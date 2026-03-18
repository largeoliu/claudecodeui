#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "[deploy] start $(date '+%F %T')"
cd "$APP_DIR"

npm ci --include=dev
npm run build
pm2 startOrRestart ecosystem.config.cjs --update-env
pm2 save

echo "[deploy] done  $(date '+%F %T')"
