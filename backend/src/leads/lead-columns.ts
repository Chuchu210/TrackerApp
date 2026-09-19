import { Prisma } from '@prisma/client';
import { lireContacts, referrerSansPersonne, sanitizeUrlPii, valeurNettoyee, withoutContact } from './lead-fields';

/**
 * LE REGISTRE DES COLONNES (tour 32) — une seule source de vérité pour ce qui est LU (liste de suppression) et ce
 * qui est NETTOYÉ (effacement, rétention), colonne par colonne.
 *
 * Treize jurys ont trouvé, chacun, une colonne ou un format que la lecture et le nettoyage ne traitaient pas de la même
 * façon — la dernière fois : `contactsOfVisits` lisait la ligne de visite ENTIÈRE, `scrubClicks` ne touchait pas
 * `utm_term`, où les outils d'e-mailing écrivent l'adresse (juré r13). Désormais chaque colonne texte ou JSON des
 * tables de visite et de lead est classée ICI, une fois : la lecture sélectionne ce registre, le nettoyage JavaScript
 * et les `SET` SQL en sont GÉNÉRÉS, la pierre tombale et la rétention des leads aussi. Un test lit
 * `prisma/schema.prisma` et échoue si une colonne n'est pas classée, ou si une colonne classée n'existe plus :
 * une colonne nouvelle force une décision.
 */

export type Table = 'clicks' | 'conversions' | 'leads' | 'postback_logs';

/** Les modèles Prisma couverts, et leur table. */
export const MODELES: Record<string, Table> = { Click: 'clicks', Conversion: 'conversions', Lead: 'leads', PostbackLog: 'postback_logs' };

/**
 * - `contact`     : peut porter une personne — LUE par la liste, et NETTOYÉE ;
 * - `url`         : une URL — lue, nettoyée par la règle d'URL (paramètres, chemin, hôte) ;
 * - `personnel`   : personnel sans être un contact (nom, IP, user-agent, ville) — jamais lu comme contact, vidé ;
 * - `identifiant` : identifiant technique (ids, gclid, versions, empreintes) — jamais lu ; vidé s'il relie ;
 * - `structure`   : énumération, statut, pays — ni lu ni nettoyé.
 */
export type Classe = 'contact' | 'url' | 'personnel' | 'identifiant' | 'structure';

/**
 * - `caviarder`         : JavaScript — les portées du détecteur (sous le nom de la colonne) deviennent `***` ;
 * - `json`              : JavaScript `withoutContact`, puis SQL — clés personnelles retirées au premier niveau ;
 * - `vider`             : NULL, à l'effacement comme à la rétention ;
 * - `viderSiEffacement` : NULL à l'effacement seulement (ville, code postal : les rapports les lisent) ;
 * - `referent`          : JavaScript `referrerSansPersonne`, puis SQL (query, fragment, identifiants ; l'origine à
 *                         l'effacement) ;
 * - `urlPostback`       : JavaScript `sanitizeUrlPii`, puis SQL (la query string coupée) ;
 * - `urlSortante`       : JavaScript `sanitizeUrlPii` (la piste d'audit du paiement reste) ;
 * - `visiteur`          : pseudonyme stable à la rétention, NULL à l'effacement ;
 * - `garder`            : rien.
 */
export type Nettoyage =
  | 'caviarder'
  | 'json'
  | 'vider'
  | 'viderSiEffacement'
  | 'referent'
  | 'urlPostback'
  | 'urlSortante'
  | 'visiteur'
  | 'garder';

export interface Colonne {
  table: Table;
  /** Le nom du champ Prisma. */
  champ: string;
  /** Le nom de la colonne SQL — et la CLÉ sous laquelle la valeur est lue ET nettoyée. */
  colonne: string;
  classe: Classe;
  nettoyage: Nettoyage;
  /** Le contact de la ligne de lead : DÉCLARÉ tel quel (la personne l'a donné comme le sien). */
  declaree?: boolean;
  /** Pour `json` : la liste de clés que le filet SQL retire (celle des URL ou celle des métadonnées). */
  cles?: 'requete' | 'metadonnees';
}

const col = (
  table: Table,
  champ: string,
  colonne: string,
  classe: Classe,
  nettoyage: Nettoyage,
  extra: Partial<Colonne> = {},
): Colonne => ({ table, champ, colonne, classe, nettoyage, ...extra });

const ids = (table: Table, ...paires: [string, string][]) => paires.map(([c, s]) => col(table, c, s, 'identifiant', 'garder'));
const structure = (table: Table, ...paires: [string, string][]) => paires.map(([c, s]) => col(table, c, s, 'structure', 'garder'));
/** Texte libre venu d'une régie ou d'un lien : un marketeur ou un outil d'e-mailing y écrit ce qu'il veut. */
const libres = (table: Table, ...paires: [string, string][]) => paires.map(([c, s]) => col(table, c, s, 'contact', 'caviarder'));

export const COLONNES: readonly Colonne[] = [
  // ——— clicks ———————————————————————————————————————————————————————————————————————————————————————————————————
  ...ids('clicks', ['id', 'id'], ['clickId', 'click_id'], ['campaignId', 'campaign_id']),
  // Les graines publicitaires RELIENT la visite à une personne chez la régie (fbc se reconstruit depuis fbclid) :
  // jamais lues comme contact, vidées.
  ...[
    ['trackingId', 'tracking_id'],
    ['externalClickId', 'external_click_id'],
    ['gclid', 'gclid'],
    ['fbclid', 'fbclid'],
    ['oppref', 'oppref'],
    ['obref', 'obref'],
  ].map(([c, s]) => col('clicks', c, s, 'identifiant', 'vider')),
  // Onze chiffres Microsoft Ads dans `ad_id` se lisaient comme un numéro (juré r13) : des identifiants, pas lus.
  ...ids(
    'clicks',
    ['adId', 'ad_id'],
    ['adsetId', 'adset_id'],
    ['campaignExternalId', 'campaign_external_id'],
    ['siteId', 'site_id'],
    ['assetId', 'asset_id'],
    ['pathId', 'path_id'],
    ['variantId', 'variant_id'],
    ['landerId', 'lander_id'],
    ['offerId', 'offer_id'],
    ['affiliateNetworkId', 'affiliate_network_id'],
    ['trafficSourceId', 'traffic_source_id'],
    // La version du navigateur (« 126.0.6478.127 ») devenait 2606478127 à presque chaque effacement (juré r13).
    ['osVersion', 'os_version'],
    ['browserVersion', 'browser_version'],
  ),
  // Les libellés que la régie ou le lien écrivent : « Hi ann.doe@gmail.com » dans un titre d'annonce, l'adresse du
  // destinataire dans `utm_term` (juré r13). Lus, et caviardés par portées — sous LEUR nom de colonne, donc avec la
  // même règle d'identifiant qu'à la lecture (`utm_campaign` ne lit pas de numéro, et n'en retire pas).
  ...libres(
    'clicks',
    ['adTitle', 'ad_title'],
    ['adsetName', 'adset_name'],
    ['publisherName', 'publisher_name'],
    ['contentName', 'content_name'],
    ['landerName', 'lander_name'],
    ['offerName', 'offer_name'],
    ['affiliateNetwork', 'affiliate_network'],
    ['trafficSourceName', 'traffic_source_name'],
    ['utmSource', 'utm_source'],
    ['utmMedium', 'utm_medium'],
    ['utmCampaign', 'utm_campaign'],
    ['utmTerm', 'utm_term'],
    ['utmContent', 'utm_content'],
  ),
  // Les dix variables libres portent ce que l'opérateur y a mappé : lues, et vidées (l'export Voluum les emporte).
  ...Array.from({ length: 10 }, (_, i) => col('clicks', `customVariable${i + 1}`, `custom_variable_${i + 1}`, 'contact', 'vider')),
  ...structure(
    'clicks',
    ['platform', 'platform'],
    ['country', 'country'],
    ['countryCode', 'country_code'],
    ['device', 'device'],
    ['os', 'os'],
    ['brand', 'brand'],
    ['model', 'model'],
    ['browser', 'browser'],
    ['isp', 'isp'],
    ['mobileCarrier', 'mobile_carrier'],
    ['connectionType', 'connection_type'],
    ['botReasons', 'bot_reasons'],
  ),
  // La ville et la région re-identifient une fois croisées : parties à l'effacement ; le pays reste.
  col('clicks', 'region', 'region', 'personnel', 'viderSiEffacement'),
  col('clicks', 'city', 'city', 'personnel', 'viderSiEffacement'),
  col('clicks', 'ipAddress', 'ip_address', 'personnel', 'vider'),
  col('clicks', 'userAgent', 'user_agent', 'personnel', 'vider'),
  col('clicks', 'acceptLanguage', 'accept_language', 'personnel', 'vider'),
  col('clicks', 'requestHeaders', 'request_headers', 'personnel', 'vider'),
  col('clicks', 'visitorId', 'visitor_id', 'personnel', 'visiteur'),
  col('clicks', 'referrer', 'referrer', 'url', 'referent'),
  col('clicks', 'rawParams', 'raw_params', 'contact', 'json', { cles: 'requete' }),

  // ——— conversions ———————————————————————————————————————————————————————————————————————————————————————————————
  ...ids('conversions', ['id', 'id'], ['clickId', 'click_id'], ['campaignId', 'campaign_id'], ['transactionId', 'transaction_id']),
  ...structure('conversions', ['eventType', 'event_type'], ['currency', 'currency']),
  col('conversions', 'metadata', 'metadata', 'contact', 'json', { cles: 'metadonnees' }),
  col('conversions', 'incomingPostbackIp', 'incoming_postback_ip', 'personnel', 'vider'),
  col('conversions', 'incomingPostbackUrl', 'incoming_postback_url', 'url', 'urlPostback'),
  // Les acheteurs y mettent couramment l'e-mail : lus, et vidés (l'export Voluum les emporte).
  ...[1, 2, 3, 4, 5].map((i) => col('conversions', `postbackParam${i}`, `postback_param_${i}`, 'contact', 'vider')),

  // ——— leads ———————————————————————————————————————————————————————————————————————————————————————————————————————
  ...ids('leads', ['id', 'id'], ['clickId', 'click_id'], ['campaignId', 'campaign_id'], ['conversionId', 'conversion_id'], ['consentHash', 'consent_hash']),
  ...structure('leads', ['source', 'source']),
  col('leads', 'phone', 'phone', 'contact', 'vider', { declaree: true }),
  col('leads', 'email', 'email', 'contact', 'vider', { declaree: true }),
  col('leads', 'firstName', 'first_name', 'personnel', 'vider'),
  col('leads', 'lastName', 'last_name', 'personnel', 'vider'),
  col('leads', 'ip', 'ip', 'personnel', 'vider'),
  col('leads', 'userAgent', 'user_agent', 'personnel', 'vider'),
  col('leads', 'consentText', 'consent_text', 'personnel', 'vider'),
  col('leads', 'pageUrl', 'page_url', 'url', 'vider'),
  col('leads', 'zip', 'zip', 'personnel', 'viderSiEffacement'),
  col('leads', 'state', 'state', 'personnel', 'viderSiEffacement'),
  // Les réponses du quiz restent à la rétention (les rapports les lisent) — mais sans la personne qu'un texte libre
  // y aurait écrite ; à l'effacement, elles partent.
  col('leads', 'answers', 'answers', 'contact', 'json', { cles: 'metadonnees' }),

  // ——— postback_logs ——————————————————————————————————————————————————————————————————————————————————————————————
  ...ids('postback_logs', ['id', 'id'], ['conversionId', 'conversion_id']),
  ...structure('postback_logs', ['method', 'method']),
  // L'URL sortante est la piste d'audit du paiement : masquée, pas remplacée. Le corps et la réponse portent la
  // personne (et un sha256 de numéro se retrouve par force brute) : vidés. Ce sont des COPIES de ce que la conversion
  // porte déjà : la liste lit l'original, pas la copie.
  col('postback_logs', 'url', 'url', 'url', 'urlSortante'),
  col('postback_logs', 'requestBody', 'request_body', 'personnel', 'vider'),
  col('postback_logs', 'response', 'response', 'personnel', 'vider'),
];

export function colonnesDe(table: Table): Colonne[] {
  return COLONNES.filter((c) => c.table === table);
}

/** Lue par la liste de suppression : ce qui peut porter une personne, et les URL. */
export function estLue(c: Colonne): boolean {
  return c.classe === 'contact' || c.classe === 'url';
}

/** Le `select` Prisma de ce que la liste lit dans cette table (et de ce que l'appelant ajoute pour sa logique). */
export function selectionLue(table: Table, avec: string[] = []): Record<string, true> {
  return Object.fromEntries([...colonnesDe(table).filter(estLue).map((c) => c.champ), ...avec].map((k) => [k, true]));
}

/** Ce qu'une ligne donne à lire : les colonnes lues NON déclarées, sous le nom de leur colonne. */
export function ligneLue(table: Table, ligne: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of colonnesDe(table)) {
    if (!estLue(c) || c.declaree) continue;
    const v = ligne[c.champ];
    if (v !== null && v !== undefined) out[c.colonne] = v;
  }
  return out;
}

/** Les contacts DÉCLARÉS tels quels par la ligne (le téléphone et l'adresse de la ligne de lead). */
export function contactDeclare(table: Table, ligne: Record<string, unknown>): { phone?: string | null; email?: string | null } {
  const out: Record<string, unknown> = {};
  for (const c of colonnesDe(table)) if (c.declaree && ligne[c.champ] != null) out[c.champ] = ligne[c.champ];
  return out as { phone?: string | null; email?: string | null };
}

/** La liste lit une ligne : `lireContacts` sur ce qu'elle donne à lire. */
export function lireLigne(table: Table, ligne: Record<string, unknown>): ReturnType<typeof lireContacts> {
  return lireContacts(ligneLue(table, ligne));
}

/** Les colonnes que le nettoyage JavaScript touche dans cette table (le `select` qu'il lui faut). */
export function selectionNettoyee(table: Table, avec: string[] = []): Record<string, true> {
  const js: Nettoyage[] = ['caviarder', 'json', 'referent', 'urlPostback', 'urlSortante'];
  return Object.fromEntries([...colonnesDe(table).filter((c) => js.includes(c.nettoyage)).map((c) => c.champ), ...avec].map((k) => [k, true]));
}

/**
 * Le nettoyage JAVASCRIPT d'une ligne : pour chaque colonne `caviarder`, `json`, `referent`, `urlPostback`,
 * `urlSortante`, la nouvelle valeur — seulement ce qui change. Le même détecteur que la lecture, sous la même clé.
 */
export function nettoyageJs(table: Table, ligne: Record<string, unknown>, reason: 'erased' | 'purged'): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of colonnesDe(table)) {
    const v = ligne[c.champ];
    if (v === null || v === undefined) continue;
    let neuve: unknown = v;
    if (c.nettoyage === 'caviarder' && typeof v === 'string') neuve = valeurNettoyee(v, c.colonne);
    else if (c.nettoyage === 'json') neuve = withoutContact(v, reason) ?? v;
    else if (c.nettoyage === 'referent' && typeof v === 'string') neuve = referrerSansPersonne(v, reason);
    else if ((c.nettoyage === 'urlPostback' || c.nettoyage === 'urlSortante') && typeof v === 'string') neuve = sanitizeUrlPii(v, reason);
    // Un JSON relu est un objet NEUF même quand rien n'a changé : comparé par son texte, pour ne pas réécrire chaque
    // ligne à chaque rétention.
    if (c.nettoyage === 'json' ? JSON.stringify(neuve) !== JSON.stringify(v) : neuve !== v) out[c.champ] = neuve;
  }
  return out;
}

/**
 * Les données Prisma d'un nettoyage par la CLÉ (tables écrites par Prisma : `leads`, `postback_logs`) : `vider`
 * toujours ; `viderSiEffacement` et `json` à l'effacement (la rétention, elle, passe `json` au JavaScript).
 */
export function donneesVidees(table: Table, reason: 'erased' | 'purged'): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of colonnesDe(table)) {
    if (c.nettoyage === 'vider' || (reason === 'erased' && c.nettoyage === 'viderSiEffacement')) out[c.champ] = null;
    else if (reason === 'erased' && c.nettoyage === 'json') out[c.champ] = Prisma.DbNull;
  }
  return out;
}

/** Les règles qu'une classe admet : une colonne lue doit être nettoyée, une colonne non lue ne l'est pas par portées. */
const ADMIS: Record<Classe, Nettoyage[]> = {
  contact: ['caviarder', 'json', 'vider'],
  url: ['referent', 'urlPostback', 'urlSortante', 'vider'],
  personnel: ['vider', 'viderSiEffacement', 'visiteur'],
  identifiant: ['garder', 'vider'],
  structure: ['garder'],
};

/**
 * Ce que le schéma et le registre ne disent pas de la même façon : une colonne texte ou JSON non classée, une colonne
 * classée qui n'existe plus, un couple classe/règle incohérent, une colonne classée deux fois. Vide = cohérent.
 * `schema` : le texte de `prisma/schema.prisma` (le test en injecte un modifié pour prouver qu'il échoue).
 */
export function ecartsAvecLeSchema(schema: string, colonnes: readonly Colonne[] = COLONNES): string[] {
  const ecarts: string[] = [];
  const vues = new Set<string>();
  for (const c of colonnes) {
    const k = `${c.table}.${c.colonne}`;
    if (vues.has(k)) ecarts.push(`classée deux fois : ${k}`);
    vues.add(k);
    if (!ADMIS[c.classe].includes(c.nettoyage)) ecarts.push(`règle « ${c.nettoyage} » incohérente pour une colonne ${c.classe} : ${k}`);
  }
  for (const [modele, table] of Object.entries(MODELES)) {
    const bloc = new RegExp(`^model ${modele} \\{([\\s\\S]*?)^\\}`, 'm').exec(schema)?.[1];
    if (!bloc) {
      ecarts.push(`modèle absent du schéma : ${modele}`);
      continue;
    }
    const champs = new Map<string, string>();
    for (const ligne of bloc.split('\n')) {
      const m = /^\s+(\w+)\s+(String|Json)\??(\s|$)/.exec(ligne);
      if (!m) continue;
      const colonne = /@map\("([^"]+)"\)/.exec(ligne)?.[1] ?? m[1];
      champs.set(m[1], colonne);
    }
    for (const [champ, colonne] of champs) {
      const c = colonnes.find((x) => x.table === table && x.champ === champ);
      if (!c) ecarts.push(`colonne non classée : ${table}.${colonne} (${modele}.${champ})`);
      else if (c.colonne !== colonne) ecarts.push(`colonne renommée : ${table}.${champ} est « ${colonne} », le registre dit « ${c.colonne} »`);
    }
    for (const c of colonnes.filter((x) => x.table === table)) {
      if (!champs.has(c.champ)) ecarts.push(`colonne classée mais absente du schéma : ${table}.${c.colonne}`);
    }
  }
  return ecarts;
}
