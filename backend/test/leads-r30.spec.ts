// Tour 30 (juré r11 : 8,5) — les bords. Chaque bloc tient un correctif ou un arbitrage écrit dans docs §9.
import { LeadsService } from '../src/leads/leads.service';
import { scrubVisitPii } from '../src/leads/lead-sql';
import { clickGroupForDimension } from '../src/analytics/campaign-drilldown.util';
import {
  contactFingerprints,
  contactsInAnything,
  declaredContactsIn,
  lireContacts,
  normalizePhone,
  withoutContact,
} from '../src/leads/lead-fields';

const CLE = 'cle-tour-30-0123456789abcdef-0123456789';
const TEMOIN = contactFingerprints({ email: 'temoin@liste-de-suppression.invalid' }, CLE)[0].hash;
const cfg = { get: jest.fn().mockImplementation((k: string) => (k === 'ERASURE_HMAC_KEY' ? CLE : undefined)) };
type Ligne = { hash: string; kind: string; groupe: string | null };
const ligne = (c: { phone?: string; email?: string }, kind: string, groupe: string | null): Ligne => ({
  hash: contactFingerprints(c, CLE)[0].hash,
  kind,
  groupe,
});

/** La table `erased_contacts`, comme Prisma la lit : `hash in`, `kind in`, `groupe` (NULL ou égal), `NOT groupe NULL`. */
function service(lignes: Ligne[]) {
  const findFirst = jest.fn().mockImplementation(
    ({ where }: { where: { kind?: string | { in: string[] }; hash?: { in: string[] }; groupe?: string | null; NOT?: unknown } }) => {
      if (where?.kind === 'temoin') return Promise.resolve({ hash: TEMOIN });
      const sortes = typeof where.kind === 'object' ? where.kind.in : null;
      const l = lignes.find(
        (x) =>
          where.hash!.in.includes(x.hash) &&
          (!sortes || sortes.includes(x.kind)) &&
          (!('groupe' in where) || (where.groupe === null ? x.groupe === null : x.groupe === where.groupe)) &&
          (!where.NOT || x.groupe !== null),
      );
      return Promise.resolve(l ? { hash: l.hash, groupe: l.groupe } : null);
    },
  );
  const findMany = jest.fn().mockImplementation(({ where }: { where: { hash: { in: string[] } } }) =>
    Promise.resolve(lignes.filter((x) => where.hash.in.includes(x.hash))),
  );
  return new LeadsService(cfg as never, { erasedContact: { findFirst, findMany, createMany: jest.fn() } } as never, {} as never);
}

describe('R11-4 — second signal : un contact trouvé dans un texte ne refuse pas seul un contact déclaré', () => {
  // Ann effacée : son numéro 813 déclaré ; dans ses notes, le numéro de Bob (727) et son adresse perso — trouvés.
  const ann = [
    ligne({ phone: '8135550142' }, 'phone', 'g-ann'),
    ligne({ phone: '7275550199' }, 'phone_texte', 'g-ann'),
    ligne({ email: 'ann.perso@example.org' }, 'email_texte', 'g-ann'),
  ];

  it('Bob, cité dans les notes d’Ann, envoie SON lead avec son numéro ⇒ accepté', async () => {
    expect(await service(ann).isErasedPerson([{ phone: '727-555-0199' }])).toBe(false);
  });

  it('Bob avec son numéro ET sa propre adresse (inconnue de la liste) ⇒ accepté', async () => {
    expect(await service(ann).isErasedPerson([{ phone: '727-555-0199', email: 'bob@example.com' }])).toBe(false);
  });

  it('Ann qui revient avec son numéro déclaré, seul ⇒ refusée (déclaré contre déclaré)', async () => {
    expect(await service(ann).isErasedPerson([{ phone: '(813) 555-0142' }])).toBe(true);
  });

  it('Ann qui revient avec les deux contacts TROUVÉS de son effacement ⇒ refusée (même groupe)', async () => {
    expect(await service(ann).isErasedPerson([{ phone: '727-555-0199', email: 'ann.perso@example.org' }])).toBe(true);
    // …et le second signal peut n'être que trouvé dans l'envoi (ses réponses).
    expect(await service(ann).isErasedPerson([{ email: 'ann.perso@example.org' }], [{ phone: '7275550199' }])).toBe(true);
  });

  it('deux contacts trouvés de DEUX effacements différents ne se prêtent pas leur signal', async () => {
    const deux = [ligne({ phone: '7275550199' }, 'phone_texte', 'g-1'), ligne({ email: 'x@example.org' }, 'email_texte', 'g-2')];
    expect(await service(deux).isErasedPerson([{ phone: '727-555-0199', email: 'x@example.org' }])).toBe(false);
  });

  it('une ligne d’avant les groupes (« avant-groupes », migration 20260919090000) garde l’ancienne règle : trouvée, elle refuse seule', async () => {
    expect(await service([ligne({ phone: '7275550199' }, 'phone_texte', 'avant-groupes')]).isErasedPerson([{ phone: '727-555-0199' }])).toBe(true);
  });

  it('trouvé à l’entrée contre trouvé à l’effacement : jamais un refus', async () => {
    expect(await service(ann).isErasedPerson([], [{ phone: '7275550199' }, { email: 'ann.perso@example.org' }])).toBe(false);
  });
});

describe('R11-4b — le consentement n’est lu ni à l’entrée ni à l’effacement', () => {
  it.each(['consent', 'consentText', 'consent_text', 'tcpa_text'])('%s : le numéro du partenaire n’est pas lu', (cle) => {
    const v = { phone: '813-555-0142', [cle]: 'Partner Insure may call me. Questions? Call 1-866-555-0100.' };
    expect(contactsInAnything(v)).toEqual([{ phone: '8135550142' }]);
    expect(contactsInAnything({ field_data: [{ name: cle, values: ['Call 1-866-555-0100'] }] })).toEqual([]);
    // …mais il est toujours retiré par le nettoyage (la clé seule suffit).
    expect(JSON.stringify(withoutContact(v, 'erased'))).not.toContain('555');
  });
});

describe('R11-1 / R11-3 — une personne, une forme', () => {
  it.each([
    ['+44 (0)7911 123456', '+44 7911 123456'],
    ['“+44 (0)7911 123456”', '0044 7911 123456'],
    ['+33 (0)6 12 34 56 78', '+33612345678'],
    ['[+49 (0)30 1234567]', '+49 30 1234567'],
  ])('%s et %s : la même empreinte', (a, b) => {
    expect(normalizePhone(a)).toBe(normalizePhone(b));
  });

  it('le numéro national étranger et sa forme internationale ne sont PAS unifiés (docs §9)', () => {
    expect(normalizePhone('07911 123456')).not.toBe(normalizePhone('+44 7911 123456'));
  });

  it.each(['813-555-0142 Ext: 12', '813-555-0142 extn 12', '(813)555-0142x.12', 'tel:+1-813-555-0142;ext=12'])(
    '%s : lu 8135550142, et retiré entier par le nettoyage',
    (t) => {
      expect(declaredContactsIn({ phone: t })).toEqual([{ phone: '8135550142' }]);
      expect(JSON.stringify(withoutContact({ note: t }, 'erased'))).not.toMatch(/555.?0142/);
    },
  );
});

describe('écritures masquées : lues ET retirées (la même règle des deux côtés)', () => {
  it.each([
    ['ann&#64;gmail.com', 'ann@gmail.com'],
    ['ann&#x40;gmail.com', 'ann@gmail.com'],
    ['{"mail":"ann\\u0040gmail.com"}', 'ann@gmail.com'],
    ['write to ann (at) gmail (dot) com', 'ann@gmail.com'],
    ['ann[at]gmail.com', 'ann@gmail.com'],
  ])('%s', (t, attendu) => {
    expect(contactsInAnything({ note: t })).toEqual([{ email: attendu }]);
    expect(JSON.stringify(withoutContact({ note: t }, 'erased'))).not.toMatch(/ann/);
  });

  it('chiffres pleine chasse : la ligne du lead aussi (`normalizePhone`, appelé directement par l’intake)', () => {
    expect(normalizePhone('８１３-５５５-０１４２')).toBe('8135550142');
  });

  it('chiffres pleine chasse : « ８１３-５５５-０１４２ »', () => {
    expect(contactsInAnything({ note: 'call ８１３-５５５-０１４２' })).toEqual([{ phone: '8135550142' }]);
    expect(JSON.stringify(withoutContact({ note: 'call ８１３-５５５-０１４２' }, 'erased'))).not.toMatch(/[０-９]{4}/);
  });

  it('« (at) » sans adresse autour ne fabrique rien, et une valeur sans personne n’est pas réécrite', () => {
    expect(contactsInAnything({ note: 'meet (at) noon, room 12' })).toEqual([]);
    expect(withoutContact({ memo: 'meet (at) noon, room 12' }, 'purged')).toBeNull();
  });
});

describe('R11-2 — un numéro étranger ne s’arrête plus au hasard', () => {
  it.each([
    ['+33 6 12 34 56 78 2 vehicles', '33612345678'],
    ['after 5 0044 7911 123456 2', '447911123456'],
    ['+447997762379) 0044 7997 762379 - 15%', '447997762379'],
    ['+49 30 1234567 12 months', '49301234567'],
    // Un blanc DOUBLE arrête le numéro, même quand le voisin tiendrait dans la longueur allemande (6 à 11).
    ['+49 30 123456  789 Main St', '4930123456'],
  ])('« %s » ⇒ %s, rien d’autre', (t, n) => {
    expect(lireContacts({ note: t }).tous).toEqual([{ phone: n }]);
  });
});

describe('R11-5 puis R12-4 — rétention : le référent, UNE règle par visite', () => {
  // Tour 31 (juré r12) : la règle du tour 30 (« une visite qui porte une personne garde l'origine ») envoyait la même
  // page d'éditeur sous deux lignes du rapport selon que la visite avait converti. Désormais chaque visite : query
  // string, fragment et identifiants partent (SQL), et seul le SEGMENT qui porte une personne — lu par le même
  // détecteur que la liste — devient `***` (JavaScript, avant le SQL).
  function client(conversions: { metadata: unknown }[], clicks: { clickId: string; rawParams: unknown; referrer: string | null }[]) {
    return {
      conversion: { findMany: jest.fn().mockResolvedValue(conversions.map((c, i) => ({ id: `v${i}`, ...c }))), update: jest.fn(), updateMany: jest.fn() },
      click: { findMany: jest.fn().mockResolvedValue(clicks), update: jest.fn(), updateMany: jest.fn() },
      postbackLog: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      $executeRaw: jest.fn().mockResolvedValue(0),
    };
  }
  const referrersEcrits = (c: ReturnType<typeof client>) =>
    Object.fromEntries(c.click.update.mock.calls.filter((x) => 'referrer' in x[0].data).map((x) => [x[0].where.clickId, x[0].data.referrer]));

  it('une visite convertie et une visite sans personne du même article gardent le MÊME référent', async () => {
    const c = client(
      [{ metadata: { email: 'ann@example.com' } }],
      [
        { clickId: 'lead', rawParams: {}, referrer: 'https://news.example/2025/best-rates' },
        { clickId: 'visite', rawParams: {}, referrer: 'https://news.example/2025/best-rates' },
        { clickId: 'perso', rawParams: {}, referrer: 'https://lp.example/confirm/ann@gmail.com/step-2' },
      ],
    );
    await scrubVisitPii(c as never, ['lead', 'visite', 'perso'], 'purged');
    // Rien à masquer dans l'article : pas de réécriture (le SQL retire query string et fragment).
    expect(referrersEcrits(c)).toEqual({ perso: 'https://lp.example/confirm/***/step-2' });
  });

  it('à l’effacement : l’origine seule', async () => {
    const c = client([], [{ clickId: 'b', rawParams: {}, referrer: 'https://news.example/2025/best-rates?x=1' }]);
    await scrubVisitPii(c as never, ['b'], 'erased');
    expect(referrersEcrits(c)).toEqual({ b: 'https://news.example/' });
  });

  it('ce que le drill-down lit ensuite : l’hôte d’un référent sans schéma n’est plus « Unassigned »', () => {
    expect(clickGroupForDimension('referrer', { referrer: 'facebook.com' } as never).label).toBe('facebook.com');
    expect(clickGroupForDimension('referrer', { referrer: null } as never).label).toBe('Unassigned');
  });
});
