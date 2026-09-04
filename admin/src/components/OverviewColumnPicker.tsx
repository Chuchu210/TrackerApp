'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, linkClass } from '@/components/ui';
import {
  buildOverviewColumns,
  DEFAULT_VISIBLE_COLUMNS,
  deleteColumnTemplate,
  loadColumnTemplates,
  loadLastAppliedTemplateName,
  saveLastAppliedTemplateName,
  saveVisibleColumns,
  upsertColumnTemplate,
  type OverviewColumnDef,
  type OverviewColumnId,
  type OverviewColumnTemplate,
} from '@/lib/overview-columns';
import type { EventColumnDef } from '@/lib/api';

export function OverviewColumnPicker({
  eventColumns,
  visible,
  onChange,
  nameColumnLabel = 'Campaign name',
}: {
  eventColumns: EventColumnDef[];
  visible: Set<OverviewColumnId>;
  onChange: (next: Set<OverviewColumnId>) => void;
  nameColumnLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templates, setTemplates] = useState<OverviewColumnTemplate[]>([]);
  const [lastApplied, setLastApplied] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const allColumns = useMemo(
    () =>
      buildOverviewColumns(eventColumns).map((c) =>
        c.id === 'campaignName' ? { ...c, label: nameColumnLabel } : c,
      ),
    [eventColumns, nameColumnLabel],
  );
  const grouped = useMemo(() => {
    const groups: Record<string, OverviewColumnDef[]> = {
      core: [],
      metrics: [],
      events: [],
    };
    for (const c of allColumns) {
      groups[c.group].push(c);
    }
    return groups;
  }, [allColumns]);

  useEffect(() => {
    setTemplates(loadColumnTemplates());
    setLastApplied(loadLastAppliedTemplateName());
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const applyColumns = (next: Set<OverviewColumnId>, appliedName: string | null) => {
    onChange(next);
    saveVisibleColumns(next);
    saveLastAppliedTemplateName(appliedName);
    setLastApplied(appliedName);
  };

  const toggle = (id: OverviewColumnId) => {
    const next = new Set(visible);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    applyColumns(next, null);
  };

  const selectAll = () => {
    applyColumns(new Set(allColumns.map((c) => c.id)), null);
  };

  const resetDefault = () => {
    const ids = allColumns.map((c) => c.id);
    applyColumns(
      new Set(
        [...DEFAULT_VISIBLE_COLUMNS, ...ids.filter((id) => id.startsWith('event:'))].filter((id) =>
          ids.includes(id),
        ),
      ),
      null,
    );
  };

  const applyTemplate = (template: OverviewColumnTemplate) => {
    const valid = template.columnIds.filter((id) => allColumns.some((c) => c.id === id));
    if (valid.length === 0) return;
    applyColumns(new Set(valid), template.name);
  };

  const saveTemplate = () => {
    const name = templateName.trim();
    if (!name || visible.size === 0) return;
    const next = upsertColumnTemplate(name, [...visible]);
    setTemplates(next);
    saveLastAppliedTemplateName(name);
    setLastApplied(name);
    setTemplateName('');
  };

  const removeTemplate = (name: string) => {
    const next = deleteColumnTemplate(name);
    setTemplates(next);
    if (lastApplied === name) setLastApplied(null);
  };

  const renderGroup = (title: string, cols: OverviewColumnDef[]) => (
    <div key={title} className="mb-3">
      <p className="text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500 mb-1.5">{title}</p>
      <div className="grid grid-cols-2 gap-1">
        {cols.map((c) => (
          <Checkbox
            key={c.id}
            label={<span className="truncate">{c.label}</span>}
            checked={visible.has(c.id)}
            onChange={() => toggle(c.id)}
            className="rounded px-1 py-0.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 text-xs"
          />
        ))}
      </div>
    </div>
  );

  return (
    <div className="relative" ref={ref}>
      <Button variant="secondary" size="sm" onClick={() => setOpen((v) => !v)}>
        Columns
        <span className="ml-1 text-[10px] text-zinc-400" aria-hidden>
          ▾
        </span>
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-[420px] max-h-[70vh] overflow-y-auto bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Visible columns</p>
            <div className="flex gap-2">
              <button type="button" className={`text-xs ${linkClass}`} onClick={selectAll}>
                All
              </button>
              <button type="button" className={`text-xs ${linkClass}`} onClick={resetDefault}>
                Default
              </button>
            </div>
          </div>
          {renderGroup('Name', grouped.core)}
          {renderGroup('Metrics', grouped.metrics)}
          {grouped.events.length > 0 && renderGroup('Events', grouped.events)}

          <div className="border-t border-zinc-200 dark:border-zinc-800 pt-3 mt-1">
            <p className="text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500 mb-2">
              Templates
            </p>
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="Template name"
                className="h-8 flex-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    saveTemplate();
                  }
                }}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={saveTemplate}
                disabled={!templateName.trim() || visible.size === 0}
              >
                Save
              </Button>
            </div>
            {templates.length === 0 ? (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">No saved templates yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {templates.map((template) => (
                  <li
                    key={template.name}
                    className="flex items-center justify-between gap-2 rounded-lg px-1.5 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                  >
                    <span className="text-xs text-zinc-800 dark:text-zinc-200 truncate">
                      {template.name}
                      {lastApplied === template.name ? (
                        <span className="ml-1 text-indigo-600 dark:text-indigo-400">· applied</span>
                      ) : null}
                    </span>
                    <span className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        className={`text-xs ${linkClass}`}
                        onClick={() => applyTemplate(template)}
                      >
                        Apply
                      </button>
                      <button
                        type="button"
                        className="text-xs text-red-600 dark:text-red-400 hover:underline"
                        onClick={() => removeTemplate(template.name)}
                      >
                        Delete
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
