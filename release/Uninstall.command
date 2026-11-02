#!/bin/bash
# Apostle AE Bridge: uninstaller. Removes the panels and the Claude Code
# connection. Asks before deleting the install folder (it may hold your work).

set -u
DEST="$HOME/Applications/Apostle AE Bridge"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.claude/local:$PATH"

clear
printf '\n  Apostle AE Bridge: uninstall\n\n'
printf '  Quit After Effects first. Press Return to continue, or close this window to cancel. '
read -r _

if command -v claude >/dev/null; then
  claude mcp remove -s user AfterEffectsMCP >/dev/null 2>&1 && echo "  removed the Claude Code connection" || true
fi

rm -f "$HOME/Library/Application Support/Adobe/CEP/extensions/apostle-panel" && echo "  removed the Apostle panel"

# Only older installs put the ScriptUI bridge inside After Effects (needs sudo).
for d in /Applications/Adobe\ After\ Effects\ 20*; do
  f="$d/Scripts/ScriptUI Panels/mcp-bridge-auto.jsx"
  if [ -f "$f" ]; then
    echo "  removing the old MCP Bridge panel from $(basename "$d") (needs your Mac password):"
    sudo rm -f "$f" && echo "  removed"
  fi
done

rm -f "$HOME/.apostle/relay.token"

printf '\n  Delete the install folder too (%s)?\n  It holds any briefs and builds you made there. [y/N] ' "$DEST"
read -r a
if [ "$a" = "y" ] || [ "$a" = "Y" ]; then
  rm -rf "$DEST" && echo "  deleted $DEST"
else
  echo "  kept $DEST"
fi

printf '\n  Done. Press Return to close this window. '
read -r _
