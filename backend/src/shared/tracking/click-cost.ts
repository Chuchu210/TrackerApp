/** Query keys a traffic source may use to pass the paid cost of a click. */
export const DEFAULT_CLICK_COST_KEYS = [
  'cost',
  'bid',
  'cpc',
  'bid_price',
  'bidprice',
  'price',
  'click_cost',
  'clickcost',
];

function isUnreplacedMacro(value: string): boolean {
  return /^\$\{[^}]+\}$/.test(value.trim()) || /^\{[^}]+\}$/.test(value.trim());
}

/**
 * Extract the per-click cost from the incoming query using a list of candidate
 * keys. Returns null when absent, an unreplaced macro, or not a finite
 * non-negative number — so a bad value never records phantom spend.
 */
export function parseClickCost(
  query: Record<string, string | undefined>,
  keys: string[] = DEFAULT_CLICK_COST_KEYS,
): number | null {
  for (const key of keys) {
    const raw = query[key] ?? query[key.toLowerCase()];
    if (raw == null || raw === '') continue;
    if (isUnreplacedMacro(String(raw))) continue;
    const value = Number(String(raw).replace(',', '.'));
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

export function parseClickCostKeys(raw?: string | null): string[] {
  if (!raw) return DEFAULT_CLICK_COST_KEYS;
  const keys = raw
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return keys.length > 0 ? keys : DEFAULT_CLICK_COST_KEYS;
}
