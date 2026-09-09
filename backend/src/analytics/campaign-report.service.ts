import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConversionEventTypesService } from '../conversion-event-types/conversion-event-types.service';
import { getVisitStats } from './visit-stats';
import { resolveReportTimezone } from '../shared/tracking/report-timezone';
import { SettingsService } from '../settings/settings.service';
import {
  aggregateDrilldownRows,
  buildEventColumns,
  getDrilldownDimension,
  type DrilldownDimensionId,
} from './campaign-drilldown.util';
import { attributedCampaignClickWhere } from '../shared/tracking/traffic-source-from-query';

export type CampaignReportRow = {
  campaignId: string;
  campaignName: string;
  marker: string;
  cpc: number;
  visits: number;
  uniqueVisits: number;
  suspiciousVisits: number;
  suspiciousPct: string;
  conversions: number;
  cost: number;
  revenue: number;
  profit: number;
  roi: number;
  cv: number;
  epv: number;
  cpv: number;
  ecpc: number;
  errors: number;
  txTransfo: number;
  impressions: number;
  platformClicks: number;
  countByEvent: Record<string, number>;
  revenueByEvent: Record<string, number>;
};

export type EventColumnDef = {
  slug: string;
  countLabel: string;
  revenueLabel: string;
};

const TRANSACTION_EVENT_SLUGS = new Set(['sale', 'sales', 'purchase']);

function countLabelFromEvent(slug: string, displayLabel: string): string {
  if (displayLabel.endsWith(' revenue')) {
    return displayLabel.slice(0, -' revenue'.length);
  }
  const known: Record<string, string> = {
    lead: 'Lead',
    sale: 'Sales',
    sales: 'Sales',
    purchase: 'Purchase',
    viewcontent: 'ViewCONTENT',
    postalcode: 'PostalCode',
    account_opening: 'account_opening',
    account_validated: 'account_validated',
    age_60: 'Age_60',
    hearing_loss: 'Hearing_loss',
    test: 'test',
    click_button: 'Click Button',
    quiz_started: 'Quiz started',
    quiz_q2: 'Question 2',
    quiz_q3: 'Question 3',
    call_click: 'Call started',
    call_started: 'Call started',
    call_connected: 'Call Connected',
  };
  return known[slug] || slug;
}

export type TimeseriesPoint = {
  bucket: string;
  impressions: number;
  visits: number;
  clicks: number;
  conversions: number;
  revenue: number;
  cost: number;
  profit: number;
};

@Injectable()
export class CampaignReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventTypes: ConversionEventTypesService,
    private readonly settings: SettingsService,
  ) {}

  private parseRange(from?: string, to?: string) {
    const toDate = to ? new Date(to) : new Date();
    const fromDate = from
      ? new Date(from)
      : new Date(toDate.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { fromDate, toDate };
  }

  private clickBase(
    from?: string,
    to?: string,
    excludeBots?: boolean,
  ): Prisma.ClickWhereInput {
    const { fromDate, toDate } = this.parseRange(from, to);
    return {
      createdAt: { gte: fromDate, lte: toDate },
      ...(excludeBots ? { isBot: false } : {}),
      // Test rows never reach a report. This is the campaign table everyone
      // reads spend and ROI off, so it is the last place a rehearsal should
      // show up.
      isTest: false,
    };
  }

  private clickWhere(
    campaignId?: string,
    from?: string,
    to?: string,
    excludeBots?: boolean,
  ): Prisma.ClickWhereInput {
    return {
      ...this.clickBase(from, to, excludeBots),
      ...(campaignId ? { campaignId } : {}),
    };
  }

  private reportClickWhere(
    campaign: {
      id: string;
      trafficSource: string;
      destinationUrl: string;
      slug: string;
      name: string;
      externalId?: string | null;
    },
    allCampaigns: Array<{
      id: string;
      trafficSource: string;
      destinationUrl: string;
      slug: string;
      name: string;
      externalId?: string | null;
    }>,
    from?: string,
    to?: string,
    excludeBots?: boolean,
  ): Prisma.ClickWhereInput {
    return attributedCampaignClickWhere(
      campaign,
      allCampaigns,
      this.clickBase(from, to, excludeBots),
    );
  }

  private convWhere(
    campaignId?: string,
    from?: string,
    to?: string,
    excludeBots?: boolean,
  ): Prisma.ConversionWhereInput {
    const { fromDate, toDate } = this.parseRange(from, to);
    const clickFilter: Prisma.ClickWhereInput = {
      ...(campaignId ? { campaignId } : {}),
      createdAt: { gte: fromDate, lte: toDate },
      ...(excludeBots ? { isBot: false } : {}),
      isTest: false,
    };
    return {
      ...(campaignId ? { campaignId } : {}),
      createdAt: { gte: fromDate, lte: toDate },
      ...(excludeBots ? { click: { is: clickFilter } } : {}),
      isTest: false,
    };
  }

  private reportConvWhere(
    clickWhere: Prisma.ClickWhereInput,
    from?: string,
    to?: string,
  ): Prisma.ConversionWhereInput {
    const { fromDate, toDate } = this.parseRange(from, to);
    return {
      createdAt: { gte: fromDate, lte: toDate },
      isTest: false,
      click: { is: clickWhere },
    };
  }

  private spendWhere(campaignId?: string, from?: string, to?: string): Prisma.CampaignSpendSnapshotWhereInput {
    const { fromDate, toDate } = this.parseRange(from, to);
    return {
      ...(campaignId ? { campaignId } : {}),
      date: { gte: fromDate, lte: toDate },
    };
  }

  async getCampaignReport(
    from?: string,
    to?: string,
    workspace?: string,
    excludeBots?: boolean,
  ): Promise<{
    rows: CampaignReportRow[];
    eventColumns: EventColumnDef[];
  }> {
    const eventTypeDefs = await this.eventTypes.findAll();
    const campaigns = await this.prisma.campaign.findMany({
      where: workspace ? { workspaceName: workspace } : undefined,
      include: { trafficSourceProfile: true },
      orderBy: { name: 'asc' },
    });

    const rows: CampaignReportRow[] = [];

    for (const campaign of campaigns) {
      const clickWhere = this.reportClickWhere(campaign, campaigns, from, to, excludeBots);
      const convWhere = this.reportConvWhere(clickWhere, from, to);
      const convCountWhere = await this.eventTypes.applyConversionCountFilter(convWhere);
      const spendWhere = this.spendWhere(campaign.id, from, to);

      const [
        visits,
        suspiciousVisits,
        visitorGroups,
        legacyVisits,
        conversions,
        errors,
        revenueAgg,
        costFromConv,
        spendAgg,
      ] = await Promise.all([
        this.prisma.click.count({ where: clickWhere }),
        this.prisma.click.count({ where: { ...clickWhere, isBot: true } }),
        this.prisma.click.groupBy({
          by: ['visitorId'],
          where: { ...clickWhere, visitorId: { not: null } },
        }),
        this.prisma.click.count({ where: { ...clickWhere, visitorId: null } }),
        this.prisma.conversion.count({ where: convCountWhere }),
        this.prisma.conversion.count({ where: { ...convWhere, status: 'failed' } }),
        this.prisma.conversion.aggregate({
          where: convWhere,
          _sum: { revenue: true },
        }),
        this.prisma.conversion.aggregate({
          where: convWhere,
          _sum: { cost: true },
        }),
        this.prisma.campaignSpendSnapshot.aggregate({
          where: spendWhere,
          _sum: { spend: true, impressions: true, clicks: true },
        }),
      ]);

      const uniqueVisits = visitorGroups.length + legacyVisits;
      const revenue = revenueAgg._sum.revenue || 0;
      const spendCost = spendAgg._sum.spend || 0;
      const convCost = costFromConv._sum.cost || 0;
      const cost = spendCost > 0 ? spendCost : convCost;
      const impressions = spendAgg._sum.impressions || 0;
      const platformClicks = spendAgg._sum.clicks || 0;
      const profit = revenue - cost;

      const countByEventRows = await this.prisma.conversion.groupBy({
        by: ['eventType'],
        where: convWhere,
        _count: { _all: true },
        _sum: { revenue: true },
      });

      const countByEvent: Record<string, number> = {};
      const revenueByEvent: Record<string, number> = {};
      let transactionConversions = 0;
      for (const g of countByEventRows) {
        const count = g._count._all;
        countByEvent[g.eventType] = count;
        revenueByEvent[g.eventType] = g._sum.revenue || 0;
        if (TRANSACTION_EVENT_SLUGS.has(g.eventType)) {
          transactionConversions += count;
        }
      }

      const suspiciousPct =
        visits > 0 ? ((suspiciousVisits / visits) * 100).toFixed(2) : '0.00';

      rows.push({
        campaignId: campaign.id,
        campaignName: campaign.name,
        marker: campaign.trafficSourceProfile?.name || campaign.trafficSourceName || campaign.trafficSource,
        cpc: platformClicks > 0 ? cost / platformClicks : 0,
        visits,
        uniqueVisits,
        suspiciousVisits,
        suspiciousPct,
        conversions,
        cost,
        revenue,
        profit,
        roi: cost > 0 ? ((revenue - cost) / cost) * 100 : 0,
        cv: visits > 0 ? (conversions / visits) * 100 : 0,
        epv: visits > 0 ? revenue / visits : 0,
        cpv: visits > 0 ? cost / visits : 0,
        ecpc: conversions > 0 ? cost / conversions : 0,
        errors,
        txTransfo: visits > 0 ? (transactionConversions / visits) * 100 : 0,
        impressions,
        platformClicks,
        countByEvent,
        revenueByEvent,
      });
    }

    const discovered = new Set<string>();
    for (const row of rows) {
      for (const slug of Object.keys(row.revenueByEvent)) discovered.add(slug);
    }

    const eventColumns: EventColumnDef[] = [
      ...eventTypeDefs.map((e) => ({
        slug: e.slug,
        countLabel: countLabelFromEvent(e.slug, e.displayLabel),
        revenueLabel: e.displayLabel.endsWith(' revenue')
          ? e.displayLabel
          : `${countLabelFromEvent(e.slug, e.displayLabel)} revenue`,
      })),
      ...[...discovered]
        .filter((s) => !eventTypeDefs.some((e) => e.slug === s))
        .sort()
        .map((slug) => ({
          slug,
          countLabel: countLabelFromEvent(slug, `${slug} revenue`),
          revenueLabel: `${countLabelFromEvent(slug, `${slug} revenue`)} revenue`,
        })),
    ];

    return { rows, eventColumns };
  }

  async getTimeseries(
    from?: string,
    to?: string,
    granularity: 'hour' | 'day' = 'hour',
    campaignId?: string,
    timezone?: string,
  ): Promise<TimeseriesPoint[]> {
    const { fromDate, toDate } = this.parseRange(from, to);
    const conversionSlugs = await this.eventTypes.getConversionCountSlugs();
    const slugList =
      conversionSlugs.length > 0 ? conversionSlugs : ['__no_conversion_slugs__'];
    const truncUnit = granularity === 'day' ? 'day' : 'hour';
    const tz = resolveReportTimezone(
      timezone,
      (await this.settings.getEffective()).reportTimezone,
    );

    // Bucket by report timezone. UTC keeps the legacy (no-conversion) behavior;
    // other zones reinterpret the stored UTC timestamp into local wall-clock.
    const clickBucketExpr =
      tz === 'UTC'
        ? Prisma.sql`date_trunc(${truncUnit}, created_at)`
        : Prisma.sql`date_trunc(${truncUnit}, created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tz})`;
    const convBucketExpr =
      tz === 'UTC'
        ? Prisma.sql`date_trunc(${truncUnit}, cv.created_at)`
        : Prisma.sql`date_trunc(${truncUnit}, cv.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tz})`;

    // The Prisma-side helpers (clickWhere/convWhere) drop test rows; these raw
    // timeseries queries bypass them entirely, so the same rule is restated
    // here — otherwise the chart and the table above it disagree.
    const clickConditions: Prisma.Sql[] = [
      Prisma.sql`created_at >= ${fromDate}`,
      Prisma.sql`created_at <= ${toDate}`,
      Prisma.sql`is_test = false`,
    ];
    const convConditions: Prisma.Sql[] = [
      Prisma.sql`cv.created_at >= ${fromDate}`,
      Prisma.sql`cv.created_at <= ${toDate}`,
      Prisma.sql`cv.is_test = false`,
    ];
    const spendConditions: Prisma.Sql[] = [
      Prisma.sql`date >= ${fromDate}`,
      Prisma.sql`date <= ${toDate}`,
    ];
    if (campaignId) {
      clickConditions.push(Prisma.sql`campaign_id = ${campaignId}`);
      convConditions.push(Prisma.sql`cv.campaign_id = ${campaignId}`);
      spendConditions.push(Prisma.sql`campaign_id = ${campaignId}`);
    }

    const [clickBuckets, conversionBuckets, spendRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ bucket: Date; visits: number }>>`
        SELECT ${clickBucketExpr} AS bucket, COUNT(*)::int AS visits
        FROM clicks
        WHERE ${Prisma.join(clickConditions, ' AND ')}
        GROUP BY 1
        ORDER BY 1
        LIMIT 10000
      `,
      this.prisma.$queryRaw<
        Array<{ bucket: Date; conversions: number; revenue: number; cost: number }>
      >`
        SELECT
          ${convBucketExpr} AS bucket,
          COUNT(*)::int AS conversions,
          COALESCE(SUM(COALESCE(cv.revenue_base, cv.revenue)), 0)::float AS revenue,
          COALESCE(SUM(COALESCE(cv.cost_base, cv.cost)), 0)::float AS cost
        FROM conversions cv
        WHERE ${Prisma.join(convConditions, ' AND ')}
          AND cv.event_type IN (${Prisma.join(slugList)})
        GROUP BY 1
        ORDER BY 1
        LIMIT 10000
      `,
      this.prisma.campaignSpendSnapshot.findMany({
        where: {
          ...(campaignId ? { campaignId } : {}),
          date: { gte: fromDate, lte: toDate },
        },
        select: { date: true, hour: true, impressions: true, clicks: true, spend: true },
        take: 10000,
      }),
    ]);

    const buckets = new Map<string, TimeseriesPoint>();

    const bucketKey = (d: Date, hour?: number | null) => {
      if (granularity === 'day') {
        return d.toISOString().slice(0, 10);
      }
      const h = hour ?? d.getUTCHours();
      return `${d.toISOString().slice(0, 10)}T${String(h).padStart(2, '0')}:00`;
    };

    const ensure = (key: string): TimeseriesPoint => {
      let p = buckets.get(key);
      if (!p) {
        p = {
          bucket: key,
          impressions: 0,
          visits: 0,
          clicks: 0,
          conversions: 0,
          revenue: 0,
          cost: 0,
          profit: 0,
        };
        buckets.set(key, p);
      }
      return p;
    };

    for (const row of clickBuckets) {
      const p = ensure(bucketKey(row.bucket));
      p.visits = row.visits;
    }

    for (const row of conversionBuckets) {
      const p = ensure(bucketKey(row.bucket));
      p.conversions = row.conversions;
      p.revenue = row.revenue;
      p.cost += row.cost;
      p.profit = p.revenue - p.cost;
    }

    for (const s of spendRows) {
      const p = ensure(bucketKey(s.date, s.hour));
      p.impressions += s.impressions;
      p.clicks += s.clicks;
      p.cost += s.spend;
      p.profit = p.revenue - p.cost;
    }

    return [...buckets.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
  }

  async getGlobalRollup(from?: string, to?: string, excludeBots?: boolean) {
    const clickWhere = this.clickWhere(undefined, from, to, excludeBots);
    const convWhere = this.convWhere(undefined, from, to, excludeBots);
    const convCountWhere = await this.eventTypes.applyConversionCountFilter(convWhere);
    const spendWhere = this.spendWhere(undefined, from, to);

    const [visitStats, conversions, sentConversions, revenueAgg, spendAgg, convCostAgg, suspiciousVisits] =
      await Promise.all([
        getVisitStats(this.prisma, undefined, from, to, excludeBots),
        this.prisma.conversion.count({ where: convCountWhere }),
        this.prisma.conversion.count({ where: { ...convCountWhere, status: 'sent' } }),
        this.prisma.conversion.aggregate({ where: convWhere, _sum: { revenue: true, cost: true } }),
        this.prisma.campaignSpendSnapshot.aggregate({
          where: spendWhere,
          _sum: { spend: true, impressions: true, clicks: true },
        }),
        this.prisma.conversion.aggregate({ where: convWhere, _sum: { cost: true } }),
        this.prisma.click.count({ where: { ...clickWhere, isBot: true } }),
      ]);

    const { visits, uniqueVisits, newVisitors, returningVisitors } = visitStats;
    const revenue = revenueAgg._sum.revenue || 0;
    const spendCost = spendAgg._sum.spend || 0;
    const cost = spendCost > 0 ? spendCost : convCostAgg._sum.cost || 0;
    const impressions = spendAgg._sum.impressions || 0;
    const platformClicks = spendAgg._sum.clicks || 0;
    const profit = revenue - cost;

    return {
      impressions,
      visits,
      uniqueVisits,
      newVisitors,
      returningVisitors,
      suspiciousVisits,
      clicks: platformClicks,
      conversions,
      revenue,
      cost,
      profit,
      conversionRate: visits > 0 ? ((conversions / visits) * 100).toFixed(2) : '0',
      sentConversions,
    };
  }

  exportCampaignReportCsv(from?: string, to?: string, workspace?: string): Promise<string> {
    return this.getCampaignReport(from, to, workspace).then(({ rows, eventColumns }) => {
      const baseHeaders = [
        'Campaign name',
        'Marker',
        'CPC',
        'Visits',
        'Unique visits',
        'Suspicious visits',
        'Suspicious %',
        'Conversions',
        'Cost',
        'Revenue',
        'Profit',
        'ROI %',
        'CV %',
        'EPV',
        'CPV',
        'Errors',
        'eCPC',
        'Tx Transfo %',
        'Impressions',
      ];
      const eventHeaders = eventColumns.flatMap((c) => [c.countLabel, c.revenueLabel]);
      const lines = [[...baseHeaders, ...eventHeaders].join(',')];

      for (const row of rows) {
        const base = [
          this.csvEscape(row.campaignName),
          this.csvEscape(row.marker),
          row.cpc.toFixed(4),
          row.visits,
          row.uniqueVisits,
          row.suspiciousVisits,
          row.suspiciousPct,
          row.conversions,
          row.cost.toFixed(4),
          row.revenue.toFixed(4),
          row.profit.toFixed(4),
          row.roi.toFixed(2),
          row.cv.toFixed(2),
          row.epv.toFixed(6),
          row.cpv.toFixed(6),
          row.errors,
          row.ecpc.toFixed(4),
          row.txTransfo.toFixed(2),
          row.impressions,
        ];
        const events = eventColumns.flatMap((c) => [
          row.countByEvent[c.slug] || 0,
          (row.revenueByEvent[c.slug] || 0).toFixed(4),
        ]);
        lines.push([...base, ...events].join(','));
      }

      return lines.join('\n');
    });
  }

  private csvEscape(value: string) {
    if (value.includes(',') || value.includes('"')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  async getCampaignDrilldownReport(
    campaignId: string,
    dimension: DrilldownDimensionId,
    from?: string,
    to?: string,
    excludeBots?: boolean,
  ): Promise<{
    rows: CampaignReportRow[];
    eventColumns: EventColumnDef[];
    campaign: { id: string; name: string } | null;
    dimension: DrilldownDimensionId;
  }> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: {
        id: true,
        name: true,
        slug: true,
        destinationUrl: true,
        externalId: true,
        trafficSourceName: true,
        trafficSource: true,
        trafficSourceProfile: { select: { name: true } },
      },
    });
    if (!campaign) {
      return { rows: [], eventColumns: [], campaign: null, dimension };
    }

    const allCampaigns = await this.prisma.campaign.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        destinationUrl: true,
        externalId: true,
        trafficSource: true,
      },
    });

    const eventTypeDefs = await this.eventTypes.findAll();
    const conversionSlugs = new Set(
      await this.eventTypes.getConversionCountSlugs(),
    );
    const clickWhere = this.reportClickWhere(campaign, allCampaigns, from, to, excludeBots);
    const convWhere = this.reportConvWhere(clickWhere, from, to);

    const [clicks, conversions] = await Promise.all([
      this.prisma.click.findMany({
        where: clickWhere,
        select: {
          clickId: true,
          offerId: true,
          offerName: true,
          landerId: true,
          landerName: true,
          pathId: true,
          affiliateNetworkId: true,
          affiliateNetwork: true,
          countryCode: true,
          country: true,
          ipAddress: true,
          device: true,
          os: true,
          browser: true,
          referrer: true,
          acceptLanguage: true,
          connectionType: true,
          externalClickId: true,
          gclid: true,
          fbclid: true,
          trackingId: true,
          customVariable1: true,
          customVariable2: true,
          customVariable3: true,
          customVariable4: true,
          customVariable5: true,
          customVariable6: true,
          customVariable7: true,
          customVariable8: true,
          customVariable9: true,
          customVariable10: true,
          visitorId: true,
          isBot: true,
          campaignExternalId: true,
          utmCampaign: true,
          adsetId: true,
          adsetName: true,
          adId: true,
          adTitle: true,
        },
      }),
      this.prisma.conversion.findMany({
        where: convWhere,
        select: {
          clickId: true,
          eventType: true,
          revenue: true,
          cost: true,
          status: true,
          transactionId: true,
          postbackParam1: true,
          postbackParam2: true,
          postbackParam3: true,
          postbackParam4: true,
          postbackParam5: true,
          click: {
            select: {
              clickId: true,
              offerId: true,
              offerName: true,
              landerId: true,
              landerName: true,
              pathId: true,
              affiliateNetworkId: true,
              affiliateNetwork: true,
              countryCode: true,
              country: true,
              ipAddress: true,
              device: true,
              os: true,
              browser: true,
              referrer: true,
              acceptLanguage: true,
              connectionType: true,
              externalClickId: true,
              gclid: true,
              fbclid: true,
              trackingId: true,
              customVariable1: true,
              customVariable2: true,
              customVariable3: true,
              customVariable4: true,
              customVariable5: true,
              customVariable6: true,
              customVariable7: true,
              customVariable8: true,
              customVariable9: true,
              customVariable10: true,
              visitorId: true,
              isBot: true,
              campaignExternalId: true,
              utmCampaign: true,
              adsetId: true,
              adsetName: true,
              adId: true,
              adTitle: true,
            },
          },
        },
      }),
    ]);

    const marker =
      campaign.trafficSourceProfile?.name ||
      campaign.trafficSourceName ||
      campaign.trafficSource;

    const rows = aggregateDrilldownRows({
      dimension,
      marker,
      clicks,
      conversions: conversions.map((row) => ({
        clickId: row.clickId,
        eventType: row.eventType,
        revenue: row.revenue,
        cost: row.cost,
        status: row.status,
        transactionId: row.transactionId,
        postbackParam1: row.postbackParam1,
        postbackParam2: row.postbackParam2,
        postbackParam3: row.postbackParam3,
        postbackParam4: row.postbackParam4,
        postbackParam5: row.postbackParam5,
        countsAsConversion:
          conversionSlugs.size === 0 || conversionSlugs.has(row.eventType),
        click: row.click,
      })),
    });

    return {
      rows,
      eventColumns: buildEventColumns(eventTypeDefs, rows),
      campaign: { id: campaign.id, name: campaign.name },
      dimension,
    };
  }

  async getOfferReport(
    campaignId: string,
    from?: string,
    to?: string,
    excludeBots?: boolean,
  ): Promise<{
    rows: CampaignReportRow[];
    eventColumns: EventColumnDef[];
    campaign: { id: string; name: string } | null;
  }> {
    const report = await this.getCampaignDrilldownReport(
      campaignId,
      'offers',
      from,
      to,
      excludeBots,
    );
    return {
      rows: report.rows,
      eventColumns: report.eventColumns,
      campaign: report.campaign,
    };
  }

  exportOfferReportCsv(
    campaignId: string,
    from?: string,
    to?: string,
    excludeBots?: boolean,
  ): Promise<string> {
    return this.getOfferReport(campaignId, from, to, excludeBots).then(
      ({ rows, eventColumns }) =>
        this.rowsToCsv(rows, eventColumns, 'Offer name'),
    );
  }

  exportCampaignDrilldownCsv(
    campaignId: string,
    dimension: DrilldownDimensionId,
    from?: string,
    to?: string,
    excludeBots?: boolean,
  ): Promise<string> {
    return this.getCampaignDrilldownReport(
      campaignId,
      dimension,
      from,
      to,
      excludeBots,
    ).then(({ rows, eventColumns }) => {
      const def = getDrilldownDimension(dimension);
      return this.rowsToCsv(
        rows,
        eventColumns,
        def?.nameColumnLabel || 'Name',
      );
    });
  }

  private rowsToCsv(
    rows: CampaignReportRow[],
    eventColumns: EventColumnDef[],
    nameHeader: string,
  ): string {
    const baseHeaders = [
      nameHeader,
      'Marker',
      'CPC',
      'Visits',
      'Unique visits',
      'Suspicious visits',
      'Suspicious %',
      'Conversions',
      'Cost',
      'Revenue',
      'Profit',
      'ROI %',
      'CV %',
      'EPV',
      'CPV',
      'Errors',
      'eCPC',
      'Tx Transfo %',
      'Impressions',
    ];
    const eventHeaders = eventColumns.flatMap((c) => [
      c.countLabel,
      c.revenueLabel,
    ]);
    const lines = [[...baseHeaders, ...eventHeaders].join(',')];

    for (const row of rows) {
      const base = [
        this.csvEscape(row.campaignName),
        this.csvEscape(row.marker),
        row.cpc.toFixed(4),
        row.visits,
        row.uniqueVisits,
        row.suspiciousVisits,
        row.suspiciousPct,
        row.conversions,
        row.cost.toFixed(4),
        row.revenue.toFixed(4),
        row.profit.toFixed(4),
        row.roi.toFixed(2),
        row.cv.toFixed(2),
        row.epv.toFixed(6),
        row.cpv.toFixed(6),
        row.errors,
        row.ecpc.toFixed(4),
        row.txTransfo.toFixed(2),
        row.impressions,
      ];
      const events = eventColumns.flatMap((c) => [
        row.countByEvent[c.slug] || 0,
        (row.revenueByEvent[c.slug] || 0).toFixed(4),
      ]);
      lines.push([...base, ...events].join(','));
    }

    return lines.join('\n');
  }

}
