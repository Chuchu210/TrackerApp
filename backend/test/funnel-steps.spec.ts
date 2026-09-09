import { FunnelStepsService } from '../src/analytics/funnel-steps.service';

describe('FunnelStepsService.record', () => {
  const prisma = {
    click: { findUnique: jest.fn() },
    funnelStepEvent: { create: jest.fn(), groupBy: jest.fn(), findMany: jest.fn() },
  };
  const settings = { isTestMode: jest.fn().mockResolvedValue(false) };
  const service = new FunnelStepsService(prisma as never, settings as never);

  beforeEach(() => {
    jest.clearAllMocks();
    settings.isTestMode.mockResolvedValue(false);
    prisma.click.findUnique.mockResolvedValue({
      clickId: 'click-1',
      campaignId: 'camp-1',
      isTest: false,
    });
    prisma.funnelStepEvent.create.mockResolvedValue({});
  });

  it('records a step against the click campaign', async () => {
    const res = await service.record({
      clickId: 'click-1',
      stepIndex: 2,
      stepKey: 'q2',
      stepLabel: 'Question 2',
    });

    expect(res.recorded).toBe(true);
    expect(prisma.funnelStepEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clickId: 'click-1',
        campaignId: 'camp-1',
        stepIndex: 2,
        stepKey: 'q2',
        stepLabel: 'Question 2',
        isTest: false,
      }),
    });
  });

  it('ignores a step for an unknown click', async () => {
    prisma.click.findUnique.mockResolvedValue(null);
    const res = await service.record({ clickId: 'nope', stepIndex: 1, stepKey: 'q1' });
    expect(res.recorded).toBe(false);
    expect(prisma.funnelStepEvent.create).not.toHaveBeenCalled();
  });

  // Going back and re-answering must not inflate the step count: the unique
  // index rejects it and we swallow the error.
  it('does not double count a step already reached', async () => {
    prisma.funnelStepEvent.create.mockRejectedValue(new Error('unique constraint'));
    const res = await service.record({ clickId: 'click-1', stepIndex: 1, stepKey: 'q1' });
    expect(res.recorded).toBe(false);
  });

  it('stamps test rows when the tracker is in test mode', async () => {
    settings.isTestMode.mockResolvedValue(true);
    await service.record({ clickId: 'click-1', stepIndex: 1, stepKey: 'q1' });
    expect(prisma.funnelStepEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ isTest: true }),
    });
  });

  it('rejects an empty step key', async () => {
    const res = await service.record({ clickId: 'click-1', stepIndex: 1, stepKey: '   ' });
    expect(res.recorded).toBe(false);
    expect(prisma.funnelStepEvent.create).not.toHaveBeenCalled();
  });
});

describe('FunnelStepsService.getStepFunnel', () => {
  const prisma = {
    click: { count: jest.fn() },
    funnelStepEvent: { groupBy: jest.fn(), findMany: jest.fn() },
  };
  const settings = { isTestMode: jest.fn() };
  const service = new FunnelStepsService(prisma as never, settings as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.click.count.mockResolvedValue(200);
    prisma.funnelStepEvent.groupBy.mockResolvedValue([
      { stepIndex: 1, stepKey: 'q1', _count: { _all: 100 } },
      { stepIndex: 2, stepKey: 'q2', _count: { _all: 60 } },
      { stepIndex: 3, stepKey: 'q3', _count: { _all: 45 } },
    ]);
    prisma.funnelStepEvent.findMany.mockResolvedValue([
      { stepKey: 'q1', stepLabel: 'Question 1' },
      { stepKey: 'q2', stepLabel: 'Question 2' },
    ]);
  });

  it('reports reach and drop-off per step', async () => {
    const res = await service.getStepFunnel('camp-1');

    expect(res.visits).toBe(200);
    expect(res.steps).toHaveLength(3);

    // 100 of 200 arrivals reached q1 — half the traffic is lost before the
    // first question, which is exactly what we want to see.
    expect(res.steps[0]).toMatchObject({
      stepKey: 'q1',
      label: 'Question 1',
      visits: 100,
      rateFromVisitsPct: '50.0',
      dropOffFromPrevPct: '50.0',
    });

    // q1 -> q2 loses 40 of 100.
    expect(res.steps[1]).toMatchObject({
      stepKey: 'q2',
      visits: 60,
      rateFromVisitsPct: '30.0',
      dropOffFromPrevPct: '40.0',
    });

    // No stored label for q3: fall back to the key rather than showing nothing.
    expect(res.steps[2].label).toBe('q3');
  });

  it('scopes to one campaign', async () => {
    await service.getStepFunnel('camp-1');
    expect(prisma.funnelStepEvent.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ campaignId: 'camp-1' }),
      }),
    );
  });

  it('excludes test rows unless asked', async () => {
    await service.getStepFunnel('camp-1');
    expect(prisma.funnelStepEvent.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isTest: false }) }),
    );

    jest.clearAllMocks();
    prisma.click.count.mockResolvedValue(0);
    prisma.funnelStepEvent.groupBy.mockResolvedValue([]);
    await service.getStepFunnel('camp-1', undefined, undefined, true);
    const where = prisma.funnelStepEvent.groupBy.mock.calls[0][0].where;
    expect(where.isTest).toBeUndefined();
  });

  it('does not divide by zero without traffic', async () => {
    prisma.click.count.mockResolvedValue(0);
    prisma.funnelStepEvent.groupBy.mockResolvedValue([
      { stepIndex: 1, stepKey: 'q1', _count: { _all: 0 } },
    ]);
    prisma.funnelStepEvent.findMany.mockResolvedValue([]);

    const res = await service.getStepFunnel('camp-1');
    expect(res.steps[0].rateFromVisitsPct).toBe('0.0');
    expect(res.steps[0].dropOffFromPrevPct).toBe('0.0');
  });
});
