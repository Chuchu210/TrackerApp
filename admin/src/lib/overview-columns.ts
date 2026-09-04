import type { EventColumnDef } from './api';

export type OverviewColumnId = string;

export type OverviewColumnDef = {
  id: OverviewColumnId;
  label: string;
  group: 'core' | 'metrics' | 'events';
};

const CORE_COLUMNS: OverviewColumnDef[] = [
  { id: 'campaignName', label: 'Campaign name', group: 'core' },
  { id: 'marker', label: 'Marker: Campaign', group: 'core' },
  { id: 'campaignId', label: 'Campaign ID', group: 'core' },
  { id: 'cpc', label: 'CPC', group: 'core' },
  { id: 'visits', label: 'Visits', group: 'core' },
  { id: 'uniqueVisits', label: 'Unique visits', group: 'core' },
  { id: 'suspiciousVisits', label: 'Suspicious visits', group: 'core' },
  { id: 'conversions', label: 'Conversions', group: 'core' },
  { id: 'cost', label: 'Cost', group: 'core' },
  { id: 'revenue', label: 'Revenue', group: 'core' },
  { id: 'profit', label: 'Profit', group: 'core' },
  { id: 'roi', label: 'ROI', group: 'metrics' },
  { id: 'cv', label: 'CV', group: 'metrics' },
  { id: 'epv', label: 'EPV', group: 'metrics' },
  { id: 'cpv', label: 'CPV', group: 'metrics' },
  { id: 'errors', label: 'Errors', group: 'metrics' },
  { id: 'ecpc', label: 'eCPC', group: 'metrics' },
  { id: 'txTransfo', label: 'Tx Transfo', group: 'metrics' },
];

const STORAGE_KEY = 'overview-visible-columns';
const TEMPLATES_STORAGE_KEY = 'overview-column-templates';
const LAST_TEMPLATE_STORAGE_KEY = 'overview-column-template-last';
const WIDTHS_STORAGE_KEY = 'overview-column-widths';

export type ResizableColumnId = 'campaignName';

export const DEFAULT_COLUMN_WIDTHS: Record<ResizableColumnId, number> = {
  campaignName: 280,
};

export const COLUMN_WIDTH_LIMITS: Record<
  ResizableColumnId,
  { min: number; max: number }
> = {
  campaignName: { min: 140, max: 640 },
};

export function loadColumnWidths(): Record<ResizableColumnId, number> {
  if (typeof window === 'undefined') return { ...DEFAULT_COLUMN_WIDTHS };
  try {
    const raw = localStorage.getItem(WIDTHS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_COLUMN_WIDTHS };
    const parsed = JSON.parse(raw) as Partial<Record<ResizableColumnId, number>>;
    return {
      campaignName: clampWidth(
        'campaignName',
        parsed.campaignName ?? DEFAULT_COLUMN_WIDTHS.campaignName,
      ),
    };
  } catch {
    return { ...DEFAULT_COLUMN_WIDTHS };
  }
}

export function saveColumnWidths(widths: Record<ResizableColumnId, number>) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(WIDTHS_STORAGE_KEY, JSON.stringify(widths));
}

export function clampWidth(column: ResizableColumnId, value: number) {
  const { min, max } = COLUMN_WIDTH_LIMITS[column];
  return Math.max(min, Math.min(max, Math.round(value)));
}

export type OverviewColumnTemplate = {
  name: string;
  columnIds: OverviewColumnId[];
};

export const DEFAULT_VISIBLE_COLUMNS: OverviewColumnId[] = [
  'campaignName',
  'marker',
  'campaignId',
  'cpc',
  'visits',
  'uniqueVisits',
  'suspiciousVisits',
  'conversions',
  'cost',
  'revenue',
  'profit',
  'roi',
  'cv',
  'epv',
  'cpv',
  'errors',
  'ecpc',
  'txTransfo',
];

export function eventCountColumnId(slug: string) {
  return `event:${slug}:count`;
}

export function eventRevenueColumnId(slug: string) {
  return `event:${slug}:revenue`;
}

export function buildOverviewColumns(eventColumns: EventColumnDef[]): OverviewColumnDef[] {
  const eventCols: OverviewColumnDef[] = [];
  for (const e of eventColumns) {
    if (!e?.slug) continue;
    const countLabel = e.countLabel || e.slug;
    const revenueLabel = e.revenueLabel || `${countLabel} revenue`;
    eventCols.push({
      id: eventCountColumnId(e.slug),
      label: countLabel,
      group: 'events',
    });
    eventCols.push({
      id: eventRevenueColumnId(e.slug),
      label: revenueLabel,
      group: 'events',
    });
  }
  return [...CORE_COLUMNS, ...eventCols];
}

export function loadVisibleColumns(allColumnIds: OverviewColumnId[]): Set<OverviewColumnId> {
  if (typeof window === 'undefined') {
    return new Set(DEFAULT_VISIBLE_COLUMNS.filter((id) => allColumnIds.includes(id)));
  }
  try {
    const lastName = loadLastAppliedTemplateName();
    if (lastName) {
      const template = loadColumnTemplates().find((t) => t.name === lastName);
      const valid = template?.columnIds.filter((id) => allColumnIds.includes(id)) ?? [];
      if (valid.length > 0) return new Set(valid);
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const defaults = new Set(
        [...DEFAULT_VISIBLE_COLUMNS, ...allColumnIds.filter((id) => id.startsWith('event:'))].filter((id) =>
          allColumnIds.includes(id),
        ),
      );
      return defaults;
    }
    const parsed = JSON.parse(raw) as OverviewColumnId[];
    const valid = parsed.filter((id) => allColumnIds.includes(id));
    return valid.length > 0 ? new Set(valid) : new Set(allColumnIds);
  } catch {
    return new Set(allColumnIds);
  }
}

export function saveVisibleColumns(visible: Set<OverviewColumnId>) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...visible]));
}

export function loadColumnTemplates(): OverviewColumnTemplate[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(TEMPLATES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as OverviewColumnTemplate[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t) =>
        t &&
        typeof t.name === 'string' &&
        t.name.trim() &&
        Array.isArray(t.columnIds),
    );
  } catch {
    return [];
  }
}

export function saveColumnTemplates(templates: OverviewColumnTemplate[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
}

export function upsertColumnTemplate(
  name: string,
  columnIds: OverviewColumnId[],
): OverviewColumnTemplate[] {
  const trimmed = name.trim();
  if (!trimmed) return loadColumnTemplates();
  const next = loadColumnTemplates().filter(
    (t) => t.name.toLowerCase() !== trimmed.toLowerCase(),
  );
  next.push({ name: trimmed, columnIds: [...columnIds] });
  next.sort((a, b) => a.name.localeCompare(b.name));
  saveColumnTemplates(next);
  return next;
}

export function deleteColumnTemplate(name: string): OverviewColumnTemplate[] {
  const next = loadColumnTemplates().filter((t) => t.name !== name);
  saveColumnTemplates(next);
  if (loadLastAppliedTemplateName() === name) {
    saveLastAppliedTemplateName(null);
  }
  return next;
}

export function loadLastAppliedTemplateName(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(LAST_TEMPLATE_STORAGE_KEY);
}

export function saveLastAppliedTemplateName(name: string | null) {
  if (typeof window === 'undefined') return;
  if (!name) {
    localStorage.removeItem(LAST_TEMPLATE_STORAGE_KEY);
    return;
  }
  localStorage.setItem(LAST_TEMPLATE_STORAGE_KEY, name);
}
