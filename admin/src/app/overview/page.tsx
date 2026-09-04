'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  Button,
  Card,
  Loading,
  PageHeader,
  StatCard,
  sectionHeadingClass,
  mutedTextClass,
  type StatCardTone,
} from '@/components/ui';
import { DateRangePicker, buildPresets, type DateRange } from '@/components/DateRangePicker';
import { ExcludeBotsToggle } from '@/components/ExcludeBotsToggle';
import { OverviewChart } from '@/components/OverviewChart';
import { CampaignReportTable } from '@/components/CampaignReportTable';
import { OverviewColumnPicker } from '@/components/OverviewColumnPicker';
import { ReportDimensionTabs } from '@/components/ReportDimensionTabs';
import { VoluumReportToolbar } from '@/components/VoluumReportToolbar';
import { trackerApi, formatApiError, type CampaignReportRow, type DigestReport, type EventColumnDef, type TimeseriesPoint, type VisitStats } from '@/lib/api';
import {
  buildOverviewColumns,
  loadVisibleColumns,
  saveVisibleColumns,
  type OverviewColumnId,
} from '@/lib/overview-columns';
import {
  getReportDimension,
  isDrilldownLevel,
  type ReportDimensionId,
  type ReportLevel,
} from '@/lib/report-dimensions';

function KpiIcon({ d }: { d: string }) {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d={d} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const KPI_CARDS: {
  key: string;
  label: string;
  tone: StatCardTone;
  icon: ReactNode;
}[] = [
  { key: 'impressions', label: 'Impressions', tone: 'sky', icon: <KpiIcon d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" /> },
  { key: 'visits', label: 'Visits', tone: 'green', icon: <KpiIcon d="M15 15l6 6M10 17a7 7 0 1 1 0-14 7 7 0 0 1 0 14z" /> },
  { key: 'clicks', label: 'Clicks', tone: 'yellow', icon: <KpiIcon d="M9 12l2 2 4-4M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" /> },
  { key: 'conversions', label: 'Conversions', tone: 'pink', icon: <KpiIcon d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /> },
  { key: 'revenue', label: 'Revenue', tone: 'purple', icon: <KpiIcon d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /> },
  { key: 'cost', label: 'Cost', tone: 'blue', icon: <KpiIcon d="M4 19h16M6 16l3-4 4 3 5-8 4 6" /> },
  { key: 'profit', label: 'Profit', tone: 'amber', icon: <KpiIcon d="M12 3v18M3 12h18" /> },
];


type SelectedCampaign = { id: string; name: string };

export default function OverviewPage() {
  const [range, setRange] = useState<DateRange>(buildPresets()[2]);
  const [excludeBots, setExcludeBots] = useState(false);
  const [overview, setOverview] = useState<VisitStats | null>(null);
  const [digest, setDigest] = useState<DigestReport | null>(null);
  const [campaignRows, setCampaignRows] = useState<CampaignReportRow[]>([]);
  const [campaignEventColumns, setCampaignEventColumns] = useState<EventColumnDef[]>([]);
  const [drilldownRows, setDrilldownRows] = useState<CampaignReportRow[]>([]);
  const [drilldownEventColumns, setDrilldownEventColumns] = useState<EventColumnDef[]>([]);
  const [timeseries, setTimeseries] = useState<TimeseriesPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [drilldownLoading, setDrilldownLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeMetrics, setActiveMetrics] = useState(
    () => new Set(['visits', 'conversions', 'revenue', 'cost']),
  );
  const [visibleColumns, setVisibleColumns] = useState<Set<OverviewColumnId>>(() => new Set());
  const [reportLevel, setReportLevel] = useState<ReportLevel>('campaigns');
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<SelectedCampaign | null>(null);
  const skipSelectionKpiFetch = useRef(true);

  const rangeParams = {
    from: range.from,
    to: range.to,
    ...(excludeBots ? { excludeBots: 'true' } : {}),
  };

  const applyColumnIds = (eventColumns: EventColumnDef[]) => {
    const allIds = buildOverviewColumns(eventColumns).map((c) => c.id);
    setVisibleColumns((prev) => {
      if (prev.size > 0) {
        const kept = new Set([...prev].filter((id) => allIds.includes(id)));
        if (kept.size > 0) return kept;
      }
      return loadVisibleColumns(allIds);
    });
  };

  const load = useCallback(() => {
    setLoading(true);
    const overviewParams = {
      ...rangeParams,
      ...(selectedCampaign ? { campaignId: selectedCampaign.id } : {}),
    };
    Promise.all([
      trackerApi.getAnalyticsOverview(overviewParams),
      trackerApi.getCampaignReport(rangeParams),
      trackerApi.getTimeseries({ ...rangeParams, granularity: 'hour' }),
      trackerApi.getDigest({ ...rangeParams, eventType: 'call_click' }),
      selectedCampaign && isDrilldownLevel(reportLevel)
        ? trackerApi.getCampaignDrilldownReport({
            ...rangeParams,
            campaignId: selectedCampaign.id,
            dimension: reportLevel,
          })
        : Promise.resolve(null),
    ])
      .then(([ov, report, ts, dig, drilldown]) => {
        setOverview(ov);
        setCampaignRows(report.rows);
        setCampaignEventColumns(report.eventColumns);
        setTimeseries(ts);
        setDigest(dig);
        if (drilldown) {
          setDrilldownRows(drilldown.rows);
          setDrilldownEventColumns(drilldown.eventColumns);
          applyColumnIds(drilldown.eventColumns);
        } else {
          applyColumnIds(report.eventColumns);
        }
        setError(null);
      })
      .catch((err) => {
        console.error(err);
        setError(formatApiError(err));
      })
      .finally(() => setLoading(false));
  }, [range.from, range.to, excludeBots, selectedCampaign?.id, reportLevel]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const overviewParams = {
      ...rangeParams,
      ...(selectedCampaign ? { campaignId: selectedCampaign.id } : {}),
    };

    Promise.all([
      trackerApi.getAnalyticsOverview(overviewParams),
      trackerApi.getCampaignReport(rangeParams),
      trackerApi.getTimeseries({ ...rangeParams, granularity: 'hour' }),
      trackerApi.getDigest({ ...rangeParams, eventType: 'call_click' }),
    ])
      .then(([ov, report, ts, dig]) => {
        if (cancelled) return;
        setOverview(ov);
        setCampaignRows(report.rows);
        setCampaignEventColumns(report.eventColumns);
        setTimeseries(ts);
        setDigest(dig);
        setError(null);
        if (reportLevel === 'campaigns') applyColumnIds(report.eventColumns);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setError(formatApiError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [range.from, range.to, excludeBots]);

  useEffect(() => {
    if (skipSelectionKpiFetch.current) {
      skipSelectionKpiFetch.current = false;
      return;
    }
    let cancelled = false;
    trackerApi
      .getAnalyticsOverview({
        ...rangeParams,
        ...(selectedCampaign ? { campaignId: selectedCampaign.id } : {}),
      })
      .then((ov) => {
        if (!cancelled) setOverview(ov);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setError(formatApiError(err));
      });
    return () => { cancelled = true; };
  }, [selectedCampaign?.id]);

  useEffect(() => {
    if (!isDrilldownLevel(reportLevel) || !selectedCampaign) return;
    let cancelled = false;
    setDrilldownLoading(true);
    trackerApi
      .getCampaignDrilldownReport({
        ...rangeParams,
        campaignId: selectedCampaign.id,
        dimension: reportLevel,
      })
      .then((report) => {
        if (cancelled) return;
        setDrilldownRows(report.rows);
        setDrilldownEventColumns(report.eventColumns);
        applyColumnIds(report.eventColumns);
        if (report.campaign) setSelectedCampaign(report.campaign);
        setError(null);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setError(formatApiError(err));
      })
      .finally(() => {
        if (!cancelled) setDrilldownLoading(false);
      });
    return () => { cancelled = true; };
  }, [reportLevel, selectedCampaign?.id, range.from, range.to, excludeBots]);

  const toggleMetric = (key: string) => {
    setActiveMetrics((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleColumnsChange = (next: Set<OverviewColumnId>) => {
    setVisibleColumns(next);
    saveVisibleColumns(next);
  };

  const clearSelection = useCallback(() => {
    setSelectedRowId(null);
    setSelectedCampaign(null);
    setReportLevel('campaigns');
    applyColumnIds(campaignEventColumns);
  }, [campaignEventColumns]);

  const handleSelectRow = (row: CampaignReportRow | null) => {
    if (!row) {
      setSelectedRowId(null);
      return;
    }
    setSelectedRowId((prev) => (prev === row.campaignId ? null : row.campaignId));
  };

  const openReport = () => {
    const row =
      campaignRows.find((r) => r.campaignId === selectedRowId) ??
      (selectedCampaign ? { campaignId: selectedCampaign.id, campaignName: selectedCampaign.name } : null);
    if (!row) return;
    setSelectedCampaign({ id: row.campaignId, name: row.campaignName });
    setReportLevel('offers');
  };

  const openDimension = (dimension: ReportDimensionId) => {
    if (!selectedCampaign) {
      openReport();
      return;
    }
    setReportLevel(dimension);
  };

  const refreshReport = () => {
    if (!selectedCampaign || !isDrilldownLevel(reportLevel)) {
      load();
      return;
    }
    setDrilldownLoading(true);
    trackerApi
      .getCampaignDrilldownReport({
        ...rangeParams,
        campaignId: selectedCampaign.id,
        dimension: reportLevel,
      })
      .then((report) => {
        setDrilldownRows(report.rows);
        setDrilldownEventColumns(report.eventColumns);
        applyColumnIds(report.eventColumns);
        setError(null);
      })
      .catch((err) => {
        console.error(err);
        setError(formatApiError(err));
      })
      .finally(() => setDrilldownLoading(false));
  };

  const exportCsv = async () => {
    if (isDrilldownLevel(reportLevel) && selectedCampaign) {
      const csv = await trackerApi.exportCampaignDrilldownCsv({
        ...rangeParams,
        campaignId: selectedCampaign.id,
        dimension: reportLevel,
      });
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${reportLevel}-report.csv`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
    const csv = await trackerApi.exportCampaignReportCsv(rangeParams);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'campaign-report.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const kpiValue = (key: string) => {
    if (!overview) return '—';
    const v = (overview as unknown as Record<string, unknown>)[key];
    if (v === undefined || v === null) return '0';
    if (key === 'revenue' || key === 'cost' || key === 'profit') {
      return `€${Number(v).toFixed(2)}`;
    }
    return String(v);
  };

  const onDrilldown = isDrilldownLevel(reportLevel);
  const activeDimension = onDrilldown ? getReportDimension(reportLevel) : null;
  const displayRows = onDrilldown ? drilldownRows : campaignRows;
  const displayEventColumns = onDrilldown ? drilldownEventColumns : campaignEventColumns;
  const nameColumnLabel = activeDimension?.nameColumnLabel || 'Campaign name';
  const activeFilterDimension: ReportDimensionId = onDrilldown ? reportLevel : 'offers';

  useEffect(() => {
    if (!onDrilldown) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clearSelection();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onDrilldown, clearSelection]);

  if (loading && !overview) return <Loading label="Loading overview..." />;

  return (
    <div>
      <PageHeader
        title="Overview"
        description="Voluum-style performance dashboard — visits, conversions, revenue, and spend."
        action={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={exportCsv}>
              Export CSV
            </Button>
            <Button variant="secondary" size="sm" onClick={load}>
              Refresh
            </Button>
          </div>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <DateRangePicker value={range} onChange={setRange} />
        <ExcludeBotsToggle value={excludeBots} onChange={setExcludeBots} />
      </div>

      {error && (
        <div className="mb-6">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {!onDrilldown ? (
        <>

          {digest && digest.items.length > 0 && (
            <Card elevated className="mb-8 border-indigo-200/60 dark:border-indigo-800/60 bg-indigo-50/30 dark:bg-indigo-950/20">
              <h2 className={`${sectionHeadingClass} mb-4`}>Today&apos;s decisions</h2>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {digest.items.slice(0, 6).map((item) => (
                  <div
                    key={item.id}
                    className="rounded-xl border border-zinc-200/60 bg-white/80 p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60"
                  >
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{item.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{item.message}</p>
                    <p className="mt-2 text-xs font-medium text-indigo-600 dark:text-indigo-400">→ {item.action}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      ) : null}

      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        {KPI_CARDS.map((c) => (
          <StatCard key={c.key} label={c.label} value={kpiValue(c.key)} tone={c.tone} icon={c.icon} />
        ))}
      </div>

      <Card elevated className="mb-8">
        <h2 className={`${sectionHeadingClass} mb-4`}>Performance over time</h2>
        <OverviewChart data={timeseries} active={activeMetrics} onToggle={toggleMetric} />
      </Card>

      <div className="mb-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className={sectionHeadingClass}>
              {onDrilldown
                ? `${activeDimension?.label || 'Offers'} performance`
                : 'Campaign performance'}
            </h2>
            {!onDrilldown ? (
              <p className={`mt-1 text-xs ${mutedTextClass}`}>
                Select a campaign, then click Report to drill down.
              </p>
            ) : null}
          </div>
        </div>

        {/* No overflow-hidden here: it would clip the toolbar and column
            picker dropdowns, which are absolutely positioned. The rounded
            corners are clipped on the table wrapper below instead. */}
        <div className="rounded-2xl border border-zinc-200/70 shadow-[var(--shadow-sm)] dark:border-zinc-800/80">
          <VoluumReportToolbar
            reportLevel={reportLevel}
            selectedCampaign={selectedCampaign}
            selectedRowId={selectedRowId}
            onOpenReport={openReport}
            onBackToCampaigns={clearSelection}
            onSelectDimension={openDimension}
            onExport={exportCsv}
            onRefresh={refreshReport}
            columnsSlot={
              <OverviewColumnPicker
                eventColumns={displayEventColumns}
                visible={visibleColumns}
                onChange={handleColumnsChange}
                nameColumnLabel={nameColumnLabel}
              />
            }
          />

          {onDrilldown ? (
            <ReportDimensionTabs
              active={activeFilterDimension}
              onSelect={openDimension}
              disabled={drilldownLoading}
            />
          ) : null}

          <div className="overflow-hidden rounded-b-2xl">
            {drilldownLoading && onDrilldown ? (
              <Loading label={`Loading ${activeDimension?.label || 'report'}...`} />
            ) : (
              <CampaignReportTable
                rows={displayRows}
                eventColumns={displayEventColumns}
                visibleColumns={visibleColumns}
                nameColumnLabel={nameColumnLabel}
                showCampaignMeta={!onDrilldown}
                selectable={!onDrilldown}
                selectedId={onDrilldown ? null : selectedRowId}
                onSelect={handleSelectRow}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
