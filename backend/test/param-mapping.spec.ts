import {
  resolveParamsFromMappings,
  getReportFieldsFromClick,
  DEFAULT_PARAM_MAPPINGS,
} from '../src/shared/tracking/param-mapping';
import { SYSTEM_TRAFFIC_SOURCE_PROFILES } from '../src/traffic-sources/traffic-source-profiles.seed';

describe('resolveParamsFromMappings', () => {
  const mediagoQuery = {
    adid: '123',
    adtitle: 'My Ad',
    campaignid: 'camp-1',
    publishername: 'PubCo',
    click_id: 'track-abc',
    platform: 'mobile',
  };

  it('maps Mediago params via default mappings', () => {
    const resolved = resolveParamsFromMappings(mediagoQuery, DEFAULT_PARAM_MAPPINGS);
    expect(resolved.ad_id).toBe('123');
    expect(resolved.ad_title).toBe('My Ad');
    expect(resolved.campaign_external_id).toBe('camp-1');
    expect(resolved.publisher_name).toBe('PubCo');
    expect(resolved.tracking_id).toBe('track-abc');
    expect(resolved.platform).toBe('mobile');
  });

  it('maps Facebook fbclid via facebook profile mappings', () => {
    const fbMappings = [
      {
        internalField: 'fbclid',
        displayLabel: 'FBCLID',
        externalKeys: ['fbclid'],
        showInReports: true,
        priority: 1,
      },
      {
        internalField: 'utm_source',
        displayLabel: 'UTM Source',
        externalKeys: ['utm_source'],
        showInReports: true,
        priority: 2,
      },
    ];
    const resolved = resolveParamsFromMappings(
      { fbclid: 'fb.123', utm_source: 'facebook' },
      fbMappings,
    );
    expect(resolved.fbclid).toBe('fb.123');
    expect(resolved.utm_source).toBe('facebook');
  });

  it('maps Google gclid via google profile mappings', () => {
    const googleMappings = [
      {
        internalField: 'gclid',
        displayLabel: 'GCLID',
        externalKeys: ['gclid'],
        showInReports: true,
        priority: 1,
      },
    ];
    const resolved = resolveParamsFromMappings({ gclid: 'gclid-xyz' }, googleMappings);
    expect(resolved.gclid).toBe('gclid-xyz');
  });

  it('strips unreplaced macros', () => {
    const resolved = resolveParamsFromMappings(
      { adid: '${AD_ID}', click_id: 'real-id' },
      DEFAULT_PARAM_MAPPINGS,
    );
    expect(resolved.ad_id).toBeUndefined();
    expect(resolved.tracking_id).toBe('real-id');
  });

  // Regression: only the `${...}` syntax was detected, so when Meta failed to
  // substitute its own macros the literal "{{ad.id}}" was stored as a real ad id.
  it('strips unreplaced Meta {{...}} macros', () => {
    const resolved = resolveParamsFromMappings(
      { ad_id: '{{ad.id}}', campaign_id: '{{campaign.id}}', click_id: 'real-id' },
      DEFAULT_PARAM_MAPPINGS,
    );
    expect(resolved.ad_id).toBeUndefined();
    expect(resolved.campaign_external_id).toBeUndefined();
    expect(resolved.tracking_id).toBe('real-id');
  });

  it('strips unreplaced single-brace macros (Taboola/MGID)', () => {
    const resolved = resolveParamsFromMappings(
      { click_id: '{click_id}', adid: '456' },
      DEFAULT_PARAM_MAPPINGS,
    );
    expect(resolved.tracking_id).toBeUndefined();
    expect(resolved.ad_id).toBe('456');
  });

  it('keeps real values that are not macros', () => {
    const resolved = resolveParamsFromMappings(
      { ad_id: '120210000000000', adtitle: 'Promo {septembre}', click_id: 'abc' },
      DEFAULT_PARAM_MAPPINGS,
    );
    expect(resolved.ad_id).toBe('120210000000000');
    // A brace *inside* a longer string is not a macro — only a lone token is.
    expect(resolved.ad_title).toBe('Promo {septembre}');
  });
});

describe('Facebook traffic source mappings', () => {
  it('captures campaign / adset / ad granularity from Meta dynamic params', () => {
    const facebookProfile = SYSTEM_TRAFFIC_SOURCE_PROFILES.find(
      (p) => p.slug === 'facebook',
    );
    expect(facebookProfile).toBeDefined();

    const resolved = resolveParamsFromMappings(
      {
        utm_source: 'facebook',
        utm_campaign: 'autolp1',
        campaign_id: '23851234567890123',
        adset_id: '23851234567890456',
        adset_name: 'FR-55plus-broad',
        ad_id: '23851234567890789',
        ad_name: 'img3_titleB_ctaDecouvrir',
        placement: 'feed',
        site_source_name: 'ig',
      },
      facebookProfile!.paramMappings,
    );

    expect(resolved.campaign_external_id).toBe('23851234567890123');
    expect(resolved.adset_id).toBe('23851234567890456');
    expect(resolved.adset_name).toBe('FR-55plus-broad');
    expect(resolved.ad_id).toBe('23851234567890789');
    // Ad name carries the image/title/CTA combination.
    expect(resolved.ad_title).toBe('img3_titleB_ctaDecouvrir');
    expect(resolved.platform).toBe('feed');
    expect(resolved.publisher_name).toBe('ig');
  });

  it('ships a direct ad URL template carrying every Meta macro', () => {
    const facebookProfile = SYSTEM_TRAFFIC_SOURCE_PROFILES.find(
      (p) => p.slug === 'facebook',
    );
    const template = facebookProfile!.directAdUrlTemplate ?? '';
    for (const macro of [
      '{{campaign.id}}',
      '{{adset.id}}',
      '{{ad.id}}',
      '{{adset.name}}',
      '{{ad.name}}',
      '{{placement}}',
      '{{site_source_name}}',
    ]) {
      expect(template).toContain(macro);
    }
  });
});

describe('getReportFieldsFromClick', () => {
  it('returns display labels for mapped click fields', () => {
    const rows = getReportFieldsFromClick(
      {
        adId: '99',
        publisherName: 'Pub',
        trackingId: 'tid-1',
      },
      DEFAULT_PARAM_MAPPINGS,
    );
    expect(rows.some((r) => r.label === 'Ad id' && r.value === '99')).toBe(true);
    expect(rows.some((r) => r.label === 'Publisher Name' && r.value === 'Pub')).toBe(true);
  });

  it('surfaces adset columns when they are populated', () => {
    const rows = getReportFieldsFromClick(
      {
        adsetId: '23851234567890456',
        adsetName: 'FR-55plus-broad',
        adId: '23851234567890789',
      },
      DEFAULT_PARAM_MAPPINGS,
    );
    expect(rows.some((r) => r.label === 'Adset id' && r.value === '23851234567890456')).toBe(true);
    expect(rows.some((r) => r.label === 'Adset' && r.value === 'FR-55plus-broad')).toBe(true);
  });
});
