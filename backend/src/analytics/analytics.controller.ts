import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AnalyticsService } from './analytics.service';
import { CampaignReportService } from './campaign-report.service';
import { FunnelAnalyticsService } from './funnel-analytics.service';
import { FunnelStepsService } from './funnel-steps.service';
import { CreativeAnalyticsService } from './creative-analytics.service';
import { PlacementAnalyticsService } from './placement-analytics.service';
import { ProfitabilityAnalyticsService } from './profitability-analytics.service';
import { DigestService } from './digest.service';
import { IncomingPostbacksService } from './incoming-postbacks.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import type { VisitAnalyticsFilters, VisitBreakdownDimension } from './visit-filters';

@Controller('api/analytics')
@UseGuards(ApiKeyGuard)
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly campaignReport: CampaignReportService,
    private readonly funnelAnalytics: FunnelAnalyticsService,
    private readonly funnelSteps: FunnelStepsService,
    private readonly creativeAnalytics: CreativeAnalyticsService,
    private readonly placementAnalytics: PlacementAnalyticsService,
    private readonly profitabilityAnalytics: ProfitabilityAnalyticsService,
    private readonly digest: DigestService,
    private readonly incomingPostbacks: IncomingPostbacksService,
  ) {}

  /** Voluum-style drilldown of one campaign along a single dimension. */
  @Get('drilldown')
  reportDrilldown(
    @Query('campaignId') campaignId?: string,
    @Query('dimension') dimension?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('excludeBots') excludeBots?: string,
  ) {
    if (!campaignId || !dimension) {
      return {
        rows: [],
        eventColumns: [],
        campaign: null,
        dimension: dimension || 'offers',
      };
    }
    return this.campaignReport.getCampaignDrilldownReport(
      campaignId,
      dimension as never,
      from,
      to,
      excludeBots === 'true',
    );
  }

  /** Offer breakdown for one campaign (the 'offers' drilldown, named). */
  @Get('offers')
  reportOffers(
    @Query('campaignId') campaignId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('excludeBots') excludeBots?: string,
  ) {
    if (!campaignId) {
      return { rows: [], eventColumns: [], campaign: null };
    }
    return this.campaignReport.getOfferReport(
      campaignId,
      from,
      to,
      excludeBots === 'true',
    );
  }

  @Get('offers/export/csv')
  async exportOfferCsv(
    @Res() res: Response,
    @Query('campaignId') campaignId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('excludeBots') excludeBots?: string,
  ) {
    const csv = campaignId
      ? await this.campaignReport.exportOfferReportCsv(
          campaignId,
          from,
          to,
          excludeBots === 'true',
        )
      : '';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="offer-report.csv"');
    res.send(csv);
  }

  @Get('drilldown/export/csv')
  async exportDrilldownCsv(
    @Res() res: Response,
    @Query('campaignId') campaignId?: string,
    @Query('dimension') dimension?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('excludeBots') excludeBots?: string,
  ) {
    const csv =
      campaignId && dimension
        ? await this.campaignReport.exportCampaignDrilldownCsv(
            campaignId,
            dimension as never,
            from,
            to,
            excludeBots === 'true',
          )
        : '';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${dimension || 'drilldown'}-report.csv"`,
    );
    res.send(csv);
  }

  /** S2S postbacks affiliate networks sent us, most recent first. */
  @Get('incoming-postbacks')
  listIncomingPostbacks(
    @Query('campaignId') campaignId?: string,
    @Query('eventType') eventType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.incomingPostbacks.list({
      campaignId,
      eventType,
      from,
      to,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  /** Per-campaign rollup of the same data, with an event-type breakdown. */
  @Get('incoming-postbacks/summary')
  incomingPostbacksSummary(
    @Query('campaignId') campaignId?: string,
    @Query('eventType') eventType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.incomingPostbacks.summary({ campaignId, eventType, from, to });
  }

  @Get('overview')
  async overview(
    @Query('campaignId') campaignId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('excludeBots') excludeBots?: string,
  ) {
    const exclude = excludeBots === 'true';
    if (campaignId) {
      return this.analytics.getOverview(campaignId, from, to, exclude);
    }
    return this.campaignReport.getGlobalRollup(from, to, exclude);
  }

  @Get('campaigns')
  reportCampaigns(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('workspace') workspace?: string,
    @Query('excludeBots') excludeBots?: string,
  ) {
    return this.campaignReport.getCampaignReport(from, to, workspace, excludeBots === 'true');
  }

  @Get('campaigns/export/csv')
  async exportCampaignCsv(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('workspace') workspace?: string,
    @Res() res?: Response,
  ) {
    const csv = await this.campaignReport.exportCampaignReportCsv(from, to, workspace);
    res!.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res!.setHeader('Content-Disposition', 'attachment; filename="campaign-report.csv"');
    res!.send(csv);
  }

  @Get('timeseries')
  timeseries(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('granularity') granularity?: 'hour' | 'day',
    @Query('campaignId') campaignId?: string,
    @Query('tz') tz?: string,
  ) {
    return this.campaignReport.getTimeseries(from, to, granularity || 'hour', campaignId, tz);
  }

  @Get('breakdown')
  breakdown(
    @Query('dimension') dimension: 'publisher' | 'platform' | 'device' | 'os' | 'country' | 'browser',
    @Query('campaignId') campaignId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.analytics.getBreakdown(dimension || 'publisher', campaignId, from, to);
  }

  @Get('visits/summary')
  visitSummary(@Query() query: Record<string, string | undefined>) {
    return this.analytics.getVisitSummary(this.parseVisitFilters(query));
  }

  @Get('visits/breakdown')
  visitBreakdown(
    @Query('dimension') dimension: VisitBreakdownDimension,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.analytics.getVisitBreakdown(
      dimension || 'publisher',
      this.parseVisitFilters(query),
    );
  }

  @Get('creatives')
  creativeReport(@Query() query: Record<string, string | undefined>) {
    const { eventType, countMode, ...rest } = query;
    return this.creativeAnalytics.getCreativeReport(this.parseVisitFilters(rest), {
      eventType,
      countMode: countMode as 'recorded' | 'sent' | undefined,
    });
  }

  @Get('placements')
  placements(@Query() query: Record<string, string | undefined>) {
    const { dimension, eventType, countMode, ...rest } = query;
    return this.placementAnalytics.getPlacements(
      this.parseVisitFilters(rest),
      (dimension as 'site' | 'publisher') || 'site',
      eventType,
      countMode === 'sent' ? 'sent' : 'recorded',
    );
  }

  @Get('profitability')
  profitability(@Query() query: Record<string, string | undefined>) {
    const { dimension, eventType, countMode, ...rest } = query;
    return this.profitabilityAnalytics.getProfitability(
      this.parseVisitFilters(rest),
      (dimension as 'hour' | 'dow' | 'country' | 'device') || 'hour',
      eventType,
      countMode === 'sent' ? 'sent' : 'recorded',
    );
  }

  @Get('digest')
  digestReport(@Query() query: Record<string, string | undefined>) {
    const { eventType, ...rest } = query;
    return this.digest.getDigest(this.parseVisitFilters(rest), eventType || 'call_click');
  }

  private parseVisitFilters(query: Record<string, string | undefined>): VisitAnalyticsFilters {
    const { isBot, isNewVisitor, excludeBots, ...rest } = query;
    return {
      campaignId: rest.campaignId,
      from: rest.from,
      to: rest.to,
      publisher: rest.publisher,
      platform: rest.platform,
      country: rest.country,
      device: rest.device,
      adId: rest.adId,
      adsetId: rest.adsetId,
      siteId: rest.siteId,
      contentName: rest.contentName,
      isBot: isBot === 'true' ? true : isBot === 'false' ? false : undefined,
      isNewVisitor:
        isNewVisitor === 'true' ? true : isNewVisitor === 'false' ? false : undefined,
      excludeBots: excludeBots === 'true',
    };
  }

  @Get('funnel')
  getFunnel(
    @Query('campaignId') campaignId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.funnelAnalytics.getFunnel(campaignId, from, to);
  }

  /**
   * Step-by-step LP funnel for one campaign: arrivals, then how many visits
   * reached each step the landing page declares via tkCallback.trackStep().
   * Answers "where do people drop off", which the conversion-based funnel
   * cannot: conversions are unique per (click, eventType), so every quiz step
   * collapsed into a single click_button row.
   */
  @Get('funnel/steps')
  getFunnelSteps(
    @Query('campaignId') campaignId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('includeTest') includeTest?: string,
  ) {
    return this.funnelSteps.getStepFunnel(
      campaignId,
      from,
      to,
      includeTest === 'true',
    );
  }

  @Get('funnel/postbacks')
  getFunnelPostbacks(
    @Query('campaignId') campaignId?: string,
    @Query('eventType') eventType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return this.funnelAnalytics.getRecentPostbacks(
      campaignId,
      eventType,
      from,
      to,
      limit ? parseInt(limit, 10) : 50,
    );
  }

  @Get('live')
  liveTraffic(
    @Query('campaignId') campaignId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.analytics.getLiveTraffic(
      campaignId,
      limit ? parseInt(limit, 10) : 50,
    );
  }
}
