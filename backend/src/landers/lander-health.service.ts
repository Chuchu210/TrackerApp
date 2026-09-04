import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { AlertSeverity, AlertStatus, LanderHealth, RuleScope } from '@prisma/client';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const REQUEST_TIMEOUT_MS = 12_000;

/**
 * Probes each ready lander's public URL and records whether the page is
 * actually live and still carries the tracker.
 *
 * This exists because a green deploy is not proof of a live page: CI reported
 * success for weeks while the production LP kept serving a two-month-old build
 * (the deploy target was not the directory nginx served). Fetching the page the
 * visitor gets is the only check that would have caught it.
 */
@Injectable()
export class LanderHealthService {
  private readonly logger = new Logger(LanderHealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: HttpService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('15 * * * *')
  async runScheduled() {
    try {
      const result = await this.checkAll();
      this.logger.log(
        `Lander health: ${result.healthy} healthy, ${result.unhealthy} unhealthy`,
      );
    } catch (err) {
      this.logger.error('Lander health sweep failed', err);
    }
  }

  async checkAll(): Promise<{ healthy: number; unhealthy: number }> {
    const landers = await this.prisma.lander.findMany({
      where: { status: 'ready' },
      select: {
        id: true,
        name: true,
        publicUrl: true,
        injectTracker: true,
        healthStatus: true,
        campaignId: true,
      },
    });

    let healthy = 0;
    let unhealthy = 0;

    for (const lander of landers) {
      const outcome = await this.probe(lander.publicUrl, lander.injectTracker);

      await this.prisma.lander.update({
        where: { id: lander.id },
        data: {
          healthStatus: outcome.status,
          healthCheckedAt: new Date(),
          healthError: outcome.error,
        },
      });

      if (outcome.status === LanderHealth.healthy) {
        healthy++;
        continue;
      }
      unhealthy++;

      // Only alert on the transition, so a lander that stays broken does not
      // re-notify every hour.
      if (lander.healthStatus !== outcome.status) {
        await this.raiseAlert(lander, outcome);
      }
    }

    return { healthy, unhealthy };
  }

  private async probe(
    url: string,
    expectTracker: boolean,
  ): Promise<{ status: LanderHealth; error: string | null }> {
    if (!url) {
      return { status: LanderHealth.unreachable, error: 'No public URL set' };
    }

    let html: string;
    try {
      const res = await firstValueFrom(
        this.http.get<string>(url, {
          timeout: REQUEST_TIMEOUT_MS,
          responseType: 'text',
          // A redirect to an error page is still a failure we want to see.
          maxRedirects: 3,
          // Bypass any intermediate cache so we probe what is really served.
          headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
        }),
      );
      if (res.status < 200 || res.status >= 300) {
        return {
          status: LanderHealth.unreachable,
          error: `HTTP ${res.status}`,
        };
      }
      html = typeof res.data === 'string' ? res.data : String(res.data ?? '');
    } catch (err) {
      const e = err as { response?: { status?: number }; message?: string };
      return {
        status: LanderHealth.unreachable,
        error: e.response?.status ? `HTTP ${e.response.status}` : e.message || 'Request failed',
      };
    }

    if (expectTracker && !/\/t\/tracker\.js/i.test(html)) {
      return {
        status: LanderHealth.tracker_missing,
        error: 'Page is up but the tracker script tag is absent',
      };
    }

    return { status: LanderHealth.healthy, error: null };
  }

  private async raiseAlert(
    lander: { id: string; name: string; publicUrl: string; campaignId: string },
    outcome: { status: LanderHealth; error: string | null },
  ) {
    const open = await this.prisma.alertEvent.findFirst({
      where: {
        entityKey: lander.id,
        scope: RuleScope.campaign,
        status: { in: [AlertStatus.open, AlertStatus.ack] },
      },
    });
    if (open) return;

    const alert = await this.prisma.alertEvent.create({
      data: {
        severity: AlertSeverity.danger,
        scope: RuleScope.campaign,
        entityKey: lander.id,
        entityLabel: lander.name,
        title: `Lander unhealthy: ${lander.name}`,
        message:
          outcome.status === LanderHealth.tracker_missing
            ? `${lander.publicUrl} responds but no tracker script was found — clicks on this page are not being recorded.`
            : `${lander.publicUrl} could not be fetched (${outcome.error}).`,
        suggestedAction:
          outcome.status === LanderHealth.tracker_missing
            ? 'Re-deploy the lander and confirm the deploy target is the directory the web server actually serves.'
            : 'Check DNS, the web server and the deploy target for this lander.',
        campaignId: lander.campaignId,
      },
    });

    void this.notifications.dispatchAlert(alert);
  }
}
