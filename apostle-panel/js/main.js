/* Apostle panel logic. CEP + Node (--enable-nodejs --mixed-context).
 * All AE work goes through jsx/host.jsx -> apostle.jsx; all parsing/diffing
 * through the same scripts/*.cjs libs the CLI and Claude use. */
"use strict";

// ---------- fail loudly, never silently -----------------------------------
// Tabs must work and errors must be visible even if the Node bootstrap
// below throws (first field report: header stuck on "connecting…", dead
// tabs — a top-level exception killed everything).
function panelFatal(where, err) {
  try {
    document.getElementById("libver").textContent = "ERROR";
    const s = document.getElementById("status");
    s.textContent = where + ": " + (err && err.message ? err.message : err);
    s.className = "err";
  } catch (e2) {}
}
window.onerror = (msg, src, line) => { panelFatal("js", msg + " @" + (src || "").split("/").pop() + ":" + line); };

// Pure-DOM tab wiring FIRST — navigation survives any bootstrap failure.
document.querySelectorAll(".tab").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    document.querySelectorAll(".pane").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    document.getElementById("tab-" + b.dataset.tab).classList.add("active");
    if (b.dataset.tab === "claude" && typeof renderJobs === "function") { try { renderJobs(); } catch (e) {} }
  })
);

// ---------- Node bootstrap -------------------------------------------------
// NB: never name a top-level binding `cep` — CEP predefines window.cep and
// the collision is a page-killing SyntaxError (found via CDP, 2026-07-28)
let fs, path, os, execFile, adobeCep, REPO, BRIDGE_DIR, JOBS_DIR, RENDER_DIR, parseLib, diffLib, redesignLib, provLib, beatsStore;
let NODE_OK = false;
try {
  if (typeof require !== "function") {
    // CEP builds where Node lives on cep_node instead of the global
    if (window.cep_node && typeof window.cep_node.require === "function") {
      window.require = window.cep_node.require;
    }
  }
  if (typeof require !== "function") throw new Error("Node disabled in CEP (no require) — check manifest CEFCommandLine and restart AE");
  fs = require("fs");
  path = require("path");
  os = require("os");
  execFile = require("child_process").execFile;
  adobeCep = window.__adobe_cep__;
  // AE swallows Cmd+V / Cmd+C at the app level (they're AE's own Paste/Copy
  // shortcuts) before the panel's Chromium view ever sees them — the terminal
  // could only paste via the right-click menu. Registering interest routes the
  // combos to the panel while it has focus. Mac virtual keycodes: V=9, C=8.
  try {
    adobeCep.registerKeyEventsInterest(JSON.stringify([
      { keyCode: 9, metaKey: true },
      { keyCode: 8, metaKey: true }
    ]));
  } catch (eKeys) {}
  const extPath = decodeURIComponent(adobeCep.getSystemPath("extension").replace("file://", ""));
  try { REPO = path.dirname(fs.realpathSync(extPath)); } catch (e) { REPO = path.dirname(extPath); }
  BRIDGE_DIR = path.join(os.homedir(), "Documents", "ae-mcp-bridge");
  JOBS_DIR = path.join(BRIDGE_DIR, "jobs");
  RENDER_DIR = path.join(BRIDGE_DIR, "renders");
  parseLib = require(path.join(REPO, "scripts", "parse-brief.cjs"));
  diffLib = require(path.join(REPO, "scripts", "diff-beats.cjs"));
  redesignLib = require(path.join(REPO, "scripts", "redesign.cjs"));
  provLib = require(path.join(REPO, "scripts", "lib", "redesign-providers.cjs"));
  beatsStore = require(path.join(REPO, "scripts", "beats-store.cjs"));
  NODE_OK = true;
} catch (bootErr) {
  panelFatal("bootstrap", bootErr);
}

// ---------- tiny helpers ---------------------------------------------------
const $id = (id) => document.getElementById(id);
const status = (msg, cls) => { const el = $id("status"); el.textContent = msg; el.className = "dim " + (cls || ""); };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

function evalJSX(code) {
  return new Promise((resolve) => adobeCep.evalScript(code, resolve));
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
  doc: null,        // BRIEF tab working doc (may not be built yet)
  docs: {},         // beats doc per master comp name — what TIMING/MOTION act on
  master: null,     // last built master comp name
  fonts: [],        // [{family, styles:[{style, ps}]}]
  plan: null,       // last diff plan
  revDoc: null,     // canonicalized revision doc
  projectId: null,  // identity of the open AE project (file path, or untitled:<pid>)
  projectPid: null, // XMP-stamped token — stable across save, unique per project
  projectInfo: null // last getProjectInfo result
};
// Panel memory is scoped per AE project: the master/doc you built in one
// project must never leak into another. Keyed by project file path. Unsaved
// (untitled) projects get NO persisted memory — a fresh project starts clean
// (Tim, 2026-07-29); state lives in RAM only until the project is saved.
const store = {
  key() { return state.projectId && state.projectId.indexOf("untitled:") !== 0 ? "apostle:" + state.projectId : null; },
  save() { const k = this.key(); if (k) try { localStorage.setItem(k, JSON.stringify({ doc: state.doc, docs: state.docs, master: state.master })); } catch (e) {} },
  load() {
    state.doc = null; state.docs = {}; state.master = null; state.plan = null; state.revDoc = null;
    const k = this.key();
    if (!k) return;
    try {
      const s = JSON.parse(localStorage.getItem(k));
      if (s) {
        state.doc = s.doc; state.master = s.master;
        state.docs = s.docs || {};
        // pre-2.11 memory held one unlabelled doc — attribute it to the
        // master it was built into rather than throwing it away
        if (!s.docs && s.doc && s.master) state.docs[s.master] = s.doc;
      }
    } catch (e) {}
  },
  cleanup() {
    // retire the pre-2.9 global blob and any memory wrongly attached to
    // untitled projects
    try {
      localStorage.removeItem("apostle");
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.indexOf("apostle:untitled:") === 0) localStorage.removeItem(k);
      }
    } catch (e) {}
  }
};

// ---------- project watcher ------------------------------------------------
// The panel outlives any one AE project. Poll the open project's identity
// (cheap DOM read) and on change: rescope memory, refresh every comp list,
// clear panes that referenced the old project. BRIEF text is never cleared —
// a draft belongs to the user, not to a project.
let projPolling = false;
async function checkProject() {
  if (projPolling || !NODE_OK) return;
  projPolling = true;
  try {
    const r = await host("getProjectInfo", []);
    if (r.ok && r.result && r.result.status === "success") applyProject(r.result);
  } catch (e) {} finally { projPolling = false; }
}

function applyProject(info) {
  // untitled projects are told apart by the XMP pid token (all of them share
  // the display name "Untitled Project"); name is the fallback when the
  // token can't be stamped
  const id = info.file || ("untitled:" + (info.pid || info.name));
  state.projectInfo = info;
  $id("projName").textContent = String(info.name).replace(/\.aep$/i, "");
  $id("projName").classList.toggle("warn", !info.file); // unsaved — RAM-only memory
  if (id === state.projectId) { state.projectPid = info.pid || state.projectPid; return; }
  const first = state.projectId === null;
  // same pid under a new id = the same project was saved (or Saved As):
  // migrate the in-RAM state to the new identity instead of clearing it,
  // and persist it now that a file-backed key exists
  const migrated = !first && info.pid && info.pid === state.projectPid;
  state.projectId = id;
  state.projectPid = info.pid || null;
  if (migrated) {
    store.save();
    status("Project saved as " + info.name + " — panel memory now persists with it.", "ok");
    return;
  }
  store.load();
  // repaint BRIEF from this project's own memory
  if (state.doc) {
    $id("btnBuild").disabled = false; $id("btnDiff").disabled = false;
    renderParse(state.doc, null);
    if (state.doc.meta && state.doc.meta.masterName) $id("masterName").value = state.doc.meta.masterName;
  } else {
    $id("btnBuild").disabled = true; $id("btnDiff").disabled = true;
    $id("parseOut").innerHTML = "";
    $id("masterName").value = "MASTER";
  }
  $id("btnApply").disabled = true;
  $id("diffOut").innerHTML = "";
  // clear stale panes BEFORE refreshing, so the refresh's own output (brand
  // fields read off the new project's comp) is not wiped by the cleanup
  if (!first) {
    $id("timingList").innerHTML = ""; $id("btnRetime").disabled = true;
    $id("brandOut").innerHTML = ""; $id("motionOut").innerHTML = ""; $id("reviewOut").innerHTML = "";
    $id("timingSrc").innerHTML = ""; $id("motionSrc").innerHTML = ""; $id("brandSrc").innerHTML = "";
    rdReset();
    status("Project changed: " + info.name + " — comp lists refreshed.", "ok");
  }
  // comp lists always mirror the live project
  refreshMasters();
  loadRdComps();
}

function rdReset() {
  rd.runDir = null; rd.selected = null; rd.comp = null;
  $id("rdAnalysis").innerHTML = ""; $id("rdGallery").innerHTML = ""; $id("rdResult").innerHTML = "";
  $id("btnRdRefs").disabled = true; $id("btnRdGenerate").disabled = true; $id("btnRdReconstruct").disabled = true;
}

// ---------- init -----------------------------------------------------------
(async function init() {
  if (!NODE_OK) return; // bootstrap already painted the error
  const init = await evalJSX('apInit("' + REPO.replace(/\\/g, "\\\\") + '")');
  try {
    const r = JSON.parse(init);
    $id("libver").textContent = r.ok ? "apostle.jsx v" + r.version : "LIBRARY ERROR";
    if (!r.ok) status(r.error, "err");
  } catch (e) { $id("libver").textContent = "HOST ERROR"; }
  store.cleanup();
  loadKitSelectors();
  await loadFonts(); // before kit load, so the font combos can resolve PS names
  const dflt = path.join(REPO, "brands", DEFAULT_KIT);
  // arm SAVE with the house default, but leave the fields alone — checkProject
  // fills them from the target comp, which is what SYNC will overwrite
  if (fs.existsSync(dflt)) selectKitSilently(dflt);
  rdProviderNote();
  await checkProject(); // scopes memory + fills comp lists for the open project
  setInterval(checkProject, 5000); // follow project switches automatically
  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => {
    checkProject();
    // leaving the CLAUDE tab must not leave keyboard focus in the (now hidden)
    // terminal — keystrokes would silently feed the session and the AE menu
    // would stay dead
    if (b.dataset.tab !== "claude" && term.xterm) { try { term.xterm.blur(); } catch (e) {} }
  }));
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

// Kits are deliberately global (repo brands/, not per-project) so CommBank
// Yello etc. are one click away in any project. Both dropdowns — the BRIEF
// parse kit and the BRAND editor kit — read the same folder.
const DEFAULT_KIT = "commbank-yello.json";
function loadKitSelectors(selectPath) {
  loadBrandKits();
  const sel = $id("kitSel");
  const keep = selectPath || sel.value;
  sel.innerHTML = "";
  try {
    for (const f of fs.readdirSync(path.join(REPO, "brands"))) {
      if (f.endsWith(".json")) sel.add(new Option(f.replace(".json", "").toUpperCase(), path.join(REPO, "brands", f)));
    }
  } catch (e) {}
  const dflt = path.join(REPO, "brands", DEFAULT_KIT);
  if (keep) sel.value = keep;
  else if (fs.existsSync(dflt)) { sel.value = dflt; $id("brandKit").value = dflt; }
}

let MASTERS = [];
async function refreshMasters() {
  const r = await host("findMasterComps", []);
  const names = r.ok ? r.result : [];
  MASTERS = names;
  for (const id of ["timingMaster", "brandMaster", "motionMaster", "reviewMaster"]) {
    const sel = $id(id);
    const keep = sel.value;
    sel.innerHTML = "";
    names.forEach((n) => sel.add(new Option(n, n)));
    if (keep && names.includes(keep)) sel.value = keep;
    else if (state.master && names.includes(state.master)) sel.value = state.master;
  }
  // setting .value in code does not fire `change`, so the dependent panes
  // would keep showing whatever was there before — refresh them explicitly.
  // Otherwise BRAND's fields silently describe a comp you are not targeting.
  await loadBrandTypography();
  noteDocSource("timingMaster", "timingSrc");
  noteDocSource("motionMaster", "motionSrc");
}

// ---------- beats doc resolution ------------------------------------------
// A master comp built by the CLI or by Claude has no doc in panel memory, and
// before 2.11 that made TIMING and MOTION permanently dead ("Build a brief
// first") for every real job. Comps are disposable, beats JSON is the source
// of truth — so fall back to the build snapshots apostle.jsx writes on every
// successful build. Resolution is ALWAYS per selected comp: acting on a doc
// belonging to a different master would retime the wrong beats into it.
function resolveDoc(master) {
  if (!master) return null;
  if (state.docs[master]) return { doc: state.docs[master], source: "panel memory" };
  // the BRIEF tab's working doc, if it names this comp (meta.masterName omits
  // the _vNNN suffix the build appends)
  const mn = state.doc && state.doc.meta && state.doc.meta.masterName;
  if (mn && (mn === master || master.indexOf(mn + "_v") === 0)) {
    state.docs[master] = state.doc;
    store.save();
    return { doc: state.doc, source: "current brief" };
  }
  let snap = null;
  try {
    snap = beatsStore.findSnapshot(master, { repo: REPO, project: state.projectInfo && state.projectInfo.file });
  } catch (e) { return null; }
  if (!snap) return null;
  state.docs[master] = snap.doc;
  store.save();
  return { doc: snap.doc, source: "build snapshot " + snap.savedAt, file: snap.file };
}

function noteDocSource(selId, outId) {
  const el = $id(outId);
  if (!el) return;
  const master = $id(selId).value;
  const r = resolveDoc(master);
  el.innerHTML = r
    ? "beats: " + esc(r.source) + " &middot; " + r.doc.beats.length + " beats"
    : '<span class="warn">no beats doc for ' + esc(master || "(no comp)") +
      " — build it from BRIEF, or drop its beats JSON in .apostle-runs/</span>";
}

// Font pickers are search-as-you-type combos in plain panel DOM. Native
// <select> popups silently fail to open in CEP on macOS once the list is
// long (296 font families) — short selects (styles, kits, comps) are fine.
async function loadFonts() {
  const r = await host("listFonts", []);
  state.fonts = r.ok && Array.isArray(r.result) ? r.result : [];
  // AE splits some families across several entries under the SAME family name
  // (CBA Beacon Sans arrives twice: Regular..ExtraBold, then Black). Two
  // identical rows in the picker are a coin flip, so label the duplicates with
  // the styles they actually carry.
  const seen = {};
  state.fonts.forEach((f) => { seen[f.family] = (seen[f.family] || 0) + 1; });
  state.fonts.forEach((f) => {
    f.label = seen[f.family] > 1
      ? f.family + "  ·  " + f.styles.map((s) => s.style).join(" / ")
      : f.family;
  });
  for (const pre of ["h", "b"]) fontCombo(pre);
}

/* The PS field is what SYNC actually sends. A family TYPED into the combo but
 * never picked from the list left that field stale, so SYNC reported success
 * while re-applying the old font — the exact "I changed the font and nothing
 * happened" symptom. Resolve the typed text before every sync, and refuse
 * rather than silently write something the user did not choose. */
function commitFamily(pre) {
  const inp = $id(pre + "Fam");
  const psEl = $id(pre + "PS");
  const typed = inp.value.trim();
  inp.classList.remove("bad");
  if (!typed) return { ok: true, ps: psEl.value }; // PS typed straight in is valid

  const cur = state.fonts[inp.dataset.i];
  // already on this family (possibly one of two same-named ones) — keep the
  // user's exact choice, including which style they selected
  if (cur && cur.family.toLowerCase() === typed.toLowerCase()) {
    const s = cur.styles[$id(pre + "Style").value];
    if (s) psEl.value = s.ps;
    return { ok: true, ps: psEl.value, family: cur.family };
  }

  const lower = typed.toLowerCase();
  let matches = [];
  state.fonts.forEach((f, i) => { if (f.family.toLowerCase() === lower) matches.push(i); });
  if (!matches.length) {
    // a raw PostScript name pasted into the family box is a legitimate answer
    for (let i = 0; i < state.fonts.length; i++) {
      for (let j = 0; j < state.fonts[i].styles.length; j++) {
        if (state.fonts[i].styles[j].ps === typed) {
          setFontByPS(pre, typed);
          return { ok: true, ps: typed, family: state.fonts[i].family };
        }
      }
    }
    // an unambiguous partial ("georgi") is what the list was already showing
    const partial = [];
    state.fonts.forEach((f, i) => { if (f.family.toLowerCase().indexOf(lower) !== -1) partial.push(i); });
    const fams = {};
    partial.forEach((i) => { fams[state.fonts[i].family] = 1; });
    if (partial.length && Object.keys(fams).length === 1) matches = partial;
    else { inp.classList.add("bad"); return { ok: false, typed }; }
  }

  // same-named families: prefer the one carrying the style already selected
  const styleEl = $id(pre + "Style");
  const wantStyle = styleEl.selectedOptions[0] ? styleEl.selectedOptions[0].text : "";
  let pick = matches[0], pickStyle = 0;
  for (const i of matches) {
    const j = state.fonts[i].styles.findIndex((s) => s.style === wantStyle);
    if (j !== -1) { pick = i; pickStyle = j; break; }
  }
  inp.value = state.fonts[pick].family;
  inp.dataset.i = pick;
  setStyles(pre, pick, pickStyle);
  return { ok: true, ps: psEl.value, family: state.fonts[pick].family };
}

function setStyles(pre, famIndex, styleIndex) {
  const f = state.fonts[famIndex];
  const st = $id(pre + "Style");
  st.innerHTML = "";
  (f ? f.styles : []).forEach((s, j) => st.add(new Option(s.style, j)));
  if (f) {
    st.value = styleIndex;
    const s = f.styles[styleIndex];
    if (s) $id(pre + "PS").value = s.ps;
  }
}

function fontCombo(pre) {
  const inp = $id(pre + "Fam");
  const box = inp.parentElement;
  const listEl = $id(pre + "FamList");

  function matches() {
    const q = inp.value.trim().toLowerCase();
    const out = [];
    state.fonts.forEach((f, i) => { if (!q || f.family.toLowerCase().indexOf(q) !== -1) out.push(i); });
    return out;
  }
  function render() {
    const m = matches().slice(0, 80);
    listEl.innerHTML = m.length
      ? m.map((i) => '<div class="comboitem" data-i="' + i + '">' + esc(state.fonts[i].label || state.fonts[i].family) + "</div>").join("")
      : '<div class="comboitem dim">no matching font</div>';
    listEl.querySelectorAll(".comboitem[data-i]").forEach((el) =>
      // mousedown (not click) so the input's blur doesn't close the list first
      el.addEventListener("mousedown", (ev) => { ev.preventDefault(); choose(Number(el.dataset.i)); }));
  }
  function choose(i) {
    const f = state.fonts[i];
    if (!f) return;
    inp.value = f.family;
    inp.dataset.i = i;
    // sensible default weight: Bold for heading, Regular for body, else first
    const want = pre === "h" ? /bold/i : /^(regular|roman|book|medium)$/i;
    let j = f.styles.findIndex((s) => want.test(s.style));
    if (j === -1) j = 0;
    setStyles(pre, i, j);
    box.classList.remove("open");
  }
  inp.addEventListener("focus", () => { inp.select(); render(); box.classList.add("open"); });
  inp.addEventListener("input", () => { render(); box.classList.add("open"); });
  // resolve whatever was typed once the list has had its chance to handle a
  // mousedown — leaving the box showing one family and the PS field another is
  // what silently synced the wrong font
  inp.addEventListener("blur", () => setTimeout(() => { box.classList.remove("open"); commitFamily(pre); }, 160));
  inp.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { const m = matches(); if (m.length) choose(m[0]); }
    if (ev.key === "Escape") box.classList.remove("open");
  });
  $id(pre + "Style").addEventListener("change", () => {
    const f = state.fonts[inp.dataset.i];
    const s = f && f.styles[$id(pre + "Style").value];
    if (s) $id(pre + "PS").value = s.ps;
  });
}

// point the combo + style select + PS field at a PostScript name (from a
// comp's typography or a brand kit); the PS field keeps the truth even when
// no installed font matches
function setFontByPS(pre, ps) {
  $id(pre + "PS").value = ps || "";
  if (!ps) return false;
  for (let i = 0; i < state.fonts.length; i++) {
    const f = state.fonts[i];
    for (let j = 0; j < f.styles.length; j++) {
      if (f.styles[j].ps === ps) {
        $id(pre + "Fam").value = f.family;
        $id(pre + "Fam").dataset.i = i;
        setStyles(pre, i, j);
        return true;
      }
    }
  }
  return false;
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
  // honor the MASTER NAME field as it reads NOW — the doc captured it at
  // parse time, and renaming after parse must not be silently ignored
  const mn = $id("masterName").value.trim();
  if (mn && state.doc.meta && state.doc.meta.masterName !== mn) {
    state.doc.meta.masterName = mn;
    state.doc.meta.title = mn;
    store.save();
  }
  status("Building in After Effects…");
  const r = await host("buildFromBeats", [JSON.stringify(state.doc)]);
  const rep = r.result;
  if (!r.ok || rep.status !== "success") return status("Build failed: " + (r.error || rep.error), "err");
  state.master = rep.masterName;
  state.docs[rep.masterName] = state.doc; // TIMING/MOTION resolve per comp
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
  state.docs[state.master] = revDoc; // the comp now holds the revised beats
  state.plan = null;
  store.save();
  $id("diffOut").innerHTML = "<p>" + results.map(esc).join("<br>") + "</p>";
  $id("btnApply").disabled = true;
  status("Sync applied. Run REVIEW before delivery.", "ok");
});

// ---------- 02 TIMING ------------------------------------------------------
$id("btnTimingLoad").addEventListener("click", loadTiming);
$id("timingMaster").addEventListener("change", () => { noteDocSource("timingMaster", "timingSrc"); loadTiming(); });
async function loadTiming() {
  const master = $id("timingMaster").value;
  if (!master) return status("No master comp in this project.", "warn");
  const res = resolveDoc(master);
  noteDocSource("timingMaster", "timingSrc");
  if (!res) {
    $id("timingList").innerHTML = "";
    $id("btnRetime").disabled = true;
    return status("No beats doc for " + master + " — nothing to retime against.", "warn");
  }
  const doc = res.doc;
  const r = await host("retimeBeats", [master, JSON.stringify(doc)]); // idempotent — returns the map
  if (!r.ok || r.result.status !== "success") return status("Timing load failed: " + (r.error || r.result.error), "err");
  let html = "";
  for (const b of r.result.beats) {
    const beat = doc.beats.find((x) => x.beatId === b.beatId);
    html += '<div class="beat"><span class="idx">' + b.arrive.toFixed(1) + "s</span>" +
      '<span class="sup">' + esc(beat ? beat.superText : b.beatId) + "</span>" +
      '<span class="meta"><input class="num durIn" data-beat="' + esc(b.beatId) + '" value="' + b.duration.toFixed(1) + '"></span></div>';
  }
  html += '<p class="dim small">Total ' + r.result.totalDuration.toFixed(1) + "s &middot; edit any duration, then APPLY RETIME (blank = auto from VO)</p>";
  $id("timingList").innerHTML = html;
  $id("btnRetime").disabled = false;
  status("Timing loaded from " + master + " (" + res.source + ").");
}
$id("btnRetime").addEventListener("click", async () => {
  const master = $id("timingMaster").value;
  const res = resolveDoc(master);
  if (!res) return status("No beats doc for " + master + ".", "warn");
  const doc = res.doc;
  document.querySelectorAll(".durIn").forEach((inp) => {
    const beat = doc.beats.find((x) => x.beatId === inp.dataset.beat);
    if (!beat) return;
    const v = parseFloat(inp.value);
    beat.durationSec = isNaN(v) ? null : v;
  });
  state.docs[master] = doc;
  store.save();
  const r = await host("retimeBeats", [master, JSON.stringify(doc)]);
  if (!r.ok || r.result.status !== "success") return status("Retime failed: " + (r.error || (r.result && r.result.error)), "err");
  let msg = "Retimed: " + r.result.totalDuration.toFixed(1) + "s";
  // A retime moves every scene boundary, and moment windows are fractions of
  // the beat's VO window — leaving them un-recomputed is what makes supers
  // drift off their illustration after a timing change.
  if ($id("timingMoments").checked) {
    let mom = null;
    try { mom = beatsStore.findMomentsFile(master, { repo: REPO }); } catch (e) {}
    if (mom) {
      const mr = await host("applyMoments", [JSON.stringify(mom.data)]);
      msg += mr.ok && mr.result.status === "success"
        ? " &middot; moments recomputed (" + path.basename(mom.file) + ")"
        : ' &middot; <span class="warn">moments re-apply failed: ' + esc(mr.error || mr.result.error) + "</span>";
    } else {
      msg += " &middot; no moments file for this master";
    }
  }
  $id("timingList").innerHTML = "<p>" + msg + "</p>" + $id("timingList").innerHTML;
  status("Retime applied — verify rendered pixels before delivery (REVIEW).", "ok");
  loadTiming();
});

// ---------- 03 BRAND -------------------------------------------------------
$id("brandMaster").addEventListener("change", loadBrandTypography); // picking a comp loads it
$id("btnBrandLoad").addEventListener("click", loadBrandTypography);

// Read the comp's OWN brand state into the fields, so what you see always
// describes the comp you are about to write to. Colours come from the CONTROL
// swatches — the same ones every fill expression reads.
async function loadBrandTypography() {
  const master = $id("brandMaster").value;
  if (!master) { $id("brandSrc").innerHTML = ""; return; }
  const r = await host("readTypography", [master]);
  if (!r.ok || r.result.status !== "success") return status("Load failed: " + (r.error || (r.result && r.result.error)), "err");
  const t = r.result;
  $id("hSize").value = t.headingSize ?? ""; $id("bSize").value = t.bodySize ?? "";
  $id("hTrack").value = t.headingTracking ?? ""; $id("bTrack").value = t.bodyTracking ?? "";
  $id("safeMargin").value = t.safeMarginPct ?? "";
  setFontByPS("h", t.headingFont);
  setFontByPS("b", t.bodyFont);
  const c = await host("readBrandColors", [master]);
  if (c.ok && c.result && c.result.status === "success") {
    const col = c.result.colors || {};
    $id("kitPrimary").value = hexOr(col.primary, $id("kitPrimary").value || "#ffcc00");
    $id("kitSecondary").value = hexOr(col.secondary, $id("kitSecondary").value || "#1e1e1e");
    $id("kitBackground").value = hexOr(col.background, $id("kitBackground").value || "#ffffff");
    $id("kitText").value = hexOr(col.text, $id("kitText").value || "#111111");
    $id("kitSurface").value = hexOr(col.surface, $id("kitSurface").value || "#ffffff");
  }
  $id("brandSrc").innerHTML = "fields now show <b>" + esc(master) + "</b>'s own brand state";
  status("Brand state loaded from " + master);
}

// Typography lives on the FONT guide layers + CONTROL sliders; colours live on
// the CONTROL swatches and only applySkin writes those. Sending typography
// alone (the pre-2.11 behaviour) is why editing the colour pickers appeared to
// do nothing to the comp.
async function syncBrandTo(master) {
  const num = (id) => { const v = parseFloat($id(id).value); return isNaN(v) ? null : v; };
  const applied = [];
  const warnings = [];
  const t = await host("applyTypography", [master, {
    headingFont: $id("hPS").value, bodyFont: $id("bPS").value,
    headingSize: num("hSize"), bodySize: num("bSize"),
    headingTracking: num("hTrack"), bodyTracking: num("bTrack"),
    safeMarginPct: num("safeMargin")
  }]);
  if (t.ok && t.result.status === "success") {
    applied.push(...t.result.applied);
    warnings.push(...t.result.warnings);
  } else {
    return { master, error: t.error || (t.result && t.result.error) || "applyTypography failed" };
  }
  const wantBackdrop = $id("brandBackdrop").checked && kitEd.data && kitEd.data.backdrop;
  if ($id("brandColors").checked || wantBackdrop) {
    // Without a `backdrop` key applySkin only rewrites CONTROL and leaves the
    // BACKDROP/CONFETTI comps alone. The gradient plane's colours are BAKED at
    // build time, so it is the one thing a CONTROL swatch cannot repaint —
    // rebuilding it is opt-in because it recreates those comps.
    const skin = {};
    if ($id("brandColors").checked) {
      skin.colors = {
        primary: $id("kitPrimary").value,
        secondary: $id("kitSecondary").value,
        background: $id("kitBackground").value,
        text: $id("kitText").value,
        surface: $id("kitSurface").value
      };
    }
    if (wantBackdrop) skin.backdrop = kitEd.data.backdrop;
    const s = await host("applySkin", [master, JSON.stringify(skin)]);
    if (s.ok && s.result.status === "success") {
      applied.push(...(s.result.comps || []));
      warnings.push(...(s.result.warnings || []));
    } else {
      warnings.push("colours: " + (s.error || (s.result && s.result.error) || "applySkin failed"));
    }
  }
  // Read the comp back and prove the fonts landed. The style expression does
  // `try { st = st.setFont(f) } catch {}`, so an unusable PostScript name is
  // swallowed in silence — without this check a no-op still reports SYNCED.
  const back = await host("readTypography", [master]);
  const got = back.ok && back.result.status === "success" ? back.result : null;
  const wantH = $id("hPS").value.trim(), wantB = $id("bPS").value.trim();
  const mismatch = [];
  if (got) {
    if (wantH && got.headingFont !== wantH) mismatch.push("heading is still " + got.headingFont + ", not " + wantH);
    if (wantB && got.bodyFont !== wantB) mismatch.push("body is still " + got.bodyFont + ", not " + wantB);
  }
  return { master, applied, warnings, mismatch, fonts: got ? got.headingFont + " / " + got.bodyFont : "?" };
}

$id("btnBrandSync").addEventListener("click", async () => {
  const one = $id("brandMaster").value;
  if (!one) return status("No master comp in this project.", "warn");
  // resolve the pickers BEFORE sending anything: a family typed but never
  // picked would otherwise sync the previous font and still report success
  const hf = commitFamily("h"), bf = commitFamily("b");
  if (!hf.ok || !bf.ok) {
    const bad = [!hf.ok ? "HEADING (“" + hf.typed + "”)" : "", !bf.ok ? "BODY (“" + bf.typed + "”)" : ""].filter(Boolean).join(" and ");
    return status("No installed font matches " + bad + " — pick one from the dropdown. Nothing was synced.", "err");
  }
  if (!$id("hPS").value.trim() || !$id("bPS").value.trim()) {
    return status("Heading and body PostScript names must both be set — RELOAD to read them off the comp.", "warn");
  }
  const targets = $id("brandAll").checked ? MASTERS.slice() : [one];
  $id("btnBrandSync").disabled = true;
  status("Syncing brand to " + targets.length + " comp" + (targets.length > 1 ? "s" : "") + "…");
  let html = "";
  let bad = 0;
  for (const m of targets) {
    const res = await syncBrandTo(m);
    if (res.error) { bad++; html += '<div class="beat"><span class="idx err">FAIL</span><span class="sup">' + esc(m) + " — " + esc(res.error) + "</span></div>"; continue; }
    const off = res.mismatch && res.mismatch.length;
    if (off) bad++;
    html += '<div class="beat"><span class="idx ' + (off ? "err" : "ok") + '">' + (off ? "NOT APPLIED" : "SYNCED") + '</span><span class="sup">' + esc(m) +
      '</span><span class="meta">' + res.applied.length + " props" +
      (res.warnings.length ? ' &middot; <span class="warn">' + res.warnings.length + " warn</span>" : "") + "</span></div>" +
      '<p class="dim small">fonts now: ' + esc(res.fonts) + "</p>" +
      (off ? '<p class="err small">' + res.mismatch.map(esc).join("<br>") + "</p>" : "") +
      (res.warnings.length ? '<p class="dim small">' + res.warnings.map(esc).join("<br>") + "</p>" : "");
  }
  $id("brandOut").innerHTML = html;
  $id("btnBrandSync").disabled = false;
  status(bad
    ? bad + " of " + targets.length + " comp(s) did NOT take the change — see the panel above."
    : "Brand synced to " + targets.length + " comp(s). Verify rendered pixels before delivery.", bad ? "err" : "ok");
});

// ---------- 03 BRAND: kit editor -------------------------------------------
// LOAD fills the typography fields + colors from a kit JSON; SAVE writes the
// fields back to that kit; SAVE AS creates a new kit file (instantly usable
// in BRIEF parsing and every project). Unknown kit fields are preserved.
const kitEd = { path: null, data: null };
const hexOr = (c, fb) => (/^#[0-9a-fA-F]{6}$/.test(c || "") ? c : fb);

$id("btnKitLoad").addEventListener("click", () => {
  const p = $id("kitSel").value;
  if (!p) return status("No kit selected.", "warn");
  loadKitIntoEditor(p);
});

function loadKitIntoEditor(p) {
  let data;
  try { data = JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return status("Kit unreadable: " + e.message, "err"); }
  kitEd.path = p; kitEd.data = data;
  setFontByPS("h", data.fontHeadingPS);
  setFontByPS("b", data.fontBodyPS);
  $id("hSize").value = data.headingSize ?? ""; $id("bSize").value = data.bodySize ?? "";
  $id("hTrack").value = data.headingTracking ?? ""; $id("bTrack").value = data.bodyTracking ?? "";
  $id("safeMargin").value = data.safeMarginPct ?? "";
  const c = data.colors || {};
  $id("kitPrimary").value = hexOr(c.primary, "#ffcc00");
  $id("kitSecondary").value = hexOr(c.secondary, "#1e1e1e");
  $id("kitBackground").value = hexOr(c.background, "#ffffff");
  $id("kitText").value = hexOr(c.text, "#111111");
  $id("kitSurface").value = hexOr(c.surface, "#ffffff");
  $id("kitName").value = "";
  $id("brandSrc").innerHTML = '<span class="warn">fields now show the KIT ' + esc(path.basename(p)) +
    " — SYNC TO COMP writes them into the target comp, RELOAD discards them</span>";
  $id("kitOut").innerHTML = '<p><span class="ok">LOADED</span> ' + esc(data.client || data.kitId || path.basename(p)) +
    ' <span class="dim">— edit fields below, SAVE writes back to the kit; SYNC TO COMP applies to the selected comp</span></p>';
}

// Point the kit editor at a file WITHOUT touching the fields — so SAVE has a
// target and the dropdown is pre-set, while the fields keep describing the
// comp. Loading a kit into the fields is an explicit LOAD KIT click.
function selectKitSilently(p) {
  try { kitEd.data = JSON.parse(fs.readFileSync(p, "utf8")); kitEd.path = p; } catch (e) {}
}

function kitFromFields(base) {
  const num = (id) => { const v = parseFloat($id(id).value); return isNaN(v) ? null : v; };
  const out = Object.assign({}, base || {});
  if ($id("hPS").value) out.fontHeadingPS = $id("hPS").value;
  if ($id("bPS").value) out.fontBodyPS = $id("bPS").value;
  if (num("hSize") !== null) out.headingSize = num("hSize");
  if (num("bSize") !== null) out.bodySize = num("bSize");
  if (num("hTrack") !== null) out.headingTracking = num("hTrack");
  if (num("bTrack") !== null) out.bodyTracking = num("bTrack");
  if (num("safeMargin") !== null) out.safeMarginPct = num("safeMargin");
  out.colors = Object.assign({}, (base && base.colors) || {}, {
    primary: $id("kitPrimary").value,
    secondary: $id("kitSecondary").value,
    background: $id("kitBackground").value,
    text: $id("kitText").value,
    surface: $id("kitSurface").value
  });
  return out;
}

$id("btnKitSave").addEventListener("click", () => {
  if (!kitEd.path) return status("LOAD a kit first (or use SAVE AS for a new one).", "warn");
  const data = kitFromFields(kitEd.data);
  try { fs.writeFileSync(kitEd.path, JSON.stringify(data, null, 2)); } catch (e) { return status("Save failed: " + e.message, "err"); }
  kitEd.data = data;
  loadKitSelectors(kitEd.path);
  $id("kitOut").innerHTML = '<p><span class="ok">SAVED</span> ' + esc(path.basename(kitEd.path)) + "</p>";
  status("Kit saved.", "ok");
});

$id("btnKitSaveAs").addEventListener("click", () => {
  const name = $id("kitName").value.trim();
  if (!name) return status("Type a kit name first.", "warn");
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!slug) return status("Kit name needs at least one letter or digit.", "warn");
  const p = path.join(REPO, "brands", slug + ".json");
  if (fs.existsSync(p)) return status("Kit '" + slug + "' already exists — LOAD it and SAVE, or pick another name.", "warn");
  const data = kitFromFields(kitEd.data);
  data.kitId = slug;
  data.client = name;
  try { fs.writeFileSync(p, JSON.stringify(data, null, 2)); } catch (e) { return status("Save failed: " + e.message, "err"); }
  kitEd.path = p; kitEd.data = data;
  loadKitSelectors(p);
  $id("kitOut").innerHTML = '<p><span class="ok">CREATED</span> ' + esc(slug + ".json") + ' <span class="dim">— now available in BRIEF parsing and every project</span></p>';
  status("Kit created: " + slug, "ok");
});

// ---------- 04 MOTION ------------------------------------------------------
$id("motionMaster").addEventListener("change", () => noteDocSource("motionMaster", "motionSrc"));
$id("btnMotionApply").addEventListener("click", async () => {
  // MOTION used to read BRAND's dropdown — it had no selector of its own, so
  // it silently retargeted whenever you touched another tab.
  const master = $id("motionMaster").value || state.master;
  if (!master) return status("No master comp in this project.", "warn");
  const res = resolveDoc(master);
  if (!res) return status("No beats doc for " + master + " — nothing to re-ease against.", "warn");
  const doc = res.doc;
  const prof = $id("easeProfile").value;
  const hh = $id("handheld").value;
  doc.meta.easeProfile = prof;
  doc.beats.forEach((b) => { b.motion = b.motion || {}; b.motion.handycam = hh; b.motion.ease = prof; });
  state.docs[master] = doc;
  store.save();
  status("Applying motion to " + master + "…");
  const r1 = await host("applyHandheldPolish", [master, JSON.stringify(doc)]);
  // beat durations are unchanged here, so scene comps keep their length and
  // moment windows stay valid — only the master's transit easing is re-laid
  const r2 = await host("retimeBeats", [master, JSON.stringify(doc)]);
  const ok = r1.ok && r1.result.status === "success" && r2.ok && r2.result.status === "success";
  $id("motionOut").innerHTML = ok
    ? '<p><span class="ok">APPLIED</span> ' + esc(master) + " &middot; handheld " + hh + " &middot; profile " + esc(prof) + "</p>"
    : '<p class="err">' + esc((r1.result && r1.result.error) || (r2.result && r2.result.error) || r1.error || r2.error || "failed") + "</p>";
  status(ok ? "Motion applied to " + master + "." : "Motion apply failed.", ok ? "ok" : "err");
});

// ---------- 05 REDESIGN ----------------------------------------------------
// AI comp redesign: analyze (AE) -> concepts (image model via fal.ai) ->
// reconstruct (LLM plan) -> apply on a DUPLICATE comp. All orchestration
// lives in scripts/redesign.cjs (shared with the CLI); the panel only
// supplies UI + its evalScript AE transport.
const rd = { runDir: null, selected: null, comp: null };

const rdAeCall = async (fn, args) => {
  const r = await host(fn, args);
  if (!r.ok) throw new Error(r.error || "host call failed: " + fn);
  return r.result;
};
const rdLog = (m) => status(m);

function fileUrl(p) { return "file://" + encodeURI(p) + "?v=" + Date.now(); }

async function loadRdComps() {
  try {
    const r = await rdAeCall("listComps", [""]);
    const sel = $id("rdComp");
    const keep = sel.value;
    sel.innerHTML = "";
    (r.comps || []).forEach((c) => sel.add(new Option((c.folder ? c.folder + "  /  " : "") + c.name, c.name)));
    if (keep) sel.value = keep;
  } catch (e) { status("Comp list failed: " + e.message, "err"); }
}
$id("btnRdComps").addEventListener("click", loadRdComps);

function rdProviderNote() {
  try {
    $id("rdProviderNote").textContent = provLib.falKey()
      ? "image model: OpenAI via fal.ai"
      : "NO FAL KEY — add FAL_API_KEY to the repo .env or ~/.apostle/fal.key";
  } catch (e) {}
}

$id("btnRdAnalyze").addEventListener("click", async () => {
  const comp = $id("rdComp").value;
  if (!comp) return status("Pick a comp.", "warn");
  $id("btnRdAnalyze").disabled = true;
  try {
    status("Analyzing " + comp + "…");
    const r = await redesignLib.analyze({ comp, aeCall: rdAeCall, log: rdLog });
    rd.runDir = r.runDir; rd.comp = comp; rd.selected = null;
    $id("rdAnalysis").innerHTML =
      '<p><span class="ok">ANALYZED</span> ' + r.spec.layers.length + " layers &middot; sampled " + r.time + "s</p>" +
      '<img class="refimg" src="' + fileUrl(r.reference) + '">' +
      '<div class="refthumbs" id="rdRefThumbs"></div>';
    $id("btnRdRefs").disabled = false;
    $id("btnRdGenerate").disabled = false;
    $id("rdGallery").innerHTML = "";
    $id("rdResult").innerHTML = "";
    $id("btnRdReconstruct").disabled = true;
    status("Analysis complete — add style refs or generate concepts.", "ok");
  } catch (e) { status("Analyze failed: " + e.message, "err"); }
  $id("btnRdAnalyze").disabled = false;
});

$id("btnRdRefs").addEventListener("click", () => {
  if (!rd.runDir) return;
  const res = window.cep.fs.showOpenDialogEx(true, false, "Style reference images (inspiration only)", null, ["png", "jpg", "jpeg", "webp"]);
  for (const f of (res && res.data) || []) {
    try { fs.copyFileSync(f, path.join(rd.runDir, "refs", path.basename(f))); } catch (e) {}
  }
  renderRefThumbs();
});
function renderRefThumbs() {
  const el = $id("rdRefThumbs");
  if (!el || !rd.runDir) return;
  const dir = path.join(rd.runDir, "refs");
  const imgs = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)) : [];
  el.innerHTML = imgs.map((f) => '<img src="' + fileUrl(path.join(dir, f)) + '" title="' + esc(f) + '">').join("");
}

async function rdGenerate(regen) {
  if (!rd.runDir) return;
  $id("btnRdGenerate").disabled = true;
  try {
    status(regen ? "Regenerating concept " + regen + "…" : "Generating concepts… (image model, ~1 min)");
    await redesignLib.generateConcepts({ runDir: rd.runDir, notes: $id("rdNotes").value, regen, log: rdLog });
    renderGallery();
    status("Concepts ready — compare, zoom, select.", "ok");
  } catch (e) { status("Concept generation failed: " + e.message, "err"); }
  $id("btnRdGenerate").disabled = false;
}
$id("btnRdGenerate").addEventListener("click", () => rdGenerate(undefined));

function renderGallery() {
  const dir = path.join(rd.runDir, "concepts");
  const imgs = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^concept-\d+\.png$/.test(f)) : [];
  imgs.sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));
  $id("rdGallery").innerHTML = imgs.length
    ? '<div class="concepts">' + imgs.map((f) => {
        const n = parseInt(f.match(/\d+/)[0], 10);
        return '<div class="concept' + (rd.selected === n ? " selected" : "") + '" data-n="' + n + '">' +
          '<img src="' + fileUrl(path.join(dir, f)) + '">' +
          '<div class="cbar"><span>CONCEPT ' + n + '</span><span>' +
          '<button class="rd-select" data-n="' + n + '">SELECT</button> ' +
          '<button class="rd-regen" data-n="' + n + '">REGEN</button></span></div></div>';
      }).join("") + "</div>"
    : "";
  document.querySelectorAll("#rdGallery .concept img").forEach((img) =>
    img.addEventListener("click", () => {
      $id("rdZoom").innerHTML = '<img src="' + img.src + '">';
      $id("rdZoom").classList.add("show");
    }));
  document.querySelectorAll("#rdGallery .rd-select").forEach((b) =>
    b.addEventListener("click", () => {
      rd.selected = Number(b.dataset.n);
      document.querySelectorAll("#rdGallery .concept").forEach((c) =>
        c.classList.toggle("selected", Number(c.dataset.n) === rd.selected));
      $id("btnRdReconstruct").disabled = false;
    }));
  document.querySelectorAll("#rdGallery .rd-regen").forEach((b) =>
    b.addEventListener("click", () => rdGenerate(Number(b.dataset.n))));
}
$id("rdZoom").addEventListener("click", () => $id("rdZoom").classList.remove("show"));

$id("btnRdReconstruct").addEventListener("click", async () => {
  if (!rd.runDir || !rd.selected) return;
  $id("btnRdReconstruct").disabled = true;
  try {
    status("Reconstructing concept " + rd.selected + " — LLM is reading both frames… (a few minutes)");
    const rec = await redesignLib.reconstruct({ runDir: rd.runDir, concept: rd.selected, log: rdLog });
    status("Plan ready (" + rec.plan.ops.length + " ops) — applying to a duplicate comp…");
    const res = await redesignLib.applyPlan({ runDir: rd.runDir, aeCall: rdAeCall, log: rdLog });
    $id("rdResult").innerHTML =
      '<p><span class="' + (res.failed ? "warn" : "ok") + '">' + (res.failed ? "PARTIAL" : "REBUILT") + "</span> " +
      esc(res.comp) + " &middot; " + res.applied + " ops applied" + (res.failed ? ", " + res.failed + " failed" : "") + "</p>" +
      '<p class="dim small">' + esc(rec.plan.summary) + "</p>" +
      (res.resultPng ? '<img class="refimg" src="' + fileUrl(res.resultPng) + '">' : "");
    status("Reconstruction done — " + res.comp + " (original untouched).", "ok");
  } catch (e) {
    $id("rdResult").innerHTML = '<p class="err">' + esc(e.message) + "</p>";
    status("Reconstruction failed.", "err");
  }
  $id("btnRdReconstruct").disabled = false;
});

// ---------- 06 REVIEW ------------------------------------------------------
$id("btnChecks").addEventListener("click", async () => {
  const master = $id("reviewMaster").value;
  if (!master) return;
  status("Running deterministic checks…");
  const m = await host("checkTextSafeMargins", [master]);
  const c = await host("checkCameraDistance", [master]);
  // must name the comp: with no argument the library falls back to AE's
  // active item, which in a panel-driven session is usually nothing at all,
  // so this line reported "?" forever instead of checking anything
  const x = await host("checkExpressionErrors", [master]);
  const line = (name, obj, key) => {
    if (!obj.ok || !obj.result || obj.result.status === "error") {
      return "<p>" + name + ': <span class="err">' + esc((obj.result && obj.result.error) || obj.error || "check failed") + "</span></p>";
    }
    const n = (obj.result[key] || []).length;
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
    project: state.projectInfo ? { file: state.projectInfo.file, name: state.projectInfo.name, pid: state.projectInfo.pid || null } : null,
    beats: state.doc,
    note: "Self-render via renderMovie, extract frames per review-export skill, score vs docs/qa-rubric.md, fix surgically, re-render. Report findings.",
    createdAt: new Date().toISOString()
  };
  fs.writeFileSync(path.join(JOBS_DIR, job.id + ".json"), JSON.stringify(job, null, 2));
  $id("reviewOut").innerHTML = '<p><span class="ok">JOB QUEUED</span> ' + job.id + ' &middot; a running Claude Code session picks this up from the bridge jobs folder</p>';
  status("Job queued for Claude.", "ok");
});

// ---------- 07 CLAUDE: embedded terminal -----------------------------------
const RELAY_PORT = 8471;
const term = { xterm: null, ws: null, fit: null };

// While the terminal's hidden textarea holds keyboard focus, AE's application
// menu is dead — macOS treats the whole app as "inside a text field". Ending
// the session never released that focus, so the menu stayed hostage until the
// user closed the project. Blur the panel and hand keyboard focus to a native
// viewer; activeViewer.setActive() is what actually revives the menu.
function releaseFocusToAE() {
  try { if (term.xterm) term.xterm.blur(); } catch (e) {}
  try { if (document.activeElement) document.activeElement.blur(); } catch (e) {}
  try { evalJSX("(function(){try{if(app.activeViewer)app.activeViewer.setActive();}catch(e){}return'1'})()"); } catch (e) {}
}
$id("btnFocusAE").addEventListener("click", () => {
  releaseFocusToAE();
  termStatus("focus returned to AE", "ok");
});

function relayEnsure() {
  // idempotent: relay exits 0 immediately if the port is already served.
  // process.execPath inside CEP is the CEF binary, NOT node — go through a
  // login shell so the user's node (homebrew/nvm) is found.
  const { spawn } = require("child_process");
  const cmd = "node '" + path.join(REPO, "scripts", "panel-relay.cjs") + "' --port " + RELAY_PORT + " --cwd '" + REPO + "'";
  const child = spawn("/bin/zsh", ["-lc", cmd], { detached: true, stdio: "ignore" });
  child.unref();
}

function termStatus(msg, cls) { const el = $id("termStatus"); el.textContent = msg; el.className = "small " + (cls || "dim"); }

function claudeArgs() {
  return $id("skipPerms").checked ? "--dangerously-skip-permissions" : "";
}

function termConnect(attempt) {
  const ws = new WebSocket("ws://127.0.0.1:" + RELAY_PORT + "/?args=" + encodeURIComponent(claudeArgs()));
  ws.binaryType = "arraybuffer";
  ws.onopen = () => {
    termStatus($id("skipPerms").checked ? "LIVE — permissions bypassed" : "LIVE", "ok");
    $id("btnTermStop").disabled = false;
    $id("btnTermStart").textContent = "RESTART SESSION";
    $id("btnTermStart").disabled = false;
    term.ws = ws;
    sendResize();
  };
  ws.onmessage = (ev) => {
    if (term.xterm) term.xterm.write(typeof ev.data === "string" ? ev.data : new Uint8Array(ev.data));
  };
  ws.onclose = () => {
    if (term.ws === ws) {
      term.ws = null;
      $id("btnTermStop").disabled = true;
      $id("btnTermStart").textContent = "START SESSION";
      $id("btnTermStart").disabled = false;
      if (term.restartPending) {
        term.restartPending = false;
        if (term.xterm) term.xterm.clear();
        termStatus("restarting…");
        setTimeout(() => startSession(), 400);
      } else {
        termStatus("session ended");
        releaseFocusToAE(); // the unfreeze: give the menu bar back when Claude is done
      }
    } else if ((attempt || 0) < 20) {
      // relay may still be starting — retry
      setTimeout(() => termConnect((attempt || 0) + 1), 250);
    } else {
      termStatus("relay unreachable — is node on PATH?", "err");
      $id("btnTermStart").disabled = false;
    }
  };
  ws.onerror = () => {};
}

function sendResize() {
  if (term.ws && term.ws.readyState === 1 && term.xterm) {
    term.ws.send("\x00resize:" + term.xterm.cols + "," + term.xterm.rows + "\n");
  }
}

// toggle persists; changing it mid-session hints at RESTART
try { $id("skipPerms").checked = localStorage.getItem("apostleSkipPerms") !== "0"; } catch (e) {}
$id("skipPerms").addEventListener("change", () => {
  try { localStorage.setItem("apostleSkipPerms", $id("skipPerms").checked ? "1" : "0"); } catch (e) {}
  if (term.ws) termStatus("toggle applies on RESTART SESSION", "warn");
});

$id("btnTermStart").addEventListener("click", () => {
  if (term.ws) {
    // live session: restart with the current toggle state
    term.restartPending = true;
    try { term.ws.close(); } catch (e) {}
    return;
  }
  startSession();
});

function startSession() {
  $id("btnTermStart").disabled = true;
  termStatus("starting relay…");
  if (!term.xterm) {
    term.xterm = new window.Terminal({
      fontSize: 11,
      fontFamily: '"SF Mono", Menlo, monospace',
      theme: { background: "#000000", foreground: "#f2f2f0", cursor: "#f2f2f0" },
      cursorBlink: true,
      scrollback: 5000
    });
    term.fit = new window.FitAddon.FitAddon();
    term.xterm.loadAddon(term.fit);
    term.xterm.open($id("terminal"));
    term.xterm.onData((d) => { if (term.ws && term.ws.readyState === 1) term.ws.send(d); });
    // Cmd+V/Cmd+C only reach us because of registerKeyEventsInterest; CEF's
    // built-in clipboard shortcuts stay dead inside AE, so do it via pb* —
    // xterm.paste() keeps bracketed paste intact for multi-line input.
    term.xterm.attachCustomKeyEventHandler((ev) => {
      if (ev.type === "keydown" && ev.metaKey && !ev.ctrlKey && !ev.altKey) {
        const k = (ev.key || "").toLowerCase();
        if (k === "v") {
          ev.preventDefault(); // keep CEF's own paste (if alive) from doubling ours
          execFile("/usr/bin/pbpaste", (err, out) => { if (!err && out && term.xterm) term.xterm.paste(out); });
          return false;
        }
        if (k === "c" && term.xterm.hasSelection()) {
          ev.preventDefault();
          const p = require("child_process").spawn("/usr/bin/pbcopy");
          p.stdin.end(term.xterm.getSelection());
          return false;
        }
      }
      return true;
    });
    window.addEventListener("resize", () => { if (term.fit) { term.fit.fit(); sendResize(); } });
  }
  term.fit.fit();
  relayEnsure();
  setTimeout(() => termConnect(0), 300);
}

$id("btnTermStop").addEventListener("click", () => {
  if (term.ws) { try { term.ws.close(); } catch (e) {} }
});

// ---------- 06 CLAUDE: one-shot + jobs -------------------------------------
$id("btnAsk").addEventListener("click", () => {
  const prompt = $id("claudePrompt").value.trim();
  if (!prompt) return;
  $id("claudeOut").textContent = "thinking…";
  // tell Claude which project is open — the bridge acts on the live project,
  // so the question should be grounded in the same one the user sees
  const projCtx = state.projectInfo
    ? "AE project currently open: " + state.projectInfo.name + (state.projectInfo.file ? " (" + state.projectInfo.file + ")" : " (unsaved)") + ".\n\n"
    : "";
  // login shell so PATH finds the claude CLI
  execFile("/bin/zsh", ["-lc", "claude -p " + JSON.stringify(projCtx + prompt)], { timeout: 120000, cwd: REPO, maxBuffer: 4 * 1024 * 1024 },
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
