import type { TrafficSource } from '@prisma/client';
import { Prisma } from '@prisma/client';

function firstQueryValue(
  query: Record<string, string | string[] | undefined>,
  key: string,
): string {
  const raw = query[key] ?? query[key.toLowerCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (value || '').trim();
}

export function inferTrafficSourceFromQuery(
  query: Record<string, string | string[] | undefined>,
): TrafficSource | null {
  const utm = firstQueryValue(query, 'utm_source').toLowerCase();
  const fbclid = firstQueryValue(query, 'fbclid');
  if (fbclid || utm === 'fb' || utm === 'meta' || utm.includes('facebook')) {
    return 'facebook';
  }
  if (utm === 'mg' || utm.includes('mediago')) return 'mediago';
  if (utm.includes('google') || firstQueryValue(query, 'gclid')) return 'google';
  if (utm.includes('outbrain')) return 'outbrain';
  return null;
}

export function destinationHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

export type CampaignSourcePick = {
  id: string;
  trafficSource: TrafficSource | string;
  destinationUrl: string;
  slug: string;
  name: string;
  externalId?: string | null;
};

/**
 * Direct LP traffic always posts data-campaign="lp1". Facebook ads on that
 * same page must land on the Facebook tracker campaign when one exists for
 * the same destination host.
 */
export function pickCampaignForInferredSource<T extends CampaignSourcePick>(
  fallback: T,
  inferred: TrafficSource | null,
  candidates: T[],
): T {
  if (!inferred || inferred === fallback.trafficSource || candidates.length === 0) {
    return fallback;
  }
  const host = destinationHost(fallback.destinationUrl);
  const sameHost = host
    ? candidates.filter((c) => destinationHost(c.destinationUrl) === host)
    : candidates;
  const pool = sameHost.length > 0 ? sameHost : candidates;
  if (pool.length === 1) return pool[0];
  return fallback;
}

export function facebookUtmOrClickIdWhere(): Prisma.ClickWhereInput {
  return {
    OR: [
      { utmSource: { equals: 'facebook', mode: 'insensitive' } },
      { utmSource: { equals: 'fb', mode: 'insensitive' } },
      { utmSource: { equals: 'meta', mode: 'insensitive' } },
      { utmSource: { contains: 'facebook', mode: 'insensitive' } },
      { fbclid: { not: null } },
    ],
  };
}

/**
 * Report visits for a tracker campaign, moving Facebook LP hits off a Mediago
 * sibling (same destination host) onto the unique Facebook campaign.
 */
export function attributedCampaignClickWhere(
  campaign: CampaignSourcePick,
  allCampaigns: CampaignSourcePick[],
  base: Prisma.ClickWhereInput,
): Prisma.ClickWhereInput {
  const host = destinationHost(campaign.destinationUrl);
  const siblings = allCampaigns.filter(
    (c) => !host || destinationHost(c.destinationUrl) === host,
  );
  const facebookSiblings = siblings.filter((c) => c.trafficSource === 'facebook');
  const donors = siblings.filter((c) => c.trafficSource !== 'facebook').map((c) => c.id);

  if (campaign.trafficSource === 'facebook' && facebookSiblings.length === 1 && donors.length > 0) {
    return {
      AND: [
        base,
        {
          OR: [
            { campaignId: campaign.id },
            { AND: [{ campaignId: { in: donors } }, facebookUtmOrClickIdWhere()] },
          ],
        },
      ],
    };
  }

  if (campaign.trafficSource !== 'facebook' && facebookSiblings.length === 1) {
    return {
      AND: [base, { campaignId: campaign.id, NOT: facebookUtmOrClickIdWhere() }],
    };
  }

  return { AND: [base, { campaignId: campaign.id }] };
}
