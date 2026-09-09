/**
 * Quiz steps are named custom events on Meta (QuizStarted / QuizQuestion2…).
 * They must not go to Mediago: unmapped slugs fall back to type 10 (Lead).
 */
const FACEBOOK_ONLY_EVENT = /^(quiz_started|quiz_q\d+|quiz_question_\d+)$/;

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
