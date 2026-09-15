#!/usr/bin/env bash
# Server-side deploy step, invoked by .github/workflows/deploy.yml over SSH.
# The workflow has already run: git fetch origin main && git reset --hard
# origin/main, and passes the changed file list in $DEPLOY_CHANGED.
# Rebuilds only what changed so admin users don't hit ChunkLoadError on
# backend-only deploys.
set -euo pipefail

APP_DIR="/var/www/TrackerApp"
CHANGED="${DEPLOY_CHANGED:-all}"

changed() { [ "$CHANGED" = "all" ] || echo "$CHANGED" | grep -qE "$1"; }

if changed '^backend/'; then
  echo "== backend changed: install / migrate / build / restart =="
  cd "$APP_DIR/backend"
  npm ci
  npx prisma migrate deploy
  # Les index des migrations 2026091312* sont construits CONCURRENTLY : une construction interrompue laisse un index
  # INVALID que `IF NOT EXISTS` garde en silence. Alerte seulement (le déploiement continue) ; reprise :
  # DROP INDEX CONCURRENTLY IF EXISTS <nom>; puis npx prisma migrate resolve --rolled-back <migration>; puis redeploy.
  if command -v psql >/dev/null 2>&1 && [ -f .env ]; then
    invalid=$( (set -a; . ./.env; set +a; psql "${DATABASE_URL%%\?*}" -Atc "SELECT string_agg(indexrelid::regclass::text, ', ') FROM pg_index WHERE NOT indisvalid") 2>/dev/null || true)
    if [ -n "$invalid" ]; then
      echo "== WARNING: invalid index(es): $invalid ==" >&2
    fi
  fi
  npm run build
  pm2 restart tracker-api --update-env
else
  echo "== backend unchanged: skipped =="
fi

if changed '^admin/'; then
  echo "== admin changed: clean rebuild (avoids ChunkLoadError) =="
  cd "$APP_DIR/admin"
  rm -rf .next
  npm ci
  npm run build
  pm2 restart tracker-admin --update-env
else
  echo "== admin unchanged: skipped =="
fi

pm2 save

# PM2 returns as soon as the process is spawned, not once Nest has finished
# bootstrapping (module resolution, Prisma connect, app.listen) — so a curl
# right after `pm2 restart` can race a cold start and hit connection-refused.
# Retry for up to ~20s before failing the deploy.
echo "== waiting for api health =="
ok=0
for i in $(seq 1 10); do
  if curl -sf http://127.0.0.1:3001/health >/dev/null; then
    ok=1
    break
  fi
  sleep 2
done

if [ "$ok" = "1" ]; then
  echo "== api health OK =="
else
  echo "== api health FAIL (after ~20s) ==" >&2
  pm2 logs tracker-api --lines 40 --nostream || true
  exit 1
fi
