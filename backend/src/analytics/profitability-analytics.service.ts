import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { buildClickWhere, type VisitAnalyticsFilters } from './visit-filters';
import {
  allocateSpend,
  computeRoi,
  fetchCampaignSpend,
} from './analytics-spend.util';
import { resolveCreativeEventSlugs, parseCreativeCountMode } from './creative-event-resolver';

export type ProfitabilityDimension = 'hour' | 'dow' | 'country' | 'device';

export type ProfitabilityRow = {
  key: string;
  label: string;
  visits: number;
  events: number;
  spend: number;
  revenue: number;
  profit: number;
  roi: number;
  cr: string;
};

@Injectable()
export class ProfitabilityAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfitability(
    filters: VisitAnalyticsFilters,
    dimension: ProfitabilityDimension = 'hour',
    eventType?: string,
    countMode: 'recorded' | 'sent' = 'recorded',
  ) {
    const event = resolveCreativeEventSlugs(eventType);
    const clickWhere = buildClickWhere(filters);

    const clicks = await this.prisma.click.findMany({
      where: clickWhere,
      select: {
        clickId: true,
        campaignId: true,
        createdAt: true,
        countryCode: true,
        device: true,
      },
    });

    const convWhere = {
      eventType: { in: event.slugs },
      click: { is: clickWhere },
      // Not implied by the click filter: a conversion fired while test mode was
      // on is a test row even when the click it attaches to is real.
      isTest: false,
      ...(countMode === 'sent' ? { status: 'sent' as const } : {}),
    };

    const conversions = await this.prisma.conversion.findMany({
      where: convWhere,
      select: { clickId: true, revenue: true },
    });

    const convByClick = new Map<string, { events: number; revenue: number }>();
    for (const c of conversions) {
      const cur = convByClick.get(c.clickId) || { events: 0, revenue: 0 };
      cur.events++;
      cur.revenue += c.revenue;
      convByClick.set(c.clickId, cur);
    }

    const campaignIds = filters.campaignId
      ? [filters.campaignId]
      : [...new Set(clicks.map((c) => c.campaignId))];
    const totalSpend = await fetchCampaignSpend(this.prisma, filters, campaignIds);
    const totalVisits = clicks.length;

    const groups = new Map<
      string,
      { label: string; visits: number; events: number; revenue: number; convertingVisits: number }
    >();

    for (const click of clicks) {
      const bucket = this.bucketKey(click, dimension);
      const g = groups.get(bucket.key) || {
        label: bucket.label,
        visits: 0,
        events: 0,
        revenue: 0,
        convertingVisits: 0,
      };
      g.visits++;
      const conv = convByClick.get(click.clickId);
      if (conv) {
        g.convertingVisits++;
        g.events += conv.events;
        g.revenue += conv.revenue;
      }
      groups.set(bucket.key, g);
    }

    const rows: ProfitabilityRow[] = Array.from(groups.entries())
      .map(([key, g]) => {
        const spend = allocateSpend(totalSpend, g.visits, totalVisits);
        const crNum = g.visits > 0 ? (g.convertingVisits / g.visits) * 100 : 0;
        return {
          key,
          label: g.label,
          visits: g.visits,
          events: g.events,
          spend,
          revenue: g.revenue,
          profit: g.revenue - spend,
          roi: computeRoi(g.revenue, spend),
          cr: crNum.toFixed(2),
        };
      })
      .sort((a, b) => a.key.localeCompare(b.key));

    return {
      dimension,
      eventType: event.stepId,
      eventLabel: event.label,
      countMode,
      summary: { totalVisits, totalSpend, totalEvents: conversions.length },
      rows,
    };
  }

  private bucketKey(
    click: { createdAt: Date; countryCode: string | null; device: string | null },
    dimension: ProfitabilityDimension,
  ): { key: string; label: string } {
    const d = click.createdAt;
    switch (dimension) {
      case 'hour': {
        const h = d.getHours();
        return { key: String(h).padStart(2, '0'), label: `${String(h).padStart(2, '0')}:00` };
      }
      case 'dow': {
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const idx = d.getDay();
        return { key: String(idx), label: days[idx] };
      }
      case 'country': {
        const c = click.countryCode?.trim() || '??';
        return { key: c, label: c };
      }
      case 'device': {
        const dev = click.device?.trim() || 'Unknown';
        return { key: dev, label: dev };
      }
      default:
        return { key: 'all', label: 'All' };
    }
  }
}
