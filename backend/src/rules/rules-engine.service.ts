import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AlertSeverity, AlertStatus, RuleMetric, RuleOperator, RuleScope } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PlacementAnalyticsService } from '../analytics/placement-analytics.service';
import { CampaignReportService } from '../analytics/campaign-report.service';
import { TargetsService } from '../targets/targets.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class RulesEngineService {
  private readonly logger = new Logger(RulesEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly placements: PlacementAnalyticsService,
    private readonly campaignReport: CampaignReportService,
    private readonly targets: TargetsService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('0 * * * *')
  async evaluateAll() {
    this.logger.log('Evaluating optimization rules');
    const rules = await this.prisma.optimizationRule.findMany({ where: { enabled: true } });
    const now = new Date();

    for (const rule of rules) {
      try {
        const from = new Date(
          now.getTime() - rule.windowHours * 60 * 60 * 1000,
        ).toISOString();
        await this.evaluateRule(rule, from, now.toISOString());
      } catch (err) {
        this.logger.error(`Rule ${rule.id} failed`, err);
      }
    }
  }

  private compareMetric(value: number, operator: RuleOperator, threshold: number): boolean {
    switch (operator) {
      case RuleOperator.lt:
        return value < threshold;
      case RuleOperator.lte:
        return value <= threshold;
      case RuleOperator.gt:
        return value > threshold;
      case RuleOperator.gte:
        return value >= threshold;
      default:
        return false;
    }
  }

  private async evaluateRule(
    rule: {
      id: string;
      scope: RuleScope;
      metric: RuleMetric;
      threshold: number;
      operator: RuleOperator;
      action: string;
      severity: AlertSeverity;
      campaignId: string | null;
      name: string;
    },
    from: string,
    to: string,
  ) {
    const filters = {
      from,
      to,
      ...(rule.campaignId ? { campaignId: rule.campaignId } : {}),
    };

    if (rule.metric === RuleMetric.spendNoEvents && rule.scope === RuleScope.site) {
      const report = await this.placements.getPlacements(filters, 'site');
      for (const row of report.rows.filter((r) => r.spend >= rule.threshold && r.events === 0)) {
        await this.createAlertIfNew({
          ruleId: rule.id,
          severity: rule.severity,
          scope: rule.scope,
          entityKey: row.key,
          entityLabel: row.label,
          title: `${rule.name}: ${row.label}`,
          message: `$${row.spend.toFixed(2)} spend with 0 events on site ${row.label}.`,
          suggestedAction: 'Add to blocklist in Mediago.',
          metricValue: row.spend,
          campaignId: rule.campaignId || undefined,
        });
      }
      return;
    }

    if (rule.metric === RuleMetric.botPct) {
      const dim = rule.scope === RuleScope.publisher ? 'publisher' : 'site';
      const report = await this.placements.getPlacements(filters, dim);
      for (const row of report.rows.filter((r) => parseFloat(r.botPct) >= rule.threshold)) {
        await this.createAlertIfNew({
          ruleId: rule.id,
          severity: rule.severity,
          scope: rule.scope,
          entityKey: row.key,
          entityLabel: row.label,
          title: `${rule.name}: ${row.label}`,
          message: `${row.botPct}% bot traffic on ${row.label} (${row.visits} visits).`,
          suggestedAction: 'Review publisher quality or block.',
          metricValue: parseFloat(row.botPct),
          campaignId: rule.campaignId || undefined,
        });
      }
      return;
    }

    if (rule.metric === RuleMetric.roi && rule.scope === RuleScope.campaign) {
      const { rows } = await this.campaignReport.getCampaignReport(from, to);
      for (const row of rows) {
        if (rule.campaignId && row.campaignId !== rule.campaignId) continue;
        if (!this.compareMetric(row.roi, rule.operator, rule.threshold) || row.cost < 5) continue;
        await this.createAlertIfNew({
          ruleId: rule.id,
          severity: rule.severity,
          scope: rule.scope,
          entityKey: row.campaignId,
          entityLabel: row.campaignName,
          title: `${rule.name}: ${row.campaignName}`,
          message: `ROI ${row.roi.toFixed(1)}% with $${row.cost.toFixed(2)} spend.`,
          suggestedAction: 'Reduce budget or pause campaign.',
          metricValue: row.roi,
          campaignId: row.campaignId,
        });
      }
      return;
    }

    if (rule.metric === RuleMetric.cpa && rule.scope === RuleScope.campaign) {
      const { rows } = await this.campaignReport.getCampaignReport(from, to);
      for (const row of rows) {
        if (rule.campaignId && row.campaignId !== rule.campaignId) continue;
        if (row.conversions === 0 || row.cost < 5) continue;
        const cpa = row.ecpc;
        if (!this.compareMetric(cpa, rule.operator, rule.threshold)) continue;
        await this.createAlertIfNew({
          ruleId: rule.id,
          severity: rule.severity,
          scope: rule.scope,
          entityKey: row.campaignId,
          entityLabel: row.campaignName,
          title: `${rule.name}: ${row.campaignName}`,
          message: `CPA $${cpa.toFixed(2)} with $${row.cost.toFixed(2)} spend and ${row.conversions} conversions.`,
          suggestedAction: 'Review targeting, creatives, or pause campaign.',
          metricValue: cpa,
          campaignId: row.campaignId,
        });
      }
      return;
    }

    if (rule.metric === RuleMetric.budgetPace && rule.scope === RuleScope.campaign) {
      const campaigns = rule.campaignId
        ? [{ id: rule.campaignId }]
        : await this.prisma.campaign.findMany({ where: { active: true }, select: { id: true } });

      for (const c of campaigns) {
        const pacing = await this.targets.getPacing(c.id);
        if (
          pacing.projectedBudgetPct != null &&
          pacing.projectedBudgetPct > rule.threshold
        ) {
          await this.createAlertIfNew({
            ruleId: rule.id,
            severity: rule.severity,
            scope: rule.scope,
            entityKey: c.id,
            entityLabel: c.id,
            title: `${rule.name}`,
            message: `Projected spend ${pacing.projectedBudgetPct.toFixed(0)}% of daily budget.`,
            suggestedAction: 'Reduce daily budget or pause low performers.',
            metricValue: pacing.projectedBudgetPct,
            campaignId: c.id,
          });
        }
      }
    }
  }

  private async createAlertIfNew(input: {
    ruleId: string;
    severity: AlertSeverity;
    scope: RuleScope;
    entityKey: string;
    entityLabel: string;
    title: string;
    message: string;
    suggestedAction: string;
    metricValue?: number;
    campaignId?: string;
  }) {
    const existing = await this.prisma.alertEvent.findFirst({
      where: {
        ruleId: input.ruleId,
        entityKey: input.entityKey,
        scope: input.scope,
        status: { in: [AlertStatus.open, AlertStatus.ack] },
      },
    });
    if (existing) return;

    const alert = await this.prisma.alertEvent.create({ data: input });
    // Best-effort external delivery (Telegram/webhook); never blocks alert creation.
    void this.notifications.dispatchAlert(alert);
  }
}
