import {
  excludeTestRows,
  excludeTestRowsSql,
  parseIncludeTest,
} from '../src/shared/tracking/test-mode';
import { buildClickWhere } from '../src/analytics/visit-filters';

describe('excludeTestRows', () => {
  it('excludes test rows when nothing is said about them', () => {
    // The whole design rests on this default: a query that forgets to mention
    // test mode must still return real traffic only.
    expect(excludeTestRows({})).toEqual({ isTest: false });
  });

  it('excludes test rows when includeTest is explicitly false', () => {
    expect(excludeTestRows({ includeTest: false })).toEqual({ isTest: false });
  });

  it('lifts the filter only on an explicit opt-in', () => {
    expect(excludeTestRows({ includeTest: true })).toEqual({});
  });
});

describe('excludeTestRowsSql', () => {
  it('emits a qualified predicate for the raw report queries', () => {
    expect(excludeTestRowsSql({}, 'cv')).toBe(' AND "cv"."is_test" = false');
  });

  it('emits nothing when test rows are wanted', () => {
    expect(excludeTestRowsSql({ includeTest: true }, 'cv')).toBe('');
  });
});

describe('parseIncludeTest', () => {
  it.each([true, 'true', '1'])('treats %p as an opt-in', (value) => {
    expect(parseIncludeTest(value)).toBe(true);
  });

  it.each([undefined, null, '', 'false', '0', 'yes', 0, 1])(
    'treats %p as no opt-in',
    (value) => {
      expect(parseIncludeTest(value)).toBe(false);
    },
  );
});

describe('buildClickWhere', () => {
  it('drops test clicks from every report built on it', () => {
    expect(buildClickWhere({}).isTest).toBe(false);
  });

  it('keeps them when the caller asks for them', () => {
    expect(buildClickWhere({ includeTest: true }).isTest).toBeUndefined();
  });

  it('leaves the other filters untouched', () => {
    const where = buildClickWhere({ campaignId: 'c1', excludeBots: true, country: 'US' });
    expect(where).toMatchObject({
      campaignId: 'c1',
      isBot: false,
      countryCode: 'US',
      isTest: false,
    });
  });
});
