---
name: verify-comp
description: Closed-loop verification of an After Effects comp built via the Apostle bridge — deterministic checks first, then state serialization, then a few sampled frames; fix and re-check under a hard iteration cap. Use after any build or edit of an AE comp, or when asked to verify or fix one.
---

# verify-comp — the Apostle verification loop

Input: a **master comp name** (e.g. `APOSTLE_P1`). The loop verifies that comp and every precomp it references.

## Preconditions (do these once, not per pass)

1. Bridge alive: run a trivial `executeScript` ping through `scripts/bridge-exec.sh`. If it times out, **stop and ask the user** to open the MCP Bridge Auto panel with Auto-run checked. Never queue into a dead bridge.
2. Library loaded — every script begins with:
   ```javascript
   if (typeof $.global.APOSTLE === "undefined") { $.evalFile(new File("<repo>/apostle/apostle.jsx")); }
   ```
   After editing `apostle.jsx`, reload with an **unconditional** `$.evalFile`.
3. Follow the session-preflight and save rules in CLAUDE.md. Never save or close the user's project without their say-so if it holds unsaved human work.

## The pass (fixed order — cheap and deterministic before expensive and visual)

Each pass runs the checks **in this order** and stops at the first stage that surfaces defects:

1. **`APOSTLE.checkExpressionErrors(comp)`** — sweeps every property of the comp and its precomps for a non-empty `expressionError`. Any entry is a defect; the record names comp, layer, property matchName, the error, and the expression text.
2. **`APOSTLE.checkTextSafeMargins(comp)`** — every text layer's post-expression rendered bounds vs the Safe Margin % slider, measured at the layer's hold time. `violations[]` entries carry bounds, which edge, by how many px, and a `fixPath`.
3. **`APOSTLE.checkCameraDistance(comp)`** — camera world position vs each station's scene plane at station-arrival marker times. Flags clipping (< 300 px in front of the plane) and framing misses (> 250 px off center in x/y).
4. **`APOSTLE.serializeCompState(comp)`** — compact capped JSON. Run when a defect needs context to fix, and once before rendering frames. Not a defect detector by itself; it is the map you fix from.
5. **Sampled frames — only when 1–3 are green** (or when a check passes but you have concrete reason to distrust it; the checks have been wrong before — see the playhead trap in CLAUDE.md). 4–8 frames max per pass, chosen from: station arrival + ~0.3 s (dwell settled), one transit midpoint, one text-entrance completion, the endcard. Render with `APOSTLE.renderKeyFrames(comp, [times], outDir)`, downscale every frame with `scripts/downscale-frame.sh <png> 800` **before** reading it, then read the PNGs. Pair frames with the state JSON — never interpret pixels without the DOM state alongside.

Station-arrival times come from the build report (`beats[].arrive`) or from the rig layer's `Station N` markers.

## Fixing

- Fix via `run-script`/`executeScript`, **smallest change that addresses the named defect**, one undo group per fix, ES3 only, and re-read the trap list in CLAUDE.md before writing any script.
- Typical fixes by defect class:
  - *Expression error* → repair or replace the expression on the exact property named in the error record. If it references a missing layer/comp, decide whether the reference or the referenced thing is wrong before editing.
  - *Safe-margin violation* → restore the autoFit Scale expression if it was lost, else reposition/rescale so post-expression bounds fit. The autoFit expression budget is computed from the layer's actual x-position — repositioning changes the budget.
  - *Camera clipping / framing miss* → correct the **rig** Position keyframe at the flagged station time to match that station's scene-layer position (read the scene layer's position; set the rig key). Never fix by moving the scene to the camera unless the scene is the thing that is provably wrong.
- Never "fix" a check by deleting the layer it flagged or widening the tolerance. Tolerances (`EPS = 2` px margins, 300 px clip, 250 px framing) are contract, not knobs.
- After a fix, re-run the **failed check first**; when it is green, re-run the full pass order from step 1 (fixes can break other things).

## Stop conditions (evaluate after every pass)

- **Success**: checks 1–3 all green **and** sampled frames visually correct → report and stop.
- **Iteration cap**: 8 passes total per task → stop and report every remaining defect with its latest check record. Do not silently keep going.
- **Stuck**: the **same defect** (same check, same layer/property, similar magnitude) survives **two consecutive fix attempts** → stop, mark it *blocked*, report what was tried and the current hypothesis. Do not thrash.

## Report (always, on any stop condition)

- Passes used (n / 8), and per pass what was found and what was changed.
- Final check results: expression errors count, margin violations count, camera violations count.
- Frames rendered (times + one-line visual verdict each).
- Anything blocked, with the two failed fix attempts described.

## Token discipline

Deterministic checks are near-free; frames are the expensive last resort. Never render more than 8 frames in a pass, never full-res, never read a frame you didn't downscale. State JSON is capped (60 KB, depth 6) — trust the caps, don't re-serialize repeatedly in one pass.
