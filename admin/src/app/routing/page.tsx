'use client';

import { useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Card,
  DataTable,
  EmptyState,
  InlineLink,
  Loading,
  PageHeader,
  TableHead,
  Td,
  Th,
  tableRowClass,
} from '@/components/ui';
import { trackerApi, formatApiError, type Campaign, type CampaignPath } from '@/lib/api';

type Row = { campaign: Campaign; paths: CampaignPath[] };

export default function RoutingPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const campaigns = await trackerApi.getCampaigns();
        const withPaths = await Promise.all(
          campaigns.map(async (campaign) => ({
            campaign,
            paths: await trackerApi.getCampaignPaths(campaign.id).catch(() => []),
          })),
        );
        if (!cancelled) setRows(withPaths);
      } catch (err) {
        if (!cancelled) setError(formatApiError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <Loading />;
  if (error) return <Alert tone="error">{error}</Alert>;

  return (
    <div>
      <PageHeader
        title="Paths & rotation"
        description="Weighted, rule-targeted routing and offer/lander A/B rotation per campaign. Auto-winner runs hourly."
      />

      {rows.length === 0 ? (
        <EmptyState title="No campaigns yet" description="Create a campaign to configure routing." />
      ) : (
        <Card>
          <DataTable>
            <TableHead>
              <Th>Campaign</Th>
              <Th>Paths</Th>
              <Th>Variants</Th>
              <Th>Status</Th>
              <Th> </Th>
            </TableHead>
            <tbody>
              {rows.map(({ campaign, paths }) => {
                const variants = paths.reduce((n, p) => n + p.variants.length, 0);
                const hasWinner = paths.some((p) => p.variants.some((v) => v.isWinner));
                return (
                  <tr key={campaign.id} className={tableRowClass}>
                    <Td>{campaign.name}</Td>
                    <Td>{paths.length}</Td>
                    <Td>{variants}</Td>
                    <Td>
                      {paths.length === 0 ? (
                        <Badge tone="neutral">Direct</Badge>
                      ) : hasWinner ? (
                        <Badge tone="success">Winner picked</Badge>
                      ) : (
                        <Badge tone="info">Routing on</Badge>
                      )}
                    </Td>
                    <Td>
                      <InlineLink href={`/campaigns/${campaign.id}/paths`}>Manage →</InlineLink>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        </Card>
      )}
    </div>
  );
}
