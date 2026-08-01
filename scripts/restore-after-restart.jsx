// restore-after-restart.jsx — rebuild every moment layer across all 7 videos.
//
//   bash scripts/ae-run.sh scripts/restore-after-restart.jsx 1800
//
// Despite the name this is now the standard full-rebuild pass: run it after any
// change to the moments docs or to the moment/reveal code in apostle.jsx. It is
// idempotent, takes about a minute, and rebuilds moments, the expo transform
// easing and the word-by-word text reveal together (all three come out of
// applyMoments, so none of them can drift apart).
//
// Original context: late in the 2026-08-01 session AE failed scripted layer
// creation with "ReferenceError: Object is invalid" on nearly every scene. That
// was NOT session degradation — it was a stale property handle in momRect, and
// it reproduced on a cold AE until fixed. See ExtendScript trap #6 in CLAUDE.md.
//
// Everything below is idempotent, so running it on the intact videos too is
// harmless and confirms them. Order matters:
//
//   1. moments  — rebuilds the moment layers (and with them the pictograms)
//   2. motion blur — moments creates NEW layers, which do not carry the switch
//   3. checks   — expression errors and text safe margins must both come back 0
//
// NOT re-run here, because they survive independently of the moments layer and
// were verified intact: the V1 beat insert + audio split, the transit-weight
// pass, the transit-depth pass, the red change flags, and the autofit inset.
// If the project is ever rebuilt from scratch, those need re-running too — see
// briefs/commbank-yello/SCRIPT-V2-CHANGES.md.

var REPO = "/Volumes/Apostle_8TB 1/00.AAA_PROJECTS_GITHUB/ae-apostle-bridge";

$.evalFile(new File(REPO + "/apostle/apostle.jsx"));                  // unconditional: pick up edits
$.evalFile(new File(REPO + "/scripts/apply-moments-per-scene.jsx"));
$.evalFile(new File(REPO + "/scripts/enable-motion-blur.jsx"));

function restoreAfterRestart() {
  var files = [
    "video1.json",
    "video2-vo-locked.json",
    "video3-vo-locked.json",
    "video4-vo-locked.json",
    "video5-vo-locked.json",
    "video6-vo-locked.json",
    "video7-vo-locked.json"
  ];
  var masters = [
    "VIDEO_001_INTRO_v001",
    "VIDEO_002_EARNING_REDEEMING_v001",
    "VIDEO_003_EARNING_DEEP_DIVE_v001",
    "VIDEO_004_REDEEMING_DEEP_DIVE_v001",
    "VIDEO_005_CARDS_TRAVEL_v001",
    "VIDEO_006_DINE_IN_DEALS_v001",
    "VIDEO_007_CARDS_CVP_v001"
  ];

  var out = { moments: [], motionBlur: null, checks: [], ok: true };

  for (var i = 0; i < files.length; i++) {
    var r = applyMomentsPerScene(REPO + "/briefs/commbank-yello/moments/" + files[i]);
    out.moments.push({
      file: files[i], scenes: r.scenes, moments: r.moments,
      layers: r.layers, retried: r.retried || 0, failures: r.failures.length,
      firstError: r.failures.length ? r.failures[0].error.substring(0, 90) : ""
    });
    if (r.failures.length) out.ok = false;
  }

  var mb = enableMotionBlur();
  out.motionBlur = { comps: mb.comps, layersOn: mb.layersOn };

  for (var m = 0; m < masters.length; m++) {
    var rec = { master: masters[m] };
    try {
      var e = JSON.parse(APOSTLE.checkExpressionErrors(masters[m]));
      rec.exprErrors = e.errors ? e.errors.length : 0;
    } catch (e1) { rec.exprErrors = "threw"; }
    try {
      var s = JSON.parse(APOSTLE.checkTextSafeMargins(masters[m]));
      rec.unsafeText = s.violations ? s.violations.length : 0;
    } catch (e2) { rec.unsafeText = "threw"; }
    if (rec.exprErrors !== 0 || rec.unsafeText !== 0) out.ok = false;
    out.checks.push(rec);
  }

  return out;
}

// `return`, not a bare expression: ae-run.sh / executeScript wrap this body in a
// function, so an expression statement here is discarded and the report is lost.
return JSON.stringify(restoreAfterRestart());
