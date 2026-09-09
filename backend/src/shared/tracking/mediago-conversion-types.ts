import { normalizeEventType } from '../../common/utils/normalize-event-type';

/** Mediago Table 1.1 — Conversion Type Map */
export const MEDIAGO_CONVERSION_TYPE_TABLE = [
  { code: 1, label: 'View Content', slugs: ['viewcontent', 'view_content'] },
  { code: 2, label: 'App Install', slugs: ['app_install'] },
  { code: 3, label: 'Complete Registration', slugs: ['complete_registration', 'registration'] },
  { code: 4, label: 'Add to Cart', slugs: ['add_to_cart'] },
  { code: 5, label: 'Add Payment Info', slugs: ['add_payment_info'] },
  { code: 6, label: 'Search', slugs: ['search'] },
  { code: 7, label: 'Start Checkout', slugs: ['start_checkout'] },
  { code: 8, label: 'Purchase', slugs: ['purchase', 'sale', 'sales'] },
  { code: 9, label: 'Add to Wishlist', slugs: ['add_to_wishlist'] },
  { code: 10, label: 'Lead', slugs: ['lead', 'postalcode'] },
  { code: 12, label: 'Click Button', slugs: ['click_button', 'clickbutton', 'call_click', 'call_started', 'quiz_started'] },
  { code: 13, label: 'Lead Qualified', slugs: ['lead_qualified', 'age_60', 'hearing_loss'] },
  { code: 14, label: 'Call Connected', slugs: ['call_connected', 'callconnected'] },
  { code: 15, label: 'Appointment Booked', slugs: ['appointment_booked'] },
  { code: 16, label: 'Application Started', slugs: ['application_started', 'account_opening'] },
  { code: 17, label: 'Application Approved', slugs: ['application_approved', 'account_validated'] },
  { code: 18, label: 'Account Created', slugs: ['account_created'] },
  { code: 19, label: 'Deal Completed', slugs: ['deal_completed'] },
] as const;

export const MEDIAGO_CONVERSION_TYPE_BY_SLUG: Record<string, number> = {};
for (const row of MEDIAGO_CONVERSION_TYPE_TABLE) {
  for (const slug of row.slugs) {
    MEDIAGO_CONVERSION_TYPE_BY_SLUG[slug] = row.code;
  }
}

/** Resolve Mediago `conversiontype` from conversion event slug (or numeric et=). */
export function resolveMediagoConversionType(
  eventType: string | null | undefined,
  fallback = 10,
): number {
  if (!eventType?.trim()) return fallback;
  const raw = eventType.trim();
  if (/^\d+$/.test(raw)) {
    const code = parseInt(raw, 10);
    return Number.isFinite(code) ? code : fallback;
  }
  const slug = normalizeEventType(raw);
  return MEDIAGO_CONVERSION_TYPE_BY_SLUG[slug] ?? fallback;
}

export function isMediagoTrafficSource(utmSource?: string | null): boolean {
  const src = (utmSource || '').trim().toLowerCase();
  return (
    src === 'mediago' ||
    src === 'mg' ||
    src === 'media go' ||
    src.includes('mediago')
  );
}

/** Read utm_source from query regardless of param casing (UTM_SOURCE, utm_Source, …). */
export function getUtmSourceFromQuery(
  query: Record<string, string | string[] | undefined>,
): string {
  for (const [key, val] of Object.entries(query)) {
    if (key.toLowerCase() === 'utm_source') {
      const v = Array.isArray(val) ? val[0] : val;
      return (v || '').trim();
    }
  }
  return '';
}
