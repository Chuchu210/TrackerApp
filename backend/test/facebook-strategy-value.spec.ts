import { httpRequestWithRetry } from '../src/postbacks/helpers/facebook-graph-http.helper';
import { FacebookStrategy } from '../src/postbacks/strategies/facebook.strategy';

jest.mock('../src/postbacks/helpers/facebook-graph-http.helper', () => ({
  httpRequestWithRetry: jest.fn().mockResolvedValue({ data: { events_received: 1 }, status: 200 }),
}));

describe('FacebookStrategy — event value', () => {
  const strategy = new FacebookStrategy({} as never, { get: () => undefined } as never);
  const config = { facebookPixelId: 'pixel-1', facebookAccessToken: 'token' } as never;
  const click = { clickId: 'c1', ipAddress: null, userAgent: null } as never;

  function sentEvent() {
    const body = (httpRequestWithRetry as jest.Mock).mock.calls.at(-1)[3];
    return body.data[0];
  }

  it('sends a sold lead as a Purchase valued at the bid, in the currency the buyer paid in', async () => {
    await strategy.send(
      click,
      { id: 'conv-1', eventType: 'lead_sold', revenue: 16, currency: 'usd', revenueBase: 16, metadata: {} } as never,
      config,
    );

    expect(sentEvent().event_name).toBe('Purchase');
    expect(sentEvent().custom_data).toEqual({ value: 16, currency: 'USD' });
  });

  // Production stores no currency and leaves BASE_CURRENCY unset (USD by
  // default) although amounts are euros: labelling them with the base currency
  // would have told Meta a 13 € lead was worth $13.
  it('defaults to EUR when the postback carried no currency, never to the base currency', async () => {
    await strategy.send(
      click,
      { id: 'conv-2', eventType: 'lead_sold', revenue: 13, currency: null, revenueBase: 13, metadata: {} } as never,
      config,
    );

    expect(sentEvent().custom_data).toEqual({ value: 13, currency: 'EUR' });
  });
});
