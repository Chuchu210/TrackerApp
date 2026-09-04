import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class CreateAffiliateNetworkDto {
  @IsString()
  name: string;

  @IsString()
  slug: string;

  /** Query parameter the network appends our click id to (e.g. `subid`). */
  @IsOptional()
  @IsString()
  clickIdParam?: string;

  /** Macro the network substitutes, e.g. `{subid}` or `#SUBID#`. */
  @IsOptional()
  @IsString()
  clickIdToken?: string;

  @IsOptional()
  @IsString()
  payoutToken?: string;

  @IsOptional()
  @IsString()
  transactionIdToken?: string;

  @IsOptional()
  @IsString()
  eventTypeToken?: string;

  @IsOptional()
  @IsString()
  defaultCurrency?: string;

  @IsOptional()
  @IsString()
  postbackUrlTemplate?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateAffiliateNetworkDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsString()
  clickIdParam?: string;

  @IsOptional()
  @IsString()
  clickIdToken?: string | null;

  @IsOptional()
  @IsString()
  payoutToken?: string | null;

  @IsOptional()
  @IsString()
  transactionIdToken?: string | null;

  @IsOptional()
  @IsString()
  eventTypeToken?: string | null;

  @IsOptional()
  @IsString()
  defaultCurrency?: string;

  @IsOptional()
  @IsString()
  postbackUrlTemplate?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
