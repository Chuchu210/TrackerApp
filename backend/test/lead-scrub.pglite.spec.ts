import type { PGlite } from '@electric-sql/pglite';
import { scrubClicks, scrubConversionMetadata, visitsDueForPurge } from '../src/leads/lead-sql';
import { freshDb, pglitePrisma } from './pg/pglite-prisma';

/**
 * Les instructions qui EFFACENT réellement la personne, jouées contre un vrai Postgres.
 *
 * Le tour 16 avait branché pglite sur la requête qui décide QUI est emporté, et laissé sans couverture celles qui
 * font le travail : `$executeRaw`. Cinq mutants passaient alors la suite sans un échec — l'adresse IP qui reste,
 * une seule visite nettoyée sur trois, la variable libre où le lander range le nom, le `fbclid` à partir duquel
 * `fbc` se reconstruit et repart chez Meta au premier postback tardif. Une visite estampillée « effacée » dont la
 * personne est encore lisible est le pire état du système : elle a l'air finie, et plus rien ne repassera dessus.
 *
 * On assert donc COLONNE PAR COLONNE, et sur DEUX visites — la seconde tue à elle seule le mutant qui remplace
 * « toutes les visites de cette personne » par « la première ».
 */
describe('ce qu\'un effacement retire vraiment de la visite (Postgres)', () => {
  let db: PGlite;
  let client: ReturnType<typeof pglitePrisma>;

  beforeEach(async () => {
    ({ db, client } = await freshDb(['Click', 'Conversion']));
  });

  afterEach(async () => {
    await db.close();
  });

  async function visit(clickId: string) {
    await db.query(
      `INSERT INTO "clicks" (
         "id", "click_id", "campaign_id", "ip_address", "user_agent", "accept_language", "referrer",
         "request_headers", "fbclid", "gclid", "external_click_id", "tracking_id", "oppref", "obref",
         "custom_variable_1", "custom_variable_7", "raw_params", "visitor_id",
         "city", "region", "country", "created_at"
       ) VALUES (
         gen_random_uuid()::text, $1, 'camp-1', '203.0.113.7', 'Mozilla/5.0 iPhone', 'en-US',
         'https://facebook.com/r?email=ann@x.co', '{"x-forwarded-for":"203.0.113.7"}'::jsonb,
         'fb.1.1758000000123.987654321', 'gclid-abc', 'ext-abc', 'tk-abc', 'opp-1', 'ob-1',
         'Ann Dupont', '8135550142', '{"firstname":"Ann","phone":"8135550142","utm_source":"facebook"}'::jsonb,
         'v_ann', 'Tampa', 'Florida', 'US', now()
       )`,
      [clickId],
    );
    // TOUTES les variables libres, pas seulement deux : c'est là que le lander range ce qu'il veut, et l'export
    // Voluum les emporte. Quatre mutants survivaient parce que le décor n'en remplissait que deux.
    for (let i = 1; i <= 10; i += 1) {
      await db.query(`UPDATE "clicks" SET "custom_variable_${i}" = $2 WHERE "click_id" = $1`,
        [clickId, `Ann 813555014${i % 10}`]);
    }
  }

  async function conversion(clickId: string, id: string) {
    await db.query(
      `INSERT INTO "conversions" (
         "id", "click_id", "campaign_id", "event_type", "metadata", "incoming_postback_url",
         "incoming_postback_ip", "postback_param_1", "postback_param_3", "created_at"
       ) VALUES (
         $2, $1, 'camp-1', 'lead',
         '{"phone":"8135550142","email":"ann@x.co","payout":"32.50"}'::jsonb,
         'https://tk.example.com/p?cid=abc&email=ann@x.co', '203.0.113.7', 'ann@x.co', '8135550142', now()
       )`,
      [clickId, id],
    );
    // Les cinq paramètres de postback : « les acheteurs mettent couramment l'e-mail dans p1..p5 », dit le code —
    // et le décor n'en remplissait que deux, donc trois mutants passaient la suite sans un échec.
    for (let i = 1; i <= 5; i += 1) {
      await db.query(`UPDATE "conversions" SET "postback_param_${i}" = $2 WHERE "id" = $1`,
        [id, `ann${i}@x.co`]);
    }
  }

  async function row(table: string, clickId: string) {
    const out = await db.query<Record<string, unknown>>(
      `SELECT * FROM "${table}" WHERE "click_id" = $1`,
      [clickId],
    );
    return out.rows[0];
  }

  it('retire la personne de CHAQUE visite passée, pas seulement de la première', async () => {
    await visit('c1');
    await visit('c2');
    await scrubClicks(client as never, ['c1', 'c2'], 'erased');

    for (const clickId of ['c1', 'c2']) {
      const click = await row('clicks', clickId);
      // Ce que la visite garde d'une personne, colonne par colonne. Chacune a été trouvée sur une vraie visite.
      expect(click.ip_address).toBeNull();
      expect(click.user_agent).toBeNull();
      expect(click.accept_language).toBeNull();
      expect(click.request_headers).toBeNull();
      // Les graines publicitaires : `fbc` se reconstruit à partir de `fbclid` et repart chez Meta au premier
      // postback tardif. En effacer une sans l'autre ne sert à rien.
      expect(click.fbclid).toBeNull();
      expect(click.gclid).toBeNull();
      expect(click.external_click_id).toBeNull();
      expect(click.tracking_id).toBeNull();
      expect(click.oppref).toBeNull();
      expect(click.obref).toBeNull();
      // Les variables libres : c'est là que le lander range ce qu'il veut, et l'export Voluum les emporte.
      for (let i = 1; i <= 10; i += 1) {
        expect(click[`custom_variable_${i}`]).toBeNull();
      }
      // La ville et la région désignent quelqu'un une fois croisées avec une date et une campagne — c'est le
      // motif exact pour lequel la pierre tombale efface le code postal et l'État. Le pays reste : il ne
      // désigne personne, et les rapports le comptent.
      expect(click.city).toBeNull();
      expect(click.region).toBeNull();
      expect(click.country).toBe('US');
      // Le référent ne garde que son origine : un onglet du drill-down le lit, et le chemin comme le fragment
      // portent la personne aussi souvent que la query string (juré r10 : « /confirm/ann@… », « #tel=… »).
      expect(click.referrer).toBe('https://facebook.com/');
      expect(click.raw_params).toEqual({ utm_source: 'facebook' });
    }
  });

  it('coupe le lien entre les visites sur un effacement, et le pseudonymise sur une purge', async () => {
    await visit('c1');
    await scrubClicks(client as never, ['c1'], 'erased');
    expect((await row('clicks', 'c1')).visitor_id).toBeNull();

    // La rétention, elle, garde un pseudonyme stable : sinon le compte des visiteurs uniques changerait
    // rétroactivement chaque nuit, une personne revenue trois fois devenant trois visiteurs.
    await visit('c2');
    await scrubClicks(client as never, ['c2'], 'purged');
    const purged = await row('clicks', 'c2');
    expect(purged.visitor_id).toMatch(/^p:[0-9a-f]{32}$/);
    // …et la rétention GARDE la géographie : ce sont les chiffres que les rapports lisent, et sans nom ni numéro
    // à côté d'eux, une ville ne désigne plus personne.
    expect(purged.city).toBe('Tampa');
    expect(purged.region).toBe('Florida');
  });

  it('vide les colonnes de postback de la conversion et masque la query string entrante', async () => {
    await visit('c1');
    await conversion('c1', 'conv-1');
    await scrubConversionMetadata(client as never, ['c1'], 'erased');

    const conv = await row('conversions', 'c1');
    expect(conv.metadata).toEqual({ payout: '32.50' }); // le paiement reste, la personne part
    expect(conv.incoming_postback_ip).toBeNull();
    for (let i = 1; i <= 5; i += 1) {
      expect(conv[`postback_param_${i}`]).toBeNull();
    }
    // L'URL garde son chemin — l'écran « postbacks entrants » ne liste que les lignes qui en ont une — et perd
    // tout ce qui suit le point d'interrogation.
    expect(conv.incoming_postback_url).toBe('https://tk.example.com/p?[erased]');
  });

  it("coupe le lien même sur une visite que la rétention avait déjà pseudonymisée", async () => {
    // Le pseudonyme est STABLE : il relie encore les visites entre elles. Le laisser en place sur un effacement
    // revenait à ne pas couper le lien — la personne effacée restait reliée à ses autres visites, et une
    // demande venue d'ailleurs pouvait encore les retrouver.
    await visit('c1');
    await scrubClicks(client as never, ['c1'], 'purged');
    expect((await row('clicks', 'c1')).visitor_id).toMatch(/^p:/);
    await scrubClicks(client as never, ['c1'], 'erased');
    expect((await row('clicks', 'c1')).visitor_id).toBeNull();
  });

  it('choisit les visites que la rétention doit purger, et pas les autres', async () => {
    // Personne ne jouait cette requête : deux mutants passaient la suite sans un échec, dont un qui inversait la
    // condition de marque — plus aucune visite n'était jamais balayée, et les personnes qui n'ont pas de ligne
    // de lead (adresse arrivée par postback, nom dans la query string) restaient lisibles pour toujours.
    const older = new Date('2026-01-01T00:00:00Z');
    const recent = new Date('2026-09-10T00:00:00Z');
    const cutoff = new Date('2026-06-01T00:00:00Z');

    const click = async (id: string, at: Date, scrubbed: Date | null) =>
      db.query(
        `INSERT INTO "clicks" ("id", "click_id", "campaign_id", "created_at", "scrubbed_at")
         VALUES (gen_random_uuid()::text, $1, 'camp-1', $2, $3)`,
        [id, at.toISOString(), scrubbed ? scrubbed.toISOString() : null],
      );

    await click('vieille', older, null); // à purger
    await click('deja-faite', older, older); // déjà nettoyée : on ne repasse pas
    await click('recente', recent, null); // trop jeune : la rétention ne l'a pas encore rattrapée
    await click('conversion-tardive', older, older); // clic marqué…
    await db.query(
      `INSERT INTO "conversions" ("id", "click_id", "campaign_id", "event_type", "created_at", "scrubbed_at")
       VALUES (gen_random_uuid()::text, 'conversion-tardive', 'camp-1', 'lead', $1, NULL)`,
      [older.toISOString()],
    ); // …mais une conversion, elle, ne l'est pas : un postback tardif l'a écrite après le passage.

    const due = await visitsDueForPurge(client as never, cutoff, 100);
    expect(due.map((r) => r.click_id).sort()).toEqual(['conversion-tardive', 'vieille']);
  });

  it("pseudonymise un « p: » que le VISITEUR s'est choisi, au lieu de le prendre pour le nôtre", async () => {
    // `visitor_id` vient du client sans validation (`tk_vid` en query, cookie `tk-vid`) : « p:ann@x.co » est une
    // valeur d'entrée ordinaire. La rétention gardait intact tout ce qui commençait par « p: », en le prenant
    // pour un pseudonyme qu'elle avait elle-même posé — donc une adresse choisie par le visiteur traversait
    // chaque nuit sans être touchée. Le nôtre a une forme : « p: » suivi de 32 caractères hexadécimaux.
    await visit('c1');
    await db.query(`UPDATE "clicks" SET "visitor_id" = 'p:ann@x.co' WHERE "click_id" = 'c1'`);
    await scrubClicks(client as never, ['c1'], 'purged');
    expect((await row('clicks', 'c1')).visitor_id).toMatch(/^p:[0-9a-f]{32}$/);

    // Et le vrai pseudonyme, lui, ne bouge plus : sinon le compte des visiteurs uniques changerait chaque nuit.
    const posed = (await row('clicks', 'c1')).visitor_id;
    await scrubClicks(client as never, ['c1'], 'purged');
    expect((await row('clicks', 'c1')).visitor_id).toBe(posed);
  });

  it("ne détruit pas un raw_params qui n'est pas un objet", async () => {
    // Un tableau est du JSON parfaitement légal, et un lander en envoie. La branche ELSE le remplaçait par NULL :
    // une purge nocturne détruisait alors des paramètres de campagne qui ne désignaient personne.
    await visit('c1');
    await db.query(`UPDATE "clicks" SET "raw_params" = '["facebook","fr"]'::jsonb WHERE "click_id" = 'c1'`);
    await scrubClicks(client as never, ['c1'], 'purged');
    expect((await row('clicks', 'c1')).raw_params).toEqual(['facebook', 'fr']);
  });
});
