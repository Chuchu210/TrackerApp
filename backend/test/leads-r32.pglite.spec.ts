import { Logger } from '@nestjs/common';
import type { PGlite } from '@electric-sql/pglite';
import { COLONNES, colonnesDe, lireLigne, type Colonne, type Table } from '../src/leads/lead-columns';
import { contactFingerprints, estCleDIdentifiant, lireContacts } from '../src/leads/lead-fields';
import { GROUPE_ANCIEN, LeadsService } from '../src/leads/leads.service';
import { baseDesLeads } from './pg/pglite-modeles';
import { readModels } from './pg/pglite-prisma';

/**
 * Tour 32 — de bout en bout, sur un vrai Postgres : `deleteOne` et `purgePersonalData` lisent, inscrivent et
 * nettoient à travers les MODÈLES Prisma (servis par pglite) et le SQL généré du registre des colonnes. Les scénarios
 * du juré r13 (S4, S11, rétention puis effacement) y sont repris comme critères, dans nos mots.
 */
Logger.overrideLogger(false);
const CLE = 'cle-r32-0123456789abcdef-0123456789abcdef';
const cfg = { get: (k: string) => (k === 'ERASURE_HMAC_KEY' ? CLE : k === 'LEADS_PII_RETENTION_DAYS' ? '30' : undefined) };
const fpTel = (national: string) => contactFingerprints({ phone: national }, CLE)[0].hash;
const fpMail = (adresse: string) => contactFingerprints({ email: adresse }, CLE)[0].hash;
const JSONB = new Set(
  [...readModels().values()].flatMap((m) => m.columns.filter((c) => c.ddl.includes(' jsonb')).map((c) => `${m.table}.${c.column}`)),
);
/** Les clés de ligne : on ne plante rien dedans, la ligne en a besoin. */
const CLES = new Set(['id', 'clickId', 'campaignId', 'conversionId']);
/** Ce que la SPÉCIFICATION dit lu (pas `estLue`, que le banc de mutation doit pouvoir casser) : contact et URL. */
const lue = (c: Colonne) => c.classe === 'contact' || c.classe === 'url';
/**
 * Un nom de colonne qui dit « identifiant » (`utm_source`, `utm_campaign`, `adset_name`) : l'adresse y est lue et
 * retirée, un numéro ni l'un ni l'autre — la MÊME règle à la lecture et au nettoyage (voir le dernier test).
 */
const numeroLu = (c: Colonne) => !estCleDIdentifiant(c.colonne);

let db: PGlite;
let service: LeadsService;
beforeEach(async () => {
  const base = await baseDesLeads();
  db = base.db;
  service = new LeadsService(cfg as never, base.client as never, {} as never);
});
afterEach(async () => {
  await db.close();
});

async function inserer(table: Table, valeurs: Record<string, unknown>) {
  const cols = Object.keys(valeurs);
  const params = cols.map((c) => (JSONB.has(`${table}.${c}`) && valeurs[c] !== null ? JSON.stringify(valeurs[c]) : valeurs[c]));
  await db.query(`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, params);
}
const inscrites = async () => new Set((await db.query<{ hash: string }>(`SELECT "hash" FROM "erased_contacts"`)).rows.map((r) => r.hash));

describe('registre — chaque colonne qui porte une personne est LUE puis NETTOYÉE, chaque identifiant ni lu ni inscrit', () => {
  it('une adresse et un numéro plantés dans CHAQUE colonne « contact » ou « url » : inscrits, puis partis', async () => {
    const plants: { table: Table; c: Colonne; mail: string; tel: string }[] = [];
    const ligne: Record<Table, Record<string, unknown>> = {
      clicks: { id: 'k1', click_id: 'c1', campaign_id: 'camp' },
      conversions: { id: 'v1', click_id: 'c1', campaign_id: 'camp', event_type: 'lead' },
      leads: { id: 'L1', click_id: 'c1', campaign_id: 'camp', source: 'form' },
      postback_logs: { id: 'p1', conversion_id: 'v1', network: 'meta', method: 'GET' },
    };
    for (const table of Object.keys(ligne) as Table[]) {
      for (const c of colonnesDe(table)) {
        if (CLES.has(c.champ) || c.table === 'conversions' && c.champ === 'eventType') continue;
        if (!lue(c)) {
          // Un identifiant, une structure, une donnée personnelle non-contact : une valeur À LA FORME d'un numéro.
          ligne[table][c.colonne] = JSONB.has(`${table}.${c.colonne}`) ? { v: '8135550199' } : '8135550199';
          continue;
        }
        const i = plants.length;
        const tel = `81355501${String(i).padStart(2, '0')}`;
        const mail = `ann.${c.colonne.replace(/_/g, '')}@gmail.com`;
        const texte = `Ann ${mail} ${tel.slice(0, 3)}-${tel.slice(3, 6)}-${tel.slice(6)}`;
        plants.push({ table, c, mail, tel });
        ligne[table][c.colonne] = JSONB.has(`${table}.${c.colonne}`)
          ? { note: texte }
          : c.classe === 'url'
            ? `https://lp.example/merci?email=${encodeURIComponent(mail)}&phone=${tel}`
            : c.declaree
              ? c.champ === 'phone' ? tel : mail
              : texte;
      }
    }
    for (const table of Object.keys(ligne) as Table[]) await inserer(table, ligne[table]);
    expect(plants.length).toBeGreaterThan(30);

    const out = await service.deleteOne('L1');
    expect(out).toMatchObject({ deleted: true });

    // LUES : chaque colonne lue de la visite, de la conversion et du lead a inscrit ce qu'elle portait. (Les journaux
    // de postback sont des COPIES de la conversion : la liste lit l'original.)
    const liste = await inscrites();
    const nonInscrits = plants
      .filter((p) => p.table !== 'postback_logs')
      .flatMap((p) => [
        ...(p.c.declaree && p.c.champ === 'phone' ? [] : liste.has(fpMail(p.mail)) ? [] : [`${p.table}.${p.c.colonne} : ${p.mail}`]),
        ...(p.c.declaree && p.c.champ === 'email' ? [] : !numeroLu(p.c) || liste.has(fpTel(p.tel)) ? [] : [`${p.table}.${p.c.colonne} : ${p.tel}`]),
      ]);
    expect(nonInscrits).toEqual([]);
    // Et aucun identifiant n'a été pris pour un numéro.
    expect(liste.has(fpTel('8135550199'))).toBe(false);

    // NETTOYÉES : plus rien de la personne dans aucune de ces colonnes.
    const survivants: string[] = [];
    for (const p of plants) {
      const { rows } = await db.query<{ v: unknown }>(`SELECT "${p.c.colonne}" AS v FROM "${p.table}"`);
      const texte = JSON.stringify(rows[0]?.v ?? null);
      if (/ann\./i.test(decodeURIComponent(texte)) || (numeroLu(p.c) && texte.replace(/\D/g, '').includes(p.tel))) {
        survivants.push(`${p.table}.${p.c.colonne} = ${texte}`);
      }
    }
    expect(survivants).toEqual([]);
  }, 60000);

  it('chaque colonne classée identifiant, structure ou personnelle : un numéro planté n’est jamais lu', () => {
    const lus = COLONNES.filter((c) => !lue(c)).flatMap((c) => lireLigne(c.table, { [c.champ]: '813-555-0199' }).tous);
    expect(lus).toEqual([]);
    // Et dans une colonne lue, la même valeur l'est (le test ci-dessus ne passe pas parce que rien n'est lu).
    expect(lireLigne('clicks', { utmContent: '813-555-0199' }).tous).toEqual([{ phone: '8135550199' }]);
  });
});

describe('juré r13 — S11 : les colonnes UTM et de titre d’annonce d’une visite, à l’effacement', () => {
  it('utm_term, utm_content, ad_title, l’hôte du référent et raw_params ne gardent ni l’adresse ni le numéro', async () => {
    await inserer('clicks', {
      id: 'k1', click_id: 'clk1', campaign_id: 'camp', utm_term: 'ann.doe@gmail.com', utm_content: '8135550142',
      ad_title: 'Hi ann.doe@gmail.com', referrer: 'https://813-555-0142.lp.example/merci',
      raw_params: { utm_term: 'ann.doe@gmail.com', utm_content: '8135550142' },
    });
    await inserer('leads', { id: 'L1', click_id: 'clk1', campaign_id: 'camp', source: 'form', first_name: 'Ann', phone: '8135550142', email: 'ann.doe@gmail.com' });
    expect(await service.deleteOne('L1')).toMatchObject({ deleted: true });
    const { rows } = await db.query(`SELECT "utm_term", "utm_content", "ad_title", "referrer", "raw_params" FROM "clicks"`);
    const texte = JSON.stringify(rows);
    expect(texte).not.toMatch(/ann\.doe|8135550142|813-555-0142/);
    expect(rows[0]).toMatchObject({ referrer: 'https://***.lp.example/' });
  });
});

describe('juré r13 — rétention PUIS effacement : ni la version du navigateur, ni un ttclid ne deviennent un numéro', () => {
  it('l’étiquette `name` d’un champ décrit survit à la rétention, et l’effacement n’inscrit que la personne', async () => {
    const vieux = new Date('2026-01-01T00:00:00Z');
    await inserer('clicks', { id: 'k1', click_id: 'c1', campaign_id: 'camp', browser: 'Chrome', browser_version: '126.0.6478.127', created_at: vieux });
    const meta = {
      field_data: [
        { name: 'vehicle_year', values: ['2019'] },
        { name: 'ttclid', values: ['E.C.P.009502215342'] },
        { name: 'phone_number', values: ['+18135550142'] },
      ],
    };
    await inserer('conversions', { id: 'v1', click_id: 'c1', campaign_id: 'camp', event_type: 'lead', metadata: meta, created_at: vieux });
    await inserer('leads', { id: 'L1', click_id: 'c1', campaign_id: 'camp', source: 'form', first_name: 'Ann', phone: '8135550142', created_at: vieux });
    await service.purgePersonalData(new Date('2026-09-19T00:00:00Z'));
    const apres = (await db.query<{ metadata: unknown }>(`SELECT "metadata" FROM "conversions"`)).rows[0].metadata;
    expect(apres).toEqual({
      field_data: [{ name: 'vehicle_year', values: ['2019'] }, { name: 'ttclid', values: ['E.C.P.009502215342'] }, { name: 'phone_number' }],
    });
    await service.eraseVisit('c1');
    const liste = await inscrites();
    expect(liste.has(fpTel('2606478127'))).toBe(false); // 126.0.6478.127
    expect(liste.has(fpTel('9502215342'))).toBe(false); // E.C.P.009502215342
    // Ann elle-même : la rétention avait déjà retiré son numéro partout — il n'y a plus rien à inscrire.
    expect([...liste].filter((h) => h !== fpMail('temoin@liste-de-suppression.invalid'))).toEqual([]);
  });
});

describe('juré r13 — S4 : un effacement = un groupe, même pour une empreinte déjà inscrite (clé (hash, groupe))', () => {
  async function effacer(id: string, clickId: string, contact: { phone?: string; email?: string }, notes: string) {
    await inserer('clicks', { id: `k-${id}`, click_id: clickId, campaign_id: 'camp' });
    await inserer('leads', { id, click_id: clickId, campaign_id: 'camp', source: 'form', first_name: id, ...contact, answers: { notes } });
    expect(await service.deleteOne(id)).toMatchObject({ deleted: true });
  }

  it('Ann cite Eve ; Ann effacée, puis Eve ; Eve revient avec son numéro ET son adresse : refusée', async () => {
    await effacer('ann', 'c-ann', { phone: '8135550142', email: 'ann@gmail.com' }, 'If busy call my sister Eve 727-555-0100');
    await effacer('eve', 'c-eve', {}, 'text me at 727-555-0100 or write eve.martin@yahoo.com');
    // Le numéro d'Eve est dans les DEUX groupes.
    const { rows } = await db.query<{ n: number }>(`SELECT count(DISTINCT "groupe")::int AS n FROM "erased_contacts" WHERE "hash" = $1`, [fpTel('7275550100')]);
    expect(rows[0].n).toBe(2);
    expect(await service.isErasedPerson([{ phone: '727-555-0100', email: 'eve.martin@yahoo.com' }])).toBe(true);
    // Le second signal tient toujours : Eve avec son seul numéro (trouvé des deux fois) passe.
    expect(await service.isErasedPerson([{ phone: '727-555-0100' }])).toBe(false);
  });

  it('S3 : Bob, cité dans les notes d’Ann, passe ; Ann qui revient avec le numéro de Bob et son adresse, non', async () => {
    await effacer('ann', 'c-ann', { phone: '8135550142', email: 'ann@gmail.com' }, 'Call my husband Bob at 727-555-0199 if I do not answer');
    expect(await service.isErasedPerson([{ phone: '727-555-0199', email: 'bob@yahoo.com' }])).toBe(false);
    expect(await service.isErasedPerson([{ phone: '727-555-0199', email: 'ann@gmail.com' }])).toBe(true);
  });

  it('deux effacements DIFFÉRENTS ne se prêtent pas leur signal : Bob, cité par Ann et par Carl, passe', async () => {
    await effacer('ann', 'c-ann', { phone: '8135550142' }, 'Call Bob at 727-555-0199');
    await effacer('carl', 'c-carl', { phone: '4075550123' }, 'my colleague is bob@yahoo.com');
    expect(await service.isErasedPerson([{ phone: '727-555-0199', email: 'bob@yahoo.com' }])).toBe(false);
  });

  it('une ligne d’avant les groupes refuse seule ; la migration l’y range', async () => {
    await db.query(`INSERT INTO "erased_contacts" ("hash", "kind", "groupe") VALUES ($1, 'phone_texte', $2)`, [fpTel('7275550100'), GROUPE_ANCIEN]);
    expect(await service.isErasedPerson([{ phone: '727-555-0100' }])).toBe(true);
    // La même empreinte, dans un autre groupe : la clé composée l'accepte.
    await db.query(`INSERT INTO "erased_contacts" ("hash", "kind", "groupe") VALUES ($1, 'phone', 'g-2')`, [fpTel('7275550100')]);
    const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM "erased_contacts" WHERE "hash" = $1`, [fpTel('7275550100')]);
    expect(rows[0].n).toBe(2);
  });
});

describe('le registre relit ce que lireContacts lit (même clé) — pas de lecteur parallèle', () => {
  it('lireLigne = lireContacts sous le nom de colonne', () => {
    const v = { utmTerm: 'ann@gmail.com', browserVersion: '126.0.6478.127', adId: '79852541234' };
    expect(lireLigne('clicks', v).tous).toEqual(lireContacts({ utm_term: 'ann@gmail.com' }).tous);
  });
});

describe('une colonne au nom d’identifiant : un numéro n’y est ni lu ni retiré, une adresse y est lue ET retirée', () => {
  it('la même règle des deux côtés, colonne par colonne', () => {
    const incoherentes = COLONNES.filter((c) => c.nettoyage === 'caviarder' && estCleDIdentifiant(c.colonne)).filter((c) => {
      const lu = lireLigne(c.table, { [c.champ]: '813-555-0142 ann@gmail.com' }).tous;
      return lu.some((x) => x.phone) || !lu.some((x) => x.email);
    });
    expect(incoherentes).toEqual([]);
  });
});
