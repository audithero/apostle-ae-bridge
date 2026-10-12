/*
 * validate-instructional.cjs: the gate on model-written instructional plans.
 *
 * Errors go back to the model verbatim for a retry, so each names the beat,
 * the event and the fix. The compiler runs too: anything it cannot place
 * (a cue missing from the VO, a band missing from a screen) is an error here.
 */
"use strict";

const { compileInstructional } = require("./compile-instructional.cjs");
const { tokens, findCue } = require("./compile-spec.cjs");
const { voFidelity } = require("./validate-spec.cjs");

const EVENTS = ["page", "item", "callout", "search", "pin", "screen", "ring", "badge", "phone", "prop", "label", "pulse", "node", "move", "buzz", "outro"];
const PROPS = { passport: ["label", "pulse"], nfc: ["move", "buzz"], path: ["node"], fan: [] };
const CAP = { grid: 4, list: 4, numbered: 5 };
const HEAD_MAX = 22, TITLE_MAX = 34, SUB_MAX = 46;

function validateInstructional(plan, opts) {
  opts = opts || {};
  const errors = [], warnings = [];
  const E = (m) => errors.push(m), W = (m) => warnings.push(m);
  if (!plan || typeof plan !== "object") return { errors: ["plan is not an object"], warnings };
  if (!/^[A-Z][A-Z0-9_]*$/.test(plan.name || "")) E("name must be UPPER_SNAKE_CASE");
  if (!Array.isArray(plan.beats) || !plan.beats.length) return { errors: errors.concat(["beats is empty"]), warnings };
  const screens = opts.screens ? new Set(opts.screens) : null;
  const bands = opts.bands || {};
  const glyphs = opts.glyphs ? new Set(opts.glyphs) : null;

  if (opts.voScript) {
    const fid = voFidelity(plan.beats.map((b) => b.vo || "").join(" "), opts.voScript, "exact");
    if (fid) E(fid);
  }
  if (plan.open && (!Array.isArray(plan.open.heading) || !plan.open.heading.length)) E("open.heading must be an array of 1-2 lines");

  const chapters = plan.beats.filter((b) => b.chapter);
  if (plan.totalSteps && chapters.length !== plan.totalSteps) E("totalSteps is " + plan.totalSteps + " but there are " + chapters.length + " chapter beats");
  chapters.forEach((b, i) => {
    if (b.chapter.step !== i + 1) E("chapter steps must run 1.." + chapters.length + " in order; found step " + b.chapter.step + " at position " + (i + 1));
    if (!b.chapter.title || b.chapter.title.length > 26) E("chapter " + (i + 1) + ".title is required and at most 26 characters");
  });
  if (!plan.beats[0].page) E("beats[0] needs a page: the film must open onto a layout");

  const checkPage = (p, where) => {
    if (!Array.isArray(p.heading) || p.heading.length < 1 || p.heading.length > 2) { E(where + ".heading must be 1-2 lines"); return; }
    p.heading.forEach((l, i) => { if (String(l).length > HEAD_MAX) E(where + ".heading[" + i + "] is " + String(l).length + " chars; max " + HEAD_MAX + " (it runs into the phone)"); });
    if (p.highlight && !p.heading.some((l) => l.indexOf(p.highlight) !== -1)) E(where + ".highlight '" + p.highlight + "' is not in the heading (match it exactly, including punctuation)");
    if (!p.highlight) W(where + " has no highlight word");
    if (p.items && !CAP[p.items]) E(where + ".items must be grid, list or numbered");
  };

  let prop = null, slots = 0, layout = "list", phoneShot = null, hasPage = false;
  plan.beats.forEach((b, bi) => {
    const at = "beats[" + bi + "]";
    if (!b.vo || !String(b.vo).trim()) E(at + " has no vo");
    if (b.chapter && !b.page) E(at + " is a chapter beat with no page: say what the step's layout is");
    if (b.chapter) prop = null;
    if (b.page) { checkPage(b.page, at + ".page"); slots = 0; layout = b.page.items || "list"; hasPage = true; }
    const toks = tokens(b.vo);
    let last = 0;
    (b.events || []).forEach((e, ei) => {
      const w = at + ".events[" + ei + "] (" + e.do + ")";
      if (EVENTS.indexOf(e.do) === -1) { E(w + ": unknown event; use one of " + EVENTS.join(", ")); return; }
      if (e.cue) {
        const idx = findCue(toks, e.cue, last);
        if (idx === -1) {
          E(w + ": cue " + JSON.stringify(e.cue) + (findCue(toks, e.cue, 0) === -1 ? " is not in this beat's vo; copy the words exactly" : " is before the previous event's cue; events must follow the vo in order"));
        } else last = idx;
      } else if (ei > 0 && !b.page && e.do !== "screen") {
        W(w + " has no cue: it fires as soon as the beat starts");
      }
      switch (e.do) {
        case "page": checkPage(e, w); slots = 0; layout = e.items || "list"; break;
        case "item": case "callout": case "search": case "pin":
          if (!hasPage) E(w + ": no page yet");
          slots++;
          if (slots > CAP[layout]) E(w + ": slot " + slots + " overflows a " + layout + " page (max " + CAP[layout] + "); start a new page or cut an item");
          if ((e.do === "item" || e.do === "callout") && !e.title) E(w + ".title is required");
          if (e.title && e.title.length > TITLE_MAX) E(w + ".title is " + e.title.length + " chars; max " + TITLE_MAX);
          if (e.sub && e.sub.length > SUB_MAX) E(w + ".sub is " + e.sub.length + " chars; max " + SUB_MAX);
          if (e.do === "search" && !e.text) E(w + ".text is required");
          if (layout !== "numbered" && (e.do === "item" || e.do === "callout") && !e.glyph) E(w + ".glyph is required on a " + layout + " page");
          if (e.glyph && glyphs && !glyphs.has(e.glyph)) E(w + ".glyph '" + e.glyph + "' does not exist; use one of " + Array.from(glyphs).join(", "));
          if (layout === "numbered" && (e.do === "callout" || e.do === "search")) W(w + ": a " + e.do + " on a numbered page sits below the list; check it does not crowd the captions");
          break;
        case "screen":
          if (!e.shot) { E(w + ".shot is required"); break; }
          if (screens && !screens.has(e.shot)) { E(w + ".shot '" + e.shot + "' is not an available screen; use a name exactly as listed"); break; }
          phoneShot = e.shot; prop = null;
          if (e.ring) checkRing(e.ring, e.shot, w);
          if (e.badge && ["tick", "cross"].indexOf(e.badge) === -1) E(w + ".badge must be tick or cross");
          if (bands[e.shot] && bands[e.shot].w < 600) W(w + ": '" + e.shot + "' is a low-res capture (" + bands[e.shot].w + "px wide) and will look soft; prefer a full-res screen of the same step if one exists");
          break;
        case "ring":
          if (!phoneShot) E(w + ": no screen on the phone to ring");
          else checkRing(e.ring || (e.bands ? { bands: e.bands } : e.rect), phoneShot, w);
          break;
        case "badge": if (["tick", "cross"].indexOf(e.kind) === -1) E(w + ".kind must be tick or cross"); break;
        case "phone": prop = null; break;
        case "prop":
          if (!PROPS[e.prop]) { E(w + ".prop must be one of " + Object.keys(PROPS).join(", ")); break; }
          prop = e.prop;
          if (e.prop === "fan") {
            if (!Array.isArray(e.shots) || e.shots.length < 4) E(w + ".shots needs 4-9 screen names");
            else e.shots.forEach((s) => { if (screens && !screens.has(s)) E(w + ".shots: '" + s + "' is not an available screen"); });
          }
          if (e.prop === "path") {
            const n = (b.events || []).slice(ei + 1).filter((x) => x.do === "node").length;
            if (n < 2 || n > 3) E(w + ": a path needs 2-3 node events after it in the same beat (found " + n + ")");
          }
          break;
        case "label": case "pulse": case "node": case "move": case "buzz":
          if (!prop) E(w + ": needs a prop on screen");
          else if (PROPS[prop].indexOf(e.do) === -1) E(w + ": '" + e.do + "' does not apply to a " + prop + " prop (it takes " + (PROPS[prop].join(", ") || "nothing") + ")");
          if (e.do === "node" && !e.label) E(w + ".label is required");
          if (e.do === "node" && e.glyph && glyphs && !glyphs.has(e.glyph)) E(w + ".glyph '" + e.glyph + "' does not exist");
          break;
        case "outro":
          if (bi !== plan.beats.length - 1) E(w + ": outro belongs in the last beat");
          break;
      }
    });
  });
  if (!plan.beats[plan.beats.length - 1].events || !plan.beats[plan.beats.length - 1].events.some((e) => e.do === "outro")) W("no outro: the film ends on the last page");

  function checkRing(r, shot, w) {
    if (!r) { E(w + ": ring needs { bands: [n] }"); return; }
    if (Array.isArray(r)) { W(w + ": a pixel rect ring; prefer { bands: [n] } from the numbered screen sheet"); return; }
    if (!Array.isArray(r.bands) || !r.bands.length) { E(w + ".ring.bands must list block numbers from the screen sheet"); return; }
    const b = bands[shot];
    if (b && r.bands.some((n) => !b.bands[n - 1])) E(w + ".ring.bands " + JSON.stringify(r.bands) + ": '" + shot + "' has blocks 1-" + b.bands.length);
  }

  // anything the compiler cannot place is an error
  if (!errors.length && opts.compile !== false) {
    try {
      const { warnings: cw } = compileInstructional(plan, { repo: opts.repo, kit: opts.kit, bands });
      cw.forEach((m) => E("compile: " + m));
    } catch (e) {
      E("compile failed: " + e.message);
    }
  }
  return { errors, warnings };
}

module.exports = { validateInstructional, EVENTS, PROPS };
