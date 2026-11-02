/*
 * pictograms.cjs: brand pictograms After Effects can actually render.
 *
 * A client's pictogram set (00.ADMIN/02.Client Assets/Pictograms) ships as SVGs
 * that wrap one embedded PNG each (no vector paths), and an "_AI" set whose
 * PDF layer renders blank in AE and in Preview (measured 2026-10-13). So the
 * embedded PNG is the pictogram: it is written out once per job, transparent,
 * and that file is what the timeline imports. SVGs with real paths and no
 * image are skipped with a warning (AE cannot import SVG).
 */
"use strict";

const fs = require("fs");
const path = require("path");

const IMG = /<image[^>]*xlink:href="data:image\/png;base64,([^"]+)"/;

// timeline.pictograms { glyph: file.svg } -> { glyph: outDir/name.png }
function rasterPictograms(timeline, outDir) {
  const warnings = [];
  if (!timeline.pictograms) return warnings;
  fs.mkdirSync(outDir, { recursive: true });
  for (const g of Object.keys(timeline.pictograms)) {
    const src = timeline.pictograms[g];
    if (!/\.svg$/i.test(src)) continue;
    const out = path.join(outDir, path.basename(src).replace(/\.svg$/i, ".png"));
    if (!(fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(src).mtimeMs)) {
      const m = fs.readFileSync(src, "utf8").match(IMG);
      if (!m) { warnings.push("pictogram " + path.basename(src) + " has no embedded image; skipped"); delete timeline.pictograms[g]; continue; }
      fs.writeFileSync(out, Buffer.from(m[1], "base64"));
    }
    timeline.pictograms[g] = out;
  }
  return warnings;
}

module.exports = { rasterPictograms };
