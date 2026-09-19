// JURY R10 — chaque test ÉCHOUE tant que le défaut est présent (attente = comportement promis par la doc §9 /
// par les deux propriétés du tour 28 : (a) ce que le nettoyage retire est inscrit ; (b) rien d'autre ne l'est).
import { LeadsService } from '../src/leads/leads.service';
import { contactFingerprints, contactsInAnything, withoutContact } from '../src/leads/lead-fields';

const CLE = 'cle-de-test-0123456789abcdef-0123456789';
const TEMOIN = contactFingerprints({ email: 'temoin@liste-de-suppression.invalid' }, CLE)[0].hash;
const cfg = { get: jest.fn().mockImplementation((k: string) => (k === 'ERASURE_HMAC_KEY' ? CLE : undefined)) };

function liste(lignes: { hash: string; kind: string; groupe?: string | null }[]) {
  return {
    findFirst: jest.fn().mockImplementation(({ where }: { where: { kind?: string | { in: string[] }; hash?: { in: string[] }; groupe?: string | null; NOT?: unknown } }) => {
      if (where?.kind === 'temoin') return Promise.resolve({ hash: TEMOIN });
      const sortes = typeof where.kind === 'object' ? where.kind.in : null;
      // La colonne `groupe` (tour 30) : `groupe: null` = ligne d'avant les groupes ; `NOT: { groupe: null }`.
      const bonGroupe = (g?: string | null) =>
        (!('groupe' in where) || (where.groupe === null ? !g : g === where.groupe)) && (!where.NOT || Boolean(g));
      const l = lignes.find(
        (x) => where.hash!.in.includes(x.hash) && (!sortes || sortes.includes(x.kind)) && bonGroupe(x.groupe),
      );
      return Promise.resolve(l ? { hash: l.hash, groupe: l.groupe ?? null } : null);
    }),
    // Tour 31 : la lecture groupée d'`isErasedPerson`, sur les mêmes lignes.
    findMany: jest.fn().mockImplementation(({ where }: { where: { hash: { in: string[] } } }) =>
      Promise.resolve(lignes.filter((x) => where.hash.in.includes(x.hash)).map((x) => ({ hash: x.hash, kind: x.kind, groupe: x.groupe ?? null }))),
    ),
    createMany: jest.fn(),
    updateMany: jest.fn(),
  };
}
function envoyer(lignes: { hash: string; kind: string; groupe?: string | null }[], corps: Record<string, unknown>) {
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
  const inscrits: { hash: string; kind: string; groupe?: string | null }[] = [];
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
    conversion: { findMany: jest.fn().mockResolvedValue(conversions), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
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

describe('R10-1 — (b) un INNOCENT refusé : `?sub2=ann+quotes@gmail.com` inscrit `quotes@gmail.com`, la boîte de quelqu’un d’autre', () => {
  // Paramètre ordinaire ⇒ « + » lu comme espace ⇒ « ann quotes@gmail.com » ⇒ `quotes@gmail.com` inscrit (trouvé).
  // Un lecteur humain lit ann+quotes@gmail.com ; `quotes@gmail.com` n'est écrit nulle part. Inscrit « trouvé »,
  // il fait refuser quiconque le DÉCLARE ensuite (déclaré ⇒ toute sorte suffit, leads.service.ts:435-438).
  const url = 'https://lp.example/quote?sub2=ann+quotes@gmail.com&zip=33601';

  it('fonction : la seule adresse inscrite doit être celle d’Ann (ann+quotes → ann@gmail.com), jamais quotes@gmail.com', () => {
    expect(contactsInAnything({ landingUrl: url }).map((c) => c.email)).not.toContain('quotes@gmail.com');
  });

  it('bout en bout : Ann effacée ; Quinn (quotes@gmail.com) envoie SON lead ⇒ doit être stocké', async () => {
    const { inscrits } = await effacer({ phone: '8135550142', email: null }, [], [{ clickId: 'c1', referrer: url }]);
    const out = await envoyer(inscrits, { firstName: 'Quinn', email: 'quotes@gmail.com' });
    expect(out).toMatchObject({ stored: true });
  });

  // Tour 30 (juré r11, second signal) : l'adresse n'est que TROUVÉE (dans l'URL), elle ne refuse plus seule un contact
  // déclaré — c'est ce qui laisse passer Bob, cité dans les notes d'Ann. Ann qui revient avec son adresse ET un autre
  // contact de ce même effacement reste refusée ; avec cette seule adresse, elle passe (docs §9, arbitrage écrit).
  it('bout en bout, l’autre sens : Ann revient avec ann+quotes@gmail.com et son numéro ⇒ refusée ; l’adresse trouvée seule ne suffit plus', async () => {
    const { inscrits } = await effacer({ phone: '8135550142', email: null }, [], [{ clickId: 'c1', referrer: `${url}&note=or+text+727-555-0199` }]);
    // L'adresse et un second numéro ne sont que TROUVÉS dans l'URL (même effacement) : ensemble ils refusent, par le
    // seul groupe ; l'adresse seule ne suffit plus (doc §9).
    expect(inscrits).toContainEqual(expect.objectContaining({ hash: contactFingerprints({ email: 'ann@gmail.com' }, CLE)[0].hash, kind: 'email_texte' }));
    const out = await envoyer(inscrits, { firstName: 'Ann', email: 'ann+quotes@gmail.com', answers: { note: '727-555-0199' } });
    expect(out).toMatchObject({ stored: false, reason: 'erased_person' });
    expect(await envoyer(inscrits, { firstName: 'Ann', email: 'ann+quotes@gmail.com' })).toMatchObject({ stored: true });
  });
});

describe('R10-2 — (a) un chiffre isolé collé au numéro : le nettoyage retire le numéro, la liste inscrit un AUTRE numéro', () => {
  // `suitesPersonnelles` prend « 813-555-0142 2 » (11 chiffres) comme UNE suite ; `normalizePhone` en fait
  // 81355501422. Le nettoyage efface bien le vrai numéro, mais ce qui est inscrit n'est pas lui.
  const textes = ['Ann Dupont 813-555-0142 2 vehicles', 'Best time after 5 813-555-0142', 'Unit 3 (813) 555-0142', '813 555 0142 1 driver'];
  it.each(textes)('« %s » : retiré par le nettoyage ⇒ 8135550142 doit être inscrit', (t) => {
    expect(JSON.stringify(withoutContact({ comments_free: t }, 'erased'))).not.toContain('0142');
    expect(contactsInAnything({ comments_free: t })).toContainEqual({ phone: '8135550142' });
  });

  // Tour 30 (juré r11, second signal) : le numéro n'est que dans le résumé (trouvé) ; il refuse Ann quand elle revient
  // avec lui ET son adresse (même effacement). Seul, il ne refuse plus (docs §9).
  // Tour 31 : réécrit pour exercer la logique de GROUPE elle-même. Le numéro et une seconde adresse d'Ann ne sont
  // que TROUVÉS dans son résumé (deux lignes `*_texte` du même effacement) ; son adresse déclarée n'est pas envoyée.
  it('bout en bout : numéro trouvé + seconde adresse trouvée, même effacement ⇒ refusée ; le numéro seul ⇒ stockée', async () => {
    const { inscrits } = await effacer({ phone: null, email: 'ann@example.com' }, [
      { eventType: 'lead', metadata: { email: 'ann@example.com', summary: `${textes[0]} — or ann.alt@example.org` } },
    ]);
    const empreinte = (c: { phone?: string; email?: string }) => contactFingerprints(c, CLE)[0].hash;
    const trouves = inscrits.filter((l) => l.kind.endsWith('_texte'));
    expect(trouves.map((l) => l.hash).sort()).toEqual([empreinte({ phone: '8135550142' }), empreinte({ email: 'ann.alt@example.org' })].sort());
    expect(new Set(trouves.map((l) => l.groupe)).size).toBe(1);
    // Le second signal peut être DÉCLARÉ ou TROUVÉ dans l'envoi : les deux refusent, par le seul groupe.
    expect(await envoyer(inscrits, { firstName: 'Ann', phone: '813-555-0142', email: 'ann.alt@example.org' })).toMatchObject({ stored: false });
    expect(await envoyer(inscrits, { firstName: 'Ann', phone: '813-555-0142', answers: { note: 'ann.alt@example.org' } })).toMatchObject({ stored: false });
    expect(await envoyer(inscrits, { firstName: 'Ann', phone: '813-555-0142' })).toMatchObject({ stored: true });
  });
});

describe('R10-3 — (a) `sansIdentifiants` avale ce qui suit un paramètre d’identifiant jusqu’au premier `&`', () => {
  // PAIRE = …=([^&\s#]*) : `utm_source=fb;phone=…` (séparateur `;`, que sanitizeUrlPii reconnaît lui-même) ou
  // `utm_content=spring|8135550142` est blanchi en entier. Le paramètre est ensuite relu sous le nom `utm_source`
  // ⇒ identifiant ⇒ aucun numéro lu. Le nettoyage, lui, retire le numéro.
  const textes = ['https://lp.example/?utm_source=fb;phone=8135550142', 'https://lp.example/?utm_content=spring|8135550142'];
  it.each(textes)('%s : retiré par le nettoyage ⇒ doit être inscrit', (t) => {
    expect(JSON.stringify(withoutContact({ landing: t }, 'erased'))).not.toContain('8135550142');
    expect(contactsInAnything({ landing: t })).toContainEqual({ phone: '8135550142' });
  });
});

describe('R10-4 — (a) une adresse dans le CHEMIN ou le fragment d’une URL n’est jamais lue', () => {
  // « addresses inside URLs are read only via params » : `/confirm/ann@gmail.com`, `#ann@gmail.com` ne sont ni des
  // paramètres ni du texte lu. Le nettoyage (withoutContact) les retire pourtant.
  const textes = ['https://lp.example/confirm/ann@gmail.com', 'https://lp.example/merci#ann@gmail.com', 'lp.example/u/ann@gmail.com then call'];
  it.each(textes)('%s : retirée par le nettoyage ⇒ doit être inscrite', (t) => {
    expect(JSON.stringify(withoutContact({ landing: t }, 'erased'))).not.toContain('ann@gmail.com');
    expect(contactsInAnything({ landing: t })).toContainEqual({ email: 'ann@gmail.com' });
  });
});

describe('R10-5 — coût quadratique : URL_DANS_TEXTE sur « a.a.a.… » / « a-a-a-… »', () => {
  // `\b[a-z][a-z0-9+.-]*:\/\/` repart de chaque frontière de mot et avale tout le reste avant d'échouer sur `://`.
  // Mesuré : 25 ko 0,2 s, 50 ko 0,8 s, 100 ko 3,1 s (×4 par ×2). Le banc r28 promet 100 ko hostiles < 2 s ; une
  // conversion (métadonnées libres, route publique, 100 ko par corps) en porte autant, relue à chaque effacement.
  it.each(['a.', 'a-'])('100 ko de « %s » répétés : lecture en moins de deux secondes', (motif) => {
    const hostile = motif.repeat(50000);
    const t = Date.now();
    contactsInAnything({ m: hostile });
    expect(Date.now() - t).toBeLessThan(2000);
  });
});
