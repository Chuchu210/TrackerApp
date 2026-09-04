/**
 * OpenAI Ads click attribution.
 *
 * `oppref` is OpenAI's attribution identifier. The pixel resolves it on its
 * own, but the Conversions API does not — we have to capture it at click time
 * and replay it with the conversion, the same way we persist gclid/fbclid.
 *
 * `obref` is the opaque browser reference stored in the `__obref` cookie; the
 * tracker script forwards it with the visit so it lands in rawParams too.
 *
 * Alias lists are deliberately tolerant: the exact landing-page query
 * parameter is configured in Ads Manager's tracking template, so we accept the
 * documented name plus the plausible prefixed variants rather than silently
 * dropping the click.
 */
const OPPREF_KEYS = ['oppref', 'oai_oppref', 'openai_oppref', 'op_ref'];
const OBREF_KEYS = ['obref', '__obref', 'oai_obref'];

export type OpenAiAttribution = {
  oppref: string | null;
  obref: string | null;
};

function firstMatch(
  params: Record<string, string>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/** `params` keys are already lowercased by extractRawParams(). */
export function extractOpenAiAttribution(
  params: Record<string, string>,
): OpenAiAttribution {
  return {
    oppref: firstMatch(params, OPPREF_KEYS),
    obref: firstMatch(params, OBREF_KEYS),
  };
}
