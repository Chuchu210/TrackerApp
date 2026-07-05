import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { buildVisitorContextFromRequest } from './visitor-context.util';
import { ClicksService } from './clicks.service';
import { buildVisitorCookie } from '../common/utils/visitor-id';
import { sendRedirect } from './send-redirect.util';

@Controller()
export class ClicksController {
  constructor(private readonly clicksService: ClicksService) {}

  @Get('click/:slug')
  async redirect(
    @Param('slug') slug: string,
    @Query() query: Record<string, string | string[] | undefined>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const visitor = buildVisitorContextFromRequest(req, query);
    const { destination, visitorId, redirectMode } = await this.clicksService.handleClick(
      slug,
      query,
      visitor,
    );

    res.append('Set-Cookie', buildVisitorCookie(visitorId, req.secure));
    return sendRedirect(res, destination, redirectMode);
  }
}
