// APOSTLE COMPOSITOR v1.0
// Script-to-composition build panel for After Effects.
// Ingests a beats JSON (see sample-beats.json) and builds a complete
// multi-scene composition: brand CONTROL layer, scene precomps, 3D scene
// world, and a HandyCam-aware camera rig with fallback.
//
// Install: copy to [AE]/Scripts/ScriptUI Panels/ then restart AE.
// Opens from the bottom of the Window menu.
// Requires: AE 2020 (17.0)+ recommended. Degrades below 17.0 (styling
// bakes instead of live controller linking). HandyCam optional.
//
// (c) Apostle. Internal production tooling.

(function apostleCompositor(thisObj) {

  var PANEL_TITLE = "Apostle Compositor";
  var MASTER_NAME = "MASTER";

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
    var obj = null;
    try {
      if (typeof JSON !== "undefined" && JSON.parse) {
        obj = JSON.parse(str);
      } else {
        obj = eval("(" + str + ")");
      }
    } catch (e) {
      try { obj = eval("(" + str + ")"); } catch (e2) { obj = null; }
    }
    return obj;
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
    return true; // cannot verify on this AE version; proceed, warn later
  }

  // ---------------------------------------------------------------
  // PREFLIGHT
  // ---------------------------------------------------------------

  function preflight(data, report) {
    report.aeVersion = parseFloat(app.version);
    report.styleExpressions = (report.aeVersion >= 17.0);
    if (!report.styleExpressions) {
      report.warnings.push("AE " + app.version + " is below 17.0. Font and size controls will be baked, not live. Colors on shapes stay live.");
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
      var fx = probe.property("Effects").addProperty("HandyCam");
      if (fx) ok = true;
    } catch (e) { ok = false; }
    try { probe.remove(); } catch (e2) {}
    return ok;
  }

  // ---------------------------------------------------------------
  // TIMING
  // ---------------------------------------------------------------

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
      // readability floor: card must rest 1.8s after transit
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
  // CONTROL LAYER
  // ---------------------------------------------------------------

  function addSlider(ctrl, name, val) {
    var fx = ctrl.property("Effects").addProperty("ADBE Slider Control");
    fx.name = name;
    fx.property("Slider").setValue(val);
    return fx;
  }

  function addColor(ctrl, name, rgb) {
    var fx = ctrl.property("Effects").addProperty("ADBE Color Control");
    fx.name = name;
    fx.property("Color").setValue(rgb);
    return fx;
  }

  function addCheckbox(ctrl, name, val) {
    var fx = ctrl.property("Effects").addProperty("ADBE Checkbox Control");
    fx.name = name;
    fx.property("Checkbox").setValue(val ? 1 : 0);
    return fx;
  }

  function buildControl(master, data, report) {
    var ctrl = master.layers.addNull(master.duration);
    ctrl.name = "CONTROL";
    ctrl.label = 9;
    ctrl.guideLayer = true;
    addColor(ctrl, "Primary", hexToRGB(data.brand.colors.primary));
    addColor(ctrl, "Secondary", hexToRGB(data.brand.colors.secondary));
    addColor(ctrl, "Background", hexToRGB(data.brand.colors.background));
    addColor(ctrl, "Text Color", hexToRGB(data.brand.colors.text));
    addSlider(ctrl, "Heading Size", data.brand.headingSize || 84);
    addSlider(ctrl, "Body Size", data.brand.bodySize || 42);
    addSlider(ctrl, "Safe Margin %", data.brand.safeMarginPct || 10);
    addCheckbox(ctrl, "Logo Visible", true);
    // Font dropdown: scriptable items require 17.1+, guard fully
    try {
      var dd = ctrl.property("Effects").addProperty("ADBE Dropdown Control");
      dd.name = "Heading Font";
      var items = ["Brand Heading", "Brand Body", "Fallback Arial"];
      var menuProp = dd.property(1).setPropertyParameters(items);
      if (menuProp) { /* reacquired reference; nothing further needed */ }
    } catch (e) {
      report.warnings.push("Dropdown items could not be scripted on this AE version. Edit items manually on the Heading Font control.");
    }
    return ctrl;
  }

  // ---------------------------------------------------------------
  // SCENE BUILD
  // ---------------------------------------------------------------

  function styleExpr(effectName, sliderName, headingPS, bodyPS) {
    return 'var c = comp("' + MASTER_NAME + '").layer("CONTROL");\n' +
      'var sel = 1;\n' +
      'try { sel = c.effect("Heading Font")("Menu").value; } catch (e) { sel = 1; }\n' +
      'var f = sel == 1 ? "' + headingPS + '" : sel == 2 ? "' + bodyPS + '" : "Arial-BoldMT";\n' +
      'text.sourceText.style\n' +
      '  .setFont(f)\n' +
      '  .setFontSize(c.effect("' + sliderName + '")("Slider"))\n' +
      '  .setFillColor(c.effect("Text Color")("Color"));';
  }

  function autoFitExpr() {
    return 'var w = thisLayer.sourceRectAtTime(time).width;\n' +
      'if (w == 0) w = 1;\n' +
      'var c = comp("' + MASTER_NAME + '").layer("CONTROL");\n' +
      'var margin = c.effect("Safe Margin %")("Slider") / 100;\n' +
      'var target = thisComp.width * (1 - margin * 2);\n' +
      'var s = Math.min(100, target / w * 100);\n' +
      '[s, s];';
  }

  function makeText(comp, str, opts, data, report) {
    var tl = comp.layers.addText(str);
    tl.name = opts.name || ("TXT " + str.substring(0, 18));
    tl.label = 2;
    var doc = tl.property("Source Text").value;
    doc.resetCharStyle();
    doc.fontSize = opts.size || 84;
    doc.font = opts.font || data.brand.fontHeadingPS;
    doc.fillColor = hexToRGB(data.brand.colors.text);
    doc.applyFill = true;
    doc.tracking = (opts.tracking !== undefined) ? opts.tracking : 10;
    doc.justification = ParagraphJustification.CENTER_JUSTIFY;
    tl.property("Source Text").setValue(doc);
    tl.property("Position").setValue(opts.pos || [comp.width / 2, comp.height / 2]);
    if (report.styleExpressions && opts.linkStyle) {
      try {
        tl.property("Source Text").expression =
          styleExpr("Heading Font", opts.sliderName || "Heading Size", data.brand.fontHeadingPS, data.brand.fontBodyPS);
      } catch (e) {
        report.warnings.push("Style expression failed on layer " + tl.name + ": " + e.toString());
      }
    }
    if (opts.autoFit) {
      try { tl.property("Scale").expression = autoFitExpr(); } catch (e2) {}
    }
    return tl;
  }

  function slideUpReveal(layer, startTime, duration) {
    duration = duration || 0.55;
    var yOffset = 70;
    var pos = layer.property("Position");
    var opa = layer.property("Opacity");
    var basePos = pos.value;
    opa.setValueAtTime(startTime, 0);
    opa.setValueAtTime(startTime + duration * 0.6, 100);
    easeAllKeys(opa, 70, 70);
    pos.setValueAtTime(startTime, [basePos[0], basePos[1] + yOffset]);
    pos.setValueAtTime(startTime + duration * 0.72, [basePos[0], basePos[1] - 6]);
    pos.setValueAtTime(startTime + duration, basePos);
    easeAllKeys(pos, 82, 78);
  }

  function buildBGSolid(comp, data) {
    var bg = comp.layers.addSolid([1, 1, 1], "BG", comp.width, comp.height, 1, comp.duration);
    var fill = bg.property("Effects").addProperty("ADBE Fill");
    fill.property("Color").setValue(hexToRGB(data.brand.colors.background));
    try {
      fill.property("Color").expression =
        'comp("' + MASTER_NAME + '").layer("CONTROL").effect("Background")("Color")';
    } catch (e) {}
    bg.moveToEnd();
    return bg;
  }

  function accentBar(comp, data, y) {
    var sl = comp.layers.addShape();
    sl.name = "Accent Bar";
    sl.label = 8;
    var grp = sl.property("Contents").addProperty("ADBE Vector Group");
    var rect = grp.property("Contents").addProperty("ADBE Vector Shape - Rect");
    rect.property("Size").setValue([220, 8]);
    var fill = grp.property("Contents").addProperty("ADBE Vector Graphic - Fill");
    fill.property("Color").setValue([1, 0.8, 0, 1]);
    try {
      fill.property("Color").expression =
        'comp("' + MASTER_NAME + '").layer("CONTROL").effect("Primary")("Color")';
    } catch (e) {}
    sl.property("Position").setValue([comp.width / 2, y]);
    return sl;
  }

  function buildBeatComp(project, data, beat, index, fps, report) {
    var w = data.meta.resolution[0];
    var h = data.meta.resolution[1];
    var dur = beat._dur + 6; // buffer so the layer never runs out under the camera
    var c = project.items.addComp("SC" + pad2(index + 1) + " " + shortName(beat), w, h, 1, dur, fps);

    buildBGSolid(c, data);

    var superText = beat.superText || beat["super"] || "";
    var preset = beat.stylePreset || "titleCard";

    if (preset == "endcard") {
      var url = makeText(c, superText, { name: "Endcard Headline", size: 72, pos: [w / 2, h * 0.44], linkStyle: true, autoFit: true }, data, report);
      slideUpReveal(url, 0.3);
      if (beat.url) {
        var u = makeText(c, beat.url, { name: "URL", size: 40, font: data.brand.fontBodyPS, pos: [w / 2, h * 0.58], linkStyle: false, autoFit: true }, data, report);
        slideUpReveal(u, 0.55);
      }
      accentBar(c, data, h * 0.66);
    } else if (preset == "uiWalkthrough") {
      // device placeholder: rounded rect frame + grey panel, real UI supplied later
      var frame = c.layers.addShape();
      frame.name = "Device Frame (placeholder)";
      frame.label = 8;
      var fg = frame.property("Contents").addProperty("ADBE Vector Group");
      var fr = fg.property("Contents").addProperty("ADBE Vector Shape - Rect");
      fr.property("Size").setValue([420, 860]);
      fr.property("Roundness").setValue(48);
      var fstr = fg.property("Contents").addProperty("ADBE Vector Graphic - Stroke");
      fstr.property("Color").setValue([0.2, 0.2, 0.2, 1]);
      fstr.property("Stroke Width").setValue(6);
      frame.property("Position").setValue([w * 0.68, h / 2]);
      var head = makeText(c, superText, { name: "Super", size: 64, pos: [w * 0.32, h / 2], linkStyle: true, autoFit: true }, data, report);
      slideUpReveal(head, 0.35);
      slideUpReveal(frame, 0.5);
    } else {
      // titleCard and listBuild default
      var main = makeText(c, superText, { name: "Super", size: 84, pos: [w / 2, h * 0.48], linkStyle: true, autoFit: true }, data, report);
      slideUpReveal(main, 0.35);
      accentBar(c, data, h * 0.58);
      slideUpReveal(c.layer("Accent Bar"), 0.5);
    }
    return c;
  }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function shortName(beat) {
    var s = beat.superText || beat["super"] || beat.vo || "beat";
    s = s.replace(/[^A-Za-z0-9 ]/g, "");
    return s.substring(0, 24);
  }

  // ---------------------------------------------------------------
  // WORLD + STATIONS
  // ---------------------------------------------------------------

  function buildStations(layout, count, w, h) {
    var stations = [];
    var spacing = (layout == "corridor") ? 3200 : (layout == "stack") ? 2300 : 2700;
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
  // CAMERA RIG
  // ---------------------------------------------------------------

  function focalToZoom(mm, compWidth) {
    return (mm / 36) * compWidth;
  }

  function buildRig(master, useHandyCam, report) {
    var rig = master.layers.addNull(master.duration);
    rig.name = "HANDYCAM RIG";
    rig.threeDLayer = true;
    rig.label = 1;
    rig.property("Position").setValue([master.width / 2, master.height / 2, 0]);

    if (useHandyCam) {
      try {
        rig.property("Effects").addProperty("HandyCam");
        var m = new MarkerValue("1) Click HandyCam SETUP on this layer. 2) If a camera existed already, click Link Selected Camera. Keyframes live on this null and effect; no re-run needed.");
        rig.property("Marker").setValueAtTime(0, m);
        report.rigPath = "HandyCam (effect applied; click Setup once)";
      } catch (e) {
        useHandyCam = false;
      }
    }
    if (!useHandyCam) {
      var cam = master.layers.addCamera("CAM (fallback)", [master.width / 2, master.height / 2]);
      cam.label = 1;
      try { cam.property("Zoom").setValue(focalToZoom(28, master.width)); } catch (e2) {}
      cam.parent = rig;
      cam.property("Position").setValue([0, 0, -1700]);
      try { cam.property("Point of Interest").setValue([0, 0, 0]); } catch (e3) {}
      try {
        cam.property("Position").expression =
          "var a = 3; var f = 0.5;\n" +
          "value + wiggle(f, a) - wiggle(f, 0);";
      } catch (e4) {}
      report.rigPath = "Fallback two-node rig (HandyCam not detected)";
    }
    return { rig: rig, handyCam: useHandyCam };
  }

  function keyframeTransit(rigInfo, stations, beats, report) {
    var rig = rigInfo.rig;
    var pos = rig.property("Position");
    var i, b, arrive, transit;
    for (i = 0; i < beats.length; i++) {
      b = beats[i];
      arrive = b._arrive;
      transit = b._transit;
      if (i === 0) {
        pos.setValueAtTime(0, stations[0].pos);
      } else {
        pos.setValueAtTime(arrive - transit, stations[i - 1].pos);
        pos.setValueAtTime(arrive, stations[i].pos);
      }
      // station marker for navigation
      try {
        var mv = new MarkerValue("Station " + (i + 1) + ": " + shortName(b));
        rig.property("Marker").setValueAtTime(arrive, mv);
      } catch (e) {}
    }
    easeAllKeys(pos, 92, 78);

    // Whip orbit accents when HandyCam present
    if (rigInfo.handyCam) {
      try {
        var fx = rig.property("Effects").property("HandyCam");
        if (fx) {
          var oy = fx.property("Orbit Y");
          if (oy) {
            for (i = 1; i < beats.length; i++) {
              b = beats[i];
              if ((b.transitIn || "") == "whipOrbit") {
                arrive = b._arrive;
                transit = b._transit;
                oy.setValueAtTime(arrive - transit, 0);
                oy.setValueAtTime(arrive - transit * 0.5, 42);
                oy.setValueAtTime(arrive, 0);
              }
            }
            easeAllKeys(oy, 85, 85);
          }
          // low constant handheld life
          var amp = fx.property("Amplitude");
          var freq = fx.property("Frequency");
          if (amp) amp.setValue(3.5);
          if (freq) freq.setValue(0.5);
        }
      } catch (e5) {
        report.warnings.push("HandyCam orbit/wiggle properties not found by name; set them manually after Setup.");
      }
    }
  }

  // ---------------------------------------------------------------
  // MAIN BUILD
  // ---------------------------------------------------------------

  function runBuild(data) {
    var report = { warnings: [], rigPath: "", styleExpressions: true, aeVersion: 0, totalDuration: 0 };
    if (!data || !data.beats || data.beats.length === 0) {
      alert("Apostle Compositor: no beats found in JSON.");
      return;
    }
    if (!data.meta) data.meta = {};
    if (!data.meta.resolution) data.meta.resolution = [1920, 1080];
    if (!data.meta.fps) data.meta.fps = 25;
    if (!data.brand) data.brand = {};
    if (!data.brand.colors) data.brand.colors = { primary: "#FFCC00", secondary: "#1E1E1E", background: "#FFFFFF", text: "#111111" };
    if (!data.brand.fontHeadingPS) data.brand.fontHeadingPS = "HelveticaNeue-Bold";
    if (!data.brand.fontBodyPS) data.brand.fontBodyPS = "HelveticaNeue";

    // fold endcard into beats as final beat
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

    app.beginUndoGroup("Apostle Compositor Build");
    try {
      preflight(data, report);
      computeTiming(data, report);

      var fps = data.meta.fps;
      var w = data.meta.resolution[0];
      var h = data.meta.resolution[1];
      var master = app.project.items.addComp(MASTER_NAME, w, h, 1, report.totalDuration, fps);
      master.motionBlur = true;

      var hcAvailable = detectHandyCam(master);
      var ctrl = buildControl(master, data, report);

      // scenes
      var beats = data.beats;
      var stations = buildStations(data.meta.layout || "corridor", beats.length, w, h);
      var i, sceneComp, sceneLayer;
      for (i = beats.length - 1; i >= 0; i--) { // reverse so layer order reads 01..N top-down under rig
        sceneComp = buildBeatComp(app.project, data, beats[i], i, fps, report);
        sceneLayer = master.layers.add(sceneComp);
        sceneLayer.threeDLayer = true;
        sceneLayer.collapseTransformation = true;
        sceneLayer.motionBlur = true;
        sceneLayer.label = 3;
        sceneLayer.property("Position").setValue(stations[i].pos);
        sceneLayer.startTime = Math.max(0, beats[i]._arrive - 0.45);
      }

      var rigInfo = buildRig(master, hcAvailable, report);
      keyframeTransit(rigInfo, stations, beats, report);

      ctrl.moveToBeginning();
      rigInfo.rig.moveToBeginning();

      master.openInViewer();

      var msg = "Apostle Compositor: build complete.\n\n" +
        "Rig: " + report.rigPath + "\n" +
        "Duration: " + report.totalDuration.toFixed(1) + "s at " + fps + "fps\n" +
        "Beats: " + beats.length + "\n" +
        "Style controls: " + (report.styleExpressions ? "live on CONTROL layer" : "baked (AE below 17.0)") + "\n";
      if (report.warnings.length > 0) {
        msg += "\nWarnings:\n";
        for (i = 0; i < report.warnings.length; i++) msg += "- " + report.warnings[i] + "\n";
      }
      alert(msg);

    } catch (err) {
      alert("Apostle Compositor Error: " + err.toString() + (err.line ? ("\nLine: " + err.line) : ""));
    }
    app.endUndoGroup();
  }

  // ---------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------

  function loadJSONFile() {
    var f = File.openDialog("Select beats JSON", "*.json");
    if (!f) return null;
    f.encoding = "UTF-8";
    if (!f.open("r")) { alert("Could not open file."); return null; }
    var str = f.read();
    f.close();
    var data = parseJSONSafe(str);
    if (!data) alert("Could not parse JSON. Check the file against sample-beats.json.");
    return data;
  }

  function buildUI(thisObj) {
    var pal = (thisObj instanceof Panel) ? thisObj :
      new Window("palette", PANEL_TITLE, undefined, { resizeable: true });
    pal.orientation = "column";
    pal.alignChildren = ["fill", "top"];
    pal.spacing = 8;
    pal.margins = 12;

    var title = pal.add("statictext", undefined, "APOSTLE COMPOSITOR");
    title.alignment = "center";

    var info = pal.add("statictext", undefined, "Script to comp. Beats JSON in, world out.", { multiline: true });
    info.alignment = "fill";

    var btnBuild = pal.add("button", undefined, "Load Beats JSON + Build");
    btnBuild.onClick = function () {
      var data = loadJSONFile();
      if (data) runBuild(data);
    };

    var btnHelp = pal.add("button", undefined, "What do I get?");
    btnHelp.onClick = function () {
      alert("Builds from a beats JSON:\n\n" +
        "- MASTER comp with brand CONTROL null (colors, fonts, sizes, safe margin)\n" +
        "- One scene precomp per beat, VO-paced timing\n" +
        "- 3D scene world (corridor, gallery, carousel, or stack)\n" +
        "- HandyCam rig if installed (click Setup once on the rig null), fallback camera otherwise\n" +
        "- Station markers on the rig for navigation\n\n" +
        "After the build: restyle everything from the CONTROL layer.\n" +
        "See sample-beats.json for the data format.");
    };

    if (pal instanceof Window) { pal.center(); pal.show(); }
    else { pal.layout.layout(true); }
    return pal;
  }

  buildUI(thisObj);

})(this);
