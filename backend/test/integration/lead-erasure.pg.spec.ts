import { PrismaClient } from '@prisma/client';
import { LeadsService } from '../../src/leads/leads.service';

/**
 * L'effacement d'une PERSONNE, joué contre un vrai Postgres, par le vrai service.
 *
 * Le tour 11 a rejeté la preuve précédente : « tant qu'un correctif est prouvé par un mock qui rend la bonne
 * réponse, il n'est pas prouvé ». C'est exact — la pièce maîtresse (`visitsOfPerson`) est du SQL brut, et le test
 * unitaire remplaçait `$queryRaw` par une fonction qui rendait déjà la liste attendue : il n'observait ni la
 * requête, ni l'ordre pierre-tombale/lecture, ni ce que la base fait vraiment. Ici, rien n'est simulé : le SQL
 * s'exécute, et les trois questions qui coûtent cher sont posées à la base.
 *
 *   1. Ann revient depuis un DEUXIÈME navigateur : sa demande d'effacement couvre-t-elle les deux visites ?
 *      (Le correctif du tour 10 était mort : le contact était relu APRÈS avoir été vidé.)
 *   2. Trois personnes derrière le même standard : la demande de l'une efface-t-elle les deux autres ?
 *      (Leurs leads et leur preuve de consentement sont irremplaçables — les effacer est le défaut le plus cher.)
 *   3. Une visite qui n'a jamais produit de lead : la personne est-elle atteinte quand même ?
 *
 * Ignoré tant que `LEAD_SQL_TEST_URL` ne pointe pas sur une base jetable portant ce schéma :
 *   createdb lead_it && DATABASE_URL=… npx prisma db push
 *   LEAD_SQL_TEST_URL=… npx jest test/integration --runInBand
 */
const url = process.env.LEAD_SQL_TEST_URL;
const describeIfPg = url ? describe : describe.skip;

describeIfPg('erasing a person against a real Postgres', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: url ?? 'postgresql://unused' } } });
  // Cette suite n'écrit jamais de lead par la porte d'entrée : elle efface. Le service des conversions est donc
  // un double qui EXPLOSE s'il est appelé — un `jest.fn()` muet laisserait passer un appel involontaire.
  const conversions = {
    create: () => {
      throw new Error("cette suite ne doit pas passer par la porte d'entrée");
    },
  };
  const service = new LeadsService({ get: () => undefined } as never, prisma as never, conversions as never);
  const tag = Date.now();
  let campaignId = '';

  const ANN_PHONE = '8135550142';
  const ANN_MAIL = 'ann@example.com';
  const SWITCHBOARD = '8005551212';
  const CONSENT = `I, Ann Dupont, agree that you may call me at ${ANN_PHONE}.`;

  async function visit(
    key: string,
    visitorId: string,
    lead: Record<string, unknown> | null,
    raw: Record<string, unknown> = {},
  ) {
    const clickId = `${key}-${tag}`;
    await prisma.click.create({
      data: {
        clickId,
        campaignId,
        visitorId,
        ipAddress: '203.0.113.7',
        userAgent: 'Mozilla/5.0',
        acceptLanguage: 'en-US',
        referrer: `https://facebook.com/?name=Ann&phone=${ANN_PHONE}`,
        rawParams: { utm_source: 'facebook', ...raw },
        requestHeaders: { 'x-forwarded-for': '203.0.113.7' },
      },
    });
    if (lead) {
      await prisma.lead.create({ data: { clickId, campaignId, source: 'quiz', ...(lead as object) } });
    }
    return clickId;
  }

  beforeAll(async () => {
    await prisma.$connect();
    const campaign = await prisma.campaign.create({
      data: {
        name: 'lead-erasure-it',
        slug: `lead-erasure-it-${tag}`,
        destinationUrl: 'https://example.com',
        trafficSource: 'facebook',
      },
    });
    campaignId = campaign.id;
  });

  afterAll(async () => {
    await prisma.postbackLog.deleteMany({ where: { conversion: { campaignId } } });
    await prisma.lead.deleteMany({ where: { campaignId } });
    await prisma.conversion.deleteMany({ where: { campaignId } });
    await prisma.click.deleteMany({ where: { campaignId } });
    await prisma.campaign.deleteMany({ where: { id: campaignId } });
    await prisma.$disconnect();
  });

  it('reaches every browser of the same person, and stops at the person', async () => {
    // Ann, deux navigateurs : deux visiteurs différents, le même numéro et la même adresse.
    const annA = await visit('ann-a', `v-ann-a-${tag}`, {
      firstName: 'Ann',
      lastName: 'Dupont',
      phone: ANN_PHONE,
      email: ANN_MAIL,
      zip: '33610',
      state: 'FL',
      answers: { q1: 'yes' },
      consentText: CONSENT,
      consentHash: 'hash-ann',
      consentAt: new Date('2026-09-01T10:00:00Z'),
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0',
      pageUrl: `https://nexoquote.com/?name=Ann&phone=${ANN_PHONE}`,
    }, { name: 'Ann', phone: ANN_PHONE });
    const annB = await visit('ann-b', `v-ann-b-${tag}`, {
      firstName: 'Ann',
      phone: ANN_PHONE,
      email: ANN_MAIL,
      consentText: CONSENT,
    }, { name: 'Ann', phone: ANN_PHONE });

    // Le standard partagé : trois personnes, un seul numéro. Carl demandera l'effacement plus bas.
    const bob = await visit('bob', `v-bob-${tag}`, { firstName: 'Bob', phone: SWITCHBOARD, consentText: 'Bob agrees.' });
    const dave = await visit('dave', `v-dave-${tag}`, { firstName: 'Dave', phone: SWITCHBOARD, consentText: 'Dave agrees.' });
    const carl = await visit('carl', `v-carl-${tag}`, { firstName: 'Carl', phone: SWITCHBOARD, consentText: 'Carl agrees.' });

    // Une conversion par visite d'Ann, avec la personne dans les métadonnées ET la preuve de paiement à côté.
    for (const clickId of [annA, annB]) {
      const conversion = await prisma.conversion.create({
        data: {
          clickId,
          campaignId,
          eventType: 'lead',
          metadata: { phone: ANN_PHONE, email: ANN_MAIL, consent: CONSENT, txid: '1758019200000', payout: '12.50' },
          incomingPostbackUrl: `https://track/pb?cid=${clickId}&p1=${ANN_MAIL}&txid=1758019200000`,
        },
      });
      await prisma.postbackLog.create({
        data: {
          conversionId: conversion.id,
          url: `https://buyer/pb?phone=${ANN_PHONE}&txid=1758019200000`,
          network: 'facebook',
          method: 'GET',
          success: true,
        },
      });
    }

    const annLead = await prisma.lead.findUnique({ where: { clickId: annA } });
    const out = await service.deleteOne(annLead!.id, 'admin@example.com');
    expect(out.deleted).toBe(true);

    // 1. Les DEUX visites d'Ann sont effacées — c'est ce que le correctif mort du tour 10 ne faisait pas.
    for (const clickId of [annA, annB]) {
      const lead = await prisma.lead.findUnique({ where: { clickId } });
      expect([lead!.firstName, lead!.lastName, lead!.phone, lead!.email, lead!.zip, lead!.state]).toEqual([
        null, null, null, null, null, null,
      ]);
      expect(lead!.erasedAt).not.toBeNull();
      const click = await prisma.click.findUnique({ where: { clickId } });
      expect([click!.ipAddress, click!.userAgent, click!.acceptLanguage]).toEqual([null, null, null]);
      expect(JSON.stringify(click!.rawParams)).not.toContain(ANN_PHONE);
      expect(JSON.stringify(click!.rawParams)).not.toContain('Ann');
      expect(click!.referrer).not.toContain(ANN_PHONE);
      const conversions = await prisma.conversion.findMany({ where: { clickId } });
      for (const conversion of conversions) {
        const serialized = JSON.stringify(conversion.metadata);
        expect(serialized).not.toContain(ANN_PHONE);
        expect(serialized).not.toContain(ANN_MAIL);
        expect(serialized).not.toContain('Ann Dupont');
        // Ce qui n'est pas la personne reste lisible : sans quoi la réconciliation des paiements est perdue.
        expect(serialized).toContain('1758019200000');
        expect(conversion.incomingPostbackUrl).not.toContain(ANN_MAIL);
        expect(conversion.incomingPostbackUrl).toContain('txid=1758019200000');
      }
      const logs = await prisma.postbackLog.findMany({ where: { conversion: { clickId } } });
      for (const log of logs) expect(log.url).not.toContain(ANN_PHONE);
    }

    // 2. Personne d'autre n'a bougé : ni celles qui partagent le standard, ni leur preuve de consentement.
    for (const clickId of [bob, dave, carl]) {
      const lead = await prisma.lead.findUnique({ where: { clickId } });
      expect(lead!.phone).toBe(SWITCHBOARD);
      expect(lead!.firstName).not.toBeNull();
      expect(lead!.consentText).not.toBeNull();
      expect(lead!.erasedAt).toBeNull();
    }

    // 3. Carl demande à son tour : lui seul part, alors que Bob et Dave portent exactement le même numéro.
    const carlLead = await prisma.lead.findUnique({ where: { clickId: carl } });
    expect((await service.deleteOne(carlLead!.id, 'admin@example.com')).deleted).toBe(true);
    expect((await prisma.lead.findUnique({ where: { clickId: carl } }))!.phone).toBeNull();
    for (const clickId of [bob, dave]) {
      const lead = await prisma.lead.findUnique({ where: { clickId } });
      expect([lead!.phone, lead!.firstName === null, lead!.erasedAt]).toEqual([SWITCHBOARD, false, null]);
      expect(lead!.consentText).not.toBeNull();
    }
  });

  it('stops at the person when two people share one computer', async () => {
    // Le `visitor_id` identifie un NAVIGATEUR, pas quelqu'un. Deux membres d'un foyer sur le même ordinateur le
    // partagent : sans garde, la demande de l'un effaçait le lead ET la preuve de consentement de l'autre — une
    // destruction irréversible de la donnée d'un tiers, et de ce qui prouvait qu'on avait le droit de l'appeler.
    const shared = `v-foyer-${tag}`;
    const hers = await visit('foyer-a', shared, {
      firstName: 'Claire', phone: '7275550111', consentText: 'Claire agrees to be called.',
    });
    const his = await visit('foyer-b', shared, {
      firstName: 'Marc', phone: '7275550222', consentText: 'Marc agrees to be called.',
    });
    const hersLead = await prisma.lead.findUnique({ where: { clickId: hers } });
    expect((await service.deleteOne(hersLead!.id, 'admin@example.com')).deleted).toBe(true);
    expect((await prisma.lead.findUnique({ where: { clickId: hers } }))!.phone).toBeNull();
    const marc = await prisma.lead.findUnique({ where: { clickId: his } });
    expect([marc!.firstName, marc!.phone, marc!.consentText, marc!.erasedAt]).toEqual([
      'Marc', '7275550222', 'Marc agrees to be called.', null,
    ]);
  });

  it('erases a person whose visit never produced a lead, including her other visit', async () => {
    // Une seule personne, deux visites du MÊME navigateur : la première n'a jamais produit de lead (son adresse
    // n'existe que dans l'URL d'atterrissage), la seconde oui. C'est la route « visite », celle qui n'a pas d'id.
    const visitor = `v-eve-${tag}`;
    const bare = await visit('eve-bare', visitor, null, { email: 'eve@example.com' });
    const withLead = await visit('eve-lead', visitor, {
      firstName: 'Eve',
      phone: '7275550199',
      email: 'eve@example.com',
      consentText: 'Eve agrees to be called at 727-555-0199.',
    });

    const out = await service.eraseVisit(bare, 'admin@example.com');
    expect(out.erased).toBe(true);

    // La visite nue porte une pierre tombale — sans elle, un postback tardif réécrirait la personne.
    const tomb = await prisma.lead.findUnique({ where: { clickId: bare } });
    expect(tomb!.erasedAt).not.toBeNull();
    // Et l'autre visite du même navigateur, qui portait tout, est vidée elle aussi.
    const other = await prisma.lead.findUnique({ where: { clickId: withLead } });
    expect([other!.firstName, other!.phone, other!.email, other!.consentText]).toEqual([null, null, null, null]);
    expect(other!.erasedAt).not.toBeNull();
    const click = await prisma.click.findUnique({ where: { clickId: withLead } });
    expect(JSON.stringify(click!.rawParams)).not.toContain('eve@example.com');
  });
});
