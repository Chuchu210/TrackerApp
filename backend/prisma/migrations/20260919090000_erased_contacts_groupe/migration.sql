-- Les effacements, par GROUPE (tours 30 et 32, une seule migration : celle du tour 30 n'a jamais été appliquée).
--
-- Le second signal (juré r11) : un contact reconnu dans le TEXTE d'une personne effacée — « call my husband Bob at
-- 727-555-0199 » — faisait refuser Bob quand il envoyait son propre lead. Chaque effacement inscrit ses empreintes
-- sous un même identifiant aléatoire ; un contact déclaré qui ne correspond qu'à une empreinte « trouvée » n'est
-- refusé que si un AUTRE contact du même envoi correspond au même effacement.
--
-- La clé devient le COUPLE (empreinte, groupe) (juré r13). Avec l'empreinte seule pour clé, un numéro déjà inscrit
-- par un effacement précédent (trouvé dans les notes d'Ann) n'entrait pas dans le groupe du second effacement (Eve,
-- qui le déclare) : Eve revenait avec son numéro ET son adresse, et passait.
--
-- Les lignes existantes prennent le groupe « avant-groupes » : on ne sait plus quelles empreintes ont été inscrites
-- ensemble. Elles gardent l'ancienne règle (une empreinte trouvée refuse seule un contact déclaré) — plus
-- protectrice pour la personne effacée. La ligne témoin de la clé prend le groupe « temoin ».
ALTER TABLE "erased_contacts" ADD COLUMN IF NOT EXISTS "groupe" TEXT;

UPDATE "erased_contacts"
   SET "groupe" = CASE WHEN "kind" = 'temoin' THEN 'temoin' ELSE 'avant-groupes' END
 WHERE "groupe" IS NULL;

ALTER TABLE "erased_contacts" ALTER COLUMN "groupe" SET NOT NULL;

ALTER TABLE "erased_contacts" DROP CONSTRAINT IF EXISTS "erased_contacts_pkey";

ALTER TABLE "erased_contacts" ADD CONSTRAINT "erased_contacts_pkey" PRIMARY KEY ("hash", "groupe");

DROP INDEX IF EXISTS "erased_contacts_groupe_idx";
