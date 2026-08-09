import { metaEventNameForEventType } from '../src/shared/tracking/meta-events';

describe('metaEventNameForEventType', () => {
  it('maps viewcontent (auto page-load conversion) to PageView', () => {
    expect(metaEventNameForEventType('viewcontent')).toBe('PageView');
  });

  it('maps lead to Lead', () => {
    expect(metaEventNameForEventType('lead')).toBe('Lead');
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
