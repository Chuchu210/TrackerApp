import type { PGlite } from '@electric-sql/pglite';
import { scrubClicks } from '../src/leads/lead-sql';
import { freshDb, pglitePrisma } from './pg/pglite-prisma';

// JURY R10-6 — l'effacement laisse la personne dans `clicks.referrer` quand elle est dans le CHEMIN ou le FRAGMENT.
// Pour un lead d'intake, `referrer` = `dto.pageUrl` (leads.service.ts:680), écrit par le partenaire. Le SQL ne coupe
// qu'à « ? » (lead-sql.ts:403-406). La liste de suppression, elle, lit bien `#tel=…` et `#/merci/…` (tour 28).
describe('R10-6 — referrer après effacement (Postgres)', () => {
  let db: PGlite;
  let client: ReturnType<typeof pglitePrisma>;
  beforeEach(async () => {
    ({ db, client } = await freshDb(['Click', 'Conversion']));
  });
  afterEach(async () => {
    await db.close();
  });

  it.each([
    'https://partner.example/merci#tel=8135550142',
    'https://partner.example/#/merci/8135550142',
    'https://partner.example/confirm/ann@gmail.com',
  ])('%s : plus de numéro ni d’adresse après effacement', async (url) => {
    await db.query(
      `INSERT INTO "clicks" ("id","click_id","campaign_id","referrer","created_at") VALUES (gen_random_uuid()::text,'c1','camp-1',$1,now())`,
      [url],
    );
    await scrubClicks(client as never, ['c1'], 'erased');
    const { rows } = await db.query<{ referrer: string | null }>(`SELECT "referrer" FROM "clicks" WHERE "click_id"='c1'`);
    expect(rows[0].referrer ?? '').not.toMatch(/5550142|ann@gmail\.com/);
  });
});
