-- Media-buying machine reads (buyer outcomes, per-ad and per-offer facts).
--
-- One index per migration, built CONCURRENTLY: `prisma migrate deploy` runs while the previous tracker
-- process still serves clicks, and a plain CREATE INDEX would block inserts into clicks for the whole build.
-- Postgres refuses CONCURRENTLY inside a transaction block, so each file holds this single statement.
-- After deploy, check that the index is valid (IF NOT EXISTS silently keeps an INVALID one):
--   SELECT indexrelid::regclass, indisvalid FROM pg_index WHERE NOT indisvalid;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "clicks_offer_id_created_at_idx" ON "clicks"("offer_id", "created_at");
