import { ForbiddenException } from '@nestjs/common';
import { ConversionsService } from '../src/conversions/conversions.service';
import { ConversionsController, maskUrlSecrets } from '../src/conversions/conversions.controller';
import { MachineApiService } from '../src/machine-api/machine-api.service';
import { isLeadOutcomeEvent } from '../src/shared/tracking/lead-outcome-events';

describe('buyer outcome check cannot be bypassed by the event type spelling', () => {
  function conversions(secret: string | null) {
    const prisma = {
      click: {
        findUnique: jest.fn().mockResolvedValue({ campaign: { postbackConfig: secret ? { postbackSecret: secret } : null } }),
      },
      conversion: { findUnique: jest.fn(), count: jest.fn(), create: jest.fn() },
    };
    const service = new ConversionsService(
      prisma as never,
      { processConversion: jest.fn() } as never,
      { get: jest.fn().mockReturnValue(undefined) } as never,
      { getEffective: jest.fn().mockResolvedValue({ baseCurrency: 'EUR', fxRates: '', testMode: false }) } as never,
    );
    return { service, prisma };
  }

  it.each(['lead_sold.', 'lead sold', 'LEAD_SOLD', ' lead_sold ', 'lead_sold​', 'lead_returned;', 'Lead Rejected!'])(
    'refuses et=%j on a campaign without secret',
    async (et) => {
      const { service, prisma } = conversions(null);
      const create = jest.spyOn(service, 'create');
      await expect(service.triggerByClickId('c1', { et, payout: '500' })).rejects.toBeInstanceOf(ForbiddenException);
      expect(create).not.toHaveBeenCalled();
      expect(prisma.conversion.create).not.toHaveBeenCalled();
    },
  );

  it('records the normalized type, the one that was checked', async () => {
    const { service } = conversions('s3cret');
    const create = jest.spyOn(service, 'create').mockResolvedValue({ skipped: true } as never);
    await service.triggerByClickId('c1', { et: 'Lead Sold.', secret: 's3cret' });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'lead_sold' }), undefined);
  });

  it('recognises outcomes whatever their spelling, and nothing else', () => {
    expect(isLeadOutcomeEvent('lead_sold.')).toBe(true);
    expect(isLeadOutcomeEvent('lead sold')).toBe(true);
    expect(isLeadOutcomeEvent('lead_sold​')).toBe(true);
    expect(isLeadOutcomeEvent('lead')).toBe(false);
    expect(isLeadOutcomeEvent('')).toBe(false);
    expect(isLeadOutcomeEvent(undefined)).toBe(false);
  });
});

describe('buyer currency is validated on reception', () => {
  const HOUR = 60 * 60 * 1000;

  function setup() {
    const prisma = {
      click: {
        findUnique: jest.fn().mockResolvedValue({
          clickId: 'c1',
          campaignId: 'camp-1',
          createdAt: new Date(Date.now() - HOUR),
          fbclid: null,
          isTest: false,
          campaign: { attributionWindowHours: null, maxConversionsPerClick: null },
        }),
      },
      conversion: {
        findUnique: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'conv-1' }),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(async ({ data }) => ({ id: 'conv-1', ...data })),
      },
    };
    const service = new ConversionsService(
      prisma as never,
      { processConversion: jest.fn().mockResolvedValue(undefined) } as never,
      { get: jest.fn().mockReturnValue(undefined) } as never,
      { getEffective: jest.fn().mockResolvedValue({ baseCurrency: 'EUR', fxRates: '', testMode: false }) } as never,
    );
    return { service, prisma };
  }

  it.each([
    ['{CURRENCY}', null],
    ['eur', 'EUR'],
    [' usd ', 'USD'],
    ['EURO', null],
  ])('stores currency %j as %j', async (sent, stored) => {
    const { service, prisma } = setup();
    await service.create({ clickId: 'c1', eventType: 'lead_sold', revenue: 14.5, currency: sent } as never);
    expect(prisma.conversion.create.mock.calls[0][0].data.currency).toBe(stored);
  });
});

describe('machine API row currency without a sale', () => {
  it('falls back to the ad spend currency, like the overall value', async () => {
    const prisma = {
      adSpendSnapshot: {
        groupBy: jest
          .fn()
          .mockResolvedValueOnce([{ externalAdId: '111', externalAdsetId: null, currency: 'EUR', _sum: { spend: 10 } }])
          .mockResolvedValueOnce([]),
      },
      clickHourlyCount: { findMany: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValueOnce([
        { ad_id: '111', clicks: 5, leads: 0, leads_sold: 0, leads_returned: 0, leads_rejected: 0, leads_pending_outcome: 0, bids_sum: 0, bid_currencies: null },
      ]),
      $executeRaw: jest.fn(),
    };
    const service = new MachineApiService(prisma as never, { getEffective: jest.fn() } as never);
    const result = await service.factsForAds({ meta_ad_ids: '111', from: '2026-08-01T00:00:00Z', to: '2026-08-08T00:00:00Z' });
    expect(result.bids_currency).toBe('EUR');
    expect(result.rows[0].bids_currency).toBe('EUR');
  });
});

describe('postback caller IP', () => {
  function context(forwarded: string | undefined, ip = '10.0.0.9') {
    const controller = new ConversionsController({} as never, {} as never);
    const req = {
      headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded },
      ip,
      query: {},
      protocol: 'https',
      originalUrl: '/postback?cid=c1',
      get: () => 'track.example.com',
    };
    return (controller as unknown as { buildContext(r: unknown): { incomingPostbackIp?: string } }).buildContext(req);
  }

  it('uses the address nginx appended, never the one the client wrote first', () => {
    expect(context('1.2.3.4, 203.0.113.7').incomingPostbackIp).toBe('203.0.113.7');
    expect(context('203.0.113.7').incomingPostbackIp).toBe('203.0.113.7');
    expect(context(undefined).incomingPostbackIp).toBe('10.0.0.9');
  });
});

describe('pre-production hardening', () => {
  it('never stores the postback secret in the incoming URL', () => {
    expect(maskUrlSecrets('https://t.example.com/postback?cid=c1&secret=s3cret&et=lead_sold')).toBe(
      'https://t.example.com/postback?cid=c1&secret=***&et=lead_sold',
    );
    expect(maskUrlSecrets('https://t.example.com/postback?SECRET=a&token=b#x')).toBe(
      'https://t.example.com/postback?SECRET=***&token=***#x',
    );
  });

  it('checks the campaign secret when the postback names the click by tracking_id only', async () => {
    const click = { clickId: 'c1', campaign: { postbackConfig: { postbackSecret: 's3cret' } } };
    const prisma = {
      click: { findUnique: jest.fn().mockResolvedValue(click), findFirst: jest.fn().mockResolvedValue(click) },
      conversion: { findUnique: jest.fn(), count: jest.fn(), create: jest.fn() },
    };
    const service = new ConversionsService(
      prisma as never,
      { processConversion: jest.fn() } as never,
      { get: jest.fn().mockReturnValue(undefined) } as never,
      { getEffective: jest.fn() } as never,
    );
    const create = jest.spyOn(service, 'create');
    await expect(service.triggerByClickId('', { tracking_id: 'T1', et: 'lead', payout: '500' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(create).not.toHaveBeenCalled();
  });
});
