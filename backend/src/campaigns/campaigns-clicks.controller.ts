import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ClicksService } from '../clicks/clicks.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';

@Controller('api')
@UseGuards(ApiKeyGuard)
export class CampaignsClicksController {
  constructor(private readonly clicksService: ClicksService) {}

  @Get('clicks')
  listClicks(
    @Query('campaignId') campaignId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('publisher') publisher?: string,
    @Query('platform') platform?: string,
    @Query('device') device?: string,
    @Query('country') country?: string,
    @Query('adId') adId?: string,
    @Query('adsetId') adsetId?: string,
    @Query('siteId') siteId?: string,
    @Query('contentName') contentName?: string,
    @Query('landerId') landerId?: string,
    @Query('isBot') isBot?: string,
    @Query('isNewVisitor') isNewVisitor?: string,
    @Query('isTest') isTest?: string,
    @Query('converted') converted?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.clicksService.listClicks({
      campaignId,
      from,
      to,
      publisher,
      platform,
      device,
      country,
      adId,
      adsetId,
      siteId,
      contentName,
      landerId,
      isBot: isBot === 'true' ? true : isBot === 'false' ? false : undefined,
      isNewVisitor:
        isNewVisitor === 'true' ? true : isNewVisitor === 'false' ? false : undefined,
      isTest: isTest === 'true' ? true : isTest === 'false' ? false : undefined,
      converted:
        converted === 'true' ? true : converted === 'false' ? false : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }
}
