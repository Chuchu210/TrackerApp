import {
  metricLabelForEvent,
  parseCreativeCountMode,
  resolveCreativeEventSlugs,
} from '../src/analytics/creative-event-resolver';

describe('creative event resolver', () => {
  it('resolves call_click slugs from LP funnel', () => {
    const event = resolveCreativeEventSlugs('call_click');
    expect(event.stepId).toBe('call_click');
    expect(event.label).toBe('Call started');
    expect(event.slugs).toContain('call_click');
  });

  it('resolves click_button with alias slugs', () => {
    const event = resolveCreativeEventSlugs('click_button');
    expect(event.stepId).toBe('click_button');
    expect(event.slugs).toEqual(expect.arrayContaining(['click_button', 'clickbutton']));
  });

  it('defaults to call_click', () => {
    const event = resolveCreativeEventSlugs();
    expect(event.stepId).toBe('call_click');
  });

  it('parses count mode', () => {
    expect(parseCreativeCountMode('sent')).toBe('sent');
    expect(parseCreativeCountMode('recorded')).toBe('recorded');
    expect(parseCreativeCountMode(undefined)).toBe('recorded');
  });

  it('builds metric label', () => {
    expect(metricLabelForEvent('Call Click')).toBe('Call Click rate');
  });
});
