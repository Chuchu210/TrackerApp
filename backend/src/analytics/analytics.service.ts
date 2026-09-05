import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConversionEventTypesService } from '../conversion-event-types/conversion-event-types.service';
import { getVisitStats } from './visit-stats';
import {
  buildClickWhere,
  excludeTestRows,
  type VisitAnalyticsFilters,
  type VisitBreakdownDimension,
} from './visit-filters';

type BreakdownDimension =
  | 'publisherName'
  | 'platform'
  | 'device'
  | 'os'
  | 'countryCode'
  | 'browser';

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventTypes: ConversionEventTypesService,
  ) {}

  async getOverview(
    campaignId?: string,
    from?: string,
    to?: string,
    excludeBots?: boolean,
    includeTest?: boolean,
  ) {
    const { fromDate, toDate } = this.resolveDateRange(from, to);
    const clickFilter: Prisma.ClickWhereInput = {
      ...(campaignId ? { campaignId } : {}),
      createdAt: { gte: fromDate, lte: toDate },
      ...(excludeBots ? { isBot: false } : {}),
      ...excludeTestRows({ includeTest }),
    };
    const convWhere: Prisma.ConversionWhereInput = {
      ...(campaignId ? { campaignId } : {}),
      createdAt: { gte: fromDate, lte: toDate },
      ...(excludeBots ? { click: { is: clickFilter } } : {}),
    };
    const convCountWhere = await this.eventTypes.applyConversionCountFilter(convWhere, {
      includeTest,
    });

    const [visitStats, conversions, sentConversions] = await Promise.all([
      getVisitStats(this.prisma, campaignId, from, to, excludeBots, includeTest),
      this.prisma.conversion.count({ where: convCountWhere }),
      this.prisma.conversion.count({ where: { ...convCountWhere, status: 'sent' } }),
    ]);

    const { visits, uniqueVisits, newVisitors, returningVisitors } = visitStats;

    return {
      clicks: visits,
      visits,
      uniqueVisits,
      newVisitors,
      returningVisitors,
      conversions,
      sentConversions,
      conversionRate: visits > 0 ? ((conversions / visits) * 100).toFixed(2) : '0',
    };
  }

  async getBreakdown(
    dimension: 'publisher' | 'platform' | 'device' | 'os' | 'country' | 'browser',
    campaignId?: string,
    from?: string,
    to?: string,
  ) {
    const fieldMap: Record<string, BreakdownDimension> = {
      publisher: 'publisherName',
      platform: 'platform',
      device: 'device',
      os: 'os',
      country: 'countryCode',
      browser: 'browser',
    };
    const columnMap: Record<BreakdownDimension, string> = {
      publisherName: 'publisher_name',
      platform: 'platform',
      device: 'device',
      os: 'os',
      countryCode: 'country_code',
      browser: 'browser',
    };

    const field = fieldMap[dimension] || 'publisherName';
    const column = columnMap[field];
    const { fromDate, toDate } = this.resolveDateRange(from, to);
    const clickWhere: Prisma.ClickWhereInput = {
      ...(campaignId ? { campaignId } : {}),
      createdAt: { gte: fromDate, lte: toDate },
      isTest: false,
    };
    const conversionSlugs = await this.eventTypes.getConversionCountSlugs();

    const clickGroups = await this.prisma.click.groupBy({
      by: [field],
      where: clickWhere,
      _count: { _all: true },
    });

    const clickConditions: Prisma.Sql[] = [
      Prisma.sql`c.created_at >= ${fromDate}`,
      Prisma.sql`c.created_at <= ${toDate}`,
      // Mirrors `clickWhere` above: the two halves of this breakdown must
      // agree on which rows exist, or the CR denominators go wrong.
      Prisma.sql`c.is_test = false`,
    ];
    if (campaignId) clickConditions.push(Prisma.sql`c.campaign_id = ${campaignId}`);

    const slugList =
      conversionSlugs.length > 0 ? conversionSlugs : ['__no_conversion_slugs__'];

    const conversionRows = await this.prisma.$queryRaw<
      Array<{ name: string; conversions: number }>
    >`
      SELECT
        COALESCE(c.${Prisma.raw(column)}, '(unknown)') AS name,
        COUNT(cv.id)::int AS conversions
      FROM clicks c
      INNER JOIN conversions cv ON cv.click_id = c.click_id
      WHERE ${Prisma.join(clickConditions, ' AND ')}
        AND cv.status = 'sent'
        AND cv.event_type IN (${Prisma.join(slugList)})
      GROUP BY COALESCE(c.${Prisma.raw(column)}, '(unknown)')
    `;

    const conversionsByName = new Map(
      conversionRows.map((row) => [row.name, row.conversions]),
    );

    const results = clickGroups.map((group) => {
      const name = (group[field] as string | null) || '(unknown)';
      const clicks = group._count._all;
      const conversions = conversionsByName.get(name) ?? 0;

      return {
        name,
        clicks,
        conversions,
        cr: clicks > 0 ? ((conversions / clicks) * 100).toFixed(2) : '0',
      };
    });

    for (const [name, conversions] of conversionsByName) {
      if (!results.some((r) => r.name === name)) {
        results.push({
          name,
          clicks: 0,
          conversions,
          cr: '0',
        });
      }
    }

    return results.sort((a, b) => b.clicks - a.clicks);
  }

  async getVisitSummary(filters: VisitAnalyticsFilters) {
    const clickWhere = buildClickWhere(filters);

    const convBase: Prisma.ConversionWhereInput = {
      status: 'sent',
      click: { is: clickWhere },
    };
    const convCountWhere = await this.eventTypes.applyConversionCountFilter(convBase);

    const [visits, newVisitors, botVisits, visitorGroups, legacyVisits, conversions, revenueAgg] =
      await Promise.all([
        this.prisma.click.count({ where: clickWhere }),
        this.prisma.click.count({ where: { ...clickWhere, isNewVisitor: true } }),
        this.prisma.click.count({ where: { ...clickWhere, isBot: true } }),
        this.prisma.click.groupBy({
          by: ['visitorId'],
          where: { ...clickWhere, visitorId: { not: null } },
        }),
        this.prisma.click.count({ where: { ...clickWhere, visitorId: null } }),
        this.prisma.conversion.count({ where: convCountWhere }),
        this.prisma.conversion.aggregate({
          where: convCountWhere,
          _sum: { revenue: true },
        }),
      ]);

    const uniqueVisits = visitorGroups.length + legacyVisits;
    const returningVisitors = Math.max(0, visits - newVisitors);
    const humanVisits = visits - botVisits;
    const botPct = visits > 0 ? ((botVisits / visits) * 100).toFixed(1) : '0.0';
    const humanPct = visits > 0 ? ((humanVisits / visits) * 100).toFixed(1) : '0.0';
    const revenue = revenueAgg._sum.revenue ?? 0;

    return {
      visits,
      uniqueVisits,
      newVisitors,
      returningVisitors,
      botVisits,
      humanVisits,
      botPct,
      humanPct,
      conversions,
      conversionRate: visits > 0 ? ((conversions / visits) * 100).toFixed(2) : '0.00',
      revenue,
    };
  }

  async getVisitBreakdown(dimension: VisitBreakdownDimension, filters: VisitAnalyticsFilters) {
    const clickWhere = buildClickWhere(filters);

    const clicks = await this.prisma.click.findMany({
      where: clickWhere,
      select: {
        clickId: true,
        publisherName: true,
        adId: true,
        adTitle: true,
        siteId: true,
        contentName: true,
        platform: true,
        countryCode: true,
        device: true,
        isBot: true,
        visitorId: true,
        isNewVisitor: true,
        campaignId: true,
        campaign: { select: { name: true } },
      },
    });

    const convWhere = await this.eventTypes.applyConversionCountFilter({
      status: 'sent',
      click: { is: clickWhere },
    });
    const conversions = await this.prisma.conversion.findMany({
      where: convWhere,
      select: { clickId: true, revenue: true },
    });

    const convByClick = new Map<string, { events: number; revenue: number }>();
    for (const conv of conversions) {
      const cur = convByClick.get(conv.clickId) || { events: 0, revenue: 0 };
      cur.events++;
      cur.revenue += conv.revenue;
      convByClick.set(conv.clickId, cur);
    }

    type GroupAcc = {
      label: string;
      visits: number;
      visitorIds: Set<string>;
      legacyVisitors: number;
      botVisits: number;
      newVisitors: number;
      convertingVisits: number;
      conversions: number;
      revenue: number;
    };

    const groups = new Map<string, GroupAcc>();

    for (const click of clicks) {
      const { key, label } = this.resolveBreakdownKey(dimension, click);
      const g = groups.get(key) || {
        label,
        visits: 0,
        visitorIds: new Set<string>(),
        legacyVisitors: 0,
        botVisits: 0,
        newVisitors: 0,
        convertingVisits: 0,
        conversions: 0,
        revenue: 0,
      };

      g.visits++;
      if (click.visitorId) g.visitorIds.add(click.visitorId);
      else g.legacyVisitors++;
      if (click.isBot) g.botVisits++;
      if (click.isNewVisitor) g.newVisitors++;

      const conv = convByClick.get(click.clickId);
      if (conv) {
        g.convertingVisits++;
        g.conversions += conv.events;
        g.revenue += conv.revenue;
      }

      groups.set(key, g);
    }

    return Array.from(groups.entries())
      .map(([key, g]) => {
        const uniqueVisitors = g.visitorIds.size + g.legacyVisitors;
        const humanVisits = g.visits - g.botVisits;
        const botPct = g.visits > 0 ? ((g.botVisits / g.visits) * 100).toFixed(1) : '0.0';
        const cr = g.visits > 0 ? ((g.convertingVisits / g.visits) * 100).toFixed(2) : '0.00';

        return {
          key,
          label: g.label,
          visits: g.visits,
          uniqueVisitors,
          botVisits: g.botVisits,
          humanVisits,
          botPct,
          newVisitors: g.newVisitors,
          convertingVisits: g.convertingVisits,
          conversions: g.conversions,
          cr,
          revenue: g.revenue,
        };
      })
      .sort((a, b) => b.visits - a.visits);
  }

  private resolveBreakdownKey(
    dimension: VisitBreakdownDimension,
    click: {
      publisherName: string | null;
      adId: string | null;
      adTitle: string | null;
      siteId: string | null;
      contentName: string | null;
      platform: string | null;
      countryCode: string | null;
      device: string | null;
      campaignId: string;
      campaign: { name: string };
    },
  ): { key: string; label: string } {
    switch (dimension) {
      case 'publisher': {
        const label = click.publisherName || '(unknown)';
        return { key: label, label };
      }
      case 'ad': {
        const key = click.adId || '(no ad)';
        const label = click.adTitle
          ? `${click.adTitle}${click.adId ? ` (${click.adId})` : ''}`
          : key;
        return { key, label };
      }
      case 'site': {
        const label = click.siteId || '(unknown)';
        return { key: label, label };
      }
      case 'content': {
        const label = click.contentName || '(unknown)';
        return { key: label, label };
      }
      case 'platform': {
        const label = click.platform || '(unknown)';
        return { key: label, label };
      }
      case 'country': {
        const label = click.countryCode || '(unknown)';
        return { key: label, label };
      }
      case 'device': {
        const label = click.device || '(unknown)';
        return { key: label, label };
      }
      case 'campaign': {
        return { key: click.campaignId, label: click.campaign.name };
      }
      default: {
        const label = click.publisherName || '(unknown)';
        return { key: label, label };
      }
    }
  }

  async getLiveTraffic(campaignId?: string, limit = 50) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    return this.prisma.click.findMany({
      where: {
        createdAt: { gte: since },
        ...(campaignId ? { campaignId } : {}),
      },
      include: {
        campaign: { select: { name: true, slug: true } },
        conversions: { select: { id: true, status: true, eventType: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  private resolveDateRange(from?: string, to?: string) {
    const toDate = to ? new Date(to) : new Date();
    const fromDate = from
      ? new Date(from)
      : new Date(toDate.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { fromDate, toDate };
  }
}
