#!/usr/bin/env bash
# Database backup with rotation.
# Keeps 48 hourly snapshots + 7 daily snapshots.
#
# Install into crontab:
#   0 * * * * /opt/cubehall/packages/server/scripts/backup.sh
#
# Or if deployed to /opt/cubehall with the script copied:
#   0 * * * * /opt/cubehall/backup.sh

set -euo pipefail

DB="${DATA_DIR:-/opt/cubehall/data}/cubehall.db"
BACKUP_DIR="${BACKUP_DIR:-/opt/cubehall/backups}"
HOURLY_DIR="$BACKUP_DIR/hourly"
DAILY_DIR="$BACKUP_DIR/daily"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

mkdir -p "$HOURLY_DIR" "$DAILY_DIR"

# Hourly snapshot
cp "$DB" "$HOURLY_DIR/cubehall-$TIMESTAMP.db"

# Keep only last 48 hourly snapshots
ls -1t "$HOURLY_DIR"/cubehall-*.db 2>/dev/null | tail -n +49 | xargs -r rm --

# Daily snapshot (once per day, keyed by date)
TODAY=$(date +%Y%m%d)
if [ ! -f "$DAILY_DIR/cubehall-$TODAY.db" ]; then
  cp "$DB" "$DAILY_DIR/cubehall-$TODAY.db"
fi

# Keep only last 7 daily snapshots
ls -1t "$DAILY_DIR"/cubehall-*.db 2>/dev/null | tail -n +8 | xargs -r rm --
