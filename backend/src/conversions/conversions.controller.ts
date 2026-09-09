import { Body, Controller, Get, Header, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ConversionStatus } from '@prisma/client';
import { ConversionsService } from './conversions.service';
import { VoluumExportService } from './voluum-export.service';
import { CreateConversionDto } from './dto/create-conversion.dto';
import { extractPostbackParamsFromQuery } from './dto/conversion-context';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ApiKeyGuard } from '../common/guards/api-key.guard';

@Controller()
export class ConversionsController {
  constructor(
    private readonly conversionsService: ConversionsService,
    private readonly voluumExport: VoluumExportService,
  ) {}

  @Post('conversions')
  @UseGuards(ApiKeyGuard)
  create(@Body() dto: CreateConversionDto, @Req() req: Request) {
    return this.conversionsService.create(dto, { ...this.buildContext(req), trusted: true });
  }

  /** Public endpoint for client-side tracker script (tkCallback.registerConversion) */
  @Post('conversions/track')
  @UseGuards(ThrottlerGuard)
  @Header('Access-Control-Allow-Origin', '*')
  trackFromClient(@Body() dto: CreateConversionDto, @Req() req: Request) {
    // Untrusted: client-supplied revenue is ignored downstream, and the
    // response is trimmed since the tracker never reads it.
    return this.conversionsService.create(dto, { ...this.buildContext(req), trusted: false });
  }

  /** Voluum-style incoming postback: /postback?cid=...&et=Lead&payout=20&txid=... */
  @Get('postback')
  incomingPostback(
    @Query() query: Record<string, string | string[] | undefined>,
    @Req() req: Request,
  ) {
    const clickId =
      this.pickQuery(query, 'cid', 'click_id', 'clickId', 'tk-cid', 'tk_cid') || '';
    return this.conversionsService.triggerByClickId(clickId, query, this.buildContext(req));
  }

  @Get('postback/:clickId')
  triggerPostback(
    @Param('clickId') clickId: string,
    @Query() query: Record<string, string | string[] | undefined>,
    @Req() req: Request,
  ) {
    return this.conversionsService.triggerByClickId(clickId, query, this.buildContext(req));
  }

  @Get('api/conversions/export/csv')
  @UseGuards(ApiKeyGuard)
  async exportCsv(
    @Query('campaignId') campaignId: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Res() res: Response,
  ) {
    const csv = await this.voluumExport.exportConversionsCsv({ campaignId, from, to });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="conversions-export.csv"');
    res.send(csv);
  }

  private buildContext(req: Request) {
    const forwarded = req.headers['x-forwarded-for'];
    const ip =
      (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : undefined) || req.ip;
    const postbackParams = extractPostbackParamsFromQuery(req.query as Record<string, string>);
    return {
      incomingPostbackIp: ip,
      incomingPostbackUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
      cookieHeader: req.headers.cookie,
      ...postbackParams,
    };
  }

  private pickQuery(
    query: Record<string, string | string[] | undefined>,
    ...keys: string[]
  ): string | undefined {
    for (const key of keys) {
      const v = query[key];
      if (Array.isArray(v)) return v[0];
      if (v) return v;
    }
    return undefined;
  }

  @Get('api/conversions/:id')
  @UseGuards(ApiKeyGuard)
  getOne(@Param('id') id: string) {
    return this.conversionsService.getOne(id);
  }

  @Get('api/conversions')
  @UseGuards(ApiKeyGuard)
  list(
    @Query('campaignId') campaignId?: string,
    @Query('status') status?: ConversionStatus,
    @Query('eventType') eventType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.conversionsService.list({
      campaignId,
      status,
      eventType,
      from,
      to,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Post('api/conversions/:id/retry')
  @UseGuards(ApiKeyGuard)
  retry(@Param('id') id: string) {
    return this.conversionsService.retry(id);
  }
}
