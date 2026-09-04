'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { SignOutButton } from './SignOutButton';
import { NotificationBell } from './NotificationBell';
import { ThemeToggle } from './ThemeToggle';
import { useSidebar } from './SidebarContext';

type NavLink = { href: string; label: string; icon: string };
type NavGroup = { section: string; links: NavLink[] };

const groups: NavGroup[] = [
  {
    section: 'Dashboard',
    links: [
      { href: '/overview', label: 'Overview', icon: 'M3 3v18h18M7 14l4-4 4 4 5-6' },
      { href: '/insights', label: 'Insights', icon: 'M4 19V5M4 19h16M8 15l3-4 4 3 5-7' },
    ],
  },
  {
    section: 'Campaigns',
    links: [
      { href: '/', label: 'Campaigns', icon: 'M3 7h18M3 12h18M3 17h18' },
      { href: '/routing', label: 'Paths & rotation', icon: 'M6 3v12a3 3 0 0 0 3 3h6M6 3l-3 3m3-3l3 3M18 21l3-3m-3 3l-3-3' },
      { href: '/landers', label: 'Landers', icon: 'M4 4h16v16H4z M8 8h8v8H8z' },
      { href: '/offers', label: 'Offers', icon: 'M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01' },
      { href: '/affiliate-networks', label: 'Affiliate networks', icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z' },
      { href: '/domains', label: 'Domains', icon: 'M12 3l8 4v10l-8 4-8-4V7l8-4z' },
    ],
  },
  {
    section: 'Traffic',
    links: [
      { href: '/traffic-sources', label: 'Traffic Sources', icon: 'M4 6h16M4 12h16M4 18h10' },
      { href: '/integrations', label: 'Integrations', icon: 'M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83' },
    ],
  },
  {
    section: 'Analytics',
    links: [
      { href: '/traffic', label: 'Live Traffic', icon: 'M3 3v18h18M7 14l4-4 4 4 5-6' },
      { href: '/clicks', label: 'Visits', icon: 'M15 15l6 6M10 17a7 7 0 1 1 0-14 7 7 0 0 1 0 14z' },
      { href: '/performance', label: 'Performance', icon: 'M4 19h16M6 16l3-4 4 3 5-8 4 6' },
      { href: '/placements', label: 'Placements', icon: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z' },
      { href: '/funnel', label: 'LP Funnel', icon: 'M4 20V4M4 20h16M8 16l3-4 3 2 4-6' },
    ],
  },
  {
    section: 'Conversions',
    links: [
      { href: '/conversions', label: 'Conversions', icon: 'M9 12l2 2 4-4M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z' },
      { href: '/conversion-events', label: 'Event types', icon: 'M4 7h16M4 12h10M4 17h6' },
    ],
  },
  {
    section: 'Automation',
    links: [
      { href: '/rules', label: 'Rules', icon: 'M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1' },
      { href: '/alerts', label: 'Alerts', icon: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0' },
    ],
  },
  {
    section: 'Settings',
    links: [
      { href: '/settings', label: 'Settings', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' },
    ],
  },
];

function NavIcon({ d }: { d: string }) {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d={d} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Sidebar({ userEmail }: { userEmail?: string | null }) {
  const pathname = usePathname();
  const { open, close } = useSidebar();

  useEffect(() => {
    close();
  }, [pathname, close]);

  if (pathname === '/login') return null;

  return (
    <>
      {open && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          aria-label="Close navigation menu"
          onClick={close}
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-zinc-950 text-zinc-300 flex flex-col transition-transform duration-200 ease-out lg:translate-x-0 border-r border-zinc-800/80 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="Main navigation"
      >
        <div className="px-5 py-6 border-b border-zinc-800/80">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl gradient-accent flex items-center justify-center shadow-lg shadow-indigo-500/25">
              <span className="text-white text-xs font-bold">TK</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-white leading-none">Tracker</p>
              <p className="text-[10px] text-zinc-500 mt-1 uppercase tracking-widest">Admin</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-5 space-y-4 overflow-y-auto">
          <NotificationBell />
          {groups.map((group) => (
            <div key={group.section} className="space-y-1">
              <p className="px-3 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                {group.section}
              </p>
              {group.links.map((link) => {
                const active =
                  link.href === '/'
                    ? pathname === '/'
                    : pathname === link.href || pathname.startsWith(`${link.href}/`);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    aria-current={active ? 'page' : undefined}
                    className={`relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 ${
                      active
                        ? 'bg-indigo-500/10 text-white shadow-sm'
                        : 'text-zinc-400 hover:bg-zinc-900/80 hover:text-zinc-200'
                    }`}
                  >
                    {active && (
                      <span
                        className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full gradient-accent"
                        aria-hidden
                      />
                    )}
                    <NavIcon d={link.icon} />
                    {link.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="px-4 py-5 border-t border-zinc-800/80 space-y-1">
          {userEmail && (
            <p className="text-xs text-zinc-500 truncate mb-2 px-1" title={userEmail}>
              {userEmail}
            </p>
          )}
          <ThemeToggle />
          <SignOutButton />
        </div>
      </aside>
    </>
  );
}
