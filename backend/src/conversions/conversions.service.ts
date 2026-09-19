import {
  Injectable,
  Logger,
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
import { resolveFacebookIdentifiers } from '../shared/tracking/facebook-cookies';
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
import { LEAD_OUTCOME_EVENTS, isLeadOutcomeEvent } from '../shared/tracking/lead-outcome-events';
import { buildFxConfig, normalizeToBase } from '../shared/tracking/currency';
import { SettingsService } from '../settings/settings.service';
import {
  CONTACT_EVENT_TYPES,
  errorLabel,
  hasContact,
  isContactEvent,
  isUniqueViolation,
  leadFromConversion,
  mergeLeadData,
  withoutContact,
  type LeadData,
} from '../leads/lead-fields';
import { fillLead, scrubVisitPii } from '../leads/lead-sql';

@Injectable()
export class ConversionsService {
  private readonly logger = new Logger(ConversionsService.name);

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
    eventType?: string,
    trackingId?: string,
  ): Promise<void> {
    const ipAllowlist = parseIpAllowlist(
      this.config.get<string>('POSTBACK_IP_ALLOWLIST'),
    );

    let expectedSecret: string | null = null;
    // Same resolution as create() (clickId, else trackingId): a `tracking_id=` postback without `cid` used to skip
    // the campaign secret and still record the conversion.
    const target =
      resolvedClickId || trackingId
        ? await this.findClick({ clickId: resolvedClickId, trackingId } as CreateConversionDto)
        : null;
    if (target) {
      const click = await this.prisma.click.findUnique({
        where: { clickId: target.clickId ?? resolvedClickId },
        select: { campaign: { select: { postbackConfig: { select: { postbackSecret: true } } } } },
      });
      expectedSecret = click?.campaign.postbackConfig?.postbackSecret ?? null;
    }

    if (!expectedSecret && ipAllowlist.length === 0) {
      // A buyer outcome moves money (a Meta Purchase, reported revenue): never from an unauthenticated
      // caller, even on a campaign that has not set a secret yet.
      if (isLeadOutcomeEvent(eventType)) {
        throw new ForbiddenException(
          'Buyer outcome postbacks need a campaign postback secret or POSTBACK_IP_ALLOWLIST',
        );
      }
      // Nothing to enforce for this campaign and no global allowlist — stay open.
      return;
    }

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

    const eventType = normalizeEventType(dto.eventType);
    // Untrusted (public browser) callers never read the response body — the
    // tracker fetch only .catch()es — so skip the join-heavy re-fetch on the
    // hot path (fires on every quiz click_button).
    const trusted = context?.trusted !== false;
    const outcome = isLeadOutcomeEvent(eventType);

    // A buyer's verdict on a lead only ever comes from the buyer's server; from
    // the public endpoint it would let anyone refuse or return our leads.
    if (outcome && !trusted) {
      return { skipped: true, reason: 'outcome_requires_server_postback' };
    }

    // Attribution window: reject conversions that land too long after the click.
    // Buyer outcomes are exempt — they describe a lead we already attributed, and
    // routinely arrive days after the click.
    if (
      !outcome &&
      !isWithinAttributionWindow(
        click.createdAt,
        new Date(),
        click.campaign?.attributionWindowHours,
      )
    ) {
      return { skipped: true, reason: 'outside_attribution_window' };
    }

    const existing = await this.prisma.conversion.findUnique({
      where: { clickId_eventType: { clickId: click.clickId, eventType } },
    });

    if (existing) {
      // Même une conversion en doublon peut porter un contact que la première n'avait pas.
      await this.storeLead(click, eventType, dto, context, existing.id);
      if (!trusted) return { conversion: { id: existing.id }, duplicate: true };
      const full = await this.getConversionWithClick(existing.id);
      return { conversion: full, duplicate: true };
    }

    // Per-click conversion cap (across all event types) to curb injection/abuse.
    // Outcomes neither count towards it nor are blocked by it: capping a buyer's
    // verdict would lose revenue, not stop abuse.
    if (!outcome && click.campaign?.maxConversionsPerClick != null) {
      const existingCount = await this.prisma.conversion.count({
        where: { clickId: click.clickId, eventType: { notIn: [...LEAD_OUTCOME_EVENTS] } },
      });
      if (isConversionCapReached(existingCount, click.campaign.maxConversionsPerClick)) {
        return { skipped: true, reason: 'conversion_cap_reached' };
      }
    }

    // Facebook CAPI match quality depends on fbp/fbc. They were never captured:
    // the browser script did not read the Meta cookies, and the server-side
    // helper existed but was called from nowhere — so every CAPI event went out
    // without them. Resolve them here, once, for every intake path.
    const facebookIds = resolveFacebookIdentifiers({
      metadata: dto.metadata as Record<string, unknown> | undefined,
      cookieHeader: context?.cookieHeader,
      fbclid: click.fbclid,
      clickedAt: click.createdAt,
    });
    const metadata = { ...(dto.metadata || {}), ...facebookIds };

    const settings = await this.settings.getEffective();
    const fx = buildFxConfig(settings.baseCurrency, settings.fxRates);
    // Une personne effacée ne revient pas par une conversion tardive (postback rejoué, re-soumission) : ni dans les
    // métadonnées de la nouvelle conversion, ni dans la ligne tombale du lead.
    const { erased, metadata: storedMetadata } = await this.erasureState(click.clickId, metadata);
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
        // Devise acheteur acceptée seulement si c'est un code ISO à 3 lettres : une macro non remplacée
        // (« {CURRENCY} ») ne doit ni partir chez Meta ni rendre incomparables les enchères du machine API.
        currency: validCurrency(dto.currency),
        revenueBase: normalizeToBase(revenue, validCurrency(dto.currency) ?? undefined, fx),
        costBase: normalizeToBase(cost, validCurrency(dto.currency) ?? undefined, fx),
        transactionId: dto.transactionId || null,
        status: ConversionStatus.pending,
        metadata: storedMetadata as Prisma.InputJsonValue,
        incomingPostbackIp: erased ? null : context?.incomingPostbackIp || null,
        incomingPostbackUrl: erased
          ? context?.incomingPostbackUrl
            ? `${context.incomingPostbackUrl.split('?')[0]}?[erased]`
            : null
          : context?.incomingPostbackUrl || null,
        // Une visite effacée n'écrit plus rien de la personne : ces cinq colonnes libres sont l'endroit où les
        // acheteurs rangent l'adresse et le numéro, et elles ressortent dans l'export.
        postbackParam1: erased ? null : dto.postbackParam1 || context?.postbackParam1 || null,
        postbackParam2: erased ? null : dto.postbackParam2 || context?.postbackParam2 || null,
        postbackParam3: erased ? null : dto.postbackParam3 || context?.postbackParam3 || null,
        postbackParam4: erased ? null : dto.postbackParam4 || context?.postbackParam4 || null,
        postbackParam5: erased ? null : dto.postbackParam5 || context?.postbackParam5 || null,
        // A test click can only ever produce test conversions; and firing a
        // conversion while test mode is on marks it test even against a real
        // click, so rehearsing a postback never adds a lead to the reports.
        isTest: click.isTest || settings.testMode,
      },
    });

    // La demande d'effacement a pu arriver entre la lecture ci-dessus et cette écriture : le nettoyage de
    // l'effacement était alors déjà passé, et cette conversion aurait gardé la personne. On revérifie après coup.
    const erasedNow = erased || (await this.erasedSince(click.clickId));
    await this.storeLead(click, eventType, dto, context, conversion.id, erasedNow);

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

    // Normalisé une seule fois : le contrôle des issues acheteur et l'enregistrement voient exactement le même type.
    // Sinon `et=lead_sold.` ou `et=lead sold` passaient le contrôle puis étaient enregistrés en lead_sold.
    const eventType = normalizeEventType(get('et') || get('event_type'));
    await this.assertPostbackAuthorized(
      resolvedClickId,
      query,
      context,
      eventType,
      get('tracking_id') || get('externalid'),
    );

    return this.create(
      {
        clickId: resolvedClickId,
        trackingId: get('tracking_id') || get('externalid'),
        eventType,
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

  /**
   * The lead behind this visit. Quiz pages send the answers with `lead` and the contact later with
   * `callback_request`, so the row is keyed by click and filled in as the events arrive — and it is only created once
   * a real contact (phone, email or name) has been received, never for a funnel step alone.
   * A failure here loses nothing: the conversion and its metadata are already stored.
   */
  private async storeLead(
    click: { clickId: string; campaignId: string; isTest: boolean },
    eventType: string,
    dto: CreateConversionDto,
    context?: ConversionContext,
    conversionId?: string,
    erased = false,
  ): Promise<void> {
    if (!isContactEvent(eventType) || erased) return;
    try {
      const incoming = leadFromConversion(dto.metadata as Record<string, unknown>, context);
      if (!hasContact(incoming)) {
        // Une étape du tunnel sans contact : elle complète une visite déjà connue, mais ne crée jamais de lead.
        // Le UPDATE ne touche rien s'il n'y a pas de ligne, et jamais une ligne effacée ou purgée.
        await fillLead(this.prisma, click.clickId, incoming, conversionId ?? null);
        return;
      }
      // Les réponses déjà envoyées par les événements précédents de ce clic complètent le contact qui arrive.
      // Chaque événement est relu avec SA date (preuve de consentement) et le plus ancien garde la main, comme dans
      // la réconciliation : un même clic donne le même lead par les deux chemins.
      const earlier = await this.prisma.conversion.findMany({
        where: { clickId: click.clickId, eventType: { in: [...CONTACT_EVENT_TYPES] } },
        select: { metadata: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
        take: 20,
      });
      let data: LeadData | null = null;
      for (const row of earlier) {
        data = mergeLeadData(data, leadFromConversion(row.metadata as Record<string, unknown>, undefined, row.createdAt));
      }
      data = mergeLeadData(data, incoming);
      const settings = await this.settings.getEffective();
      try {
        await this.prisma.lead.create({
          data: {
            ...data,
            answers: data.answers ?? undefined,
            clickId: click.clickId,
            campaignId: click.campaignId,
            conversionId: conversionId ?? null,
            isTest: click.isTest || settings.testMode,
          },
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        // Deux événements du même clic en même temps : l'autre a créé la ligne, celui-ci la complète — champ par
        // champ, côté base, donc rien de ce que l'autre a écrit n'est écrasé.
        await fillLead(this.prisma, click.clickId, data, conversionId ?? null);
      }
    } catch (err) {
      // Jamais le message de l'erreur : Prisma y recopie les données envoyées, donc les coordonnées du lead.
      this.logger.error(`Lead not stored for click ${click.clickId}: ${errorLabel(err)}`);
    }
  }

  /**
   * Whether this visit was erased on request, and the metadata to store for it: a person who asked to be forgotten
   * is not written back by a late conversion, neither in the metadata nor as a lead.
   */
  private async erasureState(
    clickId: string,
    metadata: Record<string, unknown>,
  ): Promise<{ erased: boolean; metadata: Record<string, unknown> }> {
    // Aucun raccourci sur le contenu : l'acheteur met couramment l'adresse dans `p1`, jamais dans les métadonnées,
    // et une garde qui ne regarde que celles-ci laisse la personne effacée revenir en clair par une colonne de
    // postback. La lecture se fait sur `click_id`, qui est un index unique.
    try {
      const erased = await this.prisma.lead.findFirst({
        where: { clickId, NOT: { erasedAt: null } },
        select: { id: true },
      });
      if (!erased) return { erased: false, metadata };
      // En mode « effacement » : le code postal, l'État et les réponses partent aussi, comme dans la ligne du lead.
      // Sans ce mot, un postback rejoué le lendemain les réécrivait, et la rétention les garde par construction.
      const cleaned = withoutContact(metadata, 'erased');
      return {
        erased: true,
        // `withoutContact` rend `null` quand il n'y avait rien à retirer, et un TABLEAU quand on lui en donne un.
        // Écarter le tableau réécrivait l'ORIGINAL — donc la personne effacée — sur une visite effacée. Le cas est
        // d'ailleurs injoignable ici : `metadata` vient d'un littéral d'objet (`{ ...dto.metadata, ...ids }`), donc
        // un tableau envoyé par l'acheteur y arrive déjà en objet à clés numériques. La branche disparaît plutôt
        // que de rester fausse.
        metadata: (cleaned as Record<string, unknown> | null) ?? metadata,
      };
    } catch (err) {
      this.logger.error(`Erasure check failed for click ${clickId}: ${errorLabel(err)}`);
      return { erased: false, metadata };
    }
  }

  /**
   * Whether the visit was erased while this conversion was being written — and if so, clears the person from what
   * was just written, because the erasure's own scrub had already run by then.
   */
  private async erasedSince(clickId: string): Promise<boolean> {
    try {
      const erased = await this.prisma.lead.findFirst({
        where: { clickId, NOT: { erasedAt: null } },
        select: { id: true },
      });
      if (!erased) return false;
      await scrubVisitPii(this.prisma, [clickId], 'erased');
      this.logger.warn(`Conversion written for click ${clickId} during its erasure — scrubbed again`);
      return true;
    } catch (err) {
      this.logger.error(`Erasure re-check failed for click ${clickId}: ${errorLabel(err)}`);
      return false;
    }
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

function validCurrency(raw?: string | null): string | null {
  const code = (raw || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}
