/**
 * Report timezone handling. Stored timestamps are UTC (timestamp without time
 * zone). To bucket by a viewer's local day/hour we reinterpret as UTC then
 * convert to the target zone: `created_at AT TIME ZONE 'UTC' AT TIME ZONE tz`.
 * With tz = 'UTC' this is identity, so the default preserves legacy behavior.
 */

// Conservative IANA-name allowlist pattern; blocks SQL injection into the
// AT TIME ZONE clause since the zone is interpolated as a string literal.
const IANA_TZ_PATTERN = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/;

export const DEFAULT_REPORT_TIMEZONE = 'UTC';

/** Validate and normalize a requested timezone, falling back to a default. */
export function resolveReportTimezone(
  requested?: string | null,
  fallback: string = DEFAULT_REPORT_TIMEZONE,
): string {
  const candidate = (requested || fallback || DEFAULT_REPORT_TIMEZONE).trim();
  if (candidate.toUpperCase() === 'UTC') return 'UTC';
  return IANA_TZ_PATTERN.test(candidate) ? candidate : DEFAULT_REPORT_TIMEZONE;
}
