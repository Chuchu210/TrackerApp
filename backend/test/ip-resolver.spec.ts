import { resolveClientIp, isPrivateOrLoopback } from '../src/shared/tracking/ip-resolver';
import { isUnreplacedMacro, sanitizeParam } from '../src/shared/tracking/params';

describe('resolveClientIp', () => {
  it('uses X-Real-IP (set by nginx) over req.ip and the socket', () => {
    const ip = resolveClientIp({
      headers: {
        'x-real-ip': '109.52.221.77',
        'x-forwarded-for': '127.0.0.1',
      },
      fallbackIp: '::1',
      socketIp: '::1',
    });
    expect(ip).toBe('109.52.221.77');
  });

  it.each([
    ['cf-connecting-ip', '6.6.6.6'],
    ['true-client-ip', '6.6.6.6'],
    ['x-client-ip', '6.6.6.6'],
    ['x-forwarded-for', '6.6.6.6, 109.52.221.77'],
  ])('ignores a spoofed %s when X-Real-IP is present', (header, value) => {
    const ip = resolveClientIp({
      headers: { [header]: value, 'x-real-ip': '109.52.221.77' },
      fallbackIp: '109.52.221.77',
      socketIp: '127.0.0.1',
    });
    expect(ip).toBe('109.52.221.77');
  });

  it('ignores every spoofable header at once', () => {
    const ip = resolveClientIp({
      headers: {
        'cf-connecting-ip': '6.6.6.6',
        'true-client-ip': '7.7.7.7',
        'x-client-ip': '8.8.8.8',
        'x-forwarded-for': '9.9.9.9',
        'x-real-ip': '109.52.221.77',
      },
      socketIp: '127.0.0.1',
    });
    expect(ip).toBe('109.52.221.77');
  });

  it('falls back to req.ip, not the spoofable headers, when X-Real-IP is missing', () => {
    const ip = resolveClientIp({
      headers: {
        'cf-connecting-ip': '6.6.6.6',
        'true-client-ip': '7.7.7.7',
        'x-client-ip': '8.8.8.8',
        'x-forwarded-for': '9.9.9.9',
      },
      fallbackIp: '::ffff:109.52.221.77',
      socketIp: '127.0.0.1',
    });
    expect(ip).toBe('109.52.221.77');
  });

  it('falls back to the socket when neither X-Real-IP nor req.ip is set', () => {
    const ip = resolveClientIp({
      headers: { 'cf-connecting-ip': '6.6.6.6' },
      socketIp: '::ffff:109.52.221.77',
    });
    expect(ip).toBe('109.52.221.77');
  });

  it('normalizes IPv6 loopback to 127.0.0.1', () => {
    const ip = resolveClientIp({
      headers: {},
      fallbackIp: '::1',
    });
    expect(ip).toBe('127.0.0.1');
    expect(isPrivateOrLoopback(ip)).toBe(true);
  });

  it('uses dev override IP when provided', () => {
    const ip = resolveClientIp({
      headers: {},
      fallbackIp: '::1',
      devOverrideIp: '2a01:e0a:8f3:c350:1495:1ba7:8ad1:c5aa',
    });
    expect(ip).toBe('2a01:e0a:8f3:c350:1495:1ba7:8ad1:c5aa');
  });
});

describe('macro sanitization', () => {
  it('ignores unreplaced Mediago macros', () => {
    expect(isUnreplacedMacro('${TRACKING_ID}')).toBe(true);
    expect(sanitizeParam('${PUBLISHER_NAME}')).toBeUndefined();
    expect(sanitizeParam('msn.com')).toBe('msn.com');
  });
});
