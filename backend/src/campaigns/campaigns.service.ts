import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DomainStatus, Prisma, TrackingMode, TrafficSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DomainsService } from '../domains/domains.service';
import { TrackerScriptService } from '../tracker-script/tracker-script.service';
import { TrafficSourcesService } from '../traffic-sources/traffic-sources.service';
import { buildClickUrlFromTemplate } from '../shared/tracking/param-mapping';
import { getVisitStats } from '../analytics/visit-stats';
import { ConversionEventTypesService } from '../conversion-event-types/conversion-event-types.service';
import {
  CreateCampaignDto,
  UpdateCampaignDto,
  UpdatePostbackConfigDto,
} from './dto/create-campaign.dto';

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly domainsService: DomainsService,
    private readonly trackerScript: TrackerScriptService,
    private readonly trafficSources: TrafficSourcesService,
    private readonly eventTypes: ConversionEventTypesService,
  ) {}

  async create(dto: CreateCampaignDto) {
    await this.validateDomainId(dto.domainId);
    await this.assertUniqueCampaignRefs(dto.slug, dto.externalId);
    const profile = await this.resolveProfile(dto.trafficSourceProfileId, dto.trafficSource);

    const postbackDefaults = this.trafficSources.buildPostbackDefaultsFromProfile(profile);

    const campaign = await this.prisma.campaign.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        externalId: dto.externalId || undefined,
        domainId: dto.domainId || undefined,
        trafficSource: dto.trafficSource || this.slugToTrafficSource(profile.slug),
        trafficSourceProfileId: profile.id,
        trackingMode:
          dto.trackingMode || profile.trackingModeDefault || TrackingMode.redirect,
        redirectMode: dto.redirectMode,
        trafficSourceName: dto.trafficSourceName || profile.name,
        trafficSourceId: dto.trafficSourceId,
        workspaceName: dto.workspaceName,
        workspaceId: dto.workspaceId,
        landerId: dto.landerId,
        landerName: dto.landerName,
        offerId: dto.offerId,
        offerName: dto.offerName,
        affiliateNetwork: dto.affiliateNetwork,
        affiliateNetworkId: dto.affiliateNetworkId,
        attributionWindowHours: dto.attributionWindowHours,
        maxConversionsPerClick: dto.maxConversionsPerClick,
        destinationUrl: dto.destinationUrl,
        active: dto.active ?? true,
        postbackConfig: { create: postbackDefaults },
      },
      include: { postbackConfig: true, domain: true, trafficSourceProfile: true },
    });

    return this.enrichCampaign(campaign);
  }

  async findAll() {
    const campaigns = await this.prisma.campaign.findMany({
      include: { postbackConfig: true, domain: true, trafficSourceProfile: true },
      orderBy: { createdAt: 'desc' },
    });

    return campaigns.map((c) => this.enrichCampaign(c));
  }

  async findOne(id: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: { postbackConfig: true, domain: true, trafficSourceProfile: true },
    });

    if (!campaign) throw new NotFoundException('Campaign not found');
    return this.enrichCampaign(campaign);
  }

  async update(id: string, dto: UpdateCampaignDto) {
    await this.findOne(id);
    if (dto.domainId !== undefined) {
      await this.validateDomainId(dto.domainId || undefined);
    }

    const { domainId, trafficSourceProfileId, ...rest } = dto;
    const data: Prisma.CampaignUpdateInput = { ...rest };

    if (dto.externalId === '') {
      data.externalId = null;
    }

    if (domainId === '') {
      data.domain = { disconnect: true };
    } else if (domainId) {
      data.domain = { connect: { id: domainId } };
    }

    if (trafficSourceProfileId) {
      const profile = await this.trafficSources.findOne(trafficSourceProfileId);
      data.trafficSourceProfile = { connect: { id: profile.id } };
      data.trafficSource = this.slugToTrafficSource(profile.slug);
      if (!dto.trafficSourceName) data.trafficSourceName = profile.name;
      if (!dto.trackingMode) data.trackingMode = profile.trackingModeDefault;
    } else if (dto.trafficSource && !dto.trafficSourceName) {
      data.trafficSourceName = this.defaultTrafficSourceName(dto.trafficSource);
    }

    const campaign = await this.prisma.campaign.update({
      where: { id },
      data,
      include: { postbackConfig: true, domain: true, trafficSourceProfile: true },
    });

    return this.enrichCampaign(campaign);
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.campaign.delete({ where: { id } });
    return { deleted: true, id };
  }

  async updatePostbackConfig(campaignId: string, dto: UpdatePostbackConfigDto) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { postbackConfig: true },
    });

    if (!campaign) throw new NotFoundException('Campaign not found');

    if (!campaign.postbackConfig) {
      await this.prisma.postbackConfig.create({
        data: { campaignId, ...dto },
      });
    } else {
      await this.prisma.postbackConfig.update({
        where: { campaignId },
        data: dto,
      });
    }

    return this.findOne(campaignId);
  }

  async getStats(campaignId: string) {
    const convCountWhere = await this.eventTypes.applyConversionCountFilter({ campaignId });
    try {
      const [visitStats, conversions, sentConversions] = await Promise.all([
        getVisitStats(this.prisma, campaignId),
        this.prisma.conversion.count({ where: convCountWhere }),
        this.prisma.conversion.count({
          where: { ...convCountWhere, status: 'sent' },
        }),
      ]);

      const { visits, uniqueVisits, newVisitors, returningVisitors } = visitStats;

      return {
        clicks: visits,
        visits,
        uniqueVisits,
        newVisitors,
        returningVisitors,
        conversions,
        sentConversions,
        conversionRate: visits > 0 ? ((conversions / visits) * 100).toFixed(2) : '0',
      };
    } catch {
      const [visits, conversions, sentConversions] = await Promise.all([
        this.prisma.click.count({ where: { campaignId, isTest: false } }),
        this.prisma.conversion.count({ where: convCountWhere }),
        this.prisma.conversion.count({
          where: { ...convCountWhere, status: 'sent' },
        }),
      ]);

      return {
        clicks: visits,
        visits,
        uniqueVisits: visits,
        newVisitors: visits,
        returningVisitors: 0,
        conversions,
        sentConversions,
        conversionRate: visits > 0 ? ((conversions / visits) * 100).toFixed(2) : '0',
      };
    }
  }

  private async resolveProfile(profileId?: string, trafficSource?: TrafficSource) {
    if (profileId) {
      return this.trafficSources.findOne(profileId);
    }
    if (trafficSource) {
      const profile = await this.trafficSources.findBySlug(trafficSource);
      if (profile) return profile;
    }
    const mediago = await this.trafficSources.findBySlug('mediago');
    if (!mediago) throw new BadRequestException('No traffic source profiles configured');
    return mediago;
  }

  private slugToTrafficSource(slug: string): TrafficSource {
    const known: TrafficSource[] = ['mediago', 'facebook', 'google', 'outbrain', 'native'];
    if (known.includes(slug as TrafficSource)) return slug as TrafficSource;
    return TrafficSource.native;
  }

  private defaultTrafficSourceName(source: string): string {
    const labels: Record<string, string> = {
      mediago: 'Mediago',
      facebook: 'Facebook',
      google: 'Google',
      outbrain: 'Outbrain',
      native: 'Native',
    };
    return labels[source] || source;
  }

  private async validateDomainId(domainId?: string) {
    if (!domainId) return;
    const domain = await this.prisma.trackingDomain.findUnique({ where: { id: domainId } });
    if (!domain) throw new NotFoundException('Tracking domain not found');
    if (domain.status !== DomainStatus.verified) {
      throw new BadRequestException(
        `Domain ${domain.hostname} is not verified yet. Add DNS records at GoDaddy and click Verify.`,
      );
    }
  }

  private async assertUniqueCampaignRefs(slug: string, externalId?: string) {
    const existingSlug = await this.prisma.campaign.findUnique({ where: { slug } });
    if (existingSlug) {
      throw new ConflictException(
        `Campaign slug "${slug}" already exists. Choose a different slug or edit the existing campaign.`,
      );
    }
    if (externalId) {
      const existingExternal = await this.prisma.campaign.findUnique({
        where: { externalId },
      });
      if (existingExternal) {
        throw new ConflictException(
          `External ID "${externalId}" is already used by campaign "${existingExternal.name}".`,
        );
      }
    }
  }

  private enrichCampaign(campaign: {
    slug: string;
    externalId?: string | null;
    trafficSource: string;
    trackingMode?: TrackingMode;
    destinationUrl: string;
    name: string;
    domain?: { hostname: string; status: DomainStatus; label: string } | null;
    trafficSourceProfile?: {
      name: string;
      slug: string;
      trackingModeDefault: TrackingMode;
      clickUrlTemplate: string | null;
      directAdUrlTemplate: string | null;
      paramMappings: unknown;
      setupNote: string | null;
      conversionMethod: string;
    } | null;
    [key: string]: unknown;
  }) {
    const trackerBase = this.domainsService.getTrackerBaseUrl(campaign.domain);
    const campaignRef = campaign.externalId || campaign.slug;
    const clickUrl = `${trackerBase}/${campaignRef}`;
    const mode = campaign.trackingMode || TrackingMode.redirect;
    const profile = campaign.trafficSourceProfile;

    const lpScriptSnippet = this.trackerScript.getLpScriptSnippet(
      campaignRef,
      mode,
      trackerBase,
    );

    let trackingTemplate = campaign.destinationUrl;
    if (profile) {
      if (mode === TrackingMode.direct && profile.directAdUrlTemplate) {
        trackingTemplate = buildClickUrlFromTemplate(
          profile.directAdUrlTemplate,
          clickUrl,
          campaign.destinationUrl,
          campaign.name,
        );
      } else if (profile.clickUrlTemplate) {
        trackingTemplate = buildClickUrlFromTemplate(
          profile.clickUrlTemplate,
          clickUrl,
          campaign.destinationUrl,
          campaign.name,
        );
      }
    }

    const incomingConversionUrl = `${trackerBase}/postback?cid={click_id}&et=lead&payout={payout}&txid={transaction_id}`;
    const incomingConversionUrlAlt = `${trackerBase}/postback/{click_id}?et=lead&payout={payout}`;

    return {
      ...campaign,
      trackerBaseUrl: trackerBase,
      clickUrl,
      trackingMode: mode,
      trackingTemplate,
      directAdUrl:
        mode === TrackingMode.direct
          ? trackingTemplate
          : null,
      lpScriptSnippet,
      incomingConversionUrl,
      incomingConversionUrlAlt,
      setupNote: profile?.setupNote || null,
      paramMappings: profile?.paramMappings || [],
      conversionMethod: profile?.conversionMethod || null,
    };
  }
}
