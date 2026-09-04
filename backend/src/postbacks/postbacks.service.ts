import { Injectable, Logger } from '@nestjs/common';
import { PostbackNetwork, ConversionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MediagoStrategy } from './strategies/mediago.strategy';
import { FacebookStrategy } from './strategies/facebook.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { OutbrainStrategy } from './strategies/outbrain.strategy';
import { OpenAiStrategy } from './strategies/openai.strategy';
import { PostbackStrategy } from './interfaces/postback-strategy.interface';

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

    if (!conversion || !conversion.campaign.postbackConfig) {
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
      if (!strategy.canHandle(config, campaignContext)) continue;

      const result = await strategy.send(
        conversion.click,
        conversion,
        config,
        campaignContext,
      );
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
      },
    });
  }

  async retryConversion(conversionId: string): Promise<void> {
    await this.prisma.conversion.update({
      where: { id: conversionId },
      data: { status: ConversionStatus.pending },
    });
    await this.processConversion(conversionId);
  }
}
