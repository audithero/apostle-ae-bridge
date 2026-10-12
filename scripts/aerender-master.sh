#!/bin/bash
# Headless render of a comp from a SAVED project via aerender.
# Use for projects on disk (e.g. a scratch .aep). For the live, unsaved
# project use APOSTLE.renderMovie (in-app RQ) instead — never save the
# user's open project just to feed aerender (CLAUDE.md save policy).
# Usage: aerender-master.sh <project.aep> <comp-name> <out-movie> [template]
#
# Output-module template names change between AE versions (AE 2026 has no
# "15 Mbps" H.264 preset; it has 5 and 40), and aerender exits 0 even when it
# rejects the name and renders nothing. So: try each template in turn and
# only report success when the movie actually exists.
set -uo pipefail

AEP="$1"; COMP="$2"; OUT="$3"
AERENDER="${AERENDER:-/Applications/Adobe After Effects 2026/aerender}"
if [ -n "${4:-}" ]; then
  TEMPLATES=("$4")
else
  TEMPLATES=("H.264 - Match Render Settings - 40 Mbps" "H.264 - Match Render Settings - 15 Mbps" "H.264 - Match Render Settings -  5 Mbps" "High Quality")
fi

for T in "${TEMPLATES[@]}"; do
  rm -f "$OUT"
  LOG="$("$AERENDER" -project "$AEP" -comp "$COMP" -OMtemplate "$T" -output "$OUT" -continueOnMissingFootage 2>&1)"
  if echo "$LOG" | grep -q "No output module template was found"; then
    echo "template not found: $T" >&2
    continue
  fi
  # High Quality writes .mov whatever the extension asked for; accept either
  for F in "$OUT" "${OUT%.*}.mov"; do
    if [ -s "$F" ]; then echo "rendered: $F (template: $T)"; exit 0; fi
  done
  echo "$LOG" | tail -20 >&2
  echo "aerender produced no file with template: $T" >&2
  exit 1
done
echo "no usable output template among: ${TEMPLATES[*]}" >&2
exit 1
