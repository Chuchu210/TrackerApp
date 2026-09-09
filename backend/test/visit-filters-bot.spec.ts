import { buildClickWhere } from '../src/analytics/visit-filters';

describe('excludeBots filter', () => {
  it('adds isBot false when excludeBots is set', () => {
    const where = buildClickWhere({ excludeBots: true, campaignId: 'c1' });
    expect(where).toMatchObject({ isBot: false, campaignId: 'c1' });
  });

  it('allows explicit isBot when excludeBots is false', () => {
    const where = buildClickWhere({ isBot: true });
    expect(where.isBot).toBe(true);
  });

  it('filters by adset id when provided', () => {
    const where = buildClickWhere({ adsetId: '2385' });
    expect(where.adsetId).toEqual({ contains: '2385', mode: 'insensitive' });
  });
});
