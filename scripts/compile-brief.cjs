#!/usr/bin/env node
/*
 * compile-brief.cjs: brief -> treatment -> approved -> spec -> build (lib + CLI).
 *
 * Opus 5.5 is the creative director and the motion designer; code does every
 * number. Two model passes with a human sign-off between them:
 *
 *   1. treatment  the brief (script, PDF, deck, notes, images) becomes a
 *                 treatment: logline, audience, structure, visual system,
 *                 VO per video, assets needed, library gaps, questions.
 *                 Rendered to treatment.md for the client/team to approve.
 *   2. spec       per video, the approved treatment becomes a moment-by-moment
 *                 spec (apostle/video-spec-schema.json), validated by
 *                 scripts/lib/validate-spec.cjs and sent back with the errors
 *                 until it passes (config.retries).
 *   then compile  scripts/lib/compile-spec.cjs turns the spec into the beats
 *                 and moments docs (timing, windows; no model involved), and
 *        build    APOSTLE.buildFromBeats -> applySkin -> applyMoments ->
 *                 (applyTransitions) -> deterministic checks, in AE.
 *
 * Model + prompt versions live in prompts/compile/config.json. Runs live in
 * .apostle-runs/compile/<client>-<n>/ (gitignored); approved outputs are
 * published into briefs/<client>/ like every other brief.
 *
 * CLI:
 *   node scripts/compile-brief.cjs treatment --client acme --brief brief.md
 *        [--attach deck.pdf,ref.png] [--brand brands/acme.json] [--notes "..."]
 *        [--provider claude-cli|mock] [--model ID]
 *   node scripts/compile-brief.cjs revise    --run DIR --notes "what to change"
 *   node scripts/compile-brief.cjs approve   --run DIR [--by NAME]
 *   node scripts/compile-brief.cjs spec      --run DIR [--video slug] [--notes "..."]
 *   node scripts/compile-brief.cjs compile   --spec briefs/acme/specs/x.json [--brand kit.json]
 *   node scripts/compile-brief.cjs build     --run DIR --video slug [--transitions iris]
 *   node scripts/compile-brief.cjs build     --beats b.json --moments m.json [--brand kit.json]
 *   node scripts/compile-brief.cjs validate  --spec file.json
 *   node scripts/compile-brief.cjs capabilities
 *
 * The AE transport is injectable (opts.aeCall), exactly as in redesign.cjs,
 * so the CEP panel drives the same functions through evalScript.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { planProviders } = require("./lib/redesign-providers.cjs");
const { capabilities, capabilitiesMarkdown } = require("./lib/capabilities.cjs");
const { compileSpec } = require("./lib/compile-spec.cjs");
const { validateSpec, validateTreatment } = require("./lib/validate-spec.cjs");
const { parseBrief, spokenWords } = require("./parse-brief.cjs");

const REPO = path.resolve(__dirname, "..");
const PROMPTS = path.join(REPO, "prompts", "compile");
// overridable so tests never write into the repo
const RUNS_ROOT = process.env.APOSTLE_COMPILE_RUNS || path.join(REPO, ".apostle-runs", "compile");
const BRIEFS_ROOT = process.env.APOSTLE_BRIEFS_ROOT || path.join(REPO, "briefs");

// ---------------- config + prompts ----------------

function loadConfig() {
  return JSON.parse(fs.readFileSync(path.join(PROMPTS, "config.json"), "utf8"));
}
function loadPrompt(name) {
  return fs.readFileSync(path.join(PROMPTS, name), "utf8").replace(/<!--[\s\S]*?-->\s*/, "");
}
function fill(tpl, vars) {
  return tpl.replace(/\{\{([A-Z_]+)\}\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : ""));
}
function stripToJson(text) {
  let t = String(text || "").trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a === -1 || b === -1 || b < a) throw new Error("no JSON object in model output");
  return t.slice(a, b + 1);
}
function slugify(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "brief";
}
function readJSON(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function writeJSON(p, o) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o, null, 1)); }
function rel(p) { return path.relative(REPO, p); }
function abs(p) { return path.isAbsolute(p) ? p : path.join(REPO, p); }

// ---------------- runs ----------------

function createRun(client) {
  const base = slugify(client);
  fs.mkdirSync(RUNS_ROOT, { recursive: true });
  let n = 1;
  while (fs.existsSync(path.join(RUNS_ROOT, base + "-" + n))) n++;
  const dir = path.join(RUNS_ROOT, base + "-" + n);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function readRun(dir) { return readJSON(path.join(dir, "run.json")); }
function writeRun(dir, run) { run.updated = new Date().toISOString(); writeJSON(path.join(dir, "run.json"), run); }
function listRuns() {
  let dirs = [];
  try { dirs = fs.readdirSync(RUNS_ROOT).filter((d) => fs.existsSync(path.join(RUNS_ROOT, d, "run.json"))); } catch (e) {}
  return dirs.map((d) => {
    const r = readRun(path.join(RUNS_ROOT, d));
    return { runDir: path.join(RUNS_ROOT, d), client: r.client, stage: r.stage, approved: !!r.approved, updated: r.updated, title: r.title || "" };
  }).sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
}

// ---------------- brief ingestion ----------------

const TEXT_EXT = [".md", ".txt", ".csv", ".json", ".srt", ".rtf"];

// Plain text is inlined into the prompt. Word files are converted with
// macOS textutil. Everything else (PDF, images, decks exported to PDF) is
// listed for the model to Read itself.
function ingest(briefText, attachPaths, log) {
  const inline = [];
  const forRead = [];
  for (const p0 of attachPaths || []) {
    const p = abs(p0);
    if (!fs.existsSync(p)) throw new Error("attachment not found: " + p0);
    const ext = path.extname(p).toLowerCase();
    if (TEXT_EXT.indexOf(ext) !== -1) {
      inline.push({ name: path.basename(p), text: fs.readFileSync(p, "utf8") });
    } else if (ext === ".docx" || ext === ".doc" || ext === ".pages") {
      try {
        const txt = execFileSync("/usr/bin/textutil", ["-convert", "txt", "-stdout", p], { encoding: "utf8", timeout: 60000 });
        inline.push({ name: path.basename(p), text: txt });
      } catch (e) {
        log && log("could not convert " + path.basename(p) + " to text; listing it for the model to Read");
        forRead.push(p);
      }
    } else {
      forRead.push(p);
    }
  }
  const full = [briefText || ""].concat(inline.map((x) => "### " + x.name + "\n\n" + x.text)).join("\n\n").trim();
  return { text: full, inline: inline.map((x) => x.name), forRead };
}

// The client's VO, when the script uses SUPER:/VO: lines. Other formats
// return null and the treatment's verbatim voScript becomes the contract.
function extractClientVO(text) {
  try {
    const { doc, stats } = parseBrief(text, {});
    if (!stats.voLines) return null;
    const vo = doc.beats.map((b) => b.vo || "").filter(Boolean).join(" ");
    return vo.trim() ? vo : null;
  } catch (e) {
    return null;
  }
}

function brandSection(kit, kitPath) {
  if (!kit) return "No brand kit selected. Propose one under `brandNotes` (fonts, colours) and set `brandKit` to null.";
  const L = ["Kit: `" + rel(abs(kitPath)) + "` (" + (kit.kitId || "") + (kit.client ? ", " + kit.client : "") + ")"];
  L.push("- Heading font: " + kit.fontHeadingPS + "; body font: " + kit.fontBodyPS);
  if (kit.colors) L.push("- Colours: " + Object.keys(kit.colors).map((k) => k + " " + kit.colors[k]).join(", "));
  if (kit.backdrop) L.push("- Backdrop: " + JSON.stringify(kit.backdrop));
  if (kit.note) L.push("- Note: " + kit.note);
  if (Array.isArray(kit.pictograms) && kit.pictograms.length) {
    L.push("- Brand pictograms available as `picto` (exact names): " + kit.pictograms.join(", "));
  } else {
    L.push("- No brand pictogram set: use glyphs only.");
  }
  return L.join("\n");
}

// ---------------- model calls ----------------

function resolveProvider(name) {
  if (name === "mock") return mockProvider;
  const p = planProviders[name || "claude-cli"];
  if (!p) throw new Error("unknown provider: " + name);
  return p;
}

/**
 * Ask for JSON, validate, and re-ask with the errors until it passes.
 * Every attempt's prompt and raw reply land in the run dir for audit.
 */
async function askJSON({ stage, tag, runDir, provider, cfg, model, buildPrompt, validate, addDirs, ctx, log }) {
  const retries = cfg.retries !== undefined ? cfg.retries : 2;
  let errors = [], previous = null, last = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const prompt = buildPrompt(errors, previous);
    const base = path.join(runDir, tag + ".attempt" + (attempt + 1));
    fs.writeFileSync(base + ".prompt.md", prompt);
    log && log(stage + ": asking " + (provider.name === "mock" ? "mock" : (model || provider.name)) + (attempt ? " (retry " + attempt + ", " + errors.length + " errors)" : "") + "…");
    const raw = await provider.plan({
      prompt, model, cwd: REPO, log, addDirs,
      timeoutSec: (cfg.timeoutSec && cfg.timeoutSec[stage]) || 900,
      effort: cfg.effort && cfg.effort[stage],
      ctx: Object.assign({ stage, attempt }, ctx || {})
    });
    fs.writeFileSync(base + ".raw.txt", raw);
    let obj;
    try { obj = JSON.parse(stripToJson(raw)); } catch (e) {
      errors = ["Your reply was not a single valid JSON object (" + e.message + "). Reply with the JSON object only."];
      previous = String(raw).slice(0, 4000);
      continue;
    }
    const v = validate(obj);
    last = { obj, warnings: v.warnings, attempts: attempt + 1 };
    if (!v.errors.length) return last;
    errors = v.errors;
    previous = JSON.stringify(obj);
    log && log(stage + ": " + v.errors.length + " validation errors, e.g. " + v.errors[0]);
  }
  const err = new Error(stage + " failed validation after " + (retries + 1) + " attempts:\n- " + errors.join("\n- "));
  err.errors = errors;
  err.last = last;
  throw err;
}

// ---------------- 1. treatment ----------------

async function treatment(opts) {
  const log = opts.log;
  const cfg = loadConfig();
  const runDir = opts.runDir || createRun(opts.client || "brief");
  const provider = resolveProvider(opts.provider || cfg.provider);
  const model = opts.model || cfg.model;
  const kitPath = opts.brand || null;
  const kit = kitPath ? readJSON(abs(kitPath)) : null;

  let briefText = opts.brief || "";
  if (opts.briefFile) briefText = fs.readFileSync(abs(opts.briefFile), "utf8") + (briefText ? "\n\n" + briefText : "");
  if (!briefText.trim() && !(opts.attach || []).length) throw new Error("no brief: pass --brief <file> or attachments");
  const ing = ingest(briefText, opts.attach, log);
  const clientVO = extractClientVO(ing.text);
  fs.writeFileSync(path.join(runDir, "brief.md"), ing.text);
  if (clientVO) fs.writeFileSync(path.join(runDir, "client-vo.txt"), clientVO);

  const run = fs.existsSync(path.join(runDir, "run.json")) ? readRun(runDir) : {
    client: opts.client || "brief", created: new Date().toISOString(), history: []
  };
  Object.assign(run, {
    stage: "treatment", approved: null, model,
    brandKit: kitPath ? rel(abs(kitPath)) : null,
    attachments: (opts.attach || []).map((p) => abs(p)),
    forRead: ing.forRead, clientVO: !!clientVO, notes: opts.notes || ""
  });

  const prior = opts.prior
    ? "## Previous treatment and the team's feedback\n\nRevise the treatment below. Keep what the feedback does not touch.\n\n```json\n" +
      JSON.stringify(opts.prior.treatment, null, 1) + "\n```\n\nFeedback: " + opts.prior.feedback
    : "";
  const attachments = ing.forRead.length
    ? "## Attachments\n\nRead each of these files now with the Read tool before you start. They are part of the brief:\n" + ing.forRead.map((p) => "- " + p).join("\n")
    : "";
  const clientVOBlock = clientVO
    ? "## The client's voiceover, as extracted by the script parser\n\nThe brief contains a VO script (" + spokenWords(clientVO) + " spoken words). It is the client's, word for word. Your `voScript` fields must reproduce it exactly.\n"
    : "";
  const tpl = loadPrompt(cfg.prompts.treatment);
  const cap = capabilities();
  const res = await askJSON({
    stage: "treatment", tag: "treatment", runDir, provider, cfg, model, log,
    addDirs: Array.from(new Set(ing.forRead.map((p) => path.dirname(p)))),
    ctx: { briefText: ing.text, clientVO, kitPath: run.brandKit },
    buildPrompt: (errors, previous) => fill(tpl, {
      BRIEF: ing.text || "(see attachments)", ATTACHMENTS: attachments, BRAND: brandSection(kit, kitPath),
      NOTES: opts.notes || "(none)", CAPABILITIES: capabilitiesMarkdown(cap), CLIENT_VO: clientVOBlock, PRIOR: prior
    }) + retryBlock(errors, previous),
    validate: (t) => validateTreatment(t, { capabilities: cap, clientVO })
  });

  const t = res.obj;
  if (!t.brandKit && run.brandKit) t.brandKit = run.brandKit;
  const n = (run.history || []).filter((h) => h.stage === "treatment").length + 1;
  writeJSON(path.join(runDir, "treatment.json"), t);
  writeJSON(path.join(runDir, "treatment." + n + ".json"), t);
  const md = treatmentMarkdown(t, res.warnings);
  fs.writeFileSync(path.join(runDir, "treatment.md"), md);
  run.title = t.title;
  run.history = (run.history || []).concat([{ stage: "treatment", n, at: new Date().toISOString(), feedback: opts.prior ? opts.prior.feedback : null, attempts: res.attempts }]);
  writeRun(runDir, run);
  log && log("treatment ready: " + rel(path.join(runDir, "treatment.md")));
  return { runDir, treatment: t, markdown: md, warnings: res.warnings };
}

async function revise(opts) {
  const run = readRun(opts.runDir);
  const prev = readJSON(path.join(opts.runDir, "treatment.json"));
  if (!opts.notes) throw new Error("revise needs --notes: what should change");
  return treatment({
    runDir: opts.runDir, client: run.client, brief: fs.readFileSync(path.join(opts.runDir, "brief.md"), "utf8"),
    attach: (run.forRead || []), brand: run.brandKit, notes: run.notes,
    prior: { treatment: prev, feedback: opts.notes },
    provider: opts.provider, model: opts.model, log: opts.log
  });
}

function approve(opts) {
  const run = readRun(opts.runDir);
  if (!fs.existsSync(path.join(opts.runDir, "treatment.json"))) throw new Error("nothing to approve: no treatment in " + opts.runDir);
  run.approved = { at: new Date().toISOString(), by: opts.by || os.userInfo().username };
  run.stage = "approved";
  writeRun(opts.runDir, run);
  return run;
}

// ---------------- 2. spec (+ compile) ----------------

async function spec(opts) {
  const log = opts.log;
  const cfg = loadConfig();
  const runDir = opts.runDir;
  const run = readRun(runDir);
  if (!run.approved && !opts.force) throw new Error("treatment is not approved yet. Review treatment.md, then run approve (or pass --force)");
  const t = readJSON(path.join(runDir, "treatment.json"));
  const provider = resolveProvider(opts.provider || cfg.provider);
  const model = opts.model || cfg.model;
  const kitPath = t.brandKit || run.brandKit;
  const kit = kitPath && fs.existsSync(abs(kitPath)) ? readJSON(abs(kitPath)) : null;
  const cap = capabilities();
  const tpl = loadPrompt(cfg.prompts.spec);
  const videos = (t.videos || []).filter((v) => !opts.video || v.slug === opts.video);
  if (!videos.length) throw new Error("no video " + (opts.video ? "'" + opts.video + "' " : "") + "in the treatment");
  const clientDir = path.join(BRIEFS_ROOT, slugify(run.client));

  const one = async (v) => {
    const vo = String(v.voScript || "").trim();
    const voBlock = "This is the approved VO for this video. Use it **verbatim**: every word, in order, split across beats. Do not add, drop or reword anything.\n\n" + vo;
    const res = await askJSON({
      stage: "spec", tag: "spec." + v.slug, runDir, provider, cfg, model, log,
      ctx: { treatment: t, video: v },
      buildPrompt: (errors, previous) => fill(tpl, {
        TREATMENT: JSON.stringify(Object.assign({}, t, { videos: undefined }), null, 1),
        VIDEO: JSON.stringify(Object.assign({}, v, { voScript: undefined }), null, 1),
        VO: voBlock, CAPABILITIES: capabilitiesMarkdown(cap), BRAND: brandSection(kit, kitPath),
        NOTES: opts.notes || run.notes || "(none)", NAME: v.name, SLUG: v.slug
      }) + retryBlock(errors, previous),
      validate: (s) => validateSpec(s, { capabilities: cap, clientVO: vo, voScope: "exact", pictos: kit && kit.pictograms })
    });
    const s = res.obj;
    s.client = run.client;
    s.briefDir = rel(clientDir);
    s.sourceRun = rel(runDir);
    writeJSON(path.join(runDir, "spec." + v.slug + ".json"), s);
    const out = compileAndPublish(s, kit, clientDir, log);
    return { slug: v.slug, name: v.name, warnings: res.warnings.concat(out.warnings), summary: out.summary, files: out.files, attempts: res.attempts };
  };

  // videos are independent; three model calls at a time
  const results = [];
  for (let i = 0; i < videos.length; i += 3) {
    results.push.apply(results, await Promise.all(videos.slice(i, i + 3).map(one)));
  }
  fs.mkdirSync(clientDir, { recursive: true });
  fs.copyFileSync(path.join(runDir, "treatment.md"), path.join(clientDir, "treatment.md"));
  writeJSON(path.join(clientDir, "treatment.json"), t);
  run.stage = "spec";
  run.videos = results.map((r) => ({ slug: r.slug, name: r.name, files: r.files }));
  writeRun(runDir, run);
  return { runDir, videos: results };
}

// spec -> beats + moments, written to the run's client folder. Also the
// path for a spec a human edited by hand (CLI `compile`).
function compileAndPublish(s, kit, clientDir, log) {
  const out = compileSpec(s, { kit, repo: REPO, spokenWords });
  const files = {
    spec: path.join(clientDir, "specs", s.slug + ".json"),
    beats: path.join(clientDir, "beats", s.slug + ".json"),
    moments: path.join(clientDir, "moments", s.slug + ".json")
  };
  writeJSON(files.spec, s);
  writeJSON(files.beats, out.beats);
  writeJSON(files.moments, out.moments);
  log && log(out.summary);
  for (const k of Object.keys(files)) files[k] = rel(files[k]);
  return { summary: out.summary, warnings: out.warnings, files };
}

function compileFile(opts) {
  const specPath = abs(opts.spec);
  const s = readJSON(specPath);
  const v = validateSpec(s, {});
  if (v.errors.length) { const e = new Error("spec is invalid:\n- " + v.errors.join("\n- ")); e.errors = v.errors; throw e; }
  const kitPath = opts.brand || s.brandKit || null;
  const kit = kitPath ? readJSON(abs(kitPath)) : null;
  const clientDir = s.briefDir ? abs(s.briefDir) : path.dirname(path.dirname(specPath));
  const out = compileAndPublish(s, kit, clientDir, opts.log);
  out.warnings = v.warnings.concat(out.warnings);
  return out;
}

function retryBlock(errors, previous) {
  if (!errors || !errors.length) return "";
  return "\n\n## Your previous reply was rejected\n\nFix every one of these and reply with the corrected JSON object only:\n" +
    errors.map((e) => "- " + e).join("\n") + (previous ? "\n\nYour previous reply:\n\n" + previous : "");
}

// ---------------- 3. build in AE ----------------

function aeShellCall(fnName, args, timeoutSec) {
  return require("./redesign.cjs").aeShellCall(fnName, args, timeoutSec);
}
async function callAE(fnName, args, timeoutSec, aeCall) {
  const res = await (aeCall || aeShellCall)(fnName, args, timeoutSec || 120);
  if (res && res.status && res.status !== "success" && res.status !== "partial") {
    throw new Error("APOSTLE." + fnName + " failed: " + JSON.stringify(res).slice(0, 500));
  }
  return res;
}

/**
 * Build one video in the open AE project. Never saves the project.
 * opts: { runDir+video | beats+moments paths, brand, transitions, aeCall, log }
 */
async function build(opts) {
  const log = opts.log || (() => {});
  let beatsPath = opts.beats, momentsPath = opts.moments, kitPath = opts.brand || null;
  if (opts.runDir) {
    const run = readRun(opts.runDir);
    const v = (run.videos || []).find((x) => x.slug === opts.video) || (run.videos || [])[0];
    if (!v) throw new Error("no compiled video in this run; run spec first");
    beatsPath = beatsPath || v.files.beats;
    momentsPath = momentsPath || v.files.moments;
    if (!kitPath) {
      const t = readJSON(path.join(opts.runDir, "treatment.json"));
      kitPath = t.brandKit || run.brandKit;
    }
  }
  if (!beatsPath || !momentsPath) throw new Error("build needs a run+video, or --beats and --moments");
  const beatsDoc = readJSON(abs(beatsPath));
  const momentsDoc = readJSON(abs(momentsPath));
  const kit = kitPath && fs.existsSync(abs(kitPath)) ? readJSON(abs(kitPath)) : null;
  const report = { steps: [], warnings: [] };

  log("Building " + beatsDoc.meta.masterName + " in After Effects…");
  const b = await callAE("buildFromBeats", [JSON.stringify(beatsDoc)], 900, opts.aeCall);
  const master = b.masterName;
  report.master = master;
  report.totalDuration = b.totalDuration;
  report.steps.push({ step: "buildFromBeats", status: b.status, beats: (b.beats || []).length });
  (b.warnings || []).forEach((w) => report.warnings.push("build: " + w));

  // the moments doc must address the comp that was actually built (_vNNN
  // auto-increments); write it back so TIMING/MOTION re-apply the right one
  momentsDoc.meta.masterName = master;
  fs.writeFileSync(abs(momentsPath), JSON.stringify(momentsDoc, null, 1));

  if (kit) {
    log("Applying brand skin…");
    const s = await callAE("applySkin", [master, JSON.stringify(kit)], 300, opts.aeCall);
    report.steps.push({ step: "applySkin", status: s.status });
    (s.warnings || []).forEach((w) => report.warnings.push("skin: " + w));
  }

  log("Building moments…");
  const m = await callAE("applyMoments", [JSON.stringify(momentsDoc)], 900, opts.aeCall);
  report.steps.push({ step: "applyMoments", status: m.status, scenes: (m.scenes || []).length, errors: (m.scenes || []).filter((x) => x.error).map((x) => x.beatId + ": " + x.error) });
  (m.warnings || []).forEach((w) => report.warnings.push("moments: " + w));

  if (opts.transitions === "iris") {
    log("Adding iris transitions…");
    const tr = await callAE("applyTransitions", [master], 600, opts.aeCall);
    report.steps.push({ step: "applyTransitions", status: tr.status });
  }

  log("Running checks…");
  const ex = await callAE("checkExpressionErrors", [master], 300, opts.aeCall);
  const sm = await callAE("checkTextSafeMargins", [master], 300, opts.aeCall);
  report.checks = {
    expressionErrors: (ex.errors || []).length,
    safeMarginViolations: (sm.violations || []).length,
    raw: { expressions: (ex.errors || []).slice(0, 10), margins: (sm.violations || []).slice(0, 10) }
  };
  report.status = (m.status === "success" && report.checks.expressionErrors === 0 && report.checks.safeMarginViolations === 0) ? "success" : "needs-review";
  report.next = "Verify motion before calling it done: run the verify-comp / review-export skill on " + master + " (rendered pixels, CLAUDE.md).";
  if (opts.runDir) writeJSON(path.join(opts.runDir, "build." + (opts.video || "video") + ".json"), report);
  log("Built " + master + " (" + report.totalDuration + "s): " + report.status);
  return report;
}

// ---------------- treatment.md ----------------

function treatmentMarkdown(t, warnings) {
  const L = [];
  const list = (a) => (a || []).map((x) => "- " + x).join("\n") || "- (none)";
  L.push("# " + (t.title || "Treatment"));
  L.push("");
  L.push("**Client:** " + (t.client || "") + "  ");
  L.push("**Logline:** " + (t.logline || ""));
  L.push("");
  L.push("## Audience and objective");
  L.push("");
  L.push("**Audience:** " + (t.audience || ""));
  L.push("");
  L.push("**Objective:** " + (t.objective || ""));
  L.push("");
  L.push("**Tone:** " + (t.tone || []).join(", "));
  L.push("");
  L.push("## Key messages");
  L.push("");
  L.push((t.keyMessages || []).map((x, i) => (i + 1) + ". " + x).join("\n"));
  L.push("");
  const vs = t.visualSystem || {};
  L.push("## Visual system");
  L.push("");
  L.push("- **Stage:** " + (vs.stage || "") + " · **Ease:** " + (vs.easeProfile || "") + " · **Transitions:** " + (vs.transitions || "none"));
  L.push("- **Layouts:** " + (vs.layoutPalette || []).join(", "));
  L.push("- **Icons:** " + (vs.iconStrategy || ""));
  L.push("- **Pacing:** " + (vs.pacing || ""));
  L.push("");
  L.push(vs.rationale || "");
  L.push("");
  L.push("**Brand:** " + (t.brandKit || "no kit") + (t.brandNotes ? ". " + t.brandNotes : ""));
  L.push("");
  for (const v of t.videos || []) {
    L.push("## " + v.name + " (" + v.slug + "), about " + v.targetSec + "s");
    L.push("");
    if (v.purpose) { L.push(v.purpose); L.push(""); }
    L.push("| Section | Intent | ~sec | What we see |");
    L.push("|---|---|---|---|");
    for (const s of v.structure || []) {
      L.push("| " + [s.title, s.intent, s.approxSec, s.visualIdea].map((x) => String(x == null ? "" : x).replace(/\|/g, "/")).join(" | ") + " |");
    }
    L.push("");
    if (v.voScript) {
      L.push("**VO" + (t.voSource === "drafted" ? " (drafted, needs client approval)" : " (client script, verbatim)") + "**, " + spokenWords(v.voScript) + " words, about " + Math.round(spokenWords(v.voScript) / 2.5) + "s at 150 wpm:");
      L.push("");
      L.push("> " + String(v.voScript).replace(/\n+/g, "\n>\n> "));
      L.push("");
    }
  }
  L.push("## Assets needed");
  L.push("");
  L.push(list(t.assetsNeeded));
  L.push("");
  L.push("## Library gaps");
  L.push("");
  L.push((t.libraryGaps || []).map((g) => "- **" + g.need + "**: " + g.why + (g.suggestion ? " _Suggestion:_ " + g.suggestion : "")).join("\n") || "- (none)");
  L.push("");
  L.push("## Risks");
  L.push("");
  L.push(list(t.risks));
  L.push("");
  L.push("## Open questions");
  L.push("");
  L.push(list(t.openQuestions));
  if (warnings && warnings.length) {
    L.push("");
    L.push("## Validator notes");
    L.push("");
    L.push(list(warnings));
  }
  L.push("");
  return L.join("\n");
}

// ---------------- offline mock ----------------
// Deterministic stand-in for the model so the whole pipeline (panel included)
// runs without a network call. It is deliberately plain: one statement per
// beat, VO split by sentence pairs.

const mockProvider = {
  name: "mock",
  available() { return true; },
  async plan({ ctx }) {
    if (ctx.stage === "treatment") {
      const vo = ctx.clientVO || "This is a drafted voiceover for the mock treatment. It exists so the pipeline can run offline. Replace it with the real model.";
      return JSON.stringify({
        title: "Mock treatment", client: "Mock", logline: "The pipeline runs end to end without a model.",
        audience: "Developers, sound on", objective: "Exercise compile-brief offline", tone: ["plain"],
        keyMessages: ["It runs"], voSource: ctx.clientVO ? "client" : "drafted", brandKit: ctx.kitPath || null, brandNotes: "",
        visualSystem: { stage: "gallery", easeProfile: "curvaceous", transitions: "none", layoutPalette: ["statement"], iconStrategy: "glyphs", pacing: "even", rationale: "mock" },
        videos: [{ slug: "mock-video", name: "MOCK_VIDEO", targetSec: Math.round(spokenWords(vo) / 2.5), purpose: "mock", structure: [{ section: "main", title: "Main", intent: "all of it", approxSec: 30, visualIdea: "statements" }], voScript: vo }],
        assetsNeeded: [], libraryGaps: [], risks: [], openQuestions: []
      });
    }
    const vo = ctx.video.voScript.replace(/\s+/g, " ").trim();
    const sentences = vo.split(/(?<=[.!?;\u2026])\s+/);
    const beats = [];
    for (let i = 0; i < sentences.length; i += 2) {
      const text = sentences.slice(i, i + 2).join(" ");
      const words = text.split(" ");
      const moments = [{ layout: "statement", super: words.slice(0, 5).join(" ").replace(/[,.;:!?\u2026]*$/, "") + ".", why: "mock" }];
      // a second, cue-placed moment exercises the cue path
      if (words.length >= 16) moments.push({ cue: words.slice(8, 12).join(" "), layout: "hero", glyph: "star", super: "Mock moment two.", why: "mock" });
      beats.push({ section: "main", vo: text, moments });
    }
    return JSON.stringify({
      schemaVersion: 2, name: ctx.video.name, slug: ctx.video.slug, briefId: ctx.video.slug,
      stage: "gallery", easeProfile: "curvaceous", format: { resolution: [1920, 1080], fps: 25 },
      timing: { mode: "wpm", wpm: 150 }, tail: 2.5, sections: [{ id: "main", title: "Main" }], beats
    });
  }
};

// ---------------- CLI ----------------

function arg(argv, flag, dflt) {
  const i = argv.indexOf(flag);
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const log = (m) => console.error("· " + m);
  const list = (s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []);
  if (!cmd || cmd === "-h" || cmd === "--help") {
    console.log(fs.readFileSync(__filename, "utf8").split("*/")[0].replace(/^#!.*\n\/\*\n?/, "").replace(/^ \* ?/gm, ""));
    return;
  }
  const common = { provider: arg(argv, "--provider"), model: arg(argv, "--model"), log };
  let out;
  if (cmd === "treatment") {
    out = await treatment(Object.assign(common, {
      client: arg(argv, "--client", "brief"), briefFile: arg(argv, "--brief"), attach: list(arg(argv, "--attach")),
      brand: arg(argv, "--brand"), notes: arg(argv, "--notes", ""), runDir: arg(argv, "--run")
    }));
    console.log(out.markdown);
    console.error("\nrun: " + rel(out.runDir) + "\nnext: review treatment.md, then `approve --run " + rel(out.runDir) + "` (or `revise --notes ...`)");
    return;
  }
  if (cmd === "revise") {
    out = await revise(Object.assign(common, { runDir: abs(arg(argv, "--run")), notes: arg(argv, "--notes") }));
    console.log(out.markdown);
    return;
  }
  if (cmd === "approve") { out = approve({ runDir: abs(arg(argv, "--run")), by: arg(argv, "--by") }); console.log("approved by " + out.approved.by); return; }
  if (cmd === "spec") {
    out = await spec(Object.assign(common, { runDir: abs(arg(argv, "--run")), video: arg(argv, "--video"), notes: arg(argv, "--notes"), force: argv.indexOf("--force") !== -1 }));
    for (const v of out.videos) {
      console.log(v.summary);
      Object.keys(v.files).forEach((k) => console.log("  " + k + ": " + v.files[k]));
      v.warnings.forEach((w) => console.log("  warn: " + w));
    }
    return;
  }
  if (cmd === "compile") {
    out = compileFile({ spec: arg(argv, "--spec"), brand: arg(argv, "--brand"), log });
    console.log(out.summary);
    Object.keys(out.files).forEach((k) => console.log("  " + k + ": " + out.files[k]));
    out.warnings.forEach((w) => console.log("  warn: " + w));
    return;
  }
  if (cmd === "validate") {
    const r = validateSpec(readJSON(abs(arg(argv, "--spec"))), {});
    r.errors.forEach((e) => console.log("ERROR " + e));
    r.warnings.forEach((w) => console.log("warn  " + w));
    console.log(r.errors.length ? "invalid" : "valid");
    process.exitCode = r.errors.length ? 1 : 0;
    return;
  }
  if (cmd === "build") {
    out = await build({
      runDir: arg(argv, "--run") ? abs(arg(argv, "--run")) : null, video: arg(argv, "--video"),
      beats: arg(argv, "--beats"), moments: arg(argv, "--moments"), brand: arg(argv, "--brand"),
      transitions: arg(argv, "--transitions"), log
    });
    console.log(JSON.stringify(Object.assign({}, out, { checks: Object.assign({}, out.checks, { raw: undefined }) }), null, 1));
    process.exitCode = out.status === "success" ? 0 : 2;
    return;
  }
  if (cmd === "capabilities") { console.log(capabilitiesMarkdown()); return; }
  if (cmd === "runs") { console.log(JSON.stringify(listRuns(), null, 1)); return; }
  throw new Error("unknown command: " + cmd + " (try --help)");
}

if (require.main === module) {
  main().catch((e) => { console.error("ERROR: " + e.message); process.exit(1); });
}

module.exports = {
  treatment, revise, approve, spec, build, compileFile, compileAndPublish, listRuns, readRun,
  treatmentMarkdown, extractClientVO, ingest, mockProvider, RUNS_ROOT, stripToJson
};
