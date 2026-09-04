-- Postback delivery bookkeeping.
-- Until now a conversion whose postback failed was only retried by hand from
-- the admin, and a strategy that threw left the row in `pending` forever with
-- no log at all — silent revenue loss on the path that pays.

-- AlterTable
ALTER TABLE "conversions"
  ADD COLUMN "postback_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_postback_at" TIMESTAMP(3);

-- CreateIndex: the sweeper scans unfinished deliveries by age.
CREATE INDEX "conversions_status_last_postback_at_idx" ON "conversions"("status", "last_postback_at");
