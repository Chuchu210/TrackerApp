import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Click, Conversion, ConversionMethod, PostbackConfig } from '@prisma/client';
import {
  CampaignPostbackContext,
  PostbackResult,
  PostbackStrategy,
} from '../interfaces/postback-strategy.interface';
import { httpRequestWithRetry } from '../helpers/facebook-graph-http.helper';
import { sha256 } from '../helpers/hash.helper';
import { metaEventNameForEventType } from '../../shared/tracking/meta-events';

/** Currency of this tracker's offers when a postback does not say. */
const DEFAULT_CURRENCY = 'EUR';

@Injectable()
export class FacebookStrategy implements PostbackStrategy {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  getNetwork(): string {
    return 'facebook';
  }

  canHandle(config: PostbackConfig, campaign?: CampaignPostbackContext): boolean {
    const method = campaign?.trafficSourceProfile?.conversionMethod;
    if (method && method !== ConversionMethod.facebook_capi) return false;
    return config.facebookEnabled && !!config.facebookPixelId;
  }

  async send(click: Click, conversion: Conversion, config: PostbackConfig): Promise<PostbackResult> {
    const pixelId = config.facebookPixelId || this.config.get('FACEBOOK_PIXEL_ID');
    const accessToken =
      config.facebookAccessToken || this.config.get('FACEBOOK_ACCESS_TOKEN');

    if (!pixelId || !accessToken) {
      return {
        success: false,
        method: 'POST',
        url: '',
        response: 'Facebook pixel ID or access token not configured',
      };
    }

    const metadata = (conversion.metadata as Record<string, string>) || {};
    const userData: Record<string, string> = {};

    if (metadata.email) userData.em = sha256(metadata.email);
    if (metadata.phone) userData.ph = sha256(metadata.phone.replace(/\D/g, ''));
    if (metadata.firstName) userData.fn = sha256(metadata.firstName);
    if (metadata.lastName) userData.ln = sha256(metadata.lastName);
    if (metadata.fbp) userData.fbp = metadata.fbp;
    if (metadata.fbc) userData.fbc = metadata.fbc;
    if (click.ipAddress) userData.client_ip_address = click.ipAddress;
    if (click.userAgent) userData.client_user_agent = click.userAgent;

    const eventId = `${conversion.id}-${click.clickId}`;
    // The amount goes out in the currency it was recorded in — a buyer bidding in
    // USD used to be reported to Meta as EUR. revenueBase is deliberately not
    // used: it is labelled with BASE_CURRENCY, which defaults to USD when unset
    // even though the amounts are euros.
    const value = conversion.revenue || 0;
    const rawCurrency = (conversion.currency || DEFAULT_CURRENCY).toUpperCase();
    // An unreplaced buyer macro ("{CURRENCY}") or a typo would make Meta reject the whole event.
    const currency = /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : DEFAULT_CURRENCY;
    const eventData = {
      event_name: metaEventNameForEventType(conversion.eventType),
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: 'website',
      user_data: userData,
      custom_data: { value, currency },
    };

    const body = {
      data: [eventData],
      access_token: accessToken,
    };

    const url = `https://graph.facebook.com/v21.0/${pixelId}/events`;

    try {
      const { data, status } = await httpRequestWithRetry(this.http, 'post', url, body);
      return {
        success: status >= 200 && status < 300,
        method: 'POST',
        url,
        requestBody: JSON.stringify({ ...body, access_token: '***' }), // journal lisible par l'API : jamais le jeton
        httpStatus: status,
        response: JSON.stringify(data),
      };
    } catch (err) {
      const e = err as { response?: { status?: number; data?: unknown }; message?: string };
      return {
        success: false,
        method: 'POST',
        url,
        requestBody: JSON.stringify({ ...body, access_token: '***' }), // journal lisible par l'API : jamais le jeton
        httpStatus: e.response?.status,
        response: e.response?.data
          ? JSON.stringify(e.response.data)
          : e.message || 'Facebook CAPI postback failed',
      };
    }
  }
}
