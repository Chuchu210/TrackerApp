import {
  shouldSendAutoViewContent,
  wantsAutoViewContent,
} from '../src/shared/tracking/auto-view-content';

describe('shouldSendAutoViewContent', () => {
  it('skips viewcontent for lp1 (click_button optimization)', () => {
    expect(shouldSendAutoViewContent('lp1')).toBe(false);
  });

  it('sends viewcontent for other campaigns', () => {
    expect(shouldSendAutoViewContent('auto')).toBe(true);
  });
});

describe('wantsAutoViewContent', () => {
  it('keeps firing for Mediago (unchanged behaviour)', () => {
    expect(wantsAutoViewContent('mediago')).toBe(true);
    expect(wantsAutoViewContent('mg')).toBe(true);
    expect(wantsAutoViewContent(null, 'mediago')).toBe(true);
  });

  // Regression: the gate was Mediago-only, so Facebook campaigns produced no
  // first funnel step and Meta never got the matching PageView.
  it('now fires for Facebook / Instagram traffic', () => {
    expect(wantsAutoViewContent('facebook')).toBe(true);
    expect(wantsAutoViewContent('fb')).toBe(true);
    expect(wantsAutoViewContent('meta')).toBe(true);
    expect(wantsAutoViewContent('instagram')).toBe(true);
    expect(wantsAutoViewContent(null, 'facebook')).toBe(true);
  });

  it('leaves other networks alone so their postbacks are unaffected', () => {
    expect(wantsAutoViewContent('outbrain')).toBe(false);
    expect(wantsAutoViewContent('taboola')).toBe(false);
    expect(wantsAutoViewContent('google')).toBe(false);
    expect(wantsAutoViewContent(undefined, undefined)).toBe(false);
  });
});
