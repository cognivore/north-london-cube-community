#!/usr/bin/env bash
#
# Refresh the VPN/datacenter/Tor IP range list used by the auth guard's soft
# proxy detection (packages/server/src/http/auth-guard.ts → isSuspectIp).
# Free, public lists; no API keys. Run from cron, e.g.:
#   17 4 * * * /opt/cubehall/scripts/refresh-vpn-ranges.sh
#
# Writes to /var/lib/cubehall/vpn-ranges.txt (writable, outside the deploy tree
# and the immutable data/ dir). If a source is unreachable it's skipped; if the
# whole run fails, the existing file (and detection) is left untouched. When the
# file is absent, the guard simply applies the base PoW difficulty to everyone.
set -uo pipefail

OUT="/var/lib/cubehall/vpn-ranges.txt"
TMP="$(mktemp)"
mkdir -p "$(dirname "$OUT")"

# X4BNet free VPN + datacenter CIDR lists (community-maintained).
SRCS=(
  "https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output/vpn/ipv4.txt"
  "https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output/datacenter/ipv4.txt"
)
# Tor exit nodes (the box already fetches these for Zulip; use the public list).
TOR="https://check.torproject.org/torbulkexitlist"

for url in "${SRCS[@]}"; do
  curl -fsS --max-time 30 "$url" 2>/dev/null >> "$TMP" || echo "# skip $url" >> "$TMP"
done
# Tor list is bare IPs → append /32
curl -fsS --max-time 30 "$TOR" 2>/dev/null | sed -E 's#$#/32#' >> "$TMP" || true

# Keep only valid CIDR/IPv4 lines; dedupe.
grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+(/[0-9]+)?$' "$TMP" | sort -u > "$TMP.clean" || true

n="$(wc -l < "$TMP.clean" 2>/dev/null || echo 0)"
if [ "$n" -lt 1000 ]; then
  echo "refresh-vpn-ranges: only $n ranges fetched; keeping existing $OUT" >&2
  rm -f "$TMP" "$TMP.clean"
  exit 0
fi
mv "$TMP.clean" "$OUT"
rm -f "$TMP"
echo "refresh-vpn-ranges: wrote $n ranges to $OUT"
