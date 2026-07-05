import { getTrackingParamsFromQuery, isTestLeadFromQuestionnaireData } from '../src/shared/tracking/params';
import { resolvePrimaryClickId } from '../src/shared/tracking/click-id-resolver';
import { generateClickId } from '../src/common/utils/click-id-generator';
import { DeviceParserService } from '../src/clicks/device-parser.service';

describe('Tracking flow unit tests', () => {
  describe('generateClickId', () => {
    it('generates Voluum-style click IDs with d prefix', () => {
      const id = generateClickId();
      expect(id).toMatch(/^d[a-z0-9]{24}$/);
    });
  });

  describe('getTrackingParamsFromQuery', () => {
    it('captures Mediago/Voluum URL params from energie-conseil example', () => {
      const params = getTrackingParamsFromQuery({
        adid: '12345',
        adtitle: 'Energy Offer',
        campaignid: '4950776',
        publishername: 'msn.com',
        siteid: 'site-abc',
        contentname: 'News',
        platform: 'mobile',
        assetid: 'asset-99',
        click_id: 'mediago-tracking-abc123',
      });

      expect(params.ad_id).toBe('12345');
      expect(params.ad_title).toBe('Energy Offer');
      expect(params.campaign_external_id).toBe('4950776');
      expect(params.publisher_name).toBe('msn.com');
      expect(params.site_id).toBe('site-abc');
      expect(params.content_name).toBe('News');
      expect(params.platform).toBe('mobile');
      expect(params.asset_id).toBe('asset-99');
      expect(params.tracking_id).toBe('mediago-tracking-abc123');
    });

    it('resolves gclid with priority chain', () => {
      const params = getTrackingParamsFromQuery({
        fbclid: 'fb123',
        click_id: 'click456',
      });

      expect(params.gclid).toBe('fb123');
    });
  });

  describe('DeviceParserService', () => {
    const parser = new DeviceParserService();

    it('parses Android Samsung like Voluum CSV', () => {
      const ua =
        'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36';
      const result = parser.parse(ua);
      expect(result.device).toBe('Mobile phone');
      expect(result.os).toBe('Android');
      expect(result.browser).toContain('Chrome');
    });

    it('parses iOS iPhone like Voluum CSV', () => {
      const ua =
        'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1';
      const result = parser.parse(ua);
      expect(result.device).toBe('Mobile phone');
      expect(result.os).toBe('iOS');
      expect(result.brand).toBe('Apple');
    });

    it('parses Desktop Windows like Voluum CSV', () => {
      const ua =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
      const result = parser.parse(ua);
      expect(result.device).toBe('Desktop');
      expect(result.os).toBe('Windows');
    });
  });

  describe('resolvePrimaryClickId', () => {
    it('follows gclid > fbclid > click_id > tk-cid > subid priority', () => {
      expect(
        resolvePrimaryClickId({
          gclid: 'g1',
          fbclid: 'f1',
          clickId: 'c1',
          tkCid: 't1',
          subid: 's1',
        }),
      ).toBe('g1');
    });
  });

  describe('isTestLeadFromQuestionnaireData', () => {
    it('skips genuine test leads', () => {
      expect(isTestLeadFromQuestionnaireData({ user_email: 'test@example.com' })).toBe(true);
      expect(isTestLeadFromQuestionnaireData({ user_email: 'qa.user@example.com' })).toBe(true);
      expect(isTestLeadFromQuestionnaireData({ user_email: 'someone@hipto.com' })).toBe(true);
      expect(isTestLeadFromQuestionnaireData({ is_test_lead: true })).toBe(true);
      expect(
        isTestLeadFromQuestionnaireData({ user_email: 'a@b.com', firstName: 'Demo' }),
      ).toBe(true);
    });

    it('honors the allowlisted lead email', () => {
      expect(isTestLeadFromQuestionnaireData({ user_email: 'lead@hipto.com' })).toBe(false);
    });

    it('does NOT drop real leads whose name/email merely contains a test token as a substring', () => {
      // Regression: bare-substring matching used to drop all of these.
      expect(
        isTestLeadFromQuestionnaireData({ user_email: 'qasim.khan@gmail.com', firstName: 'Qasim', lastName: 'Khan' }),
      ).toBe(false);
      expect(
        isTestLeadFromQuestionnaireData({ user_email: 'contest.winner@yahoo.com' }),
      ).toBe(false);
      expect(
        isTestLeadFromQuestionnaireData({ user_email: 'demond.wright@gmail.com', firstName: 'Demond' }),
      ).toBe(false);
      expect(
        isTestLeadFromQuestionnaireData({ user_email: 'raqa.ahmed@gmail.com', firstName: 'Raqa' }),
      ).toBe(false);
    });
  });
});

describe('Mediago postback URL format', () => {
  it('builds correct S2S postback URL', () => {
    const params = new URLSearchParams({
      trackingid: '3990b3995f7070b7727c18e074c76701',
      adid: '1000000',
      conversiontype: '10',
      conversionprice: '0',
      includeintotalconversion: '1',
    });

    const url = `https://sync.mediago.io/api/bidder/postback?${params.toString()}`;
    expect(url).toContain('trackingid=3990b3995f7070b7727c18e074c76701');
    expect(url).toContain('conversiontype=10');
  });
});
