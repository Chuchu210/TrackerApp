import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { LandersController } from './landers.controller';
import { LandersService } from './landers.service';
import { LanderHealthService } from './lander-health.service';
import { DomainsModule } from '../domains/domains.module';
import { TrackerScriptModule } from '../tracker-script/tracker-script.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [DomainsModule, TrackerScriptModule, NotificationsModule, HttpModule],
  controllers: [LandersController],
  providers: [LandersService, LanderHealthService],
  exports: [LandersService, LanderHealthService],
})
export class LandersModule {}
