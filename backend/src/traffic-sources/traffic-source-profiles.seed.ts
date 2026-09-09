import { ConversionMethod, TrackingMode } from '@prisma/client';
import type { ParamMapping } from '../shared/tracking/param-mapping';
import { DEFAULT_PARAM_MAPPINGS } from '../shared/tracking/param-mapping';
import { DEFAULT_MEDIAGO_POSTBACK_URL } from '../shared/tracking/postback-url';

const MEDIAGO_CLICK_TEMPLATE =
  '{clickUrl}?adid=${AD_ID}&adtitle=${AD_TITLE}&campaignid=${CAMPAIGN_ID}&publishername=${PUBLISHER_NAME}&siteid=${SITE_ID}&contentname=${CONTENT_NAME}&platform=${PLATFORM}&assetid=${ASSET_ID}&click_id=${TRACKING_ID}';

const OUTBRAIN_MAPPINGS: ParamMapping[] = [
  { internalField: 'tracking_id', displayLabel: 'Outbrain Click ID', externalKeys: ['click_id', 'ob_click_id', 'tracking_id'], urlMacro: '${OB_CLICK_ID}', showInReports: true, priority: 1 },
  { internalField: 'utm_source', displayLabel: 'UTM Source', externalKeys: ['utm_source'], showInReports: true, priority: 2 },
  { internalField: 'utm_campaign', displayLabel: 'Campaign', externalKeys: ['utm_campaign', 'campaignid'], showInReports: true, priority: 3 },
];

/**
 * Meta sends its own dynamic params ({{ad.id}} & co, see FACEBOOK_DIRECT_AD_TEMPLATE).
 * Without these mappings the tracker only kept the static UTMs, so reports had no
 * campaign / adset / ad granularity — you could not tell which creative produced a lead.
 */
const FACEBOOK_MAPPINGS: ParamMapping[] = [
  { internalField: 'fbclid', displayLabel: 'FBCLID', externalKeys: ['fbclid'], showInReports: true, priority: 1 },
  { internalField: 'utm_source', displayLabel: 'UTM Source', externalKeys: ['utm_source'], showInReports: true, priority: 2 },
  { internalField: 'utm_medium', displayLabel: 'UTM Medium', externalKeys: ['utm_medium'], showInReports: false, priority: 3 },
  { internalField: 'utm_campaign', displayLabel: 'UTM Campaign', externalKeys: ['utm_campaign'], showInReports: true, priority: 4 },
  { internalField: 'utm_content', displayLabel: 'UTM Content', externalKeys: ['utm_content'], showInReports: true, priority: 5 },
  { internalField: 'utm_term', displayLabel: 'UTM Term', externalKeys: ['utm_term'], showInReports: false, priority: 6 },
  // Meta object IDs + names — the granularity needed to score creatives.
  { internalField: 'campaign_external_id', displayLabel: 'FB Campaign ID', externalKeys: ['campaign_id'], urlMacro: '{{campaign.id}}', showInReports: true, priority: 10 },
  { internalField: 'adset_id', displayLabel: 'FB Adset ID', externalKeys: ['adset_id'], urlMacro: '{{adset.id}}', showInReports: true, priority: 11 },
  { internalField: 'adset_name', displayLabel: 'FB Adset', externalKeys: ['adset_name'], urlMacro: '{{adset.name}}', showInReports: true, priority: 12 },
  { internalField: 'ad_id', displayLabel: 'FB Ad ID', externalKeys: ['ad_id'], urlMacro: '{{ad.id}}', showInReports: true, priority: 13 },
  // Ad name is where the image/title/CTA combination lives, per naming convention.
  { internalField: 'ad_title', displayLabel: 'FB Ad', externalKeys: ['ad_name'], urlMacro: '{{ad.name}}', showInReports: true, priority: 14 },
  // feed / story / reels — reuses the existing `platform` column.
  { internalField: 'platform', displayLabel: 'Placement', externalKeys: ['placement'], urlMacro: '{{placement}}', showInReports: true, priority: 15 },
  // fb / ig / an / msg — reuses the existing `publisher_name` column.
  { internalField: 'publisher_name', displayLabel: 'Meta Surface', externalKeys: ['site_source_name'], urlMacro: '{{site_source_name}}', showInReports: true, priority: 16 },
];

const OPENAI_MAPPINGS: ParamMapping[] = [
  { internalField: 'oppref', displayLabel: 'OpenAI Click Ref', externalKeys: ['oppref', 'oai_oppref', 'openai_oppref'], showInReports: true, priority: 1 },
  { internalField: 'utm_source', displayLabel: 'UTM Source', externalKeys: ['utm_source'], showInReports: true, priority: 2 },
  { internalField: 'utm_medium', displayLabel: 'UTM Medium', externalKeys: ['utm_medium'], showInReports: false, priority: 3 },
  { internalField: 'utm_campaign', displayLabel: 'UTM Campaign', externalKeys: ['utm_campaign'], showInReports: true, priority: 4 },
  { internalField: 'utm_content', displayLabel: 'UTM Content', externalKeys: ['utm_content'], showInReports: true, priority: 5 },
];

const GOOGLE_MAPPINGS: ParamMapping[] = [
  { internalField: 'gclid', displayLabel: 'GCLID', externalKeys: ['gclid'], showInReports: true, priority: 1 },
  { internalField: 'utm_source', displayLabel: 'UTM Source', externalKeys: ['utm_source'], showInReports: true, priority: 2 },
  { internalField: 'utm_medium', displayLabel: 'UTM Medium', externalKeys: ['utm_medium'], showInReports: false, priority: 3 },
  { internalField: 'utm_campaign', displayLabel: 'UTM Campaign', externalKeys: ['utm_campaign'], showInReports: true, priority: 4 },
  { internalField: 'utm_term', displayLabel: 'UTM Term', externalKeys: ['utm_term'], showInReports: true, priority: 5 },
];

const TABOOLA_MAPPINGS: ParamMapping[] = [
  { internalField: 'tracking_id', displayLabel: 'Taboola Click ID', externalKeys: ['click_id', 'tblci', 'tracking_id'], urlMacro: '${click_id}', postbackToken: '{externalid}', showInReports: true, priority: 1 },
  { internalField: 'site_id', displayLabel: 'Site', externalKeys: ['site', 'site_id', 'publisher_id'], urlMacro: '${site}', postbackToken: '{var5}', showInReports: true, priority: 2 },
  { internalField: 'campaign_external_id', displayLabel: 'Campaign', externalKeys: ['campaign_id', 'campaign_item_id'], urlMacro: '${campaign_id}', postbackToken: '{var3}', showInReports: true, priority: 3 },
  { internalField: 'ad_id', displayLabel: 'Ad', externalKeys: ['campaign_item_id', 'ad_id'], urlMacro: '${campaign_item_id}', postbackToken: '{var1}', showInReports: true, priority: 4 },
];

const MGID_MAPPINGS: ParamMapping[] = [
  { internalField: 'tracking_id', displayLabel: 'MGID Click ID', externalKeys: ['click_id', 'subid', 'tracking_id'], urlMacro: '{click_id}', postbackToken: '{externalid}', showInReports: true, priority: 1 },
  { internalField: 'site_id', displayLabel: 'Widget', externalKeys: ['widget_id', 'site_id'], urlMacro: '{widget_id}', postbackToken: '{var5}', showInReports: true, priority: 2 },
  { internalField: 'ad_id', displayLabel: 'Teaser', externalKeys: ['teaser_id', 'ad_id'], urlMacro: '{teaser_id}', postbackToken: '{var1}', showInReports: true, priority: 3 },
];

const TIKTOK_MAPPINGS: ParamMapping[] = [
  { internalField: 'external_click_id', displayLabel: 'TikTok Click ID', externalKeys: ['ttclid'], showInReports: true, priority: 1 },
  { internalField: 'utm_source', displayLabel: 'UTM Source', externalKeys: ['utm_source'], showInReports: true, priority: 2 },
  { internalField: 'utm_campaign', displayLabel: 'UTM Campaign', externalKeys: ['utm_campaign'], showInReports: true, priority: 3 },
  { internalField: 'utm_content', displayLabel: 'UTM Content', externalKeys: ['utm_content'], showInReports: true, priority: 4 },
];

export interface SeedProfile {
  slug: string;
  name: string;
  trackingModeDefault: TrackingMode;
  clickUrlTemplate: string | null;
  directAdUrlTemplate: string | null;
  paramMappings: ParamMapping[];
  conversionMethod: ConversionMethod;
  postbackDefaults: Record<string, unknown>;
  setupNote: string;
  isSystem: boolean;
}

export const SYSTEM_TRAFFIC_SOURCE_PROFILES: SeedProfile[] = [
  {
    slug: 'mediago',
    name: 'Mediago',
    trackingModeDefault: TrackingMode.redirect,
    clickUrlTemplate: MEDIAGO_CLICK_TEMPLATE,
    directAdUrlTemplate: null,
    paramMappings: DEFAULT_PARAM_MAPPINGS,
    conversionMethod: ConversionMethod.mediago_s2s,
    postbackDefaults: {
      mediagoEnabled: true,
      mediagoConversionType: 10,
      mediagoAccountName: '',
      postbackUrlTemplate: DEFAULT_MEDIAGO_POSTBACK_URL,
      facebookEnabled: false,
      googleEnabled: false,
    },
    setupNote: 'Put the redirect Click URL in Mediago. User clicks → tracker records visit → redirects to LP.',
    isSystem: true,
  },
  {
    slug: 'native',
    name: 'Native (generic)',
    trackingModeDefault: TrackingMode.redirect,
    clickUrlTemplate: MEDIAGO_CLICK_TEMPLATE,
    directAdUrlTemplate: null,
    paramMappings: DEFAULT_PARAM_MAPPINGS,
    conversionMethod: ConversionMethod.mediago_s2s,
    postbackDefaults: {
      mediagoEnabled: true,
      mediagoConversionType: 10,
      mediagoAccountName: '',
      postbackUrlTemplate: DEFAULT_MEDIAGO_POSTBACK_URL,
      facebookEnabled: false,
      googleEnabled: false,
    },
    setupNote: 'Put the redirect Click URL in your native ad network tracking field.',
    isSystem: true,
  },
  {
    slug: 'outbrain',
    name: 'Outbrain',
    trackingModeDefault: TrackingMode.redirect,
    clickUrlTemplate: '{clickUrl}?click_id=${OB_CLICK_ID}&utm_source=outbrain',
    directAdUrlTemplate: null,
    paramMappings: OUTBRAIN_MAPPINGS,
    conversionMethod: ConversionMethod.outbrain_s2s,
    postbackDefaults: {
      mediagoEnabled: false,
      facebookEnabled: false,
      googleEnabled: false,
      postbackUrlTemplate:
        'https://tr.outbrain.com/pixel?ob_click_id={externalid}&marketerId=YOUR_ID&revenue={payout}',
      outbrainPostbackUrl: 'https://tr.outbrain.com/pixel?ob_click_id={tracking_id}&marketerId=YOUR_ID',
    },
    setupNote: 'Put the redirect Click URL in Outbrain. Uses OB_CLICK_ID macro.',
    isSystem: true,
  },
  {
    slug: 'facebook',
    name: 'Facebook',
    trackingModeDefault: TrackingMode.direct,
    clickUrlTemplate: null,
    directAdUrlTemplate:
      '{destinationUrl}?utm_source=facebook&utm_medium=paid_social&utm_campaign={campaignName}' +
      '&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}' +
      '&adset_name={{adset.name}}&ad_name={{ad.name}}' +
      '&placement={{placement}}&site_source_name={{site_source_name}}',
    paramMappings: FACEBOOK_MAPPINGS,
    conversionMethod: ConversionMethod.facebook_capi,
    postbackDefaults: {
      mediagoEnabled: false,
      facebookEnabled: true,
      googleEnabled: false,
      requiredMetadata: ['email', 'fbp', 'fbc'],
      postbackUrlTemplate: 'POST https://graph.facebook.com/v21.0/{pixelId}/events (Conversions API — configure pixel + token on campaign)',
    },
    setupNote:
      'Paste the Direct Ad URL as the ad\'s Website URL in Meta (not in "URL parameters" — the template already carries the query string). Meta substitutes {{campaign.id}}, {{adset.id}}, {{ad.id}}, {{adset.name}}, {{ad.name}}, {{placement}} and {{site_source_name}} at click time, which is what gives campaign/adset/ad granularity in reports. Facebook adds fbclid automatically. Add the LP script to your landing page.',
    isSystem: true,
  },
  {
    slug: 'google',
    name: 'Google Ads',
    trackingModeDefault: TrackingMode.direct,
    clickUrlTemplate: null,
    directAdUrlTemplate: '{destinationUrl}?utm_source=google&utm_medium=cpc&utm_campaign={campaignName}',
    paramMappings: GOOGLE_MAPPINGS,
    conversionMethod: ConversionMethod.google_offline,
    postbackDefaults: {
      mediagoEnabled: false,
      facebookEnabled: false,
      googleEnabled: true,
      postbackUrlTemplate:
        'https://www.googleadservices.com/pagead/conversion/?gclid={gclid}&conversion_id={conversionId}&conversion_label={conversionLabel}&value={payout}&currency_code=EUR',
    },
    setupNote:
      'Put the Direct Ad URL in Google Ads (final URL). Google adds gclid automatically. Add the LP script to your landing page.',
    isSystem: true,
  },
  {
    slug: 'taboola',
    name: 'Taboola',
    trackingModeDefault: TrackingMode.redirect,
    clickUrlTemplate:
      '{clickUrl}?click_id=${click_id}&site=${site}&campaign_id=${campaign_id}&campaign_item_id=${campaign_item_id}&cost=${cpc}&utm_source=taboola',
    directAdUrlTemplate: null,
    paramMappings: TABOOLA_MAPPINGS,
    conversionMethod: ConversionMethod.generic_postback,
    postbackDefaults: {
      mediagoEnabled: false,
      facebookEnabled: false,
      googleEnabled: false,
      postbackUrlTemplate:
        'https://trc.taboola.com/actions-handler/log/3/s2s-action?click-id={externalid}&name={eventType}&revenue={payout}&currency={payout.currency}',
    },
    setupNote:
      'Put the redirect Click URL in Taboola. Uses ${click_id} + ${cpc} for auto-cost. Configure the Taboola S2S postback.',
    isSystem: true,
  },
  {
    slug: 'mgid',
    name: 'MGID',
    trackingModeDefault: TrackingMode.redirect,
    clickUrlTemplate:
      '{clickUrl}?click_id={click_id}&widget_id={widget_id}&teaser_id={teaser_id}&cost={click_price}&utm_source=mgid',
    directAdUrlTemplate: null,
    paramMappings: MGID_MAPPINGS,
    conversionMethod: ConversionMethod.generic_postback,
    postbackDefaults: {
      mediagoEnabled: false,
      facebookEnabled: false,
      googleEnabled: false,
      postbackUrlTemplate:
        'https://a.mgid.com/postback?click_id={externalid}&price={payout}',
    },
    setupNote:
      'Put the redirect Click URL in MGID. Uses {click_id} + {click_price} for auto-cost. Configure the MGID postback.',
    isSystem: true,
  },
  {
    slug: 'newsbreak',
    name: 'NewsBreak',
    trackingModeDefault: TrackingMode.redirect,
    clickUrlTemplate:
      '{clickUrl}?click_id=${CLICK_ID}&ad_id=${AD_ID}&campaign_id=${CAMPAIGN_ID}&cost=${BID_PRICE}&utm_source=newsbreak',
    directAdUrlTemplate: null,
    paramMappings: DEFAULT_PARAM_MAPPINGS,
    conversionMethod: ConversionMethod.generic_postback,
    postbackDefaults: {
      mediagoEnabled: false,
      facebookEnabled: false,
      googleEnabled: false,
      postbackUrlTemplate:
        'https://api.newsbreak.com/adx/s2s/conversion?click_id={externalid}&value={payout}',
    },
    setupNote:
      'Put the redirect Click URL in NewsBreak. Uses ${BID_PRICE} for auto-cost. Configure the NewsBreak S2S postback.',
    isSystem: true,
  },
  {
    slug: 'tiktok',
    name: 'TikTok',
    trackingModeDefault: TrackingMode.direct,
    clickUrlTemplate: null,
    directAdUrlTemplate:
      '{destinationUrl}?utm_source=tiktok&utm_medium=paid_social&utm_campaign={campaignName}&ttclid=__CLICKID__',
    paramMappings: TIKTOK_MAPPINGS,
    conversionMethod: ConversionMethod.generic_postback,
    postbackDefaults: {
      mediagoEnabled: false,
      facebookEnabled: false,
      googleEnabled: false,
      requiredMetadata: ['ttclid'],
      postbackUrlTemplate:
        'POST https://business-api.tiktok.com/open_api/v1.3/event/track/ (Events API — configure pixel + token on campaign)',
    },
    setupNote:
      'Put the Direct Ad URL in TikTok (TikTok fills ttclid). Add the LP script to your landing page.',
    isSystem: true,
  },
  {
    slug: 'openai',
    name: 'OpenAI Ads (ChatGPT)',
    trackingModeDefault: TrackingMode.direct,
    clickUrlTemplate: null,
    directAdUrlTemplate:
      '{destinationUrl}?utm_source=openai&utm_medium=cpc&utm_campaign={campaignName}',
    paramMappings: OPENAI_MAPPINGS,
    conversionMethod: ConversionMethod.openai_capi,
    postbackDefaults: {
      mediagoEnabled: false,
      facebookEnabled: false,
      googleEnabled: false,
      openaiEnabled: true,
      requiredMetadata: ['email'],
      postbackUrlTemplate:
        'POST https://bzr.openai.com/v1/events?pid={pixelId} (Conversions API — configure pixel ID + API key on campaign)',
    },
    setupNote:
      "Put the Direct Ad URL in ChatGPT Ads Manager. Add oppref to the campaign's tracking template so it lands on the LP, then add the LP script to your landing page. Provision the Pixel ID and Conversions API key from the Conversions tab in Ads Manager.",
    isSystem: true,
  },
  {
    slug: 'affiliate-generic',
    name: 'Affiliate Network (generic S2S)',
    trackingModeDefault: TrackingMode.redirect,
    clickUrlTemplate: '{clickUrl}?click_id=${SUBID}&cost=${COST}',
    directAdUrlTemplate: null,
    paramMappings: DEFAULT_PARAM_MAPPINGS,
    conversionMethod: ConversionMethod.generic_postback,
    postbackDefaults: {
      mediagoEnabled: false,
      facebookEnabled: false,
      googleEnabled: false,
      postbackUrlTemplate:
        'https://YOUR-NETWORK.com/postback?subid={externalid}&payout={payout}&txid={transaction.id}',
    },
    setupNote:
      'Generic template for any affiliate network that supports a click/subid macro and an S2S postback. Edit the postback URL to match your network.',
    isSystem: true,
  },
];
