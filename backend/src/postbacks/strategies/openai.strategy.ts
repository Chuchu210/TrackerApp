import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { Click, Conversion, ConversionMethod, PostbackConfig } from '@prisma/client';
import {
  CampaignPostbackContext,
  PostbackResult,
  PostbackStrategy,
} from '../interfaces/postback-strategy.interface';
import { sleep } from '../helpers/facebook-graph-http.helper';
import { sha256 } from '../helpers/hash.helper';
import { openAiEventForEventType } from '../../shared/tracking/openai-events';

const OPENAI_EVENTS_ENDPOINT = 'https://bzr.openai.com/v1/events';

/** Events must be no older than 7 days and no more than 10 minutes in the future. */
const MAX_EVENT_AGE_MS = 6.5 * 24 * 60 * 60 * 1000;

/**
 * OpenAI Ads Conversions API.
 * https://developers.openai.com/ads/conversions-api
 *
 * Sends one event per request rather than batching: a batch fails as a whole if
 * any single event in it is invalid, and each of our conversions is postbacked
 * independently anyway.
 */
@Injectable()
export class OpenAiStrategy implements PostbackStrategy {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  getNetwork(): string {
    return 'openai';
  }

  canHandle(config: PostbackConfig, campaign?: CampaignPostbackContext): boolean {
    const method = campaign?.trafficSourceProfile?.conversionMethod;
    if (method && method !== ConversionMethod.openai_capi) return false;
    return config.openaiEnabled && !!config.openaiPixelId;
  }

  async send(
    click: Click,
    conversion: Conversion,
    config: PostbackConfig,
    campaign?: CampaignPostbackContext,
  ): Promise<PostbackResult> {
    const pixelId = config.openaiPixelId || this.config.get<string>('OPENAI_ADS_PIXEL_ID');
    const apiKey = config.openaiApiKey || this.config.get<string>('OPENAI_ADS_API_KEY');

    if (!pixelId || !apiKey) {
      return {
        success: false,
        method: 'POST',
        url: '',
        response: 'OpenAI Ads pixel ID or API key not configured',
      };
    }

    const url = `${OPENAI_EVENTS_ENDPOINT}?pid=${encodeURIComponent(pixelId)}`;
    const mapped = openAiEventForEventType(conversion.eventType);
    const metadata = (conversion.metadata as Record<string, string>) || {};

    const event: Record<string, unknown> = {
      // Dedup key: OpenAI keys on pixel id + event type + id, and keeps the
      // first one it receives, so retries of the same conversion are safe.
      id: conversion.id,
      type: mapped.type,
      timestamp_ms: this.eventTimestampMs(conversion.createdAt),
      action_source: 'web',
      data: this.buildData(mapped.dataType, conversion),
    };

    if (mapped.customEventName) event.custom_event_name = mapped.customEventName;
    // Click attribution — captured on the LP and stored at click time, since
    // the API (unlike the pixel) does not resolve it for us.
    if (click.oppref) event.oppref = click.oppref;

    const sourceUrl = campaign?.campaign?.destinationUrl;
    if (sourceUrl) event.source_url = sourceUrl;

    const user = this.buildUser(click, metadata);
    if (Object.keys(user).length > 0) event.user = user;

    const body = { events: [event] };

    try {
      const { data, status } = await this.postWithRetry(url, body, apiKey);
      return {
        success: status >= 200 && status < 300,
        method: 'POST',
        url,
        requestBody: JSON.stringify(body),
        httpStatus: status,
        response: JSON.stringify(data),
      };
    } catch (err) {
      const e = err as {
        response?: { status?: number; data?: unknown };
        message?: string;
      };
      return {
        success: false,
        method: 'POST',
        url,
        requestBody: JSON.stringify(body),
        httpStatus: e.response?.status,
        response: e.response?.data
          ? JSON.stringify(e.response.data)
          : e.message || 'OpenAI Ads CAPI postback failed',
      };
    }
  }

  /** Clamp into the accepted window: not older than ~7 days, not in the future. */
  private eventTimestampMs(createdAt: Date): number {
    const now = Date.now();
    const ts = createdAt.getTime();
    if (!Number.isFinite(ts) || ts > now) return now;
    return Math.max(ts, now - MAX_EVENT_AGE_MS);
  }

  private buildData(
    dataType: string,
    conversion: Conversion,
  ): Record<string, unknown> {
    const data: Record<string, unknown> = { type: dataType };
    // Amounts are in the currency's minor unit (4200 = $42.00), and currency
    // is required whenever amount is present.
    const amountMinor = Math.round((conversion.revenue || 0) * 100);
    if (amountMinor > 0) {
      data.amount = amountMinor;
      data.currency = (conversion.currency || 'USD').toUpperCase();
    }
    return data;
  }

  private buildUser(
    click: Click,
    metadata: Record<string, string>,
  ): Record<string, unknown> {
    const user: Record<string, unknown> = {};

    // Hashed identifiers are sent as arrays of lowercase hex SHA-256 digests.
    if (metadata.email) user.emails_sha256 = [sha256(metadata.email)];
    if (metadata.phone) {
      const digits = metadata.phone.replace(/\D/g, '').replace(/^0+/, '');
      if (digits) user.phone_numbers_sha256 = [sha256(digits)];
    }
    if (metadata.firstName) {
      user.first_names_sha256 = [sha256(this.normalizeName(metadata.firstName))];
    }
    if (metadata.lastName) {
      user.last_names_sha256 = [sha256(this.normalizeName(metadata.lastName))];
    }

    // Geographic and device fields are sent raw; OpenAI normalizes them.
    if (click.countryCode) user.countries = [click.countryCode];
    if (click.region) user.regions = [click.region];
    if (click.city) user.cities = [click.city];
    if (click.ipAddress) user.ip_address = click.ipAddress;
    if (click.userAgent) user.user_agent = click.userAgent;
    // Opaque browser reference from the __obref cookie — passed unchanged.
    if (click.obref) user.obref = click.obref;

    return user;
  }

  /** Lowercase, strip whitespace and ASCII punctuation, keep non-ASCII. */
  private normalizeName(value: string): string {
    return value.replace(/[\s!-/:-@[-`{-~]/g, '');
  }

  private async postWithRetry(
    url: string,
    body: unknown,
    apiKey: string,
    maxRetries = 3,
  ): Promise<{ data: unknown; status: number }> {
    let lastError: unknown;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await firstValueFrom(
          this.http.post(url, body, {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
          }),
        );
        return { data: response.data, status: response.status };
      } catch (err) {
        lastError = err;
        const status = (err as { response?: { status?: number } })?.response?.status ?? 0;
        const isTransient = status === 429 || (status >= 500 && status < 600);
        if (!isTransient || attempt === maxRetries - 1) throw err;
        await sleep(400 * Math.pow(2, attempt));
      }
    }

    throw lastError;
  }
}
