import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { buildClickWhere, type VisitAnalyticsFilters } from './visit-filters';
import {
  allocateSpend,
  computeCpa,
  computeRoi,
  fetchCampaignSpend,
} from './analytics-spend.util';
import { resolveCreativeEventSlugs, parseCreativeCountMode } from './creative-event-resolver';

export type PlacementVerdict = 'kill' | 'watch' | 'scale';

export type PlacementRow = {
  key: string;
  label: string;
  visits: number;
  botVisits: number;
  botPct: string;
  events: number;
  cr: string;
  crNum: number;
  spend: number;
  revenue: number;
  profit: number;
  roi: number;
  cpa: number;
  cpv: number;
  verdict: PlacementVerdict;
};

const PLACEMENT_TOP_N = 500;

@Injectable()
export class PlacementAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getPlacements(
    filters: VisitAnalyticsFilters,
    dimension: 'site' | 'publisher' = 'site',
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
        siteId: true,
        publisherName: true,
        isBot: true,
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
      { label: string; visits: number; botVisits: number; events: number; revenue: number; convertingVisits: number }
    >();

    for (const click of clicks) {
      const raw =
        dimension === 'site'
          ? click.siteId?.trim() || '(unknown)'
          : click.publisherName?.trim() || '(unknown)';
      const key = raw.toLowerCase();
      const g = groups.get(key) || {
        label: raw,
        visits: 0,
        botVisits: 0,
        events: 0,
        revenue: 0,
        convertingVisits: 0,
      };
      g.visits++;
      if (click.isBot) g.botVisits++;
      const conv = convByClick.get(click.clickId);
      if (conv) {
        g.convertingVisits++;
        g.events += conv.events;
        g.revenue += conv.revenue;
      }
      groups.set(key, g);
    }

    const avgCr =
      totalVisits > 0
        ? (Array.from(convByClick.keys()).length / totalVisits) * 100
        : 0;

    const rows: PlacementRow[] = Array.from(groups.entries())
      .map(([key, g]) => {
        const spend = allocateSpend(totalSpend, g.visits, totalVisits);
        const crNum = g.visits > 0 ? (g.convertingVisits / g.visits) * 100 : 0;
        const roi = computeRoi(g.revenue, spend);
        const cpa = computeCpa(spend, g.events);
        const cpv = g.visits > 0 ? spend / g.visits : 0;
        const botPct = g.visits > 0 ? ((g.botVisits / g.visits) * 100).toFixed(1) : '0.0';

        return {
          key,
          label: g.label,
          visits: g.visits,
          botVisits: g.botVisits,
          botPct,
          events: g.events,
          cr: crNum.toFixed(2),
          crNum,
          spend,
          revenue: g.revenue,
          profit: g.revenue - spend,
          roi,
          cpa,
          cpv,
          verdict: this.scoreVerdict(spend, g.events, crNum, avgCr, parseFloat(botPct), roi),
        };
      })
      .sort((a, b) => b.spend - a.spend || a.crNum - b.crNum)
      .slice(0, PLACEMENT_TOP_N);

    return {
      dimension,
      eventType: event.stepId,
      eventLabel: event.label,
      countMode,
      summary: {
        totalVisits,
        totalSpend,
        totalEvents: conversions.length,
        avgCr,
        killCount: rows.filter((r) => r.verdict === 'kill').length,
        scaleCount: rows.filter((r) => r.verdict === 'scale').length,
      },
      rows,
    };
  }

  scoreVerdict(
    spend: number,
    events: number,
    crNum: number,
    avgCr: number,
    botPct: number,
    roi: number,
  ): PlacementVerdict {
    if (spend >= 5 && events === 0) return 'kill';
    if (spend >= 10 && roi < -50) return 'kill';
    if (botPct >= 45 && spend >= 3) return 'kill';
    if (crNum >= avgCr * 1.2 && events >= 2 && roi > 0) return 'scale';
    if (spend >= 3 && crNum < avgCr * 0.5) return 'watch';
    return 'watch';
  }
}
