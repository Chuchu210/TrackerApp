import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PlatformSyncController } from './platform-sync.controller';
import { PlatformSyncService } from './platform-sync.service';
import { MetaCreativesService } from './meta-creatives.service';

@Module({
  imports: [HttpModule],
  controllers: [PlatformSyncController],
  providers: [PlatformSyncService, MetaCreativesService],
  exports: [PlatformSyncService, MetaCreativesService],
})
export class PlatformSyncModule {}
