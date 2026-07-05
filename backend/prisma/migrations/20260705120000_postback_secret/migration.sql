-- AlterTable: add per-campaign incoming-postback shared secret
ALTER TABLE "postback_configs" ADD COLUMN "postback_secret" TEXT;
