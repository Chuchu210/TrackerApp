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
import { OffersService } from './offers.service';
import { CreateOfferDto, UpdateOfferDto } from './dto/offer.dto';
import { ApiKeyGuard } from '../common/guards/api-key.guard';

@Controller('api/offers')
@UseGuards(ApiKeyGuard)
export class OffersController {
  constructor(private readonly offers: OffersService) {}

  @Get('meta')
  getMeta() {
    return this.offers.getMeta();
  }

  @Get('by-slug/:slug')
  findBySlug(@Param('slug') slug: string) {
    return this.offers.findBySlug(slug);
  }

  @Get()
  list(
    @Query('q') q?: string,
    @Query('active') active?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.offers.list({
      q,
      active: active === undefined ? undefined : active === 'true',
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.offers.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateOfferDto) {
    return this.offers.create(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateOfferDto) {
    return this.offers.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.offers.remove(id);
  }
}
