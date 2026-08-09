/**
 * Maps our internal conversion eventType slugs (see lp-funnel.ts) to Meta
 * Conversions API standard event names, so FacebookStrategy reports the
 * actual event instead of a fixed value. Unmapped slugs fall back to a
 * PascalCase custom event name, which Meta CAPI accepts as a custom event.
 *
 * Reference: https://developers.facebook.com/docs/meta-pixel/reference
 */
const META_STANDARD_EVENT_MAP: Record<string, string> = {
  // Fired automatically on LP page load (see auto-view-content.ts) — the
  // base "the page was viewed" signal Meta expects as PageView.
  viewcontent: 'PageView',
  view_content: 'PageView',
  click_button: 'Lead',
  call_click: 'Contact',
  call_connected: 'Contact',
  lead: 'Lead',
  postalcode: 'Lead',
  lead_qualified: 'Lead',
  account_opening: 'SubmitApplication',
  application_started: 'SubmitApplication',
  account_validated: 'CompleteRegistration',
  application_approved: 'CompleteRegistration',
  purchase: 'Purchase',
  sale: 'Purchase',
  sales: 'Purchase',
};

export function metaEventNameForEventType(eventType: string): string {
  const mapped = META_STANDARD_EVENT_MAP[eventType.toLowerCase()];
  if (mapped) return mapped;
  // Fallback: turn an unknown slug like "custom_thing" into "CustomThing"
  // so CAPI still accepts it as a named custom event.
  return eventType
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('');
}
