import type { Response } from 'express';
import { buildRedirect, type RedirectMode } from '../shared/tracking/redirect-modes';

/**
 * Send the redirect according to the campaign's referrer-hiding mode.
 * http_302 keeps the classic Location redirect; meta/double_meta return an
 * HTML page that navigates without leaking the tracker referrer.
 */
export function sendRedirect(
  res: Response,
  destination: string,
  mode?: string | null,
) {
  const redirect = buildRedirect(destination, (mode as RedirectMode) || 'http_302');
  if (redirect.kind === 'http') {
    return res.redirect(redirect.status, redirect.body);
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(redirect.status).send(redirect.body);
}
