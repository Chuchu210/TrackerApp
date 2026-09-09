import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { CampaignReportService } from './campaign-report.service';
import { FunnelAnalyticsService } from './funnel-analytics.service';
import { FunnelStepsService } from './funnel-steps.service';
import { CreativeAnalyticsService } from './creative-analytics.service';
import { PlacementAnalyticsService } from './placement-analytics.service';
import { ProfitabilityAnalyticsService } from './profitability-analytics.service';
import { DigestService } from './digest.service';
import { IncomingPostbacksService } from './incoming-postbacks.service';
import { ConversionEventTypesModule } from '../conversion-event-types/conversion-event-types.module';

@Module({
  imports: [ConversionEventTypesModule],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    IncomingPostbacksService,
    CampaignReportService,
    FunnelAnalyticsService,
    FunnelStepsService,
    CreativeAnalyticsService,
    PlacementAnalyticsService,
    ProfitabilityAnalyticsService,
    DigestService,
  ],
  exports: [
    AnalyticsService,
    IncomingPostbacksService,
    CampaignReportService,
    FunnelAnalyticsService,
    FunnelStepsService,
    CreativeAnalyticsService,
    PlacementAnalyticsService,
    ProfitabilityAnalyticsService,
    DigestService,
  ],
})
export class AnalyticsModule {}
