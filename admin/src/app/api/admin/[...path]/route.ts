import { auth } from '@/auth';
import type { NextRequest } from 'next/server';

const TRACKER_API_URL = process.env.TRACKER_API_URL || 'http://localhost:3001';
const API_KEY = process.env.TRACKER_API_KEY || 'dev-api-key-change-me';

async function proxy(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const { path } = await context.params;
  const target = new URL(`/api/${path.join('/')}`, TRACKER_API_URL);
  req.nextUrl.searchParams.forEach((value, key) => {
    target.searchParams.set(key, value);
  });

  const headers = new Headers();
  headers.set('x-api-key', API_KEY);
  // Qui agit : l'API journalise l'acteur d'un effacement de lead (données personnelles).
  if (session.user.email) headers.set('x-admin-user', session.user.email);
  const contentType = req.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const isMultipart = contentType?.includes('multipart/form-data');
  const body = hasBody
    ? isMultipart
      ? await req.arrayBuffer()
      : await req.text()
    : undefined;

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      method: req.method,
      headers,
      body,
    });
  } catch {
    return Response.json(
      { message: 'Tracker API unreachable. Is the backend running?' },
      { status: 502 },
    );
  }

  const upstreamType = upstream.headers.get('content-type') || 'application/json';
  const isBinary =
    upstreamType.includes('application/zip') ||
    upstreamType.includes('application/octet-stream');

  if (isBinary) {
    const buffer = await upstream.arrayBuffer();
    const outHeaders = new Headers({ 'content-type': upstreamType });
    const disposition = upstream.headers.get('content-disposition');
    if (disposition) outHeaders.set('content-disposition', disposition);
    // L'export des leads pose « ne pas mettre en cache » exprès : un fichier de coordonnées n'a rien à faire dans le
    // cache du navigateur ni dans celui d'un proxy.
    const cache = upstream.headers.get('cache-control');
    if (cache) outHeaders.set('cache-control', cache);
    return new Response(buffer, { status: upstream.status, headers: outHeaders });
  }

  const text = await upstream.text();

  return new Response(text, {
    status: upstream.status,
    headers: { 'content-type': upstreamType },
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
