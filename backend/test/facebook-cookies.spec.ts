import {
  buildFbcFromFbclid,
  getFacebookCookieValues,
  resolveFacebookIdentifiers,
} from '../src/shared/tracking/facebook-cookies';

describe('getFacebookCookieValues', () => {
  it('reads _fbp and _fbc from a cookie header', () => {
    const values = getFacebookCookieValues(
      'tk-cid=abc; _fbp=fb.1.1700000000000.123456; _fbc=fb.1.1700000000000.IwAR123',
    );
    expect(values.fbp).toBe('fb.1.1700000000000.123456');
    expect(values.fbc).toBe('fb.1.1700000000000.IwAR123');
  });

  it('returns nothing when the cookies are absent', () => {
    expect(getFacebookCookieValues('tk-cid=abc')).toEqual({});
    expect(getFacebookCookieValues(undefined)).toEqual({});
  });
});

describe('buildFbcFromFbclid', () => {
  it("rebuilds Meta's documented fbc format from the click timestamp", () => {
    const clickedAt = new Date('2026-09-09T10:00:00.000Z');
    expect(buildFbcFromFbclid('IwAR_test', clickedAt)).toBe(
      `fb.1.${clickedAt.getTime()}.IwAR_test`,
    );
  });

  it('returns undefined without an fbclid', () => {
    expect(buildFbcFromFbclid(null)).toBeUndefined();
    expect(buildFbcFromFbclid(undefined)).toBeUndefined();
  });
});

describe('resolveFacebookIdentifiers', () => {
  const clickedAt = new Date('2026-09-09T10:00:00.000Z');

  it('prefers what the caller supplied', () => {
    const ids = resolveFacebookIdentifiers({
      metadata: { fbp: 'meta-fbp', fbc: 'meta-fbc' },
      cookieHeader: '_fbp=cookie-fbp; _fbc=cookie-fbc',
      fbclid: 'IwAR_test',
      clickedAt,
    });
    expect(ids).toEqual({ fbp: 'meta-fbp', fbc: 'meta-fbc' });
  });

  it('falls back to request cookies', () => {
    const ids = resolveFacebookIdentifiers({
      metadata: {},
      cookieHeader: '_fbp=cookie-fbp; _fbc=cookie-fbc',
      fbclid: 'IwAR_test',
      clickedAt,
    });
    expect(ids).toEqual({ fbp: 'cookie-fbp', fbc: 'cookie-fbc' });
  });

  // The main win: even with no Meta pixel cookie at all, the fbclid we stored on
  // the click still yields a usable fbc, instead of sending the event with none.
  it('rebuilds fbc from the stored fbclid when no cookie is available', () => {
    const ids = resolveFacebookIdentifiers({
      metadata: {},
      cookieHeader: undefined,
      fbclid: 'IwAR_test',
      clickedAt,
    });
    expect(ids.fbc).toBe(`fb.1.${clickedAt.getTime()}.IwAR_test`);
    expect(ids.fbp).toBeUndefined();
  });

  it('returns nothing for non-Facebook traffic', () => {
    expect(
      resolveFacebookIdentifiers({ metadata: {}, cookieHeader: 'tk-cid=abc' }),
    ).toEqual({});
  });
});
