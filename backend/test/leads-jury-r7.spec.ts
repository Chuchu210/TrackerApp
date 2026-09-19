// JURY R7 — chaque test ÉCHOUE tant que le défaut est présent (attente = comportement correct).
import { LeadsService } from '../src/leads/leads.service';
import { contactFingerprints, contactsInAnything, leadFromConversion, withoutContact } from '../src/leads/lead-fields';

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

/** Efface Ann (ligne de lead : `ligne`, conversion : `conversion`) ; rend ce qui a été inscrit et la réponse. */
async function effacer(ligne: { phone: string | null; email: string | null }, conversion: Record<string, unknown>) {
  const inscrits: { hash: string; kind: string }[] = [];
  const prisma = {
    lead: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'lead-1', clickId: 'c1', campaignId: 'camp-ext', isTest: false, createdAt: new Date('2026-09-01T00:00:00Z'),
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
      findMany: jest.fn().mockResolvedValue([conversion]),
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
  const out = await new LeadsService(cfg as never, prisma as never, {} as never).deleteOne('lead-1');
  return { inscrits, out };
}

describe('R7-1 — régression r5→r6 toujours là : un « ? » ou un « = » dans un texte libre cache le numéro à l’inscription', () => {
  // Le nettoyage retire le numéro ; l'inscription ne le lit pas (le texte après « ? » part dans URLSearchParams comme
  // une CLÉ sans valeur, et « horsParametres » s'arrête au « ? »). r5 le trouvait.
  it.each([
    ['Can you call me back? 813-555-0142'],
    ['Best time? after 5pm at 813-555-0142'],
    ['813-555-0142 = my cell'],
    ['reach me at ann@example.com? or 8135550142'],
  ])('« %s » : ce que le nettoyage retire, l’inscription le voit', (texte) => {
    expect(JSON.stringify(withoutContact({ q5: texte }, 'purged'))).not.toContain('555');
    expect(contactsInAnything({ q5: texte })).toContainEqual({ phone: '8135550142' });
  });

  it('bout en bout : Ann effacée (numéro seulement dans son commentaire) — inscrit, et refusée avec un second signal', async () => {
    // Tour 31 : sa liste simulée ignorait le groupe, donc appliquait sans le dire la règle d'avant le second signal
    // (juré r11, doc §9). Ce que ce tour prouvait — le contact est inscrit sous la BONNE empreinte — est vérifié
    // directement ; la règle, dans ses deux sens, avec un second contact TROUVÉ seulement dans le même effacement.
    const { inscrits } = await effacer(
      { phone: null, email: 'ann@example.com' },
      { metadata: { email: 'ann@example.com', q5: 'Can you call me back? 813-555-0142 or text 727-555-0199' } },
    );
    const empreinte = (c: { phone?: string }) => contactFingerprints(c, CLE)[0].hash;
    expect(inscrits).toContainEqual(expect.objectContaining({ hash: empreinte({ phone: '8135550142' }), kind: 'phone_texte' }));
    const out = await envoyer(inscrits, { firstName: 'Ann', phone: '(813) 555-0142', answers: { note: 'or 727-555-0199' } });
    expect(out).toMatchObject({ stored: false, reason: 'erased_person' });
    expect(await envoyer(inscrits, { firstName: 'Ann', phone: '(813) 555-0142' })).toMatchObject({ stored: true });
  });
});

describe('R7-2 — R6-2 corrigé par liste noire : d’autres clés « de tiers » restent DÉCLARÉES', () => {
  // Vocabulaire courant du lead-gen assurance US : transfert d'appel en direct, compagnie d'assurance, vendeur.
  it.each([['transfer_phone'], ['carrier_phone'], ['vendor_phone']])(
    'Ann effacée avec answers.%s = constante du partenaire ⇒ Bob doit passer',
    async (cle) => {
      const { inscrits } = await effacer(
        { phone: '8135550142', email: null },
        { metadata: { phone: '8135550142', [cle]: '1-800-555-1212', q1: '2 vehicles' } },
      );
      const out = await envoyer(inscrits, {
        firstName: 'Bob', phone: '(407) 555-0199', email: 'bob@example.org', answers: { [cle]: '1-800-555-1212', q1: '1 vehicle' },
      });
      expect(out).toMatchObject({ stored: true });
    },
  );
});

describe('R7-3 — normalizeEmail : liste noire de bordures, à la fois incomplète et trop large', () => {
  const ann = [{ hash: empreinte({ email: 'ann@example.com' }), kind: 'email' }];
  it.each([
    ['guillemets allemands', '„ann@example.com“'],
    ['puce copiée', '•ann@example.com'],
    ['crochets CJK', '「ann@example.com」'],
  ])('%s : l’adresse effacée doit être refusée', async (_n, email) => {
    expect(await envoyer(ann, { firstName: 'Ann', email })).toMatchObject({ stored: false, reason: 'erased_person' });
  });
  it.each([['_ann@corp.example'], ['~ann@corp.example'], ["'ann@corp.example"]])(
    '« %s » (caractère légal RFC 5322 en tête) est rangée telle quelle, pas remplacée par la boîte d’un autre',
    (email) => {
      expect(leadFromConversion({ email }).email).toBe(email);
    },
  );
});

describe('R7-4 — troisième niveau d’URL : ni inscrit, ni signalé « partial »', () => {
  it('le numéro du troisième niveau est nettoyé ; l’effacement doit l’inscrire ou dire « partial »', async () => {
    const url =
      'https://buyer.example/pb?u=' +
      encodeURIComponent('https://lp.example/?r=' + encodeURIComponent('https://form.example/?p=8135550142'));
    const { inscrits, out } = await effacer({ phone: null, email: 'ann@example.com' }, { incomingPostbackUrl: url });
    const inscrit = inscrits.some((i) => i.hash === empreinte({ phone: '8135550142' }));
    expect(inscrit || out.suppression === 'partial').toBe(true);
  });
});
