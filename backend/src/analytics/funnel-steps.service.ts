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
  kind: 'arrival' | 'question';
  stepIndex: number;
  stepKey: string;
  label: string;
  /** People who reached this step (LP arrivals on the first row). */
  visits: number;
  /** People who reached the previous step. */
  previousReached: number;
  /** People who were on the previous step and never reached this one. */
  leftHere: number;
  /** Share of landing-page arrivals still present at this step. */
  rateFromVisitsPct: string;
  /** Share of the previous step that did not continue. */
  dropOffFromPrevPct: string;
};

export type QuestionFunnelLander = {
  id: string;
  name: string;
};

export type QuestionFunnelReport = {
  visits: number;
  steps: FunnelStepRow[];
  landers: QuestionFunnelLander[];
  worstDrop: {
    stepKey: string;
    label: string;
    leftHere: number;
    dropOffFromPrevPct: string;
  } | null;
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
    landerId?: string,
  ): Promise<QuestionFunnelReport> {
    const toDate = to ? new Date(to) : new Date();
    const fromDate = from
      ? new Date(from)
      : new Date(toDate.getTime() - 7 * 24 * 60 * 60 * 1000);

    const testFilter = includeTest ? {} : { isTest: false };
    const clickScope = {
      ...(campaignId ? { campaignId } : {}),
      ...(landerId ? { landerId } : {}),
      createdAt: { gte: fromDate, lte: toDate },
      isBot: false,
      ...testFilter,
    };
    const stepScope = {
      ...(campaignId ? { campaignId } : {}),
      ...(landerId ? { click: { is: { landerId } } } : {}),
      createdAt: { gte: fromDate, lte: toDate },
      ...testFilter,
    };

    const [visits, landerRows] = await Promise.all([
      this.prisma.click.count({ where: clickScope }),
      this.prisma.click.findMany({
        where: {
          ...(campaignId ? { campaignId } : {}),
          createdAt: { gte: fromDate, lte: toDate },
          isBot: false,
          landerId: { not: null },
          ...testFilter,
        },
        distinct: ['landerId'],
        select: { landerId: true, landerName: true },
        take: 80,
      }),
    ]);

    const grouped = await this.prisma.funnelStepEvent.groupBy({
      by: ['stepIndex', 'stepKey'],
      where: stepScope,
      _count: { _all: true },
      orderBy: [{ stepIndex: 'asc' }, { stepKey: 'asc' }],
    });

    // Labels are per-step free text; take the most recent non-null one so a
    // renamed question does not split the step in two rows.
    const labels = new Map<string, string>();
    if (grouped.length > 0) {
      const labelRows = await this.prisma.funnelStepEvent.findMany({
        where: {
          ...stepScope,
          stepLabel: { not: null },
        },
        select: { stepKey: true, stepLabel: true },
        orderBy: { createdAt: 'desc' },
        distinct: ['stepKey'],
      });
      for (const row of labelRows) {
        if (row.stepLabel) labels.set(row.stepKey, row.stepLabel);
      }
    }

    const questions: FunnelStepRow[] = [];
    let prev = visits;
    for (const row of grouped) {
      const count = row._count._all;
      const leftHere = Math.max(0, prev - count);
      questions.push({
        kind: 'question',
        stepIndex: row.stepIndex,
        stepKey: row.stepKey,
        label: labels.get(row.stepKey) || row.stepKey,
        visits: count,
        previousReached: prev,
        leftHere,
        rateFromVisitsPct: pct(count, visits),
        dropOffFromPrevPct: prev > 0 ? pct(leftHere, prev) : '0.0',
      });
      prev = count;
    }

    const arrival: FunnelStepRow = {
      kind: 'arrival',
      stepIndex: 0,
      stepKey: 'lp_arrival',
      label: 'Arrived on LP',
      visits,
      previousReached: visits,
      leftHere: 0,
      rateFromVisitsPct: visits > 0 ? '100.0' : '0.0',
      dropOffFromPrevPct: '0.0',
    };

    const steps = [arrival, ...questions];
    const worstDrop =
      questions
        .filter((step) => step.leftHere > 0)
        .sort((a, b) => {
          const dropDelta = parseFloat(b.dropOffFromPrevPct) - parseFloat(a.dropOffFromPrevPct);
          if (dropDelta !== 0) return dropDelta;
          return b.leftHere - a.leftHere;
        })[0] ?? null;

    return {
      visits,
      steps,
      landers: landerRows
        .filter((row): row is { landerId: string; landerName: string | null } => Boolean(row.landerId))
        .map((row) => ({
          id: row.landerId,
          name: row.landerName || row.landerId,
        })),
      worstDrop: worstDrop
        ? {
            stepKey: worstDrop.stepKey,
            label: worstDrop.label,
            leftHere: worstDrop.leftHere,
            dropOffFromPrevPct: worstDrop.dropOffFromPrevPct,
          }
        : null,
    };
  }
}
