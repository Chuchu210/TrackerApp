'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { trackerApi, formatApiError } from '@/lib/api';
import { mutedTextClass } from '@/components/ui';

/**
 * Global test-mode switch, mounted on every admin page.
 *
 * While test mode is on, ingestion stamps every click and conversion as a test
 * row and the reports leave those rows out, so the pipeline — routing,
 * postbacks, Meta and OpenAI CAPI — can be exercised end to end without moving
 * a number anyone reads.
 *
 * The banner is deliberately loud while active and nearly silent otherwise:
 * the expensive mistake is not noticing the switch was left on for a week, so
 * the "on" state occupies real space on every screen.
 */
export function TestModeBanner() {
  const pathname = usePathname();
  const onLogin = pathname === '/login';

  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await trackerApi.getTestMode();
      setEnabled(res.enabled);
      setError(null);
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    // The login page has no session, so the settings call would 401 and show a
    // spurious error before anyone has signed in.
    if (onLogin) return;
    void load();
  }, [load, onLogin]);

  if (onLogin) return null;

  const toggle = async (next: boolean) => {
    setSaving(true);
    // Optimistic: the switch has to feel instant, and a failure re-reads the
    // server rather than leaving the UI asserting something that did not stick.
    setEnabled(next);
    try {
      const res = await trackerApi.setTestMode(next);
      setEnabled(res.enabled);
      setError(null);
    } catch (err) {
      setError(formatApiError(err));
      await load();
    } finally {
      setSaving(false);
    }
  };

  // Nothing to say until we know, and nothing worth a banner when it is off —
  // just a quiet affordance to turn it on.
  if (!loaded) return null;

  if (!enabled && !error) {
    return (
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          onClick={() => void toggle(true)}
          disabled={saving}
          className={`text-xs ${mutedTextClass} hover:text-amber-700 dark:hover:text-amber-400 underline underline-offset-2 decoration-dotted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 rounded`}
        >
          Activer le mode test
        </button>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="mb-4 rounded-xl border-2 border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/40 px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span
          className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500 motion-safe:animate-pulse"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            Mode test actif
          </p>
          <p className="text-xs text-amber-800/90 dark:text-amber-300/90">
            Les clics et conversions enregistrés maintenant sont marqués{' '}
            <span className="font-mono">test</span> et n&apos;apparaîtront dans aucun
            rapport. Les postbacks partent quand même vers Meta, OpenAI et les réseaux.
          </p>
          {error && (
            <p className="mt-1 text-xs font-medium text-red-700 dark:text-red-400">{error}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void toggle(false)}
          disabled={saving}
          className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-amber-50 dark:focus-visible:ring-offset-amber-950"
        >
          {saving ? 'Désactivation…' : 'Désactiver'}
        </button>
      </div>
    </div>
  );
}
