import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { generateClickId } from '../common/utils/click-id-generator';
import {
  getTrackingParamsFromQuery,
  extractRawParams,
} from '../shared/tracking/params';
import {
  type ParamMapping,
  DEFAULT_PARAM_MAPPINGS,
  getReportFieldsFromClick,
} from '../shared/tracking/param-mapping';
import {
  applyNativeParamFallbacks,
  extractVoluumFields,
} from '../shared/tracking/voluum-fields';
import { detectBot } from '../shared/tracking/bot-detector';
import { extractOpenAiAttribution } from '../shared/tracking/openai-attribution';
import {
  evaluateClickVelocity,
  mergeBotSignals,
  parseVelocityConfig,
} from '../shared/tracking/velocity';
import { resolveRouting, type RoutablePath } from '../shared/tracking/routing';
import { parseClickCost, parseClickCostKeys } from '../shared/tracking/click-cost';
import {
  inferConnectionType,
  type VisitorContext,
} from '../shared/tracking/request-context';
import { DeviceParserService } from './device-parser.service';
import { GeoIpService } from './geo-ip.service';
import { IpEnrichmentService } from './ip-enrichment.service';
import { isPrivateOrLoopback } from '../shared/tracking/ip-resolver';
import { fingerprintVisitorId } from '../common/utils/visitor-id';
import { ConversionEventTypesService } from '../conversion-event-types/conversion-event-types.service';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class ClicksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly deviceParser: DeviceParserService,
    private readonly geoIp: GeoIpService,
    private readonly ipEnrichment: IpEnrichmentService,
    private readonly eventTypes: ConversionEventTypesService,
    private readonly settings: SettingsService,
  ) {}

  async registerDirectVisit(
    identifier: string,
    query: Record<string, string | string[] | undefined>,
    visitor: VisitorContext,
  ) {
    const { clickId, campaign, visitorId, isNewVisitor, utmSource } = await this.recordClick(
      identifier,
      query,
      visitor,
    );
    return {
      clickId,
      campaignId: campaign.id,
      campaignSlug: campaign.slug,
      trackingMode: campaign.trackingMode,
      trafficSource: campaign.trafficSource,
      visitorId,
      isNewVisitor,
      utmSource,
    };
  }

  async handleClick(
    identifier: string,
    query: Record<string, string | string[] | undefined>,
    visitor: VisitorContext,
  ) {
    const { clickId, campaign, visitorId, utmSource, routedDestination } =
      await this.recordClick(identifier, query, visitor);

    const destination = new URL(routedDestination);

    for (const [key, value] of Object.entries(query)) {
      if (key.toLowerCase() === '__test_ip') continue;
      if (Array.isArray(value)) {
        if (value[0]) destination.searchParams.set(key, value[0]);
      } else if (value) {
        destination.searchParams.set(key, value);
      }
    }

    destination.searchParams.set('click_id', clickId);
    destination.searchParams.set('tk-cid', clickId);

    return {
      destination: destination.toString(),
      visitorId,
      clickId,
      utmSource,
      trafficSource: campaign.trafficSource,
      campaignSlug: campaign.slug,
      redirectMode: campaign.redirectMode,
    };
  }

  private async recordClick(
    identifier: string,
    query: Record<string, string | string[] | undefined>,
    visitor: VisitorContext,
  ) {
    const campaign = await this.findCampaign(identifier);
    const mappings = this.getCampaignParamMappings(campaign);
    const params = getTrackingParamsFromQuery(query, null, mappings);
    const rawParams = extractRawParams(query);
    const openAi = extractOpenAiAttribution(rawParams);
    const voluum = extractVoluumFields(query);
    const customVars = applyNativeParamFallbacks(voluum.customVariables, {
      adId: params.ad_id,
      campaignExternalId: params.campaign_external_id,
      publisherName: params.publisher_name,
      adTitle: params.ad_title,
      contentName: params.content_name,
      siteId: params.site_id,
      platform: params.platform,
      assetId: params.asset_id,
      adsetId: params.utm_adset,
      placement: params.utm_content,
    });
    const clickId = generateClickId();
    const userAgent = visitor.userAgent;
    const ipAddress = visitor.ipAddress;
    const device = this.deviceParser.parse(userAgent);
    const geo = this.geoIp.lookup(ipAddress);
    const acceptLanguage = visitor.headers.acceptLanguage;
    const connectionType = inferConnectionType(
      device.device,
      undefined,
      visitor.headers.secChUaMobile,
    );
    const baseBot = detectBot({
      userAgent,
      acceptLanguage,
      hasSecFetchHeaders: Boolean(
        visitor.headers.secFetchDest || visitor.headers.secFetchMode,
      ),
    });
    const velocity = await this.evaluateVelocity(ipAddress);
    const bot = mergeBotSignals(baseBot, velocity);

    // Traffic routing: pick a path (rules) and rotate a variant (offer/lander).
    // With no paths configured this resolves to campaign.destinationUrl (legacy).
    const routing = resolveRouting(
      campaign.destinationUrl,
      (campaign.paths || []) as unknown as RoutablePath[],
      {
        country: geo.countryCode,
        device: device.device,
        os: device.os,
        browser: device.browser,
        connectionType,
      },
    );

    const { visitorId, isNewVisitor } = await this.resolveVisitor(campaign.id, visitor);

    await this.prisma.click.create({
      data: {
        clickId,
        campaignId: campaign.id,
        visitorId,
        isNewVisitor,
        trackingId: params.tracking_id || null,
        externalClickId: params.external_click_id || null,
        gclid: params.gclid || null,
        fbclid: params.fbclid || null,
        oppref: openAi.oppref,
        obref: openAi.obref,
        adId: params.ad_id || null,
        adTitle: params.ad_title || null,
        campaignExternalId: params.campaign_external_id || null,
        publisherName: params.publisher_name || null,
        siteId: params.site_id || null,
        contentName: params.content_name || null,
        platform: params.platform || null,
        assetId: params.asset_id || null,
        pathId: routing.pathId || voluum.pathId || null,
        variantId: routing.variantId || null,
        landerId: voluum.landerId || campaign.landerId || null,
        landerName: voluum.landerName || campaign.landerName || null,
        offerId: voluum.offerId || campaign.offerId || null,
        offerName: voluum.offerName || campaign.offerName || null,
        affiliateNetwork: voluum.affiliateNetwork || campaign.affiliateNetwork || null,
        affiliateNetworkId: voluum.affiliateNetworkId || campaign.affiliateNetworkId || null,
        trafficSourceId: voluum.trafficSourceId || campaign.trafficSourceId || null,
        trafficSourceName:
          campaign.trafficSourceName ||
          campaign.trafficSourceProfile?.name ||
          this.formatTrafficSource(campaign.trafficSource),
        customVariable1: customVars.cv1 || null,
        customVariable2: customVars.cv2 || null,
        customVariable3: customVars.cv3 || null,
        customVariable4: customVars.cv4 || null,
        customVariable5: customVars.cv5 || null,
        customVariable6: customVars.cv6 || null,
        customVariable7: customVars.cv7 || null,
        customVariable8: customVars.cv8 || null,
        customVariable9: customVars.cv9 || null,
        customVariable10: customVars.cv10 || null,
        utmSource: params.utm_source || null,
        utmMedium: params.utm_medium || null,
        utmCampaign: params.utm_campaign || null,
        utmTerm: params.utm_term || null,
        utmContent: params.utm_content || null,
        country: geo.country,
        countryCode: geo.countryCode,
        region: geo.region,
        city: geo.city,
        device: device.device,
        os: device.os,
        osVersion: device.osVersion,
        brand: device.brand,
        model: device.model,
        browser: device.browser,
        browserVersion: device.browserVersion,
        connectionType,
        cost: parseClickCost(
          rawParams,
          parseClickCostKeys(this.config.get<string>('CLICK_COST_KEYS')),
        ),
        isBot: bot.isBot,
        botScore: bot.score,
        botReasons: bot.reasons as Prisma.InputJsonValue,
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
        acceptLanguage: acceptLanguage || null,
        referrer: visitor.referrer || params.referrer || null,
        rawParams: rawParams as Prisma.InputJsonValue,
        requestHeaders: visitor.headers as Prisma.InputJsonValue,
      },
    });

    this.ipEnrichment.enrichClickAsync(clickId, ipAddress, userAgent, acceptLanguage);

    return {
      clickId,
      campaign,
      visitorId,
      isNewVisitor,
      utmSource: params.utm_source || null,
      routedDestination: routing.destination,
    };
  }

  /**
   * Click-flood detection: count clicks from this IP within the sliding window
   * and turn that into a bot-score contribution. Skipped for private/loopback
   * IPs (local dev). One count query per click — tune the window/threshold via
   * FRAUD_VELOCITY_* env or disable by setting the max to 0.
   */
  private async evaluateVelocity(ipAddress?: string) {
    const settings = await this.settings.getEffective();
    const config = parseVelocityConfig(
      settings.fraudVelocityWindowSeconds,
      settings.fraudVelocityMaxClicks,
    );
    if (!ipAddress || isPrivateOrLoopback(ipAddress) || config.maxClicks <= 0) {
      return { exceeded: false, score: 0 };
    }
    const since = new Date(Date.now() - config.windowSeconds * 1000);
    const recentCount = await this.prisma.click.count({
      where: { ipAddress, createdAt: { gte: since } },
    });
    return evaluateClickVelocity(recentCount, config);
  }

  private async resolveVisitor(
    campaignId: string,
    visitor: VisitorContext,
  ): Promise<{ visitorId: string; isNewVisitor: boolean }> {
    const fingerprint = fingerprintVisitorId(
      campaignId,
      visitor.ipAddress,
      visitor.userAgent,
    );
    const visitorId = visitor.visitorId || fingerprint;

    const priorVisit = await this.prisma.click.findFirst({
      where: {
        campaignId,
        OR: [
          { visitorId },
          ...(visitor.ipAddress
            ? [
                {
                  ipAddress: visitor.ipAddress,
                  userAgent: visitor.userAgent || undefined,
                },
              ]
            : []),
        ],
      },
      select: { id: true },
    });

    return { visitorId, isNewVisitor: !priorVisit };
  }

  private getCampaignParamMappings(campaign: {
    trafficSourceProfile?: { paramMappings: unknown } | null;
  }): ParamMapping[] {
    if (campaign.trafficSourceProfile?.paramMappings) {
      return campaign.trafficSourceProfile.paramMappings as unknown as ParamMapping[];
    }
    return DEFAULT_PARAM_MAPPINGS;
  }

  private async findCampaign(identifier: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: {
        OR: [{ slug: identifier }, { externalId: identifier }, { id: identifier }],
        active: true,
      },
      include: {
        trafficSourceProfile: true,
        paths: { where: { active: true }, include: { variants: { where: { active: true } } } },
      },
    });

    if (!campaign) {
      throw new NotFoundException(`Campaign "${identifier}" not found or inactive`);
    }

    return campaign;
  }

  async listClicks(filters: {
    campaignId?: string;
    from?: string;
    to?: string;
    publisher?: string;
    platform?: string;
    device?: string;
    country?: string;
    adId?: string;
    siteId?: string;
    contentName?: string;
    isBot?: boolean;
    isNewVisitor?: boolean;
    converted?: boolean;
    limit?: number;
    offset?: number;
  }) {
    const where: Prisma.ClickWhereInput = {};

    if (filters.campaignId) where.campaignId = filters.campaignId;
    if (filters.publisher) where.publisherName = { contains: filters.publisher, mode: 'insensitive' };
    if (filters.platform) where.platform = { equals: filters.platform, mode: 'insensitive' };
    if (filters.device) where.device = filters.device;
    if (filters.country) where.countryCode = filters.country;
    if (filters.adId) where.adId = { contains: filters.adId, mode: 'insensitive' };
    if (filters.siteId) where.siteId = { contains: filters.siteId, mode: 'insensitive' };
    if (filters.contentName) {
      where.contentName = { contains: filters.contentName, mode: 'insensitive' };
    }
    if (filters.isBot !== undefined) where.isBot = filters.isBot;
    if (filters.isNewVisitor !== undefined) where.isNewVisitor = filters.isNewVisitor;

    if (filters.from || filters.to) {
      where.createdAt = {
        ...(filters.from ? { gte: new Date(filters.from) } : {}),
        ...(filters.to ? { lte: new Date(filters.to) } : {}),
      };
    }

    if (filters.converted !== undefined) {
      const slugs = await this.eventTypes.getConversionCountSlugs();
      const conversionMatch: Prisma.ConversionListRelationFilter = {
        some: {
          eventType: slugs.length > 0 ? { in: slugs } : { in: ['__no_conversion_slugs__'] },
        },
      };
      if (filters.converted) {
        where.conversions = conversionMatch;
      } else {
        where.NOT = { conversions: conversionMatch };
      }
    }

    const [items, total] = await Promise.all([
      this.prisma.click.findMany({
        where,
        include: {
          campaign: {
            select: {
              name: true,
              slug: true,
              trafficSourceProfile: {
                select: { name: true, slug: true, paramMappings: true },
              },
            },
          },
          conversions: {
            select: {
              id: true,
              eventType: true,
              status: true,
              revenue: true,
              transactionId: true,
              createdAt: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: filters.limit || 50,
        skip: filters.offset || 0,
      }),
      this.prisma.click.count({ where }),
    ]);

    const conversionSlugs = new Set(await this.eventTypes.getConversionCountSlugs());

    return {
      items: items.map((click) => {
        const mappings = click.campaign.trafficSourceProfile?.paramMappings
          ? (click.campaign.trafficSourceProfile.paramMappings as unknown as ParamMapping[])
          : DEFAULT_PARAM_MAPPINGS;
        const counted = click.conversions.filter((c) =>
          this.eventTypes.isConversionCounted(c.eventType, conversionSlugs),
        );
        return {
          ...click,
          converted: counted.length > 0,
          conversionStatus: counted[0]?.status || click.conversions[0]?.status || null,
          isLocalIp: isPrivateOrLoopback(click.ipAddress || undefined),
          reportFields: getReportFieldsFromClick(click, mappings),
        };
      }),
      total,
    };
  }

  private formatTrafficSource(source: string): string {
    const labels: Record<string, string> = {
      mediago: 'Mediago',
      facebook: 'Facebook',
      google: 'Google',
      outbrain: 'Outbrain',
      native: 'Native',
    };
    return labels[source] || source;
  }

  getClickUrl(campaign: { slug: string; externalId?: string | null }): string {
    const base = this.config.get<string>('TRACKER_BASE_URL') || 'http://localhost:3001';
    const path = campaign.externalId || campaign.slug;
    return `${base}/${path}`;
  }
}
