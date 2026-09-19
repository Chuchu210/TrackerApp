import { createHash, createHmac } from 'node:crypto';
import type { ConversionContext } from '../conversions/dto/conversion-context';

/**
 * Events that can carry the person behind a visit. Quiz pages send the answers with `lead` at the result screen and
 * the contact afterwards with `callback_request`; the form page sends everything with `lead`. Same list as the
 * `lead` step of the LP funnel (shared/tracking/lp-funnel.ts).
 */
export const CONTACT_EVENT_TYPES = ['lead', 'callback_request', 'postalcode'] as const;

const CONTACT_EVENTS = new Set<string>(CONTACT_EVENT_TYPES);

/** Quiz answers kept with a lead: q1..q99 plus the named answers older quiz versions sent. */
const NAMED_ANSWERS = new Set(['insured', 'vehicles', 'homeowner']);

export function isContactEvent(eventType: string): boolean {
  return CONTACT_EVENTS.has(eventType);
}

export interface LeadData {
  source: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  zip: string | null;
  state: string | null;
  answers: Record<string, string> | null;
  consentText: string | null;
  consentHash: string | null;
  consentAt: Date | null;
  ip: string | null;
  userAgent: string | null;
  pageUrl: string | null;
}

function clip(value: unknown, max: number): string | null {
  if (value === null || value === undefined || typeof value === 'object') return null;
  const text = String(value)
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .trim();
  return text ? text.slice(0, max) : null;
}

/**
 * Le texte de consentement TEL QU'AFFICHÉ : ses retours à la ligne et tabulations restent (`clip` en faisait des
 * espaces), seuls les caractères de contrôle invisibles partent. C'est la preuve du droit d'appeler ; elle se garde
 * mot pour mot.
 */
function verbatim(value: unknown, max: number): string | null {
  if (value === null || value === undefined || typeof value === 'object') return null;
  const text = String(value).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  return text.trim() ? text.slice(0, max) : null;
}

/**
 * Les chiffres pleine chasse (« ８１３ », saisis par un clavier japonais ou chinois) sont des chiffres : lus comme
 * autre chose, le numéro échappait à la liste ET au nettoyage (juré r11). Même longueur : les positions ne bougent pas.
 */
export function chiffresAscii(texte: string): string {
  return texte.replace(/[\uff10-\uff19]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xff10 + 48));
}

/**
 * Le consentement n'est PAS lu, ni à l'entrée ni à l'effacement (juré r11) : il porte le numéro du partenaire ou de
 * l'annonceur (« Questions? Call 1-866-555-0100 »), et inscrit à l'effacement d'une personne il refusait ensuite les
 * leads de test du partenaire lui-même. L'intake ne le comparait déjà pas ; les deux côtés disent maintenant la même
 * chose. Le nettoyage, lui, l'emporte toujours entier (`PII_METADATA_KEYS`).
 */
const CLES_NON_LUES = new Set(['consent', 'consenttext', 'consentlanguage', 'tcpa', 'tcpatext', 'tcpaconsent']);
function cleNonLue(cle: string): boolean {
  return CLES_NON_LUES.has(cle.toLowerCase().replace(/[^a-z]/g, ''));
}

/** Digits only; a leading US country code is dropped. Anything that cannot be a phone number is null. */
export function normalizePhone(raw: unknown): string | null {
  // Le préfixe international « 00 » est la même chose que « + » : « 001 813 555 0142 » est le numéro que
  // « +1 813 555 0142 » écrit autrement. Sans ce retrait, la même personne avait deux formes, donc deux identités
  // pour la déduplication comme pour la liste de suppression.
  // L'EXTENSION n'est pas le numéro : « (813) 555-0142 x7 » devenait 81355501427 — un numéro faux en base, et une
  // empreinte que la liste de suppression ne reconnaissait plus. Elle part avant qu'on compte les chiffres.
  // Ce qui borde la valeur n'en fait pas partie : une espace de largeur nulle ou un crochet après le poste
  // (« 001 511 270 9778 ext.21] ») empêchaient de le reconnaître, et ses chiffres entraient dans le numéro (tour 29).
  // Tour 30 (juré r11) : les autres écritures d'un poste — « Ext: 12 », « extn 12 », « x.12 » — et la forme RFC 3966
  // (« +1-813-555-0142;ext=12 », « 8135550142;phone-context=+1 ») : tout ce qui suit un « ; » est un paramètre, pas
  // un chiffre du numéro. Rangé tel quel, « …0142 Ext: 12 » devenait 813555014212 : un numéro qui n'existe pas,
  // DÉCLARÉ à la liste de suppression.
  const sansPoste = chiffresAscii(String(raw ?? ''))
    .replace(/;.*$/s, '')
    .replace(/\s*(?:x\.?|ext[.:=]?|extn|extension|poste|#)\s*\d{1,6}[^\p{L}\p{N}]*$/iu, '');
  // Le préfixe national entre parenthèses après l'indicatif (« +44 (0)7911 123456 ») ne se compose pas depuis
  // l'étranger : gardé, la même personne avait deux identités, 4407911123456 et 447911123456 (juré r11).
  const digits = sansPoste
    .replace(/^([^\d+]*(?:\+|00)\s*\d{1,3})\s*\(0\)/, '$1')
    .replace(/\D/g, '')
    .replace(/^00/, '');
  // Après un indicatif ÉCRIT (« + », « 00 ») autre que +1 : le 0 de ligne national n'appartient pas au numéro.
  const complet = /^[^\d+]*(?:\+|00)/.test(sansPoste) && !digits.startsWith('1') ? sansPrefixeNational(digits) : digits;
  const national = complet.length === 11 && complet.startsWith('1') ? complet.slice(1) : complet;
  return national.length >= 7 && national.length <= 15 ? national : null;
}

/**
 * Les pays où un numéro national commence par un « 0 » que l'on ne compose PAS depuis l'étranger (le préfixe de
 * ligne, « trunk prefix ») : après leur indicatif, ce 0 n'appartient pas au numéro. « +44 07911 123456 » est
 * « +44 7911 123456 » écrit par quelqu'un qui garde l'habitude nationale — deux identités jusqu'ici (juré r13).
 * Pas l'Italie (39) : là, le 0 fait partie du numéro fixe.
 */
const TRONC_ZERO = new Set([
  '20', '27', '31', '32', '33', '41', '43', '44', '46', '49', '60', '61', '62', '63', '64', '66', '81', '82', '84', '86',
  '90', '91', '92', '234', '254', '353', '380', '972',
]);
function sansPrefixeNational(chiffres: string): string {
  const indicatif = [3, 2].map((n) => chiffres.slice(0, n)).find((c) => TRONC_ZERO.has(c));
  return indicatif && chiffres[indicatif.length] === '0' ? indicatif + chiffres.slice(indicatif.length + 1) : chiffres;
}

/**
 * L'empreinte à sens unique d'un contact, pour la liste de suppression.
 *
 * Ni le numéro ni l'adresse ne survivent à un effacement — on ne peut donc pas reconnaître la personne qui
 * revient, et elle revenait. Une empreinte permet de la RECONNAÎTRE sans la retrouver : on ne rappelle personne
 * avec un SHA-256, et on ne sait pas qui il désigne. C'est son unique raison d'être, et elle ne sert qu'à refuser.
 */
export function contactFingerprints(
  contact: { phone?: string | null; email?: string | null },
  key: string,
): { hash: string; kind: string }[] {
  // UN HMAC À CLÉ SECRÈTE, PAS UN SHA-256 NU. Un numéro américain a dix chiffres : le juré a retrouvé un numéro
  // depuis son empreinte non salée en 30 secondes sur un seul cœur, et l'espace entier tient en trois heures. La
  // promesse « on ne peut ni l'appeler ni savoir qui c'est » était donc fausse. Avec une clé gardée HORS de la base,
  // une fuite de la base seule ne révèle plus rien — et la recherche reste déterministe, ce qu'un sel par ligne
  // aurait rendu impossible.
  // Absente, blanche ou courte : refusée. Une clé de quelques caractères se devine aussi vite qu'un numéro, et
  // une clé faite d'espaces passait jusqu'ici pour une vraie.
  if (!key || key.trim().length < 32) {
    throw new Error('ERASURE_HMAC_KEY absente ou trop courte (32 caractères au moins) : liste de suppression indisponible');
  }
  const out: { hash: string; kind: string }[] = [];
  const phone = normalizePhone(contact.phone);
  const email = suppressionEmail(contact.email);
  // Les valeurs NORMALISÉES, pas celles écrites : « (813) 555-0142 » et « 8135550142 » sont la même personne, et
  // une empreinte posée sur la forme brute ne la reconnaîtrait pas sous l'autre.
  if (phone) out.push({ hash: createHmac('sha256', key).update(`phone:${phone}`).digest('hex'), kind: 'phone' });
  if (email) out.push({ hash: createHmac('sha256', key).update(`email:${email}`).digest('hex'), kind: 'email' });
  return out;
}

/**
 * UNE SEULE forme d'adresse, pour le nettoyage ET pour l'empreinte (juré r5 : `josé@…` était effacée sans être
 * inscrite, `ann&co@…` inscrite comme `co@…` — l'adresse de quelqu'un d'autre). La partie locale accepte ce que les
 * gens écrivent (accents, `&`, apostrophe) et s'arrête à ce qui sépare les paramètres d'une URL (`=`, `?`, `/`).
 */
// BORNÉE aux longueurs de la RFC (64 avant l'arobase, 253 après) : non bornée, une suite de cent mille caractères
// sans arobase coûtait sept secondes de retour arrière — le nettoyage comme l'inscription, sur une route publique.
// `#` et `|` sont légaux dans une partie locale, mais écrits devant une adresse ils la SÉPARENT de ce qui précède :
// `#ann@…` (un fragment, un hashtag), `spring|ann@…` (une valeur d'identifiant) — lus avec, ils inscrivaient une boîte
// qui n'est pas celle d'Ann (juré r10). Tranché pour P2 (docs §9) : une adresse qui contient vraiment `#` ou `|`
// est lue sans ce qui les précède.
// Le DOMAINE, lui, n'est fait que de lettres, de chiffres et de tirets (IDN compris) : lu plus large, « “ann@x.de”.Please »
// inscrivait `ann@x.de”.please` (tour 29).
export const EMAIL_PARTOUT = /[^\s@,;:<>()"=?/|#]{1,64}@[\p{L}\p{M}\p{N}-]{1,63}(?:\.[\p{L}\p{M}\p{N}-]{1,63}){0,16}\.[a-z]{2,24}/giu;

/**
 * Les clés dont la valeur est un identifiant de plateforme, jamais une personne : Google Ads ajoute tout seul
 * `gad_campaignid=21234567890` à chaque URL d'atterrissage — onze chiffres, la forme exacte d'un numéro. Le juré r5
 * l'a fait inscrire comme téléphone. Le user-agent porte des versions (`Chrome/126.0.6478.127`) de la même forme.
 */
// `user_agent` et les en-têtes `sec-ch-ua*`, pas toute clé qui contient « agent » : `agent_notes` porte un rappel.
// Tour 32 (juré r13) : `utm_term` et `utm_content` ne sont PAS des identifiants — les outils d'e-mailing y écrivent
// l'adresse du destinataire, et ce sont des colonnes de la visite que l'effacement doit nettoyer ; les lire comme
// identifiants laissait `utm_term=ann.doe@gmail.com` en base. Les identifiants d'annonce (`ad_id`, `site_id`…), eux,
// en sont : onze chiffres Microsoft Ads se lisaient comme un numéro.
const CLE_D_IDENTIFIANT =
  /^(gad_|hsa_)|^utm_(?!term$|content$)|campaign|adgroup|adset|gclid|gbraid|wbraid|fbclid|msclkid|ttclid|dclid|user_?-?agent|^ua$|^sec-ch-ua|^(ad|creative|placement|site|asset|offer|lander|path|variant)_?id$/i;

/** Ce nom de clé ou de colonne dit-il « identifiant » ? Un numéro n'y est alors ni lu, ni retiré — une adresse, si. */
export function estCleDIdentifiant(cle: string): boolean {
  return CLE_D_IDENTIFIANT.test(cle);
}

/**
 * Les champs qui portent le contact DE LA PERSONNE, par leur nom exact — une LISTE BLANCHE. Deux tours de liste
 * noire (« tracking », « support »…) ont laissé passer `transfer_phone`, `carrier_phone`, `vendor_phone` (juré r7) :
 * le vocabulaire des tiers ne se termine jamais, celui de la personne tient en une ligne. Le nom est comparé sans
 * casse, sans ponctuation ni chiffres (`Phone_1`, `phoneNumber`), après avoir retiré un préfixe qui désigne la
 * personne (`customer_`, `lead_`, `contact_`…). Tout autre champ est lu quand même — comme « trouvé ».
 */
// Tour 29 : `contact_number` (le numéro que la personne donne pour être rappelée), les formulaires hispanophones
// (`telefono`, `celular`, `correo`) et `whatsapp` — tous sortaient « trouvés », donc moins protégés contre un retour.
const CHAMPS_DE_LA_PERSONNE = new Set([
  'phone', 'phonenumber', 'mobile', 'mobilephone', 'mobilenumber', 'cell', 'cellphone', 'cellnumber', 'tel',
  'telephone', 'telephonenumber', 'ani', 'callerid', 'caller', 'msisdn', 'numero', 'numerotelephone', 'portable',
  'contactnumber', 'telefono', 'numerodetelefono', 'celular', 'whatsapp', 'whatsappnumber',
  // Tour 31 (juré r12) : ce que les formulaires américains nomment aussi le numéro de la personne.
  'callbacknumber', 'homenumber', 'smsnumber', 'textnumber', 'landline', 'cellular', 'phonenum',
  'email', 'emailaddress', 'emailaddr', 'mail', 'mailaddress', 'courriel', 'adresseemail', 'adressemail', 'correo',
  'correoelectronico',
]);
// Ce qui qualifie le contact SANS changer de propriétaire : `day_phone`, `phone_home`, `cell_phone_number`,
// `best_phone`, `callback_phone` sont tous le numéro de la personne (juré r8 : ils étaient sortis de la liste).
// PAS `work` : le standard de l'entreprise est partagé par tous ses employés, comme `business_phone` (juré r9).
const PREFIXES_DE_LA_PERSONNE = [
  'customer', 'contact', 'lead', 'user', 'client', 'primary', 'secondary', 'home', 'personal', 'my', 'your', 'best',
  'day', 'evening', 'night', 'alt', 'alternate', 'callback', 'cell', 'mobile', 'other', 'daytime',
];

/** Les noms de base de la liste blanche, pour le filet SQL qui ne peut pas appeler `champDeLaPersonne` (lead-sql.ts). */
export const NOMS_DE_CONTACT: readonly string[] = [...CHAMPS_DE_LA_PERSONNE];
const SUFFIXES_DE_LA_PERSONNE = ['home', 'cell', 'mobile', 'day', 'evening', 'primary', 'secondary', 'alt', 'number', 'num', 'no'];
function champDeLaPersonne(cle: string): 'phone' | 'email' | null {
  let nom = cle.toLowerCase().replace(/[^a-z]/g, '');
  for (let retire = true; retire && !CHAMPS_DE_LA_PERSONNE.has(nom); ) {
    retire = false;
    for (const p of PREFIXES_DE_LA_PERSONNE) {
      const reste = nom.slice(p.length);
      if (nom.length > p.length && nom.startsWith(p) && CHAMPS_DE_LA_PERSONNE.has(reste)) {
        nom = reste;
        retire = true;
      }
    }
    for (const s of SUFFIXES_DE_LA_PERSONNE) {
      const reste = nom.slice(0, nom.length - s.length);
      if (nom.length > s.length && nom.endsWith(s) && CHAMPS_DE_LA_PERSONNE.has(reste)) {
        nom = reste;
        retire = true;
      }
    }
  }
  if (!CHAMPS_DE_LA_PERSONNE.has(nom)) return null;
  return /mail|courriel|correo/.test(nom) ? 'email' : 'phone';
}
// Une date suivie ou non d'une heure — « 09-17-2026 10:00 », créneau de rappel — n'est pas un numéro.
// Une date ENTIÈRE : « 06.12.34.56.78 », un numéro français à points, commence comme une date et n'en est pas une
// (juré r6) — après l'année, rien ne doit continuer la suite.
const DATE_EN_TETE = /^\(?\d{1,2}[-/.]\d{1,2}[-/.](?:\d{4}|\d{2})(?![-/.]?\d)/;

/**
 * UNE VUE d'une valeur (tour 31) : le texte qu'un lecteur humain y lit — décodé, arobases masquées rendues, chiffres
 * pleine chasse, espaces et tirets Unicode ramenés à « » et « - » — ET, pour chaque caractère lu, l'endroit de la
 * valeur d'ORIGINE d'où il vient (`de`, `a`).
 *
 * C'est la pièce qui manquait depuis le tour 10 : la liste et le nettoyage lisaient chacun à leur façon, et chaque juré
 * trouvait une classe de valeurs lues par l'un et pas par l'autre (r12 : un numéro écrit avec une espace insécable,
 * DÉCLARÉ, donc inscrit — et laissé en base par l'effacement). Désormais une seule détection (`detecter`) rend des
 * PORTÉES dans la valeur d'origine : la liste inscrit ce qu'elles contiennent, le nettoyage caviarde exactement ces
 * portées. Ce qui est inscrit est retiré, par construction.
 */
interface Vue {
  texte: string;
  de: number[];
  a: number[];
}

function vueDe(brut: string): Vue {
  const de = new Array<number>(brut.length);
  const a = new Array<number>(brut.length);
  for (let i = 0; i < brut.length; i += 1) {
    de[i] = i;
    a[i] = i + 1;
  }
  return { texte: brut, de, a };
}

/** Remplace chaque correspondance ; à longueur égale chaque caractère garde sa source, sinon il vient de TOUTE la correspondance. */
function remplacerVue(v: Vue, motif: RegExp, par: (m: string, i: number, s: string) => string): Vue {
  const morceaux: string[] = [];
  const de: number[] = [];
  const a: number[] = [];
  let curseur = 0;
  let change = false;
  for (const m of v.texte.matchAll(motif)) {
    const i = m.index ?? 0;
    const r = par(m[0], i, v.texte);
    if (r === m[0] || !m[0]) continue;
    change = true;
    morceaux.push(v.texte.slice(curseur, i));
    for (let k = curseur; k < i; k += 1) (de.push(v.de[k]), a.push(v.a[k]));
    morceaux.push(r);
    for (let k = 0; k < r.length; k += 1) {
      if (r.length === m[0].length) (de.push(v.de[i + k]), a.push(v.a[i + k]));
      else (de.push(v.de[i]), a.push(v.a[i + m[0].length - 1]));
    }
    curseur = i + m[0].length;
  }
  if (!change) return v;
  morceaux.push(v.texte.slice(curseur));
  for (let k = curseur; k < v.texte.length; k += 1) (de.push(v.de[k]), a.push(v.a[k]));
  return { texte: morceaux.join(''), de, a };
}

/**
 * Combien de couches d'encodage on retire : QUATRE, pas deux (tour 29). Une URL de page dans le paramètre d'une URL
 * de redirection, encodée deux fois par la page, en porte quatre. Même profondeur pour la liste et le nettoyage,
 * puisque c'est la même vue.
 */
const COUCHES = 4;

/**
 * Décodée `couches` fois au plus, suite `%XX` par suite (une suite invalide reste telle quelle, sans empêcher les
 * autres d'être lues). Le « + » reste un « + » : collé à ce qui le précède, `numerosDans` le lit comme l'espace d'une
 * query string (`PLUS_ESPACE`) ; détaché, c'est un indicatif (« Phone: +63 917… », juré r11) ; dans une adresse, une
 * étiquette (`ann+promo@…`). Une seule vue suffit donc : le banc de mutation du tour 31 a montré que la seconde
 * lecture (« + » = espace partout) ne lisait rien que celle-ci ne lise déjà.
 */
function decoderVue(v: Vue, couches = COUCHES): Vue {
  let cur = v;
  for (let passe = 0; passe < couches && /%[0-9a-f]{2}/i.test(cur.texte); passe += 1) {
    const avant = cur.texte;
    cur = remplacerVue(cur, /(?:%[0-9a-f]{2})+/gi, (suite) => {
      try {
        return decodeURIComponent(suite);
      } catch {
        return suite;
      }
    });
    if (cur.texte === avant) break;
  }
  return cur;
}

/**
 * Ce qu'un lecteur humain lit (juré r11 puis r12) : une arobase écrite en entité HTML (`ann&#64;gmail.com`), échappée
 * dans du JSON (`ann\u0040gmail.com`) ou masquée à la main (`ann (at) gmail (dot) com`) ; des chiffres pleine chasse ;
 * et les séparateurs que produisent claviers mobiles et traitements de texte — espace insécable, espace fine, tirets
 * demi-cadratin, insécable, moins mathématique — ramenés à « » et « - », À LONGUEUR ÉGALE (les portées restent justes).
 */
function lisibleVue(v: Vue): Vue {
  let r = remplacerVue(v, /&#0*64;|&#x0*40;|&commat;|\\u0040/gi, () => '@');
  r = remplacerVue(r, /\s*[([]\s*at\s*[)\]]\s*/gi, () => '@');
  r = remplacerVue(r, /\s*[([]\s*dot\s*[)\]]\s*/gi, () => '.');
  return remplacerVue(r, /[\uff10-\uff19\p{Zs}\p{Pd}\u2212]/gu, (c) =>
    /[\uff10-\uff19]/.test(c) ? chiffresAscii(c) : /\p{Zs}/u.test(c) ? ' ' : '-',
  );
}

/** LA vue d'une valeur : décodée, lisible, sur la carte de la valeur d'origine. */
function vueLisible(brut: string): Vue {
  return lisibleVue(decoderVue(vueDe(brut)));
}

/**
 * Un « + » COLLÉ à ce qui le précède (chiffre, lettre, parenthèse) n'est pas un indicatif : c'est l'espace d'une
 * query string (`s2=+1+480+672+4873 11094`, `phone=(534)+801-5359 2018`, `extension+1234 18700`). Lu comme préfixe,
 * il faisait de « +4873 11094 » un numéro international (tour 29). Remplacé par une espace — même longueur, mêmes
 * positions.
 */
const PLUS_ESPACE = /(?<=[\p{L}\p{N})])\+(?=[\d(])/gu;

/**
 * Les numéros d'un texte, avec leurs bornes : la partie à caviarder va du premier chiffre au dernier (une parenthèse
 * fermante comprise) — ce qui précède (« + », « ( », une espace de phrase) reste, comme avant (« call 800-555-1212
 * later » devenait « call***later »). `carte` : une suite que le test de Luhn désigne comme une carte bancaire — jamais
 * inscrite comme téléphone, toujours retirée.
 */
function numerosDans(brut: string): { debut: number; fin: number; phone?: string; carte?: boolean }[] {
  const out: { debut: number; fin: number; phone?: string; carte?: boolean }[] = [];
  const texte = brut.replace(PLUS_ESPACE, ' ');
  for (const { debut, fin } of suitesPersonnelles(texte)) {
    const run = texte.slice(debut, fin);
    if (DATE_EN_TETE.test(run.trim())) continue;
    const tete = run.match(/^[^\d]*/)?.[0].length ?? 0;
    const queue = run.match(/[^\d)]*$/)?.[0].length ?? 0;
    const borne = { debut: debut + tete, fin: fin - queue };
    const chiffres = run.replace(/\D/g, '');
    // Plus de onze chiffres SANS préfixe international, ce n'est pas un téléphone : un horodatage en millisecondes,
    // un `form_id` Meta que le test de Luhn prend pour une carte, deux nombres juxtaposés (tour 29, P2).
    const n = !/^\(?(\+|00)/.test(run.trim()) && chiffres.length > 11 ? null : normalizePhone(run);
    if (n) out.push({ ...borne, phone: n });
    else if (looksLikeCard(chiffres)) out.push({ ...borne, carte: true });
  }
  return out;
}

type Trouve = { phone?: string; email?: string; declare: boolean; chemin: string; debut: number; fin: number };

/** Une portée : un contact lu dans une valeur, et OÙ il est écrit (début, fin) dans la valeur d'origine. */
interface Portee {
  debut: number;
  fin: number;
  phone?: string;
  email?: string;
  declare: boolean;
  /** Une carte bancaire : retirée par le nettoyage, jamais inscrite (ce n'est pas un contact). */
  carte?: boolean;
}

/**
 * Les conteneurs qui ne changent pas le PROPRIÉTAIRE de ce qu'ils portent : la fiche du lead, ses réponses, les
 * métadonnées d'un événement. Sous un autre parent — `transfer`, `agent`, `buyer`, `spouse` —, un `phone` n'est pas celui
 * de la personne (juré r9) : il est lu, comme « trouvé ».
 */
const CONTENEURS_DE_LA_PERSONNE = new Set([
  'metadata', 'rawparams', 'raw', 'data', 'fields', 'form', 'formdata', 'payload', 'body', 'answers', 'lead', 'contact',
  'customer', 'user', 'client', 'person', 'applicant', 'submission', 'values', 'params', 'query', 'event', 'properties',
  'props', 'attributes', 'details', 'info', 'profile', 'personal', 'me',
  // Les réponses d'un formulaire Meta Lead Ads : `field_data: [{ name: 'phone_number', values: [...] }]` (tour 29).
  'fielddata', 'formfields', 'answersdata',
  // Tour 32 (juré r13) : Gravity Forms / WPForms (`entry`), le webhook Meta (`entry[].changes[].value`, `leadgen`),
  // Typeform (`form_response`), les formulaires Google Ads (`user_column_data`).
  'entry', 'entries', 'changes', 'value', 'leadgen', 'formresponse', 'usercolumndata',
]);
function conteneurDeLaPersonne(cle: string): boolean {
  return CONTENEURS_DE_LA_PERSONNE.has(cle.toLowerCase().replace(/[^a-z]/g, ''));
}

/** Une valeur qui EST une URL (ou une query string), sans espace : elle se lit paramètre par paramètre. */
function estUneUrl(brut: string): boolean {
  return (
    !/\s/.test(brut) &&
    (/^[a-z][a-z0-9+.-]{0,31}:\/\/\S/i.test(brut) ||
      /^[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63}){1,16}\/\S*$/i.test(brut) ||
      /^\/\S*[?#]\S*$/.test(brut) ||
      /^[?#][\w.\-[\]%]+=/.test(brut))
  );
}
/** Une URL DANS un texte : jusqu'à la première espace (juré r9 : « https://… is my house. Call me? 813-555-0142 »). */
// BORNÉE (juré r10) : un schéma fait au plus 32 caractères, un hôte au plus 17 étiquettes de 63. Sans ces bornes,
// `\b[a-z][a-z0-9+.-]*:\/\/` repartait de chaque frontière de mot de « a.a.a.… » et avalait tout le reste avant
// d'échouer sur `://` : 100 ko coûtaient 3,5 s, lecture comme nettoyage, sur une route publique.
// L'apostrophe est légale dans une URL (`/merci/o'brien@…`) : s'y arrêter coupait l'adresse en deux (tour 29).
const URL_DANS_TEXTE = /(?:\b[a-z][a-z0-9+.-]{0,31}:\/\/|\bwww\.|(?<![\w@.-])[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){1,16}\/)[^\s"<>]*/gi;
/** Une query string nue : `nom=valeur&…`, avec un vrai NOM (pas `"Chromium";v=`). */
const REQUETE_NUE = /^[\w.\-[\]%]+=\S*$/;

/**
 * Les paires `nom=valeur` d'une URL : sa query string, et celle de son fragment quand la page route par fragment
 * (`#/quote?phone=…`) ou y range ses paramètres (`#tel=…`). Un segment SANS valeur n'est pas une paire : il reste du
 * texte, et le texte entier est déjà lu (juré r9 : `#/merci/8135550142`).
 */
function requetesDeUrl(brut: string, a: number, b: number): [number, number][] {
  const s = brut.slice(a, b);
  const h = s.indexOf('#');
  const finBase = h >= 0 ? a + h : b;
  const q = brut.slice(a, finBase).indexOf('?');
  const out: [number, number][] = q >= 0 ? [[a + q + 1, finBase]] : [];
  if (h >= 0) {
    const fa = a + h + 1;
    const fragment = brut.slice(fa, b);
    const fq = fragment.indexOf('?');
    if (fq >= 0) out.push([fa + fq + 1, b]);
    else if (/^[\w.\-[\]%]+=/.test(fragment)) out.push([fa, b]);
  }
  return out.filter(([x, y]) => y > x);
}

/** Les morceaux d'une plage séparés par `&` ou `;`, en positions. */
function morceauxDe(brut: string, a: number, b: number): [number, number][] {
  const out: [number, number][] = [];
  let debut = a;
  for (let i = a; i <= b; i += 1) {
    if (i === b || brut[i] === '&' || brut[i] === ';') {
      out.push([debut, i]);
      debut = i + 1;
    }
  }
  return out;
}

/**
 * Ce qu'une URL porte HORS de ses paires `nom=valeur` : le chemin (`/confirm/ann@…`), un fragment de texte
 * (`#ann@…`, `#/merci/ann@…`), un jeton nu (`?ann@…`). Ni paramètre ni texte lu : une adresse écrite là n'était
 * jamais inscrite (juré r10). Découpé AVANT décodage : un `&` encodé dans une valeur ne coupe rien. En positions.
 */
function horsParametres(brut: string, a: number, b: number, nue: boolean): [number, number][] {
  const out: [number, number][] = [];
  const nus = (qa: number, qb: number) => {
    for (const [ma, mb] of morceauxDe(brut, qa, qb)) if (brut.slice(ma, mb).indexOf('=') <= 0) out.push([ma, mb]);
  };
  if (nue) {
    nus(a, b);
    return out;
  }
  const h = brut.slice(a, b).indexOf('#');
  const finBase = h >= 0 ? a + h : b;
  const q = brut.slice(a, finBase).indexOf('?');
  if (q >= 0) {
    out.push([a, a + q]);
    nus(a + q + 1, finBase);
  } else out.push([a, finBase]);
  if (h >= 0) {
    const fa = a + h + 1;
    const fragment = brut.slice(fa, b);
    const fq = fragment.indexOf('?');
    if (fq >= 0) {
      out.push([fa, fa + fq]);
      nus(fa + fq + 1, b);
    } else if (/^[\w.\-[\]%]+=/.test(fragment)) nus(fa, b);
    else out.push([fa, b]);
  }
  return out.filter(([x, y]) => y > x);
}

/**
 * Une valeur qui est UNE adresse et rien d'autre, une étiquette au plus : `ann+quotes@gmail.com`. Dans une query
 * string le « + » code une espace — mais `?sub2=ann+quotes@gmail.com` lu « ann quotes@gmail.com » inscrivait
 * `quotes@gmail.com`, la boîte de quelqu'un d'autre, qui était ensuite refusé (juré r10). Deux « + » ou plus
 * (`write+to+ann@x.com`), c'est une phrase : là, le « + » est une espace. Tranché pour P2 (docs §9).
 */
function uneSeuleAdresse(valeur: string): boolean {
  const t = sansBordures(valeur.trim());
  const at = t.indexOf('@');
  if (at <= 0 || at !== t.lastIndexOf('@') || /\s/.test(t)) return false;
  return (
    (t.slice(0, at).match(/\+/g) ?? []).length <= 1 &&
    /^[\p{L}\p{N}-]{1,63}(?:\.[\p{L}\p{N}-]{1,63}){0,16}\.[a-z]{2,24}$/iu.test(t.slice(at + 1))
  );
}

/**
 * (nom, valeur « + » gardé, valeur « + » = espace). Le choix se fait plus bas : une valeur qui est une seule adresse
 * garde son « + », quel que soit le nom du paramètre ; ailleurs le « + » est une espace.
 */
function pairesDe(brut: string, qa: number, qb: number): { nom: string; va: number; vb: number }[] {
  const out: { nom: string; va: number; vb: number }[] = [];
  // `;` sépare aussi des paramètres (matrix URIs, vieux serveurs Java) — `sanitizeUrlPii` le reconnaît déjà :
  // `?utm_source=fb;phone=8135550142` est un numéro déclaré, pas la valeur de `utm_source` (juré r10).
  for (const [ma, mb] of morceauxDe(brut, qa, qb)) {
    const i = brut.slice(ma, mb).indexOf('=');
    if (i <= 0) continue;
    let nom = brut.slice(ma, ma + i).replace(/\+/g, ' ');
    try {
      nom = decodeURIComponent(nom);
    } catch {
      // un nom mal encodé se lit tel quel
    }
    out.push({ nom, va: ma + i + 1, vb: mb });
  }
  return out;
}

/**
 * Un paramètre dont le NOM dit « identifiant » (`gad_campaignid=…`, `utm_…=…`) sort du texte avant qu'on y cherche
 * des numéros — dans une URL comme dans une phrase —, et TOUT le reste se lit. Couper le texte au premier « ? » ou à
 * la première URL, comme avant, cachait le numéro qui suivait (juré r9).
 */
// Un NOM se prend depuis son début (lookbehind) et sur 64 caractères au plus : sans ces deux bornes, une suite de
// cent mille caractères sans « = » coûtait six secondes de retour arrière.
// La VALEUR d'un identifiant s'arrête au premier caractère qu'un identifiant ne porte pas (juré r10) : jusqu'au
// premier `&`, `utm_source=fb;phone=8135550142` ou `utm_content=spring|8135550142` était blanchi en entier — et le
// numéro de la personne avec. Le `+` reste dans la valeur : dans une query string, c'est une espace du même paramètre.
const PAIRE = /(?<![A-Za-z0-9_.\-[\]%])([A-Za-z0-9_.\-[\]%]{1,64})=([\w.\-%~+]*)/g;
// À LONGUEUR ÉGALE (tour 31) : les positions du reste du texte ne bougent pas, les portées restent justes.
function sansIdentifiants(texte: string): string {
  return texte.replace(PAIRE, (paire: string, nom: string) => (CLE_D_IDENTIFIANT.test(nom) ? ' '.repeat(paire.length) : paire));
}

/**
 * LE DÉTECTEUR (tour 31) — une chaîne, sous une clé, et ce qu'on y lit comme contact, AVEC SA PLACE dans la chaîne
 * d'origine. La liste de suppression inscrit ces portées ; le nettoyage les caviarde (`caviarder`). Aucun des deux
 * n'a d'autre façon de reconnaître une personne : ce qui est inscrit est retiré, et rien n'est retiré « au cas où »
 * sans être aussi lu — sauf une carte bancaire, qui n'est pas un contact.
 *
 * « Déclaré » : un champ de contact de la personne (liste blanche), sous un conteneur qui est le sien, ou écrit
 * `tel:` / `mailto:`. « Trouvé » : reconnu à sa forme ailleurs. UNE SEULE FORME, FIDÈLE (juré r9) : chaque forme
 * inscrite est celle qu'un lecteur humain y lit.
 */
function detecter(
  brut: string,
  cle: string,
  cheminDeLaPersonne: boolean,
  niveauUrl: number,
  budget: { reste: number; tronque?: boolean },
): Portee[] {
  const out: Portee[] = [];
  budget.reste -= brut.length;
  // Sans chiffre (pleine chasse comprise), sans arobase et sans arobase masquée (`&#64;`, `@`, `(at)`), une chaîne
  // ne porte ni numéro ni adresse — ni dans un paramètre, dont l'encodage porterait des chiffres. Rien à lire, ni à
  // retirer : « a=a&… » sur 100 ko relisait 25 000 valeurs d'une lettre (juré r11, banc de coût).
  if (!/[\d@\uff10-\uff19]|&#|&commat;|\\u0040|[([]\s*at\s*[)\]]/i.test(brut)) return out;
  const champ = cheminDeLaPersonne ? champDeLaPersonne(cle) : null;
  const identifiant = CLE_D_IDENTIFIANT.test(cle);
  const t0 = brut.length - brut.trimStart().length;
  const coeur = brut.trim();
  const t1 = t0 + coeur.length;
  const schema = coeur.toLowerCase();
  const url = estUneUrl(coeur);
  const requeteNue = !url && REQUETE_NUE.test(coeur);
  const urls: [number, number][] =
    url || requeteNue ? [] : [...brut.matchAll(URL_DANS_TEXTE)].map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length]);
  const sansPlus = vueLisible(brut);
  const versBrut = (v: Vue, d: number, f: number): [number, number] => [v.de[d], v.a[f - 1]];

  // LES ADRESSES — hors des URL : celles-là se lisent paramètre par paramètre (plus bas), avec le bon sens du « + ».
  if (!url && !requeteNue) {
    // Les URL du texte sont blanchies À LONGUEUR ÉGALE (unités de code, pas points de code) : les positions tiennent.
    // Un masque sur la valeur d'origine, construit une fois : le tester URL par URL coûtait 2 s sur 8 000 URL.
    const masque = new Uint8Array(brut.length + 1);
    for (const [ua, ub] of urls) masque.fill(1, ua, ub);
    const phrase = urls.length ? sansPlus.texte.split('').map((c, i) => (masque[sansPlus.de[i]] ? ' ' : c)).join('') : sansPlus.texte;
    const declare = champ === 'email' || schema.startsWith('mailto:');
    for (const m of adressesDans(phrase)) {
      const [debut, fin] = versBrut(sansPlus, m.debut, m.fin);
      out.push({ debut, fin, email: m.email, declare });
    }
  }
  // …et DANS une URL, hors de ses paramètres : chemin, fragment de texte, jeton nu (juré r10). Le « + » y est gardé.
  // Trouvées, jamais déclarées : aucun nom ne les désigne.
  const zonesAdresses: [number, number][] = [
    ...(url ? horsParametres(brut, t0, t1, false) : []),
    ...(requeteNue ? horsParametres(brut, t0, t1, true) : []),
    ...urls.flatMap(([ua, ub]) => horsParametres(brut, ua, ub, false)),
  ];
  for (const [za, zb] of zonesAdresses) {
    const v = vueLisible(brut.slice(za, zb));
    for (const m of adressesDans(v.texte)) {
      const [debut, fin] = versBrut(v, m.debut, m.fin);
      out.push({ debut: za + debut, fin: za + fin, email: m.email, declare: false });
    }
  }

  // LES NUMÉROS — dans tout le texte, identifiants retirés. Dans un champ d'identifiant, rien n'est une personne.
  if (!identifiant) {
    const declare = champ === 'phone' || schema.startsWith('tel:');
    for (const n of numerosDans(sansIdentifiants(sansPlus.texte))) {
      if (n.fin <= n.debut) continue;
      const [debut, fin] = versBrut(sansPlus, n.debut, n.fin);
      out.push(n.carte ? { debut, fin, declare: false, carte: true } : { debut, fin, phone: n.phone, declare });
    }
    // Sous une clé qui se dit téléphone, la valeur entière compte même courte (sept chiffres locaux) : elle est
    // inscrite, donc elle est retirée entière.
    if (declare && coeur && !sansPlus.texte.includes('@')) {
      const numero = normalizePhone(sansPlus.texte.trim().replace(/^\s*tel:/i, ''));
      if (numero) out.push({ debut: t0, fin: t1, phone: numero, declare: true });
    }
  }

  // LES PARAMÈTRES, relus avec leur NOM : `?tel=555…` est déclaré. Deux niveaux au plus : une URL dans une URL existe
  // (une redirection), une troisième est une attaque. Dans un champ d'identifiant, rien n'est relu.
  if (identifiant) return out;
  const plages: [number, number][] = [
    ...(url ? requetesDeUrl(brut, t0, t1) : []),
    ...(requeteNue ? ([[t0, t1]] as [number, number][]) : []),
    ...urls.flatMap(([ua, ub]) => requetesDeUrl(brut, ua, ub)),
  ];
  if (!plages.length) return out;
  if (niveauUrl >= 2) {
    // Un troisième niveau d'URL n'est pas lu — et ça se DIT (juré r7) ; une valeur qui a seulement un « = » (un jeton
    // base64 `s=YWJj==`) n'est pas une URL et n'y déclenche rien (juré r8).
    if (url || urls.length) budget.tronque = true;
    return out;
  }
  for (const [qa, qb] of plages) {
    for (const { nom, va, vb } of pairesDe(brut, qa, qb)) {
      const valeur = vueDe(brut.slice(va, vb));
      const avecPlus = decoderVue(valeur, 1);
      const avecEspace = decoderVue(remplacerVue(valeur, /\+/g, () => ' '), 1);
      // Sous un nom d'adresse, toute adresse garde son « + » (juré r9) ; sous un autre nom, une valeur qui n'est
      // qu'UNE adresse le garde aussi (juré r10 : `?sub2=ann+quotes@gmail.com`).
      const garderPlus = champDeLaPersonne(nom) === 'email' ? normalizeEmail(avecPlus.texte) !== null : uneSeuleAdresse(avecPlus.texte);
      const lue = garderPlus ? avecPlus : avecEspace;
      if (lue.texte === brut) continue;
      for (const p of detecter(lue.texte, nom, cheminDeLaPersonne, niveauUrl + 1, budget)) {
        if (p.fin <= p.debut) continue;
        out.push({ ...p, debut: va + lue.de[p.debut], fin: va + lue.a[p.fin - 1] });
      }
    }
  }
  return out;
}

/**
 * Parcourt une valeur quelconque — objet, tableau, URL, chaîne — et rend chaque contact lu, avec son CHEMIN et sa
 * portée. BORNÉ (juré r5) : au-delà du budget, on s'arrête, et ça se DIT (juré r6) : l'effacement répond « partial ».
 */
function parcourir(
  valeur: unknown,
  cle: string,
  profondeur: number,
  budget: { reste: number; tronque?: boolean },
  out: Trouve[],
  cheminDeLaPersonne = true,
  chemin = '',
): void {
  if (valeur === null || valeur === undefined) return;
  if (budget.reste <= 0 || profondeur > 24) {
    budget.tronque = true;
    return;
  }
  if (Array.isArray(valeur)) {
    valeur.forEach((v, i) => {
      const objet = v !== null && typeof v === 'object';
      parcourir(v, cle, profondeur + 1, budget, out, cheminDeLaPersonne && (!objet || conteneurDeLaPersonne(cle)), `${chemin}[${i}]`);
    });
    return;
  }
  if (typeof valeur === 'object') {
    const o = valeur as Record<string, unknown>;
    // UN CHAMP DÉCRIT PAR SES PROPRES CLÉS — `{ name: 'phone_number', values: ['+1…'] }` (Meta Lead Ads), `{ key,
    // value }` : son nom est une VALEUR, lu comme `{ phone_number: [...] }` (tour 29).
    const paire = champDecrit(o);
    if (paire && !cleNonLue(paire.nom)) {
      const contenu = o[paire.cleValeur];
      const objet = contenu !== null && typeof contenu === 'object' && !Array.isArray(contenu);
      parcourir(contenu, paire.nom, profondeur + 1, budget, out, cheminDeLaPersonne && (!objet || conteneurDeLaPersonne(paire.nom)), `${chemin}.${paire.cleValeur}`);
    }
    for (const [k, v] of Object.entries(o)) {
      if ((paire && k === paire.cleValeur) || cleNonLue(k)) continue;
      const objet = v !== null && typeof v === 'object' && !Array.isArray(v);
      parcourir(v, k, profondeur + 1, budget, out, cheminDeLaPersonne && (!objet || conteneurDeLaPersonne(k)), `${chemin}.${k}`);
    }
    return;
  }
  for (const p of detecter(String(valeur), cle, cheminDeLaPersonne, 0, budget)) {
    if (p.carte) continue;
    out.push({ ...(p.phone ? { phone: p.phone } : { email: p.email }), declare: p.declare, chemin, debut: p.debut, fin: p.fin });
  }
}

/** `{ name|key|field: 'phone_number', values|value: … }` : le nom du champ, et la clé qui porte sa valeur. */
function champDecrit(o: Record<string, unknown>): { nom: string; cleValeur: string; cleNom: string } | null {
  const cleNom = CLES_DE_NOM.find((k) => typeof o[k] === 'string');
  const cleValeur = CLES_DE_VALEUR.find((k) => o[k] !== undefined);
  if (cleNom && cleValeur) return { nom: o[cleNom] as string, cleValeur, cleNom };
  // Typeform : `{ type: 'phone_number', phone_number: '+1…' }` — le TYPE nomme la clé qui porte la valeur (juré r13).
  const type = o.type;
  if (typeof type === 'string' && type !== 'type' && o[type] !== undefined && (o[type] === null || typeof o[type] !== 'object')) {
    return { nom: type, cleValeur: type, cleNom: 'type' };
  }
  return null;
}
/** Les clés qui NOMMENT un champ décrit (HubSpot, Meta, Jotform, Google Ads) — et celles qui portent sa valeur. */
const CLES_DE_NOM = ['name', 'key', 'field', 'column_id'];
const CLES_DE_VALEUR = ['values', 'value', 'string_value'];

function lire(valeur: unknown): { tout: Trouve[]; complet: boolean } {
  const out: Trouve[] = [];
  const budget: { reste: number; tronque?: boolean } = { reste: 2_000_000 };
  parcourir(valeur, '', 0, budget, out);
  return { tout: out, complet: !budget.tronque };
}

function trouves(valeur: unknown): { liste: Trouve[]; complet: boolean } {
  const { tout, complet } = lire(valeur);
  // Dédoublonnés, et le « déclaré » l'emporte : le même numéro vu sous `phone` et dans un texte est déclaré.
  const parCle = new Map<string, Trouve>();
  for (const t of tout) {
    const k = t.phone ? `p:${t.phone}` : `e:${t.email}`;
    const deja = parCle.get(k);
    if (!deja || (t.declare && !deja.declare)) parCle.set(k, t);
  }
  return { liste: [...parCle.values()], complet };
}

/**
 * Chaque contact lu, avec son chemin (`.metadata.lead.phone`, `.fields[2]`) et sa portée dans la valeur d'origine —
 * ce que le banc « contact planté » compare à ce que le nettoyage retire (P1 ⇔ P3).
 */
export function porteesLues(valeur: unknown): { chemin: string; debut: number; fin: number; phone?: string; email?: string; declare: boolean }[] {
  return lire(valeur).tout.map((t) => ({ ...t }));
}

function sansDrapeau(t: Trouve): { phone?: string; email?: string } {
  return t.phone ? { phone: t.phone } : { email: t.email };
}

/**
 * Tous les contacts qu'on trouve dans une valeur quelconque — objet, tableau, URL, chaîne — à toute profondeur.
 *
 * L'inscription doit lire ce que le nettoyage efface : le juré a fait revenir des personnes dont le contact n'était
 * que dans les métadonnées d'une conversion, dans `postback_param_1`, dans l'URL d'atterrissage, dans un texte libre.
 * Un numéro se reconnaît comme `redactPersonal` le reconnaît — ni IPv4, ni date, ni horodatage, ni identifiant collé
 * à des lettres —, moins les identifiants de plateforme et les dates de rendez-vous.
 */
export function contactsInAnything(valeur: unknown): { phone?: string; email?: string }[] {
  return trouves(valeur).liste.map(sansDrapeau);
}

/**
 * Les deux lectures d'un coup, et si tout a été lu. Une ligne à la fois : le budget est PAR LIGNE, pour qu'une
 * visite chargée de cookies ne prive pas les conversions de lecture (juré r6).
 */
export function lireContacts(valeur: unknown): {
  tous: { phone?: string; email?: string }[];
  declares: { phone?: string; email?: string }[];
  complet: boolean;
} {
  const { liste, complet } = trouves(valeur);
  return { tous: liste.map(sansDrapeau), declares: liste.filter((t) => t.declare).map(sansDrapeau), complet };
}

/** Les seuls contacts DÉCLARÉS : sous une clé qui les nomme, ou écrits `tel:` / `mailto:`. */
export function declaredContactsIn(valeur: unknown): { phone?: string; email?: string }[] {
  return trouves(valeur).liste.filter((t) => t.declare).map(sansDrapeau);
}

/**
 * L'adresse telle que la liste de suppression la compare : sans l'étiquette « +promo ».
 *
 * `ann+promo@example.com` et `ann@example.com` arrivent dans la même boîte chez la plupart des fournisseurs : une
 * personne effacée qui revient avec une étiquette ne doit pas passer. Cette forme ne sert QU'À la comparaison —
 * l'adresse stockée, elle, reste celle que la personne a écrite.
 */
function suppressionEmail(raw: unknown): string | null {
  const email = normalizeEmail(raw);
  if (!email) return null;
  const [local, domaine] = email.split('@');
  // `+ann@x.com` n'a pas d'étiquette : tout est avant le premier « + » — rien. Sans ce repli, toutes ces adresses
  // devenaient `@x.com`, une seule empreinte pour tout un domaine.
  return `${local.split('+')[0] || local}@${domaine}`;
}

/**
 * Ce qui BORDE une adresse, retiré par catégorie et non par liste (juré r7 : « „ », « • », « 「 » passaient ; « _ »,
 * « ~ », « ' », légaux en tête d'une partie locale, étaient retirés — `_ann@corp.example` devenait la boîte de
 * quelqu'un d'autre).
 *
 * En tête : tout ce qui n'est ni une lettre, ni un chiffre, ni un caractère ASCII permis par la RFC 5322 part. Un
 * caractère permis ne part que s'il ENVELOPPE l'adresse (`*ann@x.com*`, `'ann@x.com'`, `{…}`). En queue : un domaine
 * finit par une lettre ou un chiffre, tout le reste part.
 */
const ATEXT_ASCII = /[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]/;
const FERMANTE: Record<string, string> = { '{': '}' };
function sansBordures(valeur: string): string {
  let t = valeur.replace(/\p{Cf}/gu, '').trim();
  while (t.length > 0) {
    const c = t[0];
    if (/[\p{L}\p{N}]/u.test(c)) break;
    if (ATEXT_ASCII.test(c)) {
      if (t.length > 2 && t[t.length - 1] === (FERMANTE[c] ?? c)) {
        t = t.slice(1, -1).trim();
        continue;
      }
      break;
    }
    t = t.slice(1);
  }
  return t.replace(/[^\p{L}\p{N}]+$/u, '');
}

export function normalizeEmail(raw: unknown): string | null {
  // « Ann Dupont <ann@example.com> » : la forme que copie un carnet d'adresses. Refusée entière, l'adresse partait
  // en clair dans la conversion sans jamais passer par la liste de suppression (juré r4).
  const affiche = typeof raw === 'string' ? raw.match(/^[^<>]*<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/) : null;
  // CE QUI BORDE L'ADRESSE N'EN EST PAS : une espace de largeur nulle (U+200B), des guillemets « “ », un crochet ou
  // un astérisque de mise en forme. Gardés, ils changeaient l'empreinte — et une adresse effacée revenait avec un
  // caractère invisible devant (juré r6). Même nettoyage pour l'empreinte et pour ce qui est rangé.
  const brute = affiche ? affiche[1] : raw;
  const nette = typeof brute === 'string' ? sansBordures(brute) : brute;
  const email = clip(nette, 254)?.toLowerCase() ?? null;
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/**
 * Les adresses d'un texte, chacune sous UNE forme fidèle : celle qu'un lecteur humain y lit (tour 28).
 *
 * L'ENVELOPPE SE LIT DANS LE TEXTE : la correspondance s'arrête au domaine et laisse dehors le « ** » fermant de
 * « **ann@x.com** » (juré r8). On lui rend ce qui la ferme, s'il répond à ce qui l'ouvre — la plus longue ouverture
 * qui se referme : « **_ann@x.com** » est `_ann@…` (le `_` est légal en tête), pas `**_ann@…` (tour 29).
 * Un `&` de tête sépare des paramètres. Une phrase qui reprend SANS espace n'est pas un domaine : « ann@gmail.com.Thanks »
 * — une étiquette Capitalisée après un domaine en minuscules — est coupée (juré r10).
 */
function adressesDans(phrase: string): { debut: number; fin: number; email: string }[] {
  const out: { debut: number; fin: number; email: string }[] = [];
  for (const m of phrase.matchAll(EMAIL_PARTOUT)) {
    const coupee = m[0].match(/^(.+@.+\.[a-z]{2,24})\.[A-Z][a-z]+$/)?.[1] ?? m[0];
    const fin = (m.index ?? 0) + coupee.length;
    // Un `&` précédé de chiffres seuls (« zip=33610&ann@… ») sépare des paramètres ; précédé d'un mot, il fait partie
    // de l'adresse (`ann&co@…`, juré r5). Tranché pour P2 (docs §9).
    const trouvee = coupee.replace(/^[\d&.-]*&/, '');
    const tete = [...(trouvee.match(/^[^\p{L}\p{N}]+/u)?.[0] ?? '')];
    let enveloppe = trouvee;
    for (let k = tete.length; k > 0; k -= 1) {
      const miroir = tete.slice(0, k).reverse().map((c) => FERMANTE[c] ?? c).join('');
      if (phrase.slice(fin, fin + miroir.length) === miroir) {
        enveloppe = trouvee + miroir;
        break;
      }
    }
    const propre = normalizeEmail(enveloppe);
    // La portée à caviarder : la correspondance (sans ce qui a été coupé, « .Thanks »).
    if (propre) out.push({ debut: m.index ?? 0, fin, email: propre });
  }
  return out;
}

/** Whether this metadata carries a person, at any depth — the shallow check missed `{ lead: { phone } }`. */
export function carriesContact(metadata: unknown): boolean {
  return withoutContact(metadata) !== null;
}

/** A row is a lead once someone can be reached or named. A funnel step alone never creates one. */
export function hasContact(data: Pick<LeadData, 'phone' | 'email' | 'firstName' | 'lastName'>): boolean {
  return Boolean(data.phone || data.email || data.firstName || data.lastName);
}

/**
 * Reads what the landing page sent with a conversion: contact fields, quiz answers, the consent text shown next to
 * the submit button (hashed so leads can be grouped by the wording they saw), and the request's IP and User-Agent.
 * The text is declared by an unauthenticated page: it is evidence of what was displayed, not proof of consent.
 */
export function leadFromConversion(
  metadata: Record<string, unknown> | undefined | null,
  context?: ConversionContext,
  now: Date = new Date(),
): LeadData {
  const meta = metadata ?? {};
  const answers: Record<string, string> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (!/^q\d{1,2}$/.test(key) && !NAMED_ANSWERS.has(key)) continue;
    const answer = clip(value, 200);
    if (answer) answers[key] = answer;
  }
  const phone = normalizePhone(meta.phone);
  const firstName = clip(meta.firstName ?? meta.first_name ?? meta.name, 100);
  const email = normalizeEmail(meta.email);
  const consentText = verbatim(meta.consent ?? meta.consentText, 2000);
  const declaredSource = clip(meta.source, 40);
  return {
    source: declaredSource ?? (phone || email || firstName ? 'form' : 'quiz'),
    firstName,
    lastName: clip(meta.lastName ?? meta.last_name, 100),
    email,
    phone,
    zip: clip(meta.zip ?? meta.zipCode ?? meta.postal_code, 10),
    state: clip(meta.state, 40),
    answers: Object.keys(answers).length ? answers : null,
    consentText,
    consentHash: consentText ? createHash('sha256').update(consentText.replace(/\s+/g, ' ').trim()).digest('hex') : null,
    consentAt: consentText ? now : null,
    ip: clip(context?.incomingPostbackIp, 64),
    userAgent: clip(context?.userAgent, 400),
    pageUrl: clip(meta.pageUrl ?? meta.page_url, 2000),
  };
}

/**
 * Fills a lead with what a later event brought. What was recorded first wins: a visitor who corrects a field in a
 * second submit is rare, a page that re-sends an empty field is not. Answers from both are kept.
 */
export function mergeLeadData(current: LeadData | null, incoming: LeadData): LeadData {
  if (!current) return incoming;
  const pick = <K extends keyof LeadData>(key: K): LeadData[K] =>
    (current[key] ?? null) === null ? incoming[key] : current[key];
  const answers =
    current.answers || incoming.answers ? { ...(incoming.answers ?? {}), ...(current.answers ?? {}) } : null;
  // Le consentement qui compte est celui affiché avec le contact : c'est lui qui autorise l'appel, pas celui d'une
  // étape précédente du tunnel.
  const incomingConsentWins = Boolean(incoming.consentText) && hasContact(incoming);
  const consentText = incomingConsentWins ? incoming.consentText : (current.consentText ?? incoming.consentText);
  return {
    // A contact only ever arrives with the form or the callback: that source names the lead better than a quiz step.
    source: hasContact(current) ? current.source : hasContact(incoming) ? incoming.source : current.source,
    firstName: pick('firstName'),
    lastName: pick('lastName'),
    email: pick('email'),
    phone: pick('phone'),
    zip: pick('zip'),
    state: pick('state'),
    answers,
    consentText,
    consentHash: incomingConsentWins || !current.consentText ? incoming.consentHash : current.consentHash,
    consentAt: incomingConsentWins || !current.consentText ? incoming.consentAt : current.consentAt,
    ip: pick('ip'),
    userAgent: pick('userAgent'),
    pageUrl: pick('pageUrl'),
  };
}

/** Keys that identify a person, as landing pages send them. Used when erasure or retention has to reach the raw
 * conversion metadata too — clearing the lead row alone would leave the contact readable next door. `pageUrl` is in
 * the list because a page URL routinely carries the name and phone in its query string. */
export const PII_METADATA_KEYS = [
  'name',
  'fullName',
  'full_name',
  'firstName',
  'first_name',
  'firstname',
  'lastName',
  'last_name',
  'lastname',
  // Les mêmes champs tels que les envoient vraiment les LP et les acheteurs. Testé : `{fname, lname, prenom, nom,
  // surname}` ressortait INTACT d'un effacement accepté — un prénom seul n'a pas de forme reconnaissable, donc la
  // relecture par valeur ne peut rien pour lui : il n'y a que la clé pour le dire.
  'fname',
  'lname',
  'first',
  'last',
  'prenom',
  'prénom',
  'nom',
  'surname',
  'givenname',
  'given_name',
  'familyname',
  'family_name',
  // Les CONTACTS (téléphone, adresse) ne sont plus ici (tour 31) : c'est la liste blanche de la liste de suppression
  // (`champDeLaPersonne`) qui dit quelle clé en porte un — une seule classification, pour inscrire et pour retirer.
  // Cette liste-ci ne garde que ce qui est personnel SANS être un contact.
  'pageUrl',
  'page_url',
  // Le texte de consentement est du verbatim : le gabarit TCPA de l'assurance auto US contient littéralement le
  // nom saisi et le numéro appelé (« I, Ann Dupont, agree … may call me at 813-555-0142 »). La ligne du lead le
  // vide déjà ; la copie dans les métadonnées de la conversion restait lisible pour toujours.
  'consent',
  'consentText',
  'consent_text',
  'consenttext',
  'notes',
  'note',
  'comments',
  // Champs d'un devis auto que la LP n'envoie pas encore, mais qu'un acheteur ou une variante enverra un jour.
  'address',
  'address1',
  'address2',
  'street',
  'city',
  'dob',
  'birthdate',
  'date_of_birth',
  'ssn',
  'license',
  'licenseNumber',
  'driverLicense',
  'driver_license',
  'vin',
  // Identifiants publicitaires persistants : ils désignent une personne aussi sûrement qu'un numéro.
  'fbp',
  'fbc',
  // L'adresse IP et le user-agent : la visite les efface déjà dans ses propres colonnes (`scrubClicks`), mais la
  // copie recopiée dans les métadonnées d'une conversion survivait. La garde qui protège les adresses IPv4 des
  // horodatages travaille contre nous ici — encore une fois, seule la clé peut le dire.
  'ip',
  'ip_address',
  'ipaddress',
  'ua',
  'user_agent',
  'useragent',
] as const;

/** Paramètres d'URL qui portent une personne : une URL de postback entrante en est pleine. */
export const PII_QUERY_KEYS = [...PII_METADATA_KEYS, 'zip', 'zipcode', 'postal_code', 'state'];

const CONTACT_KEYS = new Set<string>(PII_METADATA_KEYS.map((k) => k.toLowerCase()));

/** Ce qui ne désigne personne seul, mais qui ré-identifie une fois croisé : retiré sur demande d'effacement. */
const CONTEXT_KEYS = new Set(['zip', 'zipcode', 'postal_code', 'postalcode', 'state']);

/**
 * Whether a value IS a person, whatever the key is called. Buyers and landers name their fields as they please —
 * `sub1`, `contact`, `u1` — so the name of the key is never enough: an address or a telephone number is recognised
 * by its shape. Nothing else qualifies: a click id, a transaction id or an amount stays readable, because a scrub
 * that hides the debugging data too is a scrub nobody keeps.
 */
/**
 * La même valeur, la personne en moins.
 *
 * Une seule règle, quelle que soit la longueur : on cherche une adresse ou un numéro À L'INTÉRIEUR de la valeur et
 * on remplace ce morceau par `***`. La version précédente ne fouillait que les textes de plus de quarante
 * caractères, si bien que « Ann Dupont 813-555-0142 » — vingt-trois caractères — traversait l'écriture, la rétention
 * et l'effacement.
 *
 * Caviarder plutôt que jeter, parce que le reste porte du sens : « Lead rejected, duplicate within 30 days, call
 * *** » reste une raison de rejet exploitable, alors que la jeter laissait l'acheteur sans explication.
 *
 * Ce qui reste volontairement lisible : les suites de treize chiffres et plus (horodatages en millisecondes,
 * références de commande, identifiants de pub Meta) et les montants décimaux. Un nettoyage qui les mange rend la
 * réconciliation des paiements impossible, et l'original n'existe nulle part ailleurs.
 */
/** Test de Luhn : ce qui le passe sur treize à dix-neuf chiffres est un numéro de carte, pas une référence. */
function looksLikeCard(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Est-ce un numéro de téléphone ? La question se pose sur la FORME, pas seulement sur le nombre de chiffres.
 *
 * Une version précédente ne comptait que les chiffres — « toute suite ponctuée de neuf à quinze » — et le cron de
 * rétention s'est mis à détruire, toutes les nuits et sans original ailleurs, des UUID (`…-a716-446655440000`),
 * des références de commande (`ORD-2026-0001234`), des codes postaux ZIP+4 (`33601-1234`), des adresses IP et des
 * plages de dates. Un nettoyage qui mange les identifiants d'un système est pire que pas de nettoyage : il est
 * irréversible et il casse la réconciliation.
 *
 * L'ordre ci-dessous est celui du jugement, et chaque étape a coûté quelque chose à quelqu'un :
 *
 *  1. collé à des lettres → identifiant, pas numéro ;
 *  2. date ISO, ZIP+4, IPv4 → les trois formes qui ressemblent le plus à un numéro sans en être un ;
 *  3. un groupe de plus de cinq chiffres dans une suite ponctuée → personne n'écrit un numéro ainsi ;
 *  4. suite nue : neuf à onze chiffres, sauf un horodatage Unix plausible (dix chiffres, 2001 à 2033) ;
 *  5. suite ponctuée ou internationale : neuf à quinze chiffres, la fourchette des numéros du monde ;
 *  6. et le test de Luhn tranche les cartes, quelle que soit la forme.
 *
 * `prev` et `next` sont les caractères qui bordent la suite dans le texte d'origine : c'est ce qui distingue
 * « 716-446655440000 » au milieu d'un UUID d'un vrai numéro isolé.
 */
function isPersonalRun(run: string, prev = '', next = ''): boolean {
  // Le point ou le tiret qui FINIT une fenêtre (« 33610-1234. ») ponctue la phrase, pas la suite.
  const text = run.trim().replace(/[.-]+$/, '');
  // Un « + » EST une frontière : « call+800-555-1212 » dans une query string (où `+` code une espace) est un numéro,
  // même collé à un mot. Pas « 00 » : collé à une lettre, c'est un morceau d'identifiant — « b0015219-3390-4… » dans
  // un UUID se lisait comme un numéro composé depuis l'étranger (tour 29). Ailleurs, une lettre accolée — directement
  // ou à travers un tiret ou un souligné, qui collent un jeton — dit qu'on est dans un identifiant : `ORD-2026-0001234`.
  // Sauf un POSTE : « 925.760.5334ext.21 », « …9393x7 » sont un numéro suivi de son extension.
  const glued = (side: string) => /[a-z]/i.test(side.replace(/^[-_]+/, '').charAt(0) || '');
  const poste = /^(?:x\.?\s*\d|ext)/i.test(next);
  if (!/^\(?\+/.test(text) && (glued(prev.split('').reverse().join('')) || (glued(next) && !poste))) return false;
  // Entre parenthèses aussi, le préfixe reste un préfixe : « (0017124635437) » est un numéro (tour 29).
  const international = /^\(?(\+|00)/.test(text);
  // Un indicatif ÉCRIT (« + », ou « 00 » suivi d'un indicatif connu, en bloc à lui) dont la longueur est celle du
  // pays : les formes d'une date ISO ou d'un ZIP+4 n'y sont pas une date ni un code postal (« 0052-55-2566-1648 »,
  // « 0055 11 91234-5678 », juré r13). « $9,004.61 » ne l'est pas : « 004 » n'écrit aucun indicatif.
  const exempte = indicatifEcrit(text) && longueurPlausible(text);
  // Un MONTANT n'est pas un numéro : « 1234567.89 », « 1,234,567.89 » — lu, il s'inscrivait sans que le nettoyage le
  // retire (juré r13, M9 : la garde n'était que dans le nettoyage). Une VERSION non plus : « 126.0.6478.127 », la
  // version de Chrome de presque chaque visite, devenait 2606478127.
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$|^\d+\.\d{2}$/.test(text)) return false;
  // …mais « 06.12.34.56.78 » EST un numéro : le préfixe de ligne (un 0 suivi d'un chiffre) n'ouvre pas une version.
  if (/^\d+(\.\d+){3,}$/.test(text) && !estNanp(text) && !/^0\d/.test(text)) return false;
  if (!exempte && /^\d{4}-\d{2}-\d{2}/.test(text)) return false; // date ISO, ou plage de dates
  if (/^\d{5}-\d{4}$/.test(text)) return false; // code postal ZIP+4 : la rétention doit le GARDER
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(text)) return false; // adresse IPv4
  // Deux choses JUXTAPOSÉES ne font pas un numéro : un code ZIP+4, une IPv4, une date ISO ou un montant, suivi d'une
  // espace et d'autres chiffres (« 79423-0125 02/13 », « 2024. 29.1.222.174 », « $887.99 2015 Honda ») — la suite
  // entière inscrivait l'identité d'un inconnu (tour 29, P2). Les fenêtres, elles, restent lues une à une.
  // …mais pas après un indicatif « + » quand la longueur est celle du pays : « +55 11 91234-5678 » est LA forme d'un
  // portable brésilien, pas un ZIP+4 (juré r12). Pas après « 00 » : « $9,004.61 75581-7905 » — un prix puis un ZIP+4 —
  // commençait ainsi (banc tour 31, graine 89).
  if (/\s/.test(text) && !exempte) {
    const jetons = text.split(/\s+/).map((j) => j.replace(/^[($]+|[).,;:]+$/g, ''));
    if (jetons.some((j) => /^\d{5}-\d{4}$|^(\d{1,3}\.){3}\d{1,3}$|^\d{4}-\d{2}-\d{2}|^\d+\.\d{2}$/.test(j))) return false;
  }
  const groups = text.split(/[^\d]+/).filter(Boolean);
  const digits = groups.join('');
  if (looksLikeCard(digits)) return true;
  // Écrit avec des ESPACES et sans indicatif, un numéro a la forme nord-américaine (3-3-4) ou commence par le préfixe
  // de ligne des numéros nationaux du reste du monde (« 06 12 34 56 78 », « 07911 123456 », « 030 1234567 »). Des
  // nombres juxtaposés qui n'ont ni l'une ni l'autre — « 2024 24082 », « 7 2024 2016 », « 2026 86141 » : une année,
  // un code postal, un poste — ne sont pas une personne (tour 29, P2).
  if (/\s/.test(text) && !international && !estNanp(text) && !/^\(?0/.test(text)) return false;
  const body = international ? digits.replace(/^00/, '') : digits;
  if (groups.length === 1 && !international) {
    if (body.length < 9 || body.length > 11) return false;
    // Un horodatage Unix en secondes : dix chiffres, entre 2001 et 2033. La version précédente excluait TOUT ce
    // qui commence par 0 ou 1 — donc le mobile français `0612345678` traversait l'effacement et la rétention.
    if (body.length === 10 && Number(body) >= 1_000_000_000 && Number(body) <= 2_000_000_000) return false;
    return true;
  }
  // Un groupe de plus de SEPT chiffres trahit une référence : le monde écrit « 813-5550142 » (3+7) et
  // « +44 7911 123456 » (2+4+6), jamais un numéro avec un bloc de huit. Un UUID, lui, porte des blocs de douze.
  // …mais seulement quand il Y A des groupes : un numéro international écrit d'un bloc (« +8613800138000 »,
  // « 0018135550142 ») n'en a qu'un, et le juger sur sa longueur de groupe le rejetait alors qu'il est justement
  // la forme la plus fréquente d'un numéro composé depuis l'étranger.
  // …sauf derrière un indicatif, quand la longueur est celle du pays : « +49 151 23456789 », « +49 30 12345678 » (le
  // portable et le fixe allemands), « +52 8135550142 » (un numéro mexicain écrit d'un bloc — relu SEUL, il désignait
  // un abonné de Tampa, juré r12).
  if (groups.length > 1 && groups.some((g) => g.length > 7) && !(international && longueurPlausible(text))) return false;
  return body.length >= 9 && body.length <= 15;
}

/**
 * Les suites de chiffres qui SONT une personne dans ce texte, avec leurs bornes.
 *
 * Une suite se prend d'abord entière — « (813) 555-0142 », « +44 7911 123456 ». Mais deux numéros séparés d'une
 * espace forment une seule suite de dix-sept chiffres, rejetée : le juré r5 a fait traverser l'effacement à
 * « Ann 813-555-0142 407-555-0199 », et « 813-555-0142 33610 » s'inscrivait comme un numéro de quinze chiffres. Une
 * suite trop longue pour un numéro national est donc redécoupée à ses espaces, la plus longue fenêtre d'abord.
 *
 * Et une suite qui CONTIENT un numéro nord-américain complet, collé par une espace à un chiffre voisin — « Unit 3
 * (813) 555-0142 », « after 5 813-555-0142 », « 813-555-0142 2 vehicles » —, c'est ce numéro, écrit tel quel : prise
 * entière, elle inscrivait 38135550142 ou 81355501422, le numéro de personne, et pas celui d'Ann (juré r10).
 */
function suitesPersonnelles(texte: string): { debut: number; fin: number }[] {
  const out: { debut: number; fin: number }[] = [];
  const bords = (d: number, f: number) => [texte.slice(Math.max(0, d - 4), d), texte.slice(f, f + 4)] as const;
  const international = (s: string) => /^\(?(\+|00)/.test(s.trim());
  const chiffres = (s: string) => s.replace(/\D/g, '').length;
  // Des fenêtres de jetons consécutifs, six au plus, la plus longue d'abord : un numéro ne s'écrit jamais en plus de
  // six blocs, et la borne garde le découpage linéaire sur un texte hostile.
  const fenetres = (jetons: { d: number; f: number }[], ok: (sous: string, d: number, f: number) => boolean) => {
    const prises: { debut: number; fin: number }[] = [];
    // Chaque critère exige 9 à 15 chiffres : une fenêtre hors de cette fourchette est écartée sans regex. « (1) (1) … »
    // sur 100 ko passait 2,4 s dans la suite chargée à essayer des fenêtres de six chiffres (juré r11, banc de coût).
    const cumul = [0];
    for (const j of jetons) cumul.push(cumul[cumul.length - 1] + chiffres(texte.slice(j.d, j.f)));
    for (let i = 0; i < jetons.length; ) {
      let avance = 1;
      for (let j = Math.min(jetons.length - 1, i + 5); j >= i; j -= 1) {
        const n = cumul[j + 1] - cumul[i];
        if (n < 9 || n > 15) continue;
        if (ok(texte.slice(jetons[i].d, jetons[j].f), jetons[i].d, jetons[j].f)) {
          prises.push({ debut: jetons[i].d, fin: jetons[j].f });
          avance = j - i + 1;
          break;
        }
      }
      i += avance;
    }
    return prises;
  };
  // Une ZONE du texte : le texte entier d'abord, puis ce qui suit un numéro étranger qu'on a détaché de ses voisins —
  // relu comme un texte neuf, puisqu'il peut commencer un autre numéro (« +447997762379) 0044 7997 762379 - 15 »).
  const zone = (a: number, b: number) => {
  // `/` et `_` séparent aussi des chiffres (« 813/555-0142 », « 813_555_0142 », juré r12) ; les espaces et tirets
  // Unicode sont déjà ramenés à « » et « - » par la vue.
  for (const m of texte.slice(a, b).matchAll(/(?:\+|00)?\(?\d[\d ()./_-]*\d\)?/g)) {
    const run = m[0];
    const debut = a + (m.index ?? 0);
    const fin = debut + run.length;
    // Un numéro de SUIVI écrit par blocs de quatre (USPS « 9400 1051 1976 0459 9168 86 ») n'est pas un numéro de
    // téléphone, ni aucune de ses fenêtres : elles s'y lisaient, et le nettoyage en détruisait un morceau (juré r13).
    // Une carte bancaire a la même forme : celle-là, le test de Luhn la désigne et elle est retirée, pas lue.
    if (/^\d{4}(?: \d{4}){3,}(?: \d{1,4})?$/.test(run.trim()) && !looksLikeCard(run.replace(/\D/g, ''))) continue;
    const entier = isPersonalRun(run, ...bords(debut, fin));
    // Pas de raccourci « la suite entière est un numéro » : la fenêtre la plus longue, essayée d'abord, EST la suite
    // entière (le banc de mutation l'a montré — la retirer ne changeait rien).
    const aEspaces = /\s/.test(run.trim());
    const jetons = aEspaces
      ? [...run.matchAll(/\S+/g)].map((j) => ({ d: debut + (j.index ?? 0), f: debut + (j.index ?? 0) + j[0].length }))
      : [];
    const etranger = international(run) && !/^\(?(?:\+|00)1/.test(run.trim());
    // Un numéro étranger (« +33 612 345 6789 ») ne se redécoupe pas en numéro nord-américain.
    if (aEspaces && !etranger) {
      const nanp = fenetres(jetons, (sous, d, f) => estNanp(sous) && isPersonalRun(sous, ...bords(d, f)));
      if (nanp.length) {
        // Ce qui reste AUTOUR des numéros pris est relu, dans l'ordre (le nettoyage suit les positions) : dans
        // « utm_id=0736501234 0044 7756 558145 », l'identifiant a la forme d'un numéro nord-américain, et le numéro
        // anglais qui le suivait n'était jamais retiré (banc tour 30, graine 56). Borné comme plus bas.
        let curseur = debut;
        for (const w of nanp) {
          if (jetons.length <= 12 && w.debut > curseur) zone(curseur, w.debut);
          out.push(w);
          curseur = w.fin;
        }
        if (jetons.length <= 12 && fin > curseur) zone(curseur, fin);
        continue;
      }
    }
    // Un numéro ÉTRANGER suivi d'autres chiffres (« +44 7911 123456 123 Main St », « +52 1 55 1234 5678 10:30am ») :
    // pris entier, il avalait ses voisins — un numéro de personne inscrit, et le vrai jamais (juré r11). On prend la
    // plus longue fenêtre DEPUIS l'indicatif dont le nombre de chiffres nationaux est plausible pour ce pays, sans
    // franchir un blanc double ni un tiret isolé ; le reste est relu comme n'importe quel texte.
    // BORNÉ à douze blocs : un numéro et ses voisins en tiennent quelques-uns ; « 00 00 00 … » sur 100 ko relançait la
    // relecture à chaque bloc — pile épuisée, 75 s (juré r11, banc de coût).
    // Et un numéro « 00 » précédé d'un chiffre voisin (« after 5 0044 7911 123456 2 ») : la suite ne commence pas par
    // l'indicatif, on la coupe devant lui pour que la même règle s'applique (tour 30).
    const k00 = aEspaces && !international(run) && jetons.length <= 12
      ? jetons.findIndex((j, i) => i > 0 && /^00[1-9]\d/.test(texte.slice(j.d, j.f)))
      : -1;
    if (k00 > 0) {
      zone(debut, jetons[k00].d);
      zone(jetons[k00].d, fin);
      continue;
    }
    if (aEspaces && etranger && jetons.length <= 12) {
      let fin0 = jetons.length;
      for (let k = 1; k < jetons.length; k += 1) {
        if (texte.slice(jetons[k - 1].f, jetons[k].d).length > 1 || /^[-.]+$/.test(texte.slice(jetons[k].d, jetons[k].f))) {
          fin0 = k;
          break;
        }
      }
      const plausible = (j: number) =>
        /\d/.test(texte.slice(jetons[j].d, jetons[j].f)) &&
        longueurPlausible(texte.slice(jetons[0].d, jetons[j].f)) &&
        isPersonalRun(texte.slice(jetons[0].d, jetons[j].f), ...bords(jetons[0].d, jetons[j].f));
      let prise = -1;
      for (let j = Math.min(fin0 - 1, 6); j >= 0 && prise < 0; j -= 1) if (plausible(j)) prise = j;
      // Un DERNIER bloc d'un ou deux chiffres, quand le numéro sans lui est déjà complet, est un voisin (« 9-5 »,
      // « 2 vehicles ») : l'Allemagne ou le Mexique admettent des longueurs assez larges pour l'avaler.
      if (prise > 0 && chiffres(texte.slice(jetons[prise].d, jetons[prise].f)) <= 2 && plausible(prise - 1)) prise -= 1;
      if (prise >= 0) {
        out.push({ debut: jetons[0].d, fin: jetons[prise].f });
        zone(jetons[prise].f, fin);
        continue;
      }
    }
    if (entier && (international(run) || chiffres(run) <= 11 || !aEspaces)) {
      out.push({ debut, fin });
      continue;
    }
    // JAMAIS de fenêtre ouverte APRÈS un indicatif étranger (juré r12) : « +52 8135550142 », relu à partir du bloc,
    // inscrivait 8135550142 — un autre numéro, DÉCLARÉ sous `phone`, qui refusait un innocent de Tampa.
    if (!aEspaces || etranger) continue;
    const prises = fenetres(jetons, (sous, d, f) => {
      const n = chiffres(sous);
      return n >= 9 && (n <= 11 || international(sous)) && isPersonalRun(sous, ...bords(d, f));
    });
    if (prises.length) out.push(...prises);
    else if (entier) out.push({ debut, fin });
  }
  };
  zone(0, texte.length);
  return out;
}

/**
 * Combien de chiffres NATIONAUX (sans l'indicatif) un numéro a dans les pays qui nous écrivent le plus (plan E.164
 * de chaque pays, préfixe national exclu). Ailleurs : les bornes générales d'un numéro. Sert à arrêter un numéro étranger là où il
 * finit, au lieu d'avaler les chiffres qui le suivent (juré r11).
 */
const CHIFFRES_NATIONAUX: Record<string, [number, number]> = {
  '7': [10, 10], '20': [8, 10], '27': [9, 9], '30': [10, 10], '31': [9, 9], '32': [8, 9], '33': [9, 9], '34': [9, 9],
  '36': [8, 9], '39': [6, 11], '40': [9, 9], '41': [9, 9], '43': [7, 13], '44': [9, 10], '45': [8, 8], '46': [7, 10],
  '47': [8, 8], '48': [9, 9], '49': [6, 11], '51': [8, 9], '52': [10, 11], '54': [10, 11], '55': [10, 11], '56': [9, 9],
  '57': [10, 10], '58': [10, 10], '60': [8, 10], '61': [9, 9], '62': [8, 12], '63': [8, 10], '64': [8, 10], '65': [8, 8],
  '66': [8, 9], '81': [9, 10], '82': [8, 10], '84': [9, 10], '86': [9, 11], '90': [10, 10], '91': [10, 10], '92': [9, 10],
  '94': [9, 9], '234': [8, 10], '254': [9, 9], '351': [9, 9], '353': [7, 9], '358': [6, 12], '380': [9, 9],
  '420': [9, 9], '852': [8, 8], '880': [10, 10], '971': [8, 9], '972': [8, 9],
};
/** « +… », ou « 00 » suivi d'un indicatif de la table écrit en bloc à lui (« 0052-55… », « 0055 11… », « 00 44 … »). */
function indicatifEcrit(texte: string): boolean {
  if (/^\(?\+/.test(texte)) return true;
  const m = /^\(?00[\s.-]?(\d{1,3})(?=[\s.\-/)]|$)/.exec(texte);
  return !!m && (m[1] in CHIFFRES_NATIONAUX || m[1] === '1');
}

function longueurPlausible(suite: string): boolean {
  const tout = normalizePhone(suite);
  if (!tout) return false;
  const indicatif = [3, 2, 1].map((n) => tout.slice(0, n)).find((c) => c in CHIFFRES_NATIONAUX);
  // Indicatif hors table : les bornes de `normalizePhone` (7 à 15) et d'`isPersonalRun` (9 au moins) suffisent.
  if (!indicatif) return true;
  const [min, max] = CHIFFRES_NATIONAUX[indicatif];
  return tout.length - indicatif.length >= min && tout.length - indicatif.length <= max;
}

/** Un numéro nord-américain complet, écrit comme on l'écrit : `(813) 555-0142`, `+1 813…`, `1-813-…`, `001 813…`. */
// Deux formes. La première, compacte : espace, `.` ou `-` entre les blocs, ou rien. La seconde porte les séparateurs du
// juré r12 — `/`, `_`, un tiret entouré d'espaces (« 813 - 555 - 0142 ») — et exige alors que le PREMIER bloc soit
// séparé : « 354156 - 2024 » (un numéro étranger coupé, puis une année) n'a pas la forme d'un numéro nord-américain
// (banc tour 31, graine 83).
const FORME_NANP = /^(?:(?:\+|00)1[\s.-]?|1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}$/;
const FORME_NANP_TIRETS = /^(?:(?:\+|00)1(?:\s?[-./_]\s?|\s)|1(?:\s?[-./_]\s?|\s))?(?:\(\d{3}\)|\d{3})(?:\s?[-./_]\s?|\s)\d{3}(?:\s?[-./_]\s?|\s)?\d{4}$/;
function estNanp(suite: string): boolean {
  // Le point ou le tiret qui suit (« +1-866-795-0183. 2017 », « 001 426 989 8168... 4 ») ponctue la phrase : sans
  // ce retrait, la fenêtre du numéro n'avait pas la forme, et la suite entière s'inscrivait (tour 29).
  let t = suite.trim().replace(/[.-]+$/, '');
  const n = (c: string) => t.split(c).length - 1;
  // Une parenthèse orpheline appartient au texte autour (« (Unit 3 813-555-0142) »), pas au numéro.
  while (t.startsWith('(') && n('(') > n(')')) t = t.slice(1);
  while (t.endsWith(')') && n(')') > n('(')) t = t.slice(0, -1);
  const forme = (s: string) => FORME_NANP.test(s) || FORME_NANP_TIRETS.test(s);
  if (forme(t)) return true;
  return t.startsWith('(') && t.endsWith(')') && forme(t.slice(1, -1));
}

/**
 * LE NETTOYAGE (tour 31) : la valeur d'origine, où chaque portée que le détecteur lit — sous la même clé — est
 * remplacée par `***`. Pas de décodage, pas de réécriture : ce qui n'est pas la personne reste octet pour octet (une
 * URL garde son encodage, donc aucun appelant ne peut y fabriquer de paramètre en encodant un `&`).
 */
function caviarder(brut: string, cle = ''): string {
  // AUCUNE garde ici (juré r13) : « ce n'est pas un numéro » — montant, date, ZIP+4, version, suivi de colis — se
  // décide dans le détecteur, et seulement là. Une garde propre au nettoyage laissait inscrit ce qu'il gardait.
  return remplacerPortees(brut, detecter(brut, cle, true, 0, { reste: Number.POSITIVE_INFINITY }));
}

function remplacerPortees(brut: string, portees: { debut: number; fin: number }[]): string {
  const triees = portees.filter((p) => p.fin > p.debut).sort((x, y) => x.debut - y.debut);
  let out = '';
  let curseur = 0;
  for (const p of triees) {
    if (p.fin <= curseur) continue;
    out += `${brut.slice(curseur, Math.max(curseur, p.debut))}***`;
    curseur = p.fin;
  }
  return out + brut.slice(curseur);
}

/** La valeur, la personne en moins — lue comme un texte libre (sans clé). */
export function redactPersonal(value: string): string {
  return caviarder(value);
}

/** Ce qui reste d'une valeur caviardée, ou `null` si elle ne portait QUE la personne. */
function resteDe(masked: string): string | null {
  // La ponctuation qui bordait le numéro ne compte pas comme du sens : « (813) 555-0142 » devient « (*** », et
  // garder la clé pour cette parenthèse orpheline laisserait un champ vide qui ne dit plus rien.
  return masked.replace(/\*+/g, '').replace(/[\s().,;:+-]/g, '') === '' ? null : masked;
}

/**
 * Ce qu'il reste d'une valeur dont la personne a été retirée, ou `null` si elle ne contenait QUE la personne.
 *
 * `sub1=ann@example.com` : la valeur est la personne, la clé part. « I agree to be called at 813-555-0142 » : la
 * phrase dit autre chose que la personne — la preuve que l'appel était autorisé —, on retire la personne et on garde
 * le reste.
 */
export function withoutPerson(text: string): string | null {
  return resteDe(caviarder(text));
}

/**
 * Une valeur de COLONNE sous le nom de sa colonne (registre `lead-columns.ts`), la personne en moins : elle-même si le
 * détecteur n'y lit rien, `null` si elle n'était QUE la personne, sinon ce qui reste.
 */
export function valeurNettoyee(brut: string, cle: string): string | null {
  const masked = caviarder(brut, cle);
  return masked === brut ? brut : resteDe(masked);
}

/** Whether a value carries a person — that is, whether the detector reads anything in it. */
export function looksPersonal(value: unknown): boolean {
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  const text = String(value);
  return text.trim() !== '' && caviarder(text) !== text;
}

/**
 * La clé dit que la valeur EST une personne, et elle part entière : un champ de contact de la personne — la MÊME
 * classification que la liste de suppression (`champDeLaPersonne`), pas une deuxième liste qui dérivait (juré r12 :
 * `whatsapp`, `cell_phone`, `home_phone` étaient déclarés, donc inscrits, et le nettoyage ne les connaissait pas) —
 * ou une donnée personnelle qui n'est pas un contact (`PII_METADATA_KEYS` : nom, adresse postale, IP, consentement…).
 */
function clePersonnelle(cle: string): boolean {
  return champDeLaPersonne(cle) !== null || CONTACT_KEYS.has(cle.toLowerCase());
}

/**
 * The same metadata without the person, at any depth: the keys that name one, and every contact the detector reads
 * in a value (the SAME portées the suppression list records). Null when there was nothing to remove.
 */
export function withoutContact(
  metadata: unknown,
  reason: 'erased' | 'purged' = 'purged',
): Record<string, unknown> | unknown[] | null {
  // Un tableau au premier niveau est rare mais légal en JSON, et c'est un angle mort de plus s'il sort ici.
  if (!metadata || typeof metadata !== 'object') return null;
  // Une demande d'effacement emporte aussi ce qui ré-identifie une fois croisé : code postal, État et réponses du
  // quiz, comme dans la ligne du lead. La rétention, elle, les garde.
  const dropsContext = reason === 'erased';
  let removed = false;
  /** Une valeur scalaire sous `cle` : `undefined` si elle part entière, sinon ce qu'il en reste. */
  const feuille = (inner: unknown, cle: string): unknown => {
    if (typeof inner !== 'string' && typeof inner !== 'number') return inner;
    const texte = String(inner);
    const masked = caviarder(texte, cle);
    if (masked === texte) return inner;
    removed = true;
    if (typeof inner === 'number') return undefined;
    return resteDe(masked) ?? undefined;
  };
  const strip = (value: unknown, cle: string): unknown => {
    // Un lander qui sérialise son formulaire envoie « fields: ['Ann', 'ann@x.co', '8135550142'] » : chaque élément
    // est jugé comme une valeur — sous la clé du tableau, comme la liste le lit.
    if (Array.isArray(value)) {
      const kept: unknown[] = [];
      for (const item of value) {
        const r = item !== null && typeof item === 'object' ? strip(item, cle) : feuille(item, cle);
        if (r !== undefined) kept.push(r);
      }
      return kept;
    }
    if (!value || typeof value !== 'object') return feuille(value, cle);
    const o = value as Record<string, unknown>;
    // `{ name: 'phone_number', values: [...] }` : la valeur se juge sous le NOM du champ, comme la liste la lit.
    const paire = champDecrit(o);
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(o)) {
      // L'ÉTIQUETTE d'un champ décrit (`name`, `key`, `field`, `column_id`, `type`) n'est pas une personne : c'est
      // elle qui dit à la liste sous quel nom lire la valeur. La retirer comme un « nom » de personne (`name` est
      // dans `PII_METADATA_KEYS`) détruisait chaque libellé à la rétention — puis l'effacement relisait la valeur
      // sans son nom : un `ttclid` devenait un numéro, inscrit (juré r13). Elle reste, jugée comme la liste la lit.
      if (paire && key === paire.cleNom) {
        const r = feuille(inner, key);
        if (r !== undefined) out[key] = r;
        continue;
      }
      const cleLue = paire && key === paire.cleValeur ? paire.nom : key;
      if (reason === 'purged' && NEVER_PERSONAL_KEYS.has(cleLue.trim().toLowerCase()) && (typeof inner !== 'object' || inner === null)) {
        // Un identifiant de transaction, un montant, un horodatage : jamais une personne, quelle que soit sa forme —
        // à la RÉTENTION seulement, et sur une valeur SCALAIRE (un `event` objet porte parfois la personne). Un
        // effacement, lui, porte sur une personne à sa demande : `{leadid: '8135550142'}` y est retiré.
        out[key] = inner;
        continue;
      }
      const lc = cleLue.toLowerCase();
      if (clePersonnelle(cleLue) || (dropsContext && (CONTEXT_KEYS.has(lc) || /^q\d+$/.test(lc)))) {
        // La clé dit que la valeur est une personne : elle part entière.
        removed = true;
        continue;
      }
      const r = inner !== null && typeof inner === 'object' ? strip(inner, cleLue) : feuille(inner, cleLue);
      if (r !== undefined) out[key] = r;
    }
    return out;
  };
  const cleaned = strip(metadata, '') as Record<string, unknown> | unknown[];
  return removed ? cleaned : null;
}

/**
 * Paramètres dont la valeur n'est jamais une personne, quelle que soit sa forme : identifiants de clic et de
 * transaction, montants, horodatages. `sanitizeUrlPii` tourne à l'ÉCRITURE de chaque postback entrant, donc masquer
 * un `txid` de dix chiffres détruirait la piste d'audit du paiement sur toutes les conversions, effacées ou non —
 * et l'original n'existerait nulle part.
 */
const NEVER_PERSONAL_KEYS = new Set([
  'cid',
  'clickid',
  'click_id',
  'tk-cid',
  'tid',
  'txid',
  'transactionid',
  'transaction_id',
  'orderid',
  'order_id',
  'leadid',
  'lead_id',
  'payout',
  'revenue',
  'amount',
  'price',
  'cost',
  'ts',
  'timestamp',
  'time',
  'et',
  'event',
  'eventtype',
  'event_type',
  'campaignid',
  'campaign_id',
  'adid',
  'ad_id',
]);

/**
 * An incoming postback URL without the person: the parameters whose NAME says so (`email=`, `whatsapp=`, a name, a
 * zip…) become `***`, and every contact the detector reads in the URL is caviardé in place — the SAME portées the
 * suppression list records. Nothing is decoded or re-encoded: an encoded `&` stays encoded, so a caller cannot forge
 * a parameter through the redaction.
 */
export function sanitizeUrlPii(url: string, reason: 'erased' | 'purged' = 'purged'): string {
  // Les valeurs de paramètres, en positions — à la rétention seules elles sont caviardées, et pas celles qui portent
  // un identifiant de transaction ou un montant (la piste d'audit) : un chemin de postback porte l'identifiant de
  // clic du réseau, sans nom de paramètre pour le protéger, et la rétention repasse chaque nuit sur tout l'historique.
  // Un paramètre, c'est `nom=valeur` après `?`, `&`, `#` ou `;` — y compris un `;p1=…` de matrix URI dans le chemin.
  const valeurs = [...url.matchAll(/[?&#;]([^=&#;?/]+)=([^&#;]*)/g)].map((m) => {
    const va = (m.index ?? 0) + 1 + m[1].length + 1;
    return { nom: m[1], va, vb: va + m[2].length };
  });
  const protegee = (d: number) =>
    valeurs.some((v) => d >= v.va && d < v.vb && NEVER_PERSONAL_KEYS.has(v.nom.trim().toLowerCase()));
  const dansUneValeur = (d: number) => valeurs.some((v) => d >= v.va && d < v.vb);
  const portees = detecter(url, '', true, 0, { reste: Number.POSITIVE_INFINITY }).filter((p) =>
    reason === 'erased' ? true : dansUneValeur(p.debut) && !protegee(p.debut),
  );
  const caviardee = remplacerPortees(url, portees);
  // Par le NOM : la même classification que la liste (`champDeLaPersonne`) et les données personnelles non-contact.
  return caviardee.replace(/([?&#;])([^=&#;]+)=([^&#;]*)/g, (match, sep: string, key: string, value: string) => {
    let nom = key;
    try {
      nom = decodeURIComponent(key.replace(/\+/g, ' '));
    } catch {
      // nom mal encodé : lu tel quel
    }
    if (!value || value === '***') return match;
    if (clePersonnelle(nom) || PII_QUERY_KEYS.some((k) => k.toLowerCase() === nom.trim().toLowerCase())) return `${sep}${key}=***`;
    // Une valeur qui n'était QUE la personne : la clé ne veut plus rien dire (`sub1=***`).
    if (value.includes('***') && resteDe(value.replace(/%20/gi, ' ')) === null) return `${sep}${key}=***`;
    return match;
  });
}

/**
 * Le référent d'une visite, nettoyé (juré r12) — UNE règle par visite, qu'elle ait converti ou non : la query string,
 * le fragment et les identifiants de connexion partent toujours ; dans le chemin, seul le SEGMENT qui porte une
 * personne (lue par le même détecteur) devient `***`, le reste de l'article reste ce que l'onglet « Referrer » groupe.
 * À l'effacement : l'origine seule. Sans schéma : l'hôte seul. `null` : rien d'une URL.
 */
export function referrerSansPersonne(referrer: string, reason: 'erased' | 'purged'): string | null {
  const portees = detecter(referrer, '', true, 0, { reste: Number.POSITIVE_INFINITY });
  // L'HÔTE aussi (juré r13) : « https://813-555-0142.lp.example/ » — l'étiquette qui porte la personne devient `***`.
  // Lu SEUL : sur l'URL entière, « user:pw@news.example » se lit comme une adresse, et l'hôte partait avec elle.
  const masquerHote = (hote: string) => {
    const dansHote = detecter(hote, '', true, 0, { reste: Number.POSITIVE_INFINITY });
    let p = 0;
    return hote
      .split('.')
      .map((etiquette) => {
        const [a, b] = [p, p + etiquette.length];
        p = b + 1;
        return etiquette && dansHote.some((x) => x.debut < b && x.fin > a) ? '***' : etiquette;
      })
      .join('.');
  };
  const m = /^([a-z][a-z0-9+.-]{0,31}:\/\/)(?:[^/?#]*@)?([a-z0-9.*-]*(?::\d{1,5})?)(?=[/?#]|$)([^?#]*)/i.exec(referrer);
  if (!m) {
    const h = /^(?:[^/?#@\s]*@)?([a-z0-9*-]+(?:\.[a-z0-9*-]+)+(?::\d{1,5})?)(?=[/?#]|$)/i.exec(referrer);
    return h ? masquerHote(h[1]) : null;
  }
  const [, schema, hoteBrut, chemin] = m;
  const debutChemin = m[0].length - chemin.length;
  const hote = masquerHote(hoteBrut);
  if (reason === 'erased') return `${schema}${hote}${/^[a-z][a-z0-9+.-]{0,31}:\/\/[^/?#]*[/?#]/i.test(referrer) ? '/' : ''}`;
  let pos = debutChemin;
  const segments = chemin.split('/').map((seg) => {
    const [a, b] = [pos, pos + seg.length];
    pos = b + 1;
    return seg && portees.some((p) => p.debut < b && p.fin > a) ? '***' : seg;
  });
  return `${schema}${hote}${segments.join('/')}`;
}

/** What a storage error can say in a log: never the data Prisma echoes back in its message. */
export function errorLabel(err: unknown): string {
  const e = err as { name?: string; code?: string };
  return [e?.name || 'Error', e?.code].filter(Boolean).join(' ');
}

export function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === 'P2002';
}

/** One CSV cell. Values a spreadsheet would run as a formula are prefixed with a quote. */
/** Un nombre reste un nombre : neutraliser « -25 » casserait la colonne chez le destinataire. */
export function csvCell(value: unknown): string {
  let text =
    value === null || value === undefined
      ? ''
      : value instanceof Date
        ? value.toISOString()
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
  // Leading blanks do not stop Excel or Sheets from reading a formula.
  if (/^[=+\-@\t\r]/.test(text.replace(/^[\s ]+/, ''))) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
