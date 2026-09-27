import { TrackingMode } from '@prisma/client';
import {
  buildClickUrlFromTemplate,
  CANONICAL_FIELDS,
  resolveParamsFromMappings,
} from '../src/shared/tracking/param-mapping';
import { getTrackingParamsFromQuery } from '../src/shared/tracking/params';
import { inferTrafficSourceFromQuery } from '../src/shared/tracking/traffic-source-from-query';
import { applyMappedCustomVariables, applyNativeParamFallbacks } from '../src/shared/tracking/voluum-fields';
import { TrafficSourcesService } from '../src/traffic-sources/traffic-sources.service';
import { SYSTEM_TRAFFIC_SOURCE_PROFILES } from '../src/traffic-sources/traffic-source-profiles.seed';

const bing = SYSTEM_TRAFFIC_SOURCE_PROFILES.find((p) => p.slug === 'bing')!;

// A real Microsoft Ads click as it reaches the landing page: Final URL suffix filled + msclkid from auto-tagging.
const bingClick = {
  utm_source: 'bing',
  utm_medium: 'cpc',
  utm_campaign: 'WD LA - Search - Test 150',
  utm_term: 'water damage restoration',
  campaign_id: '488617815',
  adgroup_id: '1234753218185161',
  adgroup: 'Ad Group 1',
  ad_id: '84521234567890',
  match: 'e',
  device: 'm',
  network: 'o',
  msclkid: '3f1c0a9b8e7d4c2b1a0f9e8d7c6b5a4f',
};

describe('Microsoft Ads (Bing) traffic source', () => {
  it('is a direct-mode profile with no automatic postback (Mediago stays off)', () => {
    expect(bing).toBeDefined();
    expect(bing.name).toBe('Microsoft Ads (Bing)');
    expect(bing.trackingModeDefault).toBe(TrackingMode.direct);
    expect(bing.clickUrlTemplate).toBeNull();
    const pb = TrafficSourcesService.prototype.buildPostbackDefaultsFromProfile.call(null, bing);
    expect(pb.mediagoEnabled).toBe(false);
    expect(pb.facebookEnabled).toBe(false);
    expect(pb.googleEnabled).toBe(false);
  });

  it('keeps msclkid and the Bing campaign / ad group / ad / keyword granularity of a real click', () => {
    const r = resolveParamsFromMappings(bingClick, bing.paramMappings);
    expect(r.external_click_id).toBe(bingClick.msclkid);
    expect(r.utm_source).toBe('bing');
    expect(r.utm_campaign).toBe('WD LA - Search - Test 150');
    expect(r.utm_term).toBe('water damage restoration');
    expect(r.campaign_external_id).toBe('488617815');
    expect(r.adset_id).toBe('1234753218185161');
    expect(r.adset_name).toBe('Ad Group 1');
    expect(r.ad_id).toBe('84521234567890');
    expect(r.content_name).toBe('e');
    expect(r.platform).toBe('m');
    expect(r.publisher_name).toBe('o');
  });

  it('feeds the click columns written by recordClick', () => {
    const p = getTrackingParamsFromQuery(bingClick, null, bing.paramMappings);
    expect(p.external_click_id).toBe(bingClick.msclkid);
    expect(p.utm_term).toBe('water damage restoration');
    expect(p.campaign_external_id).toBe('488617815');
    // utm_campaign must stay the campaign NAME: campaign_id is not one of its keys here (it is in the defaults).
    expect(p.utm_campaign).toBe('WD LA - Search - Test 150');
    const { utm_campaign: _name, ...sansNom } = bingClick;
    const q = getTrackingParamsFromQuery(sansNom, null, bing.paramMappings);
    expect(q.utm_campaign).toBe('');
    expect(q.campaign_external_id).toBe('488617815');
  });

  it('drops macros Microsoft left unfilled (preview click, URL opened by hand)', () => {
    const r = resolveParamsFromMappings(
      { utm_source: 'bing', utm_term: '{keyword}', campaign_id: '{CampaignId}', network: '{Network}' },
      bing.paramMappings,
    );
    expect(r.utm_term).toBeUndefined();
    expect(r.campaign_external_id).toBeUndefined();
    expect(r.publisher_name).toBeUndefined();
  });

  it('ships a Direct Ad URL carrying every mapped Microsoft macro, left intact for Microsoft to fill', () => {
    const url = buildClickUrlFromTemplate(
      bing.directAdUrlTemplate!,
      'https://track.nexoquote.com/water-damage-la',
      'https://waterdamage.nexoquote.com/',
      'water-damage-la',
    );
    expect(url.startsWith('https://waterdamage.nexoquote.com/?utm_source=bing&utm_medium=cpc')).toBe(true);
    for (const m of bing.paramMappings) {
      if (m.urlMacro) expect(url).toContain(`${m.externalKeys[0]}=${m.urlMacro}`);
    }
    expect(url).not.toContain('msclkid'); // appended by Microsoft auto-tagging, never hard-coded
  });

  it('only maps canonical fields', () => {
    for (const m of bing.paramMappings) {
      expect(CANONICAL_FIELDS).toContain(m.internalField as (typeof CANONICAL_FIELDS)[number]);
      expect(m.externalKeys.length).toBeGreaterThan(0);
    }
  });

  it('keeps the search query the person typed in cv9 "Search Query", over the native fallbacks', () => {
    const q = { ...bingClick, query: 'water damage restoration pasadena emergency' };
    const resolved = resolveParamsFromMappings(q, bing.paramMappings);
    expect(resolved.cv9).toBe('water damage restoration pasadena emergency');
    const native = applyNativeParamFallbacks({}, { adId: '84521234567890', platform: 'm' });
    const cvs = applyMappedCustomVariables(native, resolved);
    expect(cvs.cv9).toBe('water damage restoration pasadena emergency');
    expect(cvs.cv1).toBe('84521234567890'); // native fallbacks untouched where no mapping applies
    expect(cvs.cv7).toBe('m');
    // An explicit mapping wins over a native fallback in the same slot.
    expect(applyMappedCustomVariables({ cv9: 'fallback' }, { cv9: 'typed' }).cv9).toBe('typed');
    // Preview clicks leave {QueryString} unfilled: nothing is stored.
    const preview = resolveParamsFromMappings({ ...bingClick, query: '{QueryString}' }, bing.paramMappings);
    expect(applyMappedCustomVariables({}, preview).cv9).toBeUndefined();
    const label = bing.paramMappings.find((m) => m.internalField === 'cv9');
    expect(label?.displayLabel).toBe('Search Query');
    expect(bing.directAdUrlTemplate).toContain('&query={QueryString}');
  });

  it('a Bing click is not rerouted to another campaign by source inference', () => {
    expect(inferTrafficSourceFromQuery(bingClick)).toBeNull();
  });
});
