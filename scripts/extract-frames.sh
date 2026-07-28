#!/bin/bash
# Extract review frames from a rendered export at given times, half-res.
# The Phase 8 QA loop reviews DELIVERED pixels, not comp state — this is
# how Claude sees the final export.
# Usage: extract-frames.sh <movie> <outdir> <t1> [t2 ...]   (times in seconds)
set -euo pipefail

MOVIE="$1"; OUTDIR="$2"; shift 2
mkdir -p "$OUTDIR"
for T in "$@"; do
  NAME="$(printf 'f_%07.2f' "$T" | tr '.' 'p')"
  ffmpeg -loglevel error -ss "$T" -i "$MOVIE" -frames:v 1 -y "$OUTDIR/$NAME.png"
  sips -Z 800 "$OUTDIR/$NAME.png" >/dev/null
done
ls "$OUTDIR"
