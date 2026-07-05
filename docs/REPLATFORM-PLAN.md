# Batch 9 — Infra: what shipped, and the plan for what didn't

Batch 9 covered "scale + team + ops." Two of its pieces are **safe, additive
app features** and were built and tested. Two are **architecture changes that
would destabilize the live Postgres/single-tenant system** if done blind, so
they are specified here as a plan rather than force-merged into a running
tracker. This is a deliberate engineering decision, not an omission.

## Shipped in Batch 9

1. **Referrer-hiding redirect modes** — per-campaign `redirectMode`
   (`http_302` | `meta_refresh` | `double_meta`). `meta_refresh`/`double_meta`
   return a `no-referrer` HTML page instead of a `Location` header so the offer
   never sees the tracker/LP referrer. Backward compatible (default `http_302`).
2. **Scheduled data export** — a daily cron (`ScheduledExportService`) that
   writes a conversions CSV to `EXPORT_DIR` and/or POSTs it to
   `EXPORT_WEBHOOK_URL` (S3/BigQuery ingestion, data lake). Disabled until
   `EXPORT_ENABLED=true`.

## Deferred (needs a maintenance window + your sign-off)

### A. Columnar storage / ClickHouse for scale

**Why not done blind:** this swaps the reporting datastore under a system
currently serving live traffic. It cannot be validated in a dev checkout with
no ClickHouse instance, and a wrong cutover loses or double-counts click data.

**Recommended path (incremental, low-risk first):**
1. **Now / cheap:** add a Postgres rollup table `click_rollup_hourly`
   (campaign_id, hour, country, device, visits, bots, conversions, revenue_base,
   cost) populated by an hourly cron. Point the heavy dashboard aggregations at
   the rollup; keep raw `clicks` for drill-down. This alone buys ~10–50x on
   reporting load with zero new infra. (Schema + cron are a ~1 day add and are
   the natural next step — the aggregation SQL mirrors the existing
   `campaign-report` timeseries.)
2. **When raw click volume itself hurts (>~50–100M rows):** dual-write clicks to
   ClickHouse (`MergeTree`, partition by day, order by
   `(campaign_id, created_at)`), backfill history, move reporting reads over
   behind a `REPORTING_BACKEND` flag, then retire the Postgres reporting path.
   Keep Postgres as the source of truth for campaigns/config.
3. Cutover during a low-traffic window with the click redirect (the only
   real-time-critical path) untouched — it writes to Postgres regardless.

### B. Multi-user / RBAC / workspaces

**Why not done blind:** true multi-tenancy means every query is scoped by
workspace and every endpoint is role-gated. Bolting that on incrementally
risks a data-leak (one client seeing another's campaigns) or locking out the
live admin. The current auth is a NextAuth Google email allowlist — safe but
single-tenant.

**Recommended path:**
1. Add `User` (id, email, role: `owner|admin|media_buyer|viewer`, workspaceId)
   and `Workspace` models. Seed the existing allowlisted email as an `owner`.
2. Replace the NextAuth `signIn` allowlist check with a `User` lookup; put role
   in the session token. Keep the allowlist env as the bootstrap for the first
   owner.
3. Add a `@Roles()` guard on write/destructive endpoints (campaign delete,
   postback config, rules) — read endpoints stay open to all authed users
   first, then tighten.
4. **Only then** add `workspaceId` scoping to Campaign and cascade it into
   queries — this is the invasive step and should ship on its own behind tests
   that prove cross-workspace isolation.

Each of A and B is its own reviewed change with a migration + a rollback plan,
not part of the app-feature batches. Say the word and I'll start with the
Postgres rollup table (A.1) — it's the highest scale-per-risk win.
