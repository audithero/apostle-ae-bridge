// Apostle Fonts — master typography panel (ES3)
//
// One place to drive the whole build's type: font family + weight for
// Heading and Body (written to the FONT Heading / FONT Body guide layers
// as PostScript names), plus Size and Tracking (written to the CONTROL
// sliders). "Load" pulls the comp's current values; "Sync" pushes the
// panel's values to the comp. Every linked text layer follows live via
// its style expression — the panel never touches individual text layers.
//
// Run ways:
//   - File > Scripts > Run Script File...  -> floating palette
//   - scripts/ae-run.sh apostle/apostle-fonts-panel.jsx  -> floating palette
//   - installed stub in ScriptUI Panels (scripts/install-fonts-panel.sh)
//     -> dockable panel in the Window menu
(function (thisObj) {

  // When launched via the ScriptUI Panels stub, the stub records the real
  // Panel object and the repo path before evalFile-ing this script.
  var host = ($.global.APOSTLE_FONTS_HOST !== undefined) ? $.global.APOSTLE_FONTS_HOST : thisObj;
  $.global.APOSTLE_FONTS_HOST = undefined;

  function repoApostleDir() {
    if ($.global.APOSTLE_REPO_DIR) return String($.global.APOSTLE_REPO_DIR);
    return new File($.fileName).parent.fsName;
  }

  if (typeof $.global.APOSTLE === "undefined") {
    var lib = new File(repoApostleDir() + "/apostle.jsx");
    if (lib.exists) $.evalFile(lib);
  }
  if (typeof $.global.APOSTLE === "undefined") {
    alert("Apostle Fonts: could not load apostle.jsx next to this script.");
    return;
  }
  var A = $.global.APOSTLE;
  var FONTS = A.listFonts(); // [] when app.fonts is unavailable -> manual PS entry

  var win = (host instanceof Panel) ? host : new Window("palette", "Apostle Fonts v" + A.version, undefined, { resizeable: true });
  win.orientation = "column";
  win.alignChildren = ["fill", "top"];
  win.spacing = 6;
  win.margins = 10;

  // --- master comp picker ------------------------------------------------
  var compRow = win.add("group");
  compRow.add("statictext", undefined, "Master comp");
  var compDD = compRow.add("dropdownlist", undefined, []);
  compDD.preferredSize.width = 220;
  var refreshBtn = compRow.add("button", undefined, "Refresh");
  refreshBtn.preferredSize.width = 60;

  // --- one role block (Heading / Body) -----------------------------------
  function roleBlock(title) {
    var p = win.add("panel", undefined, title);
    p.orientation = "column";
    p.alignChildren = ["fill", "top"];
    p.margins = 10;
    p.spacing = 4;
    var b = { famDD: null, styleDD: null, psET: null, sizeET: null, trackET: null };

    if (FONTS.length > 0) {
      var r1 = p.add("group");
      r1.add("statictext", undefined, "Font");
      b.famDD = r1.add("dropdownlist", undefined, []);
      b.famDD.preferredSize.width = 170;
      b.styleDD = r1.add("dropdownlist", undefined, []);
      b.styleDD.preferredSize.width = 120;
      for (var i = 0; i < FONTS.length; i++) b.famDD.add("item", FONTS[i].family);
    }

    var r2 = p.add("group");
    r2.add("statictext", undefined, "PostScript");
    b.psET = r2.add("edittext", undefined, "");
    b.psET.preferredSize.width = 240;

    var r3 = p.add("group");
    r3.add("statictext", undefined, "Size");
    b.sizeET = r3.add("edittext", undefined, "");
    b.sizeET.preferredSize.width = 50;
    r3.add("statictext", undefined, "Tracking");
    b.trackET = r3.add("edittext", undefined, "");
    b.trackET.preferredSize.width = 50;

    if (b.famDD) {
      b.famDD.onChange = function () {
        var fam = FONTS[b.famDD.selection.index];
        b.styleDD.removeAll();
        for (var j = 0; j < fam.styles.length; j++) b.styleDD.add("item", fam.styles[j].style);
        b.styleDD.selection = 0;
      };
      b.styleDD.onChange = function () {
        if (b.famDD.selection === null || b.styleDD.selection === null) return;
        b.psET.text = FONTS[b.famDD.selection.index].styles[b.styleDD.selection.index].ps;
      };
    }
    return b;
  }

  var heading = roleBlock("Heading");
  var body = roleBlock("Body");

  // --- actions -----------------------------------------------------------
  var btnRow = win.add("group");
  btnRow.alignment = "fill";
  var loadBtn = btnRow.add("button", undefined, "Load from comp");
  var syncBtn = btnRow.add("button", undefined, "Sync to comp");
  var status = win.add("statictext", undefined, "", { truncate: "end" });
  status.alignment = "fill";

  function say(msg) { status.text = msg; }

  function selectedComp() {
    return (compDD.selection !== null) ? compDD.selection.text : null;
  }

  // Point the family/style dropdowns at a PS name (best-effort reverse lookup).
  function selectPS(block, ps) {
    block.psET.text = ps || "";
    if (!block.famDD || !ps) return;
    for (var i = 0; i < FONTS.length; i++) {
      for (var j = 0; j < FONTS[i].styles.length; j++) {
        if (FONTS[i].styles[j].ps === ps) {
          block.famDD.selection = i; // fires onChange, rebuilds styleDD
          block.styleDD.selection = j;
          return;
        }
      }
    }
  }

  function fmtNum(v) { return (v === null || v === undefined) ? "" : String(Math.round(v * 100) / 100); }

  function load() {
    var name = selectedComp();
    if (!name) { say("No master comp selected."); return; }
    var t = A.readTypography(name);
    if (t.status !== "success") { say(t.error); return; }
    selectPS(heading, t.headingFont);
    selectPS(body, t.bodyFont);
    heading.sizeET.text = fmtNum(t.headingSize);
    heading.trackET.text = fmtNum(t.headingTracking);
    body.sizeET.text = fmtNum(t.bodySize);
    body.trackET.text = fmtNum(t.bodyTracking);
    say("Loaded from " + name);
  }

  function num(et) {
    var s = et.text.replace(/^\s+|\s+$/g, "");
    if (s === "" || isNaN(Number(s))) return null;
    return Number(s);
  }

  function sync() {
    var name = selectedComp();
    if (!name) { say("No master comp selected."); return; }
    var r = A.applyTypography(name, {
      headingFont: heading.psET.text,
      bodyFont: body.psET.text,
      headingSize: num(heading.sizeET),
      headingTracking: num(heading.trackET),
      bodySize: num(body.sizeET),
      bodyTracking: num(body.trackET)
    });
    if (r.status !== "success") { say(r.error); return; }
    say(r.warnings.length > 0 ? r.warnings[0] : "Synced " + r.applied.length + " properties to " + name);
  }

  function refreshComps() {
    var keep = selectedComp();
    compDD.removeAll();
    var names = A.findMasterComps();
    for (var i = 0; i < names.length; i++) compDD.add("item", names[i]);
    if (names.length === 0) { say("No master comps in project (need CONTROL + FONT layers)."); return; }
    compDD.selection = 0;
    if (keep !== null) {
      for (var k = 0; k < names.length; k++) if (names[k] === keep) compDD.selection = k;
    }
    load();
  }

  compDD.onChange = function () { if (compDD.selection !== null) load(); };
  refreshBtn.onClick = refreshComps;
  loadBtn.onClick = load;
  syncBtn.onClick = sync;

  refreshComps();

  win.onResizing = win.onResize = function () { this.layout.resize(); };
  if (win instanceof Window) {
    win.center();
    win.show();
    $.global.APOSTLE_FONTS_WIN = win; // keep palette alive after script scope ends
  } else {
    win.layout.layout(true);
  }
})(this);
