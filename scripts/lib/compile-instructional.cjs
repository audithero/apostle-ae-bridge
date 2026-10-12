/*
 * compile-instructional.cjs: instructional plan -> absolute timeline.
 *
 * The "instructional" stage (v2.15) is a persistent 2D layout, not the 3D
 * camera corridor: a left column (step eyebrow + progress, a heavy headline
 * with a marker highlight, items that build on their cue), the phone or a
 * demo prop on the right, numbered chapter cards between steps, and burnt-in
 * captions that carry every word of the VO. Things stay on screen and change
 * state instead of being replaced wholesale, which is most of why it reads as
 * animated rather than as slides.
 *
 * The plan (briefs/<client>/instructional/*.plan.json) is beats of verbatim
 * VO with events anchored by `cue` (verbatim opening words, as in video
 * specs). Every time is computed here, so recorded VO re-times the whole film
 * by switching timing.mode to "words" (vo-align.py words.json).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { tokens, findCue, makeAligner } = require("./compile-spec.cjs");

const R = (x) => Math.round(x * 100) / 100;

function hexToRgb01(h) {
  const m = String(h || "#000000").replace("#", "");
  return [parseInt(m.slice(0, 2), 16) / 255, parseInt(m.slice(2, 4), 16) / 255, parseInt(m.slice(4, 6), 16) / 255].map((v) => R(v * 1000) / 1000);
}

// captions: sentences, long ones split at a comma or "and"/"or" near the
// middle, so one line of 24px type never runs past ~95 characters
function captionChunks(vo) {
  const sentences = String(vo).replace(/\s+/g, " ").trim().split(/(?<=[.!?:])\s+(?=[A-Z‘'“"]|$)/);
  const out = [];
  const MAX = 92;
  const split = (s) => {
    if (s.length <= MAX) { out.push(s); return; }
    const mid = s.length / 2;
    let best = -1, bestD = 1e9;
    const re = /,\s|\s(?:and|or|so|to|until|then)\s/g;
    let m;
    while ((m = re.exec(s))) {
      const at = m[0][0] === "," ? m.index + 1 : m.index;
      const d = Math.abs(at - mid);
      if (d < bestD && at > 20 && at < s.length - 20) { best = at; bestD = d; }
    }
    if (best === -1) {
      best = s.lastIndexOf(" ", Math.floor(mid) + 10);
      if (best < 20) { out.push(s); return; }
    }
    split(s.slice(0, best).trim());
    split(s.slice(best).trim());
  };
  sentences.filter(Boolean).forEach(split);
  return out;
}

function compileInstructional(plan, opts) {
  opts = opts || {};
  const repo = opts.repo || path.resolve(__dirname, "..", "..");
  const kit = opts.kit || JSON.parse(fs.readFileSync(path.join(repo, plan.kit), "utf8"));
  const warnings = [];
  const timing = plan.timing || { mode: "wpm" };
  const wpm = timing.wpm || 150;
  const gap = timing.gap !== undefined ? timing.gap : 0.45;
  const spw = 60 / wpm;

  const open = plan.open || null;
  const t0 = open ? open.dur : 0.8;

  // word clock: wordTime(beatIndex, wordIndex) -> seconds
  let wordTime, beatEnd;
  if (timing.mode === "words") {
    const wf = path.isAbsolute(timing.words) ? timing.words : path.join(repo, timing.words);
    const al = makeAligner(JSON.parse(fs.readFileSync(wf, "utf8")).map((x) => Array.isArray(x) ? { w: x[2], t0: x[0], t1: x[1] } : x));
    const voStart = t0;
    const starts = [];
    plan.beats.forEach((b, i) => { starts[i] = voStart + al.locate(b.vo, i / plan.beats.length, (m) => warnings.push(m)); });
    wordTime = (bi, wi) => {
      const toks = tokens(plan.beats[bi].vo);
      if (wi <= 0) return starts[bi];
      const t = al.locate(toks.slice(wi).join(" "), 0, null, toks.slice(wi).join("").length * 1.25 + 40);
      return voStart + t;
    };
    beatEnd = (bi) => (bi + 1 < plan.beats.length ? starts[bi + 1] - gap : voStart + al.end);
  } else {
    const starts = [];
    let t = t0;
    plan.beats.forEach((b, i) => { starts[i] = t; t += tokens(b.vo).length * spw + gap; });
    wordTime = (bi, wi) => starts[bi] + Math.max(0, wi) * spw;
    beatEnd = (bi) => starts[bi] + tokens(plan.beats[bi].vo).length * spw;
  }

  const total = plan.totalSteps || plan.beats.filter((b) => b.chapter).length;
  const tl = {
    name: plan.name + "_" + (plan.version || "v001"), fps: 25, w: 1920, h: 1080,
    label: plan.label || "",
    total,
    colors: {
      bg: hexToRgb01(plan.colors && plan.colors.bg || "#F4F4F4"),
      ink: hexToRgb01(kit.colors.text || "#000000"),
      brand: hexToRgb01(kit.colors.primary || "#FFCC00"),
      card: hexToRgb01("#FFFFFF"),
      muted: hexToRgb01("#8C8C8C"),
      line: hexToRgb01("#D9D9D9"),
      tint: hexToRgb01(plan.colors && plan.colors.tint || "#FFF5CC"),
      navy: hexToRgb01(plan.colors && plan.colors.navy || "#1D2B4F"),
      gold: hexToRgb01(plan.colors && plan.colors.gold || "#D9B45B")
    },
    hex: {
      ink: kit.colors.text || "#000000", brand: kit.colors.primary || "#FFCC00", paper: "#FFFFFF", hole: "#FFFFFF", muted: "#D9D9D9",
      navy: plan.colors && plan.colors.navy || "#1D2B4F", gold: plan.colors && plan.colors.gold || "#D9B45B"
    },
    fonts: {
      black: plan.fonts && plan.fonts.black || "CBABeaconSans-Black",
      xbold: plan.fonts && plan.fonts.xbold || "CBABeaconSans-ExtraBold",
      bold: kit.fontHeadingPS || "CBABeaconSans-Bold",
      regular: kit.fontBodyPS || "CBABeaconSans-Regular"
    },
    screens: [],
    cards: [], pages: [], items: [], phone: [], shots: [], rings: [], badges: [], props: [], captions: [], fx: []
  };

  // screens: name -> file across the plan's folders
  const SHOT = /\.(png|jpe?g)$/i;
  const shotFile = {};
  for (const d0 of [].concat(plan.screens || [])) {
    const d = path.isAbsolute(d0) ? d0 : path.join(repo, d0);
    for (const f of fs.readdirSync(d)) if (SHOT.test(f)) shotFile[f.replace(SHOT, "")] = path.join(d, f);
  }
  const usedShots = {};

  if (open) tl.cards.push({ type: "title", tIn: 0, tOut: R(open.dur), heading: open.heading, sub: open.sub || "" });

  let page = null, step = 0, phoneOn = null, prop = null, itemCount = 0;
  const closePage = (t) => {
    if (!page) return;
    page.tOut = R(t);
    tl.items.filter((x) => x.page === page.id && x.tOut === null).forEach((x) => { x.tOut = R(t); });
    page = null;
  };
  const phoneOff = (t) => { if (phoneOn) { phoneOn.tOut = R(t); phoneOn = null; } };
  const propOff = (t) => { if (prop) { prop.tOut = R(t); prop = null; } };
  const newPage = (t, p, eyebrow) => {
    closePage(t);
    itemCount = 0;
    page = { id: tl.pages.length + 1, tIn: R(t), tOut: null, step, total, eyebrow: eyebrow || (step ? "STEP " + step + " OF " + total : ""), heading: p.heading, highlight: p.highlight || "", layout: p.items || "list", sub: p.sub || "" };
    tl.pages.push(page);
  };
  const ringOff = (t) => { tl.rings.filter((r) => r.tOut === null).forEach((r) => { r.tOut = R(t); }); };
  const badgeOff = (t) => { tl.badges.filter((r) => r.tOut === null).forEach((r) => { r.tOut = R(t); }); };

  plan.beats.forEach((b, bi) => {
    const toks = tokens(b.vo);
    const bStart = wordTime(bi, 0);
    let pageT = bStart;
    if (b.chapter) {
      step = b.chapter.step || step + 1;
      const cIn = Math.max(0, bStart - 0.35);
      const cOut = bStart + (b.chapter.hold || 2.0);
      tl.cards.push({ type: "chapter", tIn: R(cIn), tOut: R(cOut), step, total, numeral: String(step).padStart(2, "0"), title: b.chapter.title });
      // everything on screen ends under the card, while it is fully opaque
      const cover = cIn + 0.5;
      closePage(cover); phoneOff(cover); propOff(cover); ringOff(cover); badgeOff(cover);
      pageT = cOut - 0.1;
    }
    if (b.page) newPage(pageT, b.page, b.page.eyebrow);

    let last = 0;
    (b.events || []).forEach((e, ei) => {
      let t;
      if (e.cue) {
        const wi = findCue(toks, e.cue, last);
        if (wi === -1) { warnings.push("beat " + (bi + 1) + " event " + (ei + 1) + ": cue not found: " + e.cue); return; }
        last = wi;
        t = wordTime(bi, wi) - (e.lead !== undefined ? e.lead : 0.15);
      } else {
        t = pageT + (e.delay || 0.35);
      }
      if (b.chapter && t < pageT + 0.2) t = pageT + 0.2 + ei * 0.12;
      t = R(t);
      const at = { tIn: t, tOut: null };
      switch (e.do) {
        case "page":
          newPage(t, e, e.eyebrow); break;
        case "item": case "callout": case "search": case "pin": {
          const it = Object.assign({ page: page.id, kind: e.do === "item" ? (page.layout === "numbered" ? "num" : "card") : e.do, n: ++itemCount, slot: itemCount - 1, layout: page.layout }, at);
          ["glyph", "title", "sub", "text"].forEach((k) => { if (e[k] !== undefined) it[k] = e[k]; });
          tl.items.push(it);
          break;
        }
        case "screen": {
          if (!shotFile[e.shot]) { warnings.push("beat " + (bi + 1) + ": screen not found: " + e.shot); break; }
          usedShots[e.shot] = shotFile[e.shot];
          propOff(t);
          if (!phoneOn) { phoneOn = { tIn: t, tOut: null }; tl.phone.push(phoneOn); }
          ringOff(t); badgeOff(t);
          tl.shots.push({ t, shot: e.shot, glare: !!e.glare });
          if (e.ring) tl.rings.push({ tIn: R(t + 0.5), tOut: null, rect: e.ring, shot: e.shot });
          if (e.badge) tl.badges.push({ tIn: R(t + 0.6), tOut: null, kind: e.badge });
          break;
        }
        case "ring": {
          ringOff(t);
          const cur = tl.shots[tl.shots.length - 1];
          tl.rings.push({ tIn: t, tOut: null, rect: e.rect, shot: cur && cur.shot });
          break;
        }
        case "badge": badgeOff(t); tl.badges.push({ tIn: t, tOut: null, kind: e.kind }); break;
        case "phone": {
          propOff(t);
          if (!phoneOn) { phoneOn = { tIn: t, tOut: null }; tl.phone.push(phoneOn); }
          break;
        }
        case "prop": {
          phoneOff(t); ringOff(t); badgeOff(t); propOff(t);
          prop = Object.assign({ type: e.prop, events: [] }, at);
          ["label", "nodes", "shots", "traveler"].forEach((k) => { if (e[k] !== undefined) prop[k] = e[k]; });
          if (e.prop === "fan") {
            prop.files = (e.shots || []).filter((s) => shotFile[s]).map((s) => { usedShots[s] = shotFile[s]; return s; });
          }
          tl.props.push(prop);
          break;
        }
        case "label": case "pulse": case "node": case "move": case "buzz":
          if (!prop) { warnings.push("beat " + (bi + 1) + ": '" + e.do + "' with no prop on screen"); break; }
          prop.events.push(Object.assign({ t, action: e.do }, e.text ? { text: e.text } : {}, e.glyph ? { glyph: e.glyph, label: e.label } : {}));
          break;
        case "outro": {
          const tEnd = beatEnd(bi) + (plan.outro && plan.outro.hold || 3.5);
          tl.cards.push({ type: "outro", tIn: t, tOut: R(tEnd), heading: e.heading || (plan.outro && plan.outro.heading) || [] });
          closePage(t + 0.55); phoneOff(t + 0.55); propOff(t + 0.55); ringOff(t + 0.55); badgeOff(t + 0.55);
          break;
        }
        default:
          warnings.push("beat " + (bi + 1) + ": unknown event " + e.do);
      }
    });

    // captions for this beat
    const chunks = captionChunks(b.vo);
    let wi0 = 0;
    chunks.forEach((c, ci) => {
      const ct = tokens(c);
      const wi = findCue(toks, ct.slice(0, Math.min(4, ct.length)).join(" "), wi0);
      const ws = wi === -1 ? wi0 : wi;
      const tIn = wordTime(bi, ws) - 0.08;
      wi0 = ws + ct.length;
      tl.captions.push({ tIn: R(tIn), tOut: null, text: c });
    });
  });

  const lastBeat = plan.beats.length - 1;
  const outro = tl.cards.find((c) => c.type === "outro");
  tl.duration = R(outro ? outro.tOut : beatEnd(lastBeat) + 3.0);
  closePage(tl.duration); phoneOff(tl.duration); propOff(tl.duration); ringOff(tl.duration); badgeOff(tl.duration);
  for (let i = 0; i < tl.captions.length; i++) {
    const nx = tl.captions[i + 1];
    tl.captions[i].tOut = R(nx ? nx.tIn : tl.duration - 0.6);
  }
  // a caption may not outlive a long pause: cap at ~reading time + 1.2s
  tl.captions.forEach((c) => {
    const words = c.text.split(" ").length;
    const maxDur = Math.max(2.2, words * spw * 1.15 + 1.2);
    if (c.tOut - c.tIn > maxDur) c.tOut = R(c.tIn + maxDur);
  });
  tl.screens = Object.keys(usedShots).map((k) => ({ name: k, file: usedShots[k] }));
  return { timeline: tl, warnings };
}

module.exports = { compileInstructional, captionChunks };
