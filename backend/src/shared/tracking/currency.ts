export interface FxConfig {
  /** ISO code all reporting is normalized to, e.g. "USD". */
  baseCurrency: string;
  /**
   * Rate map: how many units of the base currency one unit of `code` is worth.
   * e.g. { EUR: 1.08, GBP: 1.27 } when base is USD. The base currency itself
   * is always 1.
   */
  rates: Record<string, number>;
}

export const DEFAULT_FX_CONFIG: FxConfig = { baseCurrency: 'USD', rates: {} };

/**
 * Parse "EUR:1.08,GBP:1.27" into a rate map. Whitespace-tolerant; skips
 * malformed or non-positive entries.
 */
export function parseFxRates(raw?: string | null): Record<string, number> {
  const rates: Record<string, number> = {};
  if (!raw) return rates;
  for (const pair of raw.split(/[,\s]+/)) {
    if (!pair.includes(':')) continue;
    const [code, valueRaw] = pair.split(':');
    const value = Number(valueRaw);
    if (code && Number.isFinite(value) && value > 0) {
      rates[code.trim().toUpperCase()] = value;
    }
  }
  return rates;
}

export function buildFxConfig(baseCurrency?: string, ratesRaw?: string | null): FxConfig {
  return {
    baseCurrency: (baseCurrency || 'USD').trim().toUpperCase(),
    rates: parseFxRates(ratesRaw),
  };
}

/**
 * Convert `amount` in `currency` to the base currency. Unknown currencies (no
 * rate) are returned unchanged so money is never silently zeroed — callers can
 * treat a missing rate as "already base / unconvertible".
 */
export function normalizeToBase(
  amount: number,
  currency: string | null | undefined,
  config: FxConfig,
): number {
  if (!amount) return 0;
  const code = (currency || config.baseCurrency).trim().toUpperCase();
  if (code === config.baseCurrency) return amount;
  const rate = config.rates[code];
  if (!rate || rate <= 0) return amount;
  return amount * rate;
}
