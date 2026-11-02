#!/bin/bash
# Copy a release over an install. Used by Install.command (first install and
# manual updates) and by the in-panel updater, always from the NEW release, so
# each release decides how it lays itself down.
#   app folders      replaced exactly (files a release dropped are removed)
#   top-level files  overwritten
#   brands/ briefs/  only files the install doesn't have yet: a user's edits
#                    (even to the demo kit) are never overwritten
#   .apostle-runs/ .env   never touched
# Usage: apply-update.sh <release-dir> <install-dir>
set -euo pipefail
SRC="${1:?release dir}"; DEST="${2:?install dir}"
[ -f "$SRC/release.json" ] || { echo "not a release: $SRC" >&2; exit 1; }
[ "$(cd "$SRC" && pwd)" != "$(cd "$DEST" 2>/dev/null && pwd || echo none)" ] || exit 0
mkdir -p "$DEST"

APP_DIRS="apostle apostle-panel build node_modules prompts scripts docs .claude"
for d in $APP_DIRS; do
  [ -d "$SRC/$d" ] || continue
  mkdir -p "$DEST/$d"
  rsync -a --checksum --delete "$SRC/$d/" "$DEST/$d/"
done
for d in brands briefs; do
  [ -d "$SRC/$d" ] || continue
  mkdir -p "$DEST/$d"
  rsync -a --ignore-existing "$SRC/$d/" "$DEST/$d/"
done
# top-level files only (directories handled above); release.json goes last so
# an interrupted copy never claims the new version
rsync -a --checksum --exclude='*/' --exclude='.env' --exclude='release.json' "$SRC/" "$DEST/"
cp "$SRC/release.json" "$DEST/release.json"

xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true
chmod +x "$DEST"/*.command "$DEST"/scripts/*.sh 2>/dev/null || true
echo "applied $(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$DEST/release.json") to $DEST"
