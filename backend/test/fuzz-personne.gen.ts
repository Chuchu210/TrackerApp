/**
 * Générateur du banc « contact planté » (tour 29).
 *
 * Sept tours ont corrigé des EXEMPLES : chaque juré en trouvait d'autres. Ce générateur mesure la promesse contre la
 * PERSONNE, pas contre le nettoyage : on plante un contact connu X dans un contexte réaliste (texte libre avec des
 * chiffres voisins, enveloppes, séparateurs, URL, charges de partenaires, leurres d'identifiants) et on sait donc,
 * pour chaque cas, ce qui DOIT être inscrit (X, sous sa forme normalisée) et ce qui ne doit PAS l'être (tout le reste,
 * sauf une seconde personne plantée exprès). Déterministe : une graine donne toujours les mêmes cas.
 *
 * Pas un `*.spec.ts` : partagé par le banc de fonctions et par le banc Postgres (référent).
 */
export type Rng = () => number;

/** mulberry32 : court, rapide, et assez bien réparti pour qu'une graine ne ressemble pas à la suivante. */
export function mulberry32(graine: number): Rng {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Contact {
  phone?: string;
  email?: string;
}

/** Un contact planté : tel qu'écrit, tel qu'il doit être inscrit, et la trace qui ne doit pas survivre au nettoyage. */
export interface Plante {
  ecrit: string;
  attendu: Contact;
  trace: RegExp;
  /** Les formes qu'un lecteur maladroit inscrirait à sa place : chacune est la boîte ou la ligne de quelqu'un d'autre. */
  devinees: Contact[];
}

export interface Cas {
  lieu: string;
  valeur: Record<string, unknown>;
  personne: Plante | null;
  /** La personne est dans un champ DÉCLARÉ (liste blanche, `tel:`, paramètre nommé, `field_data`). */
  declare: boolean;
  /** Contacts plantés exprès (seconde personne, numéro de suivi, acheteur) : inscrits « trouvés », jamais déclarés. */
  autres: Plante[];
  /** Les URL qui portent la personne : elles passent aussi par `sanitizeUrlPii` et par le référent SQL. */
  urls: string[];
}

class G {
  constructor(private readonly r: Rng) {}
  f(): number {
    return this.r();
  }
  int(a: number, b: number): number {
    return a + Math.floor(this.r() * (b - a + 1));
  }
  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.r() * xs.length)];
  }
  chance(p: number): boolean {
    return this.r() < p;
  }
  chiffres(n: number): string {
    let s = '';
    for (let i = 0; i < n; i += 1) s += String(this.int(0, 9));
    return s;
  }
  de(n: number, alphabet: string): string {
    let s = '';
    for (let i = 0; i < n; i += 1) s += alphabet[this.int(0, alphabet.length - 1)];
    return s;
  }
  lettres(n: number): string {
    return this.de(n, 'abcdefghijklmnopqrstuvwxyz');
  }
  alnum(n: number): string {
    return this.de(n, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-');
  }
  hex(n: number): string {
    return this.de(n, '0123456789abcdef');
  }
  uuid(): string {
    return `${this.hex(8)}-${this.hex(4)}-4${this.hex(3)}-a${this.hex(3)}-${this.hex(12)}`;
  }
}

// ——— La personne ———————————————————————————————————————————————————————————————————————————————————————————

type Format = (a: string, e: string, l: string) => string;
const FORMES_TEL: Format[] = [
  (a, e, l) => `${a}-${e}-${l}`,
  (a, e, l) => `(${a}) ${e}-${l}`,
  (a, e, l) => `(${a})${e}-${l}`,
  (a, e, l) => `${a}${e}${l}`,
  (a, e, l) => `${a}.${e}.${l}`,
  (a, e, l) => `${a} ${e} ${l}`,
  (a, e, l) => `${a} ${e}-${l}`,
  (a, e, l) => `+1 ${a} ${e} ${l}`,
  (a, e, l) => `+1-${a}-${e}-${l}`,
  (a, e, l) => `+1 (${a}) ${e}-${l}`,
  (a, e, l) => `+1${a}${e}${l}`,
  (a, e, l) => `+1.${a}.${e}.${l}`,
  (a, e, l) => `1-${a}-${e}-${l}`,
  (a, e, l) => `1 (${a}) ${e}-${l}`,
  (a, e, l) => `1${a}${e}${l}`,
  (a, e, l) => `001 ${a} ${e} ${l}`,
  (a, e, l) => `001${a}${e}${l}`,
];
// Tour 30 (juré r11) : « Ext: 12 », « extn 12 », « x.12 » et la forme RFC 3966 « ;ext=12 ».
const POSTES = [' x12', ' ext. 4', ' ext 305', ' extension 1234', ' x 7', ' ext.21', ' Ext: 12', ' extn 12', ' x.12', ';ext=12'];

function telephone(g: G, sansEspace = false): Plante {
  // Un indicatif et un central NANP : jamais 0 ni 1 en tête (un numéro réel, pas un horodatage).
  const a = `${g.int(2, 9)}${g.int(0, 8)}${g.int(0, 9)}`;
  const e = `${g.int(2, 9)}${g.chiffres(2)}`;
  const l = g.chiffres(4);
  const formes = sansEspace ? FORMES_TEL.filter((f) => !/\s/.test(f('2', '3', '4'))) : FORMES_TEL;
  const poste = !sansEspace && g.chance(0.12) ? g.pick(POSTES) : '';
  const national = `${a}${e}${l}`;
  const sept = `${e}${l}`.split('').join('[^0-9]{0,3}');
  // Les formes collées qu'un lecteur maladroit inscrit : un chiffre voisin devant ou derrière (juré r10 : « 813-555-0142
  // 2 vehicles » inscrivait 81355501422).
  const devinees: Contact[] = [];
  // Pas « 1 » devant : `1` + dix chiffres est l'indicatif, donc le MÊME numéro.
  for (let d = 0; d <= 9; d += 1) {
    if (d !== 1) devinees.push({ phone: `${d}${national}` });
    devinees.push({ phone: `${national}${d}` });
  }
  return { ecrit: g.pick(formes)(a, e, l) + poste, attendu: { phone: national }, trace: new RegExp(sept), devinees };
}

/**
 * Un numéro ÉTRANGER (juré r11) : Royaume-Uni avec ou sans « (0) » ou « 0044 », France, Allemagne, Mexique (avec
 * l'ancien « 1 » des mobiles), Inde, Philippines. Attendu : indicatif + numéro national, SANS le préfixe « (0) » —
 * c'est la même personne sous ses deux écritures.
 */
function etranger(g: G): Plante {
  const n = (k: number) => `${g.int(1, 9)}${g.chiffres(k - 1)}`;
  const formes: (() => [string, string])[] = [
    () => { const m = n(3), s = g.chiffres(6); return [`+44 7${m} ${s}`, `447${m}${s}`]; },
    () => { const m = n(3), s = g.chiffres(6); return [`+44 (0)7${m} ${s}`, `447${m}${s}`]; },
    () => { const m = n(3), s = g.chiffres(6); return [`0044 7${m} ${s}`, `447${m}${s}`]; },
    () => { const x = g.chiffres(8); return [`+33 6 ${x.slice(0, 2)} ${x.slice(2, 4)} ${x.slice(4, 6)} ${x.slice(6)}`, `336${x}`]; },
    () => { const x = g.chiffres(8); return [`+33 (0)6 ${x.slice(0, 2)} ${x.slice(2, 4)} ${x.slice(4, 6)} ${x.slice(6)}`, `336${x}`]; },
    () => { const x = n(7); return [`+49 30 ${x}`, `4930${x}`]; },
    () => { const x = n(7); return [`+49 (0)30 ${x}`, `4930${x}`]; },
    () => { const x = g.chiffres(8); return [`+52 55 ${x.slice(0, 4)} ${x.slice(4)}`, `5255${x}`]; },
    () => { const x = g.chiffres(8); return [`+52 1 55 ${x.slice(0, 4)} ${x.slice(4)}`, `52155${x}`]; },
    () => { const a = g.chiffres(4), b = g.chiffres(5); return [`+91 9${a} ${b}`, `919${a}${b}`]; },
    () => { const a = g.chiffres(3), b = g.chiffres(4); return [`+63 917 ${a} ${b}`, `63917${a}${b}`]; },
  ];
  const [ecrit, tout] = g.pick(formes)();
  const sept = tout.slice(-7).split('').join('[^0-9]{0,3}');
  const devinees: Contact[] = [];
  for (let d = 0; d <= 9; d += 1) devinees.push({ phone: `${tout}${d}` });
  return { ecrit, attendu: { phone: tout }, trace: new RegExp(sept), devinees };
}

const PRENOMS = ['ann', 'bob', 'zoe', 'li', 'mo', 'kat', 'raj', 'eva', 'ian', 'sam'];
const DOMAINES = [
  'gmail.com', 'yahoo.com', 'outlook.com', 'corp.example', 'example.co.uk', 'exämple.de', 'xn--exmple-cua.de',
  'mail.example.org', 'münchen.de', 'icloud.com',
];
const ETIQUETTES = ['quotes', 'promo', 'ins', 'x1', 'auto'];

function adresse(g: G, sansDebutLegal = false): Plante {
  const unique = g.lettres(6); // la trace : ne doit survivre à aucun nettoyage
  const prenom = g.pick(PRENOMS);
  const domaine = g.pick(DOMAINES);
  const variantes: (() => { local: string; devinees: string[] })[] = [
    () => ({ local: `${prenom}${unique}`, devinees: [] }),
    () => ({ local: `${prenom}.${unique}`, devinees: [] }),
    () => {
      const tag = g.pick(ETIQUETTES);
      // L'étiquette lue comme une adresse : la boîte de quelqu'un d'autre (juré r10 : `sub2=ann+quotes@…`).
      return { local: `${prenom}${unique}+${tag}`, devinees: [`${tag}@${domaine}`] };
    },
    () => ({ local: `${prenom[0].toUpperCase()}${prenom.slice(1)}.${unique[0].toUpperCase()}${unique.slice(1)}`, devinees: [] }),
    () => ({ local: `${prenom}é${unique}`, devinees: [`${unique}@${domaine}`] }),
    () => ({ local: `zoë.${unique}`, devinees: [`${unique}@${domaine}`] }),
    () => ({ local: `o'${unique}`, devinees: [`${unique}@${domaine}`] }),
    () => ({ local: `${prenom}_${unique}`, devinees: [] }),
  ];
  const legales: (() => { local: string; devinees: string[] })[] = ['_', '~', "'"].map((c) => () => ({
    // Légaux en tête d'une partie locale : `_ann@…` et `ann@…` sont deux boîtes (juré r7).
    local: `${c}${prenom}${unique}`,
    devinees: [`${prenom}${unique}@${domaine}`],
  }));
  const choix = sansDebutLegal || g.chance(0.8) ? g.pick(variantes)() : g.pick(legales)();
  const ecrit = `${choix.local}@${domaine}`;
  const devinees: Contact[] = [...choix.devinees, `${ecrit}.thanks`].map((email) => ({ email: email.toLowerCase() }));
  return { ecrit, attendu: { email: ecrit.toLowerCase() }, trace: new RegExp(unique), devinees };
}

function contact(g: G): Plante {
  const t = g.f();
  return t < 0.5 ? telephone(g) : t < 0.6 ? etranger(g) : adresse(g);
}

// ——— Les leurres : rien de tout cela n'est une personne ————————————————————————————————————————————————————————

function leurre(g: G): string {
  const annee = g.int(2015, 2026);
  const choix: (() => string)[] = [
    () => `gad_campaignid=2${g.chiffres(10)}`,
    () => `gad_source=1`,
    () => `utm_campaign=${g.chiffres(9)}`,
    () => `utm_id=${g.chiffres(10)}`,
    () => `utm_content=spring|sale`,
    () => `gclid=Cj0KCQjw${g.alnum(40)}`,
    () => `fbclid=IwAR${g.alnum(44)}`,
    () => `ORD-${annee}-${g.chiffres(7)}`,
    () => `order #A${g.chiffres(6)}`,
    () => `INV-${g.chiffres(6)}`,
    () => g.uuid(),
    () => g.uuid().toUpperCase(),
    () => String(g.int(1_600_000_000, 1_900_000_000)), // horodatage Unix
    () => `${g.int(1_600_000_000, 1_900_000_000)}${g.chiffres(3)}`, // en millisecondes
    () => `${g.int(1, 223)}.${g.int(0, 255)}.${g.int(0, 255)}.${g.int(1, 254)}`,
    () => `$${g.int(1, 9)},${g.chiffres(3)}.${g.chiffres(2)}`,
    () => `$${g.int(20, 999)}`,
    () => `${g.int(20, 9999)}.${g.chiffres(2)}`,
    () => `${g.int(10000, 99999)}`,
    () => `${g.int(10000, 99999)}-${g.chiffres(4)}`,
    () => `${String(g.int(1, 12)).padStart(2, '0')}/${String(g.int(1, 28)).padStart(2, '0')}/${annee}`,
    () => `${annee}-${String(g.int(1, 12)).padStart(2, '0')}-${String(g.int(1, 28)).padStart(2, '0')}`,
    () => `${annee}-09-17T${String(g.int(0, 23)).padStart(2, '0')}:${g.int(10, 59)}:00Z`,
    () => `${g.int(1, 12)}:${g.int(10, 59)}${g.pick(['am', 'pm', ''])}`,
    () => `${annee} Honda Civic`,
    () => `VIN 1HGCM8${g.chiffres(4)}A${g.chiffres(6)}`,
  ];
  return g.pick(choix)();
}

/** Des chiffres qui VOISINENT le contact dans une phrase : ils ne lui appartiennent pas (juré r10). */
const VOISINS_AVANT = [
  '2 vehicles,', 'Unit 3', 'after 5', 'Apt 12', 'ZIP 33610', 'quote $1,249.99', 'on 09/17/2026', 'at 10:30am',
  'Sept 17 at 3', 'from 9 to 5,', 'age 34', '2015 Honda Civic', 'Q2:', 'id 7', '2x', 'Suite 200', '1 driver',
  'since 2019', 'PO Box 1234', 'Ann Dupont', 'call me', 'Best time after 5', 'Unit 1204', 'lot 9', 'Question 3',
  '33610-1234', '192.168.1.25', '1726574400', '1726574400123',
];
const VOISINS_APRES = [
  '2 vehicles', '1 driver', 'after 5', 'thanks', '33610', 'or later', '2 times', '12 months', '9am', 'x2 cars',
  'Unit 3', 'zip 33610-1234', 'at 5', '3 kids', '2024', 'ok?', '!', '.', '', '4 ever',
];
const SEPARATEURS = ['', '', '', '?', '=', '&', '#', ';', '|', ',', ': ', 'tel ', 'call ', 'phone: ', 'email: '];
/** Enveloppes ÉQUILIBRÉES : une enveloppe à moitié ouverte est indiscernable d'un caractère légal de la partie locale. */
const ENVELOPPES: [string, string][] = [
  ['', ''], ['', ''], ['', ''], ['**', '**'], ['“', '”'], ['«', '»'], ['« ', ' »'], ['(', ')'], ['[', ']'],
  ['{', '}'], ['• ', ''], ['​', ''], ['', '​'], ['"', '"'], ["'", "'"], ['<', '>'], ['*', '*'],
  [' ', ' '],
];

function envelopper(g: G, x: string): string {
  for (;;) {
    const [o, f] = g.pick(ENVELOPPES);
    // Une enveloppe du même caractère que le début légal de l'adresse (`''ann@…'`) est ambiguë par construction.
    if (o && o.trim() && x.startsWith(o.trim()[o.trim().length - 1])) continue;
    return `${o}${x}${f}`;
  }
}

function phraseDeLeurres(g: G, n: number): string {
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) out.push(leurre(g));
  return out.join(g.pick([' ', ', ', ' | ', '\n', '; ']));
}

function texteAvec(g: G, x: string): string {
  const avant = g.chance(0.7) ? g.pick(VOISINS_AVANT) : '';
  const apres = g.chance(0.7) ? g.pick(VOISINS_APRES) : '';
  let sep = g.pick(SEPARATEURS);
  // Un `&` collé à un MOT devant une adresse (« me&ann@… ») est une adresse légale (`ann&co@…`, juré r5) :
  // ambigu par construction, tranché pour P2 (docs §9). Le générateur ne colle `&` qu'après des chiffres.
  if (sep === '&' && avant && !/\d$/.test(avant)) sep = ' & ';
  // Une phrase qui reprend SANS espace après le contact : « ann@gmail.com.Thanks » (juré r10).
  const colle = g.chance(0.1) ? g.pick(['.Thanks', '.Please call', ',', ';', '!', '?', '...', '.']) : '';
  const coeur = `${avant}${avant && !sep.trim() ? ' ' : avant ? g.pick(['', ' ']) : ''}${sep}${envelopper(g, x)}${colle}${apres ? g.pick([' ', ', ', ' - ']) + apres : ''}`;
  const tete = g.chance(0.4) ? phraseDeLeurres(g, g.int(1, 3)) + g.pick(['. ', ' ', '\n']) : '';
  const queue = g.chance(0.4) ? g.pick(['. ', ' ', '\n']) + phraseDeLeurres(g, g.int(1, 3)) : '';
  return `${tete}${coeur}${queue}`;
}

// ——— Les URL ——————————————————————————————————————————————————————————————————————————————————————————————

const PARAMS_LEURRES = (g: G): string[] => [
  'gad_source=1',
  `gad_campaignid=2${g.chiffres(10)}`,
  'utm_source=fb',
  'utm_medium=cpc',
  `utm_campaign=${g.chiffres(9)}`,
  'utm_content=spring|sale',
  'utm_term=car+insurance',
  `gclid=Cj0KCQjw${g.alnum(30)}`,
  `fbclid=IwAR${g.alnum(40)}`,
  'zip=33610',
  `click_id=${g.uuid()}`,
  `t=${g.int(1_600_000_000, 1_900_000_000)}${g.chiffres(3)}`,
  `ts=${g.int(1_600_000_000, 1_900_000_000)}`,
  'sub5=fb',
  `ref=ORD-2026-${g.chiffres(7)}`,
  'lang=en-US',
  'v=2',
  `price=${g.int(20, 999)}.${g.chiffres(2)}`,
];
const PARAM_DECLARE_TEL = ['phone', 'tel', 'phone_number', 'mobile', 'contact_phone', 'Phone', 'cell'];
const PARAM_DECLARE_MAIL = ['email', 'email_address', 'mail', 'customer_email', 'Email'];
const PARAM_LIBRE = ['sub1', 'sub2', 'sub3', 's2', 'aff_sub', 'subid', 'u1', 'c1', 'x', 'p', 'data'];

/** Une valeur de paramètre telle qu'une page l'écrit : brute (`+` pour l'espace), encodée, ou encodée deux fois. */
function enParametre(g: G, x: string): string {
  // Un « + » d'indicatif ÉTRANGER non encodé dans une query string est une espace (règles URL, docs §9) : la page
  // l'encode (%2B). Pour +1, les deux lectures donnent le même numéro.
  const mode = /^\+(?!1)/.test(x.trim()) ? g.int(2, 3) : g.int(0, 3);
  if (mode === 0) return x.replace(/ /g, '+');
  if (mode === 1) return x.replace(/ /g, '%20');
  if (mode === 2) return encodeURIComponent(x);
  return encodeURIComponent(encodeURIComponent(x));
}

interface UrlPlantee {
  url: string;
  declare: boolean;
}

function urlAvec(g: G, x: Plante | null): UrlPlantee {
  const schema = g.pick(['https://', 'http://', '', 'www.']);
  const hote = schema === 'www.' ? g.pick(['lp.example', 'quotes.insure-now.com']) : g.pick(['lp.example', 'www.lp.example', 'quotes.insure-now.com', 'partner.example']);
  let chemin = g.pick(['/', '/quote', '/lp/v2/auto', '/thank-you', '/2026/09/17/merci', '/a/b-3', '']);
  if (!chemin && (schema === '' || schema === 'www.')) chemin = '/';
  const params = [...PARAMS_LEURRES(g)].filter(() => g.chance(0.3));
  let fragment = g.chance(0.15) ? g.pick(['#top', '#/step/2', '#section-3']) : '';
  let declare = false;
  if (x) {
    const email = Boolean(x.attendu.email);
    const brut = x.ecrit;
    const place = g.int(0, 8);
    if (place <= 1) {
      params.splice(g.int(0, params.length), 0, `${g.pick(email ? PARAM_DECLARE_MAIL : PARAM_DECLARE_TEL)}=${enParametre(g, brut)}`);
      declare = true;
    } else if (place <= 3) {
      params.splice(g.int(0, params.length), 0, `${g.pick(PARAM_LIBRE)}=${enParametre(g, brut)}`);
    } else if (place === 4) {
      chemin = `${g.pick(['/confirm/', '/u/', '/merci/', '/lead/'])}${brut.replace(/ /g, '%20')}`;
    } else if (place === 5) {
      fragment = `#${brut.replace(/ /g, '%20')}`;
    } else if (place === 6) {
      fragment = `#/merci/${brut.replace(/ /g, '%20')}`;
    } else if (place === 7) {
      fragment = `#/quote?${g.pick(email ? PARAM_DECLARE_MAIL : PARAM_DECLARE_TEL)}=${enParametre(g, brut)}`;
      declare = true;
    } else {
      fragment = `#${g.pick(email ? PARAM_DECLARE_MAIL : PARAM_DECLARE_TEL)}=${enParametre(g, brut)}`;
      declare = true;
    }
  }
  const requete = params.length ? `?${params.join('&')}` : '';
  return { url: `${schema}${hote}${chemin}${requete}${fragment}`, declare };
}

// ——— Les contextes ————————————————————————————————————————————————————————————————————————————————————————

const CLES_TEXTE = [
  'notes', 'comments_free', 'summary', 'message', 'q7', 'details', 'sub1', 'u1', 'custom_text', 'description',
  'additional_info', 'best_time', 'postback_param_1',
];
const CLES_TEL = [
  'phone', 'phoneNumber', 'phone_number', 'mobile', 'cell', 'tel', 'telephone', 'callerId', 'customer_phone',
  'contact_phone', 'day_phone', 'phone_home', 'cell_phone_number', 'best_phone', 'callback_phone', 'Phone_1',
  'contact_number', 'telefono', 'celular', 'whatsapp', 'phone_no',
];
const CLES_MAIL = ['email', 'emailAddress', 'email_address', 'mail', 'customer_email', 'contactEmail', 'courriel', 'correo', 'user_email'];
const CONTENEURS = ['answers', 'metadata', 'lead', 'contact', 'fields', 'form_data', 'payload', 'data'];

type Fabrique = (g: G, x: Plante | null) => Omit<Cas, 'personne'>;

const autresDe = (...xs: (Plante | null)[]) => xs.filter((x): x is Plante => x !== null);

const FABRIQUES: [string, number, Fabrique][] = [
  [
    'texte libre',
    6,
    (g, x) => {
      const seconde = g.chance(0.15) ? contact(g) : null;
      let t = x ? texteAvec(g, x.ecrit) : phraseDeLeurres(g, g.int(1, 4));
      if (seconde) t += `${g.pick(['. Or my husband at ', ' — alt: ', ' / wife '])}${seconde.ecrit}${g.pick(['', '.', ' thanks'])}`;
      return { lieu: 'texte libre', valeur: { [g.pick(CLES_TEXTE)]: t }, declare: false, autres: autresDe(seconde), urls: [] };
    },
  ],
  [
    'champ déclaré',
    3,
    (g, x) => {
      if (!x) return { lieu: 'champ déclaré', valeur: { zip: '33610', q1: leurre(g) }, declare: false, autres: [], urls: [] };
      const cle = g.pick(x.attendu.email ? CLES_MAIL : CLES_TEL);
      const n = x.attendu.phone ?? '';
      // RFC 3966 (juré r11) : « tel:+1-813-555-0142;ext=12 », « tel:8135550142;phone-context=+1 ».
      const rfc3966 = n.length === 10 && g.chance(0.3)
        ? g.pick([`tel:+1-${n.slice(0, 3)}-${n.slice(3, 6)}-${n.slice(6)};ext=${g.chiffres(2)}`, `tel:+1${n};ext=${g.chiffres(3)}`, `tel:${n};phone-context=+1`])
        : null;
      const brut = rfc3966 ?? (g.chance(0.15) ? (x.attendu.email ? `mailto:${x.ecrit}` : `tel:${x.ecrit.replace(/ /g, '')}`) : g.chance(0.2) ? envelopper(g, x.ecrit) : x.ecrit);
      const champ: Record<string, unknown> = { [cle]: brut, zip: '33610', q1: g.pick(['Yes', '2 vehicles', 'after 5']) };
      const valeur: Record<string, unknown> = g.chance(0.5) ? champ : { [g.pick(CONTENEURS)]: g.chance(0.3) ? { contact: champ } : champ };
      return { lieu: 'champ déclaré', valeur, declare: true, autres: [], urls: [] };
    },
  ],
  [
    'url',
    5,
    (g, x) => {
      const { url, declare } = urlAvec(g, x);
      const forme = g.int(0, 3);
      if (forme === 0) return { lieu: 'url (valeur entière)', valeur: { [g.pick(['pageUrl', 'landing_page', 'referrer', 'url', 'source_url'])]: url }, declare, autres: [], urls: x ? [url] : [] };
      if (forme === 1) {
        const t = `${g.pick(['see', 'Came from', 'Q:', 'lp'])} ${url} ${g.pick(['thanks', 'is my page', '2 vehicles', leurre(g)])}`;
        return { lieu: 'url (dans un texte)', valeur: { [g.pick(CLES_TEXTE)]: t }, declare, autres: [], urls: x ? [url] : [] };
      }
      if (forme === 2) {
        // Une redirection : l'URL de la page dans un paramètre d'une autre (deux niveaux, lus tous les deux).
        const trk = `https://trk.example/r?cid=${g.uuid()}&url=${encodeURIComponent(url)}`;
        return { lieu: 'url (redirection)', valeur: { landing_page: trk }, declare, autres: [], urls: x ? [trk] : [] };
      }
      return { lieu: 'url (champs de visite)', valeur: { referrer: url, rawParams: { utm_source: 'fb' }, userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/126.0.6478.127' }, declare, autres: [], urls: x ? [url] : [] };
    },
  ],
  [
    'facebook lead ads',
    2,
    (g, x) => {
      const champs: { name: string; values: string[] }[] = [
        { name: 'full_name', values: ['Ann Dupont'] },
        { name: 'zip_code', values: [String(g.int(10000, 99999))] },
        { name: 'when_is_the_best_time_to_call?', values: [g.pick(['after 5', 'mornings', '9am-11am'])] },
      ];
      if (x) champs.splice(g.int(0, champs.length), 0, { name: x.attendu.email ? g.pick(['email', 'work_email_address', 'e-mail']) : g.pick(['phone_number', 'phone', 'mobile_number']), values: [x.ecrit] });
      const declare = Boolean(x) && !champs.some((c) => c.name === 'work_email_address');
      // Des identifiants Meta réels : quinze à dix-huit chiffres, jamais de zéro en tête.
      const valeur = {
        id: `${g.int(1, 9)}${g.chiffres(15)}`,
        created_time: '2026-09-17T10:00:00+0000',
        ad_id: `120${g.chiffres(15)}`,
        form_id: `${g.int(1, 9)}${g.chiffres(14)}`,
        campaign_id: `120${g.chiffres(15)}`,
        platform: 'fb',
        field_data: champs,
      };
      return { lieu: 'facebook field_data', valeur, declare, autres: [], urls: [] };
    },
  ],
  [
    'ringba',
    1,
    (g, x) => {
      const suivi = telephone(g);
      const acheteur = telephone(g);
      const valeur: Record<string, unknown> = {
        inboundCallId: `RGB${g.hex(24)}`,
        inboundPhoneNumber: `+1${suivi.attendu.phone}`,
        targetNumber: `+1${acheteur.attendu.phone}`,
        callStartDt: '2026-09-17T14:03:11Z',
        callLengthInSeconds: String(g.int(5, 900)),
        campaignName: 'Auto US',
        publisherName: `pub_${g.int(1, 99)}`,
        recordingUrl: `https://media.ringba.com/recording-public?v=v1&k=${g.alnum(32)}`,
      };
      if (x && x.attendu.phone) valeur.callerId = g.pick([`+${x.attendu.phone.length === 10 ? '1' : ''}${x.attendu.phone}`, x.ecrit]);
      else if (x) valeur.tag_email = x.ecrit;
      return { lieu: 'ringba', valeur, declare: Boolean(x && x.attendu.phone), autres: [suivi, acheteur], urls: [] };
    },
  ],
  [
    'trustedform/jornaya',
    1,
    (g, x) => {
      const valeur: Record<string, unknown> = {
        xxTrustedFormCertUrl: `https://cert.trustedform.com/${g.hex(40)}`,
        xxTrustedFormPingUrl: `https://ping.trustedform.com/${g.hex(8)}.${g.alnum(40)}`,
        universal_leadid: g.uuid().toUpperCase(),
        jornaya_leadid: g.uuid().toUpperCase(),
        ip_address: `${g.int(1, 223)}.${g.int(0, 255)}.${g.int(0, 255)}.${g.int(1, 254)}`,
        user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Version/17.5 Mobile/15E148 Safari/604.1',
        consent_ts: `${g.int(1_600_000_000, 1_900_000_000)}${g.chiffres(3)}`,
      };
      if (x) valeur[x.attendu.email ? 'email' : 'phone'] = x.ecrit;
      return { lieu: 'trustedform/jornaya', valeur, declare: Boolean(x), autres: [], urls: [] };
    },
  ],
  [
    'affilié sub1…sub5',
    2,
    (g, x) => {
      const valeur: Record<string, unknown> = {
        aff_id: String(g.int(1, 999)),
        offer_id: String(g.int(1, 99)),
        sub1: g.pick(['fb', `Cj0KCQjw${g.alnum(20)}`, g.uuid()]),
        sub2: `${g.int(1_600_000_000, 1_900_000_000)}${g.chiffres(3)}`,
        sub3: leurre(g),
        sub4: 'auto_us',
        sub5: String(g.int(10000, 99999)),
      };
      if (x) valeur[g.pick(['sub1', 'sub2', 'sub3', 'sub4', 'sub5'])] = g.chance(0.5) ? x.ecrit : texteAvec(g, x.ecrit);
      return { lieu: 'affilié sub1…sub5', valeur, declare: false, autres: [], urls: [] };
    },
  ],
  [
    'métadonnées imbriquées',
    2,
    (g, x) => {
      const tiers = g.chance(0.5) ? telephone(g) : adresse(g, true);
      const conteneurTiers = g.pick(['transfer', 'agent', 'buyer', 'spouse', 'vendor']);
      const valeur: Record<string, unknown> = {
        event: 'lead',
        metadata: {
          ts: `${g.int(1_600_000_000, 1_900_000_000)}${g.chiffres(3)}`,
          lead: x ? { contact: { [x.attendu.email ? g.pick(CLES_MAIL) : g.pick(CLES_TEL)]: x.ecrit } } : { zip: '33610' },
          [conteneurTiers]: { [tiers.attendu.email ? 'email' : 'phone']: tiers.ecrit },
          raw: JSON.stringify({ order: `ORD-2026-${g.chiffres(7)}`, ip: '203.0.113.7', amount: '32.50' }),
        },
      };
      return { lieu: 'métadonnées imbriquées', valeur, declare: Boolean(x), autres: [tiers], urls: [] };
    },
  ],
  [
    // Le texte de consentement porte le numéro du PARTENAIRE (juré r11) : il n'est lu ni à l'entrée ni à
    // l'effacement. Ce numéro n'est pas dans `autres` : l'inscrire est une violation de P2.
    'consentement',
    1,
    (g, x) => {
      const partenaire = telephone(g);
      const consent = `By clicking Submit I agree that Partner Insure may call me${g.pick(['', ' at the number above'])}. Questions? Call ${partenaire.ecrit}.`;
      const valeur: Record<string, unknown> = {
        [g.pick(['consent', 'consentText', 'consent_text', 'tcpa_text'])]: consent,
        zip: '33610',
      };
      if (x) valeur[x.attendu.email ? 'email' : 'phone'] = x.ecrit;
      return { lieu: 'consentement', valeur: g.chance(0.5) ? valeur : { metadata: valeur }, declare: Boolean(x), autres: [], urls: [] };
    },
  ],
  [
    'json en chaîne / tableau',
    1,
    (g, x) => {
      const cle = x?.attendu.email ? 'email' : 'phone';
      const valeur: Record<string, unknown> = g.chance(0.5)
        ? { raw_body: JSON.stringify({ [cle]: x?.ecrit ?? leurre(g), zip: '33610', ts: Date.UTC(2026, 8, 17) }) }
        : { fields: ['Ann Dupont', x?.ecrit ?? leurre(g), '33610', leurre(g)] };
      return { lieu: 'json en chaîne / tableau', valeur, declare: false, autres: [], urls: [] };
    },
  ],
];

const POIDS_TOTAL = FABRIQUES.reduce((s, [, p]) => s + p, 0);

/** Les cas d'une graine. Un cas sur dix n'a PAS de personne : que des leurres, et rien ne doit être inscrit. */
export function* casDe(graine: number, n: number): Generator<Cas> {
  const g = new G(mulberry32(graine));
  for (let i = 0; i < n; i += 1) {
    let tirage = g.f() * POIDS_TOTAL;
    let fabrique = FABRIQUES[0][2];
    for (const [, poids, f] of FABRIQUES) {
      if (tirage < poids) {
        fabrique = f;
        break;
      }
      tirage -= poids;
    }
    const personne = g.chance(0.1) ? null : contact(g);
    const cas = fabrique(g, personne);
    yield { ...cas, personne, declare: cas.declare && personne !== null };
  }
}
