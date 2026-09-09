-- Cache of Meta Marketing API creative specs (image / headline / CTA) keyed
-- by ad_id. Clicks only carry the id; reports need the actual asset.

CREATE TABLE "meta_ad_creatives" (
    "id" TEXT NOT NULL,
    "ad_id" TEXT NOT NULL,
    "ad_name" TEXT,
    "headline" TEXT,
    "body" TEXT,
    "cta" TEXT,
    "image_url" TEXT,
    "thumbnail_url" TEXT,
    "fetched_at" TIMESTAMP(3) NOT NULL,
    "last_error" TEXT,
    "raw" JSONB,

    CONSTRAINT "meta_ad_creatives_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "meta_ad_creatives_ad_id_key" ON "meta_ad_creatives"("ad_id");
CREATE INDEX "meta_ad_creatives_fetched_at_idx" ON "meta_ad_creatives"("fetched_at");
