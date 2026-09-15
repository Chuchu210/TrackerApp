import { Alert, CodeBlock, bodyTextClass, inlineCodeClass, mutedTextClass, sectionHeadingClass } from '@/components/ui';

type Props = {
  trackerBaseUrl?: string;
  incomingConversionUrl?: string;
  incomingConversionUrlAlt?: string;
  incomingOutcomeUrls?: { sold: string; rejected: string; returned: string };
  trackingMode?: string;
  lpScriptSnippet?: string;
};

export function IncomingConversionGuide({
  trackerBaseUrl,
  incomingConversionUrl,
  incomingConversionUrlAlt,
  incomingOutcomeUrls,
  trackingMode,
  lpScriptSnippet,
}: Props) {
  const exampleClickId = 'dabc123xyz';
  const exampleUrl =
    incomingConversionUrl
      ?.replace('{click_id}', exampleClickId)
      .replace('{payout}', '25')
      .replace('{transaction_id}', 'TX-001') ||
    `${trackerBaseUrl || 'https://track.your-domain.com'}/postback?cid=${exampleClickId}&et=lead&payout=25&txid=TX-001`;

  return (
    <div className={`space-y-4 text-sm ${bodyTextClass}`}>
      <p>
        When a lead converts on your landing page, you must tell the tracker using the{' '}
        <strong>internal click ID</strong> from the visit — the same value in{' '}
        <code className={inlineCodeClass}>click_id</code> and{' '}
        <code className={inlineCodeClass}>tk-cid</code> on the LP URL. They are identical.
      </p>

      <Alert tone="warning">
        <strong>Do not confuse:</strong> Mediago&apos;s ad{' '}
        <code className={inlineCodeClass}>click_id</code> macro ({'{TRACKING_ID}'}) is the network
        ID — stored as <em>tracking ID</em>. For conversion postback use our ID from the LP (
        <code className={inlineCodeClass}>d…</code> prefix), unless you only have the network ID
        and use <code className={inlineCodeClass}>tracking_id=</code> instead of{' '}
        <code className={inlineCodeClass}>cid=</code>.
      </Alert>

      <div>
        <h4 className={`${sectionHeadingClass} mb-2`}>
          Option A — GET postback URL (CRM, webhook, server-side)
        </h4>
        <p className={`text-xs ${mutedTextClass} mb-2`}>
          Each campaign uses its tracking domain. Paste this template in your LP backend / Zapier /
          form handler. Replace placeholders when the lead converts.
        </p>
        <CodeBlock>{incomingConversionUrl || exampleUrl}</CodeBlock>
        <p className={`text-xs ${mutedTextClass} mt-2`}>Example with a real click ID:</p>
        <CodeBlock>{exampleUrl}</CodeBlock>
        {incomingConversionUrlAlt && (
          <>
            <p className={`text-xs ${mutedTextClass} mt-2`}>Alternative (click ID in path):</p>
            <CodeBlock>
              {incomingConversionUrlAlt
                .replace('{click_id}', exampleClickId)
                .replace('{payout}', '25')}
            </CodeBlock>
          </>
        )}
      </div>

      {incomingOutcomeUrls && (
        <div>
          <h4 className={`${sectionHeadingClass} mb-2`}>
            RTB buyers — report whether the lead was taken
          </h4>
          <Alert tone="warning">
            Do not send the buyer&apos;s bid with <code className={inlineCodeClass}>et=lead</code>: the
            landing page has already recorded the lead, so that postback is ignored as a duplicate and
            the bid is lost. Give the buyer these three URLs instead.
          </Alert>
          <p className={`text-xs ${mutedTextClass} mt-2 mb-1`}>Lead taken — payout is the winning bid:</p>
          <CodeBlock>{incomingOutcomeUrls.sold}</CodeBlock>
          <p className={`text-xs ${mutedTextClass} mt-2 mb-1`}>Lead refused:</p>
          <CodeBlock>{incomingOutcomeUrls.rejected}</CodeBlock>
          <p className={`text-xs ${mutedTextClass} mt-2 mb-1`}>Lead returned after purchase:</p>
          <CodeBlock>{incomingOutcomeUrls.returned}</CodeBlock>
          <p className={`text-xs ${mutedTextClass} mt-2`}>
            These are accepted days after the click and are only sent on to Meta when the lead is
            taken, as a Purchase valued at the bid.
          </p>
        </div>
      )}

      <div>
        <h4 className={`${sectionHeadingClass} mb-2`}>Accepted query parameters</h4>
        <ul className={`text-xs space-y-1 font-mono ${bodyTextClass}`}>
          <li>
            <code>cid</code> or <code>click_id</code> or <code>tk-cid</code> — visit click ID
            (required)
          </li>
          <li>
            <code>et</code> — event type slug (maps to Mediago conversiontype): viewcontent, click_button,
            call_click, call_connected, lead, purchase, account_opening, … (default: lead)
          </li>
          <li>
            <code>payout</code> — revenue (e.g. 25)
          </li>
          <li>
            <code>txid</code> — transaction / order ID
          </li>
          <li>
            <code>tracking_id</code> — network click ID if you don&apos;t have our click_id
          </li>
        </ul>
      </div>

      {trackingMode === 'direct' && lpScriptSnippet && (
        <div>
          <h4 className={`${sectionHeadingClass} mb-2`}>
            Option B — LP script (Facebook / Google direct)
          </h4>
          <p className={`text-xs ${mutedTextClass} mb-2`}>
            On form submit, call from your LP JavaScript (uses tk-cid cookie automatically):
          </p>
          <CodeBlock>{`// Mediago: View Content fires automatically when utm_source=mediago

// Button click → Mediago type 12
tkCallback.trackClickButton();
// or: tkCallback.registerConversion({ eventType: 'click_button' });

// Call button click → type 12
tkCallback.trackCallClick();

// Call connected → type 14
tkCallback.trackCallConnected();

// Lead / form submit → type 10
tkCallback.registerConversion({ eventType: 'lead', email: 'user@example.com' });

// Sale / purchase → type 8
tkCallback.trackPurchase({ payout: 25, transactionId: 'TX-001' });`}</CodeBlock>
          <p className={`text-xs ${mutedTextClass} mt-2`}>
            Sends POST to <code className={inlineCodeClass}>{trackerBaseUrl}/conversions/track</code> with the visit click ID.
            Each event type maps to a Mediago <code className={inlineCodeClass}>conversiontype</code> code on the outbound S2S postback.
          </p>
        </div>
      )}
    </div>
  );
}
