# Pictogram swap subcomps — vector art drop-in map

Built 2026-08-06 in `CBA-EDUCATION_VIDEOS_2.aep`. Companion to
[VECTOR-PICTOGRAM-REQUEST.md](VECTOR-PICTOGRAM-REQUEST.md) — that doc is the ask to the team;
this doc is what to do when the files come back.

Every bitmap pictogram used on a visible button now renders through one shared precomp in the
project folder **`PICTO SUBCOMPS`**. All 109 button placements across the seven videos and the
EXP_WORLD comp point at these 27 comps, with their animation (entrances, VO pulses, easing)
untouched on the outer layers.

## The swap, per pictogram

1. Import the vector file (`.ai` with PDF compatibility ON, or real-path `.svg`).
2. Open the matching `PICTO <name>` comp (284×284). Add the vector art, center it, and scale it
   to match the bitmap layer under it (art fills the comp square the same way).
3. Turn ON **Continuously Rasterize** on the new vector layer.
4. Disable (don't delete) the original bitmap layer, commented `bitmap original`.

That one edit updates every placement of that pictogram in every video at the correct size.

## Comps and usage counts

| Subcomp | Placements |
|---|---|
| PICTO coin stack | 10 |
| PICTO star | 9 |
| PICTO offers | 8 |
| PICTO store | 8 |
| PICTO plane | 8 |
| PICTO gift | 8 |
| PICTO shopping trolley | 8 |
| PICTO percentage | 6 |
| PICTO CommBank Card | 5 |
| PICTO luggage | 5 |
| PICTO document | 4 |
| PICTO trophy | 4 |
| PICTO card cycle | 3 |
| PICTO bill | 3 |
| PICTO megaphone | 2 |
| PICTO car | 2 |
| PICTO house | 2 |
| PICTO partnership | 2 |
| PICTO keycard | 2 |
| PICTO dining | 2 |
| PICTO no fees | 2 |
| PICTO branch | 1 |
| PICTO birthday | 1 |
| PICTO decreasing trend | 1 |
| PICTO analytics | 1 |
| PICTO certified | 1 |
| PICTO tick | 1 |

(Placement counts are visible enabled buttons only — disabled layers, e.g. old phone screen
icons, still reference the raw footage and were left alone. `calendar` and `change` are already
true vector in the delivered set and stay as direct footage, as do the four shape-art glyphs.)

## Notes

- **87 of the 109 wrapper layers have Collapse Transformations ON** — vector art dropped into the
  subcomp will rasterize losslessly at any camera scale with no further work.
- **22 wrappers are 3D layers and were left uncollapsed** (collapsing 3D precomps breaks z-sort
  order under the camera — see CLAUDE.md). Bitmaps render identically either way today; once
  vector art lands, judge per case whether those need a collapse + z-sort check for close
  push-ins.
- Icon sizing: all button icons were enlarged to **121% of the original build size**
  (two ×1.1 passes, 2026-08-06), tagged `icon110`/`icon121` in layer comments. Replacement art
  inherits this automatically — size lives on the outer layers, not in the subcomps.
