import { Prisma, type PrismaClient } from '@prisma/client';
import { colonnesDe, donneesVidees, nettoyageJs, selectionNettoyee, type Colonne, type Table } from './lead-columns';
import { hasContact, NOMS_DE_CONTACT, PII_METADATA_KEYS, PII_QUERY_KEYS, type LeadData } from './lead-fields';

/**
 * Minimal view of a Prisma client or transaction: enough to run the raw statements below, so they can be called
 * from a service, from a cron or inside an interactive transaction.
 */
export type RawClient = {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
};

/** A client that can also read back the conversions of a visit — what the deep scrub below needs. */
export type VisitClient = RawClient & Pick<PrismaClient, 'click' | 'conversion' | 'postbackLog'>;

/**
 * Fills the empty fields of an existing lead in ONE statement.
 *
 * Read-then-write loses data: two events of the same visit (the quiz answers and the callback contact) can read the
 * same empty row and the second write puts back the nulls the first had just filled. Here Postgres decides field by
 * field — `COALESCE` keeps whatever is already there — so the order the requests arrive in no longer matters.
 * A row that was erased or purged is never touched (the guard is in the WHERE, so it cannot be raced either).
 *
 * The consent is the exception to "first wins": the one that arrived WITH the contact is the one that authorises the
 * call, so it replaces a consent recorded at an earlier, contactless step.
 */
export function fillLead(
  client: RawClient,
  clickId: string,
  data: LeadData,
  conversionId: string | null = null,
): Promise<number> {
  const consentWins = Boolean(data.consentText) && hasContact(data);
  const answers = JSON.stringify(data.answers ?? {});
  const contact = hasContact(data);
  return client.$executeRaw`
    UPDATE "leads" SET
      "source" = CASE
        WHEN ${contact} AND "phone" IS NULL AND "email" IS NULL AND "first_name" IS NULL AND "last_name" IS NULL
        THEN ${data.source} ELSE "source" END,
      "first_name" = COALESCE("first_name", ${data.firstName}),
      "last_name" = COALESCE("last_name", ${data.lastName}),
      "email" = COALESCE("email", ${data.email}),
      "phone" = COALESCE("phone", ${data.phone}),
      "zip" = COALESCE("zip", ${data.zip}),
      "state" = COALESCE("state", ${data.state}),
      "answers" = CASE
        WHEN ${answers}::jsonb = '{}'::jsonb THEN "answers"
        ELSE ${answers}::jsonb || COALESCE("answers", '{}'::jsonb) END,
      "consent_text" = CASE WHEN ${consentWins} THEN ${data.consentText} ELSE COALESCE("consent_text", ${data.consentText}) END,
      "consent_hash" = CASE WHEN ${consentWins} THEN ${data.consentHash} ELSE COALESCE("consent_hash", ${data.consentHash}) END,
      "consent_at" = CASE WHEN ${consentWins} THEN ${data.consentAt} ELSE COALESCE("consent_at", ${data.consentAt}) END,
      "ip" = COALESCE("ip", ${data.ip}),
      "user_agent" = COALESCE("user_agent", ${data.userAgent}),
      "page_url" = COALESCE("page_url", ${data.pageUrl}),
      "conversion_id" = COALESCE("conversion_id", ${conversionId}),
      "updated_at" = NOW()
    WHERE "click_id" = ${clickId} AND "erased_at" IS NULL AND "purged_at" IS NULL`;
}

/**
 * Un objet JSON sans ses clés personnelles, au premier niveau — le filet SQL derrière la relecture profonde de
 * `withoutContact` (qui passe AVANT, dans `scrubVisitPii`). Les clés de CONTACT viennent de la même liste blanche que
 * la liste de suppression (`NOMS_DE_CONTACT`, comparées sans casse ni ponctuation : `phone_number`, `Phone`,
 * `whatsapp`) ; les autres (nom, IP, consentement…) de la liste des données personnelles non-contact.
 */
function sansClesPersonnelles(colonne: Prisma.Sql, autres: readonly string[]): Prisma.Sql {
  return Prisma.sql`(SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::jsonb) FROM jsonb_each(${colonne}) AS e
     WHERE lower(e.key) <> ALL(${autres.map((k) => k.toLowerCase())}::text[])
       AND lower(regexp_replace(e.key, '[^A-Za-z]', '', 'g')) <> ALL(${[...NOMS_DE_CONTACT]}::text[]))`;
}

/**
 * Le référent, en SQL (la partie que le détecteur n'a pas à décider) : la query string, le fragment et les
 * identifiants de connexion partent toujours ; à l'EFFACEMENT, l'origine seule (suivie de « / » s'il y avait une
 * suite) ; à la RÉTENTION le chemin reste — le segment ou l'étiquette d'hôte qui portait une personne a déjà été
 * masqué par `referrerSansPersonne`, le même détecteur que la liste. Sans schéma : l'hôte seul. Ce qui ne ressemble
 * ni à une URL ni à un hôte part entier. Sur ce que le JavaScript a écrit, cette règle ne change rien de plus
 * (banc Postgres : SQL(JS(x)) = JS(x)).
 */
function referentSql(x: Prisma.Sql, erasing: boolean): Prisma.Sql {
  return Prisma.sql`(
     SELECT CASE
       WHEN u IS NOT NULL THEN u[1] || u[2] || CASE
         WHEN ${erasing}
           THEN CASE WHEN ${x} ~ '^[A-Za-z][A-Za-z0-9+.-]{0,31}://[^/?#]*[/?#]' THEN '/' ELSE '' END
         ELSE u[3] END
       WHEN h IS NOT NULL THEN h[1]
       ELSE NULL END
       FROM (SELECT
         regexp_match(${x},
           '^([A-Za-z][A-Za-z0-9+.-]{0,31}://)(?:[^/?#]*@)?([A-Za-z0-9.*-]*(?::[0-9]{1,5})?)(?=[/?#]|$)([^?#]*)') AS u,
         regexp_match(${x},
           '^(?:[^/?#@[:space:]]*@)?([A-Za-z0-9*-]+(?:[.][A-Za-z0-9*-]+)+(?::[0-9]{1,5})?)(?=[/?#]|$)') AS h) AS m
   )`;
}

/**
 * L'affectation SQL d'une colonne, SELON SA RÈGLE DU REGISTRE (`lead-columns.ts`) — `null` quand le SQL n'a rien à y
 * faire : la colonne se garde, ou le JavaScript l'a déjà nettoyée par portées (`caviarder`, `urlSortante`).
 */
function affectationSql(c: Colonne, erasing: boolean): Prisma.Sql | null {
  const x = Prisma.raw(`"${c.colonne}"`);
  switch (c.nettoyage) {
    case 'vider':
      return Prisma.sql`${x} = NULL`;
    case 'viderSiEffacement':
      return Prisma.sql`${x} = CASE WHEN ${erasing} THEN NULL ELSE ${x} END`;
    case 'json':
      // Un tableau JSON est légal, et un lander en envoie : seul un OBJET perd des clés ; le reste est déjà passé par
      // la relecture valeur par valeur de `withoutContact`.
      return Prisma.sql`${x} = CASE WHEN jsonb_typeof(${x}) = 'object'
        THEN ${sansClesPersonnelles(x, c.cles === 'requete' ? PII_QUERY_KEYS : PII_METADATA_KEYS)} ELSE ${x} END`;
    case 'referent':
      return Prisma.sql`${x} = ${referentSql(x, erasing)}`;
    case 'urlPostback':
      // La query string part, l'adresse reste : l'écran « postbacks entrants » ne liste que les lignes qui ont une URL.
      return Prisma.sql`${x} = CASE WHEN ${x} IS NULL THEN NULL WHEN strpos(${x}, '?') = 0 THEN ${x}
        ELSE split_part(${x}, '?', 1) || ${`?[${erasing ? 'erased' : 'purged'}]`} END`;
    case 'visiteur':
      // Un EFFACEMENT coupe le lien entre les visites ; la RÉTENTION le remplace par un pseudonyme stable (sinon le
      // compte des visiteurs uniques changerait chaque nuit) — sans repseudonymiser ce que nous avons écrit : « p: »
      // suivi de 32 caractères hexadécimaux, pas « p:ann@x.co » qu'un visiteur aurait choisi.
      return Prisma.sql`${x} = CASE WHEN ${x} IS NULL THEN NULL WHEN ${erasing} THEN NULL
        WHEN ${x} ~ '^p:[0-9a-f]{32}$' THEN ${x} ELSE 'p:' || md5(${x}) END`;
    default:
      return null;
  }
}

/** Les `SET` SQL d'une table, GÉNÉRÉS du registre : une colonne nouvelle n'y entre qu'en étant classée. */
export function affectationsSql(table: Table, reason: 'erased' | 'purged'): Prisma.Sql[] {
  return colonnesDe(table)
    .map((c) => affectationSql(c, reason === 'erased'))
    .filter((s): s is Prisma.Sql => s !== null);
}

/** Removes the person from the conversions of these visits, column by column as the registry says. */
export function scrubConversionMetadata(
  client: RawClient,
  clickIds: string[],
  reason: 'erased' | 'purged' = 'purged',
): Promise<number> {
  if (clickIds.length === 0) return Promise.resolve(0);
  return client.$executeRaw`
    UPDATE "conversions" SET ${Prisma.join(affectationsSql('conversions', reason), ', ')}
     WHERE "click_id" = ANY(${clickIds})`;
}

/**
 * Removes the person from everything one visit leaves behind: the conversions, the visit's own columns and the
 * postback logs. FIRST the JavaScript pass — the same detector as the suppression list, column by column as the
 * registry says (`nettoyageJs`) — THEN the SQL statements generated from the same registry. Returns how many
 * conversions changed.
 *
 * It lives here rather than in a service because two callers need exactly the same gesture: an erasure request, and
 * a conversion that lands for a visit erased a moment earlier.
 */
export async function scrubVisitPii(
  client: VisitClient,
  clickIds: string[],
  reason: 'erased' | 'purged',
  now: Date = new Date(),
): Promise<number> {
  if (clickIds.length === 0) return 0;
  // L'ordre compte : ce qui rend une visite invisible au balayage (sa marque) est écrit EN DERNIER, donc un
  // nettoyage coupé en route est repris tel quel au tour suivant.
  const conversions = (await client.conversion.findMany({
    where: { clickId: { in: clickIds } },
    select: selectionNettoyee('conversions', ['id']),
  })) as unknown as Record<string, unknown>[];
  for (const conversion of conversions) {
    const data = nettoyageJs('conversions', conversion, reason);
    if (!Object.keys(data).length) continue;
    await client.conversion.update({ where: { id: conversion.id as string }, data: data as Prisma.ConversionUpdateInput });
  }
  const clicks = (await client.click.findMany({
    where: { clickId: { in: clickIds } },
    select: selectionNettoyee('clicks', ['clickId']),
  })) as unknown as Record<string, unknown>[];
  for (const click of clicks) {
    const data = nettoyageJs('clicks', click, reason);
    if (!Object.keys(data).length) continue;
    await client.click.update({ where: { clickId: click.clickId as string }, data: data as Prisma.ClickUpdateInput });
  }
  const changed = await scrubConversionMetadata(client, clickIds, reason);
  await scrubClicks(client, clickIds, reason);
  // Les journaux de postback : ce que le registre vide (corps, réponse) et l'URL sortante MASQUÉE, pas remplacée —
  // c'est la piste d'audit du paiement (réseau, txid, montant) que l'export lit comme colonne « outgoing ».
  const logs = (await client.postbackLog.findMany({
    where: { conversionId: { in: conversions.map((c) => c.id as string) } },
    select: selectionNettoyee('postback_logs', ['id']),
  })) as unknown as Record<string, unknown>[];
  for (const log of logs) {
    await client.postbackLog.update({
      where: { id: log.id as string },
      data: { ...donneesVidees('postback_logs', reason), ...nettoyageJs('postback_logs', log, reason) } as Prisma.PostbackLogUpdateInput,
    });
  }
  // La marque ne va QU'À ce qui a été lu et nettoyé. La poser par visite estamperait « nettoyée » une conversion
  // arrivée pendant le balayage — un postback tardif portant une adresse — qui ne repasserait alors jamais.
  if (conversions.length > 0) {
    await client.conversion.updateMany({
      where: { id: { in: conversions.map((c) => c.id as string) } },
      data: { scrubbedAt: now },
    });
  }
  await client.click.updateMany({ where: { clickId: { in: clickIds } }, data: { scrubbedAt: now } });
  return changed;
}

/**
 * The visits due for retention, whether or not they produced a lead: a postback carrying an e-mail, a contact event
 * whose lead row failed to be written, a landing URL with the name in its query string.
 *
 * The mark decides, not a guess at where the person might be: a visit is due while it has none, and a conversion
 * that lands after its visit was swept has none of its own, so it comes back here on its own. That is also what
 * makes the sweep terminate and what makes an interrupted scrub resume.
 */
/**
 * Toutes les visites de la même personne, à partir d'une seule.
 *
 * Une demande d'effacement ne porte pas sur une visite mais sur quelqu'un : Ann revenue trois fois depuis le même
 * navigateur a trois clics et deux leads. Effacer le clic nommé et laisser les deux autres, c'est ne pas effacer —
 * et comme le nettoyage remplace ensuite `visitor_id`, le lien qui permettait d'aller chercher les autres n'existe
 * plus après coup. On les résout donc AVANT, par l'identifiant de visiteur et par le contact de la ligne de lead.
 * Bornée : au-delà de `limit` visites, on prend les plus récentes et le compte-rendu le dit.
 */
export function visitsOfPerson(
  client: Pick<PrismaClient, '$queryRaw'>,
  clickId: string,
  contact: { phone?: string | null; email?: string | null; firstName?: string | null; lastName?: string | null } = {},
  limit = 500,
): Promise<{ click_id: string; kept: boolean; why: string }[]> {
  // Le contact est passé en argument, jamais relu en base : sur le chemin de l'effacement, la ligne du lead vient
  // d'être vidée, donc le relire rendrait NULL et l'élargissement ne trouverait plus rien.
  const phone = contact.phone ?? null;
  const email = contact.email ?? null;
  // Premier jeton seulement : une variante de la LP envoie `name: "Ann Dupont"`, une autre `firstName: "Ann"`.
  const name = (contact.firstName ?? '').trim().split(/\s+/)[0].toLowerCase() || null;
  // Le nom de famille CONTREDIT et CONFIRME comme les autres. Il ne compte pas dans « deux identifiants » (un
  // prénom et un nom sont un seul identifiant : le nom de la personne), mais un « Smith » face à un « Dupont »
  // est une contradiction aussi nette qu'un numéro différent, et rien ne la voyait.
  const last = (contact.lastName ?? '').trim().toLowerCase() || null;
  // COMBIEN d'identifiants le demandeur porte-t-il ? En dessous de deux, l'élargissement par contact est refusé —
  // pas restreint : refusé, et les visites écartées sont rapportées.
  //
  // Une demande de rappel n'envoie souvent qu'un numéro. Les trois termes du « conflit » sont alors gardés par
  // « IS NOT NULL » : aucun ne peut être vrai, donc le compteur de contacts partagés reste à zéro, et rien ne
  // distingue plus « l'autre visite d'Ann » de « la visite de Bob, qui a donné le même standard d'entreprise ».
  // Le tour 15 emportait Bob : prénom, nom, courriel et `consent_text` — la preuve que SON appel était autorisé —
  // détruits sur la demande de quelqu'un d'autre, sans retour possible. Un effacement trop étroit laisse du
  // travail à un humain et se dit dans la réponse ; un effacement trop large détruit la donnée d'un tiers.
  // LE NOM COMPTE POUR UN, prénom et nom de famille confondus : « Ann » et « Dupont » ne sont pas deux preuves
  // d'identité, c'est le nom d'une personne. Mais un nom de famille SEUL en est une — et il était compté pour
  // zéro, donc une demande portant « Dupont » et un numéro était traitée comme n'en portant qu'un.
  const canWidenByContact = [name || last, phone, email].filter((v) => v !== null).length >= 2;
  return client.$queryRaw<{ click_id: string; kept: boolean; why: string }[]>`
    WITH seed AS (
      SELECT
        c."visitor_id",
        -- Ce visiteur est-il une EMPREINTE d'appareil (campagne + IP + user-agent, posée faute de cookie) ? Deux
        -- téléphones sur le même wifi la partagent : elle ne désigne pas une personne. La colonne le dit, parce
        -- qu'elle seule le sait ; le préfixe ne sert que pour les lignes d'AVANT elle, et « p: » — le pseudonyme
        -- que la rétention pose chaque nuit, et qui effaçait cette garde en la réécrivant — vaut empreinte.
        -- Deux termes, pas trois : un « sinon, vrai » ne déciderait que si le visiteur était NULL, et dans ce
        -- cas le premier terme de « by_visitor » a déjà tout arrêté. Le banc l'a montré en l'inversant
        -- sans faire tomber un test — une garde qui ne s'exécute jamais fait croire que la question est réglée.
        COALESCE(
          c."visitor_is_fingerprint",
          c."visitor_id" LIKE 'fp%' OR c."visitor_id" LIKE 'p:%'
        ) AS is_fingerprint
        FROM "clicks" c
       WHERE c."click_id" = ${clickId}
    ),
    candidate AS (
      SELECT
        c."click_id",
        c."created_at",
        -- Reliée par le NAVIGATEUR, et seulement si NI la visite demandée NI la candidate ne sont une empreinte :
        -- la garde du tour 14 ne regardait que la première, et une empreinte pseudonymisée passait des deux côtés.
        -- COALESCE sur chacun, et ce n'est pas de la ceinture-bretelles : une visite SANS ligne de lead rend
        -- « l.phone = $1 » à NULL, pas à FAUX. La colonne « kept » remontait alors NULL — faux par accident du
        -- côté JavaScript — et le motif affiché à l'opérateur tombait dans le ELSE : « même contact » sur une
        -- visite qui n'avait aucun contact. Aucun test ne pouvait le voir tant que la requête était simulée.
        COALESCE(s."visitor_id" IS NOT NULL AND (
            c."visitor_id" = s."visitor_id"
            -- …ET de part et d'autre de la RÉTENTION. Elle remplace chaque nuit « v_ann » par
            -- « p: » || md5(visitor_id) : la veille, deux visites d'Ann se reconnaissaient ; le lendemain,
            -- l'égalité brute ne trouvait plus rien. La demande d'effacement n'emportait plus la visite sœur, ne
            -- la rapportait même pas comme écartée, et la route répondait « effacé » — pendant que le code
            -- postal, l'État et les réponses du quiz restaient lisibles sur l'autre visite. Le pseudonyme est
            -- déterministe : il se compare, dans les deux sens, avec la formule qui le fabrique (ligne ~360).
            OR c."visitor_id" = 'p:' || md5(s."visitor_id")
            OR 'p:' || md5(c."visitor_id") = s."visitor_id"
          )
          AND NOT s.is_fingerprint
          AND NOT COALESCE(
            c."visitor_is_fingerprint",
            c."visitor_id" LIKE 'fp%' OR c."visitor_id" LIKE 'p:%'
          ), false) AS by_visitor,
        COALESCE(${phone}::text IS NOT NULL AND l."phone" = ${phone}, false) AS by_phone,
        COALESCE(${email}::text IS NOT NULL AND l."email" = ${email}, false) AS by_email,
        -- Un CONFLIT d'identité : un prénom, un numéro ou une adresse qui contredit ce que le demandeur a donné.
        -- C'est ce qui distingue « la même personne depuis un autre navigateur » de « quelqu'un d'autre sur le
        -- même ordinateur ».
        (
          (${name}::text IS NOT NULL AND l."first_name" IS NOT NULL AND btrim(l."first_name") <> ''
            AND split_part(lower(btrim(l."first_name")), ' ', 1) <> ${name})
          OR (${last}::text IS NOT NULL AND l."last_name" IS NOT NULL AND btrim(l."last_name") <> ''
            AND lower(btrim(l."last_name")) <> ${last})
          OR (${phone}::text IS NOT NULL AND l."phone" IS NOT NULL AND l."phone" <> ${phone})
          OR (${email}::text IS NOT NULL AND l."email" IS NOT NULL AND l."email" <> ${email})
        ) AS conflicts,
        -- COMBIEN d'identifiants du demandeur cette visite confirme-t-elle, et en porte-t-elle d'autres ?
        -- « Pas de contradiction » n'est pas « c'est la même personne » : les trois termes du conflit sont
        -- gardés des deux côtés par IS NOT NULL, donc un demandeur qui n'a qu'un numéro ne peut RIEN contredire
        -- chez quelqu'un qui n'a laissé qu'un prénom et un courriel.
        (
          CASE WHEN ${name}::text IS NOT NULL AND l."first_name" IS NOT NULL
                    AND split_part(lower(btrim(l."first_name")), ' ', 1) = ${name} THEN 1 ELSE 0 END
          + CASE WHEN ${phone}::text IS NOT NULL AND l."phone" = ${phone} THEN 1 ELSE 0 END
          + CASE WHEN ${email}::text IS NOT NULL AND l."email" = ${email} THEN 1 ELSE 0 END
          + CASE WHEN ${last}::text IS NOT NULL AND l."last_name" IS NOT NULL
                      AND lower(btrim(l."last_name")) = ${last} THEN 1 ELSE 0 END
        ) AS matches,
        -- « CETTE VISITE PORTE-T-ELLE LA LIGNE DE QUELQU'UN ? », et pas « porte-t-elle encore un de ces trois
        -- champs ? ». La version du tour 18 avait deux trous, et les deux détruisent la preuve d'un tiers :
        -- un tiers qui n'a laissé qu'un NOM DE FAMILLE avec son texte de consentement (« hasContact » accepte cette
        -- ligne, donc elle existe) répondait « non », et un tiers dont la ligne a déjà été PURGÉE par la rétention
        -- répondait « non » lui aussi — au bout de quatre-vingt-dix jours, la protection expirait toute seule.
        -- L'existence de la ligne ne s'efface pas, elle.
        COALESCE(l."click_id" IS NOT NULL, false) AS has_contact
        FROM "clicks" c
        LEFT JOIN "leads" l ON l."click_id" = c."click_id"
        CROSS JOIN seed s
       WHERE c."click_id" = ${clickId}
          OR (s."visitor_id" IS NOT NULL AND (
            c."visitor_id" = s."visitor_id"
            OR c."visitor_id" = 'p:' || md5(s."visitor_id")
            OR 'p:' || md5(c."visitor_id") = s."visitor_id"
          ))
          OR (${phone}::text IS NOT NULL AND l."phone" = ${phone})
          OR (${email}::text IS NOT NULL AND l."email" = ${email})
    ),
    shared AS (
      -- Combien d'AUTRES personnes portent ce contact : un standard d'entreprise, un numéro bidon, un foyer. Le
      -- comptage inclut les visites reliées par le visiteur : les en exclure, c'était laisser le visiteur désarmer
      -- la garde, et le juré l'a montré.
      SELECT count(*) FILTER (WHERE conflicts AND (by_phone OR by_email)) AS others
        FROM candidate
       WHERE "click_id" <> ${clickId}
    )
    SELECT
      c."click_id",
      (
        c."click_id" = ${clickId}
        -- Le NAVIGATEUR seul ne suffit pas quand la visite d'en face porte SON PROPRE contact et qu'aucun des
        -- identifiants du demandeur ne le confirme. Un ordinateur familial, un poste partagé au bureau : Ann
        -- demande un rappel en ne laissant qu'un numéro, Bob a laissé prénom, courriel et texte de consentement
        -- sans numéro. Aucune contradiction n'est calculable, et la pierre tombale partait sur la ligne de Bob —
        -- sa preuve TCPA détruite, irréversiblement, sur la demande de quelqu'un d'autre. C'est la règle qu'on
        -- avait établie pour le contact (deux identifiants concordants) et qu'on n'avait pas portée ici.
        OR (c.by_visitor AND NOT c.conflicts AND (NOT c.has_contact OR c.matches > 0))
        -- DEUX identifiants confirmés, ou le courriel — qui est quasi unique. Le compteur de contacts
        -- partagés ne voit un partage que s'il y a CONTRADICTION : il protège donc exactement ceux qui ont
        -- donné le PLUS de données, et abandonne le tiers qui n'a laissé que le standard de son entreprise et
        -- son texte de consentement. C'est le cas que ce fichier passe quarante lignes à décrire, et c'était le
        -- seul que le code n'attrapait pas.
        OR ((c.by_phone OR c.by_email) AND NOT c.conflicts AND sh.others = 0 AND ${canWidenByContact}
            AND (c.matches >= 2 OR c.by_email))
      ) AS kept,
      CASE
        WHEN c."click_id" = ${clickId} THEN 'demandée'
        WHEN c.conflicts THEN 'identité différente'
        -- L'ordre compte : quand les deux sont vrais, « quelqu'un d'autre porte ce contact » est ce qu'un
        -- opérateur a besoin de savoir — c'est un fait sur le monde, pas sur notre incertitude.
        WHEN (c.by_phone OR c.by_email) AND sh.others > 0 THEN 'contact partagé par quelqu''un d''autre'
        WHEN (c.by_phone OR c.by_email) AND (NOT ${canWidenByContact} OR (c.matches < 2 AND NOT c.by_email))
          THEN 'contact partagé, identité non confirmée'
        WHEN c.by_visitor AND c.has_contact AND c.matches = 0
          THEN 'navigateur partagé, identité non confirmée'
        WHEN c.by_visitor THEN 'même navigateur'
        WHEN NOT c.by_visitor AND NOT c.by_phone AND NOT c.by_email THEN 'empreinte de navigateur, pas une personne'
        ELSE 'même contact'
      END AS why
      FROM candidate c
      CROSS JOIN shared sh
     GROUP BY c."click_id", c."created_at", c.by_visitor, c.by_phone, c.by_email, c.conflicts,
              c.matches, c.has_contact, sh.others
     -- Les plus récentes d'abord : si la borne tronque, elle tronque le passé lointain, pas la visite d'hier.
     ORDER BY c."created_at" DESC
     LIMIT ${limit}`;
}

export function visitsDueForPurge(
  client: Pick<PrismaClient, '$queryRaw'>,
  cutoff: Date,
  limit: number,
): Promise<{ click_id: string }[]> {
  return client.$queryRaw<{ click_id: string }[]>`
    SELECT "click_id" FROM "clicks"
     WHERE "created_at" < ${cutoff} AND "scrubbed_at" IS NULL
     UNION
    SELECT DISTINCT "click_id" FROM "conversions"
     WHERE "created_at" < ${cutoff} AND "scrubbed_at" IS NULL
     LIMIT ${limit}`;
}

/**
 * The visit itself keeps a copy of the person: the IP, the User-Agent, the language, the referrer, the landing query
 * string, the ad and UTM labels, the request headers. Every column of `clicks` is classified in the registry
 * (`lead-columns.ts`), and this statement is GENERATED from it: a column cannot be read by the suppression list and
 * forgotten here (juror r13: `utm_term`, `ad_title` survived an erasure).
 */
export function scrubClicks(
  client: RawClient,
  clickIds: string[],
  reason: 'erased' | 'purged' = 'purged',
): Promise<number> {
  if (clickIds.length === 0) return Promise.resolve(0);
  return client.$executeRaw`
    UPDATE "clicks" SET ${Prisma.join(affectationsSql('clicks', reason), ', ')}
     WHERE "click_id" = ANY(${clickIds})`;
}
