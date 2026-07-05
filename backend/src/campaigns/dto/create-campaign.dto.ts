import { IsString, IsUrl, IsEnum, IsOptional, IsBoolean, IsNumber } from 'class-validator';
import { TrafficSource, TrackingMode, RedirectMode } from '@prisma/client';

export class CreateCampaignDto {
  @IsString()
  name: string;

  @IsString()
  slug: string;

  @IsOptional()
  @IsString()
  externalId?: string;

  @IsOptional()
  @IsEnum(TrafficSource)
  trafficSource?: TrafficSource;

  @IsOptional()
  @IsString()
  trafficSourceProfileId?: string;

  @IsOptional()
  @IsEnum(TrackingMode)
  trackingMode?: TrackingMode;

  @IsOptional()
  @IsEnum(RedirectMode)
  redirectMode?: RedirectMode;

  @IsOptional()
  @IsString()
  domainId?: string;

  @IsUrl({ require_tld: false })
  destinationUrl: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  workspaceName?: string;

  @IsOptional()
  @IsString()
  workspaceId?: string;

  @IsOptional()
  @IsString()
  trafficSourceId?: string;

  @IsOptional()
  @IsString()
  trafficSourceName?: string;

  @IsOptional()
  @IsString()
  landerId?: string;

  @IsOptional()
  @IsString()
  landerName?: string;

  @IsOptional()
  @IsString()
  offerId?: string;

  @IsOptional()
  @IsString()
  offerName?: string;

  @IsOptional()
  @IsString()
  affiliateNetwork?: string;

  @IsOptional()
  @IsString()
  affiliateNetworkId?: string;

  @IsOptional()
  @IsNumber()
  attributionWindowHours?: number;

  @IsOptional()
  @IsNumber()
  maxConversionsPerClick?: number;
}

export class UpdateCampaignDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsString()
  externalId?: string;

  @IsOptional()
  @IsEnum(TrafficSource)
  trafficSource?: TrafficSource;

  @IsOptional()
  @IsString()
  trafficSourceProfileId?: string;

  @IsOptional()
  @IsEnum(TrackingMode)
  trackingMode?: TrackingMode;

  @IsOptional()
  @IsEnum(RedirectMode)
  redirectMode?: RedirectMode;

  @IsOptional()
  @IsString()
  domainId?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  destinationUrl?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  workspaceName?: string;

  @IsOptional()
  @IsString()
  workspaceId?: string;

  @IsOptional()
  @IsString()
  trafficSourceId?: string;

  @IsOptional()
  @IsString()
  trafficSourceName?: string;

  @IsOptional()
  @IsString()
  landerId?: string;

  @IsOptional()
  @IsString()
  landerName?: string;

  @IsOptional()
  @IsString()
  offerId?: string;

  @IsOptional()
  @IsString()
  offerName?: string;

  @IsOptional()
  @IsString()
  affiliateNetwork?: string;

  @IsOptional()
  @IsString()
  affiliateNetworkId?: string;

  @IsOptional()
  @IsNumber()
  attributionWindowHours?: number;

  @IsOptional()
  @IsNumber()
  maxConversionsPerClick?: number;
}

export class UpdatePostbackConfigDto {
  @IsOptional()
  @IsNumber()
  mediagoConversionType?: number;

  @IsOptional()
  @IsBoolean()
  mediagoEnabled?: boolean;

  @IsOptional()
  @IsString()
  mediagoAccountName?: string;

  @IsOptional()
  @IsString()
  facebookPixelId?: string;

  @IsOptional()
  @IsString()
  facebookAccessToken?: string;

  @IsOptional()
  @IsBoolean()
  facebookEnabled?: boolean;

  @IsOptional()
  @IsString()
  googleConversionId?: string;

  @IsOptional()
  @IsString()
  googleConversionLabel?: string;

  @IsOptional()
  @IsString()
  googlePostbackUrl?: string;

  @IsOptional()
  @IsBoolean()
  googleEnabled?: boolean;

  @IsOptional()
  @IsString()
  postbackSecret?: string;
}
