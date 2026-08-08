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
if curl -sf http://127.0.0.1:3001/health >/dev/null; then
  echo "== api health OK =="
else
  echo "== api health FAIL ==" >&2
  exit 1
fi
