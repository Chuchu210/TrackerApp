/**
 * Ad-network macros left unreplaced (URL opened directly, preview click, or a
 * network that failed to substitute). Covers the three syntaxes we consume:
 *   ${AD_ID}    Mediago / Voluum / Outbrain
 *   {{ad.id}}   Meta (Facebook / Instagram)
 *   {click_id}  Taboola / MGID
 * A real value is never a lone brace-wrapped token, so anchoring on the whole
 * trimmed string keeps this safe against false positives.
 *
 * Canonical implementation lives here (params.ts re-exports it) — it used to be
 * duplicated in both files, and the copies drifted: only `${...}` was detected,
 * so unsubstituted Meta macros were stored as real values.
 */
const UNREPLACED_MACRO_RE = /^(\$\{[^{}]*\}|\{\{[^{}]*\}\}|\{[^{}]*\})$/;

export function isUnreplacedMacro(value?: string): boolean {
  if (!value) return false;
  return UNREPLACED_MACRO_RE.test(value.trim());
}

function sanitizeParam(value?: string): string | undefined {
  if (!value || isUnreplacedMacro(value)) return undefined;
  return value;
}

export interface ParamMapping {
  internalField: string;
  displayLabel: string;
  externalKeys: string[];
  urlMacro?: string;
  /** Voluum-style token in outbound postback URL, e.g. {externalid} or {var1} */
  postbackToken?: string;
  showInReports: boolean;
  priority?: number;
}

export const CANONICAL_FIELDS = [
  'tracking_id',
  'external_click_id',
  'gclid',
  'fbclid',
  'click_id',
  'subid',
  'ad_id',
  'ad_title',
  'adset_id',
  'adset_name',
  'campaign_external_id',
  'publisher_name',
  'site_id',
  'content_name',
  'platform',
  'asset_id',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_angle',
  'utm_adset',
  'referrer',
  'path_id',
  'lander_id',
  'lander_name',
  'offer_id',
  'offer_name',
  'affiliate_network',
  'affiliate_network_id',
  'traffic_source_id',
  'cv1',
  'cv2',
  'cv3',
  'cv4',
  'cv5',
  'cv6',
  'cv7',
  'cv8',
  'cv9',
  'cv10',
] as const;

export type CanonicalField = (typeof CANONICAL_FIELDS)[number];

export type ResolvedParams = Partial<Record<CanonicalField | string, string>>;

const INTERNAL_TO_DB: Record<string, string> = {
  tracking_id: 'trackingId',
  external_click_id: 'externalClickId',
  gclid: 'gclid',
  fbclid: 'fbclid',
  ad_id: 'adId',
  ad_title: 'adTitle',
  adset_id: 'adsetId',
  adset_name: 'adsetName',
  campaign_external_id: 'campaignExternalId',
  publisher_name: 'publisherName',
  site_id: 'siteId',
  content_name: 'contentName',
  platform: 'platform',
  asset_id: 'assetId',
  utm_source: 'utmSource',
  utm_medium: 'utmMedium',
  utm_campaign: 'utmCampaign',
  utm_term: 'utmTerm',
  utm_content: 'utmContent',
  path_id: 'pathId',
  lander_id: 'landerId',
  lander_name: 'landerName',
  offer_id: 'offerId',
  offer_name: 'offerName',
  affiliate_network: 'affiliateNetwork',
  affiliate_network_id: 'affiliateNetworkId',
  traffic_source_id: 'trafficSourceId',
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

function normalizeQuery(
  query: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(query)) {
    const v = Array.isArray(val) ? val[0] : val;
    if (v) out[key.toLowerCase()] = v;
  }
  return out;
}

export function resolveParamsFromMappings(
  query: Record<string, string | string[] | undefined>,
  mappings: ParamMapping[],
  tkCid?: string | null,
): ResolvedParams {
  const q = normalizeQuery(query);
  const sorted = [...mappings].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  const resolved: ResolvedParams = {};

  for (const mapping of sorted) {
    if (resolved[mapping.internalField]) continue;
    for (const key of mapping.externalKeys) {
      const raw = q[key.toLowerCase()];
      const value = sanitizeParam(raw);
      if (value) {
        resolved[mapping.internalField] = value;
        break;
      }
    }
  }

  if (!resolved.tracking_id && resolved.external_click_id) {
    resolved.tracking_id = resolved.external_click_id;
  }
  if (!resolved.external_click_id && resolved.tracking_id) {
    resolved.external_click_id = resolved.tracking_id;
  }

  if (!resolved.gclid) {
    resolved.gclid =
      resolved.gclid ||
      resolved.fbclid ||
      resolved.tracking_id ||
      sanitizeParam(tkCid || undefined) ||
      resolved.subid ||
      '';
  }

  return resolved;
}

export const DEFAULT_PARAM_MAPPINGS: ParamMapping[] = [
  { internalField: 'tracking_id', displayLabel: 'External ID 1', externalKeys: ['tracking_id', 'trackingid', 'click_id', 'subid'], urlMacro: '${TRACKING_ID}', postbackToken: '{externalid}', showInReports: true, priority: 1 },
  { internalField: 'external_click_id', displayLabel: 'External Click ID', externalKeys: ['click_id', 'tracking_id', 'subid'], showInReports: false, priority: 2 },
  { internalField: 'gclid', displayLabel: 'GCLID', externalKeys: ['gclid'], showInReports: true, priority: 3 },
  { internalField: 'fbclid', displayLabel: 'FBCLID', externalKeys: ['fbclid'], showInReports: true, priority: 4 },
  { internalField: 'ad_id', displayLabel: 'Ad id', externalKeys: ['ad_id', 'adid'], urlMacro: '${AD_ID}', postbackToken: '{var1}', showInReports: true, priority: 10 },
  { internalField: 'ad_title', displayLabel: 'Ad title', externalKeys: ['ad_title', 'adtitle'], urlMacro: '${AD_TITLE}', postbackToken: '{var2}', showInReports: true, priority: 11 },
  { internalField: 'campaign_external_id', displayLabel: 'Campaign ID', externalKeys: ['campaign_external_id', 'campaignid', 'campaign_id'], urlMacro: '${CAMPAIGN_ID}', postbackToken: '{var3}', showInReports: true, priority: 12 },
  { internalField: 'publisher_name', displayLabel: 'Publisher Name', externalKeys: ['publisher_name', 'publishername'], urlMacro: '${PUBLISHER_NAME}', postbackToken: '{var4}', showInReports: true, priority: 13 },
  { internalField: 'site_id', displayLabel: 'Site ID', externalKeys: ['site_id', 'siteid'], urlMacro: '${SITE_ID}', postbackToken: '{var5}', showInReports: true, priority: 14 },
  { internalField: 'content_name', displayLabel: 'Content name', externalKeys: ['content_name', 'contentname'], urlMacro: '${CONTENT_NAME}', postbackToken: '{var6}', showInReports: true, priority: 15 },
  { internalField: 'platform', displayLabel: 'Platform', externalKeys: ['platform'], urlMacro: '${PLATFORM}', postbackToken: '{var7}', showInReports: true, priority: 16 },
  { internalField: 'asset_id', displayLabel: 'Asset ID', externalKeys: ['asset_id', 'assetid'], urlMacro: '${ASSET_ID}', postbackToken: '{var8}', showInReports: true, priority: 17 },
  { internalField: 'adset_id', displayLabel: 'Adset id', externalKeys: ['adset_id', 'adsetid'], urlMacro: '{{adset.id}}', showInReports: true, priority: 18 },
  { internalField: 'adset_name', displayLabel: 'Adset', externalKeys: ['adset_name', 'adsetname'], urlMacro: '{{adset.name}}', showInReports: true, priority: 19 },
  { internalField: 'utm_source', displayLabel: 'UTM Source', externalKeys: ['utm_source'], showInReports: true, priority: 20 },
  { internalField: 'utm_medium', displayLabel: 'UTM Medium', externalKeys: ['utm_medium'], showInReports: false, priority: 21 },
  { internalField: 'utm_campaign', displayLabel: 'UTM Campaign', externalKeys: ['utm_campaign', 'campaignid', 'campaign_id'], showInReports: true, priority: 22 },
  { internalField: 'utm_term', displayLabel: 'UTM Term', externalKeys: ['utm_term', 'assetid', 'asset_id'], showInReports: false, priority: 23 },
  { internalField: 'utm_content', displayLabel: 'UTM Content', externalKeys: ['utm_content', 'adtitle', 'ad_title'], showInReports: false, priority: 24 },
  { internalField: 'utm_angle', displayLabel: 'UTM Angle', externalKeys: ['utm_angle'], showInReports: false, priority: 25 },
  { internalField: 'utm_adset', displayLabel: 'Ad Set', externalKeys: ['utm_adset'], showInReports: false, priority: 26 },
  { internalField: 'referrer', displayLabel: 'Referrer', externalKeys: ['referrer'], showInReports: false, priority: 30 },
];

export function resolvedToClickFields(resolved: ResolvedParams): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(resolved)) {
    const dbKey = INTERNAL_TO_DB[key];
    if (dbKey) out[dbKey] = value || null;
  }
  return out;
}

export function getReportFieldsFromClick(
  click: Record<string, unknown>,
  mappings: ParamMapping[],
): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  const seen = new Set<string>();

  for (const mapping of mappings.filter((m) => m.showInReports)) {
    if (seen.has(mapping.internalField)) continue;
    const dbKey = INTERNAL_TO_DB[mapping.internalField];
    const value = dbKey ? String(click[dbKey] ?? '') : '';
    if (value) {
      rows.push({ label: mapping.displayLabel, value });
      seen.add(mapping.internalField);
    }
  }

  return rows;
}

export function buildClickUrlFromTemplate(
  template: string,
  clickUrl: string,
  destinationUrl: string,
  campaignName: string,
): string {
  return template
    .replace(/\{clickUrl\}/g, clickUrl)
    .replace(/\{destinationUrl\}/g, destinationUrl)
    .replace(/\{campaignName\}/g, encodeURIComponent(campaignName));
}
