import { buildRedirect } from '../src/shared/tracking/redirect-modes';

describe('buildRedirect', () => {
  const dest = 'https://offer.example.com/lp?a=1&b=2';

  it('defaults to an http 302 Location redirect', () => {
    const r = buildRedirect(dest);
    expect(r).toEqual({ kind: 'http', body: dest, status: 302 });
  });

  it('meta_refresh returns an HTML page with no-referrer and a refresh meta', () => {
    const r = buildRedirect(dest, 'meta_refresh');
    expect(r.kind).toBe('html');
    expect(r.status).toBe(200);
    expect(r.body).toContain('name="referrer" content="no-referrer"');
    expect(r.body).toContain('http-equiv="refresh"');
    // ampersands in the URL are escaped inside the HTML attribute
    expect(r.body).toContain('a=1&amp;b=2');
  });

  it('double_meta also forwards via script', () => {
    const r = buildRedirect(dest, 'double_meta');
    expect(r.kind).toBe('html');
    expect(r.body).toContain('window.location.replace');
    expect(r.body).toContain('no-referrer');
  });

  it('escapes HTML metacharacters to prevent injection via destination', () => {
    const r = buildRedirect('https://x.com/"><script>alert(1)</script>', 'meta_refresh');
    expect(r.body).not.toContain('<script>alert(1)</script>');
    expect(r.body).toContain('&quot;&gt;&lt;script&gt;');
  });
});
