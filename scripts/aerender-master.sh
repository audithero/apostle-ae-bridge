#!/bin/bash
# Headless render of a comp from a SAVED project via aerender.
# Use for projects on disk (e.g. a scratch .aep). For the live, unsaved
# project use APOSTLE.renderMovie (in-app RQ) instead — never save the
# user's open project just to feed aerender (CLAUDE.md save policy).
# Usage: aerender-master.sh <project.aep> <comp-name> <out-movie> [template]
set -euo pipefail

AEP="$1"; COMP="$2"; OUT="$3"; TEMPLATE="${4:-H.264 - Match Render Settings - 15 Mbps}"
AERENDER="/Applications/Adobe After Effects 2026/aerender"

"$AERENDER" -project "$AEP" -comp "$COMP" \
  -OMtemplate "$TEMPLATE" -output "$OUT" -continueOnMissingFootage
echo "rendered: $OUT"
