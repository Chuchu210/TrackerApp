-- Periodic health probe for deployed landers.
-- Motivated by a real incident: CI reported successful deploys for weeks while
-- the live page kept serving a two-month-old build, because the rsync target
-- was not the directory nginx actually serves. A green deploy is not proof the
-- page is live and still carries the tracker.

-- CreateEnum
CREATE TYPE "LanderHealth" AS ENUM ('unknown', 'healthy', 'unreachable', 'tracker_missing');

-- AlterTable
ALTER TABLE "landers"
  ADD COLUMN "health_status" "LanderHealth" NOT NULL DEFAULT 'unknown',
  ADD COLUMN "health_checked_at" TIMESTAMP(3),
  ADD COLUMN "health_error" TEXT;
