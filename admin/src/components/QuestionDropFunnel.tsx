'use client';

import type { QuestionFunnelStep } from '@/lib/api';
import { mutedTextClass, sectionHeadingClass } from '@/components/ui';

function dropCopy(step: QuestionFunnelStep, isFirstQuestion: boolean): string {
  if (step.leftHere <= 0) {
    return isFirstQuestion
      ? 'Everyone who arrived reached the first question.'
      : 'Everyone who reached the previous question continued.';
  }
  if (isFirstQuestion) {
    return `${step.leftHere.toLocaleString()} people arrived and never started the quiz (${step.dropOffFromPrevPct}% of LP arrivals).`;
  }
  return `${step.leftHere.toLocaleString()} people left here — ${step.dropOffFromPrevPct}% of those who reached the previous question did not continue.`;
}

export function QuestionDropFunnel({
  steps,
  worstStepKey,
}: {
  steps: QuestionFunnelStep[];
  worstStepKey?: string | null;
}) {
  const arrivals = steps[0]?.visits || 0;
  const maxCount = Math.max(arrivals, 1);

  return (
    <div className="space-y-0">
      {steps.map((step, idx) => {
        const widthPct = Math.max(6, (step.visits / maxCount) * 100);
        const isArrival = step.kind === 'arrival';
        const isFirstQuestion = step.kind === 'question' && idx === 1;
        const isWorst = step.kind === 'question' && step.stepKey === worstStepKey && step.leftHere > 0;
        const stillPct = parseFloat(step.rateFromVisitsPct);

        return (
          <div key={step.stepKey}>
            {!isArrival && (
              <div
                className={`flex items-stretch gap-3 pl-3 py-2 ${
                  isWorst ? 'text-red-700 dark:text-red-300' : 'text-zinc-500 dark:text-zinc-400'
                }`}
              >
                <div className="w-px bg-zinc-200 dark:bg-zinc-700 ml-2.5" />
                <p className="text-xs leading-5">
                  {isWorst ? <span className="font-semibold">Biggest drop — </span> : null}
                  {dropCopy(step, isFirstQuestion)}
                </p>
              </div>
            )}

            <div
              className={`rounded-xl border p-4 ${
                isArrival
                  ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30'
                  : isWorst
                    ? 'border-red-300 bg-red-50/70 dark:border-red-800 dark:bg-red-950/30'
                    : 'border-zinc-200 dark:border-zinc-700'
              }`}
            >
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="min-w-0">
                  <p className={`text-[11px] uppercase tracking-wide ${mutedTextClass}`}>
                    {isArrival ? 'Landing page' : `Question ${step.stepIndex || idx}`}
                  </p>
                  <p className={`text-sm font-semibold ${sectionHeadingClass} truncate`}>
                    {step.label}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className={`text-xl font-semibold tabular-nums ${sectionHeadingClass}`}>
                    {step.visits.toLocaleString()}
                  </p>
                  <p className={`text-xs ${mutedTextClass}`}>
                    {isArrival ? 'people arrived' : `${stillPct.toFixed(1)}% of LP arrivals`}
                  </p>
                </div>
              </div>

              <div className="h-3 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    isArrival ? 'bg-emerald-500' : isWorst ? 'bg-red-500' : 'bg-indigo-500'
                  }`}
                  style={{ width: `${widthPct}%` }}
                />
              </div>

              {!isArrival && (
                <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <dt className={mutedTextClass}>Reached this question</dt>
                    <dd className="font-medium tabular-nums text-zinc-900 dark:text-zinc-50">
                      {step.visits.toLocaleString()}
                    </dd>
                  </div>
                  <div>
                    <dt className={mutedTextClass}>Left before it</dt>
                    <dd className="font-medium tabular-nums text-red-700 dark:text-red-300">
                      {step.leftHere.toLocaleString()}
                    </dd>
                  </div>
                  <div>
                    <dt className={mutedTextClass}>Drop vs previous</dt>
                    <dd className="font-medium tabular-nums text-zinc-900 dark:text-zinc-50">
                      {step.dropOffFromPrevPct}%
                    </dd>
                  </div>
                </dl>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
