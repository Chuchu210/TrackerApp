import { normalizeEventType } from '../../common/utils/normalize-event-type';

/**
 * Buyer outcome postbacks for RTB and pay-per-accepted-lead offers.
 *
 * The buyer tells us, per lead, whether it took it and what it bid. Those
 * outcomes are their own event types instead of `et=lead&payout=…`, because
 * conversions are unique per (clickId, eventType): once the landing page had
 * recorded `lead`, a buyer postback with the same type was answered as a
 * duplicate and the winning bid was silently lost.
 *
 *   lead_sold      buyer took the lead; payout = winning bid
 *   lead_rejected  buyer refused it; no revenue
 *   lead_returned  buyer returned a lead it had bought; cancels the sale in reporting
 *
 * Outcomes arrive late (hours to days after the click) and only from the
 * buyer's server, so they bypass the attribution window and the per-click cap,
 * and the public browser endpoint may not record them.
 */
export const LEAD_OUTCOME_EVENTS = ['lead_sold', 'lead_rejected', 'lead_returned'] as const;

export type LeadOutcomeEvent = (typeof LEAD_OUTCOME_EVENTS)[number];

export function isLeadOutcomeEvent(eventType?: string | null): boolean {
  // Même normalisation que l'enregistrement (normalizeEventType) : « lead_sold. », « lead sold » ou un caractère
  // invisible sont des issues acheteur, pas des événements publics.
  if (!eventType?.trim()) return false;
  const slug = normalizeEventType(eventType);
  return (LEAD_OUTCOME_EVENTS as readonly string[]).includes(slug);
}

/**
 * GET templates to hand to a buyer, one per outcome, on this campaign's tracking domain. Outcomes are refused
 * without authentication, so the campaign's postback secret is included (a placeholder when none is set yet).
 */
export function buildLeadOutcomeUrls(
  trackerBase: string,
  postbackSecret?: string | null,
): Record<'sold' | 'rejected' | 'returned', string> {
  const secret = postbackSecret ? encodeURIComponent(postbackSecret) : '{postback_secret}';
  const base = `${trackerBase}/postback?cid={click_id}&secret=${secret}`;
  return {
    sold: `${base}&et=lead_sold&payout={bid}&currency={currency}&txid={transaction_id}`,
    rejected: `${base}&et=lead_rejected&txid={transaction_id}`,
    returned: `${base}&et=lead_returned&txid={transaction_id}`,
  };
}
