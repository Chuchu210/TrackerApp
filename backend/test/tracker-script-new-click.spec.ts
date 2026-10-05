import { runInNewContext } from 'node:vm';
import { TrackerScriptService } from '../src/tracker-script/tracker-script.service';

/**
 * 05/10/2026, Bing: 6 billed clicks, 6 page hits, 5 tracker visits - a second ad/sitelink click by the same person
 * (new msclkid) was merged into the first visit because the 24 h tk-cid cookie existed. A new ad click id must start
 * a new visit; a reload (same id) or internal navigation (no id) must not.
 */
function run(opts: { search: string; cookie?: string; store?: Record<string, string> }) {
  const js = new TrackerScriptService({ get: () => 'https://track.example.com' } as never).getScript();
  const store: Record<string, string> = { ...(opts.store || {}) };
  const visits: unknown[] = [];
  let cookie = opts.cookie || '';
  const tag = {
    src: 'https://track.example.com/t/tracker.js',
    getAttribute: (n: string) => ({ 'data-campaign': 'water-damage-la', 'data-mode': 'direct', 'data-no-viewcontent': 'true' } as Record<string, string>)[n] ?? null,
  };
  const document = {
    currentScript: tag,
    get cookie() { return cookie; },
    set cookie(v: string) {
      const [pair] = v.split(';');
      const [name] = pair.split('=');
      const rest = cookie.split('; ').filter((c) => c && !c.startsWith(name + '='));
      if (!/expires=Thu, 01 Jan 1970/.test(v)) rest.push(pair);
      cookie = rest.join('; ');
    },
    querySelector: () => tag,
    getElementsByTagName: () => [tag],
    addEventListener: () => undefined,
  };
  const localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: unknown) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
  };
  const fetch = (url: string, init: { body?: string }) => {
    if (url.endsWith('/t/visit')) visits.push(JSON.parse(init.body || '{}'));
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ clickId: 'new-cid', visitorId: 'v1' }), clone() { return this; } });
  };
  const window: Record<string, unknown> = {
    location: { search: opts.search, protocol: 'https:', href: 'https://site.example/' + opts.search },
    addEventListener: () => undefined,
  };
  window.fetch = fetch;
  runInNewContext(js, { window, document, localStorage, encodeURIComponent, decodeURIComponent, URLSearchParams, URL, fetch, Date, JSON, Promise, setTimeout, clearTimeout });
  return { visits, store, getCookie: () => cookie };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('tracker.js: a new ad click starts a new visit', () => {
  it('new msclkid while an older visit is in the cookie -> new /t/visit, and the click id is remembered', async () => {
    const r = run({ search: '?utm_source=bing&msclkid=bbb', cookie: 'tk-cid=old-cid', store: { 'tk-xid': 'msclkid:aaa' } });
    expect(r.visits).toHaveLength(1);
    await flush(); await flush();
    expect(r.store['tk-xid']).toBe('msclkid:bbb');
    expect(r.getCookie()).toContain('tk-cid=new-cid');
  });

  it('same msclkid (reload / back button) -> no new visit', () => {
    const r = run({ search: '?msclkid=aaa', cookie: 'tk-cid=old-cid', store: { 'tk-xid': 'msclkid:aaa' } });
    expect(r.visits).toHaveLength(0);
  });

  it('no ad click id (internal navigation) -> keeps the current visit', () => {
    const r = run({ search: '', cookie: 'tk-cid=old-cid', store: { 'tk-xid': 'msclkid:aaa' } });
    expect(r.visits).toHaveLength(0);
  });

  it('first visit from an ad -> one visit', () => {
    const r = run({ search: '?gclid=g1' });
    expect(r.visits).toHaveLength(1);
  });
});
