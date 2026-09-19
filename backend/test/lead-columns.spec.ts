import { readFileSync } from 'fs';
import { join } from 'path';
import { COLONNES, colonnesDe, ecartsAvecLeSchema, estLue, type Colonne } from '../src/leads/lead-columns';
import { affectationsSql } from '../src/leads/lead-sql';

/**
 * Tour 32 — le registre des colonnes (méthode A du coordinateur, juré r13) : chaque colonne texte ou JSON des tables
 * de visite et de lead est classée UNE fois, et la lecture comme le nettoyage en sont générés. Ce test lit le vrai
 * schéma Prisma : une colonne ajoutée sans décision, ou une colonne classée qui a disparu, le fait échouer.
 */
const SCHEMA = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');

describe('registre des colonnes — le schéma et le registre disent la même chose', () => {
  it('toutes les colonnes texte/JSON de clicks, conversions, leads, postback_logs sont classées, et elles seules', () => {
    expect(ecartsAvecLeSchema(SCHEMA)).toEqual([]);
  });

  it('une colonne AJOUTÉE au schéma sans être classée fait échouer le test (injection)', () => {
    const injecte = SCHEMA.replace(/^model Click \{/m, 'model Click {\n  utmNote String? @map("utm_note")');
    expect(injecte).not.toBe(SCHEMA);
    expect(ecartsAvecLeSchema(injecte)).toEqual(['colonne non classée : clicks.utm_note (Click.utmNote)']);
    // Et du JSON aussi : une colonne JSON est un texte comme un autre pour une adresse.
    const json = SCHEMA.replace(/^model Conversion \{/m, 'model Conversion {\n  extra Json?');
    expect(ecartsAvecLeSchema(json)).toEqual(['colonne non classée : conversions.extra (Conversion.extra)']);
  });

  it('une colonne classée qui n’existe plus, ou renommée, fait échouer le test', () => {
    const fantome: Colonne = { table: 'clicks', champ: 'utmFantome', colonne: 'utm_fantome', classe: 'contact', nettoyage: 'caviarder' };
    expect(ecartsAvecLeSchema(SCHEMA, [...COLONNES, fantome])).toEqual(['colonne classée mais absente du schéma : clicks.utm_fantome']);
    const renomme = COLONNES.map((c) => (c.table === 'clicks' && c.champ === 'utmTerm' ? { ...c, colonne: 'utm_terme' } : c));
    expect(ecartsAvecLeSchema(SCHEMA, renomme)).toEqual([
      'colonne renommée : clicks.utmTerm est « utm_term », le registre dit « utm_terme »',
    ]);
  });

  it('une colonne lue DOIT être nettoyée, et une colonne classée deux fois est refusée', () => {
    const lueGardee = COLONNES.map((c) => (c.colonne === 'utm_term' ? { ...c, nettoyage: 'garder' as const } : c));
    expect(ecartsAvecLeSchema(SCHEMA, lueGardee)).toEqual([
      'règle « garder » incohérente pour une colonne contact : clicks.utm_term',
    ]);
    const double = [...COLONNES, COLONNES.find((c) => c.colonne === 'ad_title')!];
    expect(ecartsAvecLeSchema(SCHEMA, double)).toEqual(['classée deux fois : clicks.ad_title']);
  });

  it('les colonnes que le juré r13 a trouvées hors du nettoyage sont lues ET nettoyées', () => {
    for (const nom of ['utm_term', 'utm_content', 'ad_title', 'content_name', 'publisher_name', 'lander_name', 'raw_params']) {
      const c = colonnesDe('clicks').find((x) => x.colonne === nom)!;
      expect(estLue(c)).toBe(true);
      expect(c.nettoyage).not.toBe('garder');
    }
    // Les identifiants ne sont PAS lus (onze chiffres Microsoft, version de Chrome, gclid).
    for (const nom of ['ad_id', 'site_id', 'browser_version', 'os_version', 'gclid', 'fbclid']) {
      expect(estLue(colonnesDe('clicks').find((x) => x.colonne === nom)!)).toBe(false);
    }
  });

  it('les SET SQL sont générés du registre : chaque colonne vidée, JSON ou URL y figure, les gardées non', () => {
    const sql = (t: 'clicks' | 'conversions', r: 'erased' | 'purged') => affectationsSql(t, r).map((s) => s.sql).join('\n');
    for (const t of ['clicks', 'conversions'] as const) {
      const texte = sql(t, 'erased');
      for (const c of colonnesDe(t)) {
        const present = texte.includes(`"${c.colonne}" =`);
        const attendu = !['garder', 'caviarder', 'urlSortante'].includes(c.nettoyage);
        expect([c.colonne, present]).toEqual([c.colonne, attendu]);
      }
    }
  });
});
