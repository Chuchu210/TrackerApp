import {
  type CampaignReportRow,
  type EventColumnDef,
} from './campaign-report.service';

export const UNASSIGNED_GROUP_ID = 'unassigned';

const TRANSACTION_EVENT_SLUGS = new Set(['sale', 'sales', 'purchase']);

export type DrilldownDimensionId =
  | 'offers'
  | 'landers'
  | 'paths'
  | 'affiliate_networks'
  | 'conversions'
  | 'ad_campaigns'
  | 'adsets'
  | 'ads'
  | 'country'
  | 'ip'
  | 'devices'
  | 'os'
  | 'browsers'
  | 'referrer'
  | 'language'
  | 'connection'
  | 'click_id'
  | 'transaction_id'
  | 'external_id'
  | 'postback_param_1'
  | 'postback_param_2'
  | 'postback_param_3'
  | 'postback_param_4'
  | 'postback_param_5'
  | 'var_1'
  | 'var_2'
  | 'var_3'
  | 'var_4'
  | 'var_5'
  | 'var_6'
  | 'var_7'
  | 'var_8'
  | 'var_9'
  | 'var_10';

export type DrilldownDimensionDef = {
  id: DrilldownDimensionId;
  label: string;
  nameColumnLabel: string;
  tab?: boolean;
};

export const DRILLDOWN_DIMENSIONS: DrilldownDimensionDef[] = [
  { id: 'offers', label: 'Offers', nameColumnLabel: 'Offer name', tab: true },
  { id: 'landers', label: 'Landers', nameColumnLabel: 'Lander name', tab: true },
  { id: 'paths', label: 'Paths', nameColumnLabel: 'Path', tab: true },
  {
    id: 'affiliate_networks',
    label: 'Affiliate networks',
    nameColumnLabel: 'Affiliate network',
    tab: true,
  },
  {
    id: 'conversions',
    label: 'Conversions',
    nameColumnLabel: 'Event type',
    tab: true,
  },
  {
    id: 'ad_campaigns',
    label: 'Ad campaigns',
    nameColumnLabel: 'Ad campaign',
    tab: true,
  },
  { id: 'adsets', label: 'Adsets', nameColumnLabel: 'Adset', tab: true },
  { id: 'ads', label: 'Ads', nameColumnLabel: 'Ad', tab: true },
  { id: 'country', label: 'Country', nameColumnLabel: 'Country', tab: true },
  { id: 'ip', label: 'IP', nameColumnLabel: 'IP', tab: true },
  { id: 'devices', label: 'Devices', nameColumnLabel: 'Device', tab: true },
  { id: 'os', label: 'OS', nameColumnLabel: 'OS', tab: true },
  { id: 'browsers', label: 'Browsers', nameColumnLabel: 'Browser', tab: true },
  { id: 'referrer', label: 'Referrer', nameColumnLabel: 'Referrer', tab: true },
  { id: 'language', label: 'Language', nameColumnLabel: 'Language', tab: true },
  { id: 'connection', label: 'Connection', nameColumnLabel: 'Connection', tab: true },
  { id: 'click_id', label: 'Click ID', nameColumnLabel: 'Click ID' },
  { id: 'transaction_id', label: 'Transaction ID', nameColumnLabel: 'Transaction ID' },
  { id: 'external_id', label: 'External ID', nameColumnLabel: 'External ID' },
  { id: 'postback_param_1', label: 'Postback Param 1', nameColumnLabel: 'Postback Param 1' },
  { id: 'postback_param_2', label: 'Postback Param 2', nameColumnLabel: 'Postback Param 2' },
  { id: 'postback_param_3', label: 'Postback Param 3', nameColumnLabel: 'Postback Param 3' },
  { id: 'postback_param_4', label: 'Postback Param 4', nameColumnLabel: 'Postback Param 4' },
  { id: 'postback_param_5', label: 'Postback Param 5', nameColumnLabel: 'Postback Param 5' },
  { id: 'var_1', label: 'V1: Variable 1', nameColumnLabel: 'Variable 1' },
  { id: 'var_2', label: 'V2: Variable 2', nameColumnLabel: 'Variable 2' },
  { id: 'var_3', label: 'V3: Variable 3', nameColumnLabel: 'Variable 3' },
  { id: 'var_4', label: 'V4: Variable 4', nameColumnLabel: 'Variable 4' },
  { id: 'var_5', label: 'V5: Variable 5', nameColumnLabel: 'Variable 5' },
  { id: 'var_6', label: 'V6: Variable 6', nameColumnLabel: 'Variable 6' },
  { id: 'var_7', label: 'V7: Variable 7', nameColumnLabel: 'Variable 7' },
  { id: 'var_8', label: 'V8: Variable 8', nameColumnLabel: 'Variable 8' },
  { id: 'var_9', label: 'V9: Variable 9', nameColumnLabel: 'Variable 9' },
  { id: 'var_10', label: 'V10: Variable 10', nameColumnLabel: 'Variable 10' },
];

export type DrilldownClick = {
  clickId: string;
  offerId?: string | null;
  offerName?: string | null;
  landerId?: string | null;
  landerName?: string | null;
  pathId?: string | null;
  affiliateNetworkId?: string | null;
  affiliateNetwork?: string | null;
  countryCode?: string | null;
  country?: string | null;
  ipAddress?: string | null;
  device?: string | null;
  os?: string | null;
  browser?: string | null;
  referrer?: string | null;
  acceptLanguage?: string | null;
  connectionType?: string | null;
  externalClickId?: string | null;
  gclid?: string | null;
  fbclid?: string | null;
  trackingId?: string | null;
  customVariable1?: string | null;
  customVariable2?: string | null;
  customVariable3?: string | null;
  customVariable4?: string | null;
  customVariable5?: string | null;
  customVariable6?: string | null;
  customVariable7?: string | null;
  customVariable8?: string | null;
  customVariable9?: string | null;
  customVariable10?: string | null;
  visitorId?: string | null;
  isBot?: boolean;
  campaignExternalId?: string | null;
  adsetId?: string | null;
  adsetName?: string | null;
  adId?: string | null;
  adTitle?: string | null;
};

export type DrilldownConversion = {
  clickId: string;
  eventType: string;
  revenue?: number | null;
  cost?: number | null;
  status?: string | null;
  transactionId?: string | null;
  postbackParam1?: string | null;
  postbackParam2?: string | null;
  postbackParam3?: string | null;
  postbackParam4?: string | null;
  postbackParam5?: string | null;
  countsAsConversion?: boolean;
  click?: DrilldownClick | null;
};

export type DrilldownEventType = {
  slug: string;
  displayLabel: string;
};

function norm(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function groupFromValue(value?: string | null): { key: string; label: string } {
  const v = norm(value);
  if (!v) return { key: UNASSIGNED_GROUP_ID, label: 'Unassigned' };
  return { key: v, label: v };
}

function groupFromIdName(
  id?: string | null,
  name?: string | null,
): { key: string; label: string } {
  if (norm(id)) return { key: id!.trim(), label: norm(name) || id!.trim() };
  if (norm(name)) return { key: `name:${name!.trim()}`, label: name!.trim() };
  return { key: UNASSIGNED_GROUP_ID, label: 'Unassigned' };
}

export function clickGroupForDimension(
  dimension: DrilldownDimensionId,
  click: DrilldownClick,
): { key: string; label: string } {
  switch (dimension) {
    case 'offers':
      return groupFromIdName(click.offerId, click.offerName);
    case 'landers':
      return groupFromIdName(click.landerId, click.landerName);
    case 'paths':
      return groupFromValue(click.pathId);
    case 'affiliate_networks':
      return groupFromIdName(click.affiliateNetworkId, click.affiliateNetwork);
    case 'ad_campaigns':
      return groupFromValue(click.campaignExternalId);
    case 'adsets':
      return groupFromIdName(click.adsetId, click.adsetName);
    case 'ads':
      return groupFromIdName(click.adId, click.adTitle);
    case 'country':
      return groupFromValue(click.countryCode || click.country);
    case 'ip':
      return groupFromValue(click.ipAddress);
    case 'devices':
      return groupFromValue(click.device);
    case 'os':
      return groupFromValue(click.os);
    case 'browsers':
      return groupFromValue(click.browser);
    case 'referrer':
      return groupFromValue(click.referrer);
    case 'language':
      return groupFromValue(click.acceptLanguage);
    case 'connection':
      return groupFromValue(click.connectionType);
    case 'click_id':
      return { key: click.clickId, label: click.clickId };
    case 'external_id':
      return groupFromValue(
        click.externalClickId ||
          click.gclid ||
          click.fbclid ||
          click.trackingId,
      );
    case 'var_1':
      return groupFromValue(click.customVariable1);
    case 'var_2':
      return groupFromValue(click.customVariable2);
    case 'var_3':
      return groupFromValue(click.customVariable3);
    case 'var_4':
      return groupFromValue(click.customVariable4);
    case 'var_5':
      return groupFromValue(click.customVariable5);
    case 'var_6':
      return groupFromValue(click.customVariable6);
    case 'var_7':
      return groupFromValue(click.customVariable7);
    case 'var_8':
      return groupFromValue(click.customVariable8);
    case 'var_9':
      return groupFromValue(click.customVariable9);
    case 'var_10':
      return groupFromValue(click.customVariable10);
    default:
      return { key: UNASSIGNED_GROUP_ID, label: 'Unassigned' };
  }
}

export function conversionGroupForDimension(
  dimension: DrilldownDimensionId,
  conversion: DrilldownConversion,
): { key: string; label: string } {
  switch (dimension) {
    case 'conversions':
      return groupFromValue(conversion.eventType);
    case 'transaction_id':
      return groupFromValue(conversion.transactionId);
    case 'postback_param_1':
      return groupFromValue(conversion.postbackParam1);
    case 'postback_param_2':
      return groupFromValue(conversion.postbackParam2);
    case 'postback_param_3':
      return groupFromValue(conversion.postbackParam3);
    case 'postback_param_4':
      return groupFromValue(conversion.postbackParam4);
    case 'postback_param_5':
      return groupFromValue(conversion.postbackParam5);
    default:
      return clickGroupForDimension(dimension, conversion.click || { clickId: conversion.clickId });
  }
}

export function isConversionGroupedDimension(dimension: DrilldownDimensionId): boolean {
  return (
    dimension === 'conversions' ||
    dimension === 'transaction_id' ||
    dimension.startsWith('postback_param_')
  );
}

export function getDrilldownDimension(id: string): DrilldownDimensionDef | undefined {
  return DRILLDOWN_DIMENSIONS.find((d) => d.id === id);
}

export function countLabelFromEvent(slug: string, displayLabel: string): string {
  if (displayLabel.endsWith(' revenue')) {
    return displayLabel.slice(0, -' revenue'.length);
  }
  const known: Record<string, string> = {
    lead: 'Lead',
    sale: 'Sales',
    sales: 'Sales',
    purchase: 'Purchase',
    viewcontent: 'ViewCONTENT',
    postalcode: 'PostalCode',
    account_opening: 'account_opening',
    account_validated: 'account_validated',
    age_60: 'Age_60',
    hearing_loss: 'Hearing_loss',
    test: 'test',
    click_button: 'Click Button',
    call_click: 'Call click',
    call_connected: 'Call Connected',
  };
  return known[slug] || slug;
}

export function buildEventColumns(
  eventTypeDefs: DrilldownEventType[],
  rows: Array<{ revenueByEvent: Record<string, number> }>,
): EventColumnDef[] {
  const discovered = new Set<string>();
  for (const row of rows) {
    for (const slug of Object.keys(row.revenueByEvent)) discovered.add(slug);
  }

  return [
    ...eventTypeDefs.map((e) => ({
      slug: e.slug,
      countLabel: countLabelFromEvent(e.slug, e.displayLabel),
      revenueLabel: e.displayLabel.endsWith(' revenue')
        ? e.displayLabel
        : `${countLabelFromEvent(e.slug, e.displayLabel)} revenue`,
    })),
    ...[...discovered]
      .filter((s) => !eventTypeDefs.some((e) => e.slug === s))
      .sort()
      .map((slug) => ({
        slug,
        countLabel: countLabelFromEvent(slug, `${slug} revenue`),
        revenueLabel: `${countLabelFromEvent(slug, `${slug} revenue`)} revenue`,
      })),
  ];
}

type DrilldownBucket = {
  key: string;
  name: string;
  visits: number;
  suspiciousVisits: number;
  visitorIds: Set<string>;
  legacyVisits: number;
  conversions: number;
  errors: number;
  revenue: number;
  cost: number;
  countByEvent: Record<string, number>;
  revenueByEvent: Record<string, number>;
  transactionConversions: number;
  countedClickIds: Set<string>;
};

function getOrCreateBucket(
  buckets: Map<string, DrilldownBucket>,
  key: string,
  label: string,
): DrilldownBucket {
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = {
      key,
      name: label,
      visits: 0,
      suspiciousVisits: 0,
      visitorIds: new Set(),
      legacyVisits: 0,
      conversions: 0,
      errors: 0,
      revenue: 0,
      cost: 0,
      countByEvent: {},
      revenueByEvent: {},
      transactionConversions: 0,
      countedClickIds: new Set(),
    };
    buckets.set(key, bucket);
  } else if (label && bucket.name === bucket.key && label !== bucket.key) {
    bucket.name = label;
  }
  return bucket;
}

function addClickVisit(bucket: DrilldownBucket, click: DrilldownClick) {
  bucket.visits += 1;
  if (click.isBot) bucket.suspiciousVisits += 1;
  if (click.visitorId) bucket.visitorIds.add(click.visitorId);
  else bucket.legacyVisits += 1;
}

function addConversion(bucket: DrilldownBucket, conversion: DrilldownConversion) {
  const revenue = Number(conversion.revenue) || 0;
  const cost = Number(conversion.cost) || 0;
  bucket.revenue += revenue;
  bucket.cost += cost;
  if (conversion.status === 'failed') bucket.errors += 1;
  if (conversion.countsAsConversion !== false) bucket.conversions += 1;
  bucket.countByEvent[conversion.eventType] =
    (bucket.countByEvent[conversion.eventType] || 0) + 1;
  bucket.revenueByEvent[conversion.eventType] =
    (bucket.revenueByEvent[conversion.eventType] || 0) + revenue;
  if (TRANSACTION_EVENT_SLUGS.has(conversion.eventType)) {
    bucket.transactionConversions += 1;
  }
}

export function aggregateDrilldownRows(params: {
  dimension: DrilldownDimensionId;
  marker: string;
  clicks: DrilldownClick[];
  conversions: DrilldownConversion[];
}): CampaignReportRow[] {
  const buckets = new Map<string, DrilldownBucket>();
  const convGrouped = isConversionGroupedDimension(params.dimension);

  if (convGrouped) {
    const clickById = new Map(params.clicks.map((c) => [c.clickId, c]));
    for (const conversion of params.conversions) {
      const click = conversion.click || clickById.get(conversion.clickId) || null;
      const group = conversionGroupForDimension(params.dimension, {
        ...conversion,
        click,
      });
      const bucket = getOrCreateBucket(buckets, group.key, group.label);
      if (click && !bucket.countedClickIds.has(click.clickId)) {
        bucket.countedClickIds.add(click.clickId);
        addClickVisit(bucket, click);
      }
      addConversion(bucket, conversion);
    }
  } else {
    for (const click of params.clicks) {
      const group = clickGroupForDimension(params.dimension, click);
      const bucket = getOrCreateBucket(buckets, group.key, group.label);
      addClickVisit(bucket, click);
    }
    for (const conversion of params.conversions) {
      const click = conversion.click;
      const group = click
        ? clickGroupForDimension(params.dimension, click)
        : conversionGroupForDimension(params.dimension, conversion);
      const bucket = getOrCreateBucket(buckets, group.key, group.label);
      addConversion(bucket, conversion);
    }
  }

  return [...buckets.values()]
    .map((bucket) => {
      const uniqueVisits = bucket.visitorIds.size + bucket.legacyVisits;
      const profit = bucket.revenue - bucket.cost;
      return {
        campaignId: bucket.key,
        campaignName: bucket.name,
        marker: params.marker,
        cpc: 0,
        visits: bucket.visits,
        uniqueVisits,
        suspiciousVisits: bucket.suspiciousVisits,
        suspiciousPct:
          bucket.visits > 0
            ? ((bucket.suspiciousVisits / bucket.visits) * 100).toFixed(2)
            : '0.00',
        conversions: bucket.conversions,
        cost: bucket.cost,
        revenue: bucket.revenue,
        profit,
        roi: bucket.cost > 0 ? (profit / bucket.cost) * 100 : 0,
        cv: bucket.visits > 0 ? (bucket.conversions / bucket.visits) * 100 : 0,
        epv: bucket.visits > 0 ? bucket.revenue / bucket.visits : 0,
        cpv: bucket.visits > 0 ? bucket.cost / bucket.visits : 0,
        ecpc: bucket.conversions > 0 ? bucket.cost / bucket.conversions : 0,
        errors: bucket.errors,
        txTransfo:
          bucket.visits > 0
            ? (bucket.transactionConversions / bucket.visits) * 100
            : 0,
        impressions: 0,
        platformClicks: 0,
        countByEvent: bucket.countByEvent,
        revenueByEvent: bucket.revenueByEvent,
      };
    })
    .sort((a, b) => {
      if (b.visits !== a.visits) return b.visits - a.visits;
      return a.campaignName.localeCompare(b.campaignName);
    });
}
