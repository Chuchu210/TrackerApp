/**
 * Maps internal conversion slugs to Meta *standard* Pixel events.
 * Custom events are weakly trained by Advantage+; this funnel stays on
 * the events Meta actually optimises for.
 *
 *   LP load        → PageView
 *   Quiz Q1        → ViewContent
 *   Quiz Q2        → AddToCart
 *   Quiz Q3        → InitiateCheckout
 *   Call tap       → Contact
 *   Call connected → Schedule
 *   Form submit    → Lead
 *
 * Reference: https://developers.facebook.com/docs/meta-pixel/reference
 */
const META_STANDARD_EVENT_MAP: Record<string, string> = {
  viewcontent: 'PageView',
  view_content: 'PageView',
  pageview: 'PageView',
  quiz_started: 'ViewContent',
  quiz_q1: 'ViewContent',
  quiz_q2: 'AddToCart',
  quiz_q3: 'InitiateCheckout',
  click_button: 'ViewContent',
  call_click: 'Contact',
  call_started: 'Contact',
  call_connected: 'Schedule',
  lead: 'Lead',
  callback_request: 'Lead',
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

const STANDARD_META_EVENTS = new Set(Object.values(META_STANDARD_EVENT_MAP));

export function metaEventNameForEventType(eventType: string): string {
  const mapped = META_STANDARD_EVENT_MAP[eventType.toLowerCase()];
  if (mapped) return mapped;
  // Last resort only — Advantage+ largely ignores custom names.
  return eventType
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('');
}

export function isStandardMetaEvent(eventName: string): boolean {
  return STANDARD_META_EVENTS.has(eventName);
}
