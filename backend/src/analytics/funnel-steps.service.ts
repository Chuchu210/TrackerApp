import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

export type RecordStepInput = {
  clickId: string;
  stepIndex: number;
  stepKey: string;
  stepLabel?: string;
};

export type FunnelStepRow = {
  stepIndex: number;
  stepKey: string;
  label: string;
  visits: number;
  /** Share of landing-page visits that reached this step. */
  rateFromVisitsPct: string;
  /** Share lost between the previous step and this one — where to optimise. */
  dropOffFromPrevPct: string;
};

const pct = (part: number, whole: number): string =>
  whole > 0 ? ((part / whole) * 100).toFixed(1) : '0.0';

@Injectable()
export class FunnelStepsService {
  private readonly logger = new Logger(FunnelStepsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Record that a visit reached a step. Idempotent per (click, step): a visitor
   * going back and forth through a quiz is counted once per step, so the numbers
   * read as "how many visits reached this step".
   */
  async record(input: RecordStepInput): Promise<{ recorded: boolean }> {
    const stepKey = input.stepKey.trim().slice(0, 100);
    if (!stepKey) return { recorded: false };

    const click = await this.prisma.click.findUnique({
      where: { clickId: input.clickId },
      select: { clickId: true, campaignId: true, isTest: true },
    });
    if (!click) return { recorded: false };

    // A step taken during a test session stays a test row, like clicks do.
    const isTest = click.isTest || (await this.settings.isTestMode());

    try {
      await this.prisma.funnelStepEvent.create({
        data: {
          clickId: click.clickId,
          campaignId: click.campaignId,
          stepIndex: Number.isFinite(input.stepIndex) ? Math.trunc(input.stepIndex) : 0,
          stepKey,
          stepLabel: input.stepLabel?.trim().slice(0, 200) || null,
          isTest,
        },
      });
      return { recorded: true };
    } catch {
      // Unique (clickId, stepKey) — the visitor already reached this step.
      return { recorded: false };
    }
  }

  /**
   * Step-by-step funnel for one campaign: how many landed, how many reached each
   * declared step, and where the drop-off happens.
   */
  async getStepFunnel(
    campaignId?: string,
    from?: string,
    to?: string,
    includeTest = false,
  ): Promise<{ visits: number; steps: FunnelStepRow[] }> {
    const toDate = to ? new Date(to) : new Date();
    const fromDate = from
      ? new Date(from)
      : new Date(toDate.getTime() - 7 * 24 * 60 * 60 * 1000);

    const testFilter = includeTest ? {} : { isTest: false };

    const visits = await this.prisma.click.count({
      where: {
        ...(campaignId ? { campaignId } : {}),
        createdAt: { gte: fromDate, lte: toDate },
        isBot: false,
        ...testFilter,
      },
    });

    const grouped = await this.prisma.funnelStepEvent.groupBy({
      by: ['stepIndex', 'stepKey'],
      where: {
        ...(campaignId ? { campaignId } : {}),
        createdAt: { gte: fromDate, lte: toDate },
        ...testFilter,
      },
      _count: { _all: true },
      orderBy: [{ stepIndex: 'asc' }, { stepKey: 'asc' }],
    });

    // Labels are per-step free text; take the most recent non-null one so a
    // renamed question does not split the step in two rows.
    const labels = new Map<string, string>();
    if (grouped.length > 0) {
      const labelRows = await this.prisma.funnelStepEvent.findMany({
        where: {
          ...(campaignId ? { campaignId } : {}),
          createdAt: { gte: fromDate, lte: toDate },
          stepLabel: { not: null },
          ...testFilter,
        },
        select: { stepKey: true, stepLabel: true },
        orderBy: { createdAt: 'desc' },
        distinct: ['stepKey'],
      });
      for (const row of labelRows) {
        if (row.stepLabel) labels.set(row.stepKey, row.stepLabel);
      }
    }

    let prev = visits;
    const steps: FunnelStepRow[] = grouped.map((row) => {
      const count = row._count._all;
      const step: FunnelStepRow = {
        stepIndex: row.stepIndex,
        stepKey: row.stepKey,
        label: labels.get(row.stepKey) || row.stepKey,
        visits: count,
        rateFromVisitsPct: pct(count, visits),
        dropOffFromPrevPct: prev > 0 ? pct(prev - count, prev) : '0.0',
      };
      prev = count;
      return step;
    });

    return { visits, steps };
  }
}
