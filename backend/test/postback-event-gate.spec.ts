import { shouldFireNetworkPostback } from '../src/shared/tracking/postback-event-gate';

describe('shouldFireNetworkPostback', () => {
  it('sends pageview, quiz start, call and lead to every network', () => {
    expect(shouldFireNetworkPostback('viewcontent')).toBe(true);
    expect(shouldFireNetworkPostback('quiz_started', 'facebook')).toBe(true);
    expect(shouldFireNetworkPostback('quiz_started', 'mediago')).toBe(true);
    expect(shouldFireNetworkPostback('call_click')).toBe(true);
    expect(shouldFireNetworkPostback('lead')).toBe(true);
  });

  it('sends later quiz steps to Meta only, as standard events', () => {
    expect(shouldFireNetworkPostback('quiz_q2', 'facebook')).toBe(true);
    expect(shouldFireNetworkPostback('quiz_q3', 'facebook')).toBe(true);
    expect(shouldFireNetworkPostback('quiz_q2', 'mediago')).toBe(false);
    expect(shouldFireNetworkPostback('quiz_q3', 'google')).toBe(false);
  });
});
