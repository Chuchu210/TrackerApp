import { of } from 'rxjs';
import { OpenAiSyncAdapter } from '../src/platform-sync/adapters/openai.adapter';

type GetCall = { url: string; config: { headers: Record<string, string> } };

function makeHttp(pages: unknown[]) {
  const calls: GetCall[] = [];
  let page = 0;
  const http = {
    get: (url: string, config: GetCall['config']) => {
      calls.push({ url, config });
      const body = pages[Math.min(page, pages.length - 1)];
      page++;
      return of({ data: body });
    },
  };
  return { http, calls };
}

describe('OpenAiSyncAdapter.fetchMetrics', () => {
  const from = new Date('2026-04-25T00:00:00.000Z');
  const to = new Date('2026-04-26T00:00:00.000Z');

  it('maps Insights rows to SpendMetricRow', async () => {
    const { http, calls } = makeHttp([
      {
        data: [
          {
            readable_time: '2026-04-25',
            campaign_id: 'cmpn_101',
            campaign_name: 'Spring launch',
            impressions: 1200,
            clicks: 36,
            spend: 18.42,
          },
        ],
        has_more: false,
      },
    ]);

    const adapter = new OpenAiSyncAdapter(http as never);
    const rows = await adapter.fetchMetrics({ apiKey: 'sk-test' }, null, from, to);

    expect(rows).toEqual([
      {
        externalCampaignId: 'cmpn_101',
        date: new Date('2026-04-25T00:00:00.000Z'),
        impressions: 1200,
        clicks: 36,
        spend: 18.42,
        currency: 'USD',
      },
    ]);
    expect(calls[0].config.headers.Authorization).toBe('Bearer sk-test');
    const url = calls[0].url;
    expect(url).toContain('aggregation_level=campaign');
    expect(url).toContain('time_granularity=daily');
    // Array params must stay `fields[]`, not axios's `fields[][]`.
    expect(url).toContain('fields%5B%5D=campaign.spend');
    expect(url).not.toContain('fields%5B%5D%5B%5D');
  });

  it('returns nothing without an API key rather than calling the API', async () => {
    const { http, calls } = makeHttp([{ data: [] }]);
    const adapter = new OpenAiSyncAdapter(http as never);
    await expect(adapter.fetchMetrics({}, null, from, to)).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('follows the cursor while has_more is set', async () => {
    const { http, calls } = makeHttp([
      {
        data: [{ readable_time: '2026-04-25', campaign_id: 'a', impressions: 1, clicks: 1, spend: 1 }],
        has_more: true,
        last_id: 'cursor-1',
      },
      {
        data: [{ readable_time: '2026-04-26', campaign_id: 'b', impressions: 2, clicks: 2, spend: 2 }],
        has_more: false,
      },
    ]);

    const adapter = new OpenAiSyncAdapter(http as never);
    const rows = await adapter.fetchMetrics({ apiKey: 'sk-test' }, null, from, to);

    expect(rows.map((r) => r.externalCampaignId)).toEqual(['a', 'b']);
    expect(calls[1].url).toContain('after=cursor-1');
  });

  it('stops paginating when the cursor stops advancing', async () => {
    const { http, calls } = makeHttp([
      {
        data: [{ readable_time: '2026-04-25', campaign_id: 'a', impressions: 1, clicks: 1, spend: 1 }],
        has_more: true,
        last_id: 'stuck',
      },
    ]);

    const adapter = new OpenAiSyncAdapter(http as never);
    await adapter.fetchMetrics({ apiKey: 'sk-test' }, null, from, to);

    // First page, then one more that returns the same cursor, then it bails.
    expect(calls.length).toBeLessThanOrEqual(2);
  });

  it('skips rows without a campaign id or usable date', async () => {
    const { http } = makeHttp([
      {
        data: [
          { campaign_id: 'ok', start_time: 1777075200, impressions: 5, clicks: 1, spend: 3 },
          { impressions: 9, clicks: 9, spend: 9 },
        ],
        has_more: false,
      },
    ]);

    const adapter = new OpenAiSyncAdapter(http as never);
    const rows = await adapter.fetchMetrics({ apiKey: 'sk-test' }, null, from, to);

    expect(rows).toHaveLength(1);
    expect(rows[0].externalCampaignId).toBe('ok');
    expect(rows[0].date).toEqual(new Date(1777075200 * 1000));
  });

  it('honours a configured account currency', async () => {
    const { http } = makeHttp([
      {
        data: [{ readable_time: '2026-04-25', campaign_id: 'a', impressions: 1, clicks: 1, spend: 1 }],
        has_more: false,
      },
    ]);

    const adapter = new OpenAiSyncAdapter(http as never);
    const rows = await adapter.fetchMetrics(
      { apiKey: 'sk-test', currency: 'eur' },
      null,
      from,
      to,
    );

    expect(rows[0].currency).toBe('EUR');
  });
});

describe('OpenAiSyncAdapter time range', () => {
  it('aligns both bounds to a full hour, as the API demands', async () => {
    const calls: { url: string }[] = [];
    const http = {
      get: (url: string) => {
        calls.push({ url });
        return of({ data: { data: [], has_more: false } });
      },
    };
    const adapter = new OpenAiSyncAdapter(http as never);
    // Deliberately ragged bounds: 13:37:29 and 21:04:11.
    await adapter.fetchMetrics(
      { apiKey: 'sk-test' },
      null,
      new Date('2026-09-01T13:37:29.000Z'),
      new Date('2026-09-04T21:04:11.000Z'),
    );

    const range = JSON.parse(
      decodeURIComponent(calls[0].url.split('time_ranges%5B%5D=')[1].split('&')[0]),
    );
    expect(Number(range.start) % 3600).toBe(0);
    expect(Number(range.end) % 3600).toBe(0);
  });
});
