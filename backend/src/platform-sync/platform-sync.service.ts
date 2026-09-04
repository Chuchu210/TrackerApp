import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { AdPlatform, ControlActionStatus, PlatformConnectionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { PlatformSyncAdapter, SpendMetricRow } from './interfaces/platform-sync.adapter';
import { FacebookSyncAdapter } from './adapters/facebook.adapter';
import { GoogleSyncAdapter } from './adapters/google.adapter';
import { MediagoSyncAdapter } from './adapters/mediago.adapter';
import { OutbrainSyncAdapter } from './adapters/outbrain.adapter';
import { TaboolaSyncAdapter } from './adapters/taboola.adapter';
import { MgidSyncAdapter } from './adapters/mgid.adapter';
import { BingSyncAdapter } from './adapters/bing.adapter';
import { OpenAiSyncAdapter } from './adapters/openai.adapter';
import { ManualSyncAdapter } from './adapters/manual.adapter';
import {
  CreatePlatformConnectionDto,
  CreateCampaignMappingDto,
  ManualSpendDto,
} from './dto/platform-sync.dto';
import { sanitizeMediagoCredentialsForResponse } from './mediago/mediago-credentials';

@Injectable()
export class PlatformSyncService {
  private readonly logger = new Logger(PlatformSyncService.name);
  private adapters = new Map<AdPlatform, PlatformSyncAdapter>();
  private readonly mediagoAdapter: MediagoSyncAdapter;
  private readonly openAiAdapter: OpenAiSyncAdapter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: HttpService,
  ) {
    this.mediagoAdapter = new MediagoSyncAdapter(this.http);
    this.openAiAdapter = new OpenAiSyncAdapter(this.http);
    this.registerAdapters();
  }

  // Every 15 minutes rather than hourly: the dashboard reads spend from the
  // snapshots this writes, so the sync interval is the real data freshness.
  @Cron('*/15 * * * *')
  async scheduledSync() {
    await this.syncAll().catch((err) => this.logger.error('Scheduled sync failed', err));
  }

  async pauseMediagoCampaign(campaignId: string) {
    return this.runMediagoControl(campaignId, 'pause', async (adapter, creds, externalId) =>
      adapter.pauseCampaign!(creds, externalId),
    );
  }

  async setMediagoBudget(campaignId: string, budget: number) {
    return this.runMediagoControl(campaignId, 'set_budget', async (adapter, creds, externalId) =>
      adapter.setDailyBudget!(creds, externalId, budget),
    );
  }

  private async runMediagoControl(
    campaignId: string,
    action: string,
    fn: (
      adapter: MediagoSyncAdapter,
      credentials: Record<string, unknown>,
      externalCampaignId: string,
    ) => Promise<{ ok: boolean; message: string }>,
  ) {
    const mapping = await this.prisma.campaignPlatformMapping.findFirst({
      where: { campaignId, platform: AdPlatform.mediago },
      include: { campaign: true },
    });
    if (!mapping) throw new BadRequestException('No Mediago mapping for campaign');

    const connection = await this.prisma.platformConnection.findFirst({
      where: { platform: AdPlatform.mediago, status: PlatformConnectionStatus.active },
    });
    if (!connection) throw new BadRequestException('No active Mediago connection');

    const credentials = connection.credentials as Record<string, unknown>;
    const log = await this.prisma.controlActionLog.create({
      data: {
        campaignId,
        platform: AdPlatform.mediago,
        action,
        payload: { externalCampaignId: mapping.externalCampaignId },
        status: ControlActionStatus.pending,
      },
    });

    const result = await fn(this.mediagoAdapter, credentials, mapping.externalCampaignId);
    await this.prisma.controlActionLog.update({
      where: { id: log.id },
      data: {
        status: result.ok ? ControlActionStatus.success : ControlActionStatus.failed,
        responseMessage: result.message,
      },
    });
    return result;
  }

  private registerAdapters() {
    const list: PlatformSyncAdapter[] = [
      new FacebookSyncAdapter(this.http),
      new GoogleSyncAdapter(),
      this.mediagoAdapter,
      new OutbrainSyncAdapter(this.http),
      new TaboolaSyncAdapter(this.http),
      new MgidSyncAdapter(this.http),
      new BingSyncAdapter(),
      this.openAiAdapter,
      new ManualSyncAdapter(AdPlatform.powerspace),
      new ManualSyncAdapter(AdPlatform.organic),
      new ManualSyncAdapter(AdPlatform.native),
    ];
    for (const a of list) this.adapters.set(a.platform, a);
  }

  async listConnections() {
    const rows = await this.prisma.platformConnection.findMany({ orderBy: { platform: 'asc' } });
    return rows.map((row) => ({
      ...row,
      credentials:
        row.platform === AdPlatform.mediago
          ? sanitizeMediagoCredentialsForResponse(row.credentials as Record<string, unknown>)
          : row.credentials,
    }));
  }

  createConnection(dto: CreatePlatformConnectionDto) {
    return this.prisma.platformConnection.create({
      data: {
        platform: dto.platform,
        label: dto.label,
        accountId: dto.accountId,
        credentials: (dto.credentials || {}) as Prisma.InputJsonValue,
        status: PlatformConnectionStatus.active,
      },
    });
  }

  async updateConnection(id: string, dto: Partial<CreatePlatformConnectionDto>) {
    return this.prisma.platformConnection.update({
      where: { id },
      data: {
        ...(dto.label !== undefined ? { label: dto.label } : {}),
        ...(dto.accountId !== undefined ? { accountId: dto.accountId } : {}),
        ...(dto.credentials !== undefined
          ? { credentials: dto.credentials as Prisma.InputJsonValue }
          : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
    });
  }

  async deleteConnection(id: string) {
    await this.prisma.platformConnection.delete({ where: { id } });
    return { deleted: true, id };
  }

  async testConnection(id: string) {
    const conn = await this.prisma.platformConnection.findUnique({ where: { id } });
    if (!conn) throw new BadRequestException('Connection not found');

    if (conn.platform === AdPlatform.mediago) {
      try {
        const accounts = await this.mediagoAdapter
          .getClient()
          .listAccounts(conn.credentials as Record<string, unknown>);
        const ok = accounts.length > 0;
        return {
          ok,
          accounts,
          message: ok
            ? `Connected — ${accounts.length} Mediago account(s) found`
            : 'No Mediago accounts returned for this token',
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, accounts: [], message };
      }
    }

    const adapter = this.adapters.get(conn.platform);
    if (!adapter) return { ok: false, message: 'No adapter for platform' };
    const ok = await adapter.testConnection(
      conn.credentials as Record<string, unknown>,
      conn.accountId,
    );
    return { ok, message: ok ? 'Connection OK' : 'Connection failed' };
  }

  async getMediagoAccounts(connectionId: string) {
    const conn = await this.requireMediagoConnection(connectionId);
    return this.mediagoAdapter.getClient().listAccounts(conn.credentials as Record<string, unknown>);
  }

  async getMediagoCampaigns(connectionId: string) {
    const conn = await this.requireMediagoConnection(connectionId);
    return this.mediagoAdapter
      .getClient()
      .listCampaigns(conn.credentials as Record<string, unknown>, conn.accountId);
  }

  async autoMapMediagoCampaigns(connectionId: string) {
    const conn = await this.requireMediagoConnection(connectionId);
    const external = await this.mediagoAdapter
      .getClient()
      .listCampaigns(conn.credentials as Record<string, unknown>, conn.accountId);
    const trackerCampaigns = await this.prisma.campaign.findMany({
      select: { id: true, name: true, slug: true, externalId: true },
    });

    let mapped = 0;
    let alreadyMapped = 0;
    let unmatched = 0;
    for (const ext of external) {
      const existing = await this.prisma.campaignPlatformMapping.findFirst({
        where: {
          platform: AdPlatform.mediago,
          externalCampaignId: ext.campaignId,
        },
      });
      if (existing) {
        alreadyMapped += 1;
        continue;
      }

      const match = this.matchTrackerCampaign(trackerCampaigns, ext.campaignId, ext.campaignName);
      if (!match) {
        unmatched += 1;
        continue;
      }

      await this.createMapping({
        campaignId: match.id,
        platform: AdPlatform.mediago,
        externalCampaignId: ext.campaignId,
      });
      mapped += 1;
    }

    return { mapped, total: external.length, alreadyMapped, unmatched };
  }

  /**
   * Match OpenAI Ads campaigns onto tracker campaigns by id or name, using the
   * same matcher as Mediago. Unmatched campaigns are simply left alone so the
   * user can map them explicitly.
   */
  async autoMapOpenAiCampaigns(connectionId: string) {
    const conn = await this.prisma.platformConnection.findUnique({
      where: { id: connectionId },
    });
    if (!conn || conn.platform !== AdPlatform.openai) {
      throw new BadRequestException('OpenAI connection not found');
    }

    const external = await this.openAiAdapter.listCampaigns(
      conn.credentials as Record<string, unknown>,
    );
    const trackerCampaigns = await this.prisma.campaign.findMany({
      select: { id: true, name: true, slug: true, externalId: true },
    });

    let mapped = 0;
    let alreadyMapped = 0;
    let unmatched = 0;
    for (const ext of external) {
      const existing = await this.prisma.campaignPlatformMapping.findFirst({
        where: {
          platform: AdPlatform.openai,
          externalCampaignId: ext.campaignId,
        },
      });
      if (existing) {
        alreadyMapped += 1;
        continue;
      }

      const match = this.matchTrackerCampaign(
        trackerCampaigns,
        ext.campaignId,
        ext.campaignName,
      );
      if (!match) {
        unmatched += 1;
        continue;
      }

      await this.createMapping({
        campaignId: match.id,
        platform: AdPlatform.openai,
        externalCampaignId: ext.campaignId,
      });
      mapped += 1;
    }

    return { mapped, total: external.length, alreadyMapped, unmatched };
  }

  private requireMediagoConnection(connectionId: string) {
    return this.prisma.platformConnection
      .findUnique({ where: { id: connectionId } })
      .then((conn) => {
        if (!conn) throw new BadRequestException('Connection not found');
        if (conn.platform !== AdPlatform.mediago) {
          throw new BadRequestException('Not a Mediago connection');
        }
        return conn;
      });
  }

  private matchTrackerCampaign(
    campaigns: { id: string; name: string; slug: string; externalId: string | null }[],
    externalId: string,
    externalName: string,
  ) {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const extNorm = norm(externalName);

    const extLower = externalName.toLowerCase();
    return (
      campaigns.find((c) => c.externalId === externalId) ||
      campaigns.find((c) => c.slug === externalId) ||
      campaigns.find((c) => norm(c.name) === extNorm) ||
      campaigns.find((c) => norm(c.slug) === extNorm) ||
      campaigns.find((c) => extNorm.includes(norm(c.slug)) || norm(c.slug).includes(extNorm)) ||
      campaigns.find(
        (c) =>
          c.slug.length >= 3 &&
          (extLower.includes(c.slug.toLowerCase()) || extNorm.includes(norm(c.slug))),
      )
    );
  }

  listMappings() {
    return this.prisma.campaignPlatformMapping.findMany({
      include: { campaign: { select: { id: true, name: true, slug: true } } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  createMapping(dto: CreateCampaignMappingDto) {
    // Keyed on the external campaign: re-mapping one platform campaign must
    // not disturb the others already pointing at the same tracker campaign.
    return this.prisma.campaignPlatformMapping.upsert({
      where: {
        platform_externalCampaignId: {
          platform: dto.platform,
          externalCampaignId: dto.externalCampaignId,
        },
      },
      create: {
        campaignId: dto.campaignId,
        platform: dto.platform,
        externalCampaignId: dto.externalCampaignId,
      },
      update: { campaignId: dto.campaignId },
    });
  }

  async deleteMapping(id: string) {
    await this.prisma.campaignPlatformMapping.delete({ where: { id } });
    return { deleted: true, id };
  }

  async upsertManualSpend(dto: ManualSpendDto) {
    const date = new Date(dto.date);
    const hour = dto.hour ?? -1;
    return this.prisma.campaignSpendSnapshot.upsert({
      where: {
        campaignId_platform_date_hour: {
          campaignId: dto.campaignId,
          platform: dto.platform,
          date,
          hour,
        },
      },
      create: {
        campaignId: dto.campaignId,
        platform: dto.platform,
        date,
        hour,
        impressions: dto.impressions ?? 0,
        clicks: dto.clicks ?? 0,
        spend: dto.spend ?? 0,
        currency: dto.currency || 'EUR',
        source: 'manual',
      },
      update: {
        impressions: dto.impressions ?? 0,
        clicks: dto.clicks ?? 0,
        spend: dto.spend ?? 0,
        currency: dto.currency || 'EUR',
        source: 'manual',
      },
    });
  }

  async importSpendCsv(csv: string) {
    const lines = csv.trim().split('\n').slice(1);
    let imported = 0;
    for (const line of lines) {
      const [dateStr, campaignSlug, impressions, clicks, spend, platformStr] = line
        .split(',')
        .map((s) => s.trim());
      if (!dateStr || !campaignSlug) continue;
      const campaign = await this.prisma.campaign.findFirst({
        where: { OR: [{ slug: campaignSlug }, { name: campaignSlug }] },
      });
      if (!campaign) continue;
      const platform = (platformStr as AdPlatform) || AdPlatform.native;
      await this.upsertManualSpend({
        campaignId: campaign.id,
        platform,
        date: dateStr,
        impressions: parseInt(impressions || '0', 10),
        clicks: parseInt(clicks || '0', 10),
        spend: parseFloat(spend || '0'),
      });
      imported++;
    }
    return { imported };
  }

  async syncAll(daysBack = 7) {
    const connections = await this.prisma.platformConnection.findMany({
      where: { status: PlatformConnectionStatus.active },
    });
    const to = new Date();
    const from = new Date(to.getTime() - daysBack * 24 * 60 * 60 * 1000);
    let total = 0;

    for (const conn of connections) {
      try {
        const n = await this.syncConnection(conn.id, from, to);
        total += n;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await this.prisma.platformConnection.update({
          where: { id: conn.id },
          data: { status: PlatformConnectionStatus.error, lastError: msg },
        });
      }
    }
    return { synced: total };
  }

  async syncConnection(connectionId: string, from?: Date, to?: Date) {
    const conn = await this.prisma.platformConnection.findUnique({ where: { id: connectionId } });
    if (!conn) throw new BadRequestException('Connection not found');

    const adapter = this.adapters.get(conn.platform);
    if (!adapter) return 0;

    if (conn.platform === AdPlatform.mediago) {
      const auto = await this.autoMapMediagoCampaigns(connectionId);
      if (auto.mapped > 0) {
        this.logger.log(`Mediago auto-mapped ${auto.mapped} campaign(s) for connection ${connectionId}`);
      }
    }

    if (conn.platform === AdPlatform.openai) {
      const auto = await this.autoMapOpenAiCampaigns(connectionId).catch((err) => {
        // Mapping is a convenience; a failure here must not abort the sync.
        this.logger.error('OpenAI auto-map failed', err);
        return { mapped: 0 };
      });
      if (auto.mapped > 0) {
        this.logger.log(`OpenAI auto-mapped ${auto.mapped} campaign(s) for connection ${connectionId}`);
      }
    }

    const end = to || new Date();
    const start = from || new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);

    const metrics = await adapter.fetchMetrics(
      conn.credentials as Record<string, unknown>,
      conn.accountId,
      start,
      end,
    );

    const mappings = await this.prisma.campaignPlatformMapping.findMany({
      where: { platform: conn.platform },
    });
    const mapByExternal = new Map(mappings.map((m) => [m.externalCampaignId, m.campaignId]));

    let saved = 0;
    for (const row of metrics) {
      const campaignId = mapByExternal.get(row.externalCampaignId);
      if (!campaignId) continue;
      await this.saveSnapshot(campaignId, conn.platform, row, 'sync');
      saved++;
    }

    await this.prisma.platformConnection.update({
      where: { id: conn.id },
      data: {
        lastSyncAt: new Date(),
        lastError: null,
        status: PlatformConnectionStatus.active,
      },
    });

    return saved;
  }

  private async saveSnapshot(
    campaignId: string,
    platform: AdPlatform,
    row: SpendMetricRow,
    source: string,
  ) {
    const hour = row.hour ?? -1;
    await this.prisma.campaignSpendSnapshot.upsert({
      where: {
        campaignId_platform_date_hour: {
          campaignId,
          platform,
          date: row.date,
          hour,
        },
      },
      create: {
        campaignId,
        platform,
        date: row.date,
        hour,
        impressions: row.impressions,
        clicks: row.clicks,
        spend: row.spend,
        currency: row.currency || 'EUR',
        source,
      },
      update: {
        impressions: row.impressions,
        clicks: row.clicks,
        spend: row.spend,
        currency: row.currency || 'EUR',
        source,
      },
    });
  }
}
