#!/bin/bash
# Downscale a rendered frame PNG in place (or to a target) with sips.
# Usage: downscale-frame.sh <frame.png> [max-dimension] [out.png]
# Default max dimension 800px — half-res or smaller, per token discipline.
set -euo pipefail
IN="$1"
MAX="${2:-800}"
OUT="${3:-$IN}"
if [ "$OUT" != "$IN" ]; then cp "$IN" "$OUT"; fi
sips -Z "$MAX" "$OUT" >/dev/null
echo "$OUT $(sips -g pixelWidth -g pixelHeight "$OUT" | awk '/pixel/{printf "%s ", $2}')"
