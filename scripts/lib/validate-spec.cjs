/*
 * validate-spec.cjs: semantic checks on model output, before it gets near AE.
 *
 * Errors block the build and go back to the model verbatim for a retry, so
 * each one names the exact place and the fix. Warnings are taste calls a
 * human may overrule (long supers, a layout used three times running).
 */
"use strict";

const { capabilities } = require("./capabilities.cjs");
const { tokens, findCue } = require("./compile-spec.cjs");

const SUPER_WARN = 48, SUPER_MAX = 90, SUB_WARN = 90, LABEL_WARN = 22, CHIP_WARN = 18;

function validateSpec(spec, opts) {
  opts = opts || {};
  const cap = opts.capabilities || capabilities();
  const errors = [], warnings = [];
  const E = (m) => errors.push(m), W = (m) => warnings.push(m);
  const glyphs = new Set(cap.glyphs);
  const pictos = opts.pictos ? new Set(opts.pictos) : null;

  if (!spec || typeof spec !== "object") return { errors: ["spec is not an object"], warnings };
  if (!/^[A-Z][A-Z0-9_]*$/.test(spec.name || "")) E("name must be UPPER_SNAKE_CASE (it becomes the master comp name), got " + JSON.stringify(spec.name));
  if (!/^[a-z0-9][a-z0-9-]*$/.test(spec.slug || "")) E("slug must be kebab-case, got " + JSON.stringify(spec.slug));
  if (!spec.briefId) E("briefId is required");
  if (spec.stage && cap.stages.indexOf(spec.stage) === -1) E("stage '" + spec.stage + "' is not one of " + cap.stages.join(", "));
  if (spec.easeProfile && cap.easeProfiles.indexOf(spec.easeProfile) === -1) E("easeProfile '" + spec.easeProfile + "' is not one of " + cap.easeProfiles.join(", "));

  const res = spec.format && spec.format.resolution;
  if (res && (res[0] !== 1920 || res[1] !== 1080)) E("format.resolution " + JSON.stringify(res) + " is not supported yet: moment layouts are drawn for 1920x1080. Build at 1920x1080 and list the other aspect under libraryGaps");
  const timing = spec.timing || { mode: spec.end !== undefined ? "measured" : "wpm" };
  const mode = timing.mode || "wpm";
  if (["wpm", "words", "measured"].indexOf(mode) === -1) E("timing.mode must be wpm, words or measured");
  if (mode === "words" && !timing.words) E("timing.mode words needs timing.words (path to a vo-align words.json)");
  if (mode === "measured" && typeof spec.end !== "number") E("timing.mode measured needs spec.end in seconds");

  const sectionIds = new Set((spec.sections || []).map((s) => s.id));
  (spec.sections || []).forEach((s, i) => {
    if (!s.id || !/^[a-z0-9][a-z0-9-]*$/.test(s.id)) E("sections[" + i + "].id must be kebab-case");
    if (!s.title) E("sections[" + i + "].title is required");
  });
  if (spec.titleCard) {
    if (!spec.titleCard.super) E("titleCard.super is required");
    if (!(spec.titleCard.dur > 0)) E("titleCard.dur must be a positive number of seconds");
  }

  const beats = spec.beats || [];
  if (!beats.length) E("beats is empty");
  let prevLayouts = [];
  beats.forEach((b, bi) => {
    const at = "beats[" + bi + "]";
    if (sectionIds.size && b.section && !sectionIds.has(b.section)) E(at + ".section '" + b.section + "' is not a declared section id");
    if (b.transit && cap.transits[b.transit] === undefined) E(at + ".transit '" + b.transit + "' is not one of " + Object.keys(cap.transits).join(", "));
    if (b.preset && cap.stylePresets.indexOf(b.preset) === -1) E(at + ".preset '" + b.preset + "' is not one of " + cap.stylePresets.join(", "));
    if (!b.vo || !String(b.vo).trim()) {
      if (mode !== "wpm") E(at + " has no vo. With recorded VO, a silent card must be spec.titleCard, not a beat");
      else if (!(b.holdSec > 0)) W(at + " has no vo and no holdSec; it will hold 3s");
    }
    if (mode === "measured" && typeof b.start !== "number") E(at + ".start (seconds) is required in measured timing");
    const ms = b.moments || [];
    if (!ms.length) E(at + " has no moments");
    const toks = tokens(b.vo);
    let lastIdx = 0;
    ms.forEach((m, mi) => {
      const w = at + ".moments[" + mi + "]";
      const lay = m.layout || "statement";
      const def = cap.layouts[lay];
      if (!def) { E(w + ".layout '" + lay + "' is not one of " + Object.keys(cap.layouts).join(", ")); return; }

      // timing anchor
      if (mode === "measured") {
        if (typeof m.at !== "number") E(w + ".at (seconds) is required in measured timing");
      } else if (mi > 0 || m.cue) {
        if (!m.cue) E(w + " needs a cue: the verbatim opening words of the VO where this moment starts");
        else {
          const idx = findCue(toks, m.cue, lastIdx);
          if (idx === -1) {
            const anywhere = findCue(toks, m.cue, 0);
            E(w + ".cue " + JSON.stringify(m.cue) + (anywhere === -1
              ? " does not appear in this beat's vo. Copy it exactly from the vo"
              : " appears before the previous moment's cue. Moments must follow the vo in order"));
          } else {
            if (mi > 0 && idx === lastIdx && idx > 0) E(w + ".cue starts at the same word as the previous moment");
            const words = idx - lastIdx;
            if (mi > 0 && words < 4) W(w + " follows the previous moment after only " + words + " spoken words (under ~1.6s on screen)");
            lastIdx = idx;
          }
        }
      }
      if (mi > 0 && toks.length && mi === ms.length - 1 && mode !== "measured" && m.cue) {
        const idx = findCue(toks, m.cue, 0);
        if (idx !== -1 && toks.length - idx < 4) W(w + " gets only " + (toks.length - idx) + " spoken words before the beat ends");
      }

      // text
      const sup = m["super"];
      if (!sup && lay !== "hub") E(w + ".super is required for layout " + lay);
      if (sup && sup.length > SUPER_MAX) E(w + ".super is " + sup.length + " chars; cap is " + SUPER_MAX + ". Distil it, do not transcribe the VO");
      else if (sup && sup.length > SUPER_WARN) W(w + ".super is " + sup.length + " chars; supers read best under " + SUPER_WARN);
      if (m.sub && m.sub.length > SUB_WARN) W(w + ".sub is " + m.sub.length + " chars; keep it under " + SUB_WARN);

      // icons
      const checkIcon = (o, where, required) => {
        if (o.glyph && !glyphs.has(o.glyph)) E(where + ".glyph '" + o.glyph + "' does not exist. Use one of: " + cap.glyphs.join(", "));
        if (o.picto && pictos && !pictos.has(o.picto)) W(where + ".picto '" + o.picto + "' is not in the brand's pictogram list; the glyph fallback will be used if it is missing in AE");
        if (required && !o.glyph && !o.picto) E(where + " needs a glyph (or picto)");
      };
      checkIcon(m, w, lay === "hero");

      // per-layout payloads
      const arr = (k, lo, hi) => {
        const a = m[k];
        if (!Array.isArray(a) || a.length < lo || a.length > hi) { E(w + "." + k + " must be an array of " + lo + "-" + hi + " items for layout " + lay); return []; }
        return a;
      };
      if (lay === "iconRow" && Array.isArray(m.tiles) && m.tiles.length === 1) W(w + ": a one-tile iconRow usually reads better as hero");
      if (lay === "iconRow") arr("tiles", 1, 5).forEach((t, ti) => {
        checkIcon(t, w + ".tiles[" + ti + "]", true);
        if (t.label && t.label.replace(/\r/g, "").length > LABEL_WARN) W(w + ".tiles[" + ti + "].label is long; break it with \\r or shorten");
      });
      if (lay === "chipRow") arr("chips", 2, 6).forEach((c, ci) => {
        if (typeof c !== "string") E(w + ".chips[" + ci + "] must be a string");
        else if (c.length > CHIP_WARN) W(w + ".chips[" + ci + "] is " + c.length + " chars; chips shrink to fit, keep under " + CHIP_WARN);
      });
      if (lay === "hub") arr("spokes", 3, 6).forEach((s, si) => checkIcon(s, w + ".spokes[" + si + "]", true));
      if (lay === "device") arr("screen", 1, 5).forEach((r, ri) => {
        if (!r.label) E(w + ".screen[" + ri + "].label is required");
        checkIcon(r, w + ".screen[" + ri + "]", false);
      });
      if (lay === "compare") {
        if (!m.fromBox || !m.fromBox.label) E(w + ".fromBox.label is required for compare");
        if (!m.toBox || !m.toBox.label) E(w + ".toBox.label is required for compare");
      }
      if (lay === "placeholder" && !m.asset) E(w + ".asset must say what artwork belongs in the frame");
      if (lay === "endcard" && !(bi === beats.length - 1 && mi === ms.length - 1)) W(w + ": endcard is meant for the very last moment");

      prevLayouts.push(lay);
      const n = prevLayouts.length;
      if (n >= 3 && prevLayouts[n - 1] === prevLayouts[n - 2] && prevLayouts[n - 2] === prevLayouts[n - 3] && lay !== "statement") {
        W(w + ": third '" + lay + "' in a row; vary the layouts so the film has rhythm");
      }
    });
  });

  // VO fidelity: a client's script is never rewritten by the model
  if (opts.clientVO) {
    const fid = voFidelity(beats.map((b) => b.vo || "").join(" "), opts.clientVO, opts.voScope || "exact");
    if (fid) E(fid);
  }
  return { errors, warnings };
}

// "exact": spec VO == client VO. "subset": the spec's VO is one contiguous
// run of the client VO (a multi-video brief, one video per spec).
function voFidelity(specVO, clientVO, scope) {
  const a = tokens(specVO), b = tokens(clientVO);
  if (!a.length) return null;
  if (scope === "exact") {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        return "VO is not verbatim: at word " + (i + 1) + " the spec has \"" + a.slice(Math.max(0, i - 4), i + 6).join(" ") +
          "\" but the client script has \"" + b.slice(Math.max(0, i - 4), i + 6).join(" ") + "\". Copy the VO exactly, in order, with nothing added or dropped";
      }
    }
    return null;
  }
  const hay = " " + b.join(" ") + " ";
  if (hay.indexOf(" " + a.join(" ") + " ") !== -1) return null;
  // find the first spec word run that breaks the match, for a useful message
  for (let n = 6; n <= a.length; n += 6) {
    if (hay.indexOf(" " + a.slice(0, n).join(" ") + " ") === -1) {
      return "VO is not verbatim: \"" + a.slice(Math.max(0, n - 10), n).join(" ") + "\" does not appear in the client script. Copy the VO exactly";
    }
  }
  return "VO is not verbatim: the spec's VO is not one contiguous passage of the client script";
}

const TREATMENT_REQUIRED = ["title", "logline", "audience", "objective", "tone", "visualSystem", "videos"];

function validateTreatment(t, opts) {
  opts = opts || {};
  const cap = opts.capabilities || capabilities();
  const errors = [], warnings = [];
  const E = (m) => errors.push(m), W = (m) => warnings.push(m);
  if (!t || typeof t !== "object") return { errors: ["treatment is not an object"], warnings };
  for (const k of TREATMENT_REQUIRED) if (t[k] === undefined || t[k] === "") E("treatment." + k + " is required");
  const vs = t.visualSystem || {};
  if (vs.stage && cap.stages.indexOf(vs.stage) === -1) E("visualSystem.stage '" + vs.stage + "' is not one of " + cap.stages.join(", "));
  if (vs.easeProfile && cap.easeProfiles.indexOf(vs.easeProfile) === -1) E("visualSystem.easeProfile '" + vs.easeProfile + "' is not one of " + cap.easeProfiles.join(", "));
  if (t.voSource && ["client", "drafted"].indexOf(t.voSource) === -1) E("voSource must be client or drafted");
  const vids = Array.isArray(t.videos) ? t.videos : [];
  if (!vids.length) E("treatment.videos must list at least one video");
  const slugs = {};
  vids.forEach((v, i) => {
    const at = "videos[" + i + "]";
    if (!/^[a-z0-9][a-z0-9-]*$/.test(v.slug || "")) E(at + ".slug must be kebab-case");
    if (slugs[v.slug]) E(at + ".slug '" + v.slug + "' is used twice");
    slugs[v.slug] = true;
    if (!/^[A-Z][A-Z0-9_]*$/.test(v.name || "")) E(at + ".name must be UPPER_SNAKE_CASE");
    if (!Array.isArray(v.structure) || !v.structure.length) E(at + ".structure must list the sections of the film");
    if (!v.voScript || !String(v.voScript).trim()) E(at + ".voScript is required: the full VO for this video (verbatim from the client, or drafted)");
    else if (opts.clientVO && t.voSource === "client") {
      const fid = voFidelity(v.voScript, opts.clientVO, vids.length === 1 ? "exact" : "subset");
      if (fid) E(at + ".voScript: " + fid);
    }
  });
  if (!Array.isArray(t.openQuestions)) W("no openQuestions listed; say so explicitly with [] if there are none");
  return { errors, warnings };
}

module.exports = { validateSpec, validateTreatment, voFidelity };
