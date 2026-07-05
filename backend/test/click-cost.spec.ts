import {
  parseClickCost,
  parseClickCostKeys,
  DEFAULT_CLICK_COST_KEYS,
} from '../src/shared/tracking/click-cost';
import { SYSTEM_TRAFFIC_SOURCE_PROFILES } from '../src/traffic-sources/traffic-source-profiles.seed';

describe('parseClickCost', () => {
  it('reads the first present cost key', () => {
    expect(parseClickCost({ cost: '0.45' })).toBeCloseTo(0.45);
    expect(parseClickCost({ cpc: '1.20' })).toBeCloseTo(1.2);
    expect(parseClickCost({ bid_price: '0.03' })).toBeCloseTo(0.03);
  });

  it('accepts comma decimals', () => {
    expect(parseClickCost({ cost: '0,75' })).toBeCloseTo(0.75);
  });

  it('ignores unreplaced macros and non-numeric values', () => {
    expect(parseClickCost({ cost: '${BID_PRICE}' })).toBeNull();
    expect(parseClickCost({ cost: '{cpc}' })).toBeNull();
    expect(parseClickCost({ cost: 'abc' })).toBeNull();
    expect(parseClickCost({})).toBeNull();
  });

  it('rejects negative values', () => {
    expect(parseClickCost({ cost: '-1' })).toBeNull();
  });

  it('honors a custom key list', () => {
    expect(parseClickCost({ mycost: '2.5' }, ['mycost'])).toBeCloseTo(2.5);
    expect(parseClickCost({ cost: '2.5' }, ['mycost'])).toBeNull();
  });
});

describe('parseClickCostKeys', () => {
  it('falls back to defaults when empty', () => {
    expect(parseClickCostKeys(undefined)).toEqual(DEFAULT_CLICK_COST_KEYS);
    expect(parseClickCostKeys('')).toEqual(DEFAULT_CLICK_COST_KEYS);
  });

  it('parses and lowercases a custom list', () => {
    expect(parseClickCostKeys('Cost, MyBid')).toEqual(['cost', 'mybid']);
  });
});

describe('traffic source templates', () => {
  it('includes the newly added native/affiliate networks', () => {
    const slugs = SYSTEM_TRAFFIC_SOURCE_PROFILES.map((p) => p.slug);
    for (const slug of ['taboola', 'mgid', 'newsbreak', 'tiktok', 'affiliate-generic']) {
      expect(slugs).toContain(slug);
    }
  });

  it('every profile has a postback template and param mappings', () => {
    for (const p of SYSTEM_TRAFFIC_SOURCE_PROFILES) {
      expect(p.paramMappings.length).toBeGreaterThan(0);
      expect(p.postbackDefaults).toBeDefined();
    }
  });
});
