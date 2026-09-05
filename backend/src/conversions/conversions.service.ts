import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConversionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PostbacksService } from '../postbacks/postbacks.service';
import { CreateConversionDto } from './dto/create-conversion.dto';
import type { ConversionContext } from './dto/conversion-context';
import { isTestLeadFromQuestionnaireData } from '../shared/tracking/params';
import {
  DEFAULT_PARAM_MAPPINGS,
  getReportFieldsFromClick,
  type ParamMapping,
} from '../shared/tracking/param-mapping';
import { normalizeEventType } from '../common/utils/normalize-event-type';
import {
  isPostbackAuthorized,
  parseIpAllowlist,
  extractProvidedSecret,
} from '../shared/tracking/postback-auth';
import {
  isWithinAttributionWindow,
  isConversionCapReached,
} from '../shared/tracking/attribution';
import { buildFxConfig, normalizeToBase } from '../shared/tracking/currency';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class ConversionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly postbacks: PostbacksService,
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Guard the server-to-server postback path. When the resolved click's campaign
   * has a `postbackSecret` set, or a global POSTBACK_IP_ALLOWLIST is configured,
   * the request must satisfy one of them — otherwise anyone who knows a clickId
   * could inject conversions. Campaigns with neither configured stay open
   * (backward compatible) so nothing breaks until a secret is set.
   */
  private async assertPostbackAuthorized(
    resolvedClickId: string | undefined,
    query: Record<string, string | string[] | undefined> = {},
    context?: ConversionContext,
  ): Promise<void> {
    const ipAllowlist = parseIpAllowlist(
      this.config.get<string>('POSTBACK_IP_ALLOWLIST'),
    );

    let expectedSecret: string | null = null;
    if (resolvedClickId) {
      const click = await this.prisma.click.findUnique({
        where: { clickId: resolvedClickId },
        select: { campaign: { select: { postbackConfig: { select: { postbackSecret: true } } } } },
      });
      expectedSecret = click?.campaign.postbackConfig?.postbackSecret ?? null;
    }

    // Nothing to enforce for this campaign and no global allowlist — stay open.
    if (!expectedSecret && ipAllowlist.length === 0) return;

    const result = isPostbackAuthorized({
      expectedSecret,
      providedSecret: extractProvidedSecret(query),
      ip: context?.incomingPostbackIp,
      ipAllowlist,
    });

    if (!result.ok) {
      throw new ForbiddenException('Postback not authorized');
    }
  }

  async create(dto: CreateConversionDto, context?: ConversionContext) {
    if (
      isTestLeadFromQuestionnaireData({
        user_email: dto.metadata?.email as string,
        firstName: dto.metadata?.firstName as string,
        lastName: dto.metadata?.lastName as string,
        is_test_lead: dto.is_test_lead,
      })
    ) {
      return { skipped: true, reason: 'test_lead' };
    }

    const click = await this.findClick(dto);
    if (!click) {
      throw new NotFoundException('Click not found for provided clickId or trackingId');
    }

    // Attribution window: reject conversions that land too long after the click.
    if (
      !isWithinAttributionWindow(
        click.createdAt,
        new Date(),
        click.campaign?.attributionWindowHours,
      )
    ) {
      return { skipped: true, reason: 'outside_attribution_window' };
    }

    const eventType = normalizeEventType(dto.eventType);

    const existing = await this.prisma.conversion.findUnique({
      where: { clickId_eventType: { clickId: click.clickId, eventType } },
    });

    // Untrusted (public browser) callers never read the response body — the
    // tracker fetch only .catch()es — so skip the join-heavy re-fetch on the
    // hot path (fires on every quiz click_button).
    const trusted = context?.trusted !== false;

    if (existing) {
      if (!trusted) return { conversion: { id: existing.id }, duplicate: true };
      const full = await this.getConversionWithClick(existing.id);
      return { conversion: full, duplicate: true };
    }

    // Per-click conversion cap (across all event types) to curb injection/abuse.
    if (click.campaign?.maxConversionsPerClick != null) {
      const existingCount = await this.prisma.conversion.count({
        where: { clickId: click.clickId },
      });
      if (isConversionCapReached(existingCount, click.campaign.maxConversionsPerClick)) {
        return { skipped: true, reason: 'conversion_cap_reached' };
      }
    }

    const settings = await this.settings.getEffective();
    const fx = buildFxConfig(settings.baseCurrency, settings.fxRates);
    // Ignore client-supplied money on untrusted (public) calls.
    const revenue = trusted ? dto.revenue || 0 : 0;
    const cost = trusted ? dto.cost || 0 : 0;
    const totalRevenue = trusted ? (dto.totalRevenue ?? dto.revenue ?? 0) : 0;

    const conversion = await this.prisma.conversion.create({
      data: {
        clickId: click.clickId,
        campaignId: click.campaignId,
        eventType,
        revenue,
        totalRevenue,
        cost,
        currency: dto.currency || null,
        revenueBase: normalizeToBase(revenue, dto.currency, fx),
        costBase: normalizeToBase(cost, dto.currency, fx),
        transactionId: dto.transactionId || null,
        status: ConversionStatus.pending,
        metadata: (dto.metadata || {}) as Prisma.InputJsonValue,
        incomingPostbackIp: context?.incomingPostbackIp || null,
        incomingPostbackUrl: context?.incomingPostbackUrl || null,
        postbackParam1: dto.postbackParam1 || context?.postbackParam1 || null,
        postbackParam2: dto.postbackParam2 || context?.postbackParam2 || null,
        postbackParam3: dto.postbackParam3 || context?.postbackParam3 || null,
        postbackParam4: dto.postbackParam4 || context?.postbackParam4 || null,
        postbackParam5: dto.postbackParam5 || context?.postbackParam5 || null,
        // A test click can only ever produce test conversions; and firing a
        // conversion while test mode is on marks it test even against a real
        // click, so rehearsing a postback never adds a lead to the reports.
        isTest: click.isTest || settings.testMode,
      },
    });

    setImmediate(() => {
      this.postbacks.processConversion(conversion.id).catch(() => {});
    });

    if (!trusted) return { conversion: { id: conversion.id }, duplicate: false };

    const full = await this.getConversionWithClick(conversion.id);
    return { conversion: full, duplicate: false };
  }

  async triggerByClickId(
    clickId: string,
    query?: Record<string, string | string[] | undefined>,
    context?: ConversionContext,
  ) {
    const get = (key: string) => {
      const v = query?.[key];
      if (Array.isArray(v)) return v[0];
      return v;
    };

    const resolvedClickId =
      get('cid') ||
      clickId ||
      get('click_id') ||
      get('clickId') ||
      get('tk-cid') ||
      get('tk_cid');

    await this.assertPostbackAuthorized(resolvedClickId, query, context);

    return this.create(
      {
        clickId: resolvedClickId,
        trackingId: get('tracking_id') || get('externalid'),
        eventType: get('et') || get('event_type') || 'lead',
        transactionId: get('txid') || get('transaction_id'),
        revenue: get('payout') ? parseFloat(get('payout')!) : undefined,
        currency: get('currency'),
      },
      context,
    );
  }

  async list(filters: {
    campaignId?: string;
    status?: ConversionStatus;
    eventType?: string;
    from?: string;
    to?: string;
    isTest?: boolean;
    limit?: number;
    offset?: number;
  }) {
    // Like the click log, this list is ground truth rather than a report, so
    // test rows stay visible and carry `isTest` for the UI to mark.
    const where: Record<string, unknown> = {};

    if (filters.campaignId) where.campaignId = filters.campaignId;
    if (filters.status) where.status = filters.status;
    if (filters.isTest !== undefined) where.isTest = filters.isTest;
    if (filters.eventType) {
      const slugs = filters.eventType.includes(',')
        ? filters.eventType.split(',').map((s) => normalizeEventType(s.trim()))
        : [normalizeEventType(filters.eventType)];
      where.eventType = slugs.length === 1 ? slugs[0] : { in: slugs };
    }
    if (filters.from || filters.to) {
      where.createdAt = {
        ...(filters.from ? { gte: new Date(filters.from) } : {}),
        ...(filters.to ? { lte: new Date(filters.to) } : {}),
      };
    }

    const [items, total] = await Promise.all([
      this.prisma.conversion.findMany({
        where,
        include: {
          click: true,
          campaign: { include: { trafficSourceProfile: true } },
          postbackLogs: true,
        },
        orderBy: { createdAt: 'desc' },
        take: filters.limit || 50,
        skip: filters.offset || 0,
      }),
      this.prisma.conversion.count({ where }),
    ]);

    return {
      items: items.map((item) => ({
        ...item,
        click: item.click
          ? {
              ...item.click,
              reportFields: getReportFieldsFromClick(
                item.click,
                (item.campaign.trafficSourceProfile?.paramMappings as unknown as ParamMapping[]) ||
                  DEFAULT_PARAM_MAPPINGS,
              ),
            }
          : item.click,
      })),
      total,
    };
  }

  async retry(conversionId: string) {
    const conversion = await this.prisma.conversion.findUnique({
      where: { id: conversionId },
    });
    if (!conversion) throw new NotFoundException('Conversion not found');

    await this.postbacks.retryConversion(conversionId);
    return { success: true };
  }

  async getOne(conversionId: string) {
    const conversion = await this.getConversionWithClick(conversionId);
    if (!conversion) throw new NotFoundException('Conversion not found');
    return conversion;
  }

  private async getConversionWithClick(conversionId: string) {
    return this.prisma.conversion.findUnique({
      where: { id: conversionId },
      include: {
        click: true,
        campaign: true,
        postbackLogs: true,
      },
    });
  }

  private async findClick(dto: CreateConversionDto) {
    // Carry the campaign's attribution settings so create() can enforce
    // window/cap without a second round-trip.
    const includeCampaign = {
      campaign: {
        select: { attributionWindowHours: true, maxConversionsPerClick: true },
      },
    } as const;

    if (dto.clickId) {
      return this.prisma.click.findUnique({
        where: { clickId: dto.clickId },
        include: includeCampaign,
      });
    }

    if (dto.trackingId) {
      return this.prisma.click.findFirst({
        where: { trackingId: dto.trackingId },
        orderBy: { createdAt: 'desc' },
        include: includeCampaign,
      });
    }

    if (dto.externalClickId) {
      return this.prisma.click.findFirst({
        where: {
          OR: [
            { externalClickId: dto.externalClickId },
            { trackingId: dto.externalClickId },
            { fbclid: dto.externalClickId },
          ],
        },
        orderBy: { createdAt: 'desc' },
        include: includeCampaign,
      });
    }

    throw new BadRequestException('clickId, trackingId, or externalClickId is required');
  }
}
