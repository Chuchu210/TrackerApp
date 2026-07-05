import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConversionsController } from './conversions.controller';
import { ConversionsService } from './conversions.service';
import { VoluumExportService } from './voluum-export.service';
import { ScheduledExportService } from './scheduled-export.service';
import { PostbacksModule } from '../postbacks/postbacks.module';

@Module({
  imports: [PostbacksModule, HttpModule],
  controllers: [ConversionsController],
  providers: [ConversionsService, VoluumExportService, ScheduledExportService],
  exports: [ConversionsService],
})
export class ConversionsModule {}
