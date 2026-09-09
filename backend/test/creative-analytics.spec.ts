import { CreativeAnalyticsService } from '../src/analytics/creative-analytics.service';

describe('CreativeAnalyticsService', () => {
  const clicks = [
    {
      clickId: 'c1',
      campaignId: 'camp-1',
      assetId: 'img-a',
      contentName: null,
      adId: null,
      adTitle: 'Headline A',
      isBot: false,
      visitorId: 'v1',
    },
    {
      clickId: 'c2',
      campaignId: 'camp-1',
      assetId: 'img-b',
      contentName: null,
      adId: null,
      adTitle: 'Headline B',
      isBot: false,
      visitorId: 'v2',
    },
  ];

  const conversions = [
    { clickId: 'c1', revenue: 0, eventType: 'call_click' },
    { clickId: 'c1', revenue: 0, eventType: 'call_click' },
    { clickId: 'c2', revenue: 0, eventType: 'click_button' },
  ];

  let convWhere: Record<string, unknown> | undefined;

  const prisma = {
    click: {
      findMany: jest.fn().mockImplementation(() => Promise.resolve(clicks)),
    },
    conversion: {
      findMany: jest.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) => {
        convWhere = where;
        const slugs = (where.eventType as { in: string[] }).in;
        return Promise.resolve(
          conversions.filter((c) => slugs.includes(c.eventType)),
        );
      }),
    },
    campaignSpendSnapshot: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { spend: 100 } }),
    },
  };

  const metaCreatives = {
    getByAdIds: jest.fn().mockResolvedValue(new Map()),
  };

  const service = new CreativeAnalyticsService(prisma as never, metaCreatives as never);

  beforeEach(() => {
    jest.clearAllMocks();
    convWhere = undefined;
  });

  it('counts call_click events in recorded mode without status filter', async () => {
    const report = await service.getCreativeReport(
      { from: '2026-06-01T00:00:00.000Z', to: '2026-06-02T00:00:00.000Z' },
      { eventType: 'call_click', countMode: 'recorded' },
    );

    expect(convWhere).toMatchObject({
      eventType: { in: ['call_click'] },
    });
    expect(convWhere).not.toHaveProperty('status');
    expect(report.selectedEvent.totalEvents).toBe(2);
    expect(report.benchmarks.avgCr).toBe(50);
    expect(report.images.find((r) => r.key === 'img-a')?.conversions).toBe(2);
    expect(report.images.find((r) => r.key === 'img-a')?.crNum).toBe(100);
  });

  it('counts click_button events including clickbutton alias slugs', async () => {
    const report = await service.getCreativeReport(
      { from: '2026-06-01T00:00:00.000Z', to: '2026-06-02T00:00:00.000Z' },
      { eventType: 'click_button', countMode: 'recorded' },
    );

    expect(convWhere).toMatchObject({
      eventType: { in: expect.arrayContaining(['click_button', 'clickbutton']) },
    });
    expect(report.selectedEvent.totalEvents).toBe(1);
    expect(report.images.find((r) => r.key === 'img-b')?.conversions).toBe(1);
    expect(report.images.find((r) => r.key === 'img-b')?.crNum).toBe(100);
  });

  it('applies status sent filter in sent mode', async () => {
    await service.getCreativeReport(
      { from: '2026-06-01T00:00:00.000Z', to: '2026-06-02T00:00:00.000Z' },
      { eventType: 'call_click', countMode: 'sent' },
    );

    expect(convWhere).toMatchObject({ status: 'sent' });
  });

  it('allocates campaign spend proportionally by visits', async () => {
    const report = await service.getCreativeReport(
      { from: '2026-06-01T00:00:00.000Z', to: '2026-06-02T00:00:00.000Z', campaignId: 'camp-1' },
      { eventType: 'call_click', countMode: 'recorded' },
    );

    expect(report.summary.totalSpend).toBe(100);
    expect(report.benchmarks.avgCpv).toBe(50);
    expect(report.images.find((r) => r.key === 'img-a')?.spend).toBe(50);
    expect(report.images.find((r) => r.key === 'img-b')?.spend).toBe(50);
  });

  it('uses cached Meta image / headline / CTA when the click only has ad_id', async () => {
    prisma.click.findMany.mockResolvedValueOnce([
      {
        clickId: 'fb-1',
        campaignId: 'camp-1',
        assetId: null,
        contentName: null,
        adId: '23851234567890789',
        adTitle: 'img3_titleB_ctaDecouvrir',
        isBot: false,
        visitorId: 'v-fb',
      },
    ]);
    metaCreatives.getByAdIds.mockResolvedValueOnce(
      new Map([
        [
          '23851234567890789',
          {
            adId: '23851234567890789',
            adName: 'img3_titleB_ctaDecouvrir',
            headline: 'Découvrez notre offre',
            cta: 'Learn More',
            imageUrl: 'https://cdn.example/ad.jpg',
            thumbnailUrl: 'https://cdn.example/ad-thumb.jpg',
          },
        ],
      ]),
    );

    const report = await service.getCreativeReport(
      { from: '2026-06-01T00:00:00.000Z', to: '2026-06-02T00:00:00.000Z' },
      { eventType: 'call_click', countMode: 'recorded' },
    );

    expect(report.images[0]?.label).toBe('img3_titleB_ctaDecouvrir');
    expect(report.images[0]?.imageUrl).toBe('https://cdn.example/ad-thumb.jpg');
    expect(report.images[0]?.cta).toBe('Learn More');
    expect(report.headlines[0]?.label).toBe('Découvrez notre offre');
  });
});
