'use client';

import { Fragment, useEffect, useState } from 'react';
import { useToast } from '@/components/Toast';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Input,
  Loading,
  PageHeader,
  TableHead,
  Td,
  Th,
  detailRowClass,
  linkClass,
  mutedTextClass,
  tableRowClass,
} from '@/components/ui';
import { trackerApi, formatApiError, type Lead } from '@/lib/api';

function fullName(lead: Lead): string {
  return [lead.firstName, lead.lastName].filter(Boolean).join(' ') || '—';
}

function erasedLabel(lead: Lead): string {
  return lead.erasedAt ? `Erased ${new Date(lead.erasedAt).toLocaleDateString()}` : '';
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="min-w-0">
      <span className={mutedTextClass}>{label}: </span>
      <span className="break-words">{value || '—'}</span>
    </div>
  );
}

export default function LeadsPage() {
  const toast = useToast();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [includeTest, setIncludeTest] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 100;

  const params = (): Record<string, string> => {
    const p: Record<string, string> = { limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) };
    if (search.trim()) p.search = search.trim();
    if (includeTest) p.includeTest = 'true';
    if (from) p.from = new Date(from).toISOString();
    if (to) p.to = new Date(`${to}T23:59:59`).toISOString();
    return p;
  };

  const load = () => {
    setLoading(true);
    trackerApi
      .getLeads(params())
      .then((res) => {
        setLeads(res.items);
        setTotal(res.total);
        setError(null);
      })
      .catch((err) => setError(formatApiError(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeTest, page]);

  /** Erasure request: clears the person here, in the raw conversion metadata and in the postback logs. */
  const erase = async (lead: Lead) => {
    const who = fullName(lead) === '—' ? lead.phone || lead.email || lead.clickId : fullName(lead);
    if (!window.confirm(`Erase ${who}? Their contact details are removed everywhere and this cannot be undone.`)) return;
    try {
      const out = await trackerApi.deleteLead(lead.id);
      // Le nombre de conversions nettoyées est la preuve visible que l'effacement est allé jusqu'aux copies.
      const also = out.conversionsScrubbed ? ` (${out.conversionsScrubbed} conversion${out.conversionsScrubbed > 1 ? 's' : ''} scrubbed)` : '';
      toast.success(`Lead erased${also}`);
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const exportCsv = async () => {
    try {
      const { limit: _limit, offset: _offset, ...rest } = params();
      const csv = await trackerApi.exportLeadsCsv(rest);
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  return (
    <div>
      <PageHeader
        title="Leads"
        description="Contact, quiz answers and consent sent with each lead. Personal data: export only what you need."
        meta={<Badge tone="neutral">{total}</Badge>}
        action={
          <Button variant="secondary" onClick={exportCsv}>
            Export CSV
          </Button>
        }
      />

      <form
        className="mb-4 flex flex-wrap items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
      >
        <div className="w-72">
          <Input
            type="search"
            placeholder="Name, phone, email, ZIP or state"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search leads"
          />
        </div>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        <Button
          type="submit"
          variant="secondary"
          onClick={() => {
            setPage(0);
          }}
        >
          Search
        </Button>
        <label className={`flex items-center gap-2 text-xs ${mutedTextClass}`}>
          <input type="checkbox" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} />
          Include test leads
        </label>
      </form>

      {error && (
        <div className="mb-6">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {loading ? (
        <Loading />
      ) : (
        <DataTable>
          <table className="w-full text-xs">
            <TableHead>
              <Th>Received</Th>
              <Th>Name</Th>
              <Th>Phone</Th>
              <Th>Email</Th>
              <Th>ZIP</Th>
              <Th>State</Th>
              <Th>Source</Th>
              <Th>Campaign</Th>
              <Th></Th>
            </TableHead>
            <tbody>
              {leads.length === 0 && (
                <tr className={tableRowClass}>
                  <Td className={mutedTextClass}>No leads yet.</Td>
                </tr>
              )}
              {leads.map((lead) => {
                const isExpanded = expanded === lead.id;
                return (
                  <Fragment key={lead.id}>
                    <tr
                      className={`${tableRowClass} cursor-pointer`}
                      onClick={() => setExpanded(isExpanded ? null : lead.id)}
                    >
                      <Td className={`${mutedTextClass} whitespace-nowrap`}>
                        {new Date(lead.createdAt).toLocaleString()}
                      </Td>
                      <Td>
                        <span className="inline-flex items-center gap-1.5">
                          {fullName(lead)}
                          {lead.isTest && <Badge tone="warning">Test</Badge>}
                        </span>
                      </Td>
                      <Td className="font-mono whitespace-nowrap">{lead.phone || '—'}</Td>
                      <Td className="max-w-[180px] truncate">{lead.email || '—'}</Td>
                      <Td className="tabular-nums">{lead.zip || '—'}</Td>
                      <Td>{lead.state || '—'}</Td>
                      <Td>{lead.source}</Td>
                      <Td className="max-w-[160px] truncate">{lead.campaign?.name || lead.campaignId}</Td>
                      <Td>
                        {lead.erasedAt ? (
                          <Badge tone="neutral">{erasedLabel(lead)}</Badge>
                        ) : lead.purgedAt ? (
                          <Badge tone="neutral">Purged {new Date(lead.purgedAt).toLocaleDateString()}</Badge>
                        ) : (
                          <button
                            className={`${linkClass} text-xs font-medium`}
                            onClick={(e) => {
                              e.stopPropagation();
                              void erase(lead);
                            }}
                          >
                            Erase
                          </button>
                        )}
                      </Td>
                    </tr>
                    {isExpanded && (
                      <tr className={detailRowClass}>
                        <td colSpan={9} className="px-5 py-4">
                          <div className="grid grid-cols-3 gap-3 text-xs">
                            {Object.entries(lead.answers ?? {}).map(([k, v]) => (
                              <Detail key={k} label={`Answer ${k}`} value={v} />
                            ))}
                            <Detail label="Consent at" value={lead.consentAt ? new Date(lead.consentAt).toLocaleString() : null} />
                            <Detail label="IP" value={lead.ip} />
                            <Detail label="Click ID" value={lead.clickId} />
                            <div className="col-span-3">
                              <Detail label="Page" value={lead.pageUrl} />
                            </div>
                            <div className="col-span-3">
                              <Detail label="Consent text" value={lead.consentText} />
                            </div>
                            <div className="col-span-3">
                              <Detail label="User Agent" value={lead.userAgent} />
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </DataTable>
      )}

      {total > PAGE_SIZE && (
        <div className="mt-4 flex items-center gap-3">
          <Button variant="secondary" disabled={page === 0} onClick={() => setPage((p) => Math.max(p - 1, 0))}>
            Previous
          </Button>
          <span className={`text-xs ${mutedTextClass}`}>
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
          </span>
          <Button
            variant="secondary"
            disabled={(page + 1) * PAGE_SIZE >= total}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
