import {
  applyNativeParamFallbacks,
  extractVoluumFields,
} from '../src/shared/tracking/voluum-fields';

describe('Voluum fields extraction', () => {
  it('extracts custom variables var1-var10', () => {
    const fields = extractVoluumFields({
      var1: 'ad-hash',
      var3: 'publisher-site',
      path_id: 'path-uuid',
      lander_id: 'lander-uuid',
      offer_id: 'offer-uuid',
    });

    expect(fields.customVariables.cv1).toBe('ad-hash');
    expect(fields.customVariables.cv3).toBe('publisher-site');
    expect(fields.pathId).toBe('path-uuid');
    expect(fields.landerId).toBe('lander-uuid');
    expect(fields.offerId).toBe('offer-uuid');
  });

  it('reads the LP script aliases lp_id / lp_name', () => {
    const fields = extractVoluumFields({
      lp_id: 'nexoquote-auto-us',
      lp_name: 'Nexo Quote Auto US',
    });
    expect(fields.landerId).toBe('nexoquote-auto-us');
    expect(fields.landerName).toBe('Nexo Quote Auto US');
  });

  it('maps native Mediago params into CV slots when vars absent', () => {
    const cvs = applyNativeParamFallbacks({}, {
      adId: '12345',
      publisherName: 'msn.com',
      adTitle: 'Energy Offer',
      siteId: 'site-abc',
      platform: 'mobile',
    });

    expect(cvs.cv1).toBe('12345');
    expect(cvs.cv3).toBe('msn.com');
    expect(cvs.cv4).toBe('Energy Offer');
    expect(cvs.cv6).toBe('site-abc');
    expect(cvs.cv7).toBe('mobile');
  });
});
