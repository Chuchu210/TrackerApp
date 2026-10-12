'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  Loading,
  PageHeader,
  Select,
  StatCard,
  TableHead,
  Td,
  Th,
  sectionHeadingClass,
  tableRowClass,
} from '@/components/ui';
import { DateRangePicker, buildPresets, type DateRange } from '@/components/DateRangePicker';
import { ExcludeBotsToggle } from '@/components/ExcludeBotsToggle';
import { trackerApi, formatApiError, type Campaign, type ProfitabilityReport } from '@/lib/api';

export default function InsightsPage() {
  const [range, setRange] = useState<DateRange>(buildPresets()[0]);
  const [campaignId, setCampaignId] = useState('');
  const [dimension, setDimension] = useState<'hour' | 'dow' | 'country' | 'device'>('hour');
  const [excludeBots, setExcludeBots] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [report, setReport] = useState<ProfitabilityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const params: Record<string, string> = {
      from: range.from,
      to: range.to,
      dimension,
      eventType: 'call_click',
      ...(excludeBots ? { excludeBots: 'true' } : {}),
      ...(campaignId ? { campaignId } : {}),
    };
    trackerApi
      .getProfitability(params)
      .then((data) => {
        setReport(data);
        setError(null);
      })
      .catch((err) => {
        console.error(err);
        setError(formatApiError(err));
      })
      .finally(() => setLoading(false));
  }, [range, campaignId, dimension, excludeBots]);

  useEffect(() => {
    trackerApi.getCampaigns().then(setCampaigns).catch(console.error);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !report) return <Loading label="Loading insights…" />;

  return (
    <div>
      <PageHeader
        title="Profitability Insights"
        description="Dayparting, geo, and device ROI — trim losing hours and segments."
      />

      <div className="mb-4 flex flex-wrap gap-3 items-center">
        <DateRangePicker value={range} onChange={setRange} />
        <ExcludeBotsToggle value={excludeBots} onChange={setExcludeBots} />
        <Button size="sm" variant="secondary" onClick={load}>Refresh</Button>
      </div>

      {error && (
        <div className="mb-6">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <FilterBar>
        <Select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className="min-w-[200px]">
          <option value="">All campaigns</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
        <Select value={dimension} onChange={(e) => setDimension(e.target.value as typeof dimension)}>
          <option value="hour">Hour of day</option>
          <option value="dow">Day of week</option>
          <option value="country">Country</option>
          <option value="device">Device</option>
        </Select>
      </FilterBar>

      {report && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <StatCard label="Visits" value={report.summary.totalVisits} />
          <StatCard label="Spend" value={`$${report.summary.totalSpend.toFixed(2)}`} />
          <StatCard label="Events" value={report.summary.totalEvents} />
        </div>
      )}

      <DataTable>
        <table className="w-full text-xs">
          <TableHead>
            <Th>Segment</Th>
            <Th>Visits</Th>
            <Th>Events</Th>
            <Th>CR %</Th>
            <Th>Spend</Th>
            <Th>Revenue</Th>
            <Th>Profit</Th>
            <Th>ROI %</Th>
          </TableHead>
          <tbody>
            {report?.rows.map((r) => (
              <tr
                key={r.key}
                className={`${tableRowClass} ${
                  r.profit < 0 && r.spend >= 5 ? 'bg-red-50/40 dark:bg-red-950/20' : r.roi > 20 ? 'bg-green-50/40 dark:bg-green-950/20' : ''
                }`}
              >
                <Td className={`font-medium ${sectionHeadingClass}`}>{r.label}</Td>
                <Td>{r.visits}</Td>
                <Td>{r.events}</Td>
                <Td>{r.cr}%</Td>
                <Td>${r.spend.toFixed(2)}</Td>
                <Td>${r.revenue.toFixed(2)}</Td>
                <Td className={r.profit < 0 ? 'text-red-600 dark:text-red-400 font-medium' : 'text-green-700 dark:text-green-400'}>
                  ${r.profit.toFixed(2)}
                </Td>
                <Td>{r.roi.toFixed(1)}%</Td>
              </tr>
            ))}
          </tbody>
        </table>
        {!report?.rows.length && <EmptyState title="No data" description="Adjust date range or campaign." />}
      </DataTable>
    </div>
  );
}
