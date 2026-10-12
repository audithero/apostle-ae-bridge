#!/usr/bin/env node
/*
 * build-instructional.cjs: plan -> timeline -> built comp (the 2D
 * "instructional" stage, apostle/instructional.jsx).
 *
 *   node scripts/build-instructional.cjs <plan.json> [--dry] [--timeline-only]
 *
 * --dry            compile and print the timeline summary, touch nothing
 * --timeline-only  also write the timeline JSON, but do not build in AE
 * --replace        remove this name's previous build first (else "<name> rebuild N")
 *
 * The timeline lands in .apostle-runs/instructional/<name>.timeline.json; AE
 * reads it from there (no giant script literals). Never saves the project.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { compileInstructional } = require("./lib/compile-instructional.cjs");

const REPO = path.resolve(__dirname, "..");

function runJsx(body, timeoutSec) {
  const tmp = path.join(os.tmpdir(), "apostle-instr-" + Date.now() + ".jsx");
  fs.writeFileSync(tmp, body);
  try {
    const raw = execFileSync(path.join(REPO, "scripts", "ae-run.sh"), [tmp, String(timeoutSec)], { encoding: "utf8", timeout: (timeoutSec + 30) * 1000 });
    const outer = JSON.parse(raw);
    if (outer.status !== "ok" && outer.status !== "success") throw new Error("AE: " + raw.slice(0, 500));
    return typeof outer.result === "string" ? JSON.parse(outer.result) : outer.result;
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) {}
  }
}

function main() {
  const argv = process.argv.slice(2);
  if (!argv[0]) { console.error("usage: build-instructional.cjs <plan.json> [--dry] [--timeline-only]"); process.exit(1); }
  const planPath = path.resolve(argv[0]);
  const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  const { timeline, warnings } = compileInstructional(plan, { repo: REPO });
  console.log(timeline.name + ": " + timeline.duration + "s, " + timeline.cards.length + " cards, " + timeline.pages.length + " pages, " +
    timeline.items.length + " items, " + timeline.shots.length + " screen changes, " + timeline.rings.length + " rings, " +
    timeline.props.length + " props, " + timeline.captions.length + " captions");
  warnings.forEach((w) => console.log("  warn: " + w));
  if (argv.includes("--dry")) return;
  const dir = path.join(REPO, ".apostle-runs", "instructional");
  fs.mkdirSync(dir, { recursive: true });
  const tlPath = path.join(dir, timeline.name + ".timeline.json");
  fs.writeFileSync(tlPath, JSON.stringify(timeline, null, 1));
  console.log("timeline: " + path.relative(REPO, tlPath));
  if (argv.includes("--timeline-only")) return;
  const res = runJsx(
    '$.evalFile(new File($.global.APOSTLE_REPO + "/apostle/apostle.jsx"));\n' +
    '$.evalFile(new File($.global.APOSTLE_REPO + "/apostle/instructional.jsx"));\n' +
    "return $.global.APOSTLE_INSTR.build(" + JSON.stringify(tlPath) + ", { replace: " + (argv.includes("--replace") ? "true" : "false") + " });", 1800);
  console.log(JSON.stringify(res, null, 1));
  if (res.status !== "success") process.exit(2);
}

if (require.main === module) main();
module.exports = { runJsx };
