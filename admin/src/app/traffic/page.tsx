'use client';

import { useEffect, useState } from 'react';
import { AnalyticsTabs } from '@/components/AnalyticsTabs';
import {
  Alert,
  Badge,
  Card,
  DataTable,
  EmptyState,
  Loading,
  PageHeader,
  StatCard,
  TableHead,
  Td,
  Th,
  bodyTextClass,
  mutedTextClass,
  sectionHeadingClass,
  tableRowClass,
} from '@/components/ui';
import { trackerApi, formatApiError, type Click, type BreakdownRow } from '@/lib/api';

export default function TrafficPage() {
  const [live, setLive] = useState<Click[]>([]);
  const [overview, setOverview] = useState({
    visits: 0,
    uniqueVisits: 0,
    newVisitors: 0,
    returningVisitors: 0,
    conversions: 0,
    conversionRate: '0',
  });
  const [publisherBreakdown, setPublisherBreakdown] = useState<BreakdownRow[]>([]);
  const [deviceBreakdown, setDeviceBreakdown] = useState<BreakdownRow[]>([]);
  const [platformBreakdown, setPlatformBreakdown] = useState<BreakdownRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    Promise.all([
      trackerApi.getAnalyticsOverview(),
      trackerApi.getBreakdown('publisher'),
      trackerApi.getBreakdown('device'),
      trackerApi.getBreakdown('platform'),
      trackerApi.getLiveTraffic({ limit: '30' }),
    ])
      .then(([ov, pub, dev, plat, liveData]) => {
        if (cancelled) return;
        setOverview(ov);
        setPublisherBreakdown(pub);
        setDeviceBreakdown(dev);
        setPlatformBreakdown(plat);
        setLive(liveData);
        setError(null);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setError(formatApiError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const pollLive = () => {
      trackerApi
        .getLiveTraffic({ limit: '30' })
        .then((liveData) => {
          if (!cancelled) setLive(liveData);
        })
        .catch((err) => console.error(err));
    };

    const interval = setInterval(pollLive, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (loading) return <Loading label="Loading traffic..." />;

  return (
    <div>
      <AnalyticsTabs />
      <PageHeader
        title="Live Traffic"
        description="Real-time overview with auto-refresh every 15 seconds."
        meta={<Badge tone="success">Live</Badge>}
      />

      {error && (
        <div className="mb-6">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <StatCard label="Visits" value={overview.visits} />
        <StatCard label="Unique visits" value={overview.uniqueVisits} />
        <StatCard label="New visitors" value={overview.newVisitors} />
        <StatCard label="Returning" value={overview.returningVisitors} />
        <StatCard label="Conversions" value={overview.conversions} />
        <StatCard label="Conversion rate" value={`${overview.conversionRate}%`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
        <BreakdownCard title="By publisher" rows={publisherBreakdown} />
        <BreakdownCard title="By device" rows={deviceBreakdown} />
        <BreakdownCard title="By platform" rows={platformBreakdown} />
      </div>

      <h2 className={`${sectionHeadingClass} mb-3`}>Incoming clicks (24h)</h2>
      <DataTable>
        <table className="w-full text-xs">
          <TableHead>
            <Th>Time</Th>
            <Th>Campaign</Th>
            <Th>Publisher</Th>
            <Th>Platform</Th>
            <Th>Device</Th>
            <Th>Country</Th>
            <Th>IP</Th>
            <Th>Conv</Th>
          </TableHead>
          <tbody>
            {live.map((c) => (
              <tr key={c.id} className={tableRowClass}>
                <Td className={`whitespace-nowrap ${mutedTextClass}`}>
                  {new Date(c.createdAt).toLocaleTimeString()}
                </Td>
                <Td className={`font-medium ${sectionHeadingClass}`}>{c.campaign.name}</Td>
                <Td className="max-w-[120px] truncate">{c.publisherName || '—'}</Td>
                <Td>{c.platform || '—'}</Td>
                <Td>{c.device || '—'}</Td>
                <Td>{c.countryCode || '—'}</Td>
                <Td className="font-mono text-xs">{c.ipAddress || '—'}</Td>
                <Td>
                  {c.conversions?.length ? (
                    <Badge tone="success">Yes</Badge>
                  ) : (
                    <span className={mutedTextClass}>—</span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
        {live.length === 0 && (
          <EmptyState title="No traffic yet" description="Point your campaign URL to the tracker." />
        )}
      </DataTable>
    </div>
  );
}

function BreakdownCard({ title, rows }: { title: string; rows: BreakdownRow[] }) {
  return (
    <Card>
      <h3 className={`text-xs font-semibold uppercase tracking-wide ${mutedTextClass} mb-4`}>{title}</h3>
      <table className="w-full text-xs">
        <thead>
          <tr className={mutedTextClass}>
            <th className="text-left pb-2 font-medium">Name</th>
            <th className="text-right pb-2 font-medium">Clicks</th>
            <th className="text-right pb-2 font-medium">CR%</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 8).map((r) => (
            <tr key={r.name} className="border-t border-zinc-100 dark:border-zinc-800">
              <td className={`py-2 truncate max-w-[140px] ${bodyTextClass}`} title={r.name}>
                {r.name}
              </td>
              <td className="py-2 text-right tabular-nums">{r.clicks}</td>
              <td className={`py-2 text-right tabular-nums ${mutedTextClass}`}>{r.cr}%</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={3} className={`py-6 text-center ${mutedTextClass}`}>
                No data
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}
