export interface VariantStats {
  variantId: string;
  visits: number;
  conversions: number;
}

export interface AutoWinnerConfig {
  /** Minimum visits a variant needs before it can be judged. */
  minVisitsPerVariant: number;
  /** Minimum combined visits across the path before acting. */
  minTotalVisits: number;
  /** Winner's CR must beat the runner-up's by at least this many points (pct). */
  minMarginPct: number;
  /**
   * Minimum conversions the leader needs. Visit thresholds alone are unsafe on
   * low-converting funnels: at a ~1.5% rate, 200 visits is ~3 conversions, and
   * 4-vs-3 clears a 20% relative margin while being pure noise.
   */
  minConversionsForWinner: number;
  /**
   * Two-proportion z threshold the leader must clear against the runner-up.
   * 1.96 is the two-sided 95% critical value; deactivating a variant is
   * destructive, so the default stays on the strict side.
   */
  minZScore: number;
}

export const DEFAULT_AUTO_WINNER_CONFIG: AutoWinnerConfig = {
  minVisitsPerVariant: 200,
  minTotalVisits: 500,
  minMarginPct: 20,
  minConversionsForWinner: 25,
  minZScore: 1.96,
};

/**
 * Pooled two-proportion z-test. Returns 0 when there is no signal at all
 * (no variance, or no traffic), which callers treat as "not significant".
 */
export function twoProportionZ(
  leader: VariantStats,
  runnerUp: VariantStats,
): number {
  const n1 = leader.visits;
  const n2 = runnerUp.visits;
  if (n1 <= 0 || n2 <= 0) return 0;

  const p1 = leader.conversions / n1;
  const p2 = runnerUp.conversions / n2;
  const pooled = (leader.conversions + runnerUp.conversions) / (n1 + n2);
  if (pooled <= 0 || pooled >= 1) return 0;

  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (se <= 0) return 0;
  return (p1 - p2) / se;
}

export interface AutoWinnerResult {
  winnerId: string | null;
  reason: string;
}

function crPct(s: VariantStats): number {
  return s.visits > 0 ? (s.conversions / s.visits) * 100 : 0;
}

/**
 * Decide whether one variant has clearly won an A/B rotation. Conservative by
 * design: it only returns a winner when there is enough total data, the leader
 * itself has enough visits, and its conversion rate beats the runner-up by a
 * relative margin. Otherwise returns null so rotation keeps running.
 */
export function computeWinner(
  stats: VariantStats[],
  config: AutoWinnerConfig = DEFAULT_AUTO_WINNER_CONFIG,
): AutoWinnerResult {
  const eligible = stats.filter((s) => s.visits > 0);
  if (eligible.length < 2) {
    return { winnerId: null, reason: 'need_at_least_two_variants_with_traffic' };
  }

  const totalVisits = eligible.reduce((sum, s) => sum + s.visits, 0);
  if (totalVisits < config.minTotalVisits) {
    return { winnerId: null, reason: 'insufficient_total_visits' };
  }

  const ranked = [...eligible].sort((a, b) => crPct(b) - crPct(a));
  const leader = ranked[0];
  const runnerUp = ranked[1];

  if (leader.visits < config.minVisitsPerVariant) {
    return { winnerId: null, reason: 'leader_below_min_visits' };
  }

  const leaderCr = crPct(leader);
  const runnerCr = crPct(runnerUp);
  if (leaderCr <= 0) {
    return { winnerId: null, reason: 'no_conversions_yet' };
  }

  // Relative margin: leader must beat runner-up by minMarginPct percent of the
  // runner-up's rate (or absolutely when runner-up has zero conversions).
  const margin =
    runnerCr <= 0 ? 100 : ((leaderCr - runnerCr) / runnerCr) * 100;
  if (margin < config.minMarginPct) {
    return { winnerId: null, reason: 'margin_too_small' };
  }

  // Volume of conversions, not just of visits. Without this a 1-vs-0 split
  // clears every ratio-based gate above.
  if (leader.conversions < config.minConversionsForWinner) {
    return { winnerId: null, reason: 'leader_below_min_conversions' };
  }

  const z = twoProportionZ(leader, runnerUp);
  if (z < config.minZScore) {
    return { winnerId: null, reason: 'not_statistically_significant' };
  }

  return { winnerId: leader.variantId, reason: 'clear_winner' };
}

function toPositiveInt(raw: string | number | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function parseAutoWinnerConfig(
  minVisitsPerVariant?: string | number,
  minTotalVisits?: string | number,
  minMarginPct?: string | number,
  minConversionsForWinner?: string | number,
  minZScore?: string | number,
): AutoWinnerConfig {
  return {
    minVisitsPerVariant: toPositiveInt(
      minVisitsPerVariant,
      DEFAULT_AUTO_WINNER_CONFIG.minVisitsPerVariant,
    ),
    minTotalVisits: toPositiveInt(minTotalVisits, DEFAULT_AUTO_WINNER_CONFIG.minTotalVisits),
    minMarginPct: toPositiveInt(minMarginPct, DEFAULT_AUTO_WINNER_CONFIG.minMarginPct),
    minConversionsForWinner: toPositiveInt(
      minConversionsForWinner,
      DEFAULT_AUTO_WINNER_CONFIG.minConversionsForWinner,
    ),
    // Not an integer, so toPositiveInt would floor 1.96 to 1.
    minZScore: toPositiveNumber(minZScore, DEFAULT_AUTO_WINNER_CONFIG.minZScore),
  };
}

function toPositiveNumber(raw: string | number | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
