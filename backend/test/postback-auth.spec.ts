import {
  isPostbackAuthorized,
  ipMatches,
  parseIpAllowlist,
  extractProvidedSecret,
} from '../src/shared/tracking/postback-auth';

describe('isPostbackAuthorized', () => {
  it('allows when neither secret nor allowlist configured (backward compatible)', () => {
    const r = isPostbackAuthorized({ expectedSecret: null, ipAllowlist: [] });
    expect(r.ok).toBe(true);
    expect(r.reason).toBe('unsecured');
  });

  it('authorizes on matching secret', () => {
    const r = isPostbackAuthorized({
      expectedSecret: 's3cret-token',
      providedSecret: 's3cret-token',
    });
    expect(r).toEqual({ ok: true, reason: 'secret_match' });
  });

  it('rejects on wrong secret', () => {
    const r = isPostbackAuthorized({
      expectedSecret: 's3cret-token',
      providedSecret: 'nope',
      ipAllowlist: [],
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('secret_mismatch');
  });

  it('rejects when secret configured but none provided', () => {
    const r = isPostbackAuthorized({ expectedSecret: 's3cret', providedSecret: '' });
    expect(r.ok).toBe(false);
  });

  it('authorizes an allowlisted IP even without a secret', () => {
    const r = isPostbackAuthorized({
      expectedSecret: 's3cret',
      providedSecret: 'wrong',
      ip: '203.0.113.7',
      ipAllowlist: ['203.0.113.7'],
    });
    expect(r).toEqual({ ok: true, reason: 'ip_allowlisted' });
  });

  it('authorizes an IP inside an allowlisted CIDR', () => {
    const r = isPostbackAuthorized({
      ip: '203.0.113.55',
      ipAllowlist: ['203.0.113.0/24'],
    });
    expect(r.ok).toBe(true);
  });

  it('rejects an IP outside the allowlist when allowlist is the only gate', () => {
    const r = isPostbackAuthorized({
      expectedSecret: null,
      ip: '198.51.100.9',
      ipAllowlist: ['203.0.113.0/24'],
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('ip_not_allowed');
  });
});

describe('ipMatches', () => {
  it('matches exact IPv4', () => {
    expect(ipMatches('10.0.0.5', '10.0.0.5')).toBe(true);
    expect(ipMatches('10.0.0.6', '10.0.0.5')).toBe(false);
  });

  it('matches CIDR ranges', () => {
    expect(ipMatches('192.168.1.200', '192.168.1.0/24')).toBe(true);
    expect(ipMatches('192.168.2.1', '192.168.1.0/24')).toBe(false);
    expect(ipMatches('10.10.10.10', '10.0.0.0/8')).toBe(true);
    expect(ipMatches('11.0.0.1', '10.0.0.0/8')).toBe(false);
  });

  it('normalizes IPv4-mapped IPv6', () => {
    expect(ipMatches('::ffff:203.0.113.7', '203.0.113.7')).toBe(true);
  });
});

describe('parseIpAllowlist', () => {
  it('splits on commas and whitespace and trims', () => {
    expect(parseIpAllowlist('1.1.1.1, 2.2.2.0/24\n 3.3.3.3')).toEqual([
      '1.1.1.1',
      '2.2.2.0/24',
      '3.3.3.3',
    ]);
    expect(parseIpAllowlist('')).toEqual([]);
    expect(parseIpAllowlist(undefined)).toEqual([]);
  });
});

describe('extractProvidedSecret', () => {
  it('reads secret from common query keys', () => {
    expect(extractProvidedSecret({ secret: 'a' })).toBe('a');
    expect(extractProvidedSecret({ key: 'b' })).toBe('b');
    expect(extractProvidedSecret({ token: 'c' })).toBe('c');
    expect(extractProvidedSecret({ postback_secret: 'd' })).toBe('d');
    expect(extractProvidedSecret({ nope: 'x' })).toBeUndefined();
  });

  it('handles array-valued query params', () => {
    expect(extractProvidedSecret({ secret: ['first', 'second'] })).toBe('first');
  });
});
