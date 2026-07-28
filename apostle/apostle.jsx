// APOSTLE ExtendScript library v2.0
// Ported from ApostleCompositor.jsx (blind ScriptUI panel) for the
// apostle-ae-bridge closed loop. Claude Code is the interface now.
//
// ES3 only. All entry points undo-grouped and return JSON strings.
// Loaded into the bridge panel's scope via:
//   if (typeof APOSTLE === "undefined") { $.evalFile(new File("<repo>/apostle/apostle.jsx")); }
// JSON.* is provided by the bridge panel environment. Standalone runs
// outside the bridge must load a json2 shim first.
//
// Entry points (all on the APOSTLE global):
//   APOSTLE.buildFromBeats(beatsJSONString)       -> build report JSON
//   APOSTLE.serializeCompState(compName)          -> comp state JSON
//   APOSTLE.dumpPropTree(layerName, compName)     -> matchName tree JSON
//   APOSTLE.renderKeyFrames(compName, times, dir) -> frame paths JSON
//   APOSTLE.checkTextSafeMargins(compName)        -> violations JSON
//   APOSTLE.checkCameraDistance(compName)         -> violations JSON
//   APOSTLE.checkExpressionErrors(compName)       -> errors JSON

var APOSTLE = (function () {

  var LIB_VERSION = "2.2.1";

  // Captured at load time; locates the repo for crash-recovery run snapshots
  var LIB_FILE = null;
  try { LIB_FILE = new File($.fileName); } catch (eLibFile) {}

  // HandyCam matchNames captured Phase 0 Gate B (apostle/matchnames-handycam.md)
  var HC = {
    effect: "PEHC",
    orbitX: "PEHC-0002", orbitY: "PEHC-0003", orbitZ: "PEHC-0004",
    truckX: "PEHC-0051", pedestalY: "PEHC-0052", dollyZ: "PEHC-0012",
    offsetX: "PEHC-0015", offsetY: "PEHC-0016", offsetZ: "PEHC-0017",
    focalLength: "PEHC-0028", dollyZoom: "PEHC-0029",
    wiggleFreq: "PEHC-0034", wiggleAmpHand: "PEHC-0033",
    sourceCameraInt: "PEHC-0059"
  };

  // ---------------------------------------------------------------
  // UTILITIES
  // ---------------------------------------------------------------

  function hexToRGB(hex) {
    if (!hex) return [0, 0, 0];
    var h = hex.replace("#", "");
    if (h.length == 3) {
      h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    }
    var r = parseInt(h.substring(0, 2), 16) / 255;
    var g = parseInt(h.substring(2, 4), 16) / 255;
    var b = parseInt(h.substring(4, 6), 16) / 255;
    return [r, g, b];
  }

  function parseJSONSafe(str) {
    if (str && typeof str === "object") return str;
    var obj = null;
    try {
      if (typeof JSON !== "undefined" && JSON.parse) obj = JSON.parse(str);
      else obj = eval("(" + str + ")");
    } catch (e) {
      try { obj = eval("(" + str + ")"); } catch (e2) { obj = null; }
    }
    return obj;
  }

  function toJSON(obj) {
    return JSON.stringify(obj, null, 1);
  }

  // Crash-recovery contract: comps are disposable, beats JSON is the source
  // of truth. Every successful build snapshots its input + report to
  // <repo>/.apostle-runs/ so a world lost to an AE crash/restart before a
  // save rebuilds with one buildFromBeats call on the snapshot's beats.
  function snapshotRun(beatsData, report) {
    try {
      if (!LIB_FILE || !LIB_FILE.exists) return null;
      var runsDir = new Folder(LIB_FILE.parent.parent.fsName + "/.apostle-runs");
      if (!runsDir.exists) runsDir.create();
      var d = new Date();
      function p2(n) { return (n < 10 ? "0" : "") + n; }
      var ts = d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + "-" +
        p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
      var f = new File(runsDir.fsName + "/" + report.masterName + "-" + ts + ".json");
      f.encoding = "UTF-8";
      f.open("w");
      f.write(JSON.stringify({ savedAt: ts, beats: beatsData, report: report }, null, 1));
      f.close();
      return f.fsName;
    } catch (e) { return null; }
  }

  // Solid/null source items created during a build, so buildFromBeats can
  // file them into the build's 03_ASSETS folder instead of littering the
  // project-root Solids folder.
  var BUILD_SOURCES = [];
  function regSource(layer) {
    try { if (layer && layer.source) BUILD_SOURCES.push(layer.source); } catch (e) {}
  }

  function applyEase(prop, keyIndex, inInfluence, outInfluence) {
    var dims = 1;
    var v = prop.value;
    if (v instanceof Array) dims = v.length;
    var eIn = new KeyframeEase(0, inInfluence || 80);
    var eOut = new KeyframeEase(0, outInfluence || 80);
    var eInArr = [];
    var eOutArr = [];
    for (var d = 0; d < dims; d++) { eInArr.push(eIn); eOutArr.push(eOut); }
    try { prop.setTemporalEaseAtKey(keyIndex, eInArr, eOutArr); } catch (e) {}
  }

  function easeAllKeys(prop, inInf, outInf) {
    for (var k = 1; k <= prop.numKeys; k++) applyEase(prop, k, inInf, outInf);
  }

  function jitter(seed, amp) {
    return Math.sin(seed * 12.9898) * amp;
  }

  function wordCount(str) {
    if (!str) return 0;
    var m = str.match(/[A-Za-z0-9']+/g);
    return m ? m.length : 0;
  }

  function fontAvailable(psName) {
    try {
      if (app.fonts && app.fonts.getFontsByPostScriptName) {
        var found = app.fonts.getFontsByPostScriptName(psName);
        return (found && found.length > 0);
      }
    } catch (e) {}
    return true;
  }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function shortName(beat) {
    var s = beat.superText || beat["super"] || beat.vo || "beat";
    s = s.replace(/[^A-Za-z0-9 ]/g, "");
    return s.substring(0, 24);
  }

  function findComp(name) {
    for (var i = 1; i <= app.project.numItems; i++) {
      var it = app.project.item(i);
      if (it instanceof CompItem && it.name === name) return it;
    }
    return null;
  }

  function findLayer(comp, name) {
    for (var i = 1; i <= comp.numLayers; i++) {
      if (comp.layer(i).name === name) return comp.layer(i);
    }
    return null;
  }

  function errJSON(fn, e) {
    return toJSON({
      status: "error", fn: fn, error: e.toString(),
      line: (e.line !== undefined ? e.line : null)
    });
  }

  // ---------------------------------------------------------------
  // PREFLIGHT + TIMING (ported)
  // ---------------------------------------------------------------

  function preflight(data, report) {
    report.aeVersion = parseFloat(app.version);
    report.styleExpressions = (report.aeVersion >= 17.0);
    if (!report.styleExpressions) {
      report.warnings.push("AE " + app.version + " is below 17.0. Font and size controls will be baked, not live.");
    }
    try { app.project.expressionEngine = "javascript-1.0"; } catch (e) {
      report.warnings.push("Could not set JavaScript expression engine. Set it manually in Project Settings.");
    }
    var fonts = [data.brand.fontHeadingPS, data.brand.fontBodyPS];
    for (var i = 0; i < fonts.length; i++) {
      if (fonts[i] && !fontAvailable(fonts[i])) {
        report.warnings.push("Font not found by PostScript name: " + fonts[i] + ". AE will substitute silently.");
      }
    }
  }

  function detectHandyCam(comp) {
    var probe = comp.layers.addNull();
    probe.name = "__hc_probe";
    var ok = false;
    try {
      var fx = probe.property("ADBE Effect Parade").addProperty(HC.effect);
      if (fx) ok = true;
    } catch (e) { ok = false; }
    try { probe.remove(); } catch (e2) {}
    return ok;
  }

  function computeTiming(data, report) {
    var wpm = (data.meta && data.meta.wpm) ? data.meta.wpm : 150;
    var head = 2.0;
    var t = head;
    var beats = data.beats;
    var i, b, words, voSec, dwell, dur, transit;
    var transitDur = { dollyPush: 1.1, lateralTruck: 1.0, whipOrbit: 0.75, crane: 1.3, dollyZoom: 1.0, none: 0 };

    for (i = 0; i < beats.length; i++) {
      b = beats[i];
      if (b.durationSec === null || b.durationSec === undefined) {
        words = (b.voSpokenWords !== null && b.voSpokenWords !== undefined) ? b.voSpokenWords : wordCount(b.vo);
        voSec = words / (wpm / 60);
        dwell = (b.stylePreset == "uiWalkthrough") ? 1.2 * (b.uiStates || 1) : 0;
        dur = voSec + 0.8 + dwell;
      } else {
        dur = b.durationSec;
      }
      transit = transitDur[b.transitIn || "dollyPush"];
      if (transit === undefined) transit = 1.1;
      if (b.superText || b["super"]) {
        var rest = dur - transit - 0.2;
        if (rest < 1.8) {
          var bump = 1.8 - rest;
          dur = dur + bump;
          report.warnings.push("Beat " + (i + 1) + " extended by " + bump.toFixed(1) + "s to meet the 1.8s readability floor.");
        }
      }
      b._dur = dur;
      b._transit = (i === 0) ? 0 : transit;
      b._arrive = t;
      t = t + dur;
    }
    var endHold = (data.endcard && data.endcard.holdSec) ? data.endcard.holdSec : 3.0;
    report.totalDuration = t + (data.endcard ? endHold : 0) + 0.5;
    return report.totalDuration;
  }

  // ---------------------------------------------------------------
  // CONTROL LAYER (ported)
  // ---------------------------------------------------------------

  function addSlider(ctrl, name, val) {
    var fx = ctrl.property("ADBE Effect Parade").addProperty("ADBE Slider Control");
    fx.name = name;
    fx.property("ADBE Slider Control-0001").setValue(val);
    return fx;
  }

  function addColor(ctrl, name, rgb) {
    var fx = ctrl.property("ADBE Effect Parade").addProperty("ADBE Color Control");
    fx.name = name;
    fx.property("ADBE Color Control-0001").setValue(rgb);
    return fx;
  }

  function addCheckbox(ctrl, name, val) {
    var fx = ctrl.property("ADBE Effect Parade").addProperty("ADBE Checkbox Control");
    fx.name = name;
    fx.property("ADBE Checkbox Control-0001").setValue(val ? 1 : 0);
    return fx;
  }

  function buildControl(master, data, report) {
    var ctrl = master.layers.addNull(master.duration);
    ctrl.startTime = 0; // AE creates layers at the playhead; pin to comp start
    regSource(ctrl);
    ctrl.name = "CONTROL";
    ctrl.label = 9;
    ctrl.guideLayer = true;
    addColor(ctrl, "Primary", hexToRGB(data.brand.colors.primary));
    addColor(ctrl, "Secondary", hexToRGB(data.brand.colors.secondary));
    addColor(ctrl, "Background", hexToRGB(data.brand.colors.background));
    addColor(ctrl, "Text Color", hexToRGB(data.brand.colors.text));
    addSlider(ctrl, "Heading Size", data.brand.headingSize || 84);
    addSlider(ctrl, "Body Size", data.brand.bodySize || 42);
    addSlider(ctrl, "Heading Tracking", (data.brand.headingTracking !== undefined) ? data.brand.headingTracking : 10);
    addSlider(ctrl, "Body Tracking", (data.brand.bodyTracking !== undefined) ? data.brand.bodyTracking : 10);
    addSlider(ctrl, "Safe Margin %", data.brand.safeMarginPct || 10);
    addCheckbox(ctrl, "Logo Visible", true);
    // fonts are controlled by the FONT Heading / FONT Body guide layers
    // (buildFontLayers), not an effect dropdown — dropdowns can't hold
    // arbitrary PostScript names
    return ctrl;
  }

  // Full-frame 2D background on the master comp, brand background color.
  // Without it, transits between stations cross transparent void (renders
  // white) with visible scene-plane edges — the worst visual bug of v2.1.
  // Same color as the scene BG solids, so plane edges vanish entirely.
  function buildMasterBG(master, data, masterName) {
    var bg = master.layers.addSolid([1, 1, 1], "MASTER BG", master.width, master.height, 1, master.duration);
    bg.startTime = 0;
    bg.label = 8;
    var fill = bg.property("ADBE Effect Parade").addProperty("ADBE Fill");
    fill.property("ADBE Fill-0002").setValue(hexToRGB(data.brand.colors.background));
    try {
      fill.property("ADBE Fill-0002").expression =
        'comp("' + masterName + '").layer("CONTROL").effect("Background")("Color")';
    } catch (e) {}
    bg.moveToEnd();
    regSource(bg);
    return bg;
  }

  // ---------------------------------------------------------------
  // SCENE BUILD (ported; masterName threaded through for expressions)
  // ---------------------------------------------------------------

  // Master font control: every linked text layer reads its font's PostScript
  // name from a guide text layer on the master comp ("FONT Heading" /
  // "FONT Body" — guide, video off, never renders). Changing every font in
  // the build = retyping the PS name in that one layer.
  function styleExpr(masterName, role) {
    var fontLayer = (role === "body") ? "FONT Body" : "FONT Heading";
    var slider = (role === "body") ? "Body Size" : "Heading Size";
    var trackSlider = (role === "body") ? "Body Tracking" : "Heading Tracking";
    return 'var c = comp("' + masterName + '").layer("CONTROL");\n' +
      'var f = "";\n' +
      'try { f = comp("' + masterName + '").layer("' + fontLayer + '").text.sourceText.toString().replace(/^\\s+|\\s+$/g, ""); } catch (e) { f = ""; }\n' +
      'var st = text.sourceText.style;\n' +
      'if (f != "") { try { st = st.setFont(f); } catch (e2) {} }\n' +
      'st = st.setFontSize(c.effect("' + slider + '")("Slider"))\n' +
      '  .setFillColor(c.effect("Text Color")("Color"));\n' +
      'try { st = st.setTracking(c.effect("' + trackSlider + '")("Slider")); } catch (e3) {}\n' +
      'st;';
  }

  function buildFontLayers(master, data) {
    function fontGuide(name, ps, y) {
      var tl = master.layers.addText(ps);
      tl.startTime = 0;
      tl.name = name;
      tl.guideLayer = true;
      tl.enabled = false;
      tl.label = 9;
      var doc = tl.property("ADBE Text Properties").property("ADBE Text Document").value;
      doc.resetCharStyle();
      doc.fontSize = 24;
      tl.property("ADBE Text Properties").property("ADBE Text Document").setValue(doc);
      tl.property("ADBE Transform Group").property("ADBE Position").setValue([230, y]);
      return tl;
    }
    fontGuide("FONT Heading", data.brand.fontHeadingPS || "HelveticaNeue-Bold", 60);
    fontGuide("FONT Body", data.brand.fontBodyPS || "HelveticaNeue", 100);
  }

  function autoFitExpr(masterName) {
    // fit to the space the layer actually has from its (center-justified)
    // position to the nearest safe-margin edge — off-center text (e.g. the
    // uiWalkthrough left column) gets a proportionally smaller budget
    return 'var w = thisLayer.sourceRectAtTime(time).width;\n' +
      'if (w == 0) w = 1;\n' +
      'var c = comp("' + masterName + '").layer("CONTROL");\n' +
      'var m = c.effect("Safe Margin %")("Slider") / 100 * thisComp.width;\n' +
      'var x = transform.position[0];\n' +
      'var half = Math.min(x - m, thisComp.width - m - x);\n' +
      'if (half < 1) half = 1;\n' +
      'var s = Math.min(100, (half * 2) / w * 100);\n' +
      '[s, s];';
  }

  function makeText(comp, str, opts, data, report, masterName) {
    var tl = comp.layers.addText(str);
    tl.name = opts.name || ("TXT " + str.substring(0, 18));
    tl.label = 2;
    var doc = tl.property("ADBE Text Properties").property("ADBE Text Document").value;
    doc.resetCharStyle();
    doc.fontSize = opts.size || 84;
    doc.font = opts.font || data.brand.fontHeadingPS;
    doc.fillColor = hexToRGB(data.brand.colors.text);
    doc.applyFill = true;
    doc.tracking = (opts.tracking !== undefined) ? opts.tracking : 10;
    doc.justification = ParagraphJustification.CENTER_JUSTIFY;
    tl.property("ADBE Text Properties").property("ADBE Text Document").setValue(doc);
    tl.property("ADBE Transform Group").property("ADBE Position").setValue(opts.pos || [comp.width / 2, comp.height / 2]);
    if (report.styleExpressions && opts.linkStyle) {
      try {
        tl.property("ADBE Text Properties").property("ADBE Text Document").expression =
          styleExpr(masterName, opts.role || "heading");
      } catch (e) {
        report.warnings.push("Style expression failed on layer " + tl.name + ": " + e.toString());
      }
    }
    if (opts.autoFit) {
      try { tl.property("ADBE Transform Group").property("ADBE Scale").expression = autoFitExpr(masterName); } catch (e2) {}
    }
    return tl;
  }

  function slideUpReveal(layer, startTime, duration) {
    duration = duration || 0.55;
    var yOffset = 70;
    var pos = layer.property("ADBE Transform Group").property("ADBE Position");
    var opa = layer.property("ADBE Transform Group").property("ADBE Opacity");
    var basePos = pos.value;
    opa.setValueAtTime(startTime, 0);
    opa.setValueAtTime(startTime + duration * 0.6, 100);
    easeAllKeys(opa, 70, 70);
    pos.setValueAtTime(startTime, [basePos[0], basePos[1] + yOffset]);
    pos.setValueAtTime(startTime + duration * 0.72, [basePos[0], basePos[1] - 6]);
    pos.setValueAtTime(startTime + duration, basePos);
    easeAllKeys(pos, 82, 78);
  }

  function buildBGSolid(comp, data, masterName) {
    var bg = comp.layers.addSolid([1, 1, 1], "BG", comp.width, comp.height, 1, comp.duration);
    var fill = bg.property("ADBE Effect Parade").addProperty("ADBE Fill");
    fill.property("ADBE Fill-0002").setValue(hexToRGB(data.brand.colors.background));
    try {
      fill.property("ADBE Fill-0002").expression =
        'comp("' + masterName + '").layer("CONTROL").effect("Background")("Color")';
    } catch (e) {}
    bg.moveToEnd();
    regSource(bg);
    return bg;
  }

  function accentBar(comp, data, y, masterName) {
    var sl = comp.layers.addShape();
    sl.name = "Accent Bar";
    sl.label = 8;
    var grp = sl.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
    var rect = grp.property("ADBE Vectors Group").addProperty("ADBE Vector Shape - Rect");
    rect.property("ADBE Vector Rect Size").setValue([220, 8]);
    var fill = grp.property("ADBE Vectors Group").addProperty("ADBE Vector Graphic - Fill");
    fill.property("ADBE Vector Fill Color").setValue([1, 0.8, 0, 1]);
    try {
      fill.property("ADBE Vector Fill Color").expression =
        'comp("' + masterName + '").layer("CONTROL").effect("Primary")("Color")';
    } catch (e) {}
    sl.property("ADBE Transform Group").property("ADBE Position").setValue([comp.width / 2, y]);
    return sl;
  }

  function buildBeatComp(project, data, beat, index, fps, report, masterName) {
    var w = data.meta.resolution[0];
    var h = data.meta.resolution[1];
    var dur = beat._dur + 6; // buffer so the layer never runs out under the camera
    var c = project.items.addComp(masterName + " SC" + pad2(index + 1) + " " + shortName(beat), w, h, 1, dur, fps);

    buildBGSolid(c, data, masterName);

    var superText = beat.superText || beat["super"] || "";
    var preset = beat.stylePreset || "titleCard";

    // Reveal timing contract: the scene layer starts at arrive - 0.45 in the
    // master, so a reveal at scene-time 0.55 begins 0.1 s AFTER the camera
    // arrives. v2.1 revealed at 0.3-0.5 — half the entrance played out while
    // the camera was still in transit, so arrivals looked washed-out/empty.
    if (preset == "endcard") {
      var url = makeText(c, superText, { name: "Endcard Headline", size: 72, pos: [w / 2, h * 0.44], linkStyle: true, autoFit: true }, data, report, masterName);
      slideUpReveal(url, 0.55);
      if (beat.url) {
        var u = makeText(c, beat.url, { name: "URL", size: 40, font: data.brand.fontBodyPS, pos: [w / 2, h * 0.58], linkStyle: true, role: "body", autoFit: true }, data, report, masterName);
        slideUpReveal(u, 0.8);
      }
      accentBar(c, data, h * 0.66, masterName);
    } else if (preset == "uiWalkthrough") {
      var frame = c.layers.addShape();
      frame.name = "Device Frame (placeholder)";
      frame.label = 8;
      var fg = frame.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
      var fr = fg.property("ADBE Vectors Group").addProperty("ADBE Vector Shape - Rect");
      fr.property("ADBE Vector Rect Size").setValue([420, 860]);
      fr.property("ADBE Vector Rect Roundness").setValue(48);
      var fstr = fg.property("ADBE Vectors Group").addProperty("ADBE Vector Graphic - Stroke");
      fstr.property("ADBE Vector Stroke Color").setValue([0.2, 0.2, 0.2, 1]);
      fstr.property("ADBE Vector Stroke Width").setValue(6);
      frame.property("ADBE Transform Group").property("ADBE Position").setValue([w * 0.68, h / 2]);
      var head = makeText(c, superText, { name: "Super", size: 64, pos: [w * 0.32, h / 2], linkStyle: true, autoFit: true }, data, report, masterName);
      slideUpReveal(head, 0.55);
      slideUpReveal(frame, 0.7);
    } else {
      var main = makeText(c, superText, { name: "Super", size: 84, pos: [w / 2, h * 0.48], linkStyle: true, autoFit: true }, data, report, masterName);
      slideUpReveal(main, 0.55);
      accentBar(c, data, h * 0.58, masterName);
      slideUpReveal(findLayer(c, "Accent Bar"), 0.75);
    }
    return c;
  }

  // ---------------------------------------------------------------
  // WORLD + STATIONS (ported)
  // ---------------------------------------------------------------

  function buildStations(layout, count, w, h) {
    var stations = [];
    // explicit if/else: ExtendScript mis-parses chained ternaries
    // (left-associative), which silently made corridor spacing 2300
    var spacing;
    if (layout == "corridor") { spacing = 3200; }
    else if (layout == "stack") { spacing = 2300; }
    else if (layout == "gallery") { spacing = 2400; } // < visible width at rest
    // distance (~2186px + plane 1920), so lateral trucks always keep some
    // content on screen instead of flashing a fully empty frame mid-transit
    else { spacing = 2700; }
    var i, s, ang;
    for (i = 0; i < count; i++) {
      s = { pos: [w / 2, h / 2, 0], orbitY: 0 };
      if (layout == "gallery") {
        s.pos = [w / 2 + i * spacing, h / 2, 0];
      } else if (layout == "carousel") {
        ang = (i / count) * Math.PI * 2;
        s.pos = [w / 2 + Math.sin(ang) * spacing, h / 2, -spacing + Math.cos(ang) * spacing];
        s.orbitY = (i / count) * 360;
      } else if (layout == "stack") {
        s.pos = [w / 2, h / 2 + i * spacing, 0];
      } else { // corridor default
        s.pos = [w / 2 + jitter(i, 150), h / 2 + jitter(i + 7, 90), -i * spacing];
      }
      stations.push(s);
    }
    return stations;
  }

  // ---------------------------------------------------------------
  // CAMERA RIGS — both behind one interface (brief Section 8)
  // ---------------------------------------------------------------

  function focalToZoom(mm, compWidth) {
    return (mm / 36) * compWidth;
  }

  // Expression rig: fully autonomous two-node rig. Rig null keyframed
  // through stations, camera parented with PoI at rig origin, wiggle drift.
  function buildRigExpression(master) {
    var rig = master.layers.addNull(master.duration);
    regSource(rig);
    rig.startTime = 0; // pin: AE creates layers at the playhead, which silently
    rig.name = "APOSTLE RIG";
    rig.threeDLayer = true;
    rig.label = 1;
    rig.property("ADBE Transform Group").property("ADBE Position").setValue([master.width / 2, master.height / 2, 0]);

    var cam = master.layers.addCamera("APOSTLE CAM", [master.width / 2, master.height / 2]);
    cam.startTime = 0; // shifts every keyframe by the CTI in composite space
    cam.label = 1;
    try { cam.property("ADBE Camera Options Group").property("ADBE Camera Zoom").setValue(focalToZoom(28, master.width)); } catch (e2) {}
    cam.parent = rig;
    cam.property("ADBE Transform Group").property("ADBE Position").setValue([0, 0, -1700]);
    try { cam.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([0, 0, 0]); } catch (e3) {}
    try { cam.property("ADBE Transform Group").property("ADBE Position").expression =
      "var a = 3; var f = 0.5;\n" +
      "value + wiggle(f, a) - wiggle(f, 0);";
    } catch (e4) {}
    return { rig: rig, cam: cam, mode: "expression" };
  }

  // HandyCam rig: clean null + effect, NO transform keyframes on the null
  // (keyframing null Transform.Position then clicking Setup double-transforms
  // the rig — the root-cause bug in the old panel). All animation goes on the
  // effect's own properties by matchName. One manual step: human clicks Setup.
  // After Setup the null is RENAMED to HandyCam_Controller_N and a
  // HandyCam_Camera_N is created; find the rig by effect, not by name.
  function buildRigHandyCam(master, report) {
    var rig = master.layers.addNull(master.duration);
    regSource(rig);
    rig.startTime = 0; // pin to comp start (see buildRigExpression)
    rig.name = "APOSTLE HC RIG";
    rig.threeDLayer = true;
    rig.label = 1;
    // static relocation only — never keyframed
    rig.property("ADBE Transform Group").property("ADBE Position").setValue([master.width / 2, master.height / 2, 0]);
    var fx;
    try {
      fx = rig.property("ADBE Effect Parade").addProperty(HC.effect);
    } catch (e) {
      try { rig.remove(); } catch (e2) {}
      return null;
    }
    var m = new MarkerValue("MANUAL STEP: click HandyCam SETUP on this layer (once). The null gets renamed by Setup; that is expected. Do NOT add transform keyframes to this null.");
    // at 0.2s, not 0: the Station 1 marker lands at t=0 and a same-time
    // setValueAtTime would silently replace this instruction marker
    rig.property("Marker").setValueAtTime(0.2, m);
    report.rigPath = "HandyCam (effect applied; click Setup once; PEHC-0059 != 0 confirms)";
    return { rig: rig, fx: fx, mode: "handycam" };
  }

  function keyframeTransitExpression(rigInfo, stations, beats) {
    var pos = rigInfo.rig.property("ADBE Transform Group").property("ADBE Position");
    var yrot = rigInfo.rig.property("ADBE Transform Group").property("ADBE Rotate Y");
    var zoomProp = null;
    var baseZoom = 0;
    try {
      zoomProp = rigInfo.cam.property("ADBE Camera Options Group").property("ADBE Camera Zoom");
      baseZoom = zoomProp.value;
    } catch (eZoom) { zoomProp = null; }
    var i, b, arrive, transit, tt, mid;
    for (i = 0; i < beats.length; i++) {
      b = beats[i];
      arrive = b._arrive;
      transit = b._transit;
      if (i === 0) {
        pos.setValueAtTime(0, stations[0].pos);
      } else {
        pos.setValueAtTime(arrive - transit, stations[i - 1].pos);
        pos.setValueAtTime(arrive, stations[i].pos);
        // transit flavor — v2.1 differentiated transits by duration only,
        // which read as "every move looks the same"
        tt = b.transitIn || "dollyPush";
        if (tt === "crane") {
          // vertical arc: rise at the midpoint, settle into the station
          mid = [
            (stations[i - 1].pos[0] + stations[i].pos[0]) / 2,
            Math.min(stations[i - 1].pos[1], stations[i].pos[1]) - 260,
            (stations[i - 1].pos[2] + stations[i].pos[2]) / 2
          ];
          pos.setValueAtTime(arrive - transit * 0.5, mid);
        } else if (tt === "whipOrbit") {
          // lateral whip: rig yaw swings out and back across the move
          yrot.setValueAtTime(arrive - transit, 0);
          yrot.setValueAtTime(arrive - transit * 0.5, 26);
          yrot.setValueAtTime(arrive, 0);
        } else if (tt === "dollyZoom" && zoomProp) {
          // vertigo push: tight zoom at departure easing to base on arrival;
          // first key = baseZoom*1.18 only from the transit start, and the
          // start-of-transit anchor keeps earlier times at base
          zoomProp.setValueAtTime(arrive - transit, baseZoom);
          zoomProp.setValueAtTime(arrive - transit * 0.85, baseZoom * 1.18);
          zoomProp.setValueAtTime(arrive, baseZoom);
        }
      }
      addStationMarker(rigInfo.rig, arrive, i, b);
    }
    easeAllKeys(pos, 92, 78);
    if (yrot.numKeys > 0) easeAllKeys(yrot, 85, 85);
    if (zoomProp && zoomProp.numKeys > 0) easeAllKeys(zoomProp, 80, 80);
  }

  function keyframeTransitHandyCam(rigInfo, stations, beats, master, report) {
    // base = the null's static position; stations are reached via Position Offset
    var base = rigInfo.rig.property("ADBE Transform Group").property("ADBE Position").value;
    var ox = rigInfo.fx.property(HC.offsetX);
    var oy = rigInfo.fx.property(HC.offsetY);
    var oz = rigInfo.fx.property(HC.offsetZ);
    var orbY = rigInfo.fx.property(HC.orbitY);
    var i, b, arrive, transit, off;

    function offsetFor(st) {
      return [st.pos[0] - base[0], st.pos[1] - base[1], st.pos[2] - base[2]];
    }

    for (i = 0; i < beats.length; i++) {
      b = beats[i];
      arrive = b._arrive;
      transit = b._transit;
      off = offsetFor(stations[i]);
      if (i === 0) {
        ox.setValueAtTime(0, off[0]); oy.setValueAtTime(0, off[1]); oz.setValueAtTime(0, off[2]);
      } else {
        var prev = offsetFor(stations[i - 1]);
        ox.setValueAtTime(arrive - transit, prev[0]); ox.setValueAtTime(arrive, off[0]);
        oy.setValueAtTime(arrive - transit, prev[1]); oy.setValueAtTime(arrive, off[1]);
        oz.setValueAtTime(arrive - transit, prev[2]); oz.setValueAtTime(arrive, off[2]);
      }
      if ((b.transitIn || "") == "whipOrbit" && i > 0 && orbY) {
        orbY.setValueAtTime(arrive - transit, 0);
        orbY.setValueAtTime(arrive - transit * 0.5, 42);
        orbY.setValueAtTime(arrive, 0);
      }
      addStationMarker(rigInfo.rig, arrive, i, b);
    }
    easeAllKeys(ox, 92, 78); easeAllKeys(oy, 92, 78); easeAllKeys(oz, 92, 78);
    if (orbY && orbY.numKeys > 0) easeAllKeys(orbY, 85, 85);
    try {
      rigInfo.fx.property(HC.wiggleAmpHand).setValue(3.5);
      rigInfo.fx.property(HC.wiggleFreq).setValue(0.5);
    } catch (e) {
      report.warnings.push("HandyCam wiggle properties could not be set: " + e.toString());
    }
  }

  function addStationMarker(rig, arrive, i, b) {
    try {
      var mv = new MarkerValue("Station " + (i + 1) + ": " + shortName(b));
      rig.property("Marker").setValueAtTime(arrive, mv);
    } catch (e) {}
  }

  // ---------------------------------------------------------------
  // 5.1 buildFromBeats
  // ---------------------------------------------------------------
  // rig selection: data.meta.rig = "expression" (default) | "handycam" | "auto"
  // master comp name: data.meta.masterName (default "MASTER")

  function buildFromBeats(beatsJSON) {
    var report = { status: "success", warnings: [], rigPath: "", styleExpressions: true, aeVersion: 0, totalDuration: 0, beats: [], masterName: "" };
    var data = parseJSONSafe(beatsJSON);
    if (!data || !data.beats || data.beats.length === 0) {
      return toJSON({ status: "error", error: "No beats found in JSON." });
    }
    if (!data.meta) data.meta = {};
    if (!data.meta.resolution) data.meta.resolution = [1920, 1080];
    if (!data.meta.fps) data.meta.fps = 25;
    if (!data.brand) data.brand = {};
    if (!data.brand.colors) data.brand.colors = { primary: "#FFCC00", secondary: "#1E1E1E", background: "#FFFFFF", text: "#111111" };
    if (!data.brand.fontHeadingPS) data.brand.fontHeadingPS = "HelveticaNeue-Bold";
    if (!data.brand.fontBodyPS) data.brand.fontBodyPS = "HelveticaNeue";

    var baseName = data.meta.masterName || "MASTER";
    // Versioned builds: every build creates <base>_vNNN, scanning existing
    // items for the highest version — never overwrites, never collides.
    // Old versions stay until deliberately deleted.
    function pad3(n) { var s = String(n); while (s.length < 3) s = "0" + s; return s; }
    var vmax = 0;
    for (var vi = 1; vi <= app.project.numItems; vi++) {
      var vnm = String(app.project.item(vi).name);
      if (vnm.indexOf(baseName + "_v") === 0) {
        var vrest = vnm.substring(baseName.length + 2);
        if (/^\d+$/.test(vrest) && parseInt(vrest, 10) > vmax) vmax = parseInt(vrest, 10);
      }
    }
    var masterName = baseName + "_v" + pad3(vmax + 1);
    report.masterName = masterName;

    if (data.endcard) {
      data.beats.push({
        vo: "",
        superText: data.endcard.superText || data.endcard["super"] || "Find out more",
        url: data.endcard.url || "",
        stylePreset: "endcard",
        durationSec: (data.endcard.holdSec || 3.0) + 1.1,
        transitIn: "dollyPush"
      });
      data.endcard = null;
    }

    app.beginUndoGroup("Apostle buildFromBeats");
    try {
      preflight(data, report);
      computeTiming(data, report);

      var fps = data.meta.fps;
      var w = data.meta.resolution[0];
      var h = data.meta.resolution[1];
      // Project organization: APOSTLE/<masterName>/01_MASTER + 02_SCENES +
      // 03_ASSETS. Nothing from a build lands loose at the project root.
      var rootFolder = null;
      for (var rf = 1; rf <= app.project.numItems; rf++) {
        var rit = app.project.item(rf);
        if (rit instanceof FolderItem && rit.name === "APOSTLE" && rit.parentFolder === app.project.rootFolder) { rootFolder = rit; break; }
      }
      if (!rootFolder) rootFolder = app.project.items.addFolder("APOSTLE");
      var buildFolder = app.project.items.addFolder(masterName);
      buildFolder.parentFolder = rootFolder;
      var fMaster = app.project.items.addFolder("01_MASTER"); fMaster.parentFolder = buildFolder;
      var fScenes = app.project.items.addFolder("02_SCENES"); fScenes.parentFolder = buildFolder;
      var fAssets = app.project.items.addFolder("03_ASSETS"); fAssets.parentFolder = buildFolder;
      BUILD_SOURCES = [];

      var master = app.project.items.addComp(masterName, w, h, 1, report.totalDuration, fps);
      master.parentFolder = fMaster;
      master.motionBlur = true;

      var rigMode = data.meta.rig || "expression";
      // Phase 3 A/B verdict: "auto" resolves to the expression rig even when
      // HandyCam is installed. HandyCam's Position Offset is shake-scale local
      // offset — the Setup-baked look-at target stays pinned near the rig home,
      // so corridor-scale offsets put the camera ON the target plane facing
      // backward. HandyCam remains explicit opt-in ("handycam") for
      // static-position shake/polish only.
      if (rigMode === "auto") rigMode = "expression";

      var ctrl = buildControl(master, data, report);
      buildFontLayers(master, data);
      buildMasterBG(master, data, masterName);

      var beats = data.beats;
      var stations = buildStations(data.meta.layout || "corridor", beats.length, w, h);
      var i, sceneComp, sceneLayer;
      for (i = beats.length - 1; i >= 0; i--) {
        sceneComp = buildBeatComp(app.project, data, beats[i], i, fps, report, masterName);
        sceneComp.parentFolder = fScenes;
        sceneLayer = master.layers.add(sceneComp);
        sceneLayer.threeDLayer = true;
        // collapseTransformation stays OFF: collapsed 3D precomps composite in
        // stack order instead of z-sorting under the camera, so the top scene
        // paints over every station (verified visually, Phase 1)
        sceneLayer.motionBlur = true;
        sceneLayer.label = 3;
        sceneLayer.property("ADBE Transform Group").property("ADBE Position").setValue(stations[i].pos);
        sceneLayer.startTime = Math.max(0, beats[i]._arrive - 0.45);
      }

      var rigInfo = null;
      if (rigMode === "handycam") {
        rigInfo = buildRigHandyCam(master, report);
        if (!rigInfo) {
          report.warnings.push("HandyCam not available; fell back to expression rig.");
          rigMode = "expression";
        }
      }
      if (rigMode === "expression") {
        rigInfo = buildRigExpression(master);
        report.rigPath = "Expression two-node rig (autonomous, no plugin)";
      }
      if (rigInfo.mode === "handycam") {
        keyframeTransitHandyCam(rigInfo, stations, beats, master, report);
      } else {
        keyframeTransitExpression(rigInfo, stations, beats);
      }

      for (var si = 0; si < BUILD_SOURCES.length; si++) {
        try { BUILD_SOURCES[si].parentFolder = fAssets; } catch (eSrc) {}
      }

      ctrl.moveToBeginning();
      rigInfo.rig.moveToBeginning();
      master.openInViewer();

      for (i = 0; i < beats.length; i++) {
        report.beats.push({
          index: i + 1,
          name: shortName(beats[i]),
          arrive: Math.round(beats[i]._arrive * 100) / 100,
          duration: Math.round(beats[i]._dur * 100) / 100,
          transit: Math.round(beats[i]._transit * 100) / 100,
          station: stations[i].pos
        });
      }
      report.rigMode = rigInfo.mode;
      report.fps = fps;
    } catch (err) {
      report.status = "error";
      report.error = err.toString() + (err.line ? (" (line " + err.line + ")") : "");
    }
    app.endUndoGroup();
    if (report.status === "success") report.snapshot = snapshotRun(data, report);
    return toJSON(report);
  }

  // ---------------------------------------------------------------
  // 5.2 serializeCompState
  // ---------------------------------------------------------------

  var SERIALIZE_MAX_DEPTH = 6;
  var SERIALIZE_MAX_CHARS = 60000;
  var SERIALIZE_MAX_KEYS = 12;

  function propValueCompact(p) {
    try {
      var v = p.value;
      if (v === null || v === undefined) return null;
      if (typeof v === "number") return Math.round(v * 1000) / 1000;
      if (typeof v === "string") return v.length > 80 ? v.substring(0, 80) + "…" : v;
      if (typeof v === "boolean") return v;
      if (v instanceof Array) {
        var out = [];
        for (var i = 0; i < v.length && i < 4; i++) {
          out.push(typeof v[i] === "number" ? Math.round(v[i] * 1000) / 1000 : v[i]);
        }
        return out;
      }
      if (v instanceof MarkerValue) return "[marker] " + v.comment;
      if (v instanceof TextDocument) return "[text] " + v.text;
      return String(v).substring(0, 60);
    } catch (e) { return undefined; }
  }

  function serializeProp(p, depth, budget) {
    if (budget.spent > SERIALIZE_MAX_CHARS) { budget.truncated = true; return null; }
    var node = { mn: p.matchName };
    if (p.name !== p.matchName) node.name = p.name;
    if (p.propertyType === PropertyType.PROPERTY) {
      var v = propValueCompact(p);
      if (v !== undefined) node.v = v;
      try {
        if (p.expression && p.expression.length > 0) {
          node.expr = p.expression.length > 160 ? p.expression.substring(0, 160) + "…" : p.expression;
          // expressionError is the highest-value debugging signal — never omit
          node.exprError = (p.expressionError && p.expressionError.length) ? p.expressionError : "";
        }
      } catch (ee) {}
      try {
        if (p.numKeys > 0) {
          node.keys = [];
          var n = p.numKeys > SERIALIZE_MAX_KEYS ? SERIALIZE_MAX_KEYS : p.numKeys;
          for (var k = 1; k <= n; k++) {
            var kv = p.keyValue(k);
            var kvOut;
            if (kv instanceof Array) {
              kvOut = [];
              for (var d = 0; d < kv.length && d < 4; d++) kvOut.push(Math.round(kv[d] * 100) / 100);
            } else if (typeof kv === "number") {
              kvOut = Math.round(kv * 100) / 100;
            } else { kvOut = String(kv).substring(0, 40); }
            node.keys.push({ t: Math.round(p.keyTime(k) * 100) / 100, v: kvOut });
          }
          if (p.numKeys > SERIALIZE_MAX_KEYS) node.keysTruncated = p.numKeys;
        }
      } catch (ke) {}
    } else if (depth < SERIALIZE_MAX_DEPTH && p.numProperties > 0) {
      var kids = [];
      for (var i = 1; i <= p.numProperties; i++) {
        var child = null;
        try { child = serializeProp(p.property(i), depth + 1, budget); } catch (ce) {}
        if (child) {
          // skip silent leaves: no value, no keys, no expression, no children
          var keep = (child.v !== undefined) || child.keys || child.expr || child.props;
          if (keep) kids.push(child);
        }
      }
      if (kids.length) node.props = kids;
    }
    var chunk = 30;
    try { chunk = JSON.stringify(node).length; } catch (se) {}
    budget.spent += chunk;
    return node;
  }

  function serializeLayer(layer, budget) {
    var lType = "av";
    if (layer instanceof CameraLayer) { lType = "camera"; }
    else if (layer instanceof LightLayer) { lType = "light"; }
    else if (layer instanceof TextLayer) { lType = "text"; }
    else if (layer instanceof ShapeLayer) { lType = "shape"; }
    else if (layer.nullLayer) { lType = "null"; }
    else if (layer.source instanceof CompItem) { lType = "precomp"; }
    var L = {
      index: layer.index,
      name: layer.name,
      type: lType,
      threeD: !!layer.threeDLayer,
      startTime: Math.round(layer.startTime * 100) / 100,
      inPoint: Math.round(layer.inPoint * 100) / 100,
      outPoint: Math.round(layer.outPoint * 100) / 100,
      label: layer.label
    };
    if (layer.parent) L.parent = layer.parent.name;
    if (layer.source instanceof CompItem) L.sourceComp = layer.source.name;
    try { if (!layer.enabled) L.disabled = true; } catch (e0) {}

    var groups = ["ADBE Transform Group", "ADBE Effect Parade", "ADBE Text Properties", "ADBE Camera Options Group"];
    for (var g = 0; g < groups.length; g++) {
      var grp = null;
      try { grp = layer.property(groups[g]); } catch (ge) {}
      if (grp) {
        var node = serializeProp(grp, 1, budget);
        if (node && node.props) {
          if (!L.props) L.props = [];
          L.props.push(node);
        }
      }
    }
    try {
      var mk = layer.property("Marker");
      if (mk && mk.numKeys > 0) {
        L.markers = [];
        for (var m = 1; m <= mk.numKeys && m <= 20; m++) {
          L.markers.push({ t: Math.round(mk.keyTime(m) * 100) / 100, c: mk.keyValue(m).comment });
        }
      }
    } catch (me) {}
    return L;
  }

  function serializeCompState(compName) {
    try {
      var root = compName ? findComp(compName) :
        (app.project.activeItem instanceof CompItem ? app.project.activeItem : null);
      if (!root) return toJSON({ status: "error", error: "Comp not found: " + compName });

      var budget = { spent: 0, truncated: false };
      var seen = {};
      var queue = [root];
      var comps = [];
      while (queue.length > 0 && comps.length < 12) {
        var c = queue.shift();
        if (seen[c.name]) continue;
        seen[c.name] = true;
        var C = {
          name: c.name, width: c.width, height: c.height,
          duration: Math.round(c.duration * 100) / 100, frameRate: c.frameRate,
          numLayers: c.numLayers, layers: []
        };
        for (var i = 1; i <= c.numLayers; i++) {
          var layer = c.layer(i);
          C.layers.push(serializeLayer(layer, budget));
          if (layer.source instanceof CompItem && !seen[layer.source.name]) queue.push(layer.source);
          if (budget.spent > SERIALIZE_MAX_CHARS) { budget.truncated = true; break; }
        }
        comps.push(C);
        if (budget.spent > SERIALIZE_MAX_CHARS) break;
      }
      return toJSON({ status: "success", rootComp: root.name, truncated: budget.truncated, comps: comps });
    } catch (e) {
      return errJSON("serializeCompState", e);
    }
  }

  // ---------------------------------------------------------------
  // 5.3 dumpPropTree
  // ---------------------------------------------------------------

  function dumpPropTree(layerName, compName) {
    try {
      var comp = compName ? findComp(compName) :
        (app.project.activeItem instanceof CompItem ? app.project.activeItem : null);
      if (!comp) return toJSON({ status: "error", error: "Comp not found: " + compName });
      var layer = findLayer(comp, layerName);
      if (!layer) return toJSON({ status: "error", error: "Layer not found: " + layerName + " in " + comp.name });
      var root = layer.property("ADBE Effect Parade");
      if (!root) return toJSON({ status: "error", error: "Layer has no effects group." });
      var out = [];
      function walk(node, lvl) {
        for (var i = 1; i <= node.numProperties; i++) {
          var p = node.property(i);
          var pad = "";
          for (var s = 0; s < lvl; s++) pad += "  ";
          out.push(pad + p.matchName + " | " + p.name);
          if (p.numProperties && p.numProperties > 0) walk(p, lvl + 1);
        }
      }
      walk(root, 0);
      return toJSON({ status: "success", layer: layer.name, comp: comp.name, tree: out });
    } catch (e) {
      return errJSON("dumpPropTree", e);
    }
  }

  // ---------------------------------------------------------------
  // 5.4 renderKeyFrames
  // ---------------------------------------------------------------

  // Primary: saveFrameToPng with async-write guard (the call returns before
  // the file exists on current AE versions). Fallback: Render Queue
  // single-frame PNG (color-accurate, effects-applied, slower).

  function renderFramePNG(comp, timeSec, outPath) {
    var f = new File(outPath);
    try { if (f.exists) f.remove(); } catch (e0) {}
    try {
      comp.saveFrameToPng(timeSec, f);
    } catch (e) { return null; }
    var waited = 0;
    while (!f.exists && waited < 5000) { $.sleep(100); waited += 100; }
    return f.exists ? f.fsName : null;
  }

  function renderFrameViaRQ(comp, timeSec, outPath) {
    var rq = app.project.renderQueue;
    var item = null;
    try {
      item = rq.items.add(comp);
      item.timeSpanStart = timeSec;
      item.timeSpanDuration = comp.frameDuration;
      var om = item.outputModule(1);
      var applied = false;
      var templates = ["PNG Sequence", "PNG-Sequenz", "_HIDDEN X-Factor 8 Premul"];
      for (var t = 0; t < templates.length; t++) {
        try { om.applyTemplate(templates[t]); applied = true; break; } catch (te) {}
      }
      if (!applied) return null;
      om.file = new File(outPath);
      rq.render();
      // RQ appends frame numbers to sequence outputs; find what got written
      var f = new File(outPath);
      if (f.exists) return f.fsName;
      var folder = f.parent;
      var base = f.name.replace(/\.png$/i, "");
      var matches = folder.getFiles(base + "*");
      if (matches && matches.length > 0) return matches[0].fsName;
      return null;
    } catch (e) {
      return null;
    } finally {
      try { if (item && item.status !== RQItemStatus.DONE) item.remove(); } catch (re) {}
    }
  }

  function renderKeyFrames(compName, timesArray, outDir) {
    try {
      var comp = compName ? findComp(compName) :
        (app.project.activeItem instanceof CompItem ? app.project.activeItem : null);
      if (!comp) return toJSON({ status: "error", error: "Comp not found: " + compName });
      var folder = new Folder(outDir);
      if (!folder.exists) folder.create();
      var frames = [];
      var failures = [];
      app.beginUndoGroup("Apostle renderKeyFrames");
      try {
        for (var i = 0; i < timesArray.length; i++) {
          var t = timesArray[i];
          if (t < 0) t = 0;
          if (t > comp.duration) t = comp.duration;
          var name = comp.name.replace(/[^A-Za-z0-9]/g, "_") + "_t" + String(Math.round(t * 100) / 100).replace(".", "p") + ".png";
          var outPath = folder.fsName + "/" + name;
          var got = renderFramePNG(comp, t, outPath);
          var via = "saveFrameToPng";
          if (!got) { got = renderFrameViaRQ(comp, t, outPath); via = "renderQueue"; }
          if (got) frames.push({ time: t, path: got, via: via });
          else failures.push({ time: t });
        }
      } finally {
        app.endUndoGroup();
      }
      return toJSON({ status: frames.length ? "success" : "error", comp: comp.name, frames: frames, failures: failures });
    } catch (e) {
      return errJSON("renderKeyFrames", e);
    }
  }

  // ---------------------------------------------------------------
  // 5.5 Deterministic checks (no model, no image tokens)
  // ---------------------------------------------------------------

  function textHoldTime(layer) {
    // entrance done = last transform keyframe + epsilon; else early-in
    var t = layer.inPoint + 0.5;
    try {
      var pos = layer.property("ADBE Transform Group").property("ADBE Position");
      if (pos.numKeys > 0) t = pos.keyTime(pos.numKeys) + 0.1;
    } catch (e) {}
    if (t > layer.outPoint) t = (layer.inPoint + layer.outPoint) / 2;
    return t;
  }

  function findControlSafeMargin(masterName) {
    var m = findComp(masterName || "MASTER");
    if (!m) return null;
    var ctrl = findLayer(m, "CONTROL");
    if (!ctrl) return null;
    try {
      return ctrl.property("ADBE Effect Parade").property("Safe Margin %").property("ADBE Slider Control-0001").value;
    } catch (e) { return null; }
  }

  // Check every text layer in the comp and its precomps against the safe
  // margin at its hold time. Scale is read post-expression (autoFit).
  function checkTextSafeMargins(compName) {
    try {
      var root = compName ? findComp(compName) :
        (app.project.activeItem instanceof CompItem ? app.project.activeItem : null);
      if (!root) return toJSON({ status: "error", error: "Comp not found: " + compName });
      var marginPct = findControlSafeMargin(root.name);
      if (marginPct === null) marginPct = 10;
      var violations = [];
      var checked = 0;
      var seen = {};
      var queue = [root];
      while (queue.length > 0) {
        var c = queue.shift();
        if (seen[c.name]) continue;
        seen[c.name] = true;
        var mx = c.width * marginPct / 100;
        var my = c.height * marginPct / 100;
        for (var i = 1; i <= c.numLayers; i++) {
          var layer = c.layer(i);
          if (layer.source instanceof CompItem && !seen[layer.source.name]) queue.push(layer.source);
          if (!(layer instanceof TextLayer)) continue;
          if (layer.guideLayer || !layer.enabled) continue; // FONT config guides never render
          checked++;
          var t = textHoldTime(layer);
          var rect = layer.sourceRectAtTime(t, false);
          var pos = layer.property("ADBE Transform Group").property("ADBE Position").valueAtTime(t, false);
          var anchor = layer.property("ADBE Transform Group").property("ADBE Anchor Point").valueAtTime(t, false);
          var scale = layer.property("ADBE Transform Group").property("ADBE Scale").valueAtTime(t, false);
          var sx = scale[0] / 100, sy = scale[1] / 100;
          var left = pos[0] + (rect.left - anchor[0]) * sx;
          var top = pos[1] + (rect.top - anchor[1]) * sy;
          var right = left + rect.width * sx;
          var bottom = top + rect.height * sy;
          var EPS = 2; // exact-fit tolerance: autoFit scales text flush to the margin
          var out = [];
          if (left < mx - EPS) out.push("left by " + Math.round(mx - left) + "px");
          if (right > c.width - mx + EPS) out.push("right by " + Math.round(right - (c.width - mx)) + "px");
          if (top < my - EPS) out.push("top by " + Math.round(my - top) + "px");
          if (bottom > c.height - my + EPS) out.push("bottom by " + Math.round(bottom - (c.height - my)) + "px");
          if (out.length) {
            violations.push({
              comp: c.name, layer: layer.name, atTime: Math.round(t * 100) / 100,
              bounds: [Math.round(left), Math.round(top), Math.round(right), Math.round(bottom)],
              exceeds: out,
              fixPath: 'comp("' + c.name + '").layer("' + layer.name + '") Transform/Scale or Position'
            });
          }
        }
      }
      return toJSON({ status: "success", marginPct: marginPct, textLayersChecked: checked, violations: violations });
    } catch (e) {
      return errJSON("checkTextSafeMargins", e);
    }
  }

  // Camera world position vs each station's scene plane at station arrival.
  // Flags clipping (camera nearer than 300px to the plane) and framing
  // misses (station not centered within tolerance). World positions are
  // computed by summing the parent chain (our rigs use no parent rotation).
  var CLIP_MIN_Z = 300;
  var FRAME_TOLERANCE_XY = 250;

  function layerWorldPos(layer, t) {
    var p = layer.property("ADBE Transform Group").property("ADBE Position").valueAtTime(t, false);
    var world = [p[0], p[1], (p.length > 2 ? p[2] : 0)];
    var guard = 0;
    var cur = layer;
    while (cur.parent && guard < 10) {
      cur = cur.parent;
      var pp = cur.property("ADBE Transform Group").property("ADBE Position").valueAtTime(t, false);
      world[0] += pp[0]; world[1] += pp[1]; world[2] += (pp.length > 2 ? pp[2] : 0);
      guard++;
    }
    return world;
  }

  function checkCameraDistance(compName) {
    try {
      var comp = compName ? findComp(compName) :
        (app.project.activeItem instanceof CompItem ? app.project.activeItem : null);
      if (!comp) return toJSON({ status: "error", error: "Comp not found: " + compName });

      var cam = null;
      for (var i = 1; i <= comp.numLayers; i++) {
        if (comp.layer(i) instanceof CameraLayer) { cam = comp.layer(i); break; }
      }
      if (!cam) return toJSON({ status: "error", error: "No camera layer in " + comp.name });

      // rig = layer carrying station markers
      var rig = null;
      for (var r = 1; r <= comp.numLayers; r++) {
        var mk = null;
        try { mk = comp.layer(r).property("Marker"); } catch (e0) {}
        if (mk && mk.numKeys > 0 && String(mk.keyValue(1).comment).indexOf("Station") === 0) { rig = comp.layer(r); break; }
        if (mk && mk.numKeys > 1 && String(mk.keyValue(2).comment).indexOf("Station") === 0) { rig = comp.layer(r); break; }
      }
      if (!rig) return toJSON({ status: "error", error: "No layer with Station markers found in " + comp.name });

      // scene layers = precomp layers, indexed by station order (SCnn in name)
      var scenes = [];
      for (var s = 1; s <= comp.numLayers; s++) {
        var L = comp.layer(s);
        if (L.source instanceof CompItem) {
          var m2 = String(L.name).match(/SC(\d+)/);
          if (m2) scenes[parseInt(m2[1], 10) - 1] = L;
        }
      }

      var results = [];
      var violations = [];
      var mkProp = rig.property("Marker");
      for (var k = 1; k <= mkProp.numKeys; k++) {
        var comment = String(mkProp.keyValue(k).comment);
        var m3 = comment.match(/^Station (\d+)/);
        if (!m3) continue;
        var idx = parseInt(m3[1], 10) - 1;
        var t = mkProp.keyTime(k);
        var scene = scenes[idx];
        if (!scene) continue;
        var camW = layerWorldPos(cam, t);
        var sceneW = layerWorldPos(scene, t);
        var dz = camW[2] - sceneW[2]; // camera should sit in FRONT (negative dz)
        var dx = camW[0] - sceneW[0];
        var dy = camW[1] - sceneW[1];
        var entry = {
          station: idx + 1, time: Math.round(t * 100) / 100,
          cameraZGap: Math.round(-dz), dx: Math.round(dx), dy: Math.round(dy)
        };
        results.push(entry);
        if (-dz < CLIP_MIN_Z) {
          violations.push({ station: idx + 1, time: entry.time, problem: "clipping: camera only " + Math.round(-dz) + "px in front of scene plane (min " + CLIP_MIN_Z + ")" });
        }
        if (Math.abs(dx) > FRAME_TOLERANCE_XY || Math.abs(dy) > FRAME_TOLERANCE_XY) {
          violations.push({ station: idx + 1, time: entry.time, problem: "framing miss: camera offset [" + Math.round(dx) + ", " + Math.round(dy) + "]px from station center (tolerance " + FRAME_TOLERANCE_XY + ")" });
        }
      }
      return toJSON({ status: "success", camera: cam.name, rig: rig.name, stations: results, violations: violations });
    } catch (e) {
      return errJSON("checkCameraDistance", e);
    }
  }

  // Sweep every property of every layer (comp + precomps) for non-empty
  // expressionError. Highest-value debugging signal in the system.
  function checkExpressionErrors(compName) {
    try {
      var root = compName ? findComp(compName) :
        (app.project.activeItem instanceof CompItem ? app.project.activeItem : null);
      if (!root) return toJSON({ status: "error", error: "Comp not found: " + compName });
      var errors = [];
      var scanned = { props: 0 };
      var seen = {};
      var queue = [root];

      function sweep(node, compRef, layerRef, depth) {
        if (depth > SERIALIZE_MAX_DEPTH) return;
        for (var i = 1; i <= node.numProperties; i++) {
          var p = null;
          try { p = node.property(i); } catch (pe) { continue; }
          if (!p) continue;
          if (p.propertyType === PropertyType.PROPERTY) {
            scanned.props++;
            try {
              if (p.expression && p.expression.length > 0 && p.expressionError && p.expressionError.length > 0) {
                errors.push({
                  comp: compRef.name, layer: layerRef.name,
                  property: p.matchName + " (" + p.name + ")",
                  error: p.expressionError,
                  expression: p.expression.length > 120 ? p.expression.substring(0, 120) + "…" : p.expression
                });
              }
            } catch (xe) {}
          } else if (p.numProperties > 0) {
            sweep(p, compRef, layerRef, depth + 1);
          }
        }
      }

      while (queue.length > 0) {
        var c = queue.shift();
        if (seen[c.name]) continue;
        seen[c.name] = true;
        for (var i = 1; i <= c.numLayers; i++) {
          var layer = c.layer(i);
          if (layer.source instanceof CompItem && !seen[layer.source.name]) queue.push(layer.source);
          sweep(layer, c, layer, 0);
        }
      }
      return toJSON({ status: "success", propertiesScanned: scanned.props, errors: errors });
    } catch (e) {
      return errJSON("checkExpressionErrors", e);
    }
  }

  // ---------------------------------------------------------------

  return {
    version: LIB_VERSION,
    HC: HC,
    buildFromBeats: buildFromBeats,
    serializeCompState: serializeCompState,
    dumpPropTree: dumpPropTree,
    renderKeyFrames: renderKeyFrames,
    checkTextSafeMargins: checkTextSafeMargins,
    checkCameraDistance: checkCameraDistance,
    checkExpressionErrors: checkExpressionErrors
  };
})();

// expose to the bridge panel's scope explicitly (executeScript evals inside a function)
$.global.APOSTLE = APOSTLE;
