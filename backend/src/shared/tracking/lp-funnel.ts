import { MEDIAGO_CONVERSION_TYPE_TABLE } from './mediago-conversion-types';

export type LpFunnelStepDef = {
  stepId: string;
  label: string;
  kind: 'visit' | 'event';
  slugs?: string[];
  mediagoCode?: number;
  sortOrder: number;
};

/** Canonical LP funnel order for drop-off analysis */
export const LP_FUNNEL_STEPS: LpFunnelStepDef[] = [
  { stepId: 'visits', label: 'LP Arrivals', kind: 'visit', sortOrder: 0 },
  { stepId: 'viewcontent', label: 'View Content', kind: 'event', slugs: ['viewcontent', 'view_content', 'pageview'], mediagoCode: 1, sortOrder: 10 },
  { stepId: 'quiz_started', label: 'Quiz started', kind: 'event', slugs: ['quiz_started', 'quiz_q1'], mediagoCode: 12, sortOrder: 16 },
  { stepId: 'quiz_q2', label: 'Question 2', kind: 'event', slugs: ['quiz_q2'], sortOrder: 17 },
  { stepId: 'quiz_q3', label: 'Question 3', kind: 'event', slugs: ['quiz_q3'], sortOrder: 18 },
  { stepId: 'click_button', label: 'Click Button', kind: 'event', slugs: ['click_button', 'clickbutton'], mediagoCode: 12, sortOrder: 20 },
  { stepId: 'call_click', label: 'Call started', kind: 'event', slugs: ['call_click', 'call_started'], mediagoCode: 12, sortOrder: 25 },
  { stepId: 'lead', label: 'Lead', kind: 'event', slugs: ['lead', 'postalcode', 'callback_request'], mediagoCode: 10, sortOrder: 30 },
  { stepId: 'call_connected', label: 'Call Connected', kind: 'event', slugs: ['call_connected', 'callconnected'], mediagoCode: 14, sortOrder: 40 },
  { stepId: 'lead_qualified', label: 'Lead Qualified', kind: 'event', slugs: ['lead_qualified', 'age_60', 'hearing_loss'], mediagoCode: 13, sortOrder: 50 },
  { stepId: 'account_opening', label: 'Application Started', kind: 'event', slugs: ['account_opening', 'application_started'], mediagoCode: 16, sortOrder: 60 },
  { stepId: 'account_validated', label: 'Application Approved', kind: 'event', slugs: ['account_validated', 'application_approved'], mediagoCode: 17, sortOrder: 70 },
  { stepId: 'purchase', label: 'Purchase / Sale', kind: 'event', slugs: ['purchase', 'sale', 'sales'], mediagoCode: 8, sortOrder: 80 },
];

const slugToStep = new Map<string, LpFunnelStepDef>();
for (const step of LP_FUNNEL_STEPS) {
  if (step.slugs) {
    for (const slug of step.slugs) {
      slugToStep.set(slug, step);
    }
  }
}

export function funnelStepForEventSlug(slug: string): LpFunnelStepDef | undefined {
  return slugToStep.get(slug);
}

export function mediagoLabelForCode(code: number): string {
  const row = MEDIAGO_CONVERSION_TYPE_TABLE.find((r) => r.code === code);
  return row?.label ?? `Type ${code}`;
}
