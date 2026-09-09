/**
 * Per-question quiz events go to Meta as standard Pixel events (AddToCart /
 * InitiateCheckout). They must not hit Mediago: unresolved slugs fall back to
 * conversion type 10 (Lead) and would poison bidding.
 */
const FACEBOOK_ONLY_EVENT = /^(quiz_q\d+|quiz_question_\d+)$/;

export function shouldFireNetworkPostback(
  eventType: string | null | undefined,
  network?: string,
): boolean {
  const slug = (eventType || '').trim().toLowerCase();
  if (!slug) return true;
  if (FACEBOOK_ONLY_EVENT.test(slug)) {
    return !network || network === 'facebook';
  }
  return true;
}
