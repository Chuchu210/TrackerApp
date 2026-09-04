-- Link a path variant to a catalog offer.
-- Nullable and ON DELETE SET NULL, so every existing variant keeps working
-- exactly as before (offer_id stays NULL = plain destination URL).

-- AlterTable
ALTER TABLE "path_variants" ADD COLUMN "offer_id" TEXT;

-- CreateIndex
CREATE INDEX "path_variants_offer_id_idx" ON "path_variants"("offer_id");

-- AddForeignKey
ALTER TABLE "path_variants" ADD CONSTRAINT "path_variants_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
