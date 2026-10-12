/*
 * compile-spec.cjs: video spec -> { beats, moments } docs, deterministically.
 *
 * The spec is what the model writes (see apostle/video-spec-schema.json):
 * sections, beats with their verbatim VO, and per-beat moments chosen from
 * the library's layouts. Everything with a number in it is computed here,
 * never by the model: beat durations, the readability floor, moment windows.
 *
 * This is the Node successor of scripts/make-video.py and produces the same
 * output for a measured spec (beats carry absolute `start` seconds, moments
 * carry `at`). It adds two timing modes so a build can happen before any VO
 * is recorded, and moments can be placed by what is SAID rather than when:
 *
 *   timing.mode "wpm"      estimate from word counts at timing.wpm (default 150)
 *   timing.mode "words"    align to a vo-align.py words.json (recorded VO)
 *   timing.mode "measured" beats[].start + spec.end given in seconds
 *
 * In "wpm" and "words" modes a moment is placed by `cue`: the verbatim
 * opening words of the VO where that idea starts. The first moment of a
 * beat starts with the beat and needs no cue.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { LIST_LAYOUTS } = require("./capabilities.cjs");

const HEAD = 2.0;          // computeTiming's fixed pre-roll before beat 1
const TAIL_BUFFER = 6.0;   // applyMoments: voDur = comp.duration - tailBuffer
const VO_LEAD_IN = 0.45;
const BEAT_PAD = 0.8;      // computeTiming pads every VO beat by this much
const FLOOR = 1.8;         // computeTiming's readability floor
const ROTATION = ["lateralTruck", "crane", "whipOrbit", "dollyZoom"];
const TRANSIT_SEC = { dollyPush: 1.1, lateralTruck: 1.0, whipOrbit: 0.75, crane: 1.3, dollyZoom: 1.0, none: 0.0 };

function beatIdFrom(text, n) {
  const s = String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s.slice(0, 36).replace(/-+$/, "") || "beat-" + n;
}

// words as spoken, for matching: lowercase, apostrophes dropped so
// "customer's" and "customers" both land on one token
function tokens(text) {
  return (String(text || "").toLowerCase().replace(/['’]/g, "").match(/[a-z0-9]+/g)) || [];
}

// index of the first token of `cue` inside `toks`, searching from `from`
function findCue(toks, cue, from) {
  const c = tokens(cue);
  if (!c.length) return -1;
  for (let i = from || 0; i + c.length <= toks.length; i++) {
    let ok = true;
    for (let j = 0; j < c.length; j++) { if (toks[i + j] !== c[j]) { ok = false; break; } }
    if (ok) return i;
  }
  return -1;
}

function transitFor(b, i) {
  if (b.transit) return b.transit;
  return i === 0 ? "none" : ROTATION[(i - 1) % ROTATION.length];
}

// --- recorded VO alignment ------------------------------------------------
// words.json comes in two shapes: [{w,t0,t1}] (current) and [[t0,t1,w]]
// (vo-align.py's raw tuples). Whisper splits contractions ("we", "'ve") and
// spells numbers its own way, so alignment runs on a letters-and-digits
// character stream, not on word tokens.
function loadWords(file) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  return raw.map((x) => Array.isArray(x) ? { w: x[2], t0: x[0], t1: x[1] } : x);
}

function charStream(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function makeAligner(words) {
  let s = "";
  const times = [];
  const wordAt = [];   // char index -> index into `spoken`
  // drop punctuation tokens and whisper's bracketed tags, which arrive in
  // fragments: "[", "BL", "ANK", "_", "AUD", "IO", "]"
  const spoken = [];
  let inTag = false;
  for (const w of words) {
    const t = String(w.w || "");
    if (t.indexOf("[") !== -1) inTag = true;
    if (!inTag && charStream(t).length) spoken.push(w);
    if (t.indexOf("]") !== -1) inTag = false;
  }
  const wordStart = [];
  spoken.forEach((w, wi) => {
    const c = charStream(w.w);
    wordStart.push(s.length);
    for (let k = 0; k < c.length; k++) { times.push(w.t0); wordAt.push(wi); }
    s += c;
  });
  const end = words.length ? words[words.length - 1].t1 : 0;
  let cursor = 0;
  const find = (probe, window) => {
    const at = s.indexOf(probe, cursor);
    return (at === -1 || at - cursor > window) ? -1 : at;
  };
  // Time at which `text` starts, searching forward from the last match.
  // Whisper spells some words its own way ("Com Bank" for "CommBank",
  // digits for numbers), so if the opening words miss, probe from a few
  // words in and step back that many recognised words. `expectedFrac`
  // (0..1 through the whole script) is the last resort. `maxAhead` caps how
  // far past the cursor a match may land, in characters: a cue cannot be
  // further on than the rest of its own beat, and without the cap a misheard
  // word ("own" for "earn") lets a probe match the NEXT time the phrase is said.
  return {
    end,
    locate(text, expectedFrac, warn, maxAhead) {
      const window = maxAhead || 2000;
      const tw = String(text || "").split(/\s+/).filter((x) => charStream(x).length);
      if (!tw.length) return null;
      for (let k = 0; k < Math.min(6, tw.length); k++) {
        let probe = charStream(tw.slice(k, k + 4).join(""));
        if (probe.length < 8 && k + 4 < tw.length) continue;
        probe = probe.slice(0, 24);
        const at = find(probe, window);
        if (at === -1) continue;
        // step back by the CHARACTERS of the skipped script words (whisper
        // may split or join them differently), then snap to the nearest
        // word start
        const p0 = Math.max(0, at - charStream(tw.slice(0, k).join("")).length);
        let wi = wordAt[p0];
        const len = charStream(spoken[wi].w).length;
        if (p0 - wordStart[wi] > len / 2 && wi + 1 < spoken.length) wi++;
        cursor = Math.max(cursor, at - 1);
        return spoken[wi].t0;
      }
      // a miss must not move the cursor: jumping it to the guess skips past
      // the beats that follow and turns one miss into a cascade
      const at = Math.max(cursor, Math.min(s.length - 1, Math.round(expectedFrac * s.length)));
      if (warn) warn("VO alignment: could not find \"" + String(text).slice(0, 40) + "\" in words.json; placed proportionally at " + (times[at] || 0).toFixed(2) + "s");
      return times[at] || 0;
    }
  };
}

// --- main ----------------------------------------------------------------

/**
 * @param {object} spec  video spec
 * @param {object} opts  { kit, repo, spokenWords(text) }
 * @returns {{beats, moments, warnings, summary}}
 */
function compileSpec(spec, opts) {
  opts = opts || {};
  const repo = opts.repo || path.resolve(__dirname, "..", "..");
  const kit = opts.kit || null;
  const spoken = opts.spokenWords || ((t) => tokens(t).length);
  const warnings = [];
  const warn = (m) => warnings.push(m);

  const timing = spec.timing || { mode: spec.end !== undefined ? "measured" : "wpm" };
  const mode = timing.mode || "wpm";
  const wpm = timing.wpm || 150;
  const name = spec.name;
  const built = name + (spec.version || "_v001");
  const tail = spec.tail !== undefined ? spec.tail : 2.5;

  let beatsIn = (spec.beats || []).map((b) => Object.assign({}, b, { moments: (b.moments || []).map((m) => Object.assign({}, m)) }));
  const title = spec.titleCard || null;
  // with a title card in front, no spoken beat may cut in: drop "none"
  // and index transits as if the card were already beat 1
  const off = title ? 1 : 0;
  if (title) beatsIn.forEach((b) => { if (b.transit === "none") delete b.transit; });

  // 1. absolute VO-timeline starts for every beat, and each moment's `at`
  let end;
  if (mode === "measured") {
    end = spec.end;
    if (end === undefined) throw new Error("timing.mode measured needs spec.end");
  } else if (mode === "words") {
    const wf = path.isAbsolute(timing.words) ? timing.words : path.join(repo, timing.words);
    const aligner = makeAligner(loadWords(wf));
    const all = beatsIn.map((b) => charStream(b.vo).length);
    const total = all.reduce((a, b) => a + b, 0) || 1;
    let acc = 0;
    beatsIn.forEach((b, i) => {
      b.start = aligner.locate(b.vo, acc / total, warn);
      if (i === 0 && b.start > 0.6) warn("first spoken word is at " + b.start.toFixed(2) + "s into the recording");
      const toks = tokens(b.vo);
      let last = 0;
      b.moments.forEach((m, k) => {
        if (k === 0 && !m.cue) { m.at = b.start; return; }
        // the search runs from the previous anchor, so the window spans the
        // rest of the beat measured from there, not from this cue
        const rest = charStream(toks.slice(last).join(""));
        const idx = findCue(toks, m.cue, last);
        last = Math.max(0, idx);
        const frac = acc / total + (idx / Math.max(1, toks.length)) * (all[i] / total);
        m.at = aligner.locate(toks.slice(idx).join(" "), frac, warn, Math.round(rest.length * 1.25) + 40);
      });
      acc += all[i];
    });
    end = aligner.end;
  } else {
    // wpm: a beat lasts its spoken time plus the pad, raised to the floor
    // computeTiming would otherwise apply silently (and break the moments)
    const voSec = beatsIn.map((b) => (b.vo ? spoken(b.vo) / (wpm / 60) : 0));
    const durs = beatsIn.map((b, i) => (b.vo ? voSec[i] + BEAT_PAD : (b.holdSec || 3.0)));
    beatsIn.forEach((b, i) => {
      const tIn = tsec(transitFor(b, i + off));
      const nxt = beatsIn[i + 1];
      const tOut = nxt ? tsec(transitFor(nxt, i + 1 + off)) : 0;
      // +0.01: AE's computeTiming does the same float arithmetic, and
      // 4.6 - 1.3 - 0.2 - 1.3 is 1.7999..., which it would stretch again
      const need = Math.ceil((FLOOR + tIn + 0.2 + tOut + 0.01) * 100) / 100;
      if (durs[i] < need) durs[i] = need;
    });
    let t = 0;
    beatsIn.forEach((b, i) => {
      b.start = t;
      const toks = tokens(b.vo);
      let last = 0;
      b.moments.forEach((m, k) => {
        if (k === 0 && !m.cue) { m.at = t; return; }
        const idx = findCue(toks, m.cue, last);
        last = Math.max(0, idx);
        m.at = t + (toks.length ? (idx / toks.length) * voSec[i] : 0);
      });
      t += durs[i];
    });
    // the last beat's tail is added below; `end` is where speech stops
    end = t - (beatsIn.length ? BEAT_PAD : 0);
  }

  // 2. a leading title card holds a super the VO never says, so it runs
  // BEFORE the first spoken word and pushes the VO back by its length
  if (title) {
    const first = beatsIn[0];
    beatsIn = [{
      start: first.start - title.dur, silent: true, section: first.section, vo: "", transit: "none",
      moments: [{ id: "m1", at: first.start - title.dur, layout: title.layout || "statement", super: title.super, sub: title.sub || "" }]
    }].concat(beatsIn);
  }
  const voOffset = HEAD + (title ? title.dur : 0);

  // 3. beats + moments, exactly as make-video.py lays them out
  const beats = [], scenes = [];
  const usedIds = {};
  beatsIn.forEach((b, i) => {
    const nxt = i + 1 < beatsIn.length ? beatsIn[i + 1].start : end;
    let dur = round(nxt - b.start, 2);
    if (i === beatsIn.length - 1) dur = round(dur + tail, 2);
    let bid = b.id || beatIdFrom(b.vo, i + 1);
    if (usedIds[bid]) bid = bid.slice(0, 32) + "-" + (i + 1);
    usedIds[bid] = true;
    const transit = transitFor(b, i);
    let preset = b.preset;
    if (!preset) {
      if (b.moments.some((m) => m.layout === "screen")) preset = "uiWalkthrough";
      else preset = b.moments.some((m) => LIST_LAYOUTS.indexOf(m.layout) !== -1) ? "listBuild" : "titleCard";
    }
    const entrance = preset === "listBuild" ? "listCascade" : "fadeRise";

    const nxtB = beatsIn[i + 1];
    const nxtTransit = nxtB ? tsec(transitFor(nxtB, i + 1)) : 0;
    const rest = dur - tsec(transit) - 0.2 - nxtTransit;
    if (rest < FLOOR - 1e-6) {
      warn("beat " + (i + 1) + " (" + bid + ") has only " + rest.toFixed(2) + "s of settled hold; computeTiming will stretch it" + (mode === "wpm" ? "" : " and break VO lock"));
    }

    beats.push({
      id: i + 1, beatId: bid, sectionId: b.section,
      vo: b.vo || "", superText: (b.moments[0] && b.moments[0].super) || "",
      voSpokenWords: b.vo ? spoken(b.vo) : 0,
      silent: !!b.silent || !b.vo,
      stylePreset: preset, durationSec: dur,
      voWindow: [round(b.start, 2), round(nxt, 2)],
      transitIn: transit,
      motion: { ease: spec.easeProfile || "corporate-smooth", entrance, exit: entrance, handycam: "subtle" }
    });

    const moments = [];
    b.moments.forEach((m, k) => {
      const at = m.at;
      let to = k + 1 < b.moments.length ? b.moments[k + 1].at : nxt;
      if (k === b.moments.length - 1 && i === beatsIn.length - 1) to = nxt + tail;
      const mm = {};
      for (const key of Object.keys(m)) { if (key !== "at" && key !== "cue" && key !== "why") mm[key] = m[key]; }
      if (!mm.id) mm.id = "m" + (k + 1);
      mm.from = round(Math.max(0, at - b.start) / dur, 4);
      mm.to = round(Math.min(dur, to - b.start) / dur, 4);
      mm.voSec = [round(at, 2), round(to, 2)];
      if (m.cue) mm.voCue = m.cue;
      moments.push(mm);
    });
    scenes.push({ beatId: bid, beatDurationSec: dur, moments });
  });

  const total = round(HEAD + beats.reduce((a, b) => a + b.durationSec, 0), 2);
  const brand = kit ? pick(kit, ["fontHeadingPS", "fontBodyPS", "headingSize", "bodySize", "headingTracking", "bodyTracking", "safeMarginPct", "colors", "logo"]) : {};
  if (kit) brand.kitId = kit.kitId;
  const fmt = spec.format || {};

  const beatsDoc = {
    meta: {
      schemaVersion: 2, briefId: spec.briefId, scriptVersion: spec.scriptVersion || 1,
      sourceScriptPath: spec.script || null, title: name,
      fps: fmt.fps || 25, resolution: fmt.resolution || [1920, 1080], wpm,
      layout: spec.stage || "gallery", masterName: name, rig: "auto",
      easeProfile: spec.easeProfile || "corporate-smooth",
      brandKit: kit ? kit.kitId : null,
      timingMode: mode,
      note: mode === "wpm"
        ? "durationSec is ESTIMATED at " + wpm + " wpm (no VO recorded yet). Re-run compile with timing.mode words once it is."
        : "durationSec is MEASURED from the recorded VO. Each beat runs to the next beat's first spoken word. VO layer sits at startTime meta.voOffsetSec.",
      voOffsetSec: round(voOffset, 2), voFiles: spec.voFiles || []
    },
    assets: spec.assets || undefined,
    sections: spec.sections || [],
    brand,
    beats
  };

  const pal = momentsPalette(kit);
  const momentsDoc = {
    meta: {
      briefId: spec.briefId, masterName: built, scriptVersion: spec.scriptVersion || 1,
      easeProfile: spec.easeProfile || "corporate-smooth",
      voLeadIn: VO_LEAD_IN, tailBuffer: TAIL_BUFFER,
      brandKit: kit ? kit.kitId : null,
      note: "Windows are fractions of each beat's VO window. meta.masterName is rewritten to the real versioned comp at build time."
    },
    palette: pal,
    scenes
  };
  if (spec.textReveal === false) momentsDoc.meta.textReveal = false;

  return {
    beats: beatsDoc,
    moments: momentsDoc,
    warnings,
    summary: built + ": " + beats.length + " beats, " + scenes.reduce((n, s) => n + s.moments.length, 0) + " moments, total " + total + "s (" + mode + " timing)"
  };
}

// a kit without a moments block still gets a coherent palette from its colours
function momentsPalette(kit) {
  if (kit && kit.moments && kit.moments.palette) {
    const pal = Object.assign({}, kit.moments.palette);
    for (const k of ["tileShape", "tileFill", "plateFill", "plateStroke"]) {
      if (kit.moments[k] !== undefined) pal[k] = kit.moments[k];
    }
    return pal;
  }
  const c = (kit && kit.colors) || {};
  return {
    ink: c.text || "#000000", brand: c.primary || "#FFCC00", paper: c.background || "#FFFFFF",
    hole: c.background || "#FFFFFF", muted: c.secondary || "#E5E5E5",
    tileShape: "circle", tileFill: "paper", plateFill: "paper", plateStroke: "ink"
  };
}

function tsec(t) {
  return TRANSIT_SEC[t] !== undefined ? TRANSIT_SEC[t] : 1.0;
}
function pick(o, keys) {
  const r = {};
  for (const k of keys) if (o[k] !== undefined) r[k] = o[k];
  return r;
}
function round(x, n) {
  const p = Math.pow(10, n);
  return Math.round(x * p) / p;
}

module.exports = { compileSpec, tokens, findCue, makeAligner, momentsPalette, beatIdFrom, HEAD, TAIL_BUFFER };
