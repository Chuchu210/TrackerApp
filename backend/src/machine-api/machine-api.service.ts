import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AdPlatform } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

const MAX_AD_IDS = 200;
const MAX_WINDOW_DAYS = 92;
// realizedValue: a lead is never attributed to a click older than this, so the clicks read stays bounded.
const MAX_CLICK_TO_LEAD_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

type OutcomeCountsRow = {
  ad_id: string;
  clicks: number;
  leads: number;
  leads_sold: number;
  leads_returned: number;
  leads_rejected: number;
  leads_pending_outcome: number;
  bids_sum: number;
  bid_currencies: string[] | null;
};

type RealizedValueRow = {
  leads_settled: number;
  sold_kept: number;
  returned: number;
  rejected: number;
  no_outcome: number;
  bids_sum: number;
  bid_currencies: string[] | null;
};

/**
 * Read-only facts for the media-buying machine (PRD §6.7, §11.1, §16.2).
 *
 * The tracker stays "dumb": these endpoints count and sum what it already
 * stores, they decide nothing. Every query is bounded by a window or a cohort
 * so that none of them scans clicks or conversions on the redirect path.
 */
@Injectable()
export class MachineApiService {
  private readonly logger = new Logger(MachineApiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Per-ad spend, clicks, leads and buyer outcomes. Leads and outcomes are
   * attributed to the click's time: a lead is counted in the window its click
   * fell in, even if the buyer answered later.
   */
  async factsForAds(query: Record<string, string | undefined>) {
    const ids = parseAdIds(query.meta_ad_ids);
    const from = parseDate(query.from, 'from');
    const to = parseDate(query.to, 'to');
    if (to <= from) throw new BadRequestException('`to` must be after `from`');
    if (to.getTime() - from.getTime() > MAX_WINDOW_DAYS * DAY_MS) {
      throw new BadRequestException(`window longer than ${MAX_WINDOW_DAYS} days`);
    }
    const latencyHours = parseIntParam(query.latency_hours, 72, 0, 24 * 60, 'latency_hours');
    const dateRange = { gte: startOfUtcDay(from), lt: to };

    const spendRows = await this.prisma.adSpendSnapshot.groupBy({
      by: ['externalAdId', 'externalAdsetId', 'currency'],
      where: { platform: AdPlatform.facebook, externalAdId: { in: ids }, date: dateRange },
      _sum: { spend: true },
    });

    // Adset totals give spend_share its denominator (PRD §6.0): the ad's spend
    // over everything its adset spent, and how many ads actually spent.
    const adsetIds = [
      ...new Set(spendRows.map((r) => r.externalAdsetId).filter((v): v is string => !!v)),
    ];
    const adsetTotals = new Map<string, { spend: number; activeAds: number }>();
    if (adsetIds.length > 0) {
      const adsetRows = await this.prisma.adSpendSnapshot.groupBy({
        by: ['externalAdsetId', 'externalAdId'],
        where: { platform: AdPlatform.facebook, externalAdsetId: { in: adsetIds }, date: dateRange },
        _sum: { spend: true },
      });
      for (const row of adsetRows) {
        const key = row.externalAdsetId as string;
        const spend = row._sum.spend ?? 0;
        const total = adsetTotals.get(key) ?? { spend: 0, activeAds: 0 };
        total.spend += spend;
        if (spend > 0) total.activeAds += 1;
        adsetTotals.set(key, total);
      }
    }

    const outcomeRows = await this.prisma.$queryRaw<OutcomeCountsRow[]>`
      WITH k AS (
        SELECT c.click_id, c.ad_id
        FROM clicks c
        WHERE c.ad_id = ANY(${ids}::text[])
          AND c.created_at >= ${from} AND c.created_at < ${to}
          AND c.is_test = false
      ),
      ev AS (
        SELECT k.ad_id, k.click_id,
               bool_or(v.event_type = 'lead')          AS lead,
               bool_or(v.event_type = 'lead_sold')     AS sold,
               bool_or(v.event_type = 'lead_rejected') AS rejected,
               bool_or(v.event_type = 'lead_returned') AS returned,
               -- Bids in the currency the buyer sent: revenue_base is labelled BASE_CURRENCY, which defaults
               -- to USD while the recorded amounts are euros, and sums unconvertible currencies as-is.
               max(v.revenue) FILTER (WHERE v.event_type = 'lead_sold') AS bid,
               max(COALESCE(upper(v.currency), 'EUR')) FILTER (WHERE v.event_type = 'lead_sold') AS bid_currency
        FROM k
        LEFT JOIN conversions v ON v.click_id = k.click_id AND v.is_test = false
        GROUP BY k.ad_id, k.click_id
      )
      SELECT ad_id,
             COUNT(*)::int                                                         AS clicks,
             COUNT(*) FILTER (WHERE lead)::int                                     AS leads,
             COUNT(*) FILTER (WHERE sold AND NOT returned)::int                    AS leads_sold,
             COUNT(*) FILTER (WHERE returned)::int                                 AS leads_returned,
             COUNT(*) FILTER (WHERE rejected AND NOT sold)::int                    AS leads_rejected,
             COUNT(*) FILTER (WHERE lead AND sold IS NOT TRUE AND rejected IS NOT TRUE
                                          AND returned IS NOT TRUE)::int           AS leads_pending_outcome,
             COALESCE(SUM(bid) FILTER (WHERE sold AND NOT returned), 0)::float     AS bids_sum,
             ARRAY_AGG(DISTINCT bid_currency) FILTER (WHERE sold AND NOT returned AND bid_currency IS NOT NULL) AS bid_currencies
      FROM ev
      GROUP BY ad_id`;

    const outcomesByAd = new Map(outcomeRows.map((r) => [r.ad_id, r]));
    const spendByAd = new Map<string, { spend: number; adsetId: string | null; currency: string }>();
    for (const row of spendRows) {
      const current = spendByAd.get(row.externalAdId);
      spendByAd.set(row.externalAdId, {
        spend: (current?.spend ?? 0) + (row._sum.spend ?? 0),
        adsetId: row.externalAdsetId ?? current?.adsetId ?? null,
        currency: row.currency,
      });
    }
    // Bids are reported in the buyer's currency. One currency across the requested ads: that currency. None
    // (no sale): the single spend currency, so a campaign without sales stays comparable. Several: null, and
    // the caller must not compare spend and revenue.
    const bidCurrencies = new Set<string>();
    for (const row of outcomeRows) for (const c of row.bid_currencies ?? []) bidCurrencies.add(c);
    const spendCurrencies = new Set(spendRows.map((r) => r.currency).filter((c): c is string => !!c));
    const bidsCurrency =
      bidCurrencies.size === 1
        ? [...bidCurrencies][0]
        : bidCurrencies.size === 0 && spendCurrencies.size === 1
          ? [...spendCurrencies][0]
          : null;

    return {
      schema_version: '1.0',
      window: { from: from.toISOString(), to: to.toISOString() },
      // Meta spend is stored per whole day (ad account time zone): spend covers these days, clicks the exact window.
      // Callers wanting matching figures send bounds at midnight UTC.
      spend_window: { from: dateRange.gte.toISOString(), to: to.toISOString(), granularity: 'day' },
      // Buyers answer after the lead: facts are final once the window closed
      // longer ago than their outcome latency.
      attribution_closed: to.getTime() <= Date.now() - latencyHours * HOUR_MS,
      bids_currency: bidsCurrency,
      rows: ids.map((id) => {
        const spend = spendByAd.get(id);
        const adset = spend?.adsetId ? adsetTotals.get(spend.adsetId) : undefined;
        const outcome = outcomesByAd.get(id);
        return {
          meta_ad_id: id,
          meta_adset_id: spend?.adsetId ?? null,
          spend: roundCents(spend?.spend ?? 0),
          spend_currency: spend?.currency ?? null,
          adset_spend: adset ? roundCents(adset.spend) : null,
          n_ads_active_adset: adset?.activeAds ?? null,
          clicks: outcome?.clicks ?? 0,
          leads: outcome?.leads ?? 0,
          leads_sold: outcome?.leads_sold ?? 0,
          leads_returned: outcome?.leads_returned ?? 0,
          leads_rejected: outcome?.leads_rejected ?? 0,
          leads_pending_outcome: outcome?.leads_pending_outcome ?? 0,
          // Several bid currencies on one ad cannot be summed.
          bids_sum: (outcome?.bid_currencies?.length ?? 0) > 1 ? null : roundCents(outcome?.bids_sum ?? 0),
          // Même règle qu'au niveau global : sans vente, la devise de dépense de l'annonce.
          bids_currency:
            (outcome?.bid_currencies?.length ?? 0) === 0
              ? spend?.currency ?? null
              : outcome!.bid_currencies!.length === 1
                ? outcome!.bid_currencies![0]
                : null,
        };
      }),
    };
  }

  /**
   * Realized value of a lead for an offer (PRD §11.1): only leads old enough for
   * the buyer to have answered are measured, with or without an answer —
   * excluding just the young unanswered ones would inflate acceptance.
   */
  async realizedValue(offerId: string, query: Record<string, string | undefined>) {
    if (!offerId?.trim()) throw new BadRequestException('offerId is required');
    const days = parseIntParam(query.days, 7, 1, MAX_WINDOW_DAYS, 'days');
    const latencyHours = parseIntParam(query.latency_hours, 72, 0, 24 * 60, 'latency_hours');

    const [row] = await this.prisma.$queryRaw<RealizedValueRow[]>`
      WITH cohort AS (
        SELECT l.click_id
        FROM conversions l
        JOIN clicks c ON c.click_id = l.click_id
        WHERE c.offer_id = ${offerId} AND l.event_type = 'lead' AND l.is_test = false
          AND l.created_at >= now() - make_interval(days => ${days}::int, hours => ${latencyHours}::int)
          AND c.created_at >= now() - make_interval(days => ${days + MAX_CLICK_TO_LEAD_DAYS}::int, hours => ${latencyHours}::int)
          AND l.created_at <  now() - make_interval(hours => ${latencyHours}::int)
      ),
      outcomes AS (
        SELECT o.click_id,
               bool_or(o.event_type = 'lead_sold')     AS sold,
               bool_or(o.event_type = 'lead_rejected') AS rejected,
               bool_or(o.event_type = 'lead_returned') AS returned,
               max(o.revenue) FILTER (WHERE o.event_type = 'lead_sold') AS bid,
               max(COALESCE(upper(o.currency), 'EUR')) FILTER (WHERE o.event_type = 'lead_sold') AS bid_currency
        FROM conversions o
        JOIN cohort k ON k.click_id = o.click_id
        WHERE o.event_type IN ('lead_sold', 'lead_rejected', 'lead_returned') AND o.is_test = false
        GROUP BY o.click_id
      )
      SELECT
        COUNT(*)::int                                                      AS leads_settled,
        COUNT(*) FILTER (WHERE o.sold AND NOT o.returned)::int             AS sold_kept,
        COUNT(*) FILTER (WHERE o.returned)::int                            AS returned,
        COUNT(*) FILTER (WHERE o.rejected AND NOT o.sold)::int             AS rejected,
        COUNT(*) FILTER (WHERE o.click_id IS NULL)::int                    AS no_outcome,
        COALESCE(SUM(o.bid) FILTER (WHERE o.sold AND NOT o.returned), 0)::float AS bids_sum,
        ARRAY_AGG(DISTINCT o.bid_currency) FILTER (WHERE o.sold AND NOT o.returned AND o.bid_currency IS NOT NULL) AS bid_currencies
      FROM cohort k LEFT JOIN outcomes o ON o.click_id = k.click_id`;

    const settled = row?.leads_settled ?? 0;
    const soldKept = row?.sold_kept ?? 0;
    const bidsSum = row?.bids_sum ?? 0;
    const currencies = row?.bid_currencies ?? [];
    const singleCurrency = currencies.length <= 1;

    return {
      schema_version: '1.0',
      offer_id: offerId,
      days,
      latency_hours: latencyHours,
      leads_settled: settled,
      sold_kept: soldKept,
      returned: row?.returned ?? 0,
      rejected: row?.rejected ?? 0,
      no_outcome: row?.no_outcome ?? 0,
      bids_sum: singleCurrency ? roundCents(bidsSum) : null,
      currency: currencies.length === 1 ? currencies[0] : null,
      acceptance: settled > 0 ? soldKept / settled : null,
      value_per_lead: settled > 0 && singleCurrency ? roundCents(bidsSum / settled) : null,
    };
  }

  /** Clicks per UTC hour from the aggregate table — never from clicks itself. */
  async trafficHourly(query: Record<string, string | undefined>) {
    const days = parseIntParam(query.days, 28, 1, 60, 'days');
    const rows = await this.prisma.clickHourlyCount.findMany({
      where: { hour: { gte: new Date(Date.now() - days * DAY_MS) } },
      orderBy: { hour: 'asc' },
    });
    return {
      schema_version: '1.0',
      days,
      rows: rows.map((r) => ({ hour: r.hour.toISOString(), clicks: r.clicks })),
    };
  }

  /**
   * Keeps click_hourly_counts current. Recomputes only the current and previous
   * UTC hour, which the BRIN index on clicks(created_at) serves without a
   * sequential scan; older hours are final and never re-read.
   */
  @Cron('*/5 * * * *')
  async refreshHourlyCounts() {
    try {
      await this.prisma.$executeRaw`
        INSERT INTO click_hourly_counts (hour, clicks, updated_at)
        SELECT date_trunc('hour', created_at), COUNT(*)::int, now()
        FROM clicks
        WHERE created_at >= date_trunc('hour', (now() AT TIME ZONE 'UTC') - interval '1 hour')
        GROUP BY 1
        ON CONFLICT (hour) DO UPDATE SET clicks = EXCLUDED.clicks, updated_at = now()`;
    } catch (err) {
      this.logger.error('click_hourly_counts refresh failed', err as Error);
    }
  }
}

function parseAdIds(raw?: string | string[]): string[] {
  // `?meta_ad_ids=1&meta_ad_ids=2` arrives as an array.
  const joined = Array.isArray(raw) ? raw.join(',') : raw || '';
  const ids = [...new Set(joined.split(',').map((s) => s.trim()).filter(Boolean))];
  if (ids.length === 0) throw new BadRequestException('meta_ad_ids is required');
  if (ids.length > MAX_AD_IDS) throw new BadRequestException(`at most ${MAX_AD_IDS} meta_ad_ids per call`);
  if (ids.some((id) => !/^\d+$/.test(id))) throw new BadRequestException('meta_ad_ids must be numeric Meta ad ids');
  return ids;
}

function parseDate(raw: string | undefined, name: string): Date {
  const date = raw ? new Date(raw) : new Date(NaN);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`${name} must be an ISO date`);
  return date;
}

function parseIntParam(raw: string | undefined, fallback: number, min: number, max: number, name: string): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new BadRequestException(`${name} must be an integer between ${min} and ${max}`);
  }
  return n;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}
