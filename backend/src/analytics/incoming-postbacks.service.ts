import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type IncomingPostbackFilters = {
  campaignId?: string;
  eventType?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

/**
 * Analysis of the server-to-server postbacks affiliate networks send us
 * (GET /postback and /postback/:clickId). Those land as conversions carrying
 * `incomingPostbackUrl`, so this reads existing rows rather than introducing
 * a separate log table — and it deliberately covers only what we receive,
 * not anything forwarded onwards.
 */
@Injectable()
export class IncomingPostbacksService {
  constructor(private readonly prisma: PrismaService) {}

  private buildWhere(filters: IncomingPostbackFilters): Prisma.ConversionWhereInput {
    const where: Prisma.ConversionWhereInput = {
      // Only conversions that actually arrived over an incoming postback.
      incomingPostbackUrl: { not: null },
    };
    if (filters.campaignId) where.campaignId = filters.campaignId;
    if (filters.eventType) where.eventType = filters.eventType;
    if (filters.from || filters.to) {
      where.createdAt = {
        ...(filters.from ? { gte: new Date(filters.from) } : {}),
        ...(filters.to ? { lte: new Date(filters.to) } : {}),
      };
    }
    return where;
  }

  async list(filters: IncomingPostbackFilters) {
    const where = this.buildWhere(filters);

    const [items, total] = await Promise.all([
      this.prisma.conversion.findMany({
        where,
        select: {
          id: true,
          clickId: true,
          eventType: true,
          status: true,
          revenue: true,
          currency: true,
          transactionId: true,
          incomingPostbackIp: true,
          incomingPostbackUrl: true,
          postbackParam1: true,
          postbackParam2: true,
          postbackParam3: true,
          createdAt: true,
          campaign: { select: { id: true, name: true, slug: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: filters.limit || 50,
        skip: filters.offset || 0,
      }),
      this.prisma.conversion.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * Per-campaign rollup with an event-type breakdown, so it's obvious which
   * network/campaign is sending what — and which postbacks failed to send on.
   */
  async summary(filters: IncomingPostbackFilters) {
    const where = this.buildWhere(filters);

    const grouped = await this.prisma.conversion.groupBy({
      by: ['campaignId', 'eventType', 'status'],
      where,
      _count: { _all: true },
      _sum: { revenue: true },
    });

    const campaignIds = [...new Set(grouped.map((row) => row.campaignId))];
    const campaigns = await this.prisma.campaign.findMany({
      where: { id: { in: campaignIds } },
      select: { id: true, name: true, slug: true },
    });
    const campaignById = new Map(campaigns.map((c) => [c.id, c]));

    const byCampaign = new Map<
      string,
      {
        campaignId: string;
        campaignName: string;
        campaignSlug: string;
        total: number;
        revenue: number;
        failed: number;
        byEventType: Record<string, number>;
      }
    >();

    for (const row of grouped) {
      const campaign = campaignById.get(row.campaignId);
      const entry = byCampaign.get(row.campaignId) || {
        campaignId: row.campaignId,
        campaignName: campaign?.name || 'Unknown',
        campaignSlug: campaign?.slug || '',
        total: 0,
        revenue: 0,
        failed: 0,
        byEventType: {},
      };

      const count = row._count._all;
      entry.total += count;
      entry.revenue += row._sum.revenue || 0;
      if (row.status === 'failed') entry.failed += count;
      entry.byEventType[row.eventType] =
        (entry.byEventType[row.eventType] || 0) + count;

      byCampaign.set(row.campaignId, entry);
    }

    const items = [...byCampaign.values()].sort((a, b) => b.total - a.total);
    const totals = items.reduce(
      (acc, row) => ({
        total: acc.total + row.total,
        revenue: acc.revenue + row.revenue,
        failed: acc.failed + row.failed,
      }),
      { total: 0, revenue: 0, failed: 0 },
    );

    return { items, totals };
  }
}
