import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { VOLUUM_CSV_HEADERS } from '../shared/tracking/voluum-fields';

type ConversionRow = Prisma.ConversionGetPayload<{
  include: {
    click: true;
    campaign: true;
    postbackLogs: true;
  };
}>;

@Injectable()
export class VoluumExportService {
  constructor(private readonly prisma: PrismaService) {}

  async exportConversionsCsv(filters: {
    campaignId?: string;
    from?: string;
    to?: string;
  }): Promise<string> {
    // A CSV export leaves the building — test rows must never travel with it,
    // whatever the log screens choose to display.
    const where: Prisma.ConversionWhereInput = { isTest: false };
    if (filters.campaignId) where.campaignId = filters.campaignId;
    if (filters.from || filters.to) {
      where.createdAt = {
        ...(filters.from ? { gte: new Date(filters.from) } : {}),
        ...(filters.to ? { lte: new Date(filters.to) } : {}),
      };
    }

    const items = await this.prisma.conversion.findMany({
      where,
      include: { click: true, campaign: true, postbackLogs: { orderBy: { createdAt: 'desc' } } },
      orderBy: { createdAt: 'desc' },
      take: 10000,
    });

    const lines = [VOLUUM_CSV_HEADERS.join(',')];
    for (const row of items) {
      lines.push(this.toCsvRow(row));
    }
    return lines.join('\n');
  }

  private toCsvRow(row: ConversionRow): string {
    const click = row.click;
    const campaign = row.campaign;
    const outgoing = row.postbackLogs[0]?.url || '';

    const values = [
      this.fmtDate(row.createdAt),
      this.fmtDate(click.createdAt),
      click.trackingId || click.externalClickId || click.fbclid || '',
      click.clickId,
      row.transactionId || '',
      this.fmtNum(row.revenue),
      this.fmtNum(row.revenue),
      this.fmtNum(row.totalRevenue ?? row.revenue),
      this.fmtNum(row.cost),
      row.currency || '',
      row.eventType,
      outgoing,
      row.incomingPostbackIp || '',
      row.incomingPostbackUrl || '',
      campaign.externalId || campaign.id,
      campaign.name,
      campaign.workspaceName || '',
      campaign.workspaceId || '',
      click.landerName || campaign.landerName || '',
      click.landerId || campaign.landerId || '',
      click.offerName || campaign.offerName || '',
      click.offerId || campaign.offerId || '',
      click.country || '',
      click.countryCode || '',
      click.region || '',
      click.city || '',
      click.pathId || '',
      click.userAgent || '',
      click.trafficSourceName || campaign.trafficSourceName || campaign.trafficSource,
      click.trafficSourceId || campaign.trafficSourceId || '',
      click.affiliateNetwork || campaign.affiliateNetwork || '',
      click.affiliateNetworkId || campaign.affiliateNetworkId || '',
      click.device || '',
      click.os || '',
      click.osVersion || '',
      click.brand || '',
      click.model || '',
      click.browser || '',
      click.browserVersion || '',
      click.isp || '',
      click.mobileCarrier || '',
      click.connectionType || '',
      click.ipAddress || '',
      click.referrer || '',
      click.customVariable1 || '',
      click.customVariable2 || '',
      click.customVariable3 || '',
      click.customVariable4 || '',
      click.customVariable5 || '',
      click.customVariable6 || '',
      click.customVariable7 || '',
      click.customVariable8 || '',
      click.customVariable9 || '',
      click.customVariable10 || '',
      row.postbackParam1 || '',
      row.postbackParam2 || '',
      row.postbackParam3 || '',
      row.postbackParam4 || '',
      row.postbackParam5 || '',
    ];

    return values.map((v) => this.escapeCsv(String(v))).join(',');
  }

  private fmtDate(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  private fmtNum(n: number): string {
    return n.toFixed(5);
  }

  private escapeCsv(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
