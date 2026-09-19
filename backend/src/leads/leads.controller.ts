import { Body, Controller, Delete, Get, Headers, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { IntakeLeadDto } from './dto/intake-lead.dto';
import { IntakeKeyGuard } from './intake-key.guard';
import { LeadsService, type LeadFilters } from './leads.service';

function toInt(value: string | undefined): number | undefined {
  const n = value === undefined ? NaN : Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

function filters(query: Record<string, string | undefined>): LeadFilters {
  return {
    campaignId: query.campaignId || undefined,
    from: query.from || undefined,
    to: query.to || undefined,
    search: query.search || undefined,
    includeTest: query.includeTest === 'true',
    limit: toInt(query.limit),
    offset: toInt(query.offset),
  };
}

@Controller()
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  /**
   * People who left their contact, one row per visit. Personal data: admin API key, and rate-limited — a leaked key
   * should not allow pulling the whole base in one burst.
   */
  /**
   * Un lead capté sur un autre site.
   *
   * `IntakeKeyGuard` et non `ApiKeyGuard` : la clé d'admin ouvre aussi la liste, l'export CSV et la suppression.
   * La confier à chaque partenaire pour qu'il puisse DÉPOSER une ligne lui donnerait la base entière.
   *
   * Et le site vient de la CLÉ, jamais du corps : `source` n'est qu'une déclaration de l'appelant, que la garde a
   * déjà refusée si elle contredit la clé. Le croire sur parole laisserait un partenaire écrire chez un autre.
   */
  @Post('api/leads/intake')
  // LA LIMITE DE DÉBIT D'ABORD. Dans l'autre ordre, un 401 sort avant que le compteur ne bouge : les essais de
  // clé fausse ne sont donc pas limités, et rien ne les ralentit ni ne les rend visibles.
  @UseGuards(ThrottlerGuard, IntakeKeyGuard)
  intake(@Body() dto: IntakeLeadDto, @Req() req: { intakeSite?: string }) {
    // Pas de repli sur `dto.source` : si la garde n'a pas nommé le site, le service refuse (400). Un repli sur le
    // corps rendrait la route silencieusement crédule le jour où quelqu'un déplacerait la garde.
    return this.leads.intake({ ...dto, source: req.intakeSite });
  }

  @Get('api/leads')
  @UseGuards(ApiKeyGuard, ThrottlerGuard)
  list(@Query() query: Record<string, string | undefined>) {
    return this.leads.list(filters(query));
  }

  @Get('api/leads/export/csv')
  @UseGuards(ApiKeyGuard, ThrottlerGuard)
  async exportCsv(@Query() query: Record<string, string | undefined>, @Res() res: Response) {
    const csv = await this.leads.exportCsv(filters(query));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="leads-export.csv"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  }

  /**
   * Effacement d'une visite entière : pour une personne qui n'a jamais produit de ligne de lead (son adresse n'est
   * arrivée que dans un paramètre de postback ou dans l'URL d'atterrissage), la visite est le seul identifiant
   * qu'elle possède.
   *
   * Gardée comme tout le reste du contrôleur. Un identifiant de clic n'est pas un secret — il voyage dans l'URL de
   * redirection, dans les postbacks du réseau et dans l'historique du navigateur — donc sans clé d'API, quiconque
   * en détient une liste pourrait effacer des visites en boucle.
   */
  @Delete('api/leads/visit/:clickId')
  @UseGuards(ApiKeyGuard, ThrottlerGuard)
  eraseVisit(@Param('clickId') clickId: string, @Headers('x-admin-user') by?: string) {
    return this.leads.eraseVisit(clickId, by);
  }

  /** Erasure request: clears the person everywhere, keeps the conversion and the reports. */
  @Delete('api/leads/:id')
  @UseGuards(ApiKeyGuard, ThrottlerGuard)
  remove(@Param('id') id: string, @Headers('x-admin-user') by?: string) {
    return this.leads.deleteOne(id, by);
  }
}
