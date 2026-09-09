import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PostbackNetwork, ConversionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MediagoStrategy } from './strategies/mediago.strategy';
import { FacebookStrategy } from './strategies/facebook.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { OutbrainStrategy } from './strategies/outbrain.strategy';
import { OpenAiStrategy } from './strategies/openai.strategy';
import { PostbackStrategy } from './interfaces/postback-strategy.interface';
import { shouldFireNetworkPostback } from '../shared/tracking/postback-event-gate';

@Injectable()
export class PostbacksService {
  private readonly logger = new Logger(PostbacksService.name);
  private readonly strategies: PostbackStrategy[];

  constructor(
    private readonly prisma: PrismaService,
    mediago: MediagoStrategy,
    facebook: FacebookStrategy,
    google: GoogleStrategy,
    outbrain: OutbrainStrategy,
    openai: OpenAiStrategy,
  ) {
    this.strategies = [mediago, facebook, google, outbrain, openai];
  }

  async processConversion(conversionId: string): Promise<void> {
    const conversion = await this.prisma.conversion.findUnique({
      where: { id: conversionId },
      include: {
        click: true,
        campaign: {
          include: {
            postbackConfig: true,
            trafficSourceProfile: true,
          },
        },
      },
    });

    if (!conversion) {
      this.logger.warn(`Conversion ${conversionId} not found`);
      return;
    }

    if (!conversion.campaign.postbackConfig) {
      this.logger.warn(`Conversion ${conversionId} not found or no postback config`);
      return;
    }

    const config = conversion.campaign.postbackConfig;
    const profile = conversion.campaign.trafficSourceProfile;
    const campaignContext = {
      trafficSourceProfile: profile
        ? {
            conversionMethod: profile.conversionMethod,
            postbackDefaults: profile.postbackDefaults,
            paramMappings: (profile.paramMappings || []) as never,
          }
        : null,
      campaign: {
        id: conversion.campaign.id,
        name: conversion.campaign.name,
        externalId: conversion.campaign.externalId,
        destinationUrl: conversion.campaign.destinationUrl,
      },
    };

    let allSuccess = true;
    let anySent = false;

    for (const strategy of this.strategies) {
      if (!shouldFireNetworkPostback(conversion.eventType, strategy.getNetwork())) continue;
      if (!strategy.canHandle(config, campaignContext)) continue;

      let result;
      try {
        result = await strategy.send(
          conversion.click,
          conversion,
          config,
          campaignContext,
        );
      } catch (err) {
        // A strategy that throws used to abort processConversion entirely,
        // leaving the conversion stuck in `pending` with no log to explain it.
        const message = err instanceof Error ? err.message : String(err);
        result = {
          success: false,
          method: 'UNKNOWN',
          url: '',
          response: `Strategy threw: ${message}`,
        };
      }
      anySent = true;

      await this.prisma.postbackLog.create({
        data: {
          conversionId: conversion.id,
          network: strategy.getNetwork() as PostbackNetwork,
          method: result.method,
          url: result.url,
          requestBody: result.requestBody,
          httpStatus: result.httpStatus,
          response: result.response,
          success: result.success,
        },
      });

      if (!result.success) {
        allSuccess = false;
        this.logger.error(
          `Postback failed for ${strategy.getNetwork()}: ${result.response}`,
        );
      }
    }

    await this.prisma.conversion.update({
      where: { id: conversionId },
      data: {
        status: anySent
          ? allSuccess
            ? ConversionStatus.sent
            : ConversionStatus.failed
          : ConversionStatus.skipped,
        postbackAttempts: { increment: 1 },
        lastPostbackAt: new Date(),
      },
    });
  }

  /** Attempts before a conversion is left alone for manual inspection. */
  private static readonly MAX_POSTBACK_ATTEMPTS = 6;

  /**
   * Retry deliveries that never completed. Without this a failed postback was
   * only ever retried by hand from the admin, so a transient network blip on
   * the network's side quietly cost a conversion.
   *
   * Backoff is derived from the attempt count rather than stored per row:
   * a conversion is eligible once it has been idle for 5 minutes x 2^attempts.
   */
  @Cron('*/5 * * * *')
  async retryUnfinished(): Promise<{ retried: number }> {
    try {
      const candidates = await this.prisma.conversion.findMany({
        where: {
          status: { in: [ConversionStatus.pending, ConversionStatus.failed] },
          postbackAttempts: { lt: PostbacksService.MAX_POSTBACK_ATTEMPTS },
        },
        select: { id: true, postbackAttempts: true, lastPostbackAt: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
        take: 100,
      });

      const now = Date.now();
      let retried = 0;

      for (const row of candidates) {
        const idleSince = (row.lastPostbackAt ?? row.createdAt).getTime();
        const waitMs = 5 * 60_000 * Math.pow(2, row.postbackAttempts);
        if (now - idleSince < waitMs) continue;

        // Claim the row before working on it so two overlapping sweeps (or a
        // sweep racing a manual retry) cannot double-send the same postback.
        const claimed = await this.prisma.conversion.updateMany({
          where: { id: row.id, postbackAttempts: row.postbackAttempts },
          data: { lastPostbackAt: new Date() },
        });
        if (claimed.count !== 1) continue;

        await this.processConversion(row.id).catch((err) => {
          this.logger.error(`Retry failed for conversion ${row.id}`, err);
        });
        retried++;
      }

      if (retried > 0) this.logger.log(`Retried ${retried} unfinished postback(s)`);
      return { retried };
    } catch (err) {
      this.logger.error('Postback retry sweep failed', err);
      return { retried: 0 };
    }
  }

  async retryConversion(conversionId: string): Promise<void> {
    await this.prisma.conversion.update({
      where: { id: conversionId },
      data: { status: ConversionStatus.pending },
    });
    await this.processConversion(conversionId);
  }
}
