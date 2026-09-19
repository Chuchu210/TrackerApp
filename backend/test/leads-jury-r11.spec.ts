// JURÉ R11 — défauts prouvés. Chaque test ÉCHOUE sur le code livré (sauf mention « constat »).
import { LeadsService } from '../src/leads/leads.service';
import { contactFingerprints, lireContacts, normalizePhone } from '../src/leads/lead-fields';

const CLE = 'cle-jure-r11-0123456789abcdef-0123456789';
const TEMOIN = contactFingerprints({ email: 'temoin@liste-de-suppression.invalid' }, CLE)[0].hash;
const cfg = { get: jest.fn().mockImplementation((k: string) => (k === 'ERASURE_HMAC_KEY' ? CLE : undefined)) };

/** Efface une personne dont le lead a été reçu par l'intake : ligne normalisée + métadonnées telles que stockées. */
async function effacer(corps: { phone?: string; email?: string; answers?: Record<string, unknown> }) {
  const inscrits: { hash: string; kind: string; groupe?: string | null }[] = [];
  const ligne = { phone: normalizePhone(corps.phone), email: corps.email ?? null };
  const metadata = { ...(corps.answers ?? {}), firstName: 'Ann', email: corps.email, phone: corps.phone, source: 'partner.example' };
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
      createMany: jest.fn().mockImplementation(({ data }: { data: { hash: string; kind: string; groupe?: string | null }[] }) => {
        inscrits.push(...data);
        return Promise.resolve({ count: data.length });
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    conversion: {
      findMany: jest.fn().mockResolvedValue([{ eventType: 'lead', metadata }]),
      update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    postbackLog: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    click: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn().mockResolvedValue({ clickId: 'c1', campaignId: 'camp-1', isTest: false, createdAt: new Date(), rawParams: {} }),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(0),
    $transaction: jest.fn(async (fn: (t: unknown) => Promise<void>) => fn({ lead: { update: jest.fn() } })),
  };
  await new LeadsService(cfg as never, prisma as never, {} as never).deleteOne('lead-1');
  return inscrits;
}

function envoyer(liste: { hash: string; kind: string; groupe?: string | null }[], corps: Record<string, unknown>) {
  const prisma = {
    campaign: { upsert: jest.fn().mockResolvedValue({ id: 'camp-ext' }) },
    click: { upsert: jest.fn().mockResolvedValue({}), findUnique: jest.fn().mockResolvedValue({ isTest: false }) },
    lead: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    erasedContact: {
      findFirst: jest.fn().mockImplementation(({ where }: { where: { kind?: string | { in: string[] }; hash?: { in: string[] }; groupe?: string | null; NOT?: unknown } }) => {
        if (where?.kind === 'temoin') return Promise.resolve({ hash: TEMOIN });
        const sortes = typeof where.kind === 'object' ? where.kind.in : null;
        // La colonne `groupe` (tour 30) : `groupe: null` = ligne d'avant les groupes ; `NOT: { groupe: null }`.
      const bonGroupe = (g?: string | null) =>
        (!('groupe' in where) || (where.groupe === null ? !g : g === where.groupe)) && (!where.NOT || Boolean(g));
      const l = liste.find(
        (x) => where.hash!.in.includes(x.hash) && (!sortes || sortes.includes(x.kind)) && bonGroupe(x.groupe),
      );
        return Promise.resolve(l ? { hash: l.hash, groupe: l.groupe ?? null } : null);
      }),
      // Tour 31 : la lecture groupée d'`isErasedPerson`, sur les mêmes lignes.
      findMany: jest.fn().mockImplementation(({ where }: { where: { hash: { in: string[] } } }) =>
        Promise.resolve(liste.filter((x) => where.hash.in.includes(x.hash)).map((x) => ({ hash: x.hash, kind: x.kind, groupe: x.groupe ?? null }))),
      ),
      createMany: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  return new LeadsService(cfg as never, prisma as never, { create: jest.fn().mockResolvedValue({ id: 'c' }) } as never).intake({
    source: 'partner.example',
    firstName: 'Ann',
    ...corps,
  } as never);
}

describe('R11-1 — numéro étranger : le préfixe national « (0) » change l’identité (P1, de bout en bout)', () => {
  it.each([
    ['+44 (0)7911 123456', '+44 7911 123456'],
    ['+44 7911 123456', '+44 (0)7911 123456'],
    ['+33 (0)6 12 34 56 78', '+33 6 12 34 56 78'],
    ['+49 (0)30 1234567', '+49 30 1234567'],
  ])('effacée avec %s, revient avec %s ⇒ refusée', async (avant, apres) => {
    const liste = await effacer({ phone: avant });
    const r = await envoyer(liste, { phone: apres });
    expect(r.stored).toBe(false);
  });
});

describe('R11-2 — numéro international suivi de chiffres : la suite voisine est avalée (P1 + P2)', () => {
  it.each([
    ['call +44 7911 123456 123 Main St', '447911123456'],
    ['cell +52 1 55 1234 5678 10:30am', '5215512345678'],
    ['+63 917 125 8817  09/17/2026', '639171258817'],
    ['+91 98759 61657 - 150 lbs', '919875961657'],
    ['+49 30 1234567 2019 Honda Civic', '49301234567'],
  ])('« %s » ⇒ %s, rien d’autre', (texte, attendu) => {
    expect(lireContacts({ notes: texte }).tous).toEqual([{ phone: attendu }]);
  });
});

describe('R11-3 — extensions non reconnues : le numéro rangé et déclaré est faux (P2, qualité de ligne)', () => {
  it.each([
    ['813-555-0142 Ext: 12'],
    ['813-555-0142 extn 12'],
    ['813-555-0142 x.12'],
    ['+1 813-555-0142;ext=12'],
    ['tel:+1-813-555-0142;ext=12'],
    ['tel:8135550142;phone-context=+1'],
  ])('normalizePhone(%s) = 8135550142, et c’est le seul numéro déclaré', (ecrit) => {
    expect(normalizePhone(ecrit.replace(/^tel:/, ''))).toBe('8135550142');
    expect(lireContacts({ phone: ecrit }).declares).toEqual([{ phone: '8135550142' }]);
  });
});

describe('R11-4 (constat, documenté §9) — un tiers cité dans les notes de la personne effacée est refusé ensuite', () => {
  it('Ann effacée avec « my husband Bob 727-555-0199 » ; Bob envoie SON lead ⇒ refusé', async () => {
    const liste = await effacer({ phone: '813-555-0142', answers: { comments2: 'Please call my husband Bob at 727-555-0199 after 6pm' } });
    const bob = await envoyer(liste, { firstName: 'Bob', phone: '727-555-0199' });
    // La promesse : « ne jamais refuser un innocent ». Bob est un innocent.
    expect(bob.stored).toBe(true);
  });
});

describe('R11-4b (constat) — le numéro du PARTENAIRE dans le texte de consentement est inscrit à l’effacement', () => {
  it('Ann effacée ; le partenaire envoie un lead de test avec son propre numéro de standard ⇒ refusé', async () => {
    const liste = await effacer({
      phone: '813-555-0142',
      answers: { consent: 'By clicking Submit I agree that Partner Insure may call me. Questions? Call 1-866-555-0100.' },
    });
    const test = await envoyer(liste, { firstName: 'Test', phone: '1-866-555-0100', isTest: true });
    expect(test.stored).toBe(true);
  });
});
