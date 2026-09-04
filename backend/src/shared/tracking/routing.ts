/** Visitor signals a path rule can target. */
export interface RoutingContext {
  country?: string | null;
  device?: string | null;
  os?: string | null;
  browser?: string | null;
  connectionType?: string | null;
}

export type PathDimension = 'country' | 'device' | 'os' | 'browser' | 'connectionType';
export type PathOperator = 'in' | 'not_in';

export interface PathCondition {
  dimension: PathDimension;
  operator: PathOperator;
  values: string[];
}

export interface RoutableVariant {
  id: string;
  destinationUrl: string;
  weight: number;
  active: boolean;
  label?: string;
  /** Set when the variant points at a catalog offer rather than a bare URL. */
  offerId?: string | null;
  offerName?: string | null;
}

export interface RoutablePath {
  id: string;
  weight: number;
  active: boolean;
  conditions: PathCondition[];
  destinationUrl?: string | null;
  variants: RoutableVariant[];
}

export interface RoutingDecision {
  destination: string;
  pathId?: string;
  variantId?: string;
  variantLabel?: string;
  /** Offer that served the click, when the chosen variant references one. */
  offerId?: string | null;
  offerName?: string | null;
}

type Rng = () => number;

function ctxValue(ctx: RoutingContext, dim: PathDimension): string | undefined {
  const v = ctx[dim];
  return v == null ? undefined : String(v).toLowerCase();
}

/** All conditions must pass for the path to be eligible. */
export function evaluateConditions(
  conditions: PathCondition[],
  ctx: RoutingContext,
): boolean {
  if (!conditions || conditions.length === 0) return true;

  return conditions.every((cond) => {
    const value = ctxValue(ctx, cond.dimension);
    const set = (cond.values || []).map((v) => v.toLowerCase());
    const contained = value != null && set.includes(value);
    return cond.operator === 'not_in' ? !contained : contained;
  });
}

/** Weighted random pick among items with positive weight. Returns null if none. */
export function pickWeighted<T extends { weight: number }>(
  items: T[],
  rng: Rng = Math.random,
): T | null {
  const pool = items.filter((i) => i.weight > 0);
  if (pool.length === 0) return null;
  const total = pool.reduce((sum, i) => sum + i.weight, 0);
  let target = rng() * total;
  for (const item of pool) {
    target -= item.weight;
    if (target < 0) return item;
  }
  return pool[pool.length - 1];
}

/**
 * Select a path for this visitor. Rule-targeted paths whose conditions match
 * take precedence; if any match, the weighted pick is made among them.
 * Otherwise the pick is made among the default (condition-less) paths.
 */
export function selectPath(
  paths: RoutablePath[],
  ctx: RoutingContext,
  rng: Rng = Math.random,
): RoutablePath | null {
  const active = paths.filter((p) => p.active);
  if (active.length === 0) return null;

  const targeted = active.filter(
    (p) => p.conditions?.length > 0 && evaluateConditions(p.conditions, ctx),
  );
  const defaults = active.filter((p) => !p.conditions || p.conditions.length === 0);

  const pool = targeted.length > 0 ? targeted : defaults;
  return pickWeighted(pool, rng);
}

/** Weighted rotation among a path's active variants. */
export function selectVariant(
  variants: RoutableVariant[],
  rng: Rng = Math.random,
): RoutableVariant | null {
  return pickWeighted(
    variants.filter((v) => v.active),
    rng,
  );
}

/**
 * Full routing decision for a click. Falls back through variant → path →
 * campaign destination so a campaign with no paths behaves exactly as before.
 */
export function resolveRouting(
  campaignDestination: string,
  paths: RoutablePath[],
  ctx: RoutingContext,
  rng: Rng = Math.random,
): RoutingDecision {
  const path = selectPath(paths, ctx, rng);
  if (!path) return { destination: campaignDestination };

  const variant = selectVariant(path.variants, rng);
  const destination =
    variant?.destinationUrl || path.destinationUrl || campaignDestination;

  return {
    destination,
    pathId: path.id,
    variantId: variant?.id,
    variantLabel: variant?.label,
    offerId: variant?.offerId ?? null,
    offerName: variant?.offerName ?? null,
  };
}
