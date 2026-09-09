import {
  aggregateDrilldownRows,
  clickGroupForDimension,
} from '../src/analytics/campaign-drilldown.util';

describe('Facebook campaign / adset / ad drilldown', () => {
  const click = {
    clickId: 'clk-1',
    campaignExternalId: '23851234567890123',
    adsetId: '23851234567890456',
    adsetName: 'FR-55plus-broad',
    adId: '23851234567890789',
    adTitle: 'img3_titleB_ctaDecouvrir',
    visitorId: 'v1',
  };

  it('groups by Meta campaign id', () => {
    expect(clickGroupForDimension('ad_campaigns', click)).toEqual({
      key: '23851234567890123',
      label: '23851234567890123',
    });
  });

  it('labels Meta campaign with utm_campaign when present', () => {
    expect(
      clickGroupForDimension('ad_campaigns', { ...click, utmCampaign: 'autolp1' }),
    ).toEqual({
      key: '23851234567890123',
      label: 'autolp1',
    });
  });

  it('falls back to utm_campaign when Meta campaign id is missing', () => {
    expect(clickGroupForDimension('ad_campaigns', { utmCampaign: 'autolp1' })).toEqual({
      key: 'name:autolp1',
      label: 'autolp1',
    });
  });

  it('groups by adset id and prefers the adset name as the label', () => {
    expect(clickGroupForDimension('adsets', click)).toEqual({
      key: '23851234567890456',
      label: 'FR-55plus-broad',
    });
  });

  it('groups by ad id and prefers the ad name as the label', () => {
    expect(clickGroupForDimension('ads', click)).toEqual({
      key: '23851234567890789',
      label: 'img3_titleB_ctaDecouvrir',
    });
  });

  it('aggregates visits and conversions per adset', () => {
    const rows = aggregateDrilldownRows({
      dimension: 'adsets',
      marker: 'Facebook',
      clicks: [
        click,
        { ...click, clickId: 'clk-2', visitorId: 'v2' },
        {
          clickId: 'clk-3',
          adsetId: '999',
          adsetName: 'other',
          visitorId: 'v3',
        },
      ],
      conversions: [
        {
          clickId: 'clk-1',
          eventType: 'lead',
          revenue: 40,
          click,
        },
      ],
    });

    const fr = rows.find((r) => r.campaignId === '23851234567890456');
    const other = rows.find((r) => r.campaignId === '999');
    expect(fr?.campaignName).toBe('FR-55plus-broad');
    expect(fr?.visits).toBe(2);
    expect(fr?.conversions).toBe(1);
    expect(fr?.revenue).toBe(40);
    expect(other?.visits).toBe(1);
    expect(other?.conversions).toBe(0);
  });
});
