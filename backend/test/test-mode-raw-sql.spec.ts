import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The report layer filters test rows through buildClickWhere /
 * applyConversionCountFilter. Three report paths drop to raw SQL and are
 * therefore invisible to those helpers — the filter has to be restated inside
 * the query, and nothing but this fence stops someone from deleting it.
 *
 * A silent regression here is the bad kind: the chart quietly starts counting
 * rehearsal traffic while the table above it does not, and the two disagree by
 * an amount nobody can explain.
 */
const RAW_SQL_REPORTS = [
  {
    file: 'src/analytics/visit-stats.ts',
    predicates: ['is_test = false'],
  },
  {
    file: 'src/analytics/analytics.service.ts',
    predicates: ['c.is_test = false'],
  },
  {
    file: 'src/analytics/campaign-report.service.ts',
    predicates: ['is_test = false', 'cv.is_test = false'],
  },
];

describe('raw-SQL report queries exclude test rows', () => {
  it.each(RAW_SQL_REPORTS)('$file', ({ file, predicates }) => {
    const source = readFileSync(join(__dirname, '..', file), 'utf8');
    for (const predicate of predicates) {
      expect(source).toContain(predicate);
    }
  });
});
