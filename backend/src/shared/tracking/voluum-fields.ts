export interface VoluumClickFields {
  pathId?: string;
  landerId?: string;
  landerName?: string;
  offerId?: string;
  offerName?: string;
  affiliateNetwork?: string;
  affiliateNetworkId?: string;
  trafficSourceId?: string;
  customVariables: Record<string, string | undefined>;
}

const CV_KEYS = [
  ['cv1', ['var1', 'cv1', 'c1', 'custom_variable_1', 'customvariable1']],
  ['cv2', ['var2', 'cv2', 'c2', 'custom_variable_2', 'customvariable2']],
  ['cv3', ['var3', 'cv3', 'c3', 'custom_variable_3', 'customvariable3']],
  ['cv4', ['var4', 'cv4', 'c4', 'custom_variable_4', 'customvariable4']],
  ['cv5', ['var5', 'cv5', 'c5', 'custom_variable_5', 'customvariable5']],
  ['cv6', ['var6', 'cv6', 'c6', 'custom_variable_6', 'customvariable6']],
  ['cv7', ['var7', 'cv7', 'c7', 'custom_variable_7', 'customvariable7']],
  ['cv8', ['var8', 'cv8', 'c8', 'custom_variable_8', 'customvariable8']],
  ['cv9', ['var9', 'cv9', 'c9', 'custom_variable_9', 'customvariable9']],
  ['cv10', ['var10', 'cv10', 'c10', 'custom_variable_10', 'customvariable10']],
] as const;

function pick(q: Record<string, string>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    if (q[k]) return q[k];
  }
  return undefined;
}

/** Extract Voluum-style funnel + custom variable fields from URL query */
export function extractVoluumFields(
  query: Record<string, string | string[] | undefined>,
): VoluumClickFields {
  const q: Record<string, string> = {};
  for (const [key, val] of Object.entries(query)) {
    const v = Array.isArray(val) ? val[0] : val;
    if (v) q[key.toLowerCase()] = v;
  }

  const customVariables: Record<string, string | undefined> = {};
  for (const [cvKey, aliases] of CV_KEYS) {
    customVariables[cvKey] = pick(q, ...aliases);
  }

  return {
    pathId: pick(q, 'path_id', 'pathid'),
    landerId: pick(q, 'lander_id', 'landerid', 'lp_id', 'lpid'),
    landerName: pick(q, 'lander', 'lander_name', 'landername', 'lp_name', 'lpname', 'lp'),
    offerId: pick(q, 'offer_id', 'offerid'),
    offerName: pick(q, 'offer', 'offer_name', 'offername'),
    affiliateNetwork: pick(q, 'affiliate_network', 'affiliatenetwork', 'network'),
    affiliateNetworkId: pick(q, 'affiliate_network_id', 'affiliatenetworkid', 'network_id'),
    trafficSourceId: pick(q, 'traffic_source_id', 'trafficsourceid', 'ts_id'),
    customVariables,
  };
}

/** Map native ad URL params into CV slots when explicit var1-var10 are absent */
export function applyNativeParamFallbacks(
  cvs: Record<string, string | undefined>,
  native: {
    adId?: string;
    campaignExternalId?: string;
    publisherName?: string;
    adTitle?: string;
    contentName?: string;
    siteId?: string;
    platform?: string;
    assetId?: string;
    adsetId?: string;
    placement?: string;
  },
): Record<string, string | undefined> {
  const out = { ...cvs };
  const set = (key: string, value?: string) => {
    if (!out[key] && value) out[key] = value;
  };
  set('cv1', native.adId);
  set('cv2', native.campaignExternalId || native.adsetId);
  set('cv3', native.publisherName);
  set('cv4', native.adTitle);
  set('cv5', native.contentName);
  set('cv6', native.siteId);
  set('cv7', native.platform || native.placement);
  set('cv8', native.assetId);
  return out;
}

export const VOLUUM_CSV_HEADERS = [
  'Postback Timestamp',
  'Visit Timestamp',
  'External ID',
  'Click ID',
  'Transaction ID',
  'Revenue',
  'Revenue amount in original currency (Offer currency at conversion time)',
  'Total Revenue (with custom conversions excluded from the \'Revenue\' column)',
  'Cost',
  'Conversion original currency (Offer currency at conversion time)',
  'Conversion Type',
  'Outgoing Postback URL',
  'Incoming Postback IP',
  'Incoming Postback URL',
  'Campaign ID',
  'Campaign',
  'Campaign Workspace name',
  'Campaign Workspace ID',
  'Lander',
  'Lander ID',
  'Offer',
  'Offer ID',
  'Country',
  'Country Code',
  'Region',
  'City',
  'Path ID',
  'User Agent',
  'Traffic Source Name',
  'Traffic Source ID',
  'Affiliate Network',
  'Affiliate Network ID',
  'Device',
  'OS',
  'OS Version',
  'Brand',
  'Model',
  'Browser',
  'Browser Version',
  'Isp',
  'Mobile Carrier',
  'Connection Type',
  'IP',
  'Referrer',
  'Custom Variable 1',
  'Custom Variable 2',
  'Custom Variable 3',
  'Custom Variable 4',
  'Custom Variable 5',
  'Custom Variable 6',
  'Custom Variable 7',
  'Custom Variable 8',
  'Custom Variable 9',
  'Custom Variable 10',
  'Postback param 1',
  'Postback param 2',
  'Postback param 3',
  'Postback param 4',
  'Postback param 5',
] as const;
