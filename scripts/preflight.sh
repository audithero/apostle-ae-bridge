#!/bin/bash
# Session preflight: find a working transport into AE and report session state.
# Order: MCP bridge panel (bridge-exec.sh) -> AppleScript DoScript (ae-run.sh).
# Exit 0 with a JSON report on stdout, or exit 1 with guidance on stderr.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
PROBE="$DIR/preflight.jsx"

# `pgrep -f` matches the full command line, which a sandboxed shell is not
# always allowed to read — it then returns nothing and we would declare a
# perfectly healthy AE dead. `ps -Ao comm` (executable path only) is always
# readable, so treat either hit as running.
# NB: no `... | grep -q` here — grep -q exits on first match, ps takes
# SIGPIPE, and `set -o pipefail` then reports the whole pipeline as failed.
ae_running() {
  pgrep -qf "MacOS/After Effects" && return 0
  local procs
  procs="$(ps -Ao comm= 2>/dev/null)"
  case "$procs" in
    *"MacOS/After Effects"*) return 0 ;;
  esac
  return 1
}

if ! ae_running; then
  echo "After Effects is not running. Start it (and open the project) first." >&2
  exit 1
fi

OUT="$("$DIR/bridge-exec.sh" executeScript --file "$PROBE" 8 2>/dev/null)" && {
  echo "{\"transport\":\"bridge-panel\",\"probe\":$OUT}"
  exit 0
}

OUT="$("$DIR/ae-run.sh" "$PROBE" 30 2>/dev/null)" && {
  echo "{\"transport\":\"doscript\",\"probe\":$OUT}"
  echo "NOTE: bridge is not responding — using DoScript fallback. For MCP-native tools, open the Apostle panel (Window > Extensions > Apostle; it reads "claude linked")." >&2
  exit 0
}

echo "AE is running but neither transport responded. A modal dialog may be blocking AE — check the screen." >&2
exit 1
