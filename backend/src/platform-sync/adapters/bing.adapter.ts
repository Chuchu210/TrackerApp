import { HttpService } from '@nestjs/axios';
import { AdPlatform } from '@prisma/client';
import AdmZip from 'adm-zip';
import { firstValueFrom } from 'rxjs';
import type { PlatformSyncAdapter, SpendMetricRow } from '../interfaces/platform-sync.adapter';

const REPORTING_API = 'https://reporting.api.bingads.microsoft.com/Reporting/v13/GenerateReport';
const OAUTH_SCOPE = 'https://ads.microsoft.com/msads.manage offline_access';

/** An access token is reused until this close to its expiry. */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

type BingCredentials = {
  developerToken: string;
  customerId: string;
  accountId: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  tenant: string;
  /** IANA zone of the Microsoft Ads account: report hours come back in it (e.g. Europe/Paris). */
  timeZone: string;
  accessToken: string;
  accessTokenExpiresAt: number;
};

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number };
type SubmitResponse = { ReportRequestId?: string; OperationErrors?: { Message?: string }[] };
type PollResponse = {
  ReportRequestStatus?: { Status?: string; ReportDownloadUrl?: string | null };
  OperationErrors?: { Message?: string }[];
};

export type BingAdapterOptions = {
  /** Wait between two polls of a queued report. */
  pollIntervalMs?: number;
  /** Polls before giving up on a report that never completes. */
  maxPolls?: number;
};

function parseCredentials(raw: Record<string, unknown>, accountId: string | null): BingCredentials {
  const str = (v: unknown) => String(v ?? '').trim();
  return {
    developerToken: str(raw.developerToken),
    customerId: str(raw.customerId),
    accountId: str(accountId || raw.accountId),
    clientId: str(raw.clientId),
    clientSecret: str(raw.clientSecret),
    refreshToken: str(raw.refreshToken),
    tenant: str(raw.tenant) || 'common',
    timeZone: str(raw.timeZone) || 'UTC',
    accessToken: str(raw.accessToken),
    accessTokenExpiresAt: Date.parse(str(raw.accessTokenExpiresAt)) || 0,
  };
}

/** Secrets never leave the API in clear; only the ids stay readable. */
export function sanitizeBingCredentialsForResponse(
  creds: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...creds };
  for (const key of ['developerToken', 'clientSecret', 'refreshToken', 'accessToken']) {
    if (out[key]) out[key] = '••••••••';
  }
  return out;
}

/** RFC 4180 CSV: quoted fields, doubled quotes, commas inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/** Minutes to add to UTC to get the wall-clock time in `timeZone` at that instant. */
function tzOffsetMinutes(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return (Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute')) - utcMs) / 60000;
}

/** Wall-clock day + hour in `timeZone` -> the UTC instant (DST-aware). */
export function localHourToUtc(day: string, hour: number, timeZone: string): Date | null {
  const [y, m, d] = day.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hour);
  if (Number.isNaN(guess)) return null;
  let utc = guess - tzOffsetMinutes(guess, timeZone) * 60000;
  utc = guess - tzOffsetMinutes(utc, timeZone) * 60000;
  return new Date(utc);
}

/**
 * "2026-10-04|7" (Hourly, FormatVersion 2.0) or "2026-10-04" (Daily).
 * The docs say report hours are UTC, but they come back in the account's time zone: on 04/10/2026 the
 * tracker's own Bing clicks (7am-10pm PT) matched report hours 16-23 and 0-7 of a Paris-time account.
 * They are converted to the UTC day and hour the tracker reports in.
 */
function parseTimePeriod(value: string, timeZone: string): { date: Date; hour?: number } | null {
  const [day, hourPart] = value.split('|');
  const date = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (hourPart === undefined) return { date };
  const hour = Number(hourPart);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return { date };
  const utc = localHourToUtc(day, hour, timeZone);
  if (!utc) return null;
  return { date: utcDay(utc), hour: utc.getUTCHours() };
}

function toNumber(value: string | undefined): number {
  const n = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function reportDate(date: Date) {
  return { Day: date.getUTCDate(), Month: date.getUTCMonth() + 1, Year: date.getUTCFullYear() };
}

function apiErrors(body: { OperationErrors?: { Message?: string }[] } | undefined): string | null {
  const errors = body?.OperationErrors?.map((e) => e.Message).filter(Boolean) ?? [];
  return errors.length ? errors.join('; ') : null;
}

/**
 * Microsoft Advertising (Bing) spend, from the Reporting API v13 (REST).
 * https://learn.microsoft.com/en-us/advertising/reporting-service/pollgeneratereport
 *
 * Credentials (platform_connections.credentials):
 *   developerToken, customerId, clientId, refreshToken, optional clientSecret and tenant.
 * The connection's accountId is the Microsoft Ads account id (the "aid" in the UI URL).
 *
 * Auth is OAuth with a refresh token. Microsoft rotates refresh tokens, so the
 * fresh pair is handed back through refreshCredentials and stored by the service.
 *
 * The report is hourly: Microsoft reports hours in UTC, so each row lands on
 * the right tracker day and hour whatever the account's time zone.
 */
export class BingSyncAdapter implements PlatformSyncAdapter {
  platform = AdPlatform.bing;

  private readonly pollIntervalMs: number;
  private readonly maxPolls: number;

  constructor(
    private readonly http: HttpService,
    options: BingAdapterOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 2000;
    this.maxPolls = options.maxPolls ?? 60;
  }

  async testConnection(credentials: Record<string, unknown>, accountId: string | null): Promise<boolean> {
    const creds = parseCredentials(credentials, accountId);
    if (!creds.developerToken || !creds.customerId || !creds.accountId) return false;
    try {
      await this.ensureAccessToken(creds);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns credentials with a valid access token (and the rotated refresh
   * token) when a refresh was needed, or null when the stored token is still good.
   */
  async refreshCredentials(
    credentials: Record<string, unknown>,
    accountId: string | null,
  ): Promise<Record<string, unknown> | null> {
    const creds = parseCredentials(credentials, accountId);
    if (creds.accessToken && creds.accessTokenExpiresAt - Date.now() > TOKEN_REFRESH_MARGIN_MS) {
      return null;
    }
    const token = await this.requestToken(creds);
    return {
      ...credentials,
      refreshToken: token.refreshToken,
      accessToken: token.accessToken,
      accessTokenExpiresAt: new Date(token.expiresAt).toISOString(),
    };
  }

  async fetchMetrics(
    credentials: Record<string, unknown>,
    accountId: string | null,
    from: Date,
    to: Date,
  ): Promise<SpendMetricRow[]> {
    const creds = parseCredentials(credentials, accountId);
    if (!creds.developerToken || !creds.customerId || !creds.accountId) return [];
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: creds.timeZone });
    } catch {
      throw new Error(`Bing credentials: unknown timeZone "${creds.timeZone}" (use an IANA zone such as Europe/Paris)`);
    }
    const accessToken = await this.ensureAccessToken(creds);
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      DeveloperToken: creds.developerToken,
      CustomerId: creds.customerId,
      CustomerAccountId: creds.accountId,
      'Content-Type': 'application/json',
    };

    const firstDay = utcDay(from);
    const lastDay = utcDay(to);
    // One extra day before the window: the custom range is read in the report
    // time zone, the rows come back in UTC, and rows outside the window are
    // dropped below.
    const requestStart = new Date(firstDay.getTime() - DAY_MS);
    // Report days are account-time days: a zone ahead of UTC (Paris) puts the last UTC hours on the next
    // local day, so ask one day more, but never past today in the account zone.
    const localToday = new Date(
      Date.now() + tzOffsetMinutes(Date.now(), creds.timeZone) * 60000,
    );
    const requestEnd = new Date(Math.min(lastDay.getTime() + DAY_MS, utcDay(localToday).getTime()));

    const { data: submitted } = await firstValueFrom(
      this.http.post<SubmitResponse>(
        `${REPORTING_API}/Submit`,
        {
          ReportRequest: {
            Type: 'CampaignPerformanceReportRequest',
            Format: 'Csv',
            FormatVersion: '2.0',
            ReportName: 'Tracker spend sync',
            ExcludeReportHeader: true,
            ExcludeReportFooter: true,
            ExcludeColumnHeaders: false,
            ReturnOnlyCompleteData: false,
            Aggregation: 'Hourly',
            Columns: [
              'TimePeriod',
              'AccountId',
              'CampaignId',
              'CampaignName',
              'CurrencyCode',
              'Impressions',
              'Clicks',
              'Spend',
            ],
            Scope: { AccountIds: [Number(creds.accountId)] },
            Time: {
              CustomDateRangeStart: reportDate(requestStart),
              CustomDateRangeEnd: reportDate(requestEnd),
              ReportTimeZone: 'GreenwichMeanTimeDublinEdinburghLisbonLondon',
            },
          },
        },
        { headers },
      ),
    );
    const submitError = apiErrors(submitted);
    if (submitError || !submitted?.ReportRequestId) {
      throw new Error(`Bing report submit failed: ${submitError || 'no ReportRequestId'}`);
    }

    const downloadUrl = await this.waitForReport(submitted.ReportRequestId, headers);
    // No download URL on success means the report has no rows for the period.
    if (!downloadUrl) return [];

    const { data: zipped } = await firstValueFrom(
      this.http.get<ArrayBuffer>(downloadUrl, { responseType: 'arraybuffer' }),
    );
    const entry = new AdmZip(Buffer.from(zipped)).getEntries()[0];
    if (!entry) return [];
    const csv = entry.getData().toString('utf8').replace(/^﻿/, '');

    return this.toRows(parseCsv(csv), firstDay, lastDay, creds.timeZone);
  }

  private toRows(table: string[][], firstDay: Date, lastDay: Date, timeZone: string): SpendMetricRow[] {
    const [header, ...body] = table;
    if (!header) return [];
    const col = (name: string) => header.findIndex((h) => h.trim() === name);
    const iTime = col('TimePeriod');
    const iCampaign = col('CampaignId');
    const iCurrency = col('CurrencyCode');
    const iImpressions = col('Impressions');
    const iClicks = col('Clicks');
    const iSpend = col('Spend');
    if (iTime < 0 || iCampaign < 0) {
      throw new Error(`Bing report has unexpected columns: ${header.join(',')}`);
    }

    const rows: SpendMetricRow[] = [];
    for (const cells of body) {
      const period = parseTimePeriod(cells[iTime] ?? '', timeZone);
      const campaignId = (cells[iCampaign] ?? '').trim();
      if (!period || !/^\d+$/.test(campaignId)) continue;
      if (period.date < firstDay || period.date > lastDay) continue;
      rows.push({
        externalCampaignId: campaignId,
        date: period.date,
        ...(period.hour !== undefined ? { hour: period.hour } : {}),
        impressions: toNumber(cells[iImpressions]),
        clicks: toNumber(cells[iClicks]),
        spend: toNumber(cells[iSpend]),
        currency: ((iCurrency >= 0 ? cells[iCurrency] : '') || 'USD').trim().toUpperCase(),
      });
    }
    return rows;
  }

  private async waitForReport(reportRequestId: string, headers: Record<string, string>) {
    for (let attempt = 0; attempt < this.maxPolls; attempt++) {
      const { data } = await firstValueFrom(
        this.http.post<PollResponse>(`${REPORTING_API}/Poll`, { ReportRequestId: reportRequestId }, { headers }),
      );
      const pollError = apiErrors(data);
      if (pollError) throw new Error(`Bing report poll failed: ${pollError}`);
      const status = data?.ReportRequestStatus?.Status;
      if (status === 'Success') return data?.ReportRequestStatus?.ReportDownloadUrl || null;
      if (status === 'Error') throw new Error('Bing report failed on Microsoft side (status Error)');
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
    throw new Error(`Bing report not ready after ${this.maxPolls} polls`);
  }

  private async ensureAccessToken(creds: BingCredentials): Promise<string> {
    if (creds.accessToken && creds.accessTokenExpiresAt - Date.now() > TOKEN_REFRESH_MARGIN_MS) {
      return creds.accessToken;
    }
    return (await this.requestToken(creds)).accessToken;
  }

  private async requestToken(creds: BingCredentials) {
    if (!creds.clientId || !creds.refreshToken) {
      throw new Error('Bing credentials need clientId and refreshToken');
    }
    const form = new URLSearchParams({
      client_id: creds.clientId,
      grant_type: 'refresh_token',
      refresh_token: creds.refreshToken,
      scope: OAUTH_SCOPE,
    });
    if (creds.clientSecret) form.set('client_secret', creds.clientSecret);
    const { data } = await firstValueFrom(
      this.http.post<TokenResponse>(
        `https://login.microsoftonline.com/${encodeURIComponent(creds.tenant)}/oauth2/v2.0/token`,
        form.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      ),
    );
    if (!data?.access_token) throw new Error('Bing OAuth: no access_token returned');
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || creds.refreshToken,
      expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    };
  }
}
