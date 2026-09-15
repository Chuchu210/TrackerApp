import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { MachineApiService } from './machine-api.service';
import { MachineTokenGuard } from './machine-token.guard';

@Controller('v1')
@UseGuards(MachineTokenGuard)
export class MachineApiController {
  constructor(private readonly machine: MachineApiService) {}

  @Get('facts/ads')
  factsForAds(@Query() query: Record<string, string | undefined>) {
    return this.machine.factsForAds(query);
  }

  @Get('offers/:offerId/realized-value')
  realizedValue(
    @Param('offerId') offerId: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.machine.realizedValue(offerId, query);
  }

  @Get('traffic/hourly')
  trafficHourly(@Query() query: Record<string, string | undefined>) {
    return this.machine.trafficHourly(query);
  }
}
