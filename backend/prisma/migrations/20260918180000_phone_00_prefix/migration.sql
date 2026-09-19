-- Les numéros écrits avant la normalisation du préfixe international « 00 ».
--
-- `normalizePhone` retire désormais « 00 » comme il retirait « + » : « 001 813 555 0142 » et « +1 813 555 0142 »
-- sont la même personne. Les lignes écrites AVANT gardaient « 0018135550142 » : la même personne avait donc deux
-- formes, et un effacement demandé sous la nouvelle forme ne retrouvait pas l'ancienne ligne. Mesuré par le juré.
-- On remet l'existant à la forme d'aujourd'hui, avec la même règle et dans le même ordre : « 00 » d'abord, puis
-- l'indicatif américain « 1 » devant dix chiffres.
UPDATE "leads" SET "phone" = substring("phone" from 3) WHERE "phone" ~ '^00[0-9]{7,}$';
UPDATE "leads" SET "phone" = substring("phone" from 2) WHERE "phone" ~ '^1[0-9]{10}$';
