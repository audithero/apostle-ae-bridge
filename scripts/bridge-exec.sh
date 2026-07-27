#!/bin/bash
# Send a command to the AE file bridge and wait for the matching result.
# Usage:
#   bridge-exec.sh <command> [args-json] [timeout-sec]
#   bridge-exec.sh executeScript --file <script.jsx> [timeout-sec]
# Prints the result JSON to stdout. Exits 1 on timeout.
set -euo pipefail

BRIDGE_DIR="${AE_MCP_BRIDGE_DIR:-$HOME/Documents/ae-mcp-bridge}"
CMD="$1"; shift || true

if [ "$CMD" = "executeScript" ] && [ "${1:-}" = "--file" ]; then
  SCRIPT_FILE="$2"; TIMEOUT="${3:-30}"
  ARGS_MODE="file"
else
  ARGS_JSON="${1:-{}}"; TIMEOUT="${2:-30}"
  ARGS_MODE="json"
fi

ID="bx-$$-$(date +%s)"
rm -f "$BRIDGE_DIR/ae_mcp_result.json"

python3 - "$ID" "$BRIDGE_DIR" "$CMD" "$ARGS_MODE" "${SCRIPT_FILE:-}" "${ARGS_JSON:-}" <<'PYEOF'
import json, sys, os
cid, bdir, cmd, mode, sfile, argsjson = sys.argv[1:7]
if mode == "file":
    args = {"script": open(sfile).read()}
else:
    args = json.loads(argsjson) if argsjson else {}
tmp = os.path.join(bdir, "ae_command.json.tmp")
with open(tmp, "w") as f:
    f.write(json.dumps({"command": cmd, "args": args, "commandId": cid}))
os.rename(tmp, os.path.join(bdir, "ae_command.json"))
PYEOF

DEADLINE=$(( $(date +%s) + TIMEOUT ))
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  if [ -f "$BRIDGE_DIR/ae_mcp_result.json" ] && grep -q "$ID" "$BRIDGE_DIR/ae_mcp_result.json" 2>/dev/null; then
    cat "$BRIDGE_DIR/ae_mcp_result.json"
    exit 0
  fi
  sleep 0.2
done
echo "TIMEOUT: no result for $CMD ($ID) after ${TIMEOUT}s — is the bridge panel open with Auto-run on?" >&2
exit 1
