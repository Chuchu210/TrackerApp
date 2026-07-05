import {
  evaluateConditions,
  pickWeighted,
  selectPath,
  selectVariant,
  resolveRouting,
  type RoutablePath,
  type RoutableVariant,
} from '../src/shared/tracking/routing';

describe('evaluateConditions', () => {
  const ctx = { country: 'US', device: 'mobile', os: 'iOS' };

  it('matches when all conditions pass (case-insensitive)', () => {
    expect(
      evaluateConditions(
        [{ dimension: 'country', operator: 'in', values: ['us', 'ca'] }],
        ctx,
      ),
    ).toBe(true);
  });

  it('fails when any condition fails', () => {
    expect(
      evaluateConditions(
        [
          { dimension: 'country', operator: 'in', values: ['US'] },
          { dimension: 'device', operator: 'in', values: ['desktop'] },
        ],
        ctx,
      ),
    ).toBe(false);
  });

  it('handles not_in', () => {
    expect(
      evaluateConditions([{ dimension: 'country', operator: 'not_in', values: ['CA'] }], ctx),
    ).toBe(true);
    expect(
      evaluateConditions([{ dimension: 'country', operator: 'not_in', values: ['US'] }], ctx),
    ).toBe(false);
  });

  it('empty conditions always match', () => {
    expect(evaluateConditions([], ctx)).toBe(true);
  });

  it('missing context value: in fails, not_in passes', () => {
    expect(evaluateConditions([{ dimension: 'browser', operator: 'in', values: ['chrome'] }], ctx)).toBe(false);
    expect(evaluateConditions([{ dimension: 'browser', operator: 'not_in', values: ['chrome'] }], ctx)).toBe(true);
  });
});

describe('pickWeighted', () => {
  it('is deterministic with an injected rng', () => {
    const items = [
      { id: 'a', weight: 30 },
      { id: 'b', weight: 70 },
    ];
    expect(pickWeighted(items, () => 0.0)?.id).toBe('a'); // first 30%
    expect(pickWeighted(items, () => 0.5)?.id).toBe('b'); // into the 70% band
    expect(pickWeighted(items, () => 0.99)?.id).toBe('b');
  });

  it('ignores zero-weight items and returns null when none', () => {
    expect(pickWeighted([{ id: 'a', weight: 0 }], () => 0.5)).toBeNull();
  });
});

describe('selectPath', () => {
  const mkPath = (over: Partial<RoutablePath>): RoutablePath => ({
    id: 'p',
    weight: 100,
    active: true,
    conditions: [],
    variants: [],
    ...over,
  });

  it('prefers a targeted path whose conditions match over the default', () => {
    const targeted = mkPath({
      id: 'targeted',
      conditions: [{ dimension: 'country', operator: 'in', values: ['US'] }],
    });
    const fallback = mkPath({ id: 'default' });
    const chosen = selectPath([targeted, fallback], { country: 'US' }, () => 0.5);
    expect(chosen?.id).toBe('targeted');
  });

  it('falls back to default paths when no targeted path matches', () => {
    const targeted = mkPath({
      id: 'targeted',
      conditions: [{ dimension: 'country', operator: 'in', values: ['CA'] }],
    });
    const fallback = mkPath({ id: 'default' });
    const chosen = selectPath([targeted, fallback], { country: 'US' }, () => 0.5);
    expect(chosen?.id).toBe('default');
  });

  it('ignores inactive paths and returns null when nothing eligible', () => {
    expect(selectPath([mkPath({ active: false })], {}, () => 0.5)).toBeNull();
  });
});

describe('selectVariant', () => {
  const variants: RoutableVariant[] = [
    { id: 'v1', destinationUrl: 'https://a', weight: 50, active: true },
    { id: 'v2', destinationUrl: 'https://b', weight: 50, active: false },
  ];
  it('only rotates active variants', () => {
    expect(selectVariant(variants, () => 0.99)?.id).toBe('v1');
  });
});

describe('resolveRouting', () => {
  it('falls back to the campaign destination when no paths', () => {
    const decision = resolveRouting('https://camp-dest', [], {}, () => 0.5);
    expect(decision).toEqual({ destination: 'https://camp-dest' });
  });

  it('routes to a variant destination and records ids', () => {
    const path: RoutablePath = {
      id: 'path1',
      weight: 100,
      active: true,
      conditions: [{ dimension: 'country', operator: 'in', values: ['US'] }],
      destinationUrl: 'https://path-dest',
      variants: [
        { id: 'var1', destinationUrl: 'https://offer-a', weight: 100, active: true },
      ],
    };
    const decision = resolveRouting('https://camp-dest', [path], { country: 'US' }, () => 0.5);
    expect(decision.destination).toBe('https://offer-a');
    expect(decision.pathId).toBe('path1');
    expect(decision.variantId).toBe('var1');
  });

  it('uses the path destination when the path has no variants', () => {
    const path: RoutablePath = {
      id: 'path1',
      weight: 100,
      active: true,
      conditions: [],
      destinationUrl: 'https://path-dest',
      variants: [],
    };
    const decision = resolveRouting('https://camp-dest', [path], {}, () => 0.5);
    expect(decision.destination).toBe('https://path-dest');
    expect(decision.variantId).toBeUndefined();
  });
});
