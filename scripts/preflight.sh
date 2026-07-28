#!/bin/bash
# Session preflight: find a working transport into AE and report session state.
# Order: MCP bridge panel (bridge-exec.sh) -> AppleScript DoScript (ae-run.sh).
# Exit 0 with a JSON report on stdout, or exit 1 with guidance on stderr.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
PROBE="$DIR/preflight.jsx"

if ! pgrep -qf "Adobe After Effects.*MacOS/After Effects$"; then
  if ! pgrep -qf "MacOS/After Effects"; then
    echo "After Effects is not running. Start it (and open the project) first." >&2
    exit 1
  fi
fi

OUT="$("$DIR/bridge-exec.sh" executeScript --file "$PROBE" 8 2>/dev/null)" && {
  echo "{\"transport\":\"bridge-panel\",\"probe\":$OUT}"
  exit 0
}

OUT="$("$DIR/ae-run.sh" "$PROBE" 30 2>/dev/null)" && {
  echo "{\"transport\":\"doscript\",\"probe\":$OUT}"
  echo "NOTE: bridge panel is not responding — using DoScript fallback. For MCP-native tools, open Window > mcp-bridge-auto.jsx with Auto-run checked." >&2
  exit 0
}

echo "AE is running but neither transport responded. A modal dialog may be blocking AE — check the screen." >&2
exit 1
