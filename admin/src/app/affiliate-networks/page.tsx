'use client';

import { useEffect, useState } from 'react';
import { useToast } from '@/components/Toast';
import {
  Alert,
  Badge,
  Button,
  Card,
  Input,
  Label,
  Loading,
  PageHeader,
  TableHead,
  Td,
  Th,
  mutedTextClass,
  sectionHeadingClass,
  tableRowClass,
} from '@/components/ui';
import { trackerApi, formatApiError, type AffiliateNetwork } from '@/lib/api';

const EMPTY_FORM = {
  name: '',
  slug: '',
  clickIdParam: 'subid',
  clickIdToken: '',
  payoutToken: '',
  transactionIdToken: '',
  eventTypeToken: '',
  defaultCurrency: 'EUR',
  postbackUrlTemplate: '',
};

export default function AffiliateNetworksPage() {
  const toast = useToast();
  const [items, setItems] = useState<AffiliateNetwork[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    trackerApi
      .getAffiliateNetworks(true)
      .then((data) => {
        setItems(data);
        setError(null);
      })
      .catch((err) => {
        console.error(err);
        setError(formatApiError(err));
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const set = (key: keyof typeof EMPTY_FORM, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  const startEdit = (network: AffiliateNetwork) => {
    setEditingId(network.id);
    setForm({
      name: network.name,
      slug: network.slug,
      clickIdParam: network.clickIdParam || 'subid',
      clickIdToken: network.clickIdToken || '',
      payoutToken: network.payoutToken || '',
      transactionIdToken: network.transactionIdToken || '',
      eventTypeToken: network.eventTypeToken || '',
      defaultCurrency: network.defaultCurrency || 'EUR',
      postbackUrlTemplate: network.postbackUrlTemplate || '',
    });
  };

  const submit = async () => {
    if (!form.name.trim() || !form.slug.trim()) {
      toast.error('Name and slug are required');
      return;
    }
    setSaving(true);
    // Blank inputs mean "not set", so send null rather than empty strings.
    const payload = {
      ...form,
      clickIdToken: form.clickIdToken || null,
      payoutToken: form.payoutToken || null,
      transactionIdToken: form.transactionIdToken || null,
      eventTypeToken: form.eventTypeToken || null,
      postbackUrlTemplate: form.postbackUrlTemplate || null,
    };
    try {
      if (editingId) {
        await trackerApi.updateAffiliateNetwork(editingId, payload);
        toast.success('Network updated');
      } else {
        await trackerApi.createAffiliateNetwork(payload);
        toast.success('Network created');
      }
      resetForm();
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (network: AffiliateNetwork) => {
    try {
      await trackerApi.updateAffiliateNetwork(network.id, {
        active: !network.active,
      });
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const remove = async (network: AffiliateNetwork) => {
    if (!confirm(`Delete "${network.name}"?`)) return;
    try {
      await trackerApi.deleteAffiliateNetwork(network.id);
      toast.success('Network deleted');
      load();
    } catch (err) {
      // The API refuses to delete a network that still has offers attached.
      toast.error(formatApiError(err));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Affiliate networks"
        description="Networks you send traffic to, and how each one fills its postback macros."
      />

      {error && <Alert tone="error">{error}</Alert>}

      <Card>
        <h2 className={sectionHeadingClass}>
          {editingId ? 'Edit network' : 'New network'}
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="MyNetwork"
            />
          </div>
          <div>
            <Label htmlFor="slug">Slug</Label>
            <Input
              id="slug"
              value={form.slug}
              onChange={(e) => set('slug', e.target.value)}
              placeholder="mynetwork"
            />
          </div>
          <div>
            <Label htmlFor="clickIdParam">Click ID param</Label>
            <Input
              id="clickIdParam"
              value={form.clickIdParam}
              onChange={(e) => set('clickIdParam', e.target.value)}
              placeholder="subid"
            />
          </div>
          <div>
            <Label htmlFor="clickIdToken">Click ID macro</Label>
            <Input
              id="clickIdToken"
              value={form.clickIdToken}
              onChange={(e) => set('clickIdToken', e.target.value)}
              placeholder="{subid}"
            />
          </div>
          <div>
            <Label htmlFor="payoutToken">Payout macro</Label>
            <Input
              id="payoutToken"
              value={form.payoutToken}
              onChange={(e) => set('payoutToken', e.target.value)}
              placeholder="{payout}"
            />
          </div>
          <div>
            <Label htmlFor="transactionIdToken">Transaction ID macro</Label>
            <Input
              id="transactionIdToken"
              value={form.transactionIdToken}
              onChange={(e) => set('transactionIdToken', e.target.value)}
              placeholder="{txid}"
            />
          </div>
          <div>
            <Label htmlFor="eventTypeToken">Event type macro</Label>
            <Input
              id="eventTypeToken"
              value={form.eventTypeToken}
              onChange={(e) => set('eventTypeToken', e.target.value)}
              placeholder="{event}"
            />
          </div>
          <div>
            <Label htmlFor="defaultCurrency">Default currency</Label>
            <Input
              id="defaultCurrency"
              value={form.defaultCurrency}
              onChange={(e) => set('defaultCurrency', e.target.value)}
              placeholder="EUR"
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <Label htmlFor="postbackUrlTemplate">Postback URL template</Label>
            <Input
              id="postbackUrlTemplate"
              value={form.postbackUrlTemplate}
              onChange={(e) => set('postbackUrlTemplate', e.target.value)}
              placeholder="https://network.com/postback?subid={subid}&payout={payout}"
            />
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <Button onClick={submit} disabled={saving}>
            {saving ? 'Saving...' : editingId ? 'Save changes' : 'Create network'}
          </Button>
          {editingId && (
            <Button variant="secondary" onClick={resetForm} disabled={saving}>
              Cancel
            </Button>
          )}
        </div>
      </Card>

      <Card>
        {loading ? (
          <Loading />
        ) : items.length === 0 ? (
          <p className={mutedTextClass}>No affiliate networks yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <TableHead>
                <Th>Name</Th>
                <Th>Slug</Th>
                <Th>Click ID param</Th>
                <Th>Currency</Th>
                <Th>Offers</Th>
                <Th>Status</Th>
                <Th>Actions</Th>
              </TableHead>
              <tbody>
                {items.map((network) => (
                  <tr key={network.id} className={tableRowClass}>
                    <Td className="font-medium">{network.name}</Td>
                    <Td>{network.slug}</Td>
                    <Td>{network.clickIdParam}</Td>
                    <Td>{network.defaultCurrency}</Td>
                    <Td>{network._count?.offers ?? 0}</Td>
                    <Td>
                      <Badge tone={network.active ? 'success' : 'neutral'}>
                        {network.active ? 'Active' : 'Inactive'}
                      </Badge>
                    </Td>
                    <Td>
                      <div className="flex gap-2">
                        <Button variant="secondary" onClick={() => startEdit(network)}>
                          Edit
                        </Button>
                        <Button variant="secondary" onClick={() => toggleActive(network)}>
                          {network.active ? 'Disable' : 'Enable'}
                        </Button>
                        <Button variant="danger" onClick={() => remove(network)}>
                          Delete
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
