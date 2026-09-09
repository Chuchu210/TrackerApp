import { isMediagoTrafficSource } from './mediago-conversion-types';

/** Campaigns that skip the automatic PageView. Empty: every LP sends pageview first. */
export const SKIP_AUTO_VIEW_CONTENT_SLUGS = new Set<string>();

export function shouldSendAutoViewContent(campaignSlug: string): boolean {
  return !SKIP_AUTO_VIEW_CONTENT_SLUGS.has(campaignSlug);
}

export function isFacebookTrafficSource(utmSource?: string | null): boolean {
  const src = (utmSource || '').trim().toLowerCase();
  return (
    src === 'fb' ||
    src === 'meta' ||
    src.includes('facebook') ||
    src.includes('instagram')
  );
}

/**
 * Which traffic sources get an automatic `viewcontent` on visit.
 *
 * This used to be Mediago-only, in both the browser script and the server, so a
 * Facebook campaign never produced the first funnel step — LP arrivals had no
 * View Content, and Meta's CAPI never received the matching PageView. Meta gets
 * the same treatment as Mediago now; other networks keep the previous behaviour
 * so their postbacks are unaffected.
 */
export function wantsAutoViewContent(
  utmSource?: string | null,
  trafficSource?: string | null,
): boolean {
  const source = (trafficSource || '').trim().toLowerCase();
  return (
    isMediagoTrafficSource(utmSource) ||
    source === 'mediago' ||
    isFacebookTrafficSource(utmSource) ||
    source === 'facebook'
  );
}
