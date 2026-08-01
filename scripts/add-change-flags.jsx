// add-change-flags.jsx — red ACTION REQUIRED notes for script v2 changes.
//
// Script v2 (2026-07-31) changed no facts the build was not already showing,
// and its 14 super rewordings have been applied. Exactly one thing in it
// cannot be resolved in After Effects: Video 1 gained a paragraph that was
// never recorded. That beat is built and timed, but silent.
//
// The flag is a GUIDE layer: visible to anyone who opens the project or
// scrubs the comp, and automatically excluded from every render, so a
// placeholder note can never leak into a delivered file. Red #E4002B, top of
// the layer stack, in a system font so it reads as an annotation rather than
// as brand copy someone might mistake for a super.
//
// Idempotent — re-running replaces the flags rather than stacking them.

var FLAG_TAG = "apostle change flag";
var FLAG_RED = [228 / 255, 0 / 255, 43 / 255];

var FLAGS = [
  {
    beatId: "at-the-same-time-you-might-see-chang",
    master: "VIDEO_001_INTRO_v001",
    alsoOnMaster: true,
    text:
      "[!] SCRIPT v2 CHANGE — ACTION REQUIRED\r" +
      "\r" +
      "VO NOT RECORDED. Script v2 (2026-07-31) adds this paragraph to Video 1:\r" +
      "\r" +
      "“At the same time you might see changes also following the Reserve Bank of\r" +
      "Australia’s announcement of industry-wide interchange reforms, which will\r" +
      "reshape Australian credit card marketing from 1 October 2026. As the industry\r" +
      "adapts to these changes, CommBank is evolving the reward and loyalty\r" +
      "propositions to continue delivering value to customers.”\r" +
      "\r" +
      "This beat is BUILT AND TIMED BUT SILENT — 22.32s held as a placeholder\r" +
      "(53 words at Video 1’s measured 142.7 wpm).\r" +
      "\r" +
      "TO CHANGE: record the pickup VO, drop it into the 22.32s silent gap that\r" +
      "starts at 18.72s on the master (the recorded VO is already split there and\r" +
      "its tail slipped by 22.32s). If the delivered read is not 22.32s, update\r" +
      "durationSec in beats/video1-vo-locked.json, then re-run applyBeatStructure\r" +
      "and apply-moments-per-scene."
  }
];

function flagFindComp(masterName, beatId) {
  for (var i = 1; i <= app.project.numItems; i++) {
    var it = app.project.item(i);
    if (!(it instanceof CompItem)) continue;
    if (it.name.indexOf(masterName) !== 0) continue;
    if (it.comment && it.comment.indexOf("beatId=" + beatId) !== -1) return it;
  }
  return null;
}

function flagRemoveExisting(comp) {
  for (var L = comp.numLayers; L >= 1; L--) {
    var ly = comp.layer(L);
    if (ly.comment && ly.comment.indexOf(FLAG_TAG) !== -1) ly.remove();
  }
}

function flagAdd(comp, text) {
  flagRemoveExisting(comp);
  var tl = comp.layers.addText(text);
  tl.startTime = 0; // trap #2
  tl.name = "!! SCRIPT v2 — ACTION REQUIRED";
  tl.comment = FLAG_TAG;
  tl.guideLayer = true;   // never renders
  tl.label = 1;           // red label in the timeline too
  tl.enabled = true;

  var td = tl.property("ADBE Text Properties").property("ADBE Text Document");
  var doc = td.value;
  doc.resetCharStyle();
  doc.fontSize = 26;
  doc.applyFill = true;
  doc.fillColor = FLAG_RED;
  doc.applyStroke = false;
  doc.justification = ParagraphJustification.LEFT_JUSTIFY;
  try { doc.font = "Helvetica-Bold"; } catch (eF) {}
  td.setValue(doc);

  // top-left, inside the safe area, spanning the frame
  tl.property("ADBE Transform Group").property("ADBE Position").setValue([120, 130]);
  tl.moveToBeginning();
  tl.inPoint = 0;
  tl.outPoint = comp.duration;
  return tl;
}

function addChangeFlags() {
  app.beginUndoGroup("Apostle change flags");
  var report = { added: [], missing: [] };
  try {
    for (var f = 0; f < FLAGS.length; f++) {
      var spec = FLAGS[f];
      var scene = flagFindComp(spec.master, spec.beatId);
      if (!scene) { report.missing.push(spec.beatId); continue; }
      flagAdd(scene, spec.text);
      report.added.push(scene.name.substring(0, 50));

      if (spec.alsoOnMaster) {
        for (var i = 1; i <= app.project.numItems; i++) {
          var m = app.project.item(i);
          if (m instanceof CompItem && m.name === spec.master) {
            flagAdd(m, spec.text);
            report.added.push(m.name.substring(0, 50) + " (master)");
            break;
          }
        }
      }
    }
  } finally {
    app.endUndoGroup();
  }
  return report;
}
