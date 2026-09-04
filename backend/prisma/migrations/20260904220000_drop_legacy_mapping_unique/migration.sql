-- Finishes 20260904210000_mapping_many_to_one.
-- That migration tried DROP CONSTRAINT IF EXISTS, but Prisma materialises
-- @@unique as a unique *index*, not a table constraint, so the IF EXISTS made
-- it a silent no-op and the old 1:1 rule stayed in force — auto-mapping kept
-- overwriting and spend kept being dropped.

-- DropIndex
DROP INDEX IF EXISTS "campaign_platform_mappings_campaign_id_platform_key";
