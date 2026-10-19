const LOOPBACK = new Set(['127.0.0.1', '::1', '0:0:0:0:0:0:0:1']);

export function normalizeIp(ip: string): string {
  const clean = ip.trim().replace(/^::ffff:/i, '');
  if (clean === '::1' || clean === '0:0:0:0:0:0:0:1') return '127.0.0.1';
  return clean;
}

export function isPrivateOrLoopback(ip?: string): boolean {
  if (!ip) return true;
  const n = normalizeIp(ip);
  if (LOOPBACK.has(n)) return true;
  if (n.startsWith('10.')) return true;
  if (n.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(n)) return true;
  if (n.startsWith('fe80:') || n.startsWith('fc') || n.startsWith('fd')) return true;
  return false;
}

function getHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * IP du visiteur. Seul X-Real-IP est cru : nginx l'écrase avec $remote_addr, que real_ip a déjà ramené à l'IP
 * du visiteur en ne faisant confiance qu'aux plages Cloudflare (CF-Connecting-IP). CF-Connecting-IP,
 * True-Client-IP, X-Client-IP et X-Forwarded-For peuvent tous être écrits par l'appelant : les lire ici
 * laisserait n'importe qui choisir l'IP enregistrée (géo, filtres bots, doublons).
 * Ensuite req.ip (trust proxy 1 = l'adresse posée par nginx) puis le socket.
 */
export function resolveClientIp(options: {
  headers: Record<string, string | string[] | undefined>;
  fallbackIp?: string;
  socketIp?: string;
  devOverrideIp?: string;
}): string | undefined {
  const candidates = [
    options.devOverrideIp,
    getHeader(options.headers, 'x-real-ip'),
    options.fallbackIp,
    options.socketIp,
  ];

  for (const ip of candidates) {
    if (!ip) continue;
    const normalized = normalizeIp(ip);
    if (normalized) return normalized;
  }

  return undefined;
}
