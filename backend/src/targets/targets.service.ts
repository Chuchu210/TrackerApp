import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type UpsertCampaignTargetDto = {
  dailyBudget?: number | null;
  cpaTarget?: number | null;
  roasTarget?: number | null;
  currency?: string;
};

@Injectable()
export class TargetsService {
  constructor(private readonly prisma: PrismaService) {}

  findByCampaign(campaignId: string) {
    return this.prisma.campaignTarget.findUnique({ where: { campaignId } });
  }

  upsert(campaignId: string, dto: UpsertCampaignTargetDto) {
    return this.prisma.campaignTarget.upsert({
      where: { campaignId },
      create: {
        campaignId,
        dailyBudget: dto.dailyBudget ?? undefined,
        cpaTarget: dto.cpaTarget ?? undefined,
        roasTarget: dto.roasTarget ?? undefined,
        currency: dto.currency || 'USD',
      },
      update: {
        dailyBudget: dto.dailyBudget ?? undefined,
        cpaTarget: dto.cpaTarget ?? undefined,
        roasTarget: dto.roasTarget ?? undefined,
        currency: dto.currency || undefined,
      },
    });
  }

  async getPacing(campaignId: string, day?: string) {
    const target = await this.findByCampaign(campaignId);
    const dayStart = day ? new Date(day) : new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);

    const spendAgg = await this.prisma.campaignSpendSnapshot.aggregate({
      where: {
        campaignId,
        date: { gte: dayStart, lte: dayEnd },
      },
      _sum: { spend: true },
    });

    const hourlyRows = await this.prisma.campaignSpendSnapshot.findMany({
      where: {
        campaignId,
        date: { gte: dayStart, lte: dayEnd },
        hour: { gte: 0 },
      },
      select: { hour: true, spend: true },
    });

    const spendSoFar = spendAgg._sum.spend || 0;
    const now = new Date();
    const elapsedHours =
      dayStart.toDateString() === now.toDateString()
        ? Math.max(1, now.getHours() + now.getMinutes() / 60)
        : 24;
    const projectedSpend = (spendSoFar / elapsedHours) * 24;

    const convAgg = await this.prisma.conversion.aggregate({
      where: {
        campaignId,
        createdAt: { gte: dayStart, lte: dayEnd },
        isTest: false,
      },
      _count: { _all: true },
      _sum: { revenue: true },
    });

    const events = convAgg._count._all;
    const revenue = convAgg._sum.revenue || 0;
    const cpaActual = events > 0 ? spendSoFar / events : 0;
    const roasActual = spendSoFar > 0 ? revenue / spendSoFar : 0;

    const dailyBudget = target?.dailyBudget ?? null;
    const budgetPct = dailyBudget && dailyBudget > 0 ? (spendSoFar / dailyBudget) * 100 : null;
    const projectedBudgetPct =
      dailyBudget && dailyBudget > 0 ? (projectedSpend / dailyBudget) * 100 : null;

    return {
      campaignId,
      date: dayStart.toISOString().slice(0, 10),
      target,
      spendSoFar,
      projectedSpend,
      dailyBudget,
      budgetPct,
      projectedBudgetPct,
      events,
      revenue,
      cpaActual,
      roasActual,
      cpaTarget: target?.cpaTarget ?? null,
      roasTarget: target?.roasTarget ?? null,
      onTrack:
        dailyBudget != null
          ? projectedSpend <= dailyBudget * 1.05
          : target?.cpaTarget != null
            ? cpaActual <= target.cpaTarget * 1.1
            : null,
    };
  }
}
