"use strict";
/* Beats/moments resolution for an EXISTING master comp.
 *
 * The panel used to treat its own in-session parse as the only source of a
 * beats doc, so TIMING and MOTION were dead for any comp built by the CLI or
 * by Claude (i.e. almost every real job). Comps are disposable and beats JSON
 * is the source of truth — so the truth is on disk, in the build snapshots
 * apostle.jsx writes to .apostle-runs/ on every successful build, and in the
 * briefs/<client>/moments/ files.
 *
 * Shared by the panel and the CLI. Pure Node, no AE.
 */

const fs = require("fs");
const path = require("path");

const REPO_DEFAULT = path.resolve(__dirname, "..");

// snapshot files are "<masterComp>-<YYYYMMDD>-<HHMMSS>[-<tag>].json"
function snapshotRe(masterName) {
  const esc = String(masterName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("^" + esc + "-(\\d{8}-\\d{6})(?:-[^/]*)?\\.json$");
}

function looksLikeBeatsDoc(d) {
  return !!(d && d.meta && Array.isArray(d.beats) && d.beats.length);
}

/* Every build snapshot for a master comp, newest first.
 * Snapshots stamped with a DIFFERENT project file are kept but ranked last —
 * a master name can legitimately repeat across projects, and a same-named
 * snapshot from another project is a guess, not a fact. */
function listSnapshots(masterName, opts) {
  opts = opts || {};
  const repo = opts.repo || REPO_DEFAULT;
  const dir = path.join(repo, ".apostle-runs");
  const re = snapshotRe(masterName);
  const out = [];
  let names;
  try { names = fs.readdirSync(dir); } catch (e) { return out; }
  for (const f of names) {
    const m = re.exec(f);
    if (!m) continue;
    let raw;
    try { raw = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch (e) { continue; }
    const doc = typeof raw.beats === "string" ? safeParse(raw.beats) : raw.beats;
    if (!looksLikeBeatsDoc(doc)) continue;
    out.push({
      file: path.join(dir, f),
      savedAt: m[1],
      project: raw.project || null,
      sameProject: !opts.project || !raw.project || samePath(raw.project, opts.project),
      report: raw.report || null,
      doc
    });
  }
  out.sort((a, b) => (a.sameProject === b.sameProject ? b.savedAt.localeCompare(a.savedAt) : (a.sameProject ? -1 : 1)));
  return out;
}

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }

// snapshotRun writes an absolute project path, but snapshots hand-written by
// ad-hoc scripts sometimes stamp only the .aep filename. Compare on basename
// whenever either side lacks a directory component — otherwise the richer,
// newer hand-written snapshot loses to an older automatic one.
function samePath(a, b) {
  a = String(a); b = String(b);
  if (a.indexOf("/") === -1 || b.indexOf("/") === -1) return path.basename(a) === path.basename(b);
  return path.resolve(a) === path.resolve(b);
}

/* The best beats doc for a master comp, or null. */
function findSnapshot(masterName, opts) {
  const all = listSnapshots(masterName, opts);
  return all.length ? all[0] : null;
}

/* Moment files are authored per video and carry meta.masterName, so they are
 * matched by content, not by filename. Newest mtime wins. */
function findMomentsFile(masterName, opts) {
  opts = opts || {};
  const repo = opts.repo || REPO_DEFAULT;
  const briefs = path.join(repo, "briefs");
  const hits = [];
  let clients;
  try { clients = fs.readdirSync(briefs); } catch (e) { return null; }
  for (const c of clients) {
    const dir = path.join(briefs, c, "moments");
    let files;
    try { files = fs.readdirSync(dir); } catch (e) { continue; }
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const p = path.join(dir, f);
      let data;
      try { data = JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { continue; }
      if (!data || !data.meta || data.meta.masterName !== masterName) continue;
      let mtime = 0;
      try { mtime = fs.statSync(p).mtimeMs; } catch (e) {}
      hits.push({ file: p, data, mtime });
    }
  }
  if (!hits.length) return null;
  hits.sort((a, b) => b.mtime - a.mtime);
  return hits[0];
}

module.exports = { listSnapshots, findSnapshot, findMomentsFile, looksLikeBeatsDoc, REPO_DEFAULT };
