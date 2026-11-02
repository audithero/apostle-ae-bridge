#!/bin/bash
# Build the shareable zip: a clean copy of the engine (committed HEAD only),
# with client material, third-party plugins, tests and git history removed,
# the neutral demo content from release/overlay/ laid over it, the installer
# scripts at the top, the server prebuilt and production node_modules bundled
# (so the recipient needs Node.js, but never npm or a compiler).
#
# Usage: scripts/package-release.sh [out-dir]     (default: <repo>/dist)
# Refuses to package if any client name survives in the output.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$REPO/dist}"
NAME="Apostle AE Bridge"
STAGE="$OUT/$NAME"
COMMIT="$(cd "$REPO" && git rev-parse --short HEAD)"
VERSION="$(tr -d ' \n' < "$REPO/APOSTLE_VERSION")"
CHANNEL="${RELEASE_CHANNEL:-stable}"
STAMP="$(date +%Y-%m-%d)"

if [ -n "$(cd "$REPO" && git status --porcelain -- . ':!dist' ':!release')" ]; then
  echo "note: uncommitted changes outside release/ are NOT packaged (git archive HEAD)" >&2
fi

rm -rf "$STAGE"
mkdir -p "$STAGE"
(cd "$REPO" && git archive HEAD) | tar -x -C "$STAGE"

# ---- remove: client material, third-party code we may not redistribute,
# tests/CI (they read client briefs), one-off client job scripts
cd "$STAGE"
rm -rf \
  briefs references tests .github release \
  brands/commbank*.json \
  apostle/demo-beats-redeem.json \
  prompts/compile/examples/instructional-cba-migrant.json \
  scripts/build-video.jsx scripts/make-video.py scripts/restore-after-restart.jsx \
  scripts/v1-insert-rba-beat.cjs scripts/apply-super-updates-v2.cjs \
  scripts/add-change-flags.jsx scripts/fix-blank-transits.jsx \
  docs/phase5-8-roadmap.md \
  apostle-panel/.debug scripts/package-release.sh scripts/publish-release.sh APOSTLE_VERSION .release-please-manifest.json release-please-config.json vitest.config.ts eslint.config.js \
  CONTRIBUTING.md CODE_OF_CONDUCT.md badge-ar.svg README.ar.md \
  .githooks .git-blame-ignore-revs .gitattributes .npmignore .prettierignore .prettierrc.json .editorconfig

# ---- CLAUDE.md: keep the engineering notes, drop the client names
# (the repo copy keeps them; only the packaged copy is rewritten)
perl -0pi -e '
  s{prompts/compile/examples/instructional-cba-migrant\.json}{prompts/compile/examples/instructional-demo.json}g;
  s{briefs/commbank-yello/}{briefs/<client>/}g;
  s{CommBank Yello Video 8}{a client explainer}g;
  s{CommBank Yello}{a client series}g;
  s{the six CommBank specs}{six hand-timed client specs}g;
  s{the CommBank spec form}{the hand-timed spec form}g;
  s{CBA Migrant script}{client script}g;
  s{Measured on CBA Migrant}{Measured on a client onboarding film}g;
  s{CBA Beacon Sans}{a client font}g;
  s{CBA review pass}{Client review pass}g;
  s{\(v2\.18, CBA }{(v2.18, }g;
  s{CBA\x27s }{a client\x27s }g;
  s{\(CBA step}{(a client film\x27s step}g;
  s{On CBA this}{On a client film this}g;
  s{CommBank|CBA}{client}g;
  s{the volume has been renamed under us \(.*?\)\. Never hardcode it\.}{never hardcode it (external volumes get renamed when remounted).}g;
' CLAUDE.md

# ---- overlay: neutral demo content and scrubbed copies
cp -R "$REPO/release/overlay/." "$STAGE/"
cp "$REPO/release/Install.command" "$REPO/release/Check Setup.command" \
   "$REPO/release/Uninstall.command" "$REPO/release/START HERE.md" "$STAGE/"
chmod +x "$STAGE"/*.command "$STAGE"/scripts/*.sh

# ---- build the server and keep only runtime dependencies
npm ci --ignore-scripts --no-audit --no-fund --loglevel=error
npm run build --silent
npm prune --omit=dev --no-audit --no-fund --loglevel=error
rm -rf src tsconfig.json
node -e '
const p = require("./package.json");
delete p.scripts.prepare; delete p.scripts.prepack; delete p.devDependencies;
p.name = "apostle-ae-bridge"; p.description = "Claude Code drives After Effects: MCP server + Apostle panel.";
require("fs").writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n");'
# release.json: what the updater and Check Setup read
node -e 'require("fs").writeFileSync("release.json", JSON.stringify({ product: "apostle-ae-bridge",
  version: process.argv[1], channel: process.argv[2], commit: process.argv[3], built: process.argv[4] }, null, 2) + "\n")' \
  "$VERSION" "$CHANNEL" "$COMMIT" "$STAMP"

# ---- leak gate: no client names anywhere (file contents or names)
LEAKS="$(grep -rIilE 'commbank|\bcba\b|yello([^w]|$)|migrant|beacon ?sans' . --exclude-dir=node_modules || true)"
NAMES="$(find . -path ./node_modules -prune -o -print | grep -iE 'commbank|cba|yello|migrant' || true)"
if [ -n "$LEAKS$NAMES" ]; then
  echo "REFUSING: client names found in the package:" >&2
  echo "$LEAKS" "$NAMES" | tr ' ' '\n' | grep -v '^$' >&2
  exit 1
fi
MACHINE="$(grep -rIlE '/Volumes/Apostle|apostle_mbp|/Users/[a-z_]+/' . --exclude-dir=node_modules || true)"
[ -z "$MACHINE" ] || { echo "REFUSING: this Mac's paths found in: $MACHINE" >&2; exit 1; }
SECRETS="$(grep -rIlE '(sk-ant-|FAL_API_KEY=[A-Za-z0-9:_-]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,})' . --exclude-dir=node_modules || true)"
[ -z "$SECRETS" ] || { echo "REFUSING: possible secrets in: $SECRETS" >&2; exit 1; }

# ---- zip (ditto keeps the executable bits on the .command files)
cd "$OUT"
ZIP="$OUT/Apostle-AE-Bridge-$VERSION.zip"
rm -f "$ZIP"
ditto -c -k --keepParent --norsrc "$NAME" "$ZIP"
echo "packaged $VERSION -> $ZIP ($(du -h "$ZIP" | cut -f1))"
