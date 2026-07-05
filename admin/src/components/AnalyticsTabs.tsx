'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/traffic', label: 'Live traffic' },
  { href: '/clicks', label: 'Visits' },
  { href: '/performance', label: 'Performance' },
  { href: '/placements', label: 'Placements' },
  { href: '/funnel', label: 'LP funnel' },
];

/** Shared sub-nav so the analytics pages read as one workspace with tabs. */
export function AnalyticsTabs() {
  const pathname = usePathname();
  return (
    <div className="flex flex-wrap gap-1 mb-6 border-b border-zinc-200 dark:border-zinc-800">
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              active
                ? 'border-indigo-500 text-zinc-900 dark:text-zinc-50'
                : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
