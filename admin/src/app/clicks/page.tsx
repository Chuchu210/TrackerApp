'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { AnalyticsTabs } from '@/components/AnalyticsTabs';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  Input,
  Loading,
  PageHeader,
  Select,
  StatCard,
  TableHead,
  Td,
  Th,
  bodyTextClass,
  detailRowClass,
  mutedTextClass,
  tableRowClass,
} from '@/components/ui';
import { DateRangePicker, buildPresets, type DateRange } from '@/components/DateRangePicker';
import { ExcludeBotsToggle } from '@/components/ExcludeBotsToggle';
import {
  trackerApi,
  formatApiError,
  type Click,
  type Campaign,
  type VisitBreakdownDimension,
  type VisitBreakdownRow,
  type VisitSummary,
} from '@/lib/api';

type ViewMode = 'performance' | 'log';

type Filters = {
  campaignId: string;
  publisher: string;
  platform: string;
  country: string;
  adId: string;
  adsetId: string;
  siteId: string;
  contentName: string;
  isBot: string;
  isNewVisitor: string;
  isTest: string;
  converted: string;
  landerId: string;
};

const EMPTY_FILTERS: Filters = {
  campaignId: '',
  publisher: '',
  platform: '',
  country: '',
  adId: '',
  adsetId: '',
  siteId: '',
  contentName: '',
  isBot: '',
  isNewVisitor: '',
  isTest: '',
  converted: '',
  landerId: '',
};

const DIMENSIONS: { id: VisitBreakdownDimension; label: string }[] = [
  { id: 'campaign', label: 'Campaign' },
  { id: 'lander', label: 'Landing page' },
  { id: 'publisher', label: 'Publisher' },
  { id: 'adset', label: 'Adset' },
  { id: 'ad', label: 'Ad' },
  { id: 'site', label: 'Site' },
  { id: 'content', label: 'Content' },
  { id: 'platform', label: 'Platform' },
  { id: 'country', label: 'Country' },
  { id: 'device', label: 'Device' },
];

type SortKey = 'visits' | 'botPct' | 'convertingVisits' | 'cr' | 'revenue';

export default function ClicksPage() {
  const [range, setRange] = useState<DateRange>(buildPresets()[2]);
  const [viewMode, setViewMode] = useState<ViewMode>('performance');
  const [dimension, setDimension] = useState<VisitBreakdownDimension>('publisher');
  const [sortKey, setSortKey] = useState<SortKey>('visits');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [clicks, setClicks] = useState<Click[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<VisitSummary | null>(null);
  const [breakdown, setBreakdown] = useState<VisitBreakdownRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [excludeBots, setExcludeBots] = useState(false);

  // Seed filters from the URL so drill-down links (e.g. from Placements) land pre-filtered.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    const keys: (keyof Filters)[] = [
      'campaignId',
      'publisher',
      'siteId',
      'platform',
      'country',
      'adId',
      'adsetId',
      'contentName',
    ];
    const seed: Partial<Filters> = {};
    for (const k of keys) {
      const v = sp.get(k);
      if (v) seed[k] = v;
    }
    if (Object.keys(seed).length) setFilters((f) => ({ ...f, ...seed }));
  }, []);

  const queryParams = useMemo(() => {
    const params: Record<string, string> = {
      from: range.from,
      to: range.to,
    };
    if (filters.campaignId) params.campaignId = filters.campaignId;
    if (filters.publisher) params.publisher = filters.publisher;
    if (filters.platform) params.platform = filters.platform;
    if (filters.country) params.country = filters.country;
    if (filters.adId) params.adId = filters.adId;
    if (filters.adsetId) params.adsetId = filters.adsetId;
    if (filters.siteId) params.siteId = filters.siteId;
    if (filters.contentName) params.contentName = filters.contentName;
    if (filters.landerId) params.landerId = filters.landerId;
    if (filters.isBot) params.isBot = filters.isBot;
    if (filters.isNewVisitor) params.isNewVisitor = filters.isNewVisitor;
    if (filters.isTest) params.isTest = filters.isTest;
    if (filters.converted) params.converted = filters.converted;
    if (excludeBots) params.excludeBots = 'true';
    return params;
  }, [range, filters, excludeBots]);

  useEffect(() => {
    trackerApi.getCampaigns().then(setCampaigns).catch(console.error);
  }, []);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    const listParams = { ...queryParams, limit: '100' };

    Promise.all([
      trackerApi.getVisitSummary(queryParams),
      trackerApi.getVisitBreakdown(dimension, queryParams),
      viewMode === 'log' ? trackerApi.getClicks(listParams) : Promise.resolve(null),
    ])
      .then(([sum, rows, clickRes]) => {
        if (cancelled) return;
        setSummary(sum);
        setBreakdown(rows);
        if (clickRes) {
          setClicks(clickRes.items);
          setTotal(clickRes.total);
        }
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
  }, [queryParams, dimension, viewMode]);

  const sortedBreakdown = useMemo(() => {
    const rows = [...breakdown];
    rows.sort((a, b) => {
      let av: number;
      let bv: number;
      if (sortKey === 'botPct') {
        av = parseFloat(a.botPct);
        bv = parseFloat(b.botPct);
      } else if (sortKey === 'cr') {
        av = parseFloat(a.cr);
        bv = parseFloat(b.cr);
      } else {
        av = a[sortKey];
        bv = b[sortKey];
      }
      return sortDir === 'desc' ? bv - av : av - bv;
    });
    return rows;
  }, [breakdown, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const drillIntoRow = (row: VisitBreakdownRow) => {
    const next = { ...EMPTY_FILTERS, campaignId: filters.campaignId };
    switch (dimension) {
      case 'publisher':
        next.publisher = row.key === '(unknown)' ? '' : row.key;
        break;
      case 'adset':
        next.adsetId = row.key === '(no adset)' ? '' : row.key;
        break;
      case 'ad':
        next.adId = row.key === '(no ad)' ? '' : row.key;
        break;
      case 'site':
        next.siteId = row.key === '(unknown)' ? '' : row.key;
        break;
      case 'content':
        next.contentName = row.key === '(unknown)' ? '' : row.key;
        break;
      case 'platform':
        next.platform = row.key === '(unknown)' ? '' : row.key;
        break;
      case 'country':
        next.country = row.key === '(unknown)' ? '' : row.key;
        break;
      case 'device':
        break;
      case 'campaign':
        next.campaignId = row.key;
        break;
      case 'lander':
        next.landerId = row.key === '(no lander)' ? '' : row.key;
        break;
    }
    setFilters(next);
    setViewMode('log');
  };

  const qualityTone = (row: VisitBreakdownRow): 'success' | 'warning' | 'danger' | 'neutral' => {
    const bot = parseFloat(row.botPct);
    if (bot >= 40) return 'danger';
    if (row.convertingVisits > 0 && bot < 25) return 'success';
    if (bot >= 20 && row.convertingVisits === 0) return 'warning';
    return 'neutral';
  };

  const qualityLabel = (row: VisitBreakdownRow): string => {
    const bot = parseFloat(row.botPct);
    if (bot >= 40) return 'High bot';
    if (row.convertingVisits > 0 && bot < 25) return 'Converting';
    if (bot >= 20 && row.convertingVisits === 0) return 'Low quality';
    return 'Mixed';
  };

  return (
    <div>
      <AnalyticsTabs />
      <PageHeader
        title="Visits"
        description="Analyze publisher and ad performance, bot traffic, and conversion quality."
        meta={summary ? <Badge tone="neutral">{summary.visits} visits</Badge> : undefined}
      />

      <div className="mb-4">
        <DateRangePicker value={range} onChange={setRange} />
        <ExcludeBotsToggle value={excludeBots} onChange={setExcludeBots} />
      </div>

      {error && (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          <StatCard label="Visits" value={summary.visits} />
          <StatCard label="Human traffic" value={`${summary.humanPct}%`} hint={`${summary.humanVisits} visits`} />
          <StatCard label="Bot traffic" value={`${summary.botPct}%`} hint={`${summary.botVisits} visits`} />
          <StatCard label="Conversions" value={summary.conversions} />
          <StatCard label="CV rate" value={`${summary.conversionRate}%`} />
          <StatCard label="Revenue" value={`$${summary.revenue.toFixed(2)}`} />
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        <Button
          size="sm"
          variant={viewMode === 'performance' ? 'primary' : 'secondary'}
          onClick={() => setViewMode('performance')}
        >
          Performance
        </Button>
        <Button
          size="sm"
          variant={viewMode === 'log' ? 'primary' : 'secondary'}
          onClick={() => setViewMode('log')}
        >
          Visit log
        </Button>
      </div>

      <FilterBar>
        <Select
          className="w-auto min-w-[160px]"
          value={filters.campaignId}
          onChange={(e) => setFilters({ ...filters, campaignId: e.target.value })}
        >
          <option value="">All campaigns</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Input
          className="w-40"
          placeholder="Landing page"
          value={filters.landerId}
          onChange={(e) => setFilters({ ...filters, landerId: e.target.value })}
        />
        <Input
          className="w-32"
          placeholder="Publisher"
          value={filters.publisher}
          onChange={(e) => setFilters({ ...filters, publisher: e.target.value })}
        />
        <Input
          className="w-28"
          placeholder="Adset ID"
          value={filters.adsetId}
          onChange={(e) => setFilters({ ...filters, adsetId: e.target.value })}
        />
        <Input
          className="w-28"
          placeholder="Ad ID"
          value={filters.adId}
          onChange={(e) => setFilters({ ...filters, adId: e.target.value })}
        />
        <Input
          className="w-28"
          placeholder="Site ID"
          value={filters.siteId}
          onChange={(e) => setFilters({ ...filters, siteId: e.target.value })}
        />
        <Input
          className="w-28"
          placeholder="Platform"
          value={filters.platform}
          onChange={(e) => setFilters({ ...filters, platform: e.target.value })}
        />
        <Input
          className="w-24"
          placeholder="Country"
          value={filters.country}
          onChange={(e) => setFilters({ ...filters, country: e.target.value })}
        />
        <Select
          className="w-auto"
          value={filters.isBot}
          onChange={(e) => setFilters({ ...filters, isBot: e.target.value })}
        >
          <option value="">All traffic</option>
          <option value="false">Humans only</option>
          <option value="true">Bots only</option>
        </Select>
        <Select
          className="w-auto"
          value={filters.isTest}
          onChange={(e) => setFilters({ ...filters, isTest: e.target.value })}
        >
          <option value="">Real + test</option>
          <option value="false">Real only</option>
          <option value="true">Test only</option>
        </Select>
        <Select
          className="w-auto"
          value={filters.converted}
          onChange={(e) => setFilters({ ...filters, converted: e.target.value })}
        >
          <option value="">All conversions</option>
          <option value="true">Converted</option>
          <option value="false">Not converted</option>
        </Select>
        <Select
          className="w-auto"
          value={filters.isNewVisitor}
          onChange={(e) => setFilters({ ...filters, isNewVisitor: e.target.value })}
        >
          <option value="">All visitors</option>
          <option value="true">New only</option>
          <option value="false">Returning only</option>
        </Select>
        {(filters.publisher ||
          filters.adId ||
          filters.adsetId ||
          filters.siteId ||
          filters.platform ||
          filters.country ||
          filters.isBot ||
          filters.isTest ||
          filters.converted ||
          filters.isNewVisitor) && (
          <Button size="sm" variant="secondary" onClick={() => setFilters({ ...EMPTY_FILTERS, campaignId: filters.campaignId })}>
            Clear filters
          </Button>
        )}
      </FilterBar>

      {loading ? (
        <Loading />
      ) : viewMode === 'performance' ? (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className={`text-xs ${mutedTextClass}`}>Group by</span>
            {DIMENSIONS.map((d) => (
              <Button
                key={d.id}
                size="sm"
                variant={dimension === d.id ? 'primary' : 'secondary'}
                onClick={() => setDimension(d.id)}
              >
                {d.label}
              </Button>
            ))}
          </div>

          <DataTable>
            <table className="w-full text-xs">
              <TableHead>
                <Th>{DIMENSIONS.find((d) => d.id === dimension)?.label}</Th>
                <Th>
                  <SortHeader label="Visits" sortKey="visits" active={sortKey} dir={sortDir} onSort={toggleSort} />
                </Th>
                <Th>Unique</Th>
                <Th>
                  <SortHeader label="Bots" sortKey="botPct" active={sortKey} dir={sortDir} onSort={toggleSort} />
                </Th>
                <Th>Bot %</Th>
                <Th>Humans</Th>
                <Th>
                  <SortHeader
                    label="Conv. visits"
                    sortKey="convertingVisits"
                    active={sortKey}
                    dir={sortDir}
                    onSort={toggleSort}
                  />
                </Th>
                <Th>
                  <SortHeader label="CR %" sortKey="cr" active={sortKey} dir={sortDir} onSort={toggleSort} />
                </Th>
                <Th>
                  <SortHeader label="Revenue" sortKey="revenue" active={sortKey} dir={sortDir} onSort={toggleSort} />
                </Th>
                <Th>Quality</Th>
              </TableHead>
              <tbody>
                {sortedBreakdown.map((row) => (
                  <tr
                    key={row.key}
                    className={`${tableRowClass} cursor-pointer`}
                    onClick={() => drillIntoRow(row)}
                    title="Click to filter visit log"
                  >
                    <Td className="max-w-[200px] truncate font-medium">{row.label}</Td>
                    <Td>{row.visits}</Td>
                    <Td>{row.uniqueVisitors}</Td>
                    <Td>{row.botVisits}</Td>
                    <Td>
                      <span className={parseFloat(row.botPct) >= 30 ? 'text-red-600 font-medium' : ''}>
                        {row.botPct}%
                      </span>
                    </Td>
                    <Td>{row.humanVisits}</Td>
                    <Td>{row.convertingVisits}</Td>
                    <Td>{row.cr}%</Td>
                    <Td>${row.revenue.toFixed(2)}</Td>
                    <Td>
                      <Badge tone={qualityTone(row)}>{qualityLabel(row)}</Badge>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sortedBreakdown.length === 0 && (
              <EmptyState
                title="No visits in this range"
                description="Adjust the date range or filters to see performance data."
              />
            )}
          </DataTable>
        </>
      ) : (
        <DataTable>
          <table className="w-full text-xs">
            <TableHead>
              <Th>Visitor</Th>
              <Th>Bot</Th>
              <Th>Conv</Th>
              <Th>Click ID</Th>
              <Th>Publisher</Th>
              <Th>Adset</Th>
              <Th>Ad</Th>
              <Th>Site</Th>
              <Th>Device</Th>
              <Th>Country</Th>
              <Th>IP</Th>
              <Th>Date</Th>
            </TableHead>
            <tbody>
              {clicks.map((c) => {
                const isExpanded = expanded === c.id;
                return (
                  <Fragment key={c.id}>
                    <tr
                      className={`${tableRowClass} cursor-pointer`}
                      onClick={() => setExpanded(isExpanded ? null : c.id)}
                    >
                      <Td>
                        {c.isNewVisitor === false ? (
                          <Badge tone="neutral">Returning</Badge>
                        ) : (
                          <Badge tone="info">New</Badge>
                        )}
                      </Td>
                      <Td>
                        {/* Test rows are the reason this log shows them at all —
                            you open it right after firing a test click. The badge
                            says why the row will never appear in a report. */}
                        {c.isTest ? (
                          <Badge tone="warning">Test</Badge>
                        ) : c.isBot ? (
                          <Badge tone="danger">Bot {c.botScore}</Badge>
                        ) : (
                          <Badge tone="success">Human</Badge>
                        )}
                      </Td>
                      <Td>
                        {c.converted ? (
                          <Badge tone="success">Yes</Badge>
                        ) : (
                          <span className={mutedTextClass}>No</span>
                        )}
                      </Td>
                      <Td className="font-mono">{c.clickId}</Td>
                      <Td className="max-w-[100px] truncate">{c.publisherName || '—'}</Td>
                      <Td className="max-w-[120px] truncate">
                        <span title={c.adsetName || c.adsetId || undefined}>
                          {c.adsetName || c.adsetId || '—'}
                        </span>
                      </Td>
                      <Td className="max-w-[100px] truncate">
                        <span title={c.adTitle || c.adId || undefined}>{c.adId || '—'}</span>
                      </Td>
                      <Td className="max-w-[80px] truncate">{c.siteId || '—'}</Td>
                      <Td>{c.device || '—'}</Td>
                      <Td>{c.countryCode || '—'}</Td>
                      <Td className="font-mono">
                        {c.ipAddress || '—'}
                        {c.isLocalIp && <span className="ml-1 text-amber-600">(local)</span>}
                      </Td>
                      <Td className="text-zinc-400 whitespace-nowrap">
                        {new Date(c.createdAt).toLocaleString()}
                      </Td>
                    </tr>
                    {isExpanded && (
                      <tr className={detailRowClass}>
                        <td colSpan={12} className="px-5 py-4">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                            {(c.reportFields?.length
                              ? c.reportFields.map((f) => (
                                  <Detail key={f.label} label={f.label} value={f.value} />
                                ))
                              : [
                                  <Detail key="tid" label="Tracking ID" value={c.trackingId} />,
                                  <Detail key="pub" label="Publisher" value={c.publisherName} />,
                                  <Detail key="adset" label="Adset" value={c.adsetName || c.adsetId} />,
                                  <Detail key="ad" label="Ad ID" value={c.adId} />,
                                  <Detail key="plat" label="Platform" value={c.platform} />,
                                ])}
                            <Detail label="Adset" value={c.adsetName || c.adsetId} />
                            <Detail label="Ad title" value={c.adTitle} />
                            <Detail label="Site ID" value={c.siteId} />
                            <Detail label="Content" value={c.contentName} />
                            <Detail label="OS / Model" value={`${c.os || '—'} / ${c.model || c.brand || '—'}`} />
                            <Detail label="Browser" value={c.browserVersion || c.browser} />
                            <Detail label="City" value={c.city} />
                            <Detail label="ISP" value={c.isp} />
                            <Detail label="Bot reasons" value={(c.botReasons || []).join(', ')} />
                            <div className="col-span-full">
                              <span className={mutedTextClass}>UA: </span>
                              <span className={`${bodyTextClass} break-all`}>{c.userAgent || '—'}</span>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {clicks.length === 0 && (
            <EmptyState title="No visits match filters" description="Try widening the date range or clearing filters." />
          )}
          {total > clicks.length && (
            <p className={`text-xs ${mutedTextClass} px-5 py-3`}>
              Showing {clicks.length} of {total} visits. Narrow filters to inspect specific traffic.
            </p>
          )}
        </DataTable>
      )}
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  active,
  dir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  dir: 'asc' | 'desc';
  onSort: (key: SortKey) => void;
}) {
  const indicator = active === sortKey ? (dir === 'desc' ? ' ↓' : ' ↑') : '';
  return (
    <button type="button" className={`cursor-pointer hover:text-zinc-600 dark:hover:text-zinc-300`} onClick={() => onSort(sortKey)}>
      {label}
      {indicator}
    </button>
  );
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <span className={mutedTextClass}>{label}: </span>
      <span className={bodyTextClass}>{value || '—'}</span>
    </div>
  );
}
