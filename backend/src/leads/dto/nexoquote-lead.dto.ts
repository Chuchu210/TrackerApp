import { IsOptional, IsString, MaxLength } from 'class-validator';

export class NexoquoteLeadDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  timestamp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  zip?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  insured?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  q1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  vehicles?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  q2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  homeowner?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  q3?: string;
}
