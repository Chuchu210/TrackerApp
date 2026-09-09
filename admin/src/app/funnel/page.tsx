'use client';

import { useCallback, useEffect, useState } from 'react';
import { AnalyticsTabs } from '@/components/AnalyticsTabs';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Label,
  Loading,
  PageHeader,
  Select,
  StatCard,
  mutedTextClass,
  sectionHeadingClass,
} from '@/components/ui';
import { DateRangePicker, buildPresets, type DateRange } from '@/components/DateRangePicker';
import { FunnelChart } from '@/components/FunnelChart';
import { FunnelPostbackFeed } from '@/components/FunnelPostbackFeed';
import { QuestionDropFunnel } from '@/components/QuestionDropFunnel';
import {
  trackerApi,
  type Campaign,
  type FunnelPostbackRow,
  type FunnelReport,
  type QuestionFunnelReport,
} from '@/lib/api';

export default function FunnelPage() {
  const [range, setRange] = useState<DateRange>(buildPresets()[2]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState('');
  const [landerId, setLanderId] = useState('');
  const [questionFunnel, setQuestionFunnel] = useState<QuestionFunnelReport | null>(null);
  const [funnel, setFunnel] = useState<FunnelReport | null>(null);
  const [postbacks, setPostbacks] = useState<FunnelPostbackRow[]>([]);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const params = {
    from: range.from,
    to: range.to,
    ...(campaignId ? { campaignId } : {}),
    ...(landerId ? { landerId } : {}),
  };

  const load = useCallback(() => {
    setLoading(true);
    const postbackParams = {
      ...params,
      limit: '100',
      ...(selectedStepId && selectedStepId !== 'visits' ? { eventType: selectedStepId } : {}),
    };
    Promise.all([
      trackerApi.getQuestionFunnel(params),
      trackerApi.getFunnel(params),
      trackerApi.getFunnelPostbacks(postbackParams),
    ])
      .then(([questions, conversions, pb]) => {
        setQuestionFunnel(questions);
        setFunnel(conversions);
        setPostbacks(pb);
        setError(null);
      })
      .catch((err) => {
        console.error(err);
        setError('Could not load the funnel.');
      })
      .finally(() => setLoading(false));
  }, [range.from, range.to, campaignId, landerId, selectedStepId]);

  useEffect(() => {
    trackerApi.getCampaigns().then(setCampaigns).catch(console.error);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selectedStep = funnel?.steps.find((s) => s.stepId === selectedStepId);
  const questions = questionFunnel?.steps.filter((s) => s.kind === 'question') ?? [];
  const firstQuestion = questions[0];
  const lastQuestion = questions[questions.length - 1];
  const startedPct = firstQuestion ? parseFloat(firstQuestion.rateFromVisitsPct) : 0;
  const finishedPct = lastQuestion ? parseFloat(lastQuestion.rateFromVisitsPct) : 0;

  if (loading && !questionFunnel) return <Loading label="Loading funnel..." />;

  return (
    <div>
      <AnalyticsTabs />
      <PageHeader
        title="LP Funnel"
        description="Drop-off at each quiz question, starting from people who landed on the page. Conversion postbacks stay below — they are a different thing."
        action={
          <Button variant="secondary" size="sm" onClick={load}>
            Refresh
          </Button>
        }
      />

      <div className="flex flex-wrap gap-4 mb-6 items-end">
        <DateRangePicker value={range} onChange={setRange} />
        <div className="min-w-[220px]">
          <Label>Campaign</Label>
          <Select
            value={campaignId}
            onChange={(e) => {
              setCampaignId(e.target.value);
              setLanderId('');
            }}
            className="w-full"
          >
            <option value="">All campaigns</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-[220px]">
          <Label>Landing page</Label>
          <Select
            value={landerId}
            onChange={(e) => setLanderId(e.target.value)}
            className="w-full"
          >
            <option value="">All landing pages</option>
            {(questionFunnel?.landers ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {error && (
        <div className="mb-6">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {questionFunnel && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <StatCard label="Arrived on LP" value={questionFunnel.visits} tone="green" />
            <StatCard
              label="Started the quiz"
              value={firstQuestion?.visits ?? 0}
              hint={firstQuestion ? `${startedPct.toFixed(1)}% of arrivals` : undefined}
            />
            <StatCard
              label="Reached last question"
              value={lastQuestion?.visits ?? 0}
              hint={lastQuestion ? `${finishedPct.toFixed(1)}% of arrivals` : undefined}
            />
            <StatCard
              label="Biggest drop"
              value={
                questionFunnel.worstDrop
                  ? `${questionFunnel.worstDrop.dropOffFromPrevPct}%`
                  : '—'
              }
              hint={questionFunnel.worstDrop?.label}
              tone={questionFunnel.worstDrop ? 'amber' : 'neutral'}
            />
          </div>

          <Card className="mb-8">
            <h2 className={`${sectionHeadingClass} mb-1`}>Drop at each question</h2>
            <p className={`text-xs ${mutedTextClass} mb-5`}>
              Each row is a question the landing page reported with{' '}
              <code className="font-mono">tkCallback.trackStep()</code>. The % drop is among
              people who reached the previous step — the first drop is people who landed and
              never started.
            </p>

            {questions.length === 0 ? (
              <EmptyState
                title="No quiz steps recorded yet"
                description="The LP is receiving visits, but it is not calling trackStep on each question. Until you add those calls, every quiz click collapses into a single click_button and you cannot see Q1 → Q2 → Q3."
              />
            ) : (
              <QuestionDropFunnel
                steps={questionFunnel.steps}
                worstStepKey={questionFunnel.worstDrop?.stepKey}
              />
            )}
          </Card>
        </>
      )}

      {funnel && (
        <>
          <div className="grid lg:grid-cols-2 gap-6 mb-8">
            <Card>
              <h2 className={`${sectionHeadingClass} mb-1`}>Business events (postbacks)</h2>
              <p className={`text-xs ${mutedTextClass} mb-4`}>
                View Content, Lead, Purchase — these fire network postbacks. Quiz questions
                are not here on purpose: one click_button cannot represent five questions.
              </p>
              <FunnelChart
                steps={funnel.steps}
                visits={funnel.visits}
                selectedStepId={selectedStepId}
                onSelectStep={setSelectedStepId}
              />
            </Card>

            <Card>
              <h2 className={`${sectionHeadingClass} mb-1`}>Selected event</h2>
              {selectedStep ? (
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <Stat label="Unique visitors" value={String(selectedStep.uniqueVisitors)} />
                  <Stat label="% of LP visits" value={`${selectedStep.rateFromVisitsPct}%`} />
                  <Stat label="Drop from prev step" value={`${selectedStep.dropOffFromPrevPct}%`} />
                  <Stat label="Postbacks sent" value={String(selectedStep.postbacksSent)} />
                  <Stat label="Postbacks failed" value={String(selectedStep.postbacksFailed)} />
                  <Stat label="Revenue" value={`€${selectedStep.revenue.toFixed(2)}`} />
                </dl>
              ) : (
                <p className={`text-sm ${mutedTextClass}`}>
                  Click a business event to filter the outbound postbacks below.
                </p>
              )}
            </Card>
          </div>

          <h2 className={`${sectionHeadingClass} mb-3`}>
            Outbound postbacks
            {selectedStep && (
              <span className={`font-normal ${mutedTextClass} ml-2`}>— {selectedStep.label}</span>
            )}
          </h2>
          <FunnelPostbackFeed rows={postbacks} />
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-zinc-50 dark:bg-zinc-800/60 rounded px-2 py-1.5">
      <dt className={mutedTextClass}>{label}</dt>
      <dd className="font-medium text-zinc-900 dark:text-zinc-50">{value}</dd>
    </div>
  );
}
