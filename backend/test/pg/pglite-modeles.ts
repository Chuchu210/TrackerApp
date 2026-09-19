import { PGlite } from '@electric-sql/pglite';
import { Prisma } from '@prisma/client';
import { createTables, pglitePrisma, readModels, type Model } from './pglite-prisma';

/**
 * Tour 32 — les MODÈLES Prisma servis par pglite : `findMany`, `update`, `createMany`… sur de vraies tables, lues
 * dans `prisma/schema.prisma`. Assez pour faire tourner `deleteOne` et `purgePersonalData` de bout en bout — la
 * lecture de la liste de suppression, l'inscription dans `erased_contacts` (clé composée comprise), le nettoyage
 * JavaScript et le SQL généré du registre — sans double écrit à la main qui dirait ce que le test veut entendre.
 *
 * Ce qui n'est pas pris en charge (relations, `include`, opérateurs rares) LÈVE : un test ne passe jamais par un
 * chemin que ce banc aurait ignoré en silence.
 */
type Ou = Record<string, unknown>;

function modele(db: PGlite, m: Model) {
  const colonne = (champ: string) => {
    const c = m.columns.find((x) => x.field === champ);
    if (!c) throw new Error(`${m.name}.${champ} : champ inconnu du banc`);
    return c;
  };
  const valeur = (champ: string, v: unknown) => {
    if (v === Prisma.DbNull || v === Prisma.JsonNull || v === null || v === undefined) return null;
    return colonne(champ).ddl.includes(' jsonb') ? JSON.stringify(v) : v;
  };
  const filtre = (where: Ou | undefined, params: unknown[]) => {
    const conds: string[] = [];
    for (const [champ, v] of Object.entries(where ?? {})) {
      if (v === undefined) continue;
      const x = `"${colonne(champ).column}"`;
      if (v === null) conds.push(`${x} IS NULL`);
      else if (typeof v === 'object' && !(v instanceof Date)) {
        for (const [op, w] of Object.entries(v as Ou)) {
          if (op === 'in') conds.push(`${x} = ANY($${params.push(w)})`);
          else if (op === 'lt') conds.push(`${x} < $${params.push(w)}`);
          else if (op === 'not' && w === null) conds.push(`${x} IS NOT NULL`);
          else throw new Error(`${m.name}.${champ} : opérateur « ${op} » inconnu du banc`);
        }
      } else conds.push(`${x} = $${params.push(v)}`);
    }
    return conds.length ? ` WHERE ${conds.join(' AND ')}` : '';
  };
  const colonnes = (select?: Ou) =>
    (select ? Object.keys(select).filter((k) => select[k]) : m.columns.map((c) => c.field))
      .map((f) => `"${colonne(f).column}" AS "${f}"`)
      .join(', ');
  const trouver = async (a: { where?: Ou; select?: Ou; take?: number } = {}) => {
    const params: unknown[] = [];
    const sql = `SELECT ${colonnes(a.select)} FROM "${m.table}"${filtre(a.where, params)}${a.take ? ` LIMIT ${a.take}` : ''}`;
    return (await db.query<Record<string, unknown>>(sql, params)).rows;
  };
  const inserer = async (data: Ou, rien = false) => {
    const champs = Object.keys(data).filter((k) => data[k] !== undefined);
    const params = champs.map((k) => valeur(k, data[k]));
    const sql = `INSERT INTO "${m.table}" (${champs.map((k) => `"${colonne(k).column}"`).join(', ')})
      VALUES (${champs.map((_, i) => `$${i + 1}`).join(', ')})${rien ? ' ON CONFLICT DO NOTHING' : ''} RETURNING *`;
    return (await db.query(sql, params)).rows.length;
  };
  const modifier = async (where: Ou, data: Ou) => {
    const params: unknown[] = [];
    const sets = Object.entries(data)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `"${colonne(k).column}" = $${params.push(valeur(k, v))}`);
    if (!sets.length) return 0;
    const res = await db.query(`UPDATE "${m.table}" SET ${sets.join(', ')}${filtre(where, params)}`, params);
    return res.affectedRows ?? 0;
  };
  return {
    findMany: trouver,
    findFirst: async (a: { where?: Ou; select?: Ou } = {}) => (await trouver({ ...a, take: 1 }))[0] ?? null,
    findUnique: async (a: { where?: Ou; select?: Ou }) => (await trouver({ ...a, take: 1 }))[0] ?? null,
    count: async (a: { where?: Ou } = {}) => (await trouver({ where: a.where })).length,
    create: async (a: { data: Ou }) => {
      await inserer(a.data);
      return a.data;
    },
    createMany: async (a: { data: Ou[]; skipDuplicates?: boolean }) => {
      let count = 0;
      for (const d of a.data) count += await inserer(d, a.skipDuplicates);
      return { count };
    },
    update: async (a: { where: Ou; data: Ou }) => {
      await modifier(a.where, a.data);
      return (await trouver({ where: a.where, take: 1 }))[0];
    },
    updateMany: async (a: { where: Ou; data: Ou }) => ({ count: await modifier(a.where, a.data) }),
    upsert: async (a: { where: Ou; create: Ou; update: Ou }) => {
      if ((await trouver({ where: a.where, take: 1 })).length) await modifier(a.where, a.update);
      else await inserer(a.create);
      return (await trouver({ where: a.where, take: 1 }))[0];
    },
  };
}

const MODELES = ['Click', 'Conversion', 'Lead', 'PostbackLog', 'ErasedContact'] as const;

/** Une base neuve avec les tables des leads, et un client qui a la forme de `PrismaService` pour ces tables. */
export async function baseDesLeads() {
  const db = await PGlite.create();
  await createTables(db, [...MODELES]);
  const models = readModels();
  const brut = pglitePrisma(db);
  const client = {
    ...brut,
    click: modele(db, models.get('Click')!),
    conversion: modele(db, models.get('Conversion')!),
    lead: modele(db, models.get('Lead')!),
    postbackLog: modele(db, models.get('PostbackLog')!),
    erasedContact: modele(db, models.get('ErasedContact')!),
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(client),
  };
  return { db, client };
}
