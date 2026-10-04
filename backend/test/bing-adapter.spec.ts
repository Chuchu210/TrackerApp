import AdmZip from 'adm-zip';
import { of } from 'rxjs';
import {
  BingSyncAdapter,
  parseCsv,
  sanitizeBingCredentialsForResponse,
} from '../src/platform-sync/adapters/bing.adapter';
import { sumByTrackerCampaign } from '../src/platform-sync/platform-sync.service';

type Call = { method: 'post' | 'get'; url: string; body?: unknown; config?: { headers?: Record<string, string> } };

function zipOf(csv: string): Buffer {
  const zip = new AdmZip();
  zip.addFile('report.csv', Buffer.from(csv, 'utf8'));
  return zip.toBuffer();
}

/** Routes the adapter's calls: OAuth token, Submit, Poll (one response per poll), download. */
function makeHttp(opts: {
  token?: unknown;
  submit?: unknown;
  polls?: unknown[];
  csv?: string;
}) {
  const calls: Call[] = [];
  let poll = 0;
  const polls = opts.polls ?? [{ ReportRequestStatus: { Status: 'Success', ReportDownloadUrl: 'https://dl.example/r.zip' } }];
  const http = {
    post: (url: string, body: unknown, config: Call['config']) => {
      calls.push({ method: 'post', url, body, config });
      if (url.includes('login.microsoftonline.com')) {
        return of({ data: opts.token ?? { access_token: 'AT-1', refresh_token: 'RT-2', expires_in: 3600 } });
      }
      if (url.endsWith('/Submit')) return of({ data: opts.submit ?? { ReportRequestId: 'req-1' } });
      if (url.endsWith('/Poll')) return of({ data: polls[Math.min(poll++, polls.length - 1)] });
      throw new Error(`unexpected POST ${url}`);
    },
    get: (url: string, config: Call['config']) => {
      calls.push({ method: 'get', url, config });
      return of({ data: zipOf(opts.csv ?? '') });
    },
  };
  return { http, calls };
}

const CREDS = {
  developerToken: 'DEV',
  customerId: '254682648',
  clientId: 'client-1',
  refreshToken: 'RT-1',
};

const CSV = [
  '﻿"TimePeriod","AccountId","CampaignId","CampaignName","CurrencyCode","Impressions","Clicks","Spend"',
  '"2026-10-03|23","188285470","488617815","WD LA - Search, Test 150","USD","12","3","4.65"',
  '"2026-10-04|0","188285470","488617815","WD LA - Search, Test 150","USD","20","4","6.95"',
  // Outside the requested window (the request starts one day early): dropped.
  '"2026-10-01|5","188285470","488617815","WD LA - Search, Test 150","USD","9","1","1.10"',
  '',
].join('\r\n');

describe('BingSyncAdapter.fetchMetrics', () => {
  const from = new Date('2026-10-02T10:00:00.000Z');
  const to = new Date('2026-10-04T18:00:00.000Z');

  it('refreshes the token, submits an hourly UTC report and maps the rows', async () => {
    const { http, calls } = makeHttp({
      csv: CSV,
      polls: [
        { ReportRequestStatus: { Status: 'Pending' } },
        { ReportRequestStatus: { Status: 'Success', ReportDownloadUrl: 'https://dl.example/r.zip' } },
      ],
    });
    const adapter = new BingSyncAdapter(http as never, { pollIntervalMs: 0 });

    const rows = await adapter.fetchMetrics(CREDS, '188285470', from, to);

    expect(rows).toEqual([
      {
        externalCampaignId: '488617815',
        date: new Date('2026-10-03T00:00:00.000Z'),
        hour: 23,
        impressions: 12,
        clicks: 3,
        spend: 4.65,
        currency: 'USD',
      },
      {
        externalCampaignId: '488617815',
        date: new Date('2026-10-04T00:00:00.000Z'),
        hour: 0,
        impressions: 20,
        clicks: 4,
        spend: 6.95,
        currency: 'USD',
      },
    ]);

    const token = calls.find((c) => c.url.includes('login.microsoftonline.com'))!;
    expect(token.url).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/token');
    expect(String(token.body)).toContain('grant_type=refresh_token');
    expect(String(token.body)).toContain('refresh_token=RT-1');

    const submit = calls.find((c) => c.url.endsWith('/Submit'))!;
    expect(submit.url).toBe('https://reporting.api.bingads.microsoft.com/Reporting/v13/GenerateReport/Submit');
    expect(submit.config?.headers).toMatchObject({
      Authorization: 'Bearer AT-1',
      DeveloperToken: 'DEV',
      CustomerId: '254682648',
      CustomerAccountId: '188285470',
    });
    const request = (submit.body as { ReportRequest: Record<string, unknown> }).ReportRequest;
    expect(request.Type).toBe('CampaignPerformanceReportRequest');
    expect(request.Aggregation).toBe('Hourly');
    expect(request.FormatVersion).toBe('2.0');
    expect(request.Scope).toEqual({ AccountIds: [188285470] });
    expect(request.Time).toMatchObject({
      CustomDateRangeStart: { Day: 1, Month: 10, Year: 2026 },
      CustomDateRangeEnd: { Day: 4, Month: 10, Year: 2026 },
    });

    expect(calls.filter((c) => c.url.endsWith('/Poll'))).toHaveLength(2);
    expect(calls.find((c) => c.method === 'get')!.url).toBe('https://dl.example/r.zip');
  });

  it('reuses a stored access token that is still valid', async () => {
    const { http, calls } = makeHttp({ csv: CSV });
    const adapter = new BingSyncAdapter(http as never, { pollIntervalMs: 0 });
    const valid = {
      ...CREDS,
      accessToken: 'AT-stored',
      accessTokenExpiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };

    await adapter.fetchMetrics(valid, '188285470', from, to);

    expect(calls.some((c) => c.url.includes('login.microsoftonline.com'))).toBe(false);
    expect(calls.find((c) => c.url.endsWith('/Submit'))!.config?.headers?.Authorization).toBe('Bearer AT-stored');
  });

  it('returns no rows when the report succeeds without a download URL', async () => {
    const { http } = makeHttp({ polls: [{ ReportRequestStatus: { Status: 'Success', ReportDownloadUrl: null } }] });
    const adapter = new BingSyncAdapter(http as never, { pollIntervalMs: 0 });
    await expect(adapter.fetchMetrics(CREDS, '188285470', from, to)).resolves.toEqual([]);
  });

  it('throws with the API message when Submit is rejected', async () => {
    const { http } = makeHttp({ submit: { OperationErrors: [{ Message: 'Invalid developer token' }] } });
    const adapter = new BingSyncAdapter(http as never, { pollIntervalMs: 0 });
    await expect(adapter.fetchMetrics(CREDS, '188285470', from, to)).rejects.toThrow('Invalid developer token');
  });

  it('throws when the report ends in Error, and when it never completes', async () => {
    const failed = new BingSyncAdapter(makeHttp({ polls: [{ ReportRequestStatus: { Status: 'Error' } }] }).http as never, {
      pollIntervalMs: 0,
    });
    await expect(failed.fetchMetrics(CREDS, '188285470', from, to)).rejects.toThrow('status Error');

    const stuck = new BingSyncAdapter(makeHttp({ polls: [{ ReportRequestStatus: { Status: 'Pending' } }] }).http as never, {
      pollIntervalMs: 0,
      maxPolls: 3,
    });
    await expect(stuck.fetchMetrics(CREDS, '188285470', from, to)).rejects.toThrow('not ready after 3 polls');
  });

  it('returns nothing without an account id', async () => {
    const { http, calls } = makeHttp({});
    const adapter = new BingSyncAdapter(http as never, { pollIntervalMs: 0 });
    await expect(adapter.fetchMetrics(CREDS, null, from, to)).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe('BingSyncAdapter.refreshCredentials', () => {
  it('returns null while the stored access token is valid', async () => {
    const adapter = new BingSyncAdapter(makeHttp({}).http as never);
    const valid = { ...CREDS, accessToken: 'AT', accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString() };
    await expect(adapter.refreshCredentials(valid, '188285470')).resolves.toBeNull();
  });

  it('returns the rotated refresh token and a new access token when expired', async () => {
    const adapter = new BingSyncAdapter(makeHttp({}).http as never);
    const out = await adapter.refreshCredentials({ ...CREDS, extra: 'kept' }, '188285470');
    expect(out).toMatchObject({ refreshToken: 'RT-2', accessToken: 'AT-1', extra: 'kept', developerToken: 'DEV' });
    expect(Date.parse(String(out!.accessTokenExpiresAt))).toBeGreaterThan(Date.now());
  });

  it('keeps the old refresh token when Microsoft does not send a new one', async () => {
    const adapter = new BingSyncAdapter(makeHttp({ token: { access_token: 'AT-9', expires_in: 3600 } }).http as never);
    const out = await adapter.refreshCredentials(CREDS, '188285470');
    expect(out).toMatchObject({ refreshToken: 'RT-1', accessToken: 'AT-9' });
  });
});

describe('Bing helpers', () => {
  it('masks secrets but keeps ids readable', () => {
    const out = sanitizeBingCredentialsForResponse({ ...CREDS, clientSecret: 's', accessToken: 'a' });
    expect(out).toMatchObject({
      developerToken: '••••••••',
      refreshToken: '••••••••',
      clientSecret: '••••••••',
      accessToken: '••••••••',
      customerId: '254682648',
      clientId: 'client-1',
    });
  });

  it('parses quoted CSV with commas, doubled quotes and CRLF', () => {
    expect(parseCsv('"a","b, c","say ""hi"""\r\n"1","2","3"\r\n\r\n')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', '2', '3'],
    ]);
  });
});

describe('sumByTrackerCampaign', () => {
  it('adds up platform campaigns that map to the same tracker campaign and drops unmapped ones', () => {
    const date = new Date('2026-10-04T00:00:00.000Z');
    const row = (externalCampaignId: string, spend: number, hour?: number) => ({
      externalCampaignId,
      date,
      ...(hour !== undefined ? { hour } : {}),
      impressions: 10,
      clicks: 2,
      spend,
      currency: 'USD',
    });
    const map = new Map([
      ['A', 'trk-1'],
      ['B', 'trk-1'],
    ]);

    const out = sumByTrackerCampaign([row('A', 5, 7), row('B', 3, 7), row('A', 1, 8), row('Z', 99, 7)], map);

    expect(out).toEqual([
      { campaignId: 'trk-1', row: { ...row('A', 8, 7), impressions: 20, clicks: 4 } },
      { campaignId: 'trk-1', row: row('A', 1, 8) },
    ]);
  });
});
