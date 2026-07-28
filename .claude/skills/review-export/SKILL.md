---
name: review-export
description: Closed-loop visual QA of a rendered Apostle export — self-render via the render queue (or ingest a provided export), extract frames at beat boundaries and transit midpoints with ffmpeg, score against the QA rubric, fix via surgical ops, re-render. Use before reporting any build as working, or when asked to review an exported movie.
---

# review-export — Claude reviews the delivered pixels

Input: a **master comp name** (self-render path) or a **movie file path**
(client-provided export). Never report a build as working from DOM checks
alone — that's the whole point of this skill (decision: Tim, 2026-07-28).

## 1. Get a movie

- Self-render (default): `APOSTLE.renderMovie(master, "<scratchpad>/renders/<master>.mp4")`
  via `run-script`/`ae-run.sh`. In-app RQ render — works on the unsaved
  project; blocks AE while rendering, so warn in the narration if the comp
  is long. Template falls back H.264 → High Quality → Lossless; the report
  says which was used.
- Saved scratch project: `scripts/aerender-master.sh <aep> <comp> <out>`.
  NEVER save the user's open project to enable this — CLAUDE.md save policy.

## 2. Timing map

`retimeBeats(master, beatsJSON)` is idempotent and returns
`{beats: [{beatId, arrive, duration}]}` — or read the build snapshot in
`.apostle-runs/`. Sample times: each beat settle (`arrive + 1.2`), each
transit midpoint (`arrive − transit/2`), plus `duration − 0.5` for the
endcard hold.

## 3. Extract cheap, review cheap

- `scripts/extract-frames.sh <movie> <outdir> <t1> <t2> ...` — half-res PNGs.
- Tile into montages before reading any image (token discipline):
  `ffmpeg -pattern_type glob -i '<outdir>/f_*.png' -filter_complex tile=4x3 montage.png`
  (one montage for settles, one for transit midpoints). Read the montage(s);
  pull individual full frames ONLY for tiles that look wrong.

## 4. Score against docs/qa-rubric.md

Emit findings as `{beatId, check, severity, evidence, suggestedFix}`.
Attribute to beats via the timing map — every extracted frame's time maps
to exactly one beat/transit.

## 5. Fix loop

Surgical only: `updateBeatText` / `retimeBeats` / `applyBeatStructure` /
`rebuildBeatScene` / motion params / `applyHandheldPolish`. After fixing,
re-render and re-score. Hard cap **8 passes**; same defect surviving two
consecutive fix attempts → report blocked with the evidence frames. Delete
scratch renders when done; they are large.
