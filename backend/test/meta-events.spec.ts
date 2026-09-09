import { metaEventNameForEventType } from '../src/shared/tracking/meta-events';

describe('metaEventNameForEventType', () => {
  it('maps viewcontent (auto page-load conversion) to PageView', () => {
    expect(metaEventNameForEventType('viewcontent')).toBe('PageView');
  });

  it('maps lead to Lead', () => {
    expect(metaEventNameForEventType('lead')).toBe('Lead');
  });

  it('does not map quiz or call onto the wrong standard Pixel events', () => {
    expect(metaEventNameForEventType('quiz_started')).toBe('QuizStarted');
    expect(metaEventNameForEventType('quiz_q2')).toBe('QuizQuestion2');
    expect(metaEventNameForEventType('quiz_q3')).toBe('QuizQuestion3');
    expect(metaEventNameForEventType('call_click')).toBe('CallStarted');
    expect(metaEventNameForEventType('call_connected')).toBe('CallConnected');
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
