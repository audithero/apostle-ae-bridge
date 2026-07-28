#!/usr/bin/env node
/*
 * diff-beats.cjs — compare two beats JSON versions → surgical edit plan.
 *
 * Matching: beatId first (parse-brief.cjs --prior inherits IDs, so a
 * re-parsed revision normally matches everything); unmatched beats then
 * fuzzy-match on normalized superText word overlap (Jaccard >= 0.5) and
 * inherit the old beatId into the plan. Whatever still doesn't match is
 * added/removed.
 *
 * Plan consumers: updateBeatText per textChanges entry, then one
 * retimeBeats with the new file when timingImpact is non-empty.
 *
 * Usage: node scripts/diff-beats.cjs old.json new.json [-o plan.json]
 */
"use strict";
const fs = require("fs");

const [oldPath, newPath] = process.argv.slice(2);
if (!oldPath || !newPath) {
  console.error("usage: diff-beats.cjs old.json new.json [-o plan.json]");
  process.exit(1);
}
const oi = process.argv.indexOf("-o");
const outPath = oi !== -1 ? process.argv[oi + 1] : null;

const oldDoc = JSON.parse(fs.readFileSync(oldPath, "utf8"));
const newDoc = JSON.parse(fs.readFileSync(newPath, "utf8"));

const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const words = (s) => new Set(norm(s).split(" ").filter(Boolean));
function jaccard(a, b) {
  const A = words(a), B = words(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

const oldBeats = oldDoc.beats || [];
const newBeats = newDoc.beats || [];
const matchedOld = new Set();
const pairs = []; // {oldBeat, newBeat, how}

for (const nb of newBeats) {
  const ob = oldBeats.find((o) => o.beatId && o.beatId === nb.beatId && !matchedOld.has(o));
  if (ob) { matchedOld.add(ob); pairs.push({ ob, nb, how: "beatId" }); }
}
for (const nb of newBeats) {
  if (pairs.some((p) => p.nb === nb)) continue;
  let best = null, bestScore = 0;
  for (const ob of oldBeats) {
    if (matchedOld.has(ob)) continue;
    const score = jaccard(ob.superText || ob.vo, nb.superText || nb.vo);
    if (score > bestScore) { bestScore = score; best = ob; }
  }
  if (best && bestScore >= 0.5) {
    matchedOld.add(best);
    pairs.push({ ob: best, nb, how: "fuzzy:" + bestScore.toFixed(2) });
    nb.beatId = best.beatId; // inherit identity into the plan
  }
}

const textChanges = [];
const timingImpact = [];
const motionChanges = [];
for (const { ob, nb, how } of pairs) {
  const tc = { beatId: ob.beatId, matchedBy: how };
  let changed = false;
  if (norm(ob.superText) !== norm(nb.superText)) {
    tc.superText = nb.superText;
    tc.oldSuperText = ob.superText;
    changed = true;
  }
  if ((ob.url || null) !== (nb.url || null)) { tc.url = nb.url || null; changed = true; }
  if (norm(ob.vo) !== norm(nb.vo)) { tc.vo = nb.vo; tc.voChanged = true; changed = true; }
  if (changed) textChanges.push(tc);
  if (
    (ob.voSpokenWords || 0) !== (nb.voSpokenWords || 0) ||
    (ob.durationSec || null) !== (nb.durationSec || null) ||
    (ob.transitIn || "") !== (nb.transitIn || "")
  ) timingImpact.push(ob.beatId);
  if (JSON.stringify(ob.motion || {}) !== JSON.stringify(nb.motion || {})) {
    motionChanges.push({ beatId: ob.beatId, motion: nb.motion });
  }
}
const added = newBeats
  .filter((nb) => !pairs.some((p) => p.nb === nb))
  .map((nb) => ({ beatId: nb.beatId, superText: nb.superText, afterBeatId: (() => {
    const idx = newBeats.indexOf(nb);
    return idx > 0 ? newBeats[idx - 1].beatId : null;
  })() }));
const removed = oldBeats.filter((ob) => !matchedOld.has(ob)).map((ob) => ob.beatId);
// order changed iff matched beats, walked in NEW script order, don't have
// strictly increasing OLD positions
const orderChanged = (() => {
  const inNewOrder = pairs.slice().sort((a, b) => newBeats.indexOf(a.nb) - newBeats.indexOf(b.nb));
  let prev = -1;
  for (const p of inNewOrder) {
    const oldIdx = oldBeats.indexOf(p.ob);
    if (oldIdx < prev) return true;
    prev = oldIdx;
  }
  return false;
})();

const plan = {
  master: (oldDoc.meta && oldDoc.meta.masterName) || null,
  oldScriptVersion: oldDoc.meta && oldDoc.meta.scriptVersion,
  newScriptVersion: newDoc.meta && newDoc.meta.scriptVersion,
  textChanges,
  timingImpact,
  motionChanges,
  added,
  removed,
  orderChanged,
  needsRetime: timingImpact.length > 0 || added.length > 0 || removed.length > 0 || orderChanged,
  summary: `${textChanges.length} text change(s), ${added.length} added, ${removed.length} removed, ${timingImpact.length} timing-affecting, order ${orderChanged ? "CHANGED" : "unchanged"}`
};

// --canonical <path>: write the new doc back out with fuzzy-inherited
// beatIds applied, so downstream consumers (retimeBeats, the next diff's
// --prior) address beats by their stable identity. Without it a fuzzy
// match exists only in the plan and retime can't find the scene comp.
const ci = process.argv.indexOf("--canonical");
if (ci !== -1 && process.argv[ci + 1]) {
  fs.writeFileSync(process.argv[ci + 1], JSON.stringify(newDoc, null, 2));
}

if (outPath) {
  fs.writeFileSync(outPath, JSON.stringify(plan, null, 2));
  console.log(plan.summary + " -> " + outPath);
} else {
  console.log(JSON.stringify(plan, null, 2));
}
