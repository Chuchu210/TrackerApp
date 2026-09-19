import type { PGlite } from '@electric-sql/pglite';
import { scrubClicks } from '../src/leads/lead-sql';
import { clickGroupForDimension } from '../src/analytics/campaign-drilldown.util';
import { freshDb, pglitePrisma } from './pg/pglite-prisma';

// JURÉ R12-4 — la rétention coupe le référent de façon DIFFÉRENTE selon que la visite a converti ou non (R11-5 :
// « une visite qui porte une personne garde l'origine ; sans personne, le chemin »). Pour une même page d'éditeur,
// les visites converties partent sous « https://news.example/ », les autres restent sous l'article : passé la
// rétention, l'onglet Referrer du drill-down (groupFromValue = valeur brute, campaign-drilldown.util.ts:217) montre
// l'article à 0 lead et l'origine avec les leads — le taux de conversion par référent est faux, et biaisé.
describe('R12-4 — rétention : deux visites du même référent finissent dans deux lignes du rapport', () => {
  let db: PGlite;
  let client: ReturnType<typeof pglitePrisma>;
  beforeEach(async () => {
    ({ db, client } = await freshDb(['Click']));
  });
  afterEach(async () => {
    await db.close();
  });

  it('la visite convertie et la visite non convertie du même article restent dans le même groupe « Referrer »', async () => {
    const ref = 'https://news.example/2025/best-auto-insurance-rates?utm_source=x';
    await db.query(
      `INSERT INTO "clicks" ("id","click_id","campaign_id","referrer","created_at") VALUES
        (gen_random_uuid()::text,'lead','camp-1',$1,now()), (gen_random_uuid()::text,'visite','camp-1',$1,now())`,
      [ref],
    );
    // Ce que `purgePersonalData` puis `purgeOldVisits` font. Porté au tour 31 : `scrubClicks` n'a plus de liste
    // « avec personne » (4ᵉ argument retiré) — la règle est la même pour chaque visite, c'est ce que ce test demande.
    await scrubClicks(client as never, ['lead'], 'purged');
    await scrubClicks(client as never, ['visite'], 'purged');
    const { rows } = await db.query<{ click_id: string; referrer: string | null }>(`SELECT "click_id","referrer" FROM "clicks"`);
    const groupe = (id: string) => clickGroupForDimension('referrer', { referrer: rows.find((r) => r.click_id === id)!.referrer } as never).key;
    expect(groupe('lead')).toBe(groupe('visite'));
  });
});
