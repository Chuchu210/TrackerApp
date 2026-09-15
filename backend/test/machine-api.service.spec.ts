import { BadRequestException } from '@nestjs/common';
import { MachineApiService } from '../src/machine-api/machine-api.service';

describe('MachineApiService', () => {
  function setup() {
    const prisma = {
      adSpendSnapshot: { groupBy: jest.fn() },
      clickHourlyCount: { findMany: jest.fn() },
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn(),
    };
    const settings = { getEffective: jest.fn().mockResolvedValue({ baseCurrency: 'EUR' }) };
    return { prisma, service: new MachineApiService(prisma as never, settings as never) };
  }

  describe('factsForAds', () => {
    const window = { from: '2026-08-01T00:00:00Z', to: '2026-08-08T00:00:00Z' };

    it('joins ad spend, adset totals and buyer outcomes per requested ad', async () => {
      const { prisma, service } = setup();
      prisma.adSpendSnapshot.groupBy
        .mockResolvedValueOnce([
          { externalAdId: '111', externalAdsetId: '11', currency: 'EUR', _sum: { spend: 41.2 } },
        ])
        .mockResolvedValueOnce([
          { externalAdsetId: '11', externalAdId: '111', _sum: { spend: 41.2 } },
          { externalAdsetId: '11', externalAdId: '112', _sum: { spend: 246.2 } },
          { externalAdsetId: '11', externalAdId: '113', _sum: { spend: 0 } },
        ]);
      prisma.$queryRaw.mockResolvedValueOnce([
        {
          ad_id: '111',
          clicks: 318,
          leads: 6,
          leads_sold: 4,
          leads_returned: 0,
          leads_rejected: 1,
          leads_pending_outcome: 1,
          bids_sum: 52,
          bid_currencies: ['EUR'],
        },
      ]);

      const result = await service.factsForAds({ meta_ad_ids: '111, 999,111', ...window });

      expect(result.attribution_closed).toBe(true);
      expect(result.rows).toEqual([
        {
          meta_ad_id: '111',
          meta_adset_id: '11',
          spend: 41.2,
          spend_currency: 'EUR',
          adset_spend: 287.4,
          n_ads_active_adset: 2,
          clicks: 318,
          leads: 6,
          leads_sold: 4,
          leads_returned: 0,
          leads_rejected: 1,
          leads_pending_outcome: 1,
          bids_sum: 52,
          bids_currency: 'EUR',
        },
        {
          meta_ad_id: '999',
          meta_adset_id: null,
          spend: 0,
          spend_currency: null,
          adset_spend: null,
          n_ads_active_adset: null,
          clicks: 0,
          leads: 0,
          leads_sold: 0,
          leads_returned: 0,
          leads_rejected: 0,
          leads_pending_outcome: 0,
          bids_sum: 0,
          bids_currency: null,
        },
      ]);
    });

    it('keeps the window open while buyers may still answer', async () => {
      const { prisma, service } = setup();
      prisma.adSpendSnapshot.groupBy.mockResolvedValue([]);
      prisma.$queryRaw.mockResolvedValue([]);
      const to = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const from = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();

      const result = await service.factsForAds({ meta_ad_ids: '111', from, to, latency_hours: '72' });

      expect(result.attribution_closed).toBe(false);
    });

    it.each([
      [{ ...window }, 'missing ids'],
      [{ ...window, meta_ad_ids: 'abc' }, 'non-numeric id'],
      [{ ...window, meta_ad_ids: Array.from({ length: 201 }, (_, i) => String(i + 1)).join(',') }, 'too many ids'],
      [{ meta_ad_ids: '111', from: window.to, to: window.from }, 'reversed window'],
      [{ meta_ad_ids: '111', from: '2026-01-01T00:00:00Z', to: '2026-08-01T00:00:00Z' }, 'window too long'],
      [{ ...window, meta_ad_ids: '111', latency_hours: '-1' }, 'bad latency'],
    ])('rejects %j (%s) without querying', async (query, _label) => {
      const { prisma, service } = setup();
      await expect(service.factsForAds(query as never)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('realizedValue', () => {
    it('derives acceptance and value per settled lead from the cohort counts', async () => {
      const { prisma, service } = setup();
      prisma.$queryRaw.mockResolvedValueOnce([
        { leads_settled: 412, sold_kept: 301, returned: 0, rejected: 111, no_outcome: 0, bids_sum: 4366, bid_currencies: ['EUR'] },
      ]);

      const result = await service.realizedValue('offer-1', { days: '7', latency_hours: '72' });

      expect(result.acceptance).toBeCloseTo(0.7306, 4);
      expect(result.value_per_lead).toBe(10.6);
      expect(result.currency).toBe('EUR');
    });

    it('returns no ratios for an empty cohort instead of dividing by zero', async () => {
      const { prisma, service } = setup();
      prisma.$queryRaw.mockResolvedValueOnce([
        { leads_settled: 0, sold_kept: 0, returned: 0, rejected: 0, no_outcome: 0, bids_sum: 0 },
      ]);

      const result = await service.realizedValue('offer-1', {});

      expect(result.acceptance).toBeNull();
      expect(result.value_per_lead).toBeNull();
    });

    it('rejects out-of-range days', async () => {
      const { service } = setup();
      await expect(service.realizedValue('offer-1', { days: '0' })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('trafficHourly / refreshHourlyCounts', () => {
    it('reads the aggregate table, capped at 60 days', async () => {
      const { prisma, service } = setup();
      prisma.clickHourlyCount.findMany.mockResolvedValueOnce([
        { hour: new Date('2026-09-12T08:00:00Z'), clicks: 40 },
      ]);

      const result = await service.trafficHourly({ days: '28' });

      expect(result.rows).toEqual([{ hour: '2026-09-12T08:00:00.000Z', clicks: 40 }]);
      await expect(service.trafficHourly({ days: '90' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('never throws out of the scheduled refresh', async () => {
      const { prisma, service } = setup();
      prisma.$executeRaw.mockRejectedValueOnce(new Error('db down'));
      await expect(service.refreshHourlyCounts()).resolves.toBeUndefined();
    });
  });
});
