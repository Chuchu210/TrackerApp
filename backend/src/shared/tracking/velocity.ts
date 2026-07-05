export interface VelocityConfig {
  /** Sliding window, in seconds, over which clicks from one IP are counted. */
  windowSeconds: number;
  /** Click count from a single IP within the window that trips flood detection. */
  maxClicks: number;
}

export const DEFAULT_VELOCITY_CONFIG: VelocityConfig = {
  windowSeconds: 60,
  maxClicks: 20,
};

export interface VelocityResult {
  exceeded: boolean;
  /** Bot-score contribution (0-60) added on top of UA/IP heuristics. */
  score: number;
  reason?: string;
}

/**
 * Score click-flood velocity: how many clicks a single IP produced in the
 * window. At/above the threshold it contributes a bot score that scales with
 * how far over the limit the source is, capped at 60.
 */
export function evaluateClickVelocity(
  recentCount: number,
  config: VelocityConfig = DEFAULT_VELOCITY_CONFIG,
): VelocityResult {
  if (config.maxClicks <= 0) return { exceeded: false, score: 0 };
  if (recentCount < config.maxClicks) return { exceeded: false, score: 0 };

  const overRatio = recentCount / config.maxClicks;
  const score = Math.min(60, 30 + Math.floor((overRatio - 1) * 30));
  return {
    exceeded: true,
    score,
    reason: `click_velocity:${recentCount}_per_${config.windowSeconds}s`,
  };
}

function toPositiveInt(raw: string | number | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function parseVelocityConfig(
  windowRaw?: string | number,
  maxRaw?: string | number,
): VelocityConfig {
  return {
    windowSeconds: toPositiveInt(windowRaw, DEFAULT_VELOCITY_CONFIG.windowSeconds),
    maxClicks: toPositiveInt(maxRaw, DEFAULT_VELOCITY_CONFIG.maxClicks),
  };
}

/**
 * Merge the base bot signal (UA/IP heuristics) with the velocity signal into a
 * single score/isBot/reasons triple. Kept pure for testing.
 */
export function mergeBotSignals(
  base: { isBot: boolean; score: number; reasons: string[] },
  velocity: VelocityResult,
): { isBot: boolean; score: number; reasons: string[] } {
  const score = Math.min(100, base.score + velocity.score);
  const reasons = velocity.reason ? [...base.reasons, velocity.reason] : base.reasons;
  return { isBot: score >= 50, score, reasons };
}
