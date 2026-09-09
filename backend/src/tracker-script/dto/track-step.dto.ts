import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class TrackStepDto {
  @IsString()
  clickId!: string;

  /** Sort order within the funnel (1 = first step after landing). */
  @IsInt()
  @Min(0)
  stepIndex!: number;

  /** Stable grouping key, e.g. "q1". */
  @IsString()
  @MaxLength(100)
  stepKey!: string;

  /** Human label shown in reports, e.g. "Question 2 — budget". */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  stepLabel?: string;
}
