import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsArray,
  IsEnum,
  IsUrl,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PathVariantKind } from '@prisma/client';

export class PathConditionDto {
  @IsString()
  dimension: string;

  @IsString()
  operator: string;

  @IsArray()
  @IsString({ each: true })
  values: string[];
}

export class CreatePathDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  weight?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PathConditionDto)
  conditions?: PathConditionDto[];

  @IsOptional()
  @IsUrl({ require_tld: false })
  destinationUrl?: string;
}

export class UpdatePathDto extends CreatePathDto {}

export class CreateVariantDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsEnum(PathVariantKind)
  kind?: PathVariantKind;

  @IsUrl({ require_tld: false })
  destinationUrl: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  weight?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateVariantDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsEnum(PathVariantKind)
  kind?: PathVariantKind;

  @IsOptional()
  @IsUrl({ require_tld: false })
  destinationUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  weight?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
