import { Module } from '@nestjs/common';
import { TrackerScriptController } from './tracker-script.controller';
import { TrackerScriptService } from './tracker-script.service';
import { ClicksModule } from '../clicks/clicks.module';
import { ConversionsModule } from '../conversions/conversions.module';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [ClicksModule, ConversionsModule, AnalyticsModule],
  controllers: [TrackerScriptController],
  providers: [TrackerScriptService],
  exports: [TrackerScriptService],
})
export class TrackerScriptModule {}
