import { ForbiddenException } from '@nestjs/common';
import { MachineApiService } from '../src/machine-api/machine-api.service';
import { ConversionsService } from '../src/conversions/conversions.service';
import { buildLeadOutcomeUrls } from '../src/shared/tracking/lead-outcome-events';
import { describeError } from '../src/common/utils/describe-error';

describe('machine API — currencies, bounds and parameters', () => {
  const window = { from: '2026-08-01T00:00:00Z', to: '2026-08-08T00:00:00Z' };

  function machine(outcomes: unknown[], spend: unknown[] = []) {
    const prisma = {
      adSpendSnapshot: { groupBy: jest.fn().mockResolvedValueOnce(spend).mockResolvedValueOnce([]) },
      clickHourlyCount: { findMany: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValueOnce(outcomes),
      $executeRaw: jest.fn(),
    };
    return { prisma, service: new MachineApiService(prisma as never, { getEffective: jest.fn() } as never) };
  }

  const outcome = (adId: string, bids: number, currencies: string[] | null) => ({
    ad_id: adId,
    clicks: 10,
    leads: 2,
    leads_sold: 1,
    leads_returned: 0,
    leads_rejected: 0,
    leads_pending_outcome: 1,
    bids_sum: bids,
    bid_currencies: currencies,
  });
  const eurSpend = [{ externalAdId: '111', externalAdsetId: null, currency: 'EUR', _sum: { spend: 10 } }];

  it('accepts repeated meta_ad_ids parameters instead of failing with a 500', async () => {
    const { service } = machine([]);
    const result = await service.factsForAds({ ...window, meta_ad_ids: ['111', '222'] } as never);
    expect(result.rows.map((r) => r.meta_ad_id)).toEqual(['111', '222']);
  });

  it('labels bids with the currency the buyer sent, never the base currency setting', async () => {
    const { service } = machine([outcome('111', 30, ['USD'])], eurSpend);
    const result = await service.factsForAds({ ...window, meta_ad_ids: '111' });
    expect(result.bids_currency).toBe('USD');
    expect(result.rows[0].bids_currency).toBe('USD');
    expect(result.rows[0].bids_sum).toBe(30);
  });

  it('never sums bids received in several currencies', async () => {
    const { service } = machine([outcome('111', 30, ['EUR', 'USD'])], eurSpend);
    const result = await service.factsForAds({ ...window, meta_ad_ids: '111' });
    expect(result.bids_currency).toBeNull();
    expect(result.rows[0].bids_sum).toBeNull();
  });

  it('uses the single spend currency when nothing was sold', async () => {
    const { service } = machine([outcome('111', 0, null)], eurSpend);
    const result = await service.factsForAds({ ...window, meta_ad_ids: '111' });
    expect(result.bids_currency).toBe('EUR');
  });

  it('bounds the clicks read by realizedValue and reports mixed currencies without a value', async () => {
    const { prisma, service } = machine([
      { leads_settled: 10, sold_kept: 5, returned: 0, rejected: 5, no_outcome: 0, bids_sum: 50, bid_currencies: ['EUR', 'USD'] },
    ]);
    const result = await service.realizedValue('offer-1', { days: '7' });
    expect(result.currency).toBeNull();
    expect(result.bids_sum).toBeNull();
    expect(result.value_per_lead).toBeNull();
    const sql = (prisma.$queryRaw.mock.calls[0][0] as readonly string[]).join('?');
    expect(sql).toContain('AND c.created_at >= now() - make_interval');
  });
});

describe('buyer outcome postbacks need authentication', () => {
  function conversions(secret: string | null) {
    const prisma = {
      click: {
        findUnique: jest.fn().mockResolvedValue({ campaign: { postbackConfig: secret ? { postbackSecret: secret } : null } }),
      },
      conversion: { findUnique: jest.fn(), count: jest.fn(), create: jest.fn() },
    };
    const config = { get: jest.fn().mockReturnValue(undefined) };
    const settings = { getEffective: jest.fn().mockResolvedValue({ baseCurrency: 'EUR', fxRates: '', testMode: false }) };
    const service = new ConversionsService(
      prisma as never,
      { processConversion: jest.fn() } as never,
      config as never,
      settings as never,
    );
    return { service, prisma };
  }

  it('refuses lead_sold on a campaign with neither a secret nor an IP allowlist', async () => {
    const { service, prisma } = conversions(null);
    await expect(service.triggerByClickId('c1', { et: 'lead_sold', payout: '99999' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.conversion.create).not.toHaveBeenCalled();
  });

  it('keeps the landing-page lead open on such a campaign', async () => {
    const { service } = conversions(null);
    const create = jest.spyOn(service, 'create').mockResolvedValue({ skipped: true } as never);
    await service.triggerByClickId('c1', { et: 'lead' });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'lead' }), undefined);
  });

  it('accepts lead_sold carrying the campaign secret', async () => {
    const { service } = conversions('s3cret');
    const create = jest.spyOn(service, 'create').mockResolvedValue({ skipped: true } as never);
    await service.triggerByClickId('c1', { et: 'lead_sold', secret: 's3cret' });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'lead_sold' }), undefined);
  });

  it('puts the campaign secret, URL-encoded, in the buyer outcome templates', () => {
    const urls = buildLeadOutcomeUrls('https://t.example', 'a b&c');
    expect(urls.sold).toContain('?cid={click_id}&secret=a%20b%26c&et=lead_sold');
    expect(buildLeadOutcomeUrls('https://t.example').rejected).toContain('&secret={postback_secret}&');
  });
});

describe('describeError', () => {
  it('never returns the Meta token carried by an Axios error', () => {
    const token = 'EAABsecretTOKENvalue1234567890abcdef';
    const err = Object.assign(new Error('Request failed with status code 400'), {
      config: {
        params: { access_token: token },
        url: `https://graph.facebook.com/v21.0/act_1/insights?access_token=${token}`,
      },
      response: { status: 400, data: { error: { message: `Invalid OAuth access token ${token}` } } },
    });
    const text = describeError(err);
    expect(text).toContain('HTTP 400');
    expect(text).not.toContain(token);
  });

  it('describes plain strings and unknown values', () => {
    expect(describeError('boom access_token=abc')).toBe('boom access_token=***');
    expect(describeError(undefined)).toBe('unknown error');
  });
});
