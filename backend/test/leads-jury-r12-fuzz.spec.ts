import { lireContacts, withoutContact } from '../src/leads/lead-fields';

// JURÉ R12 — troisième fuzzer, indépendant des deux autres (fuzz-personne.gen.ts, leads-jury-r11-fuzz.spec.ts).
// Angle : les SÉPARATEURS et les CLÉS. Un numéro nord-américain écrit avec des séparateurs que produisent les
// claviers mobiles, les traitements de texte et le HTML (espace insécable, tiret demi-cadratin, trait d'union
// insécable, barre oblique…), rangé sous une clé que le lecteur DÉCLARE mais que le nettoyage ne connaît pas
// (`whatsapp`, `cell_phone`, `home_phone`…), sous une clé PII, ou dans un texte libre.
// Oracles :
//  O1 lu        — le numéro planté est dans lireContacts().tous ;
//  O2 déclaré   — sous une clé déclarante, il est dans .declares ;
//  O3 innocent  — aucun autre numéro que le planté n'est lu (le contexte ne porte que ZIP, heures, montants, années) ;
//  O4 effacé    — après withoutContact(…, 'erased'), aucune valeur ne contient encore ses dix chiffres ;
//  O5 cohérent  — tout numéro DÉCLARÉ (donc inscrit à la liste) est retiré par l'effacement.
// Borné : JURY12_N cas par famille (défaut 4000), graine JURY12_SEED.

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

const ASCII_SEP = [' ', '-', '.', ''];
const UNI_SEP = [' ', ' ', ' ', '–', '‑', '‐', '−', '‒', '/', ' - ', '_'];
const CLES_DECLARANTES_NON_PII = ['whatsapp', 'cell_phone', 'home_phone', 'mobile_number', 'contact_number', 'best_phone', 'cellPhone', 'phone2'];
const CLES_PII = ['phone', 'phone_number', 'mobile'];
const CLES_TEXTE = ['message', 'q4', 'summary', 'details_text'];

type Famille = 'ascii' | 'unicode';
type Cas = { payload: Record<string, unknown>; attendu: string; cle: string; genre: 'declarante' | 'pii' | 'texte'; txt: string };

function gen(r: () => number, famille: Famille): Cas {
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(r() * a.length)];
  const d = (n: number) => Array.from({ length: n }, () => Math.floor(r() * 10)).join('');
  const d29 = () => String(2 + Math.floor(r() * 8));
  const npa = d29() + d(2);
  const nxx = d29() + d(2);
  const sub = d(4);
  const attendu = npa + nxx + sub;
  const seps = famille === 'ascii' ? ASCII_SEP : UNI_SEP;
  // ASCII : seulement les formes réalistes (mêmes séparateurs, ou « 813 555-0142 » / « 813555-0142 »).
  const paire = famille === 'ascii' ? pick([[' ', ' '], ['-', '-'], ['.', '.'], ['', ''], [' ', '-']] as const) : null;
  const s1 = paire ? paire[0] : pick(seps);
  const s2 = paire ? paire[1] : r() < 0.5 ? s1 : pick([...seps, '-']);
  const forme = Math.floor(r() * 5);
  let num: string;
  if (forme === 0) num = `${npa}${s1}${nxx}${s2}${sub}`;
  else if (forme === 1) num = `(${npa})${famille === 'ascii' ? pick([' ', '']) : s1}${nxx}${s2}${sub}`;
  else if (forme === 2) num = `+1${famille === 'ascii' ? (s1 === '' ? '' : ' ') : s1}${npa}${s1}${nxx}${s2}${sub}`;
  else if (forme === 3) num = `1${s1}${npa}${s1}${nxx}${s2}${sub}`;
  else num = `${npa}${s1}${nxx}${s2}${sub}${pick([' ext. 12', ' x7', ''])}`;
  const genre = pick(['declarante', 'pii', 'texte'] as const);
  const cle = genre === 'declarante' ? pick(CLES_DECLARANTES_NON_PII) : genre === 'pii' ? pick(CLES_PII) : pick(CLES_TEXTE);
  const ctxAvant = pick(['', 'Call me at ', 'Best number: ', 'zip 33610, cell ', 'After 5pm ', '2 cars, 2019, ']);
  const ctxApres = pick(['', ' thanks', ' after 6:30pm', ' (evenings)', ', budget $120.50', ' — zip 90210']);
  const txt = genre === 'texte' ? `${ctxAvant}${num}${ctxApres}` : num;
  return { payload: { [cle]: txt, zip: '33610', vehicles: '2' }, attendu, cle, genre, txt };
}

function run(famille: Famille, n: number, seed: number) {
  const r = rng(seed);
  const fails: Record<string, { n: number; ex: string[] }> = {};
  const note = (o: string, c: Cas) => {
    fails[o] ??= { n: 0, ex: [] };
    fails[o].n += 1;
    if (fails[o].ex.length < 4) fails[o].ex.push(`${c.cle}=${JSON.stringify(c.txt)}`);
  };
  for (let i = 0; i < n; i += 1) {
    const c = gen(r, famille);
    const lu = lireContacts(c.payload);
    const tous = lu.tous.map((x) => x.phone).filter(Boolean);
    const decl = lu.declares.map((x) => x.phone).filter(Boolean);
    if (!tous.includes(c.attendu)) note('O1_lu', c);
    if (c.genre !== 'texte' && !decl.includes(c.attendu)) note('O2_declare', c);
    if (tous.some((p) => p !== c.attendu)) note('O3_innocent', c);
    const apres = withoutContact(c.payload, 'erased') ?? c.payload;
    const reste = Object.values(apres).some((v) => typeof v === 'string' && v.replace(/\D/g, '').includes(c.attendu));
    if (reste) note('O4_efface', c);
    if (decl.includes(c.attendu) && reste) note('O5_declare_mais_pas_efface', c);
  }
  return fails;
}

describe('JURÉ R12 — fuzzer séparateurs × clés (numéros US)', () => {
  const N = Number(process.env.JURY12_N ?? 4000);
  const SEED = Number(process.env.JURY12_SEED ?? 12);
  it.each(['ascii', 'unicode'] as const)('famille %s', (famille) => {
    const t0 = Date.now();
    const fails = run(famille, N, SEED);
    // eslint-disable-next-line no-console
    console.log(`[jury-r12-fuzz] ${famille} N=${N} seed=${SEED} ${Date.now() - t0}ms ${JSON.stringify(fails, null, 1)}`);
    expect(fails).toEqual({});
  });
});
