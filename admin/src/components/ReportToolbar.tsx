'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui';
import {
  REPORT_DIMENSIONS,
  REPORT_MENU_DIMENSIONS,
  REPORT_TAB_DIMENSIONS,
  type ReportDimensionId,
  type ReportLevel,
} from '@/lib/report-dimensions';

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
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        <span className="ml-1 text-[10px] text-zinc-400" aria-hidden>
          ▾
        </span>
      </Button>
      {open && !disabled && (
        <div
          className={[
            'absolute z-40 mt-1 max-h-[70vh] min-w-[220px] overflow-y-auto origin-top rounded-xl border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900',
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

export function ReportToolbar({
  reportLevel,
  selectedCampaign,
  onSelectDimension,
  onManageCampaigns,
  columnsSlot,
}: {
  reportLevel: ReportLevel;
  selectedCampaign: { id: string; name: string } | null;
  onSelectDimension: (dimension: ReportDimensionId) => void;
  onManageCampaigns: () => void;
  columnsSlot: ReactNode;
}) {
  const hasSelection = Boolean(selectedCampaign);
  const onDrilldown = reportLevel !== 'campaigns';

  const reportItems: MenuItem[] = REPORT_DIMENSIONS.map((dim) => ({
    id: dim.id,
    label: dim.label,
    active: reportLevel === dim.id,
    disabled: !hasSelection,
    onClick: () => onSelectDimension(dim.id),
  }));

  const manageItems: MenuItem[] = [
    {
      id: 'campaigns',
      label: 'Campaigns',
      active: !onDrilldown,
      onClick: onManageCampaigns,
    },
    ...REPORT_TAB_DIMENSIONS.map((dim) => ({
      id: dim.id,
      label: dim.label,
      active: reportLevel === dim.id,
      disabled: !hasSelection,
      onClick: () => onSelectDimension(dim.id),
    })),
    ...REPORT_MENU_DIMENSIONS.map((dim) => ({
      id: dim.id,
      label: dim.label,
      active: reportLevel === dim.id,
      disabled: !hasSelection,
      onClick: () => onSelectDimension(dim.id),
    })),
  ];

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-xl border border-zinc-200/80 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-900">
      <ToolbarMenu
        label="Report"
        disabled={!hasSelection}
        items={reportItems}
      />
      {columnsSlot}
      <ToolbarMenu
        label="Manage report"
        disabled={!hasSelection && !onDrilldown}
        items={manageItems}
        align="right"
      />
    </div>
  );
}

export type { ReportLevel };
