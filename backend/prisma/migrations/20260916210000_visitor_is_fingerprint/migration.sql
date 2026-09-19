-- Le drapeau d'empreinte devient une colonne. Il décidait jusqu'ici d'un préfixe de chaîne (« fp_ »), que la
-- rétention réécrit chaque nuit en « p:<md5> » : la garde qui empêche un effacement de s'élargir à travers une
-- empreinte d'appareil était donc désarmée par notre propre rétention, sur les visites qu'elle protégeait.
ALTER TABLE "clicks" ADD COLUMN IF NOT EXISTS "visitor_is_fingerprint" BOOLEAN;

-- Ce qu'on peut encore savoir des lignes existantes : tant que le pseudonyme n'est pas passé, le préfixe dit la
-- vérité. Les lignes déjà pseudonymisées restent NULL — « inconnu », et la requête d'effacement refuse d'élargir
-- sur un inconnu. Reconstituer une réponse pour elles serait inventer.
UPDATE "clicks"
   SET "visitor_is_fingerprint" = ("visitor_id" LIKE 'fp\_%')
 WHERE "visitor_id" IS NOT NULL
   AND "visitor_id" NOT LIKE 'p:%'
   AND "visitor_is_fingerprint" IS NULL;
