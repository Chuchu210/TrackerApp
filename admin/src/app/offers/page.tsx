'use client';

import { useCallback, useEffect, useState } from 'react';
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
  Select,
  TableHead,
  Td,
  Th,
  mutedTextClass,
  sectionHeadingClass,
  tableRowClass,
} from '@/components/ui';
import {
  trackerApi,
  formatApiError,
  type AffiliateNetwork,
  type Offer,
} from '@/lib/api';

const PAGE_SIZE = 50;

const EMPTY_FORM = {
  name: '',
  slug: '',
  url: '',
  payout: '0',
  currency: 'EUR',
  country: '',
  affiliateNetworkId: '',
};

export default function OffersPage() {
  const toast = useToast();
  const [items, setItems] = useState<Offer[]>([]);
  const [total, setTotal] = useState(0);
  const [networks, setNetworks] = useState<AffiliateNetwork[]>([]);
  const [meta, setMeta] = useState<{ countries: string[]; currencies: string[] }>({
    countries: [],
    currencies: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const params: Record<string, string> = {
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
    };
    if (search.trim()) params.q = search.trim();

    trackerApi
      .getOffers(params)
      .then((data) => {
        setItems(data.items);
        setTotal(data.total);
        setError(null);
      })
      .catch((err) => {
        console.error(err);
        setError(formatApiError(err));
      })
      .finally(() => setLoading(false));
  }, [page, search]);

  useEffect(load, [load]);

  useEffect(() => {
    trackerApi.getAffiliateNetworks(true).then(setNetworks).catch(console.error);
    trackerApi.getOfferMeta().then(setMeta).catch(console.error);
  }, []);

  const set = (key: keyof typeof EMPTY_FORM, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  const startEdit = (offer: Offer) => {
    setEditingId(offer.id);
    setForm({
      name: offer.name,
      slug: offer.slug,
      url: offer.url,
      payout: String(offer.payout ?? 0),
      currency: offer.currency || 'EUR',
      country: offer.country || '',
      affiliateNetworkId: offer.affiliateNetworkId || '',
    });
  };

  const submit = async () => {
    if (!form.name.trim() || !form.slug.trim() || !form.url.trim()) {
      toast.error('Name, slug and URL are required');
      return;
    }
    const payout = Number(form.payout);
    if (!Number.isFinite(payout) || payout < 0) {
      toast.error('Payout must be a positive number');
      return;
    }

    setSaving(true);
    const payload = {
      name: form.name,
      slug: form.slug,
      url: form.url,
      payout,
      currency: form.currency,
      country: form.country || null,
      affiliateNetworkId: form.affiliateNetworkId || null,
    };
    try {
      if (editingId) {
        await trackerApi.updateOffer(editingId, payload);
        toast.success('Offer updated');
      } else {
        await trackerApi.createOffer(payload);
        toast.success('Offer created');
      }
      resetForm();
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (offer: Offer) => {
    try {
      await trackerApi.updateOffer(offer.id, { active: !offer.active });
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const remove = async (offer: Offer) => {
    if (!confirm(`Delete "${offer.name}"?`)) return;
    try {
      await trackerApi.deleteOffer(offer.id);
      toast.success('Offer deleted');
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Offers"
        description="Destination offers and their payouts, optionally grouped by affiliate network."
      />

      {error && <Alert tone="error">{error}</Alert>}

      <Card>
        <h2 className={sectionHeadingClass}>
          {editingId ? 'Edit offer' : 'New offer'}
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Auto Insurance US"
            />
          </div>
          <div>
            <Label htmlFor="slug">Slug</Label>
            <Input
              id="slug"
              value={form.slug}
              onChange={(e) => set('slug', e.target.value)}
              placeholder="auto-insurance-us"
            />
          </div>
          <div>
            <Label htmlFor="payout">Payout</Label>
            <Input
              id="payout"
              type="number"
              min="0"
              step="0.01"
              value={form.payout}
              onChange={(e) => set('payout', e.target.value)}
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <Label htmlFor="url">Destination URL</Label>
            <Input
              id="url"
              value={form.url}
              onChange={(e) => set('url', e.target.value)}
              placeholder="https://offer.example.com/?subid={clickid}"
            />
          </div>
          <div>
            <Label htmlFor="currency">Currency</Label>
            <Select
              id="currency"
              value={form.currency}
              onChange={(e) => set('currency', e.target.value)}
            >
              {(meta.currencies.length ? meta.currencies : ['EUR']).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="country">Country</Label>
            <Select
              id="country"
              value={form.country}
              onChange={(e) => set('country', e.target.value)}
            >
              <option value="">Any</option>
              {meta.countries.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="affiliateNetworkId">Affiliate network</Label>
            <Select
              id="affiliateNetworkId"
              value={form.affiliateNetworkId}
              onChange={(e) => set('affiliateNetworkId', e.target.value)}
            >
              <option value="">None</option>
              {networks.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <Button onClick={submit} disabled={saving}>
            {saving ? 'Saving...' : editingId ? 'Save changes' : 'Create offer'}
          </Button>
          {editingId && (
            <Button variant="secondary" onClick={resetForm} disabled={saving}>
              Cancel
            </Button>
          )}
        </div>
      </Card>

      <Card>
        <div className="mb-4 flex items-center gap-2">
          <Input
            value={search}
            onChange={(e) => {
              setPage(0);
              setSearch(e.target.value);
            }}
            placeholder="Search name, slug or URL..."
          />
        </div>

        {loading ? (
          <Loading />
        ) : items.length === 0 ? (
          <p className={mutedTextClass}>No offers found.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <TableHead>
                  <Th>Name</Th>
                  <Th>Slug</Th>
                  <Th>Payout</Th>
                  <Th>Country</Th>
                  <Th>Network</Th>
                  <Th>Clicks</Th>
                  <Th>Status</Th>
                  <Th>Actions</Th>
                </TableHead>
                <tbody>
                  {items.map((offer) => (
                    <tr key={offer.id} className={tableRowClass}>
                      <Td className="font-medium">{offer.name}</Td>
                      <Td>{offer.slug}</Td>
                      <Td>
                        {offer.payout.toFixed(2)} {offer.currency}
                      </Td>
                      <Td>{offer.country || '—'}</Td>
                      <Td>{offer.affiliateNetwork?.name || '—'}</Td>
                      <Td>{offer._count?.offerClicks ?? 0}</Td>
                      <Td>
                        <Badge tone={offer.active ? 'success' : 'neutral'}>
                          {offer.active ? 'Active' : 'Inactive'}
                        </Badge>
                      </Td>
                      <Td>
                        <div className="flex gap-2">
                          <Button variant="secondary" onClick={() => startEdit(offer)}>
                            Edit
                          </Button>
                          <Button variant="secondary" onClick={() => toggleActive(offer)}>
                            {offer.active ? 'Disable' : 'Enable'}
                          </Button>
                          <Button variant="danger" onClick={() => remove(offer)}>
                            Delete
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <span className={mutedTextClass}>
                {total} offer{total === 1 ? '' : 's'}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
                  disabled={page >= lastPage}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
