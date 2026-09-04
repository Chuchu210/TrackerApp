import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  CSSProperties,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ring-offset)]';

/** Shared class tokens — use instead of hardcoded light-only colors */
export const tableRowClass = 'border-b border-zinc-100 dark:border-zinc-800';
export const sectionHeadingClass = 'text-sm font-semibold text-zinc-900 dark:text-zinc-50';
export const pageTitleClass = 'text-xl font-semibold text-zinc-900 dark:text-zinc-50';
export const linkClass = 'text-indigo-600 dark:text-indigo-400 hover:underline';
export const mutedTextClass = 'text-zinc-500 dark:text-zinc-400';
export const bodyTextClass = 'text-zinc-700 dark:text-zinc-300';
export const detailRowClass =
  'bg-zinc-50/80 dark:bg-zinc-800/40 border-b border-zinc-100 dark:border-zinc-800';
export const inlineCodeClass =
  'bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 px-1.5 py-0.5 rounded-md text-xs font-mono';

export type StatCardTone =
  | 'neutral'
  | 'sky'
  | 'green'
  | 'yellow'
  | 'pink'
  | 'purple'
  | 'blue'
  | 'amber'
  | 'indigo';

const statToneStyles: Record<
  StatCardTone,
  { chip: string; icon: string; value: string }
> = {
  neutral: {
    chip: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300',
    icon: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400',
    value: 'text-zinc-900 dark:text-zinc-50',
  },
  sky: {
    chip: 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300',
    icon: 'bg-sky-100 dark:bg-sky-900/50 text-sky-600 dark:text-sky-400',
    value: 'text-sky-900 dark:text-sky-100',
  },
  green: {
    chip: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300',
    icon: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400',
    value: 'text-emerald-900 dark:text-emerald-100',
  },
  yellow: {
    chip: 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300',
    icon: 'bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400',
    value: 'text-amber-900 dark:text-amber-100',
  },
  pink: {
    chip: 'bg-pink-50 dark:bg-pink-950/40 text-pink-700 dark:text-pink-300',
    icon: 'bg-pink-100 dark:bg-pink-900/50 text-pink-600 dark:text-pink-400',
    value: 'text-pink-900 dark:text-pink-100',
  },
  purple: {
    chip: 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300',
    icon: 'bg-violet-100 dark:bg-violet-900/50 text-violet-600 dark:text-violet-400',
    value: 'text-violet-900 dark:text-violet-100',
  },
  blue: {
    chip: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300',
    icon: 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400',
    value: 'text-blue-900 dark:text-blue-100',
  },
  amber: {
    chip: 'bg-orange-50 dark:bg-orange-950/40 text-orange-800 dark:text-orange-300',
    icon: 'bg-orange-100 dark:bg-orange-900/50 text-orange-600 dark:text-orange-400',
    value: 'text-orange-900 dark:text-orange-100',
  },
  indigo: {
    chip: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300',
    icon: 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400',
    value: 'text-indigo-900 dark:text-indigo-100',
  },
};

export function PageHeader({
  title,
  description,
  action,
  meta,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{title}</h1>
          {meta}
        </div>
        <div className="mt-2 h-0.5 w-12 rounded-full gradient-accent" aria-hidden />
        {description && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-3 max-w-2xl leading-relaxed">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

export function Card({
  children,
  className = '',
  padding = true,
  elevated = false,
}: {
  children: ReactNode;
  className?: string;
  padding?: boolean;
  elevated?: boolean;
}) {
  const base = elevated
    ? 'card-elevated'
    : 'bg-white dark:bg-zinc-900 border border-zinc-200/70 dark:border-zinc-800/80 rounded-2xl shadow-[var(--shadow-sm)]';
  return (
    <div className={`${base} ${padding ? 'p-6' : ''} ${className}`}>
      {children}
    </div>
  );
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
  size?: 'sm' | 'md';
}) {
  const base = `inline-flex items-center justify-center font-medium rounded-xl transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] ${focusRing}`;
  const sizes = { sm: 'px-3.5 py-2 text-xs', md: 'px-4 py-2.5 text-sm' };
  const variants = {
    primary:
      'gradient-accent text-white shadow-md shadow-indigo-500/20 hover:shadow-lg hover:shadow-indigo-500/25 hover:brightness-105 dark:shadow-indigo-900/30',
    secondary:
      'bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 border border-zinc-200/80 dark:border-zinc-700 shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-600',
    ghost: 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100/80 dark:hover:bg-zinc-800',
    danger:
      'bg-white dark:bg-zinc-900 text-red-600 dark:text-red-400 border border-red-200/80 dark:border-red-900/50 shadow-sm hover:bg-red-50 dark:hover:bg-red-950/30',
    success:
      'bg-emerald-600 text-white shadow-md shadow-emerald-500/20 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600',
  };
  return (
    <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...props} />
  );
}

export function Badge({
  children,
  tone = 'neutral',
  dot = false,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'purple';
  dot?: boolean;
}) {
  const tones = {
    neutral: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
    success:
      'bg-emerald-50 text-emerald-700 border border-emerald-200/80 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800',
    warning:
      'bg-amber-50 text-amber-800 border border-amber-200/80 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800',
    danger:
      'bg-red-50 text-red-700 border border-red-200/80 dark:bg-red-950/50 dark:text-red-300 dark:border-red-800',
    info: 'bg-indigo-50 text-indigo-700 border border-indigo-200/80 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-800',
    purple:
      'bg-violet-50 text-violet-700 border border-violet-200/80 dark:bg-violet-950/50 dark:text-violet-300 dark:border-violet-800',
  };
  const dotColors = {
    neutral: 'bg-zinc-400',
    success: 'bg-emerald-500',
    warning: 'bg-amber-500',
    danger: 'bg-red-500',
    info: 'bg-indigo-500',
    purple: 'bg-violet-500',
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${tones[tone]}`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dotColors[tone]}`} aria-hidden />}
      {children}
    </span>
  );
}

const inputBase = `w-full h-10 bg-white dark:bg-zinc-900/80 border border-zinc-200/80 dark:border-zinc-700 rounded-xl px-3.5 text-sm text-zinc-900 dark:text-zinc-100 transition-colors ${focusRing} focus:border-indigo-400 dark:focus:border-indigo-500`;

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`${inputBase} placeholder:text-zinc-400 dark:placeholder:text-zinc-500 ${props.className || ''}`}
    />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`${inputBase} ${props.className || ''}`}
    />
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full min-h-[80px] bg-white dark:bg-zinc-900/80 border border-zinc-200/80 dark:border-zinc-700 rounded-xl px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 transition-colors ${focusRing} focus:border-indigo-400 dark:focus:border-indigo-500 ${props.className || ''}`}
    />
  );
}

export function Label({
  children,
  htmlFor,
  className = '',
  ...props
}: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      htmlFor={htmlFor}
      className={`text-xs font-semibold text-zinc-500 dark:text-zinc-400 block mb-1.5 uppercase tracking-wide ${className}`}
      {...props}
    >
      {children}
    </label>
  );
}

export function CodeBlock({ children }: { children: string }) {
  return (
    <code className="block bg-zinc-950 text-zinc-100 p-4 rounded-xl text-xs break-all font-mono leading-relaxed border border-zinc-800">
      {children}
    </code>
  );
}

export function PreBlock({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <pre
      className={`text-xs bg-zinc-50 dark:bg-zinc-900/80 text-zinc-800 dark:text-zinc-200 p-4 rounded-xl overflow-x-auto border border-zinc-200/80 dark:border-zinc-800 font-mono leading-relaxed ${className}`}
    >
      {children}
    </pre>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
  id,
  className = '',
}: {
  label?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  id?: string;
  className?: string;
}) {
  const inputId = id || (typeof label === 'string' ? label.replace(/\s+/g, '-').toLowerCase() : undefined);
  return (
    <label className={`inline-flex items-center gap-2 cursor-pointer text-sm text-zinc-700 dark:text-zinc-300 ${className}`}>
      <input
        type="checkbox"
        id={inputId}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-zinc-300 dark:border-zinc-600 text-indigo-600 focus:ring-indigo-500/40 dark:bg-zinc-900"
      />
      {label}
    </label>
  );
}

export function InlineLink({
  href,
  children,
  className = '',
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a href={href} className={`${linkClass} ${className}`} {...props}>
      {children}
    </a>
  );
}

export function SortTh({
  children,
  active,
  direction,
  onClick,
  className = '',
}: {
  children?: ReactNode;
  active?: boolean;
  direction?: 'asc' | 'desc';
  onClick?: () => void;
  className?: string;
}) {
  return (
    <th className={`text-left px-5 py-3.5 text-[11px] font-semibold uppercase tracking-wider ${className}`}>
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 transition-colors ${focusRing} ${
          active
            ? 'text-zinc-700 dark:text-zinc-200'
            : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200'
        }`}
      >
        {children}
        {active && (
          <span aria-hidden className="text-[10px]">
            {direction === 'desc' ? '↓' : '↑'}
          </span>
        )}
      </button>
    </th>
  );
}

export function Alert({
  children,
  tone = 'info',
}: {
  children: ReactNode;
  tone?: 'info' | 'warning' | 'error' | 'success';
}) {
  const tones = {
    info: 'bg-indigo-50/80 border-indigo-200/80 text-indigo-900 dark:bg-indigo-950/40 dark:border-indigo-800 dark:text-indigo-100',
    warning:
      'bg-amber-50/80 border-amber-200/80 text-amber-900 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-100',
    error: 'bg-red-50/80 border-red-200/80 text-red-900 dark:bg-red-950/40 dark:border-red-800 dark:text-red-100',
    success:
      'bg-emerald-50/80 border-emerald-200/80 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-100',
  };
  return (
    <div className={`border rounded-xl p-4 text-sm shadow-sm ${tones[tone]}`}>{children}</div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
  icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: StatCardTone;
  icon?: ReactNode;
}) {
  const styles = statToneStyles[tone];
  return (
    <div className="card-elevated p-5 group">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${styles.chip}`}>
            {label}
          </p>
          <p className={`text-2xl font-bold mt-3 tabular-nums tracking-tight ${styles.value}`}>{value}</p>
          {hint && <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1.5">{hint}</p>}
        </div>
        {icon && (
          <div className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${styles.icon}`}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}

export function Loading({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400 py-12" role="status">
      <span
        className="w-5 h-5 border-2 border-zinc-200 dark:border-zinc-700 border-t-indigo-600 dark:border-t-violet-400 rounded-full animate-spin"
        aria-hidden
      />
      {label}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="text-center py-16 px-4">
      {icon && (
        <div className="mx-auto mb-4 w-12 h-12 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-400 dark:text-zinc-500">
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{title}</p>
      {description && <p className="text-sm text-zinc-400 dark:text-zinc-500 mt-1 max-w-sm mx-auto">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function DataTable({ children }: { children: ReactNode }) {
  return (
    <Card padding={false} className="overflow-hidden">
      <div className="overflow-x-auto [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-zinc-50/60 dark:[&_tbody_tr:hover]:bg-zinc-800/40">
        {children}
      </div>
    </Card>
  );
}

export function TableHead({ children, sticky = false }: { children: ReactNode; sticky?: boolean }) {
  return (
    <thead className={sticky ? 'sticky top-0 z-10' : undefined}>
      <tr className="border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/90 dark:bg-zinc-900/90 backdrop-blur-sm">
        {children}
      </tr>
    </thead>
  );
}

export function Th({
  children,
  className = '',
  style,
}: {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <th
      style={style}
      className={`text-left px-5 py-3.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className = '',
  style,
  title,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Native tooltip — used to reveal values in truncated cells. */
  title?: string;
  onClick?: () => void;
}) {
  const interactive = Boolean(onClick);
  return (
    <td
      style={style}
      title={title}
      className={`px-5 py-3.5 text-sm text-zinc-700 dark:text-zinc-300 ${interactive ? 'cursor-pointer' : ''} ${className}`}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
    >
      {children}
    </td>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-2.5 mb-6 items-center">
      {children}
    </div>
  );
}

export function statusTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' | 'info' | 'purple' {
  const map: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'info' | 'purple'> = {
    verified: 'success',
    active: 'success',
    sent: 'success',
    pending_dns: 'warning',
    pending: 'warning',
    failed: 'danger',
    stopped: 'neutral',
    skipped: 'neutral',
    redirect: 'info',
    direct: 'purple',
  };
  return map[status] || 'neutral';
}
