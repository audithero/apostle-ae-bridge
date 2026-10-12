/*
 * capabilities.cjs: what the APOSTLE library can actually build, as data.
 *
 * The compile pipeline hands this to the model so it composes from real
 * building blocks instead of inventing layouts the library cannot draw.
 * Names that live in code (glyphs, ease profiles, transits, stages) are
 * READ FROM apostle.jsx, never copied here, so adding a glyph to MOM_GLYPHS
 * makes it available to the model with no second edit. What cannot be read
 * (what each layout is for, which fields it takes) is described below and
 * must be kept in step with momLayout() by hand.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");
const LIB = path.join(REPO, "apostle", "apostle.jsx");

// Keep in step with momLayout() in apostle.jsx and LAYOUTS in apply-moments.cjs.
const LAYOUTS = {
  statement: {
    use: "One plain message. The default when nothing more specific fits. Optional icon above the line.",
    fields: { super: "required", sub: "optional", glyph: "optional", picto: "optional" }
  },
  hero: {
    use: "One big idea carried by a single large icon: a product, a benefit, a headline number. Strong opener for a section.",
    fields: { super: "required", sub: "optional", glyph: "required unless picto", picto: "optional" }
  },
  iconRow: {
    use: "2 to 5 parallel items of equal weight (ways to earn, product categories, steps). Each item is an icon tile with a short label.",
    fields: { super: "required", sub: "optional", tiles: "2-5 (1 allowed, but hero is usually better) of {glyph|picto, label}; label <= 22 chars, use \\r to break a line" }
  },
  chipRow: {
    use: "A set of short tags or options with no icons (partner names, plan tiers, features). Text pills in a row.",
    fields: { super: "required", sub: "optional", chips: "2-6 short strings, <= 18 chars each" }
  },
  compare: {
    use: "Before vs after, old vs new, A vs B. Left box (optionally struck through), arrow, right box.",
    fields: { super: "required", sub: "optional", fromBox: "{label, strike?: true}", toBox: "{label}" }
  },
  hub: {
    use: "One central thing connected to several others (an ecosystem, a platform and its parts). Core icon with 3-6 spokes.",
    fields: { super: "required", sub: "optional", glyph: "core icon", spokes: "3-6 of {glyph|picto}" }
  },
  device: {
    use: "Anything happening in an app or on a phone: a flow, a feature, a list of in-app options. Phone mock-up beside the text.",
    fields: { super: "required", sub: "optional", screen: "1-5 rows of {label, glyph|picto}; label <= 20 chars" }
  },
  endcard: {
    use: "The closing call to action. Last moment of the last beat only.",
    fields: { super: "required", sub: "optional", url: "optional" }
  },
  placeholder: {
    use: "Artwork the library cannot draw (real product shots, partner logos, screenshots). Renders an outlined frame captioned with what belongs there, so it is obviously unfinished in review. Use sparingly and list it under assetsNeeded.",
    fields: { super: "required", sub: "optional", asset: "what artwork goes here" }
  }
};

// Keep in step with beats-schema.json beats[].stylePreset. listBuild is
// inferred when any moment in the beat uses a list layout.
const STYLE_PRESETS = ["titleCard", "listBuild", "uiWalkthrough", "endcard"];
const LIST_LAYOUTS = ["iconRow", "chipRow", "compare", "hub", "device"];

function readLib() {
  return fs.readFileSync(LIB, "utf8");
}

// top-level keys of `var NAME = { ... };`, found by brace depth so nested
// arrays and objects inside each entry are skipped
function objectKeys(src, varName) {
  const start = src.indexOf("var " + varName + " = {");
  if (start === -1) return [];
  // line comments between entries can hold colons ("from 2026-08-02:"),
  // which would otherwise read as a key and swallow the next real one
  src = src.slice(start).replace(/\/\/[^\n]*/g, "");
  let i = src.indexOf("{");
  let depth = 0;
  const keys = [];
  let tokenStart = -1;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "{" || c === "[") {
      depth++;
      if (depth === 1) tokenStart = i + 1;
      continue;
    }
    if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) break;
      if (depth === 1) tokenStart = i + 1;
      continue;
    }
    if (depth === 1 && c === ",") { tokenStart = i + 1; continue; }
    if (depth === 1 && c === ":" && tokenStart !== -1) {
      const k = src.slice(tokenStart, i).trim().replace(/^"|"$/g, "");
      if (/^[A-Za-z0-9_-]+$/.test(k)) keys.push(k);
      tokenStart = -1;
    }
  }
  return keys;
}

function transitDurations(src) {
  const m = src.match(/var transitDur = (\{[^}]*\})/);
  if (!m) return {};
  const out = {};
  m[1].replace(/([A-Za-z]+)\s*:\s*([0-9.]+)/g, (_, k, v) => { out[k] = Number(v); return ""; });
  return out;
}

function stages() {
  try {
    const schema = JSON.parse(fs.readFileSync(path.join(REPO, "apostle", "beats-schema.json"), "utf8"));
    return schema.properties.meta.properties.layout["enum"];
  } catch (e) {
    return ["corridor", "gallery", "carousel", "stack"];
  }
}

function brandKits() {
  const dir = path.join(REPO, "brands");
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")); } catch (e) {}
  return files.map((f) => {
    try {
      const k = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      return { path: "brands/" + f, kitId: k.kitId || f.replace(/\.json$/, ""), client: k.client || "" };
    } catch (e) {
      return { path: "brands/" + f, kitId: f.replace(/\.json$/, ""), client: "", error: "unreadable" };
    }
  });
}

function capabilities() {
  const src = readLib();
  const transits = transitDurations(src);
  return {
    layouts: LAYOUTS,
    listLayouts: LIST_LAYOUTS,
    glyphs: objectKeys(src, "MOM_GLYPHS"),
    easeProfiles: objectKeys(src, "EASE_PROFILES"),
    transits,
    stages: stages(),
    stylePresets: STYLE_PRESETS,
    brandKits: brandKits(),
    rules: {
      readabilityFloorSec: 1.8,
      headSec: 2.0,
      voLeadInSec: 0.45,
      tailBufferSec: 6,
      note: "A text beat must rest >= 1.8s after its arriving transit and before the next one departs. Moments cross-fade with a 0.3s lead."
    }
  };
}

// compact human/model-readable rendering of the manifest
function capabilitiesMarkdown(cap) {
  cap = cap || capabilities();
  const L = [];
  L.push("### Moment layouts");
  for (const k of Object.keys(cap.layouts)) {
    const d = cap.layouts[k];
    const f = Object.keys(d.fields).map((x) => x + " (" + d.fields[x] + ")").join("; ");
    L.push("- `" + k + "`: " + d.use + " Fields: " + f + ".");
  }
  L.push("");
  L.push("### Glyphs (native vector icons, always available)");
  L.push(cap.glyphs.map((g) => "`" + g + "`").join(", "));
  L.push("");
  L.push("### Camera transits between beats (seconds)");
  L.push(Object.keys(cap.transits).map((k) => "`" + k + "` " + cap.transits[k] + "s").join(", "));
  L.push("");
  L.push("### Stages (how scenes are laid out in 3D space)");
  L.push(cap.stages.map((s) => "`" + s + "`").join(", "));
  L.push("");
  L.push("### Ease profiles (motion personality)");
  L.push(cap.easeProfiles.map((s) => "`" + s + "`").join(", "));
  L.push("");
  L.push("### Brand kits on disk");
  L.push(cap.brandKits.length ? cap.brandKits.map((k) => "`" + k.path + "` (" + k.kitId + (k.client ? ", " + k.client : "") + ")").join(", ") : "(none)");
  return L.join("\n");
}

module.exports = { capabilities, capabilitiesMarkdown, objectKeys, LAYOUTS, LIST_LAYOUTS, STYLE_PRESETS };
