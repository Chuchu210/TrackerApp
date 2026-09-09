import { LP_FUNNEL_STEPS } from '../src/shared/tracking/lp-funnel';

describe('LP funnel steps', () => {
  it('starts with visits and includes mediago funnel events', () => {
    expect(LP_FUNNEL_STEPS[0].stepId).toBe('visits');
    const viewContent = LP_FUNNEL_STEPS.find((s) => s.stepId === 'viewcontent');
    expect(viewContent?.mediagoCode).toBe(1);
    expect(LP_FUNNEL_STEPS.find((s) => s.stepId === 'quiz_started')?.slugs).toContain('quiz_started');
    expect(LP_FUNNEL_STEPS.find((s) => s.stepId === 'lead')?.slugs).toContain('lead');
    expect(LP_FUNNEL_STEPS.find((s) => s.stepId === 'call_connected')?.mediagoCode).toBe(14);
    expect(LP_FUNNEL_STEPS.find((s) => s.stepId === 'purchase')?.mediagoCode).toBe(8);
  });
});
