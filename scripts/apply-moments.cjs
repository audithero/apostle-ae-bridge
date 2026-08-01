#!/usr/bin/env node
/**
 * apply-moments — build timed supers + native vector illustration into
 * the scene comps of a master, from a moments JSON.
 *
 * A scene precomp holds one beat of VO, which is usually several ideas
 * long. A "moment" is one idea: a super line, an optional sub, and an
 * illustration, alive for its slice of the beat. Moment windows are
 * fractions of the beat's VO window, so a retime never invalidates the
 * file — re-run this after retimeBeats and the seconds recompute.
 *
 * Usage:
 *   node scripts/apply-moments.cjs <moments.json> [--scenes 1,3,4] [--dry]
 *
 *   --scenes  1-based indexes into the JSON's scenes[]; default all
 *   --dry     validate + print the resolved plan, touch nothing in AE
 *
 * Example:
 *   node scripts/apply-moments.cjs briefs/commbank-yello/moments/video1.json
 *
 * The interpreter is APOSTLE.applyMoments in apostle/apostle.jsx — this
 * is only the CLI face of it, so the panel and the CLI share one code
 * path (repo rule: never fork logic out of the library).
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");

// "placeholder" is a deliberate gap for artwork the build cannot draw
// (real card art, partner logos, app screenshots) — it renders an outlined
// frame captioned with what belongs there.
const LAYOUTS = ["statement", "hero", "iconRow", "chipRow", "device", "compare", "hub", "endcard", "placeholder"];

function aeShellCall(fnName, args, timeoutSec) {
  const lit = (args || []).map((a) => (a === undefined || a === null) ? "null" : JSON.stringify(a)).join(", ");
  const tmp = path.join(os.tmpdir(), "apostle-moments-" + Date.now() + ".jsx");
  const loader =
    'if (typeof $.global.APOSTLE === "undefined") { $.evalFile(new File(' +
    JSON.stringify(path.join(REPO, "apostle", "apostle.jsx")) + ")); }\n";
  fs.writeFileSync(tmp, loader + "var r = $.global.APOSTLE." + fnName + "(" + lit + ");\nreturn r;");
  const t = String(timeoutSec || 180);
  let raw;
  try {
    raw = execFileSync(path.join(REPO, "scripts", "bridge-exec.sh"),
      ["executeScript", "--file", tmp, t], { encoding: "utf8", timeout: (Number(t) + 15) * 1000 });
  } catch (e) {
    raw = execFileSync(path.join(REPO, "scripts", "ae-run.sh"),
      [tmp, t], { encoding: "utf8", timeout: (Number(t) + 15) * 1000 });
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) {}
  }
  const outer = JSON.parse(raw);
  if (outer.status !== "success" && outer.status !== "ok") {
    throw new Error("AE transport error: " + raw.slice(0, 400));
  }
  const inner = outer.result !== undefined ? outer.result : null;
  if (typeof inner === "string") { try { return JSON.parse(inner); } catch (e) { return inner; } }
  return inner;
}

function validate(doc) {
  const errs = [];
  if (!doc.meta || !doc.meta.masterName) errs.push("meta.masterName is required");
  const scenes = doc.scenes || [];
  if (!scenes.length) errs.push("no scenes");
  scenes.forEach((sc, si) => {
    const where = "scenes[" + si + "]";
    if (!sc.beatId && !sc.comp) errs.push(where + ": needs beatId or comp");
    const ms = sc.moments || [];
    if (!ms.length) errs.push(where + ": no moments");
    let prevTo = 0;
    ms.forEach((m, mi) => {
      const w = where + ".moments[" + mi + "]" + (m.id ? " (" + m.id + ")" : "");
      if (m.layout && LAYOUTS.indexOf(m.layout) === -1) {
        errs.push(w + ": unknown layout '" + m.layout + "' (want one of " + LAYOUTS.join(", ") + ")");
      }
      const hasSec = m.atSec !== undefined && m.toSec !== undefined;
      if (!hasSec) {
        if (typeof m.from !== "number" || typeof m.to !== "number") {
          errs.push(w + ": needs from/to fractions (or atSec/toSec)");
        } else {
          if (m.from < 0 || m.to > 1) errs.push(w + ": from/to must sit inside 0..1");
          if (m.to <= m.from) errs.push(w + ": to must be greater than from");
          // gaps are legal (a deliberate breath) but overlaps double-expose
          if (m.from < prevTo - 1e-9) errs.push(w + ": overlaps the previous moment (from " + m.from + " < prev to " + prevTo + ")");
          prevTo = m.to;
        }
      }
      if (!m["super"] && m.layout !== "hub") errs.push(w + ": no super text");
    });
  });
  return errs;
}

function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv[0] === "-h" || argv[0] === "--help") {
    console.log(fs.readFileSync(__filename, "utf8").split("*/")[0].split("/**")[1].replace(/^\s*\* ?/gm, ""));
    process.exit(0);
  }
  const file = path.resolve(argv[0]);
  const dry = argv.indexOf("--dry") !== -1;
  const si = argv.indexOf("--scenes");
  const only = si !== -1 && argv[si + 1]
    ? argv[si + 1].split(",").map((n) => parseInt(n, 10))
    : null;

  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  const errs = validate(doc);
  if (errs.length) {
    console.error("moments file is invalid:");
    errs.forEach((e) => console.error("  - " + e));
    process.exit(1);
  }

  if (only) {
    doc.scenes = doc.scenes.filter((_, i) => only.indexOf(i + 1) !== -1);
    if (!doc.scenes.length) { console.error("--scenes matched nothing"); process.exit(1); }
  }

  const total = doc.scenes.reduce((n, s) => n + (s.moments || []).length, 0);
  console.log("master:  " + doc.meta.masterName);
  console.log("scenes:  " + doc.scenes.length + "   moments: " + total);
  doc.scenes.forEach((sc) => {
    console.log("  " + (sc.beatId || sc.comp));
    (sc.moments || []).forEach((m) => {
      const win = (m.atSec !== undefined)
        ? m.atSec + "s-" + m.toSec + "s"
        : (m.from.toFixed(3) + "-" + m.to.toFixed(3));
      console.log("    " + String(m.id || "?").padEnd(4) + " " + String(m.layout || "statement").padEnd(10) + " " + win.padEnd(14) + " " + JSON.stringify(m["super"] || ""));
    });
  });

  if (dry) { console.log("\n--dry: nothing sent to After Effects."); return; }

  const res = aeShellCall("applyMoments", [doc], 240);
  console.log("\napplyMoments -> " + res.status);
  (res.scenes || []).forEach((s) => {
    console.log("  " + (s.comp || s.beatId) + "  moments=" + s.moments + " layers=" + s.layers + (s.error ? "  ERROR: " + s.error : ""));
  });
  (res.warnings || []).forEach((w) => console.log("  warning: " + w));
  if (res.status !== "success") process.exit(2);
}

if (require.main === module) main();
module.exports = { validate, aeShellCall };
