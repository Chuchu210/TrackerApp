-- A tracker campaign can be fed by several platform campaigns (device and
-- placement splits, copies). The old unique on (campaign_id, platform) forced
-- 1:1, so auto-mapping overwrote earlier matches and syncConnection then
-- dropped every spend row whose external id was no longer mapped — silently
-- under-reporting cost, and therefore overstating profit and ROI.

-- DropIndex
DROP INDEX IF EXISTS "campaign_platform_mappings_platform_external_campaign_id_idx";

-- AlterTable: replace the 1:1 constraint with one per external campaign
ALTER TABLE "campaign_platform_mappings"
  DROP CONSTRAINT IF EXISTS "campaign_platform_mappings_campaign_id_platform_key";

-- CreateIndex
CREATE UNIQUE INDEX "campaign_platform_mappings_platform_external_campaign_id_key"
  ON "campaign_platform_mappings"("platform", "external_campaign_id");

-- CreateIndex
CREATE INDEX "campaign_platform_mappings_campaign_id_idx"
  ON "campaign_platform_mappings"("campaign_id");
