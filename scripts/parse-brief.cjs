#!/usr/bin/env node
/*
 * parse-brief.js — deterministic SUPER:/VO: script parser → beats JSON v2.
 *
 * The primary brief parser is Claude (it handles messy real-world scripts);
 * this parser is the deterministic path for the regular grammar, the offline
 * test harness, and the sanity cross-check on Claude's output.
 *
 * Grammar: lines starting "SUPER:" or "VO:". Wrapped lines are joined onto
 * the previous marker line. A SUPER matching /^\d+\.\s/ opens a section and
 * becomes a section-title beat. Pairing: a VO binds to the immediately
 * preceding unconsumed SUPER if one exists, else to the immediately
 * following SUPER; leftover SUPERs become standalone card beats. (Rule
 * verified against the full CommBank Yello corpus.)
 *
 * Usage:
 *   node scripts/parse-brief.js <script.md> --brand brands/kit.json \
 *     --brief-id commbank-yello-video1 --master-name YELLO_INTRO \
 *     --title "..." [--script-version N] [--prior prev-beats.json] [-o out.json]
 */
"use strict";
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------- args
const argv = process.argv.slice(2);
if (argv.length === 0) {
  console.error("usage: parse-brief.js <script.md> [--brand kit.json] [--brief-id id] [--master-name NAME] [--title T] [--script-version N] [--prior beats.json] [-o out.json]");
  process.exit(1);
}
const scriptPath = argv[0];
function opt(flag, dflt) {
  const i = argv.indexOf(flag);
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
}
const brandPath = opt("--brand", null);
const briefId = opt("--brief-id", path.basename(scriptPath).replace(/\.[^.]+$/, ""));
const masterName = opt("--master-name", briefId.toUpperCase().replace(/[^A-Z0-9]+/g, "_"));
const title = opt("--title", briefId);
const scriptVersion = Number(opt("--script-version", "1"));
const priorPath = opt("--prior", null);
const outPath = opt("-o", null);

// ---------------------------------------------------------------- helpers
function slug(s, max) {
  const k = s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return k.substring(0, max || 40).replace(/-+$/, "");
}
function normText(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function contentHash(sup, vo) {
  // djb2 over normalized text — stability matters, cryptography doesn't
  const s = normText(sup) + "|" + normText(vo);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
function spokenWords(text) {
  if (!text) return 0;
  let words = (text.match(/[A-Za-z0-9']+/g) || []).length;
  // URLs are spoken slowly: "commbank dot com dot au slash ..." — count extra
  const urls = text.match(/[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?/gi) || [];
  words += urls.length * 5;
  return words;
}

// ---------------------------------------------------------------- tokenize
const raw = fs.readFileSync(scriptPath, "utf8");
const items = []; // {type: "SUPER"|"VO", text}
for (const line of raw.split(/\r?\n/)) {
  const t = line.trim();
  if (t === "" || t.startsWith("#")) continue;
  const m = t.match(/^(SUPER|VO)\s*:\s*(.*)$/i);
  if (m) items.push({ type: m[1].toUpperCase(), text: m[2].trim(), consumed: false });
  else if (items.length > 0) items[items.length - 1].text += " " + t; // wrapped line
}

// ---------------------------------------------------------------- sections + pairing
const sections = [];
const beats = [];
let currentSection = null;

function sectionFor(superText) {
  const m = superText.match(/^(\d+)\.\s+(.*)$/);
  return m ? { num: m[1], title: m[2] } : null;
}

function inferPreset(sup, vo, isLast) {
  if (isLast && /[a-z0-9.-]+\.[a-z]{2,}/i.test(sup)) return "endcard";
  if (/\bapp\b/i.test(sup + " " + vo) && /tap|activat|in-app/i.test(sup + " " + vo)) return "uiWalkthrough";
  if (sup.includes(" / ")) return "listBuild";
  const frags = sup.split(/\.\s+/).filter((f) => f.trim().length > 0);
  if (frags.length >= 3 && frags.every((f) => f.split(/\s+/).length <= 4)) return "listBuild";
  return "titleCard";
}

for (let i = 0; i < items.length; i++) {
  const it = items[i];
  if (it.consumed) continue;
  if (it.type === "SUPER") {
    const sec = sectionFor(it.text);
    if (sec) {
      currentSection = { id: slug(sec.title, 30), title: it.text };
      sections.push(currentSection);
      beats.push({ _sup: it.text, _vo: "", _sec: currentSection.id, _isTitle: true });
      it.consumed = true;
      continue;
    }
    // standalone unless the next VO claims it (handled below) — defer
    continue;
  }
  // VO: prefer immediately preceding unconsumed non-section SUPER
  let sup = null;
  const prev = items[i - 1];
  if (prev && prev.type === "SUPER" && !prev.consumed && !sectionFor(prev.text)) sup = prev;
  else {
    const next = items[i + 1];
    if (next && next.type === "SUPER" && !next.consumed && !sectionFor(next.text)) sup = next;
  }
  if (sup) sup.consumed = true;
  it.consumed = true;
  beats.push({ _sup: sup ? sup.text : "", _vo: it.text, _sec: currentSection ? currentSection.id : null, _isTitle: false });
}
// leftover SUPERs → standalone cards, in original order (splice into position)
const standalone = [];
items.forEach((it, i) => {
  if (it.type === "SUPER" && !it.consumed) standalone.push({ idx: i, it });
});
for (const { idx, it } of standalone) {
  // find how many beats came from items before idx to keep script order
  let pos = 0;
  for (let i = 0; i < idx; i++) if (items[i].consumed && items[i].type !== "SUPER") pos++;
  // count consumed SUPER-title + standalone beats before too — simpler: rebuild below
  it._standalone = true;
}
// simpler ordered rebuild: walk items again, emitting in script order
const ordered = [];
{
  const emitted = new Set();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    for (const b of beats) {
      if (emitted.has(b)) continue;
      if ((it.type === "VO" && b._vo === it.text) || (it.type === "SUPER" && b._isTitle && b._sup === it.text)) {
        ordered.push(b);
        emitted.add(b);
        break;
      }
    }
    if (it.type === "SUPER" && it._standalone) {
      let sec = null;
      for (let j = i; j >= 0 && !sec; j--) {
        const s = items[j].type === "SUPER" ? sectionFor(items[j].text) : null;
        if (s) sec = slug(s.title, 30);
      }
      ordered.push({ _sup: it.text, _vo: "", _sec: sec, _isTitle: false });
    }
  }
  for (const b of beats) if (!emitted.has(b) && !ordered.includes(b)) ordered.push(b);
}

// ---------------------------------------------------------------- brand kit
let kit = null;
if (brandPath) kit = JSON.parse(fs.readFileSync(brandPath, "utf8"));
const kd = (kit && kit.defaults) || {};

// ---------------------------------------------------------------- prior beatId inheritance
let prior = null;
if (priorPath) prior = JSON.parse(fs.readFileSync(priorPath, "utf8"));
function inheritBeatId(sup, vo) {
  if (!prior || !prior.beats) return null;
  const n = normText(sup) + "|" + normText(vo);
  for (const pb of prior.beats) {
    if (normText(pb.superText) + "|" + normText(pb.vo) === n && pb.beatId) return pb.beatId;
  }
  return null;
}

// ---------------------------------------------------------------- emit beats v2
const TRANSIT_CYCLE = ["lateralTruck", "crane", "whipOrbit", "dollyZoom"];
const usedIds = new Set();
let cycleIdx = 0;
const outBeats = ordered.map((b, i) => {
  const isLast = i === ordered.length - 1;
  const preset = b._isTitle ? "titleCard" : inferPreset(b._sup, b._vo, isLast);
  let beatId = inheritBeatId(b._sup, b._vo) || slug(b._sup || b._vo, 36) + (b._isTitle ? "-title" : "");
  while (usedIds.has(beatId)) beatId += "-2";
  usedIds.add(beatId);
  let transitIn;
  if (i === 0) transitIn = "none";
  else if (preset === "endcard") transitIn = "dollyPush";
  else if (b._isTitle) transitIn = "dollyPush";
  else transitIn = TRANSIT_CYCLE[cycleIdx++ % TRANSIT_CYCLE.length];
  const entrance = preset === "listBuild" ? "listCascade" : "fadeRise";
  const beat = {
    id: i + 1,
    beatId,
    sectionId: b._sec,
    contentHash: contentHash(b._sup, b._vo),
    vo: b._vo,
    voSpokenWords: spokenWords(b._vo),
    superText: b._sup,
    stylePreset: preset,
    durationSec: null,
    transitIn,
    motion: {
      ease: kd.easeProfile || "corporate-smooth",
      entrance,
      exit: entrance,
      handycam: kd.handycam || "subtle"
    }
  };
  if (preset === "endcard") {
    const url = (b._sup.match(/[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?/i) || [""])[0].replace(/[.,]$/, "");
    if (url) beat.url = url;
    // on-screen headline = short pre-comma clause (mirrors apostle.jsx endcardHeadline)
    const hm = b._sup.match(/^([^,]{3,60}),/);
    beat.headline = hm ? hm[1] : b._sup;
  }
  if (preset === "uiWalkthrough") beat.uiStates = 1;
  return beat;
});

const doc = {
  meta: {
    schemaVersion: 2,
    briefId,
    scriptVersion,
    sourceScriptPath: path.relative(path.join(__dirname, ".."), path.resolve(scriptPath)),
    title,
    fps: kd.fps || 25,
    resolution: kd.resolution || [1920, 1080],
    wpm: kd.wpm || 150,
    layout: kd.layout || "gallery",
    masterName,
    rig: "auto"
  },
  sections,
  brand: kit
    ? {
        kitId: kit.kitId,
        fontHeadingPS: kit.fontHeadingPS,
        fontBodyPS: kit.fontBodyPS,
        headingSize: kit.headingSize,
        bodySize: kit.bodySize,
        headingTracking: kit.headingTracking,
        bodyTracking: kit.bodyTracking,
        safeMarginPct: kit.safeMarginPct,
        colors: kit.colors,
        logo: kit.logo
      }
    : {},
  beats: outBeats
};

// ---------------------------------------------------------------- stats + out
const voItems = items.filter((x) => x.type === "VO").length;
const supItems = items.filter((x) => x.type === "SUPER").length;
const stats = {
  superLines: supItems,
  voLines: voItems,
  sections: sections.length,
  beats: outBeats.length,
  vosPaired: outBeats.filter((b) => b.vo && b.superText).length,
  standaloneSupers: outBeats.filter((b) => !b.vo).length,
  totalSpokenWords: outBeats.reduce((a, b) => a + b.voSpokenWords, 0),
  inheritedBeatIds: prior ? outBeats.filter((b) => prior.beats.some((p) => p.beatId === b.beatId)).length : null
};
if (outPath) {
  fs.writeFileSync(outPath, JSON.stringify(doc, null, 2));
  console.log(JSON.stringify({ wrote: outPath, stats }, null, 2));
} else {
  console.log(JSON.stringify(doc, null, 2));
  console.error(JSON.stringify(stats));
}
