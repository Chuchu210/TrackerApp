-- La liste de suppression : ce qu'il reste d'une personne effacée, et qui ne la désigne pas.
--
-- La garde d'effacement des conversions lit `click_id` : elle ne couvre que les visites DÉJÀ connues. Un lead
-- capté sur un autre site arrive avec un identifiant neuf, et la personne qui avait demandé son effacement était
-- recréée avec son contact complet. On ne peut pas la reconnaître à son numéro — l'effacement l'a supprimé, comme
-- promis. Une empreinte à clé (HMAC-SHA256, clé ERASURE_HMAC_KEY gardée hors de la base) la reconnaît sans
-- permettre de la retrouver à qui ne détient pas la clé. Ce sont des données pseudonymisées ; la ligne ne sert
-- qu'à REFUSER un retour.
CREATE TABLE IF NOT EXISTS "erased_contacts" (
    "hash"      TEXT NOT NULL,
    "kind"      TEXT NOT NULL,
    "erased_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "erased_contacts_pkey" PRIMARY KEY ("hash")
);

CREATE INDEX IF NOT EXISTS "erased_contacts_erased_at_idx" ON "erased_contacts"("erased_at");

-- Les personnes DÉJÀ effacées avant cette migration ne sont pas dans la liste, et ne peuvent pas y entrer : leur
-- contact a été supprimé, il n'y a plus rien à hacher. C'est dit ici plutôt que tu, parce que c'est la limite de
-- cette protection — elle vaut pour tout effacement demandé à partir d'aujourd'hui.
