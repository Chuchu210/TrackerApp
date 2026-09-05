import type { Click, Conversion, PostbackConfig } from '@prisma/client';
import type { ParamMapping } from './param-mapping';
import { resolveMediagoConversionType } from './mediago-conversion-types';
import {
  resolveMediagoAccountName,
  resolveMediagoAdId,
  resolveMediagoTrackingId,
} from './mediago-postback';

export interface PostbackTokenDef {
  token: string;
  description: string;
}

/** Voluum-compatible outbound postback placeholders */
export const POSTBACK_TOKEN_DEFINITIONS: PostbackTokenDef[] = [
  { token: '{externalid}', description: 'Traffic source click ID (tracking_id)' },
  { token: '{click.id}', description: 'Internal tracker click ID' },
  { token: '{payout}', description: 'Conversion revenue' },
  { token: '{payout.currency}', description: 'Revenue currency (EUR)' },
  { token: '{conversiontype}', description: 'Mediago conversion type code (from event type, Table 1.1)' },
  { token: '{accountname}', description: 'Mediago account name' },
  { token: '{transaction.id}', description: 'Conversion transaction ID' },
  { token: '{eventType}', description: 'Conversion event type (Lead, Sale, …)' },
  { token: '{campaign.id}', description: 'Campaign ID' },
  { token: '{campaign.name}', description: 'Campaign name' },
  { token: '{var1}', description: 'Custom var 1 — usually Ad ID' },
  { token: '{var2}', description: 'Custom var 2 — usually Ad title' },
  { token: '{var3}', description: 'Custom var 3 — usually Campaign ID' },
  { token: '{var4}', description: 'Custom var 4 — usually Publisher' },
  { token: '{var5}', description: 'Custom var 5 — usually Site ID' },
  { token: '{var6}', description: 'Custom var 6 — usually Content' },
  { token: '{var7}', description: 'Custom var 7 — usually Platform' },
  { token: '{var8}', description: 'Custom var 8 — usually Asset ID' },
  { token: '{country}', description: 'Visitor country code' },
  { token: '{city}', description: 'Visitor city' },
  { token: '{ip}', description: 'Visitor IP' },
  { token: '{useragent}', description: 'User agent' },
  { token: '{device}', description: 'Device type' },
  { token: '{browser}', description: 'Browser name' },
  { token: '{os}', description: 'Operating system' },
  { token: '{gclid}', description: 'Google click ID' },
  { token: '{param1}', description: 'Incoming postback param 1' },
  { token: '{param2}', description: 'Incoming postback param 2' },
  { token: '{param3}', description: 'Incoming postback param 3' },
  { token: '{param4}', description: 'Incoming postback param 4' },
  { token: '{param5}', description: 'Incoming postback param 5' },
];

const INTERNAL_TO_CLICK: Record<string, keyof Click> = {
  tracking_id: 'trackingId',
  external_click_id: 'externalClickId',
  gclid: 'gclid',
  fbclid: 'fbclid',
  ad_id: 'adId',
  ad_title: 'adTitle',
  campaign_external_id: 'campaignExternalId',
  publisher_name: 'publisherName',
  site_id: 'siteId',
  content_name: 'contentName',
  platform: 'platform',
  asset_id: 'assetId',
  cv1: 'customVariable1',
  cv2: 'customVariable2',
  cv3: 'customVariable3',
  cv4: 'customVariable4',
  cv5: 'customVariable5',
  cv6: 'customVariable6',
  cv7: 'customVariable7',
  cv8: 'customVariable8',
  cv9: 'customVariable9',
  cv10: 'customVariable10',
};

const DEFAULT_POSTBACK_TOKEN_BY_FIELD: Record<string, string> = {
  tracking_id: 'externalid',
  ad_id: 'var1',
  ad_title: 'var2',
  campaign_external_id: 'var3',
  publisher_name: 'var4',
  site_id: 'var5',
  content_name: 'var6',
  platform: 'var7',
  asset_id: 'var8',
};

export const DEFAULT_MEDIAGO_POSTBACK_URL =
  'https://sync.mediago.io/api/bidder/postback?trackingid={trackingid}&adid={adid}&conversiontype={conversiontype}&conversionprice={payout}&includeintotalconversion=1&accountname={accountname}';

type ResolveContext = {
  click: Click;
  conversion: Conversion;
  // Narrowed to the two fields this actually reads. Taking the whole
  // PostbackConfig forced every caller and test to build a full row, and each
  // field added to the model (the OpenAI ones, most recently) silently broke
  // fixtures that SWC never typechecks.
  config?: Partial<Pick<PostbackConfig, 'mediagoConversionType' | 'mediagoAccountName'>> | null;
  profileDefaults?: Record<string, unknown>;
  paramMappings?: ParamMapping[];
  campaign?: { id: string; name: string; externalId?: string | null };
};

function clickField(click: Click, internalField: string): string {
  const key = INTERNAL_TO_CLICK[internalField];
  if (!key) return '';
  const val = click[key];
  return val != null ? String(val) : '';
}

function buildTokenMap(ctx: ResolveContext): Record<string, string> {
  const { click, conversion, config, profileDefaults, paramMappings, campaign } = ctx;
  const trackingId = resolveMediagoTrackingId(click);
  const adId = resolveMediagoAdId(click);
  const accountName = resolveMediagoAccountName(config, profileDefaults);
  const tokens: Record<string, string> = {
    externalid: trackingId,
    trackingid: trackingId,
    adid: adId,
    'click.id': click.clickId,
    payout: String(conversion.revenue ?? 0),
    'payout.currency': 'EUR',
    conversiontype: String(
      resolveMediagoConversionType(
        conversion.eventType,
        Number(
          config?.mediagoConversionType ??
            profileDefaults?.mediagoConversionType ??
            10,
        ),
      ),
    ),
    accountname: accountName,
    'transaction.id': conversion.transactionId || '',
    eventType: conversion.eventType || '',
    'campaign.id': campaign?.id || click.campaignId || '',
    'campaign.name': campaign?.name || '',
    gclid: click.gclid || '',
    country: click.countryCode || click.country || '',
    city: click.city || '',
    ip: click.ipAddress || '',
    useragent: click.userAgent || '',
    device: click.device || '',
    browser: click.browser || '',
    os: click.os || '',
    param1: conversion.postbackParam1 || '',
    param2: conversion.postbackParam2 || '',
    param3: conversion.postbackParam3 || '',
    param4: conversion.postbackParam4 || '',
    param5: conversion.postbackParam5 || '',
  };

  for (let i = 1; i <= 10; i++) {
    const cvKey = `cv${i}` as keyof typeof INTERNAL_TO_CLICK;
    const field = INTERNAL_TO_CLICK[cvKey];
    if (field) {
      const val = click[field];
      tokens[`var${i}`] = val != null ? String(val) : '';
    }
  }

  if (paramMappings?.length) {
    for (const m of paramMappings) {
      const tokenName = m.postbackToken?.replace(/^\{|\}$/g, '') || DEFAULT_POSTBACK_TOKEN_BY_FIELD[m.internalField];
      if (tokenName) {
        tokens[tokenName] = clickField(click, m.internalField);
      }
    }
  } else {
    for (const [field, tokenName] of Object.entries(DEFAULT_POSTBACK_TOKEN_BY_FIELD)) {
      if (!tokens[tokenName]) {
        tokens[tokenName] = clickField(click, field);
      }
    }
  }

  return tokens;
}

export function resolvePostbackUrlTemplate(template: string, ctx: ResolveContext): string {
  const tokens = buildTokenMap(ctx);
  return template.replace(/\{([^}]+)\}/g, (_, raw: string) => {
    const key = raw.trim();
    const value = tokens[key];
    return value != null ? encodeURIComponent(value) : '';
  });
}
