import { readFileSync } from 'fs';
import { join } from 'path';
import { PGlite } from '@electric-sql/pglite';

/**
 * Un vrai Postgres, dans le processus de test.
 *
 * Les règles qui protègent une personne — quelles visites une demande d'effacement emporte, lesquelles elle
 * REFUSE d'emporter — vivent dans du SQL brut. Or `$queryRaw` est simulé dans tous les tests unitaires : le juré
 * du tour 15 l'a montré en cassant trois fois la requête sans faire tomber un seul test. Une règle que personne
 * ne vérifie n'est pas une règle, et celle-ci décide de détruire la preuve de consentement d'un tiers.
 *
 * `@electric-sql/pglite` est Postgres compilé en WebAssembly : `md5`, `split_part`, `FILTER`, les CTE et les
 * paramètres se comportent comme en production, sans serveur à installer ni base à créer. Le banc d'intégration
 * `test/integration/*.pg.spec.ts` reste la référence pour ce qui touche au vrai moteur (index, verrous,
 * concurrence) ; celui-ci rend la LOGIQUE de la requête exécutable partout, tout le temps.
 */

const SCHEMA_PATH = join(__dirname, '..', '..', 'prisma', 'schema.prisma');

const SCALARS: Record<string, string> = {
  String: 'text',
  Boolean: 'boolean',
  Int: 'integer',
  BigInt: 'bigint',
  Float: 'double precision',
  Decimal: 'numeric(18,6)',
  DateTime: 'timestamptz',
  Json: 'jsonb',
  Bytes: 'bytea',
};

type Column = { field: string; column: string; ddl: string };
export type Model = { name: string; table: string; columns: Column[]; cleComposee?: string[] };

function blocks(source: string, keyword: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const re = new RegExp(`^${keyword}\\s+(\\w+)\\s*\\{([\\s\\S]*?)^\\}`, 'gm');
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) out.push({ name: m[1], body: m[2] });
  return out;
}

function defaultClause(attrs: string, pgType: string): string {
  // Les fonctions d'abord : `@default(now())` porte une parenthèse interne, et une expression trop pressée y lisait
  // « now( » — toutes les colonnes `created_at` naissaient alors sans valeur par défaut, donc NOT NULL sans rien.
  if (/@default\(now\(\)\)/.test(attrs)) return ' DEFAULT now()';
  if (/@default\((uuid|cuid)\((\d*)\)\)/.test(attrs)) return ' DEFAULT gen_random_uuid()::text';
  if (/@default\(autoincrement\(\)\)/.test(attrs)) return '';
  if (/@default\(dbgenerated\(/.test(attrs)) return '';
  const m = /@default\(([^)]*)\)/.exec(attrs);
  if (!m) return /@updatedAt/.test(attrs) ? ' DEFAULT now()' : '';
  const raw = m[1].trim();
  if (raw === 'true' || raw === 'false') return ` DEFAULT ${raw}`;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return ` DEFAULT ${raw}`;
  if (/^"(.*)"$/.test(raw)) return ` DEFAULT '${raw.slice(1, -1).replace(/'/g, "''")}'`;
  if (/^\[\]$/.test(raw)) return " DEFAULT '[]'::jsonb";
  if (/^\w+$/.test(raw)) return pgType === 'text' ? ` DEFAULT '${raw}'` : ''; // valeur d'énumération
  return '';
}

/** Lit `prisma/schema.prisma` — la source de vérité — plutôt qu'un DDL recopié à la main qui dériverait en silence. */
export function readModels(): Map<string, Model> {
  const source = readFileSync(SCHEMA_PATH, 'utf8');
  const modelNames = new Set(blocks(source, 'model').map((b) => b.name));
  const enumNames = new Set(blocks(source, 'enum').map((b) => b.name));
  const models = new Map<string, Model>();

  for (const { name, body } of blocks(source, 'model')) {
    let table = name;
    const columns: Column[] = [];
    let cleComposee: string[] | undefined;
    for (const line of body.split('\n')) {
      const text = line.trim();
      if (!text || text.startsWith('//') || text.startsWith('///')) continue;
      const mapped = /^@@map\("([^"]+)"\)/.exec(text);
      if (mapped) {
        table = mapped[1];
        continue;
      }
      // Une clé COMPOSÉE (`@@id([hash, groupe])`, tour 32) : c'est elle que `skipDuplicates` respecte.
      const composee = /^@@id\(\[([^\]]+)\]/.exec(text);
      if (composee) {
        cleComposee = composee[1].split(',').map((s) => s.trim());
        continue;
      }
      if (text.startsWith('@@')) continue;
      const field = /^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/.exec(text);
      if (!field) continue;
      const [, fieldName, type, list, optional, attrs = ''] = field;
      // Un champ de relation n'est pas une colonne : c'est l'autre bout du lien, et Prisma ne l'écrit jamais.
      if (list || modelNames.has(type)) continue;
      const pgType = SCALARS[type] ?? (enumNames.has(type) ? 'text' : null);
      if (!pgType) continue;
      const column = /@map\("([^"]+)"\)/.exec(attrs)?.[1] ?? fieldName;
      const nullable = optional ? '' : ' NOT NULL';
      const primary = /@id\b/.test(attrs) ? ' PRIMARY KEY' : '';
      const unique = !primary && /@unique\b/.test(attrs) ? ' UNIQUE' : '';
      columns.push({
        field: fieldName,
        column,
        ddl: `"${column}" ${pgType}${defaultClause(attrs, pgType)}${nullable}${primary}${unique}`,
      });
    }
    models.set(name, { name, table, columns, cleComposee });
  }
  return models;
}

/**
 * Crée les tables demandées. Sans clés étrangères : ces requêtes-là ne dépendent d'aucune cascade, et les exiger
 * obligerait chaque cas de test à fabriquer une campagne et une conversion pour poser une question sur un numéro
 * de téléphone. Ce que ce banc prouve, c'est la LOGIQUE de la requête.
 */
export async function createTables(db: PGlite, wanted: string[]): Promise<void> {
  const models = readModels();
  for (const name of wanted) {
    const model = models.get(name);
    if (!model) throw new Error(`modèle absent de prisma/schema.prisma : ${name}`);
    const cle = model.cleComposee
      ? [`PRIMARY KEY (${model.cleComposee.map((f) => `"${model.columns.find((c) => c.field === f)?.column ?? f}"`).join(', ')})`]
      : [];
    await db.exec(`CREATE TABLE "${model.table}" (${[...model.columns.map((c) => c.ddl), ...cle].join(', ')})`);
  }
}

function isSqlFragment(value: unknown): value is { strings: string[]; values: unknown[] } {
  return (
    !!value &&
    typeof value === 'object' &&
    Array.isArray((value as { strings?: unknown }).strings) &&
    Array.isArray((value as { values?: unknown }).values)
  );
}

/**
 * Ce que `PrismaClient` expose aux fonctions de `lead-sql.ts`, servi par pglite. Les fragments `Prisma.sql` /
 * `Prisma.join` sont dépliés récursivement — c'est ainsi que `scrubClicks` compose sa liste de clés.
 */
export function pglitePrisma(db: PGlite) {
  const build = (strings: readonly string[], values: readonly unknown[]) => {
    let text = '';
    const params: unknown[] = [];
    const walk = (ss: readonly string[], vv: readonly unknown[]) => {
      ss.forEach((chunk, i) => {
        text += chunk;
        if (i >= vv.length) return;
        const value = vv[i];
        if (isSqlFragment(value)) walk(value.strings, value.values);
        else {
          params.push(value === undefined ? null : value);
          text += `$${params.length}`;
        }
      });
    };
    walk(strings, values);
    return { text, params };
  };

  const run = async (strings: readonly string[], values: readonly unknown[]) => {
    const { text, params } = build(strings, values);
    return db.query(text, params as unknown[]);
  };

  return {
    $queryRaw: async <T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T> =>
      (await run(strings, values)).rows as T,
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]): Promise<number> =>
      (await run(strings, values)).affectedRows ?? 0,
  };
}

export async function freshDb(tables: string[]): Promise<{ db: PGlite; client: ReturnType<typeof pglitePrisma> }> {
  const db = await PGlite.create();
  await createTables(db, tables);
  return { db, client: pglitePrisma(db) };
}
