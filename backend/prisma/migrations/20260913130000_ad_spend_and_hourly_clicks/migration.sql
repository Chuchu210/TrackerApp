-- Spend per ad (media-buying machine creative facts) and clicks per hour
-- (traffic-window reads without scanning clicks). New tables only: no lock on
-- existing tables.

-- CreateTable
CREATE TABLE "ad_spend_snapshots" (
    "id" TEXT NOT NULL,
    "platform" "AdPlatform" NOT NULL,
    "external_ad_id" TEXT NOT NULL,
    "external_adset_id" TEXT,
    "external_campaign_id" TEXT,
    "date" DATE NOT NULL,
    "hour" INTEGER NOT NULL DEFAULT -1,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "spend" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_spend_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "click_hourly_counts" (
    "hour" TIMESTAMP(3) NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "click_hourly_counts_pkey" PRIMARY KEY ("hour")
);

-- CreateIndex
CREATE UNIQUE INDEX "ad_spend_snapshots_platform_external_ad_id_date_hour_key" ON "ad_spend_snapshots"("platform", "external_ad_id", "date", "hour");

-- CreateIndex
CREATE INDEX "ad_spend_snapshots_external_campaign_id_date_idx" ON "ad_spend_snapshots"("external_campaign_id", "date");
