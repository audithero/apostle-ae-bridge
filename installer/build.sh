#!/bin/bash
# Build "Apostle Installer.app" and "Apostle Installer.dmg" around a release zip.
#   installer/build.sh [release.zip]     (default: dist/Apostle-AE-Bridge-<APOSTLE_VERSION>.zip)
# Signs with the Developer ID Application identity. Notarizes and staples when
# a notarytool keychain profile named "apostle-notary" exists; without it the
# build is signed but macOS will warn on other Macs (see installer/README.md).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
VERSION="$(tr -d ' \n' < "$REPO/APOSTLE_VERSION")"
PAYLOAD="${1:-$REPO/dist/Apostle-AE-Bridge-$VERSION.zip}"
OUT="$HERE/build-out"
APP="$OUT/Apostle Installer.app"
DMG="$OUT/Apostle-Installer-$VERSION.dmg"
NOTARY_PROFILE="${NOTARY_PROFILE:-apostle-notary}"
TEAM="2K289MU28J"

[ -f "$PAYLOAD" ] || { echo "no release zip at $PAYLOAD (run scripts/package-release.sh)" >&2; exit 1; }
# Two Developer ID certificates share a name; sign by hash (first valid one).
IDENTITY="$(security find-identity -v -p codesigning | awk -v t="($TEAM)" '/Developer ID Application/ && index($0, t) { print $2; exit }')"
[ -n "$IDENTITY" ] || { echo "no Developer ID Application identity for team $TEAM" >&2; exit 1; }

echo "== build (universal)"
cd "$HERE"
swift build -c release --arch arm64 --arch x86_64 2>&1 | grep -E "error|warning: unre|Build complete" || true
BIN="$HERE/.build/apple/Products/Release/ApostleInstaller"
[ -x "$BIN" ] || { echo "build failed" >&2; exit 1; }

echo "== bundle"
rm -rf "$OUT"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/Apostle Installer"
cp "$PAYLOAD" "$APP/Contents/Resources/payload.zip"
printf '{ "version": "%s" }\n' "$VERSION" > "$APP/Contents/Resources/payload.json"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Apostle Installer</string>
  <key>CFBundleDisplayName</key><string>Apostle Installer</string>
  <key>CFBundleIdentifier</key><string>io.apostle.ae-bridge.installer</string>
  <key>CFBundleExecutable</key><string>Apostle Installer</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.graphics-design</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>© Apostle</string>
</dict></plist>
PLIST

echo "== icon"
ICONSET="$OUT/AppIcon.iconset"; mkdir -p "$ICONSET"
swift "$HERE/tools/make-icon.swift" "$OUT/icon-1024.png"
for s in 16 32 128 256 512; do
  sips -z $s $s "$OUT/icon-1024.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) "$OUT/icon-1024.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
rm -rf "$ICONSET"

echo "== sign"
codesign --force --options runtime --timestamp --sign "$IDENTITY" "$APP"
codesign --verify --strict --verbose=1 "$APP"

notarize() { # notarize <file>
  xcrun notarytool submit "$1" --keychain-profile "$NOTARY_PROFILE" --wait
}
NOTARIZED=0
if xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1; then
  echo "== notarize app"
  ditto -c -k --keepParent "$APP" "$OUT/app-for-notary.zip"
  notarize "$OUT/app-for-notary.zip" && xcrun stapler staple "$APP" && NOTARIZED=1
  rm -f "$OUT/app-for-notary.zip"
else
  echo "== notarize: SKIPPED (no keychain profile '$NOTARY_PROFILE'; see installer/README.md)"
fi

echo "== dmg"
STAGE="$OUT/dmg"; mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
hdiutil create -volname "Apostle" -srcfolder "$STAGE" -fs HFS+ -format UDZO -ov "$DMG" >/dev/null
rm -rf "$STAGE"
codesign --force --timestamp --sign "$IDENTITY" "$DMG"
if [ $NOTARIZED = 1 ]; then
  notarize "$DMG" && xcrun stapler staple "$DMG"
fi

echo "== check"
spctl --assess --type execute --verbose=2 "$APP" 2>&1 | sed 's/^/  /' || true
echo "built $APP"
echo "built $DMG ($(du -h "$DMG" | cut -f1)), notarized: $([ $NOTARIZED = 1 ] && echo yes || echo NO)"
