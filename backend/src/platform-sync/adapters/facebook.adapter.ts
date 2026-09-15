import { HttpService } from '@nestjs/axios';
import { AdPlatform } from '@prisma/client';
import { firstValueFrom } from 'rxjs';
import { httpRequestWithRetry } from '../../postbacks/helpers/facebook-graph-http.helper';
import type {
  AdSpendMetricRow,
  PlatformSyncAdapter,
  SpendMetricRow,
} from '../interfaces/platform-sync.adapter';
import {
  parseMetaAdCreativeBatch,
  type ParsedMetaAdCreative,
} from '../meta-ad-creative.parse';

const GRAPH_BASE = 'https://graph.facebook.com/v21.0';
const CREATIVE_FIELDS =
  'id,name,creative{id,name,title,body,image_url,thumbnail_url,call_to_action_type,object_story_spec,asset_feed_spec}';
const AD_BATCH_SIZE = 50;
const INSIGHTS_PAGE_SIZE = 500;
const MAX_INSIGHTS_PAGES = 200;

type InsightsPage = {
  data?: Array<Record<string, string | undefined>>;
  paging?: { next?: string };
};

export class FacebookSyncAdapter implements PlatformSyncAdapter {
  platform = AdPlatform.facebook;

  constructor(private readonly http: HttpService) {}

  async testConnection(
    credentials: Record<string, unknown>,
    accountId: string | null,
  ): Promise<boolean> {
    const token = String(credentials.accessToken || '');
    const actId = accountId || String(credentials.adAccountId || '');
    if (!token || !actId) return false;
    try {
      await firstValueFrom(
        this.http.get(`${GRAPH_BASE}/${actId}`, {
          params: { fields: 'name', access_token: token },
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async fetchMetrics(
    credentials: Record<string, unknown>,
    accountId: string | null,
    from: Date,
    to: Date,
  ): Promise<SpendMetricRow[]> {
    const token = String(credentials.accessToken || '');
    const actId = accountId || String(credentials.adAccountId || '');
    if (!token || !actId) return [];

    const { data } = await firstValueFrom(
      this.http.get(`${GRAPH_BASE}/${actId}/insights`, {
        params: {
          fields: 'campaign_id,impressions,clicks,spend',
          level: 'campaign',
          time_range: JSON.stringify({
            since: from.toISOString().slice(0, 10),
            until: to.toISOString().slice(0, 10),
          }),
          time_increment: 1,
          access_token: token,
        },
      }),
    );

    const rows: SpendMetricRow[] = [];
    for (const item of data?.data || []) {
      rows.push({
        externalCampaignId: String(item.campaign_id || ''),
        date: new Date(item.date_start),
        impressions: parseInt(item.impressions || '0', 10),
        clicks: parseInt(item.clicks || '0', 10),
        spend: parseFloat(item.spend || '0'),
        currency: 'EUR',
      });
    }
    return rows;
  }

  /**
   * Spend per ad per day, for the media-buying machine's creative facts.
   * Graph returns insights 25 rows at a time unless told otherwise, and an
   * account with a few dozen ads over a week already exceeds that, so every
   * `paging.next` page is followed (bounded, in case the cursor never ends).
   */
  async fetchAdMetrics(
    credentials: Record<string, unknown>,
    accountId: string | null,
    from: Date,
    to: Date,
  ): Promise<AdSpendMetricRow[]> {
    const token = String(credentials.accessToken || '');
    const actId = accountId || String(credentials.adAccountId || '');
    if (!token || !actId) return [];

    const rows: AdSpendMetricRow[] = [];
    let url: string | null = `${GRAPH_BASE}/${actId}/insights`;
    // The `next` URL already carries every query parameter, so params are only sent once.
    let params: Record<string, string | number> | undefined = {
      fields: 'ad_id,adset_id,campaign_id,impressions,clicks,spend,account_currency',
      level: 'ad',
      time_range: JSON.stringify({
        since: from.toISOString().slice(0, 10),
        until: to.toISOString().slice(0, 10),
      }),
      time_increment: 1,
      limit: INSIGHTS_PAGE_SIZE,
      access_token: token,
    };

    for (let page = 0; url && page < MAX_INSIGHTS_PAGES; page++) {
      const response = await firstValueFrom(
        this.http.get<InsightsPage>(url, params ? { params } : undefined),
      );
      const data: InsightsPage = response.data;
      for (const item of data?.data || []) {
        if (!item.ad_id || !item.date_start) continue;
        rows.push({
          externalAdId: String(item.ad_id),
          externalAdsetId: item.adset_id ? String(item.adset_id) : undefined,
          externalCampaignId: item.campaign_id ? String(item.campaign_id) : undefined,
          date: new Date(item.date_start),
          impressions: parseInt(item.impressions || '0', 10),
          clicks: parseInt(item.clicks || '0', 10),
          spend: parseFloat(item.spend || '0'),
          currency: item.account_currency || 'EUR',
        });
      }
      url = data?.paging?.next || null;
      params = undefined;
    }
    return rows;
  }

  async fetchAdCreatives(
    token: string,
    adIds: string[],
  ): Promise<ParsedMetaAdCreative[]> {
    const unique = [...new Set(adIds.map((id) => id.trim()).filter(Boolean))];
    if (!token || unique.length === 0) return [];

    const out: ParsedMetaAdCreative[] = [];
    for (let i = 0; i < unique.length; i += AD_BATCH_SIZE) {
      const chunk = unique.slice(i, i + AD_BATCH_SIZE);
      const qs = new URLSearchParams({
        ids: chunk.join(','),
        fields: CREATIVE_FIELDS,
        access_token: token,
      });
      const { data } = await httpRequestWithRetry(
        this.http,
        'get',
        `${GRAPH_BASE}/?${qs.toString()}`,
      );
      out.push(...parseMetaAdCreativeBatch(data));
    }
    return out;
  }
}
