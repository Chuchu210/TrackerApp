import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ConversionEventTypesService } from '../conversion-event-types/conversion-event-types.service';
import {
  computeWinner,
  parseAutoWinnerConfig,
  type VariantStats,
} from '../shared/tracking/auto-winner';

@Injectable()
export class AutoWinnerService {
  private readonly logger = new Logger(AutoWinnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly eventTypes: ConversionEventTypesService,
  ) {}

  @Cron('15 * * * *')
  async scheduledRun() {
    if ((this.config.get<string>('AUTO_WINNER_ENABLED') || 'true') === 'false') return;
    await this.evaluateAll();
  }

  async evaluateAll() {
    const windowDays = Number(this.config.get<string>('AUTO_WINNER_WINDOW_DAYS') || 7);
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const config = parseAutoWinnerConfig(
      this.config.get<string>('AUTO_WINNER_MIN_VISITS_PER_VARIANT'),
      this.config.get<string>('AUTO_WINNER_MIN_TOTAL_VISITS'),
      this.config.get<string>('AUTO_WINNER_MIN_MARGIN_PCT'),
    );
    const slugs = await this.eventTypes.getConversionCountSlugs();

    const paths = await this.prisma.campaignPath.findMany({
      where: { active: true },
      include: { variants: { where: { active: true } } },
    });

    let winnersPicked = 0;
    for (const path of paths) {
      if (path.variants.length < 2) continue;

      const stats: VariantStats[] = [];
      for (const variant of path.variants) {
        const [visits, conversions] = await Promise.all([
          // Test rows are excluded on both sides: this counter decides which
          // variant every future visitor is sent to, so a handful of rehearsal
          // conversions must never be what picks the winner.
          this.prisma.click.count({
            where: {
              variantId: variant.id,
              isBot: false,
              isTest: false,
              createdAt: { gte: since },
            },
          }),
          this.prisma.conversion.count({
            where: {
              click: { variantId: variant.id },
              createdAt: { gte: since },
              isTest: false,
              ...(slugs.length > 0 ? { eventType: { in: slugs } } : {}),
            },
          }),
        ]);
        stats.push({ variantId: variant.id, visits, conversions });
      }

      const result = computeWinner(stats, config);
      if (!result.winnerId) continue;

      await this.promoteWinner(path.id, result.winnerId);
      winnersPicked++;
      this.logger.log(`Auto-winner picked variant ${result.winnerId} for path ${path.id}`);
    }

    return { pathsEvaluated: paths.length, winnersPicked };
  }

  /** Mark the winner and deactivate the losing variants for a path. */
  private async promoteWinner(pathId: string, winnerId: string) {
    await this.prisma.$transaction([
      this.prisma.pathVariant.update({
        where: { id: winnerId },
        data: { isWinner: true, weight: 100 },
      }),
      this.prisma.pathVariant.updateMany({
        where: { pathId, id: { not: winnerId } },
        data: { active: false },
      }),
    ]);
  }
}
