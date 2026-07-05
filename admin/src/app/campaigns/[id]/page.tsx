'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useToast } from '@/components/Toast';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  CodeBlock,
  Input,
  InlineLink,
  Label,
  Loading,
  Select,
  StatCard,
  TableHead,
  Th,
  bodyTextClass,
  inlineCodeClass,
  mutedTextClass,
  pageTitleClass,
  sectionHeadingClass,
  statusTone,
  tableRowClass,
} from '@/components/ui';
import { PostbackPreview } from '@/components/PostbackPreview';
import { IncomingConversionGuide } from '@/components/IncomingConversionGuide';
import { MediagoConversionTypeTable } from '@/components/MediagoConversionTypeTable';
import {
  trackerApi,
  formatApiError,
  type Campaign,
  type PostbackConfig,
  type TrackingDomain,
  type TrafficSourceProfile,
  type VisitStats,
  type CampaignTarget,
  type CampaignPacing,
} from '@/lib/api';

type CampaignForm = {
  name: string;
  slug: string;
  externalId: string;
  trafficSourceProfileId: string;
  trackingMode: 'redirect' | 'direct';
  redirectMode: 'http_302' | 'meta_refresh' | 'double_meta';
  domainId: string;
  destinationUrl: string;
  active: boolean;
  landerName: string;
  offerName: string;
  workspaceName: string;
  attributionWindowHours: number | null;
  maxConversionsPerClick: number | null;
};

function toForm(c: Campaign): CampaignForm {
  return {
    name: c.name,
    slug: c.slug,
    externalId: c.externalId || '',
    trafficSourceProfileId: c.trafficSourceProfileId || c.trafficSourceProfile?.id || '',
    trackingMode: c.trackingMode || 'redirect',
    redirectMode: c.redirectMode || 'http_302',
    domainId: c.domainId || '',
    destinationUrl: c.destinationUrl,
    active: c.active,
    landerName: c.landerName || '',
    offerName: c.offerName || '',
    workspaceName: c.workspaceName || '',
    attributionWindowHours: c.attributionWindowHours ?? null,
    maxConversionsPerClick: c.maxConversionsPerClick ?? null,
  };
}

export default function CampaignDetailPage() {
  const toast = useToast();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [form, setForm] = useState<CampaignForm | null>(null);
  const [stats, setStats] = useState<VisitStats | null>(null);
  const [postback, setPostback] = useState<Partial<PostbackConfig>>({});
  const [domains, setDomains] = useState<TrackingDomain[]>([]);
  const [profiles, setProfiles] = useState<TrafficSourceProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [target, setTarget] = useState<Partial<CampaignTarget>>({});
  const [pacing, setPacing] = useState<CampaignPacing | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadCampaign = async () => {
      setLoading(true);
      try {
        const c = await trackerApi.getCampaign(id);
        if (cancelled) return;
        setCampaign(c);
        setForm(toForm(c));
        if (c.postbackConfig) setPostback(c.postbackConfig);
        setError(null);
        trackerApi.getCampaignTarget(id).then((t) => { if (!cancelled && t) setTarget(t); }).catch(() => {});
        trackerApi.getCampaignPacing(id).then((p) => { if (!cancelled) setPacing(p); }).catch(() => {});
      } catch (err) {
        console.error('Failed to load campaign:', err);
        if (!cancelled) {
          setCampaign(null);
          setForm(null);
          setError(formatApiError(err));
        }
      }
      try {
        const s = await trackerApi.getStats(id);
        if (!cancelled) setStats(s);
      } catch (err) {
        console.error('Failed to load campaign stats:', err);
        if (!cancelled) setStats(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadCampaign();
    trackerApi.getDomains().then((d) => { if (!cancelled) setDomains(d); }).catch(console.error);
    trackerApi.getTrafficSources().then((p) => { if (!cancelled) setProfiles(p); }).catch(console.error);

    return () => { cancelled = true; };
  }, [id]);

  const saveCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    try {
      const updated = await trackerApi.updateCampaign(id, form);
      setCampaign(updated);
      setForm(toForm(updated));
      toast.success('Campaign saved');
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const deleteCampaign = async () => {
    if (!campaign) return;
    const confirmed = window.confirm(
      `Delete "${campaign.name}"?\n\nThis permanently removes the campaign and all its clicks and conversions.`,
    );
    if (!confirmed) return;

    setDeleting(true);
    try {
      await trackerApi.deleteCampaign(id);
      router.push('/');
    } catch (err) {
      toast.error(formatApiError(err));
      setDeleting(false);
    }
  };

  const savePostback = async () => {
    try {
      const updated = await trackerApi.updatePostbackConfig(id, postback);
      setCampaign(updated);
      toast.success('Postback config saved');
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  if (loading) return <Loading />;
  if (!campaign || !form) return <Alert tone="error">Campaign not found</Alert>;

  return (
    <div>
      <InlineLink href="/" className="text-sm font-medium mb-6 inline-block">
        ← Back to campaigns
      </InlineLink>

      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="flex items-center gap-3">
            <h1 className={pageTitleClass}>{campaign.name}</h1>
            <Badge tone={campaign.active ? 'success' : 'neutral'}>
              {campaign.active ? 'Active' : 'Stopped'}
            </Badge>
            <Badge tone={statusTone(campaign.trackingMode)}>{campaign.trackingMode}</Badge>
          </div>
          <p className={`text-sm ${mutedTextClass} capitalize mt-1`}>
            {campaign.trafficSourceProfile?.name || campaign.trafficSource} · {campaign.slug}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                const updated = await trackerApi.updateCampaign(id, { active: !campaign.active });
                setCampaign(updated);
                setForm(toForm(updated));
              } catch (err) {
                toast.error(formatApiError(err));
              }
            }}
          >
            {campaign.active ? 'Stop campaign' : 'Enable campaign'}
          </Button>
          <Button variant="danger" onClick={deleteCampaign} disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      </div>

      <div className="mb-6">
        <InlineLink href={`/campaigns/${id}/paths`} className="text-sm font-medium">
          Manage paths &amp; rotation →
        </InlineLink>
      </div>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
          <StatCard label="Visits" value={stats.visits} />
          <StatCard label="Unique visits" value={stats.uniqueVisits} />
          <StatCard label="New visitors" value={stats.newVisitors} />
          <StatCard label="Returning" value={stats.returningVisitors} />
          <StatCard label="Conversions" value={stats.conversions} />
          <StatCard label="Conversion rate" value={`${stats.conversionRate}%`} />
        </div>
      )}

      <Card className="mb-6">
      <form onSubmit={saveCampaign} className="grid gap-4">
        <h2 className={sectionHeadingClass}>Edit campaign</h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Name</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>
          <div>
            <Label>Slug</Label>
            <Input
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
              className="font-mono text-sm"
              required
            />
          </div>
        </div>

        <div>
          <Label>External ID (Voluum UUID path)</Label>
          <Input
            value={form.externalId}
            onChange={(e) => setForm({ ...form, externalId: e.target.value })}
            className="font-mono text-sm"
            placeholder="8d92ac23-ca85-497e-87c4-44ddd2ade345"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Traffic source profile</Label>
            <Select
              value={form.trafficSourceProfileId}
              onChange={(e) => {
                const profile = profiles.find((p) => p.id === e.target.value);
                setForm({
                  ...form,
                  trafficSourceProfileId: e.target.value,
                  trackingMode: profile?.trackingModeDefault || form.trackingMode,
                });
              }}
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <InlineLink
              href={`/traffic-sources/${campaign.trafficSourceProfileId || ''}`}
              className="text-xs mt-1 inline-block"
            >
              Edit profile →
            </InlineLink>
          </div>
          <div>
            <Label>Tracking mode</Label>
            <Select
              value={form.trackingMode}
              onChange={(e) =>
                setForm({ ...form, trackingMode: e.target.value as 'redirect' | 'direct' })
              }
            >
              <option value="redirect">Redirect (native — Mediago/Outbrain)</option>
              <option value="direct">Direct LP (Facebook/Google)</option>
            </Select>
          </div>
        </div>

        {form.trackingMode === 'redirect' && (
          <div>
            <Label>Redirect mode (referrer hiding)</Label>
            <Select
              value={form.redirectMode}
              onChange={(e) =>
                setForm({
                  ...form,
                  redirectMode: e.target.value as CampaignForm['redirectMode'],
                })
              }
            >
              <option value="http_302">HTTP 302 (default, fastest)</option>
              <option value="meta_refresh">Meta refresh (hide referrer)</option>
              <option value="double_meta">Double meta (hide referrer chain)</option>
            </Select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Attribution window (hours)</Label>
            <Input
              type="number"
              min={0}
              placeholder="No limit"
              value={form.attributionWindowHours ?? ''}
              onChange={(e) =>
                setForm({
                  ...form,
                  attributionWindowHours: e.target.value ? parseInt(e.target.value, 10) : null,
                })
              }
            />
            <p className={`text-xs ${mutedTextClass} mt-1`}>
              Reject conversions older than N hours after the click. Empty = no limit.
            </p>
          </div>
          <div>
            <Label>Max conversions per click</Label>
            <Input
              type="number"
              min={0}
              placeholder="Unlimited"
              value={form.maxConversionsPerClick ?? ''}
              onChange={(e) =>
                setForm({
                  ...form,
                  maxConversionsPerClick: e.target.value ? parseInt(e.target.value, 10) : null,
                })
              }
            />
            <p className={`text-xs ${mutedTextClass} mt-1`}>
              Cap conversions per click to curb injection. Empty = unlimited.
            </p>
          </div>
        </div>

        <Checkbox
          label="Active — accepts new clicks/visits"
          checked={form.active}
          onChange={(checked) => setForm({ ...form, active: checked })}
        />

        <div>
          <Label>Tracking domain</Label>
          <Select
            value={form.domainId}
            onChange={(e) => setForm({ ...form, domainId: e.target.value })}
          >
            <option value="">Default tracker URL</option>
            {domains
              .filter((d) => d.status === 'verified')
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.hostname}
                </option>
              ))}
          </Select>
        </div>

        <div>
          <Label>Destination URL (landing page)</Label>
          <Input
            value={form.destinationUrl}
            onChange={(e) => setForm({ ...form, destinationUrl: e.target.value })}
            required
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <Label>Lander name</Label>
            <Input
              value={form.landerName}
              onChange={(e) => setForm({ ...form, landerName: e.target.value })}
            />
          </div>
          <div>
            <Label>Offer name</Label>
            <Input
              value={form.offerName}
              onChange={(e) => setForm({ ...form, offerName: e.target.value })}
            />
          </div>
          <div>
            <Label>Workspace name</Label>
            <Input
              value={form.workspaceName}
              onChange={(e) => setForm({ ...form, workspaceName: e.target.value })}
            />
          </div>
        </div>

        <Button type="submit" disabled={saving} className="w-fit">
          {saving ? 'Saving...' : 'Save campaign'}
        </Button>
      </form>
      </Card>

      <Card className="mb-6">
        <h2 className={`${sectionHeadingClass} mb-3`}>
          {campaign.trackingMode === 'direct' ? 'Direct Ad URL' : 'Redirect Click URL'}
        </h2>
        {campaign.setupNote && (
          <div className="mb-3">
            <Alert tone="info">{campaign.setupNote}</Alert>
          </div>
        )}
        <CodeBlock>{campaign.trackingTemplate}</CodeBlock>
      </Card>

      {campaign.paramMappings && campaign.paramMappings.length > 0 && (
        <Card className="mb-6">
          <h2 className={`${sectionHeadingClass} mb-3`}>Param mapping (inherited)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <TableHead>
                <Th>Display</Th>
                <Th>Internal</Th>
                <Th>External keys</Th>
                <Th>In reports</Th>
              </TableHead>
              <tbody>
                {campaign.paramMappings.map((m) => (
                  <tr key={m.internalField} className={tableRowClass}>
                    <td className="py-2 px-5">{m.displayLabel}</td>
                    <td className={`py-2 px-5 font-mono ${mutedTextClass}`}>{m.internalField}</td>
                    <td className="py-2 px-5 font-mono">{m.externalKeys.join(', ')}</td>
                    <td className="py-2 px-5">{m.showInReports ? 'Yes' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card className="mb-6">
        <h2 className={`${sectionHeadingClass} mb-3`}>LP Script</h2>
        <CodeBlock>{campaign.lpScriptSnippet || ''}</CodeBlock>
      </Card>

      <Card className="mb-6">
        <h2 className={`${sectionHeadingClass} mb-3`}>
          Incoming conversion URL (tell your LP / CRM)
        </h2>
        {campaign.domain && (
          <p className={`text-xs ${mutedTextClass} mb-3`}>
            Tracking domain: <span className="font-mono">{campaign.domain.hostname}</span> — this
            campaign&apos;s unique conversion endpoint.
          </p>
        )}
        <IncomingConversionGuide
          trackerBaseUrl={campaign.trackerBaseUrl}
          incomingConversionUrl={campaign.incomingConversionUrl}
          incomingConversionUrlAlt={campaign.incomingConversionUrlAlt}
          trackingMode={campaign.trackingMode}
          lpScriptSnippet={campaign.lpScriptSnippet}
        />
      </Card>

      <Card className="mb-6">
        <h2 className={`${sectionHeadingClass} mb-3`}>Outbound conversion (what we send)</h2>
        <PostbackPreview
          conversionMethod={campaign.conversionMethod}
          postback={postback}
        />
        <p className={`text-xs ${mutedTextClass} mt-4`}>
          After a real conversion, expand it on the <strong>Conversions</strong> page to see the exact
          URL/body sent and Mediago/Facebook/Google response.
        </p>
      </Card>

      <Card>
        <h2 className={`${sectionHeadingClass} mb-4`}>Postback Configuration</h2>

        <p className={`text-sm ${mutedTextClass} mb-4`}>
          Conversion method:{' '}
          <span className={`font-medium ${bodyTextClass}`}>
            {(campaign.conversionMethod || 'mediago_s2s').replace(/_/g, ' ')}
          </span>
        </p>

        <fieldset className="border border-zinc-200 dark:border-zinc-700 rounded-xl p-4 mb-4">
          <legend className={`px-2 text-sm font-medium ${bodyTextClass}`}>
            Incoming postback security
          </legend>
          <Label>
            Shared secret — networks must append{' '}
            <code className={inlineCodeClass}>?secret=…</code> on S2S postbacks
          </Label>
          <Input
            type="text"
            placeholder="Leave empty to rely on IP allowlist only"
            value={postback.postbackSecret ?? ''}
            onChange={(e) => setPostback({ ...postback, postbackSecret: e.target.value })}
            className="font-mono text-sm"
          />
          <p className={`text-xs ${mutedTextClass} mt-2`}>
            When set, incoming <code className={inlineCodeClass}>/postback</code> calls without a
            matching secret (or an allowlisted IP) are rejected. Empty = unsecured (legacy).
          </p>
        </fieldset>

        <div className="space-y-4">
          {(campaign.conversionMethod === 'mediago_s2s' || !campaign.conversionMethod) && (
          <fieldset className="border border-zinc-200 dark:border-zinc-700 rounded-xl p-4">
            <legend className={`px-2 text-sm font-medium ${bodyTextClass}`}>Mediago S2S</legend>
            <Checkbox
              label="Enabled"
              checked={postback.mediagoEnabled ?? true}
              onChange={(checked) => setPostback({ ...postback, mediagoEnabled: checked })}
              className="mb-2"
            />
            <Label>
              Mediago account name (<code className={inlineCodeClass}>accountname</code>) — required for Mediago test dashboard
            </Label>
            <Input
              type="text"
              placeholder="my_account_name (from Mediago dashboard)"
              value={postback.mediagoAccountName ?? ''}
              onChange={(e) =>
                setPostback({ ...postback, mediagoAccountName: e.target.value })
              }
              className="mb-3"
            />
            <Label>
              Fallback conversion type (used only when event type is unknown)
            </Label>
            <Input
              type="number"
              placeholder="Fallback (10 = Lead)"
              value={postback.mediagoConversionType ?? 10}
              onChange={(e) =>
                setPostback({ ...postback, mediagoConversionType: parseInt(e.target.value, 10) })
              }
            />
            <p className={`text-xs ${mutedTextClass} mt-2`}>
              Postback format:{' '}
              <code className={inlineCodeClass}>
                trackingid=TRACKING_ID&amp;adid=AD_ID&amp;conversiontype=1&amp;accountname=…
              </code>
            </p>
          </fieldset>
          )}

          {(campaign.conversionMethod === 'mediago_s2s' || !campaign.conversionMethod) && (
            <div className="mt-4">
              <MediagoConversionTypeTable compact />
            </div>
          )}

          {campaign.conversionMethod === 'facebook_capi' && (
          <fieldset className="border border-zinc-200 dark:border-zinc-700 rounded-xl p-4">
            <legend className={`px-2 text-sm font-medium ${bodyTextClass}`}>Facebook CAPI</legend>
            <Checkbox
              label="Enabled"
              checked={postback.facebookEnabled ?? false}
              onChange={(checked) => setPostback({ ...postback, facebookEnabled: checked })}
              className="mb-2"
            />
            <Input
              placeholder="Pixel ID"
              value={postback.facebookPixelId || ''}
              onChange={(e) => setPostback({ ...postback, facebookPixelId: e.target.value })}
              className="mb-2"
            />
            <Input
              placeholder="Access Token"
              value={postback.facebookAccessToken || ''}
              onChange={(e) => setPostback({ ...postback, facebookAccessToken: e.target.value })}
            />
          </fieldset>
          )}

          {campaign.conversionMethod === 'google_offline' && (
          <fieldset className="border border-zinc-200 dark:border-zinc-700 rounded-xl p-4">
            <legend className={`px-2 text-sm font-medium ${bodyTextClass}`}>Google</legend>
            <Checkbox
              label="Enabled"
              checked={postback.googleEnabled ?? false}
              onChange={(checked) => setPostback({ ...postback, googleEnabled: checked })}
              className="mb-2"
            />
            <Input
              placeholder="Conversion ID"
              value={postback.googleConversionId || ''}
              onChange={(e) => setPostback({ ...postback, googleConversionId: e.target.value })}
              className="mb-2"
            />
            <Input
              placeholder="Conversion Label"
              value={postback.googleConversionLabel || ''}
              onChange={(e) => setPostback({ ...postback, googleConversionLabel: e.target.value })}
              className="mb-2"
            />
            <Input
              placeholder="Custom postback URL (optional)"
              value={postback.googlePostbackUrl || ''}
              onChange={(e) => setPostback({ ...postback, googlePostbackUrl: e.target.value })}
            />
          </fieldset>
          )}
        </div>

        <Button onClick={savePostback} className="mt-4">
          Save Postback Config
        </Button>
      </Card>

      <Card className="mt-6">
        <h2 className={`text-lg font-semibold text-zinc-900 dark:text-zinc-50 mb-4`}>Budget & targets</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <div>
            <Label>Daily budget ($)</Label>
            <Input
              type="number"
              value={target.dailyBudget ?? ''}
              onChange={(e) =>
                setTarget({ ...target, dailyBudget: e.target.value ? parseFloat(e.target.value) : null })
              }
            />
          </div>
          <div>
            <Label>CPA target ($)</Label>
            <Input
              type="number"
              value={target.cpaTarget ?? ''}
              onChange={(e) =>
                setTarget({ ...target, cpaTarget: e.target.value ? parseFloat(e.target.value) : null })
              }
            />
          </div>
          <div>
            <Label>ROAS target (x)</Label>
            <Input
              type="number"
              step="0.1"
              value={target.roasTarget ?? ''}
              onChange={(e) =>
                setTarget({ ...target, roasTarget: e.target.value ? parseFloat(e.target.value) : null })
              }
            />
          </div>
        </div>
        {pacing && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <StatCard label="Spend today" value={`$${pacing.spendSoFar.toFixed(2)}`} />
            <StatCard
              label="Projected EOD"
              value={`$${pacing.projectedSpend.toFixed(2)}`}
            />
            <StatCard
              label="Budget used"
              value={pacing.budgetPct != null ? `${pacing.budgetPct.toFixed(0)}%` : '—'}
            />
            <StatCard label="CPA actual" value={`$${pacing.cpaActual.toFixed(2)}`} />
          </div>
        )}
        <div className="flex gap-2">
          <Button
            onClick={async () => {
              await trackerApi.upsertCampaignTarget(id, target);
              const p = await trackerApi.getCampaignPacing(id);
              setPacing(p);
            }}
          >
            Save targets
          </Button>
          <Button
            variant="secondary"
            onClick={async () => {
              const r = await trackerApi.pauseMediagoCampaign(id);
              toast.info(r.message);
            }}
          >
            Pause on Mediago
          </Button>
        </div>
      </Card>
    </div>
  );
}
