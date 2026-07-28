/* Apostle panel logic. CEP + Node (--enable-nodejs --mixed-context).
 * All AE work goes through jsx/host.jsx -> apostle.jsx; all parsing/diffing
 * through the same scripts/*.cjs libs the CLI and Claude use. */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");

// ---------- environment ----------------------------------------------------
const cep = window.__adobe_cep__;
const extPath = decodeURIComponent(cep.getSystemPath("extension").replace("file://", ""));
let REPO;
try { REPO = path.dirname(fs.realpathSync(extPath)); } catch (e) { REPO = path.dirname(extPath); }
const BRIDGE_DIR = path.join(os.homedir(), "Documents", "ae-mcp-bridge");
const JOBS_DIR = path.join(BRIDGE_DIR, "jobs");
const RENDER_DIR = path.join(BRIDGE_DIR, "renders");

const parseLib = require(path.join(REPO, "scripts", "parse-brief.cjs"));
const diffLib = require(path.join(REPO, "scripts", "diff-beats.cjs"));

// ---------- tiny helpers ---------------------------------------------------
const $id = (id) => document.getElementById(id);
const status = (msg, cls) => { const el = $id("status"); el.textContent = msg; el.className = "dim " + (cls || ""); };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

function evalJSX(code) {
  return new Promise((resolve) => cep.evalScript(code, resolve));
}
async function host(fnName, args) {
  let argsPath = "";
  if (args && args.length) {
    argsPath = path.join(os.tmpdir(), "apostle-args-" + Date.now() + ".json");
    fs.writeFileSync(argsPath, JSON.stringify(args));
  }
  const raw = await evalJSX('apCallFile("' + fnName + '", "' + argsPath.replace(/\\/g, "\\\\") + '")');
  if (argsPath) { try { fs.unlinkSync(argsPath); } catch (e) {} }
  let res;
  try { res = JSON.parse(raw); } catch (e) { return { ok: false, error: "host returned non-JSON: " + raw }; }
  if (res.ok && res.isJSON) { try { return { ok: true, result: JSON.parse(res.raw) }; } catch (e) { return { ok: true, result: res.raw }; } }
  return res;
}

// ---------- state ----------------------------------------------------------
const state = {
  doc: null,        // last parsed/built beats doc
  master: null,     // last built master comp name
  fonts: [],        // [{family, styles:[{style, ps}]}]
  plan: null,       // last diff plan
  revDoc: null      // canonicalized revision doc
};
const store = {
  save() { try { localStorage.setItem("apostle", JSON.stringify({ doc: state.doc, master: state.master })); } catch (e) {} },
  load() { try { const s = JSON.parse(localStorage.getItem("apostle")); if (s) { state.doc = s.doc; state.master = s.master; } } catch (e) {} }
};

// ---------- init -----------------------------------------------------------
(async function init() {
  store.load();
  document.querySelectorAll(".tab").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
      document.querySelectorAll(".pane").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      $id("tab-" + b.dataset.tab).classList.add("active");
      if (b.dataset.tab === "claude") renderJobs();
    })
  );
  const init = await evalJSX('apInit("' + REPO.replace(/\\/g, "\\\\") + '")');
  try {
    const r = JSON.parse(init);
    $id("libver").textContent = r.ok ? "apostle.jsx v" + r.version : "LIBRARY ERROR";
    if (!r.ok) status(r.error, "err");
  } catch (e) { $id("libver").textContent = "HOST ERROR"; }
  loadBrandKits();
  refreshMasters();
  loadFonts();
  if (state.doc) { $id("btnBuild").disabled = false; $id("btnDiff").disabled = false; renderParse(state.doc, null); }
  [JOBS_DIR, RENDER_DIR].forEach((d) => { try { fs.mkdirSync(d, { recursive: true }); } catch (e) {} });
})();

function loadBrandKits() {
  const sel = $id("brandKit");
  sel.innerHTML = "";
  try {
    for (const f of fs.readdirSync(path.join(REPO, "brands"))) {
      if (f.endsWith(".json")) sel.add(new Option(f.replace(".json", "").toUpperCase(), path.join(REPO, "brands", f)));
    }
  } catch (e) {}
  sel.add(new Option("— NONE —", ""));
}

async function refreshMasters() {
  const r = await host("findMasterComps", []);
  const names = r.ok ? r.result : [];
  for (const id of ["timingMaster", "brandMaster", "reviewMaster"]) {
    const sel = $id(id);
    const keep = sel.value;
    sel.innerHTML = "";
    names.forEach((n) => sel.add(new Option(n, n)));
    if (keep && names.includes(keep)) sel.value = keep;
    else if (state.master && names.includes(state.master)) sel.value = state.master;
  }
}

async function loadFonts() {
  const r = await host("listFonts", []);
  state.fonts = r.ok && Array.isArray(r.result) ? r.result : [];
  for (const pre of ["h", "b"]) {
    const fam = $id(pre + "Fam");
    fam.innerHTML = "";
    state.fonts.forEach((f, i) => fam.add(new Option(f.family, i)));
    fam.addEventListener("change", () => {
      const styles = state.fonts[fam.value]?.styles || [];
      const st = $id(pre + "Style");
      st.innerHTML = "";
      styles.forEach((s, j) => st.add(new Option(s.style, j)));
      st.dispatchEvent(new Event("change"));
    });
    $id(pre + "Style").addEventListener("change", () => {
      const f = state.fonts[fam.value];
      const s = f?.styles[$id(pre + "Style").value];
      if (s) $id(pre + "PS").value = s.ps;
    });
  }
}

// ---------- 01 BRIEF -------------------------------------------------------
function currentKit() {
  const p = $id("brandKit").value;
  if (!p) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return null; }
}

$id("btnParse").addEventListener("click", () => {
  const raw = $id("briefText").value;
  if (!raw.trim()) return status("Paste a script first.", "warn");
  const kit = currentKit();
  const { doc, stats } = parseLib.parseBrief(raw, {
    kit,
    briefId: ($id("masterName").value || "brief").toLowerCase(),
    masterName: $id("masterName").value || "MASTER",
    title: $id("masterName").value || "MASTER"
  });
  state.doc = doc;
  store.save();
  renderParse(doc, stats);
  $id("btnBuild").disabled = false;
  $id("btnDiff").disabled = false;
  status("Parsed: " + stats.beats + " beats, " + stats.sections + " sections.");
});

function renderParse(doc, stats) {
  let html = "";
  let sec = null;
  for (const b of doc.beats) {
    if (b.sectionId !== sec) {
      sec = b.sectionId;
      const s = doc.sections.find((x) => x.id === sec);
      if (s) html += '<div class="sectionhead">' + esc(s.title.toUpperCase()) + "</div>";
    }
    html += '<div class="beat"><span class="idx">NO. /' + String(b.id).padStart(2, "0") + '</span>' +
      '<span class="sup">' + esc(b.superText || "(vo only)") + '</span>' +
      '<span class="meta">' + esc(b.stylePreset) + " &middot; " + b.voSpokenWords + "w</span></div>";
  }
  if (stats) html += '<p class="dim small">' + stats.totalSpokenWords + " spoken words total</p>";
  $id("parseOut").innerHTML = html;
}

$id("btnBuild").addEventListener("click", async () => {
  if (!state.doc) return;
  status("Building in After Effects…");
  const r = await host("buildFromBeats", [JSON.stringify(state.doc)]);
  const rep = r.result;
  if (!r.ok || rep.status !== "success") return status("Build failed: " + (r.error || rep.error), "err");
  state.master = rep.masterName;
  store.save();
  refreshMasters();
  const warn = rep.warnings.length ? ' &middot; <span class="warn">' + rep.warnings.length + " warnings</span>" : "";
  $id("parseOut").innerHTML = '<p><span class="ok">BUILT</span> ' + esc(rep.masterName) + " &middot; " + rep.totalDuration + "s &middot; " + rep.beats.length + " beats" + warn + "</p>" + $id("parseOut").innerHTML;
  status("Built " + rep.masterName + " (" + rep.totalDuration + "s). Verify before delivery: run REVIEW.", "ok");
});

$id("btnDiff").addEventListener("click", () => {
  const raw = $id("revText").value;
  if (!raw.trim() || !state.doc) return status("Need a built brief and a revised script.", "warn");
  const kit = currentKit();
  const { doc: revDoc } = parseLib.parseBrief(raw, {
    kit,
    prior: state.doc,
    briefId: state.doc.meta.briefId,
    masterName: state.doc.meta.masterName,
    title: state.doc.meta.title,
    scriptVersion: (state.doc.meta.scriptVersion || 1) + 1
  });
  const plan = diffLib.diffBeats(state.doc, revDoc); // mutates revDoc: inherits beatIds
  state.plan = plan;
  state.revDoc = revDoc;
  let html = "<p>" + esc(plan.summary) + "</p>";
  for (const tc of plan.textChanges) {
    html += '<div class="beat"><span class="idx">EDIT</span><span class="sup">' + esc(tc.beatId) +
      (tc.superText ? "<br><span class='dim'>" + esc(tc.oldSuperText) + "</span> &rarr; " + esc(tc.superText) : "") +
      (tc.voChanged ? " <span class='dim'>(vo/timing)</span>" : "") + "</span></div>";
  }
  for (const a of plan.added) html += '<div class="beat"><span class="idx ok">ADD</span><span class="sup">' + esc(a.superText) + "</span></div>";
  for (const rm of plan.removed) html += '<div class="beat"><span class="idx err">CUT</span><span class="sup">' + esc(rm) + "</span></div>";
  $id("diffOut").innerHTML = html;
  $id("btnApply").disabled = false;
  status("Diff ready — review then APPLY SYNC.");
});

$id("btnApply").addEventListener("click", async () => {
  const { plan, revDoc } = state;
  if (!plan || !revDoc || !state.master) return status("Nothing to apply (build first).", "warn");
  status("Applying sync to " + state.master + "…");
  const beatsJSON = JSON.stringify(revDoc);
  const results = [];
  for (const tc of plan.textChanges) {
    if (tc.superText !== undefined || tc.url !== undefined) {
      const r = await host("updateBeatText", [state.master, tc.beatId, { superText: tc.superText, url: tc.url }]);
      results.push(tc.beatId + ": " + (r.ok && r.result.status === "success" ? "ok" : (r.error || r.result.error)));
    }
  }
  if (plan.needsStructure) {
    const r = await host("applyBeatStructure", [state.master, beatsJSON]);
    results.push("structure: " + (r.ok && r.result.status === "success" ? "ok (+" + r.result.added.length + "/-" + r.result.removed.length + ")" : (r.error || r.result.error)));
  } else if (plan.needsRetime) {
    const r = await host("retimeBeats", [state.master, beatsJSON]);
    results.push("retime: " + (r.ok && r.result.status === "success" ? "ok, " + r.result.totalDuration + "s" : (r.error || r.result.error)));
  }
  state.doc = revDoc;
  state.plan = null;
  store.save();
  $id("diffOut").innerHTML = "<p>" + results.map(esc).join("<br>") + "</p>";
  $id("btnApply").disabled = true;
  status("Sync applied. Run REVIEW before delivery.", "ok");
});

// ---------- 02 TIMING ------------------------------------------------------
$id("btnTimingLoad").addEventListener("click", loadTiming);
async function loadTiming() {
  const master = $id("timingMaster").value;
  if (!master || !state.doc) return status("Build a brief first.", "warn");
  const r = await host("retimeBeats", [master, JSON.stringify(state.doc)]); // idempotent — returns the map
  if (!r.ok || r.result.status !== "success") return status("Timing load failed: " + (r.error || r.result.error), "err");
  let html = "";
  for (const b of r.result.beats) {
    const beat = state.doc.beats.find((x) => x.beatId === b.beatId);
    html += '<div class="beat"><span class="idx">' + b.arrive.toFixed(1) + "s</span>" +
      '<span class="sup">' + esc(beat ? beat.superText : b.beatId) + "</span>" +
      '<span class="meta"><input class="num durIn" data-beat="' + esc(b.beatId) + '" value="' + b.duration.toFixed(1) + '"></span></div>';
  }
  html += '<p class="dim small">Total ' + r.result.totalDuration.toFixed(1) + "s &middot; edit any duration, then APPLY RETIME (blank = auto from VO)</p>";
  $id("timingList").innerHTML = html;
  $id("btnRetime").disabled = false;
}
$id("btnRetime").addEventListener("click", async () => {
  const master = $id("timingMaster").value;
  document.querySelectorAll(".durIn").forEach((inp) => {
    const beat = state.doc.beats.find((x) => x.beatId === inp.dataset.beat);
    if (!beat) return;
    const v = parseFloat(inp.value);
    beat.durationSec = isNaN(v) ? null : v;
  });
  store.save();
  const r = await host("retimeBeats", [master, JSON.stringify(state.doc)]);
  status(r.ok && r.result.status === "success" ? "Retimed: " + r.result.totalDuration.toFixed(1) + "s" : "Retime failed", r.ok ? "ok" : "err");
  loadTiming();
});

// ---------- 03 BRAND -------------------------------------------------------
$id("btnBrandLoad").addEventListener("click", async () => {
  const master = $id("brandMaster").value;
  if (!master) return;
  const r = await host("readTypography", [master]);
  if (!r.ok || r.result.status !== "success") return status("Load failed: " + (r.error || r.result.error), "err");
  const t = r.result;
  $id("hPS").value = t.headingFont || ""; $id("bPS").value = t.bodyFont || "";
  $id("hSize").value = t.headingSize ?? ""; $id("bSize").value = t.bodySize ?? "";
  $id("hTrack").value = t.headingTracking ?? ""; $id("bTrack").value = t.bodyTracking ?? "";
  for (const [pre, ps] of [["h", t.headingFont], ["b", t.bodyFont]]) {
    state.fonts.forEach((f, i) => f.styles.forEach((s, j) => {
      if (s.ps === ps) { $id(pre + "Fam").value = i; $id(pre + "Fam").dispatchEvent(new Event("change")); $id(pre + "Style").value = j; }
    }));
  }
  status("Typography loaded from " + master);
});
$id("btnBrandSync").addEventListener("click", async () => {
  const master = $id("brandMaster").value;
  if (!master) return;
  const num = (id) => { const v = parseFloat($id(id).value); return isNaN(v) ? null : v; };
  const r = await host("applyTypography", [master, {
    headingFont: $id("hPS").value, bodyFont: $id("bPS").value,
    headingSize: num("hSize"), bodySize: num("bSize"),
    headingTracking: num("hTrack"), bodyTracking: num("bTrack")
  }]);
  const rep = r.result;
  $id("brandOut").innerHTML = r.ok && rep.status === "success"
    ? '<p><span class="ok">SYNCED</span> ' + rep.applied.length + " properties" + (rep.warnings.length ? ' &middot; <span class="warn">' + esc(rep.warnings[0]) + "</span>" : "") + "</p>"
    : '<p class="err">' + esc(r.error || rep.error) + "</p>";
});

// ---------- 04 MOTION ------------------------------------------------------
$id("btnMotionApply").addEventListener("click", async () => {
  const master = $id("brandMaster").value || state.master;
  if (!master || !state.doc) return status("Build a brief first.", "warn");
  state.doc.meta.easeProfile = $id("easeProfile").value;
  const hh = $id("handheld").value;
  state.doc.beats.forEach((b) => { b.motion = b.motion || {}; b.motion.handycam = hh; b.motion.ease = $id("easeProfile").value; });
  store.save();
  const r1 = await host("applyHandheldPolish", [master, JSON.stringify(state.doc)]);
  const r2 = await host("retimeBeats", [master, JSON.stringify(state.doc)]); // re-ease transits with profile
  const ok = r1.ok && r1.result.status === "success" && r2.ok && r2.result.status === "success";
  $id("motionOut").innerHTML = ok ? '<p><span class="ok">APPLIED</span> handheld ' + hh + " &middot; profile " + state.doc.meta.easeProfile + "</p>"
    : '<p class="err">' + esc(r1.result?.error || r2.result?.error || "failed") + "</p>";
});

// ---------- 05 REVIEW ------------------------------------------------------
$id("btnChecks").addEventListener("click", async () => {
  const master = $id("reviewMaster").value;
  if (!master) return;
  status("Running deterministic checks…");
  const m = await host("checkTextSafeMargins", [master]);
  const c = await host("checkCameraDistance", [master]);
  const x = await host("checkExpressionErrors", []);
  const line = (name, obj, key) => {
    const n = obj.ok ? (obj.result[key] || []).length : "?";
    return "<p>" + name + ": " + (n === 0 ? '<span class="ok">CLEAN</span>' : '<span class="err">' + n + "</span>") + "</p>";
  };
  $id("reviewOut").innerHTML =
    line("SAFE MARGINS", m, "violations") + line("CAMERA", c, "issues") + line("EXPRESSIONS", x, "errors");
  status("Checks done.");
});
$id("btnRender").addEventListener("click", async () => {
  const master = $id("reviewMaster").value;
  if (!master) return;
  const out = path.join(RENDER_DIR, master + ".mov");
  status("Rendering " + master + " (AE will be busy)…");
  const r = await host("renderMovie", [master, out]);
  $id("reviewOut").innerHTML = r.ok && r.result.status === "success"
    ? '<p><span class="ok">RENDERED</span> ' + r.result.seconds + "s &rarr; " + esc(r.result.out) + "</p>"
    : '<p class="err">' + esc(r.error || r.result.error) + "</p>";
  status("Render done.", "ok");
});
$id("btnClaudeReview").addEventListener("click", () => {
  const master = $id("reviewMaster").value;
  if (!master) return;
  const job = {
    id: "job-" + Date.now(),
    type: "review-export",
    master,
    beats: state.doc,
    note: "Self-render via renderMovie, extract frames per review-export skill, score vs docs/qa-rubric.md, fix surgically, re-render. Report findings.",
    createdAt: new Date().toISOString()
  };
  fs.writeFileSync(path.join(JOBS_DIR, job.id + ".json"), JSON.stringify(job, null, 2));
  $id("reviewOut").innerHTML = '<p><span class="ok">JOB QUEUED</span> ' + job.id + ' &middot; a running Claude Code session picks this up from the bridge jobs folder</p>';
  status("Job queued for Claude.", "ok");
});

// ---------- 06 CLAUDE ------------------------------------------------------
$id("btnAsk").addEventListener("click", () => {
  const prompt = $id("claudePrompt").value.trim();
  if (!prompt) return;
  $id("claudeOut").textContent = "thinking…";
  // login shell so PATH finds the claude CLI
  execFile("/bin/zsh", ["-lc", "claude -p " + JSON.stringify(prompt)], { timeout: 120000, cwd: REPO, maxBuffer: 4 * 1024 * 1024 },
    (err, stdout, stderr) => {
      $id("claudeOut").textContent = err ? ("ERROR: " + (stderr || err.message)) : stdout;
    });
});

function renderJobs() {
  let html = "";
  try {
    const jobs = fs.readdirSync(JOBS_DIR).filter((f) => f.endsWith(".json") && !f.endsWith(".result.json"));
    for (const f of jobs.slice(-10).reverse()) {
      const resultPath = path.join(JOBS_DIR, f.replace(".json", ".result.json"));
      const done = fs.existsSync(resultPath);
      html += '<div class="beat"><span class="idx ' + (done ? "ok" : "warn") + '">' + (done ? "DONE" : "OPEN") + "</span><span class='sup'>" + esc(f) + "</span></div>";
    }
  } catch (e) {}
  $id("jobsList").innerHTML = html || '<p class="dim">No jobs.</p>';
}
