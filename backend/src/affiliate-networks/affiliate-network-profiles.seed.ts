/**
 * Common affiliate networks pre-seeded to save setup time.
 *
 * Modeled after Voluum's "affiliate network" configuration: a set of parameter
 * tokens that map the network's own placeholders to our canonical postback
 * fields.
 *
 * - `clickIdParam`        AN parameter we append to the OUTBOUND affiliate link
 *                         so the network stores our click reference (Voluum:
 *                         the "AN parameter" of the Click ID row, e.g. `cb`).
 * - `clickIdToken`        The token the network substitutes in its postback for
 *                         that click reference (e.g. `!!!cb!!!`) -> our `cid`.
 * - `payoutToken`         Network token for the commission/payout -> `payout`.
 * - `transactionIdToken`  Network token for the order/transaction id -> `txid`.
 * - `eventTypeToken`      Optional token for the conversion/event type -> `et`.
 * - `defaultCurrency`     Fixed payout currency sent as `currency` (Voluum's
 *                         "Payout currency" dropdown).
 *
 * The full postback URL is built from these tokens at runtime (tracker base is
 * prepended from TRACKER_BASE_URL), so the same seed works in dev and prod.
 * A freeform `postbackUrlTemplate` override remains available per network.
 */
export interface AffiliateNetworkSeed {
  name: string;
  slug: string;
  clickIdParam: string;
  clickIdToken?: string;
  payoutToken?: string;
  transactionIdToken?: string;
  eventTypeToken?: string;
  defaultCurrency?: string;
}

export const SYSTEM_AFFILIATE_NETWORKS: AffiliateNetworkSeed[] = [
  // --- FR / EU focused networks with documented postback tokens ---
  {
    name: 'AWIN',
    slug: 'awin',
    clickIdParam: 'clickref',
    clickIdToken: '!!!clickRef!!!',
    payoutToken: '!!!commission!!!',
    transactionIdToken: '!!!transactionId!!!',
    defaultCurrency: 'EUR',
  },
  {
    name: 'Tradedoubler',
    slug: 'tradedoubler',
    clickIdParam: 'epi',
    clickIdToken: '${epi}',
    payoutToken: '${publisherCommission}',
    transactionIdToken: '${orderNumber}',
    defaultCurrency: 'EUR',
  },
  {
    name: 'Kwanko',
    slug: 'kwanko',
    clickIdParam: 'argsite',
    clickIdToken: '{ARGSITE}',
    payoutToken: '{GAINAF}',
    transactionIdToken: '{UNIQUE_CONV_ID}',
    defaultCurrency: 'EUR',
  },
  {
    name: 'TimeOne',
    slug: 'timeone',
    clickIdParam: 'cb',
    clickIdToken: '!!!cb!!!',
    payoutToken: '!!!commission!!!',
    transactionIdToken: '!!!id!!!',
    defaultCurrency: 'EUR',
  },
  { name: 'Effiliation', slug: 'effiliation', clickIdParam: 'effi_id' },
  { name: 'TradeTracker', slug: 'tradetracker', clickIdParam: 'reference' },
  { name: 'Daisycon', slug: 'daisycon', clickIdParam: 'subid' },
  { name: 'Webgains', slug: 'webgains', clickIdParam: 'clickref' },
  { name: 'Rakuten Advertising', slug: 'rakuten', clickIdParam: 'u1' },
  { name: 'CJ Affiliate', slug: 'cj-affiliate', clickIdParam: 'sid' },
  { name: 'Impact', slug: 'impact', clickIdParam: 'subId1' },
  { name: 'Partnerize', slug: 'partnerize', clickIdParam: 'pubref' },
  { name: 'Admitad', slug: 'admitad', clickIdParam: 'subid' },
  { name: 'ShareASale', slug: 'shareasale', clickIdParam: 'afftrack' },
  { name: 'FlexOffers', slug: 'flexoffers', clickIdParam: 'sid' },

  // --- Generic fallback for networks not listed above ---
  { name: 'Generic (subid)', slug: 'generic', clickIdParam: 'subid' },
];
