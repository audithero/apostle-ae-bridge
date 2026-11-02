/*
 * screen-android.cjs: take the iPhone Dynamic Island out of app captures.
 *
 * Some clients may not show an iPhone (client review, 2026-10-13: "make it feel more
 * like an android phone"). iOS screenshots carry the island as a black pill
 * in the middle of the status bar (y 33-143, x 374-750 at 1125 wide on the
 * a client's October 2026 set). Each row of the pill is repainted with that row's
 * own status-bar colour, sampled in the gap between the clock and the pill,
 * so dimmed (modal) and tinted bars clean as well as white ones. The phone
 * frame then draws an Android punch-hole camera instead (instructional.jsx).
 *
 * Cleaned copies keep the original file names, in outDir; originals are
 * never touched. A capture with no pill (dark camera screens, where the pill
 * is invisible anyway) is copied unchanged. Needs python3 + Pillow.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const PY = [
  "import sys, json, os, shutil",
  "from PIL import Image",
  "items = json.load(open(sys.argv[1])); out = sys.argv[2]; res = {}",
  "def diff(a, b): return sum(abs(x - y) for x, y in zip(a[:3], b[:3]))",
  "for it in items:",
  "    src = it['file']; dst = os.path.join(out, os.path.basename(src))",
  "    try: im = Image.open(src)",
  "    except Exception: continue",
  "    mode = im.mode; rgb = im.convert('RGBA'); w, h = rgb.size; k = w / 1125.0",
  "    px = rgb.load(); y1 = min(h, int(170 * k)); sx = int(320 * k)",
  "    rows = []",
  "    for y in range(y1):",
  "        bg = px[sx, y]",
  "        xs = [x for x in range(int(340 * k), int(790 * k)) if diff(px[x, y], bg) > 24]",
  "        if xs: rows.append((y, min(xs), max(xs)))",
  "    box = None",
  "    if rows:",
  "        x0 = min(r[1] for r in rows); x1 = max(r[2] for r in rows); t = rows[0][0]; b = rows[-1][0]",
  "        if 250 * k < x1 - x0 < 480 * k and 60 * k < b - t < 140 * k and t < 70 * k: box = [x0, t, x1, b]",
  "    if box:",
  "        pad = max(3, int(4 * k))",
  "        for y in range(max(0, box[1] - pad), min(h, box[3] + pad + 1)):",
  "            bg = px[sx, y]",
  "            for x in range(max(0, box[0] - pad), min(w, box[2] + pad + 1)): px[x, y] = bg",
  "        (rgb if mode == 'RGBA' else rgb.convert('RGB')).save(dst)",
  "    else:",
  "        shutil.copyfile(src, dst)",
  "    res[it['name']] = {'file': dst, 'island': box}",
  "json.dump(res, open(sys.argv[3], 'w'), indent=1)"
].join("\n");

/**
 * @param {{name:string,file:string}[]} screens
 * @param {string} outDir
 * @returns {Object<string,{file:string,island:number[]|null}>}
 */
function androidScreens(screens, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const index = path.join(outDir, "android.json");
  let done = {};
  try { done = JSON.parse(fs.readFileSync(index, "utf8")); } catch (e) {}
  // only captures that are new or changed since their cleaned copy
  const todo = screens.filter((s) => {
    const d = done[s.name];
    return !(d && fs.existsSync(d.file) && fs.statSync(d.file).mtimeMs >= fs.statSync(s.file).mtimeMs);
  });
  if (todo.length) {
    const list = path.join(outDir, "android-input.json"), res = path.join(outDir, "android-new.json");
    fs.writeFileSync(list, JSON.stringify(todo));
    try {
      execFileSync("python3", ["-I", "-c", PY, list, outDir, res], { timeout: 900000 });
      Object.assign(done, JSON.parse(fs.readFileSync(res, "utf8")));
      fs.writeFileSync(index, JSON.stringify(done, null, 1));
    } finally {
      for (const f of [list, res]) { try { fs.unlinkSync(f); } catch (e) {} }
    }
  }
  return done;
}

// point a timeline's screens (phone shots and fan cards) at cleaned copies
function androidTimeline(timeline, outDir) {
  const map = androidScreens(timeline.screens, outDir);
  timeline.screens = timeline.screens.map((s) => (map[s.name] ? { name: s.name, file: map[s.name].file } : s));
  return Object.keys(map).filter((k) => map[k].island).length;
}

module.exports = { androidScreens, androidTimeline };
