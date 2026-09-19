// JURY R9 — chaque test ÉCHOUE tant que le défaut est présent (attente = comportement correct / promis par la doc).
import { LeadsService } from '../src/leads/leads.service';
import {
  contactFingerprints,
  contactsInAnything,
  declaredContactsIn,
  lireContacts,
  redactPersonal,
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

async function effacer(
  ligne: { phone: string | null; email: string | null },
  conversions: Record<string, unknown>[],
  visites: Record<string, unknown>[] = [],
) {
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
      findMany: jest.fn().mockResolvedValue(visites), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn().mockResolvedValue({ clickId: 'c1', campaignId: 'camp-1', isTest: false, createdAt: new Date(), rawParams: {} }),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(0),
    $transaction: jest.fn(async (fn: (t: unknown) => Promise<void>) => fn({ lead: { update: jest.fn() } })),
  };
  const out = await new LeadsService(cfg as never, prisma as never, {} as never).deleteOne('lead-1');
  return { inscrits, out };
}

describe('R9-1 — régression r8→r9 : une valeur qui COMMENCE par une URL à schéma est coupée au premier « ? » / « # »', () => {
  // r9 : `estUrl` accepte désormais une URL à schéma SUIVIE d'espaces (`/^scheme:\/\/\S/`), et coupe aussi au « # ».
  // Tout ce qui suit le premier « ? » ou « # » n'est plus lu que comme `clé=valeur` : un numéro sans « = » devient une
  // CLÉ de URLSearchParams et n'est jamais lu. C'est exactement le défaut r7 (« call me back? 813… » caché), revenu
  // pour un texte qui commence par un lien. Le nettoyage, lui, retire bien le numéro.
  const textes = [
    'https://www.zillow.com/homedetails/12-Oak-St is my house. Can you call me? 813-555-0142',
    'https://lp.example/#/merci/8135550142',
    'https://www.facebook.com/ann.dupont #1 priority: 813-555-0142',
  ];
  it.each(textes)('« %s » : le numéro effacé par le nettoyage doit être inscrit', (t) => {
    expect(JSON.stringify(withoutContact({ q5: t }, 'purged'))).not.toContain('555-0142');
    expect(JSON.stringify(withoutContact({ q5: t }, 'purged'))).not.toContain('5550142');
    expect(contactsInAnything({ q5: t })).toContainEqual({ phone: '8135550142' });
  });

  it('bout en bout : Ann (e-mail au formulaire, numéro seulement dans son commentaire) revient par ce numéro ⇒ doit être refusée', async () => {
    // Tour 31 : sa liste simulée ignorait le groupe, donc appliquait sans le dire la règle d'avant le second signal
    // (juré r11, doc §9). Ce que ce tour prouvait — le contact est inscrit sous la BONNE empreinte — est vérifié
    // directement ; la règle, dans ses deux sens, avec un second contact TROUVÉ seulement dans le même effacement.
    const { inscrits } = await effacer({ phone: null, email: 'ann@example.com' }, [
      { eventType: 'lead', metadata: { email: 'ann@example.com', q5: `${textes[0]} — or ann.alt@example.org` } },
    ]);
    expect(inscrits).toContainEqual(expect.objectContaining({ hash: contactFingerprints({ phone: '8135550142' }, CLE)[0].hash, kind: 'phone_texte' }));
    const out = await envoyer(inscrits, { firstName: 'Ann', phone: '813-555-0142', answers: { note: 'ann.alt@example.org' } });
    expect(out).toMatchObject({ stored: false, reason: 'erased_person' });
    expect(await envoyer(inscrits, { firstName: 'Ann', phone: '813-555-0142' })).toMatchObject({ stored: true });
  });
});

describe('R9-2 — la forme « nue » toujours inscrite fait refuser QUELQU’UN D’AUTRE (déclaré à l’entrée ⇒ tout type suffit)', () => {
  // Doc §9 : « Characters an address may legally start with (`_ann@…`, `~ann@…`) are kept » — donc `_ann@corp.example`
  // et `ann@corp.example` sont deux boîtes. r9 inscrit en plus `ann@corp.example` « trouvé » ; or `isErasedPerson`
  // compare un DÉCLARÉ entrant à TOUTE la liste (`kind` libre) : l'autre personne est refusée.
  it.each(['_ann@corp.example', '~ann@corp.example', '-ann@corp.example'])(
    'effacer %s ne doit pas refuser ann@corp.example (une autre boîte)',
    async (adresse) => {
      const { inscrits } = await effacer({ phone: '8135550142', email: adresse }, [
        { eventType: 'lead', metadata: { email: adresse, phone: '8135550142' } },
      ]);
      const out = await envoyer(inscrits, { firstName: 'Bob', email: 'ann@corp.example', phone: '(407) 555-0199' });
      expect(out).toMatchObject({ stored: true });
    },
  );
});

describe('R9-3 — liste blanche élargie : `work_phone` déclaré, `business_phone` trouvé — même numéro, deux régimes', () => {
  // Doc §9 cite `business_phone` comme « read as found ». `work_phone` / `phone_work` / `office`… désignent la même
  // chose (souvent un standard partagé) mais sont maintenant DÉCLARÉS : un collègue qui l'écrit est refusé.
  it('les deux noms du même numéro professionnel ont le même régime', () => {
    const d = (k: string) => declaredContactsIn({ [k]: '800-555-0100' }).length;
    expect(d('work_phone')).toBe(d('business_phone'));
  });

  it('Ann effacée (work_phone = standard d’Acme) ⇒ Bob, collègue, qui donne son propre numéro + le même work_phone, doit passer', async () => {
    const { inscrits } = await effacer({ phone: '8135550142', email: 'ann@example.com' }, [
      { eventType: 'lead', metadata: { phone: '8135550142', email: 'ann@example.com', work_phone: '800-555-0100' } },
    ]);
    const out = await envoyer(inscrits, {
      firstName: 'Bob', phone: '(407) 555-0199', email: 'bob@example.org', answers: { work_phone: '800-555-0100' },
    });
    expect(out).toMatchObject({ stored: true });
  });
});

describe('R9-4 — « + » non encodé dans une URL : l’étiquette devient une adresse DÉCLARÉE (celle de quelqu’un d’autre)', () => {
  // `?email=ann+quotes@gmail.com` (URL construite sans encodage) : URLSearchParams lit « ann quotes@gmail.com »,
  // puis EMAIL_PARTOUT y prend `quotes@gmail.com` sous la clé `email` ⇒ DÉCLARÉ. La boîte de quelqu'un d'autre est
  // inscrite comme déclarée : il est refusé même quand elle n'est que TROUVÉE dans son envoi.
  it('le propriétaire de quotes@gmail.com n’est pas refusé après l’effacement d’ann+quotes@gmail.com', async () => {
    const { inscrits } = await effacer(
      { phone: '8135550142', email: 'ann+quotes@gmail.com' },
      [{ eventType: 'lead', metadata: { phone: '8135550142', email: 'ann+quotes@gmail.com' } }],
      [{ clickId: 'c1', landingUrl: 'https://lp.example/quote?email=ann+quotes@gmail.com&zip=33601', rawParams: { email: 'ann+quotes@gmail.com' } }],
    );
    const out = await envoyer(inscrits, { firstName: 'Carl', email: 'quotes@gmail.com', phone: '(305) 555-0177' });
    expect(out).toMatchObject({ stored: true });
  });
});

describe('R9-5 — (mineur) coût quadratique de `urlsDansLeTexte.reduce(split/join)` : mesure, pas un échec', () => {
  // 212 ko : 1,6 s en r9 contre 17 ms en r8 ; borné en pratique par la limite de 100 ko du parseur (~0,3 s par ligne).
  it('8 000 URL distinctes (~100 ko) : < 2 s', () => {
    const q = Array.from({ length: 8000 }, (_, i) => `www.a${i}.io`).join(' ');
    const t0 = Date.now();
    lireContacts({ q });
    const ms = Date.now() - t0;
    // eslint-disable-next-line no-console
    console.log(`R9-5 100 ko: ${ms} ms`);
    expect(ms).toBeLessThan(2000);
  });
});

describe('R9-6 — (mineur) résidu du fuzz r8 : URL sans schéma dans une phrase, valeur avec espace', () => {
  // `www.lp.example/?phone=(813) 555-0142` : phrase (espace, pas de schéma) → l'URL retirée s'arrête à « (813) »,
  // le reste « 555-0142 » n'a plus que 7 chiffres. Le nettoyage retire le numéro, l'inscription ne le voit pas.
  it.each(['www.lp.example/?phone=(813) 555-0142', 'see www.x.com/?cb=(813) 555-0142 thanks'])('« %s »', (t) => {
    expect(redactPersonal(t)).not.toContain('555-0142');
    expect(contactsInAnything({ q5: t })).toContainEqual({ phone: '8135550142' });
  });
});
