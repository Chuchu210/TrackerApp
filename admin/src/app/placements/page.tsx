'use client';

import { useCallback, useEffect, useState } from 'react';
import { AnalyticsTabs } from '@/components/AnalyticsTabs';
import { useToast } from '@/components/Toast';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  DataTable,
  EmptyState,
  FilterBar,
  InlineLink,
  Loading,
  PageHeader,
  Select,
  StatCard,
  TableHead,
  Td,
  Th,
  tableRowClass,
} from '@/components/ui';
import { DateRangePicker, buildPresets, type DateRange } from '@/components/DateRangePicker';
import { ExcludeBotsToggle } from '@/components/ExcludeBotsToggle';
import {
  trackerApi,
  formatApiError,
  type Campaign,
  type PlacementReport,
  type PlacementRow,
} from '@/lib/api';

const VERDICT_TONE = { kill: 'danger', watch: 'warning', scale: 'success' } as const;

export default function PlacementsPage() {
  const toast = useToast();
  const [range, setRange] = useState<DateRange>(buildPresets()[2]);
  const [campaignId, setCampaignId] = useState('');
  const [dimension, setDimension] = useState<'site' | 'publisher'>('site');
  const [excludeBots, setExcludeBots] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [report, setReport] = useState<PlacementReport | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const params = {
    from: range.from,
    to: range.to,
    dimension,
    eventType: 'call_click',
    countMode: 'recorded',
    ...(excludeBots ? { excludeBots: 'true' } : {}),
    ...(campaignId ? { campaignId } : {}),
  };

  const load = useCallback(() => {
    setLoading(true);
    trackerApi
      .getPlacements(params)
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

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const addToBlocklist = async () => {
    const rows = report?.rows.filter((r) => selected.has(r.key)) || [];
    if (rows.length === 0) return;
    try {
      await trackerApi.createBlockedPlacements(
        rows.map((r) => ({
          campaignId: campaignId || undefined,
          dimension,
          value: r.label,
          reason: `Kill verdict: $${r.spend.toFixed(2)} spend, ${r.events} events`,
        })),
      );
      setSelected(new Set());
      toast.success(`Added ${rows.length} placement(s) to blocklist`);
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const copyBlocklist = async () => {
    const values =
      selected.size > 0
        ? report?.rows.filter((r) => selected.has(r.key)).map((r) => r.label)
        : report?.rows.filter((r) => r.verdict === 'kill').map((r) => r.label);
    if (!values?.length) return;
    await navigator.clipboard.writeText(values.join('\n'));
    toast.success(`Copied ${values.length} ID(s) — paste into Mediago blocklist`);
  };

  if (loading && !report) return <Loading label="Loading placements…" />;

  return (
    <div>
      <AnalyticsTabs />
      <PageHeader
        title="Placement Kill List"
        description="Find sites and publishers wasting budget. Block underperformers in Mediago."
      />

      <div className="mb-4 flex flex-wrap gap-3 items-center">
        <DateRangePicker value={range} onChange={setRange} />
        <ExcludeBotsToggle value={excludeBots} onChange={setExcludeBots} />
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
        <Select value={dimension} onChange={(e) => setDimension(e.target.value as 'site' | 'publisher')}>
          <option value="site">By site ID</option>
          <option value="publisher">By publisher</option>
        </Select>
        <Button size="sm" variant="secondary" onClick={copyBlocklist}>Copy blocklist</Button>
        <Button size="sm" variant="primary" onClick={addToBlocklist} disabled={selected.size === 0}>
          Add selected to blocklist
        </Button>
      </FilterBar>

      {report && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
          <StatCard label="Visits" value={report.summary.totalVisits} />
          <StatCard label="Spend" value={`$${report.summary.totalSpend.toFixed(2)}`} />
          <StatCard label="Events" value={report.summary.totalEvents} />
          <StatCard label="Kill list" value={report.summary.killCount} />
          <StatCard label="Scale candidates" value={report.summary.scaleCount} />
        </div>
      )}

      <DataTable>
        <table className="w-full text-xs">
          <TableHead>
            <Th></Th>
            <Th>{dimension === 'site' ? 'Site ID' : 'Publisher'}</Th>
            <Th>Visits</Th>
            <Th>Events</Th>
            <Th>CR %</Th>
            <Th>Spend</Th>
            <Th>CPA</Th>
            <Th>ROI %</Th>
            <Th>Bots %</Th>
            <Th>Verdict</Th>
          </TableHead>
          <tbody>
            {report?.rows.map((r: PlacementRow) => (
              <tr key={r.key} className={tableRowClass}>
                <Td>
                  <Checkbox
                    checked={selected.has(r.key)}
                    onChange={() => toggle(r.key)}
                  />
                </Td>
                <Td className="font-mono max-w-[160px] truncate">
                  <InlineLink
                    href={`/clicks?${dimension === 'site' ? 'siteId' : 'publisher'}=${encodeURIComponent(r.key)}${campaignId ? `&campaignId=${campaignId}` : ''}`}
                    title={`View visits for ${r.label}`}
                  >
                    {r.label}
                  </InlineLink>
                </Td>
                <Td>{r.visits}</Td>
                <Td>{r.events}</Td>
                <Td>{r.cr}%</Td>
                <Td>${r.spend.toFixed(2)}</Td>
                <Td>{r.events > 0 ? `$${r.cpa.toFixed(2)}` : '—'}</Td>
                <Td className={r.roi < 0 ? 'text-red-600 dark:text-red-400' : ''}>{r.roi.toFixed(1)}%</Td>
                <Td>{r.botPct}%</Td>
                <Td>
                  <Badge tone={VERDICT_TONE[r.verdict]}>{r.verdict}</Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
        {!report?.rows.length && (
          <EmptyState title="No placement data" description="Need visits with site_id or publisher in click URL." />
        )}
      </DataTable>
    </div>
  );
}
