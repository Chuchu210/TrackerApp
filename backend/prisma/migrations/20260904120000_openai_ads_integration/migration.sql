-- OpenAI Ads integration: Conversions API postbacks + click attribution.
-- Safe in a transaction on PostgreSQL 12+ (prod runs 16): the new enum values
-- are added here but not used until a later statement/migration.

-- AlterEnum
ALTER TYPE "PostbackNetwork" ADD VALUE 'openai';

-- AlterEnum
ALTER TYPE "ConversionMethod" ADD VALUE 'openai_capi';

-- AlterTable: per-campaign OpenAI Ads credentials
ALTER TABLE "postback_configs"
  ADD COLUMN "openai_pixel_id" TEXT,
  ADD COLUMN "openai_api_key" TEXT,
  ADD COLUMN "openai_enabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: OpenAI Ads click attribution identifiers.
-- `oppref` comes from the landing-page URL, `obref` from the __obref cookie;
-- the Conversions API does not capture either for us, so we persist them on
-- the click and replay them with the conversion.
ALTER TABLE "clicks"
  ADD COLUMN "oppref" TEXT,
  ADD COLUMN "obref" TEXT;
