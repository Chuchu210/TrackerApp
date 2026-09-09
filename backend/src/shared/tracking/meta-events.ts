/**
 * Meta CAPI event names.
 *
 * Standard Pixel events are used ONLY when the action is that event.
 * A wrong standard name trains Advantage+ on the wrong signal (quiz ≠ cart,
 * quiz start ≠ application submit, call tap ≠ Schedule).
 *
 * Everything else is a named custom event — specific, not a near-match.
 *
 *   LP load          → PageView          (standard)
 *   Quiz started     → QuizStarted       (custom)
 *   Question 2 / 3   → QuizQuestion2/3   (custom)
 *   Call tap         → CallStarted       (custom, pay-per-call)
 *   Call connected   → CallConnected     (custom)
 *   Form submit      → Lead              (standard)
 *
 * Reference: https://developers.facebook.com/docs/meta-pixel/reference
 */
const META_EVENT_MAP: Record<string, string> = {
  // Real page load — this slug is historical; the action is PageView, not Meta's ViewContent.
  viewcontent: 'PageView',
  view_content: 'PageView',
  pageview: 'PageView',

  quiz_started: 'QuizStarted',
  quiz_q1: 'QuizStarted',
  quiz_q2: 'QuizQuestion2',
  quiz_q3: 'QuizQuestion3',

  click_button: 'ClickButton',

  call_click: 'CallStarted',
  call_started: 'CallStarted',
  call_connected: 'CallConnected',

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

export function metaEventNameForEventType(eventType: string): string {
  const mapped = META_EVENT_MAP[eventType.toLowerCase()];
  if (mapped) return mapped;
  return eventType
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('');
}
