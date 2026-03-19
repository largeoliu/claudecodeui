#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -n "${NVM_DIR:-}" ] && [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh"
elif [ -s "$HOME/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh"
fi

PM2_BIN="${PM2_BIN:-$(command -v pm2 || true)}"

if [ -z "$PM2_BIN" ] && [ -x "$HOME/.nvm/versions/node/v22.22.0/bin/pm2" ]; then
  PM2_BIN="$HOME/.nvm/versions/node/v22.22.0/bin/pm2"
fi

if [ -z "$PM2_BIN" ]; then
  echo "[deploy] error: pm2 not found in PATH or known nvm location" >&2
  exit 1
fi

echo "[deploy] start $(date '+%F %T')"
cd "$APP_DIR"

npm ci --include=dev
npm run build
"$PM2_BIN" startOrRestart ecosystem.config.cjs --update-env
"$PM2_BIN" save

echo "[deploy] done  $(date '+%F %T')"
