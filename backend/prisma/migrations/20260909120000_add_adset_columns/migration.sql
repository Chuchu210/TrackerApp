-- Meta (Facebook) adset granularity.
-- Until now a click had ad_id / campaign_external_id but no adset column at all,
-- so campaign > adset > ad reporting was impossible: adset only survived as a
-- fallback inside custom_variable_2, which loses to campaign_external_id whenever
-- a campaign id is present (see applyNativeParamFallbacks).
-- Both columns are nullable additions, so existing rows are untouched.

ALTER TABLE "clicks" ADD COLUMN "adset_id" TEXT;
ALTER TABLE "clicks" ADD COLUMN "adset_name" TEXT;

-- Creative-level reports group by adset like they do by publisher/platform.
CREATE INDEX "clicks_adset_id_idx" ON "clicks"("adset_id");
