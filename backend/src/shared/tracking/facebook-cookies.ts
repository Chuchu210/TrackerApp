export interface FacebookCookieValues {
  fbp?: string;
  fbc?: string;
}

const getCookieValue = (cookieName: string, cookieHeader?: string): string | undefined => {
  if (!cookieHeader) return undefined;

  const prefixedCookie = cookieHeader
    .split('; ')
    .find((cookie) => cookie.startsWith(`${cookieName}=`));

  if (!prefixedCookie) return undefined;

  const rawValue = prefixedCookie.slice(cookieName.length + 1);
  return rawValue ? decodeURIComponent(rawValue) : undefined;
};

/**
 * Meta's documented _fbc format: `fb.<subdomainIndex>.<creationTimeMs>.<fbclid>`.
 * When the Meta pixel never ran (or its cookie is not readable server-side), CAPI
 * still accepts an fbc rebuilt from the fbclid we already stored on the click.
 * The click timestamp is the right creation time: it is the moment Meta's redirect
 * handed us that fbclid.
 */
export const buildFbcFromFbclid = (
  fbclid?: string | null,
  clickedAt?: Date,
): string | undefined => {
  if (!fbclid) return undefined;
  const creationTime = (clickedAt ?? new Date()).getTime();
  return `fb.1.${creationTime}.${fbclid}`;
};

/**
 * Resolve the fbp/fbc pair to send with a CAPI event, in decreasing order of
 * fidelity: what the caller supplied, then the request cookies, then an fbc
 * rebuilt from the stored fbclid. Anything already present is never overwritten.
 */
export const resolveFacebookIdentifiers = (input: {
  metadata?: Record<string, unknown>;
  cookieHeader?: string;
  fbclid?: string | null;
  clickedAt?: Date;
}): FacebookCookieValues => {
  const fromMetadata = {
    fbp: typeof input.metadata?.fbp === 'string' ? input.metadata.fbp : undefined,
    fbc: typeof input.metadata?.fbc === 'string' ? input.metadata.fbc : undefined,
  };
  const fromCookies = getFacebookCookieValues(input.cookieHeader);

  const fbp = fromMetadata.fbp || fromCookies.fbp;
  const fbc =
    fromMetadata.fbc ||
    fromCookies.fbc ||
    buildFbcFromFbclid(input.fbclid, input.clickedAt);

  return {
    ...(fbp ? { fbp } : {}),
    ...(fbc ? { fbc } : {}),
  };
};

export const getFacebookCookieValues = (cookieHeader?: string): FacebookCookieValues => {
  const fbp = getCookieValue('_fbp', cookieHeader);
  const fbc = getCookieValue('_fbc', cookieHeader);

  return {
    ...(fbp ? { fbp } : {}),
    ...(fbc ? { fbc } : {}),
  };
};
