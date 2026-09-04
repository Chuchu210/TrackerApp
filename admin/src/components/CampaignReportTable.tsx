'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Badge, TableHead, Td, Th, tableRowClass } from '@/components/ui';
import type { CampaignReportRow, EventColumnDef } from '@/lib/api';
import {
  clampWidth,
  DEFAULT_COLUMN_WIDTHS,
  eventCountColumnId,
  eventRevenueColumnId,
  loadColumnWidths,
  saveColumnWidths,
  type OverviewColumnId,
} from '@/lib/overview-columns';

function safeNum(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function fmtMoney(n: unknown) {
  return `â‚¬${safeNum(n).toFixed(4)}`;
}

function fmtPct(n: unknown) {
  return `${safeNum(n).toFixed(2)}%`;
}

function fmtInt(n: unknown) {
  return safeNum(n).toLocaleString('en-US');
}

type SortKey = OverviewColumnId;

function getSortValue(row: CampaignReportRow, key: SortKey): number | string {
  if (key.startsWith('event:')) {
    const [, slug, kind] = key.split(':');
    const counts = row.countByEvent ?? {};
    const revenues = row.revenueByEvent ?? {};
    if (kind === 'count') return counts[slug] || 0;
    return revenues[slug] || 0;
  }
  if (key === 'suspiciousVisits') return parseFloat(row.suspiciousPct);
  const v = (row as unknown as Record<string, unknown>)[key];
  if (typeof v === 'number') return v;
  return String(v ?? '');
}

function rowStatusTone(row: CampaignReportRow): 'green' | 'red' | 'yellow' {
  const suspicious = parseFloat(row.suspiciousPct);
  if (suspicious >= 5) return 'yellow';
  if (safeNum(row.profit) < 0) return 'red';
  return 'green';
}

function FilterFunnel({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = value.trim().length > 0;

  return (
    <div className="relative inline-flex">
      <button
        type="button"
        aria-label="Filter column"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={[
          'ml-1 inline-flex h-4 w-4 items-center justify-center rounded text-[10px]',
          active
            ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
            : 'text-zinc-400 hover:bg-zinc-200/80 hover:text-zinc-600 dark:hover:bg-zinc-700',
        ].join(' ')}
      >
        â–¾
      </button>
      {open ? (
        <div
          className="absolute left-0 top-full z-30 mt-1 w-40 rounded-xl border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            autoFocus
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Filterâ€¦"
            className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800"
          />
          {active ? (
            <button
              type="button"
              className="mt-1 text-xs text-indigo-600 hover:underline dark:text-indigo-400"
              onClick={() => onChange('')}
            >
              Clear
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SuspiciousCell({ visits, pct }: { visits: number; pct: string }) {
  const value = parseFloat(pct);
  return (
    <div className="flex items-center gap-2">
      <span>{visits}</span>
      {value === 0 ? (
        <Badge tone="success">Clean</Badge>
      ) : (
        <Badge tone={value >= 10 ? 'danger' : 'warning'}>{pct}%</Badge>
      )}
    </div>
  );
}

function ResizableNameTh({
  width,
  onResize,
  children,
}: {
  width: number;
  onResize: (width: number) => void;
  children: ReactNode;
}) {
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { startX: e.clientX, startWidth: width };

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      onResize(
        clampWidth('campaignName', dragRef.current.startWidth + ev.clientX - dragRef.current.startX),
      );
    };

    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <Th className="relative select-none" style={{ width, minWidth: width }}>
      {children}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize column"
        onMouseDown={onMouseDown}
        className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize touch-none hover:bg-indigo-300/60 dark:hover:bg-indigo-500/40"
      />
    </Th>
  );
}

export function CampaignReportTable({
  rows,
  eventColumns,
  visibleColumns,
  nameColumnLabel = 'Campaign name',
  showCampaignMeta = true,
  selectable = false,
  selectedId = null,
  onSelect,
}: {
  rows: CampaignReportRow[];
  eventColumns: EventColumnDef[];
  visibleColumns: Set<OverviewColumnId>;
  nameColumnLabel?: string;
  showCampaignMeta?: boolean;
  selectable?: boolean;
  selectedId?: string | null;
  onSelect?: (row: CampaignReportRow | null) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('visits');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [columnWidths, setColumnWidths] = useState(DEFAULT_COLUMN_WIDTHS);

  useEffect(() => {
    setColumnWidths(loadColumnWidths());
  }, []);

  const setNameWidth = useCallback((width: number) => {
    setColumnWidths((prev) => {
      const next = { ...prev, campaignName: clampWidth('campaignName', width) };
      saveColumnWidths(next);
      return next;
    });
  }, []);

  const nameWidth = columnWidths.campaignName;
  const nameMultiline = nameWidth >= 360;

  const visible = (id: OverviewColumnId) => visibleColumns.has(id);

  const setFilter = (key: string, value: string) => {
    setColumnFilters((prev) => ({ ...prev, [key]: value }));
  };

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      for (const [key, raw] of Object.entries(columnFilters)) {
        const q = raw.trim().toLowerCase();
        if (!q) continue;
        const val = String(getSortValue(row, key as SortKey)).toLowerCase();
        if (!val.includes(q)) return false;
      }
      return true;
    });
  }, [rows, columnFilters]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = getSortValue(a, sortKey);
      const bv = getSortValue(b, sortKey);
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  const totals = useMemo(() => {
    const sum = (key: SortKey) =>
      filtered.reduce((acc, row) => acc + safeNum(getSortValue(row, key)), 0);
    return {
      visits: sum('visits'),
      uniqueVisits: sum('uniqueVisits'),
      suspiciousVisits: sum('suspiciousVisits'),
      conversions: sum('conversions'),
      cost: sum('cost'),
      revenue: sum('revenue'),
      profit: sum('profit'),
      errors: sum('errors'),
    };
  }, [filtered]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const sortBtn = (key: SortKey, label: string) => (
    <button
      type="button"
      className="inline-flex items-center hover:text-zinc-900 dark:hover:text-zinc-100"
      onClick={() => toggleSort(key)}
    >
      {label}
      {sortKey === key ? (sortDir === 'asc' ? ' â†‘' : ' â†“') : ''}
      <FilterFunnel value={columnFilters[key] || ''} onChange={(v) => setFilter(key, v)} />
    </button>
  );

  const eventColBySlug = useMemo(() => {
    const map = new Map<string, EventColumnDef>();
    for (const c of eventColumns) map.set(c.slug, c);
    return map;
  }, [eventColumns]);

  const visibleEventSlugs = useMemo(() => {
    const slugs = new Set<string>();
    for (const id of visibleColumns) {
      if (id.startsWith('event:')) {
        const [, slug] = id.split(':');
        slugs.add(slug);
      }
    }
    return [...slugs].sort((a, b) => {
      const ai = eventColumns.findIndex((c) => c.slug === a);
      const bi = eventColumns.findIndex((c) => c.slug === b);
      return ai - bi;
    });
  }, [visibleColumns, eventColumns]);

  if (visibleColumns.size === 0) {
    return (
      <p className="p-6 text-sm text-zinc-500 dark:text-zinc-400">
        No columns selected. Use the Columns button to choose metrics.
      </p>
    );
  }

  const selectRow = (row: CampaignReportRow) => {
    if (!selectable) return;
    onSelect?.(selectedId === row.campaignId ? null : row);
  };

  const metaCols =
    (showCampaignMeta && visible('marker') ? 1 : 0) +
    (showCampaignMeta && visible('campaignId') ? 1 : 0);

  const footerCell = (content: ReactNode, className = '') => (
    <td
      className={`px-4 py-2.5 text-xs font-semibold text-zinc-600 dark:text-zinc-300 ${className}`}
    >
      {content}
    </td>
  );

  return (
    <div className="overflow-x-auto [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-zinc-50/60 dark:[&_tbody_tr:hover]:bg-zinc-800/40">
      <table className="w-full min-w-[900px] text-xs">
        <TableHead>
            {selectable ? <Th className="w-10"> </Th> : null}
            {visible('campaignName') && (
              <ResizableNameTh width={nameWidth} onResize={setNameWidth}>
                {sortBtn('campaignName', nameColumnLabel)}
              </ResizableNameTh>
            )}
            {showCampaignMeta && visible('marker') && (
              <Th>{sortBtn('marker', 'Marker: Campaign')}</Th>
            )}
            {showCampaignMeta && visible('campaignId') && (
              <Th>{sortBtn('campaignId', 'Campaign ID')}</Th>
            )}
            {visible('cpc') && <Th>{sortBtn('cpc', 'CPC')}</Th>}
            {visible('visits') && <Th>{sortBtn('visits', 'Visits')}</Th>}
            {visible('uniqueVisits') && <Th>{sortBtn('uniqueVisits', 'Unique visits')}</Th>}
            {visible('suspiciousVisits') && <Th>Suspicious visits</Th>}
            {visible('conversions') && <Th>{sortBtn('conversions', 'Conversions')}</Th>}
            {visible('cost') && <Th>{sortBtn('cost', 'Cost')}</Th>}
            {visible('revenue') && <Th>{sortBtn('revenue', 'Revenue')}</Th>}
            {visible('profit') && <Th>{sortBtn('profit', 'Profit')}</Th>}
            {visible('roi') && <Th>{sortBtn('roi', 'ROI')}</Th>}
            {visible('cv') && <Th>{sortBtn('cv', 'CV')}</Th>}
            {visible('epv') && <Th>{sortBtn('epv', 'EPV')}</Th>}
            {visible('cpv') && <Th>{sortBtn('cpv', 'CPV')}</Th>}
            {visible('errors') && <Th>{sortBtn('errors', 'Errors')}</Th>}
            {visible('ecpc') && <Th>{sortBtn('ecpc', 'eCPC')}</Th>}
            {visible('txTransfo') && <Th>{sortBtn('txTransfo', 'Tx Transfo')}</Th>}
            {visibleEventSlugs.flatMap((slug) => {
              const col = eventColBySlug.get(slug);
              if (!col) return [];
              const headers = [];
              if (visible(eventCountColumnId(slug))) {
                headers.push(
                  <Th key={`${slug}-count`}>{sortBtn(eventCountColumnId(slug), col.countLabel || slug)}</Th>,
                );
              }
              if (visible(eventRevenueColumnId(slug))) {
                headers.push(
                  <Th key={`${slug}-revenue`}>
                    {sortBtn(
                      eventRevenueColumnId(slug),
                      col.revenueLabel || `${col.countLabel || slug} revenue`,
                    )}
                  </Th>,
                );
              }
              return headers;
            })}
        </TableHead>
        <tbody>
          {sorted.map((row) => {
            const selected = selectable && selectedId === row.campaignId;
            const tone = rowStatusTone(row);
            const toneClass =
              tone === 'green'
                ? 'bg-emerald-500'
                : tone === 'red'
                  ? 'bg-red-500'
                  : 'bg-amber-400';

            return (
              <tr
                key={row.campaignId}
                className={[
                  tableRowClass,
                  selectable ? 'cursor-pointer' : '',
                  selected ? 'bg-indigo-50/80 dark:bg-indigo-950/40' : '',
                ].join(' ')}
                onClick={() => selectRow(row)}
              >
                {selectable ? (
                  <Td className="w-10">
                    <div className="flex items-center gap-2">
                      <div className={`h-4 w-1 shrink-0 rounded-full ${toneClass}`} aria-hidden />
                      <input
                        type="checkbox"
                        checked={selected}
                        aria-label={`Select ${row.campaignName}`}
                        onChange={() => selectRow(row)}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500/40 dark:border-zinc-600 dark:bg-zinc-900"
                      />
                    </div>
                  </Td>
                ) : null}
                {visible('campaignName') && (
                  <Td
                    title={row.campaignName}
                    style={{ width: nameWidth, minWidth: nameWidth }}
                    className={[
                      'font-medium',
                      nameMultiline ? 'whitespace-normal break-words' : 'max-w-0 truncate',
                    ].join(' ')}
                  >
                    {row.campaignName}
                  </Td>
                )}
                {showCampaignMeta && visible('marker') && (
                  <Td>{row.marker || 'â€”'}</Td>
                )}
                {showCampaignMeta && visible('campaignId') && (
                  <Td className="max-w-[180px] truncate font-mono text-[10px] text-zinc-500">
                    {row.campaignId}
                  </Td>
                )}
                {visible('cpc') && <Td className="font-mono">{fmtMoney(row.cpc)}</Td>}
                {visible('visits') && <Td>{fmtInt(row.visits)}</Td>}
                {visible('uniqueVisits') && <Td>{fmtInt(row.uniqueVisits)}</Td>}
                {visible('suspiciousVisits') && (
                  <Td>
                    <SuspiciousCell visits={row.suspiciousVisits} pct={row.suspiciousPct} />
                  </Td>
                )}
                {visible('conversions') && <Td>{fmtInt(row.conversions)}</Td>}
                {visible('cost') && <Td className="font-mono">{fmtMoney(row.cost)}</Td>}
                {visible('revenue') && <Td className="font-mono">{fmtMoney(row.revenue)}</Td>}
                {visible('profit') && (
                  <Td
                    className={`font-mono ${safeNum(row.profit) < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}
                  >
                    {fmtMoney(row.profit)}
                  </Td>
                )}
                {visible('roi') && (
                  <Td
                    className={`font-mono ${safeNum(row.roi) < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}
                  >
                    {fmtPct(row.roi)}
                  </Td>
                )}
                {visible('cv') && <Td className="font-mono">{fmtPct(row.cv)}</Td>}
                {visible('epv') && <Td className="font-mono">{fmtMoney(row.epv)}</Td>}
                {visible('cpv') && <Td className="font-mono">{fmtMoney(row.cpv)}</Td>}
                {visible('errors') && <Td>{fmtInt(row.errors)}</Td>}
                {visible('ecpc') && <Td className="font-mono">{fmtMoney(row.ecpc)}</Td>}
                {visible('txTransfo') && <Td className="font-mono">{fmtPct(row.txTransfo)}</Td>}
                {visibleEventSlugs.flatMap((slug) => {
                  const cells = [];
                  if (visible(eventCountColumnId(slug))) {
                    cells.push(
                      <Td key={`${slug}-count`}>
                        {row.countByEvent?.[slug] || 0}
                      </Td>,
                    );
                  }
                  if (visible(eventRevenueColumnId(slug))) {
                    cells.push(
                      <Td key={`${slug}-revenue`} className="font-mono">
                        {fmtMoney(row.revenueByEvent?.[slug] || 0)}
                      </Td>,
                    );
                  }
                  return cells;
                })}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-zinc-200 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-900/60">
            {selectable ? footerCell('') : null}
            <td
              colSpan={1 + metaCols}
              className="px-4 py-2.5 text-xs font-semibold text-zinc-600 dark:text-zinc-300"
            >
              Total ({filtered.length} rows)
            </td>
            {visible('cpc') && footerCell('')}
            {visible('visits') && footerCell(fmtInt(totals.visits))}
            {visible('uniqueVisits') && footerCell(fmtInt(totals.uniqueVisits))}
            {visible('suspiciousVisits') && footerCell(fmtInt(totals.suspiciousVisits))}
            {visible('conversions') && footerCell(fmtInt(totals.conversions))}
            {visible('cost') && footerCell(fmtMoney(totals.cost), 'font-mono')}
            {visible('revenue') && footerCell(fmtMoney(totals.revenue), 'font-mono')}
            {visible('profit') && footerCell(fmtMoney(totals.profit), 'font-mono')}
            {visible('roi') && footerCell('')}
            {visible('cv') && footerCell('')}
            {visible('epv') && footerCell('')}
            {visible('cpv') && footerCell('')}
            {visible('errors') && footerCell(fmtInt(totals.errors))}
            {visible('ecpc') && footerCell('')}
            {visible('txTransfo') && footerCell('')}
            {visibleEventSlugs.flatMap((slug) => {
              const cells = [];
              if (visible(eventCountColumnId(slug))) cells.push(<td key={`${slug}-count`} />);
              if (visible(eventRevenueColumnId(slug))) cells.push(<td key={`${slug}-rev`} />);
              return cells;
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
