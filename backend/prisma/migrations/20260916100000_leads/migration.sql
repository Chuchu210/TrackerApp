-- Leads: the person behind a visit — contact, quiz answers and consent — merged from every event of that click that
-- carries them (lead, callback_request, postalcode). One row per click, created only once a real contact arrived.
-- New table only (no lock on existing tables), then a backfill from the conversions already recorded.

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "click_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "conversion_id" TEXT,
    "source" TEXT NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "zip" TEXT,
    "state" TEXT,
    "answers" JSONB,
    "consent_text" TEXT,
    "consent_hash" TEXT,
    "consent_at" TIMESTAMP(3),
    "ip" TEXT,
    "user_agent" TEXT,
    "page_url" TEXT,
    "is_test" BOOLEAN NOT NULL DEFAULT false,
    "purged_at" TIMESTAMP(3),
    "erased_at" TIMESTAMP(3),
    "scrubbed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "leads_click_id_key" ON "leads"("click_id");

-- CreateIndex
CREATE INDEX "leads_campaign_id_created_at_idx" ON "leads"("campaign_id", "created_at");

-- CreateIndex
CREATE INDEX "leads_created_at_idx" ON "leads"("created_at");

-- CreateIndex
CREATE INDEX "leads_phone_idx" ON "leads"("phone");

-- CreateIndex
CREATE INDEX "leads_email_idx" ON "leads"("email");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_click_id_fkey" FOREIGN KEY ("click_id") REFERENCES "clicks"("click_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill. Same rules as lead-fields.ts: control characters removed, first non-empty value per key wins (events read
-- oldest first), phone digits only with a leading US country code dropped, and a row only where a contact exists.
WITH ev AS (
    SELECT c."id", c."click_id", c."campaign_id", c."is_test", c."created_at", c."metadata"
    FROM "conversions" c
    WHERE c."event_type" IN ('lead', 'callback_request', 'postalcode')
      AND jsonb_typeof(c."metadata") = 'object'
), kv AS (
    SELECT DISTINCT ON (ev."click_id", e.key)
           ev."click_id",
           e.key,
           btrim(regexp_replace(e.value, '[[:cntrl:]]', ' ', 'g')) AS value
    FROM ev, LATERAL jsonb_each_text(ev."metadata") e
    WHERE jsonb_typeof(ev."metadata" -> e.key) <> 'object'
      AND jsonb_typeof(ev."metadata" -> e.key) <> 'array'
      AND btrim(e.value) <> ''
    ORDER BY ev."click_id", e.key, ev."created_at"
), meta AS (
    SELECT "click_id", jsonb_object_agg(key, value) AS m
    FROM kv
    WHERE value <> ''
    GROUP BY "click_id"
), base AS (
    SELECT "click_id",
           min("created_at") AS created_at,
           (array_agg("id" ORDER BY "created_at"))[1] AS conversion_id,
           (array_agg("campaign_id" ORDER BY "created_at"))[1] AS campaign_id,
           bool_or("is_test") AS is_test
    FROM ev
    GROUP BY "click_id"
), built AS (
    SELECT b."click_id",
           b.campaign_id,
           b.conversion_id,
           b.is_test,
           b.created_at,
           left(m.m->>'source', 40) AS declared_source,
           left(COALESCE(m.m->>'firstName', m.m->>'first_name', m.m->>'name'), 100) AS first_name,
           left(COALESCE(m.m->>'lastName', m.m->>'last_name'), 100) AS last_name,
           CASE WHEN lower(m.m->>'email') ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN left(lower(m.m->>'email'), 254) END AS email,
           CASE
               WHEN length(regexp_replace(regexp_replace(COALESCE(m.m->>'phone', ''), '\D', '', 'g'), '^1(\d{10})$', '\1')) BETWEEN 7 AND 15
               THEN regexp_replace(regexp_replace(m.m->>'phone', '\D', '', 'g'), '^1(\d{10})$', '\1')
           END AS phone,
           left(COALESCE(m.m->>'zip', m.m->>'zipCode', m.m->>'postal_code'), 10) AS zip,
           left(m.m->>'state', 40) AS state,
           left(COALESCE(m.m->>'consent', m.m->>'consentText'), 2000) AS consent_text,
           left(COALESCE(m.m->>'pageUrl', m.m->>'page_url'), 2000) AS page_url,
           (SELECT jsonb_object_agg(k.key, left(k.value, 200))
              FROM jsonb_each_text(m.m) k
             WHERE k.key ~ '^q[0-9][0-9]?$' OR k.key IN ('insured', 'vehicles', 'homeowner')) AS answers
    FROM base b
    JOIN meta m ON m."click_id" = b."click_id"
)
INSERT INTO "leads" ("id", "click_id", "campaign_id", "conversion_id", "source", "first_name", "last_name", "email",
                     "phone", "zip", "state", "answers", "consent_text", "consent_hash", "consent_at", "page_url",
                     "is_test", "created_at", "updated_at")
SELECT gen_random_uuid()::text,
       built."click_id",
       built.campaign_id,
       built.conversion_id,
       COALESCE(NULLIF(built.declared_source, ''),
                CASE WHEN built.phone IS NOT NULL OR built.email IS NOT NULL OR built.first_name IS NOT NULL
                     THEN 'form' ELSE 'quiz' END),
       NULLIF(built.first_name, ''),
       NULLIF(built.last_name, ''),
       built.email,
       built.phone,
       NULLIF(built.zip, ''),
       NULLIF(built.state, ''),
       built.answers,
       NULLIF(built.consent_text, ''),
       CASE WHEN NULLIF(built.consent_text, '') IS NOT NULL
            THEN encode(sha256(convert_to(regexp_replace(built.consent_text, '[[:space:]]+', ' ', 'g'), 'UTF8')), 'hex') END,
       CASE WHEN NULLIF(built.consent_text, '') IS NOT NULL THEN built.created_at END,
       NULLIF(built.page_url, ''),
       built.is_test,
       built.created_at,
       built.created_at
FROM built
JOIN "clicks" cl ON cl."click_id" = built."click_id"
WHERE built.phone IS NOT NULL OR built.email IS NOT NULL OR built.first_name IS NOT NULL OR built.last_name IS NOT NULL
ON CONFLICT ("click_id") DO NOTHING;

-- Marques de nettoyage : la rétention lit ces colonnes pour savoir ce qui reste à faire, et pour ne jamais
-- repasser sur ce qui est fait.
ALTER TABLE "clicks" ADD COLUMN IF NOT EXISTS "scrubbed_at" TIMESTAMP(3);
ALTER TABLE "conversions" ADD COLUMN IF NOT EXISTS "scrubbed_at" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "clicks_scrub_due_idx" ON "clicks" ("created_at") WHERE "scrubbed_at" IS NULL;
CREATE INDEX IF NOT EXISTS "conversions_scrub_due_idx" ON "conversions" ("created_at") WHERE "scrubbed_at" IS NULL;

-- Rattrapage unique : les URL de postback entrantes écrites avant cette version peuvent porter l'e-mail ou le
-- téléphone d'une personne dans leur query string. Les paramètres qui nomment quelqu'un sont masqués ; le reste de
-- l'URL (identifiant de clic, événement, montant) reste lisible, sinon l'écran « postbacks entrants » perd tout son
-- historique — c'est le même masquage que celui appliqué depuis à l'écriture (sanitizeUrlPii).
-- D'abord par VALEUR, dans n'importe quel paramètre quel que soit son nom (`p1`, `sub1`, `u1`…), fragment compris.
-- C'est par là qu'une personne arrive le plus souvent, et aucune liste de clés ne l'attrape.
--
-- Une adresse e-mail, y compris encodée une ou deux fois (`%40`, `%2540`) :
UPDATE "conversions"
   SET "incoming_postback_url" = regexp_replace(
         "incoming_postback_url",
         '([?&#;][^=&#;]+=)[^&#;]*(@|%40|%2540)[^&#;]*',
         '\1***',
         'gi')
 WHERE "incoming_postback_url" IS NOT NULL;

-- Puis un NUMÉRO, en deux passes, et JAMAIS dans un paramètre dont le nom dit qu'il porte un identifiant ou un
-- montant (`txid`, `cid`, `ts`, `payout`…) : sinon le rattrapage détruirait la piste d'audit du paiement sur tout
-- l'historique, alors que l'original n'existe nulle part ailleurs. Même règle qu'à l'écriture (sanitizeUrlPii).
--
-- 1) Une suite de chiffres NUE, jugée ENTIÈRE : onze à douze chiffres, ou dix qui ne commencent PAS par 0 ou 1.
--    Cette dernière garde manquait, et c'est une destruction : un horodatage Unix en secondes (`1699999999`) rangé
--    dans un paramètre libre était masqué ici alors que l'écriture le préserve exprès. Le rattrapage ne passe
--    qu'une fois, et l'original n'existe nulle part. Bornée des deux côtés par un non-chiffre. La
--    version précédente (`[0-9][0-9()., -]{8,18}[0-9]`) mordait à l'intérieur d'une suite plus longue : un
--    horodatage en millisecondes (treize chiffres) et une référence de commande (quinze) y passaient.
--    Le numéro seul est masqué, le reste de la valeur est gardé : « msg=Lead+rejected+call+813… » garde sa raison.
UPDATE "conversions"
   SET "incoming_postback_url" = regexp_replace(
         "incoming_postback_url",
         '([?&#;](?!(?:cid|clickid|click_id|tk-cid|tid|txid|transactionid|transaction_id|orderid|order_id|leadid|lead_id|payout|revenue|amount|price|cost|ts|timestamp|time|et|event|eventtype|event_type|campaignid|campaign_id|adid|ad_id)=)[^=&#;]+=)((?:[^&#;]*[^&#;0-9])?)(?:[0-9]{11,12}|[2-9][0-9]{9})((?:[^&#;0-9][^&#;]*)?)(?=[&#;]|$)',
         '\1\2***\3',
         'gi')
 WHERE "incoming_postback_url" IS NOT NULL;

-- 2) Un numéro PONCTUÉ, qu'aucune suite nue n'attrape, dans les trois formes que l'écriture reconnaît :
--    séparateur avant OU après l'indicatif (« (813)555-0142 » passait au travers des deux côtés), préfixe
--    international (« +33 6 12 34 56 78 », « 0018135550142 »), plus le numéro de sécurité sociale. Bornes des deux
--    côtés, pour ne pas entamer une référence qui contiendrait un tiret.
--    Ce que le SQL ne sait pas faire : le test de Luhn, donc une carte bancaire de seize chiffres rangée dans un
--    paramètre libre de l'HISTORIQUE n'est pas masquée par ce rattrapage. L'écriture, elle, l'attrape (`looksLikeCard`).
UPDATE "conversions"
   SET "incoming_postback_url" = regexp_replace(
         "incoming_postback_url",
         '([?&#;](?!(?:cid|clickid|click_id|tk-cid|tid|txid|transactionid|transaction_id|orderid|order_id|leadid|lead_id|payout|revenue|amount|price|cost|ts|timestamp|time|et|event|eventtype|event_type|campaignid|campaign_id|adid|ad_id)=)[^=&#;]+=)((?:[^&#;]*[^&#;0-9])?)(?:(?:\(|%28)?[0-9]{3}(?:\)|%29)?(?:[ .+-]|%20)?[0-9]{3}(?:[ .+-]|%20)[0-9]{4}|(?:\(|%28)?[0-9]{3}(?:\)|%29)?(?:[ .+-]|%20)[0-9]{3}(?:[ .+-]|%20)?[0-9]{4}|(?:\+|00|%2B)[0-9][0-9 .()%2B+-]{6,18}[0-9]|[0-9]{3}-[0-9]{2}-[0-9]{4})((?:[^&#;0-9][^&#;]*)?)(?=[&#;]|$)',
         '\1\2***\3',
         'gi')
 WHERE "incoming_postback_url" IS NOT NULL;

-- Puis par CLÉ, pour ce qu'une valeur ne trahit pas : un prénom, un code postal, un État.
UPDATE "conversions"
   SET "incoming_postback_url" = regexp_replace(
         "incoming_postback_url",
         '([?&#;](?:name|fullname|full_name|firstname|first_name|lastname|last_name|phone|phonenumber|phone_number|customer_phone|tel|mobile|email|emailaddress|email_address|user_email|pageurl|page_url|consent|consenttext|consent_text|notes|note|comments|address|address1|address2|street|city|dob|birthdate|date_of_birth|ssn|license|licensenumber|driverlicense|driver_license|vin|fbp|fbc|zip|zipcode|postal_code|state)=)[^&#;]*',
         '\1***',
         'gi')
 WHERE "incoming_postback_url" IS NOT NULL;

-- Et les mêmes journaux de postback sortants, qui portent l'URL envoyée à l'acheteur.
UPDATE "postback_logs"
   SET "url" = regexp_replace("url", '([?&#;][^=&#;]+=)[^&#;]*(@|%40|%2540)[^&#;]*', '\1***', 'gi')
 WHERE "url" IS NOT NULL;

-- Les journaux sortants portent le même numéro que l'URL entrante : les deux passes qui le trouvent s'appliquent
-- aussi ici, sans quoi l'effacement du tour 8 ne couvrait qu'une moitié du couple.
UPDATE "postback_logs"
   SET "url" = regexp_replace("url", '([?&#;](?!(?:cid|clickid|click_id|tk-cid|tid|txid|transactionid|transaction_id|orderid|order_id|leadid|lead_id|payout|revenue|amount|price|cost|ts|timestamp|time|et|event|eventtype|event_type|campaignid|campaign_id|adid|ad_id)=)[^=&#;]+=)((?:[^&#;]*[^&#;0-9])?)(?:[0-9]{11,12}|[2-9][0-9]{9})((?:[^&#;0-9][^&#;]*)?)(?=[&#;]|$)', '\1\2***\3', 'gi')
 WHERE "url" IS NOT NULL;

UPDATE "postback_logs"
   SET "url" = regexp_replace(
         "url",
         '([?&#;](?!(?:cid|clickid|click_id|tk-cid|tid|txid|transactionid|transaction_id|orderid|order_id|leadid|lead_id|payout|revenue|amount|price|cost|ts|timestamp|time|et|event|eventtype|event_type|campaignid|campaign_id|adid|ad_id)=)[^=&#;]+=)((?:[^&#;]*[^&#;0-9])?)(?:(?:\(|%28)?[0-9]{3}(?:\)|%29)?(?:[ .+-]|%20)?[0-9]{3}(?:[ .+-]|%20)[0-9]{4}|(?:\(|%28)?[0-9]{3}(?:\)|%29)?(?:[ .+-]|%20)[0-9]{3}(?:[ .+-]|%20)?[0-9]{4}|(?:\+|00|%2B)[0-9][0-9 .()%2B+-]{6,18}[0-9]|[0-9]{3}-[0-9]{2}-[0-9]{4})((?:[^&#;0-9][^&#;]*)?)(?=[&#;]|$)',
         '\1\2***\3',
         'gi')
 WHERE "url" IS NOT NULL;

UPDATE "postback_logs"
   SET "url" = regexp_replace("url", '([?&#;](?:name|fullname|full_name|firstname|first_name|lastname|last_name|phone|phonenumber|phone_number|customer_phone|tel|mobile|email|emailaddress|email_address|user_email|pageurl|page_url|consent|consenttext|consent_text|notes|note|comments|address|address1|address2|street|city|dob|birthdate|date_of_birth|ssn|license|licensenumber|driverlicense|driver_license|vin|fbp|fbc|zip|zipcode|postal_code|state)=)[^&#;]*', '\1***', 'gi')
 WHERE "url" IS NOT NULL;

-- L'effacement d'une PERSONNE part de son visiteur (lead-sql.ts::visitsOfPerson), et le seul index qui portait
-- `visitor_id` commence par `campaign_id` : Postgres ne peut pas s'en servir, donc la requête balayait `clicks` en
-- entier, à l'intérieur de la requête HTTP DELETE. Déclaré aussi dans schema.prisma, sinon la prochaine migration
-- le verrait comme une dérive et le supprimerait.
CREATE INDEX IF NOT EXISTS "clicks_visitor_id_idx" ON "clicks" ("visitor_id");
