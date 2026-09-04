import { HttpService } from '@nestjs/axios';
import { AdPlatform } from '@prisma/client';
import { firstValueFrom } from 'rxjs';
import type { PlatformSyncAdapter, SpendMetricRow } from '../interfaces/platform-sync.adapter';

const OPENAI_ADS_API = 'https://api.ads.openai.com/v1';

/** Max rows per page allowed by the Insights API (default is 20). */
const PAGE_LIMIT = 2000;

/** Guard against an unbounded loop if the cursor ever stops advancing. */
const MAX_PAGES = 25;

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
      const now = Math.floor(Date.now() / 1000);
      await firstValueFrom(
        this.http.get(`${OPENAI_ADS_API}/ad_account/insights`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          params: {
            aggregation_level: 'ad_account',
            time_granularity: 'none',
            'time_ranges[]': JSON.stringify({
              type: 'unix_range',
              start: String(now - 86400),
              end: String(now),
            }),
            limit: 1,
          },
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

    for (let page = 0; page < MAX_PAGES; page++) {
      const params: Record<string, unknown> = {
        aggregation_level: 'campaign',
        time_granularity: 'daily',
        'time_ranges[]': JSON.stringify({
          type: 'unix_range',
          start: String(Math.floor(from.getTime() / 1000)),
          end: String(Math.floor(to.getTime() / 1000)),
        }),
        'fields[]': [
          'metadata.readable_time',
          'campaign.id',
          'campaign.name',
          'campaign.impressions',
          'campaign.clicks',
          'campaign.spend',
        ],
        limit: PAGE_LIMIT,
      };
      if (after) params.after = after;

      const { data } = await firstValueFrom(
        this.http.get<InsightsResponse>(`${OPENAI_ADS_API}/ad_account/insights`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          params,
        }),
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
