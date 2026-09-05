import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

const SINGLETON_ID = 'singleton';
const CACHE_TTL_MS = 30_000;

export interface EffectiveSettings {
  telegramBotToken: string;
  telegramChatId: string;
  notifyWebhookUrl: string;
  notifyMinSeverity: string;
  baseCurrency: string;
  fxRates: string;
  reportTimezone: string;
  fraudVelocityWindowSeconds: number;
  fraudVelocityMaxClicks: number;
  testMode: boolean;
}

export interface StoredSettings {
  telegramBotToken: string | null;
  telegramChatId: string | null;
  notifyWebhookUrl: string | null;
  notifyMinSeverity: string | null;
  baseCurrency: string | null;
  fxRates: string | null;
  reportTimezone: string | null;
  fraudVelocityWindowSeconds: number | null;
  fraudVelocityMaxClicks: number | null;
  testMode: boolean | null;
}

/**
 * Global settings with a short in-memory cache so hot paths (click ingestion)
 * never hit the DB per request. Each field falls back DB -> env -> default, so
 * an empty settings row preserves the previous env-driven behavior exactly.
 */
@Injectable()
export class SettingsService {
  private cache: { value: EffectiveSettings; expiresAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async getEffective(): Promise<EffectiveSettings> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.value;

    let row: StoredSettings | null = null;
    try {
      row = await this.prisma.appSettings.findUnique({ where: { id: SINGLETON_ID } });
    } catch {
      row = null; // table not migrated yet — fall back to env
    }

    const env = (key: string) => this.config.get<string>(key);
    const value: EffectiveSettings = {
      telegramBotToken: row?.telegramBotToken ?? env('TELEGRAM_BOT_TOKEN') ?? '',
      telegramChatId: row?.telegramChatId ?? env('TELEGRAM_CHAT_ID') ?? '',
      notifyWebhookUrl: row?.notifyWebhookUrl ?? env('NOTIFY_WEBHOOK_URL') ?? '',
      notifyMinSeverity: (row?.notifyMinSeverity ?? env('NOTIFY_MIN_SEVERITY') ?? 'warning').toLowerCase(),
      baseCurrency: row?.baseCurrency ?? env('BASE_CURRENCY') ?? 'USD',
      fxRates: row?.fxRates ?? env('FX_RATES') ?? '',
      reportTimezone: row?.reportTimezone ?? env('REPORT_TIMEZONE') ?? 'UTC',
      fraudVelocityWindowSeconds:
        row?.fraudVelocityWindowSeconds ?? Number(env('FRAUD_VELOCITY_WINDOW_SECONDS') ?? 60),
      fraudVelocityMaxClicks:
        row?.fraudVelocityMaxClicks ?? Number(env('FRAUD_VELOCITY_MAX_CLICKS') ?? 20),
      // Deliberately not env-configurable: test mode is an operator switch that
      // must be visible and reversible from the UI, never a deploy-time state
      // someone can forget a server is running in.
      testMode: row?.testMode ?? false,
    };

    this.cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  }

  /** Raw stored values (nulls preserved) for the settings editor. */
  async getStored(): Promise<StoredSettings> {
    let row: StoredSettings | null = null;
    try {
      row = await this.prisma.appSettings.findUnique({ where: { id: SINGLETON_ID } });
    } catch {
      row = null;
    }
    return {
      telegramBotToken: row?.telegramBotToken ?? null,
      telegramChatId: row?.telegramChatId ?? null,
      notifyWebhookUrl: row?.notifyWebhookUrl ?? null,
      notifyMinSeverity: row?.notifyMinSeverity ?? null,
      baseCurrency: row?.baseCurrency ?? null,
      fxRates: row?.fxRates ?? null,
      reportTimezone: row?.reportTimezone ?? null,
      fraudVelocityWindowSeconds: row?.fraudVelocityWindowSeconds ?? null,
      fraudVelocityMaxClicks: row?.fraudVelocityMaxClicks ?? null,
      testMode: row?.testMode ?? null,
    };
  }

  /** Hot path: is ingestion currently stamping rows as test? */
  async isTestMode(): Promise<boolean> {
    const { testMode } = await this.getEffective();
    return testMode;
  }

  async setTestMode(enabled: boolean): Promise<{ enabled: boolean }> {
    await this.update({ testMode: enabled });
    return { enabled };
  }

  async update(patch: Partial<StoredSettings>): Promise<StoredSettings> {
    const data = this.normalize(patch);
    await this.prisma.appSettings.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, ...data },
      update: data,
    });
    this.cache = null; // invalidate so the next read reflects the change
    return this.getStored();
  }

  /** Convert empty strings to null so a cleared field falls back to env. */
  private normalize(patch: Partial<StoredSettings>): Partial<StoredSettings> {
    const out: Partial<StoredSettings> = {};
    for (const [key, val] of Object.entries(patch)) {
      if (val === undefined) continue;
      out[key as keyof StoredSettings] =
        typeof val === 'string' && val.trim() === '' ? null : (val as never);
    }
    return out;
  }
}
