import {
  evaluateClickVelocity,
  mergeBotSignals,
  parseVelocityConfig,
  DEFAULT_VELOCITY_CONFIG,
} from '../src/shared/tracking/velocity';

describe('evaluateClickVelocity', () => {
  const cfg = { windowSeconds: 60, maxClicks: 20 };

  it('does not trip below the threshold', () => {
    expect(evaluateClickVelocity(19, cfg).exceeded).toBe(false);
    expect(evaluateClickVelocity(19, cfg).score).toBe(0);
  });

  it('trips at the threshold with a base score', () => {
    const r = evaluateClickVelocity(20, cfg);
    expect(r.exceeded).toBe(true);
    expect(r.score).toBe(30);
    expect(r.reason).toContain('click_velocity');
  });

  it('scales score with how far over the limit, capped at 60', () => {
    expect(evaluateClickVelocity(40, cfg).score).toBe(60); // 2x over
    expect(evaluateClickVelocity(200, cfg).score).toBe(60); // capped
  });

  it('is disabled when maxClicks is 0', () => {
    expect(evaluateClickVelocity(1000, { windowSeconds: 60, maxClicks: 0 }).exceeded).toBe(false);
  });
});

describe('mergeBotSignals', () => {
  it('adds velocity score and flips isBot past 50', () => {
    const base = { isBot: false, score: 25, reasons: ['missing_accept_language'] };
    const merged = mergeBotSignals(base, { exceeded: true, score: 30, reason: 'click_velocity:20_per_60s' });
    expect(merged.score).toBe(55);
    expect(merged.isBot).toBe(true);
    expect(merged.reasons).toContain('click_velocity:20_per_60s');
  });

  it('caps combined score at 100 and preserves reasons when no velocity', () => {
    const base = { isBot: true, score: 90, reasons: ['ua_pattern:bot'] };
    const merged = mergeBotSignals(base, { exceeded: true, score: 60 });
    expect(merged.score).toBe(100);
    expect(merged.reasons).toEqual(['ua_pattern:bot']);
  });
});

describe('parseVelocityConfig', () => {
  it('falls back to defaults on missing/invalid input', () => {
    expect(parseVelocityConfig(undefined, undefined)).toEqual(DEFAULT_VELOCITY_CONFIG);
    expect(parseVelocityConfig('abc', '-5')).toEqual(DEFAULT_VELOCITY_CONFIG);
  });

  it('parses numeric strings', () => {
    expect(parseVelocityConfig('30', '10')).toEqual({ windowSeconds: 30, maxClicks: 10 });
  });
});
