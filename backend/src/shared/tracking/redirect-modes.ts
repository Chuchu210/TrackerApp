export type RedirectMode = 'http_302' | 'meta_refresh' | 'double_meta';

export interface RedirectResponse {
  kind: 'http' | 'html';
  /** For kind==='http': the Location URL. For kind==='html': the page body. */
  body: string;
  status: number;
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Build the redirect a click controller should send.
 *
 * - http_302: classic Location redirect (referrer = tracker domain).
 * - meta_refresh: an HTML page with a `<meta http-equiv="refresh">` and no
 *   referrer meta, so the offer does not receive the tracker/LP referrer.
 * - double_meta: meta-refresh via an intermediate step, hiding the referrer
 *   chain even from networks that read the first hop.
 *
 * The `<meta name="referrer" content="no-referrer">` tag is what actually
 * strips the referrer; the refresh performs navigation without a Location
 * header.
 */
export function buildRedirect(
  destination: string,
  mode: RedirectMode = 'http_302',
): RedirectResponse {
  if (mode === 'http_302') {
    return { kind: 'http', body: destination, status: 302 };
  }

  const safe = escapeHtmlAttr(destination);
  const jsSafe = JSON.stringify(destination);

  if (mode === 'double_meta') {
    // First hop lands on this page with no referrer, JS/meta then forwards on.
    return {
      kind: 'html',
      status: 200,
      body: `<!DOCTYPE html><html><head><meta name="referrer" content="no-referrer"><meta http-equiv="refresh" content="0;url=${safe}"><title>Redirecting…</title><script>window.location.replace(${jsSafe});</script></head><body>Redirecting…</body></html>`,
    };
  }

  return {
    kind: 'html',
    status: 200,
    body: `<!DOCTYPE html><html><head><meta name="referrer" content="no-referrer"><meta http-equiv="refresh" content="0;url=${safe}"><title>Redirecting…</title></head><body>Redirecting…</body></html>`,
  };
}
