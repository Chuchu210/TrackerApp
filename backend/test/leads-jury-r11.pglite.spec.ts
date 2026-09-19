import type { PGlite } from '@electric-sql/pglite';
import { scrubClicks } from '../src/leads/lead-sql';
import { freshDb, pglitePrisma } from './pg/pglite-prisma';

// JURÉ R11-5 (constat) — la RÉTENTION (toutes les visites de plus de LEADS_PII_RETENTION_DAYS, leads ou non) réduit
// désormais le référent à son origine. L'onglet « Referrer » du drill-down (campaign-drilldown.util.ts:217) et l'export
// Voluum (voluum-export.service.ts:97) le lisent. Au tour r10, la rétention ne coupait qu'à « ? ».
describe('R11-5 — référent à la rétention (Postgres)', () => {
  let db: PGlite;
  let client: ReturnType<typeof pglitePrisma>;
  beforeEach(async () => {
    ({ db, client } = await freshDb(['Click']));
  });
  afterEach(async () => {
    await db.close();
  });

  it('une visite SANS personne garde le chemin de son référent (article éditeur) après la rétention', async () => {
    await db.query(
      `INSERT INTO "clicks" ("id","click_id","campaign_id","referrer","created_at") VALUES
        (gen_random_uuid()::text,'a','camp-1','https://news.example/2025/best-auto-insurance-rates',now()),
        (gen_random_uuid()::text,'b','camp-1','facebook.com',now())`,
    );
    await scrubClicks(client as never, ['a', 'b'], 'purged');
    const { rows } = await db.query<{ click_id: string; referrer: string | null }>(`SELECT "click_id","referrer" FROM "clicks" ORDER BY 1`);
    expect(rows).toEqual([
      { click_id: 'a', referrer: 'https://news.example/2025/best-auto-insurance-rates' },
      { click_id: 'b', referrer: 'facebook.com' },
    ]);
  });
});
