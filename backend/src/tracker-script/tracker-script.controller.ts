import { Body, Controller, Get, Header, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { TrackerScriptService } from './tracker-script.service';
import { DirectVisitDto } from './dto/direct-visit.dto';
import { TrackStepDto } from './dto/track-step.dto';
import { ClicksService } from '../clicks/clicks.service';
import { ConversionsService } from '../conversions/conversions.service';
import { buildVisitorContextFromRequest } from '../clicks/visitor-context.util';
import { buildVisitorCookie } from '../common/utils/visitor-id';
import {
  shouldSendAutoViewContent,
  wantsAutoViewContent,
} from '../shared/tracking/auto-view-content';
import { FunnelStepsService } from '../analytics/funnel-steps.service';

@Controller('t')
export class TrackerScriptController {
  constructor(
    private readonly trackerScript: TrackerScriptService,
    private readonly clicks: ClicksService,
    private readonly conversions: ConversionsService,
    private readonly funnelSteps: FunnelStepsService,
  ) {}

  @Get('tracker.js')
  @Header('Content-Type', 'application/javascript')
  @Header('Cache-Control', 'public, max-age=3600')
  @Header('Access-Control-Allow-Origin', '*')
  getTrackerScript() {
    return this.trackerScript.getScript();
  }

  /** Direct LP tracking — Facebook/Google land directly on LP, script registers the visit */
  @Post('visit')
  @UseGuards(ThrottlerGuard)
  @Header('Access-Control-Allow-Origin', '*')
  async registerVisit(
    @Body() dto: DirectVisitDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const query: Record<string, string> = { ...(dto.params || {}) };
    // Test-IP override (?__test_ip=) is honored inside buildVisitorContextFromRequest
    // when ALLOW_TEST_IP_OVERRIDE=true — no special handling needed here.
    const visitor = buildVisitorContextFromRequest(req, query);
    if (dto.visitorId) {
      visitor.visitorId = dto.visitorId;
    }
    const result = await this.clicks.registerDirectVisit(dto.campaign, query, visitor);
    res.append('Set-Cookie', buildVisitorCookie(result.visitorId, req.secure));

    const autoViewContentSource =
      wantsAutoViewContent(result.utmSource, result.trafficSource) ||
      wantsAutoViewContent(query.utm_source);
    const sendViewContent =
      !dto.noViewContent && shouldSendAutoViewContent(result.campaignSlug);
    if (autoViewContentSource && sendViewContent) {
      setImmediate(() => {
        this.conversions
          .create({
            clickId: result.clickId,
            eventType: 'viewcontent',
            metadata: { source: 'auto_server_pageview', utm_source: result.utmSource || 'mediago' },
          })
          .catch(() => {});
      });
    }

    return result;
  }

  /**
   * LP funnel step reached (quiz question, form stage...). Analytics only — no
   * postback, no revenue — so a multi-step page can report every step without
   * sending one CAPI event per step.
   */
  @Post('step')
  @UseGuards(ThrottlerGuard)
  @Header('Access-Control-Allow-Origin', '*')
  async trackStep(@Body() dto: TrackStepDto) {
    // The tracker fetch never reads the body; keep the response minimal.
    await this.funnelSteps.record(dto);
    return { ok: true };
  }

  @Get('pixel')
  @Header('Content-Type', 'image/gif')
  @Header('Access-Control-Allow-Origin', '*')
  pixel() {
    return Buffer.from(
      'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      'base64',
    );
  }
}
