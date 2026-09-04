/**
 * Maps our internal conversion eventType slugs (see lp-funnel.ts) to the
 * OpenAI Ads Conversions API event taxonomy.
 *
 * Each event carries a `type` (the standard event name) and a `data.type`
 * discriminator that must match the event's group, otherwise the whole batch
 * is rejected:
 *   - contents         -> page_viewed, contents_viewed, items_added,
 *                         checkout_started, order_created
 *   - customer_action  -> lead_created, registration_completed,
 *                         appointment_scheduled
 *   - plan_enrollment  -> subscription_created, trial_started
 *   - custom           -> custom (requires custom_event_name)
 *
 * Reference: https://developers.openai.com/ads/conversions-api
 */
export type OpenAiDataType =
  | 'contents'
  | 'customer_action'
  | 'plan_enrollment'
  | 'custom';

export type OpenAiEvent = {
  /** Standard event name, or 'custom'. */
  type: string;
  /** Discriminator for the event's `data` object. */
  dataType: OpenAiDataType;
  /** Only set when type === 'custom'. */
  customEventName?: string;
};

const STANDARD: Record<string, { type: string; dataType: OpenAiDataType }> = {
  // Auto-fired on LP page load (see auto-view-content.ts).
  viewcontent: { type: 'page_viewed', dataType: 'contents' },
  view_content: { type: 'page_viewed', dataType: 'contents' },
  lead: { type: 'lead_created', dataType: 'customer_action' },
  postalcode: { type: 'lead_created', dataType: 'customer_action' },
  account_opening: {
    type: 'registration_completed',
    dataType: 'customer_action',
  },
  application_started: {
    type: 'registration_completed',
    dataType: 'customer_action',
  },
  purchase: { type: 'order_created', dataType: 'contents' },
  sale: { type: 'order_created', dataType: 'contents' },
  sales: { type: 'order_created', dataType: 'contents' },
};

/**
 * Slugs deliberately sent as custom events: the funnel steps below have no
 * honest equivalent in the standard taxonomy, and mis-mapping them (e.g.
 * call_connected -> appointment_scheduled) would distort reporting and
 * bid optimisation. Custom events are first-class for optimisation.
 */
const CUSTOM_EVENT_SLUGS = new Set([
  'click_button',
  'call_click',
  'call_connected',
  'lead_qualified',
  'account_validated',
  'application_approved',
]);

/** custom_event_name must be 1-64 chars of alphanumerics/underscore/hyphen. */
export function sanitizeCustomEventName(slug: string): string {
  const cleaned = slug.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  return cleaned.length > 0 ? cleaned : 'custom_event';
}

export function openAiEventForEventType(eventType: string): OpenAiEvent {
  const slug = eventType.toLowerCase();

  const standard = STANDARD[slug];
  if (standard && !CUSTOM_EVENT_SLUGS.has(slug)) {
    return { type: standard.type, dataType: standard.dataType };
  }

  return {
    type: 'custom',
    dataType: 'custom',
    customEventName: sanitizeCustomEventName(slug),
  };
}
