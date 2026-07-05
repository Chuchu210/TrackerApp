-- CreateEnum
CREATE TYPE "RedirectMode" AS ENUM ('http_302', 'meta_refresh', 'double_meta');

-- AlterTable: referrer-hiding redirect mode per campaign
ALTER TABLE "campaigns" ADD COLUMN "redirect_mode" "RedirectMode" NOT NULL DEFAULT 'http_302';
