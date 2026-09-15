/**
 * Quiz steps are named custom events on Meta (QuizStarted / QuizQuestion2…).
 * They must not go to Mediago: unmapped slugs fall back to type 10 (Lead).
 *
 * Buyer outcomes follow the same logic: `lead_sold` is a Purchase with the real
 * bid on Meta, but on Mediago it would fall back to a second Lead. Refusals and
 * returns are bookkeeping for our own revenue and go to no network at all.
 */
const FACEBOOK_ONLY_EVENT = /^(quiz_started|quiz_q\d+|quiz_question_\d+|lead_sold)$/;
const NEVER_FORWARDED_EVENT = /^(lead_rejected|lead_returned)$/;

export function shouldFireNetworkPostback(
  eventType: string | null | undefined,
  network?: string,
): boolean {
  const slug = (eventType || '').trim().toLowerCase();
  if (!slug) return true;
  if (NEVER_FORWARDED_EVENT.test(slug)) return false;
  if (FACEBOOK_ONLY_EVENT.test(slug)) {
    return !network || network === 'facebook';
  }
  return true;
}
