'use client';

import {
  REPORT_TAB_DIMENSIONS,
  type ReportDimensionId,
} from '@/lib/report-dimensions';

export function ReportDimensionTabs({
  active,
  disabled,
  onSelect,
}: {
  active: ReportDimensionId;
  disabled?: boolean;
  onSelect: (dimension: ReportDimensionId) => void;
}) {
  return (
    <div className="overflow-x-auto border-b border-zinc-200/80 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-900/60">
      <div className="flex min-w-max gap-1 px-2 py-1">
        {REPORT_TAB_DIMENSIONS.map((dim) => {
          const selected = active === dim.id;
          return (
            <button
              key={dim.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(dim.id)}
              className={[
                'rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors disabled:opacity-50',
                selected
                  ? 'bg-white text-indigo-700 shadow-sm dark:bg-zinc-800 dark:text-indigo-300'
                  : 'text-zinc-500 hover:bg-white/80 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200',
              ].join(' ')}
            >
              {dim.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
