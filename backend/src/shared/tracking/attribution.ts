export interface AttributionSettings {
  attributionWindowHours?: number | null;
  maxConversionsPerClick?: number | null;
}

/**
 * A conversion is in-window when no window is configured, or when it lands
 * within `attributionWindowHours` of the originating click.
 */
export function isWithinAttributionWindow(
  clickCreatedAt: Date,
  now: Date,
  windowHours?: number | null,
): boolean {
  if (windowHours == null || windowHours <= 0) return true;
  const elapsedMs = now.getTime() - clickCreatedAt.getTime();
  if (elapsedMs < 0) return true; // clock skew — don't penalize
  return elapsedMs <= windowHours * 60 * 60 * 1000;
}

/**
 * The per-click conversion cap is reached when a positive cap is configured and
 * the click already has at least that many conversions.
 */
export function isConversionCapReached(
  existingCount: number,
  cap?: number | null,
): boolean {
  if (cap == null || cap <= 0) return false;
  return existingCount >= cap;
}
