import { randomUUID } from 'crypto';
import { Logger } from '@nestjs/common';
import type { PGlite } from '@electric-sql/pglite';
import { enFormeInternationale, formesDuNumero, leadFromConversion, normalizePhone } from '../src/leads/lead-fields';
import { paysDuSite, parseIntakeKeys } from '../src/leads/intake-key.guard';
import { LeadsService } from '../src/leads/leads.service';
import { baseDesLeads } from './pg/pglite-modeles';

/**
 * Défaut reproduit en production le 20/09 : Marie arrive avec « +33 6 12 34 56 78 » (rangée 33612345678), demande
 * son effacement, revient avec « 0612345678 » — le même numéro, écrit à la française, sans indicatif — et un autre
 * e-mail : ACCEPTÉE. Sans le pays, les deux écritures étaient deux empreintes.
 *
 * De bout en bout sur un vrai Postgres (pglite) : `intake` → visite, conversion et ligne de lead écrites en base
 * (la ligne lue par le VRAI `leadFromConversion`, comme `ConversionsService.storeLead`) → `deleteOne` (lecture de la
 * liste, inscription dans `erased_contacts`, nettoyage SQL) → second `intake`.
 */
Logger.overrideLogger(false);
const CLE = 'cle-numero-national-0123456789abcdef-01234567';

let db: PGlite;
let service: LeadsService;
let cles = '';

beforeEach(async () => {
  const base = await baseDesLeads();
  db = base.db;
  const client = base.client as Record<string, any>;
  // La table des campagnes n'est pas dans le banc : `intake` n'en attend qu'un identifiant.
  client.campaign = { upsert: async ({ where }: { where: { slug: string } }) => ({ id: `camp-${where.slug}` }) };
  // La porte normale, réduite à ce qu'elle écrit pour un lead : la conversion, puis la ligne lue par
  // `leadFromConversion` — la fonction même de `ConversionsService.storeLead`.
  const conversions = {
    create: async (dto: { clickId: string; metadata: Record<string, unknown> }, ctx: { userAgent?: string; incomingPostbackIp?: string }) => {
      const visite = await client.click.findUnique({ where: { clickId: dto.clickId } });
      const id = randomUUID();
      await client.conversion.create({ data: { id, clickId: dto.clickId, campaignId: visite.campaignId, eventType: 'lead', metadata: dto.metadata } });
      const data = leadFromConversion(dto.metadata, ctx as never);
      await client.lead.create({
        data: { ...data, answers: data.answers ?? undefined, clickId: dto.clickId, campaignId: visite.campaignId, conversionId: id, isTest: false },
      });
      return { conversion: { id } };
    },
  };
  const cfg = { get: (k: string) => (k === 'ERASURE_HMAC_KEY' ? CLE : k === 'INTAKE_API_KEYS' ? cles : undefined) };
  service = new LeadsService(cfg as never, client as never, conversions as never);
});
afterEach(async () => {
  await db.close();
});

type Envoi = { source: string; externalId: string; phone?: string; email?: string; country?: string; firstName?: string; answers?: Record<string, unknown> };
const envoyer = (e: Envoi) => service.intake({ firstName: 'Marie', ...e } as never);

/** L'effacement, demandé sur le lead de cette soumission. */
async function effacer(source: string, externalId: string) {
  const { rows } = await db.query<{ id: string }>(`SELECT "id" FROM "leads" WHERE "click_id" = $1`, [`ext_${source}_${externalId}`]);
  expect(rows).toHaveLength(1);
  const out = await service.deleteOne(rows[0].id);
  expect(out).toMatchObject({ deleted: true });
  expect(out.suppression).toBeUndefined();
}
const leadsVivants = async () =>
  (await db.query<{ phone: string | null }>(`SELECT "phone" FROM "leads" WHERE "erased_at" IS NULL`)).rows.map((r) => r.phone);

describe('Marie (défaut du 20/09) : effacée sous sa forme internationale, elle revient sous sa forme nationale', () => {
  it('FR : « +33 6 12 34 56 78 » rangé, effacé ; « 0612345678 » depuis le site FR → REFUSÉ', async () => {
    cles = 'monsite.fr:cle-fr:FR';
    expect(await envoyer({ source: 'monsite.fr', externalId: 'm1', phone: '+33 6 12 34 56 78', email: 'marie@exemple.fr' })).toMatchObject({
      stored: true,
    });
    expect(await leadsVivants()).toEqual(['33612345678']);
    await effacer('monsite.fr', 'm1');
    expect(await leadsVivants()).toEqual([]);

    const retour = await envoyer({ source: 'monsite.fr', externalId: 'm2', phone: '0612345678', email: 'marie.autre@exemple.fr' });
    expect(retour).toMatchObject({ stored: false, reason: 'erased_person' });
    // Rien d'écrit : ni visite, ni lead.
    expect((await db.query(`SELECT 1 FROM "clicks" WHERE "click_id" = 'ext_monsite.fr_m2'`)).rows).toHaveLength(0);
    expect(await leadsVivants()).toEqual([]);
  });

  it('UK : « +44 7911 123456 » effacé ; « 07911 123456 » depuis le site UK → REFUSÉ (« UK » vaut GB)', async () => {
    cles = 'monsite.co.uk:cle-uk:UK';
    expect(await envoyer({ source: 'monsite.co.uk', externalId: 'u1', phone: '+44 7911 123456', email: 'mary@example.co.uk' })).toMatchObject({
      stored: true,
    });
    await effacer('monsite.co.uk', 'u1');
    expect(await envoyer({ source: 'monsite.co.uk', externalId: 'u2', phone: '07911 123456', email: 'mary.other@example.co.uk' })).toMatchObject({
      stored: false,
      reason: 'erased_person',
    });
  });

  it('DE : « +49 151 23456789 » effacé ; « 0151 23456789 » depuis le site DE → REFUSÉ', async () => {
    cles = 'meineseite.de:cle-de:DE';
    expect(await envoyer({ source: 'meineseite.de', externalId: 'd1', phone: '+49 151 23456789', email: 'maria@beispiel.de' })).toMatchObject({
      stored: true,
    });
    await effacer('meineseite.de', 'd1');
    expect(await envoyer({ source: 'meineseite.de', externalId: 'd2', phone: '0151 23456789', email: 'maria.neu@beispiel.de' })).toMatchObject({
      stored: false,
      reason: 'erased_person',
    });
  });

  it('le pays DÉCLARÉ par le lead passe avant celui du site (ici : un site sans pays)', async () => {
    cles = 'portail.eu:cle-eu';
    await envoyer({ source: 'portail.eu', externalId: 'p1', phone: '+33 6 12 34 56 78', email: 'marie@exemple.fr' });
    await effacer('portail.eu', 'p1');
    expect(await envoyer({ source: 'portail.eu', externalId: 'p2', phone: '0612345678', email: 'x@exemple.fr', country: 'fr' })).toMatchObject({
      stored: false,
      reason: 'erased_person',
    });
  });

  it("dans l'autre sens : venue en « 06 12 34 56 78 » par le site FR, effacée, elle revient en « +33 » par un site SANS pays → REFUSÉE", async () => {
    // L'effacement lit ses numéros avec le pays de SA visite : il inscrit la forme écrite ET l'internationale.
    cles = 'monsite.fr:cle-fr:FR,autre.com:cle-autre';
    await envoyer({ source: 'monsite.fr', externalId: 'n1', phone: '06 12 34 56 78', email: 'marie@exemple.fr' });
    expect(await leadsVivants()).toEqual(['0612345678']);
    await effacer('monsite.fr', 'n1');
    expect(await envoyer({ source: 'autre.com', externalId: 'n2', phone: '+33 6 12 34 56 78', email: 'y@exemple.fr' })).toMatchObject({
      stored: false,
      reason: 'erased_person',
    });
    // Et par un site sans pays, sous la forme nationale : comme avant, refusée.
    expect(await envoyer({ source: 'autre.com', externalId: 'n3', phone: '0612345678', email: 'z@exemple.fr' })).toMatchObject({
      stored: false,
      reason: 'erased_person',
    });
  });
});

describe('ne jamais deviner un pays, ne jamais refuser un innocent', () => {
  it('SANS pays connu, « 0612345678 » n’est PAS rapproché de 33612345678 — le même envoi depuis un site FR, lui, l’est', async () => {
    cles = 'sanspays.com:cle-sp,monsite.fr:cle-fr:FR';
    await envoyer({ source: 'sanspays.com', externalId: 's1', phone: '+33 6 12 34 56 78', email: 'marie@exemple.fr' });
    await effacer('sanspays.com', 's1');
    // Aucun pays : la forme nationale est une autre chaîne, on ne la lit pas comme française.
    expect(await envoyer({ source: 'sanspays.com', externalId: 's2', phone: '0612345678', email: 'quelquun@exemple.nl' })).toMatchObject({
      stored: true,
    });
    expect(formesDuNumero('0612345678')).toEqual(['0612345678']);
    expect(normalizePhone('0612345678')).toBe('0612345678');
    // La seule différence est le pays : le même numéro depuis le site FR est refusé.
    expect(await envoyer({ source: 'monsite.fr', externalId: 's3', phone: '0612345678', email: 'autre@exemple.fr' })).toMatchObject({
      stored: false,
      reason: 'erased_person',
    });
  });

  it('un Américain « (813) 555-0142 » n’est touché ni par un site FR ni par un site US', async () => {
    cles = 'monsite.fr:cle-fr:FR,monsite.com:cle-us:US';
    // Une personne effacée sur chaque site, dont un Américain voisin (0199).
    await envoyer({ source: 'monsite.fr', externalId: 'a1', phone: '+33 6 12 34 56 78', email: 'marie@exemple.fr' });
    await effacer('monsite.fr', 'a1');
    await envoyer({ source: 'monsite.com', externalId: 'a2', phone: '(813) 555-0199', email: 'bob@example.com', firstName: 'Bob' });
    await effacer('monsite.com', 'a2');
    // Ses formes : dix chiffres, quel que soit le pays du site — le plan nord-américain n'est jamais réécrit, et un
    // numéro sans 0 national n'est pas lu comme français.
    for (const pays of [undefined, 'US', 'CA', 'FR', 'GB', 'DE', 'IT', 'ES']) expect(formesDuNumero('(813) 555-0142', pays)).toEqual(['8135550142']);
    expect(await envoyer({ source: 'monsite.fr', externalId: 'a3', phone: '(813) 555-0142', email: 'tom@example.com', firstName: 'Tom' })).toMatchObject({
      stored: true,
    });
    expect(await envoyer({ source: 'monsite.com', externalId: 'a4', phone: '(813) 555-0142', email: 'tom2@example.com', firstName: 'Tom' })).toMatchObject({
      stored: true,
    });
    // Et l'Américain effacé, lui, reste refusé sous toutes ses écritures.
    expect(await envoyer({ source: 'monsite.com', externalId: 'a5', phone: '+1 813 555 0199', email: 'b2@example.com', firstName: 'Bob' })).toMatchObject({
      stored: false,
      reason: 'erased_person',
    });
  });

  it('deux FORMES du même numéro ne sont pas un « second signal » : Bob, cité dans les notes d’Ann, envoie son lead', async () => {
    cles = 'monsite.fr:cle-fr:FR';
    await envoyer({
      source: 'monsite.fr',
      externalId: 'b1',
      phone: '+33 7 00 00 00 01',
      email: 'ann@exemple.fr',
      firstName: 'Ann',
      answers: { notes: 'appelez mon mari Bob au 06 12 34 56 78' },
    });
    await effacer('monsite.fr', 'b1');
    // Le numéro de Bob est inscrit « trouvé » sous ses deux formes, dans le groupe d'Ann : son propre lead passe.
    expect(await envoyer({ source: 'monsite.fr', externalId: 'b2', phone: '0612345678', email: 'bob@exemple.fr', firstName: 'Bob' })).toMatchObject({
      stored: true,
    });
    // Ann, qui revient avec ce numéro ET son adresse, reste refusée (deux contacts du même effacement).
    expect(await envoyer({ source: 'monsite.fr', externalId: 'b3', phone: '0612345678', email: 'ann@exemple.fr', firstName: 'Ann' })).toMatchObject({
      stored: false,
      reason: 'erased_person',
    });
  });
});

describe('INTAKE_API_KEYS : le pays du site, sans casser l’ancien format', () => {
  it('« site:clé:FR » et « site:clé » cohabitent ; l’ancien format n’a pas de pays', () => {
    expect(parseIntakeKeys('monsite.fr:cle-fr:FR,autre.com:cle-autre, uk.example : k:uk ')).toEqual([
      { site: 'monsite.fr', key: 'cle-fr', pays: 'FR' },
      { site: 'autre.com', key: 'cle-autre' },
      { site: 'uk.example', key: 'k', pays: 'GB' },
    ]);
    expect(paysDuSite('monsite.fr:cle-fr:FR,autre.com:cle-autre', 'monsite.fr')).toBe('FR');
    expect(paysDuSite('monsite.fr:cle-fr:FR,autre.com:cle-autre', 'autre.com')).toBeNull();
    // Une clé en rotation qui déclare deux pays : aucun (on ne choisit pas).
    expect(paysDuSite('monsite.fr:a:FR,monsite.fr:b:BE', 'monsite.fr')).toBeNull();
    // Une clé qui contient des deux-points reste entière tant qu'elle ne finit pas par « :XX ».
    expect(parseIntakeKeys('monsite.com:a:b:c')).toEqual([{ site: 'monsite.com', key: 'a:b:c' }]);
  });

  it('l’ancien format, de bout en bout : le lead est rangé, effacé, et refusé sous la même écriture', async () => {
    cles = 'monsite.com:cle-us';
    expect(await envoyer({ source: 'monsite.com', externalId: 'o1', phone: '(813) 555-0142', email: 'ann@example.com' })).toMatchObject({
      stored: true,
    });
    await effacer('monsite.com', 'o1');
    expect(await envoyer({ source: 'monsite.com', externalId: 'o2', phone: '813.555.0142', email: 'x@example.com' })).toMatchObject({
      stored: false,
      reason: 'erased_person',
    });
  });
});

describe('enFormeInternationale : la forme nationale d’un pays connu, et rien d’autre', () => {
  it.each([
    ['0612345678', 'FR', '33612345678'],
    ['07911123456', 'GB', '447911123456'],
    ['015123456789', 'DE', '4915123456789'],
    ['0612345678', 'NL', '31612345678'],
    ['0470123456', 'BE', '32470123456'],
    ['0791234567', 'CH', '41791234567'],
    ['0612345678', 'IT', '390612345678'], // un fixe romain : le 0 reste
    ['612345678', 'ES', '34612345678'],
    ['912345678', 'PT', '351912345678'],
  ])('%s + %s → %s', (numero, pays, attendu) => {
    expect(enFormeInternationale(numero, pays)).toBe(attendu);
    // Idempotente : la forme internationale ne bouge plus.
    expect(enFormeInternationale(attendu, pays)).toBe(attendu);
  });

  it.each([
    ['0612345678', null], // aucun pays
    ['0612345678', 'US'], // le plan nord-américain n'est pas réécrit
    ['0612345678', 'MX'], // un pays sans règle
    ['33612345678', 'FR'], // déjà international
    ['33612345678', 'IT'], // Marie écrite avec son +33, sur un site italien : pas italienne
    ['3123456789', 'IT'], // un « +1 312… » rangé, ou un mobile italien : indiscernables, rien ne bouge
    ['8135550142', 'ES'], // un numéro nord-américain sur un site espagnol
    ['00612345678', 'FR'], // pas de 0 national seul
    ['061234', 'FR'], // trop court pour la France
    ['06123456789', 'FR'], // trop long pour la France
  ])('%s + %s : inchangé', (numero, pays) => {
    expect(enFormeInternationale(numero, pays)).toBe(numero);
  });

  it('normalizePhone garde ses règles, le pays ne s’ajoute qu’à un numéro écrit sans indicatif', () => {
    expect(normalizePhone('0033 6 12 34 56 78', 'FR')).toBe('33612345678');
    expect(normalizePhone('+44 (0)7911 123456', 'FR')).toBe('447911123456');
    expect(normalizePhone('06 12 34 56 78 ext. 12', 'FR')).toBe('33612345678');
    expect(normalizePhone('+1 813 555 0142', 'IT')).toBe('8135550142');
    expect(normalizePhone('1-813-555-0142', 'FR')).toBe('8135550142');
    expect(formesDuNumero('+33 6 12 34 56 78', 'FR')).toEqual(['33612345678']);
    expect(formesDuNumero('06 12 34 56 78', 'FR')).toEqual(['0612345678', '33612345678']);
  });
});
