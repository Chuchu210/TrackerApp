-- CreateEnum
CREATE TYPE "PathVariantKind" AS ENUM ('offer', 'lander');

-- AlterTable: attribute clicks to the chosen rotation variant
ALTER TABLE "clicks" ADD COLUMN "variant_id" TEXT;

-- CreateTable
CREATE TABLE "campaign_paths" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Path',
    "weight" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "destination_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_paths_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "path_variants" (
    "id" TEXT NOT NULL,
    "path_id" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'Variant',
    "kind" "PathVariantKind" NOT NULL DEFAULT 'offer',
    "destination_url" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "is_winner" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "path_variants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaign_paths_campaign_id_active_idx" ON "campaign_paths"("campaign_id", "active");

-- CreateIndex
CREATE INDEX "path_variants_path_id_active_idx" ON "path_variants"("path_id", "active");

-- AddForeignKey
ALTER TABLE "campaign_paths" ADD CONSTRAINT "campaign_paths_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "path_variants" ADD CONSTRAINT "path_variants_path_id_fkey" FOREIGN KEY ("path_id") REFERENCES "campaign_paths"("id") ON DELETE CASCADE ON UPDATE CASCADE;
