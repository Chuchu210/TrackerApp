// JURÉ R12 — chaque test ÉCHOUE tant que le défaut est présent. Attente = promesse de la doc §9 :
// (a) l'effacement retire la personne ; (b) on ne refuse pas un innocent ; (c) ce qui est inscrit est ce qui est retiré.
import { LeadsService } from '../src/leads/leads.service';
import { scrubVisitPii } from '../src/leads/lead-sql';
import { contactFingerprints, declaredContactsIn, lireContacts, sanitizeUrlPii, withoutContact } from '../src/leads/lead-fields';

const CLE = 'cle-jury-r12-0123456789abcdef-0123456789';
const TEMOIN = contactFingerprints({ email: 'temoin@liste-de-suppression.invalid' }, CLE)[0].hash;
const cfg = { get: jest.fn().mockImplementation((k: string) => (k === 'ERASURE_HMAC_KEY' ? CLE : undefined)) };

type Ligne = { hash: string; kind: string; groupe: string | null };

/** `erased_contacts` en mémoire, avec la sémantique Postgres que le service utilise (PK hash, skipDuplicates). */
function table() {
  const lignes: Ligne[] = [{ hash: TEMOIN, kind: 'temoin', groupe: null }];
  const match = (x: Ligne, where: Record<string, unknown>) => {
    const h = where.hash as { in: string[] } | undefined;
    const k = where.kind as string | { in: string[] } | undefined;
    if (h && !h.in.includes(x.hash)) return false;
    if (typeof k === 'string' && x.kind !== k) return false;
    if (k && typeof k === 'object' && !k.in.includes(x.kind)) return false;
    if ('groupe' in where && (where.groupe === null ? x.groupe !== null : x.groupe !== where.groupe)) return false;
    if (where.NOT && x.groupe === null) return false;
    return true;
  };
  return {
    lignes,
    findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => lignes.find((x) => match(x, where)) ?? null),
    // Porté au tour 31 : la lecture groupée d'`isErasedPerson` (juré r12, R12-5), même filtre.
    findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => lignes.filter((x) => match(x, where))),
    createMany: jest.fn(async ({ data }: { data: Ligne[] }) => {
      for (const d of data) if (!lignes.some((x) => x.hash === d.hash)) lignes.push({ ...d, groupe: d.groupe ?? null });
      return { count: data.length };
    }),
    updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<Ligne> }) => {
      let count = 0;
      for (const x of lignes) if (match(x, where)) (Object.assign(x, data), (count += 1));
      return { count };
    }),
  };
}

/** Un effacement complet par `deleteOne`, sur une personne dont la conversion `lead` porte `metadata`. */
async function effacer(t: ReturnType<typeof table>, ligne: { phone: string | null; email: string | null }, metadata: Record<string, unknown>) {
  const updates: unknown[] = [];
  const prisma = {
    lead: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'lead-1', clickId: 'c1', campaignId: 'camp-1', isTest: false, createdAt: new Date('2026-09-01T00:00:00Z'),
        ...ligne, firstName: 'Juan', lastName: null, erasedAt: null, purgedAt: null,
      }),
      findMany: jest.fn().mockResolvedValue([ligne]),
      upsert: jest.fn().mockResolvedValue({}), create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    erasedContact: t,
    conversion: {
      findMany: jest.fn().mockResolvedValue([{ id: 'v1', clickId: 'c1', eventType: 'lead', metadata }]),
      update: jest.fn(async (a: unknown) => (updates.push(a), {})),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    postbackLog: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    click: {
      findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn().mockResolvedValue({ clickId: 'c1', campaignId: 'camp-1', isTest: false, createdAt: new Date(), rawParams: {} }),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(0),
    $transaction: jest.fn(async (fn: (x: unknown) => Promise<void>) => fn({ lead: { update: jest.fn() } })),
  };
  const out = await new LeadsService(cfg as never, prisma as never, {} as never).deleteOne('lead-1');
  return { out, updates };
}

function envoyer(t: ReturnType<typeof table>, corps: Record<string, unknown>) {
  const prisma = {
    campaign: { upsert: jest.fn().mockResolvedValue({ id: 'camp-ext' }) },
    click: { upsert: jest.fn().mockResolvedValue({}), findUnique: jest.fn().mockResolvedValue({ isTest: false }) },
    lead: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    erasedContact: t,
  };
  return new LeadsService(cfg as never, prisma as never, { create: jest.fn().mockResolvedValue({ id: 'c' }) } as never).intake({
    source: 'monsite.com',
    ...corps,
  } as never);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('R12-1 — un numéro US DÉCLARÉ (donc inscrit) reste en clair après l’effacement', () => {
  // `champDeLaPersonne` déclare `whatsapp`, `cell_phone`, `home_phone`… ; le nettoyage ne retire par CLÉ que
  // PII_METADATA_KEYS (lead-fields.ts:751) et, ailleurs, ce que `suitesPersonnelles` reconnaît — dont la classe de
  // séparateurs est `[\d ().-]` (lead-fields.ts:1028). Espace insécable, tiret demi-cadratin, trait d'union
  // insécable, barre oblique : lus (normalizePhone de la valeur entière) et inscrits, jamais retirés.
  const formes = ['813 555 0142', '(813) 555-0142', '813–555–0142', '813‑555‑0142', '813/555-0142'];

  it.each(formes)('scrubVisitPii(erased) sur { whatsapp: %j } : inscrit, donc doit être retiré', async (f) => {
    expect(declaredContactsIn({ whatsapp: f })).toContainEqual({ phone: '8135550142' });
    const metadata = { whatsapp: f, cell_phone: f, zip: '33610' };
    const client = {
      conversion: {
        findMany: jest.fn().mockResolvedValue([{ id: 'v1', clickId: 'c1', metadata }]),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      click: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn() },
      postbackLog: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      $executeRaw: jest.fn().mockResolvedValue(0),
    };
    await scrubVisitPii(client as never, ['c1'], 'erased');
    const ecrit = client.conversion.update.mock.calls[0]?.[0]?.data?.metadata ?? metadata; // pas d'update = inchangé
    expect(JSON.stringify(ecrit).replace(/\D/g, '')).not.toContain('8135550142');
  });

  it.each(formes)('texte libre « Call me at %s » : ni lu ni retiré', (f) => {
    const t = `Call me at ${f} tonight`;
    expect(lireContacts({ message: t }).tous).toContainEqual({ phone: '8135550142' });
    expect(JSON.stringify(withoutContact({ message: t }, 'erased') ?? { message: t })).not.toContain('555');
  });

  it('URL d’atterrissage `?whatsapp=813%C2%A0555%C2%A00142` : retirée à l’effacement', () => {
    expect(sanitizeUrlPii('https://lp.example/q?whatsapp=813%C2%A0555%C2%A00142&utm_source=fb', 'erased')).not.toMatch(/555/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('R12-2 — les formats STANDARD brésilien et allemand ne sont ni lus ni retirés', () => {
  // BR : « 91234-5678 » est pris pour un ZIP+4 (lead-fields.ts:958) ; DE : un bloc de 8 chiffres est « une référence »
  // (lead-fields.ts:981). Ce sont LA façon d'écrire un portable au Brésil et en Allemagne.
  it.each([
    ['+55 11 91234-5678', '5511912345678'],
    ['+55 (11) 91234-5678', '5511912345678'],
    ['+49 151 23456789', '4915123456789'],
    ['+49 30 12345678', '493012345678'],
  ])('« WhatsApp me %s » : lu comme %s, et retiré', (f, n) => {
    const t = `WhatsApp me ${f} after 6`;
    expect(lireContacts({ message: t }).tous).toContainEqual({ phone: n });
    expect(JSON.stringify(withoutContact({ message: t }, 'erased') ?? { message: t })).not.toMatch(/5678|6789/);
  });

  it('champ déclaré `whatsapp: "+55 11 91234-5678"` : empreinte inscrite, valeur laissée en base', () => {
    expect(declaredContactsIn({ whatsapp: '+55 11 91234-5678' })).toContainEqual({ phone: '5511912345678' });
    expect(withoutContact({ whatsapp: '+55 11 91234-5678' }, 'erased')).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('R12-3 — « +CC <numéro national d’un bloc> » inscrit un AUTRE numéro, DÉCLARÉ : un innocent US refusé', () => {
  // « +52 8135550142 » : le bloc de 10 chiffres est « une référence » (> 7 chiffres, lead-fields.ts:981), la fenêtre
  // étrangère échoue, et `fenetres` relit « 8135550142 » SEUL — un numéro de Tampa. Sous `phone` il est DÉCLARÉ.
  it('fonction : « +52 8135550142 » sous `phone` ne déclare que 528135550142', () => {
    expect(declaredContactsIn({ phone: '+52 8135550142' }).map((c) => c.phone)).toEqual(['528135550142']);
  });

  it('bout en bout : Juan (Monterrey, +52 8135550142) effacé ⇒ Tom de Tampa, (813) 555-0142, doit être stocké', async () => {
    const t = table();
    await effacer(t, { phone: '528135550142', email: 'juan@example.mx' }, { phone: '+52 8135550142', email: 'juan@example.mx' });
    const out = await envoyer(t, { firstName: 'Tom', phone: '(813) 555-0142' });
    expect(out).toMatchObject({ stored: true });
  });

  it('bout en bout, l’autre sens : Tom de Tampa effacé ⇒ Juan (+52 8135550142) doit être stocké', async () => {
    const t = table();
    await effacer(t, { phone: '8135550142', email: 'tom@example.com' }, { phone: '813-555-0142', email: 'tom@example.com' });
    const out = await envoyer(t, { firstName: 'Juan', phone: '+52 8135550142' });
    expect(out).toMatchObject({ stored: true });
  });

  it('même mécanisme : Londres « +44 2079460958 » inscrit 2079460958 (indicatif 207, Maine)', () => {
    expect(declaredContactsIn({ phone: '+44 2079460958' }).map((c) => c.phone)).toEqual(['442079460958']);
  });
});
