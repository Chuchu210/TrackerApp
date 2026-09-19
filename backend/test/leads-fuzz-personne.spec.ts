// Tour 29 — CHANGEMENT DE MÉTHODE. Sept jurys (7 ; 7,5 ; 8 ; 7,5 ; 7,5 ; 8 ; 7,5) ont trouvé chacun de nouveaux
// exemples, parce que chaque tour corrigeait les exemples du précédent. Ce banc ne mesure plus le lecteur contre le
// nettoyage : il plante un contact CONNU dans des contextes réalistes (test/fuzz-personne.gen.ts) et le mesure contre
// LA PERSONNE.
//   P1 — la personne est inscrite, sous sa forme normalisée (déclarée quand elle est dans un champ déclaré) ;
//   P2 — RIEN d'autre n'est inscrit, sauf une seconde personne plantée exprès — et un tiers n'est jamais déclaré ;
//   P3 — le nettoyage d'effacement la retire de chaque endroit stocké (métadonnées, URL de postback).
// Là où P1 et P2 se contredisent sur une entrée réellement ambiguë, P2 gagne (ne jamais refuser un innocent) : ces
// cas sont écrits dans docs/lead-intake-api.md §9, et le générateur ne les produit pas.
import { LeadsService } from '../src/leads/leads.service';
import { contactFingerprints, contactsInAnything, lireContacts, porteesLues, sanitizeUrlPii, withoutContact } from '../src/leads/lead-fields';
import { casDe, type Cas, type Contact } from './fuzz-personne.gen';

const CLE = 'cle-de-fuzz-0123456789abcdef-0123456789';
const fp = (c: Contact) => contactFingerprints(c, CLE).map((m) => m.hash);

/** Graines et taille : `FUZZ_GRAINES=1-200 FUZZ_N=20000` pour un balayage long hors CI. */
function graines(): number[] {
  const brut = process.env.FUZZ_GRAINES;
  if (!brut) return [1, 29, 1010, 2026, 424242];
  const [a, b] = brut.split('-').map(Number);
  return Array.from({ length: (b ?? a) - a + 1 }, (_, i) => a + i);
}
const PAR_GRAINE = Number(process.env.FUZZ_N ?? 5000);

/** Ce qu'un lecteur de la base verrait : encodages d'URL retirés (jusqu'à trois couches). */
function decoder(s: string): string {
  let out = s;
  for (let i = 0; i < 3; i += 1) {
    out = out.replace(/(%[0-9a-f]{2})+/gi, (m) => {
      try {
        return decodeURIComponent(m);
      } catch {
        return m;
      }
    });
  }
  return out.toLowerCase();
}

type Violation = { propriete: string; lieu: string; detail: string };

/** La valeur au chemin `.a.b[2].c` que rend `porteesLues`, ou `undefined` si le nettoyage l'a retirée. */
function valeurA(racine: unknown, chemin: string): unknown {
  let cur: unknown = racine;
  for (const m of chemin.matchAll(/\.([^.[]*)|\[(\d+)\]/g)) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = m[2] !== undefined ? (cur as unknown[])[Number(m[2])] : (cur as Record<string, unknown>)[m[1]];
  }
  return cur;
}

function juger(cas: Cas): Violation[] {
  const out: Violation[] = [];
  const v = (propriete: string, detail: string) => out.push({ propriete, lieu: cas.lieu, detail });
  const lu = lireContacts(cas.valeur);
  const tous = new Set(lu.tous.flatMap(fp));
  const declares = new Set(lu.declares.flatMap(fp));
  const x = cas.personne;
  const deX = x ? fp(x.attendu) : [];
  const permis = new Set([...deX, ...cas.autres.flatMap((a) => fp(a.attendu))]);
  const montre = () => `${JSON.stringify(cas.valeur)}\n      tous=${JSON.stringify(lu.tous)} declares=${JSON.stringify(lu.declares)}`;

  if (x && !deX.every((h) => tous.has(h))) v('P1 inscrit', `${JSON.stringify(x.attendu)} manque — ${montre()}`);
  if (x && cas.declare && !deX.every((h) => declares.has(h))) v('P1 déclaré', `${JSON.stringify(x.attendu)} non déclaré — ${montre()}`);
  const intrus = lu.tous.filter((c) => fp(c).some((h) => !permis.has(h)));
  if (intrus.length) v('P2 rien d’autre', `${JSON.stringify(intrus)} — ${montre()}`);
  const tiersDeclares = lu.declares.filter((c) => fp(c).some((h) => !deX.includes(h)));
  if (tiersDeclares.length) v('P2 tiers déclaré', `${JSON.stringify(tiersDeclares)} — ${montre()}`);
  if (!lu.complet) v('lecture tronquée', montre());

  // P1 ⇔ P3 PAR CONSTRUCTION (tour 31) : chaque portée LUE — ce que la liste inscrit — a disparu, au même chemin, de la
  // valeur nettoyée ; et la relecture de la valeur nettoyée n'inscrit plus RIEN de ce qui avait été lu. Mesuré sur
  // chaque cas, personne plantée ou non.
  const efface = withoutContact(cas.valeur, 'erased') ?? cas.valeur;
  for (const p of porteesLues(cas.valeur)) {
    const avant = valeurA(cas.valeur, p.chemin);
    const apres = valeurA(efface, p.chemin);
    const morceau = String(avant).slice(p.debut, p.fin);
    if (apres !== undefined && String(apres).includes(morceau)) v('P1⇔P3 portée', `${p.chemin} « ${morceau} » lue et restée — ${montre()}`);
  }
  const relus = new Set(lireContacts(efface).tous.flatMap(fp));
  const restes = lu.tous.filter((c) => fp(c).some((h) => relus.has(h)));
  if (restes.length) v('P1⇔P3 relu', `${JSON.stringify(restes)} lus avant ET après l’effacement — ${montre()}`);

  if (x) {
    const nettoye = withoutContact(cas.valeur, 'erased') ?? cas.valeur;
    const reste = decoder(JSON.stringify(nettoye));
    if (x.trace.test(reste)) v('P3 nettoyage', `${x.ecrit} survit — ${reste}`);
    for (const url of cas.urls) {
      const propre = decoder(sanitizeUrlPii(url, 'erased'));
      if (x.trace.test(propre)) v('P3 sanitizeUrlPii', `${x.ecrit} survit — ${url} → ${propre}`);
    }
  }
  return out;
}

describe('tour 29 — banc « contact planté » : P1, P2, P3 mesurées contre la personne', () => {
  it(`${graines().length} graines × ${PAR_GRAINE} cas : zéro violation`, () => {
    const violations: Violation[] = [];
    let n = 0;
    const debut = Date.now();
    for (const graine of graines()) {
      for (const cas of casDe(graine, PAR_GRAINE)) {
        n += 1;
        for (const viol of juger(cas)) violations.push({ ...viol, detail: `[graine ${graine}] ${viol.detail}` });
      }
    }
    const parSorte = new Map<string, Violation[]>();
    for (const viol of violations) {
      const k = `${viol.propriete} · ${viol.lieu}`;
      parSorte.set(k, [...(parSorte.get(k) ?? []), viol]);
    }
    const rapport = [...parSorte]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([k, vs]) => `${k} : ${vs.length}\n${vs.slice(0, 4).map((x) => `    ${x.detail}`).join('\n')}`)
      .join('\n');
    if (violations.length || process.env.FUZZ_RAPPORT) {
      process.stderr.write(`\nFUZZ ${n} cas, ${violations.length} violation(s), ${Date.now() - debut} ms\n${rapport}\n`);
    }
    expect(n).toBeGreaterThanOrEqual(20000);
    expect(violations.length).toBe(0);
  }, 120000);
});

// ——— De bout en bout : la même promesse à travers l'effacement et l'intake réels (services, liste simulée) ————

const TEMOIN = contactFingerprints({ email: 'temoin@liste-de-suppression.invalid' }, CLE)[0].hash;
const cfg = { get: jest.fn().mockImplementation((k: string) => (k === 'ERASURE_HMAC_KEY' ? CLE : undefined)) };

function envoyer(lignes: { hash: string; kind: string; groupe?: string | null }[], corps: Record<string, unknown>) {
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
    },
  };
  return new LeadsService(cfg as never, prisma as never, { create: jest.fn().mockResolvedValue({ id: 'c' }) } as never).intake({
    source: 'monsite.com',
    ...corps,
  } as never);
}

async function effacer(metadata: Record<string, unknown>, referrer: string | null) {
  const inscrits: { hash: string; kind: string; groupe?: string | null }[] = [];
  const ligne = { phone: null, email: null };
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
      findMany: jest.fn().mockResolvedValue(referrer ? [{ clickId: 'c1', referrer }] : []),
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

describe('tour 29/30 — de bout en bout : la personne effacée est refusée, ses formes devinées et les tiers ne le sont pas', () => {
  it('200 cas plantés : X déclaré revient ⇒ refusé ; X trouvé revient avec un 2ᵉ contact du même effacement ⇒ refusé, seul ⇒ stocké ; formes devinées et tiers ⇒ stockés', async () => {
    const echecs: string[] = [];
    let vus = 0;
    for (const cas of casDe(290, 400)) {
      const x = cas.personne;
      if (!x || vus >= 200) continue;
      vus += 1;
      // Un second contact de la même personne, trouvé seulement dans un texte : le « second signal » (juré r11).
      const seconde = `seconde${vus}@exemple-second.org`;
      const inscrits = await effacer({ ...cas.valeur, note_seconde: `or write to ${seconde}` }, cas.urls[0] ?? null);
      const sorte = x.attendu.email ? 'email' : 'phone';
      const seul = await envoyer(inscrits, { firstName: 'Ann', [sorte]: x.ecrit });
      // Déclarée à l'effacement, elle refuse seule ; trouvée seulement, elle ne refuse plus seule (docs §9).
      if (seul.stored !== !cas.declare) echecs.push(`X seul (déclaré=${cas.declare}) : stored=${seul.stored} — ${x.ecrit} dans ${JSON.stringify(cas.valeur)}`);
      const retour = await envoyer(inscrits, { firstName: 'Ann', [sorte]: x.ecrit, answers: { contact_email: seconde } });
      if (retour.stored !== false) echecs.push(`X revient avec un second signal et passe : ${x.ecrit} dans ${JSON.stringify(cas.valeur)}`);
      // Un tiers planté (numéro de suivi, acheteur, conjoint cité dans les notes) qui envoie SON lead : jamais refusé.
      for (const tiers of cas.autres) {
        const r = await envoyer(inscrits, { firstName: 'Bob', ...tiers.attendu });
        if (r.stored !== true) echecs.push(`tiers refusé : ${JSON.stringify(tiers.attendu)} (X = ${x.ecrit}) dans ${JSON.stringify(cas.valeur)}`);
      }
      // Les formes devinées sont d'AUTRES personnes par construction (le générateur le garantit) : on ne les filtre
      // pas avec l'empreinte du code testé — une empreinte faussée se serait cachée elle-même (banc de mutation).
      const autres = new Set(cas.autres.map((a) => JSON.stringify(a.attendu)));
      const innocents = x.devinees.filter((d) => !autres.has(JSON.stringify(d)));
      for (const innocent of innocents.slice(0, 4)) {
        const r = await envoyer(inscrits, { firstName: 'Quinn', ...innocent });
        if (r.stored !== true) echecs.push(`innocent refusé : ${JSON.stringify(innocent)} (X = ${x.ecrit}) dans ${JSON.stringify(cas.valeur)}`);
      }
    }
    expect(vus).toBe(200);
    expect(echecs).toEqual([]);
  }, 60000);
});

describe('tour 29 — coût borné : 100 ko hostiles, lecture ET nettoyage', () => {
  // R10-5 : `\b[a-z][a-z0-9+.-]*:\/\/` repartait de chaque frontière de mot sur « a.a.a.… » (100 ko : 3,5 s).
  const HOSTILES: [string, string][] = [
    ['a.', 'a.'.repeat(50000)],
    ['a-', 'a-'.repeat(50000)],
    ['a.a-', 'a.a-'.repeat(25000)],
    ['a+', 'a+'.repeat(50000)],
    ['x.y/', 'x.y/'.repeat(25000)],
    ['1 ', '1 '.repeat(50000)],
    ['1-1 ', '1-1 '.repeat(25000)],
    ['(1', '(1'.repeat(50000)],
    ['+1 ', '+1 '.repeat(33000)],
    ['a@', 'a.'.repeat(50000) + '@'],
    ['@a.', 'x@' + 'a.'.repeat(50000)],
    ['#a@', '#a'.repeat(50000) + '@x.com'],
    ['|a', '|a'.repeat(50000) + '@x.com'],
    ['utm=', 'utm_source=a;'.repeat(8000)],
    ['/a@', 'https://x.io/' + 'a@b/'.repeat(25000)],
  ];
  it.each(HOSTILES)('%s × 100 ko : moins de deux secondes chacun', (_nom, hostile) => {
    let t = Date.now();
    contactsInAnything({ m: hostile });
    expect(Date.now() - t).toBeLessThan(2000);
    t = Date.now();
    withoutContact({ m: hostile }, 'erased');
    expect(Date.now() - t).toBeLessThan(2000);
  });
});
