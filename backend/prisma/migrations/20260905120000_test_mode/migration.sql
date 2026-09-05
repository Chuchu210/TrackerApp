-- Global test mode. While it is on, ingestion stamps clicks and conversions as
-- test rows and every report filters them out by default, so the pipeline
-- (routing, postbacks, Meta/OpenAI CAPI) can be exercised end-to-end without
-- moving a number a human reads.

-- AlterTable
ALTER TABLE "app_settings" ADD COLUMN "test_mode" BOOLEAN;

-- AlterTable
ALTER TABLE "clicks" ADD COLUMN "is_test" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "conversions" ADD COLUMN "is_test" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "clicks_is_test_idx" ON "clicks"("is_test");

-- CreateIndex
CREATE INDEX "conversions_is_test_idx" ON "conversions"("is_test");
