import { Click, Conversion, ConversionMethod, PostbackConfig } from '@prisma/client';
import type { ParamMapping } from '../../shared/tracking/param-mapping';

export interface PostbackResult {
  success: boolean;
  method: string;
  url: string;
  requestBody?: string;
  httpStatus?: number;
  response?: string;
}

export type CampaignPostbackContext = {
  trafficSourceProfile?: {
    conversionMethod: ConversionMethod;
    postbackDefaults: unknown;
    paramMappings?: ParamMapping[];
  } | null;
  campaign?: {
    id: string;
    name: string;
    externalId?: string | null;
    /** Landing page URL — used as `source_url` for OpenAI Ads web events. */
    destinationUrl?: string | null;
  };
};

export interface PostbackStrategy {
  getNetwork(): string;
  canHandle(config: PostbackConfig, campaign?: CampaignPostbackContext): boolean;
  send(
    click: Click,
    conversion: Conversion,
    config: PostbackConfig,
    campaign?: CampaignPostbackContext,
  ): Promise<PostbackResult>;
}
