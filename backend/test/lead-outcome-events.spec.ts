import {
  buildLeadOutcomeUrls,
  isLeadOutcomeEvent,
} from '../src/shared/tracking/lead-outcome-events';
import { shouldFireNetworkPostback } from '../src/shared/tracking/postback-event-gate';
import { metaEventNameForEventType } from '../src/shared/tracking/meta-events';

describe('isLeadOutcomeEvent', () => {
  it('recognises the three buyer outcomes, case-insensitively', () => {
    expect(isLeadOutcomeEvent('lead_sold')).toBe(true);
    expect(isLeadOutcomeEvent('LEAD_REJECTED')).toBe(true);
    expect(isLeadOutcomeEvent(' lead_returned ')).toBe(true);
  });

  it('does not treat the landing-page lead or other events as outcomes', () => {
    expect(isLeadOutcomeEvent('lead')).toBe(false);
    expect(isLeadOutcomeEvent('purchase')).toBe(false);
    expect(isLeadOutcomeEvent(undefined)).toBe(false);
  });
});

describe('buyer outcomes on outgoing postbacks', () => {
  it('sends lead_sold to Meta only, as a Purchase', () => {
    expect(shouldFireNetworkPostback('lead_sold', 'facebook')).toBe(true);
    expect(shouldFireNetworkPostback('lead_sold', 'mediago')).toBe(false);
    expect(metaEventNameForEventType('lead_sold')).toBe('Purchase');
  });

  // Regression: without the gate these fell back to custom events on Meta and
  // to a second Lead (type 10) on Mediago.
  it('never forwards refusals or returns to any network', () => {
    for (const network of ['facebook', 'mediago', 'google', 'outbrain', undefined]) {
      expect(shouldFireNetworkPostback('lead_rejected', network)).toBe(false);
      expect(shouldFireNetworkPostback('lead_returned', network)).toBe(false);
    }
  });
});

describe('buildLeadOutcomeUrls', () => {
  it('builds one GET template per outcome on the tracking domain, never et=lead', () => {
    const urls = buildLeadOutcomeUrls('https://track.example.com');
    expect(urls.sold).toBe(
      'https://track.example.com/postback?cid={click_id}&secret={postback_secret}&et=lead_sold&payout={bid}&currency={currency}&txid={transaction_id}',
    );
    expect(urls.rejected).toBe('https://track.example.com/postback?cid={click_id}&secret={postback_secret}&et=lead_rejected&txid={transaction_id}');
    expect(urls.returned).toBe('https://track.example.com/postback?cid={click_id}&secret={postback_secret}&et=lead_returned&txid={transaction_id}');
    for (const url of Object.values(urls)) {
      expect(url).not.toContain('et=lead&');
    }
  });
});
