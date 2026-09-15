import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MachineApiController } from './machine-api.controller';
import { MachineApiService } from './machine-api.service';
import { MachineTokenGuard } from './machine-token.guard';

@Module({
  imports: [PrismaModule],
  controllers: [MachineApiController],
  providers: [MachineApiService, MachineTokenGuard],
})
export class MachineApiModule {}
