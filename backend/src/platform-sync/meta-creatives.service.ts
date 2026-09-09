import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { AdPlatform, PlatformConnectionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FacebookSyncAdapter } from './adapters/facebook.adapter';
import type { ParsedMetaAdCreative } from './meta-ad-creative.parse';

const FAILED_RETRY_MS = 6 * 60 * 60 * 1000;
const LOOKBACK_DAYS = 14;

@Injectable()
export class MetaCreativesService {
  private readonly logger = new Logger(MetaCreativesService.name);
  private readonly facebook: FacebookSyncAdapter;

  constructor(
    private readonly prisma: PrismaService,
    http: HttpService,
  ) {
    this.facebook = new FacebookSyncAdapter(http);
  }

  async getByAdIds(adIds: string[]): Promise<Map<string, ParsedMetaAdCreative>> {
    const unique = [...new Set(adIds.map((id) => id.trim()).filter(Boolean))];
    if (unique.length === 0) return new Map();

    const rows = await this.prisma.metaAdCreative.findMany({
      where: { adId: { in: unique } },
    });
    return new Map(
      rows.map((row) => [
        row.adId,
        {
          adId: row.adId,
          adName: row.adName ?? undefined,
          headline: row.headline ?? undefined,
          body: row.body ?? undefined,
          cta: row.cta ?? undefined,
          imageUrl: row.imageUrl ?? undefined,
          thumbnailUrl: row.thumbnailUrl ?? undefined,
          lastError: row.lastError ?? undefined,
        },
      ]),
    );
  }

  async refreshRecent(): Promise<{ fetched: number; skipped: string | null }> {
    const token = await this.resolveAccessToken();
    if (!token) return { fetched: 0, skipped: 'no facebook connection' };

    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const clicks = await this.prisma.click.findMany({
      where: {
        adId: { not: null },
        createdAt: { gte: since },
        isTest: false,
      },
      select: { adId: true },
      distinct: ['adId'],
    });
    const adIds = clicks.map((c) => c.adId).filter((id): id is string => Boolean(id));
    const fetched = await this.refreshAdIds(adIds, token);
    return { fetched, skipped: null };
  }

  async refreshAdIds(adIds: string[], token?: string): Promise<number> {
    const accessToken = token || (await this.resolveAccessToken());
    if (!accessToken) return 0;

    const unique = [...new Set(adIds.map((id) => id.trim()).filter(Boolean))];
    if (unique.length === 0) return 0;

    const existing = await this.prisma.metaAdCreative.findMany({
      where: { adId: { in: unique } },
    });
    const byId = new Map(existing.map((row) => [row.adId, row]));
    const now = Date.now();
    const needed = unique.filter((id) => {
      const row = byId.get(id);
      if (!row) return true;
      if (row.lastError && now - row.fetchedAt.getTime() >= FAILED_RETRY_MS) return true;
      return false;
    });
    if (needed.length === 0) return 0;

    let parsed: ParsedMetaAdCreative[] = [];
    try {
      parsed = await this.facebook.fetchAdCreatives(accessToken, needed);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Meta creative fetch failed: ${message}`);
      await this.upsertAll(
        needed.map((adId) => ({ adId, lastError: message })),
      );
      return 0;
    }

    const seen = new Set(parsed.map((row) => row.adId));
    for (const adId of needed) {
      if (!seen.has(adId)) parsed.push({ adId, lastError: 'Ad not returned by Graph API' });
    }
    await this.upsertAll(parsed);
    return parsed.filter((row) => !row.lastError).length;
  }

  private async resolveAccessToken(): Promise<string | null> {
    const conn = await this.prisma.platformConnection.findFirst({
      where: {
        platform: AdPlatform.facebook,
        status: { not: PlatformConnectionStatus.disabled },
      },
      orderBy: { updatedAt: 'desc' },
    });
    const token = String(
      (conn?.credentials as Record<string, unknown> | undefined)?.accessToken || '',
    ).trim();
    return token || null;
  }

  private async upsertAll(rows: ParsedMetaAdCreative[]) {
    const fetchedAt = new Date();
    for (const row of rows) {
      await this.prisma.metaAdCreative.upsert({
        where: { adId: row.adId },
        create: {
          adId: row.adId,
          adName: row.adName || null,
          headline: row.headline || null,
          body: row.body || null,
          cta: row.cta || null,
          imageUrl: row.imageUrl || null,
          thumbnailUrl: row.thumbnailUrl || null,
          fetchedAt,
          lastError: row.lastError || null,
          raw: (row.raw as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        },
        update: {
          adName: row.adName || null,
          headline: row.headline || null,
          body: row.body || null,
          cta: row.cta || null,
          imageUrl: row.imageUrl || null,
          thumbnailUrl: row.thumbnailUrl || null,
          fetchedAt,
          lastError: row.lastError || null,
          raw: (row.raw as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        },
      });
    }
  }
}
