# Apostle export QA rubric

The checklist Claude scores rendered pixels against (Phase 8). Findings are
per beat, structured: `{beatId, check, severity: blocker|major|minor,
evidence: "<frame file + what's visible>", suggestedFix}`. Severity gates:
a **blocker** fails the export; **major** should be fixed before client
review; **minor** is polish. Deterministic checks (expressions, margins,
camera) run BEFORE any frame is rendered — this rubric covers what only
pixels can show.

## Layout (score at each beat's settled frame, arrive + ~1.2s)

- **L1 safe margins**: no text touching the outer 10% (or brand kit value).
- **L2 collision**: no text overlapping other text, bars, or device frames.
- **L3 hierarchy**: heading visibly larger than items/URL; accent bar under
  the heading it belongs to; centered content optically centered.
- **L4 autofit sanity**: no line shrunk far below its role's size (the
  "headline smaller than URL" class); no single-word orphan wraps.
- **L5 list shape**: listBuild beats show heading + stacked items, not a
  run-on sentence with separators.

## Transitions (score at transit midpoints, arrive − transit/2)

- **T1 never empty**: some content visible mid-transit (motion-blurred is
  correct); a fully blank frame is the v2.1 empty-transit bug — blocker.
- **T2 no ghosts**: outgoing and incoming supers never both fully readable
  (double-exposure look).
- **T3 arrival settle**: 0.3s after arrive, the camera has stopped —
  content is sharp; residual drift beyond handheld level is a major.
- **T4 speed sanity**: transits read as a move, not a jump-cut (unless
  transitIn: none) nor a crawl (mid-frame nearly identical to settled).

## Timing (score from the timing map + spot frames)

- **M1 reading time**: text on screen ≥ its word count reading time (the
  1.8s floor is enforced at build; verify the render agrees).
- **M2 dead air**: no stretch > 3s with a settled camera and no text
  animating (dwell beats with VO are exempt).
- **M3 endcard hold**: endcard fully settled ≥ 2.5s before the export ends.

## Brand (score anywhere; one settled frame is enough)

- **B1 colors**: background, accent, and text colors match the brand kit
  (allow codec drift ±10 per channel).
- **B2 fonts rendered**: headings/body visibly the kit's faces — catches
  silent PostScript substitution that DOM checks can miss.
- **B3 logo**: present and unclipped when the kit ships one.

## Loop discipline

Same as verify-comp: fix via surgical ops (`updateBeatText`, `retimeBeats`,
`applyBeatStructure`, motion params), re-render only affected spans, hard
cap 8 passes, two consecutive failures on the same defect = report blocked.
Review montages first (4×3 tiles); pull single full frames only where a
tile looks wrong. Never report an export as working without this rubric
having seen rendered pixels.
