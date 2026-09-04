'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Input,
  Label,
  Loading,
  PageHeader,
  StatCard,
  TableHead,
  Td,
  Th,
  inlineCodeClass,
  mutedTextClass,
  sectionHeadingClass,
  tableRowClass,
} from '@/components/ui';
import {
  trackerApi,
  formatApiError,
  type IncomingPostback,
  type IncomingPostbackSummary,
} from '@/lib/api';

const PAGE_SIZE = 50;

function statusTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'sent') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'pending') return 'warning';
  return 'neutral';
}

export default function IncomingPostbacksPage() {
  const [items, setItems] = useState<IncomingPostback[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<IncomingPostbackSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    const filters: Record<string, string> = {};
    if (from) filters.from = from;
    if (to) filters.to = to;

    Promise.all([
      trackerApi.getIncomingPostbacks({
        ...filters,
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      }),
      trackerApi.getIncomingPostbackSummary(filters),
    ])
      .then(([list, sum]) => {
        setItems(list.items);
        setTotal(list.total);
        setSummary(sum);
        setError(null);
      })
      .catch((err) => {
        console.error(err);
        setError(formatApiError(err));
      })
      .finally(() => setLoading(false));
  }, [from, to, page]);

  useEffect(load, [load]);

  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Incoming postbacks"
        description="Server-to-server conversions your affiliate networks sent to this tracker."
      />

      {error && <Alert tone="error">{error}</Alert>}

      <Card>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <Label htmlFor="from">From</Label>
            <Input
              id="from"
              type="date"
              value={from}
              onChange={(e) => {
                setPage(0);
                setFrom(e.target.value);
              }}
            />
          </div>
          <div>
            <Label htmlFor="to">To</Label>
            <Input
              id="to"
              type="date"
              value={to}
              onChange={(e) => {
                setPage(0);
                setTo(e.target.value);
              }}
            />
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              setPage(0);
              setFrom('');
              setTo('');
            }}
          >
            Reset
          </Button>
        </div>
      </Card>

      {summary && (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Postbacks received" value={String(summary.totals.total)} />
          <StatCard
            label="Revenue reported"
            value={summary.totals.revenue.toFixed(2)}
          />
          <StatCard
            label="Failed to forward"
            value={String(summary.totals.failed)}
            tone={summary.totals.failed > 0 ? 'pink' : 'neutral'}
          />
        </div>
      )}

      {summary && summary.items.length > 0 && (
        <Card>
          <h2 className={sectionHeadingClass}>By campaign</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <TableHead>
                <Th>Campaign</Th>
                <Th>Received</Th>
                <Th>Revenue</Th>
                <Th>Failed</Th>
                <Th>Event types</Th>
              </TableHead>
              <tbody>
                {summary.items.map((row) => (
                  <tr key={row.campaignId} className={tableRowClass}>
                    <Td className="font-medium">{row.campaignName}</Td>
                    <Td>{row.total}</Td>
                    <Td>{row.revenue.toFixed(2)}</Td>
                    <Td>
                      {row.failed > 0 ? (
                        <Badge tone="danger">{row.failed}</Badge>
                      ) : (
                        <span className={mutedTextClass}>0</span>
                      )}
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(row.byEventType).map(([type, count]) => (
                          <Badge key={type} tone="info">
                            {type}: {count}
                          </Badge>
                        ))}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <h2 className={sectionHeadingClass}>Raw postbacks</h2>
        {loading ? (
          <Loading />
        ) : items.length === 0 ? (
          <p className={`mt-4 ${mutedTextClass}`}>
            No incoming postbacks in this range. Networks reach this tracker at{' '}
            <code className={inlineCodeClass}>GET /postback?cid=...&amp;et=lead</code>.
          </p>
        ) : (
          <>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <TableHead>
                  <Th>Received</Th>
                  <Th>Campaign</Th>
                  <Th>Event</Th>
                  <Th>Revenue</Th>
                  <Th>Transaction</Th>
                  <Th>From IP</Th>
                  <Th>Status</Th>
                </TableHead>
                <tbody>
                  {items.map((row) => (
                    <tr key={row.id} className={tableRowClass}>
                      <Td>{new Date(row.createdAt).toLocaleString()}</Td>
                      <Td>{row.campaign?.name || '—'}</Td>
                      <Td>{row.eventType}</Td>
                      <Td>
                        {row.revenue ? row.revenue.toFixed(2) : '—'}{' '}
                        {row.revenue ? row.currency || '' : ''}
                      </Td>
                      <Td>{row.transactionId || '—'}</Td>
                      <Td>{row.incomingPostbackIp || '—'}</Td>
                      <Td>
                        <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <span className={mutedTextClass}>
                {total} postback{total === 1 ? '' : 's'}
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
