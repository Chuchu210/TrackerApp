-- AlterTable: per-click paid cost captured from the traffic-source cost macro
ALTER TABLE "clicks" ADD COLUMN "cost" DOUBLE PRECISION;
