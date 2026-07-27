#!/bin/bash
# Run an ExtendScript file in a live After Effects via AppleScript DoScript.
# Fallback transport when the MCP bridge panel is not open — same contract as
# bridge-exec.sh executeScript --file: the script body may use top-level
# `return`; the returned value is JSON-stringified into the result.
# Usage: ae-run.sh <script.jsx> [timeout-sec] [ae-app-name]
# Prints {"status":"ok","result":...} or {"status":"error",...} to stdout.
set -euo pipefail

TARGET="$1"
TIMEOUT="${2:-60}"
AE_APP="${3:-Adobe After Effects 2026}"
RUNDIR="${AE_RUN_DIR:-${TMPDIR:-/tmp}/ae-run}"
mkdir -p "$RUNDIR"

TARGET_ABS="$(cd "$(dirname "$TARGET")" && pwd)/$(basename "$TARGET")"
RESULT="$RUNDIR/ae_run_result.json"
WRAPPER="$RUNDIR/ae_run_wrapper.jsx"
rm -f "$RESULT"

cat > "$WRAPPER" <<EOF
(function () {
  var out = new File("$RESULT");
  var res;
  try {
    var sf = new File("$TARGET_ABS");
    sf.encoding = "UTF-8"; sf.open("r"); var body = sf.read(); sf.close();
    var fn = eval("(function(){" + body + "\n})");
    var r = fn();
    res = { status: "ok", result: (r === undefined ? null : r) };
  } catch (e) {
    res = { status: "error", error: e.toString(), line: (e.line || null), fileName: (e.fileName || null) };
  }
  out.encoding = "UTF-8"; out.open("w");
  try { out.write(JSON.stringify(res)); }
  catch (e2) { out.write('{"status":"error","error":"result not JSON-serializable: ' + String(e2).replace(/"/g, "'") + '"}'); }
  out.close();
})();
EOF

osascript -e "with timeout of $TIMEOUT seconds" \
          -e "tell application \"$AE_APP\" to DoScript \"\$.evalFile(new File('$WRAPPER'))\"" \
          -e "end timeout" >/dev/null

DEADLINE=$(( $(date +%s) + TIMEOUT ))
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  if [ -f "$RESULT" ]; then cat "$RESULT"; echo; exit 0; fi
  sleep 0.2
done
echo "TIMEOUT: no result after ${TIMEOUT}s — is AE responsive (no modal dialog open)?" >&2
exit 1
