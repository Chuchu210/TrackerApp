import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ConversionEventTypesModule } from '../conversion-event-types/conversion-event-types.module';
import { PathsController } from './paths.controller';
import { PathsService } from './paths.service';
import { AutoWinnerService } from './auto-winner.service';

@Module({
  imports: [PrismaModule, ConversionEventTypesModule],
  controllers: [PathsController],
  providers: [PathsService, AutoWinnerService],
  exports: [PathsService],
})
export class PathsModule {}
