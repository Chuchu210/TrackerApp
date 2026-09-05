import {
  computeWinner,
  parseAutoWinnerConfig,
  DEFAULT_AUTO_WINNER_CONFIG,
  twoProportionZ,
  type AutoWinnerConfig,
} from '../src/shared/tracking/auto-winner';

// Spread the defaults so adding a gate to AutoWinnerConfig cannot silently
// leave this fixture behind (it did once: the significance gates were added and
// these objects kept typechecking only because jest does not run tsc).
const cfg: AutoWinnerConfig = {
  ...DEFAULT_AUTO_WINNER_CONFIG,
  minVisitsPerVariant: 200,
  minTotalVisits: 500,
  minMarginPct: 20,
};

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

describe('computeWinner statistical safety', () => {
  it('refuses a winner on a low-conversion split that clears the ratio gates', () => {
    // The exact trap on a ~1.5% funnel: 200 visits is ~3 conversions, and
    // 4-vs-3 clears both the visit floor and the 20% relative margin.
    const r = computeWinner([
      { variantId: 'a', visits: 300, conversions: 4 },
      { variantId: 'b', visits: 300, conversions: 3 },
    ]);
    expect(r.winnerId).toBeNull();
    expect(r.reason).toBe('leader_below_min_conversions');
  });

  it('refuses to promote a variant just because the other has zero conversions', () => {
    const r = computeWinner([
      { variantId: 'a', visits: 300, conversions: 1 },
      { variantId: 'b', visits: 300, conversions: 0 },
    ]);
    expect(r.winnerId).toBeNull();
  });

  it('refuses a large-volume split that is not significant', () => {
    const r = computeWinner([
      { variantId: 'a', visits: 5000, conversions: 130 },
      { variantId: 'b', visits: 5000, conversions: 105 },
    ]);
    expect(r.winnerId).toBeNull();
    expect(r.reason).toBe('not_statistically_significant');
  });

  it('promotes a winner once the gap is both large and significant', () => {
    const r = computeWinner([
      { variantId: 'a', visits: 5000, conversions: 250 },
      { variantId: 'b', visits: 5000, conversions: 100 },
    ]);
    expect(r.winnerId).toBe('a');
    expect(r.reason).toBe('clear_winner');
  });
});

describe('twoProportionZ', () => {
  it('returns 0 when a variant has no traffic', () => {
    expect(
      twoProportionZ(
        { variantId: 'a', visits: 0, conversions: 0 },
        { variantId: 'b', visits: 100, conversions: 5 },
      ),
    ).toBe(0);
  });

  it('returns 0 when neither variant converted', () => {
    expect(
      twoProportionZ(
        { variantId: 'a', visits: 100, conversions: 0 },
        { variantId: 'b', visits: 100, conversions: 0 },
      ),
    ).toBe(0);
  });

  it('is positive when the leader converts better', () => {
    expect(
      twoProportionZ(
        { variantId: 'a', visits: 1000, conversions: 100 },
        { variantId: 'b', visits: 1000, conversions: 50 },
      ),
    ).toBeGreaterThan(1.96);
  });
});

describe('parseAutoWinnerConfig', () => {
  it('falls back to defaults on invalid input', () => {
    expect(parseAutoWinnerConfig(undefined, undefined, undefined)).toEqual(
      DEFAULT_AUTO_WINNER_CONFIG,
    );
  });

  it('parses provided values', () => {
    expect(parseAutoWinnerConfig('100', '300', '15', '10', '1.65')).toEqual({
      minVisitsPerVariant: 100,
      minTotalVisits: 300,
      minMarginPct: 15,
      minConversionsForWinner: 10,
      minZScore: 1.65,
    });
  });
});
