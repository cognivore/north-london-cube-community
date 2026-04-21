#!/usr/bin/env bash
set -euo pipefail

HOST="root@chat.md110.se"
PROD="/opt/cubehall/"
STAGING="/opt/cubehall-staging/"

RSYNC_OPTS=(
  -az
  --delete
  --filter="merge .rsync-filter"
)

target="${1:-both}"

echo "Building..."
pnpm run build

if [[ "$target" == "staging" || "$target" == "both" ]]; then
  echo "Deploying to staging..."
  rsync "${RSYNC_OPTS[@]}" ./ "$HOST:$STAGING"
  ssh "$HOST" "cd $STAGING && pnpm install --frozen-lockfile"
  ssh "$HOST" "systemctl restart cubehall-staging-api cubehall-staging-web"
  echo "Staging deployed."
fi

if [[ "$target" == "prod" || "$target" == "both" ]]; then
  echo "Deploying to prod..."
  rsync "${RSYNC_OPTS[@]}" ./ "$HOST:$PROD"
  ssh "$HOST" "cd $PROD && pnpm install --frozen-lockfile"
  ssh "$HOST" "systemctl restart cubehall-api cubehall-web"
  echo "Prod deployed."
fi

echo "Done."
