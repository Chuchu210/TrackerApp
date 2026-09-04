'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, linkClass, mutedTextClass } from '@/components/ui';
import {
  REPORT_DIMENSIONS,
  REPORT_MENU_DIMENSIONS,
  REPORT_TAB_DIMENSIONS,
  type ReportDimensionId,
  type ReportLevel,
} from '@/lib/report-dimensions';

function toolbarLink(href: string, label: string, variant: 'success' | 'secondary' = 'secondary') {
  const base =
    'inline-flex items-center justify-center font-medium rounded-xl transition-all duration-150 px-3.5 py-2 text-xs';
  const styles =
    variant === 'success'
      ? 'bg-emerald-600 text-white shadow-md shadow-emerald-500/20 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600'
      : 'bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 border border-zinc-200/80 dark:border-zinc-700 shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-800';
  return (
    <Link href={href} className={`${base} ${styles}`}>
      {label}
    </Link>
  );
}

type MenuItem = {
  id: string;
  label: string;
  disabled?: boolean;
  active?: boolean;
  onClick: () => void;
};

function ToolbarMenu({
  label,
  disabled,
  items,
  align = 'left',
}: {
  label: string;
  disabled?: boolean;
  items: MenuItem[];
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={() => setOpen((v) => !v)}>
        {label}
        <span className="ml-0.5 text-[10px] text-zinc-400" aria-hidden>
          â–¾
        </span>
      </Button>
      {open && !disabled && (
        <div
          className={[
            'absolute z-50 mt-1 max-h-[70vh] min-w-[220px] overflow-y-auto rounded-xl border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900',
            align === 'right' ? 'right-0' : 'left-0',
          ].join(' ')}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
              className={[
                'block w-full px-3 py-2 text-left text-sm disabled:opacity-50',
                item.active
                  ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300'
                  : 'text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800',
              ].join(' ')}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function VoluumReportToolbar({
  reportLevel,
  selectedCampaign,
  selectedRowId,
  onOpenReport,
  onBackToCampaigns,
  onSelectDimension,
  onExport,
  onRefresh,
  columnsSlot,
}: {
  reportLevel: ReportLevel;
  selectedCampaign: { id: string; name: string } | null;
  selectedRowId: string | null;
  onOpenReport: () => void;
  onBackToCampaigns: () => void;
  onSelectDimension: (dimension: ReportDimensionId) => void;
  onExport: () => void;
  onRefresh: () => void;
  columnsSlot: ReactNode;
}) {
  const onDrilldown = reportLevel !== 'campaigns';
  const hasRowSelection = Boolean(selectedRowId);
  const hasCampaignContext = Boolean(selectedCampaign);

  const reportItems: MenuItem[] = REPORT_DIMENSIONS.map((dim) => ({
    id: dim.id,
    label: dim.label,
    active: reportLevel === dim.id,
    disabled: !hasCampaignContext,
    onClick: () => onSelectDimension(dim.id),
  }));

  const manageItems: MenuItem[] = [
    {
      id: 'campaigns',
      label: 'Campaigns',
      active: !onDrilldown,
      onClick: onBackToCampaigns,
    },
    ...REPORT_TAB_DIMENSIONS.map((dim) => ({
      id: dim.id,
      label: dim.label,
      active: reportLevel === dim.id,
      disabled: !hasCampaignContext,
      onClick: () => onSelectDimension(dim.id),
    })),
    ...REPORT_MENU_DIMENSIONS.map((dim) => ({
      id: dim.id,
      label: dim.label,
      active: reportLevel === dim.id,
      disabled: !hasCampaignContext,
      onClick: () => onSelectDimension(dim.id),
    })),
  ];

  return (
    <div className="border-b border-zinc-200/80 bg-zinc-50/90 dark:border-zinc-800 dark:bg-zinc-900/90">
      {onDrilldown && selectedCampaign ? (
        <div className={`flex items-center gap-2 border-b border-zinc-200/80 px-4 py-2 text-xs dark:border-zinc-800 ${mutedTextClass}`}>
          <button type="button" className={`font-medium ${linkClass}`} onClick={onBackToCampaigns}>
            Campaigns
          </button>
          <span className="text-zinc-300 dark:text-zinc-600">â€º</span>
          <span className="truncate font-medium text-zinc-800 dark:text-zinc-100">
            {selectedCampaign.name}
          </span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {toolbarLink('/tracker/campaigns', '+ Create', 'success')}
          <Button
            variant="secondary"
            size="sm"
            disabled={!hasRowSelection && !hasCampaignContext}
            onClick={onOpenReport}
          >
            Report
          </Button>
          <ToolbarMenu
            label="Report"
            disabled={!hasRowSelection && !hasCampaignContext}
            items={reportItems}
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={!hasRowSelection && !hasCampaignContext}
            onClick={onOpenReport}
          >
            Report in new tab
          </Button>
          {selectedRowId ? (
            toolbarLink(`/tracker/campaigns/${selectedRowId}`, 'Edit')
          ) : (
            <Button variant="secondary" size="sm" disabled>
              Edit
            </Button>
          )}
          <Button variant="secondary" size="sm" disabled>
            Duplicate
          </Button>
          <ToolbarMenu label="Tags" disabled items={[]} />
          <ToolbarMenu label="Actions" disabled items={[]} />
          <Button variant="ghost" size="sm" disabled>
            Update cost
          </Button>
          <Button variant="ghost" size="sm" disabled>
            Markers
          </Button>
          <Button variant="secondary" size="sm" onClick={onExport}>
            Export/Import
          </Button>
          {toolbarLink('/tracker/rules', 'Automizer rule')}
          <ToolbarMenu label="More" disabled items={[]} />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {columnsSlot}
          <ToolbarMenu label="Manage report" items={manageItems} align="right" />
          <Button variant="secondary" size="sm" onClick={onRefresh}>
            Refresh
          </Button>
          <span className={`px-1 text-xs ${mutedTextClass}`}>1 of 1</span>
        </div>
      </div>
    </div>
  );
}
