#!/bin/bash
# Apostle AE Bridge: setup check. Double-click any time something seems off.
# Read-only: it changes nothing. Open After Effects first for the full check.

set -u
DEST="$HOME/Applications/Apostle AE Bridge"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.claude/local:$PATH"
PROBLEMS=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; [ -n "${2:-}" ] && printf '      fix: %s\n' "$2"; PROBLEMS=$((PROBLEMS+1)); }

clear
printf '\n  Apostle AE Bridge: setup check\n\n'

[ -f "$DEST/build/index.js" ] && ok "Installed at $DEST" || bad "Not installed at $DEST" "double-click Install.command"

NODE="$(command -v node || true)"
[ -n "$NODE" ] && ok "Node.js $("$NODE" -v)" || bad "Node.js not found" "install the LTS from https://nodejs.org, then re-run Install.command"

CLAUDE="$(command -v claude || true)"
if [ -n "$CLAUDE" ]; then
  ok "Claude Code $("$CLAUDE" --version 2>/dev/null | head -1)"
  if "$CLAUDE" mcp get AfterEffectsMCP 2>/dev/null | grep -qF "$DEST/build/index.js"; then
    ok "Claude Code is connected to the bridge (AfterEffectsMCP)"
  else
    bad "Claude Code is not connected to the bridge" "re-run Install.command"
  fi
else
  bad "Claude Code not found" "re-run Install.command, or see https://docs.claude.com/en/docs/claude-code/setup"
fi

# The old ScriptUI bridge panel isn't needed. A copy from before the Apostle
# panel served the bridge doesn't know to stand down, so commands could run twice.
for d in /Applications/Adobe\ After\ Effects\ 20*; do
  f="$d/Scripts/ScriptUI Panels/mcp-bridge-auto.jsx"
  [ -f "$f" ] || continue
  if ! grep -q "apostle_bridge.alive" "$f"; then
    bad "An old MCP Bridge panel is installed in $(basename "$d")" "it isn't needed: don't open Window > mcp-bridge-auto.jsx (close it if it's open)"
  fi
done

LINK="$HOME/Library/Application Support/Adobe/CEP/extensions/apostle-panel"
[ -f "$LINK/CSXS/manifest.xml" ] && ok "Apostle panel installed" || bad "Apostle panel missing" "re-run Install.command"

printf '\n  Live connection to After Effects\n\n'
if ! pgrep -qf "MacOS/After Effects"; then
  bad "After Effects is not open" "open After Effects and run this check again"
else
  ok "After Effects is open"
  ALIVE="$HOME/Documents/ae-mcp-bridge/apostle_bridge.alive"
  AGE=999
  [ -f "$ALIVE" ] && AGE=$(( $(date +%s) - $(stat -f %m "$ALIVE") ))
  if [ "$AGE" -le 5 ]; then
    ok "The Apostle panel is open and serving Claude"
  else
    bad "The Apostle panel isn't open" "in After Effects: Window > Extensions > Apostle. Keep it open (dock it anywhere). Then run this check again."
  fi
  if "$DEST/scripts/bridge-exec.sh" ping '{}' 10 >/dev/null 2>&1; then
    ok "After Effects answered through the bridge: Claude can drive it"
  elif "$DEST/scripts/ae-run.sh" "$DEST/scripts/preflight.jsx" 20 >/dev/null 2>&1; then
    [ "$AGE" -le 5 ] && bad "After Effects responds, but not through the Apostle panel" "close and reopen the Apostle panel (Window > Extensions > Apostle)"
  else
    bad "After Effects did not answer" "open the Apostle panel (Window > Extensions > Apostle), and close any dialog box open in After Effects, then run this check again"
  fi
  WRITE="$(printf 'return app.preferences.getPrefAsLong("Main Pref Section v2", "Pref_SCRIPTING_FILE_NETWORK_SECURITY");\n' > "$HOME/Documents/ae-mcp-bridge/.check-pref.jsx"; "$DEST/scripts/bridge-exec.sh" executeScript --file "$HOME/Documents/ae-mcp-bridge/.check-pref.jsx" 10 2>/dev/null | tr -d ' \n')"
  case "$WRITE" in
    *'"result":1'*) ok "Scripts may write files (frame previews work)" ;;
    *'"result":0'*) bad "Scripts may not write files, so Claude can't preview frames" "After Effects > Settings > Scripting & Expressions > tick 'Allow Scripts to Write Files and Access Network'" ;;
  esac
fi

echo
if [ $PROBLEMS = 0 ]; then
  printf '  \033[32mAll good.\033[0m Open Terminal and run:\n\n'
  printf '      cd ~/Applications/Apostle\\ AE\\ Bridge && claude\n\n'
else
  printf '  \033[31m%s problem(s) found.\033[0m Fix them in order from the top, then run this check again.\n\n' "$PROBLEMS"
fi
printf 'Press Return to close this window. '
read -r _
