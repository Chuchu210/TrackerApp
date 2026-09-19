import type { PGlite } from '@electric-sql/pglite';
import { referrerSansPersonne } from '../src/leads/lead-fields';
import { scrubClicks } from '../src/leads/lead-sql';
import { casDe } from './fuzz-personne.gen';
import { freshDb, pglitePrisma } from './pg/pglite-prisma';

// Tour 29 puis 31 — P3 dans le SQL. Le référent passe d'abord par `referrerSansPersonne` (JavaScript, le MÊME détecteur
// que la liste de suppression : le segment de chemin qui porte une personne devient `***`), puis par la requête
// `scrubClicks`, qui ne sait pas lire une personne et ne fait que retirer query string, fragment, identifiants (et le
// chemin à l'effacement). Ce banc prouve l'équivalence : sur les URL plantées du banc « contact planté »,
//  · SQL(JS(x)) ne contient plus la personne, à l'effacement comme à la rétention ;
//  · à la rétention, SQL(JS(x)) = JS(x) — le SQL ne décide rien de plus que le détecteur, et ne remet rien.
describe('tour 31 — P3 : le référent, JavaScript puis SQL (Postgres)', () => {
  let db: PGlite;
  let client: ReturnType<typeof pglitePrisma>;
  beforeEach(async () => {
    ({ db, client } = await freshDb(['Click']));
  });
  afterEach(async () => {
    await db.close();
  });

  it.each(['erased', 'purged'] as const)('%s : 600 URL plantées — plus de personne, et le SQL ne change rien de plus', async (raison) => {
    const cas = [...casDe(2929, 4000)].filter((c) => c.personne && c.urls.length).slice(0, 600);
    expect(cas.length).toBe(600);
    const ids = cas.map((_, i) => `c${i}`);
    const js = cas.map((c) => referrerSansPersonne(c.urls[0], raison));
    await db.query(
      `INSERT INTO "clicks" ("id","click_id","campaign_id","referrer","created_at")
       SELECT gen_random_uuid()::text, id, 'camp-1', url, now() FROM unnest($1::text[], $2::text[]) AS t(id, url)`,
      [ids, js],
    );
    await scrubClicks(client as never, ids, raison);
    const { rows } = await db.query<{ click_id: string; referrer: string | null }>(`SELECT "click_id", "referrer" FROM "clicks"`);
    const parId = new Map(rows.map((r) => [r.click_id, r.referrer]));
    const survivants = cas
      .map((c, i) => ({ c, reste: decodeURIComponent(parId.get(`c${i}`) ?? '').toLowerCase() }))
      .filter(({ c, reste }) => c.personne!.trace.test(reste))
      .map(({ c, reste }) => `${c.urls[0]} → ${reste}`);
    expect(survivants).toEqual([]);
    if (raison === 'purged') {
      const differents = cas.map((c, i) => [c.urls[0], js[i], parId.get(`c${i}`)]).filter(([, j, s]) => j !== s);
      expect(differents).toEqual([]);
    }
  }, 60000);

  it('rétention : le chemin reste, seul le segment qui porte la personne est masqué — que la visite ait converti ou non', async () => {
    const urls = [
      'https://news.example/2025/best-rates?utm_source=x#top',
      'https://user:pw@news.example/a',
      'lp.example/merci?tel=8135550142',
      'Ann 813-555-0142',
      'https://lp.example/confirm/ann@gmail.com/step-2',
      'https://lp.example/u/813-555-0142',
    ];
    const js = urls.map((u) => referrerSansPersonne(u, 'purged'));
    expect(js).toEqual([
      'https://news.example/2025/best-rates',
      'https://news.example/a',
      'lp.example',
      null,
      'https://lp.example/confirm/***/step-2',
      'https://lp.example/u/***',
    ]);
    await db.query(
      `INSERT INTO "clicks" ("id","click_id","campaign_id","referrer","created_at")
       SELECT gen_random_uuid()::text, id, 'camp-1', url, now() FROM unnest($1::text[], $2::text[]) AS t(id, url)`,
      [urls.map((_, i) => `r${i}`), js],
    );
    await scrubClicks(client as never, urls.map((_, i) => `r${i}`), 'purged');
    const { rows } = await db.query<{ referrer: string | null }>(`SELECT "referrer" FROM "clicks" ORDER BY "click_id"`);
    expect(rows.map((r) => r.referrer)).toEqual(js);
  });

  it('effacement : l’origine seule ; identifiants de connexion retirés ; sans schéma, l’hôte', async () => {
    await db.query(
      `INSERT INTO "clicks" ("id","click_id","campaign_id","referrer","created_at") VALUES
         (gen_random_uuid()::text,'u1','camp-1','https://ann@gmail.com@partner.example/merci?x=1',now()),
         (gen_random_uuid()::text,'u2','camp-1','https://facebook.com',now()),
         (gen_random_uuid()::text,'u3','camp-1','lp.example/confirm/ann@gmail.com',now())`,
    );
    await scrubClicks(client as never, ['u1', 'u2', 'u3'], 'erased');
    const { rows } = await db.query<{ click_id: string; referrer: string | null }>(
      `SELECT "click_id", "referrer" FROM "clicks" ORDER BY "click_id"`,
    );
    expect(rows).toEqual([
      { click_id: 'u1', referrer: 'https://partner.example/' },
      { click_id: 'u2', referrer: 'https://facebook.com' },
      // Sans schéma : l'hôte seul (NULL devenait « Unassigned » dans le drill-down, juré r11).
      { click_id: 'u3', referrer: 'lp.example' },
    ]);
    // Et le JavaScript, sur les mêmes URL, dit la même chose.
    expect(['https://ann@gmail.com@partner.example/merci?x=1', 'https://facebook.com', 'lp.example/confirm/ann@gmail.com'].map((u) => referrerSansPersonne(u, 'erased'))).toEqual(
      rows.map((r) => r.referrer),
    );
  });
});
