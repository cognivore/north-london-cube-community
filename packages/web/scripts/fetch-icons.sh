#!/usr/bin/env bash
# fetch-icons.sh
#
# Downloads Mark James's famfamfam Silk icon set (CC BY 2.5)
# and installs it as static assets for Cubehall's web package.
#
# Mandated by docs/design/dci-aesthetic-brief.md §5.
#
# Idempotent: safe to run multiple times. Skips download if the
# target directory already contains 999 PNGs.
#
# Usage, from repo root:
#   packages/web/scripts/fetch-icons.sh
#
# Or from packages/web:
#   scripts/fetch-icons.sh
#
# Dependencies: curl, tar. Optionally ImageMagick (magick or convert)
# for favicon.ico generation. If not present, only favicon.png is
# generated.

set -euo pipefail

# Resolve script path so the command works from any CWD.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$(dirname "$SCRIPT_DIR")"
PUBLIC_DIR="$WEB_DIR/public"
ICONS_DIR="$PUBLIC_DIR/icons/silk"
LICENSE_FILE="$ICONS_DIR/LICENSE-SILK.txt"
FAVICON_ICO="$PUBLIC_DIR/favicon.ico"
FAVICON_PNG="$PUBLIC_DIR/favicon.png"
APPLE_TOUCH="$PUBLIC_DIR/apple-touch-icon.png"

UPSTREAM_TARBALLS=(
  "https://github.com/markjames/famfamfam-silk-icons/archive/refs/heads/master.tar.gz"
  "https://github.com/markjames/famfamfam-silk-icons/archive/refs/heads/main.tar.gz"
)

EXPECTED_COUNT=999

info()  { printf "\033[36m==>\033[0m %s\n" "$*"; }
warn()  { printf "\033[33m[warn]\033[0m %s\n" "$*" >&2; }
fatal() { printf "\033[31m[fatal]\033[0m %s\n" "$*" >&2; exit 1; }

check_deps() {
  command -v curl >/dev/null 2>&1 || fatal "curl not found"
  command -v tar  >/dev/null 2>&1 || fatal "tar not found"
}

already_installed() {
  [ -d "$ICONS_DIR" ] || return 1
  local count
  count="$(find "$ICONS_DIR" -maxdepth 1 -name '*.png' | wc -l | tr -d ' ')"
  [ "$count" -ge "$EXPECTED_COUNT" ]
}

download_and_extract() {
  local staging tarball url
  staging="$(mktemp -d)"
  trap 'rm -rf "$staging"' RETURN

  tarball="$staging/silk.tar.gz"
  for url in "${UPSTREAM_TARBALLS[@]}"; do
    info "Attempting: $url"
    if curl -fsSL --retry 2 --retry-delay 2 "$url" -o "$tarball"; then
      info "Downloaded $(du -h "$tarball" | cut -f1)"
      break
    fi
  done
  [ -s "$tarball" ] || fatal "could not download Silk icon tarball from any mirror"

  info "Extracting..."
  tar -xzf "$tarball" -C "$staging"

  # The extracted top-level folder is famfamfam-silk-icons-<branch>.
  local extracted
  extracted="$(find "$staging" -maxdepth 1 -type d -name 'famfamfam-silk-icons-*' | head -n1)"
  [ -n "$extracted" ] || fatal "unexpected archive layout"

  # The pack lives in /icons inside the repo.
  local src_icons="$extracted/icons"
  [ -d "$src_icons" ] || fatal "no 'icons' folder inside archive at $extracted"

  mkdir -p "$ICONS_DIR"
  cp "$src_icons"/*.png "$ICONS_DIR/"

  # License copy. The upstream readme.txt is the canonical licence text.
  if [ -f "$extracted/readme.txt" ]; then
    cp "$extracted/readme.txt" "$LICENSE_FILE"
  else
    cat > "$LICENSE_FILE" <<'EOF'
famfamfam Silk Icons
Created by Mark James <mjames@gmail.com>
https://famfamfam.com/lab/icons/silk/

Licensed under Creative Commons Attribution 2.5
https://creativecommons.org/licenses/by/2.5/

Attribution required: include a link back to
https://famfamfam.com/lab/icons/silk/ in your credits.
EOF
  fi

  info "Installed $(find "$ICONS_DIR" -maxdepth 1 -name '*.png' | wc -l | tr -d ' ') icons at $ICONS_DIR"
}

generate_favicons() {
  # Brief §5.6 mandates dice.png, but the standard Silk pack ships
  # without it. Fall back to bricks.png (the cube/draft concept icon
  # per §5.3) — conservative reading per the RULES preamble.
  local source="$ICONS_DIR/dice.png"
  if [ ! -f "$source" ]; then
    source="$ICONS_DIR/bricks.png"
    warn "dice.png not in pack — using bricks.png per §5.3 mapping"
  fi
  [ -f "$source" ] || fatal "neither dice.png nor bricks.png found in pack"

  cp "$source" "$FAVICON_PNG"
  info "Wrote $FAVICON_PNG"

  # ICO generation — prefer ImageMagick v7 (magick), fall back to v6 (convert).
  if command -v magick >/dev/null 2>&1; then
    magick "$source" "$FAVICON_ICO"
    info "Wrote $FAVICON_ICO (via magick)"
  elif command -v convert >/dev/null 2>&1; then
    convert "$source" "$FAVICON_ICO"
    info "Wrote $FAVICON_ICO (via convert)"
  else
    warn "ImageMagick not installed — favicon.ico not generated."
    warn "Browsers will fall back to /favicon.png. To generate the ICO:"
    warn "  nix-shell -p imagemagick --run '$SCRIPT_DIR/fetch-icons.sh'"
  fi

  # Apple touch icon: nearest-neighbour 180×180 upscale of dice.png.
  if command -v magick >/dev/null 2>&1; then
    magick "$source" -filter point -resize 180x180 "$APPLE_TOUCH"
    info "Wrote $APPLE_TOUCH (180×180 nearest-neighbour)"
  elif command -v convert >/dev/null 2>&1; then
    convert "$source" -filter point -resize 180x180 "$APPLE_TOUCH"
    info "Wrote $APPLE_TOUCH (180×180 nearest-neighbour)"
  fi
}

main() {
  check_deps
  if already_installed; then
    info "Silk icons already installed at $ICONS_DIR — refreshing favicons only."
  else
    download_and_extract
  fi
  generate_favicons
  info "Done."
}

main "$@"
