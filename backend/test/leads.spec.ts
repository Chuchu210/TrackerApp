import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConversionsService } from '../src/conversions/conversions.service';
import {
  carriesContact,
  csvCell,
  errorLabel,
  looksPersonal,
  redactPersonal,
  sanitizeUrlPii,
  withoutContact,
  hasContact,
  isContactEvent,
  leadFromConversion,
  mergeLeadData,
  normalizeEmail,
  normalizePhone,
} from '../src/leads/lead-fields';
import { ApiKeyGuard } from '../src/common/guards/api-key.guard';
import { ThrottlerGuard } from '@nestjs/throttler';
import { LeadsController } from '../src/leads/leads.controller';
import { alias, LeadsService } from '../src/leads/leads.service';
import { contactFingerprints, contactsInAnything } from '../src/leads/lead-fields';

/** Une clé de la longueur exigée en production (32 caractères au moins). */
const CLE_TEST = 'cle-de-test-0123456789abcdef-0123456789';
/** Le témoin que cette clé a posé : les doubles le rendent, comme une base déjà initialisée. */
const TEMOIN_TEST = contactFingerprints({ email: 'temoin@liste-de-suppression.invalid' }, CLE_TEST)[0].hash;

/**
 * Les doubles de Prisma, complétés de ce que les tests anciens ne connaissaient pas : la liste de suppression
 * (vide) et la lecture des visites sœurs (aucune). Un test qui veut autre chose passe le sien, qui l'emporte.
 */
function avecDefauts(prisma: Record<string, unknown>) {
  const lead = (prisma.lead ?? {}) as Record<string, unknown>;
  const click = (prisma.click ?? {}) as Record<string, unknown>;
  const conversion = (prisma.conversion ?? {}) as Record<string, unknown>;
  const liste = (prisma.erasedContact ?? listeDeSuppressionVide().erasedContact) as Record<string, jest.Mock>;
  // Une liste fournie par le test ne sait pas forcément répondre à la question du témoin : on la lui apprend,
  // sans toucher à ce qu'elle répond pour les personnes.
  const trouverSansTemoin = liste.findFirst;
  return {
    ...prisma,
    erasedContact: {
      // La promotion « trouvé → déclaré » (tour 24) : les doubles anciens ne la connaissaient pas.
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      // La lecture groupée (tour 31) : une liste qui ne la fournit pas est vide.
      findMany: jest.fn().mockResolvedValue([]),
      ...liste,
      findFirst: jest.fn().mockImplementation((args: { where: { kind?: string } }) =>
        args?.where?.kind === 'temoin' ? Promise.resolve({ hash: TEMOIN_TEST }) : trouverSansTemoin(args),
      ),
    },
    lead: { findMany: jest.fn().mockResolvedValue([]), ...lead },
    click: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null), ...click },
    conversion: { findMany: jest.fn().mockResolvedValue([]), ...conversion },
  };
}

/** La liste de suppression, vide : personne n'a demandé son effacement, et les écritures passent. */
function listeDeSuppressionVide() {
  return {
    erasedContact: {
      // Le témoin est déjà posé (base initialisée) ; aucune personne n'est inscrite.
      findFirst: jest.fn().mockImplementation(({ where }: { where: { kind?: string } }) =>
        Promise.resolve(where?.kind === 'temoin' ? { hash: TEMOIN_TEST } : null),
      ),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
}


describe('lead fields', () => {
  const now = new Date('2026-09-16T10:00:00Z');

  it('reads contact, answers and consent from the lead metadata', () => {
    const lead = leadFromConversion(
      {
        name: ' Ann ',
        phone: '+1 (415) 555-0134',
        zip: '94107',
        state: 'California',
        q1: 'yes',
        q2: '2',
        insured: 'yes',
        consent: 'By submitting  you agree to be called...',
        pageUrl: 'https://nexoquote.com/form/',
        source: 'form',
        fbp: 'fb.1.2.3',
        nested: { a: 1 },
      },
      { incomingPostbackIp: '203.0.113.7', userAgent: 'Mozilla/5.0' },
      now,
    );
    expect(lead).toEqual({
      source: 'form',
      firstName: 'Ann',
      lastName: null,
      email: null,
      phone: '4155550134',
      zip: '94107',
      state: 'California',
      answers: { q1: 'yes', q2: '2', insured: 'yes' },
      consentText: 'By submitting  you agree to be called...',
      consentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      consentAt: now,
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0',
      pageUrl: 'https://nexoquote.com/form/',
    });
  });

  it('gives the same consent hash whatever the spacing of the same text', () => {
    const a = leadFromConversion({ consent: 'I agree to be called', phone: '4155550134' });
    const b = leadFromConversion({ consent: ' I agree   to be\ncalled ', phone: '4155550134' });
    expect(a.consentHash).toBe(b.consentHash);
  });

  it('knows which events can carry a contact', () => {
    expect(CONTACT_EVENTS.map(isContactEvent)).toEqual([true, true, true]);
    expect(['quiz_started', 'quiz_q2', 'call_click', 'lead_sold'].map(isContactEvent)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it('tells a funnel step apart from a real lead', () => {
    expect(hasContact(leadFromConversion({ q1: 'no', q3: 'yes' }))).toBe(false);
    expect(hasContact(leadFromConversion({ phone: '4155550134' }))).toBe(true);
    expect(hasContact(leadFromConversion({ email: 'ann@example.com' }))).toBe(true);
    expect(hasContact(leadFromConversion({ name: 'Ann' }))).toBe(true);
  });

  it('merges the quiz answers with the callback contact, keeping what came first', () => {
    const quiz = leadFromConversion({ q1: 'yes', q2: '2', state: 'Florida' }, undefined, now);
    const callback = leadFromConversion(
      { name: 'Margaret', phone: '813-555-0142', zip: '33602', q3: 'no', state: 'Texas', source: 'callback' },
      undefined,
      now,
    );
    const merged = mergeLeadData(quiz, callback);
    expect(merged).toMatchObject({
      source: 'callback',
      firstName: 'Margaret',
      phone: '8135550142',
      zip: '33602',
      state: 'Florida',
      answers: { q1: 'yes', q2: '2', q3: 'no' },
    });
  });

  it('drops what cannot be a phone or an email', () => {
    expect(normalizePhone('12')).toBeNull();
    expect(normalizePhone('14155550134')).toBe('4155550134');
    expect(normalizePhone('1'.repeat(20))).toBeNull();
    expect(normalizeEmail('not-an-email')).toBeNull();
    expect(normalizeEmail(' Ann@Example.COM ')).toBe('ann@example.com');
  });

  it('never lets a spreadsheet run a formula from a lead field', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+1 415')).toBe("'+1 415");
    expect(csvCell('  =1+1')).toBe("'  =1+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell(null)).toBe('');
    expect(csvCell({ q1: 'yes' })).toBe('"{""q1"":""yes""}"');
  });
});

const CONTACT_EVENTS = ['lead', 'callback_request', 'postalcode'];

/** Le SQL d'un appel `$executeRaw` (gabarit balisé), paramètres remplacés par « ? ». */
function sqlOf(call: unknown[]): string {
  // Tour 32 : les SET sont GENERES du registre, en fragments Prisma imbriques ; le texte rendu les deplie (les noms de
  // colonne y sont en clair, les valeurs restent des « ? »).
  return Prisma.sql(call[0] as TemplateStringsArray, ...(call.slice(1) as never[])).sql.replace(/\s+/g, ' ');
}

describe('one lead per visit, filled in as the events arrive', () => {
  function setup(overrides: Record<string, unknown> = {}) {
    const prisma = {
      click: {
        findUnique: jest.fn().mockResolvedValue({
          clickId: 'c1',
          campaignId: 'camp-1',
          createdAt: new Date(Date.now() - 60 * 60 * 1000),
          fbclid: null,
          isTest: false,
          campaign: { attributionWindowHours: null, maxConversionsPerClick: null },
        }),
      },
      conversion: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(async ({ data }) => ({ id: 'conv-1', ...data })),
      },
      lead: {
        upsert: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      ...overrides,
    };
    const service = new ConversionsService(
      prisma as never,
      { processConversion: jest.fn().mockResolvedValue(undefined) } as never,
      { get: jest.fn().mockReturnValue(undefined) } as never,
      { getEffective: jest.fn().mockResolvedValue({ baseCurrency: 'EUR', fxRates: '', testMode: false }) } as never,
    );
    return { service, prisma };
  }

  it('creates no lead for a quiz step, but completes the visit if a lead already exists', async () => {
    const { service, prisma } = setup();
    await service.create({ clickId: 'c1', eventType: 'lead', metadata: { q1: 'yes', q2: '2' } } as never, {
      trusted: false,
    });
    expect(prisma.lead.create).not.toHaveBeenCalled();
    // Le UPDATE ne touche rien s'il n'y a pas de ligne : une étape du tunnel ne crée jamais un lead.
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(sqlOf(prisma.$executeRaw.mock.calls[0])).toContain('"erased_at" IS NULL AND "purged_at" IS NULL');
  });

  it('creates the lead when the callback brings the contact, with the answers already sent', async () => {
    const { service, prisma } = setup();
    prisma.conversion.findMany.mockResolvedValue([
      { metadata: { q1: 'yes', q2: '2', state: 'Florida' } },
      { metadata: { name: 'Margaret', phone: '813-555-0142' } },
    ]);
    await service.create(
      {
        clickId: 'c1',
        eventType: 'callback_request',
        metadata: { name: 'Margaret', phone: '813-555-0142', zip: '33602' },
      } as never,
      { trusted: false, incomingPostbackIp: '203.0.113.7', userAgent: 'UA' },
    );
    expect(prisma.lead.create).toHaveBeenCalledTimes(1);
    expect(prisma.lead.create.mock.calls[0][0].data).toMatchObject({
      clickId: 'c1',
      campaignId: 'camp-1',
      conversionId: 'conv-1',
      firstName: 'Margaret',
      phone: '8135550142',
      zip: '33602',
      state: 'Florida',
      answers: { q1: 'yes', q2: '2' },
      ip: '203.0.113.7',
      isTest: false,
    });
  });

  it('fills the existing lead instead of making a second one, even on a duplicate conversion', async () => {
    const { service, prisma } = setup();
    prisma.conversion.findUnique.mockResolvedValue({ id: 'conv-0' });
    prisma.lead.create.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));
    await service.create(
      { clickId: 'c1', eventType: 'lead', metadata: { name: 'Ann', phone: '4155550134' } } as never,
      { trusted: false },
    );
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const sql = sqlOf(prisma.$executeRaw.mock.calls[0]);
    expect(sql).toContain('UPDATE "leads"');
    expect(sql).toContain('"phone" = COALESCE("phone", ?)');
    expect(sql).toContain('"erased_at" IS NULL AND "purged_at" IS NULL');
    expect(prisma.$executeRaw.mock.calls[0]).toContain('4155550134');
  });

  it('creates no lead for events that never carry a contact', async () => {
    const { service, prisma } = setup();
    await service.create({ clickId: 'c1', eventType: 'quiz_started', metadata: { step: 1 } } as never, {
      trusted: false,
    });
    expect(prisma.lead.create).not.toHaveBeenCalled();
    expect(prisma.lead.findUnique).not.toHaveBeenCalled();
  });

  it('never loses the conversion when the lead row fails', async () => {
    const { service, prisma } = setup();
    prisma.lead.create.mockRejectedValue(new Error('db down'));
    const out = await service.create(
      { clickId: 'c1', eventType: 'lead', metadata: { phone: '4155550134' } } as never,
      { trusted: false },
    );
    expect(prisma.conversion.create).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ conversion: { id: 'conv-1' }, duplicate: false });
  });
});

describe('leads admin', () => {
  function service(
    prisma: Record<string, unknown>,
    config: Record<string, string> = {},
    conversions: Record<string, unknown> = { create: jest.fn().mockResolvedValue({ id: 'conv-1' }) },
  ) {
    return new LeadsService(
      // La clé de la liste de suppression fait partie de la configuration réelle : sans elle, aucun effacement
      // ne peut plus noter la personne. Un test qui veut son absence la retire explicitement.
      { get: jest.fn().mockImplementation((k: string) => ({ ERASURE_HMAC_KEY: CLE_TEST, ...config })[k]) } as never,
      // La liste de suppression par défaut : vide, et qui accepte les écritures. Un test qui veut une personne
      // déjà effacée passe son propre `erasedContact` — il écrase celui-ci.
      avecDefauts(prisma) as never,
      conversions as never,
    );
  }

  it('hides test leads by default and caps the page size', async () => {
    const prisma = {
      lead: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      campaign: { findMany: jest.fn().mockResolvedValue([]) },
    };
    await service(prisma).list({ limit: 10000, search: '415 555' });
    const args = prisma.lead.findMany.mock.calls[0][0];
    expect(args.take).toBe(500);
    expect(args.where.isTest).toBe(false);
    expect(args.where.OR).toEqual(expect.arrayContaining([{ phone: { contains: '415555' } }]));
  });

  it('recreates a missing lead and completes an incomplete one', async () => {
    const created = new Date('2026-09-16T09:00:00Z');
    const prisma = {
      conversion: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'x1', clickId: 'c1', campaignId: 'camp-1', metadata: { q1: 'yes' }, createdAt: created, isTest: false },
          { id: 'x2', clickId: 'c1', campaignId: 'camp-1', metadata: { phone: '4155550134' }, createdAt: created, isTest: false },
          { id: 'y1', clickId: 'c2', campaignId: 'camp-1', metadata: { q1: 'no' }, createdAt: created, isTest: false },
          { id: 'z1', clickId: 'c3', campaignId: 'camp-1', metadata: { email: 'ann@example.com' }, createdAt: created, isTest: false },
        ]),
      },
      lead: {
        upsert: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([{ clickId: 'c3' }]),
        create: jest.fn().mockResolvedValue({}),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    const out = await service(prisma).reconcileRecentLeads();
    expect(out).toEqual({ created: 1, repaired: 1, checked: 3 });
    expect(prisma.lead.create.mock.calls[0][0].data).toMatchObject({ clickId: 'c1', phone: '4155550134', answers: { q1: 'yes' } });
    expect(prisma.$executeRaw.mock.calls[0]).toContain('c3');
  });

  it('never brings back a lead that was erased or purged', async () => {
    const created = new Date('2026-09-16T09:00:00Z');
    const prisma = {
      conversion: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'x1', clickId: 'c1', campaignId: 'camp-1', metadata: { phone: '4155550134' }, createdAt: created, isTest: false },
        ]),
      },
      lead: { findMany: jest.fn().mockResolvedValue([{ clickId: 'c1' }]), create: jest.fn() },
      // La ligne est effacée : le UPDATE gardé par erased_at/purged_at ne modifie rien.
      $executeRaw: jest.fn().mockResolvedValue(0),
    };
    expect(await service(prisma).reconcileRecentLeads()).toEqual({ created: 0, repaired: 0, checked: 1 });
    expect(prisma.lead.create).not.toHaveBeenCalled();
  });

  it('purges by batches, and reaches every copy of the person', async () => {
    const prisma = {
      lead: {
        upsert: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValueOnce([{ clickId: 'c1' }, { clickId: 'c2' }]).mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      conversion: {
        findMany: jest.fn().mockResolvedValue([{ id: 'conv-1' }]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      click: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      postbackLog: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      $executeRaw: jest.fn().mockResolvedValue(3),
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    expect(await service(prisma).purgePersonalData()).toEqual({ purged: 0, visits: 0, days: 0 });
    expect(prisma.lead.updateMany).not.toHaveBeenCalled();
    const out = await service(prisma, { LEADS_PII_RETENTION_DAYS: '90' }).purgePersonalData(
      new Date('2026-09-16T00:00:00Z'),
    );
    expect(out).toEqual({ purged: 2, visits: 0, days: 90 });
    expect(prisma.lead.findMany.mock.calls[0][0]).toMatchObject({
      where: { createdAt: { lt: new Date('2026-06-18T00:00:00Z') }, purgedAt: null, erasedAt: null },
    });
    expect(prisma.lead.updateMany.mock.calls[0][0].data).toMatchObject({ phone: null, email: null, ip: null, pageUrl: null });
    // Trois autres copies de la même personne : métadonnées des conversions, colonnes du clic, journaux de postback.
    const statements = prisma.$executeRaw.mock.calls.map((c) => sqlOf(c));
    expect(statements.some((sql) => sql.includes('UPDATE "conversions"'))).toBe(true);
    expect(statements.some((sql) => sql.includes('UPDATE "clicks"'))).toBe(true);
    // Les acheteurs écrivent l'e-mail et le téléphone dans les paramètres de postback autant que dans l'URL.
    expect(statements.some((sql) => sql.includes('"postback_param_1" = NULL'))).toBe(true);
    expect(statements.some((sql) => sql.includes('"incoming_postback_ip" = NULL'))).toBe(true);
    // À la rétention le visiteur devient un pseudonyme : le mettre à NULL ferait compter une personne revenue
    // trois fois comme trois visiteurs uniques, et l'historique des rapports changerait chaque nuit.
    // Le visiteur n'est pas effacé mais remplacé (le fragment pseudonyme est interpolé par Prisma) : le mettre à
    // NULL ferait compter une personne revenue trois fois comme trois visiteurs uniques, et l'historique des
    // rapports changerait chaque nuit. Le SQL exact est vérifié sur un vrai Postgres (lead-sql.pg.spec.ts).
    expect(statements.some((sql) => sql.includes('"visitor_id" = CASE'))).toBe(true);
    expect(statements.some((sql) => sql.includes('"custom_variable_10" = NULL'))).toBe(true);
    // Les journaux : le corps et la réponse partent, l'URL sortante est masquée (c'est la piste d'audit du paiement).
    expect(prisma.postbackLog.findMany).toHaveBeenCalledWith({
      where: { conversionId: { in: ['conv-1'] } },
      select: { id: true, url: true },
    });
    // La ligne porte la marque du nettoyage : sans elle, le rattrapage horaire la reprendrait indéfiniment.
    expect(prisma.lead.updateMany.mock.calls[1][0]).toMatchObject({
      where: { clickId: { in: ['c1', 'c2'] }, scrubbedAt: null },
      data: { scrubbedAt: new Date('2026-09-16T00:00:00Z') },
    });
  });

  it('sweeps the visits past retention that never became a lead', async () => {
    const prisma = {
      lead: {
        upsert: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      conversion: {
        findMany: jest.fn().mockResolvedValue([{ id: 'conv-9', metadata: { email: 'ann@example.com' } }]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      click: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      postbackLog: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      $executeRaw: jest.fn().mockResolvedValue(1),
      // Une visite qui a porté un e-mail sans jamais produire de lead : un postback acheteur, une création de ligne
      // qui a échoué, un nom dans la query string d'atterrissage.
      $queryRaw: jest.fn().mockResolvedValueOnce([{ click_id: 'c9', kept: true, why: 'demandée' }]).mockResolvedValue([]),
    };
    const out = await service(prisma, { LEADS_PII_RETENTION_DAYS: '90' }).purgePersonalData(
      new Date('2026-09-16T00:00:00Z'),
    );
    expect(out).toEqual({ purged: 0, visits: 1, days: 90 });
    expect(prisma.$queryRaw.mock.calls[0]).toContainEqual(new Date('2026-06-18T00:00:00Z'));
    const statements = prisma.$executeRaw.mock.calls.map((c) => sqlOf(c));
    expect(statements.some((sql) => sql.includes('UPDATE "conversions"'))).toBe(true);
    expect(statements.some((sql) => sql.includes('UPDATE "clicks"'))).toBe(true);
    expect(prisma.conversion.update).toHaveBeenCalledWith({ where: { id: 'conv-9' }, data: { metadata: {} } });
  });

  it('resumes a scrub that was interrupted between the tombstone and the cleanup', async () => {
    const prisma = {
      lead: {
        upsert: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([
          { id: 'lead-1', clickId: 'c1', erasedAt: new Date('2026-09-15T10:00:00Z') },
          { id: 'lead-2', clickId: 'c2', erasedAt: null },
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
      conversion: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn() },
      click: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn() },
      postbackLog: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn() },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    expect(await service(prisma).resumeInterruptedScrubs()).toEqual({ resumed: 2, pending: 2 });
    // Seules les lignes effacées ou purgées sans marque de nettoyage sont reprises.
    expect(prisma.lead.findMany.mock.calls[0][0].where).toMatchObject({ scrubbedAt: null });
    expect(prisma.lead.update.mock.calls[0][0]).toMatchObject({
      where: { id: 'lead-1' },
      data: { scrubbedAt: expect.any(Date) },
    });
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it('erases the person everywhere and keeps the row as a tombstone', async () => {
    const tx = { lead: { update: jest.fn().mockResolvedValue({}) } };
    const prisma = {
      lead: {
        upsert: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue({ id: 'lead-1', clickId: 'c1', purgedAt: null }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn(async (fn: (t: unknown) => Promise<void>) => fn(tx)),
      $executeRaw: jest.fn().mockResolvedValue(1),
      conversion: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'conv-1', metadata: { q1: 'yes', nested: { phone: '4155550134' } } },
          { id: 'conv-2', metadata: { q2: '2' } },
        ]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      click: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      postbackLog: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      // Une seule visite pour cette personne : le contre-exemple à plusieurs visites est dans le describe du tour 10.
      $queryRaw: jest.fn().mockResolvedValue([{ click_id: 'c1', kept: true, why: 'demandée' }]),
    };
    const out = await service(prisma).deleteOne('lead-1', 'admin@example.com');
    expect(out).toEqual({ deleted: true, conversionsScrubbed: 1 });
    expect(tx.lead.update.mock.calls[0][0].data).toMatchObject({
      firstName: null, phone: null, email: null, ip: null, userAgent: null, consentText: null, pageUrl: null,
      // Code postal, État et réponses du quiz désignent encore quelqu'un une fois croisés.
      zip: null, state: null,
      erasedAt: expect.any(Date), purgedAt: expect.any(Date),
    });
    // Les coordonnées vivaient aussi dans les métadonnées (jusque dans un objet imbriqué), dans le clic, dans l'URL
    // entrante et, hachées, dans les journaux de postback.
    const statements = prisma.$executeRaw.mock.calls.map((c) => sqlOf(c));
    expect(statements.some((sql) => sql.includes('UPDATE "conversions"'))).toBe(true);
    // L'URL garde son adresse et perd sa query string : l'écran « postbacks entrants » ne liste que les lignes qui
    // ont une URL, et la vider effacerait l'écran au lieu d'effacer une personne.
    expect(statements.some((sql) => sql.includes(`split_part("incoming_postback_url", '?', 1)`))).toBe(true);
    expect(statements.some((sql) => sql.includes('UPDATE "clicks"'))).toBe(true);
    // Effacement : les réponses du quiz partent aussi, comme dans la ligne du lead — croisées avec le code postal et
    // l'État elles désignent encore quelqu'un. La rétention, elle, les garde (les rapports les lisent).
    expect(prisma.conversion.update).toHaveBeenCalledWith({ where: { id: 'conv-1' }, data: { metadata: { nested: {} } } });
    // La seconde conversion ne portait que `q2` : elle est réécrite elle aussi, puisqu'un effacement emporte les
    // réponses. Une conversion sans rien à retirer, elle, n'est jamais touchée.
    expect(prisma.conversion.update).toHaveBeenCalledWith({ where: { id: 'conv-2' }, data: { metadata: {} } });
    expect(prisma.postbackLog.findMany).toHaveBeenCalledWith({
      where: { conversionId: { in: ['conv-1', 'conv-2'] } },
      select: { id: true, url: true },
    });
    // La marque n'est posée qu'après le nettoyage : coupé avant, le rattrapage horaire reprend la ligne. Et elle
    // est posée sur TOUTES les visites nettoyées : les pierres tombales sœurs naissaient sans marque, donc le
    // rattrapage horaire les reprenait à chaque effacement normal en journalisant un incident qui n'en était pas.
    expect(prisma.lead.updateMany).toHaveBeenCalledWith({
      where: { clickId: { in: ['c1'] } },
      data: { scrubbedAt: expect.any(Date) },
    });
  });

  it('reports when the lead is already gone', async () => {
    const prisma = { lead: { findUnique: jest.fn().mockResolvedValue(null) }, $transaction: jest.fn() };
    expect(await service(prisma).deleteOne('lead-1')).toEqual({ deleted: false });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('lead storage under race, erasure and failure', () => {
  function setup() {
    const prisma = {
      click: {
        findUnique: jest.fn().mockResolvedValue({
          clickId: 'c1',
          campaignId: 'camp-1',
          createdAt: new Date(Date.now() - 60 * 60 * 1000),
          fbclid: null,
          isTest: false,
          campaign: { attributionWindowHours: null, maxConversionsPerClick: null },
        }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      conversion: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(async ({ data }) => ({ id: 'conv-1', ...data })),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      lead: {
        upsert: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      postbackLog: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    const service = new ConversionsService(
      prisma as never,
      { processConversion: jest.fn().mockResolvedValue(undefined) } as never,
      { get: jest.fn().mockReturnValue(undefined) } as never,
      { getEffective: jest.fn().mockResolvedValue({ baseCurrency: 'EUR', fxRates: '', testMode: false }) } as never,
    );
    return { service, prisma };
  }

  const row = (extra: Record<string, unknown> = {}) => ({
    clickId: 'c1', conversionId: 'conv-0', source: 'quiz', firstName: null, lastName: null, email: null,
    phone: null, zip: null, state: null, answers: null, consentText: null, consentHash: null, consentAt: null,
    ip: null, userAgent: null, pageUrl: null, purgedAt: null, erasedAt: null, ...extra,
  });

  it('completes the row instead of losing the lead when two events of the same click race', async () => {
    const { service, prisma } = setup();
    prisma.lead.create.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));
    await service.create(
      { clickId: 'c1', eventType: 'lead', metadata: { phone: '813-555-0142', consent: 'I agree' } } as never,
      { trusted: false },
    );
    // Chaque champ est rempli côté base : ce que l'autre événement vient d'écrire n'est jamais écrasé.
    const sql = sqlOf(prisma.$executeRaw.mock.calls[0]);
    expect(sql).toContain('"first_name" = COALESCE("first_name", ?)');
    expect(sql).toContain('"answers" = CASE');
    expect(prisma.$executeRaw.mock.calls[0]).toContain('8135550142');
  });

  it('leaves an erased or purged lead alone, in the statement itself', async () => {
    const { service, prisma } = setup();
    await service.create(
      { clickId: 'c1', eventType: 'postalcode', metadata: { zip: '33602' } } as never,
      { trusted: false },
    );
    // La garde est dans le WHERE : elle ne peut pas être contournée par une course.
    expect(sqlOf(prisma.$executeRaw.mock.calls[0])).toContain(
      'WHERE "click_id" = ? AND "erased_at" IS NULL AND "purged_at" IS NULL',
    );
  });

  it('scrubs a conversion that lands while the visit is being erased', async () => {
    const { service, prisma } = setup();
    // Première lecture : rien d'effacé. La demande arrive pendant l'écriture, donc la seconde la voit.
    prisma.lead.findFirst.mockResolvedValueOnce(null).mockResolvedValue({ id: 'lead-1' });
    prisma.conversion.findMany.mockResolvedValue([]);
    await service.create(
      { clickId: 'c1', eventType: 'lead', metadata: { phone: '4155550134', consent: 'I agree' } } as never,
      { trusted: false },
    );
    // La conversion est gardée (les chiffres restent justes), mais la personne en est retirée et aucun lead n'est créé.
    expect(prisma.lead.create).not.toHaveBeenCalled();
    const statements = prisma.$executeRaw.mock.calls.map((c) => sqlOf(c));
    expect(statements.some((sql) => sql.includes('UPDATE "conversions"'))).toBe(true);
    expect(statements.some((sql) => sql.includes('UPDATE "clicks"'))).toBe(true);
  });

  it('logs a storage failure without the lead data', async () => {
    const { service, prisma } = setup();
    prisma.lead.create.mockRejectedValue(
      new Error('Invalid prisma.lead.create(): Argument phone: "4155550134", email: "ann@example.com"'),
    );
    const logged: string[] = [];
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation((msg: unknown) => {
      logged.push(String(msg));
    });
    await service.create(
      { clickId: 'c1', eventType: 'lead', metadata: { phone: '4155550134', email: 'ann@example.com' } } as never,
      { trusted: false },
    );
    spy.mockRestore();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('c1');
    expect(logged[0]).not.toContain('4155550134');
    expect(logged[0]).not.toContain('ann@example.com');
  });

  it('strips contact fields from raw metadata, and says when there was nothing to strip', () => {
    expect(withoutContact({ name: 'Ann', phone: '415', q1: 'yes' })).toEqual({ q1: 'yes' });
    expect(withoutContact({ q1: 'yes' })).toBeNull();
    expect(withoutContact(null)).toBeNull();
    expect(withoutContact(['x'])).toBeNull();
  });

  it('describes an error by name and code only', () => {
    expect(errorLabel(Object.assign(new Error('phone: "4155550134"'), { code: 'P2002' }))).toBe('Error P2002');
    expect(errorLabel('boom')).toBe('Error');
  });
});

describe('consent kept with a lead', () => {
  it('keeps the consent shown with the contact, not the one from an earlier step', () => {
    const quiz = leadFromConversion({ q1: 'yes', consent: 'Consent shown on the quiz screen' });
    const callback = leadFromConversion({ phone: '8135550142', consent: 'Consent shown under the phone field' });
    expect(mergeLeadData(quiz, callback).consentText).toBe('Consent shown under the phone field');
    expect(mergeLeadData(quiz, callback).consentHash).toBe(callback.consentHash);
  });

  it('keeps the earlier consent when the later event brings none', () => {
    const withConsent = leadFromConversion({ phone: '8135550142', consent: 'Consent under the phone field' });
    const later = leadFromConversion({ zip: '33602' });
    expect(mergeLeadData(withConsent, later).consentText).toBe('Consent under the phone field');
  });
});

describe('the person never comes back after an erasure', () => {
  it('stores a later conversion without the contact fields', async () => {
    const prisma = {
      click: {
        findUnique: jest.fn().mockResolvedValue({
          clickId: 'c1',
          campaignId: 'camp-1',
          createdAt: new Date(Date.now() - 60 * 60 * 1000),
          fbclid: null,
          isTest: false,
          campaign: { attributionWindowHours: null, maxConversionsPerClick: null },
        }),
      },
      conversion: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(async ({ data }) => ({ id: 'conv-9', ...data })),
      },
      lead: {
        upsert: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue({ clickId: 'c1', erasedAt: new Date(), purgedAt: new Date() }),
        findFirst: jest.fn().mockResolvedValue({ id: 'lead-1' }),
        create: jest.fn(),
        update: jest.fn(),
      },
      $executeRaw: jest.fn().mockResolvedValue(0),
    };
    const service = new ConversionsService(
      prisma as never,
      { processConversion: jest.fn().mockResolvedValue(undefined) } as never,
      { get: jest.fn().mockReturnValue(undefined) } as never,
      { getEffective: jest.fn().mockResolvedValue({ baseCurrency: 'EUR', fxRates: '', testMode: false }) } as never,
    );
    await service.create(
      { clickId: 'c1', eventType: 'lead', metadata: { name: 'Ann', phone: '4155550134', q1: 'yes' } } as never,
      { trusted: false },
    );
    const stored = prisma.conversion.create.mock.calls[0][0].data.metadata;
    // Visite effacée : le contact part, et les réponses du quiz aussi — c'est le régime « effacement », pas celui de
    // la rétention (qui garde les réponses parce que les rapports les lisent).
    expect(stored).toEqual({});
    expect(stored).not.toHaveProperty('phone');
    expect(stored).not.toHaveProperty('name');
    expect(prisma.lead.create).not.toHaveBeenCalled();
  });

  it('strips the person from an incoming postback URL and from nested metadata', () => {
    expect(sanitizeUrlPii('https://t.example.com/postback?cid=c1&email=ann@example.com&phone=415&et=lead_sold')).toBe(
      'https://t.example.com/postback?cid=c1&email=***&phone=***&et=lead_sold',
    );
    expect(withoutContact({ q1: 'yes', lead: { phone: '415', zip: '33602' } })).toEqual({
      q1: 'yes',
      lead: { zip: '33602' },
    });
  });

  it('strips a person from a postback URL even when the buyer named the parameter its own way', () => {
    // Les acheteurs nomment leurs paramètres comme ils veulent : la valeur dit ce que la clé cache.
    expect(sanitizeUrlPii('https://t.example.com/pb?cid=c1&sub1=ann%40example.com&tel=%2B18135550142&payout=32.50')).toBe(
      'https://t.example.com/pb?cid=c1&sub1=***&tel=***&payout=32.50',
    );
    // Ce qui n'est pas une personne reste lisible : sans ça, le débogage d'un postback devient impossible.
    expect(sanitizeUrlPii('https://t.example.com/pb?cid=c1&et=lead&txid=abc123')).toBe(
      'https://t.example.com/pb?cid=c1&et=lead&txid=abc123',
    );
  });
});


describe('what a person is, whatever the key is called', () => {
  it('finds the person in the value, not only in the name of the field', () => {
    // Un lander ou un acheteur nomme ses champs comme il veut : la valeur tranche.
    expect(withoutContact({ sub1: 'ann@example.com', u2: '(813) 555-0142', q1: 'yes' })).toEqual({ q1: 'yes' });
    expect(withoutContact({ contact: { tel: '18135550142' }, q1: 'yes' })).toEqual({ contact: {}, q1: 'yes' });
    expect(withoutContact({ firstname: 'Ann', user_email: 'a@b.co' })).toEqual({});
  });

  it('leaves the identifiers and the amounts readable', () => {
    // Un scrub qui cache aussi les données de débogage est un scrub que personne ne garde.
    expect(withoutContact({ cid: 'd8f2k19s0am4x7q3wz6r5tyu', txid: 'ORD1234567890XZ', payout: '32.50' })).toBeNull();
    expect(sanitizeUrlPii('https://t.example.com/pb?cid=d8f2k19s0am4x7q3wz6r5tyu&txid=ORD1234567890XZ&payout=32.50')).toBe(
      'https://t.example.com/pb?cid=d8f2k19s0am4x7q3wz6r5tyu&txid=ORD1234567890XZ&payout=32.50',
    );
  });

  it('keeps the person out of a conversion that lands after the erasure, even in the postback columns', async () => {
    const prisma = {
      click: {
        findUnique: jest.fn().mockResolvedValue({
          clickId: 'c1',
          campaignId: 'camp-1',
          createdAt: new Date(Date.now() - 60 * 60 * 1000),
          fbclid: null,
          isTest: false,
          campaign: { attributionWindowHours: null, maxConversionsPerClick: null },
        }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      conversion: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(async ({ data }) => ({ id: 'conv-1', ...data })),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      // La personne a demandé l'effacement hier : la ligne tombale est là.
      lead: { findFirst: jest.fn().mockResolvedValue({ id: 'lead-1' }), create: jest.fn(), update: jest.fn() },
      postbackLog: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    const service = new ConversionsService(
      prisma as never,
      { processConversion: jest.fn().mockResolvedValue(undefined) } as never,
      { get: jest.fn().mockReturnValue(undefined) } as never,
      { getEffective: jest.fn().mockResolvedValue({ baseCurrency: 'EUR', fxRates: '', testMode: false }) } as never,
    );
    // L'acheteur renvoie l'adresse dans p1 et dans l'URL, sans rien mettre dans les métadonnées : c'est le chemin le
    // plus courant du métier, et c'est celui par lequel la personne effacée revenait en clair.
    await service.create(
      { clickId: 'c1', eventType: 'lead_sold', postbackParam1: 'ann@example.com' } as never,
      {
        trusted: true,
        incomingPostbackUrl: 'https://track.example.com/postback?cid=c1&email=ann@example.com',
        incomingPostbackIp: '198.51.100.9',
      } as never,
    );
    const stored = prisma.conversion.create.mock.calls[0][0].data;
    expect(stored.postbackParam1).toBeNull();
    expect(stored.incomingPostbackIp).toBeNull();
    expect(stored.incomingPostbackUrl).toBe('https://track.example.com/postback?[erased]');
    expect(prisma.lead.create).not.toHaveBeenCalled();
  });
});


describe('what the round-8 review found still readable', () => {
  function service(
    prisma: Record<string, unknown>,
    config: Record<string, string> = {},
    conversions: Record<string, unknown> = { create: jest.fn().mockResolvedValue({ id: 'conv-1' }) },
  ) {
    return new LeadsService(
      // La clé de la liste de suppression fait partie de la configuration réelle : sans elle, aucun effacement
      // ne peut plus noter la personne. Un test qui veut son absence la retire explicitement.
      { get: jest.fn().mockImplementation((k: string) => ({ ERASURE_HMAC_KEY: CLE_TEST, ...config })[k]) } as never,
      // La liste de suppression par défaut : vide, et qui accepte les écritures. Un test qui veut une personne
      // déjà effacée passe son propre `erasedContact` — il écrase celui-ci.
      avecDefauts(prisma) as never,
      conversions as never,
    );
  }

  it('reads a person inside an array of strings', () => {
    // Un formulaire multi-étapes sérialisé : la clé ne dit rien, la valeur dit tout.
    expect(withoutContact({ fields: ['Ann', 'ann@example.com', '(813) 555-0142'], q1: 'yes' })).toEqual({
      fields: ['Ann'],
      q1: 'yes',
    });
    expect(carriesContact({ xs: ['8135550142'] })).toBe(true);
  });

  it('never mistakes a timestamp or an order reference for a phone number', () => {
    // Le défaut du tour 7 : une suite de dix chiffres était « une personne », donc l'horodatage d'un postback et le
    // txid d'un réseau partaient en ***, et la réconciliation des paiements devenait impossible.
    for (const value of [1758019200, 1758019200000, '4812345678901', '238512345678901', '12.345678901']) {
      expect(looksPersonal(value)).toBe(false);
    }
    for (const value of ['8135550142', '18135550142', '+1 813 555 0142', '(813) 555-0142']) {
      expect(looksPersonal(value)).toBe(true);
    }
    expect(sanitizeUrlPii('https://t.example.com/pb?cid=c1&ts=1758019200000&txid=4812345678901&payout=32.50')).toBe(
      'https://t.example.com/pb?cid=c1&ts=1758019200000&txid=4812345678901&payout=32.50',
    );
  });

  it('strips the person from the landing query string, key or value', async () => {
    const prisma = {
      lead: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      conversion: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn() },
      click: {
        // `sub1` et `u1` ne sont dans aucune liste de clés : seule la valeur les trahit.
        findMany: jest.fn().mockResolvedValue([
          { clickId: 'c1', rawParams: { sub1: 'ann@example.com', u1: '8135550142', utm_source: 'facebook' } },
        ]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      postbackLog: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn() },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValueOnce([{ click_id: 'c1', kept: true, why: 'demandée' }]).mockResolvedValue([]),
    };
    await service(prisma, { LEADS_PII_RETENTION_DAYS: '90' }).purgePersonalData(new Date('2026-09-16T00:00:00Z'));
    expect(prisma.click.update).toHaveBeenCalledWith({
      where: { clickId: 'c1' },
      data: { rawParams: { utm_source: 'facebook' } },
    });
  });

  it('marks as scrubbed only the conversions it actually read', async () => {
    const prisma = {
      lead: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      conversion: {
        findMany: jest.fn().mockResolvedValue([{ id: 'conv-1', metadata: { phone: '4155550134' } }]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      click: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      postbackLog: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValueOnce([{ click_id: 'c1', kept: true, why: 'demandée' }]).mockResolvedValue([]),
    };
    await service(prisma, { LEADS_PII_RETENTION_DAYS: '90' }).purgePersonalData(new Date('2026-09-16T00:00:00Z'));
    // Par identifiant, jamais par visite : un postback tardif arrivé pendant le balayage repasse au tour suivant,
    // au lieu d'être estampé « nettoyé » sans l'avoir été.
    expect(prisma.conversion.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['conv-1'] } },
      data: { scrubbedAt: expect.any(Date) },
    });
  });

  it('erases a visit that never produced a lead row', async () => {
    const prisma = {
      click: {
        findUnique: jest.fn().mockResolvedValue({
          clickId: 'c9',
          campaignId: 'camp-1',
          isTest: false,
          createdAt: new Date('2026-09-01T00:00:00Z'),
        }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      lead: {
        upsert: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      conversion: {
        findMany: jest.fn().mockResolvedValue([{ id: 'conv-9', metadata: { p1: 'ann@example.com' } }]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      postbackLog: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    const out = await service(prisma).eraseVisit('c9', 'admin@example.com');
    expect(out.erased).toBe(true);
    // Une pierre tombale est posée pour la visite : sans ligne, rien n'empêcherait un événement tardif de réécrire
    // la personne.
    expect(prisma.lead.create.mock.calls[0][0].data).toMatchObject({
      clickId: 'c9',
      campaignId: 'camp-1',
      erasedAt: expect.any(Date),
      purgedAt: expect.any(Date),
    });
    expect(prisma.conversion.update).toHaveBeenCalledWith({ where: { id: 'conv-9' }, data: { metadata: {} } });
    expect(await service({ click: { findUnique: jest.fn().mockResolvedValue(null) } }).eraseVisit('nope')).toEqual({
      erased: false,
    });
  });
});


describe('who may call the leads routes', () => {
  /**
   * Une route qui détruit doit être gardée comme celles qui lisent. L'identifiant de clic n'est pas un secret : il
   * voyage dans l'URL de redirection, dans les postbacks du réseau et dans l'historique du navigateur. Ce test
   * existe parce que la route d'effacement par visite est partie en revue sans garde.
   */
  it('guards every route of the controller, the destructive ones included', () => {
    const proto = LeadsController.prototype as unknown as Record<string, unknown>;
    const routes = ['list', 'exportCsv', 'eraseVisit', 'remove'];
    for (const name of routes) {
      const guards = Reflect.getMetadata('__guards__', proto[name] as object) ?? [];
      expect(guards).toContain(ApiKeyGuard);
      expect(guards).toContain(ThrottlerGuard);
    }
  });
});


describe('what the round-9 review found still readable', () => {
  function service(
    prisma: Record<string, unknown>,
    config: Record<string, string> = {},
    conversions: Record<string, unknown> = { create: jest.fn().mockResolvedValue({ id: 'conv-1' }) },
  ) {
    return new LeadsService(
      // La clé de la liste de suppression fait partie de la configuration réelle : sans elle, aucun effacement
      // ne peut plus noter la personne. Un test qui veut son absence la retire explicitement.
      { get: jest.fn().mockImplementation((k: string) => ({ ERASURE_HMAC_KEY: CLE_TEST, ...config })[k]) } as never,
      // La liste de suppression par défaut : vide, et qui accepte les écritures. Un test qui veut une personne
      // déjà effacée passe son propre `erasedContact` — il écrase celui-ci.
      avecDefauts(prisma) as never,
      conversions as never,
    );
  }

  const CONSENT =
    'By submitting, I, Ann Dupont, agree that Nexo Quote and its licensed insurance partners may call and text me ' +
    'at 813-555-0142 about auto insurance quotes, including by automatic telephone dialing system or prerecorded ' +
    'voice, and may email me at ann.dupont@example.com. Consent is not a condition of purchase.';

  it('reads the person inside the consent text, which carries the name and the number', () => {
    // Le gabarit TCPA de l'assurance auto US contient littéralement le numéro saisi : la ligne du lead le vide déjà,
    // la copie d'à côté restait lisible pour toujours.
    expect(looksPersonal(CONSENT)).toBe(true);
    expect(withoutContact({ consent: CONSENT, q1: 'yes' }, 'purged')).toEqual({ q1: 'yes' });
    expect(withoutContact({ notes: 'Called back, she asked for 813-555-0142 after 6pm.' })).toEqual({});
    // `note`, `notes` et `comments` partent par leur clé : ce sont des champs libres, donc tôt ou tard une personne.
    expect(withoutContact({ note: 'anything' })).toEqual({});
    // Ailleurs, une phrase sans personne reste une phrase : on ne mange pas le contexte pour le plaisir.
    expect(
      withoutContact({ summary: 'Quote requested during the 2026 renewal window, no answer on two attempts.' }),
    ).toBeNull();
  });

  it('recognises a phone number in the forms the world actually writes them', () => {
    // Le juré du tour 12 a passé ses propres chaînes dans cette fonction. Toutes celles-ci traversaient le pipeline
    // en clair — à l'écriture, à l'effacement et en rétention — parce que la règle exigeait un séparateur APRÈS
    // l'indicatif et ne connaissait que le format américain.
    for (const value of [
      '(813)555-0142',        // la forme la plus canonique des États-Unis
      '813-5550142',          // découpe 3 + 7
      '0018135550142',        // préfixe international composé depuis l'étranger
      '+33 6 12 34 56 78',    // France
      '06 12 34 56 78',       // France, sans indicatif pays
      '+44 7911 123456',      // Royaume-Uni
      '+8613800138000',       // Chine : treize chiffres après l'indicatif, donc hors de la fourchette d'une suite
                              // NUE — c'est le « + » qui dit que c'est un numéro, et pas une référence
      '123-45-6789',          // numéro de sécurité sociale américain
      '4111 1111 1111 1111',  // carte bancaire (test de Luhn)
      '8135550142',
    ]) {
      expect([value, looksPersonal(value)]).toEqual([value, true]);
      expect(redactPersonal(value)).toContain('***');
    }
    // Et la symétrie, qui compte autant : ce qui n'est pas une personne survit. Le rattrapage de migration ne
    // passe qu'une fois, et l'original de ces valeurs n'existe nulle part ailleurs.
    for (const value of [
      '1758019200',             // horodatage Unix en secondes
      '1758019200000',          // en millisecondes
      '4812345678901',          // référence de commande
      '238512345678901',
      '16.09.2026',             // une date
      '1234.56',                // un montant
      '2026-09-16',
      'v1.2.3',
    ]) {
      expect([value, looksPersonal(value)]).toEqual([value, false]);
      expect(redactPersonal(value)).toBe(value);
    }
    // Dans une phrase, la personne part et la phrase reste.
    expect(redactPersonal('I agree, call me at 813-555-0142 please')).toBe('I agree, call me at *** please');
  });

  it('never mutilates the identifiers a business runs on', () => {
    // Élargir la détection « à toute suite ponctuée de neuf à quinze chiffres » a fait de la rétention nocturne
    // une destruction : `withoutContact` tourne sur CHAQUE métadonnée de conversion et sur les paramètres bruts de
    // CHAQUE clic passé en rétention, sans original ailleurs. Ces huit valeurs y passaient.
    for (const value of [
      '550e8400-e29b-41d4-a716-446655440000', // UUID v4 : un sur huit portait un bloc que la règle prenait
      'ORD-2026-0001234',                     // référence de commande
      '100023456789',                         // identifiant externe à douze chiffres
      '33601-1234',                           // code postal ZIP+4, que la rétention doit GARDER
      '192.168.1.254',                        // adresse IPv4
      '2026-01-01 - 2026-12-31',              // une plage de dates
      'sess_2026_09_16_123456',
      '2026-09-16T14:30:00',
    ]) {
      expect([value, looksPersonal(value)]).toEqual([value, false]);
      expect(redactPersonal(value)).toBe(value);
    }
    // Et la rétention garde le code postal comme la ligne du lead le fait : elle ne l'emporte qu'à l'effacement.
    expect(withoutContact({ zip: '33601-1234', session_id: '550e8400-e29b-41d4-a716-446655440000' }, 'purged')).toBeNull();
  });

  it('reads a bare European mobile, which the Unix-timestamp guard used to swallow', () => {
    // « dix chiffres commençant par 0 ou 1 = horodatage » emportait le 0 français avec le 1 d'epoch : le mobile
    // le plus courant d'Europe traversait l'effacement, la rétention et l'URL de postback.
    for (const value of ['0612345678', '612345678', '123456789']) {
      expect([value, looksPersonal(value)]).toEqual([value, true]);
    }
    // …sans reprendre l'horodatage qu'elle protégeait : dix chiffres, entre 2001 et 2033.
    expect(looksPersonal('1758019200')).toBe(false);
  });

  it('never lets a redacted value rewrite the structure of the URL it sits in', () => {
    // `redactPersonal` rend le texte DÉCODÉ. Le réinjecter tel quel laissait l'appelant — affilié ou acheteur —
    // fabriquer de vrais paramètres dans la colonne que l'écran « postbacks entrants » affiche et que tout
    // relecteur reparse ensuite.
    const out = sanitizeUrlPii('https://t.io/pb?cid=c1&p1=call%208135550142%26cid%3Dhacked%26payout%3D999&payout=1');
    expect(out).not.toContain('&cid=hacked');
    expect(out).not.toContain('&payout=999');
    expect(out).toContain('cid=c1');
    expect(out).toContain('payout=1');
    expect(out).not.toContain('8135550142');
    // Et le « + » d'une query string, qui code une espace, reste un « + » : l'encoder en %2B changerait le texte.
    expect(sanitizeUrlPii('https://t.io/pb?cid=c1&msg=Lead+rejected+call+800-555-1212+later')).toBe(
      'https://t.io/pb?cid=c1&msg=Lead+rejected+call+***+later',
    );
  });

  it('never masks an identifier or an amount, because the URL is sanitised at write time', () => {
    // `sanitizeUrlPii` tourne sur CHAQUE postback entrant : masquer un txid de dix chiffres détruirait la piste
    // d'audit du paiement sur toutes les conversions, et l'original n'existerait nulle part.
    expect(sanitizeUrlPii('https://t.example.com/pb?cid=c1&txid=8472910365&payout=32.50&ts=1758019200')).toBe(
      'https://t.example.com/pb?cid=c1&txid=8472910365&payout=32.50&ts=1758019200',
    );
    // Sous un nom quelconque, en revanche, un numéro reste un numéro — y compris derrière un double encodage.
    expect(sanitizeUrlPii('https://t.example.com/pb?sub1=8135550142&u1=ann%2540example.com')).toBe(
      'https://t.example.com/pb?sub1=***&u1=***',
    );
    // Le point-virgule sépare aussi des paramètres chez certains réseaux.
    expect(sanitizeUrlPii('https://t.example.com/pb;p1=ann@example.com;txid=99')).toBe(
      'https://t.example.com/pb;p1=***;txid=99',
    );
  });

  it('marks every visit BEFORE scrubbing it, and stops if a mark cannot be written', async () => {
    // L'ordre décide de ce qui reste après une panne. `scrubVisitPii` pose `scrubbed_at` sur les clics et les
    // conversions : si le processus meurt entre le nettoyage et la pierre tombale, la visite sœur est nettoyée
    // mais NON MARQUÉE — `erasureState` n'y voit aucun effacement, la conversion suivante y réécrit la personne en
    // clair, et la rétention ne repassera jamais puisque `scrubbed_at` est posé. Dans l'autre ordre, une
    // interruption laisse au pire une marque sans nettoyage : le rattrapage horaire la reprend.
    const tx = { lead: { update: jest.fn().mockResolvedValue({}) } };
    const prisma = {
      lead: {
        findUnique: jest.fn().mockResolvedValue({ id: 'lead-1', clickId: 'c1', isTest: true,
          createdAt: new Date('2026-08-01T00:00:00Z'), campaignId: 'camp-1', purgedAt: null }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(async (fn: (t: unknown) => Promise<void>) => fn(tx)),
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([{ click_id: 'c1', kept: true, why: 'demandée' }, { click_id: 'c2', kept: true, why: 'demandée' }]),
      conversion: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      click: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      postbackLog: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    await service(prisma).deleteOne('lead-1', 'admin@example.com');
    expect(prisma.lead.upsert.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.click.updateMany.mock.invocationCallOrder[0],
    );
    // Et la pierre tombale n'est pas un lead : elle reprend le test et la date du clic d'origine. Sans ça, une
    // visite de test devenait un lead réel, daté du jour de la demande, compté à l'écran et dans l'export.
    const created = prisma.lead.upsert.mock.calls.find(([a]: [{ where: { clickId: string } }]) => a.where.clickId === 'c2');
    expect(created[0].create).toMatchObject({
      clickId: 'c2', source: 'erasure', isTest: true, createdAt: new Date('2026-08-01T00:00:00Z'),
    });

    // Une marque qui ne peut pas s'écrire arrête l'effacement : nettoyer sans marquer est le pire des deux états.
    const broken = {
      ...prisma,
      lead: { ...prisma.lead, upsert: jest.fn().mockRejectedValue(new Error('P2002')) },
      click: { ...prisma.click, updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    await expect(service(broken).deleteOne('lead-1', 'admin@example.com')).rejects.toThrow(/tombstone failed/);
    expect(broken.click.updateMany).not.toHaveBeenCalled();
  });

  it('vide le corps et la réponse du journal de postback, et masque son URL', async () => {
    // Le journal garde la charge du postback : le numéro en clair, et souvent son sha256 — que dix chiffres ne
    // cachent pas, on les retrouve par force brute. L'URL SORTANTE, elle, est masquée et pas vidée : c'est la
    // piste d'audit du paiement (réseau, txid, montant) que l'export lit comme colonne « outgoing ».
    const tx = { lead: { update: jest.fn().mockResolvedValue({}) } };
    const prisma = {
      lead: {
        findUnique: jest.fn().mockResolvedValue({ id: 'lead-1', clickId: 'c1', phone: '8135550142', purgedAt: null }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(async (fn: (t: unknown) => Promise<void>) => fn(tx)),
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([{ click_id: 'c1', kept: true, why: 'demandée' }]),
      conversion: {
        findMany: jest.fn().mockResolvedValue([{ id: 'conv-1', metadata: {} }]),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      click: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      postbackLog: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'log-1', url: 'https://buyer.example.com/cb?cid=abc&phone=8135550142&payout=32.50' },
        ]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    await service(prisma).deleteOne('lead-1', 'admin@example.com');
    const [[call]] = prisma.postbackLog.update.mock.calls;
    expect(call.data.requestBody).toBeNull();
    expect(call.data.response).toBeNull();
    expect(call.data.url).toContain('payout=32.50');
    expect(call.data.url).not.toContain('8135550142');
  });

  it("dit qu'il n'a pas pu chercher les autres visites, au lieu de répondre « effacé »", async () => {
    // L'effacement le plus partiel possible — une seule visite — et le seul qui ne se disait pas. La base peut
    // tomber, la requête peut expirer : la réponse doit porter ce qui n'a pas été fait, sinon personne ne le
    // saura jamais et le numéro de la personne restera appelable sur ses autres visites.
    const tx = { lead: { update: jest.fn().mockResolvedValue({}) } };
    const prisma = {
      lead: {
        findUnique: jest.fn().mockResolvedValue({ id: 'lead-1', clickId: 'c1', phone: '8135550142', purgedAt: null }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(async (fn: (t: unknown) => Promise<void>) => fn(tx)),
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockRejectedValue(new Error('P1001 base injoignable')),
      conversion: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      click: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      postbackLog: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    const out = await service(prisma).deleteOne('lead-1', 'admin@example.com');
    expect(out.deleted).toBe(true);
    expect(out.skipped).toEqual([
      { clickId: 'c1', why: 'résolution des autres visites indisponible : effacement limité à celle-ci' },
    ]);
  });

  it('remet la marque de nettoyage à zéro sur une visite que la rétention avait déjà purgée', async () => {
    // Une visite sœur déjà nettoyée par la rétention porte une marque « nettoyée » qui ne vaut que pour la
    // PURGE — laquelle garde exprès le code postal, l'État et les réponses du quiz. Un effacement en demande
    // plus. Sans cette remise à zéro, le rattrapage horaire ne la reprenait jamais : elle restait à moitié
    // effacée avec sa date d'effacement posée, c'est-à-dire dans le seul état qui a l'air fini sans l'être.
    const tx = { lead: { update: jest.fn().mockResolvedValue({}) } };
    const prisma = {
      lead: {
        findUnique: jest.fn().mockResolvedValue({ id: 'lead-1', clickId: 'c1', phone: '8135550142', purgedAt: null }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(async (fn: (t: unknown) => Promise<void>) => fn(tx)),
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([
        { click_id: 'c1', kept: true, why: 'demandée' },
        { click_id: 'c2', kept: true, why: 'même navigateur' },
      ]),
      conversion: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      click: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      postbackLog: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    await service(prisma).deleteOne('lead-1', 'admin@example.com');
    for (const [call] of prisma.lead.upsert.mock.calls) {
      expect(call.update).toMatchObject({ scrubbedAt: null });
      expect(call.create).toMatchObject({ scrubbedAt: null });
    }
  });

  it("l'URL de postback ne garde pas ses paramètres « jamais personnels » pendant un effacement", () => {
    // Même arbitrage que pour les métadonnées, et il manquait ici : cette liste protège la piste d'audit du
    // paiement contre la RÉTENTION, qui repasse chaque nuit sur tout l'historique. Contre un effacement, elle ne
    // protège rien — le nom du paramètre est choisi par l'acheteur, et « leadid=ann@example.com » est une URL de
    // postback banale, qui ressortait intacte d'un effacement accepté.
    const url = 'https://buyer.example.com/cb?leadid=ann@example.com&payout=32.50';
    expect(sanitizeUrlPii(url, 'erased')).toContain('leadid=***');
    expect(sanitizeUrlPii(url, 'erased')).toContain('payout=32.50');
    // À la rétention, au contraire, il ne bouge pas : c'est la trace du paiement.
    expect(sanitizeUrlPii(url, 'purged')).toBe(url);
  });

  it('la rétention descend dans un objet et emporte un tableau de premier niveau', () => {
    // Deux règles de la RÉTENTION que rien ne tenait, parce que le seul test qui descendait dans un objet était
    // écrit en mode « effacement » — où la liste des clés jamais personnelles ne s'applique plus, donc où la
    // condition « scalaire seulement » est du code mort. Ces deux-là tournent chaque nuit sur tout l'historique.
    expect(withoutContact({ event: { type: 'lead', phone: '8135550142' } }, 'purged'))
      .toEqual({ event: { type: 'lead' } });
    // Un tableau au premier niveau est du JSON parfaitement légal, et `scrubVisitPii` lui passe `raw_params`
    // tel quel : l'écarter laissait « ["Ann","8135550142"] » lisible pour toujours.
    expect(withoutContact(['Ann', 'appelle le 8135550142'], 'purged'))
      .toEqual(['Ann', expect.stringContaining('***')]);
  });

  it('la rétention emporte le texte de consentement, qui contient le nom et le numéro', async () => {
    // Le gabarit TCPA de l'assurance auto US contient littéralement « I, Ann Dupont, agree … may call me at
    // 813-555-0142 ». Le test de la purge ne vérifiait que quatre colonnes, et pas celle-là.
    const prisma = {
      lead: {
        findMany: jest.fn().mockResolvedValue([{ id: 'lead-1', clickId: 'c1' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn().mockResolvedValue(1),
      conversion: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      click: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      postbackLog: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    await service(prisma, { LEADS_PII_RETENTION_DAYS: '90' }).purgePersonalData(new Date('2026-09-16T00:00:00Z'));
    const [purge] = prisma.lead.updateMany.mock.calls.map(([c]: [{ data: Record<string, unknown> }]) => c.data);
    expect(purge).toMatchObject({
      firstName: null, lastName: null, email: null, phone: null, ip: null, userAgent: null,
      consentText: null, pageUrl: null,
    });
  });

  it("la reprise d'un effacement interrompu ne le dégrade pas en purge", async () => {
    // Le rattrapage horaire existe pour RÉPARER un effacement à moitié fait. S'il le rejoue en mode purge, il
    // garde le code postal, l'État et les réponses du quiz, pseudonymise le lien de visiteur au lieu de le
    // couper — PUIS pose la marque de nettoyage. Plus rien ne repasse jamais : l'effacement reste à moitié fait,
    // pour toujours, avec l'air d'être terminé.
    const prisma = {
      lead: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'lead-1', clickId: 'c1', erasedAt: new Date('2026-09-15T00:00:00Z') },
        ]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn().mockResolvedValue(1),
      conversion: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'conv-1', metadata: { zip: '33610', state: 'FL', q1: 'oui', payout: '32.50' } },
        ]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      click: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      postbackLog: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    await service(prisma).resumeInterruptedScrubs();
    // Le code postal, l'État et le quiz partent : c'est ce qui distingue un effacement d'une purge.
    expect(prisma.conversion.update).toHaveBeenCalledWith({
      where: { id: 'conv-1' },
      data: { metadata: { payout: '32.50' } },
    });
  });

  it('donne à chaque pierre tombale la campagne, le test et la date de SA visite', async () => {
    // `visitsOfPerson` ne filtre pas par campagne : la même personne revient par une autre campagne, et sa
    // pierre tombale était comptée dans celle du demandeur, datée du jour de la demande, avec le drapeau de test
    // d'une autre visite. Ce sont exactement les colonnes que les rapports et l'export lisent.
    const tx = { lead: { update: jest.fn().mockResolvedValue({}) } };
    const prisma = {
      lead: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'lead-1', clickId: 'c1', phone: '8135550142', campaignId: 'camp-A', isTest: false,
          createdAt: new Date('2026-08-01T00:00:00Z'), purgedAt: null,
        }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(async (fn: (t: unknown) => Promise<void>) => fn(tx)),
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([
        { click_id: 'c1', kept: true, why: 'demandée' },
        { click_id: 'c2', kept: true, why: 'même navigateur' },
      ]),
      conversion: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      click: {
        findMany: jest.fn().mockResolvedValue([
          { clickId: 'c1', campaignId: 'camp-A', isTest: false, createdAt: new Date('2026-08-01T00:00:00Z') },
          { clickId: 'c2', campaignId: 'camp-B', isTest: true, createdAt: new Date('2026-07-02T00:00:00Z') },
        ]),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      postbackLog: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    await service(prisma).deleteOne('lead-1', 'admin@example.com');
    type Upsert = { where: { clickId: string }; create: Record<string, unknown> };
    const sister = prisma.lead.upsert.mock.calls
      .map(([c]: [Upsert]) => c)
      .find((c: Upsert) => c.where.clickId === 'c2');
    // Sans cette ligne, une absence de `c2` ferait sauter le `toMatchObject` sur `undefined` — un échec, oui,
    // mais qui parle de JavaScript au lieu de dire que la visite sœur n'a pas été touchée.
    expect(sister).toBeDefined();
    expect(sister?.create).toMatchObject({
      clickId: 'c2', campaignId: 'camp-B', isTest: true, createdAt: new Date('2026-07-02T00:00:00Z'),
    });
  });

  it('dit que la personne a plus de visites que la borne, au lieu de tronquer en silence', async () => {
    // Le commentaire de la requête affirmait depuis trois tours que « le compte-rendu le dit ». Il ne le disait
    // pas. Une personne à plus de 500 visites n'est pas une hypothèse : un affilié qui reteste sa propre page en
    // fait autant en une journée, et ce sont les visites les plus ANCIENNES qui tombent.
    const tx = { lead: { update: jest.fn().mockResolvedValue({}) } };
    const rows = Array.from({ length: 500 }, (_, i) => ({
      click_id: `c${i}`, kept: true, why: i === 0 ? 'demandée' : 'même navigateur',
    }));
    const prisma = {
      lead: {
        findUnique: jest.fn().mockResolvedValue({ id: 'lead-1', clickId: 'c0', phone: '8135550142', purgedAt: null }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 500 }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(async (fn: (t: unknown) => Promise<void>) => fn(tx)),
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue(rows),
      conversion: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      click: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 500 }) },
      postbackLog: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    const out = await service(prisma).deleteOne('lead-1', 'admin@example.com');
    expect(out.skipped).toEqual([
      { clickId: '+500', why: "plus de 500 visites : les plus anciennes n'ont pas été examinées" },
    ]);
  });

  it("résout les visites de la personne AVANT d'écrire quoi que ce soit", async () => {
    // La clé qui permet de retrouver les autres visites d'Ann, c'est le contact porté par SA ligne — celui que la
    // pierre tombale efface. Le tour 15 vidait cette ligne d'abord et se servait de la copie chargée en mémoire :
    // ça marche tant que rien ne s'interrompt. Si la pose des pierres tombales échoue (elle lève, c'est voulu) ou
    // si le processus meurt, le rejeu relit une ligne vide, ne trouve plus personne, et les autres visites d'Ann
    // gardent son numéro POUR TOUJOURS — `resumeScrubs` ne reprend que le clic du demandeur, jamais ses sœurs.
    const tx = { lead: { update: jest.fn().mockResolvedValue({}) } };
    const prisma = {
      lead: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'lead-1', clickId: 'c1', phone: '8135550142', email: 'ann@x.co', firstName: 'Ann',
          campaignId: 'camp-1', isTest: false, createdAt: new Date('2026-08-01T00:00:00Z'), purgedAt: null,
        }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert: jest.fn().mockRejectedValue(new Error('P1001')),
      },
      $transaction: jest.fn(async (fn: (t: unknown) => Promise<void>) => fn(tx)),
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([
        { click_id: 'c1', kept: true, why: 'demandée' },
        { click_id: 'c2', kept: true, why: 'même contact' },
      ]),
      conversion: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      click: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      postbackLog: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    await expect(service(prisma).deleteOne('lead-1', 'admin@example.com')).rejects.toThrow(/tombstone failed/);
    // La résolution a eu lieu avant la première écriture…
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.lead.upsert.mock.invocationCallOrder[0],
    );
    // …et la ligne du demandeur n'a PAS été vidée : sa clé est intacte, le rejeu retrouvera ses sœurs.
    expect(tx.lead.update).not.toHaveBeenCalled();
    expect(prisma.lead.update).not.toHaveBeenCalled();
  });

  it("descend dans un objet rangé sous une clé « jamais personnelle »", () => {
    // `event`, `ts`, `amount` sont dans la liste des clés qui ne portent jamais de personne — vrai pour un
    // SCALAIRE. Une charge de postback les envoie régulièrement comme objets. Rendre la valeur entière sans y
    // descendre ne laissait pas seulement le numéro en place : `withoutContact` rendait alors « rien à retirer »,
    // donc la mise à jour était sautée et la métadonnée d'origine réécrite par-dessus. La route répondait
    // « effacé » sur un numéro et une adresse restés lisibles, qu'un postback tardif réinstallait.
    expect(withoutContact({ cid: 'abc', event: { type: 'lead', phone: '8135550142', email: 'ann@x.co' } }, 'erased'))
      .toEqual({ cid: 'abc', event: { type: 'lead' } });
    expect(withoutContact({ ts: { at: 1758000000123, phone: '8135550142' } }, 'erased'))
      .toEqual({ ts: { at: 1758000000123 } });
    // Une référence à plusieurs groupes dont l'un dépasse sept chiffres n'est pas un numéro : le monde écrit
    // « 813-5550142 » (3+7) et « +44 7911 123456 » (2+4+6), jamais un bloc de huit. Sans cette borne, la
    // rétention nocturne mange les références de commande et de RMA de tout l'historique, et l'original
    // n'existe nulle part ailleurs.
    expect(withoutContact({ msg: 'ref 123 45678901' }, 'erased')).toBeNull();
    // Un prénom n'a aucune forme reconnaissable : aucune relecture par valeur ne peut le trouver, il n'y a que
    // la clé pour le dire. Ceux-là sont ceux que les LP et les acheteurs envoient vraiment.
    expect(withoutContact({ fname: 'Ann', lname: 'Dupont', cid: 'abc' }, 'erased')).toEqual({ cid: 'abc' });
    expect(withoutContact({ prenom: 'Ann', nom: 'Dupont' }, 'erased')).toEqual({});
    // Le scalaire est protégé de la RÉTENTION — c'est la raison d'être de la liste : elle tourne chaque nuit sur
    // tout l'historique, et un identifiant de transaction de dix chiffres y ressemble à un numéro.
    expect(withoutContact({ txid: '8135550142', msg: 'call 8135550142' }, 'purged'))
      .toEqual({ txid: '8135550142', msg: expect.stringContaining('***') });
    // Mais PAS d'un effacement. Le nom du paramètre est choisi par l'acheteur : « leadid », « event », « ts »
    // portent régulièrement un numéro, et les laisser passer rendait « rien à retirer » — donc la mise à jour
    // sautée et la métadonnée d'origine réécrite par-dessus l'effacement, avec « effacé » en réponse.
    expect(withoutContact({ txid: '8135550142', cid: 'abc' }, 'erased')).toEqual({ cid: 'abc' });
    expect(withoutContact({ leadid: '8135550142' }, 'erased')).toEqual({});
  });

  it('says what it did NOT erase, instead of reporting a clean erasure', async () => {
    // « On ne sait pas » n'est pas « il n'y a rien ». Une visite écartée par une garde — contact partagé par
    // quelqu'un d'autre, identité différente, empreinte de navigateur partagée par un foyer — laisse un numéro
    // appelable. La route rendait « effacé » sans le dire ; elle le dit maintenant, et un humain peut trancher.
    const tx = { lead: { update: jest.fn().mockResolvedValue({}) } };
    const prisma = {
      lead: {
        findUnique: jest.fn().mockResolvedValue({ id: 'lead-1', clickId: 'c1', phone: '8005551212', purgedAt: null }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(async (fn: (t: unknown) => Promise<void>) => fn(tx)),
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([
        { click_id: 'c1', kept: true, why: 'demandée' },
        { click_id: 'c2', kept: false, why: "contact partagé par quelqu'un d'autre" },
        { click_id: 'c3', kept: false, why: 'empreinte de navigateur, pas une personne' },
      ]),
      conversion: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      click: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      postbackLog: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    const out = await service(prisma).deleteOne('lead-1', 'admin@example.com');
    expect(out.deleted).toBe(true);
    expect(out.skipped).toEqual([
      { clickId: 'c2', why: "contact partagé par quelqu'un d'autre" },
      { clickId: 'c3', why: 'empreinte de navigateur, pas une personne' },
    ]);
    // Et seule la visite gardée est marquée : on n'écrase pas la ligne d'un tiers pour faire bonne mesure.
    expect(prisma.lead.upsert.mock.calls.map((c: [{ where: { clickId: string } }]) => c[0].where.clickId)).toEqual(['c1']);
  });

  it('never counts its own tombstones as leads', () => {
    // Effacer une personne à trois visites CRÉAIT deux lignes de plus, `isTest: false` et datées du jour : le total
    // de l'écran et l'export CSV grossissaient à chaque demande RGPD.
    const prisma = {
      lead: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), upsert: jest.fn() },
      campaign: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return service(prisma)
      .list({})
      .then(() => {
        const where = prisma.lead.findMany.mock.calls[0][0].where;
        expect(where.NOT).toEqual({ source: 'erasure', erasedAt: { not: null } });
      });
  });

  it('never hands an attacker a lower encoding than the one they sent', () => {
    // `redactPersonal` décode jusqu'à deux passes. N'en ré-encoder qu'une rendait la valeur avec un niveau EN
    // MOINS : il suffisait alors d'un seul décodage chez le lecteur pour que `&cid=…` réapparaisse. Le sanitiseur
    // augmentait le levier de l'appelant au lieu de le retirer.
    const doubled = sanitizeUrlPii(
      'https://t.io/pb?cid=c1&p1=call%25208135550142%2526cid%253Dhacked%2526payout%253D999&payout=1',
    );
    const value = doubled.split('&p1=')[1].split('&payout')[0];
    const onceDecoded = decodeURIComponent(value.replace(/\+/g, ' '));
    expect(onceDecoded).not.toContain('&cid=');
    expect(onceDecoded).not.toContain('&payout=999');
    expect(doubled).not.toContain('8135550142');
  });

  it('resolves the person from the row read BEFORE the tombstone empties it', async () => {
    // La faute du tour 10, qui a survécu deux tours : la requête qui retrouve les autres visites d'Ann lisait son
    // numéro et son adresse dans la ligne du lead — que la transaction venait de vider. Elle cherchait donc NULL,
    // et le deuxième navigateur d'Ann gardait tout. Deux choses à prouver : la lecture précède la pierre tombale,
    // et ce qu'elle a lu est bien ce qu'on passe à la requête.
    const tx = { lead: { update: jest.fn().mockResolvedValue({}) } };
    const prisma = {
      lead: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'lead-1',
          clickId: 'c1',
          firstName: 'Ann',
          phone: '8135550142',
          email: 'ann@example.com',
          purgedAt: null,
        }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(async (fn: (t: unknown) => Promise<void>) => fn(tx)),
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([{ click_id: 'c1', kept: true, why: 'demandée' }, { click_id: 'c2', kept: true, why: 'demandée' }]),
      conversion: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      click: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      postbackLog: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    await service(prisma).deleteOne('lead-1', 'admin@example.com');
    // L'ordre : lire la personne, PUIS la vider.
    expect(prisma.lead.findUnique.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.$transaction.mock.invocationCallOrder[0],
    );
    // Et ce qui a été lu arrive dans la requête : sans ces valeurs, elle ne retrouve que la visite nommée.
    const [, ...values] = prisma.$queryRaw.mock.calls[0];
    expect(values).toContain('8135550142');
    expect(values).toContain('ann@example.com');
    // Le prénom sert à ne PAS emporter les leads de tiers qui partagent un standard : passé en minuscules.
    expect(values).toContain('ann');
  });

  it('gives the other visits of the person the same tombstone, by the visit route too', async () => {
    // Sans pierre tombale, `erasureState` (conversions.service.ts) ne voit rien : un postback tardif sur l'autre
    // visite réécrit la personne qui vient de demander l'effacement.
    const prisma = {
      click: {
        findUnique: jest.fn().mockResolvedValue({
          clickId: 'c9',
          campaignId: 'camp-1',
          isTest: false,
          createdAt: new Date('2026-09-01T00:00:00Z'),
          rawParams: { email: 'eve@example.com' },
        }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      lead: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      conversion: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      postbackLog: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([{ click_id: 'c9', kept: true, why: 'demandée' }, { click_id: 'c10', kept: true, why: 'demandée' }]),
    };
    expect((await service(prisma).eraseVisit('c9', 'admin@example.com')).erased).toBe(true);
    const tombstones = prisma.lead.updateMany.mock.calls.filter(
      ([arg]: [{ data: Record<string, unknown> }]) => 'erasedAt' in arg.data,
    );
    expect(tombstones).toHaveLength(0);  // plus par `updateMany` : il ne crée rien
    expect(prisma.lead.upsert.mock.calls.map((c: [{ where: { clickId: string } }]) => c[0].where.clickId)).toEqual([
      'c9', 'c10',
    ]);
    for (const [arg] of prisma.lead.upsert.mock.calls) {
      expect(arg.update).toMatchObject({ phone: null, email: null, firstName: null, erasedAt: expect.any(Date) });
      expect(arg.create).toMatchObject({ clickId: arg.where.clickId, source: 'erasure', erasedAt: expect.any(Date) });
    }
    // Et le contact porté par l'URL d'atterrissage sert à retrouver ses autres visites : c'est tout ce qu'on a.
    const [, ...values] = prisma.$queryRaw.mock.calls[0];
    expect(values).toContain('eve@example.com');
  });

  it('takes the quiz answers, the zip and the state on an erasure, and keeps them on a retention purge', () => {
    // Seuls, ils ne désignent personne ; croisés avec une date et une campagne, ils ré-identifient. Une demande
    // d'effacement les emporte donc — mais la rétention les garde, parce que ce sont les chiffres que lisent les
    // rapports, et que sans nom ni numéro à côté ils ne désignent plus personne.
    const row = { zip: '33610', state: 'FL', q1: 'yes', q3: 'no', utm_source: 'facebook' };
    expect(withoutContact(row, 'erased')).toEqual({ utm_source: 'facebook' });
    expect(withoutContact(row, 'purged')).toBeNull();
  });

  it('erases every visit of the same person, not only the one that was named', async () => {
    const tx = { lead: { update: jest.fn().mockResolvedValue({}) } };
    const prisma = {
      lead: {
        findUnique: jest.fn().mockResolvedValue({ id: 'lead-1', clickId: 'c1', purgedAt: null }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(async (fn: (t: unknown) => Promise<void>) => fn(tx)),
      $executeRaw: jest.fn().mockResolvedValue(1),
      // Ann est revenue trois fois depuis le même navigateur : trois visites, une seule demande.
      $queryRaw: jest.fn().mockResolvedValue([{ click_id: 'c1', kept: true, why: 'demandée' }, { click_id: 'c2', kept: true, why: 'demandée' }, { click_id: 'c3', kept: true, why: 'demandée' }]),
      conversion: {
        findMany: jest.fn().mockResolvedValue([{ id: 'conv-1', metadata: { phone: '8135550142' } }]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      click: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 3 }),
      },
      postbackLog: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn() },
    };
    await service(prisma).deleteOne('lead-1', 'admin@example.com');
    // Les trois visites sont nettoyées…
    expect(prisma.click.updateMany).toHaveBeenCalledWith({
      where: { clickId: { in: ['c1', 'c2', 'c3'] } },
      data: { scrubbedAt: expect.any(Date) },
    });
    // …et les deux autres lignes de lead reçoivent la même pierre tombale, sinon un postback tardif sur l'une d'elles
    // recréerait la personne.
    // Une par visite, et CRÉÉE quand la visite n'a pas encore de ligne : `updateMany` n'en créait aucune, donc la
    // visite d'à côté restait sans marque et la conversion suivante y recréait la personne en entier.
    expect(prisma.lead.upsert.mock.calls.map((c: [{ where: { clickId: string } }]) => c[0].where.clickId)).toEqual([
      'c1', 'c2', 'c3',
    ]);
    for (const [arg] of prisma.lead.upsert.mock.calls) {
      expect(arg.update).toMatchObject({ phone: null, email: null, erasedAt: expect.any(Date) });
      expect(arg.create).toMatchObject({ clickId: arg.where.clickId, source: 'erasure', erasedAt: expect.any(Date) });
    }
  });

  it('still erases what it was given when the person cannot be resolved', async () => {
    const tx = { lead: { update: jest.fn().mockResolvedValue({}) } };
    const prisma = {
      lead: {
        upsert: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue({ id: 'lead-1', clickId: 'c1', purgedAt: null }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn(async (fn: (t: unknown) => Promise<void>) => fn(tx)),
      $executeRaw: jest.fn().mockResolvedValue(1),
      // La résolution échoue : un effacement ne doit pas s'arrêter pour autant.
      $queryRaw: jest.fn().mockRejectedValue(new Error('db down')),
      conversion: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn() },
      click: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      postbackLog: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn() },
    };
    const out = await service(prisma).deleteOne('lead-1');
    expect(out.deleted).toBe(true);
    expect(prisma.click.updateMany).toHaveBeenCalledWith({
      where: { clickId: { in: ['c1'] } },
      data: { scrubbedAt: expect.any(Date) },
    });
  });
});

describe("la porte d'entrée des leads captés ailleurs", () => {
  function service(
    prisma: Record<string, unknown>,
    conversions: Record<string, unknown> = { create: jest.fn().mockResolvedValue({ id: 'conv-1' }) },
  ) {
    return new LeadsService(
      { get: jest.fn().mockImplementation((k: string) => (k === 'ERASURE_HMAC_KEY' ? CLE_TEST : undefined)) } as never,
      avecDefauts(prisma) as never,
      conversions as never,
    );
  }

  function intakePrisma() {
    return {
      campaign: { upsert: jest.fn().mockResolvedValue({ id: 'camp-ext' }) },
      click: { upsert: jest.fn().mockResolvedValue({}) },
      // Aucune personne déjà stockée sur ce clic : ce n'est pas un rejeu.
      lead: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
      // La liste de suppression fait partie du décor : c'est elle qui décide si la personne a le droit d'entrer.
      erasedContact: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
  }

  it("fabrique la VISITE qui manque, puis entre par la porte normale", async () => {
    // Tout ce que ce dépôt sait faire d'une personne — l'effacer partout, la purger au bout de quatre-vingt-dix
    // jours, l'exporter, refuser de la recréer après un effacement — est accroché à une VISITE. Un lead externe
    // sans visite serait un objet d'un genre nouveau, invisible à ces quatre mécanismes. On crée donc la visite,
    // et on passe ensuite par `conversions.create`, qui porte déjà toutes ces règles.
    const prisma = intakePrisma();
    const conversions = { create: jest.fn().mockResolvedValue({ id: 'conv-1' }) };
    const out = await service(prisma, conversions).intake({
      source: 'MonSite.com',
      externalId: 'form-42',
      firstName: 'Ann',
      phone: '8135550142',
      consentText: 'I agree to be called at 813-555-0142',
      pageUrl: 'https://monsite.com/devis',
    });

    // Une campagne PAR SITE : rangé ailleurs, ce lead compterait dans les chiffres de quelqu'un d'autre.
    const campaignCall = prisma.campaign.upsert.mock.calls[0][0];
    expect(campaignCall.where).toEqual({ slug: 'ext-monsite.com' });
    expect(campaignCall.create).toMatchObject({ slug: 'ext-monsite.com', attributionWindowHours: 24 * 365 });

    const clickCall = prisma.click.upsert.mock.calls[0][0];
    expect(clickCall.where).toEqual({ clickId: 'ext_monsite.com_form-42' });
    expect(clickCall.create).toMatchObject({ campaignId: 'camp-ext', isTest: false });

    // Et c'est bien la porte normale qui écrit la personne : le consentement voyage avec elle.
    const dto = conversions.create.mock.calls[0][0];
    expect(dto).toMatchObject({ clickId: 'ext_monsite.com_form-42', eventType: 'lead' });
    expect(dto.metadata).toMatchObject({ firstName: 'Ann', phone: '8135550142' });
    expect(String(dto.metadata.consent)).toContain('agree to be called');
    expect(out).toMatchObject({ stored: true, clickId: 'ext_monsite.com_form-42', campaignId: 'camp-ext' });
  });

  it('rejoue le même lead sans créer une seconde personne', async () => {
    // Un partenaire qui réessaie après un délai d'attente ne doit pas nous dupliquer quelqu'un. L'identifiant
    // qu'il nous donne EST la clé : deux envois visent la même visite. Et le rejeu ne RÉÉCRIT rien — remettre
    // une IP et un user-agent sur une visite peut-être déjà nettoyée par un effacement ressusciterait ce que
    // l'effacement venait d'enlever.
    const prisma = intakePrisma();
    const dto = { source: 'monsite.com', externalId: 'form-42', phone: '8135550142', ip: '1.2.3.4' };
    await service(prisma).intake(dto);
    await service(prisma).intake(dto);
    type Upsert = { where: { clickId: string }; update: object };
    const calls = prisma.click.upsert.mock.calls.map((c: [Upsert]) => c[0]);
    expect(calls.map((c: Upsert) => c.where.clickId)).toEqual([
      'ext_monsite.com_form-42',
      'ext_monsite.com_form-42',
    ]);
    expect(calls.every((c: Upsert) => Object.keys(c.update).length === 0)).toBe(true);
  });

  it("ne confond pas deux personnes qui portent le même identifiant chez DEUX sites différents", async () => {
    // « form-42 » est un numéro de formulaire, pas un identifiant mondial : deux partenaires en ont chacun un.
    // Sans le site dans la clé, le second écraserait le premier — et comme le rejeu ne réécrit rien, le lead du
    // second serait attaché à la personne du premier.
    const prisma = intakePrisma();
    await service(prisma).intake({ source: 'monsite.com', externalId: 'form-42', phone: '8135550142' });
    await service(prisma).intake({ source: 'autresite.com', externalId: 'form-42', phone: '4075550199' });
    const ids = prisma.click.upsert.mock.calls.map((c: [{ where: { clickId: string } }]) => c[0].where.clickId);
    expect(new Set(ids).size).toBe(2);
  });

  it("donne une visite PROPRE à chaque lead quand le partenaire n'a pas d'identifiant", async () => {
    // Sans identifiant chez eux, on ne peut pas dédoublonner — mais on ne peut surtout pas confondre : deux
    // formulaires remplis par deux personnes doivent faire deux visites. Une clé fixe les aurait fusionnées.
    const prisma = intakePrisma();
    await service(prisma).intake({ source: 'monsite.com', phone: '8135550142' });
    await service(prisma).intake({ source: 'monsite.com', phone: '4075550199' });
    const ids = prisma.click.upsert.mock.calls.map((c: [{ where: { clickId: string } }]) => c[0].where.clickId);
    expect(new Set(ids).size).toBe(2);
    expect(ids.every((id: string) => id.startsWith('ext_monsite.com_'))).toBe(true);
  });

  it("ne laisse pas une RÉPONSE de questionnaire écraser le contact ni le consentement", async () => {
    // Le questionnaire d'un partenaire porte les noms qu'il veut. S'il a une question « phone » — « à quel numéro
    // préférez-vous être rappelé ? » — ou « consent », ses réponses arrivaient APRÈS les champs nommés et les
    // remplaçaient : le numéro capté disparaissait, et le texte de consentement, qui est la preuve du droit
    // d'appeler, devenait une réponse de quiz. Les champs nommés ont le dernier mot ; les réponses restent lues.
    const prisma = intakePrisma();
    const conversions = { create: jest.fn().mockResolvedValue({ id: 'conv-1' }) };
    await service(prisma, conversions).intake({
      source: 'monsite.com',
      phone: '8135550142',
      consentText: 'I agree to be called',
      answers: { phone: 'le soir', consent: 'oui', q1: 'deux véhicules' },
    });
    const meta = conversions.create.mock.calls[0][0].metadata as Record<string, unknown>;
    expect(meta.phone).toBe('8135550142');
    expect(meta.consent).toBe('I agree to be called');
    expect(meta.q1).toBe('deux véhicules');
  });

  it('nomme le SITE dans le lead, au lieu de dire « form » comme tout le monde', async () => {
    // `source` est la colonne que l'opérateur lit dans la liste des leads. Sans elle, deux partenaires et notre
    // propre tunnel disent tous « form », et il faut remonter à la campagne pour savoir qui a envoyé quoi.
    const prisma = intakePrisma();
    const conversions = { create: jest.fn().mockResolvedValue({ id: 'conv-1' }) };
    await service(prisma, conversions).intake({ source: 'MonSite.com', phone: '8135550142' });
    const meta = conversions.create.mock.calls[0][0].metadata as Record<string, unknown>;
    expect(meta.source).toBe('monsite.com');
    // …et une réponse de questionnaire nommée « source » ne peut pas le maquiller non plus.
    await service(prisma, conversions).intake({
      source: 'MonSite.com',
      phone: '8135550142',
      answers: { source: 'autresite.fr' },
    });
    expect((conversions.create.mock.calls[1][0].metadata as Record<string, unknown>).source).toBe('monsite.com');
  });

  it("refuse un lead qui ne désigne personne, et refuse un lead sans origine", async () => {
    // Sans prénom, nom, courriel ni numéro, il n'y a personne à rappeler et personne à effacer : la ligne ne
    // ferait que gonfler les compteurs. Et sans savoir d'où il vient, il n'est rattachable à rien. Dans les deux
    // cas on refuse EN LE DISANT — et sans rien écrire, sinon on laisse une visite orpheline derrière soi.
    const prisma = intakePrisma();
    await expect(service(prisma).intake({ source: 'monsite.com', zip: '33610' })).rejects.toThrow(
      /ne désigne personne/,
    );
    await expect(service(prisma).intake({ source: '   ', phone: '8135550142' })).rejects.toThrow(/source/);
    expect(prisma.click.upsert).not.toHaveBeenCalled();
    expect(prisma.campaign.upsert).not.toHaveBeenCalled();
  });

  it("refuse un contact que la normalisation videra, au lieu de stocker un lead injoignable", async () => {
    // Le tracker ne garde un numéro que s'il porte 7 à 15 chiffres, et une adresse que si elle en a la forme. Un
    // partenaire qui met « à demander lors du rappel » dans `phone` passait la garde — écrite sur la chaîne brute
    // — et sa ligne se rangeait avec un téléphone VIDE, pendant qu'on lui répondait « stored: true ». Personne
    // n'aurait jamais rappelé cette personne, et personne n'aurait jamais su pourquoi.
    const prisma = intakePrisma();
    await expect(
      service(prisma).intake({ source: 'monsite.com', phone: 'à demander lors du rappel' }),
    ).rejects.toThrow(/ne désigne personne/);
    await expect(service(prisma).intake({ source: 'monsite.com', email: 'ann(at)example.com' })).rejects.toThrow(
      /ne désigne personne/,
    );
    await expect(service(prisma).intake({ source: 'monsite.com', phone: '12345' })).rejects.toThrow(
      /ne désigne personne/,
    );
    expect(prisma.click.upsert).not.toHaveBeenCalled();

    // …et un vrai numéro, écrit comme les gens l'écrivent, passe : ce n'est pas au partenaire de le formater.
    await service(prisma).intake({ source: 'monsite.com', phone: '(813) 555-0142' });
    expect(prisma.click.upsert).toHaveBeenCalledTimes(1);
    // Le NOM seul reste un contact : on peut rappeler une personne qu'un autre champ retrouvera, et le lead est
    // rattaché à sa visite. Refuser ici effacerait des leads que le tracker sait relier.
    await service(prisma).intake({ source: 'monsite.com', firstName: 'Ann', phone: 'bientôt' });
    expect(prisma.click.upsert).toHaveBeenCalledTimes(2);
  });

  it("rapporte quand la porte normale a refusé le lead, au lieu d'annoncer un succès", async () => {
    // La porte normale refuse pour ses propres raisons — un lead de test, une fenêtre d'attribution dépassée.
    // L'appelant doit l'apprendre : sans ça, un partenaire croit son lead stocké et nous le renvoie en boucle.
    const prisma = intakePrisma();
    const conversions = { create: jest.fn().mockResolvedValue({ skipped: true, reason: 'test_lead' }) };
    const out = await service(prisma, conversions).intake({ source: 'monsite.com', phone: '8135550142' });
    expect(out).toMatchObject({ stored: false, reason: 'test_lead' });
  });

  it("refuse une personne EFFACÉE qui revient sous un identifiant neuf, sans rien écrire", async () => {
    // LE DÉFAUT LE PLUS GRAVE DE CETTE ROUTE, et le cas NORMAL, pas le cas limite. La garde d'effacement de
    // `conversions.create` lit `click_id` : elle ne couvre que les visites déjà connues. Un partenaire engendre
    // un identifiant par soumission, donc un clic neuf — aucune pierre tombale ne s'y rattachait, et la personne
    // qui avait demandé son effacement était recréée avec son contact complet, pendant qu'on répondait
    // « stored: true ». On ne peut pas la reconnaître à son numéro : l'effacement l'a supprimé, comme promis.
    // D'où l'empreinte à sens unique, écrite avant le nettoyage.
    const prisma = intakePrisma();
    // Tour 31 : la liste se lit en UNE requête ; elle connaît ce contact, déclaré.
    prisma.erasedContact.findMany = jest.fn().mockImplementation(({ where }: { where: { hash: { in: string[] } } }) =>
      Promise.resolve(where.hash.in.map((hash) => ({ hash, kind: 'phone', groupe: null }))),
    );
    const conversions = { create: jest.fn() };
    const out = await service(prisma, conversions).intake({
      source: 'monsite.com',
      externalId: 'formulaire-neuf-jamais-vu',
      firstName: 'Ann',
      phone: '8135550142',
    });
    expect(out).toMatchObject({ stored: false, reason: 'erased_person' });
    // RIEN n'est écrit : ni campagne, ni visite, ni conversion. Une visite orpheline serait déjà une trace.
    expect(prisma.campaign.upsert).not.toHaveBeenCalled();
    expect(prisma.click.upsert).not.toHaveBeenCalled();
    expect(conversions.create).not.toHaveBeenCalled();
  });

  it("inscrit l'empreinte de la personne AVANT de supprimer son contact", async () => {
    // L'ordre est la règle : une ligne plus bas, le numéro et l'adresse n'existent plus, et il est alors trop
    // tard pour reconnaître cette personne si elle revient par une autre porte.
    const ordre: string[] = [];
    const prisma = {
      lead: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'lead-1', clickId: 'c1', campaignId: 'camp-A', isTest: false,
          createdAt: new Date('2026-07-01T00:00:00Z'), phone: '8135550142', email: 'ann@example.com',
          firstName: 'Ann', lastName: null, erasedAt: null, purgedAt: null,
        }),
        upsert: jest.fn().mockImplementation(() => { ordre.push('pierre tombale'); return Promise.resolve({}); }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      erasedContact: {
        createMany: jest.fn().mockImplementation(() => { ordre.push('empreinte'); return Promise.resolve({ count: 2 }); }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      conversion: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      postbackLog: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      click: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn().mockResolvedValue(0),
      $transaction: jest.fn(async (fn: (t: unknown) => Promise<void>) => fn({ lead: { update: jest.fn() } })),
    };
    await service(prisma).deleteOne('lead-1', 'admin@example.com');
    expect(prisma.erasedContact.createMany).toHaveBeenCalled();
    expect(ordre.indexOf('empreinte')).toBeLessThan(ordre.indexOf('pierre tombale'));
    // Deux empreintes : le numéro ET l'adresse. Une seule laisserait revenir la personne par l'autre.
    const [[appel]] = prisma.erasedContact.createMany.mock.calls;
    expect(appel.data.map((d: { kind: string }) => d.kind).sort()).toEqual(['email', 'phone']);
    // L'empreinte n'est pas le contact : on ne rappelle personne avec un SHA-256.
    for (const ligne of appel.data) {
      expect(ligne.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(ligne)).not.toContain('8135550142');
      expect(JSON.stringify(ligne)).not.toContain('ann@example.com');
    }
  });

  it("reconnaît la même personne écrite autrement", async () => {
    // « (813) 555-0142 » et « 8135550142 » sont la même personne, « Ann@Example.com » et « ann@example.com »
    // aussi. Une empreinte posée sur la forme brute ne la reconnaîtrait pas sous l'autre — et la promesse de ne
    // plus jamais la recontacter tiendrait à la façon dont le partenaire met ses espaces.
    const vus: string[][] = [];
    const prisma = intakePrisma();
    prisma.erasedContact.findMany = jest.fn().mockImplementation(
      ({ where }: { where: { hash: { in: string[] } } }) => {
        vus.push(where.hash.in);
        return Promise.resolve([]);
      },
    );
    await service(prisma).intake({ source: 'monsite.com', phone: '(813) 555-0142', email: 'Ann@Example.com' });
    await service(prisma).intake({ source: 'monsite.com', phone: '1-813-555-0142', email: 'ann@example.com' });
    expect(vus[0].sort()).toEqual(vus[1].sort());
  });

  it("porte chaque champ du partenaire jusqu'à la personne, sans en perdre un", async () => {
    // SIX MUTANTS TRIVIAUX SURVIVAIENT ICI. Retirer `email` des métadonnées laissait la garde d'entrée valider
    // le lead sur un objet local, puis le stocker sans adresse — et si c'était le seul contact, plus aucune
    // ligne n'était créée, avec « stored: true » en réponse. Le code postal et l'État, eux, conditionnent le
    // prix payé par l'acheteur ; l'IP et le navigateur sont la preuve que l'appel était autorisé.
    const prisma = intakePrisma();
    const conversions = { create: jest.fn().mockResolvedValue({ id: 'conv-1' }) };
    await service(prisma, conversions).intake({
      source: 'monsite.com',
      externalId: 'form-7',
      firstName: 'Ann',
      lastName: 'Dupont',
      email: 'ann@example.com',
      phone: '8135550142',
      zip: '33610',
      state: 'FL',
      consentText: 'I agree to be called',
      pageUrl: 'https://monsite.com/devis',
      ip: '198.51.100.7',
      userAgent: 'Mozilla/5.0 (test)',
      answers: { q1: 'deux véhicules' },
    });
    const [[dto, contexte]] = conversions.create.mock.calls;
    expect(dto.metadata).toMatchObject({
      firstName: 'Ann',
      lastName: 'Dupont',
      email: 'ann@example.com',
      phone: '8135550142',
      zip: '33610',
      state: 'FL',
      consent: 'I agree to be called',
      page_url: 'https://monsite.com/devis',
      source: 'monsite.com',
      q1: 'deux véhicules',
    });
    // L'IP et le navigateur ne voyagent pas dans les métadonnées mais dans le CONTEXTE : c'est de là que la
    // preuve de consentement les lit.
    expect(contexte).toMatchObject({ incomingPostbackIp: '198.51.100.7', userAgent: 'Mozilla/5.0 (test)' });
    // Et la visite garde de quoi retrouver la personne quand elle n'a pas de ligne de lead.
    expect(prisma.click.upsert.mock.calls[0][0].create.rawParams).toMatchObject({
      source: 'monsite.com', external_id: 'form-7',
    });
  });

  it("n'accepte pas qu'une réponse de questionnaire prenne le nom d'un ALIAS reconnu", async () => {
    // La protection ne couvrait que les neuf noms canoniques. Le lecteur de métadonnées en connaît d'autres —
    // `first_name`, `name`, `consentText`, `pageUrl`, `zipCode`, `postal_code` — et il lit certains EN PREMIER.
    // Résultat prouvé : une réponse de quiz devenait la preuve de consentement, et « Test Dupont » glissé dans
    // `answers.first_name` contournait la garde des leads de test, qui ne regarde que `firstName`.
    const prisma = intakePrisma();
    const conversions = { create: jest.fn().mockResolvedValue({ id: 'conv-1' }) };
    await service(prisma, conversions).intake({
      source: 'monsite.com',
      firstName: 'Ann',
      phone: '8135550142',
      consentText: 'I agree to be called',
      pageUrl: 'https://monsite.com/vrai',
      answers: {
        first_name: 'Test Dupont',
        name: 'Test',
        last_name: 'Faux',
        consentText: 'oui',
        pageUrl: 'https://ailleurs.test/faux',
        zipCode: '00000',
        postal_code: '00000',
        q1: 'deux véhicules',
      },
    });
    const meta = conversions.create.mock.calls[0][0].metadata as Record<string, unknown>;
    for (const interdit of ['first_name', 'name', 'last_name', 'consentText', 'pageUrl', 'zipCode', 'postal_code']) {
      expect(meta).not.toHaveProperty(interdit);
    }
    expect(meta.firstName).toBe('Ann');
    expect(meta.consent).toBe('I agree to be called');
    expect(meta.page_url).toBe('https://monsite.com/vrai');
    expect(meta.q1).toBe('deux véhicules');  // les vraies réponses passent toujours
  });

  it("date la visite du moment où la personne a rempli le formulaire, pas de notre réception", async () => {
    // Un partenaire qui pousse les leads de la veille en lot daterait tout le lot d'aujourd'hui : la rétention
    // à quatre-vingt-dix jours partirait trop tard, et les rapports par jour seraient faux. Une date illisible,
    // elle, ne doit pas faire une visite datée de 1970 — on retombe alors sur maintenant.
    const prisma = intakePrisma();
    await service(prisma).intake({ source: 'monsite.com', phone: '8135550142', capturedAt: '2026-09-01T10:00:00Z' });
    expect(prisma.click.upsert.mock.calls[0][0].create.createdAt).toEqual(new Date('2026-09-01T10:00:00Z'));

    const avant = Date.now();
    await service(prisma).intake({ source: 'monsite.com', phone: '8135550142', capturedAt: 'pas une date' });
    const retombee = prisma.click.upsert.mock.calls[1][0].create.createdAt as Date;
    expect(retombee.getTime()).toBeGreaterThanOrEqual(avant);
  });

  it('garde un lead de test marqué comme tel, de la visite jusqu\'à la conversion', async () => {
    // Le partenaire teste son intégration avant de brancher le vrai formulaire. Si ces leads-là entrent comme
    // des vrais, ils partent aux acheteurs et polluent les chiffres sur lesquels la machine décide.
    const prisma = intakePrisma();
    const conversions = { create: jest.fn().mockResolvedValue({ id: 'conv-1' }) };
    await service(prisma, conversions).intake({ source: 'monsite.com', phone: '8135550142', isTest: true });
    expect(prisma.click.upsert.mock.calls[0][0].create).toMatchObject({ isTest: true });
    expect(conversions.create.mock.calls[0][0]).toMatchObject({ is_test_lead: true });
  });
});

describe("la liste de suppression, telle que le juré l'a attaquée", () => {
  const CLE = CLE_TEST;

  function service(prisma: Record<string, unknown>, conversions: Record<string, unknown> = { create: jest.fn() }) {
    return new LeadsService(
      { get: jest.fn().mockImplementation((k: string) => (k === 'ERASURE_HMAC_KEY' ? CLE : undefined)) } as never,
      avecDefauts(prisma) as never,
      conversions as never,
    );
  }

  /** Une liste qui ne répond « effacé » QUE pour les empreintes qu'elle contient vraiment. */
  function listeContenant(...contacts: { phone?: string; email?: string }[]) {
    const connues = new Set(contacts.flatMap((c) => contactFingerprints(c, CLE).map((m) => m.hash)));
    return {
      // Le faux précédent répondait « trouvé » quelles que soient les empreintes demandées : il ne prouvait
      // donc pas qu'on cherche la BONNE. Celui-ci ne trouve que ce qu'on lui a donné.
      findFirst: jest.fn().mockImplementation(({ where }: { where: { hash: { in: string[] } } }) =>
        Promise.resolve(where.hash.in.some((h) => connues.has(h)) ? { hash: 'x' } : null),
      ),
      // Tour 31 : la lecture groupée d'`isErasedPerson` — des lignes déclarées, d'avant les groupes.
      findMany: jest.fn().mockImplementation(({ where }: { where: { hash: { in: string[] } } }) =>
        Promise.resolve(where.hash.in.filter((h) => connues.has(h)).map((hash) => ({ hash, kind: 'phone', groupe: null }))),
      ),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
  }

  function porte(liste: ReturnType<typeof listeContenant>) {
    return {
      campaign: { upsert: jest.fn().mockResolvedValue({ id: 'camp-ext' }) },
      click: { upsert: jest.fn().mockResolvedValue({}) },
      lead: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
      erasedContact: liste,
    };
  }

  it("reconnaît une personne effacée par son ADRESSE SEULE, et laisse passer quelqu'un d'autre", async () => {
    const liste = listeContenant({ email: 'ann@example.com' });
    const effacee = await service(porte(liste)).intake({ source: 'monsite.com', email: 'ann@example.com' });
    expect(effacee).toMatchObject({ stored: false, reason: 'erased_person' });

    const autre = await service(porte(liste), { create: jest.fn().mockResolvedValue({ id: 'c' }) }).intake({
      source: 'monsite.com',
      email: 'bob@example.com',
    });
    expect(autre).toMatchObject({ stored: true });
  });

  it('cherche le numéro ET l\'adresse — une seule des deux laisserait revenir la personne par l\'autre', async () => {
    const liste = listeContenant({ phone: '8135550142' });
    const out = await service(porte(liste)).intake({
      source: 'monsite.com',
      phone: '8135550142',
      email: 'adresse-neuve@example.com',
    });
    expect(out).toMatchObject({ reason: 'erased_person' });
    const demande = liste.findMany.mock.calls[0][0].where.hash.in as string[];
    expect(demande).toHaveLength(2);
  });

  it("reconnaît le préfixe « 00 » et l'étiquette « +promo »", async () => {
    // « 001 813 555 0142 » est « +1 813 555 0142 » ; « ann+promo@ » arrive dans la boîte de « ann@ ».
    const liste = listeContenant({ phone: '8135550142', email: 'ann@example.com' });
    expect(await service(porte(liste)).intake({ source: 'monsite.com', phone: '001 813 555 0142' })).toMatchObject({
      reason: 'erased_person',
    });
    expect(await service(porte(liste)).intake({ source: 'monsite.com', email: 'ann+promo@example.com' })).toMatchObject({
      reason: 'erased_person',
    });
  });

  it("l'empreinte dépend de la CLÉ : sans elle, on ne retrouve pas le numéro par force brute", () => {
    // Le juré a retrouvé un numéro depuis un SHA-256 nu en 30 secondes. Avec une clé hors base, l'empreinte d'un
    // même numéro change avec la clé — une base volée seule ne se renverse plus.
    const a = contactFingerprints({ phone: '8135550142' }, 'cle-A'.padEnd(40, 'a'))[0].hash;
    const b = contactFingerprints({ phone: '8135550142' }, 'cle-B'.padEnd(40, 'b'))[0].hash;
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    // …et sans clé du tout, on refuse de calculer plutôt que de retomber sur un hachage nu.
    expect(() => contactFingerprints({ phone: '8135550142' }, '')).toThrow(/ERASURE_HMAC_KEY/);
  });

  it("refuse d'entrer quand la clé manque, au lieu de laisser revenir n'importe qui", async () => {
    // Sans clé, la liste n'a rien pu noter et ne peut rien lire : la protection promise n'existe pas. Répondre
    // « stored: true » serait recréer, peut-être, une personne effacée — on refuse en le disant.
    const sansCle = new LeadsService(
      { get: jest.fn().mockReturnValue(undefined) } as never,
      avecDefauts(porte(listeContenant())) as never,
      { create: jest.fn() } as never,
    );
    const refus = sansCle.intake({ source: 'monsite.com', phone: '8135550142' });
    await expect(refus).rejects.toThrow(/ERASURE_HMAC_KEY/);
    // Un 503, pas un 500 : le partenaire doit réessayer plus tard, pas croire à une panne de son côté.
    await expect(refus).rejects.toMatchObject({ status: 503 });
  });

  it("un rejeu du même externalId ne réécrit PAS la preuve de consentement", async () => {
    // Mesuré par le juré : « TEXTE A » devenait « TEXTE B (corrigé) », daté de la réception. Un rejeu n'entre plus.
    const prisma = porte(listeContenant());
    prisma.lead.findUnique = jest.fn().mockResolvedValue({ id: 'lead-deja-la' });
    const conversions = { create: jest.fn() };
    const out = await service(prisma, conversions).intake({
      source: 'monsite.com',
      externalId: 'form-42',
      phone: '8135550142',
      consentText: 'TEXTE B (corrigé)',
    });
    expect(out).toMatchObject({ stored: true, replay: true });
    expect(conversions.create).not.toHaveBeenCalled();
  });

  it("garde l'IP, le navigateur et la page sur la VISITE — la preuve ne vit pas que dans la conversion", async () => {
    const prisma = porte(listeContenant());
    await service(prisma, { create: jest.fn().mockResolvedValue({ id: 'c' }) }).intake({
      source: 'monsite.com',
      phone: '8135550142',
      ip: '198.51.100.7',
      userAgent: 'Mozilla/5.0 (test)',
      pageUrl: 'https://monsite.com/devis',
    });
    expect(prisma.click.upsert.mock.calls[0][0].create).toMatchObject({
      ipAddress: '198.51.100.7',
      userAgent: 'Mozilla/5.0 (test)',
      referrer: 'https://monsite.com/devis',
    });
  });
});

describe("l'effacement inscrit TOUTE la personne, et dit quand il n'a pas pu", () => {
  const CLE = CLE_TEST;

  function effaceur(prisma: Record<string, unknown>) {
    return new LeadsService(
      { get: jest.fn().mockImplementation((k: string) => (k === 'ERASURE_HMAC_KEY' ? CLE : undefined)) } as never,
      avecDefauts(prisma) as never,
      { create: jest.fn() } as never,
    );
  }

  function base(extra: Record<string, unknown> = {}) {
    return {
      lead: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'lead-1', clickId: 'c1', campaignId: 'camp-A', isTest: false,
          createdAt: new Date('2026-07-01T00:00:00Z'), phone: '8135550142', email: 'ann@example.com',
          firstName: 'Ann', lastName: null, erasedAt: null, purgedAt: null,
        }),
        // La visite sœur a laissé une AUTRE adresse. Le juré : elle recevait sa pierre tombale, mais son adresse
        // n'entrait pas dans la liste — et la personne revenait par elle.
        findMany: jest.fn().mockResolvedValue([{ phone: null, email: 'ann.travail@example.com' }]),
        upsert: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      erasedContact: { createMany: jest.fn().mockResolvedValue({ count: 3 }), findFirst: jest.fn() },
      conversion: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      postbackLog: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      click: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn().mockResolvedValue(0),
      $transaction: jest.fn(async (fn: (t: unknown) => Promise<void>) => fn({ lead: { update: jest.fn() } })),
      ...extra,
    };
  }

  it("inscrit l'adresse de la visite SŒUR, pas seulement celle de la demande", async () => {
    const prisma = base();
    await effaceur(prisma).deleteOne('lead-1', 'admin@example.com');
    const inscrites = new Set(
      (prisma.erasedContact.createMany.mock.calls[0][0].data as { hash: string }[]).map((d) => d.hash),
    );
    const soeur = contactFingerprints({ email: 'ann.travail@example.com' }, CLE)[0].hash;
    expect(inscrites.has(soeur)).toBe(true);
    // Et sans doublon bloquant : un second effacement de la même personne ne doit pas faire échouer le lot.
    expect(prisma.erasedContact.createMany.mock.calls[0][0].skipDuplicates).toBe(true);
  });

  it("DIT que la liste n'a pas pu être écrite, au lieu de répondre « effacé » sans réserve", async () => {
    // Le contact est supprimé une ligne plus bas : si l'inscription a échoué, la protection contre le retour de
    // cette personne est perdue pour de bon. L'effacement continue — mais l'opérateur doit le savoir.
    const prisma = base();
    prisma.erasedContact.createMany = jest.fn().mockRejectedValue(new Error('base indisponible'));
    const out = await effaceur(prisma).deleteOne('lead-1', 'admin@example.com');
    expect(out).toMatchObject({ deleted: true, suppression: 'failed' });
  });

  it("dit « nothing » quand le lead effacé ne portait AUCUN contact à inscrire", async () => {
    // Le pendant de eraseVisit sur la route des leads : sans ce décor, taire « nothing » ici passait inaperçu.
    const prisma = base();
    prisma.lead.findUnique = jest.fn().mockResolvedValue({
      id: 'lead-1', clickId: 'c1', campaignId: 'camp-A', isTest: false,
      createdAt: new Date('2026-07-01T00:00:00Z'), phone: null, email: null,
      firstName: 'Ann', lastName: null, erasedAt: null, purgedAt: null,
    });
    prisma.lead.findMany = jest.fn().mockResolvedValue([]);
    const out = await effaceur(prisma).deleteOne('lead-1', 'admin@example.com');
    expect(out).toMatchObject({ deleted: true, suppression: 'nothing' });
  });

  it("inscrit une visite SANS ligne de lead, par son contact lu dans rawParams", async () => {
    // Le juré a mesuré zéro inscription sur ce chemin, puis « stored: true » quand la personne revenait.
    const prisma = base();
    prisma.lead.findUnique = jest.fn().mockResolvedValue(null);
    prisma.lead.findMany = jest.fn().mockResolvedValue([]);
    prisma.click.findUnique = jest.fn().mockResolvedValue({
      clickId: 'c9', campaignId: 'camp-A', isTest: false, createdAt: new Date('2026-07-01T00:00:00Z'),
      rawParams: { phone: '8135550142' },
    });
    await effaceur(prisma).eraseVisit('c9', 'admin@example.com');
    expect(prisma.erasedContact.createMany).toHaveBeenCalled();
    const inscrit = (prisma.erasedContact.createMany.mock.calls[0][0].data as { hash: string }[]).map((d) => d.hash);
    expect(inscrit).toContain(contactFingerprints({ phone: '8135550142' }, CLE)[0].hash);
  });
});


describe('tour 22 : ce que le juré a fait revenir, et la clé qui ne doit pas changer', () => {
  // `null` et non `undefined` pour « pas de clé » : un paramètre par défaut en JavaScript remplace `undefined`, et
  // le premier décor du test R04 tournait donc AVEC la clé de test.
  function effaceur(prisma: Record<string, unknown>, cle: string | null = CLE_TEST, brut = false) {
    return new LeadsService(
      { get: jest.fn().mockImplementation((k: string) => (k === 'ERASURE_HMAC_KEY' ? cle ?? undefined : undefined)) } as never,
      (brut ? prisma : avecDefauts(prisma)) as never,
      { create: jest.fn() } as never,
    );
  }

  function visiteSansLead(extra: Record<string, unknown> = {}) {
    return {
      lead: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({}),
        upsert: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      click: {
        findUnique: jest.fn().mockResolvedValue({
          clickId: 'c9', campaignId: 'camp-A', isTest: false, createdAt: new Date('2026-07-01T00:00:00Z'), rawParams: {},
        }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      conversion: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      postbackLog: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      erasedContact: {
        findFirst: jest.fn().mockResolvedValue(null),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn().mockResolvedValue(0),
      $transaction: jest.fn(async (fn: (t: unknown) => Promise<void>) => fn({ lead: { update: jest.fn() } })),
      ...extra,
    };
  }

  function inscrits(prisma: { erasedContact: { createMany: jest.Mock } }): string[] {
    return prisma.erasedContact.createMany.mock.calls
      .flatMap(([arg]: [{ data: { hash: string; kind: string }[] }]) => arg.data)
      .filter((d: { kind: string }) => d.kind !== 'temoin')
      .map((d: { hash: string }) => d.hash);
  }

  const empreinte = (c: { phone?: string; email?: string }) => contactFingerprints(c, CLE_TEST)[0].hash;

  it("S7a : inscrit un contact qui n'était QUE dans une conversion et un paramètre de postback", async () => {
    // Le cas même que la route décrit : l'acheteur a renvoyé l'adresse dans un paramètre de postback. Le
    // nettoyage la retirait ; l'inscription ne la voyait pas — et Dora revenait avec « stored: true ».
    const prisma = visiteSansLead();
    prisma.conversion.findMany = jest.fn().mockResolvedValue([
      { metadata: { lead: { contact: { phone: '(813) 555-0142' } } }, postbackParam1: 'dora@example.com' },
    ]);
    await effaceur(prisma).eraseVisit('c9', 'admin@example.com');
    const liste = inscrits(prisma);
    expect(liste).toContain(empreinte({ email: 'dora@example.com' }));
    expect(liste).toContain(empreinte({ phone: '8135550142' }));
  });

  it("S7b : inscrit l'adresse d'une visite SŒUR qui n'a pas de ligne de lead", async () => {
    const prisma = visiteSansLead();
    prisma.click.findMany = jest.fn().mockResolvedValue([
      { clickId: 'c8', rawParams: { email: 'eve@example.com' } },
    ]);
    await effaceur(prisma).eraseVisit('c9', 'admin@example.com');
    expect(inscrits(prisma)).toContain(empreinte({ email: 'eve@example.com' }));
  });

  it("S3 : inscrit une adresse cachée dans l'URL d'atterrissage (`?sub1=…`), encodée ou non", async () => {
    const prisma = visiteSansLead();
    prisma.click.findMany = jest.fn().mockResolvedValue([
      { clickId: 'c9', rawParams: { landing: 'https://lp.test/?sub1=carl%40example.com&tel=4155550199' } },
    ]);
    await effaceur(prisma).eraseVisit('c9', 'admin@example.com');
    const liste = inscrits(prisma);
    expect(liste).toContain(empreinte({ email: 'carl@example.com' }));
    expect(liste).toContain(empreinte({ phone: '4155550199' }));
  });

  it("dit « nothing » quand l'effacement n'a trouvé AUCUN contact à inscrire", async () => {
    // Un effacement qui n'inscrit rien ne protège personne contre un retour : l'opérateur doit le savoir.
    const prisma = visiteSansLead();
    const out = await effaceur(prisma).eraseVisit('c9', 'admin@example.com');
    expect(out).toMatchObject({ erased: true, suppression: 'nothing' });
  });

  it("un identifiant publicitaire à 17 chiffres n'est pas pris pour un numéro", () => {
    expect(contactsInAnything({ adId: '23851234567890123' })).toEqual([]);
    expect(contactsInAnything({ phone: '813 555 0142' })).toEqual([{ phone: '8135550142' }]);
  });

  it("vérifie la clé contre le TÉMOIN : une clé changée fait refuser, au lieu de laisser revenir tout le monde", async () => {
    const prisma = visiteSansLead();
    // Le témoin posé par une AUTRE clé : la clé du moment ne le retrouve pas.
    const autreTemoin = contactFingerprints({ email: 'temoin@liste-de-suppression.invalid' }, 'z'.repeat(40))[0].hash;
    prisma.erasedContact.findFirst = jest.fn().mockImplementation(({ where }: { where: { kind?: string } }) =>
      Promise.resolve(where?.kind === 'temoin' ? { hash: autreTemoin } : null),
    );
    const service = new LeadsService(
      { get: jest.fn().mockImplementation((k: string) => (k === 'ERASURE_HMAC_KEY' ? CLE_TEST : undefined)) } as never,
      prisma as never,
      { create: jest.fn() } as never,
    );
    await expect(service.intake({ source: 'monsite.com', phone: '8135550142' })).rejects.toMatchObject({ status: 503 });
    const out = await service.eraseVisit('c9', 'admin@example.com');
    expect(out).toMatchObject({ suppression: 'failed' });
  });

  it('pose le témoin à la première utilisation, avec la clé du moment', async () => {
    const prisma = visiteSansLead();
    prisma.click.findMany = jest.fn().mockResolvedValue([{ clickId: 'c9', rawParams: { phone: '8135550142' } }]);
    // Le double BRUT : une base neuve, où aucun témoin n'existe encore.
    await effaceur(prisma, CLE_TEST, true).eraseVisit('c9', 'admin@example.com');
    const temoins = prisma.erasedContact.createMany.mock.calls
      .flatMap(([arg]: [{ data: { hash: string; kind: string }[] }]) => arg.data)
      .filter((d: { kind: string }) => d.kind === 'temoin');
    expect(temoins).toEqual([
      { hash: contactFingerprints({ email: 'temoin@liste-de-suppression.invalid' }, CLE_TEST)[0].hash, kind: 'temoin', groupe: 'temoin' },
    ]);
  });

  it("R04 : sans clé valide, l'effacement dit « failed » et n'écrit AUCUNE empreinte de secours", async () => {
    for (const cle of [null, '', '   '.repeat(20), 'courte']) {
      const prisma = visiteSansLead();
      prisma.click.findMany = jest.fn().mockResolvedValue([{ clickId: 'c9', rawParams: { phone: '8135550142' } }]);
      // Base NEUVE (double brut, aucun témoin) : seule la règle de longueur peut refuser ici. Sur une base déjà
      // initialisée, le témoin refusait avant elle — et un mutant qui retirait la règle passait.
      const out = await effaceur(prisma, cle, true).eraseVisit('c9', 'admin@example.com');
      expect(out).toMatchObject({ suppression: 'failed' });
      expect(prisma.erasedContact.createMany).not.toHaveBeenCalled();
    }
  });

  it("l'empreinte est un HMAC-SHA256 standard : valeurs de référence calculées HORS de ce code", () => {
    // Calculées avec le module `hmac` de Python, pas avec `contactFingerprints` : un test qui recalcule avec le
    // code testé ne voit pas une dérive de format (préfixe, casse, séparateur).
    const cle = 'cle-de-reference-0123456789abcdef-0123';
    expect(contactFingerprints({ phone: '(813) 555-0142' }, cle)[0].hash).toBe(
      '3d8711216ed6b88c6066e1653818699ba221b95a1d709c15f6945382542f6017',
    );
    expect(contactFingerprints({ email: 'Ann@Example.com' }, cle)[0].hash).toBe(
      '38cd5c72f51aacf1bc7e1f2f583de9b870d4491a0aaaadd3eb31b87b577401ea',
    );
  });

  it('N01 : le préfixe « 00 » part, le « 0 » national français reste', () => {
    expect(normalizePhone('06 12 34 56 78')).toBe('0612345678');
    expect(normalizePhone('0033 6 12 34 56 78')).toBe('33612345678');
    expect(normalizePhone('001 813 555 0142')).toBe('8135550142');
  });

  it("I01 : deux externalId longs qui ne diffèrent qu'à la fin restent deux visites", async () => {
    const prisma = {
      campaign: { upsert: jest.fn().mockResolvedValue({ id: 'camp-ext' }) },
      click: { upsert: jest.fn().mockResolvedValue({}), findUnique: jest.fn().mockResolvedValue(null) },
      lead: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = effaceur(prisma);
    const racine = 'x'.repeat(110);
    await service.intake({ source: 'monsite.com', externalId: `${racine}-aaaaaaa`, phone: '8135550142' });
    await service.intake({ source: 'monsite.com', externalId: `${racine}-bbbbbbb`, phone: '8135550199' });
    const ids = prisma.click.upsert.mock.calls.map((c: [{ where: { clickId: string } }]) => c[0].where.clickId);
    expect(new Set(ids).size).toBe(2);
  });

  it('A01 : `_fbp` et les autres identifiants de clic Meta ne passent pas par les réponses', () => {
    expect(alias({ _fbp: 'fb.1.x', fbc: 'y', fbp: 'z', _fbc: 'w', fbclid: 'v', q1: 'ok' })).toEqual({ q1: 'ok' });
  });

  it("refuse un envoi RÉEL posé sur une visite de TEST, au lieu de le stocker invisible", async () => {
    // Intégration branchée avec `isTest: true`, puis même externalId en production : la visite garde son drapeau
    // de test, et le vrai lead était rangé hors des listes et des rapports, avec « stored: true ».
    const prisma = {
      campaign: { upsert: jest.fn().mockResolvedValue({ id: 'camp-ext' }) },
      click: { upsert: jest.fn().mockResolvedValue({}), findUnique: jest.fn().mockResolvedValue({ isTest: true }) },
      lead: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    };
    const conversions = { create: jest.fn() };
    const service = new LeadsService(
      { get: jest.fn().mockImplementation((k: string) => (k === 'ERASURE_HMAC_KEY' ? CLE_TEST : undefined)) } as never,
      avecDefauts(prisma) as never,
      conversions as never,
    );
    const out = await service.intake({ source: 'monsite.com', externalId: 'form-1', phone: '8135550142' });
    expect(out).toMatchObject({ stored: false, reason: 'external_id_used_for_test' });
    expect(conversions.create).not.toHaveBeenCalled();
  });
});


describe('tour 22 : les règles de lecture, chacune isolée', () => {
  it("voit un numéro SEUL dans un paramètre de postback, sans clé qui dise « téléphone »", () => {
    // Un acheteur renvoie souvent le numéro nu dans `postback_param_2` : aucune clé ne le nomme, seule la forme de
    // la valeur entière le dit.
    expect(contactsInAnything({ postbackParam2: '813-555-0199' })).toEqual([{ phone: '8135550199' }]);
  });

  it('voit une adresse ENCODÉE hors de toute URL', () => {
    // Dans une URL, le découpage des paramètres décode déjà ; une valeur isolée (`carl%40example.com`), elle, ne
    // passe que par le décodage explicite.
    expect(contactsInAnything({ note: 'carl%40example.com' })).toEqual([{ email: 'carl@example.com' }]);
  });
});
