import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AffiliateNetworksService } from './affiliate-networks.service';
import {
  CreateAffiliateNetworkDto,
  UpdateAffiliateNetworkDto,
} from './dto/affiliate-network.dto';
import { ApiKeyGuard } from '../common/guards/api-key.guard';

@Controller('api/affiliate-networks')
@UseGuards(ApiKeyGuard)
export class AffiliateNetworksController {
  constructor(private readonly networks: AffiliateNetworksService) {}

  @Get()
  list(@Query('all') all?: string) {
    return this.networks.list(all === '1' || all === 'true');
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.networks.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateAffiliateNetworkDto) {
    return this.networks.create(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAffiliateNetworkDto) {
    return this.networks.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.networks.remove(id);
  }
}
