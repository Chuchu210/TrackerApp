import { IsString, IsOptional, IsObject, IsBoolean } from 'class-validator';

export class DirectVisitDto {
  @IsString()
  campaign: string;

  @IsOptional()
  @IsObject()
  params?: Record<string, string>;

  @IsOptional()
  @IsString()
  visitorId?: string;

  /** LP script data-no-viewcontent — skip Mediago viewcontent (optimize for click_button). */
  @IsOptional()
  @IsBoolean()
  noViewContent?: boolean;

  /** LP script data-lp-id — which landing page registered this visit. */
  @IsOptional()
  @IsString()
  lpId?: string;

  /** LP script data-lp-name — human label for the lander report. */
  @IsOptional()
  @IsString()
  lpName?: string;
}
