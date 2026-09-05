import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type VisitStats = {
  visits: number;
  uniqueVisits: number;
  newVisitors: number;
  returningVisitors: number;
};

function resolveDateRange(from?: string, to?: string) {
  const toDate = to ? new Date(to) : new Date();
  const fromDate = from
    ? new Date(from)
    : new Date(toDate.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { fromDate, toDate };
}

export async function getVisitStats(
  prisma: PrismaService,
  campaignId?: string,
  from?: string,
  to?: string,
  excludeBots?: boolean,
  includeTest?: boolean,
): Promise<VisitStats> {
  const { fromDate, toDate } = resolveDateRange(from, to);

  const conditions: Prisma.Sql[] = [
    Prisma.sql`created_at >= ${fromDate}`,
    Prisma.sql`created_at <= ${toDate}`,
  ];
  if (campaignId) conditions.push(Prisma.sql`campaign_id = ${campaignId}`);
  if (excludeBots) conditions.push(Prisma.sql`is_bot = false`);
  // Default-deny, like every other report path: only an explicit opt-in shows
  // rows recorded while test mode was on.
  if (!includeTest) conditions.push(Prisma.sql`is_test = false`);

  const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

  const [row] = await prisma.$queryRaw<
    [{ visits: number; new_visitors: number; unique_visits: number }]
  >`
    SELECT
      COUNT(*)::int AS visits,
      COUNT(*) FILTER (WHERE is_new_visitor)::int AS new_visitors,
      COUNT(DISTINCT COALESCE(visitor_id, id::text))::int AS unique_visits
    FROM clicks
    ${whereClause}
  `;

  const visits = row?.visits ?? 0;
  const newVisitors = row?.new_visitors ?? 0;
  const uniqueVisits = row?.unique_visits ?? 0;
  const returningVisitors = Math.max(0, visits - newVisitors);

  return { visits, uniqueVisits, newVisitors, returningVisitors };
}
