-- Offer catalog + affiliate networks.
-- Ported from the newer tracker module without its Voluum sync columns
-- (voluum_offer_id / voluum_synced_at / voluum_* on networks) and without
-- path_offers, since campaign paths already rotate destinations through
-- path_variants here.

-- CreateTable
CREATE TABLE "affiliate_networks" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "click_id_param" TEXT NOT NULL DEFAULT 'subid',
    "click_id_token" TEXT,
    "payout_token" TEXT,
    "transaction_id_token" TEXT,
    "event_type_token" TEXT,
    "default_currency" TEXT NOT NULL DEFAULT 'EUR',
    "postback_url_template" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliate_networks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "payout" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "country" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "affiliate_network_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offer_clicks" (
    "id" TEXT NOT NULL,
    "click_id" TEXT NOT NULL,
    "offer_id" TEXT NOT NULL,
    "campaign_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offer_clicks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_networks_slug_key" ON "affiliate_networks"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "offers_slug_key" ON "offers"("slug");

-- CreateIndex
CREATE INDEX "offers_name_idx" ON "offers"("name");

-- CreateIndex
CREATE INDEX "offers_updated_at_idx" ON "offers"("updated_at");

-- CreateIndex
CREATE INDEX "offer_clicks_click_id_idx" ON "offer_clicks"("click_id");

-- CreateIndex
CREATE INDEX "offer_clicks_offer_id_idx" ON "offer_clicks"("offer_id");

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_affiliate_network_id_fkey" FOREIGN KEY ("affiliate_network_id") REFERENCES "affiliate_networks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_clicks" ADD CONSTRAINT "offer_clicks_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
