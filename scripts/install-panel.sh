#!/bin/bash
# Install the Apostle CEP panel (user-level — NO sudo needed, unlike
# ScriptUI Panels): symlink the repo's apostle-panel/ into the user CEP
# extensions folder and enable PlayerDebugMode (required for unsigned
# extensions during development).
# Usage: scripts/install-panel.sh [--uninstall]
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CEP_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions"
LINK="$CEP_DIR/apostle-panel"

if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$LINK"
  echo "Removed $LINK"
  exit 0
fi

mkdir -p "$CEP_DIR"
rm -f "$LINK"
ln -s "$REPO_DIR/apostle-panel" "$LINK"

# unsigned-extension debug mode for every CSXS runtime AE 2024+ may use
for V in 11 12 13; do
  defaults write "com.adobe.CSXS.$V" PlayerDebugMode 1
done

echo "Installed: $LINK -> $REPO_DIR/apostle-panel"
echo "Restart After Effects, then open Window > Extensions > Apostle"
