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

  var LIB_VERSION = "2.17.0";

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
      var projPath = null;
      try { projPath = app.project.file ? app.project.file.fsName : "Untitled Project"; } catch (ep) {}
      f.write(JSON.stringify({ savedAt: ts, project: projPath, beats: beatsData, report: report }, null, 1));
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

  // ---------------------------------------------------------------
  // EASING LIBRARY (Phase 6)
  // Keyframe-reading easing expressions: animate with plain keys, apply
  // personality as an expression afterward, swap personality without
  // touching keys (the Ease-and-Wizz pattern; equations are our own
  // implementation of the BSD-licensed Penner set — do not copy E&W files).
  // ---------------------------------------------------------------

  // Body of f(t,b,c,d) for each easing (t elapsed, b start, c delta, d span)
  var EASE_CORE = {
    outQuint: "t=t/d-1; return c*(t*t*t*t*t+1)+b;",
    inOutQuint: "t/=d/2; if (t<1) return c/2*t*t*t*t*t+b; t-=2; return c/2*(t*t*t*t*t+2)+b;",
    outExpo: "if (t==d) return b+c; return c*(-Math.pow(2,-10*t/d)+1)+b;",
    // Penner easeInOutExpo. The 0.000976563 correction (= 2^-10) is what keeps
    // the two halves continuous at the midpoint; without it the curve steps.
    // This is the shape Tim hand-applied via Ease and Wizz ("Curvaceous /
    // inoutExpo") on VIDEO_001 SC01 — slow out, hard middle, long soft settle.
    inOutExpo: "var C=0.000976563; t=t/(d/2); var v; if (t<1) { v=Math.pow(2,10*(t-1))-C; } else { v=(-Math.pow(2,-10*(t-1))+2)+C; } return b+(v/2)*c;",
    outBack: "var s=1.70158; t=t/d-1; return c*(t*t*((s+1)*t+s)+1)+b;",
    outElastic: "if (t==0) return b; t/=d; if (t==1) return b+c; var p=d*0.3, s=p/4; return c*Math.pow(2,-10*t)*Math.sin((t*d-s)*(2*Math.PI)/p)+c+b;"
  };

  // Full dimension-aware expression: re-interpolates between the two keys
  // around `time` with the named easing; returns plain value outside keys.
  function easeKeyframeExpression(name) {
    var core = EASE_CORE[name];
    if (!core) return null;
    return "function EZ(t,b,c,d){" + core + "}\n" +
      "var n=0;\n" +
      "if (numKeys>0){ n=nearestKey(time).index; if (key(n).time>time) n--; }\n" +
      "if (n===0 || n===numKeys){ value; } else {\n" +
      "var k1=key(n), k2=key(n+1);\n" +
      "var t=time-k1.time, d=k2.time-k1.time;\n" +
      "var v1=k1.value, v2=k2.value;\n" +
      "if (v1 instanceof Array){ var out=[]; for (var i=0;i<v1.length;i++) out.push(EZ(t,v1[i],v2[i]-v1[i],d)); out; }\n" +
      "else { EZ(t,v1,v2-v1,d); }\n" +
      "}";
  }

  function applyEaseExpression(prop, name) {
    var ex = easeKeyframeExpression(name);
    if (!ex) return false;
    try { prop.expression = ex; return true; } catch (e) { return false; }
  }

  // Named personalities. transitIn/Out are keyframe influences for camera
  // transit keys; reveal/revealDur/stagger drive text entrances.
  var EASE_PROFILES = {
    "corporate-smooth": { transitIn: 92, transitOut: 78, reveal: "outQuint", revealDur: 0.7, stagger: 0.14 },
    "snappy":           { transitIn: 96, transitOut: 55, reveal: "outExpo",  revealDur: 0.45, stagger: 0.10 },
    "playful":          { transitIn: 88, transitOut: 82, reveal: "outBack",  revealDur: 0.75, stagger: 0.18 },
    // The house style of a client series from 2026-08-02: expo in/out on every
    // moment Position and Scale, plus the word-by-word text reveal.
    "curvaceous":       { transitIn: 92, transitOut: 78, reveal: "inOutExpo", revealDur: 0.7, stagger: 0.14 }
  };

  function profileFor(beat, data) {
    var name = null;
    if (beat && beat.motion && beat.motion.ease) name = beat.motion.ease;
    if (!name && data && data.meta && data.meta.easeProfile) name = data.meta.easeProfile;
    if (!EASE_PROFILES[name]) name = "corporate-smooth";
    return EASE_PROFILES[name];
  }

  function buildProfile(data) {
    var name = (data && data.meta && data.meta.easeProfile) || null;
    if (!name && data && data.beats && data.beats[0] && data.beats[0].motion) name = data.beats[0].motion.ease;
    if (!EASE_PROFILES[name]) name = "corporate-smooth";
    return EASE_PROFILES[name];
  }

  // "Earn via Banking. / Home Loans. Savings Accounts." -> heading + items;
  // "More points. More perks. More partners." -> items only. Shared contract
  // with parse-brief's listBuild inference — keep the two in sync.
  function splitListSuper(superText) {
    var heading = null, itemsRaw = superText;
    var slash = superText.indexOf(" / ");
    if (slash !== -1) {
      heading = superText.substring(0, slash).replace(/[.\s]+$/g, "");
      itemsRaw = superText.substring(slash + 3);
    }
    var parts = itemsRaw.split(/\.\s*/);
    var items = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].replace(/^\s+|\s+$/g, "");
      if (p !== "") items.push(p);
    }
    if (heading === null && items.length < 3) return { heading: null, items: null }; // not list-shaped
    return { heading: heading, items: items };
  }

  // Endcard supers are long spoken lines; the on-screen headline is the
  // short pre-comma clause ("To find out more, visit ..." -> "To find out
  // more"). Mirrored in parse-brief.cjs.
  function endcardHeadline(superText) {
    var m = String(superText || "").match(/^([^,]{3,60}),/);
    return m ? m[1] : superText;
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

    // pass 1: every beat's arriving transit (needed for lookahead below)
    for (i = 0; i < beats.length; i++) {
      transit = transitDur[beats[i].transitIn || "dollyPush"];
      if (transit === undefined) transit = 1.1;
      beats[i]._transit = (i === 0) ? 0 : transit;
    }
    // pass 2: durations. The readability floor must survive BOTH the beat's
    // own arriving transit AND the next beat's departing transit — pixel QA
    // caught beat-1 leaving after a 1.0s hold because only the arrival was
    // counted (settle frame still motion-blurred at arrive+1.2).
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
      var nextTransit = (i + 1 < beats.length) ? beats[i + 1]._transit : 0;
      if (b.superText || b["super"]) {
        var rest = dur - b._transit - 0.2 - nextTransit;
        if (rest < 1.8) {
          var bump = 1.8 - rest;
          dur = dur + bump;
          report.warnings.push("Beat " + (i + 1) + " extended by " + bump.toFixed(1) + "s to meet the 1.8s readability floor (incl. departure transit).");
        }
      }
      b._dur = dur;
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
    // Surface = the plate colour under icon art. Kept separate from
    // Background: on a coloured backdrop, "paper" must stay white rather
    // than inherit the backdrop and make every tile vanish.
    addColor(ctrl, "Surface", hexToRGB((data.brand.colors.surface) || "#FFFFFF"));
    addSlider(ctrl, "Heading Size", data.brand.headingSize || 84);
    addSlider(ctrl, "Body Size", data.brand.bodySize || 42);
    addSlider(ctrl, "Heading Tracking", (data.brand.headingTracking !== undefined) ? data.brand.headingTracking : 10);
    addSlider(ctrl, "Body Tracking", (data.brand.bodyTracking !== undefined) ? data.brand.bodyTracking : 10);
    addSlider(ctrl, "Safe Margin %", data.brand.safeMarginPct || 10);
    addSlider(ctrl, "Handheld Amount", 0); // keyframed by keyframeHandheld; camera wiggle reads it
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
  // sizeMult: per-layer multiplier on the master size slider (list items
  // render at bodySize * mult while staying fully master-controlled)
  function styleExpr(masterName, role, sizeMult) {
    var fontLayer = (role === "body") ? "FONT Body" : "FONT Heading";
    var slider = (role === "body") ? "Body Size" : "Heading Size";
    var trackSlider = (role === "body") ? "Body Tracking" : "Heading Tracking";
    var mult = (sizeMult && sizeMult > 0) ? sizeMult : 1;
    return 'var c = comp("' + masterName + '").layer("CONTROL");\n' +
      'var f = "";\n' +
      'try { f = comp("' + masterName + '").layer("' + fontLayer + '").text.sourceText.toString().replace(/^\\s+|\\s+$/g, ""); } catch (e) { f = ""; }\n' +
      'var st = text.sourceText.style;\n' +
      'if (f != "") { try { st = st.setFont(f); } catch (e2) {} }\n' +
      'st = st.setFontSize(c.effect("' + slider + '")("Slider") * ' + mult + ')\n' +
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

  // maxWidth (optional, px): a tighter budget than the safe margin, for
  // text that has to fit inside a shape (the placeholder caption)
  function autoFitExpr(masterName, maxWidth) {
    // fit to the space the layer actually has from its (center-justified)
    // position to the nearest safe-margin edge — off-center text (e.g. the
    // uiWalkthrough left column) gets a proportionally smaller budget
    return 'var w = thisLayer.sourceRectAtTime(time).width;\n' +
      'if (w == 0) w = 1;\n' +
      'var c = comp("' + masterName + '").layer("CONTROL");\n' +
      'var m = c.effect("Safe Margin %")("Slider") / 100 * thisComp.width;\n' +
      'var x = transform.position[0];\n' +
      // 4px inset: sourceRectAtTime under-reports by the glyph side bearing on
      // the last character, so fitting exactly to the margin lands the rendered
      // right edge 2-3px past it and checkTextSafeMargins (rightly) flags it
      'var half = Math.min(x - m, thisComp.width - m - x) - 4;\n' +
      'if (half < 1) half = 1;\n' +
      (maxWidth ? 'half = Math.min(half, ' + (maxWidth / 2) + ');\n' : '') +
      'var s = Math.min(100, (half * 2) / w * 100);\n' +
      '[s, s];';
  }

  function makeText(comp, str, opts, data, report, masterName) {
    var tl = comp.layers.addText(str);
    tl.name = opts.name || ("TXT " + str.substring(0, 18));
    tl.label = 2;
    // AE 26 intermittently hands back a garbage TextDocument on the first
    // .value read after addText (fillColor rejects junk like [3126,1920,
    // 1080]); non-deterministic, project-state dependent. Re-fetch + retry
    // once — the second read is reliably sane.
    var docProp = tl.property("ADBE Text Properties").property("ADBE Text Document");
    var attempt;
    for (attempt = 0; attempt < 2; attempt++) {
      try {
        var doc = docProp.value;
        doc.resetCharStyle();
        doc.fontSize = opts.size || 84;
        doc.font = opts.font || data.brand.fontHeadingPS;
        doc.fillColor = hexToRGB(data.brand.colors.text);
        doc.applyFill = true;
        doc.tracking = (opts.tracking !== undefined) ? opts.tracking : 10;
        doc.justification = ParagraphJustification.CENTER_JUSTIFY;
        docProp.setValue(doc);
        break;
      } catch (eDoc) {
        if (attempt === 1) report.warnings.push("Text style baking failed twice on '" + tl.name + "' (" + eDoc.toString() + "); layer keeps defaults" + (opts.linkStyle ? " until the style expression evaluates" : "") + ".");
      }
    }
    tl.property("ADBE Transform Group").property("ADBE Position").setValue(opts.pos || [comp.width / 2, comp.height / 2]);
    if (report.styleExpressions && opts.linkStyle) {
      try {
        tl.property("ADBE Text Properties").property("ADBE Text Document").expression =
          styleExpr(masterName, opts.role || "heading", opts.sizeMult);
      } catch (e) {
        report.warnings.push("Style expression failed on layer " + tl.name + ": " + e.toString());
      }
    }
    if (opts.autoFit) {
      try { tl.property("ADBE Transform Group").property("ADBE Scale").expression = autoFitExpr(masterName); } catch (e2) {}
    }
    return tl;
  }

  // profile (optional): two plain keys shaped by the profile's easing
  // expression — personality is swappable post-build by changing the
  // expression alone. Legacy three-key path when no profile given.
  function slideUpReveal(layer, startTime, duration, profile) {
    var yOffset = 70;
    var pos = layer.property("ADBE Transform Group").property("ADBE Position");
    var opa = layer.property("ADBE Transform Group").property("ADBE Opacity");
    var basePos = pos.value;
    if (profile) {
      duration = duration || profile.revealDur;
      opa.setValueAtTime(startTime, 0);
      opa.setValueAtTime(startTime + duration * 0.6, 100);
      easeAllKeys(opa, 70, 70);
      pos.setValueAtTime(startTime, [basePos[0], basePos[1] + yOffset]);
      pos.setValueAtTime(startTime + duration, basePos);
      applyEaseExpression(pos, profile.reveal);
      return;
    }
    duration = duration || 0.55;
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
    // Schema v2: tag the precomp with its stable beat identity so surgical
    // edit ops (updateBeatText / retimeBeats) can find beats without relying
    // on comp names or indices. Comment format: apostle beatId=<id> section=<id>
    if (beat.beatId) {
      c.comment = "apostle beatId=" + beat.beatId + (beat.sectionId ? " section=" + beat.sectionId : "");
    }

    buildBGSolid(c, data, masterName);

    var superText = beat.superText || beat["super"] || "";
    var preset = beat.stylePreset || "titleCard";

    // Reveal timing contract: the scene layer starts at arrive - 0.45 in the
    // master, so a reveal at scene-time 0.55 begins 0.1 s AFTER the camera
    // arrives. v2.1 revealed at 0.3-0.5 — half the entrance played out while
    // the camera was still in transit, so arrivals looked washed-out/empty.
    var prof = profileFor(beat, data);

    if (preset == "endcard") {
      // headline = short pre-comma clause, not the whole spoken line —
      // the v2.4 endcard autofit shrank long supers below the URL size
      var headText = beat.headline || endcardHeadline(superText);
      var hl = makeText(c, headText, { name: "Endcard Headline", size: 96, pos: [w / 2, h * 0.42], linkStyle: true, autoFit: true }, data, report, masterName);
      slideUpReveal(hl, 0.55, null, prof);
      if (beat.url) {
        var u = makeText(c, beat.url, { name: "URL", size: 44, font: data.brand.fontBodyPS, pos: [w / 2, h * 0.56], linkStyle: true, role: "body", autoFit: true }, data, report, masterName);
        slideUpReveal(u, 0.8, null, prof);
      }
      accentBar(c, data, h * 0.64, masterName);
    } else if (preset == "listBuild") {
      var split = splitListSuper(superText);
      if (split.items === null) {
        // not list-shaped after all — fall back to the titleCard layout
        var solo = makeText(c, superText, { name: "Super", size: 84, pos: [w / 2, h * 0.48], linkStyle: true, autoFit: true }, data, report, masterName);
        slideUpReveal(solo, 0.55, null, prof);
        accentBar(c, data, h * 0.58, masterName);
        slideUpReveal(findLayer(c, "Accent Bar"), 0.75, null, prof);
      } else {
        var hasHead = split.heading !== null && split.heading !== "";
        var itemN = split.items.length;
        var lineGap = Math.max(64, (data.brand.bodySize || 42) * 1.9);
        var headY = h * 0.34;
        var firstY = hasHead ? h * 0.5 : (h / 2 - ((itemN - 1) * lineGap) / 2);
        // "Super" stays the heading holder (updateBeatText contract); an
        // empty heading still gets the layer so re-splits have a target
        var headLayer = makeText(c, hasHead ? split.heading : "", { name: "Super", size: 84, pos: [w / 2, headY], linkStyle: true, autoFit: true }, data, report, masterName);
        if (hasHead) {
          slideUpReveal(headLayer, 0.55, null, prof);
          accentBar(c, data, headY + 64, masterName);
          slideUpReveal(findLayer(c, "Accent Bar"), 0.65, null, prof);
        } else {
          headLayer.enabled = false;
        }
        for (var li = 0; li < itemN; li++) {
          var itLay = makeText(c, split.items[li], { name: "Item " + (li + 1), size: hasHead ? (data.brand.bodySize || 42) + 18 : 64, sizeMult: hasHead ? 1.4 : 1.55, font: data.brand.fontBodyPS, role: "body", pos: [w / 2, firstY + li * lineGap], linkStyle: true, autoFit: true }, data, report, masterName);
          slideUpReveal(itLay, (hasHead ? 0.75 : 0.55) + li * prof.stagger, null, prof);
        }
      }
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
      slideUpReveal(head, 0.55, null, prof);
      slideUpReveal(frame, 0.7, null, prof);
    } else {
      var main = makeText(c, superText, { name: "Super", size: 84, pos: [w / 2, h * 0.48], linkStyle: true, autoFit: true }, data, report, masterName);
      slideUpReveal(main, 0.55, null, prof);
      accentBar(c, data, h * 0.58, masterName);
      slideUpReveal(findLayer(c, "Accent Bar"), 0.75, null, prof);
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
      'var a = 0;\n' +
      'try { a = comp("' + master.name + '").layer("CONTROL").effect("Handheld Amount")("Slider"); } catch (e) {}\n' +
      'var f = 0.5;\n' +
      'value + wiggle(f, a) - wiggle(f, 0);';
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

  function keyframeTransitExpression(rigInfo, stations, beats, profile) {
    if (!profile) profile = EASE_PROFILES["corporate-smooth"];
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
          // lateral whip: rig yaw swings out and back across the move.
          // NEGATIVE yaw = look BACK at the outgoing station: incoming
          // text only reveals 0.1s after arrival (v2.2 contract), so a
          // forward whip stares at a blank plane — pixel QA caught the
          // fully white mid-whip frame. Looking back keeps revealed
          // content in view for the whole whip.
          yrot.setValueAtTime(arrive - transit, 0);
          yrot.setValueAtTime(arrive - transit * 0.5, -26);
          yrot.setValueAtTime(arrive, 0);
          mid = [
            (stations[i - 1].pos[0] + stations[i].pos[0]) / 2,
            (stations[i - 1].pos[1] + stations[i].pos[1]) / 2,
            ((stations[i - 1].pos[2] + stations[i].pos[2]) / 2) - 420
          ];
          pos.setValueAtTime(arrive - transit * 0.5, mid);
        } else if (tt === "dollyZoom" && zoomProp) {
          // vertigo push: tight zoom at departure easing to base on arrival;
          // first key = baseZoom*1.18 only from the transit start, and the
          // start-of-transit anchor keeps earlier times at base
          zoomProp.setValueAtTime(arrive - transit, baseZoom);
          zoomProp.setValueAtTime(arrive - transit * 0.85, baseZoom * 1.18);
          zoomProp.setValueAtTime(arrive, baseZoom);
        } else if (tt === "lateralTruck") {
          // mid-transit z pull-back widens the view so neighbor content
          // stays visible — pixel QA caught a fully white mid-truck frame
          // when both supers were narrow (planes visible but their
          // centered text just off both edges). Trucks only: dollyPush
          // already moves in z, and "none" has no transit span at all.
          mid = [
            (stations[i - 1].pos[0] + stations[i].pos[0]) / 2,
            (stations[i - 1].pos[1] + stations[i].pos[1]) / 2,
            ((stations[i - 1].pos[2] + stations[i].pos[2]) / 2) - 420
          ];
          pos.setValueAtTime(arrive - transit * 0.5, mid);
        }
      }
      addStationMarker(rigInfo.rig, arrive, i, b);
    }
    easeAllKeys(pos, profile.transitIn, profile.transitOut);
    if (yrot.numKeys > 0) easeAllKeys(yrot, 85, 85);
    if (zoomProp && zoomProp.numKeys > 0) easeAllKeys(zoomProp, 80, 80);
  }

  // ---------------------------------------------------------------
  // HANDHELD POLISH (Phase 6)
  // Per-beat handheld life on the expression rig, plugin-free: a Handheld
  // Amount slider on CONTROL drives the camera wiggle amplitude; the build
  // keyframes it from beats[].motion.handycam — settled at stations,
  // livelier mid-transit. The real HandyCam plugin remains the explicit
  // opt-in for STATIC rigs only (Phase 3 verdict: it cannot do transport);
  // this layer is what "handycam: subtle/energetic" means on transport
  // builds, so client work gets handheld life with zero manual steps.
  // ---------------------------------------------------------------

  var HANDHELD_LEVELS = { off: 0, subtle: 2.5, energetic: 7 };

  function handheldLevel(beat) {
    var name = (beat && beat.motion && beat.motion.handycam) ? beat.motion.handycam : "off";
    var v = HANDHELD_LEVELS[name];
    return (v === undefined) ? 0 : v;
  }

  function keyframeHandheld(ctrl, beats) {
    var slider = null;
    try { slider = ctrl.property("ADBE Effect Parade").property("Handheld Amount").property("ADBE Slider Control-0001"); } catch (e) { return false; }
    if (!slider) return false;
    removeAllKeys(slider);
    var any = false;
    for (var i = 0; i < beats.length; i++) {
      var b = beats[i];
      var lvl = handheldLevel(b);
      if (lvl > 0) any = true;
      slider.setValueAtTime(b._arrive, lvl);
      if (i > 0 && b._transit > 0) {
        var mid = Math.min(10, Math.max(lvl, handheldLevel(beats[i - 1])) * 2.4);
        slider.setValueAtTime(b._arrive - b._transit * 0.5, mid);
      }
    }
    if (!any && slider.numKeys > 0) { removeAllKeys(slider); slider.setValue(0); }
    else easeAllKeys(slider, 70, 70);
    return true;
  }

  // Retrofit/adjust handheld polish on an existing master from a beats JSON.
  function applyHandheldPolish(masterName, beatsJSON) {
    var master = findComp(masterName);
    if (!master) return { status: "error", error: "Comp not found: " + masterName };
    var ctrl = findLayer(master, "CONTROL");
    if (!ctrl) return { status: "error", error: "CONTROL layer not found on " + masterName };
    var data = parseJSONSafe(beatsJSON);
    if (!data || !data.beats) return { status: "error", error: "No beats in JSON." };
    var report = { status: "success", warnings: [] };
    app.beginUndoGroup("Apostle applyHandheldPolish");
    try {
      var hasSlider = true;
      try { ctrl.property("ADBE Effect Parade").property("Handheld Amount").name; } catch (eS) { hasSlider = false; }
      if (!hasSlider) addSlider(ctrl, "Handheld Amount", 0);
      var cam = findLayer(master, "APOSTLE CAM");
      if (cam) {
        try {
          cam.property("ADBE Transform Group").property("ADBE Position").expression =
            'var a = 0;\n' +
            'try { a = comp("' + masterName + '").layer("CONTROL").effect("Handheld Amount")("Slider"); } catch (e) {}\n' +
            'var f = 0.5;\n' +
            'value + wiggle(f, a) - wiggle(f, 0);';
        } catch (eE) { report.warnings.push("Could not set camera wiggle expression."); }
      } else {
        report.warnings.push("APOSTLE CAM not found — handheld polish targets the expression rig.");
      }
      computeTiming(data, { warnings: [], beats: [] });
      keyframeHandheld(ctrl, data.beats);
    } catch (e) {
      report.status = "error";
      report.error = e.toString();
    } finally {
      app.endUndoGroup();
    }
    return report;
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
        keyframeTransitExpression(rigInfo, stations, beats, buildProfile(data));
        keyframeHandheld(ctrl, beats);
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
          beatId: beats[i].beatId || null,
          sectionId: beats[i].sectionId || null,
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
          var layer = null;
          try { layer = c.layer(i); } catch (eL) { layer = null; }
          if (layer === null || layer === undefined) continue;
          C.layers.push(serializeLayer(layer, budget));
          var lsrc = null;
          try { lsrc = layer.source; } catch (eS) { lsrc = null; }
          if (lsrc && lsrc instanceof CompItem && !seen[lsrc.name]) queue.push(lsrc);
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
    if (!f.exists) return null;
    // existence is not completion — wait for the size to hold steady twice
    var last = -1, stable = 0;
    while (stable < 2 && waited < 8000) {
      $.sleep(150); waited += 150;
      var len = 0;
      try { len = f.length; } catch (fe) {}
      if (len > 0 && len === last) { stable++; } else { stable = 0; }
      last = len;
    }
    return f.fsName;
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
    // A text animator is still mid-flight long after the layer transform has
    // settled: the word reveal runs ~1.6s while Position finishes in 0.62s.
    // Sampling in between measures words that are still thousands of px below
    // the line — which read as a 6000px safe-margin violation on every
    // revealed layer. Wait for the last selector keyframe too.
    try {
      var ans = layer.property("ADBE Text Properties").property("ADBE Text Animators");
      for (var a = 1; a <= ans.numProperties; a++) {
        var sels = ans.property(a).property("ADBE Text Selectors");
        for (var s = 1; s <= sels.numProperties; s++) {
          var off = sels.property(s).property("ADBE Text Percent Offset");
          if (off && off.numKeys > 0) {
            var ta = off.keyTime(off.numKeys) + 0.1;
            if (ta > t) t = ta;
          }
        }
      }
    } catch (e2) {}
    // If the entrance somehow outruns the layer, sample at the END of its
    // life, not the midpoint — the midpoint of a layer whose animation is
    // still running measures a shape that is still moving.
    if (t > layer.outPoint) {
      t = layer.outPoint - 0.05;
      if (t < layer.inPoint) t = layer.inPoint;
    }
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
      var unmeasured = [];   // layers/comps this sweep could not measure
      var checked = 0;
      var seen = {};
      var queue = [root];

      // Every AE access below is guarded. AE hands back null for things that
      // look guaranteed — layer.source on shape layers and cameras, and
      // c.layer(i) for i <= c.numLayers on some comps — and one such layer
      // used to abort the whole sweep with "null is not an object".
      while (queue.length > 0) {
        var c = queue.shift();
        var cname = null, cw = 0, ch = 0, cn = 0;
        try { cname = c.name; cw = c.width; ch = c.height; cn = c.numLayers; } catch (eC) { cname = null; }
        if (cname === null) { unmeasured.push("unreadable comp in walk"); continue; }
        if (seen[cname]) continue;
        seen[cname] = true;
        var mx = cw * marginPct / 100;
        var my = ch * marginPct / 100;

        for (var i = 1; i <= cn; i++) {
          var layer = null;
          try { layer = c.layer(i); } catch (eL) { layer = null; }
          // NB: `!layer` is not a safe emptiness test — AE DOM objects can
          // evaluate falsy in boolean context, which silently skipped ~half
          // the shape/text layers in a comp. Compare against null explicitly.
          if (layer === null || layer === undefined) { unmeasured.push(cname + " / layer " + i + " (null)"); continue; }

          var lsrc = null;
          try { lsrc = layer.source; } catch (eSrc) { lsrc = null; }
          if (lsrc && lsrc instanceof CompItem && !seen[lsrc.name]) queue.push(lsrc);

          var isText = false;
          try { isText = (layer instanceof TextLayer); } catch (eT) { isText = false; }
          if (!isText) continue;
          try { if (layer.guideLayer || !layer.enabled) continue; } catch (eG) { continue; }

          checked++;
          try {
            var t = textHoldTime(layer);
            var rect = layer.sourceRectAtTime(t, false);
            var tg = layer.property("ADBE Transform Group");
            var pos = tg.property("ADBE Position").valueAtTime(t, false);
            var anchor = tg.property("ADBE Anchor Point").valueAtTime(t, false);
            var scale = tg.property("ADBE Scale").valueAtTime(t, false);
            if (!rect || !pos || !anchor || !scale) {
              unmeasured.push(cname + " / " + layer.name + " (no bounds)");
              continue;
            }
            var sx = scale[0] / 100, sy = scale[1] / 100;
            var left = pos[0] + (rect.left - anchor[0]) * sx;
            var top = pos[1] + (rect.top - anchor[1]) * sy;
            var right = left + rect.width * sx;
            var bottom = top + rect.height * sy;
            var EPS = 2; // autoFit scales text flush to the margin
            var out = [];
            if (left < mx - EPS) out.push("left by " + Math.round(mx - left) + "px");
            if (right > cw - mx + EPS) out.push("right by " + Math.round(right - (cw - mx)) + "px");
            if (top < my - EPS) out.push("top by " + Math.round(my - top) + "px");
            if (bottom > ch - my + EPS) out.push("bottom by " + Math.round(bottom - (ch - my)) + "px");
            if (out.length) {
              violations.push({
                comp: cname, layer: layer.name, atTime: Math.round(t * 100) / 100,
                bounds: [Math.round(left), Math.round(top), Math.round(right), Math.round(bottom)],
                exceeds: out,
                fixPath: 'comp("' + cname + '").layer("' + layer.name + '") Transform/Scale or Position'
              });
            }
          } catch (eLayer) {
            var lnm = "?"; try { lnm = layer.name; } catch (eN) {}
            unmeasured.push(cname + " / " + lnm + ": " + eLayer.toString());
          }
        }
      }
      return toJSON({
        status: "success", marginPct: marginPct, textLayersChecked: checked,
        violations: violations, unmeasured: unmeasured
      });
    } catch (e) {
      return errJSON("checkTextSafeMargins", e);
    }
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
      var warnings = [];
      // Thresholds were referenced but never declared, so this check threw
      // before it could report anything. Measured against a healthy build:
      // the expression rig parks the camera 1700px in front of every station
      // with framing inside +/-2px. CLIP_MIN_Z therefore only fires when the
      // camera has genuinely collapsed onto or behind the plane (the Phase 3
      // HandyCam failure mode); FRAME_TOLERANCE_XY absorbs handheld shake at
      // "energetic" while still catching a corridor-scale framing miss.
      var CLIP_MIN_Z = 400;
      var FRAME_TOLERANCE_XY = 60;
      // layerWorldPos was called here but never defined — checkCameraDistance
      // threw ReferenceError on every run, so one of the three deterministic
      // checks has never actually reported. A child's Position is expressed
      // relative to its parent's anchor, and that anchor sits at the parent's
      // own world position, so with no rotation/scale in the chain world
      // position is exact translation composition. The Apostle rig parents
      // only the camera, to a plain translation null — but guard the general
      // case rather than silently returning a wrong number.
      function layerWorldPos(layer, t) {
        var p = [0, 0, 0];
        var node = layer;
        var guard = 0;
        while (node && guard < 32) {
          guard++;
          var tg = node.property("ADBE Transform Group");
          var lp = tg.property("ADBE Position").valueAtTime(t, false);
          p[0] += lp[0];
          p[1] += lp[1];
          p[2] += (lp.length > 2 ? lp[2] : 0);
          node = node.parent;
          if (node) {
            var ptg = node.property("ADBE Transform Group");
            var bad = false;
            try {
              var sc = ptg.property("ADBE Scale").valueAtTime(t, false);
              if (Math.round(sc[0]) !== 100 || Math.round(sc[1]) !== 100) bad = true;
            } catch (eS) {}
            try {
              var rz = ptg.property("ADBE Rotate Z").valueAtTime(t, false);
              if (Math.round(rz) % 360 !== 0) bad = true;
            } catch (eR) {}
            try {
              var or = ptg.property("ADBE Orientation").valueAtTime(t, false);
              if (Math.round(or[0]) % 360 !== 0 || Math.round(or[1]) % 360 !== 0 || Math.round(or[2]) % 360 !== 0) bad = true;
            } catch (eO) {}
            if (bad) warnings.push("parent '" + node.name + "' carries rotation or scale — world position is translation-only and therefore approximate");
          }
        }
        return p;
      }
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
      return toJSON({ status: "success", camera: cam.name, rig: rig.name, stations: results, violations: violations, warnings: warnings });
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
  // TYPOGRAPHY CONTROL
  // Scripted access to the master font system: the FONT Heading / FONT
  // Body guide layers (PostScript name holders) and the CONTROL sliders
  // (Heading/Body Size, Heading/Body Tracking). Shared by the Apostle
  // Fonts panel and bridge callers.
  // ---------------------------------------------------------------

  var TYPO_SLIDERS = {
    headingSize: "Heading Size",
    bodySize: "Body Size",
    headingTracking: "Heading Tracking",
    bodyTracking: "Body Tracking",
    safeMarginPct: "Safe Margin %"
  };

  // Master comps are identified structurally: CONTROL null + both font
  // guide layers. Returns names, newest project item first.
  function findMasterComps() {
    var out = [];
    for (var i = app.project.numItems; i >= 1; i--) {
      var it = app.project.item(i);
      if (!(it instanceof CompItem)) continue;
      if (findLayer(it, "CONTROL") && findLayer(it, "FONT Heading") && findLayer(it, "FONT Body")) {
        out.push(it.name);
      }
    }
    return out;
  }

  // Installed fonts grouped by family via app.fonts (AE 24+).
  // Returns [{family, styles: [{style, ps}]}]; empty array when the API
  // is unavailable — callers must fall back to manual PS-name entry.
  function listFonts() {
    var out = [];
    try {
      if (!(app.fonts && app.fonts.allFonts)) return out;
      var groups = app.fonts.allFonts;
      for (var i = 0; i < groups.length; i++) {
        var g = groups[i];
        if (!g || g.length === 0) continue;
        var fam = { family: String(g[0].familyName), styles: [] };
        for (var j = 0; j < g.length; j++) {
          fam.styles.push({ style: String(g[j].styleName), ps: String(g[j].postScriptName) });
        }
        out.push(fam);
      }
    } catch (e) {}
    return out;
  }

  function readGuideText(comp, layerName) {
    var l = findLayer(comp, layerName);
    if (!l) return null;
    var txt = l.property("ADBE Text Properties").property("ADBE Text Document").value.text;
    return String(txt).replace(/^\s+|\s+$/g, "");
  }

  function setGuideText(comp, layerName, str) {
    var l = findLayer(comp, layerName);
    if (!l) return false;
    var prop = l.property("ADBE Text Properties").property("ADBE Text Document");
    var doc = prop.value;
    doc.text = str;
    prop.setValue(doc);
    return true;
  }

  var BRAND_SWATCHES = {
    primary: "Primary",
    secondary: "Secondary",
    background: "Background",
    text: "Text Color",
    surface: "Surface"
  };

  function rgbToHex(v) {
    var out = "#";
    for (var i = 0; i < 3; i++) {
      var n = Math.round(Math.max(0, Math.min(1, v[i])) * 255);
      var s = n.toString(16).toUpperCase();
      out += (s.length < 2 ? "0" : "") + s;
    }
    return out;
  }

  // The CONTROL swatches every background/moment fill expression reads back.
  // The panel needs these to show a comp's OWN colours rather than a kit's —
  // editing a swatch you cannot see is how a brand drifts per video.
  function readBrandColors(masterName) {
    var comp = findComp(masterName);
    if (!comp) return { status: "error", error: "Comp not found: " + masterName };
    var ctrl = findLayer(comp, "CONTROL");
    if (!ctrl) return { status: "error", error: "CONTROL layer missing on " + masterName };
    var out = { status: "success", master: masterName, colors: {} };
    for (var k in BRAND_SWATCHES) {
      if (!BRAND_SWATCHES.hasOwnProperty(k)) continue;
      try {
        var v = ctrl.property("ADBE Effect Parade").property(BRAND_SWATCHES[k]).property("ADBE Color Control-0001").value;
        out.colors[k] = rgbToHex(v);
      } catch (e) { out.colors[k] = null; }
    }
    return out;
  }

  function readTypography(masterName) {
    var comp = findComp(masterName);
    if (!comp) return { status: "error", error: "Comp not found: " + masterName };
    var out = {
      status: "success",
      headingFont: readGuideText(comp, "FONT Heading"),
      bodyFont: readGuideText(comp, "FONT Body")
    };
    var ctrl = findLayer(comp, "CONTROL");
    for (var k in TYPO_SLIDERS) {
      out[k] = null;
      if (ctrl) {
        try { out[k] = ctrl.property("ADBE Effect Parade").property(TYPO_SLIDERS[k]).property("ADBE Slider Control-0001").value; } catch (e) {}
      }
    }
    return out;
  }

  // opts: any of {headingFont, bodyFont, headingSize, bodySize,
  // headingTracking, bodyTracking}. Omitted keys are left untouched.
  function applyTypography(masterName, opts) {
    var comp = findComp(masterName);
    if (!comp) return { status: "error", error: "Comp not found: " + masterName };
    if (!opts) opts = {};
    var report = { status: "success", applied: [], warnings: [] };
    app.beginUndoGroup("Apostle applyTypography");
    try {
      var fontKeys = { headingFont: "FONT Heading", bodyFont: "FONT Body" };
      for (var fk in fontKeys) {
        if (opts[fk] === undefined || opts[fk] === null) continue;
        var ps = String(opts[fk]).replace(/^\s+|\s+$/g, "");
        if (ps === "") continue;
        if (!fontAvailable(ps)) {
          report.warnings.push("Font not found by PostScript name: " + ps + ". AE will substitute silently.");
        }
        if (setGuideText(comp, fontKeys[fk], ps)) report.applied.push(fk);
        else report.warnings.push("Guide layer missing: " + fontKeys[fk]);
      }
      var ctrl = findLayer(comp, "CONTROL");
      for (var sk in TYPO_SLIDERS) {
        if (opts[sk] === undefined || opts[sk] === null) continue;
        if (!ctrl) { report.warnings.push("CONTROL layer missing; sliders not set."); break; }
        try {
          ctrl.property("ADBE Effect Parade").property(TYPO_SLIDERS[sk]).property("ADBE Slider Control-0001").setValue(Number(opts[sk]));
          report.applied.push(sk);
        } catch (e2) {
          report.warnings.push("Could not set slider " + TYPO_SLIDERS[sk] + ": " + e2.toString());
        }
      }
    } catch (e) {
      report.status = "error";
      report.error = e.toString();
    } finally {
      app.endUndoGroup();
    }
    return report;
  }

  // ---------------------------------------------------------------
  // SURGICAL EDIT OPS (schema v2)
  // Script-sync edits that touch only the beats they name. Scene comp
  // contents (where human polish lives) are never rebuilt; retime re-lays
  // the master timeline (camera keys, scene layer start times) around
  // untouched scene comps. Beats are found via the comment tag written by
  // buildBeatComp ("apostle beatId=<id> ...") — never by name or index.
  // ---------------------------------------------------------------

  function commentHasBeatId(comment, beatId) {
    var toks = String(comment || "").split(" ");
    for (var i = 0; i < toks.length; i++) {
      if (toks[i] === "beatId=" + beatId) return true;
    }
    return false;
  }

  function findBeatComp(masterName, beatId) {
    for (var i = 1; i <= app.project.numItems; i++) {
      var it = app.project.item(i);
      if (!(it instanceof CompItem)) continue;
      if (it.name.indexOf(masterName + " SC") !== 0) continue;
      if (commentHasBeatId(it.comment, beatId)) return it;
    }
    return null;
  }

  function setTextLayerString(comp, layerName, str) {
    var l = findLayer(comp, layerName);
    if (!l) return false;
    var prop = l.property("ADBE Text Properties").property("ADBE Text Document");
    var doc = prop.value;
    doc.text = str;
    prop.setValue(doc);
    return true;
  }

  // opts: {superText, url, vo}. vo alone changes no layers (timing only —
  // run retimeBeats with the updated beats JSON afterwards); it is accepted
  // here so a diff plan can be applied uniformly.
  function updateBeatText(masterName, beatId, opts) {
    var sc = findBeatComp(masterName, beatId);
    if (!sc) return { status: "error", error: "No scene comp tagged beatId=" + beatId + " under " + masterName };
    if (!opts) opts = {};
    var report = { status: "success", beatId: beatId, comp: sc.name, updated: [], warnings: [] };
    app.beginUndoGroup("Apostle updateBeatText " + beatId);
    try {
      if (opts.superText !== undefined && opts.superText !== null) {
        if (findLayer(sc, "Endcard Headline")) {
          // endcard shows the short pre-comma clause, not the spoken line
          var headText = opts.headline || endcardHeadline(opts.superText);
          if (setTextLayerString(sc, "Endcard Headline", headText)) report.updated.push("Endcard Headline");
          else report.warnings.push("Text layer not found: Endcard Headline");
        } else if (findLayer(sc, "Item 1")) {
          // listBuild scene: re-split and update heading + items in place
          var split = splitListSuper(opts.superText);
          if (split.items === null) split = { heading: opts.superText, items: [] };
          if (setTextLayerString(sc, "Super", split.heading || "")) report.updated.push("Super");
          var li = 0;
          while (findLayer(sc, "Item " + (li + 1))) {
            var itemLayer = findLayer(sc, "Item " + (li + 1));
            if (li < split.items.length) {
              setTextLayerString(sc, "Item " + (li + 1), split.items[li]);
              itemLayer.enabled = true;
              report.updated.push("Item " + (li + 1));
            } else {
              // fewer items than layers: hide the leftovers (removal would
              // shift reveal timing of siblings; hiding is reversible)
              itemLayer.enabled = false;
              report.updated.push("Item " + (li + 1) + " (hidden)");
            }
            li++;
          }
          if (split.items.length > li) {
            report.warnings.push((split.items.length - li) + " new item(s) need layers — item-count growth requires a scene rebuild for this beat (rebuildBeatScene).");
          }
        } else {
          if (setTextLayerString(sc, "Super", opts.superText)) report.updated.push("Super");
          else report.warnings.push("Text layer not found: Super");
        }
      }
      if (opts.url !== undefined && opts.url !== null) {
        if (setTextLayerString(sc, "URL", opts.url)) report.updated.push("URL");
        else report.warnings.push("Text layer not found: URL");
      }
      if (opts.vo !== undefined) report.warnings.push("vo change affects timing only — run retimeBeats with the updated beats JSON.");
    } catch (e) {
      report.status = "error";
      report.error = e.toString();
    } finally {
      app.endUndoGroup();
    }
    return report;
  }

  function removeAllKeys(prop) {
    while (prop.numKeys > 0) prop.removeKey(1);
  }

  // Recompute timing from an updated beats JSON and re-lay the master
  // timeline: camera transit keys, station markers, scene layer start
  // times and positions, comp durations. Scene comp contents untouched.
  // Expression rig only — HandyCam static rigs have no transport keys.
  function retimeBeats(masterName, beatsJSON) {
    var data = parseJSONSafe(beatsJSON);
    if (!data || !data.beats || data.beats.length === 0) return { status: "error", error: "No beats in JSON." };
    var master = findComp(masterName);
    if (!master) return { status: "error", error: "Comp not found: " + masterName };
    var rig = findLayer(master, "APOSTLE RIG");
    var cam = findLayer(master, "APOSTLE CAM");
    if (!rig || !cam) return { status: "error", error: "Expression rig not found on " + masterName + " (retime supports the expression rig only)." };
    if (!data.meta) data.meta = {};
    if (!data.meta.resolution) data.meta.resolution = [master.width, master.height];
    var report = { status: "success", warnings: [], totalDuration: 0, beats: [] };
    computeTiming(data, report);
    var beats = data.beats;
    var stations = buildStations(data.meta.layout || "corridor", beats.length, master.width, master.height);

    app.beginUndoGroup("Apostle retimeBeats");
    try {
      var newDur = report.totalDuration;
      if (newDur > master.duration) master.duration = newDur;

      removeAllKeys(rig.property("ADBE Transform Group").property("ADBE Position"));
      removeAllKeys(rig.property("ADBE Transform Group").property("ADBE Rotate Y"));
      try { removeAllKeys(cam.property("ADBE Camera Options Group").property("ADBE Camera Zoom")); } catch (eZ) {}
      try { removeAllKeys(rig.property("Marker")); } catch (eM) {}
      keyframeTransitExpression({ rig: rig, cam: cam, mode: "expression" }, stations, beats, buildProfile(data));
      var rtCtrl = findLayer(master, "CONTROL");
      if (rtCtrl) keyframeHandheld(rtCtrl, beats);

      for (var i = 0; i < beats.length; i++) {
        var b = beats[i];
        if (!b.beatId) { report.warnings.push("Beat " + (i + 1) + " has no beatId; skipped."); continue; }
        var sc = findBeatComp(masterName, b.beatId);
        if (!sc) { report.warnings.push("No scene comp for beatId=" + b.beatId + " — structural change? insert/remove ops are not built yet."); continue; }
        // EXACT, not just grow. applyMoments derives the beat's VO window as
        // (comp.duration - tailBuffer); a scene comp left oversized from an
        // earlier, longer timing makes every moment fraction map onto the old
        // window, so a retime silently does nothing to the moments inside.
        sc.duration = b._dur + 6;
        var lay = null;
        for (var L = 1; L <= master.numLayers; L++) {
          if (master.layer(L).source === sc) { lay = master.layer(L); break; }
        }
        if (!lay) { report.warnings.push("Scene comp " + sc.name + " has no layer in master."); continue; }
        lay.property("ADBE Transform Group").property("ADBE Position").setValue(stations[i].pos);
        lay.startTime = Math.max(0, b._arrive - 0.45);
        try { lay.outPoint = Math.min(newDur, lay.startTime + sc.duration); } catch (eO) {}
        report.beats.push({ index: i + 1, beatId: b.beatId, arrive: Math.round(b._arrive * 100) / 100, duration: Math.round(b._dur * 100) / 100 });
      }

      // full-duration layers (CONTROL, BG, rig) follow the new length where
      // their solid sources allow; warn when a source is too short to extend
      for (var K = 1; K <= master.numLayers; K++) {
        var ml = master.layer(K);
        if (ml.source instanceof CompItem) continue;
        try { if (ml.outPoint < newDur) ml.outPoint = newDur; } catch (eE) {
          report.warnings.push("Layer '" + ml.name + "' could not extend to " + newDur.toFixed(1) + "s (solid source length).");
        }
      }

      // Shrink the master last — growing first (above) let the layer layout
      // above write past the old length; trimming now drops the dead tail a
      // retime-to-shorter leaves behind.
      if (master.duration > newDur) master.duration = newDur;
    } catch (e) {
      report.status = "error";
      report.error = e.toString();
    } finally {
      app.endUndoGroup();
    }
    return report;
  }

  function beatIdFromComment(comment) {
    var toks = String(comment || "").split(" ");
    for (var i = 0; i < toks.length; i++) {
      if (toks[i].indexOf("beatId=") === 0) return toks[i].substring(7);
    }
    return null;
  }

  // Structural sync: make the master's scene set match the beats JSON —
  // build scenes for added beats, remove scenes for dropped beats, then
  // retime re-lays stations/camera/start times. Scene comps of surviving
  // beats are untouched (same invariant as retimeBeats).
  function applyBeatStructure(masterName, beatsJSON) {
    var data = parseJSONSafe(beatsJSON);
    if (!data || !data.beats || data.beats.length === 0) return { status: "error", error: "No beats in JSON." };
    var master = findComp(masterName);
    if (!master) return { status: "error", error: "Comp not found: " + masterName };
    var report = { status: "success", added: [], removed: [], warnings: [] };
    var tmp = { warnings: [], beats: [], totalDuration: 0 };
    if (!data.meta) data.meta = {};
    if (!data.meta.resolution) data.meta.resolution = [master.width, master.height];
    if (!data.brand) data.brand = {};
    if (!data.brand.colors) data.brand.colors = { primary: "#FFCC00", secondary: "#1E1E1E", background: "#FFFFFF", text: "#111111" };
    computeTiming(data, tmp);
    app.beginUndoGroup("Apostle applyBeatStructure");
    try {
      var wanted = {};
      var i;
      for (i = 0; i < data.beats.length; i++) {
        if (!data.beats[i].beatId) return { status: "error", error: "Beat " + (i + 1) + " has no beatId — structural sync requires v2 beats." };
        wanted[data.beats[i].beatId] = true;
      }
      // removals: master layers whose source comp is beat-tagged but no longer wanted
      var fScenes = null;
      for (var L = master.numLayers; L >= 1; L--) {
        var lay = master.layer(L);
        if (!(lay.source instanceof CompItem)) continue;
        var bid = beatIdFromComment(lay.source.comment);
        if (!bid) continue;
        if (wanted[bid]) { fScenes = lay.source.parentFolder; continue; }
        var deadComp = lay.source;
        lay.remove();
        try { deadComp.remove(); } catch (eR) { report.warnings.push("Removed layer but could not delete comp " + deadComp.name); }
        report.removed.push(bid);
      }
      // additions
      for (i = 0; i < data.beats.length; i++) {
        var b = data.beats[i];
        if (findBeatComp(masterName, b.beatId)) continue;
        var sc = buildBeatComp(app.project, data, b, i, master.frameRate, tmp, masterName);
        if (fScenes) sc.parentFolder = fScenes;
        var sl = master.layers.add(sc);
        sl.threeDLayer = true;
        sl.motionBlur = true;
        sl.label = 3;
        report.added.push(b.beatId);
      }
    } catch (e) {
      report.status = "error";
      report.error = e.toString();
      app.endUndoGroup();
      return report;
    }
    app.endUndoGroup();
    // retime re-lays every station, camera key, and start time for the new set
    var rt = retimeBeats(masterName, beatsJSON);
    if (rt.status !== "success") { report.status = "error"; report.error = "retime after structure: " + rt.error; }
    for (var wI = 0; wI < rt.warnings.length; wI++) report.warnings.push(rt.warnings[wI]);
    report.totalDuration = rt.totalDuration;
    return report;
  }

  // Nuke-and-regenerate one beat's scene comp (e.g. listBuild item count
  // grew past its layers). Human polish inside THAT scene is lost — by
  // design, and only that scene.
  function rebuildBeatScene(masterName, beatsJSON, beatId) {
    var sc = findBeatComp(masterName, beatId);
    var master = findComp(masterName);
    if (!master) return { status: "error", error: "Comp not found: " + masterName };
    app.beginUndoGroup("Apostle rebuildBeatScene " + beatId);
    try {
      if (sc) {
        for (var L = master.numLayers; L >= 1; L--) {
          if (master.layer(L).source === sc) { master.layer(L).remove(); break; }
        }
        sc.remove();
      }
    } finally {
      app.endUndoGroup();
    }
    return applyBeatStructure(masterName, beatsJSON);
  }

  // ---------------------------------------------------------------
  // MOVIE RENDER (Phase 8)
  // In-app render-queue render of a comp to a movie file — works on the
  // open (possibly unsaved) project, unlike aerender which needs an .aep
  // on disk (scripts/aerender-master.sh covers that path). Blocks AE for
  // the duration. Other queued RQ items are disabled during the render
  // and restored after; our item is removed on completion.
  // ---------------------------------------------------------------

  function renderMovie(compName, outPath, templateName) {
    var comp = findComp(compName);
    if (!comp) return { status: "error", error: "Comp not found: " + compName };
    var rq = app.project.renderQueue;
    var report = { status: "success", comp: compName, out: outPath, template: null, seconds: 0, warnings: [] };
    var disabled = [];
    var i;
    for (i = 1; i <= rq.numItems; i++) {
      try {
        if (rq.item(i).status === RQItemStatus.QUEUED && rq.item(i).render) {
          rq.item(i).render = false;
          disabled.push(i);
        }
      } catch (eD) {}
    }
    var rqi = null;
    try {
      rqi = rq.items.add(comp);
      var om = rqi.outputModule(1);
      var tpls = templateName ? [templateName] : ["H.264 - Match Render Settings - 40 Mbps", "H.264 - Match Render Settings - 15 Mbps", "H.264 - Match Render Settings -  5 Mbps", "High Quality", "Lossless"];
      for (i = 0; i < tpls.length; i++) {
        try { om.applyTemplate(tpls[i]); report.template = tpls[i]; break; } catch (eT) {}
      }
      if (!report.template) report.warnings.push("No output template matched; using module defaults.");
      om.file = new File(outPath);
      var t0 = new Date().getTime();
      rq.render();
      report.seconds = Math.round((new Date().getTime() - t0) / 100) / 10;
      if (rqi.status !== RQItemStatus.DONE) {
        report.status = "error";
        report.error = "Render did not complete (status " + rqi.status + ")";
      }
      report.out = om.file.fsName;
    } catch (e) {
      report.status = "error";
      report.error = e.toString();
    } finally {
      try { if (rqi) rqi.remove(); } catch (eR) {}
      for (i = 0; i < disabled.length; i++) {
        try { rq.item(disabled[i]).render = true; } catch (eE) {}
      }
    }
    return report;
  }

  // djb2 over a comp's serialized state — cheap fingerprint for the
  // "untouched beats stay byte-identical" invariant checks
  function hashCompState(compName) {
    var s = serializeCompState(compName);
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h * 33) + s.charCodeAt(i)) & 0xffffffff;
    return { comp: compName, length: s.length, hash: (h >>> 0).toString(16) };
  }

  // ---------------------------------------------------------------
  // 6. REDESIGN MODULE — analysis, capture, native reconstruction
  // ---------------------------------------------------------------
  // Three-module pipeline (see docs): AE owns analysis (extractDesignSpec,
  // captureCompReference) and reconstruction (applyRebuildPlan on a
  // DUPLICATE, never the original). Concept generation lives in Node
  // (scripts/redesign.cjs) and never touches AE.

  function listComps(filter) {
    try {
      var out = [];
      var f = filter ? String(filter).toLowerCase() : null;
      for (var i = 1; i <= app.project.numItems && out.length < 250; i++) {
        var it = app.project.item(i);
        if (!(it instanceof CompItem)) continue;
        if (f && it.name.toLowerCase().indexOf(f) === -1) continue;
        var folderName = "";
        try { if (it.parentFolder && it.parentFolder.name !== "Root") folderName = it.parentFolder.name; } catch (e0) {}
        out.push({ name: it.name, w: it.width, h: it.height, dur: Math.round(it.duration * 100) / 100, folder: folderName });
      }
      return toJSON({ status: "success", comps: out });
    } catch (e) { return errJSON("listComps", e); }
  }

  // Per-project identity token stamped into the project's XMP metadata.
  // Unsaved projects all report file=null and the same display name, so
  // without this token two different untitled projects are indistinguishable
  // and panel state leaks between them. The token survives save, so the
  // panel can also recognize "same project, now file-backed" and migrate
  // its memory instead of clearing it. create=false only reads (a clean
  // saved project must not be dirtied by a metadata write).
  function projectPidToken(create) {
    try {
      var xp = String(app.project.xmpPacket || "");
      var m = xp.match(/apostle:pid="([^"]+)"/);
      if (m) return m[1];
      if (!create) return null;
      var pid = "p" + new Date().getTime().toString(36) + Math.floor(Math.random() * 1679616).toString(36);
      var marker = "<rdf:Description ";
      if (xp.indexOf(marker) === -1) return null;
      var nxp = xp.replace(marker, marker + 'xmlns:apostle="https://apostle.io/ns/1.0/" apostle:pid="' + pid + '" ');
      app.project.xmpPacket = nxp;
      var chk = String(app.project.xmpPacket || "");
      if (chk.indexOf('apostle:pid="' + pid + '"') === -1) return null;
      return pid;
    } catch (e) { return null; }
  }

  // Identity of the open project, so panel and CLI can detect project
  // switches and stamp artifacts. file is null for unsaved projects.
  function getProjectInfo() {
    try {
      var f = null;
      try { f = app.project.file; } catch (e0) {}
      var info = {
        status: "success",
        file: f ? f.fsName : null,
        name: f ? decodeURI(String(f.name)) : "Untitled Project",
        dirty: false,
        numItems: app.project.numItems,
        pid: projectPidToken(!f)
      };
      try { info.dirty = (app.project.dirty === true); } catch (e1) {}
      return toJSON(info);
    } catch (e) { return errJSON("getProjectInfo", e); }
  }

  function layerCompBounds(layer, t) {
    // comp-space bounds for the common case (2D, unparented or static
    // parent, rotation reported separately). Good enough for a design spec.
    var r = layer.sourceRectAtTime(t, false);
    var tr = layer.property("ADBE Transform Group");
    var pos = tr.property("ADBE Position").valueAtTime(t, false);
    var anc = tr.property("ADBE Anchor Point").valueAtTime(t, false);
    var scl = tr.property("ADBE Scale").valueAtTime(t, false);
    var sx = scl[0] / 100, sy = scl[1] / 100;
    return {
      x: Math.round(pos[0] + (r.left - anc[0]) * sx),
      y: Math.round(pos[1] + (r.top - anc[1]) * sy),
      w: Math.round(r.width * sx),
      h: Math.round(r.height * sy)
    };
  }

  function col01(c) {
    if (!c || c.length < 3) return null;
    return [Math.round(c[0] * 1000) / 1000, Math.round(c[1] * 1000) / 1000, Math.round(c[2] * 1000) / 1000];
  }

  function firstShapeFill(layer) {
    // walk one level of vector groups for the first fill color
    try {
      var root = layer.property("ADBE Root Vectors Group");
      for (var i = 1; i <= root.numProperties; i++) {
        var g = root.property(i);
        var contents = g.property("ADBE Vectors Group");
        if (!contents) continue;
        for (var j = 1; j <= contents.numProperties; j++) {
          var p = contents.property(j);
          if (p.matchName === "ADBE Vector Graphic - Fill") {
            return col01(p.property("ADBE Vector Fill Color").value);
          }
        }
      }
    } catch (e) {}
    return null;
  }

  function extractDesignSpec(compName, timeSec) {
    try {
      var comp = findComp(compName);
      if (!comp) return toJSON({ status: "error", error: "Comp not found: " + compName });
      var t;
      if (timeSec !== undefined && timeSec !== null && timeSec >= 0) { t = timeSec; }
      else { t = comp.duration * 0.6; }
      if (t > comp.duration) t = comp.duration / 2;
      var spec = {
        comp: comp.name,
        width: comp.width, height: comp.height,
        duration: Math.round(comp.duration * 100) / 100,
        fps: Math.round(comp.frameRate * 100) / 100,
        bgColor: col01(comp.bgColor),
        sampledAt: Math.round(t * 100) / 100,
        layers: []
      };
      for (var i = 1; i <= comp.numLayers; i++) {
        var layer = comp.layer(i);
        var L = { index: i, name: layer.name };
        if (layer instanceof CameraLayer) { L.type = "camera"; spec.layers.push(L); continue; }
        if (layer instanceof LightLayer) { L.type = "light"; spec.layers.push(L); continue; }
        if (layer instanceof TextLayer) { L.type = "text"; }
        else if (layer instanceof ShapeLayer) { L.type = "shape"; }
        else if (layer.nullLayer) { L.type = "null"; }
        else if (layer.source instanceof CompItem) { L.type = "precomp"; L.sourceComp = layer.source.name; }
        else if (layer.source && layer.source.mainSource instanceof SolidSource) { L.type = "solid"; }
        else { L.type = "footage"; }
        try { if (!layer.enabled) L.disabled = true; } catch (e1) {}
        try { if (layer.threeDLayer) L.threeD = true; } catch (e2) {}
        try { if (layer.parent) L.parent = layer.parent.name; } catch (e3) {}
        try { L.bounds = layerCompBounds(layer, t); } catch (e4) {}
        var tr = layer.property("ADBE Transform Group");
        try { L.position = tr.property("ADBE Position").valueAtTime(t, false); } catch (e5) {}
        try {
          var scv = tr.property("ADBE Scale").valueAtTime(t, false);
          if (Math.round(scv[0]) !== 100 || Math.round(scv[1]) !== 100) L.scale = [Math.round(scv[0] * 10) / 10, Math.round(scv[1] * 10) / 10];
        } catch (e5b) {}
        try { L.opacity = Math.round(tr.property("ADBE Opacity").valueAtTime(t, false)); } catch (e6) {}
        try {
          var rot = tr.property("ADBE Rotate Z").valueAtTime(t, false);
          if (rot !== 0) L.rotation = Math.round(rot * 100) / 100;
        } catch (e7) {}
        try {
          var pk = tr.property("ADBE Position").numKeys;
          var ok = tr.property("ADBE Opacity").numKeys;
          if (pk > 0 || ok > 0) L.animated = true;
        } catch (e8) {}
        if (L.type === "text") {
          try {
            var doc = layer.property("ADBE Text Properties").property("ADBE Text Document").value;
            L.text = doc.text;
            L.font = doc.font;
            L.fontSize = Math.round(doc.fontSize * 10) / 10;
            try { if (doc.applyFill) L.fillColor = col01(doc.fillColor); } catch (tf) {}
            try { L.tracking = doc.tracking; } catch (tt) {}
            try {
              var j = doc.justification;
              if (j === ParagraphJustification.LEFT_JUSTIFY) L.justification = "left";
              else if (j === ParagraphJustification.CENTER_JUSTIFY) L.justification = "center";
              else if (j === ParagraphJustification.RIGHT_JUSTIFY) L.justification = "right";
            } catch (tj) {}
          } catch (e9) { L.textError = e9.toString(); }
        } else if (L.type === "solid") {
          try { L.color = col01(layer.source.mainSource.color); } catch (e10) {}
        } else if (L.type === "shape") {
          var sf = firstShapeFill(layer);
          if (sf) L.fill = sf;
        }
        spec.layers.push(L);
      }
      return toJSON({ status: "success", spec: spec });
    } catch (e) { return errJSON("extractDesignSpec", e); }
  }

  function captureCompReference(compName, timeSec, outPath) {
    try {
      var comp = findComp(compName);
      if (!comp) return toJSON({ status: "error", error: "Comp not found: " + compName });
      var t;
      if (timeSec !== undefined && timeSec !== null && timeSec >= 0) { t = timeSec; }
      else { t = comp.duration * 0.6; }
      if (t > comp.duration) t = comp.duration / 2;
      var got = renderFramePNG(comp, t, outPath);
      var via = "saveFrameToPng";
      if (!got) { got = renderFrameViaRQ(comp, t, outPath); via = "renderQueue"; }
      if (!got) return toJSON({ status: "error", error: "Both frame render paths failed for " + compName });
      return toJSON({ status: "success", path: got, time: Math.round(t * 100) / 100, via: via, w: comp.width, h: comp.height });
    } catch (e) { return errJSON("captureCompReference", e); }
  }

  function duplicateForRedesign(compName) {
    try {
      var comp = findComp(compName);
      if (!comp) return toJSON({ status: "error", error: "Comp not found: " + compName });
      app.beginUndoGroup("Apostle duplicateForRedesign");
      var n = 1;
      var base = comp.name + " REDESIGN v";
      while (findComp(base + n) && n < 99) n++;
      var dup = comp.duplicate();
      dup.name = base + n;
      app.endUndoGroup();
      return toJSON({ status: "success", comp: dup.name, from: comp.name });
    } catch (e) { app.endUndoGroup(); return errJSON("duplicateForRedesign", e); }
  }

  // ---- applyRebuildPlan helpers ----

  function planJustification(s) {
    if (s === "left") return ParagraphJustification.LEFT_JUSTIFY;
    if (s === "right") return ParagraphJustification.RIGHT_JUSTIFY;
    return ParagraphJustification.CENTER_JUSTIFY;
  }

  function bakeLayerExpressions(layer, sampleT, r) {
    // Master-link expressions (style reads FONT layers; fit-width autoscale
    // reads CONTROL + sourceRectAtTime) make redesigned layers render
    // unpredictably once the plan changes text metrics — verified: autoscale
    // shrank a 96px heading to 27% and blanked frames entirely. Bake the
    // evaluated value and drop the expression on any layer a plan touches.
    var tg = layer.property("ADBE Transform Group");
    var mns = ["ADBE Anchor Point", "ADBE Position", "ADBE Scale", "ADBE Rotate Z", "ADBE Opacity"];
    var baked = [];
    for (var i = 0; i < mns.length; i++) {
      var p = null;
      try { p = tg.property(mns[i]); } catch (e0) {}
      if (!p) continue;
      try {
        if (p.expressionEnabled) {
          var v = p.valueAtTime(sampleT, false);
          p.expression = "";
          if (p.numKeys === 0) p.setValue(v);
          baked.push(p.name);
        }
      } catch (e1) {}
    }
    if (baked.length && r) {
      var msg = "transform expressions baked: " + baked.join(", ");
      if (r.warn) { r.warn += "; " + msg; } else { r.warn = msg; }
    }
  }

  function mutateTextDoc(layer, fn, r) {
    // AE 26 intermittently returns a garbage TextDocument on a fresh
    // layer's first .value read — refetch and retry once (same trap as
    // makeText).
    var prop = layer.property("ADBE Text Properties").property("ADBE Text Document");
    // Master-linked layers carry a style expression that overrides any
    // static TextDocument write (verified: setValue(fontSize) silently
    // no-ops under it). Bake the evaluated style, drop the expression,
    // then mutate — a redesigned comp is meant to diverge from master.
    try {
      if (prop.expressionEnabled) {
        var evald = prop.value; // evaluated through the expression
        prop.expression = "";
        prop.setValue(evald);
        if (r) {
          if (r.warn) { r.warn += "; style expression baked + removed"; }
          else { r.warn = "master style expression baked + removed"; }
        }
        prop = layer.property("ADBE Text Properties").property("ADBE Text Document");
      }
    } catch (be) {}
    var attempt, doc;
    for (attempt = 0; attempt < 2; attempt++) {
      try {
        doc = prop.value;
        fn(doc);
        prop.setValue(doc);
        return null;
      } catch (e) {
        prop = layer.property("ADBE Text Properties").property("ADBE Text Document");
        if (attempt === 1) return e.toString();
      }
    }
    return "unreachable";
  }

  function shiftPropKeys(prop, delta, isArray) {
    // preserve entrance/exit animation: move every key by the same delta
    for (var k = 1; k <= prop.numKeys; k++) {
      var v = prop.keyValue(k);
      if (isArray) {
        var nv = [];
        for (var d = 0; d < v.length; d++) nv.push(v[d] + (delta[d] !== undefined ? delta[d] : 0));
        prop.setValueAtKey(k, nv);
      } else {
        prop.setValueAtKey(k, v + delta);
      }
    }
  }

  function setOrShift(prop, target, sampleT) {
    // unkeyed -> setValue; keyed -> delta-shift all keys so the settled
    // value lands on target and the animation survives.
    if (prop.numKeys === 0) { prop.setValue(target); return; }
    var cur = prop.valueAtTime(sampleT, false);
    if (cur instanceof Array) {
      var delta = [];
      for (var d = 0; d < cur.length; d++) delta.push((target[d] !== undefined ? target[d] : cur[d]) - cur[d]);
      shiftPropKeys(prop, delta, true);
    } else {
      shiftPropKeys(prop, target - cur, false);
    }
  }

  function placeCreated(layer, opSpec, comp) {
    layer.startTime = 0; // trap #2: pin — AE creates layers at the playhead
    if (opSpec.below) {
      var b = findLayer(comp, opSpec.below);
      if (b) layer.moveAfter(b);
    } else if (opSpec.above) {
      var a = findLayer(comp, opSpec.above);
      if (a) layer.moveBefore(a);
    }
  }

  function opCreateShape(comp, o) {
    var layer = comp.layers.addShape();
    layer.name = o.name || "Shape";
    var group = layer.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
    var contents = group.property("ADBE Vectors Group");
    var bx = o.bounds[0], by = o.bounds[1], bw = o.bounds[2], bh = o.bounds[3];
    var shapeMn;
    if (o.shape === "ellipse") { shapeMn = "ADBE Vector Shape - Ellipse"; } else { shapeMn = "ADBE Vector Shape - Rect"; }
    var sh = contents.addProperty(shapeMn);
    sh.property(o.shape === "ellipse" ? "ADBE Vector Ellipse Size" : "ADBE Vector Rect Size").setValue([bw, bh]);
    if (o.shape !== "ellipse" && o.roundness) {
      sh.property("ADBE Vector Rect Roundness").setValue(o.roundness);
    }
    if (o.fill) {
      var fill = contents.addProperty("ADBE Vector Graphic - Fill");
      fill.property("ADBE Vector Fill Color").setValue(o.fill);
      if (o.fillOpacity !== undefined) fill.property("ADBE Vector Fill Opacity").setValue(o.fillOpacity);
    }
    if (o.stroke && o.strokeWidth) {
      var st = contents.addProperty("ADBE Vector Graphic - Stroke");
      st.property("ADBE Vector Stroke Color").setValue(o.stroke);
      st.property("ADBE Vector Stroke Width").setValue(o.strokeWidth);
    }
    // shape layer anchor is [0,0] at its position; put position at bounds center
    layer.property("ADBE Transform Group").property("ADBE Position").setValue([bx + bw / 2, by + bh / 2]);
    placeCreated(layer, o, comp);
    return layer;
  }

  function opCreateText(comp, o) {
    var layer = comp.layers.addText(o.text || "");
    if (o.name) layer.name = o.name;
    var err = mutateTextDoc(layer, function (doc) {
      if (o.postScriptName) doc.font = o.postScriptName;
      if (o.size) doc.fontSize = o.size;
      if (o.fill || o.color) { doc.applyFill = true; doc.fillColor = (o.fill || o.color); }
      if (o.tracking !== undefined) doc.tracking = o.tracking;
      if (o.justification) doc.justification = planJustification(o.justification);
      if (o.leading) { doc.autoLeading = false; doc.leading = o.leading; }
    });
    if (o.position) layer.property("ADBE Transform Group").property("ADBE Position").setValue(o.position);
    placeCreated(layer, o, comp);
    return err;
  }

  function applyRebuildPlan(compName, plan) {
    try {
      if (typeof plan === "string") plan = eval("(" + plan + ")");
      var comp = findComp(compName);
      if (!comp) return toJSON({ status: "error", error: "Comp not found: " + compName });
      var sampleT = comp.duration * 0.6;
      if (sampleT > comp.duration) sampleT = comp.duration / 2;
      var results = [];
      var applied = 0, failed = 0;
      app.beginUndoGroup("Apostle applyRebuildPlan");
      try {
        if (plan.background && plan.background.color) {
          try { comp.bgColor = plan.background.color; } catch (bg) {}
        }
        var ops = plan.ops || [];
        for (var i = 0; i < ops.length; i++) {
          var o = ops[i];
          var r = { i: i, op: o.op, layer: o.layer || o.name || "" };
          try {
            var layer = null;
            if (o.op !== "createText" && o.op !== "createShape" && o.op !== "createSolid") {
              layer = findLayer(comp, o.layer);
              if (!layer) throw new Error("layer not found: " + o.layer);
            }
            if (o.op === "setText" || o.op === "setFont" || o.op === "setFill" || o.op === "setTransform") {
              bakeLayerExpressions(layer, sampleT, r);
            }
            if (o.op === "setText") {
              var e1 = mutateTextDoc(layer, function (doc) { doc.text = o.text; }, r);
              if (e1) throw new Error(e1);
            } else if (o.op === "setFont") {
              var e2 = mutateTextDoc(layer, function (doc) {
                if (o.postScriptName) doc.font = o.postScriptName;
                if (o.size) doc.fontSize = o.size;
                if (o.tracking !== undefined) doc.tracking = o.tracking;
                if (o.leading) { doc.autoLeading = false; doc.leading = o.leading; }
                if (o.justification) doc.justification = planJustification(o.justification);
              }, r);
              if (e2) throw new Error(e2);
            } else if (o.op === "setFill") {
              var e3 = mutateTextDoc(layer, function (doc) { doc.applyFill = true; doc.fillColor = o.color; }, r);
              if (e3) throw new Error(e3);
            } else if (o.op === "setTransform") {
              var tr = layer.property("ADBE Transform Group");
              if (o.anchor) tr.property("ADBE Anchor Point").setValue(o.anchor);
              if (o.bounds) {
                // place by top-left comp-px bounds — the interpreter does
                // the anchor/justification math the LLM would get wrong
                var rb = layer.sourceRectAtTime(sampleT, false);
                var bScl = tr.property("ADBE Scale").valueAtTime(sampleT, false);
                var bAnc = tr.property("ADBE Anchor Point").valueAtTime(sampleT, false);
                var bpx = o.bounds[0] + (bAnc[0] - rb.left) * bScl[0] / 100;
                var bpy = o.bounds[1] + (bAnc[1] - rb.top) * bScl[1] / 100;
                setOrShift(tr.property("ADBE Position"), [bpx, bpy], sampleT);
              }
              if (o.position) setOrShift(tr.property("ADBE Position"), o.position, sampleT);
              if (o.scale) {
                var sp = tr.property("ADBE Scale");
                var full = o.scale.length === 2 ? [o.scale[0], o.scale[1], 100] : o.scale;
                if (sp.numKeys === 0) { sp.setValue(full); }
                else {
                  var curS = sp.valueAtTime(sampleT, false);
                  var ratio = [];
                  for (var d = 0; d < curS.length; d++) {
                    if (curS[d] !== 0 && full[d] !== undefined) { ratio.push(full[d] / curS[d]); } else { ratio.push(1); }
                  }
                  for (var k = 1; k <= sp.numKeys; k++) {
                    var kv = sp.keyValue(k);
                    var nv = [];
                    for (var d2 = 0; d2 < kv.length; d2++) nv.push(kv[d2] * ratio[d2]);
                    sp.setValueAtKey(k, nv);
                  }
                }
              }
              if (o.rotation !== undefined) setOrShift(tr.property("ADBE Rotate Z"), o.rotation, sampleT);
              if (o.opacity !== undefined) {
                var op2 = tr.property("ADBE Opacity");
                if (op2.numKeys === 0) { op2.setValue(o.opacity); }
                else { op2.setValueAtKey(op2.numKeys, o.opacity); }
              }
            } else if (o.op === "createText") {
              var e4 = opCreateText(comp, o);
              if (e4) r.warn = "text doc styling failed: " + e4;
            } else if (o.op === "createShape") {
              opCreateShape(comp, o);
            } else if (o.op === "createSolid") {
              var bw2 = Math.round(o.bounds[2]), bh2 = Math.round(o.bounds[3]);
              var sl = comp.layers.addSolid(o.color || o.fill, o.name || "Solid", bw2, bh2, 1);
              sl.property("ADBE Transform Group").property("ADBE Position").setValue([o.bounds[0] + bw2 / 2, o.bounds[1] + bh2 / 2]);
              placeCreated(sl, o, comp);
            } else if (o.op === "reorder") {
              if (o.below) {
                var lb = findLayer(comp, o.below);
                if (!lb) throw new Error("below target not found: " + o.below);
                layer.moveAfter(lb);
              } else if (o.above) {
                var la = findLayer(comp, o.above);
                if (!la) throw new Error("above target not found: " + o.above);
                layer.moveBefore(la);
              }
            } else if (o.op === "deleteLayer") {
              layer.remove();
            } else if (o.op === "applyEffect") {
              layer.property("ADBE Effect Parade").addProperty(o.effectMatchName);
            } else if (o.op === "setEffectProperty") {
              var fx = layer.property("ADBE Effect Parade").property(o.effectMatchName);
              if (!fx) throw new Error("effect not found: " + o.effectMatchName);
              fx.property(o.property).setValue(o.value);
            } else {
              throw new Error("unknown op: " + o.op);
            }
            r.status = "ok";
            applied++;
          } catch (oe) {
            r.status = "error";
            r.error = oe.toString();
            failed++;
          }
          results.push(r);
        }
      } finally {
        app.endUndoGroup();
      }
      var status;
      if (failed === 0) { status = "success"; } else if (applied > 0) { status = "partial"; } else { status = "error"; }
      return toJSON({ status: status, comp: comp.name, applied: applied, failed: failed, ops: results });
    } catch (e) { return errJSON("applyRebuildPlan", e); }
  }

  // ---------------------------------------------------------------
  // MOMENTS — timed supers + native vector illustration inside a
  // scene comp. A scene precomp holds ONE beat of VO, which is often
  // several ideas long; a moment is one idea: a super line, an
  // optional sub, and an illustration, alive for its slice of the
  // beat. Fully data-driven (see apostle/moments-schema.json) so the
  // copy and the art live in a reviewable JSON, not in code.
  //
  // Illustration is native AE shape art only — no external assets, so
  // everything stays editable, recolourable off the brand kit, and
  // survives a retime (re-run applyMoments after retimeBeats).
  // ---------------------------------------------------------------

  var MOM_TAG = "apostle moment";

  // Glyph vocabulary. Each glyph is a list of primitives drawn in a
  // 100x100 box, origin top-left, y down, in PAINTER'S ORDER (first
  // entry is furthest back). momAddPrims reverses on the way into AE,
  // where contents index 1 is frontmost.
  //   t: "rect" | "ellipse" | "path"
  //   f: fill role, s: stroke role, sw: stroke width, r: rect roundness
  // Roles resolve through the palette: ink / brand / paper / hole
  // ("hole" = whatever the glyph sits on, so knock-outs read cleanly
  // on a yellow tile and on the white background alike).
  var MOM_GLYPHS = {
    star: [
      { t: "path", f: "ink", pts: [[50, 4], [62, 37], [96, 38], [69, 59], [79, 93], [50, 73], [21, 93], [31, 59], [4, 38], [38, 37]] }
    ],
    sparkle: [
      { t: "path", f: "ink", pts: [[50, 2], [59, 41], [98, 50], [59, 59], [50, 98], [41, 59], [2, 50], [41, 41]] }
    ],
    card: [
      { t: "rect", x: 6, y: 24, w: 88, h: 56, r: 8, s: "ink", sw: 7 },
      { t: "rect", x: 6, y: 38, w: 88, h: 13, f: "ink" },
      { t: "rect", x: 16, y: 61, w: 26, h: 7, r: 3, f: "ink" }
    ],
    doc: [
      { t: "rect", x: 22, y: 6, w: 56, h: 88, r: 7, s: "ink", sw: 7 },
      { t: "rect", x: 34, y: 26, w: 32, h: 7, r: 3, f: "ink" },
      { t: "rect", x: 34, y: 44, w: 32, h: 7, r: 3, f: "ink" },
      { t: "rect", x: 34, y: 62, w: 20, h: 7, r: 3, f: "ink" }
    ],
    renew: [
      { t: "ellipse", x: 13, y: 15, w: 74, h: 74, s: "ink", sw: 9 },
      { t: "rect", x: 48, y: 0, w: 54, h: 30, f: "hole" },
      { t: "path", f: "ink", pts: [[46, 2], [76, 18], [46, 34]] }
    ],
    home: [
      { t: "path", s: "ink", sw: 8, closed: true, pts: [[50, 8], [93, 44], [81, 44], [81, 90], [19, 90], [19, 44], [7, 44]] }
    ],
    shield: [
      { t: "path", s: "ink", sw: 8, closed: true, pts: [[50, 5], [89, 20], [89, 52], [50, 95], [11, 52], [11, 20]] }
    ],
    bank: [
      { t: "path", f: "ink", pts: [[4, 36], [50, 9], [96, 36]] },
      { t: "rect", x: 16, y: 43, w: 13, h: 37, f: "ink" },
      { t: "rect", x: 43, y: 43, w: 13, h: 37, f: "ink" },
      { t: "rect", x: 70, y: 43, w: 13, h: 37, f: "ink" },
      { t: "rect", x: 6, y: 84, w: 88, h: 10, r: 4, f: "ink" }
    ],
    cart: [
      { t: "path", s: "ink", sw: 8, closed: false, pts: [[8, 14], [24, 14], [37, 62], [83, 62], [93, 28], [30, 28]] },
      { t: "ellipse", x: 34, y: 72, w: 17, h: 17, f: "ink" },
      { t: "ellipse", x: 68, y: 72, w: 17, h: 17, f: "ink" }
    ],
    basket: [
      { t: "path", s: "ink", sw: 8, closed: true, pts: [[13, 36], [87, 36], [77, 90], [23, 90]] },
      { t: "path", s: "ink", sw: 8, closed: false, pts: [[33, 36], [42, 12]] },
      { t: "path", s: "ink", sw: 8, closed: false, pts: [[67, 36], [58, 12]] }
    ],
    plane: [
      { t: "path", f: "ink", pts: [[6, 44], [96, 8], [58, 95], [46, 62]] },
      { t: "path", s: "hole", sw: 5, closed: false, pts: [[46, 62], [96, 8]] }
    ],
    gift: [
      { t: "ellipse", x: 24, y: 12, w: 27, h: 22, s: "ink", sw: 6 },
      { t: "ellipse", x: 49, y: 12, w: 27, h: 22, s: "ink", sw: 6 },
      { t: "rect", x: 8, y: 34, w: 84, h: 58, r: 5, s: "ink", sw: 7 },
      { t: "rect", x: 8, y: 34, w: 84, h: 16, f: "ink" },
      { t: "rect", x: 44, y: 34, w: 12, h: 58, f: "ink" }
    ],
    tag: [
      { t: "path", s: "ink", sw: 7, closed: true, pts: [[8, 8], [54, 8], [93, 47], [47, 93], [8, 54]] },
      { t: "ellipse", x: 20, y: 20, w: 19, h: 19, f: "ink" }
    ],
    percent: [
      { t: "path", s: "ink", sw: 8, closed: false, pts: [[14, 86], [86, 14]] },
      { t: "ellipse", x: 10, y: 10, w: 28, h: 28, s: "ink", sw: 8 },
      { t: "ellipse", x: 62, y: 62, w: 28, h: 28, s: "ink", sw: 8 }
    ],
    ticket: [
      { t: "rect", x: 6, y: 24, w: 88, h: 52, r: 7, s: "ink", sw: 7 },
      { t: "rect", x: 60, y: 30, w: 6, h: 10, r: 3, f: "ink" },
      { t: "rect", x: 60, y: 45, w: 6, h: 10, r: 3, f: "ink" },
      { t: "rect", x: 60, y: 60, w: 6, h: 10, r: 3, f: "ink" }
    ],
    phone: [
      { t: "rect", x: 27, y: 4, w: 46, h: 92, r: 9, s: "ink", sw: 7 },
      { t: "rect", x: 42, y: 10, w: 16, h: 4, r: 2, f: "ink" },
      { t: "rect", x: 35, y: 22, w: 30, h: 8, r: 4, f: "ink" },
      { t: "rect", x: 35, y: 36, w: 30, h: 8, r: 4, f: "ink" },
      { t: "rect", x: 35, y: 50, w: 30, h: 8, r: 4, f: "ink" }
    ],
    coin: [
      { t: "ellipse", x: 4, y: 4, w: 92, h: 92, f: "ink" },
      { t: "ellipse", x: 15, y: 15, w: 70, h: 70, f: "hole" },
      { t: "path", f: "ink", pts: [[50, 24], [58, 44], [79, 45], [62, 58], [68, 78], [50, 66], [32, 78], [38, 58], [21, 45], [42, 44]] }
    ],
    receipt: [
      { t: "rect", x: 20, y: 5, w: 60, h: 90, r: 5, s: "ink", sw: 7 },
      { t: "rect", x: 32, y: 24, w: 36, h: 6, r: 3, f: "ink" },
      { t: "rect", x: 32, y: 41, w: 36, h: 6, r: 3, f: "ink" },
      { t: "rect", x: 32, y: 58, w: 22, h: 6, r: 3, f: "ink" }
    ],
    arrowRight: [
      { t: "path", f: "ink", pts: [[4, 40], [60, 40], [60, 16], [96, 50], [60, 84], [60, 60], [4, 60]] }
    ],
    transfer: [
      { t: "path", f: "ink", pts: [[4, 28], [66, 28], [66, 10], [96, 34], [66, 58], [66, 40], [4, 40]] },
      { t: "path", f: "ink", pts: [[96, 62], [34, 62], [34, 44], [4, 68], [34, 92], [34, 74], [96, 74]] }
    ],
    check: [
      { t: "path", s: "ink", sw: 12, closed: false, pts: [[10, 52], [38, 80], [90, 20]] }
    ],
    cross: [
      { t: "path", s: "ink", sw: 11, closed: false, pts: [[20, 20], [80, 80]] },
      { t: "path", s: "ink", sw: 11, closed: false, pts: [[80, 20], [20, 80]] }
    ],
    // ICAO ePassport chip mark, as printed on the cover: a rectangle, a
    // circle at its centre, and a mid-height line broken by the circle.
    // Added 2026-10-12 for an onboarding video, where recognising this
    // symbol decides the viewer's path.
    epassport: [
      { t: "rect", x: 8, y: 26, w: 84, h: 48, r: 6, s: "ink", sw: 6 },
      { t: "ellipse", x: 37, y: 37, w: 26, h: 26, s: "ink", sw: 6 },
      { t: "path", s: "ink", sw: 6, closed: false, pts: [[8, 50], [37, 50]] },
      { t: "path", s: "ink", sw: 6, closed: false, pts: [[63, 50], [92, 50]] }
    ],
    lock: [
      { t: "path", s: "ink", sw: 8, closed: false, pts: [[31, 47], [31, 31], [38, 19], [50, 15], [62, 19], [69, 31], [69, 47]] },
      { t: "rect", x: 20, y: 45, w: 60, h: 44, r: 8, f: "ink" },
      { t: "ellipse", x: 45, y: 58, w: 10, h: 10, f: "hole" },
      { t: "rect", x: 48, y: 65, w: 4, h: 12, f: "hole" }
    ],
    mail: [
      { t: "rect", x: 8, y: 22, w: 84, h: 56, r: 6, s: "ink", sw: 7 },
      { t: "path", s: "ink", sw: 7, closed: false, pts: [[10, 26], [50, 54], [90, 26]] }
    ],
    hub: [
      { t: "ellipse", x: 34, y: 34, w: 32, h: 32, f: "ink" },
      { t: "ellipse", x: 40, y: 2, w: 20, h: 20, s: "ink", sw: 6 },
      { t: "ellipse", x: 40, y: 78, w: 20, h: 20, s: "ink", sw: 6 },
      { t: "ellipse", x: 2, y: 40, w: 20, h: 20, s: "ink", sw: 6 },
      { t: "ellipse", x: 78, y: 40, w: 20, h: 20, s: "ink", sw: 6 }
    ]
  };

  function momPalette(spec) {
    var p = {
      ink: hexToRGB((spec && spec.ink) || "#1E1E1E"),
      brand: hexToRGB((spec && spec.brand) || "#FFCC00"),
      paper: hexToRGB((spec && spec.paper) || "#FFFFFF"),
      hole: hexToRGB((spec && spec.hole) || "#FFFFFF"),
      muted: hexToRGB((spec && spec.muted) || "#D6D6D6")
    };
    p.tileShape = (spec && spec.tileShape) || "rect";
    p.tileFill = (spec && spec.tileFill) || "brand";
    // Plates that sit DIRECTLY on the backdrop (chips, the compare "to" box).
    // On a white backdrop these are brand yellow; on a yellow backdrop that is
    // yellow-on-yellow and they disappear, so the skin flips them to paper.
    // Device screen rows are NOT included — those sit inside a white phone
    // body, where brand yellow still reads.
    p.plateFill = (spec && spec.plateFill) || "brand";
    p.plateStroke = (spec && spec.plateStroke) || null;
    return p;
  }

  function momColor(role, pal) {
    var c;
    if (role === "brand") { c = pal.brand; }
    else if (role === "paper") { c = pal.paper; }
    else if (role === "hole") { c = pal.hole; }
    else if (role === "muted") { c = pal.muted; }
    else { c = pal.ink; }
    return [c[0], c[1], c[2], 1];
  }

  // brand / background fills track the CONTROL nulls so a brand-kit
  // change still repaints the illustration (same contract as accentBar)
  function momLinkFill(prop, role, masterName) {
    if (!masterName) return;
    var eff = null;
    if (role === "brand") { eff = "Primary"; }
    else if (role === "hole" || role === "paper") { eff = "Surface"; }
    if (!eff) return;
    try {
      prop.expression = 'comp("' + masterName + '").layer("CONTROL").effect("' + eff + '")("Color")';
    } catch (e) {}
  }

  // remap lets a batch re-point a role: glyph knock-outs ("hole") must
  // take the colour of whatever they sit ON, so the same glyph reads
  // correctly loose on the background and inset in a yellow tile
  function momRole(role, remap) {
    if (remap && remap[role]) return remap[role];
    return role;
  }

  function momAddPrim(contents, p, k, ox, oy, pal, masterName, remap) {
    var g = contents.addProperty("ADBE Vector Group");
    var c = g.property("ADBE Vectors Group");
    if (p.t === "path") {
      var sh = c.addProperty("ADBE Vector Shape - Group");
      var s = new Shape();
      var v = [];
      for (var i = 0; i < p.pts.length; i++) {
        v.push([(p.pts[i][0] - 50) * k + ox, (p.pts[i][1] - 50) * k + oy]);
      }
      s.vertices = v;
      s.closed = (p.closed === false) ? false : true;
      sh.property("ADBE Vector Shape").setValue(s);
    } else if (p.t === "ellipse") {
      var se = c.addProperty("ADBE Vector Shape - Ellipse");
      se.property("ADBE Vector Ellipse Size").setValue([p.w * k, p.h * k]);
      se.property("ADBE Vector Ellipse Position").setValue([(p.x + p.w / 2 - 50) * k + ox, (p.y + p.h / 2 - 50) * k + oy]);
    } else {
      var sr = c.addProperty("ADBE Vector Shape - Rect");
      sr.property("ADBE Vector Rect Size").setValue([p.w * k, p.h * k]);
      sr.property("ADBE Vector Rect Position").setValue([(p.x + p.w / 2 - 50) * k + ox, (p.y + p.h / 2 - 50) * k + oy]);
      if (p.r) sr.property("ADBE Vector Rect Roundness").setValue(p.r * k);
    }
    if (p.f) {
      var fRole = momRole(p.f, remap);
      var fl = c.addProperty("ADBE Vector Graphic - Fill");
      var fp = fl.property("ADBE Vector Fill Color");
      fp.setValue(momColor(fRole, pal));
      momLinkFill(fp, fRole, masterName);
    }
    if (p.s) {
      var sRole = momRole(p.s, remap);
      var st = c.addProperty("ADBE Vector Graphic - Stroke");
      var sp = st.property("ADBE Vector Stroke Color");
      sp.setValue(momColor(sRole, pal));
      momLinkFill(sp, sRole, masterName);
      st.property("ADBE Vector Stroke Width").setValue((p.sw || 6) * k);
      try { st.property("ADBE Vector Stroke Line Cap").setValue(2); } catch (eCap) {}
      try { st.property("ADBE Vector Stroke Line Join").setValue(2); } catch (eJoin) {}
    }
    return g;
  }

  // batches: [{ prims: [...], k: <px per glyph unit>, ox, oy }] in
  // painter's order; reversed on the way in so batch 0 sits at the back
  function momAddPrims(contents, batches, pal, masterName) {
    for (var b = batches.length - 1; b >= 0; b--) {
      var batch = batches[b];
      var k = (batch.k === undefined) ? 1 : batch.k;
      var ox = batch.ox || 0;
      var oy = batch.oy || 0;
      for (var i = batch.prims.length - 1; i >= 0; i--) {
        momAddPrim(contents, batch.prims[i], k, ox, oy, pal, masterName, batch.remap);
      }
    }
  }

  function momShapeLayer(comp, name, batches, cx, cy, pal, masterName) {
    var sl = comp.layers.addShape();
    sl.startTime = 0; // trap #2
    sl.name = name;
    sl.label = 8;
    sl.comment = MOM_TAG;
    momAddPrims(sl.property("ADBE Root Vectors Group"), batches, pal, masterName);
    sl.property("ADBE Transform Group").property("ADBE Position").setValue([cx, cy]);
    return sl;
  }

  function momGlyphPrims(name) {
    var g = MOM_GLYPHS[name];
    if (!g) g = MOM_GLYPHS.sparkle;
    return g;
  }

  // --- branded pictograms -------------------------------------------
  //
  // MOM_GLYPHS is Apostle's own drawn vocabulary — fine for a first pass, but
  // the bank ships an official pictogram set and that is what must appear on
  // screen. These are .ai (PDF-backed Illustrator) files imported once into
  // IMPORTS/pictograms; a moment names one with `picto` instead of `glyph`.
  //
  // They are placed as CONTINUOUSLY RASTERISED footage layers, which is what
  // "vector enabled" means for an AVLayer: AE re-renders the art from its
  // vector description at whatever scale the layer sits at, so a pictogram
  // scaled to 38% or blown up in a camera push stays crisp instead of
  // resampling a 284px bitmap. Without this switch the .ai import is just a
  // still at its native raster size and every push-in softens it.
  //
  // Tradeoff, stated plainly: unlike MOM_GLYPHS shape art, a footage layer's
  // fill cannot carry an expression onto CONTROL, so a brand-kit colour change
  // does NOT repaint these. The bank's pictograms are fixed black line art by
  // design, so that is the correct behaviour here — but it does mean the
  // pictogram set, not the kit, owns their colour.

  var MOM_PICTO_FOLDER = "pictograms";

  function momPictoItem(name) {
    for (var i = 1; i <= app.project.numItems; i++) {
      var it = app.project.item(i);
      if (!(it instanceof FootageItem)) continue;
      if (!it.parentFolder || it.parentFolder.name !== MOM_PICTO_FOLDER) continue;
      var n = String(it.name).replace(/\.(ai|eps|svg|pdf|png|jpg|jpeg|tif|tiff)$/i, "");
      if (n === name) return it;
    }
    return null;
  }

  // boxPx = the square the art must fit inside, matching the px size the
  // equivalent MOM_GLYPHS batch would have rendered at (100 units * k)
  function momPicto(comp, name, pictoName, cx, cy, boxPx) {
    var item = momPictoItem(pictoName);
    if (!item) return null;
    var l = comp.layers.add(item);
    l.startTime = 0; // trap #2
    l.name = name;
    l.label = 8;
    l.comment = MOM_TAG;
    // Continuous rasterisation, but ONLY where AE allows it: the switch exists
    // for vector footage (.ai/.eps/PDF) and throws on raster. Most of one client's
    // pictogram set turned out to be bitmaps despite the .ai extension (see
    // scripts/extract-pictogram-art.py), so this has to be conditional —
    // setting it unguarded failed every scene carrying a raster pictogram.
    try {
      if (l.canSetCollapseTransformation) l.collapseTransformation = true;
    } catch (eC) {}
    l.motionBlur = true;
    var mx = item.width;
    if (item.height > mx) mx = item.height;
    if (!mx) return l;
    // The set mixes padded artboards (284x284, art inset in its own margin)
    // with "-nopadding" crops. At an equal box the crops read noticeably
    // heavier, so trim them to match the padded set's optical weight.
    var pad = 1.0;
    if (mx < 280) pad = 0.8;
    var s = (boxPx / mx) * 100 * pad;
    var tr = l.property("ADBE Transform Group");
    tr.property("ADBE Scale").setValue([s, s]);
    tr.property("ADBE Position").setValue([cx, cy]);
    return l;
  }

  // ---------------------------------------------------------------
  // SCREENS: real app screenshots inside a phone (moment layout "screen")
  //
  // Screenshots are footage items in the project folder MOM_SCREEN_FOLDER,
  // brought in by importAssets (compile-brief build does it from
  // spec.assets.screens). Each screen moment gets its own small precomp with
  // the phone body, the shot under an alpha track matte cut to the display,
  // and the camera island. One layer in the scene then carries the moment's
  // entrance and exit, so frame and shot cannot drift apart, and a tall
  // scrolling screenshot can move inside the display while its matte stays put.
  //
  // The display is the aspect of a 1125x2436 iPhone capture (0.4618), so a
  // standard screenshot fills it exactly and only longer captures scroll.
  var MOM_SCREEN_FOLDER = "screens";
  var MOM_PHONE = { w: 400, h: 834, bezel: 14, r: 60 };

  function momFolderItem(folderName, name) {
    if (!name) return null;
    for (var i = 1; i <= app.project.numItems; i++) {
      var it = app.project.item(i);
      if (!(it instanceof FootageItem)) continue;
      if (!it.parentFolder || it.parentFolder.name !== folderName) continue;
      var n = String(it.name).replace(/\.(png|jpg|jpeg|tif|tiff|psd|ai|pdf)$/i, "");
      if (n === name) return it;
    }
    return null;
  }

  // A round do / don't stamp: tick on a brand plate, cross reversed out of ink.
  function momBadge(comp, name, kind, cx, cy, size, pal, masterName) {
    var isCross = (kind === "cross");
    var plate = isCross ? "ink" : "brand";
    var glyph = isCross ? "cross" : "check";
    var remap = isCross ? { ink: "paper", hole: "ink" } : { hole: "brand" };
    return momShapeLayer(comp, name, [
      { prims: [{ t: "ellipse", x: 0, y: 0, w: 100, h: 100, f: plate }], k: size / 100 },
      { prims: momGlyphPrims(glyph), k: size * 0.5 / 100, remap: remap }
    ], cx, cy, pal, masterName);
  }

  // win = { tIn, tOut } in scene time; scroll and shake are timed from it.
  function momScreenLayer(scene, mid, m, win, pal, masterName) {
    var item = momFolderItem(MOM_SCREEN_FOLDER, m.shot);
    if (!item) return null;
    var P = MOM_PHONE;
    var pcName = scene.name + " SCREEN " + mid;
    // idempotent: applyMoments already dropped the scene layer that used it
    for (var i = app.project.numItems; i >= 1; i--) {
      var old = app.project.item(i);
      if (old instanceof CompItem && old.name === pcName) old.remove();
    }
    var pc = app.project.items.addComp(pcName, P.w, P.h, 1, scene.duration, scene.frameRate);
    try { pc.parentFolder = scene.parentFolder; } catch (eF) {}
    pc.comment = MOM_TAG + " screen";
    var cx = P.w / 2, cy = P.h / 2;
    var iw = P.w - 2 * P.bezel, ih = P.h - 2 * P.bezel;

    momRect(pc, "PHONE BODY", cx, cy, P.w, P.h, P.r, "ink", null, 0, pal, masterName);
    // white display under the shot: a capture shorter than the display (the
    // a client script's cropped screens) ends in white like the app, not in the
    // black phone body
    var disp = momRect(pc, "DISPLAY", cx, cy, iw, ih, P.r - P.bezel, "paper", null, 0, pal, masterName);

    var shot = pc.layers.add(item);
    shot.startTime = 0; // trap #2
    shot.name = "SHOT";
    var sc = iw / item.width * 100;
    var tr = shot.property("ADBE Transform Group");
    tr.property("ADBE Anchor Point").setValue([item.width / 2, 0]);
    tr.property("ADBE Scale").setValue([sc, sc]);
    var pos = tr.property("ADBE Position");
    pos.setValue([cx, P.bezel]);
    // the display takes the capture's OWN background (its bottom edge), not
    // the kit's paper: one client's surface tint left a visible seam under short
    // captures. Sampled once by expression, then frozen to a plain value.
    try {
      var dv = disp.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group");
      for (var di = 1; di <= dv.numProperties; di++) {
        if (dv.property(di).matchName !== "ADBE Vector Graphic - Fill") continue;
        var dc = dv.property(di).property("ADBE Vector Fill Color");
        dc.expression = 'var L = thisComp.layer("SHOT"); L.sampleImage([L.width / 2, L.height - 3], [6, 2], false, 0);';
        var sampled = dc.valueAtTime(0, false);
        dc.expression = "";
        dc.setValue(sampled);
      }
    } catch (eDisp) {}
    var overflow = item.height * sc / 100 - ih;
    // Scroll only a genuinely long capture: a few % taller than the display
    // just crops at the bottom. Start halfway through the moment so the
    // viewer reads the screen's heading first (scrolling from tIn+1.4 had
    // already carried "Approved" past the app's own tick in a client build).
    if (overflow > ih * 0.12 && m.scroll !== false && win) {
      var a = win.tIn + Math.max(1.4, (win.tOut - win.tIn) * 0.45);
      var b = win.tOut - 0.8;
      if (b - a > 0.8) {
        pos.setValueAtTime(a, [cx, P.bezel]);
        pos.setValueAtTime(b, [cx, P.bezel - overflow]);
        applyEaseExpression(pos, "inOutQuint");
      }
    }
    if (m.degrade === "blur" || m.degrade === "glare") {
      shot.property("ADBE Effect Parade").addProperty("ADBE Gaussian Blur 2");
      var gb = shot.property("ADBE Effect Parade").property("ADBE Gaussian Blur 2");
      gb.property("ADBE Gaussian Blur 2-0001").setValue(m.degrade === "blur" ? 26 : 3);
    }

    var matte = momRect(pc, "DISPLAY MATTE", cx, cy, iw, ih, P.r - P.bezel, "paper", null, 0, pal, masterName);
    try {
      shot.setTrackMatte(matte, TrackMatteType.ALPHA); // AE 2023+
      matte.enabled = false;
    } catch (eTM) {
      matte.moveBefore(shot);                           // legacy: matte directly above
      shot.trackMatteType = TrackMatteType.ALPHA;
    }

    // The capture's own status bar stays put while the content scrolls under
    // it, like a real phone. Without this, scrolled text slid beneath the
    // island ("Take a p[island]your passport"). Same footage, unscrolled,
    // masked to the top STATUS_PX of the capture and under the same display
    // matte, so the rounded corners stay clean.
    var MOM_STATUS_PX = 141; // 47pt at @3x
    if (pos.numKeys > 0) {
      var bar = pc.layers.add(item);
      bar.startTime = 0; // trap #2
      bar.name = "STATUS BAR";
      bar.moveBefore(matte);
      var btr = bar.property("ADBE Transform Group");
      btr.property("ADBE Anchor Point").setValue([item.width / 2, 0]);
      btr.property("ADBE Scale").setValue([sc, sc]);
      btr.property("ADBE Position").setValue([cx, P.bezel]);
      bar.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
      var mk = bar.property("ADBE Mask Parade").property(1);
      var bs = new Shape();
      bs.vertices = [[0, 0], [item.width, 0], [item.width, MOM_STATUS_PX], [0, MOM_STATUS_PX]];
      bs.closed = true;
      mk.property("ADBE Mask Shape").setValue(bs);
      try { bar.setTrackMatte(matte, TrackMatteType.ALPHA); } catch (eBM) {}
    }

    if (m.degrade === "glare") {
      var glare = momShapeLayer(pc, "GLARE", [{ prims: [{ t: "ellipse", x: 0, y: 0, w: 100, h: 62, f: "paper" }], k: 2.6 }],
        cx + 34, cy - 150, pal, masterName);
      glare.property("ADBE Transform Group").property("ADBE Opacity").setValue(88);
      glare.property("ADBE Effect Parade").addProperty("ADBE Gaussian Blur 2");
      glare.property("ADBE Effect Parade").property("ADBE Gaussian Blur 2").property("ADBE Gaussian Blur 2-0001").setValue(48);
    }
    momRect(pc, "ISLAND", cx, P.bezel + 24, 112, 32, 16, "ink", null, 0, pal, masterName);

    var L = scene.layers.add(pc);
    L.startTime = 0; // trap #2
    L.name = momIdTag("SCREEN", mid);
    L.label = 8;
    L.comment = MOM_TAG;
    L.motionBlur = true;
    if (m.shake && win) {
      // a short damped buzz: the phone vibrating when the chip read succeeds
      var t0 = win.tIn + (win.tOut - win.tIn) * 0.62;
      L.property("ADBE Transform Group").property("ADBE Rotate Z").expression =
        "var t = time - " + t0.toFixed(3) + "; (t > 0 && t < 0.7) ? 2.4 * Math.sin(t * 72) * (1 - t / 0.7) : 0";
    }
    return L;
  }

  // a tile = brand plate + inset art. Pass glyph = null for a bare plate,
  // which is what a `picto` tile wants — the pictogram rides above it as its
  // own layer (opacity does not inherit through parenting, so it cannot be a
  // child; it gets its own animation at an identical delay instead).
  function momTile(comp, name, glyph, cx, cy, size, pal, masterName) {
    // Tile geometry is skin-controlled. A client reference puts
    // black line art in WHITE CIRCLES on a yellow backdrop; the original kit
    // put black glyphs on YELLOW ROUNDED SQUARES on white. Same glyph
    // vocabulary either way — only the plate under it changes.
    var fillRole = pal.tileFill || "brand";
    var shape = (pal.tileShape === "circle") ? "ellipse" : "rect";
    var batches = [
      { prims: [{ t: shape, x: 0, y: 0, w: 100, h: 100, r: 22, f: fillRole }], k: size / 100 }
    ];
    if (glyph) {
      batches.push({ prims: momGlyphPrims(glyph), k: size * 0.54 / 100, remap: { hole: fillRole } });
    }
    return momShapeLayer(comp, name, batches, cx, cy, pal, masterName);
  }

  function momRect(comp, name, x, y, w, h, r, fillRole, strokeRole, sw, pal, masterName) {
    // sized in real px, not through the 100-unit glyph box
    var sl = comp.layers.addShape();
    sl.startTime = 0;
    sl.name = name;
    sl.label = 8;
    sl.comment = MOM_TAG;
    var contents = sl.property("ADBE Root Vectors Group");
    var g = contents.addProperty("ADBE Vector Group");

    // ADD EVERY SUB-PROPERTY FIRST, THEN RE-READ EACH ONE BEFORE WRITING.
    //
    // Two failure modes meet on this vectors group, and both are handle
    // staleness:
    //   - Interleaving addProperty with setValue/expression writes made the
    //     GROUP handle go stale: "Function c.addProperty is undefined" on the
    //     second or third add. Only chipRow hit it, being the one layout that
    //     calls momRect in a loop. Fix: re-read the group before every add.
    //   - Doing all the adds first but KEEPING the property objects those adds
    //     returned makes those CHILD handles go stale instead: every
    //     addProperty on the group invalidates the ones handed out before it,
    //     so the first setValue below threw "ReferenceError: Object is
    //     invalid". That took out every scene containing a rect and left them
    //     half-built (2026-08-01) — momRect was the only site in the file
    //     holding a handle across a later add.
    // So: re-read the group before every add, and re-read each child by
    // matchName after the last add. No handle ever spans an addProperty.
    function vec() { return g.property("ADBE Vectors Group"); }

    // by index, not vec().property(matchName) — index lookup is unambiguous
    // and does not depend on how AE resolves a matchName on a vectors group
    function vecProp(mn) {
      var vg = vec();
      for (var i = 1; i <= vg.numProperties; i++) {
        if (vg.property(i).matchName === mn) return vg.property(i);
      }
      return null;
    }

    vec().addProperty("ADBE Vector Shape - Rect");
    if (fillRole) vec().addProperty("ADBE Vector Graphic - Fill");
    if (strokeRole) vec().addProperty("ADBE Vector Graphic - Stroke");

    var sr = vecProp("ADBE Vector Shape - Rect");
    var fl = fillRole ? vecProp("ADBE Vector Graphic - Fill") : null;
    var st = strokeRole ? vecProp("ADBE Vector Graphic - Stroke") : null;

    sr.property("ADBE Vector Rect Size").setValue([Number(w), Number(h)]);
    sr.property("ADBE Vector Rect Position").setValue([0, 0]);
    // roundness is a scalar — coerce so a stray vector cannot throw here
    var rr = Number(r);
    if (rr && !isNaN(rr)) sr.property("ADBE Vector Rect Roundness").setValue(rr);

    if (fl) {
      var fp = fl.property("ADBE Vector Fill Color");
      fp.setValue(momColor(fillRole, pal));
      momLinkFill(fp, fillRole, masterName);
    }
    if (st) {
      var sp = st.property("ADBE Vector Stroke Color");
      sp.setValue(momColor(strokeRole, pal));
      momLinkFill(sp, strokeRole, masterName);
      st.property("ADBE Vector Stroke Width").setValue(sw || 6);
      try { st.property("ADBE Vector Stroke Line Join").setValue(2); } catch (eJ) {}
    }
    sl.property("ADBE Transform Group").property("ADBE Position").setValue([x, y]);
    return sl;
  }

  // Text inside a moment stays master-controlled: the style expression
  // owns font / size / colour exactly as it does for a build super, so
  // the FONT Heading / FONT Body guide layers still drive everything.
  function momText(comp, str, opts, masterName) {
    var tl = comp.layers.addText(str);
    tl.startTime = 0; // trap #2
    tl.name = opts.name;
    tl.label = 2;
    tl.comment = MOM_TAG;
    var docProp = tl.property("ADBE Text Properties").property("ADBE Text Document");
    var attempt;
    for (attempt = 0; attempt < 2; attempt++) {
      try {
        var doc = docProp.value;
        doc.resetCharStyle();
        doc.fontSize = opts.size || 64;
        doc.justification = ParagraphJustification.CENTER_JUSTIFY;
        if (opts.leading) { doc.autoLeading = false; doc.leading = opts.leading; }
        docProp.setValue(doc);
        break;
      } catch (eDoc) {}
    }
    try {
      docProp.expression = styleExpr(masterName, opts.role || "heading", opts.sizeMult);
    } catch (eExpr) {}
    tl.property("ADBE Transform Group").property("ADBE Position").setValue(opts.pos);
    if (opts.autoFit) {
      try { tl.property("ADBE Transform Group").property("ADBE Scale").expression = autoFitExpr(masterName, opts.maxWidth); } catch (eFit) {}
    }
    return tl;
  }

  function momClearKeys(prop) {
    if (!prop) return;
    while (prop.numKeys > 0) prop.removeKey(1);
  }

  // Entrance + exit for one element of a moment. Position/opacity only
  // for text — Scale carries the autofit expression and keyframing it
  // is the v2.8 bug that blanked frames.
  // `lead` pulls the entrance earlier than the moment's nominal start so
  // it overlaps the outgoing moment's fade. Without it the two ramps sit
  // end-to-end and every boundary showed ~0.3s of empty white frame.
  // Position and Scale are 2- or 3-component depending on how the layer was
  // made — the build's text layers report 3 even when 2D. Writing a 2-element
  // array into a 3-component property throws ("... is not a number"), so every
  // transform write here is padded to the arity the property actually has.
  function momFitDims(sample, vals) {
    var out = [];
    for (var i = 0; i < sample.length; i++) {
      out.push(i < vals.length ? vals[i] : (sample[i] || 0));
    }
    return out;
  }

  // easeName (optional): applies the keyframe-reading easing expression from
  // EASE_CORE to Position and Scale, so the personality can be swapped later
  // without touching a single key. Text Scale is never given one — it carries
  // the autofit expression and has no keys.
  function momAnimate(layer, tIn, tOut, delay, isShape, compDur, lead, easeName) {
    var tr = layer.property("ADBE Transform Group");
    var pos = tr.property("ADBE Position");
    var opa = tr.property("ADBE Opacity");
    var sc = tr.property("ADBE Scale");
    momClearKeys(pos); momClearKeys(opa); momClearKeys(sc);

    var t0 = tIn - (lead || 0) + delay;
    if (t0 < 0) t0 = 0;
    var rise = 0.62;
    var fadeOut = 0.34;
    if (tOut - t0 < rise + fadeOut + 0.3) {
      // very short moment — shrink the moves rather than overlap them
      rise = Math.max(0.22, (tOut - t0) * 0.3);
      fadeOut = Math.max(0.14, (tOut - t0) * 0.2);
    }

    opa.setValueAtTime(t0, 0);
    opa.setValueAtTime(t0 + rise * 0.55, 100);
    opa.setValueAtTime(tOut - fadeOut, 100);
    opa.setValueAtTime(tOut, 0);
    easeAllKeys(opa, 70, 70);

    var base = pos.value;
    pos.setValueAtTime(t0, momFitDims(base, [base[0], base[1] + 44]));
    pos.setValueAtTime(t0 + rise, momFitDims(base, [base[0], base[1]]));
    easeAllKeys(pos, 86, 80);
    if (easeName) applyEaseExpression(pos, easeName);

    if (isShape) {
      // RELATIVE to whatever the layer already sits at. Shape layers are
      // always 100%, so this is identical to the old absolute 88/103/100 for
      // them — but a pictogram footage layer is fit-scaled (often ~35-40%),
      // and absolute keys would have snapped it to full size on arrival.
      var bs = sc.value;
      var b0 = bs[0], b1 = bs[1];
      sc.setValueAtTime(t0, momFitDims(bs, [b0 * 0.88, b1 * 0.88]));
      sc.setValueAtTime(t0 + rise * 0.62, momFitDims(bs, [b0 * 1.03, b1 * 1.03]));
      sc.setValueAtTime(t0 + rise, momFitDims(bs, [b0, b1]));
      easeAllKeys(sc, 78, 80);
      if (easeName) applyEaseExpression(sc, easeName);
    }

    var lin = t0 - 0.05;
    if (lin < 0) lin = 0;
    layer.outPoint = Math.min(tOut + 0.05, compDur);
    layer.inPoint = lin;
  }

  function momIdTag(prefix, mid, n) {
    return prefix + " " + mid + (n === undefined ? "" : " " + n);
  }

  // ---------------------------------------------------------------
  // TEXT REVEAL — "Slide Up By Word" + per-line mask band
  //
  // Measured off the hand-built reference (VIDEO_001 SC01, 2026-08-02).
  // Words ride up from far below into a band that is only as tall as the
  // line they belong to, so a word is invisible until it has arrived. The
  // band is the whole trick: without it every word is visible flying up
  // through the frame and the composition reads as noise.
  //
  // The reference used Ease and Wizz for the transform easing; we get the
  // same curve from EASE_CORE.inOutExpo through applyEaseExpression, so
  // nothing here depends on the plugin being installed.
  // ---------------------------------------------------------------
  var MOM_REVEAL = {
    slideY: 7445,   // animator Position Y, px — per the reference
    dur: 1.6,       // 40 frames @ 25fps
    stagger: 1.12,  // sub starts this long after its super
    start: 13,      // range selector Start %
    padTopK: 0.65,  // single-line band padding, as a multiple of line height
    padBotK: 0.55,
    padX: 240       // horizontal slack — the band never clips sideways
  };

  function momIsSuper(name) {
    return (name === "Super" || name.substring(0, 5) === "SUPER");
  }
  function momIsSub(name) {
    return name.substring(0, 3) === "SUB";
  }

  function momTextLines(layer) {
    var n = 1;
    try {
      var s = layer.property("ADBE Text Properties").property("ADBE Text Document").value.text;
      var cr = 0, lf = 0, i;
      for (i = 0; i < s.length; i++) {
        if (s.charAt(i) === "\r") cr++;
        else if (s.charAt(i) === "\n") lf++;
      }
      // AE uses \r; count whichever is present so \r\n never double-counts
      n = 1 + (cr > 0 ? cr : lf);
    } catch (e) {}
    return n;
  }

  // One band per line. A single band around a multi-line block would let a
  // word from line 2 slide up through line 1 in full view — the exact mess
  // the mask exists to prevent. Multi-line bands are a tight line slice
  // (leading always exceeds glyph extent, so nothing clips); a single line
  // gets the generous padding of the reference.
  function momMaskBands(layer, sampleT) {
    // The reveal owns masking on any layer it touches: two ADD masks union,
    // so a leftover hand-drawn band would quietly crop this one layer
    // differently from every other reveal in the project. Dropping non-ours
    // is reported, never silent.
    var mp = layer.property("ADBE Mask Parade");
    var i, foreign = 0;
    for (i = mp.numProperties; i >= 1; i--) {
      if (mp.property(i).name.substring(0, 12) !== "APOSTLE band") foreign++;
      mp.property(i).remove();
    }
    if (foreign > 0) MOM_REVEAL_WARN.push(layer.name + ": replaced " + foreign + " pre-existing mask(s) with generated band(s)");
    var r = null;
    try { r = layer.sourceRectAtTime(sampleT, false); } catch (e) { return 0; }
    if (!r || r.width <= 0 || r.height <= 0) return 0;

    var lines = momTextLines(layer);
    var lineH = r.height / lines;
    var x0 = r.left - MOM_REVEAL.padX;
    var x1 = r.left + r.width + MOM_REVEAL.padX;
    var made = 0;
    for (i = 0; i < lines; i++) {
      var y0 = r.top + i * lineH;
      var y1 = y0 + lineH;
      if (lines === 1) {
        y0 -= lineH * MOM_REVEAL.padTopK;
        y1 += lineH * MOM_REVEAL.padBotK;
      }
      // trap #6: re-read the parade before every add, write immediately after
      var mk = layer.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
      mk.name = "APOSTLE band " + (i + 1);
      mk.maskMode = MaskMode.ADD;
      var sh = new Shape();
      sh.vertices = [[x1, y0], [x0, y0], [x0, y1], [x1, y1]];
      sh.closed = true;
      mk.property("ADBE Mask Shape").setValue(sh);
      made++;
    }
    return made;
  }

  function momDropReveal(layer) {
    var ans = null;
    try { ans = layer.property("ADBE Text Properties").property("ADBE Text Animators"); } catch (e) { return; }
    if (!ans) return;
    for (var i = ans.numProperties; i >= 1; i--) {
      if (ans.property(i).name === "Slide Up By Word") ans.property(i).remove();
    }
  }

  function momSlideUpByWord(layer, t0, dur) {
    var tp = layer.property("ADBE Text Properties");
    var an = tp.property("ADBE Text Animators").addProperty("ADBE Text Animator");
    an.name = "Slide Up By Word";

    // trap #6: every add is followed by a fresh read of the group, and no
    // handle returned by an add is used after the next add
    an.property("ADBE Text Animator Properties").addProperty("ADBE Text Position 3D");
    an.property("ADBE Text Animator Properties").addProperty("ADBE Text Opacity");
    an.property("ADBE Text Animator Properties").property("ADBE Text Position 3D")
      .setValue([0, MOM_REVEAL.slideY, 0]);
    an.property("ADBE Text Animator Properties").property("ADBE Text Opacity").setValue(0);

    an.property("ADBE Text Selectors").addProperty("ADBE Text Selector");
    var sel = an.property("ADBE Text Selectors").property(1);
    sel.property("ADBE Text Percent Start").setValue(MOM_REVEAL.start);
    sel.property("ADBE Text Percent End").setValue(100);

    // Some Advanced fields are hidden depending on the others — Smoothness
    // only exists while Shape is Square, and setting a hidden property throws
    // ("the property or a parent property is hidden"), which took the whole
    // run down. Set what we can, then READ IT BACK: a swallowed write here
    // would silently give the wrong reveal on every layer in the project.
    var adv = sel.property("ADBE Text Range Advanced");
    var wants = [
      ["ADBE Text Range Units", 1],          // percentage
      ["ADBE Text Range Type2", 3],          // based on: words
      ["ADBE Text Selector Mode", 1],        // add
      ["ADBE Text Selector Max Amount", 100],
      ["ADBE Text Range Shape", 2],          // ramp up
      ["ADBE Text Levels Max Ease", 0],      // ease high
      ["ADBE Text Levels Min Ease", 100]     // ease low
    ];
    var bad = [];
    for (var w = 0; w < wants.length; w++) {
      try { adv.property(wants[w][0]).setValue(wants[w][1]); } catch (eW) {}
      try {
        if (adv.property(wants[w][0]).value !== wants[w][1]) bad.push(wants[w][0]);
      } catch (eR) { bad.push(wants[w][0]); }
    }

    // The offset ramp is LINEAR on purpose — every bit of the easing comes
    // from Ease High/Low + Smoothness above, exactly as in the reference.
    var off = sel.property("ADBE Text Percent Offset");
    off.setValueAtTime(t0, -100);
    off.setValueAtTime(t0 + dur, 100);
    for (var k = 1; k <= off.numKeys; k++) {
      off.setInterpolationTypeAtKey(k, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR);
    }
    return bad;
  }

  // Drop first, then measure, then rebuild: measuring while a previous pass's
  // animator is live would read the flown-out bounds, not the settled ones.
  var MOM_REVEAL_WARN = [];

  function momTextReveal(layer, t0, dur) {
    momDropReveal(layer);
    var bands = momMaskBands(layer, t0 + dur + 0.2);
    var bad = momSlideUpByWord(layer, t0, dur);
    if (bands === 0) MOM_REVEAL_WARN.push(layer.name + ": no mask band (unmeasurable bounds)");
    if (bad && bad.length) MOM_REVEAL_WARN.push(layer.name + ": selector fields not applied: " + bad.join(","));
    return bands;
  }

  function momT0(tIn, lead, delay) {
    var t = tIn - (lead || 0) + (delay || 0);
    if (t < 0) t = 0;
    return t;
  }

  // Super leads, every sub in the same moment follows one stagger later.
  // A moment too short to hold super + stagger + reveal compresses both
  // rather than running the reveal past its own fade-out.
  function momRevealMoment(els, tIn, tOut, lead) {
    var superEl = null, subs = [], i;
    for (i = 0; i < els.length; i++) {
      var ly = els[i].layer;
      if (!(ly instanceof TextLayer)) continue;
      if (momIsSuper(ly.name)) { if (!superEl) superEl = els[i]; }
      else if (momIsSub(ly.name)) subs.push(els[i]);
    }
    if (!superEl && subs.length === 0) return 0;

    var baseDelay = superEl ? superEl.delay : subs[0].delay;
    var sT0 = momT0(tIn, lead, baseDelay);
    var dur = MOM_REVEAL.dur, stag = MOM_REVEAL.stagger;

    // The reveal must finish before the moment starts fading out, ALWAYS.
    // An earlier version only compressed when there was room to spare, so a
    // short moment kept the full 1.6s and its words were still arriving as
    // the layer faded — visible as a super that never completes, and as a
    // 7000px "safe margin" violation because the check samples mid-flight.
    // A moment with no sub gets the whole window to itself.
    var room = tOut - 0.34 - sT0;
    if (room < 0.4) room = 0.4;
    var need = dur + (subs.length > 0 ? stag : 0);
    if (need > room) {
      var k = room / need;
      dur = dur * k;
      stag = stag * k;
    }
    if (dur < 0.3) dur = 0.3;

    var n = 0;
    if (superEl) { momTextReveal(superEl.layer, sT0, dur); n++; }
    for (i = 0; i < subs.length; i++) {
      momTextReveal(subs[i].layer, superEl ? (sT0 + stag) : sT0, dur);
      n++;
    }
    return n;
  }

  // --- layouts -----------------------------------------------------
  // Every layout returns a flat list of { layer, delay, shape } which
  // the caller animates on the moment's window. Geometry is fixed so
  // moments of the same kind land identically across scenes.

  function momLayout(comp, m, pal, masterName, superLayer, win) {
    var W = comp.width, H = comp.height;
    var el = [];
    var kind = m.layout || "statement";
    var mid = m.id || "m";
    var i, n;

    function addSuper(y, mult, x) {
      var sx = (x === undefined) ? W / 2 : x;
      var lay;
      if (superLayer) {
        // reuse the build's "Super" layer for the first moment so the
        // updateBeatText / hashCompState contract still finds it
        lay = superLayer;
        setTextLayerString(comp, lay.name, m["super"] || "");
        lay.property("ADBE Transform Group").property("ADBE Position").setValue([sx, y]);
        // re-point the style expression at this layout's size multiplier —
        // the build baked mult 1, so a reused Super would otherwise ignore
        // the layout and render at full heading size
        try {
          lay.property("ADBE Text Properties").property("ADBE Text Document").expression =
            styleExpr(masterName, "heading", mult);
        } catch (eRe) {}
        superLayer = null;
      } else {
        lay = momText(comp, m["super"] || "", { name: momIdTag("SUPER", mid), sizeMult: mult, pos: [sx, y], autoFit: true, leading: 96 }, masterName);
      }
      el.push({ layer: lay, delay: 0, shape: false });
      return lay;
    }
    function addSub(y, x, mult) {
      if (!m.sub) return null;
      var lay = momText(comp, m.sub, { name: momIdTag("SUB", mid), role: "body", sizeMult: mult || 1.15, pos: [x === undefined ? W / 2 : x, y], autoFit: true, leading: 60 }, masterName);
      el.push({ layer: lay, delay: 0.16, shape: false });
      return lay;
    }
    function addLabel(str, x, y, idx, mult) {
      var lay = momText(comp, str, { name: momIdTag("LABEL", mid, idx), role: "body", sizeMult: mult || 0.82, pos: [x, y], leading: 42 }, masterName);
      return lay;
    }

    if (kind === "iconRow") {
      var tiles = m.tiles || [];
      n = tiles.length;
      var hasSub = !!m.sub;
      addSuper(hasSub ? 250 : 285, 0.92);
      addSub(hasSub ? 375 : 0, W / 2, 1.1);
      var size = 200;
      if (n >= 4) size = 180;
      var gap = (n >= 4) ? 78 : 110;
      var rowW = n * size + (n - 1) * gap;
      var x0 = W / 2 - rowW / 2 + size / 2;
      var cy = hasSub ? 640 : 610;
      for (i = 0; i < n; i++) {
        var cx = x0 + i * (size + gap);
        var tDelay = 0.30 + i * 0.10;
        var t = momTile(comp, momIdTag("TILE", mid, i + 1), tiles[i].picto ? null : tiles[i].glyph, cx, cy, size, pal, masterName);
        el.push({ layer: t, delay: tDelay, shape: true });
        if (tiles[i].picto) {
          // identical delay => momAnimate produces identical curves, so the
          // pictogram and its plate move as one despite being two layers
          var tp = momPicto(comp, momIdTag("TILE ART", mid, i + 1), tiles[i].picto, cx, cy, size * 0.54);
          if (tp) el.push({ layer: tp, delay: tDelay, shape: true });
        }
        if (tiles[i].label) {
          el.push({ layer: addLabel(tiles[i].label, cx, cy + size / 2 + 78, i + 1), delay: 0.38 + i * 0.10, shape: false });
        }
      }
    } else if (kind === "chipRow") {
      var chips = m.chips || [];
      n = chips.length;
      addSuper(320, 0.92);
      addSub(452, W / 2, 1.1);
      var chipH = 116;
      var widths = [];
      var total = 0;
      for (i = 0; i < n; i++) {
        var wch = 84 + String(chips[i]).length * 27;
        if (wch < 240) wch = 240;
        widths.push(wch);
        total += wch;
      }
      var cgap = 44;
      total += (n - 1) * cgap;
      var maxW = W - 2 * 170;
      var shrink = 1;
      if (total > maxW) shrink = maxW / total;
      var cx0 = W / 2 - (total * shrink) / 2;
      var chipY = m.sub ? 690 : 620;
      var run = cx0;
      for (i = 0; i < n; i++) {
        var cw = widths[i] * shrink;
        var ccx = run + cw / 2;
        var pill = momRect(comp, momIdTag("CHIP", mid, i + 1), ccx, chipY, cw, chipH, chipH / 2, pal.plateFill, pal.plateStroke, pal.plateStroke ? 3 : 0, pal, masterName);
        el.push({ layer: pill, delay: 0.28 + i * 0.09, shape: true });
        el.push({ layer: addLabel(String(chips[i]), ccx, chipY + 14, i + 1, 0.92), delay: 0.34 + i * 0.09, shape: false });
        run += cw + cgap * shrink;
      }
    } else if (kind === "device") {
      var px = m.deviceX || 1345;
      var py = 545;
      var body = momRect(comp, momIdTag("PHONE", mid), px, py, 452, 856, 52, "paper", "ink", 8, pal, masterName);
      el.push({ layer: body, delay: 0.30, shape: true });
      var notch = momRect(comp, momIdTag("PHONE NOTCH", mid), px, py - 386, 132, 14, 7, "ink", null, 0, pal, masterName);
      el.push({ layer: notch, delay: 0.34, shape: true });
      var rows = m.screen || [];
      var nRows = Math.min(rows.length, 5);
      var rowGap = 150;
      // centre the card stack in the screen rather than stacking it
      // against the notch — a top-hugging stack left the phone empty
      var ry0 = py - ((nRows - 1) * rowGap) / 2 + 20;
      for (i = 0; i < nRows; i++) {
        var ry = ry0 + i * rowGap;
        var card = momRect(comp, momIdTag("SCREEN", mid, i + 1), px, ry, 348, 108, 18, "brand", null, 0, pal, masterName);
        el.push({ layer: card, delay: 0.52 + i * 0.11, shape: true });
        // label is centred on the text half of the card, clear of the icon
        if (rows[i].label) {
          el.push({ layer: addLabel(rows[i].label, px + 46, ry + 12, i + 1, 0.78), delay: 0.58 + i * 0.11, shape: false });
        }
        if (rows[i].picto) {
          var rp = momPicto(comp, momIdTag("SCREEN ICON", mid, i + 1), rows[i].picto, px - 116, ry, 56);
          if (rp) el.push({ layer: rp, delay: 0.60 + i * 0.11, shape: true });
        } else if (rows[i].glyph) {
          var gl = momShapeLayer(comp, momIdTag("SCREEN ICON", mid, i + 1), [{ prims: momGlyphPrims(rows[i].glyph), k: 0.56, remap: { hole: "brand" } }], px - 116, ry, pal, masterName);
          el.push({ layer: gl, delay: 0.60 + i * 0.11, shape: true });
        }
      }
      var colX = m.textX || 640;
      // goes through addSuper (not a fresh layer) so a device-led scene
      // still hands the build's "Super" layer to moment 1
      addSuper(m.sub ? 440 : 500, 0.86, colX);
      addSub(600, colX, 1.1);
    } else if (kind === "compare") {
      addSuper(255, 0.92);
      var boxW = 560, boxH = 230, cy2 = 620;
      var lx = 560, rx = 1360;
      var lbox = momRect(comp, momIdTag("FROM BOX", mid), lx, cy2, boxW, boxH, 26, "paper", "muted", 7, pal, masterName);
      el.push({ layer: lbox, delay: 0.28, shape: true });
      var fromLabel = (m.fromBox && m.fromBox.label) || "";
      el.push({ layer: addLabel(fromLabel, lx, cy2 + 16, 1, 1.02), delay: 0.34, shape: false });
      if (m.fromBox && m.fromBox.strike) {
        // width tracks the label so the rule crosses the words, not the box
        var strikeW = fromLabel.length * 22 + 24;
        if (strikeW > boxW - 60) strikeW = boxW - 60;
        if (strikeW < 80) strikeW = 80;
        var strike = momRect(comp, momIdTag("STRIKE", mid), lx, cy2 + 2, strikeW, 7, 4, "ink", null, 0, pal, masterName);
        el.push({ layer: strike, delay: 0.62, shape: true });
      }
      var arrow = momShapeLayer(comp, momIdTag("ARROW", mid), [{ prims: momGlyphPrims("arrowRight"), k: 1.28 }], (lx + rx) / 2, cy2, pal, masterName);
      el.push({ layer: arrow, delay: 0.48, shape: true });
      var rbox = momRect(comp, momIdTag("TO BOX", mid), rx, cy2, boxW, boxH, 26, pal.plateFill, pal.plateStroke, pal.plateStroke ? 5 : 0, pal, masterName);
      el.push({ layer: rbox, delay: 0.60, shape: true });
      el.push({ layer: addLabel((m.toBox && m.toBox.label) || "", rx, cy2 + 16, 2, 1.02), delay: 0.66, shape: false });
      addSub(880, W / 2, 1.05);
    } else if (kind === "hub") {
      addSuper(235, 0.92);
      addSub(360, W / 2, 1.1);
      var hcx = W / 2, hcy = 680, R = 250;
      var spokes = m.spokes || [];
      n = spokes.length;
      for (i = 0; i < n; i++) {
        var ang = -Math.PI / 2 + (2 * Math.PI * i) / n;
        var sx = hcx + Math.cos(ang) * R;
        var sy = hcy + Math.sin(ang) * R * 0.62;
        var link = momShapeLayer(comp, momIdTag("SPOKE", mid, i + 1),
          [{ prims: [{ t: "path", s: "muted", sw: 1.25, closed: false, pts: [[50, 50], [50 + (sx - hcx) / 4, 50 + (sy - hcy) / 4]] }], k: 4 }],
          hcx, hcy, pal, masterName);
        el.push({ layer: link, delay: 0.42 + i * 0.06, shape: false });
        var sDelay = 0.48 + i * 0.08;
        var sat = momTile(comp, momIdTag("SPOKE TILE", mid, i + 1), spokes[i].picto ? null : (spokes[i].glyph || "tag"), sx, sy, 128, pal, masterName);
        el.push({ layer: sat, delay: sDelay, shape: true });
        if (spokes[i].picto) {
          var sp2 = momPicto(comp, momIdTag("SPOKE ART", mid, i + 1), spokes[i].picto, sx, sy, 128 * 0.54);
          if (sp2) el.push({ layer: sp2, delay: sDelay, shape: true });
        }
      }
      var coreBatches = [{ prims: [{ t: "ellipse", x: 0, y: 0, w: 100, h: 100, f: "brand" }], k: 1.7 }];
      if (!m.picto) {
        coreBatches.push({ prims: momGlyphPrims(m.glyph || "star"), k: 0.86, remap: { hole: "brand" } });
      }
      var core = momShapeLayer(comp, momIdTag("HUB CORE", mid), coreBatches, hcx, hcy, pal, masterName);
      el.push({ layer: core, delay: 0.34, shape: true });
      if (m.picto) {
        var cp = momPicto(comp, momIdTag("HUB CORE ART", mid), m.picto, hcx, hcy, 86);
        if (cp) el.push({ layer: cp, delay: 0.34, shape: true });
      }
    } else if (kind === "screen") {
      var onRight = (m.side !== "left");
      var phX = onRight ? 1330 : 590;
      var phY = 545;
      var scr = momScreenLayer(comp, mid, m, win, pal, masterName);
      if (scr) {
        scr.property("ADBE Transform Group").property("ADBE Position").setValue([phX, phY]);
        el.push({ layer: scr, delay: 0.24, shape: true });
      } else {
        // the screenshot is not in the project: an outlined phone that says
        // which one, like placeholder, so it cannot pass for finished work
        var ghost = momRect(comp, momIdTag("PHONE", mid), phX, phY, MOM_PHONE.w, MOM_PHONE.h, MOM_PHONE.r, "paper", "ink", 6, pal, masterName);
        el.push({ layer: ghost, delay: 0.24, shape: true });
        var gcap = momText(comp, "[ " + (m.shot || "screen") + " ]",
          { name: momIdTag("SHOT MISSING", mid), role: "body", sizeMult: 0.62, pos: [phX, phY], autoFit: true }, masterName);
        el.push({ layer: gcap, delay: 0.3, shape: false });
      }
      if (m.badge === "tick" || m.badge === "cross") {
        var bdg = momBadge(comp, momIdTag("BADGE", mid), m.badge,
          phX + MOM_PHONE.w / 2 - 4, phY - MOM_PHONE.h / 2 + 118, 150, pal, masterName);
        el.push({ layer: bdg, delay: 0.95, shape: true });
      }
      var sColX = (m.textX !== undefined) ? m.textX : 640;
      if (!onRight && m.textX === undefined) sColX = 1280;
      addSuper(m.sub ? 450 : 510, 0.86, sColX);
      addSub(610, sColX, 1.1);
    } else if (kind === "placeholder") {
      // A slot for artwork the build cannot draw — real card art, partner
      // logos, app screenshots. Deliberately reads as unfinished: an outlined
      // frame captioned with what belongs there, so it can never be mistaken
      // for a finished moment in review.
      var pw = 620, ph = 380, pcy = 400;
      // momRect takes CENTRE coords, not top-left
      var frame = momRect(comp, momIdTag("ASSET FRAME", mid), W / 2, pcy,
        pw, ph, 24, "paper", "ink", 4, pal, masterName);
      el.push({ layer: frame, delay: 0.16, shape: true });
      var cap = momText(comp, "[ " + (m.asset || "artwork") + " ]",
        { name: momIdTag("ASSET LABEL", mid), role: "body", sizeMult: 0.92, pos: [W / 2, pcy + 12], autoFit: true, maxWidth: pw - 64 }, masterName);
      el.push({ layer: cap, delay: 0.3, shape: false });
      addSuper(700, 1.1);
      addSub(842, W / 2, 1.12);
    } else if (kind === "hero") {
      var g2 = null;
      if (m.picto) g2 = momPicto(comp, momIdTag("HERO", mid), m.picto, W / 2, 375, 310);
      if (!g2) g2 = momShapeLayer(comp, momIdTag("HERO", mid), [{ prims: momGlyphPrims(m.glyph || "coin"), k: 3.1 }], W / 2, 375, pal, masterName);
      el.push({ layer: g2, delay: 0.22, shape: true });
      addSuper(730, 1.16);
      addSub(872, W / 2, 1.15);
    } else if (kind === "endcard") {
      addSuper(400, 1.05);
      if (m.url) {
        var u = momText(comp, m.url, { name: momIdTag("URL", mid), role: "body", sizeMult: 1.28, pos: [W / 2, 560], autoFit: true }, masterName);
        el.push({ layer: u, delay: 0.22, shape: false });
      }
      addSub(672, W / 2, 1.02);
      var bar = momRect(comp, momIdTag("BAR", mid), W / 2, 772, 240, 9, 4, "brand", null, 0, pal, masterName);
      el.push({ layer: bar, delay: 0.42, shape: true });
    } else {
      // statement
      var hasGlyph = !!(m.glyph || m.picto);
      if (hasGlyph) {
        var gs = null;
        if (m.picto) gs = momPicto(comp, momIdTag("ART", mid), m.picto, W / 2, 372, 210);
        if (!gs && m.glyph) gs = momShapeLayer(comp, momIdTag("ART", mid), [{ prims: momGlyphPrims(m.glyph), k: 2.1 }], W / 2, 372, pal, masterName);
        if (gs) { el.push({ layer: gs, delay: 0.18, shape: true }); } else { hasGlyph = false; }
      }
      addSuper(hasGlyph ? 668 : 480, 1.0);
      addSub(hasGlyph ? 810 : 622, W / 2, 1.15);
      // trap #1: no chained ternaries — ExtendScript mis-associates them
      var barY;
      if (hasGlyph) { barY = 906; }
      else if (m.sub) { barY = 716; }
      else { barY = 574; }
      var b2 = momRect(comp, momIdTag("BAR", mid), W / 2, barY, 220, 8, 4, "brand", null, 0, pal, masterName);
      el.push({ layer: b2, delay: 0.34, shape: true });
    }

    // a first moment that never consumed the build's Super layer: park it
    if (superLayer) {
      superLayer.enabled = false;
      superLayer.comment = MOM_TAG + " retired";
    }
    return el;
  }

  // --- entry point -------------------------------------------------

  // How early moment 1 of a scene starts fading up, so the camera flies INTO
  // content instead of across ~0.5s of empty backdrop. See the note at its
  // use in applyMoments for the history.
  var MOM_FIRST_LEAD = 0.8;

  // Shape-art helpers for other Apostle builders (apostle/instructional.jsx):
  // the MOM_GLYPHS vocabulary drawn into any comp, with a hex palette and no
  // CONTROL linking (masterName null).
  function drawGlyph(comp, name, glyph, cx, cy, size, palHex, remap) {
    var l = momShapeLayer(comp, name, [{ prims: momGlyphPrims(glyph), k: size / 100, remap: remap || null }], cx, cy, momPalette(palHex), null);
    l.comment = "apostle instr";
    return l;
  }
  function drawTile(comp, name, glyph, cx, cy, size, palHex) {
    var pal = momPalette(palHex);
    var l = momShapeLayer(comp, name, [
      { prims: [{ t: "ellipse", x: 0, y: 0, w: 100, h: 100, f: "brand" }], k: size / 100 },
      { prims: momGlyphPrims(glyph), k: size * 0.52 / 100, remap: { hole: "brand" } }
    ], cx, cy, pal, null);
    l.comment = "apostle instr";
    return l;
  }
  function drawBadge(comp, name, kind, cx, cy, size, palHex) {
    var l = momBadge(comp, name, kind, cx, cy, size, momPalette(palHex), null);
    l.comment = "apostle instr";
    return l;
  }

  // The 2D instructional stage lives in its own file; load it from beside
  // this library and build a compiled timeline (see build-instructional.cjs).
  function buildInstructional(timelinePath, replace) {
    try {
      if (!LIB_FILE || !LIB_FILE.exists) return toJSON({ status: "error", error: "apostle.jsx cannot locate itself to load instructional.jsx" });
      $.evalFile(new File(LIB_FILE.parent.fsName + "/instructional.jsx"));
      return $.global.APOSTLE_INSTR.build(timelinePath, { replace: !!replace });
    } catch (e) { return errJSON("buildInstructional", e); }
  }

  // Import files into a named project folder (e.g. "screens"), skipping any
  // already there by name. filesJSON: array of absolute paths.
  function importAssets(folderName, filesJSON) {
    try {
      var files = parseJSONSafe(filesJSON);
      if (!files) return toJSON({ status: "error", error: "files JSON did not parse" });
      var folder = null;
      for (var i = 1; i <= app.project.numItems; i++) {
        var it = app.project.item(i);
        if (it instanceof FolderItem && it.name === folderName) { folder = it; break; }
      }
      var report = { status: "success", folder: folderName, imported: [], existing: [], missing: [] };
      app.beginUndoGroup("Apostle importAssets");
      try {
        if (!folder) folder = app.project.items.addFolder(folderName);
        for (var f = 0; f < files.length; f++) {
          var file = new File(files[f]);
          var base = decodeURI(file.name);
          var have = false;
          for (var k = 1; k <= folder.numItems; k++) {
            if (folder.item(k).name === base) { have = true; break; }
          }
          if (have) { report.existing.push(base); continue; }
          if (!file.exists) { report.missing.push(files[f]); continue; }
          var item = app.project.importFile(new ImportOptions(file));
          item.parentFolder = folder;
          report.imported.push(base);
        }
      } finally {
        app.endUndoGroup();
      }
      if (report.missing.length) report.status = "partial";
      return toJSON(report);
    } catch (e) { return errJSON("importAssets", e); }
  }

  function applyMoments(momentsJSON) {
    try {
      var data = parseJSONSafe(momentsJSON);
      if (!data) return toJSON({ status: "error", error: "moments JSON did not parse" });
      var meta = data.meta || {};
      var masterName = meta.masterName || "";
      var leadIn = (meta.voLeadIn === undefined) ? 0.45 : meta.voLeadIn;
      var tail = (meta.tailBuffer === undefined) ? 6 : meta.tailBuffer;
      var pal = momPalette(data.palette);
      // Motion personality. meta.easeProfile picks the transform easing;
      // meta.textReveal:false turns the word-by-word reveal off for a doc.
      var easeName = profileFor(null, data).reveal;
      var revealOn = !(meta && meta.textReveal === false);
      MOM_REVEAL_WARN = [];
      var report = { status: "success", scenes: [], warnings: [], ease: easeName, reveal: revealOn };

      app.beginUndoGroup("Apostle applyMoments");
      try {
        var scenes = data.scenes || [];
        for (var s = 0; s < scenes.length; s++) {
          var sc = scenes[s];
          var rec = { beatId: sc.beatId || "", comp: "", moments: 0, layers: 0, reveals: 0 };
          var comp = null;
          if (sc.beatId && masterName) comp = findBeatComp(masterName, sc.beatId);
          if (!comp && sc.comp) comp = findComp(sc.comp);
          if (!comp) {
            rec.error = "scene comp not found (beatId=" + (sc.beatId || "-") + ", comp=" + (sc.comp || "-") + ")";
            report.scenes.push(rec);
            report.status = "partial";
            continue;
          }
          rec.comp = comp.name;

          // idempotent re-run: drop everything a previous pass made,
          // plus the generic build placeholders the moments replace
          for (var L = comp.numLayers; L >= 1; L--) {
            var ly = comp.layer(L);
            var isMoment = (ly.comment && ly.comment.substring(0, MOM_TAG.length) === MOM_TAG);
            var isPlaceholder = (ly.name === "Accent Bar" || ly.name === "Device Frame (placeholder)");
            if (isMoment || isPlaceholder) {
              if (ly.name === "Super") { continue; }
              ly.remove();
            }
          }

          var superLayer = findLayer(comp, "Super");
          if (superLayer) {
            superLayer.enabled = true;
            superLayer.comment = "";
            var str = superLayer.property("ADBE Transform Group");
            momClearKeys(str.property("ADBE Position"));
            momClearKeys(str.property("ADBE Opacity"));
            momClearKeys(str.property("ADBE Scale"));
            superLayer.inPoint = 0;
            superLayer.outPoint = comp.duration;
            // "Super" is the one text layer that survives a re-run (every
            // other one is removed and remade above), so it is the only one
            // that can carry a previous pass's reveal into this one.
            momDropReveal(superLayer);
            var smp = superLayer.property("ADBE Mask Parade");
            for (var sb = smp.numProperties; sb >= 1; sb--) {
              if (smp.property(sb).name.substring(0, 12) === "APOSTLE band") smp.property(sb).remove();
            }
          }

          // moment windows are fractions of the beat's VO window, so a
          // retime only means re-running this — no hand-nudged times
          var voDur = comp.duration - tail;
          if (voDur <= 0) voDur = comp.duration;
          var moments = sc.moments || [];
          for (var mi = 0; mi < moments.length; mi++) {
            var m = moments[mi];
            var tIn = (m.atSec !== undefined) ? m.atSec : (leadIn + voDur * m.from);
            var tOut = (m.toSec !== undefined) ? m.toSec : (leadIn + voDur * m.to);
            if (tOut > comp.duration) tOut = comp.duration;
            if (tOut - tIn < 0.6) tOut = tIn + 0.6;
            // Moment 1 DOES lead, and by more than the rest.
            //
            // It used to be pinned to 0 on the reasoning that leading would
            // start it before the camera reached the station. Measuring the
            // rig proves the opposite: stations sit 2400 apart, the camera
            // sees ~2460 wide at mid-transit, so the incoming plane is already
            // in frame for most of the move. Pinning moment 1 to the arrival
            // is what left the back of every transit staring at a blank plane
            // (rendered proof: VIDEO_001 t=40.8s, an entirely empty frame).
            //
            // Leading it means content fades up as the camera flies in, which
            // both removes the dead frames and is where the movement gets its
            // energy — you arrive INTO something rather than at nothing.
            // momAnimate clamps t0 at 0, so the opening beat is unaffected.
            //
            // History: reverted to 0 on 2026-08-01 because applying the lead
            // coincided with "ReferenceError: Object is invalid" across every
            // video. That error was later traced to the stale-handle bug in
            // momRect (CLAUDE.md trap #6), not to the lead. Re-enabled
            // 2026-10-12 at MOM_FIRST_LEAD = 0.8 after a gap scan of VIDEO_008
            // (frames 0.2s apart, +/-1s around all 11 transits): 31/132 frames
            // were empty backdrop with no lead, against none with 0.8s.
            var lead = (mi === 0) ? MOM_FIRST_LEAD : 0.3;
            var els = momLayout(comp, m, pal, masterName, (mi === 0) ? superLayer : null, { tIn: tIn, tOut: tOut });
            for (var e = 0; e < els.length; e++) {
              momAnimate(els[e].layer, tIn, tOut, els[e].delay, els[e].shape, comp.duration, lead, easeName);
              rec.layers++;
            }
            if (revealOn) rec.reveals += momRevealMoment(els, tIn, tOut, lead);
            rec.moments++;
          }
          // keep BG at the bottom of the stack
          var bg = findLayer(comp, "BG");
          if (bg) bg.moveToEnd();
          report.scenes.push(rec);
        }
      } finally {
        app.endUndoGroup();
      }
      for (var rw = 0; rw < MOM_REVEAL_WARN.length; rw++) report.warnings.push(MOM_REVEAL_WARN[rw]);
      return toJSON(report);
    } catch (e) { return errJSON("applyMoments", e); }
  }

  // ---------------------------------------------------------------
  // TRANSITIONS — the Point Signifier iris between stations
  //
  // The rig flies the camera between stations 2400 apart. Mid-flight the
  // frame shows the seams of two flat scene planes over the backdrop, and
  // on the longer moves it shows nothing at all (rendered proof: VIDEO_001
  // at t=40.8s, a completely empty frame). Rather than fight the geometry,
  // cover the move: the brand's Point Signifier appears, a backdrop-coloured
  // disc opens out of it and swallows the frame, the camera flies behind it,
  // then the disc irises open again on the arrived station.
  //
  // Art is drawn natively, not imported, so it stays CONTROL-linked and
  // resolution-free. Proportions are measured off the supplied toolkit SVG
  // (a client currency icon SVG, 1080 box): ring centreline diameter
  // 0.600 of the box, stroke 0.0148; diamond side 0.200 rotated 45 degrees
  // with the same 0.0148 stroke.
  // ---------------------------------------------------------------
  var TRANS_TAG = "apostle transition";
  var TRANS = {
    iconSize: 420,     // the 1080-box size the proportions below scale from
    ringD: 0.600,      // ring centreline diameter, x iconSize
    strokeK: 0.0148,   // ring + diamond stroke, x iconSize
    diamondK: 0.200,   // diamond side, x iconSize
    // Centred on the MOVE MIDPOINT, not spanning the whole move. Anchoring
    // the cover to depart/arrive held the frame white for the entire flight —
    // on a 1.3s move that is 1.3s of blank, nine times a film. The seams only
    // show mid-flight, so punch through the middle and let the ends play.
    closeDur: 0.32,
    holdDur: 0.30,
    openDur: 0.32
  };

  // A transit is a run of rig position keys between two station dwells.
  // Stations are the x values the rig rests at; a dwell is a gap > 2s.
  function transitWindows(master) {
    var rig = findLayer(master, "APOSTLE RIG");
    if (!rig) return [];
    var p = rig.property("ADBE Transform Group").property("ADBE Position");
    if (!p || p.numKeys < 2) return [];
    var k = [], i;
    for (i = 1; i <= p.numKeys; i++) {
      var v = p.keyValue(i);
      k.push({ t: p.keyTime(i), x: Math.round(v[0]) });
    }
    // Station x values = those held across a long gap. The LAST station is
    // never followed by a gap (the keys simply stop), so add it explicitly —
    // without it the final transit of every video goes uncovered.
    var station = {};
    for (i = 0; i < k.length - 1; i++) {
      if (k[i + 1].t - k[i].t > 2.0 && k[i + 1].x === k[i].x) station[k[i].x] = true;
    }
    station[k[k.length - 1].x] = true;

    var out = [];
    // start at 1: key 0 has no predecessor, and treating it as a departure
    // invented a transit covering the whole opening beat
    for (i = 1; i < k.length - 1; i++) {
      // departure: a key whose predecessor sat at the same station for a while
      if (!(k[i].t - k[i - 1].t > 2.0)) continue;
      if (!station[k[i].x]) continue;
      var from = k[i].x;
      for (var j = i + 1; j < k.length; j++) {
        if (station[k[j].x] && k[j].x !== from) {
          out.push({ t0: k[i].t, t1: k[j].t, from: from, to: k[j].x });
          break;
        }
      }
    }
    return out;
  }

  function transDropExisting(master) {
    var n = 0;
    for (var L = master.numLayers; L >= 1; L--) {
      var ly = master.layer(L);
      if (ly.comment && ly.comment.substring(0, TRANS_TAG.length) === TRANS_TAG) { ly.remove(); n++; }
    }
    return n;
  }

  // filled ellipse whose SIZE is keyed; a layer mask punches the hole later
  function transDisc(master, name, pal, masterName) {
    var sl = master.layers.addShape();
    sl.startTime = 0;                       // trap #2
    sl.name = name;
    sl.comment = TRANS_TAG;
    sl.label = 11;
    var g = sl.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
    // trap #6: re-read the group before each add, re-read children after
    g.property("ADBE Vectors Group").addProperty("ADBE Vector Shape - Ellipse");
    g.property("ADBE Vectors Group").addProperty("ADBE Vector Graphic - Fill");
    var vg = g.property("ADBE Vectors Group");
    var el = null, fl = null;
    for (var i = 1; i <= vg.numProperties; i++) {
      var pr = vg.property(i);
      if (pr.matchName === "ADBE Vector Shape - Ellipse") el = pr;
      if (pr.matchName === "ADBE Vector Graphic - Fill") fl = pr;
    }
    var fp = fl.property("ADBE Vector Fill Color");
    fp.setValue(momColor("paper", pal));
    momLinkFill(fp, "paper", masterName);   // tracks CONTROL Surface
    sl.property("ADBE Transform Group").property("ADBE Position")
      .setValue([master.width / 2, master.height / 2]);
    return { layer: sl, size: el.property("ADBE Vector Ellipse Size") };
  }

  function transIcon(master, name, pal, masterName) {
    var S = TRANS.iconSize;
    var sl = master.layers.addShape();
    sl.startTime = 0;
    sl.name = name;
    sl.comment = TRANS_TAG;
    sl.label = 11;

    // ring
    var gr = sl.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
    gr.name = "ring";
    gr.property("ADBE Vectors Group").addProperty("ADBE Vector Shape - Ellipse");
    gr.property("ADBE Vectors Group").addProperty("ADBE Vector Graphic - Stroke");
    var rvg = gr.property("ADBE Vectors Group");
    var rel = null, rst = null, i;
    for (i = 1; i <= rvg.numProperties; i++) {
      if (rvg.property(i).matchName === "ADBE Vector Shape - Ellipse") rel = rvg.property(i);
      if (rvg.property(i).matchName === "ADBE Vector Graphic - Stroke") rst = rvg.property(i);
    }
    rel.property("ADBE Vector Ellipse Size").setValue([S * TRANS.ringD, S * TRANS.ringD]);
    var rsc = rst.property("ADBE Vector Stroke Color");
    rsc.setValue(momColor("ink", pal));
    rst.property("ADBE Vector Stroke Width").setValue(S * TRANS.strokeK);

    // diamond = square rotated 45 degrees, brand fill, ink stroke
    var gd = sl.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
    gd.name = "diamond";
    gd.property("ADBE Vectors Group").addProperty("ADBE Vector Shape - Rect");
    gd.property("ADBE Vectors Group").addProperty("ADBE Vector Graphic - Fill");
    gd.property("ADBE Vectors Group").addProperty("ADBE Vector Graphic - Stroke");
    var dvg = gd.property("ADBE Vectors Group");
    var dre = null, dfl = null, dst = null;
    for (i = 1; i <= dvg.numProperties; i++) {
      if (dvg.property(i).matchName === "ADBE Vector Shape - Rect") dre = dvg.property(i);
      if (dvg.property(i).matchName === "ADBE Vector Graphic - Fill") dfl = dvg.property(i);
      if (dvg.property(i).matchName === "ADBE Vector Graphic - Stroke") dst = dvg.property(i);
    }
    dre.property("ADBE Vector Rect Size").setValue([S * TRANS.diamondK, S * TRANS.diamondK]);
    var dfp = dfl.property("ADBE Vector Fill Color");
    dfp.setValue(momColor("brand", pal));
    momLinkFill(dfp, "brand", masterName);  // tracks CONTROL Primary
    dst.property("ADBE Vector Stroke Color").setValue(momColor("ink", pal));
    dst.property("ADBE Vector Stroke Width").setValue(S * TRANS.strokeK);
    gd.property("ADBE Vector Transform Group").property("ADBE Vector Rotation").setValue(45);

    sl.property("ADBE Transform Group").property("ADBE Position")
      .setValue([master.width / 2, master.height / 2]);
    return sl;
  }

  function applyTransitions(masterName) {
    try {
      var master = findComp(masterName);
      if (!master) return toJSON({ status: "error", error: "Comp not found: " + masterName });
      var pal = momPalette(null);
      var report = { status: "success", master: masterName, removed: 0, transits: [], warnings: [] };

      app.beginUndoGroup("Apostle applyTransitions");
      try {
        report.removed = transDropExisting(master);
        var wins = transitWindows(master);
        if (wins.length === 0) {
          report.warnings.push("no transits found — is APOSTLE RIG keyed?");
          report.status = "partial";
        }
        // radius that guarantees frame cover, corner to corner
        var R = Math.sqrt(master.width * master.width + master.height * master.height) / 2 + 40;

        for (var w = 0; w < wins.length; w++) {
          var t0 = wins[w].t0, t1 = wins[w].t1;
          var tm = (t0 + t1) / 2;
          var cA = tm - TRANS.holdDur / 2 - TRANS.closeDur;  // disc starts closing
          var cB = tm - TRANS.holdDur / 2;                   // fully covered
          var rA = tm + TRANS.holdDur / 2;                   // starts opening
          var rB = tm + TRANS.holdDur / 2 + TRANS.openDur;   // fully open
          if (cA < 0) cA = 0;

          var d = transDisc(master, "TRANS DISC " + (w + 1), pal, masterName);
          d.size.setValueAtTime(cA, [0, 0]);
          d.size.setValueAtTime(cB, [R * 2, R * 2]);
          easeAllKeys(d.size, 80, 80);
          applyEaseExpression(d.size, "inOutExpo");

          // the opening hole: one mask, expansion keyed
          var mk = d.layer.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
          mk.name = "iris";
          mk.maskMode = MaskMode.SUBTRACT;
          var sh = new Shape();
          // LAYER space, not comp space: the shape layer's anchor is [0,0]
          // and its position is comp centre, so the mask origin is 0,0.
          // Using comp centre here opened the iris from the bottom-right
          // corner instead of the middle of the frame.
          var r0 = 6, cx = 0, cy = 0;
          sh.vertices = [[cx, cy - r0], [cx + r0, cy], [cx, cy + r0], [cx - r0, cy]];
          sh.inTangents = [[-r0 * 0.55, 0], [0, -r0 * 0.55], [r0 * 0.55, 0], [0, r0 * 0.55]];
          sh.outTangents = [[r0 * 0.55, 0], [0, r0 * 0.55], [-r0 * 0.55, 0], [0, -r0 * 0.55]];
          sh.closed = true;
          mk.property("ADBE Mask Shape").setValue(sh);
          var exp = mk.property("ADBE Mask Offset");
          exp.setValueAtTime(rA, 0);
          exp.setValueAtTime(rB, R);
          easeAllKeys(exp, 80, 80);
          applyEaseExpression(exp, "inOutExpo");

          d.layer.inPoint = cA;
          d.layer.outPoint = rB;

          // the mark rides on top for the whole cover
          var ic = transIcon(master, "TRANS MARK " + (w + 1), pal, masterName);
          var itr = ic.property("ADBE Transform Group");
          var op = itr.property("ADBE Opacity");
          op.setValueAtTime(cA, 0);
          op.setValueAtTime(cA + 0.22, 100);
          op.setValueAtTime(rB - 0.24, 100);
          op.setValueAtTime(rB, 0);
          easeAllKeys(op, 70, 70);
          var sc = itr.property("ADBE Scale");
          sc.setValueAtTime(cA, [78, 78]);
          sc.setValueAtTime(cB, [100, 100]);
          sc.setValueAtTime(rA, [100, 100]);
          sc.setValueAtTime(rB, [124, 124]);
          easeAllKeys(sc, 80, 80);
          applyEaseExpression(sc, "inOutExpo");
          ic.inPoint = cA;
          ic.outPoint = rB;

          // both above every scene plane
          d.layer.moveToBeginning();
          ic.moveToBeginning();

          report.transits.push({ n: w + 1, t0: Math.round(t0 * 100) / 100, t1: Math.round(t1 * 100) / 100,
                                 cover: Math.round(cA * 100) / 100, open: Math.round(rB * 100) / 100 });
        }
      } finally { app.endUndoGroup(); }
      return toJSON(report);
    } catch (e) { return errJSON("applyTransitions", e); }
  }

  // ---------------------------------------------------------------
  // SKIN — backdrop + palette + typography swap on a built master
  //
  // The build already links every BG solid and moment fill to CONTROL, and
  // reads fonts off the FONT guide layers, so colour/type re-skinning is just
  // setting those. What CONTROL cannot express is a *textured* backdrop: the
  // client reference was a yellow gradient with a diagonal white beacon
  // sweep and scattered confetti. That gets built once as a shared comp and
  // dropped in behind every BG, so one edit repaints the whole video.
  // ---------------------------------------------------------------

  var BACKDROP_TAG = "apostle backdrop";

  // deterministic scatter — no Math.random, so a rebuild is byte-identical
  function skinRand(seed) {
    var x = Math.sin(seed * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  }

  // The backdrop is a set of 3D planes living BEHIND the station corridor, not
  // a flat 2D card. Each plane follows the rig at a slightly different rate, so
  // a camera transit slides them past each other and the background reads as
  // depth rather than wallpaper. Built oversize because perspective magnifies
  // anything sitting further from the camera than the stations do.
  var BACKDROP_OVERSIZE = 4;

  function skinRampOn(layer, w, h, spec) {
    var from = hexToRGB(spec.from || "#FDFD3C");
    var to = hexToRGB(spec.to || "#FDFDAD");
    var ramp = layer.property("ADBE Effect Parade").addProperty("ADBE Ramp");
    var ang = (spec.angleDeg === undefined) ? 28 : spec.angleDeg;
    var rad = ang * Math.PI / 180;
    var cx = w / 2, cy = h / 2;
    var reach = (Math.abs(Math.cos(rad)) * w + Math.abs(Math.sin(rad)) * h) / 2;
    ramp.property("ADBE Ramp-0001").setValue([cx - Math.cos(rad) * reach, cy + Math.sin(rad) * reach]);
    ramp.property("ADBE Ramp-0002").setValue(from);
    ramp.property("ADBE Ramp-0003").setValue([cx + Math.cos(rad) * reach, cy - Math.sin(rad) * reach]);
    ramp.property("ADBE Ramp-0004").setValue(to);
    try { ramp.property("ADBE Ramp-0005").setValue(1); } catch (eS) {}
  }

  function buildBackdropComp(name, w, h, spec, fps) {
    var existing = findComp(name);
    if (existing) existing.remove();
    var W = w * BACKDROP_OVERSIZE, H = h * BACKDROP_OVERSIZE;
    var comp = app.project.items.addComp(name, W, H, 1, 12, fps || 25);
    var base = comp.layers.addSolid(hexToRGB(spec.from || "#FDFD3C"), "GRADIENT", W, H, 1, comp.duration);
    base.startTime = 0;
    skinRampOn(base, W, H, spec);
    if (spec.beacon !== false) {
      var ang = (spec.angleDeg === undefined) ? 28 : spec.angleDeg;
      var bw = Math.sqrt(W * W + H * H) * 1.2;
      var beam = comp.layers.addSolid(hexToRGB(spec.beaconColor || "#FFFFFF"),
        "BEACON", Math.round(bw), 6, 1, comp.duration);
      beam.startTime = 0;
      beam.property("ADBE Transform Group").property("ADBE Position").setValue([W / 2, H / 2]);
      beam.property("ADBE Transform Group").property("ADBE Rotate Z").setValue(-ang);
      beam.property("ADBE Transform Group").property("ADBE Opacity").setValue(88);
      try {
        var fea = beam.property("ADBE Effect Parade").addProperty("ADBE Box Blur2");
        fea.property("ADBE Box Blur2-0001").setValue(4);
      } catch (eB) {}
    }
    return comp;
  }

  // One confetti field. seed shifts the scatter so the three depth layers
  // never sit on top of each other.
  function buildConfettiComp(name, w, h, spec, fps, seed, count, sizeK) {
    var existing = findComp(name);
    if (existing) existing.remove();
    var W = w * BACKDROP_OVERSIZE, H = h * BACKDROP_OVERSIZE;
    var comp = app.project.items.addComp(name, W, H, 1, 12, fps || 25);
    var sl = comp.layers.addShape();
    sl.name = "CONFETTI";
    sl.startTime = 0;
    var root = sl.property("ADBE Root Vectors Group");
    var col = hexToRGB(spec.confettiColor || "#F4E32A");
    for (var i = 0; i < count; i++) {
      var rx = skinRand(i + seed + 1.7), ry = skinRand(i + seed + 11.3);
      var rs = skinRand(i + seed + 27.1), rr = skinRand(i + seed + 41.9);
      var px = (rx - 0.5) * W * 0.98;
      var py = (ry - 0.5) * H * 0.98;
      var sz = (7 + rs * 30) * (sizeK || 1);
      var g = root.addProperty("ADBE Vector Group");
      g.name = "c" + (i + 1);
      var c = g.property("ADBE Vectors Group");
      var r0 = c.addProperty("ADBE Vector Shape - Rect");
      r0.property("ADBE Vector Rect Size").setValue([sz, sz]);
      r0.property("ADBE Vector Rect Position").setValue([px, py]);
      if (rr < 0.55) {
        var fl = c.addProperty("ADBE Vector Graphic - Fill");
        fl.property("ADBE Vector Fill Color").setValue([col[0], col[1], col[2], 1]);
        fl.property("ADBE Vector Fill Opacity").setValue(38 + rs * 50);
      } else {
        var st2 = c.addProperty("ADBE Vector Graphic - Stroke");
        st2.property("ADBE Vector Stroke Color").setValue([col[0], col[1], col[2], 1]);
        st2.property("ADBE Vector Stroke Width").setValue(2.5);
        st2.property("ADBE Vector Stroke Opacity").setValue(42 + rs * 45);
      }
      g.property("ADBE Vector Transform Group").property("ADBE Vector Rotation").setValue(rr * 90);
    }
    return comp;
  }

  // Place a depth plane in the master: 3D, pushed back in z, tracking the rig
  // at (1 - lag) so it drifts against the foreground during a transit. The
  // drift is centred on the corridor midpoint so the plane never runs out of
  // coverage at either end. `wob` adds a slow float so it breathes when the
  // camera is parked on a station.
  function attachDepthLayer(master, srcComp, name, z, lag, midX, wob, seed) {
    for (var i = master.numLayers; i >= 1; i--) {
      if (master.layer(i).comment === BACKDROP_TAG && master.layer(i).name === name) master.layer(i).remove();
    }
    var lay = master.layers.add(srcComp);
    lay.name = name;
    lay.comment = BACKDROP_TAG;
    lay.startTime = 0;
    lay.label = 8;
    lay.threeDLayer = true;
    // Lengthen the SOURCE, do not stretch the layer. AE clamps a precomp
    // layer's outPoint to its source duration, so the old order (set
    // outPoint, then stretch) silently left the backdrop short — VIDEO_001
    // ran 183.28s with the gradient stopping at 160.96s, i.e. the last 22
    // seconds played against the flat MASTER BG with no gradient or beacon.
    try { if (srcComp.duration < master.duration) srcComp.duration = master.duration; } catch (eD) {}
    try { lay.outPoint = master.duration; } catch (eO) {}
    var expr =
      'var r = thisComp.layer("APOSTLE RIG").transform.position;\n' +
      'var mid = ' + midX + ';\n' +
      'var lag = ' + lag + ';\n' +
      'var w = ' + wob + ';\n' +
      'var s = ' + seed + ';\n' +
      '[ r[0] - (r[0]-mid)*lag + Math.sin(time*0.13+s)*w,\n' +
      '  r[1] + Math.cos(time*0.11+s)*w*0.6,\n' +
      '  ' + z + ' ]';
    try { lay.property("ADBE Transform Group").property("ADBE Position").expression = expr; } catch (eE) {}
    lay.moveToEnd();
    return lay;
  }

  // corridor midpoint, read off the actual station planes
  function corridorMidX(master) {
    var lo = null, hi = null;
    for (var i = 1; i <= master.numLayers; i++) {
      var L = master.layer(i);
      if (!(L.source instanceof CompItem)) continue;
      if (L.comment === BACKDROP_TAG) continue;
      if (L.name.indexOf("AUDIO") >= 0) continue;
      var x = L.property("ADBE Transform Group").property("ADBE Position").value[0];
      if (lo === null || x < lo) lo = x;
      if (hi === null || x > hi) hi = x;
    }
    if (lo === null) return master.width / 2;
    return (lo + hi) / 2;
  }

  function applySkin(masterName, skinJSON) {
    try {
      var spec = parseJSONSafe(skinJSON);
      if (!spec) return toJSON({ status: "error", error: "skin JSON did not parse" });
      var master = findComp(masterName);
      if (!master) return toJSON({ status: "error", error: "Comp not found: " + masterName });
      var report = { status: "success", master: masterName, comps: [], warnings: [] };

      app.beginUndoGroup("Apostle applySkin");
      try {
        // 1. CONTROL colours — every BG and moment fill expression reads these
        var ctrl = findLayer(master, "CONTROL");
        if (ctrl && spec.colors) {
          var map = { Primary: "primary", Secondary: "secondary", Background: "background", "Text Color": "text", Surface: "surface" };
          for (var k in map) {
            if (!map.hasOwnProperty(k)) continue;
            var hex = spec.colors[map[k]];
            if (!hex && k === "Surface") hex = "#FFFFFF";
            if (!hex) continue;
            // older builds predate the Surface control — add it on demand
            if (k === "Surface") {
              var has = null;
              try { has = ctrl.property("ADBE Effect Parade").property("Surface"); } catch (eH) { has = null; }
              if (!has) { try { addColor(ctrl, "Surface", hexToRGB(hex)); } catch (eA) {} }
            }
            try {
              ctrl.property("ADBE Effect Parade").property(k).property("ADBE Color Control-0001").setValue(hexToRGB(hex));
              report.comps.push("CONTROL." + k + " = " + hex);
            } catch (eC) { report.warnings.push("CONTROL slider '" + k + "' not set: " + eC.toString()); }
          }
        }

        // 2. fonts — master-controlled via the FONT guide layers
        if (spec.fontHeadingPS || spec.fontBodyPS) {
          var fh = findLayer(master, "FONT Heading"), fb = findLayer(master, "FONT Body");
          if (fh && spec.fontHeadingPS) fh.property("Source Text").setValue(spec.fontHeadingPS);
          if (fb && spec.fontBodyPS) fb.property("Source Text").setValue(spec.fontBodyPS);
          report.comps.push("fonts -> " + spec.fontHeadingPS + " / " + spec.fontBodyPS);
        }

        // 3. backdrop
        if (spec.backdrop && spec.backdrop.style === "gradient") {
          var bdSpec = spec.backdrop;
          var midX = corridorMidX(master);
          var folder = null;
          try { folder = master.parentFolder; } catch (eF) { folder = null; }

          // Clear the whole depth stack first. attachDepthLayer only replaces
          // a layer of the SAME name, so switching confetti off used to leave
          // the existing CONFETTI 1/2/3 layers in place and the setting looked
          // like it did nothing.
          var dropped = 0;
          for (var dz = master.numLayers; dz >= 1; dz--) {
            if (master.layer(dz).comment === BACKDROP_TAG) { master.layer(dz).remove(); dropped++; }
          }
          if (dropped > 0) report.comps.push("cleared " + dropped + " existing depth layer(s)");

          var bd = buildBackdropComp(masterName + " BACKDROP", master.width, master.height, bdSpec, master.frameRate);
          if (folder) { try { bd.parentFolder = folder; } catch (eP) {} }
          attachDepthLayer(master, bd, "BACKDROP", 2600, 0.04, midX, 10, 0.0);
          report.comps.push("backdrop plane z=2600 lag=0.04 mid=" + Math.round(midX));

          if (bdSpec.confetti !== false) {
            // three fields at different depths — the differential rates are
            // what sell the 3D; one field at one depth just slides.
            // sizes/counts are pre-compensated for perspective: a field at
            // z sits (z+camGap)/camGap further away than the stations, so it
            // renders that much smaller. Only ~a third of each oversize field
            // is ever in shot, hence the counts.
            var fields = [
              { z: 1900, lag: 0.055, n: 74, k: 3.1, wob: 16, seed: 3.1 },
              { z: 1000, lag: 0.035, n: 58, k: 2.4, wob: 12, seed: 17.7 },
              { z: 300, lag: 0.018, n: 40, k: 1.7, wob: 9, seed: 29.3 }
            ];
            for (var fi = 0; fi < fields.length; fi++) {
              var F = fields[fi];
              var cc = buildConfettiComp(masterName + " CONFETTI " + (fi + 1), master.width, master.height,
                bdSpec, master.frameRate, F.seed, F.n, F.k);
              if (folder) { try { cc.parentFolder = folder; } catch (eP2) {} }
              attachDepthLayer(master, cc, "CONFETTI " + (fi + 1), F.z, F.lag, midX, F.wob, F.seed);
              report.comps.push("confetti field " + (fi + 1) + " z=" + F.z + " lag=" + F.lag);
            }
          }

          // scene planes go transparent so the depth stack reads through them
          for (var L = 1; L <= master.numLayers; L++) {
            var sl2 = master.layer(L);
            if (!(sl2.source instanceof CompItem)) continue;
            if (sl2.comment === BACKDROP_TAG) continue;
            if (sl2.name.indexOf("AUDIO") >= 0) continue;
            var sc2 = sl2.source;
            for (var q = sc2.numLayers; q >= 1; q--) {
              if (sc2.layer(q).comment === BACKDROP_TAG) sc2.layer(q).remove();
            }
            var sbg = findLayer(sc2, "BG");
            if (sbg) sbg.enabled = false;
          }
          // flat solid stays at the very back as the last-resort fill
          var mbg = findLayer(master, "MASTER BG");
          if (mbg) { mbg.enabled = true; mbg.moveToEnd(); }
        }
      } catch (e) {
        report.status = "error";
        report.error = e.toString();
      } finally {
        app.endUndoGroup();
      }
      return toJSON(report);
    } catch (e2) { return errJSON("applySkin", e2); }
  }

  function findItemFolder(comp) {
    try { return comp.parentFolder; } catch (e) { return null; }
  }

  // ---------------------------------------------------------------

  return {
    version: LIB_VERSION,
    applySkin: applySkin,
    applyMoments: applyMoments,
    importAssets: importAssets,
    drawGlyph: drawGlyph,
    drawTile: drawTile,
    drawBadge: drawBadge,
    buildInstructional: buildInstructional,
    applyTransitions: applyTransitions,
    getProjectInfo: getProjectInfo,
    listComps: listComps,
    extractDesignSpec: extractDesignSpec,
    captureCompReference: captureCompReference,
    duplicateForRedesign: duplicateForRedesign,
    applyRebuildPlan: applyRebuildPlan,
    toJSON: toJSON,
    findBeatComp: findBeatComp,
    updateBeatText: updateBeatText,
    retimeBeats: retimeBeats,
    applyBeatStructure: applyBeatStructure,
    rebuildBeatScene: rebuildBeatScene,
    applyHandheldPolish: applyHandheldPolish,
    applyEaseExpression: applyEaseExpression,
    renderMovie: renderMovie,
    hashCompState: hashCompState,
    findMasterComps: findMasterComps,
    listFonts: listFonts,
    readTypography: readTypography,
    applyTypography: applyTypography,
    readBrandColors: readBrandColors,
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
