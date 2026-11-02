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

WANT="$(grep -m1 -o 'BRIDGE_VERSION = "[^"]*"' "$DEST/build/scripts/mcp-bridge-auto.jsx" 2>/dev/null)"
FOUND=0
for d in /Applications/Adobe\ After\ Effects\ 20*; do
  f="$d/Scripts/ScriptUI Panels/mcp-bridge-auto.jsx"
  [ -f "$f" ] || continue
  FOUND=1
  HAVE="$(grep -m1 -o 'BRIDGE_VERSION = "[^"]*"' "$f")"
  if [ "$HAVE" = "$WANT" ]; then ok "MCP Bridge panel is current in $(basename "$d")"
  else bad "MCP Bridge panel in $(basename "$d") is out of date (${HAVE#*= })" "re-run Install.command"; fi
done
[ $FOUND = 1 ] || bad "MCP Bridge panel is not in any After Effects" "re-run Install.command"

LINK="$HOME/Library/Application Support/Adobe/CEP/extensions/apostle-panel"
[ -f "$LINK/CSXS/manifest.xml" ] && ok "Apostle panel installed" || bad "Apostle panel missing" "re-run Install.command"

printf '\n  Live connection to After Effects\n\n'
if ! pgrep -qf "MacOS/After Effects"; then
  bad "After Effects is not open" "open After Effects and run this check again"
else
  ok "After Effects is open"
  if OUT="$("$DEST/scripts/bridge-exec.sh" executeScript --file "$DEST/scripts/preflight.jsx" 10 2>/dev/null)"; then
    ok "The MCP Bridge panel answered: Claude can drive After Effects"
  else
    bad "The MCP Bridge panel did not answer" "in After Effects: Window > mcp-bridge-auto.jsx, keep it open with 'Auto-run commands' ticked. Also check After Effects > Settings > Scripting & Expressions > 'Allow Scripts to Write Files and Access Network' is ticked. Then run this check again."
    if "$DEST/scripts/ae-run.sh" "$DEST/scripts/preflight.jsx" 20 >/dev/null 2>&1; then
      printf '      (After Effects itself responds, so only the panel or the setting above is missing.)\n'
    else
      printf '      (After Effects did not respond at all: look for an open dialog box in After Effects and close it.)\n'
    fi
  fi
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
