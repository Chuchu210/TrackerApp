'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useToast } from '@/components/Toast';
import {
  Alert,
  Badge,
  Button,
  Card,
  Input,
  InlineLink,
  Label,
  Loading,
  Select,
  bodyTextClass,
  mutedTextClass,
  pageTitleClass,
  sectionHeadingClass,
} from '@/components/ui';
import {
  trackerApi,
  formatApiError,
  type Campaign,
  type CampaignPath,
  type PathCondition,
  type PathVariant,
} from '@/lib/api';

const DIMENSIONS: PathCondition['dimension'][] = [
  'country',
  'device',
  'os',
  'browser',
  'connectionType',
];

export default function CampaignPathsPage() {
  const toast = useToast();
  const { id } = useParams<{ id: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [paths, setPaths] = useState<CampaignPath[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newPathName, setNewPathName] = useState('');

  const load = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([
        trackerApi.getCampaign(id),
        trackerApi.getCampaignPaths(id),
      ]);
      setCampaign(c);
      setPaths(p);
      setError(null);
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const addPath = async () => {
    try {
      await trackerApi.createPath(id, { name: newPathName || 'Path', weight: 100, conditions: [] });
      setNewPathName('');
      await load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const savePath = async (path: CampaignPath) => {
    try {
      await trackerApi.updatePath(path.id, {
        name: path.name,
        weight: path.weight,
        active: path.active,
        conditions: path.conditions,
        destinationUrl: path.destinationUrl,
      });
      toast.success('Path saved');
      await load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const removePath = async (pathId: string) => {
    if (!window.confirm('Delete this path and its variants?')) return;
    try {
      await trackerApi.deletePath(pathId);
      await load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const addVariant = async (pathId: string) => {
    try {
      await trackerApi.createVariant(pathId, {
        label: 'Variant',
        kind: 'offer',
        destinationUrl: campaign?.destinationUrl || '',
        weight: 100,
      });
      await load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const saveVariant = async (v: PathVariant) => {
    try {
      await trackerApi.updateVariant(v.id, {
        label: v.label,
        kind: v.kind,
        destinationUrl: v.destinationUrl,
        weight: v.weight,
        active: v.active,
      });
      toast.success('Variant saved');
      await load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const removeVariant = async (variantId: string) => {
    try {
      await trackerApi.deleteVariant(variantId);
      await load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const runAutoWinner = async () => {
    try {
      const r = await trackerApi.runAutoWinner();
      toast.info(`Evaluated ${r.pathsEvaluated} paths, picked ${r.winnersPicked} winner(s)`);
      await load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const updatePathLocal = (pathId: string, patch: Partial<CampaignPath>) =>
    setPaths((prev) => prev.map((p) => (p.id === pathId ? { ...p, ...patch } : p)));

  const updateVariantLocal = (pathId: string, variantId: string, patch: Partial<PathVariant>) =>
    setPaths((prev) =>
      prev.map((p) =>
        p.id === pathId
          ? { ...p, variants: p.variants.map((v) => (v.id === variantId ? { ...v, ...patch } : v)) }
          : p,
      ),
    );

  if (loading) return <Loading />;
  if (error) return <Alert tone="error">{error}</Alert>;

  return (
    <div>
      <InlineLink href={`/campaigns/${id}`} className="text-sm font-medium mb-6 inline-block">
        ← Back to campaign
      </InlineLink>

      <div className="flex items-start justify-between mb-2">
        <h1 className={pageTitleClass}>Paths &amp; rotation</h1>
        <Button variant="secondary" onClick={runAutoWinner}>
          Run auto-winner now
        </Button>
      </div>
      <p className={`text-sm ${mutedTextClass} mb-6`}>
        {campaign?.name} — visitors are routed to the first matching rule-targeted path, then a
        variant is chosen by weight. With no paths, traffic goes to the campaign destination.
      </p>

      <Card className="mb-6">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <Label>New path name</Label>
            <Input
              value={newPathName}
              onChange={(e) => setNewPathName(e.target.value)}
              placeholder="e.g. US mobile"
            />
          </div>
          <Button onClick={addPath}>Add path</Button>
        </div>
      </Card>

      {paths.length === 0 && (
        <Alert tone="info">
          No paths yet. This campaign sends all traffic to its destination URL. Add a path to A/B
          test offers or route by geo/device.
        </Alert>
      )}

      {paths.map((path) => (
        <Card key={path.id} className="mb-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Input
                value={path.name}
                onChange={(e) => updatePathLocal(path.id, { name: e.target.value })}
                className="w-48"
              />
              <Badge tone={path.active ? 'success' : 'neutral'}>
                {path.active ? 'Active' : 'Off'}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => savePath(path)}>
                Save
              </Button>
              <Button variant="danger" onClick={() => removePath(path.id)}>
                Delete
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <Label>Weight</Label>
              <Input
                type="number"
                min={0}
                value={path.weight}
                onChange={(e) =>
                  updatePathLocal(path.id, { weight: parseInt(e.target.value, 10) || 0 })
                }
              />
            </div>
            <div>
              <Label>Active</Label>
              <Select
                value={path.active ? 'yes' : 'no'}
                onChange={(e) => updatePathLocal(path.id, { active: e.target.value === 'yes' })}
              >
                <option value="yes">Active</option>
                <option value="no">Off</option>
              </Select>
            </div>
            <div>
              <Label>Fallback destination (no variants)</Label>
              <Input
                value={path.destinationUrl || ''}
                onChange={(e) => updatePathLocal(path.id, { destinationUrl: e.target.value })}
                placeholder="Optional"
              />
            </div>
          </div>

          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className={sectionHeadingClass}>Targeting rules (all must match)</h3>
              <Button
                variant="secondary"
                onClick={() =>
                  updatePathLocal(path.id, {
                    conditions: [
                      ...path.conditions,
                      { dimension: 'country', operator: 'in', values: [] },
                    ],
                  })
                }
              >
                Add rule
              </Button>
            </div>
            {path.conditions.length === 0 && (
              <p className={`text-xs ${mutedTextClass}`}>
                No rules — this is a default/fallback path.
              </p>
            )}
            {path.conditions.map((cond, i) => (
              <div key={i} className="flex items-center gap-2 mb-2">
                <Select
                  value={cond.dimension}
                  onChange={(e) => {
                    const conditions = [...path.conditions];
                    conditions[i] = { ...cond, dimension: e.target.value as PathCondition['dimension'] };
                    updatePathLocal(path.id, { conditions });
                  }}
                  className="w-40"
                >
                  {DIMENSIONS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </Select>
                <Select
                  value={cond.operator}
                  onChange={(e) => {
                    const conditions = [...path.conditions];
                    conditions[i] = { ...cond, operator: e.target.value as PathCondition['operator'] };
                    updatePathLocal(path.id, { conditions });
                  }}
                  className="w-28"
                >
                  <option value="in">is in</option>
                  <option value="not_in">not in</option>
                </Select>
                <Input
                  value={cond.values.join(', ')}
                  onChange={(e) => {
                    const conditions = [...path.conditions];
                    conditions[i] = {
                      ...cond,
                      values: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                    };
                    updatePathLocal(path.id, { conditions });
                  }}
                  placeholder="US, CA, mobile…"
                  className="flex-1"
                />
                <Button
                  variant="secondary"
                  onClick={() =>
                    updatePathLocal(path.id, {
                      conditions: path.conditions.filter((_, idx) => idx !== i),
                    })
                  }
                >
                  ✕
                </Button>
              </div>
            ))}
          </div>

          <div className="border-t border-zinc-100 dark:border-zinc-800 pt-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className={sectionHeadingClass}>Variants (rotate by weight)</h3>
              <Button variant="secondary" onClick={() => addVariant(path.id)}>
                Add variant
              </Button>
            </div>
            {path.variants.length === 0 && (
              <p className={`text-xs ${mutedTextClass}`}>
                No variants — this path uses its fallback destination.
              </p>
            )}
            {path.variants.map((v) => (
              <div key={v.id} className="flex items-center gap-2 mb-2">
                <Input
                  value={v.label}
                  onChange={(e) => updateVariantLocal(path.id, v.id, { label: e.target.value })}
                  className="w-36"
                  placeholder="Label"
                />
                <Input
                  value={v.destinationUrl}
                  onChange={(e) =>
                    updateVariantLocal(path.id, v.id, { destinationUrl: e.target.value })
                  }
                  className="flex-1"
                  placeholder="Offer/lander URL"
                />
                <Input
                  type="number"
                  min={0}
                  value={v.weight}
                  onChange={(e) =>
                    updateVariantLocal(path.id, v.id, { weight: parseInt(e.target.value, 10) || 0 })
                  }
                  className="w-20"
                />
                {v.isWinner && <Badge tone="success">Winner</Badge>}
                {!v.active && <Badge tone="neutral">Off</Badge>}
                <Button variant="secondary" onClick={() => saveVariant(v)}>
                  Save
                </Button>
                <Button variant="secondary" onClick={() => removeVariant(v.id)}>
                  ✕
                </Button>
              </div>
            ))}
          </div>
        </Card>
      ))}

      <p className={`text-xs ${mutedTextClass} mt-4`}>
        <span className={bodyTextClass}>Auto-winner</span> runs hourly: once a variant clearly
        beats the others it is promoted and the losers are switched off.
      </p>
    </div>
  );
}
