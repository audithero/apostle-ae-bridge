// enable-motion-blur.jsx — turn motion blur on across every Apostle comp.
//
// Two switches have to agree before AE renders any blur: the COMP's motion
// blur enable, and the per-LAYER motion blur switch. The build set the comp
// switch on masters only, and set the layer switch on scene precomps only —
// so nothing inside a scene comp (supers, tiles, pictograms, chips) has ever
// rendered with blur, and the moment animations have been stepping instead of
// smearing.
//
// Shutter: 180 degrees, phase -90. 180 is the film-standard half-open shutter
// and is what makes movement read as weighted rather than either strobed (low
// angle) or mushy (high angle). Phase -90 centres the exposure on the frame
// time, so a layer's blur straddles its keyframed position rather than
// trailing it, which keeps text legible through a move.
//
// Layers deliberately left OFF:
//   - guide layers (FONT Heading / FONT Body) — never rendered
//   - CONTROL — a null holding brand values
//   - cameras and lights — no motion blur switch
//   - MASTER BG / BG — full-frame static colour, blur would only cost render
//
// Returns a per-comp report.

var SHUTTER_ANGLE = 180;
var SHUTTER_PHASE = -90;

function mbIsApostleComp(comp) {
  var p = comp.parentFolder;
  while (p && p.name !== "Root") {
    if (p.name === "APOSTLE") return true;
    p = p.parentFolder;
  }
  return false;
}

function mbSkipLayer(layer) {
  if (layer.guideLayer) return true;
  if (layer.nullLayer) return true;
  if (layer instanceof CameraLayer) return true;
  if (layer instanceof LightLayer) return true;
  var n = layer.name;
  if (n === "CONTROL" || n === "MASTER BG" || n === "BG") return true;
  return false;
}

function enableMotionBlur() {
  app.beginUndoGroup("Apostle enable motion blur");
  var report = { comps: 0, layersOn: 0, layersSkipped: 0, compsAlready: 0, detail: [] };
  try {
    for (var i = 1; i <= app.project.numItems; i++) {
      var it = app.project.item(i);
      if (!(it instanceof CompItem)) continue;
      if (!mbIsApostleComp(it)) continue;

      var was = it.motionBlur;
      it.motionBlur = true;
      try { it.shutterAngle = SHUTTER_ANGLE; } catch (eA) {}
      try { it.shutterPhase = SHUTTER_PHASE; } catch (eP) {}
      if (was) report.compsAlready += 1;
      report.comps += 1;

      var on = 0, skip = 0;
      for (var L = 1; L <= it.numLayers; L++) {
        var ly = it.layer(L);
        if (mbSkipLayer(ly)) { skip += 1; continue; }
        try { ly.motionBlur = true; on += 1; } catch (eL) { skip += 1; }
      }
      report.layersOn += on;
      report.layersSkipped += skip;
      report.detail.push({ comp: it.name.substring(0, 46), on: on, skipped: skip, compWasOn: was });
    }
  } finally {
    app.endUndoGroup();
  }
  return report;
}
