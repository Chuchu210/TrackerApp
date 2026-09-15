/**
 * One-line, token-free description of an error for logs and stored `lastError`.
 *
 * An AxiosError carries its request config — including `params.access_token` or a Graph `paging.next` URL
 * with the token in it — and Nest's Logger prints the whole object. Only the message, the HTTP status and
 * the Graph API error message are kept, and anything that looks like a token is masked.
 */
export function describeError(err: unknown): string {
  const e = err as {
    message?: unknown;
    response?: { status?: unknown; data?: { error?: { message?: unknown } } };
  } | null;
  const parts: string[] = [];
  const status = e?.response?.status;
  if (typeof status === 'number') parts.push(`HTTP ${status}`);
  const graphMessage = e?.response?.data?.error?.message;
  if (typeof graphMessage === 'string' && graphMessage) parts.push(graphMessage);
  else if (typeof e?.message === 'string' && e.message) parts.push(e.message);
  else if (typeof err === 'string' && err) parts.push(err);
  const text = parts.length ? parts.join(' — ') : 'unknown error';
  return text
    .replace(/(access_token|token|secret)=[^&\s"']+/gi, '$1=***')
    .replace(/\bEA[A-Za-z0-9]{20,}\b/g, '***')
    .slice(0, 500);
}
