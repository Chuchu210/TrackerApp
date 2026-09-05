import { Prisma } from '@prisma/client';
import { excludeTestRows } from '../shared/tracking/test-mode';

export { excludeTestRows, excludeTestRowsSql } from '../shared/tracking/test-mode';

export type VisitAnalyticsFilters = {
  campaignId?: string;
  from?: string;
  to?: string;
  publisher?: string;
  platform?: string;
  country?: string;
  device?: string;
  adId?: string;
  siteId?: string;
  contentName?: string;
  isBot?: boolean;
  isNewVisitor?: boolean;
  excludeBots?: boolean;
  /**
   * Opt in to test rows. Absent or false means reports read real traffic only,
   * which is the whole point of test mode — the safe state must be the one you
   * get by forgetting to pass anything.
   */
  includeTest?: boolean;
};

export function buildClickWhere(filters: VisitAnalyticsFilters): Prisma.ClickWhereInput {
  const where: Prisma.ClickWhereInput = { ...excludeTestRows(filters) };

  if (filters.campaignId) where.campaignId = filters.campaignId;
  if (filters.publisher) {
    where.publisherName = { contains: filters.publisher, mode: 'insensitive' };
  }
  if (filters.platform) where.platform = { equals: filters.platform, mode: 'insensitive' };
  if (filters.device) where.device = filters.device;
  if (filters.country) where.countryCode = filters.country;
  if (filters.adId) where.adId = { contains: filters.adId, mode: 'insensitive' };
  if (filters.siteId) where.siteId = { contains: filters.siteId, mode: 'insensitive' };
  if (filters.contentName) {
    where.contentName = { contains: filters.contentName, mode: 'insensitive' };
  }
  if (filters.excludeBots) {
    where.isBot = false;
  } else if (filters.isBot !== undefined) {
    where.isBot = filters.isBot;
  }
  if (filters.isNewVisitor !== undefined) where.isNewVisitor = filters.isNewVisitor;

  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: new Date(filters.from) } : {}),
      ...(filters.to ? { lte: new Date(filters.to) } : {}),
    };
  }

  return where;
}

export type VisitBreakdownDimension =
  | 'publisher'
  | 'ad'
  | 'site'
  | 'content'
  | 'platform'
  | 'country'
  | 'device'
  | 'campaign';
