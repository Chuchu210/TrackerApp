import {
  parseFxRates,
  buildFxConfig,
  normalizeToBase,
} from '../src/shared/tracking/currency';
import {
  resolveReportTimezone,
  DEFAULT_REPORT_TIMEZONE,
} from '../src/shared/tracking/report-timezone';

describe('parseFxRates', () => {
  it('parses a comma list into an uppercase rate map', () => {
    expect(parseFxRates('eur:1.08, gbp:1.27')).toEqual({ EUR: 1.08, GBP: 1.27 });
  });

  it('skips malformed and non-positive entries', () => {
    expect(parseFxRates('EUR:abc,GBP:-1,CAD:0,USD:1')).toEqual({ USD: 1 });
    expect(parseFxRates('')).toEqual({});
    expect(parseFxRates(undefined)).toEqual({});
  });
});

describe('normalizeToBase', () => {
  const cfg = buildFxConfig('USD', 'EUR:1.08,GBP:1.27');

  it('returns the amount unchanged for the base currency', () => {
    expect(normalizeToBase(100, 'USD', cfg)).toBe(100);
    expect(normalizeToBase(100, null, cfg)).toBe(100); // null treated as base
  });

  it('converts a known foreign currency', () => {
    expect(normalizeToBase(100, 'EUR', cfg)).toBeCloseTo(108);
    expect(normalizeToBase(100, 'GBP', cfg)).toBeCloseTo(127);
  });

  it('returns the amount unchanged for an unknown currency (never zeroes money)', () => {
    expect(normalizeToBase(100, 'JPY', cfg)).toBe(100);
  });

  it('returns 0 for a zero amount', () => {
    expect(normalizeToBase(0, 'EUR', cfg)).toBe(0);
  });
});

describe('resolveReportTimezone', () => {
  it('defaults to UTC', () => {
    expect(resolveReportTimezone(undefined)).toBe('UTC');
    expect(resolveReportTimezone('utc')).toBe('UTC');
    expect(resolveReportTimezone('')).toBe(DEFAULT_REPORT_TIMEZONE);
  });

  it('accepts valid IANA names', () => {
    expect(resolveReportTimezone('Europe/Paris')).toBe('Europe/Paris');
    expect(resolveReportTimezone('America/New_York')).toBe('America/New_York');
  });

  it('rejects injection attempts and falls back to UTC', () => {
    expect(resolveReportTimezone("UTC'; DROP TABLE clicks;--")).toBe('UTC');
    expect(resolveReportTimezone('foo bar')).toBe('UTC');
  });
});
