import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import {
  AlertLike,
  buildWebhookPayload,
  formatAlertText,
  meetsMinSeverity,
} from './notification-format';

/**
 * Delivers alerts to external channels (Telegram + generic webhook) so the
 * existing rules/decision engine can push notifications instead of only
 * surfacing them in-app. All sends are best-effort and never throw — a failing
 * channel must not block alert creation.
 *
 * Email: point NOTIFY_WEBHOOK_URL at an email relay (Zapier/Make/SES webhook),
 * or add an SMTP channel here later — kept HTTP-only to avoid new dependencies.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly http: HttpService,
  ) {}

  private minSeverity(): string {
    return (this.config.get<string>('NOTIFY_MIN_SEVERITY') || 'warning').toLowerCase();
  }

  async dispatchAlert(alert: AlertLike): Promise<void> {
    try {
      if (!meetsMinSeverity(alert.severity, this.minSeverity())) return;

      await Promise.all([this.sendTelegram(alert), this.sendWebhook(alert)]);
    } catch (err) {
      this.logger.warn(`Notification dispatch failed: ${(err as Error).message}`);
    }
  }

  private async sendTelegram(alert: AlertLike): Promise<void> {
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    const chatId = this.config.get<string>('TELEGRAM_CHAT_ID');
    if (!token || !chatId) return;

    try {
      await firstValueFrom(
        this.http.post(
          `https://api.telegram.org/bot${token}/sendMessage`,
          { chat_id: chatId, text: formatAlertText(alert), disable_web_page_preview: true },
          { timeout: 5000 },
        ),
      );
    } catch (err) {
      this.logger.warn(`Telegram notify failed: ${(err as Error).message}`);
    }
  }

  private async sendWebhook(alert: AlertLike): Promise<void> {
    const url = this.config.get<string>('NOTIFY_WEBHOOK_URL');
    if (!url) return;

    try {
      await firstValueFrom(
        this.http.post(url, buildWebhookPayload(alert), { timeout: 5000 }),
      );
    } catch (err) {
      this.logger.warn(`Webhook notify failed: ${(err as Error).message}`);
    }
  }
}
