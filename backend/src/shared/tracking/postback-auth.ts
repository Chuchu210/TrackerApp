import { timingSafeEqual } from 'crypto';
import { normalizeIp } from './ip-resolver';

export interface PostbackAuthInput {
  /** Secret configured on the campaign's postback config (null = none set). */
  expectedSecret?: string | null;
  /** Secret presented on the incoming postback query (?secret / ?key / ?token). */
  providedSecret?: string | null;
  /** Resolved client IP of the incoming postback request. */
  ip?: string | null;
  /** Global allowlist of exact IPs or CIDR ranges permitted to fire postbacks. */
  ipAllowlist?: string[];
}

export interface PostbackAuthResult {
  ok: boolean;
  /** Machine-readable reason, useful for logging without leaking the secret. */
  reason:
    | 'secret_match'
    | 'ip_allowlisted'
    | 'unsecured'
    | 'secret_mismatch'
    | 'ip_not_allowed';
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function ipToLong(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    n = n * 256 + octet;
  }
  return n >>> 0;
}

/** IPv4 exact-or-CIDR match. IPv6 falls back to normalized string equality. */
export function ipMatches(ip: string, rule: string): boolean {
  const cleanIp = normalizeIp(ip);
  const cleanRule = rule.trim();
  if (!cleanRule) return false;

  if (cleanRule.includes('/')) {
    const [range, bitsRaw] = cleanRule.split('/');
    const bits = Number(bitsRaw);
    const ipLong = ipToLong(cleanIp);
    const rangeLong = ipToLong(normalizeIp(range));
    if (ipLong == null || rangeLong == null || !Number.isInteger(bits) || bits < 0 || bits > 32) {
      return false;
    }
    if (bits === 0) return true;
    const mask = (0xffffffff << (32 - bits)) >>> 0;
    return (ipLong & mask) === (rangeLong & mask);
  }

  return cleanIp === normalizeIp(cleanRule);
}

function ipInAllowlist(ip: string | null | undefined, allowlist: string[]): boolean {
  if (!ip || allowlist.length === 0) return false;
  return allowlist.some((rule) => ipMatches(ip, rule));
}

/**
 * Decide whether an incoming server-to-server postback is authorized.
 *
 * Precedence:
 *  1. If a secret is configured, a matching `providedSecret` authorizes it.
 *  2. An allowlisted source IP authorizes it (bypasses/for when the network
 *     cannot append a secret).
 *  3. If neither a secret nor an allowlist is configured, it is allowed
 *     (`unsecured`) so existing campaigns keep working until a secret is set.
 */
export function isPostbackAuthorized(input: PostbackAuthInput): PostbackAuthResult {
  const expected = input.expectedSecret?.trim() || '';
  const provided = input.providedSecret?.trim() || '';
  const allowlist = (input.ipAllowlist || []).map((s) => s.trim()).filter(Boolean);

  if (expected && provided && safeEqual(provided, expected)) {
    return { ok: true, reason: 'secret_match' };
  }

  if (ipInAllowlist(input.ip, allowlist)) {
    return { ok: true, reason: 'ip_allowlisted' };
  }

  if (!expected && allowlist.length === 0) {
    return { ok: true, reason: 'unsecured' };
  }

  return { ok: false, reason: expected ? 'secret_mismatch' : 'ip_not_allowed' };
}

/** Parse POSTBACK_IP_ALLOWLIST env (comma/space separated) into a clean list. */
export function parseIpAllowlist(raw?: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Pull a postback secret from common query keys. */
export function extractProvidedSecret(
  query: Record<string, string | string[] | undefined>,
): string | undefined {
  for (const key of ['secret', 'key', 'token', 'postback_secret']) {
    const v = query[key];
    const val = Array.isArray(v) ? v[0] : v;
    if (val) return val;
  }
  return undefined;
}
