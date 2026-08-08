import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { ClicksModule } from './clicks/clicks.module';
import { ConversionsModule } from './conversions/conversions.module';
import { PostbacksModule } from './postbacks/postbacks.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { TrackerScriptModule } from './tracker-script/tracker-script.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { DomainsModule } from './domains/domains.module';
import { TrafficSourcesModule } from './traffic-sources/traffic-sources.module';
import { ConversionEventTypesModule } from './conversion-event-types/conversion-event-types.module';
import { PlatformSyncModule } from './platform-sync/platform-sync.module';
import { LandersModule } from './landers/landers.module';
import { TargetsModule } from './targets/targets.module';
import { PlacementsModule } from './placements/placements.module';
import { RulesModule } from './rules/rules.module';
import { PathsModule } from './paths/paths.module';
import { SettingsModule } from './settings/settings.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    // Global module: provides ThrottlerGuard deps app-wide. Applied per-route
    // via @UseGuards(ThrottlerGuard) on public browser endpoints only — NOT as
    // an APP_GUARD, since all admin traffic shares the Next server's single IP
    // and would trip a global per-IP limit. 30 req/min/IP (real visitor IP via
    // `trust proxy`). Note: in-memory storage is per-process; use a shared
    // store (e.g. Redis) if running multiple backend instances.
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 30 }]),
    PrismaModule,
    SettingsModule,
    ClicksModule,
    ConversionsModule,
    PostbacksModule,
    CampaignsModule,
    TrackerScriptModule,
    AnalyticsModule,
    DomainsModule,
    TrafficSourcesModule,
    ConversionEventTypesModule,
    PlatformSyncModule,
    LandersModule,
    TargetsModule,
    PlacementsModule,
    RulesModule,
    PathsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
