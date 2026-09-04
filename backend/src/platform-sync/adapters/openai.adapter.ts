import { HttpService } from '@nestjs/axios';
import { AdPlatform } from '@prisma/client';
import { firstValueFrom } from 'rxjs';
import type { PlatformSyncAdapter, SpendMetricRow } from '../interfaces/platform-sync.adapter';

const OPENAI_ADS_API = 'https://api.ads.openai.com/v1';

/** Max rows per page allowed by the Insights API (default is 20). */
const PAGE_LIMIT = 2000;

/** Guard against an unbounded loop if the cursor ever stops advancing. */
const MAX_PAGES = 25;

const HOUR_SECONDS = 3600;

/**
 * The API rejects any time range whose bounds are not on a full hour in the ad
 * account's timezone ("minute and second must be 0"). Account timezones are
 * whole-hour offsets, so flooring to a UTC hour satisfies it.
 */
function toHourAlignedUnix(date: Date): number {
  const seconds = Math.floor(date.getTime() / 1000);
  return seconds - (seconds % HOUR_SECONDS);
}

/**
 * Built by hand rather than handed to axios: axios appends "[]" to array keys,
 * which would turn `fields[]` into `fields[][]` and be rejected.
 */
function buildInsightsQuery(params: {
  aggregationLevel: string;
  timeGranularity: string;
  fields: string[];
  start: number;
  end: number;
  limit: number;
  after?: string;
}): string {
  const qs = new URLSearchParams();
  qs.set('aggregation_level', params.aggregationLevel);
  qs.set('time_granularity', params.timeGranularity);
  for (const field of params.fields) qs.append('fields[]', field);
  qs.append(
    'time_ranges[]',
    JSON.stringify({
      type: 'unix_range',
      start: String(params.start),
      end: String(params.end),
    }),
  );
  qs.set('limit', String(params.limit));
  if (params.after) qs.set('after', params.after);
  return qs.toString();
}

type InsightsRow = {
  readable_time?: string;
  start_time?: number;
  campaign_id?: string;
  campaign_name?: string;
  impressions?: number;
  clicks?: number;
  spend?: number;
};

type InsightsResponse = {
  data?: InsightsRow[];
  has_more?: boolean;
  last_id?: string;
};

/**
 * OpenAI Ads (ChatGPT Ads) spend reporting.
 * https://developers.openai.com/ads/api-reference/insights
 *
 * Pulls daily per-campaign metrics from the Insights API so ChatGPT spend
 * lands in the same reports as every other platform. The API key is issued in
 * Ads Manager > Settings and is scoped to a single ad account, so `accountId`
 * is not part of the request path.
 */
export class OpenAiSyncAdapter implements PlatformSyncAdapter {
  platform = AdPlatform.openai;

  constructor(private readonly http: HttpService) {}

  async testConnection(
    credentials: Record<string, unknown>,
    _accountId: string | null,
  ): Promise<boolean> {
    const apiKey = this.resolveApiKey(credentials);
    if (!apiKey) return false;
    try {
      // Cheapest possible probe: one row over a one-day window.
      const end = toHourAlignedUnix(new Date());
      const query = buildInsightsQuery({
        aggregationLevel: 'ad_account',
        timeGranularity: 'none',
        fields: ['ad_account.spend'],
        start: end - 24 * HOUR_SECONDS,
        end,
        limit: 1,
      });
      await firstValueFrom(
        this.http.get(`${OPENAI_ADS_API}/ad_account/insights?${query}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async fetchMetrics(
    credentials: Record<string, unknown>,
    _accountId: string | null,
    from: Date,
    to: Date,
  ): Promise<SpendMetricRow[]> {
    const apiKey = this.resolveApiKey(credentials);
    if (!apiKey) return [];

    const currency = this.resolveCurrency(credentials);
    const rows: SpendMetricRow[] = [];
    let after: string | undefined;

    const start = toHourAlignedUnix(from);
    const end = toHourAlignedUnix(to);

    for (let page = 0; page < MAX_PAGES; page++) {
      const query = buildInsightsQuery({
        aggregationLevel: 'campaign',
        timeGranularity: 'daily',
        fields: [
          'metadata.readable_time',
          'campaign.id',
          'campaign.name',
          'campaign.impressions',
          'campaign.clicks',
          'campaign.spend',
        ],
        start,
        end,
        limit: PAGE_LIMIT,
        after,
      });

      const { data } = await firstValueFrom(
        this.http.get<InsightsResponse>(
          `${OPENAI_ADS_API}/ad_account/insights?${query}`,
          { headers: { Authorization: `Bearer ${apiKey}` } },
        ),
      );

      for (const item of data?.data || []) {
        const campaignId = item.campaign_id;
        const date = this.rowDate(item);
        if (!campaignId || !date) continue;
        rows.push({
          externalCampaignId: String(campaignId),
          date,
          impressions: Number(item.impressions) || 0,
          clicks: Number(item.clicks) || 0,
          // Insights returns spend as a decimal in the account currency
          // (e.g. 18.42), unlike the Conversions API which uses minor units.
          spend: Number(item.spend) || 0,
          currency,
        });
      }

      if (!data?.has_more || !data.last_id || data.last_id === after) break;
      after = data.last_id;
    }

    return rows;
  }

  /**
   * Campaigns on the ad account, used to auto-map them onto tracker campaigns.
   * Spend rows are keyed by external campaign id and are dropped when no
   * mapping exists, so without this the sync would silently import nothing.
   */
  async listCampaigns(
    credentials: Record<string, unknown>,
  ): Promise<{ campaignId: string; campaignName: string }[]> {
    const apiKey = this.resolveApiKey(credentials);
    if (!apiKey) return [];

    const { data } = await firstValueFrom(
      this.http.get<{ data?: { id?: string; name?: string }[] }>(
        `${OPENAI_ADS_API}/campaigns`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      ),
    );

    return (data?.data || [])
      .filter((c) => c.id)
      .map((c) => ({
        campaignId: String(c.id),
        campaignName: c.name || String(c.id),
      }));
  }

  /** Prefer the daily bucket label, fall back to the row's start timestamp. */
  private rowDate(item: InsightsRow): Date | null {
    if (item.readable_time) {
      const parsed = new Date(`${item.readable_time}T00:00:00.000Z`);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    if (typeof item.start_time === 'number') {
      return new Date(item.start_time * 1000);
    }
    return null;
  }

  private resolveApiKey(credentials: Record<string, unknown>): string {
    return String(credentials.apiKey || credentials.accessToken || '').trim();
  }

  private resolveCurrency(credentials: Record<string, unknown>): string {
    return String(credentials.currency || 'USD')
      .trim()
      .toUpperCase();
  }
}
