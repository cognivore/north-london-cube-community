#!/usr/bin/env bash
#
# Hourly Cubehall DB backup. Invoked from cron:
#   0 * * * * /opt/cubehall/backup.sh
#
# Lives in the repo (so a deploy can't delete it — the previous backup.sh was
# NOT in the repo and got removed by an rsync --delete deploy ~2026-05-09,
# which is why backups silently stopped). Writes consistent snapshots to
# backups/{hourly,daily} and prunes old ones. The data dir is chattr +i
# immutable, but backups/ is writable, so this works without touching the lock.
set -euo pipefail

ROOT="/opt/cubehall"
DB="$ROOT/data/cubehall.db"
HOURLY="$ROOT/backups/hourly"
DAILY="$ROOT/backups/daily"
KEEP_HOURLY=48      # 2 days of hourly
KEEP_DAILY=30       # 30 days of daily

mkdir -p "$HOURLY" "$DAILY"
[ -f "$DB" ] || { echo "backup: no db at $DB" >&2; exit 1; }

ts="$(date +%Y%m%d-%H%M%S)"
day="$(date +%Y%m%d)"

# Consistent snapshot via sqlite3 .backup (read-only on source; falls back to
# cp if sqlite3 is unavailable). .backup creates its temp in the TARGET dir,
# which is writable — so the immutable data/ dir is not involved.
snap="$HOURLY/cubehall-$ts.db"
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB" ".backup '$snap'"
else
  cp "$DB" "$snap"
fi

# One daily copy (first backup of the day wins; later ones overwrite so the
# daily reflects the latest state of the day).
cp -f "$snap" "$DAILY/cubehall-$day.db"

# Prune
ls -1t "$HOURLY"/cubehall-*.db 2>/dev/null | tail -n +$((KEEP_HOURLY + 1)) | xargs -r rm -f
ls -1t "$DAILY"/cubehall-*.db  2>/dev/null | tail -n +$((KEEP_DAILY + 1))  | xargs -r rm -f

echo "backup: wrote $snap"
