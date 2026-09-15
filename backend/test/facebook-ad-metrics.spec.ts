import { of } from 'rxjs';
import { FacebookSyncAdapter } from '../src/platform-sync/adapters/facebook.adapter';

describe('FacebookSyncAdapter.fetchAdMetrics', () => {
  const from = new Date('2026-09-10T00:00:00Z');
  const to = new Date('2026-09-11T00:00:00Z');

  // Regression guard: Graph returns insights in pages, and the campaign-level
  // fetch only ever read the first one.
  it('reads every page of ad-level insights and keeps account currency', async () => {
    const get = jest
      .fn()
      .mockReturnValueOnce(
        of({
          data: {
            data: [
              {
                ad_id: '111',
                adset_id: '11',
                campaign_id: '1',
                impressions: '1000',
                clicks: '31',
                spend: '41.20',
                account_currency: 'USD',
                date_start: '2026-09-10',
              },
              { adset_id: '11', spend: '3.00', date_start: '2026-09-10' },
            ],
            paging: { next: 'https://graph.facebook.com/v21.0/act_1/insights?after=abc' },
          },
        }),
      )
      .mockReturnValueOnce(
        of({
          data: {
            data: [
              {
                ad_id: '112',
                adset_id: '11',
                campaign_id: '1',
                impressions: '500',
                clicks: '12',
                spend: '8.5',
                account_currency: 'USD',
                date_start: '2026-09-10',
              },
            ],
          },
        }),
      );
    const adapter = new FacebookSyncAdapter({ get } as never);

    const rows = await adapter.fetchAdMetrics({ accessToken: 'token' }, 'act_1', from, to);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      externalAdId: '111',
      externalAdsetId: '11',
      externalCampaignId: '1',
      date: new Date('2026-09-10'),
      impressions: 1000,
      clicks: 31,
      spend: 41.2,
      currency: 'USD',
    });
    expect(rows[1].externalAdId).toBe('112');
    expect(get.mock.calls[0][1].params).toMatchObject({ level: 'ad', limit: 500, time_increment: 1 });
    expect(get.mock.calls[1]).toEqual(['https://graph.facebook.com/v21.0/act_1/insights?after=abc', undefined]);
  });

  it('returns nothing without a token or an ad account', async () => {
    const get = jest.fn();
    const adapter = new FacebookSyncAdapter({ get } as never);
    expect(await adapter.fetchAdMetrics({}, 'act_1', from, to)).toEqual([]);
    expect(await adapter.fetchAdMetrics({ accessToken: 'token' }, null, from, to)).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });
});
