-- Speeds up the per-IP click-velocity count in ClicksService.evaluateVelocity
-- (fraud detection), which filters on ip_address + created_at on every
-- non-private click. Without this index that COUNT scans the clicks table.
--
-- Note: on a very large clicks table, prefer applying this out-of-band with
-- CREATE INDEX CONCURRENTLY (cannot run inside Prisma's migration transaction)
-- and then `prisma migrate resolve --applied 20260808120000_click_ip_velocity_index`.
-- CreateIndex
CREATE INDEX "clicks_ip_address_created_at_idx" ON "clicks"("ip_address", "created_at");
