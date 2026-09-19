import { PrismaClient } from '@prisma/client';
import { leadFromConversion } from '../../src/leads/lead-fields';
import { fillLead, scrubClicks, scrubConversionMetadata, scrubVisitPii, visitsDueForPurge } from '../../src/leads/lead-sql';

/**
 * Runs the raw statements against a real Postgres, because that is the only way to prove what they claim: that two
 * events of the same visit can fill a lead at the same time without overwriting each other, that an erased or purged
 * row is never touched, and that the scrubs reach every copy of the person.
 *
 * Skipped unless LEAD_SQL_TEST_URL points at a throwaway database with this schema:
 *   createdb lead_it && DATABASE_URL=… npx prisma db push
 *   LEAD_SQL_TEST_URL=… npx jest test/integration/lead-sql.pg.spec.ts --runInBand
 */
const url = process.env.LEAD_SQL_TEST_URL;
const describeIfPg = url ? describe : describe.skip;

describeIfPg('lead SQL against a real Postgres', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: url ?? 'postgresql://unused' } } });
  let campaignId = '';

  beforeAll(async () => {
    await prisma.$connect();
    const campaign = await prisma.campaign.create({
      data: {
        name: 'lead-sql-it',
        slug: `lead-sql-it-${Date.now()}`,
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

  async function visit(clickId: string, lead: Partial<Record<string, unknown>> = {}) {
    await prisma.click.create({
      data: {
        clickId,
        campaignId,
        fbclid: 'fb.click.abc123',
        gclid: 'gclid-abc',
        trackingId: 'tk-abc',
        externalClickId: 'ext-abc',
        ipAddress: '203.0.113.7',
        userAgent: 'UA',
        acceptLanguage: 'en-US',
        referrer: 'https://facebook.com/',
        rawParams: { name: 'Ann', phone: '4155550134', utm_source: 'facebook' },
        requestHeaders: { 'x-forwarded-for': '203.0.113.7' },
      },
    });
    await prisma.lead.create({
      data: { clickId, campaignId, source: 'quiz', answers: { q1: 'yes' }, ...(lead as object) },
    });
  }

  it('lets two events of the same visit fill the lead without losing either', async () => {
    const clickId = `it-race-${Date.now()}`;
    await visit(clickId);
    const phoneSide = leadFromConversion({ phone: '813-555-0142', q2: '2', consent: 'I agree to be called' });
    const emailSide = leadFromConversion({ email: 'ann@example.com', q3: 'no' });
    await Promise.all([
      fillLead(prisma, clickId, phoneSide, 'conv-a'),
      fillLead(prisma, clickId, emailSide, 'conv-b'),
    ]);
    const lead = await prisma.lead.findUnique({ where: { clickId } });
    expect(lead?.phone).toBe('8135550142');
    expect(lead?.email).toBe('ann@example.com');
    expect(lead?.answers).toEqual({ q1: 'yes', q2: '2', q3: 'no' });
    // The consent that arrived with a contact is the one that authorises the call.
    expect(lead?.consentText).toBe('I agree to be called');
    expect(lead?.consentHash).toBe(phoneSide.consentHash);
  });

  it('keeps what was recorded first and never touches an erased or purged row', async () => {
    const kept = `it-first-${Date.now()}`;
    await visit(kept, { firstName: 'Margaret', phone: '8135550142' });
    expect(await fillLead(prisma, kept, leadFromConversion({ name: 'Other', phone: '4155550134' }))).toBe(1);
    const unchanged = await prisma.lead.findUnique({ where: { clickId: kept } });
    expect([unchanged?.firstName, unchanged?.phone]).toEqual(['Margaret', '8135550142']);

    const erased = `it-erased-${Date.now()}`;
    await visit(erased, { erasedAt: new Date(), purgedAt: new Date() });
    expect(await fillLead(prisma, erased, leadFromConversion({ phone: '4155550134' }))).toBe(0);
    expect((await prisma.lead.findUnique({ where: { clickId: erased } }))?.phone).toBeNull();
  });

  it('scrubs the person from the conversion metadata, the incoming URL and the visit', async () => {
    const clickId = `it-scrub-${Date.now()}`;
    await visit(clickId);
    await prisma.conversion.create({
      data: {
        clickId,
        campaignId,
        eventType: 'lead',
        metadata: { name: 'Ann', phone: '4155550134', q1: 'yes', nested: { email: 'ann@example.com', zip: '33602' } },
        incomingPostbackUrl: 'https://track.example.com/postback?cid=x&email=ann@example.com',
      },
    });
    expect(await scrubConversionMetadata(prisma, [clickId])).toBe(1);
    expect(await scrubClicks(prisma, [clickId])).toBe(1);
    const conversion = await prisma.conversion.findFirst({ where: { clickId } });
    const click = await prisma.click.findUnique({ where: { clickId } });
    expect(conversion?.metadata).toEqual({ q1: 'yes', nested: { email: 'ann@example.com', zip: '33602' } });
    expect(conversion?.incomingPostbackUrl).toBe('https://track.example.com/postback?[purged]');
    expect(click?.rawParams).toEqual({ utm_source: 'facebook' });
    expect([click?.ipAddress, click?.userAgent, click?.acceptLanguage]).toEqual([null, null, null]);
    // Le référent garde son origine et perd sa query string : un onglet du drill-down le lit, et une URL de
    // provenance porte régulièrement l'adresse dans ses paramètres.
    expect(click?.referrer).toBe('https://facebook.com/');
  });

  it('reaches what the statement alone cannot: nested metadata, postback columns, visitor id and logs', async () => {
    const clickId = `it-deep-${Date.now()}`;
    await visit(clickId);
    await prisma.click.update({ where: { clickId }, data: { visitorId: 'v-abc' } });
    const conversion = await prisma.conversion.create({
      data: {
        clickId,
        campaignId,
        eventType: 'lead',
        metadata: { q1: 'yes', lead: { phone: '4155550134', zip: '33602' } },
        incomingPostbackUrl: 'https://track.example.com/postback?cid=x&email=ann@example.com',
        incomingPostbackIp: '198.51.100.9',
        postbackParam1: 'ann@example.com',
        postbackParam5: '4155550134',
      },
    });
    await prisma.postbackLog.create({
      data: {
        conversionId: conversion.id,
        network: 'mediago',
        method: 'POST',
        url: 'https://buyer.example.com/lead?phone=4155550134',
        requestBody: '{"phone":"4155550134","hash":"9c1185a5c5e9fc54612808977ee8f548b2258d31"}',
        response: '{"accepted":true,"phone":"4155550134"}',
      },
    });

    await scrubVisitPii(prisma, [clickId], 'erased');

    const after = await prisma.conversion.findUnique({ where: { id: conversion.id } });
    const click = await prisma.click.findUnique({ where: { clickId } });
    const log = await prisma.postbackLog.findFirst({ where: { conversionId: conversion.id } });
    // Le `metadata - 'phone'` du SQL ne descend pas d'un niveau : c'est la relecture qui l'achève. Et sur un
    // effacement, le code postal et les réponses du quiz partent aussi : croisés, ils désignent encore quelqu'un.
    expect(after?.metadata).toEqual({ lead: {} });
    expect([after?.incomingPostbackIp, after?.postbackParam1, after?.postbackParam5]).toEqual([null, null, null]);
    // L'URL garde son adresse : l'écran « postbacks entrants » ne liste que les lignes qui en ont une.
    expect(after?.incomingPostbackUrl).toBe('https://track.example.com/postback?[erased]');
    // Effacement demandé : le lien entre les visites de cette personne est coupé net.
    expect(click?.visitorId).toBeNull();
    // La graine de l'identifiant publicitaire part aussi : `fbc` se reconstruit à partir de `fbclid` et repartirait
    // chez Meta au premier postback tardif.
    expect([click?.fbclid, click?.gclid, click?.trackingId, click?.externalClickId]).toEqual([null, null, null, null]);
    // Le corps et la réponse partent ; l'URL sortante est masquée, pas remplacée — c'est la piste d'audit du
    // paiement (réseau, txid, montant) que l'export lit comme colonne « outgoing ».
    expect([log?.requestBody, log?.response]).toEqual([null, null]);
    expect(log?.url).toBe('https://buyer.example.com/lead?phone=***');
    // Les marques sont posées en dernier, une fois tout le reste écrit.
    expect(after?.scrubbedAt).toBeInstanceOf(Date);
    expect(click?.scrubbedAt).toBeInstanceOf(Date);
  });

  it('keeps the visitor count intact on retention, and clears the ten free columns', async () => {
    const first = `it-visitor-a-${Date.now()}`;
    const second = `it-visitor-b-${Date.now()}`;
    for (const clickId of [first, second]) {
      await prisma.click.create({
        data: {
          clickId,
          campaignId,
          // Deux visites de la même personne : après la rétention, elles doivent encore compter pour un visiteur.
          visitorId: 'v-same-person',
          ipAddress: '203.0.113.7',
          customVariable1: 'Ann',
          customVariable10: '4155550134',
        },
      });
    }
    await scrubVisitPii(prisma, [first, second], 'purged');
    const rows = await prisma.click.findMany({ where: { clickId: { in: [first, second] } } });
    const visitors = new Set(rows.map((r) => r.visitorId));
    expect(visitors.size).toBe(1);
    expect([...visitors][0]).toMatch(/^p:[0-9a-f]{32}$/);
    expect([...visitors][0]).not.toBe('v-same-person');
    expect(rows.map((r) => [r.customVariable1, r.customVariable10])).toEqual([
      [null, null],
      [null, null],
    ]);
    // Un second passage ne change plus rien : le pseudonyme n'est pas repseudonymisé.
    await scrubVisitPii(prisma, [first, second], 'purged');
    const again = await prisma.click.findMany({ where: { clickId: { in: [first, second] } } });
    expect(new Set(again.map((r) => r.visitorId))).toEqual(visitors);
  });

  it('comes back for a postback that lands after the visit was swept', async () => {
    const clickId = `it-late-${Date.now()}`;
    const old = new Date('2020-01-01T00:00:00Z');
    const cutoff = new Date('2026-01-01T00:00:00Z');
    await prisma.click.create({ data: { clickId, campaignId, createdAt: old, ipAddress: '203.0.113.1' } });
    await scrubVisitPii(prisma, [clickId], 'purged');
    expect((await visitsDueForPurge(prisma, cutoff, 100)).map((d) => d.click_id)).not.toContain(clickId);

    // L'acheteur renvoie l'adresse des mois plus tard : la conversion naît sans marque, donc le balayage la reprend.
    await prisma.conversion.create({
      data: {
        clickId,
        campaignId,
        eventType: 'lead_sold',
        createdAt: old,
        postbackParam1: 'ann@example.com',
        metadata: { phone: '4155550134' },
      },
    });
    expect((await visitsDueForPurge(prisma, cutoff, 100)).map((d) => d.click_id)).toContain(clickId);
    await scrubVisitPii(prisma, [clickId], 'purged');
    const late = await prisma.conversion.findFirst({ where: { clickId }, orderBy: { createdAt: 'desc' } });
    expect([late?.postbackParam1, late?.metadata]).toEqual([null, {}]);
    expect((await visitsDueForPurge(prisma, cutoff, 100)).map((d) => d.click_id)).not.toContain(clickId);
  });

  it('clears a person from the landing query string even under a name nobody knows', async () => {
    const clickId = `it-raw-${Date.now()}`;
    await prisma.click.create({
      data: {
        clickId,
        campaignId,
        ipAddress: '203.0.113.7',
        // Ni `sub1` ni `u1` ne figurent dans une liste de clés : seule la valeur les trahit.
        rawParams: { sub1: 'ann@example.com', u1: '(813) 555-0142', zip: '33602', utm_source: 'facebook', ts: '1758019200000' },
      },
    });
    await scrubVisitPii(prisma, [clickId], 'erased');
    const click = await prisma.click.findUnique({ where: { clickId } });
    // Ce qui n'est pas une personne reste lisible : la source du trafic et l'horodatage du postback.
    expect(click?.rawParams).toEqual({ utm_source: 'facebook', ts: '1758019200000' });
  });

  it('never marks a conversion that landed after the sweep had read the visit', async () => {
    const clickId = `it-late-mark-${Date.now()}`;
    const old = new Date('2020-01-01T00:00:00Z');
    await prisma.click.create({ data: { clickId, campaignId, createdAt: old, ipAddress: '203.0.113.2' } });
    const first = await prisma.conversion.create({
      data: { clickId, campaignId, eventType: 'lead', createdAt: old, metadata: { phone: '4155550134' } },
    });
    await scrubVisitPii(prisma, [clickId], 'purged');
    // Arrivée après coup, comme un postback acheteur tardif pendant le balayage de la nuit.
    const late = await prisma.conversion.create({
      data: { clickId, campaignId, eventType: 'lead_sold', createdAt: old, postbackParam1: 'ann@example.com' },
    });
    const rows = await prisma.conversion.findMany({ where: { clickId }, select: { id: true, scrubbedAt: true } });
    const marks = Object.fromEntries(rows.map((r) => [r.id, r.scrubbedAt !== null]));
    expect(marks[first.id]).toBe(true);
    expect(marks[late.id]).toBe(false);
    // Donc le balayage la reprend, au lieu de la tenir pour nettoyée.
    expect((await visitsDueForPurge(prisma, new Date('2026-01-01T00:00:00Z'), 100)).map((d) => d.click_id)).toContain(clickId);
  });

  it('finds the visits past retention that never became a lead, and stops finding them once cleared', async () => {
    const clickId = `it-visit-${Date.now()}`;
    // Une visite sans lead : un postback acheteur, une écriture de lead qui a échoué, un nom dans l'URL d'atterrissage.
    await prisma.click.create({
      data: {
        clickId,
        campaignId,
        createdAt: new Date('2020-01-01T00:00:00Z'),
        ipAddress: '203.0.113.9',
        rawParams: { email: 'ann@example.com', utm_source: 'facebook' },
      },
    });
    const cutoff = new Date('2026-01-01T00:00:00Z');
    const due = await visitsDueForPurge(prisma, cutoff, 100);
    expect(due.map((d) => d.click_id)).toContain(clickId);

    await scrubVisitPii(prisma, [clickId], 'purged');

    const again = await visitsDueForPurge(prisma, cutoff, 100);
    expect(again.map((d) => d.click_id)).not.toContain(clickId);
    const click = await prisma.click.findUnique({ where: { clickId } });
    expect(click?.ipAddress).toBeNull();
    // Ce que les rapports lisent reste : la source de trafic n'est pas une personne.
    expect(click?.rawParams).toEqual({ utm_source: 'facebook' });
  });
});
