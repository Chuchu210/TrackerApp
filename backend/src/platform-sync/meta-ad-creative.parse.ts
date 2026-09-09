export type ParsedMetaAdCreative = {
  adId: string;
  adName?: string;
  headline?: string;
  body?: string;
  cta?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  lastError?: string;
  raw?: unknown;
};

type GraphError = { message?: string; code?: number };
type GraphTextAsset = { text?: string };
type GraphImageAsset = { url?: string; hash?: string };
type GraphLinkData = {
  name?: string;
  message?: string;
  picture?: string;
  call_to_action?: { type?: string };
};
type GraphCreative = {
  id?: string;
  name?: string;
  title?: string;
  body?: string;
  image_url?: string;
  thumbnail_url?: string;
  call_to_action_type?: string;
  object_story_spec?: { link_data?: GraphLinkData };
  asset_feed_spec?: {
    titles?: GraphTextAsset[];
    bodies?: GraphTextAsset[];
    images?: GraphImageAsset[];
    call_to_action_types?: string[];
  };
};
type GraphAd = {
  id?: string;
  name?: string;
  creative?: GraphCreative;
  error?: GraphError;
};

function firstText(items?: GraphTextAsset[]): string | undefined {
  const text = items?.find((item) => item.text?.trim())?.text?.trim();
  return text || undefined;
}

function humanizeCta(raw?: string): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  return value
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function pick(...values: Array<string | undefined | null>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

export function parseMetaAdCreative(adId: string, payload: unknown): ParsedMetaAdCreative {
  const ad = (payload || {}) as GraphAd;
  if (ad.error?.message) {
    return { adId, lastError: ad.error.message, raw: payload };
  }

  const creative = ad.creative || {};
  const link = creative.object_story_spec?.link_data;
  const feed = creative.asset_feed_spec;
  const headline = pick(creative.title, link?.name, firstText(feed?.titles));
  const body = pick(creative.body, link?.message, firstText(feed?.bodies));
  const cta = humanizeCta(
    pick(creative.call_to_action_type, link?.call_to_action?.type, feed?.call_to_action_types?.[0]),
  );
  const imageUrl = pick(creative.image_url, link?.picture, feed?.images?.[0]?.url);
  const thumbnailUrl = pick(creative.thumbnail_url, imageUrl);

  return {
    adId,
    adName: pick(ad.name, creative.name),
    headline,
    body,
    cta,
    imageUrl,
    thumbnailUrl,
    raw: payload,
  };
}

export function parseMetaAdCreativeBatch(
  payload: unknown,
): ParsedMetaAdCreative[] {
  if (!payload || typeof payload !== 'object') return [];
  const rows: ParsedMetaAdCreative[] = [];
  for (const [adId, value] of Object.entries(payload as Record<string, unknown>)) {
    if (adId === 'error' || adId === 'paging') continue;
    rows.push(parseMetaAdCreative(adId, value));
  }
  return rows;
}
