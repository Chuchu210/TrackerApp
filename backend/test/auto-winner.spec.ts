import {
  computeWinner,
  parseAutoWinnerConfig,
  DEFAULT_AUTO_WINNER_CONFIG,
} from '../src/shared/tracking/auto-winner';

const cfg = { minVisitsPerVariant: 200, minTotalVisits: 500, minMarginPct: 20 };

describe('computeWinner', () => {
  it('returns no winner with fewer than two variants that have traffic', () => {
    expect(computeWinner([{ variantId: 'a', visits: 1000, conversions: 100 }], cfg).winnerId).toBeNull();
  });

  it('returns no winner below the total-visit floor', () => {
    const r = computeWinner(
      [
        { variantId: 'a', visits: 100, conversions: 20 },
        { variantId: 'b', visits: 100, conversions: 2 },
      ],
      cfg,
    );
    expect(r.winnerId).toBeNull();
    expect(r.reason).toBe('insufficient_total_visits');
  });

  it('returns no winner when the leader has too few visits', () => {
    const r = computeWinner(
      [
        { variantId: 'a', visits: 150, conversions: 60 },
        { variantId: 'b', visits: 400, conversions: 8 },
      ],
      cfg,
    );
    expect(r.winnerId).toBeNull();
    expect(r.reason).toBe('leader_below_min_visits');
  });

  it('returns no winner when the margin is too small', () => {
    const r = computeWinner(
      [
        { variantId: 'a', visits: 500, conversions: 55 }, // 11%
        { variantId: 'b', visits: 500, conversions: 50 }, // 10% -> 10% margin < 20
      ],
      cfg,
    );
    expect(r.winnerId).toBeNull();
    expect(r.reason).toBe('margin_too_small');
  });

  it('picks a clear winner when the leader beats the runner-up by the margin', () => {
    const r = computeWinner(
      [
        { variantId: 'a', visits: 500, conversions: 75 }, // 15%
        { variantId: 'b', visits: 500, conversions: 50 }, // 10% -> 50% margin
      ],
      cfg,
    );
    expect(r.winnerId).toBe('a');
    expect(r.reason).toBe('clear_winner');
  });

  it('treats a zero-conversion runner-up as a clear win for a converting leader', () => {
    const r = computeWinner(
      [
        { variantId: 'a', visits: 500, conversions: 30 },
        { variantId: 'b', visits: 500, conversions: 0 },
      ],
      cfg,
    );
    expect(r.winnerId).toBe('a');
  });
});

describe('parseAutoWinnerConfig', () => {
  it('falls back to defaults on invalid input', () => {
    expect(parseAutoWinnerConfig(undefined, undefined, undefined)).toEqual(
      DEFAULT_AUTO_WINNER_CONFIG,
    );
  });

  it('parses provided values', () => {
    expect(parseAutoWinnerConfig('100', '300', '15')).toEqual({
      minVisitsPerVariant: 100,
      minTotalVisits: 300,
      minMarginPct: 15,
    });
  });
});
