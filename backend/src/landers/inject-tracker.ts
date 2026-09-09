import { shouldSendAutoViewContent } from '../shared/tracking/auto-view-content';
import type { TrackerScriptService } from '../tracker-script/tracker-script.service';
import { TrackingMode } from '@prisma/client';

export function buildTrackerScriptTag(
  trackerScript: TrackerScriptService,
  campaign: {
    slug: string;
    externalId?: string | null;
    trackingMode?: TrackingMode;
  },
  trackerBase: string,
  injectTracker: boolean,
  trackerAttrs?: { noViewContent?: boolean } | null,
  lander?: { slug?: string; name?: string } | null,
): string | null {
  if (!injectTracker) return null;

  const campaignRef = campaign.externalId || campaign.slug;
  const mode = campaign.trackingMode === TrackingMode.direct ? 'direct' : 'redirect';
  const noViewContent =
    trackerAttrs?.noViewContent === true ||
    (trackerAttrs?.noViewContent !== false && !shouldSendAutoViewContent(campaign.slug));

  return trackerScript.getLpScriptSnippet(campaignRef, mode, trackerBase, {
    noViewContent,
    lpId: lander?.slug,
    lpName: lander?.name,
  });
}

export function injectTrackerIntoHtml(html: string, scriptTag: string): string {
  if (!scriptTag) return html;
  if (/tracker\.js/i.test(html) || /tkCallback/i.test(html)) {
    return html;
  }

  const snippet = `\n${scriptTag}\n`;
  const headClose = html.search(/<\/head>/i);
  if (headClose >= 0) {
    return html.slice(0, headClose) + snippet + html.slice(headClose);
  }

  const htmlOpen = html.search(/<html[^>]*>/i);
  if (htmlOpen >= 0) {
    const insertAt = html.indexOf('>', htmlOpen) + 1;
    return html.slice(0, insertAt) + snippet + html.slice(insertAt);
  }

  return snippet + html;
}
