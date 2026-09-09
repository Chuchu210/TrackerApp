import { HttpService } from '@nestjs/axios';
import { AdPlatform } from '@prisma/client';
import { firstValueFrom } from 'rxjs';
import { httpRequestWithRetry } from '../../postbacks/helpers/facebook-graph-http.helper';
import type { PlatformSyncAdapter, SpendMetricRow } from '../interfaces/platform-sync.adapter';
import {
  parseMetaAdCreativeBatch,
  type ParsedMetaAdCreative,
} from '../meta-ad-creative.parse';

const GRAPH_BASE = 'https://graph.facebook.com/v21.0';
const CREATIVE_FIELDS =
  'id,name,creative{id,name,title,body,image_url,thumbnail_url,call_to_action_type,object_story_spec,asset_feed_spec}';
const AD_BATCH_SIZE = 50;

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
