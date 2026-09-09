import { Controller, Get, Param, Query, Req, Res, NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { buildVisitorContextFromRequest } from './visitor-context.util';
import { ClicksService } from './clicks.service';
import { ConversionsService } from '../conversions/conversions.service';
import { buildVisitorCookie } from '../common/utils/visitor-id';
import {
  shouldSendAutoViewContent,
  wantsAutoViewContent,
} from '../shared/tracking/auto-view-content';
import { sendRedirect } from './send-redirect.util';

const RESERVED = new Set(['api', 't', 'conversions', 'postback', 'click', 'health', 'favicon.ico']);

@Controller()
export class VoluumRedirectController {
  constructor(
    private readonly clicksService: ClicksService,
    private readonly conversions: ConversionsService,
  ) {}

  /** Voluum-style: https://tracks.domain.com/{campaign-uuid}?adid=...&click_id={TRACKING_ID} */
  @Get(':identifier')
  async voluumRedirect(
    @Param('identifier') identifier: string,
    @Query() query: Record<string, string | string[] | undefined>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (RESERVED.has(identifier.toLowerCase())) {
      throw new NotFoundException();
    }

    const visitor = buildVisitorContextFromRequest(req, query);
    const { destination, visitorId, clickId, utmSource, trafficSource, campaignSlug, redirectMode } =
      await this.clicksService.handleClick(identifier, query, visitor);

    const autoViewContentSource =
      wantsAutoViewContent(utmSource, trafficSource) ||
      wantsAutoViewContent(
        typeof query.utm_source === 'string'
          ? query.utm_source
          : Array.isArray(query.utm_source)
            ? query.utm_source[0]
            : undefined,
      );
    if (autoViewContentSource && clickId && shouldSendAutoViewContent(campaignSlug)) {
      setImmediate(() => {
        this.conversions
          .create({
            clickId,
            eventType: 'viewcontent',
            metadata: { source: 'auto_redirect_pageview', utm_source: utmSource || 'mediago' },
          })
          .catch(() => {});
      });
    }

    res.append('Set-Cookie', buildVisitorCookie(visitorId, req.secure));
    return sendRedirect(res, destination, redirectMode);
  }
}
