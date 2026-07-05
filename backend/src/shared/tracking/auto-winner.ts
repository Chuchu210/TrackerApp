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
}

export const DEFAULT_AUTO_WINNER_CONFIG: AutoWinnerConfig = {
  minVisitsPerVariant: 200,
  minTotalVisits: 500,
  minMarginPct: 20,
};

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
): AutoWinnerConfig {
  return {
    minVisitsPerVariant: toPositiveInt(
      minVisitsPerVariant,
      DEFAULT_AUTO_WINNER_CONFIG.minVisitsPerVariant,
    ),
    minTotalVisits: toPositiveInt(minTotalVisits, DEFAULT_AUTO_WINNER_CONFIG.minTotalVisits),
    minMarginPct: toPositiveInt(minMarginPct, DEFAULT_AUTO_WINNER_CONFIG.minMarginPct),
  };
}
