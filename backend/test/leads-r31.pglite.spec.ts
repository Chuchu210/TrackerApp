import type { PGlite } from '@electric-sql/pglite';
import { scrubClicks, scrubConversionMetadata } from '../src/leads/lead-sql';
import { freshDb, pglitePrisma } from './pg/pglite-prisma';

// Tour 31 — le filet SQL retire les clés de CONTACT avec la même liste blanche que la liste de suppression (comparées
// sans casse ni ponctuation), et les données personnelles non-contact avec leur propre liste.
describe('tour 31 — clés personnelles en SQL : la même classification que la liste (Postgres)', () => {
  let db: PGlite;
  let client: ReturnType<typeof pglitePrisma>;
  beforeEach(async () => {
    ({ db, client } = await freshDb(['Click', 'Conversion']));
  });
  afterEach(async () => {
    await db.close();
  });

  it('le référent, par le SQL SEUL à la rétention : query string, fragment et identifiants partent, le chemin reste', async () => {
    // Le banc de mutation l'a montré : derrière le JavaScript (`referrerSansPersonne`), cette règle SQL n'était plus
    // jamais exercée seule. Elle reste le filet pour toute ligne que le JavaScript n'aurait pas réécrite.
    await db.query(
      `INSERT INTO "clicks" ("id","click_id","campaign_id","referrer","created_at") VALUES
         ('k1','c1','camp-1','https://news.example/2025/a?utm_source=x#top',now()),
         ('k2','c2','camp-1','https://user:pw@news.example/b',now())`,
    );
    await scrubClicks(client as never, ['c1', 'c2'], 'purged');
    const { rows } = await db.query<{ referrer: string }>(`SELECT "referrer" FROM "clicks" ORDER BY "click_id"`);
    expect(rows.map((r) => r.referrer)).toEqual(['https://news.example/2025/a', 'https://news.example/b']);
  });

  it('métadonnées de conversion et paramètres d’atterrissage', async () => {
    const perso = { Phone_Number: '1', whatsapp: '2', 'e-mail': '3', CellPhone: '4', firstName: 'Ann', ip: '203.0.113.7' };
    const garde = { zip: '33610', amount: '12.00', utm_source: 'fb' };
    await db.query(
      `INSERT INTO "conversions" ("id","click_id","campaign_id","event_type","metadata","created_at")
       VALUES ('v1','c1','camp-1','lead',$1::jsonb,now())`,
      [JSON.stringify({ ...perso, ...garde })],
    );
    await db.query(
      `INSERT INTO "clicks" ("id","click_id","campaign_id","raw_params","created_at") VALUES ('k1','c1','camp-1',$1::jsonb,now())`,
      [JSON.stringify({ whatsapp: '8135550142', Mobile: 'x', utm_source: 'fb', q1: 'Yes' })],
    );
    await scrubConversionMetadata(client as never, ['c1'], 'purged');
    await scrubClicks(client as never, ['c1'], 'purged');
    const conv = await db.query<{ metadata: Record<string, string> }>(`SELECT "metadata" FROM "conversions"`);
    expect(conv.rows[0].metadata).toEqual(garde);
    const clic = await db.query<{ raw_params: Record<string, string> }>(`SELECT "raw_params" FROM "clicks"`);
    // `zip`, `state` : personnels à l'effacement seulement pour les métadonnées ; dans l'URL, ils partent toujours.
    expect(clic.rows[0].raw_params).toEqual({ utm_source: 'fb', q1: 'Yes' });
  });
});
