#!/usr/bin/env node
/*
 * redesign.cjs — orchestrator for the AI comp-redesign pipeline (lib + CLI).
 * Three decoupled modules:
 *   1. analyze      — AE extracts a design spec + renders a reference PNG
 *   2. concepts     — image model (fal.ai) generates redesign concepts
 *   3. reconstruct  — LLM turns the chosen concept into a rebuild plan;
 *      apply        — AE applies it to a DUPLICATE comp, then re-captures
 * Model calls live behind scripts/lib/redesign-providers.cjs; prompts are
 * versioned files in prompts/redesign/. Runs live in
 * .apostle-runs/redesign/<slug>-<n>/ (gitignored).
 *
 * CLI:
 *   node scripts/redesign.cjs analyze     --comp NAME [--time T] [--run DIR]
 *   node scripts/redesign.cjs concepts    --run DIR [--n 3] [--provider fal|mock]
 *                                         [--notes "..."] [--refs a.png,b.png] [--regen K]
 *   node scripts/redesign.cjs reconstruct --run DIR --concept K [--provider claude-cli|mock]
 *   node scripts/redesign.cjs apply       --run DIR
 *   node scripts/redesign.cjs comps       [--filter TEXT]
 *
 * The AE transport is injectable (opts.aeCall = async (fnName, args,
 * timeoutSec) => parsed result) so the CEP panel passes its evalScript
 * host() bridge; the default shell transport tries the file bridge
 * first, then AppleScript DoScript. AE interaction is strictly at
 * APOSTLE-function granularity — no raw script bodies — so every
 * surface drives the exact same library entry points.
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { imageProviders, planProviders } = require("./lib/redesign-providers.cjs");

const REPO = path.resolve(__dirname, "..");
const PROMPTS = path.join(REPO, "prompts", "redesign");
const SCHEMA_PATH = path.join(REPO, "apostle", "redesign-plan-schema.json");
const RUNS_ROOT = path.join(REPO, ".apostle-runs", "redesign");

function loadConfig() {
  return JSON.parse(fs.readFileSync(path.join(PROMPTS, "config.json"), "utf8"));
}
function loadPrompt(name) {
  return fs.readFileSync(path.join(PROMPTS, name), "utf8").replace(/<!--[\s\S]*?-->\s*/g, "");
}

// ---------------- AE transport (default: shell) ----------------

function aeShellCall(fnName, args, timeoutSec) {
  const lit = (args || []).map((a) => (a === undefined || a === null) ? "null" : JSON.stringify(a)).join(", ");
  const tmp = path.join(os.tmpdir(), "apostle-redesign-" + Date.now() + ".jsx");
  const loader =
    'if (typeof $.global.APOSTLE === "undefined") { $.evalFile(new File(' +
    JSON.stringify(path.join(REPO, "apostle", "apostle.jsx")) + ")); }\n";
  fs.writeFileSync(tmp, loader + "var r = $.global.APOSTLE." + fnName + "(" + lit + ");\nreturn r;");
  const t = String(timeoutSec || 90);
  let raw;
  try {
    raw = execFileSync(path.join(REPO, "scripts", "bridge-exec.sh"),
      ["executeScript", "--file", tmp, t], { encoding: "utf8", timeout: (timeoutSec + 15) * 1000 });
  } catch (e) {
    raw = execFileSync(path.join(REPO, "scripts", "ae-run.sh"),
      [tmp, t], { encoding: "utf8", timeout: (timeoutSec + 15) * 1000 });
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) {}
  }
  const outer = JSON.parse(raw);
  const inner = outer.result !== undefined ? outer.result : null;
  if (outer.status !== "success" && outer.status !== "ok") {
    throw new Error("AE transport error: " + raw.slice(0, 400));
  }
  // library functions return JSON strings
  if (typeof inner === "string") { try { return JSON.parse(inner); } catch (e) { return inner; } }
  return inner;
}

async function callAE(fnName, args, timeoutSec, aeCall) {
  const res = await (aeCall || aeShellCall)(fnName, args, timeoutSec || 90);
  if (res && res.status && res.status !== "success" && res.status !== "partial") {
    throw new Error("APOSTLE." + fnName + " failed: " + JSON.stringify(res).slice(0, 400));
  }
  return res;
}

// ---------------- runs ----------------

function slugify(s) { return s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60); }

function createRunDir(compName) {
  fs.mkdirSync(RUNS_ROOT, { recursive: true });
  const base = slugify(compName);
  let n = 1;
  while (fs.existsSync(path.join(RUNS_ROOT, base + "-" + n))) n++;
  const dir = path.join(RUNS_ROOT, base + "-" + n);
  fs.mkdirSync(path.join(dir, "concepts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "refs"), { recursive: true });
  return dir;
}

function readRun(runDir) {
  return JSON.parse(fs.readFileSync(path.join(runDir, "run.json"), "utf8"));
}
function writeRun(runDir, run) {
  fs.writeFileSync(path.join(runDir, "run.json"), JSON.stringify(run, null, 2));
}

// ---------------- module 1: analyze ----------------

async function analyze({ comp, time, runDir, aeCall, log }) {
  const dir = runDir || createRunDir(comp);
  fs.mkdirSync(path.join(dir, "concepts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "refs"), { recursive: true });
  const t = (time !== undefined && time !== null && time !== "") ? Number(time) : null;
  log && log("analyze: extracting design spec for " + comp);
  const specRes = await callAE("extractDesignSpec", [comp, t], 90, aeCall);
  fs.writeFileSync(path.join(dir, "spec.json"), JSON.stringify(specRes.spec, null, 2));
  const refPng = path.join(dir, "reference.png");
  log && log("analyze: capturing reference frame");
  const capRes = await callAE("captureCompReference", [comp, t, refPng], 180, aeCall);
  const run = { comp, createdAt: new Date().toISOString(), sampledAt: capRes.time, spec: "spec.json", reference: "reference.png" };
  writeRun(dir, run);
  return { runDir: dir, spec: specRes.spec, reference: refPng, time: capRes.time };
}

// ---------------- module 2: concepts ----------------

function textInventory(spec) {
  const texts = [];
  for (const L of spec.layers) if (L.type === "text" && L.text) texts.push('"' + L.text.replace(/\s+/g, " ").trim() + '"');
  return texts.length ? texts.join(", ") : "(no text layers)";
}

function buildConceptPrompt(spec, notes, hasRefs, cfg) {
  return loadPrompt(cfg.prompts.concept)
    .replace("{{TEXT_INVENTORY}}", textInventory(spec))
    .replace("{{DIMENSIONS}}", spec.width + "x" + spec.height + " px")
    .replace("{{NOTES}}", (notes && notes.trim()) ? notes.trim() : "none — designer's discretion within the existing brand colors and fonts.")
    .replace("{{HAS_REFS}}", hasRefs ? "- Every image after the first is a style reference supplied by the client." : "");
}

async function generateConcepts({ runDir, n, provider, notes, refs, regen, log }) {
  const cfg = loadConfig();
  const run = readRun(runDir);
  const spec = JSON.parse(fs.readFileSync(path.join(runDir, "spec.json"), "utf8"));
  const provName = provider || cfg.image.provider;
  const prov = imageProviders[provName];
  if (!prov) throw new Error("unknown image provider: " + provName);
  if (!prov.available()) throw new Error("image provider '" + provName + "' unavailable (missing key?). Set FAL_KEY or ~/.apostle/fal.key, or use --provider mock.");

  // copy refs into the run so it is self-contained
  const refPaths = [];
  for (const r of (refs || [])) {
    const dst = path.join(runDir, "refs", path.basename(r));
    if (path.resolve(r) !== path.resolve(dst)) fs.copyFileSync(r, dst);
    refPaths.push(dst);
  }
  const existingRefs = fs.readdirSync(path.join(runDir, "refs")).filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .map((f) => path.join(runDir, "refs", f));
  const allRefs = existingRefs;
  if (notes !== undefined && notes !== null) fs.writeFileSync(path.join(runDir, "notes.txt"), notes);
  const savedNotes = fs.existsSync(path.join(runDir, "notes.txt")) ? fs.readFileSync(path.join(runDir, "notes.txt"), "utf8") : "";

  const prompt = buildConceptPrompt(spec, savedNotes, allRefs.length > 0, cfg);
  const images = [path.join(runDir, "reference.png")].concat(allRefs);
  // params.image_size may be an orientation map ({landscape, portrait, square})
  // so the model's size vocabulary stays in config; resolve it from the comp.
  const params = Object.assign({}, cfg.image.params);
  if (params.image_size && typeof params.image_size === "object") {
    const ar = spec.width / spec.height;
    params.image_size = ar > 1.05 ? params.image_size.landscape
      : ar < 0.95 ? params.image_size.portrait
      : params.image_size.square;
  }
  const count = regen !== undefined && regen !== null ? 1 : (n || cfg.conceptsPerRun);
  const indices = [];
  if (regen !== undefined && regen !== null) { indices.push(regen); }
  else {
    // append after any existing concepts
    let start = 1;
    while (fs.existsSync(path.join(runDir, "concepts", "concept-" + start + ".png"))) start++;
    for (let i = 0; i < count; i++) indices.push(start + i);
  }

  const results = [];
  const jobs = indices.map((idx) => (async () => {
    const outPath = path.join(runDir, "concepts", "concept-" + idx + ".png");
    let lastErr = null;
    for (let attempt = 0; attempt <= (cfg.image.retries || 0); attempt++) {
      try {
        const t0 = Date.now();
        const r = await prov.generate({
          prompt, images, outPath,
          model: cfg.image.model, params: params,
          timeoutSec: cfg.image.timeoutSec || 240, log
        });
        results.push({ index: idx, file: outPath, ms: Date.now() - t0, meta: r.meta });
        return;
      } catch (e) {
        lastErr = e;
        log && log("concept " + idx + " attempt " + (attempt + 1) + " failed: " + e.message);
      }
    }
    results.push({ index: idx, error: lastErr.message });
  })());
  await Promise.all(jobs);
  results.sort((a, b) => a.index - b.index);

  const metaPath = path.join(runDir, "concepts", "meta.json");
  const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, "utf8")) : { generations: [] };
  meta.provider = prov.name;
  meta.model = cfg.image.model;
  meta.promptFile = cfg.prompts.concept;
  meta.prompt = prompt;
  meta.refs = allRefs.map((r) => path.basename(r));
  meta.generations.push({ at: new Date().toISOString(), results: results.map((r) => ({ index: r.index, ms: r.ms, error: r.error || null })) });
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  run.concepts = results.filter((r) => !r.error).length;
  writeRun(runDir, run);
  const failed = results.filter((r) => r.error);
  if (failed.length === results.length) throw new Error("all concept generations failed: " + failed[0].error);
  return { results, prompt };
}

// ---------------- module 3: reconstruct + apply ----------------

function stripToJson(text) {
  let t = text.trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a === -1 || b === -1 || b < a) throw new Error("no JSON object in model output");
  return t.slice(a, b + 1);
}

const KNOWN_OPS = new Set(["setText", "setFont", "setFill", "setTransform", "createText", "createShape", "createSolid", "reorder", "deleteLayer", "setEffectProperty", "applyEffect"]);
const NEEDS_LAYER = new Set(["setText", "setFont", "setFill", "setTransform", "reorder", "deleteLayer", "setEffectProperty", "applyEffect"]);

function validatePlan(plan, spec) {
  const errs = [];
  if (plan.schemaVersion !== 1) errs.push("schemaVersion must be 1");
  if (typeof plan.summary !== "string" || !plan.summary) errs.push("summary required");
  if (!Array.isArray(plan.ops) || !plan.ops.length) errs.push("ops must be a non-empty array");
  const layerNames = new Set((spec.layers || []).map((L) => L.name));
  const created = new Set();
  (plan.ops || []).forEach((o, i) => {
    const at = "ops[" + i + "] ";
    if (!KNOWN_OPS.has(o.op)) { errs.push(at + "unknown op: " + o.op); return; }
    if (NEEDS_LAYER.has(o.op)) {
      if (!o.layer) errs.push(at + o.op + " needs layer");
      else if (!layerNames.has(o.layer) && !created.has(o.layer)) errs.push(at + "targets unknown layer: " + o.layer);
    }
    if (o.op === "createText" && !o.text) errs.push(at + "createText needs text");
    if ((o.op === "createShape" || o.op === "createSolid") && (!Array.isArray(o.bounds) || o.bounds.length !== 4)) errs.push(at + o.op + " needs bounds [x,y,w,h]");
    if (o.op === "createShape" && !o.shape) errs.push(at + "createShape needs shape rect|ellipse");
    if (o.op === "setText" && typeof o.text !== "string") errs.push(at + "setText needs text");
    if (o.op === "setFill" && !Array.isArray(o.color)) errs.push(at + "setFill needs color [r,g,b]");
    if (o.name) created.add(o.name);
  });
  return errs;
}

function buildReconstructPrompt(runDir, conceptIdx, spec, cfg) {
  const refs = fs.existsSync(path.join(runDir, "refs")) ?
    fs.readdirSync(path.join(runDir, "refs")).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)) : [];
  const refList = refs.map((f) => "- Style reference: " + path.join(runDir, "refs", f)).join("\n");
  return loadPrompt(cfg.prompts.reconstruct)
    .replace("{{ORIGINAL_PNG}}", path.join(runDir, "reference.png"))
    .replace("{{CONCEPT_PNG}}", path.join(runDir, "concepts", "concept-" + conceptIdx + ".png"))
    .replace("{{REF_LIST}}", refList)
    .replace("{{SPEC_JSON}}", JSON.stringify(spec, null, 2))
    .replace("{{SCHEMA_JSON}}", fs.readFileSync(SCHEMA_PATH, "utf8"))
    .replace("{{COMP_W}}", String(spec.width))
    .replace("{{COMP_H}}", String(spec.height));
}

async function reconstruct({ runDir, concept, provider, log }) {
  const cfg = loadConfig();
  const run = readRun(runDir);
  const spec = JSON.parse(fs.readFileSync(path.join(runDir, "spec.json"), "utf8"));
  const provName = provider || cfg.plan.provider;
  const prov = planProviders[provName];
  if (!prov) throw new Error("unknown plan provider: " + provName);
  const conceptPng = path.join(runDir, "concepts", "concept-" + concept + ".png");
  if (!fs.existsSync(conceptPng)) throw new Error("concept image missing: " + conceptPng);

  let prompt = buildReconstructPrompt(runDir, concept, spec, cfg);
  let plan = null, raw = "";
  for (let attempt = 0; attempt <= (cfg.plan.retries || 0); attempt++) {
    log && log("reconstruct: asking " + provName + (attempt ? " (retry " + attempt + ")" : ""));
    raw = await prov.plan({ prompt, model: cfg.plan.model || undefined, timeoutSec: cfg.plan.timeoutSec || 420, cwd: runDir, log });
    fs.writeFileSync(path.join(runDir, "plan-raw.txt"), raw);
    let errs;
    try {
      plan = JSON.parse(stripToJson(raw));
      errs = validatePlan(plan, spec);
    } catch (e) {
      errs = ["output was not valid JSON: " + e.message];
      plan = null;
    }
    if (!errs.length) break;
    plan = null;
    log && log("reconstruct: plan invalid — " + errs.join("; "));
    prompt += "\n\nYour previous output was rejected: " + errs.join("; ") + "\nOutput the corrected JSON object only.";
  }
  if (!plan) throw new Error("reconstruction LLM never produced a valid plan (see plan-raw.txt)");
  fs.writeFileSync(path.join(runDir, "plan.json"), JSON.stringify(plan, null, 2));
  run.plan = "plan.json";
  run.chosenConcept = concept;
  writeRun(runDir, run);
  return { plan, planPath: path.join(runDir, "plan.json") };
}

async function applyPlan({ runDir, aeCall, log }) {
  const run = readRun(runDir);
  const planPath = path.join(runDir, "plan.json");
  if (!fs.existsSync(planPath)) throw new Error("no plan.json in run — reconstruct first");
  log && log("apply: duplicating " + run.comp);
  const dup = await callAE("duplicateForRedesign", [run.comp], 60, aeCall);
  log && log("apply: applying plan to " + dup.comp);
  const res = await callAE("applyRebuildPlan", [dup.comp, fs.readFileSync(planPath, "utf8")], 180, aeCall);
  const resultPng = path.join(runDir, "result.png");
  let capture = null;
  try {
    capture = await callAE("captureCompReference", [dup.comp, null, resultPng], 180, aeCall);
  } catch (e) { log && log("apply: result capture failed: " + e.message); }
  const result = { comp: dup.comp, from: run.comp, applied: res.applied, failed: res.failed, status: res.status, ops: res.ops, resultPng: capture ? resultPng : null, at: new Date().toISOString() };
  fs.writeFileSync(path.join(runDir, "result.json"), JSON.stringify(result, null, 2));
  run.result = "result.json";
  run.redesignComp = dup.comp;
  writeRun(runDir, run);
  return result;
}

// ---------------- CLI ----------------

function cliArg(argv, flag, dflt) {
  const i = argv.indexOf(flag);
  return i !== -1 ? argv[i + 1] : dflt;
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const log = (m) => console.error("[redesign] " + m);
  try {
    if (cmd === "comps") {
      const r = await callAE("listComps", [cliArg(argv, "--filter", "") || ""], 60);
      console.log(JSON.stringify(r.comps, null, 2));
    } else if (cmd === "analyze") {
      const comp = cliArg(argv, "--comp");
      if (!comp) throw new Error("--comp required");
      const t = cliArg(argv, "--time");
      const r = await analyze({ comp, time: t !== undefined ? Number(t) : undefined, runDir: cliArg(argv, "--run"), log });
      console.log(JSON.stringify({ runDir: r.runDir, reference: r.reference, layers: r.spec.layers.length, sampledAt: r.time }, null, 2));
    } else if (cmd === "concepts") {
      const runDir = cliArg(argv, "--run");
      if (!runDir) throw new Error("--run required");
      const refsArg = cliArg(argv, "--refs", "");
      const regen = cliArg(argv, "--regen");
      const r = await generateConcepts({
        runDir: path.resolve(runDir),
        n: Number(cliArg(argv, "--n", "0")) || undefined,
        provider: cliArg(argv, "--provider"),
        notes: cliArg(argv, "--notes"),
        refs: refsArg ? refsArg.split(",").map((s) => s.trim()).filter(Boolean) : [],
        regen: regen !== undefined ? Number(regen) : undefined,
        log
      });
      console.log(JSON.stringify(r.results, null, 2));
    } else if (cmd === "reconstruct") {
      const runDir = cliArg(argv, "--run");
      const concept = cliArg(argv, "--concept");
      if (!runDir || !concept) throw new Error("--run and --concept required");
      const r = await reconstruct({ runDir: path.resolve(runDir), concept: Number(concept), provider: cliArg(argv, "--provider"), log });
      console.log(JSON.stringify({ planPath: r.planPath, summary: r.plan.summary, ops: r.plan.ops.length }, null, 2));
    } else if (cmd === "apply") {
      const runDir = cliArg(argv, "--run");
      if (!runDir) throw new Error("--run required");
      const r = await applyPlan({ runDir: path.resolve(runDir), log });
      console.log(JSON.stringify(r, null, 2));
    } else {
      console.error("usage: redesign.cjs comps|analyze|concepts|reconstruct|apply (see header)");
      process.exit(2);
    }
  } catch (e) {
    console.error("[redesign] ERROR: " + e.message);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { analyze, generateConcepts, reconstruct, applyPlan, validatePlan, createRunDir, readRun, callAE, aeShellCall, RUNS_ROOT };
