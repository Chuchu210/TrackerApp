import { metaEventNameForEventType } from '../src/shared/tracking/meta-events';

describe('metaEventNameForEventType', () => {
  it('maps viewcontent (auto page-load conversion) to PageView', () => {
    expect(metaEventNameForEventType('viewcontent')).toBe('PageView');
  });

  it('maps lead to Lead', () => {
    expect(metaEventNameForEventType('lead')).toBe('Lead');
  });

  it('maps the quiz funnel to standard Pixel events Meta optimises for', () => {
    expect(metaEventNameForEventType('quiz_started')).toBe('ViewContent');
    expect(metaEventNameForEventType('quiz_q2')).toBe('AddToCart');
    expect(metaEventNameForEventType('quiz_q3')).toBe('InitiateCheckout');
  });

  it('maps call_click to Contact and call_connected to Schedule', () => {
    expect(metaEventNameForEventType('call_click')).toBe('Contact');
    expect(metaEventNameForEventType('call_connected')).toBe('Schedule');
  });

  it('maps purchase to Purchase', () => {
    expect(metaEventNameForEventType('purchase')).toBe('Purchase');
  });

  it('is case-insensitive', () => {
    expect(metaEventNameForEventType('LEAD')).toBe('Lead');
  });

  it('falls back to a PascalCase custom event name for unknown slugs', () => {
    expect(metaEventNameForEventType('custom_thing')).toBe('CustomThing');
  });
});
