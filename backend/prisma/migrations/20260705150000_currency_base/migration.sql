-- AlterTable: store revenue/cost normalized to the reporting base currency
ALTER TABLE "conversions" ADD COLUMN "revenue_base" DOUBLE PRECISION;
ALTER TABLE "conversions" ADD COLUMN "cost_base" DOUBLE PRECISION;
