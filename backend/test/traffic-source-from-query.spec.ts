import {
  attributedCampaignClickWhere,
  inferTrafficSourceFromQuery,
  pickCampaignForInferredSource,
} from '../src/shared/tracking/traffic-source-from-query';

const lp1 = {
  id: 'mediago-id',
  trafficSource: 'mediago' as const,
  destinationUrl: 'https://nexoquote.com/',
  slug: 'lp1',
  name: 'LP1 Mediago',
};

const facebook = {
  id: 'facebook-id',
  trafficSource: 'facebook' as const,
  destinationUrl: 'https://nexoquote.com/',
  slug: 'fb-lp1',
  name: 'Facebook LP1',
};

describe('inferTrafficSourceFromQuery', () => {
  it('detects Facebook from utm_source', () => {
    expect(inferTrafficSourceFromQuery({ utm_source: 'facebook' })).toBe('facebook');
  });

  it('detects Facebook from fbclid even without utm', () => {
    expect(inferTrafficSourceFromQuery({ fbclid: 'abc' })).toBe('facebook');
  });
});

describe('pickCampaignForInferredSource', () => {
  it('moves Facebook LP hits onto the Facebook campaign for the same host', () => {
    const picked = pickCampaignForInferredSource(lp1, 'facebook', [facebook]);
    expect(picked.id).toBe('facebook-id');
  });

  it('keeps lp1 when no Facebook campaign exists', () => {
    const picked = pickCampaignForInferredSource(lp1, 'facebook', []);
    expect(picked.id).toBe('mediago-id');
  });
});

describe('attributedCampaignClickWhere', () => {
  const base = { isTest: false };

  it('counts Facebook utm visits from the Mediago sibling on the Facebook row', () => {
    const where = attributedCampaignClickWhere(facebook, [lp1, facebook], base);
    expect(JSON.stringify(where)).toContain('facebook-id');
    expect(JSON.stringify(where)).toContain('mediago-id');
  });

  it('excludes Facebook utm visits from the Mediago row when a Facebook sibling exists', () => {
    const where = attributedCampaignClickWhere(lp1, [lp1, facebook], base);
    expect(JSON.stringify(where)).toContain('NOT');
  });
});
