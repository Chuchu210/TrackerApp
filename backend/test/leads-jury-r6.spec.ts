// JURY R6 — chaque test ÉCHOUE tant que le défaut est présent (attente = comportement correct).
import { LeadsService } from '../src/leads/leads.service';
import { contactFingerprints, contactsInAnything } from '../src/leads/lead-fields';

const CLE = 'cle-de-test-0123456789abcdef-0123456789';
const TEMOIN = contactFingerprints({ email: 'temoin@liste-de-suppression.invalid' }, CLE)[0].hash;
const cfg = { get: jest.fn().mockImplementation((k: string) => (k === 'ERASURE_HMAC_KEY' ? CLE : undefined)) };
const empreinte = (c: { phone?: string; email?: string }) => contactFingerprints(c, CLE)[0].hash;

/** Liste de suppression qui répond comme Postgres : par empreinte ET par sorte. */
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

describe('R6-1 — régression r5→r6 : une adresse effacée revient avec un caractère collé devant', () => {
  // Ann a été effacée : son adresse est DÉCLARÉE dans la liste (ligne de lead).
  const ann = [{ hash: empreinte({ email: 'ann@example.com' }), kind: 'email' }];
  // r5 : EMAIL_PARTOUT ([a-z0-9._%+-]+@…) extrayait « ann@example.com » → refus. r6 : la partie locale élargie
  // avale le caractère de tête, l'empreinte est celle de « ​ann@… » / « “ann@… » → stockée.
  it.each([
    ['espace de largeur nulle (copier-coller)', '​ann@example.com'],
    ['guillemets typographiques', '“ann@example.com”'],
    ['guillemets français', '«ann@example.com»'],
  ])('%s : refusée', async (_nom, email) => {
    expect(await envoyer(ann, { firstName: 'Ann', email })).toMatchObject({ stored: false, reason: 'erased_person' });
  });
  it('la forme inscrite est l’adresse, pas la ponctuation qui la borde', () => {
    expect(contactsInAnything({ note: 'écrire à «ann@example.com» demain' })).toEqual([{ email: 'ann@example.com' }]);
  });
});

describe('R6-2 — une constante déclarée par le partenaire : un effacement bloque TOUS ses leads suivants', () => {
  it('Ann effacée avec answers.tracking_phone = numéro du centre d’appels ⇒ Bob refusé', async () => {
    // Ce que l'effacement d'Ann inscrit : ses métadonnées de conversion portaient la réponse constante du
    // partenaire sous une clé qui « dit téléphone » → sorte `phone` (déclarée).
    const inscrits: { hash: string; kind: string }[] = [];
    const prisma = {
      lead: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'lead-1', clickId: 'c1', campaignId: 'camp-ext', isTest: false, createdAt: new Date('2026-09-01T00:00:00Z'),
          phone: '8135550142', email: null, firstName: 'Ann', lastName: null, erasedAt: null, purgedAt: null,
        }),
        findMany: jest.fn().mockResolvedValue([{ phone: '8135550142', email: null }]),
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
        findMany: jest.fn().mockResolvedValue([{ metadata: { phone: '8135550142', tracking_phone: '1-800-555-1212', q1: '2 vehicles' } }]),
        update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      postbackLog: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      click: {
        findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue({ clickId: 'c1', campaignId: 'camp-ext', isTest: false, createdAt: new Date(), rawParams: {} }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn().mockResolvedValue(0),
      $transaction: jest.fn(async (fn: (t: unknown) => Promise<void>) => fn({ lead: { update: jest.fn() } })),
    };
    await new LeadsService(cfg as never, prisma as never, {} as never).deleteOne('lead-1');
    const out = await envoyer(inscrits, {
      firstName: 'Bob', phone: '(407) 555-0199', email: 'bob@example.org', answers: { tracking_phone: '1-800-555-1212', q1: '1 vehicle' },
    });
    expect(out).toMatchObject({ stored: true });
  });
});

describe('R6-3 — le budget de 2 M caractères tronque l’inscription EN SILENCE (visites d’abord, conversions jamais lues)', () => {
  it('500 visites à 4,2 ko d’en-têtes : l’adresse de la conversion n’est pas inscrite, et la réponse dit « recorded »', async () => {
    const inscrits: string[] = [];
    const visites = Array.from({ length: 500 }, (_, i) => ({
      clickId: `c${i}`, campaignId: 'camp', isTest: false, createdAt: new Date(),
      requestHeaders: { cookie: `_ga=GA1.1.${i};` + 'x'.repeat(4200) }, rawParams: {},
    }));
    const prisma = {
      lead: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'lead-1', clickId: 'c0', campaignId: 'camp', isTest: false, createdAt: new Date('2026-09-01T00:00:00Z'),
          phone: '8135550142', email: null, firstName: 'Ann', lastName: null, erasedAt: null, purgedAt: null,
        }),
        findMany: jest.fn().mockResolvedValue([{ phone: '8135550142', email: null }]),
        upsert: jest.fn().mockResolvedValue({}), create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      erasedContact: {
        findFirst: jest.fn().mockResolvedValue({ hash: TEMOIN }),
        createMany: jest.fn().mockImplementation(({ data }: { data: { hash: string }[] }) => {
          inscrits.push(...data.map((d) => d.hash));
          return Promise.resolve({ count: data.length });
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      conversion: {
        findMany: jest.fn().mockResolvedValue([{ metadata: { contact_email: 'ann.pro@example.com' } }]),
        update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      postbackLog: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      click: {
        findMany: jest.fn().mockResolvedValue(visites), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue({ clickId: 'c0', campaignId: 'camp', isTest: false, createdAt: new Date(), rawParams: {} }),
      },
      $queryRaw: jest.fn().mockResolvedValue(visites.map((v) => ({ click_id: v.clickId, kept: true, why: '' }))),
      $executeRaw: jest.fn().mockResolvedValue(0),
      $transaction: jest.fn(async (fn: (t: unknown) => Promise<void>) => fn({ lead: { update: jest.fn() } })),
    };
    const out = await new LeadsService(cfg as never, prisma as never, {} as never).deleteOne('lead-1');
    expect(new Set(inscrits).has(empreinte({ email: 'ann.pro@example.com' }))).toBe(true);
    expect(out.suppression).toBeUndefined();
  }, 60000);
});

describe('R6-4 — un numéro français à points est lu comme une date (inscription ≠ nettoyage)', () => {
  it('« rappel au 06.12.34.56.78 » : le nettoyage le retire, l’inscription doit le voir', () => {
    expect(contactsInAnything({ note: 'rappel au 06.12.34.56.78' })).toEqual([{ phone: '0612345678' }]);
  });
});
