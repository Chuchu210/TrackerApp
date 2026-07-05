import {
  isWithinAttributionWindow,
  isConversionCapReached,
} from '../src/shared/tracking/attribution';

describe('isWithinAttributionWindow', () => {
  const click = new Date('2026-07-01T00:00:00Z');

  it('allows everything when no window configured', () => {
    const later = new Date('2026-08-01T00:00:00Z');
    expect(isWithinAttributionWindow(click, later, null)).toBe(true);
    expect(isWithinAttributionWindow(click, later, 0)).toBe(true);
  });

  it('accepts a conversion inside the window', () => {
    const within = new Date('2026-07-01T12:00:00Z'); // 12h later
    expect(isWithinAttributionWindow(click, within, 24)).toBe(true);
  });

  it('rejects a conversion past the window', () => {
    const past = new Date('2026-07-03T01:00:00Z'); // 49h later
    expect(isWithinAttributionWindow(click, past, 24)).toBe(false);
  });

  it('accepts exactly at the boundary', () => {
    const boundary = new Date('2026-07-02T00:00:00Z'); // 24h later
    expect(isWithinAttributionWindow(click, boundary, 24)).toBe(true);
  });

  it('does not penalize clock skew (conversion before click)', () => {
    const before = new Date('2026-06-30T23:00:00Z');
    expect(isWithinAttributionWindow(click, before, 24)).toBe(true);
  });
});

describe('isConversionCapReached', () => {
  it('never caps when unset or non-positive', () => {
    expect(isConversionCapReached(100, null)).toBe(false);
    expect(isConversionCapReached(100, 0)).toBe(false);
  });

  it('caps once existing count reaches the limit', () => {
    expect(isConversionCapReached(0, 3)).toBe(false);
    expect(isConversionCapReached(2, 3)).toBe(false);
    expect(isConversionCapReached(3, 3)).toBe(true);
    expect(isConversionCapReached(5, 3)).toBe(true);
  });
});
