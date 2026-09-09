import { shouldFireNetworkPostback } from '../src/shared/tracking/postback-event-gate';

describe('shouldFireNetworkPostback', () => {
  it('sends pageview, call start and lead to every network', () => {
    expect(shouldFireNetworkPostback('viewcontent')).toBe(true);
    expect(shouldFireNetworkPostback('call_click', 'facebook')).toBe(true);
    expect(shouldFireNetworkPostback('call_click', 'mediago')).toBe(true);
    expect(shouldFireNetworkPostback('lead')).toBe(true);
  });

  it('sends quiz custom events to Meta only', () => {
    expect(shouldFireNetworkPostback('quiz_started', 'facebook')).toBe(true);
    expect(shouldFireNetworkPostback('quiz_q2', 'facebook')).toBe(true);
    expect(shouldFireNetworkPostback('quiz_q3', 'facebook')).toBe(true);
    expect(shouldFireNetworkPostback('quiz_started', 'mediago')).toBe(false);
    expect(shouldFireNetworkPostback('quiz_q2', 'mediago')).toBe(false);
  });
});
