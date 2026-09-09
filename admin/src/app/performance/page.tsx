'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AnalyticsTabs } from '@/components/AnalyticsTabs';
import {
  Alert,
  Badge,
  Button,
  Card,
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
  mutedTextClass,
  sectionHeadingClass,
  tableRowClass,
} from '@/components/ui';
import { DateRangePicker, buildPresets, type DateRange } from '@/components/DateRangePicker';
import { ExcludeBotsToggle } from '@/components/ExcludeBotsToggle';
import {
  trackerApi,
  formatApiError,
  type Campaign,
  type CreativePerformanceRow,
  type CreativePairRow,
  type CreativeQuality,
  type CreativeRecommendation,
  type CreativeReport,
  type VisitSummary,
} from '@/lib/api';

type Tab = 'dashboard' | 'images' | 'headlines' | 'combos';

const PERFORMANCE_EVENT_OPTIONS = [
  { id: 'call_click', label: 'Call Click' },
  { id: 'click_button', label: 'Click Button' },
  { id: 'lead', label: 'Lead' },
  { id: 'call_connected', label: 'Call Connected' },
  { id: 'viewcontent', label: 'View Content' },
];

const QUALITY_TONE: Record<
  CreativeQuality,
  'success' | 'warning' | 'danger' | 'neutral' | 'info'
> = {
  excellent: 'success',
  good: 'info',
  average: 'neutral',
  poor: 'warning',
  risk: 'danger',
  low_data: 'neutral',
};

const QUALITY_LABEL: Record<CreativeQuality, string> = {
  excellent: 'Top performer',
  good: 'Good',
  average: 'Average',
  poor: 'Underperforming',
  risk: 'High bot risk',
  low_data: 'Low data',
};

const SEV_TONE: Record<CreativeRecommendation['severity'], 'success' | 'warning' | 'danger' | 'info'> =
  {
    success: 'success',
    warning: 'warning',
    danger: 'danger',
    info: 'info',
  };

export default function PerformancePage() {
  const [range, setRange] = useState<DateRange>(buildPresets()[2]);
  const [campaignId, setCampaignId] = useState('');
  const [eventType, setEventType] = useState('call_click');
  const [countMode, setCountMode] = useState<'recorded' | 'sent'>('recorded');
  const [excludeBots, setExcludeBots] = useState(false);
  const [tab, setTab] = useState<Tab>('dashboard');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [summary, setSummary] = useState<VisitSummary | null>(null);
  const [report, setReport] = useState<CreativeReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const params = {
    from: range.from,
    to: range.to,
    eventType,
    countMode,
    ...(excludeBots ? { excludeBots: 'true' } : {}),
    ...(campaignId ? { campaignId } : {}),
  };

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      trackerApi.getVisitSummary(params),
      trackerApi.getCreativeReport(params),
    ])
      .then(([sum, creative]) => {
        setSummary(sum);
        setReport(creative);
        setError(null);
      })
      .catch((err) => {
        console.error(err);
        setError(formatApiError(err));
      })
      .finally(() => setLoading(false));
  }, [range, campaignId, eventType, countMode, excludeBots]);

  useEffect(() => {
    trackerApi.getCampaigns().then(setCampaigns).catch(console.error);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Loading label="Loading creative performance…" />;

  const metricLabel = report?.metricLabel ?? 'Conversion rate';
  const eventCountLabel = report?.selectedEvent.label ?? 'Events';

  return (
    <div>
      <AnalyticsTabs />
      <PageHeader
        title="Creative Performance"
        description="Image vs headline analysis with automated recommendations. Native ads use asset_id + ad_title; Facebook ads pull image, headline and CTA from the Meta Marketing API by ad_id."
      />

      <div className="mb-4 flex flex-wrap gap-3 items-center">
        <DateRangePicker value={range} onChange={setRange} />
        <ExcludeBotsToggle value={excludeBots} onChange={setExcludeBots} />
        <Button
          size="sm"
          variant="secondary"
          disabled={refreshing}
          onClick={() => {
            setRefreshing(true);
            trackerApi
              .refreshFacebookCreatives()
              .then((res) => {
                if (res.skipped) {
                  setError(res.skipped);
                  return;
                }
                load();
              })
              .catch((err) => setError(formatApiError(err)))
              .finally(() => setRefreshing(false));
          }}
        >
          {refreshing ? 'Refreshing Meta ads…' : 'Refresh Meta creatives'}
        </Button>
      </div>

      {error && (
        <div className="mb-6">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <FilterBar>
        <Select
          className="w-auto min-w-[200px]"
          value={campaignId}
          onChange={(e) => setCampaignId(e.target.value)}
        >
          <option value="">All campaigns</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select
          className="w-auto min-w-[180px]"
          value={eventType}
          onChange={(e) => setEventType(e.target.value)}
          aria-label="Optimize for event"
        >
          {PERFORMANCE_EVENT_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>
              Optimize: {opt.label}
            </option>
          ))}
        </Select>
        <Select
          className="w-auto min-w-[160px]"
          value={countMode}
          onChange={(e) => setCountMode(e.target.value as 'recorded' | 'sent')}
          aria-label="Count mode"
        >
          <option value="recorded">Recorded (all events)</option>
          <option value="sent">Postback sent only</option>
        </Select>
      </FilterBar>

      {report && report.selectedEvent.totalEvents === 0 && report.summary.totalVisits > 0 && (
        <div className="mb-6">
          <Alert tone="warning">
          <p className="text-sm font-medium">
            No {report.selectedEvent.label} events in this period
          </p>
          <p className="text-xs mt-1 opacity-90">
            {countMode === 'sent'
              ? 'No postbacks marked "sent" for this event. Switch to Recorded mode, or check Mediago postback config on the LP Funnel page.'
              : 'No events recorded in the database. Check the LP Funnel page and verify trackCallClick / registerConversion fire on your landing page.'}
          </p>
          </Alert>
        </div>
      )}

      {summary && report && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
          <StatCard label="Visits" value={summary.visits} />
          <StatCard label={metricLabel} value={`${report.benchmarks.avgCr.toFixed(2)}%`} />
          <StatCard label={`${eventCountLabel}s`} value={report.selectedEvent.totalEvents} />
          <StatCard
            label="Campaign spend"
            value={report.summary.totalSpend > 0 ? `$${report.summary.totalSpend.toFixed(2)}` : '—'}
          />
          <StatCard
            label="CPV"
            value={report.summary.totalSpend > 0 ? `$${report.summary.avgCpv.toFixed(3)}` : '—'}
          />
          <StatCard
            label="Cost / event"
            value={
              report.summary.avgCostPerEvent > 0
                ? `$${report.summary.avgCostPerEvent.toFixed(2)}`
                : '—'
            }
          />
          <StatCard label="Avg bot %" value={`${report.benchmarks.avgBotPct.toFixed(1)}%`} />
          <StatCard label="Images tracked" value={report.summary.trackedImages} />
        </div>
      )}

      {report && report.summary.totalSpend === 0 && report.summary.totalVisits > 0 && (
        <div className="mb-6">
          <Alert tone="info">
            <p className="text-xs">
              No campaign spend synced for this period. Import spend via Integrations or select a campaign with Mediago sync.
            </p>
          </Alert>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-6">
        {(
          [
            ['dashboard', 'Dashboard'],
            ['images', 'Images'],
            ['headlines', 'Headlines'],
            ['combos', 'Image × Headline'],
          ] as const
        ).map(([id, label]) => (
          <Button
            key={id}
            size="sm"
            variant={tab === id ? 'primary' : 'secondary'}
            onClick={() => setTab(id)}
          >
            {label}
          </Button>
        ))}
      </div>

      {!report || report.summary.totalVisits === 0 ? (
        <EmptyState
          title="No visit data"
          description="Ensure your Mediago click URL passes ${ASSET_ID} and ${AD_TITLE} macros."
        />
      ) : tab === 'dashboard' ? (
        <DashboardTab report={report} />
      ) : tab === 'images' ? (
        <CreativeTable
          title="Performance by image"
          subtitle="Grouped by asset_id, or by the Meta image URL when the ad was looked up from Graph."
          metricLabel={metricLabel}
          eventCountLabel={eventCountLabel}
          rows={report.images}
          extraColumns={[
            {
              header: 'CTA',
              render: (r) => r.cta || '—',
            },
            {
              header: 'Best headline',
              render: (r) =>
                r.topHeadline ? (
                  <span title={r.topHeadline}>
                    {r.topHeadline.slice(0, 40)}
                    {r.topHeadline.length > 40 ? '…' : ''}{' '}
                    <span className="text-zinc-400">({r.topHeadlineCr}%)</span>
                  </span>
                ) : (
                  '—'
                ),
            },
          ]}
        />
      ) : tab === 'headlines' ? (
        <CreativeTable
          title="Performance by headline"
          subtitle="Uses the Meta headline when cached, otherwise ad_title / ad name from the click URL."
          metricLabel={metricLabel}
          eventCountLabel={eventCountLabel}
          rows={report.headlines}
          extraColumns={[
            {
              header: 'Best image',
              render: (r) =>
                r.topImage ? (
                  <span>
                    {r.topImage}{' '}
                    <span className="text-zinc-400">({r.topImageCr}%)</span>
                  </span>
                ) : (
                  '—'
                ),
            },
          ]}
        />
      ) : (
        <ComboTable pairs={report.pairs} metricLabel={metricLabel} eventCountLabel={eventCountLabel} />
      )}
    </div>
  );
}

function DashboardTab({ report }: { report: CreativeReport }) {
  return (
    <div className="space-y-6">
      <section>
        <h2 className={`${sectionHeadingClass} mb-3`}>Recommendations</h2>
        {report.recommendations.length === 0 ? (
          <Card>
            <p className="text-sm text-zinc-500">No recommendations yet — need more traffic per creative.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {report.recommendations.map((rec) => (
              <RecommendationCard key={rec.id} rec={rec} />
            ))}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <TopList title="Top images" rows={report.images.filter((r) => r.key !== '(unknown)').slice(0, 5)} />
        <TopList title="Top headlines" rows={report.headlines.filter((r) => r.key !== '(unknown)').slice(0, 5)} />
        <TopList title="Top combos" rows={report.pairs.slice(0, 5)} isCombo />
      </div>
    </div>
  );
}

function RecommendationCard({ rec }: { rec: CreativeRecommendation }) {
  return (
    <Card className="border-l-4 border-l-indigo-400">
      <div className="flex items-start justify-between gap-2 mb-2">
        <Badge tone={SEV_TONE[rec.severity]}>{rec.category}</Badge>
        {rec.metric && <span className="text-xs font-mono text-zinc-500">{rec.metric}</span>}
      </div>
      <h3 className={`font-medium text-zinc-900 dark:text-zinc-50 text-sm`}>{rec.title}</h3>
      <p className={`text-sm text-zinc-600 dark:text-zinc-300 mt-1`}>{rec.message}</p>
      <p className="text-xs text-indigo-700 dark:text-indigo-400 mt-2 font-medium">→ {rec.action}</p>
    </Card>
  );
}

function TopList({
  title,
  rows,
  isCombo,
}: {
  title: string;
  rows: (CreativePerformanceRow | CreativePairRow)[];
  isCombo?: boolean;
}) {
  return (
    <Card>
      <h3 className={`${sectionHeadingClass} mb-3`}>{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-zinc-400">No data</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.key} className="text-xs flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1">
                <CreativeLabel
                  row={
                    isCombo && 'headlineLabel' in r
                      ? { ...r, label: `${(r as CreativePairRow).imageLabel} + ${(r as CreativePairRow).headlineLabel}` }
                      : r
                  }
                />
              </span>
              <span className="shrink-0 font-mono text-zinc-500">{r.cr}%</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function CreativeLabel({ row }: { row: Pick<CreativePerformanceRow, 'label' | 'imageUrl' | 'cta'> }) {
  return (
    <span className="inline-flex items-center gap-2 min-w-0">
      {row.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={row.imageUrl}
          alt=""
          className="h-8 w-8 rounded object-cover shrink-0 bg-zinc-100 dark:bg-zinc-800"
        />
      ) : null}
      <span className="min-w-0">
        <span className="block truncate" title={row.label}>
          {row.label}
        </span>
        {row.cta ? <span className={`block truncate ${mutedTextClass}`}>{row.cta}</span> : null}
      </span>
    </span>
  );
}

function CreativeTable({
  title,
  subtitle,
  metricLabel,
  eventCountLabel,
  rows,
  extraColumns,
}: {
  title: string;
  subtitle: string;
  metricLabel: string;
  eventCountLabel: string;
  rows: CreativePerformanceRow[];
  extraColumns?: { header: string; render: (r: CreativePerformanceRow) => ReactNode }[];
}) {
  return (
    <div>
      <h2 className={sectionHeadingClass}>{title}</h2>
      <p className={`text-xs ${mutedTextClass} mb-3`}>{subtitle}</p>
      <DataTable>
        <table className="w-full text-xs">
          <TableHead>
            <Th>Creative</Th>
            {extraColumns?.map((c) => <Th key={c.header}>{c.header}</Th>)}
            <Th>Visits</Th>
            <Th>{eventCountLabel}s</Th>
            <Th>{metricLabel}</Th>
            <Th>Spend</Th>
            <Th>CPV</Th>
            <Th>Cost / event</Th>
            <Th>Bots %</Th>
            <Th>Revenue</Th>
            <Th>EPC</Th>
            <Th>Verdict</Th>
          </TableHead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={tableRowClass}>
                <Td className="max-w-[240px] font-medium">
                  <CreativeLabel row={r} />
                </Td>
                {extraColumns?.map((c) => (
                  <Td key={c.header} className="max-w-[160px] truncate">
                    {c.render(r)}
                  </Td>
                ))}
                <Td>{r.visits}</Td>
                <Td>{r.conversions}</Td>
                <Td>{r.cr}%</Td>
                <Td>{r.spend > 0 ? `$${r.spend.toFixed(2)}` : '—'}</Td>
                <Td>{r.spend > 0 ? `$${r.cpv.toFixed(3)}` : '—'}</Td>
                <Td>{r.conversions > 0 && r.spend > 0 ? `$${r.costPerEvent.toFixed(2)}` : '—'}</Td>
                <Td>
                  <span className={parseFloat(r.botPct) >= 30 ? 'text-red-600 dark:text-red-400 font-medium' : ''}>
                    {r.botPct}%
                  </span>
                </Td>
                <Td>${r.revenue.toFixed(2)}</Td>
                <Td>${r.epc.toFixed(3)}</Td>
                <Td>
                  <Badge tone={QUALITY_TONE[r.quality]}>{QUALITY_LABEL[r.quality]}</Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <EmptyState title="No creatives" description="No asset_id or ad_title in visits." />}
      </DataTable>
    </div>
  );
}

function ComboTable({
  pairs,
  metricLabel,
  eventCountLabel,
}: {
  pairs: CreativePairRow[];
  metricLabel: string;
  eventCountLabel: string;
}) {
  return (
    <div>
      <h2 className={sectionHeadingClass}>Image × Headline combinations</h2>
      <p className={`text-xs ${mutedTextClass} mb-3`}>
        Each row is a unique image + headline pair — use this to see which combo performs best for the selected event.
      </p>
      <DataTable>
        <table className="w-full text-xs">
          <TableHead>
            <Th>Image</Th>
            <Th>Headline</Th>
            <Th>CTA</Th>
            <Th>Visits</Th>
            <Th>{eventCountLabel}s</Th>
            <Th>{metricLabel}</Th>
            <Th>Spend</Th>
            <Th>CPV</Th>
            <Th>Cost / event</Th>
            <Th>Bots %</Th>
            <Th>Revenue</Th>
            <Th>Verdict</Th>
          </TableHead>
          <tbody>
            {pairs.map((r) => (
              <tr key={r.key} className={tableRowClass}>
                <Td className="max-w-[160px]">
                  <CreativeLabel row={{ label: r.imageLabel, imageUrl: r.imageUrl }} />
                </Td>
                <Td className="max-w-[200px] truncate">
                  <span title={r.headlineLabel}>{r.headlineLabel}</span>
                </Td>
                <Td className="max-w-[100px] truncate">{r.cta || '—'}</Td>
                <Td>{r.visits}</Td>
                <Td>{r.conversions}</Td>
                <Td>{r.cr}%</Td>
                <Td>{r.spend > 0 ? `$${r.spend.toFixed(2)}` : '—'}</Td>
                <Td>{r.spend > 0 ? `$${r.cpv.toFixed(3)}` : '—'}</Td>
                <Td>{r.conversions > 0 && r.spend > 0 ? `$${r.costPerEvent.toFixed(2)}` : '—'}</Td>
                <Td>
                  <span className={parseFloat(r.botPct) >= 30 ? 'text-red-600 dark:text-red-400 font-medium' : ''}>
                    {r.botPct}%
                  </span>
                </Td>
                <Td>${r.revenue.toFixed(2)}</Td>
                <Td>
                  <Badge tone={QUALITY_TONE[r.quality]}>{QUALITY_LABEL[r.quality]}</Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
        {pairs.length === 0 && (
          <EmptyState title="No combos" description="Need visits with both asset_id and ad_title." />
        )}
      </DataTable>
    </div>
  );
}
