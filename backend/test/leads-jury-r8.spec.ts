// JURY R8 — chaque test ÉCHOUE tant que le défaut est présent (attente = comportement correct / promis par la doc).
import { LeadsService } from '../src/leads/leads.service';
import {
  contactFingerprints,
  contactsInAnything,
  declaredContactsIn,
  lireContacts,
  normalizeEmail,
  withoutContact,
} from '../src/leads/lead-fields';

const CLE = 'cle-de-test-0123456789abcdef-0123456789';
const TEMOIN = contactFingerprints({ email: 'temoin@liste-de-suppression.invalid' }, CLE)[0].hash;
const cfg = { get: jest.fn().mockImplementation((k: string) => (k === 'ERASURE_HMAC_KEY' ? CLE : undefined)) };

function liste(lignes: { hash: string; kind: string }[]) {
  return {
    findFirst: jest.fn().mockImplementation(({ where }: { where: { kind?: string | { in: string[] }; hash?: { in: string[] } } }) => {
      if (where?.kind === 'temoin') return Promise.resolve({ hash: TEMOIN });
      const sortes = typeof where.kind === 'object' ? where.kind.in : null;
      const l = lignes.find((x) => where.hash!.in.includes(x.hash) && (!sortes || sortes.includes(x.kind)));
      return Promise.resolve(l ? { hash: l.hash } : null);
    }),
    // Tour 31 : la lecture groupée d'`isErasedPerson`, sur les mêmes lignes.
    findMany: jest.fn().mockImplementation(({ where }: { where: { hash: { in: string[] } } }) =>
      Promise.resolve(
        lignes.filter((x) => where.hash.in.includes(x.hash)).map((x) => ({ hash: x.hash, kind: x.kind, groupe: (x as { groupe?: string | null }).groupe ?? null })),
      ),
    ),
    createMany: jest.fn(),
    updateMany: jest.fn(),
  };
}
function envoyer(lignes: { hash: string; kind: string }[], corps: Record<string, unknown>) {
  const prisma = {
    campaign: { upsert: jest.fn().mockResolvedValue({ id: 'camp-ext' }) },
    click: { upsert: jest.fn().mockResolvedValue({}), findUnique: jest.fn().mockResolvedValue({ isTest: false }) },
    lead: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    erasedContact: liste(lignes),
  };
  return new LeadsService(cfg as never, prisma as never, { create: jest.fn().mockResolvedValue({ id: 'c' }) } as never).intake({
    source: 'monsite.com',
    ...corps,
  } as never);
}

async function effacer(ligne: { phone: string | null; email: string | null }, conversions: Record<string, unknown>[]) {
  const inscrits: { hash: string; kind: string }[] = [];
  const prisma = {
    lead: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'lead-1', clickId: 'c1', campaignId: 'camp-1', isTest: false, createdAt: new Date('2026-09-01T00:00:00Z'),
        ...ligne, firstName: 'Ann', lastName: null, erasedAt: null, purgedAt: null,
      }),
      findMany: jest.fn().mockResolvedValue([ligne]),
      upsert: jest.fn().mockResolvedValue({}), create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    erasedContact: {
      findFirst: jest.fn().mockResolvedValue({ hash: TEMOIN }),
      createMany: jest.fn().mockImplementation(({ data }: { data: { hash: string; kind: string }[] }) => {
        inscrits.push(...data);
        return Promise.resolve({ count: data.length });
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    conversion: {
      findMany: jest.fn().mockResolvedValue(conversions),
      update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    postbackLog: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    click: {
      findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn().mockResolvedValue({ clickId: 'c1', campaignId: 'camp-1', isTest: false, createdAt: new Date(), rawParams: {} }),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(0),
    $transaction: jest.fn(async (fn: (t: unknown) => Promise<void>) => fn({ lead: { update: jest.fn() } })),
  };
  const out = await new LeadsService(cfg as never, prisma as never, {} as never).deleteOne('lead-1');
  return { inscrits, out };
}

describe('R8-1 — le numéro d’appel de NOS LP (call_click.metadata.phone) est inscrit comme DÉCLARÉ', () => {
  // nexoquote/site/src/scripts/form-engine.js:217 : tk('trackCallClick', { phone: <href tel: du bouton>, placement… })
  // → conversion `call_click` avec metadata.phone = NOTRE numéro de suivi. `phone` est dans la liste blanche.
  it('Ann (a cliqué « appeler » puis rempli le formulaire) est effacée ⇒ un lead d’appel de Bob portant ce numéro doit passer', async () => {
    const { inscrits } = await effacer({ phone: '8135550142', email: 'ann@example.com' }, [
      { metadata: { phone: '+18885551212', placement: 'hero', state: 'FL', form_sent: false } },
      { metadata: { phone: '8135550142', email: 'ann@example.com', firstName: 'Ann' } },
    ]);
    // Doc §9 : « your own tracking number never blocks your other leads ».
    const out = await envoyer(inscrits, {
      firstName: 'Bob', phone: '(407) 555-0199', email: 'bob@example.org', answers: { dnis: '1-888-555-1212', q1: 'yes' },
    });
    expect(out).toMatchObject({ stored: true });
  });
});

describe('R8-2 — régression r7→r8 : une adresse ENVELOPPÉE dans un texte libre est inscrite AVEC son enveloppe', () => {
  // EMAIL_PARTOUT coupe l'enveloppe fermante (`**ann@x.com**` → `**ann@x.com`), puis sansBordures ne voit plus
  // qu'elle « enveloppe » et garde le caractère de tête : l'empreinte est celle de `**ann@x.com`, pas d'`ann@x.com`.
  // r7 retirait ces caractères de tête et inscrivait `ann@example.com`.
  it.each(['**ann@example.com**', '*ann@example.com*', '_ann@example.com_', '`ann@example.com`', '|ann@example.com|'])(
    'texte « write to %s please » : l’adresse trouvée = normalizeEmail de l’adresse',
    (b) => {
      expect(normalizeEmail(b)).toBe('ann@example.com');
      expect(contactsInAnything({ q5: `write to ${b} please` })).toContainEqual({ email: 'ann@example.com' });
    },
  );

  it('bout en bout : Ann effacée (adresse seulement en gras dans son commentaire) revient avec cette adresse ⇒ doit être refusée', async () => {
    // Tour 31 : sa liste simulée ignorait le groupe, donc appliquait sans le dire la règle d'avant le second signal
    // (juré r11, doc §9). Ce que ce tour prouvait — le contact est inscrit sous la BONNE empreinte — est vérifié
    // directement ; la règle, dans ses deux sens, avec un second contact TROUVÉ seulement dans le même effacement.
    const { inscrits } = await effacer({ phone: '8135550142', email: null }, [
      { metadata: { phone: '8135550142', q5: 'Please email me instead: **ann@example.com** or text 727-555-0199' } },
    ]);
    // Le nettoyage a bien retiré l'adresse…
    expect(JSON.stringify(withoutContact({ q5: 'Please email me instead: **ann@example.com**' }, 'purged'))).not.toContain('ann@');
    // …et l'inscription porte SON empreinte (pas celle de `**ann@…**`) : Ann revient par son adresse et un autre
    // contact trouvé du même effacement ⇒ refusée ; l'adresse seule ne suffit plus (second signal, doc §9).
    expect(inscrits).toContainEqual(expect.objectContaining({ hash: contactFingerprints({ email: 'ann@example.com' }, CLE)[0].hash, kind: 'email_texte' }));
    const out = await envoyer(inscrits, { firstName: 'Ann', email: 'ann@example.com', answers: { note: 'text 727-555-0199' } });
    expect(out).toMatchObject({ stored: false, reason: 'erased_person' });
    expect(await envoyer(inscrits, { firstName: 'Ann', email: 'ann@example.com' })).toMatchObject({ stored: true });
  });
});

describe('R8-3 — régression r7→r8 : la détection d’URL exige un schéma ; la doc promet `?tel=` déclaré et gad_* ignoré', () => {
  it.each(['www.lp.example/?tel=8135550142', 'lp.example/form?phone=8135550142', '?tel=8135550142', 'https://lp.example/p?a=1#tel=8135550142'])(
    '« %s » : le paramètre `tel`/`phone` est déclaré (doc §9 ; r7 le faisait)',
    (url) => {
      expect(declaredContactsIn({ pageUrl: url })).toContainEqual({ phone: '8135550142' });
    },
  );
  it.each(['www.lp.example/?gad_campaignid=21234567890', 'https://lp.example/?q=a b&gad_campaignid=21234567890'])(
    '« %s » : gad_campaignid n’est pas un numéro (doc §9 ; r7 le faisait)',
    (url) => {
      expect(contactsInAnything({ pageUrl: url })).toEqual([]);
    },
  );
});

describe('R8-4 — « partial » à tort : une valeur à « = » (base64) au 2e niveau d’URL', () => {
  it('une URL d’atterrissage dans une URL de postback, avec un jeton base64 : tout a été lu', () => {
    const lp = 'https://lp.example/?s=YWJjZA==';
    expect(lireContacts({ incomingPostbackUrl: `https://t.example/pb?lp=${encodeURIComponent(lp)}` }).complet).toBe(true);
  });
});
