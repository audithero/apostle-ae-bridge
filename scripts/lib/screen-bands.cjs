/*
 * screen-bands.cjs: numbered content blocks for app screenshots.
 *
 * Models are poor at reading pixel coordinates off an image. So instead of
 * asking for a highlight rect, we detect the content blocks of every screen
 * (rows of ink separated by white space; lines closer than a gap merge into
 * one block), draw them numbered on a contact sheet the model can Read, and
 * let it say { "bands": [4] }. compile-instructional resolves that to an
 * exact rect. Measured on real app screens: the three status options of
 * a visa-status screen come out as three blocks.
 *
 * Needs python3 + Pillow; returns {} (and the plan must use rect) without.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const PY = [
  "import sys, json, os",
  "from PIL import Image, ImageDraw",
  "items = json.load(open(sys.argv[1])); out = sys.argv[2]; sheet = sys.argv[3]",
  "res = {}",
  "thumbs = []",
  "for it in items:",
  "    try:",
  "        im = Image.open(it['file']).convert('L')",
  "    except Exception as e:",
  "        continue",
  "    w, h = im.size; k = w / 1125.0",
  "    vis = min(h, int(w / 0.4618))",          // only what the phone display shows
  "    x0, x1, step = int(40 * k), int(w - 40 * k), max(2, int(6 * k))",
  "    small = im.resize((max(1, w // 3), max(1, h // 3)))",
  "    sw, sh = small.size",
  "    rows = []",
  "    for y in range(sh):",
  "        rows.append(any(small.getpixel((x, y)) < 235 for x in range(int(x0 / 3), int(x1 / 3), max(1, step // 3))))",
  "    bands, s = [], None",
  "    for y, ink in enumerate(rows + [False]):",
  "        if ink and s is None: s = y",
  "        if not ink and s is not None: bands.append([s * 3, y * 3]); s = None",
  "    # merge lines closer than ~44px (at 1125 wide) into one block; drop the status bar",
  "    merged = []",
  "    for b in bands:",
  "        if b[1] < 160 * k: continue",
  "        if merged and b[0] - merged[-1][1] < 44 * k: merged[-1][1] = b[1]",
  "        else: merged.append(list(b))",
  "    merged = [b for b in merged if b[1] - b[0] > 10 * k and b[0] < vis]",
  "    res[it['name']] = {'w': w, 'h': h, 'bands': merged}",
  "    src = Image.open(it['file']).convert('RGB').crop((0, 0, w, vis))",
  "    src.thumbnail((270, 600)); s2 = src.size[0] / float(w)",
  "    th = Image.new('RGB', (src.size[0] + 30, src.size[1]), (70, 70, 70)); th.paste(src, (30, 0))",
  "    d = ImageDraw.Draw(th)",
  "    for i, b in enumerate(merged):",
  "        y0, y1 = b[0] * s2, min(b[1], vis) * s2",
  "        d.rectangle([30, y0 - 2, th.size[0] - 2, y1 + 2], outline=(230, 30, 30), width=2)",
  "        d.rectangle([0, y0 - 2, 27, y0 + 16], fill=(230, 30, 30))",
  "        d.text((4, y0), str(i + 1), fill=(255, 255, 255))",
  "    thumbs.append((it['name'], th))",
  "json.dump(res, open(out, 'w'))",
  "if thumbs:",
  "    cols = 8; W, H = 300, 670; rows_n = (len(thumbs) + cols - 1) // cols",
  "    s = Image.new('RGB', (cols * (W + 8), rows_n * (H + 30)), (70, 70, 70)); d = ImageDraw.Draw(s)",
  "    for i, (name, th) in enumerate(thumbs):",
  "        x, y = (i % cols) * (W + 8), (i // cols) * (H + 30)",
  "        s.paste(th, (x + (W - th.size[0]) // 2, y + 26)); d.text((x + 4, y + 6), name[:44], fill=(255, 255, 0))",
  "    s.save(sheet)"
].join("\n");

/**
 * @param {{name:string,file:string}[]} screens
 * @param {string} outDir  where bands.json and screens-bands.png are written
 * @returns {{bands: Object, sheet: string|null}}
 */
function screenBands(screens, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const list = path.join(outDir, "bands-input.json");
  const out = path.join(outDir, "bands.json");
  const sheet = path.join(outDir, "screens-bands.png");
  fs.writeFileSync(list, JSON.stringify(screens));
  try {
    execFileSync("python3", ["-I", "-c", PY, list, out, sheet], { timeout: 300000 });
    return { bands: JSON.parse(fs.readFileSync(out, "utf8")), sheet: fs.existsSync(sheet) ? sheet : null };
  } catch (e) {
    return { bands: {}, sheet: null };
  } finally {
    try { fs.unlinkSync(list); } catch (e) {}
  }
}

// bands [i, j] (1-based) -> the rect around them, full width of the capture
function bandsToRect(entry, idx) {
  if (!entry || !Array.isArray(idx) || !idx.length) return null;
  const bs = idx.map((i) => entry.bands[i - 1]).filter(Boolean);
  if (bs.length !== idx.length) return null;
  const k = entry.w / 1125;
  const y0 = Math.min.apply(null, bs.map((b) => b[0])) - 22 * k;
  const y1 = Math.max.apply(null, bs.map((b) => b[1])) + 22 * k;
  return [Math.round(40 * k), Math.round(y0), Math.round(entry.w - 80 * k), Math.round(y1 - y0)];
}

module.exports = { screenBands, bandsToRect };
