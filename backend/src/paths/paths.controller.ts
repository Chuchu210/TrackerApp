import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { PathsService } from './paths.service';
import { AutoWinnerService } from './auto-winner.service';
import {
  CreatePathDto,
  UpdatePathDto,
  CreateVariantDto,
  UpdateVariantDto,
} from './dto/path.dto';

@Controller('api')
@UseGuards(ApiKeyGuard)
export class PathsController {
  constructor(
    private readonly paths: PathsService,
    private readonly autoWinner: AutoWinnerService,
  ) {}

  @Get('campaigns/:campaignId/paths')
  list(@Param('campaignId') campaignId: string) {
    return this.paths.listForCampaign(campaignId);
  }

  @Post('campaigns/:campaignId/paths')
  create(@Param('campaignId') campaignId: string, @Body() dto: CreatePathDto) {
    return this.paths.createPath(campaignId, dto);
  }

  @Put('paths/:id')
  update(@Param('id') id: string, @Body() dto: UpdatePathDto) {
    return this.paths.updatePath(id, dto);
  }

  @Delete('paths/:id')
  remove(@Param('id') id: string) {
    return this.paths.deletePath(id);
  }

  @Post('paths/:id/variants')
  addVariant(@Param('id') id: string, @Body() dto: CreateVariantDto) {
    return this.paths.createVariant(id, dto);
  }

  @Put('variants/:id')
  updateVariant(@Param('id') id: string, @Body() dto: UpdateVariantDto) {
    return this.paths.updateVariant(id, dto);
  }

  @Delete('variants/:id')
  removeVariant(@Param('id') id: string) {
    return this.paths.deleteVariant(id);
  }

  /** Manually trigger an auto-winner evaluation (also runs hourly on a cron). */
  @Post('paths/auto-winner/run')
  runAutoWinner() {
    return this.autoWinner.evaluateAll();
  }
}
