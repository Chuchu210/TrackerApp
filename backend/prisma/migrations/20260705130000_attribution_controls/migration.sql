-- AlterTable: per-campaign attribution window + conversion cap
ALTER TABLE "campaigns" ADD COLUMN "attribution_window_hours" INTEGER;
ALTER TABLE "campaigns" ADD COLUMN "max_conversions_per_click" INTEGER;
