export interface ConversionContext {
  /**
   * Whether the caller is allowed to set monetary fields (revenue/cost).
   * Server-to-server postbacks and the API-key endpoint are trusted; the
   * public browser endpoint (/conversions/track) is not, so client-supplied
   * revenue is ignored to prevent conversion/revenue injection.
   * Defaults to trusted when unset (server-initiated calls).
   */
  trusted?: boolean;
  incomingPostbackIp?: string;
  incomingPostbackUrl?: string;
  postbackParam1?: string;
  postbackParam2?: string;
  postbackParam3?: string;
  postbackParam4?: string;
  postbackParam5?: string;
}

export function extractPostbackParamsFromQuery(
  query: Record<string, string | string[] | undefined>,
): Partial<ConversionContext> {
  const get = (key: string) => {
    const v = query[key];
    if (Array.isArray(v)) return v[0];
    return v;
  };

  return {
    postbackParam1: get('p1') || get('postback_param_1') || get('param1'),
    postbackParam2: get('p2') || get('postback_param_2') || get('param2'),
    postbackParam3: get('p3') || get('postback_param_3') || get('param3'),
    postbackParam4: get('p4') || get('postback_param_4') || get('param4'),
    postbackParam5: get('p5') || get('postback_param_5') || get('param5'),
  };
}
