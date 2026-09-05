import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { buildClickWhere, type VisitAnalyticsFilters } from './visit-filters';
import {
  buildCreativeRecommendations,
  scoreCreativeQuality,
  type CreativeBenchmarks,
  type CreativePairRow,
  type CreativePerformanceRow,
} from './creative-recommendations';
import {
  metricLabelForEvent,
  parseCreativeCountMode,
  resolveCreativeEventSlugs,
  type CreativeReportOptions,
} from './creative-event-resolver';
import {
  computeBotWastedSpend,
  fetchCampaignSpend,
} from './analytics-spend.util';

type ClickRow = {
  clickId: string;
  campaignId: string;
  assetId: string | null;
  contentName: string | null;
  adId: string | null;
  adTitle: string | null;
  isBot: boolean;
  visitorId: string | null;
};

type GroupAcc = {
  label: string;
  visits: number;
  visitorIds: Set<string>;
  legacyVisitors: number;
  botVisits: number;
  convertingVisits: number;
  conversions: number;
  revenue: number;
};

@Injectable()
export class CreativeAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getCreativeReport(filters: VisitAnalyticsFilters, options: CreativeReportOptions = {}) {
    const event = resolveCreativeEventSlugs(options.eventType);
    const countMode = parseCreativeCountMode(options.countMode);
    const metricLabel = metricLabelForEvent(event.label);

    const clickWhere = buildClickWhere(filters);

    const clicks = await this.prisma.click.findMany({
      where: clickWhere,
      select: {
        clickId: true,
        campaignId: true,
        assetId: true,
        contentName: true,
        adId: true,
        adTitle: true,
        isBot: true,
        visitorId: true,
      },
    });

    const totalSpend = await fetchCampaignSpend(
      this.prisma,
      filters,
      filters.campaignId
        ? [filters.campaignId]
        : [...new Set(clicks.map((c) => c.campaignId))],
    );

    const botVisitsForWaste = filters.excludeBots
      ? await this.prisma.click.count({
          where: {
            ...buildClickWhere({ ...filters, excludeBots: false }),
            isBot: true,
          },
        })
      : clicks.filter((c) => c.isBot).length;
    const totalVisitsForWaste = filters.excludeBots
      ? clicks.length + botVisitsForWaste
      : clicks.length;
    const wastedBotSpend = computeBotWastedSpend(totalSpend, botVisitsForWaste, totalVisitsForWaste);

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
      select: { clickId: true, revenue: true, eventType: true },
    });

    const convByClick = new Map<string, { events: number; revenue: number }>();
    for (const conv of conversions) {
      const cur = convByClick.get(conv.clickId) || { events: 0, revenue: 0 };
      cur.events++;
      cur.revenue += conv.revenue;
      convByClick.set(conv.clickId, cur);
    }

    const imageGroups = new Map<string, GroupAcc>();
    const headlineGroups = new Map<string, GroupAcc>();
    const pairGroups = new Map<
      string,
      GroupAcc & { imageKey: string; imageLabel: string; headlineKey: string; headlineLabel: string }
    >();

    const imageHeadlineStats = new Map<string, Map<string, { visits: number; converting: number }>>();
    const headlineImageStats = new Map<string, Map<string, { visits: number; converting: number }>>();

    for (const click of clicks) {
      const image = this.resolveImage(click);
      const headline = this.resolveHeadline(click);
      const pairKey = `${image.key}|||${headline.key}`;
      const conv = convByClick.get(click.clickId);

      this.accumulate(imageGroups, image.key, image.label, click, conv);
      this.accumulate(headlineGroups, headline.key, headline.label, click, conv);
      this.accumulatePair(pairGroups, pairKey, image, headline, click, conv);

      if (!imageHeadlineStats.has(image.key)) imageHeadlineStats.set(image.key, new Map());
      const ih = imageHeadlineStats.get(image.key)!;
      const ihRow = ih.get(headline.label) || { visits: 0, converting: 0 };
      ihRow.visits++;
      if (conv) ihRow.converting++;
      ih.set(headline.label, ihRow);

      if (!headlineImageStats.has(headline.key)) headlineImageStats.set(headline.key, new Map());
      const hi = headlineImageStats.get(headline.key)!;
      const hiRow = hi.get(image.label) || { visits: 0, converting: 0 };
      hiRow.visits++;
      if (conv) hiRow.converting++;
      hi.set(image.label, hiRow);
    }

    const benchmarks = this.computeBenchmarks(
      clicks,
      convByClick,
      conversions.length,
      metricLabel,
      totalSpend,
    );

    const images = this.applySpend(
      this.finalizeRows(imageGroups, benchmarks, (key) => {
      const stats = imageHeadlineStats.get(key);
      if (!stats) return {};
      let best = { label: '', cr: 0 };
      for (const [hl, s] of stats.entries()) {
        const cr = s.visits > 0 ? (s.converting / s.visits) * 100 : 0;
        if (cr > best.cr) best = { label: hl, cr };
      }
      return best.label
        ? { topHeadline: best.label, topHeadlineCr: best.cr.toFixed(2) }
        : {};
    }),
      totalSpend,
      benchmarks.totalVisits,
    );

    const headlines = this.applySpend(
      this.finalizeRows(headlineGroups, benchmarks, (key) => {
      const stats = headlineImageStats.get(key);
      if (!stats) return {};
      let best = { label: '', cr: 0 };
      for (const [img, s] of stats.entries()) {
        const cr = s.visits > 0 ? (s.converting / s.visits) * 100 : 0;
        if (cr > best.cr) best = { label: img, cr };
      }
      return best.label ? { topImage: best.label, topImageCr: best.cr.toFixed(2) } : {};
    }),
      totalSpend,
      benchmarks.totalVisits,
    );

    const pairs: CreativePairRow[] = this.applySpend(
      Array.from(pairGroups.entries())
        .map(([key, g]) => ({
          ...this.toPerformanceRow(key, g.label, g, benchmarks),
          imageKey: g.imageKey,
          imageLabel: g.imageLabel,
          headlineKey: g.headlineKey,
          headlineLabel: g.headlineLabel,
        }))
        .sort((a, b) => b.crNum - a.crNum || b.visits - a.visits),
      totalSpend,
      benchmarks.totalVisits,
    );

    const totalRevenue = conversions.reduce((sum, c) => sum + c.revenue, 0);

    const recommendations = buildCreativeRecommendations(
      images,
      headlines,
      pairs,
      benchmarks,
      countMode,
    );

    const clickIdSet = new Set(clicks.map((c) => c.clickId));
    const visitsWithEvent =
      benchmarks.totalVisits > 0
        ? Array.from(convByClick.keys()).filter((cid) => clickIdSet.has(cid)).length
        : 0;

    return {
      selectedEvent: {
        slug: event.stepId,
        label: event.label,
        slugs: event.slugs,
        totalEvents: conversions.length,
        visitsWithEvent,
        ratePct: benchmarks.avgCr.toFixed(2),
      },
      countMode,
      metricLabel,
      benchmarks,
      recommendations,
      images,
      headlines,
      pairs,
      summary: {
        trackedImages: images.filter((r) => r.key !== '(unknown)').length,
        trackedHeadlines: headlines.filter((r) => r.key !== '(unknown)').length,
        trackedPairs: pairs.length,
        totalVisits: benchmarks.totalVisits,
        totalSpend,
        avgCpv: benchmarks.avgCpv,
        avgCostPerEvent: benchmarks.avgCostPerEvent,
        totalRevenue,
        profit: totalRevenue - totalSpend,
        wastedBotSpend,
      },
    };
  }

  private applySpend<T extends CreativePerformanceRow>(
    rows: T[],
    totalSpend: number,
    totalVisits: number,
  ): T[] {
    return rows.map((row) => {
      const spend = totalVisits > 0 ? totalSpend * (row.visits / totalVisits) : 0;
      const cpv = row.visits > 0 ? spend / row.visits : 0;
      const costPerEvent = row.conversions > 0 ? spend / row.conversions : 0;
      return {
        ...row,
        spend,
        cpv,
        costPerEvent,
        profit: row.revenue - spend,
      };
    });
  }

  private resolveImage(click: ClickRow): { key: string; label: string } {
    if (click.assetId?.trim()) {
      return { key: click.assetId.trim(), label: click.assetId.trim() };
    }
    if (click.contentName?.trim()) {
      const v = click.contentName.trim();
      return { key: `content:${v}`, label: v };
    }
    if (click.adId?.trim()) {
      return { key: `ad:${click.adId.trim()}`, label: `Ad ${click.adId.trim()}` };
    }
    return { key: '(unknown)', label: '(unknown image)' };
  }

  private resolveHeadline(click: ClickRow): { key: string; label: string } {
    const t = click.adTitle?.trim();
    if (t) return { key: t, label: t };
    return { key: '(unknown)', label: '(unknown headline)' };
  }

  private accumulate(
    groups: Map<string, GroupAcc>,
    key: string,
    label: string,
    click: ClickRow,
    conv: { events: number; revenue: number } | undefined,
  ) {
    const g = groups.get(key) || {
      label,
      visits: 0,
      visitorIds: new Set<string>(),
      legacyVisitors: 0,
      botVisits: 0,
      convertingVisits: 0,
      conversions: 0,
      revenue: 0,
    };
    g.visits++;
    if (click.visitorId) g.visitorIds.add(click.visitorId);
    else g.legacyVisitors++;
    if (click.isBot) g.botVisits++;
    if (conv) {
      g.convertingVisits++;
      g.conversions += conv.events;
      g.revenue += conv.revenue;
    }
    groups.set(key, g);
  }

  private accumulatePair(
    groups: Map<
      string,
      GroupAcc & { imageKey: string; imageLabel: string; headlineKey: string; headlineLabel: string }
    >,
    pairKey: string,
    image: { key: string; label: string },
    headline: { key: string; label: string },
    click: ClickRow,
    conv: { events: number; revenue: number } | undefined,
  ) {
    const g = groups.get(pairKey) || {
      label: `${image.label} × ${headline.label}`,
      imageKey: image.key,
      imageLabel: image.label,
      headlineKey: headline.key,
      headlineLabel: headline.label,
      visits: 0,
      visitorIds: new Set<string>(),
      legacyVisitors: 0,
      botVisits: 0,
      convertingVisits: 0,
      conversions: 0,
      revenue: 0,
    };
    g.visits++;
    if (click.visitorId) g.visitorIds.add(click.visitorId);
    else g.legacyVisitors++;
    if (click.isBot) g.botVisits++;
    if (conv) {
      g.convertingVisits++;
      g.conversions += conv.events;
      g.revenue += conv.revenue;
    }
    groups.set(pairKey, g);
  }

  private computeBenchmarks(
    clicks: ClickRow[],
    convByClick: Map<string, { events: number; revenue: number }>,
    totalEvents: number,
    metricLabel: string,
    totalSpend: number,
  ): CreativeBenchmarks {
    const totalVisits = clicks.length;
    let converting = 0;
    let botVisits = 0;
    let revenue = 0;
    for (const click of clicks) {
      if (click.isBot) botVisits++;
      const conv = convByClick.get(click.clickId);
      if (conv) {
        converting++;
        revenue += conv.revenue;
      }
    }
    return {
      totalVisits,
      avgCr: totalVisits > 0 ? (converting / totalVisits) * 100 : 0,
      avgBotPct: totalVisits > 0 ? (botVisits / totalVisits) * 100 : 0,
      avgEpc: totalVisits > 0 ? revenue / totalVisits : 0,
      minSample: 15,
      totalEvents,
      metricLabel,
      totalSpend,
      avgCpv: totalVisits > 0 ? totalSpend / totalVisits : 0,
      avgCostPerEvent: totalEvents > 0 ? totalSpend / totalEvents : 0,
    };
  }

  private finalizeRows(
    groups: Map<string, GroupAcc>,
    benchmarks: CreativeBenchmarks,
    extra: (key: string) => Partial<CreativePerformanceRow>,
  ): CreativePerformanceRow[] {
    return Array.from(groups.entries())
      .map(([key, g]) => ({
        ...this.toPerformanceRow(key, g.label, g, benchmarks),
        ...extra(key),
      }))
      .sort((a, b) => b.crNum - a.crNum || b.visits - a.visits);
  }

  private toPerformanceRow(
    key: string,
    label: string,
    g: GroupAcc,
    benchmarks: CreativeBenchmarks,
  ): CreativePerformanceRow {
    const uniqueVisitors = g.visitorIds.size + g.legacyVisitors;
    const humanVisits = g.visits - g.botVisits;
    const botPct = g.visits > 0 ? ((g.botVisits / g.visits) * 100).toFixed(1) : '0.0';
    const crNum = g.visits > 0 ? (g.convertingVisits / g.visits) * 100 : 0;
    const botNum = parseFloat(botPct);
    return {
      key,
      label,
      visits: g.visits,
      uniqueVisitors,
      botVisits: g.botVisits,
      humanVisits,
      botPct,
      convertingVisits: g.convertingVisits,
      conversions: g.conversions,
      cr: crNum.toFixed(2),
      crNum,
      revenue: g.revenue,
      epc: g.visits > 0 ? g.revenue / g.visits : 0,
      spend: 0,
      cpv: 0,
      costPerEvent: 0,
      profit: g.revenue,
      quality: scoreCreativeQuality(g.visits, crNum, botNum, benchmarks),
    };
  }
}
