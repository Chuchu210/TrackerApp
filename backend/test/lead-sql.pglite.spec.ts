import { createHash } from 'crypto';
import type { PGlite } from '@electric-sql/pglite';
import { visitsOfPerson } from '../src/leads/lead-sql';
import { freshDb, pglitePrisma } from './pg/pglite-prisma';

/**
 * La requête qui décide qui est emporté par une demande d'effacement, jouée contre un vrai Postgres.
 *
 * Elle est la seule règle du système qui puisse DÉTRUIRE la donnée d'un tiers : la pierre tombale efface prénom,
 * nom, courriel et `consent_text` — la preuve TCPA qu'un appel était autorisé. Trop large, elle détruit celle de
 * quelqu'un qui n'a rien demandé ; trop étroite, elle laisse un numéro appelable après un effacement accepté.
 * Jusqu'ici, `$queryRaw` était simulé dans tous les tests : trois mutants qui rouvraient les bloquants du tour 14
 * passaient la suite sans un échec. Ici, c'est Postgres qui répond.
 */
describe("les visites qu'un effacement emporte (Postgres)", () => {
  let db: PGlite;
  let client: ReturnType<typeof pglitePrisma>;

  beforeEach(async () => {
    ({ db, client } = await freshDb(['Click', 'Lead']));
  });

  afterEach(async () => {
    await db.close();
  });

  let clock = 0;
  async function visit(
    clickId: string,
    visitorId: string | null,
    lead?: { firstName?: string | null; lastName?: string | null; phone?: string | null; email?: string | null } | null,
    options: { fingerprint?: boolean | null } = {},
  ) {
    clock += 1;
    await db.query(
      `INSERT INTO "clicks" ("id", "click_id", "campaign_id", "visitor_id", "visitor_is_fingerprint", "created_at")
       VALUES (gen_random_uuid()::text, $1, 'camp-1', $2, $3, now() - ($4 || ' minutes')::interval)`,
      [clickId, visitorId, options.fingerprint ?? null, String(1000 - clock)],
    );
    if (lead) {
      await db.query(
        `INSERT INTO "leads" ("id", "click_id", "campaign_id", "source", "first_name", "last_name", "phone", "email")
         VALUES (gen_random_uuid()::text, $1, 'camp-1', 'form', $2, $3, $4, $5)`,
        [clickId, lead.firstName ?? null, lead.lastName ?? null, lead.phone ?? null, lead.email ?? null],
      );
    }
  }

  async function resolve(clickId: string, contact: Record<string, string | null> = {}) {
    const rows = await visitsOfPerson(client as never, clickId, contact);
    return Object.fromEntries(rows.map((r) => [r.click_id, { kept: r.kept, why: r.why }]));
  }

  it("emporte les autres visites du même navigateur, et la visite demandée d'abord", async () => {
    await visit('c1', 'v_ann', { firstName: 'Ann', phone: '8135550142' }, { fingerprint: false });
    await visit('c2', 'v_ann', { firstName: 'Ann', phone: '8135550142' }, { fingerprint: false });
    const out = await resolve('c1', { phone: '8135550142', firstName: 'Ann' });
    expect(out['c1'].kept).toBe(true);
    expect(out['c2']).toEqual({ kept: true, why: 'même navigateur' });
  });

  it("n'emporte pas la visite de quelqu'un d'autre sur le même ordinateur", async () => {
    await visit('c1', 'v_partage', { firstName: 'Ann', phone: '8135550142' }, { fingerprint: false });
    await visit('c2', 'v_partage', { firstName: 'Bob', phone: '8135550199' }, { fingerprint: false });
    const out = await resolve('c1', { phone: '8135550142', firstName: 'Ann' });
    expect(out['c2']).toEqual({ kept: false, why: 'identité différente' });
  });

  it("n'emporte jamais une visite reliée par une EMPREINTE de navigateur", async () => {
    // `fp_…` = campagne + IP + user-agent : deux téléphones sur le même wifi la partagent. Ce n'est pas une personne.
    await visit('c1', 'fp_wifi', { firstName: 'Ann', phone: '8135550142' }, { fingerprint: true });
    await visit('c2', 'fp_wifi', null, { fingerprint: true });
    const out = await resolve('c1', { phone: '8135550142', firstName: 'Ann' });
    expect(out['c2']).toEqual({ kept: false, why: 'empreinte de navigateur, pas une personne' });
  });

  it("n'emporte pas une empreinte que la rétention a pseudonymisée la nuit d'avant", async () => {
    // LE BLOQUANT DU TOUR 15. La rétention remplace `visitor_id` par « p: » || md5(visitor_id) — y compris sur une
    // empreinte. Le lendemain, `NOT LIKE 'fp%'` est vrai pour « p:9c4f… » : la garde était désarmée par sa propre
    // rétention, sur la seule visite qu'elle existait pour protéger.
    //
    // Le scénario : deux iPhones, même wifi familial, même iOS → même empreinte. La mère demande l'effacement ;
    // sa ligne est déjà purgée, donc plus aucun contact ne peut CONTREDIRE celui du fils, et sa visite à lui
    // partait — `erased_at` posé, quiz, code postal et État détruits, `consent_text` avec.
    await visit('c1', 'p:9c4f', { firstName: null, phone: null, email: null }, { fingerprint: true });
    await visit('c2', 'p:9c4f', { firstName: 'Tom', phone: '8135550199' }, { fingerprint: true });
    const out = await resolve('c1', {});
    expect(out['c1'].kept).toBe(true);
    expect(out['c2']).toEqual({ kept: false, why: 'empreinte de navigateur, pas une personne' });
  });

  it("refuse de conclure sur une visite d'avant la colonne dont le pseudonyme ne dit plus rien", async () => {
    // Les lignes antérieures à la migration n'ont pas de drapeau (`NULL`) : leur `visitor_id` est déjà « p:… » et
    // plus personne ne peut savoir si c'était une empreinte. On ne devine pas — on refuse d'élargir, et on le dit.
    await visit('c1', 'p:legacy', { firstName: null, phone: null }, { fingerprint: null });
    await visit('c2', 'p:legacy', { firstName: 'Tom', phone: '8135550199' }, { fingerprint: null });
    const out = await resolve('c1', {});
    expect(out['c2'].kept).toBe(false);
  });

  it("n'emporte pas une empreinte de l'appareil d'à côté parce que le demandeur s'est déclaré le même visiteur", async () => {
    // `visitor_id` vient du CLIENT (`tk_vid` en query, cookie `tk-vid`) : il suffit d'envoyer l'empreinte de
    // quelqu'un d'autre — campagne + IP + user-agent, devinable sur un wifi partagé — pour se déclarer le même
    // visiteur que lui. La ligne du demandeur porte alors « ce n'est pas une empreinte » (il l'a fournie), celle
    // du voisin porte « c'en est une » (le serveur l'a calculée). Regarder le drapeau des DEUX côtés est ce qui
    // ferme la porte ; ne le lire que sur la visite demandée la laissait grande ouverte.
    await visit('c1', 'fp_wifi', { firstName: 'Ann', phone: '8135550142' }, { fingerprint: false });
    await visit('c2', 'fp_wifi', null, { fingerprint: true });
    const out = await resolve('c1', { phone: '8135550142', firstName: 'Ann' });
    expect(out['c2']).toEqual({ kept: false, why: 'empreinte de navigateur, pas une personne' });
  });

  it("n'emporte pas la visite de celui qui a donné le même numéro sous un autre prénom", async () => {
    await visit('c1', 'v_ann', { firstName: 'Ann', phone: '8135550142' }, { fingerprint: false });
    await visit('c2', 'v_bob', { firstName: 'Bob', phone: '8135550142' }, { fingerprint: false });
    const out = await resolve('c1', { phone: '8135550142', firstName: 'Ann' });
    expect(out['c2']).toEqual({ kept: false, why: 'identité différente' });
  });

  it("n'emporte rien quand c'est la visite DEMANDÉE qui est une empreinte", async () => {
    // L'autre sens du même lien, et il se teste à part : tant que les deux côtés étaient des empreintes dans mes
    // essais, chaque garde était tenue par l'autre — retirer celle du demandeur ne faisait tomber aucun test.
    // Ici Ann arrive sans cookie (le serveur calcule son empreinte) et le voisin, lui, a un vrai identifiant de
    // navigateur qui vaut la même chaîne parce qu'il l'a envoyée lui-même. Partir de l'empreinte n'emporte rien.
    await visit('c1', 'fp_wifi', { firstName: 'Ann', phone: '8135550142' }, { fingerprint: true });
    // Aucune ligne de lead sur la visite du voisin : RIEN d'autre que l'empreinte ne peut l'écarter. C'est ce qui
    // rend ce test isolant — avec un prénom, « identité différente » aurait répondu à la place de la garde.
    await visit('c2', 'fp_wifi', null, { fingerprint: false });
    const out = await resolve('c1', { phone: '8135550142', firstName: 'Ann' });
    expect(out['c2']).toEqual({ kept: false, why: 'empreinte de navigateur, pas une personne' });
  });

  it("n'emporte rien à partir d'une visite héritée dont le pseudonyme ne dit plus rien", async () => {
    // La visite demandée est d'avant la colonne : son « p:… » peut aussi bien cacher une empreinte qu'un vrai
    // cookie, et rien ne permettra jamais de trancher. La candidate, elle, est postérieure et se déclare
    // honnêtement « pas une empreinte ». On ne conclut pas depuis un inconnu : c'est le préfixe « p: » du côté
    // DEMANDEUR qui arrête tout, et lui seul — la candidate ne peut rien arrêter ici.
    await visit('c1', 'p:legacy', { firstName: null, phone: null }, { fingerprint: null });
    await visit('c2', 'p:legacy', { firstName: 'Tom', phone: '8135550199' }, { fingerprint: false });
    const out = await resolve('c1', {});
    expect(out['c2'].kept).toBe(false);
  });

  it("n'emporte personne par le contact dès qu'un tiers porte le même numéro", async () => {
    // Ann porte bien DEUX identifiants (prénom + numéro), donc l'élargissement par contact est ouvert. Mais Bob
    // porte le même numéro sous un autre prénom : le numéro est partagé, et il ne prouve plus rien pour PERSONNE.
    // La troisième visite — même numéro, aucun prénom — pourrait être celle d'Ann comme celle de Bob. Le
    // compteur de contacts partagés est ce qui l'écarte ; sans lui, on posait une pierre tombale au hasard.
    await visit('c1', 'v_ann', { firstName: 'Ann', phone: '8135550142' }, { fingerprint: false });
    await visit('c2', 'v_bob', { firstName: 'Bob', phone: '8135550142' }, { fingerprint: false });
    await visit('c3', 'v_inconnu', { firstName: null, phone: '8135550142' }, { fingerprint: false });
    const out = await resolve('c1', { phone: '8135550142', firstName: 'Ann' });
    expect(out['c2']).toEqual({ kept: false, why: 'identité différente' });
    expect(out['c3']).toEqual({ kept: false, why: "contact partagé par quelqu'un d'autre" });
  });

  it('emporte bien les visites du même navigateur APRÈS le passage de la rétention', async () => {
    // L'autre moitié de la colonne, et la raison d'être du tour 16 : la rétention remplace chaque nuit
    // « v_ann » par « p:<md5> ». Avant, le préfixe était tout ce qu'on avait, donc il fallait refuser d'élargir
    // sur « p:… » — c'est-à-dire qu'une demande d'effacement arrivée le lendemain n'emportait plus rien. La
    // colonne garde la réponse quand la chaîne, elle, l'a perdue : ces deux visites sont le même navigateur, et
    // elles partent ensemble. Sans lire la colonne, ce test échoue ; sans le refus du cas inconnu, l'autre échoue.
    await visit('c1', 'p:ann', { firstName: 'Ann', phone: '8135550142' }, { fingerprint: false });
    await visit('c2', 'p:ann', null, { fingerprint: false });
    const out = await resolve('c1', { phone: '8135550142', firstName: 'Ann' });
    expect(out['c2']).toEqual({ kept: true, why: 'même navigateur' });
  });

  it("n'élargit pas vers une visite héritée, même quand la visite demandée, elle, est claire", async () => {
    // Le cas inverse du précédent, et le plus tordu : même pseudonyme des deux côtés, donc même identifiant
    // d'origine — mais la candidate est d'AVANT la colonne et ne porte aucune réponse. On pourrait déduire que
    // les deux sont de même nature, puisque md5 est déterministe. On ne le fait pas : l'identifiant du demandeur
    // vient du CLIENT, donc son « ce n'est pas une empreinte » est déclaratif, et s'en servir pour lever le doute
    // sur la ligne d'un tiers, c'est exactement le levier qu'on refuse de donner. Un inconnu reste un inconnu.
    await visit('c1', 'p:ambigu', { firstName: 'Ann', phone: '8135550142' }, { fingerprint: false });
    await visit('c2', 'p:ambigu', null, { fingerprint: null });
    const out = await resolve('c1', { phone: '8135550142', firstName: 'Ann' });
    expect(out['c2']).toEqual({ kept: false, why: 'empreinte de navigateur, pas une personne' });
  });

  it('compte AUSSI les contacts partagés des visites du même navigateur', async () => {
    // La règle écrite, commentée — et que rien ne vérifiait. Ann et Bob ont partagé un ordinateur ET donné le
    // même standard d'entreprise. Si le compteur de contacts partagés ignorait les visites reliées par le
    // navigateur, il rendrait zéro : le numéro passerait pour celui d'Ann seule, et Carl — ailleurs, même numéro,
    // pas de prénom — serait emporté. Le lien par navigateur ne prouve rien sur le numéro, il prouve seulement
    // que deux personnes ont utilisé la même machine.
    await visit('c1', 'v_bureau', { firstName: 'Ann', phone: '8005551212' }, { fingerprint: false });
    await visit('c2', 'v_bureau', { firstName: 'Bob', phone: '8005551212' }, { fingerprint: false });
    await visit('c3', 'v_carl', { firstName: null, phone: '8005551212' }, { fingerprint: false });
    const out = await resolve('c1', { phone: '8005551212', firstName: 'Ann' });
    expect(out['c2']).toEqual({ kept: false, why: 'identité différente' });
    expect(out['c3']).toEqual({ kept: false, why: "contact partagé par quelqu'un d'autre" });
  });

  it('élargit par le COURRIEL, et un courriel différent contredit une identité', async () => {
    // La moitié de la clé d'identité n'était jugée nulle part : aucun des tests n'utilisait de courriel, ni comme
    // conflit, ni comme moyen d'élargir. Les deux sens sont ici.
    await visit('c1', 'v_ann', { firstName: 'Ann', email: 'ann@x.co', phone: '8135550142' }, { fingerprint: false });
    await visit('c2', 'v_ailleurs', { firstName: null, email: 'ann@x.co' }, { fingerprint: false });
    const out = await resolve('c1', { phone: '8135550142', email: 'ann@x.co', firstName: 'Ann' });
    expect(out['c2']).toEqual({ kept: true, why: 'même contact' });

    // Et le même numéro sous un AUTRE courriel n'est pas la même personne — sans ce terme, la ligne de Bob
    // partait : prénom, nom, courriel et texte de consentement détruits sur la demande d'Ann.
    await visit('c3', 'v_bob', { firstName: null, email: 'bob@x.co', phone: '8135550142' }, { fingerprint: false });
    const second = await resolve('c1', { phone: '8135550142', email: 'ann@x.co', firstName: 'Ann' });
    expect(second['c3']).toEqual({ kept: false, why: 'identité différente' });
  });

  it("n'emporte pas la visite d'un tiers sur le seul lien du navigateur", async () => {
    // Un ordinateur familial, un poste partagé au bureau : un seul cookie pour deux personnes. Ann demande un
    // rappel en ne laissant QU'UN numéro ; Bob a laissé prénom, courriel et son texte de consentement, sans
    // numéro. Aucun des trois termes du conflit n'est calculable — ils sont gardés des deux côtés par
    // « IS NOT NULL » — donc rien ne contredit rien, et la pierre tombale partait sur la ligne de Bob : sa
    // preuve TCPA détruite, sur la demande de quelqu'un d'autre. La règle des deux identifiants concordants
    // existait pour le contact ; elle n'avait pas été portée au navigateur.
    await visit('c1', 'v_maison', { firstName: null, phone: '8135550142' }, { fingerprint: false });
    await visit('c2', 'v_maison', { firstName: 'Bob', email: 'bob@x.co' }, { fingerprint: false });
    const out = await resolve('c1', { phone: '8135550142' });
    expect(out['c1'].kept).toBe(true);
    expect(out['c2']).toEqual({ kept: false, why: 'navigateur partagé, identité non confirmée' });
  });

  it('emporte la visite du même navigateur dès QU\'UN identifiant la confirme', async () => {
    // L'autre côté de la même règle : il ne s'agit pas de fermer le chemin du navigateur, il s'agit de ne pas
    // emporter une visite qui porte le contact de QUELQU'UN D'AUTRE. Ici c'est bien la même personne.
    await visit('c1', 'v_ann', { firstName: 'Ann', phone: '8135550142' }, { fingerprint: false });
    await visit('c2', 'v_ann', { firstName: 'Ann' }, { fingerprint: false });
    const out = await resolve('c1', { phone: '8135550142', firstName: 'Ann' });
    expect(out['c2']).toEqual({ kept: true, why: 'même navigateur' });
  });

  it('reconnaît les visites de la même personne de part et d\'autre de la rétention', async () => {
    // La rétention remplace chaque nuit « v_ann » par « p: » || md5(visitor_id), visite par visite selon son âge.
    // Le lendemain, une visite purgée et une visite récente de la MÊME personne ne se reconnaissaient plus : la
    // demande d'effacement n'emportait plus la sœur, ne la rapportait même pas comme écartée, et la route
    // répondait « effacé » pendant que le code postal, l'État et les réponses du quiz restaient lisibles.
    const pseudo = 'p:' + createHash('md5').update('v_ann').digest('hex');
    await visit('c1', pseudo, { firstName: 'Ann', phone: '8135550142' }, { fingerprint: false });
    await visit('c2', 'v_ann', { firstName: 'Ann', phone: '8135550142' }, { fingerprint: false });
    const fromFresh = await resolve('c2', { phone: '8135550142', firstName: 'Ann' });
    expect(fromFresh['c1']).toEqual({ kept: true, why: 'même navigateur' });
    // Et dans l'autre sens : la demande peut aussi arriver depuis la visite déjà purgée.
    const fromPurged = await resolve('c1', { phone: '8135550142', firstName: 'Ann' });
    expect(fromPurged['c2']).toEqual({ kept: true, why: 'même navigateur' });
  });

  it('va CHERCHER la visite purgée qu\'aucun contact ne peut plus retrouver', async () => {
    // ARBITRAGE ÉCRIT : une ligne purgée sur un navigateur partagé est indiscernable de celle d'un tiers —
    // c'est le scénario même où la preuve de consentement de quelqu'un d'autre partait. On ne l'emporte donc
    // PAS. Ce que ce test garantit, c'est qu'elle est TROUVÉE et NOMMÉE : sans la reconnaissance du
    // pseudonyme dans la clause de recherche, elle n'entrerait même pas dans les candidates, et la route
    // répondrait « effacé » sans rien dire du code postal, de l'État et du quiz restés lisibles.
    // Le cas réel, et le seul qui prouve la clause de recherche : la visite d'hier a déjà été purgée, donc sa
    // ligne de lead est vide. Ni le numéro ni le courriel ne peuvent la ramener — seul le lien de navigateur le
    // peut, et il n'a survécu que sous sa forme pseudonymisée. Sans la reconnaissance du pseudonyme DANS LA
    // RECHERCHE, cette visite n'entre même pas dans l'ensemble des candidates : elle n'est ni emportée, ni
    // rapportée. Le code postal, l'État et les réponses du quiz y restent, et la route répond « effacé ».
    const pseudo = 'p:' + createHash('md5').update('v_ann').digest('hex');
    await visit('c1', pseudo, { firstName: null, phone: null, email: null }, { fingerprint: false });
    await visit('c2', 'v_ann', { firstName: 'Ann', phone: '8135550142' }, { fingerprint: false });
    const out = await resolve('c2', { phone: '8135550142', firstName: 'Ann' });
    expect(out['c1']).toEqual({ kept: false, why: 'navigateur partagé, identité non confirmée' });
  });

  it("n'emporte pas une visite dont le NOM DE FAMILLE contredit celui du demandeur", async () => {
    // Le nom de famille était le trou du tour 18 : `hasContact` l'accepte comme seul contact, donc une ligne
    // « Smith + texte de consentement, sans numéro ni courriel » existe vraiment — et rien ne pouvait la
    // contredire. Ici il contredit, et c'est la seule chose qui peut le faire : les deux visites partagent le
    // même numéro et le même prénom.
    await visit('c1', 'v_ann', { firstName: 'Ann', lastName: 'Dupont', phone: '8135550142' }, { fingerprint: false });
    await visit('c2', 'v_autre', { firstName: 'Ann', lastName: 'Smith', phone: '8135550142' }, { fingerprint: false });
    const out = await resolve('c1', { phone: '8135550142', firstName: 'Ann', lastName: 'Dupont' });
    expect(out['c2']).toEqual({ kept: false, why: 'identité différente' });
  });

  it('emporte une visite que le seul NOM DE FAMILLE confirme, avec le numéro', async () => {
    // L'autre sens : le nom de famille compte comme identifiant confirmé. Sans lui dans le compte, cette visite
    // n'aurait qu'un seul identifiant confirmé (le numéro) et serait écartée — un effacement plus étroit que ce
    // que la personne a demandé, sans raison.
    await visit('c1', 'v_ann', { firstName: null, lastName: 'Dupont', phone: '8135550142' }, { fingerprint: false });
    await visit('c2', 'v_autre', { firstName: null, lastName: 'Dupont', phone: '8135550142' }, { fingerprint: false });
    const out = await resolve('c1', { phone: '8135550142', lastName: 'Dupont' });
    expect(out['c2']).toEqual({ kept: true, why: 'même contact' });
  });

  it("n'emporte pas un tiers qui ne partage QUE le numéro, même sans contradiction", async () => {
    // Le compteur de contacts partagés ne voit un partage que s'il y a CONTRADICTION : il protège donc ceux qui
    // ont donné le plus de données et abandonne celui qui n'a laissé que le standard de son entreprise et son
    // texte de consentement. Ann porte bien deux identifiants, donc l'élargissement par contact est ouvert —
    // c'est la confirmation côté CANDIDAT qui manque, et c'est elle qu'on exige désormais.
    await visit('c1', 'v_ann', { firstName: 'Ann', phone: '8005551212' }, { fingerprint: false });
    await visit('c2', 'v_bob', { firstName: null, phone: '8005551212' }, { fingerprint: false });
    const out = await resolve('c1', { phone: '8005551212', firstName: 'Ann' });
    expect(out['c2']).toEqual({ kept: false, why: 'contact partagé, identité non confirmée' });
  });

  it('élargit par contact quand DEUX identifiants concordent', async () => {
    await visit('c1', 'v_ann', { firstName: 'Ann', phone: '8135550142' }, { fingerprint: false });
    await visit('c2', 'v_autre', { firstName: 'Ann', phone: '8135550142' }, { fingerprint: false });
    const out = await resolve('c1', { phone: '8135550142', firstName: 'Ann' });
    expect(out['c2']).toEqual({ kept: true, why: 'même contact' });
  });

  it("n'emporte personne quand le demandeur n'a qu'un numéro et que ce numéro est partagé", async () => {
    // LE SECOND BLOQUANT DU TOUR 15, et le plus cher. Une demande de rappel n'envoie souvent qu'un numéro : pas de
    // prénom, pas de courriel. Les trois termes du conflit sont alors gardés par « IS NOT NULL » — aucun ne peut
    // être vrai. Le compteur de contacts partagés restait à zéro, et un standard d'entreprise emportait les lignes
    // de tous ceux qui l'avaient donné : prénom, nom, courriel ET `consent_text` détruits. La preuve TCPA de deux
    // personnes partait sur la demande d'une troisième, irréversiblement.
    await visit('c1', 'v_ann', { firstName: null, phone: '8005551212' }, { fingerprint: false });
    await visit('c2', 'v_bob', { firstName: 'Bob', phone: '8005551212' }, { fingerprint: false });
    await visit('c3', 'v_carl', { firstName: 'Carl', phone: '8005551212' }, { fingerprint: false });
    const out = await resolve('c1', { phone: '8005551212' });
    expect(out['c1'].kept).toBe(true); // la sienne, toujours
    expect(out['c2'].kept).toBe(false);
    expect(out['c3'].kept).toBe(false);
    expect(out['c2'].why).toBe('contact partagé, identité non confirmée');
  });

  it("refuse d'élargir sur un seul identifiant, même quand personne d'autre ne le porte", async () => {
    // Le prix assumé du correctif : un numéro seul ne confirme pas une identité, et rien dans cette base ne peut
    // dire si l'autre visite est celle d'Ann ou celle de quelqu'un qui a donné le même numéro. On laisse donc du
    // travail à un humain — et la réponse le DIT (`skipped`), au lieu d'annoncer « effacé » sur un numéro resté
    // appelable ou de détruire la ligne d'un tiers.
    await visit('c1', 'v_ann', { firstName: null, phone: '8135550142' }, { fingerprint: false });
    await visit('c2', 'v_autre', { firstName: null, phone: '8135550142' }, { fingerprint: false });
    const out = await resolve('c1', { phone: '8135550142' });
    expect(out['c2']).toEqual({ kept: false, why: 'contact partagé, identité non confirmée' });
  });

  it('… mais la visite du même navigateur passe toujours, elle ne dépend pas du contact', async () => {
    await visit('c1', 'v_ann', { firstName: null, phone: '8135550142' }, { fingerprint: false });
    await visit('c2', 'v_ann', null, { fingerprint: false });
    const out = await resolve('c1', { phone: '8135550142' });
    expect(out['c2']).toEqual({ kept: true, why: 'même navigateur' });
  });

  it('ne rend jamais la visite demandée comme écartée, même sans aucun contact', async () => {
    await visit('c1', null, undefined, { fingerprint: null });
    const out = await resolve('c1', {});
    expect(out['c1']).toEqual({ kept: true, why: 'demandée' });
  });
});
