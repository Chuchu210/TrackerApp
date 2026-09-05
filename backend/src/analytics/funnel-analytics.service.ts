import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConversionEventTypesService } from '../conversion-event-types/conversion-event-types.service';
import {
  LP_FUNNEL_STEPS,
  mediagoLabelForCode,
  type LpFunnelStepDef,
} from '../shared/tracking/lp-funnel';
import { getVisitStats } from './visit-stats';

export type FunnelStepMetrics = {
  stepId: string;
  label: string;
  kind: 'visit' | 'event';
  mediagoCode?: number;
  mediagoLabel?: string;
  eventSlugs: string[];
  totalEvents: number;
  uniqueVisitors: number;
  rateFromVisitsPct: string;
  dropOffFromPrevPct: string;
  postbacksSent: number;
  postbacksFailed: number;
  postbacksPending: number;
  revenue: number;
};

export type FunnelPostbackRow = {
  id: string;
  createdAt: string;
  eventType: string;
  stepLabel: string;
  mediagoCode?: number;
  clickId: string;
  campaignName: string;
  network: string;
  success: boolean;
  httpStatus: number | null;
  url: string;
  conversionStatus: string;
  revenue: number;
};

@Injectable()
export class FunnelAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventTypes: ConversionEventTypesService,
  ) {}

  private parseRange(from?: string, to?: string) {
    const toDate = to ? new Date(to) : new Date();
    const fromDate = from
      ? new Date(from)
      : new Date(toDate.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { fromDate, toDate };
  }

  private convWhere(
    campaignId: string | undefined,
    slugs: string[],
    from?: string,
    to?: string,
  ): Prisma.ConversionWhereInput {
    const { fromDate, toDate } = this.parseRange(from, to);
    return {
      ...(campaignId ? { campaignId } : {}),
      eventType: { in: slugs },
      createdAt: { gte: fromDate, lte: toDate },
      isTest: false,
    };
  }

  async getFunnel(campaignId?: string, from?: string, to?: string): Promise<{
    visits: number;
    uniqueVisits: number;
    steps: FunnelStepMetrics[];
    discoveredEvents: { slug: string; count: number; uniqueVisitors: number }[];
  }> {
    const visitStats = await getVisitStats(this.prisma, campaignId, from, to);
    const visits = visitStats.visits;
    const uniqueVisits = visitStats.uniqueVisits;

    const eventTypeDefs = await this.eventTypes.findAll(true);
    const configuredSlugs = new Set(eventTypeDefs.map((e) => e.slug));

    const { fromDate, toDate } = this.parseRange(from, to);
    const allConversions = await this.prisma.conversion.groupBy({
      by: ['eventType'],
      where: {
        ...(campaignId ? { campaignId } : {}),
        createdAt: { gte: fromDate, lte: toDate },
        isTest: false,
      },
      _count: { _all: true },
    });

    const funnelSlugs = new Set(
      LP_FUNNEL_STEPS.flatMap((s) => s.slugs || []),
    );
    const discoveredSlugs = allConversions
      .map((g) => g.eventType)
      .filter((slug) => !funnelSlugs.has(slug));

    const steps: FunnelStepMetrics[] = [];
    let prevUnique = visits;

    for (const stepDef of LP_FUNNEL_STEPS) {
      if (stepDef.kind === 'visit') {
        steps.push({
          stepId: stepDef.stepId,
          label: stepDef.label,
          kind: 'visit',
          eventSlugs: [],
          totalEvents: visits,
          uniqueVisitors: uniqueVisits,
          rateFromVisitsPct: '100.00',
          dropOffFromPrevPct: '0.00',
          postbacksSent: 0,
          postbacksFailed: 0,
          postbacksPending: 0,
          revenue: 0,
        });
        prevUnique = visits;
        continue;
      }

      const slugs = stepDef.slugs || [];
      const metrics = await this.metricsForStep(stepDef, slugs, campaignId, from, to, visits, prevUnique);
      steps.push(metrics);
      if (metrics.uniqueVisitors > 0) {
        prevUnique = metrics.uniqueVisitors;
      }
    }

    const discoveredEvents: { slug: string; count: number; uniqueVisitors: number }[] = [];
    for (const slug of discoveredSlugs) {
      if (configuredSlugs.has(slug)) continue;
      const where = this.convWhere(campaignId, [slug], from, to);
      const [count, groups] = await Promise.all([
        this.prisma.conversion.count({ where }),
        this.prisma.conversion.groupBy({
          by: ['clickId'],
          where,
        }),
      ]);
      if (count > 0) {
        discoveredEvents.push({ slug, count, uniqueVisitors: groups.length });
      }
    }

    return { visits, uniqueVisits, steps, discoveredEvents };
  }

  private async metricsForStep(
    stepDef: LpFunnelStepDef,
    slugs: string[],
    campaignId: string | undefined,
    from: string | undefined,
    to: string | undefined,
    visits: number,
    prevUnique: number,
  ): Promise<FunnelStepMetrics> {
    const where = this.convWhere(campaignId, slugs, from, to);

    const [totalEvents, visitorGroups, revenueAgg, conversions] = await Promise.all([
      this.prisma.conversion.count({ where }),
      this.prisma.conversion.groupBy({
        by: ['clickId'],
        where,
      }),
      this.prisma.conversion.aggregate({
        where,
        _sum: { revenue: true },
      }),
      this.prisma.conversion.findMany({
        where,
        select: {
          id: true,
          status: true,
          postbackLogs: { select: { success: true } },
        },
      }),
    ]);

    const uniqueVisitors = visitorGroups.length;
    let postbacksSent = 0;
    let postbacksFailed = 0;
    let postbacksPending = 0;

    for (const c of conversions) {
      if (c.postbackLogs.length === 0) {
        if (c.status === 'pending') postbacksPending++;
        else if (c.status === 'failed') postbacksFailed++;
        else if (c.status === 'skipped') postbacksPending++;
        continue;
      }
      const anySuccess = c.postbackLogs.some((l) => l.success);
      if (anySuccess) postbacksSent++;
      else postbacksFailed++;
    }

    const rateFromVisitsPct =
      visits > 0 ? ((uniqueVisitors / visits) * 100).toFixed(2) : '0.00';
    const dropOffFromPrevPct =
      prevUnique > 0
        ? (((prevUnique - uniqueVisitors) / prevUnique) * 100).toFixed(2)
        : '0.00';

    return {
      stepId: stepDef.stepId,
      label: stepDef.label,
      kind: 'event',
      mediagoCode: stepDef.mediagoCode,
      mediagoLabel: stepDef.mediagoCode ? mediagoLabelForCode(stepDef.mediagoCode) : undefined,
      eventSlugs: slugs,
      totalEvents,
      uniqueVisitors,
      rateFromVisitsPct,
      dropOffFromPrevPct,
      postbacksSent,
      postbacksFailed,
      postbacksPending,
      revenue: revenueAgg._sum.revenue || 0,
    };
  }

  async getRecentPostbacks(
    campaignId?: string,
    eventType?: string,
    from?: string,
    to?: string,
    limit = 50,
  ): Promise<FunnelPostbackRow[]> {
    const { fromDate, toDate } = this.parseRange(from, to);
    const slugs = eventType
      ? LP_FUNNEL_STEPS.find((s) => s.stepId === eventType)?.slugs || [eventType]
      : undefined;

    const logs = await this.prisma.postbackLog.findMany({
      where: {
        createdAt: { gte: fromDate, lte: toDate },
        conversion: {
          ...(campaignId ? { campaignId } : {}),
          ...(slugs ? { eventType: { in: slugs } } : {}),
        },
      },
      include: {
        conversion: {
          include: {
            campaign: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return logs.map((log) => {
      const step = LP_FUNNEL_STEPS.find((s) => s.slugs?.includes(log.conversion.eventType));
      return {
        id: log.id,
        createdAt: log.createdAt.toISOString(),
        eventType: log.conversion.eventType,
        stepLabel: step?.label || log.conversion.eventType,
        mediagoCode: step?.mediagoCode,
        clickId: log.conversion.clickId,
        campaignName: log.conversion.campaign.name,
        network: log.network,
        success: log.success,
        httpStatus: log.httpStatus,
        url: log.url,
        conversionStatus: log.conversion.status,
        revenue: log.conversion.revenue,
      };
    });
  }
}
