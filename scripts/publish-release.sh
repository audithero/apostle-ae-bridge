#!/bin/bash
# Publish a release to the update server (R2 bucket apostle-ae-bridge-updates,
# served at https://updates.apostle.io/ae-bridge/).
#
#   scripts/publish-release.sh beta   "What changed, in a sentence or two"
#   scripts/publish-release.sh stable "What changed"
#
# Version comes from APOSTLE_VERSION (bump it and commit first). Beta versions
# should carry a prerelease tag (2.21.0-beta.1); stable versions must not.
# Steps: refuse a dirty tree or an already-published version, build the
# package (scripts/package-release.sh, with all its gates), sign the manifest
# with the key in the Keychain (service apostle-ae-bridge-release-signing),
# upload the zip, then the channel manifest. A stable release also moves the
# beta channel forward if beta is behind it, and refreshes the stable
# first-install link: https://updates.apostle.io/ae-bridge/download/Apostle-AE-Bridge.zip
set -euo pipefail

CHANNEL="${1:?usage: publish-release.sh <stable|beta> \"notes\"}"
NOTES="${2:-}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
BUCKET="apostle-ae-bridge-updates"
PREFIX="ae-bridge"
BASE="https://updates.apostle.io/$PREFIX"
WRANGLER=(npx -y wrangler@4)

cd "$REPO"
VERSION="$(tr -d ' \n' < APOSTLE_VERSION)"
case "$CHANNEL" in
  stable) [[ "$VERSION" != *-* ]] || { echo "stable releases can't be prereleases ($VERSION)" >&2; exit 1; } ;;
  beta) ;;
  *) echo "channel must be stable or beta" >&2; exit 1 ;;
esac
[ -z "$(git status --porcelain -- . ':!dist')" ] || { echo "commit first: the package is built from HEAD" >&2; exit 1; }

ZIPKEY="$PREFIX/releases/$VERSION/Apostle-AE-Bridge-$VERSION.zip"
# Probe with a unique query string: Cloudflare caches a 404 for the plain URL,
# and a probe of the real address before upload poisoned it for minutes (2.20.0).
if curl -fsI "$BASE/releases/$VERSION/Apostle-AE-Bridge-$VERSION.zip?probe=$(date +%s)$RANDOM" >/dev/null 2>&1; then
  echo "$VERSION is already published. Bump APOSTLE_VERSION." >&2; exit 1
fi

RELEASE_CHANNEL="$CHANNEL" scripts/package-release.sh
ZIP="$REPO/dist/Apostle-AE-Bridge-$VERSION.zip"
[ -f "$ZIP" ] || { echo "package did not produce $ZIP" >&2; exit 1; }

PRIV="$(security find-generic-password -s apostle-ae-bridge-release-signing -w)" ||
  { echo "release signing key not found in the Keychain" >&2; exit 1; }

sign() { # sign <channel> -> manifest JSON on stdout
  APOSTLE_RELEASE_KEY="$PRIV" node -e '
    const u = require(process.argv[1]); const fs = require("fs"); const crypto = require("crypto");
    const [, channel, version, zip, zipPath, notes, repo] = process.argv.slice(1);
    const buf = fs.readFileSync(zip);
    const payload = { product: u.PRODUCT, channel, version, path: zipPath, size: buf.length,
      sha256: crypto.createHash("sha256").update(buf).digest("hex"), notes, released: new Date().toISOString() };
    const m = u.signManifest(payload, process.env.APOSTLE_RELEASE_KEY);
    // self-check against the public key the installs carry
    u.verifyManifest(m, u.publicKeyFrom(repo), channel);
    process.stdout.write(JSON.stringify(m));
  ' "$REPO/scripts/lib/updater.cjs" "$1" "$VERSION" "$ZIP" "releases/$VERSION/Apostle-AE-Bridge-$VERSION.zip" "$NOTES" "$REPO"
}

put() { # put <local file> <key> <content-type> <cache-control>
  "${WRANGLER[@]}" r2 object put "$BUCKET/$2" --file "$1" --content-type "$3" --cache-control "$4" --remote >/dev/null
  echo "  uploaded $2"
}

TMP="$REPO/dist/.publish"; rm -rf "$TMP"; mkdir -p "$TMP"
echo "publishing $VERSION to $CHANNEL"
put "$ZIP" "$ZIPKEY" application/zip "public, max-age=31536000, immutable"
sign "$CHANNEL" > "$TMP/$CHANNEL.json"
put "$TMP/$CHANNEL.json" "$PREFIX/channels/$CHANNEL/latest.json" application/json "no-cache, max-age=0"

if [ "$CHANNEL" = stable ]; then
  BETA_NOW="$(curl -fs "$BASE/channels/beta/latest.json" | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{ try { console.log(JSON.parse(Buffer.from(JSON.parse(s).payload,"base64")).version) } catch(e) { console.log("") } })' || true)"
  if [ -z "$BETA_NOW" ] || node -e 'const u=require(process.argv[1]); process.exit(u.compareVersions(process.argv[2], process.argv[3]) < 0 ? 0 : 1)' "$REPO/scripts/lib/updater.cjs" "$BETA_NOW" "$VERSION"; then
    sign beta > "$TMP/beta.json"
    put "$TMP/beta.json" "$PREFIX/channels/beta/latest.json" application/json "no-cache, max-age=0"
  fi
  put "$ZIP" "$PREFIX/download/Apostle-AE-Bridge.zip" application/zip "no-cache, max-age=0"
  # The installer app embeds this release. Only a notarized DMG is published:
  # an un-notarized one makes macOS warn on every other Mac.
  if installer/build.sh "$ZIP" | tee "$TMP/installer.log" | grep -q "notarized: yes"; then
    DMG="$REPO/installer/build-out/Apostle-Installer-$VERSION.dmg"
    put "$DMG" "$PREFIX/releases/$VERSION/Apostle-Installer-$VERSION.dmg" application/x-apple-diskimage "public, max-age=31536000, immutable"
    put "$DMG" "$PREFIX/download/Apostle-Installer.dmg" application/x-apple-diskimage "no-cache, max-age=0"
  else
    echo "  installer NOT published: not notarized (see installer/README.md)" >&2
  fi
fi
rm -rf "$TMP"

# the zip must be reachable at the address installs will use
curl -fsI "$BASE/releases/$VERSION/Apostle-AE-Bridge-$VERSION.zip" >/dev/null ||
  echo "WARNING: $BASE/releases/$VERSION/... is not reachable yet (edge cache?); re-check before announcing" >&2

# what an install will actually see
curl -fs "$BASE/channels/$CHANNEL/latest.json" | node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{ const u=require(process.argv[1]);
  const p=u.verifyManifest(JSON.parse(s), u.publicKeyFrom(process.argv[2]), process.argv[3]);
  console.log("live: " + p.channel + " -> " + p.version + " (" + p.size + " bytes, signature ok)") })' "$REPO/scripts/lib/updater.cjs" "$REPO" "$CHANNEL"

git tag -f "apostle-v$VERSION" >/dev/null && git push -q -f origin "apostle-v$VERSION" && echo "tagged apostle-v$VERSION"
