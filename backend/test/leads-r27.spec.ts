// Tour 27 : la propriété étendue aux adresses enveloppées et aux URL sans schéma — la famille de cas par où R8-2 est
// passé —, les événements qui déclarent, la liste blanche élargie, et la fausse alerte « partial » supprimée.
import { LeadsService } from '../src/leads/leads.service';
import {
  contactFingerprints,
  contactsInAnything,
  declaredContactsIn,
  lireContacts,
  normalizeEmail,
  withoutContact,
} from '../src/leads/lead-fields';

function graine(n: number) {
  let s = n >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('tour 27 : ce que le nettoyage retire, l’inscription le voit — adresses enveloppées comprises', () => {
  const ENVELOPPES: [string, string][] = [
    ['', ''], ['**', '**'], ['*', '*'], ['_', '_'], ['`', '`'], ['|', '|'], ['~', '~'], ['{', '}'], ['"', '"'],
    ["'", "'"], ['(', ')'], ['[', ']'], ['<', '>'], ['«', '»'], ['“', '”'], ['„', '“'], ['• ', ''], ['​', ''],
  ];
  const AVANT = ['Please email me instead:', 'write to', 'contact', 'Q:', 'mail?', 'reach me at'];
  const APRES = ['', ' please', '?', ', thanks', ' or call later', '.'];

  it('sur 800 phrases, chaque adresse retirée par le nettoyage est inscrite sous sa forme normale', () => {
    const r = graine(27);
    const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
    const manques: string[] = [];
    for (let i = 0; i < 800; i += 1) {
      const [o, f] = pick(ENVELOPPES);
      const phrase = `${pick(AVANT)} ${o}ann@example.com${f}${pick(APRES)}`;
      if (withoutContact({ note: phrase }, 'erased') === null) continue;
      const vus = contactsInAnything({ note: phrase }).map((c) => c.email);
      if (!vus.includes('ann@example.com')) manques.push(phrase);
    }
    expect(manques).toEqual([]);
  });

  it.each([
    'www.lp.example/?tel=813-555-0142',
    'lp.example/form?phone=813-555-0142',
    '/merci?tel=813-555-0142',
    '?tel=813-555-0142',
    'https://lp.example/#tel=813-555-0142',
  ])('« %s » : le numéro est DÉCLARÉ par le nom de son paramètre', (url) => {
    expect(declaredContactsIn({ pageUrl: url })).toEqual([{ phone: '8135550142' }]);
  });

  it('une URL contenue dans une phrase se relit paramètre par paramètre, et son gad_campaignid n’est pas un numéro', () => {
    const phrase = 'voir https://lp.example/?gad_campaignid=21234567890&tel=8135550142 merci';
    expect(contactsInAnything({ note: phrase })).toEqual([{ phone: '8135550142' }]);
  });
});

describe('tour 27 : seuls les événements de CONTACT déclarent', () => {
  const CLE = 'cle-de-test-0123456789abcdef-0123456789';
  const TEMOIN = contactFingerprints({ email: 'temoin@liste-de-suppression.invalid' }, CLE)[0].hash;
  const cfg = { get: jest.fn().mockImplementation((k: string) => (k === 'ERASURE_HMAC_KEY' ? CLE : undefined)) };

  it('le numéro du bouton d’appel (call_click) s’inscrit « trouvé », le formulaire (lead) « déclaré »', async () => {
    const data: { hash: string; kind: string }[] = [];
    const prisma = {
      lead: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'lead-1', clickId: 'c1', campaignId: 'camp', isTest: false, createdAt: new Date('2026-09-01T00:00:00Z'),
          phone: null, email: null, firstName: 'Ann', lastName: null, erasedAt: null, purgedAt: null,
        }),
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      erasedContact: {
        findFirst: jest.fn().mockResolvedValue({ hash: TEMOIN }),
        createMany: jest.fn().mockImplementation(({ data: d }: { data: { hash: string; kind: string }[] }) => {
          data.push(...d);
          return Promise.resolve({ count: d.length });
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      conversion: {
        findMany: jest.fn().mockResolvedValue([
          { eventType: 'call_click', metadata: { phone: '+18885551212', placement: 'hero' } },
          { eventType: 'lead', metadata: { phone: '813-555-0142' } },
        ]),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      postbackLog: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      click: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue({ clickId: 'c1', campaignId: 'camp', isTest: false, createdAt: new Date(), rawParams: {} }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn().mockResolvedValue(0),
      $transaction: jest.fn(async (fn: (t: unknown) => Promise<void>) => fn({ lead: { update: jest.fn() } })),
    };
    await new LeadsService(cfg as never, prisma as never, {} as never).deleteOne('lead-1');
    const sorte = new Map(data.map((d) => [d.hash, d.kind]));
    expect(sorte.get(contactFingerprints({ phone: '8885551212' }, CLE)[0].hash)).toBe('phone_texte');
    expect(sorte.get(contactFingerprints({ phone: '8135550142' }, CLE)[0].hash)).toBe('phone');
  });
});

describe('tour 27 : la liste blanche, élargie à ce qui qualifie sans changer de propriétaire', () => {
  it.each(['phone_home', 'day_phone', 'cell_phone_number', 'best_phone', 'callback_phone', 'secondary_phone', 'caller', 'callerId', 'email_addr'])(
    '%s est la personne',
    (cle) => expect(declaredContactsIn({ [cle]: /mail/.test(cle) ? 'ann@example.com' : '813-555-0142' })).toHaveLength(1),
  );

  it.each(['business_phone', 'tracking_phone', 'dnis'])('%s reste « trouvé »', (cle) =>
    expect(declaredContactsIn({ [cle]: '813-555-0142' })).toEqual([]),
  );

  it('une enveloppe { … } se retire en entier', () => {
    expect(normalizeEmail('{ann@example.com}')).toBe('ann@example.com');
  });
});

describe('tour 27 : « partial » ne se déclenche que sur une vraie URL', () => {
  it('un jeton base64 au deuxième niveau (`s=YWJjZA==`) n’est pas un troisième niveau d’URL', () => {
    const url = 'https://a.example/?u=' + encodeURIComponent('https://b.example/?s=YWJjZA==');
    expect(lireContacts({ incomingPostbackUrl: url }).complet).toBe(true);
  });
});

describe('tour 27 : chaque garde isolée (elles se doublent l’une l’autre, chacune a sa preuve)', () => {
  it('dans un champ DÉCLARÉ, l’enveloppe lue dans le texte donne la forme déclarée exacte', () => {
    expect(declaredContactsIn({ contact_email: 'mail: **ann@example.com** merci' })).toEqual([{ email: 'ann@example.com' }]);
    expect(declaredContactsIn({ contact_email: 'mail: {ann@example.com} merci' })).toEqual([{ email: 'ann@example.com' }]);
  });

  // Tour 28 : la « forme nue » est retirée — un trouvé inscrit à tort fait refuser un innocent qui le déclare (juré r9).
  // Une ouverture SANS fermeture garde donc son caractère : on n'invente pas l'adresse.
  it('une ouverture SANS fermeture n’invente pas d’adresse (pas de forme nue)', () => {
    expect(contactsInAnything({ note: 'mail **ann@example.com please' }).map((c) => c.email)).not.toContain('ann@example.com');
  });

  it('`www.` sans barre oblique est une URL', () => {
    expect(declaredContactsIn({ pageUrl: 'www.lp.example?tel=813-555-0142' })).toEqual([{ phone: '8135550142' }]);
  });
});
