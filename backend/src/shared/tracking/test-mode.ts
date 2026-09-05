/**
 * Test mode: while the global switch is on, ingestion stamps `isTest` on every
 * click and conversion it writes, and reports leave those rows out.
 *
 * The rule that makes this trustworthy is the default: a query that says
 * nothing about test rows gets real traffic only. Forgetting the filter can
 * therefore hide test data from a report, but it can never leak test data into
 * one — and a missing number gets noticed, a slightly inflated one does not.
 */

export type TestModeFilter = {
  /** Opt in to test rows. Absent or false means real traffic only. */
  includeTest?: boolean;
};

/**
 * Spreadable Prisma clause. Both Click and Conversion carry `isTest`, so the
 * same helper serves either model:
 *
 *   where: { ...myWhere, ...excludeTestRows(filters) }
 */
export function excludeTestRows(filters: TestModeFilter): { isTest?: false } {
  return filters.includeTest ? {} : { isTest: false };
}

/**
 * SQL counterpart for the report queries that drop to raw SQL, where the
 * Prisma clause cannot reach. `alias` is the table alias carrying `is_test`.
 */
export function excludeTestRowsSql(filters: TestModeFilter, alias: string): string {
  return filters.includeTest ? '' : ` AND "${alias}"."is_test" = false`;
}

/** Parse the `includeTest` query-string flag from an admin request. */
export function parseIncludeTest(value: unknown): boolean {
  return value === true || value === 'true' || value === '1';
}
