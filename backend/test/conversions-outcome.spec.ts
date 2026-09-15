import { ConversionsService } from '../src/conversions/conversions.service';

describe('ConversionsService.create — buyer outcome postbacks', () => {
  const HOUR = 60 * 60 * 1000;

  function setup(click: Record<string, unknown>) {
    const prisma = {
      click: { findUnique: jest.fn().mockResolvedValue(click) },
      conversion: {
        findUnique: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(async ({ data }) => ({ id: 'conv-1', ...data })),
      },
    };
    const postbacks = { processConversion: jest.fn().mockResolvedValue(undefined) };
    const config = { get: jest.fn().mockReturnValue(undefined) };
    const settings = {
      getEffective: jest.fn().mockResolvedValue({ baseCurrency: 'EUR', fxRates: '', testMode: false }),
    };
    const service = new ConversionsService(
      prisma as never,
      postbacks as never,
      config as never,
      settings as never,
    );
    return { service, prisma };
  }

  const clickAt = (hoursAgo: number, campaign: Record<string, unknown>) => ({
    clickId: 'c1',
    campaignId: 'camp-1',
    createdAt: new Date(Date.now() - hoursAgo * HOUR),
    fbclid: null,
    isTest: false,
    campaign,
  });

  // Regression: the landing page had already recorded `lead`, so a buyer
  // postback `et=lead&payout=14.5` came back as a duplicate and the bid was lost.
  it('records lead_sold with the bid even though the click already has a lead', async () => {
    const { service, prisma } = setup(clickAt(2, { attributionWindowHours: null, maxConversionsPerClick: null }));
    prisma.conversion.findUnique
      .mockResolvedValueOnce(null) // no existing lead_sold for this click
      .mockResolvedValueOnce({ id: 'conv-1', eventType: 'lead_sold', revenue: 14.5 });

    await service.create({ clickId: 'c1', eventType: 'lead_sold', revenue: 14.5, currency: 'EUR' } as never);

    expect(prisma.conversion.findUnique.mock.calls[0][0]).toEqual({
      where: { clickId_eventType: { clickId: 'c1', eventType: 'lead_sold' } },
    });
    const data = prisma.conversion.create.mock.calls[0][0].data;
    expect(data.eventType).toBe('lead_sold');
    expect(data.revenue).toBe(14.5);
    expect(data.revenueBase).toBe(14.5);
  });

  it('accepts a buyer outcome 72 h after the click despite a 24 h attribution window', async () => {
    const { service, prisma } = setup(clickAt(72, { attributionWindowHours: 24, maxConversionsPerClick: null }));
    prisma.conversion.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'conv-1' });

    const result = await service.create({ clickId: 'c1', eventType: 'lead_rejected' } as never);

    expect(result).not.toHaveProperty('skipped');
    expect(prisma.conversion.create).toHaveBeenCalledTimes(1);
  });

  it('still applies the attribution window to ordinary events', async () => {
    const { service, prisma } = setup(clickAt(72, { attributionWindowHours: 24, maxConversionsPerClick: null }));

    const result = await service.create({ clickId: 'c1', eventType: 'lead' } as never);

    expect(result).toEqual({ skipped: true, reason: 'outside_attribution_window' });
    expect(prisma.conversion.create).not.toHaveBeenCalled();
  });

  it('is not blocked by the per-click conversion cap', async () => {
    const { service, prisma } = setup(clickAt(2, { attributionWindowHours: null, maxConversionsPerClick: 1 }));
    prisma.conversion.count.mockResolvedValue(5);
    prisma.conversion.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'conv-1' });

    const result = await service.create({ clickId: 'c1', eventType: 'lead_sold', revenue: 20 } as never);

    expect(result).not.toHaveProperty('skipped');
    expect(prisma.conversion.count).not.toHaveBeenCalled();
  });

  it('refuses outcomes from the public browser endpoint', async () => {
    const { service, prisma } = setup(clickAt(2, { attributionWindowHours: null, maxConversionsPerClick: null }));

    const result = await service.create(
      { clickId: 'c1', eventType: 'lead_returned' } as never,
      { trusted: false } as never,
    );

    expect(result).toEqual({ skipped: true, reason: 'outcome_requires_server_postback' });
    expect(prisma.conversion.create).not.toHaveBeenCalled();
  });

  it('keeps outcomes out of the cap count for ordinary events', async () => {
    const { service, prisma } = setup(clickAt(2, { attributionWindowHours: null, maxConversionsPerClick: 3 }));
    prisma.conversion.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'conv-1' });

    await service.create({ clickId: 'c1', eventType: 'purchase', revenue: 10 } as never);

    expect(prisma.conversion.count).toHaveBeenCalledWith({
      where: { clickId: 'c1', eventType: { notIn: ['lead_sold', 'lead_rejected', 'lead_returned'] } },
    });
  });
});
