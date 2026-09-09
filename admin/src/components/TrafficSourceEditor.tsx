'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/Toast';
import { Button, Card, Checkbox, Input, Label, Select, Textarea, inlineCodeClass, linkClass, mutedTextClass, sectionHeadingClass } from '@/components/ui';
import { trackerApi, formatApiError, type ParamMapping, type TrafficSourceProfile } from '@/lib/api';
import {
  DEFAULT_MEDIAGO_POSTBACK_URL,
  POSTBACK_TOKEN_DEFINITIONS,
} from '@/lib/postback-tokens';

const CANONICAL_FIELDS = [
  'tracking_id',
  'external_click_id',
  'gclid',
  'fbclid',
  'ad_id',
  'ad_title',
  'adset_id',
  'adset_name',
  'campaign_external_id',
  'publisher_name',
  'site_id',
  'content_name',
  'platform',
  'asset_id',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'cv1',
  'cv2',
  'cv3',
  'cv4',
  'cv5',
  'cv6',
  'cv7',
  'cv8',
  'cv9',
  'cv10',
];

const CONVERSION_METHODS = [
  'mediago_s2s',
  'facebook_capi',
  'google_offline',
  'outbrain_s2s',
  'generic_postback',
  'none',
];

type Tab = 'general' | 'url' | 'params' | 'conversion';

export function TrafficSourceEditor({
  initial,
  isNew,
}: {
  initial?: TrafficSourceProfile;
  isNew?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('general');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    slug: initial?.slug || '',
    name: initial?.name || '',
    trackingModeDefault: initial?.trackingModeDefault || 'redirect',
    clickUrlTemplate: initial?.clickUrlTemplate || '',
    directAdUrlTemplate: initial?.directAdUrlTemplate || '',
    paramMappings: (initial?.paramMappings || []) as ParamMapping[],
    conversionMethod: initial?.conversionMethod || 'mediago_s2s',
    setupNote: initial?.setupNote || '',
    active: initial?.active ?? true,
    postbackDefaults: (initial?.postbackDefaults || {}) as Record<string, unknown>,
  });

  const addMapping = () => {
    setForm({
      ...form,
      paramMappings: [
        ...form.paramMappings,
        {
          internalField: 'tracking_id',
          displayLabel: 'Tracking ID',
          externalKeys: ['click_id'],
          showInReports: true,
          priority: form.paramMappings.length + 1,
        },
      ],
    });
  };

  const updateMapping = (idx: number, patch: Partial<ParamMapping>) => {
    const next = [...form.paramMappings];
    next[idx] = { ...next[idx], ...patch };
    setForm({ ...form, paramMappings: next });
  };

  const removeMapping = (idx: number) => {
    setForm({
      ...form,
      paramMappings: form.paramMappings.filter((_, i) => i !== idx),
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        ...form,
        clickUrlTemplate: form.clickUrlTemplate || null,
        directAdUrlTemplate: form.directAdUrlTemplate || null,
        setupNote: form.setupNote || null,
      };
      if (isNew) {
        const created = await trackerApi.createTrafficSource(payload);
        router.push(`/traffic-sources/${created.id}`);
      } else if (initial) {
        await trackerApi.updateTrafficSource(initial.id, payload);
        router.refresh();
      }
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'url', label: 'URL Template' },
    { id: 'params', label: 'Param Mapping' },
    { id: 'conversion', label: 'Conversion' },
  ];

  return (
    <div>
      <div className="flex gap-1 mb-6 border-b border-zinc-200 dark:border-zinc-800">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === t.id
                ? 'border-indigo-600 dark:border-indigo-400 text-indigo-600 dark:text-indigo-400'
                : `border-transparent ${mutedTextClass} hover:text-zinc-800 dark:hover:text-zinc-200`
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <Card className="space-y-4 max-w-xl">
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
              disabled={initial?.isSystem}
              className="font-mono"
              required
            />
          </div>
          <div>
            <Label>Default tracking mode</Label>
            <Select
              value={form.trackingModeDefault}
              onChange={(e) =>
                setForm({
                  ...form,
                  trackingModeDefault: e.target.value as 'redirect' | 'direct',
                })
              }
            >
              <option value="redirect">Redirect (native networks)</option>
              <option value="direct">Direct LP (Facebook/Google)</option>
            </Select>
          </div>
          <div>
            <Label>Setup note (shown on campaigns)</Label>
            <Textarea
              value={form.setupNote}
              onChange={(e) => setForm({ ...form, setupNote: e.target.value })}
              rows={3}
            />
          </div>
          <Checkbox
            label="Active (visible in campaign picker)"
            checked={form.active}
            onChange={(checked) => setForm({ ...form, active: checked })}
          />
        </Card>
      )}

      {tab === 'url' && (
        <Card className="space-y-4 max-w-3xl">
          <p className={`text-sm ${mutedTextClass}`}>
            Use placeholders: <code className={inlineCodeClass}>{'{clickUrl}'}</code>,{' '}
            <code className={inlineCodeClass}>{'{destinationUrl}'}</code>,{' '}
            <code className={inlineCodeClass}>{'{campaignName}'}</code>. Network macros
            like <code className={inlineCodeClass}>${'{AD_ID}'}</code> stay as-is for ad
            platforms.
          </p>
          {form.trackingModeDefault === 'redirect' ? (
            <div>
              <Label>Click URL template (redirect)</Label>
              <Textarea
                value={form.clickUrlTemplate}
                onChange={(e) => setForm({ ...form, clickUrlTemplate: e.target.value })}
                rows={4}
                className="font-mono text-xs"
                placeholder="{clickUrl}?adid=${AD_ID}&click_id=${TRACKING_ID}"
              />
            </div>
          ) : (
            <div>
              <Label>Direct ad URL template</Label>
              <Textarea
                value={form.directAdUrlTemplate}
                onChange={(e) => setForm({ ...form, directAdUrlTemplate: e.target.value })}
                rows={3}
                className="font-mono text-xs"
                placeholder="{destinationUrl}?utm_source=facebook&utm_campaign={campaignName}"
              />
            </div>
          )}
        </Card>
      )}

      {tab === 'params' && (
        <Card>
          <div className="flex justify-between items-center mb-4">
            <p className="text-sm text-zinc-500">
              Parameters — same layout as Voluum: TS parameter (query key in ad URL), TS token
              (network macro), postback token (used in outbound conversion URL).
            </p>
            <Button type="button" onClick={addMapping}>
              Add parameter
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-zinc-500 border-b">
                  <th className="pb-2 pr-3 font-medium">Name</th>
                  <th className="pb-2 pr-3 font-medium">TS parameter</th>
                  <th className="pb-2 pr-3 font-medium">TS token</th>
                  <th className="pb-2 pr-3 font-medium">Postback token</th>
                  <th className="pb-2 pr-3 font-medium">Report</th>
                  <th className="pb-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {form.paramMappings.map((m, idx) => (
                  <tr key={idx} className="border-b border-zinc-100 align-top">
                    <td className="py-2 pr-3">
                      <Input
                        value={m.displayLabel}
                        onChange={(e) => updateMapping(idx, { displayLabel: e.target.value })}
                        className="text-xs"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <Input
                        value={m.externalKeys[0] || ''}
                        onChange={(e) => {
                          const rest = m.externalKeys.slice(1);
                          updateMapping(idx, {
                            externalKeys: [e.target.value, ...rest].filter(Boolean),
                          });
                        }}
                        className="font-mono text-xs"
                        placeholder="click_id"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <Input
                        value={m.urlMacro || ''}
                        onChange={(e) => updateMapping(idx, { urlMacro: e.target.value })}
                        className="font-mono text-xs"
                        placeholder="${TRACKING_ID}"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <Input
                        value={m.postbackToken || ''}
                        onChange={(e) => updateMapping(idx, { postbackToken: e.target.value })}
                        className="font-mono text-xs"
                        placeholder="{externalid}"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="checkbox"
                        checked={m.showInReports}
                        onChange={(e) => updateMapping(idx, { showInReports: e.target.checked })}
                      />
                    </td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => removeMapping(idx)}
                        className="text-red-600 text-xs hover:underline"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'conversion' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900">
                Passing conversion info to traffic source
              </h3>
              <p className="text-xs text-zinc-500 mt-1">
                Same as Voluum &quot;Traffic source postback URL&quot;. On each conversion the
                tracker replaces tokens and fires this URL.
              </p>
            </div>

            <div>
              <Label>Conversion method</Label>
              <Select
                value={form.conversionMethod}
                onChange={(e) => setForm({ ...form, conversionMethod: e.target.value })}
              >
                {CONVERSION_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m.replace(/_/g, ' ')}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label>Traffic source postback URL</Label>
              <Textarea
                value={String(
                  form.postbackDefaults.postbackUrlTemplate ??
                    (form.conversionMethod === 'mediago_s2s' ? DEFAULT_MEDIAGO_POSTBACK_URL : ''),
                )}
                onChange={(e) =>
                  setForm({
                    ...form,
                    postbackDefaults: {
                      ...form.postbackDefaults,
                      postbackUrlTemplate: e.target.value,
                    },
                  })
                }
                rows={4}
                className="font-mono text-xs"
                placeholder={DEFAULT_MEDIAGO_POSTBACK_URL}
              />
            </div>

            {form.conversionMethod === 'mediago_s2s' && (
              <>
                <div>
                  <Label>Mediago account name ({'{accountname}'})</Label>
                  <Input
                    value={String(form.postbackDefaults.mediagoAccountName ?? '')}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        postbackDefaults: {
                          ...form.postbackDefaults,
                          mediagoAccountName: e.target.value,
                          mediagoEnabled: true,
                        },
                      })
                    }
                    placeholder="Your Mediago account name (replaces REPLACE in Voluum)"
                  />
                </div>
                <div>
                  <Label>Default conversion type ({'{conversiontype}'})</Label>
                  <Input
                    type="number"
                    value={String(form.postbackDefaults.mediagoConversionType ?? 10)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        postbackDefaults: {
                          ...form.postbackDefaults,
                          mediagoConversionType: parseInt(e.target.value, 10),
                          mediagoEnabled: true,
                          facebookEnabled: false,
                          googleEnabled: false,
                        },
                      })
                    }
                  />
                  <p className="text-xs text-zinc-400 mt-1">10 = Lead, 11 = Purchase (Mediago)</p>
                </div>
              </>
            )}

            {form.conversionMethod === 'facebook_capi' && (
              <p className="text-sm text-zinc-500">
                Facebook uses Conversions API (POST JSON), not a GET URL. Configure{' '}
                <strong>Pixel ID</strong> and <strong>System User access token</strong> on each
                campaign. LP passes email, fbp, fbc via{' '}
                <code className="text-xs bg-zinc-100 px-1">tkCallback.registerConversion()</code>.
              </p>
            )}

            {form.conversionMethod === 'google_offline' && (
              <p className="text-sm text-zinc-500">
                Google uses <code className="text-xs bg-zinc-100 px-1">{'{gclid}'}</code> from the
                click. Set Conversion ID + Label on each campaign.
              </p>
            )}
          </Card>

          <Card>
            <h3 className={`${sectionHeadingClass} mb-2`}>Tokens dictionary</h3>
            <p className={`text-xs ${mutedTextClass} mb-3`}>
              Click a token to copy. Use in the postback URL above.
            </p>
            <div className="max-h-[420px] overflow-y-auto space-y-1">
              {POSTBACK_TOKEN_DEFINITIONS.map((t) => (
                <button
                  key={t.token}
                  type="button"
                  onClick={() => navigator.clipboard.writeText(t.token)}
                  className="w-full text-left px-2 py-1.5 rounded hover:bg-zinc-50 dark:hover:bg-zinc-800/60 group"
                  title={t.description}
                >
                  <code className={`text-[11px] ${linkClass}`}>{t.token}</code>
                  <span className={`block text-[10px] ${mutedTextClass} group-hover:text-zinc-500 dark:group-hover:text-zinc-400`}>
                    {t.description}
                  </span>
                </button>
              ))}
            </div>
          </Card>
        </div>
      )}

      <div className="mt-6">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : isNew ? 'Create profile' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}
