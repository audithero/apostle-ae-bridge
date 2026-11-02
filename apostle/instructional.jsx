// instructional.jsx: the "instructional" stage (v2.20). ES3 ExtendScript.
//
// Builds one 2D master comp from a timeline compiled by
// scripts/lib/compile-instructional.cjs. Where the corridor stage is a camera
// flying between isolated scene planes, this is a persistent layout that
// changes state: headline + step progress on the left, items that build on
// their spoken cue, the phone (real app screens, highlight rings, do/don't
// badges) or a demo prop on the right, yellow chapter cards between steps,
// and burnt-in captions for every word of the VO.
//
// Requires apostle.jsx loaded first ($.global.APOSTLE: drawGlyph/drawTile/
// drawBadge). Entry: $.global.APOSTLE_INSTR.build(timelinePath) -> JSON.
// Traps from CLAUDE.md apply: startTime = 0 on every new layer (#2), no
// chained ternaries (#1), no property handle spans an addProperty (#6).

(function () {
  var W = 1920, H = 1080, LX = 120;
  var T, C, F, HX, comp, report;
  // every master-comp layer is tagged with the section it belongs to, so the
  // finished build can be folded into one precomp per section (organise)
  var GROUP = "MISC";
  var PHONE = { x: 1430, y: 528, w: 372, h: 778, bezel: 12, r: 54 };
  var PROP = { x: 1430, y: 500 };
  var CAP = { y: 1008, h: 58, size: 29 };
  // the logo: one layer over everything, every card included, its bottom
  // right corner on the margins (CBA, 2026-10-14: twice the old 88px)
  var LOGO = { h: 170, right: W - LX, bottom: H - 56 };
  var HEAD_TRACK = -20; // headings: CBA Beacon Sans Black, tracked -20 (CBA, 2026-10-14)
  var SLOT = { top: 540, h: 92, step: 108, wList: 600, wGrid: 404, gapGrid: 20 };

  // ---------------------------------------------------------------- utils
  function rd(p) { var f = new File(p); f.encoding = "UTF-8"; f.open("r"); var s = f.read(); f.close(); return s; }
  function tr(l) { return l.property("ADBE Transform Group"); }
  function P(l) { return tr(l).property("ADBE Position"); }
  function O(l) { return tr(l).property("ADBE Opacity"); }
  function S(l) { return tr(l).property("ADBE Scale"); }
  function Rz(l) { return tr(l).property("ADBE Rotate Z"); }
  function fresh(l, name) { l.startTime = 0; l.name = name; l.comment = "apostle instr|" + GROUP; return l; }
  function hide(l) { O(l).setValue(0); return l; }

  // Ease by key: "out" = expo-ish arrival (fast leave, long settle),
  // "in" = slow leave, quick arrival (exits), "io" = symmetric.
  var EASE = { out: [10, 88], "in": [82, 12], io: [62, 62], snap: [6, 70] };
  // ease arrays must match the PROPERTY's dimensions (Scale is always 3D,
  // even when it is set with two values); spatial props take one ease
  function dims(prop) {
    var t = prop.propertyValueType;
    if (t === PropertyValueType.ThreeD) return 3;
    if (t === PropertyValueType.TwoD) return 2;
    return 1;
  }
  // segs: [[t0, v0, t1, v1, ease], ...] all on one property. A key shared by
  // two segments takes the arriving segment's in-ease and the leaving one's
  // out-ease.
  function anim(prop, segs) {
    var keys = {}, order = [], i, k;
    function want(t, v) {
      var id = Math.round(t * 1000);
      if (!keys[id]) { keys[id] = { t: t, v: v, inf: 33, outf: 33 }; order.push(id); }
      return keys[id];
    }
    for (i = 0; i < segs.length; i++) {
      var s = segs[i], e = EASE[s[4] || "out"];
      var a = want(s[0], s[1]), b = want(s[2], s[3]);
      a.outf = e[0]; b.inf = e[1];
    }
    for (i = 0; i < order.length; i++) { k = keys[order[i]]; prop.setValueAtTime(k.t, k.v); }
    for (i = 0; i < order.length; i++) {
      k = keys[order[i]];
      var idx = prop.nearestKeyIndex(k.t);
      var n = dims(prop), ein = [], eout = [];
      for (var d = 0; d < n; d++) { ein.push(new KeyframeEase(0, k.inf)); eout.push(new KeyframeEase(0, k.outf)); }
      try { prop.setTemporalEaseAtKey(idx, ein, eout); } catch (eE) {}
    }
  }
  function add(p, d) { return [p[0] + d[0], p[1] + d[1]]; }

  // standard reveal: fade + drift in, fade + drift out; trims the layer
  function show(l, tIn, tOut, o) {
    o = o || {};
    var p = P(l).value, dur = o.dur || 0.55, ex = o.exit || 0.32;
    var from = o.from || [0, 26], to = o.to || [0, -18];
    var pos = [[tIn, add(p, from), tIn + dur, p, o.ease || "out"]];
    var op = [[tIn, 0, tIn + dur * 0.7, o.opacity || 100, "out"]];
    var end = (tOut !== null && tOut !== undefined && tOut < T.duration - 0.05);
    if (end) {
      pos.push([tOut - ex, p, tOut, add(p, to), "in"]);
      op.push([tOut - ex, o.opacity || 100, tOut, 0, "in"]);
    }
    anim(P(l), pos);
    anim(O(l), op);
    if (o.scaleFrom) {
      var sc = S(l).value;
      anim(S(l), [[tIn, [sc[0] * o.scaleFrom, sc[1] * o.scaleFrom, 100], tIn + dur, sc, o.ease || "out"]]);
    }
    l.inPoint = Math.max(0, tIn - 0.02);
    if (end) l.outPoint = tOut + 0.02;
    l.motionBlur = true;
    return l;
  }

  // ---------------------------------------------------------------- drawing
  function txt(name, str, font, size, color, x, y, o) {
    o = o || {};
    // lowercase films: captions are all lowercase, every other line is
    // sentence case (CBA, 2026-10-14); multi-line headings arrive already
    // cased by headingCase and pass keepCase
    if (T.textCase === "lower" && !o.keepCase) str = o.lowerOnly ? String(str).toLowerCase() : headingCase([str])[0];
    var l = fresh(comp_(o.into).layers.addText(str), name);
    var dp = l.property("ADBE Text Properties").property("ADBE Text Document");
    for (var a = 0; a < 2; a++) {
      try {
        var d = dp.value;
        d.resetCharStyle();
        d.font = font; d.fontSize = size; d.fillColor = color; d.applyFill = true; d.applyStroke = false;
        d.tracking = o.tracking || 0;
        if (o.leading) { d.autoLeading = false; d.leading = o.leading; }
        if (o.center) { d.justification = ParagraphJustification.CENTER_JUSTIFY; }
        else { d.justification = ParagraphJustification.LEFT_JUSTIFY; }
        dp.setValue(d);
        break;
      } catch (eT) { if (a === 1) report.warnings.push("text style failed on " + name + ": " + eT); }
    }
    P(l).setValue([x, y]);
    return l;
  }
  function comp_(c) { return c || comp; }
  function textWidth(str, font, size, tracking, o) {
    if (!str) return 0;
    o = o || {};
    var l = txt("MEASURE", str, font, size, [0, 0, 0], 0, 0, { tracking: tracking, keepCase: o.keepCase, lowerOnly: o.lowerOnly });
    var w = l.sourceRectAtTime(0, false).width;
    l.remove();
    return w;
  }

  // headings in a lowercase film are sentence case (CBA, 2026-10-14): a
  // capital only where a sentence starts, which carries across the lines of
  // one heading (["Add your", "contact details"]) and restarts after . ! ?
  function headingCase(lines) {
    if (T.textCase !== "lower") return lines;
    var out = [], start = true;
    for (var i = 0; i < lines.length; i++) {
      var s = String(lines[i]).toLowerCase().replace(/([.!?]\s+)([a-z])/g, function (m, a, b) { return a + b.toUpperCase(); });
      if (start) s = s.replace(/[a-z]/, function (c) { return c.toUpperCase(); });
      out.push(s);
      start = /[.!?]\s*$/.test(s);
    }
    return out;
  }

  function shapeLayer(name, into) {
    var l = fresh(comp_(into).layers.addShape(), name);
    return l;
  }
  // one rounded rect (or ellipse) per layer, re-reading every handle
  // after each addProperty (trap #6)
  function box(name, w, h, r, fill, stroke, sw, x, y, o) {
    o = o || {};
    var l = shapeLayer(name, o.into);
    var root = l.property("ADBE Root Vectors Group");
    root.addProperty("ADBE Vector Group");
    function vec() { return l.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group"); }
    function byMN(mn) { var v = vec(); for (var i = 1; i <= v.numProperties; i++) if (v.property(i).matchName === mn) return v.property(i); return null; }
    var shapeMN = o.ellipse ? "ADBE Vector Shape - Ellipse" : "ADBE Vector Shape - Rect";
    vec().addProperty(shapeMN);
    if (fill) vec().addProperty("ADBE Vector Graphic - Fill");
    if (stroke) vec().addProperty("ADBE Vector Graphic - Stroke");
    var sh = byMN(shapeMN);
    if (o.ellipse) { sh.property("ADBE Vector Ellipse Size").setValue([w, h]); }
    else {
      sh.property("ADBE Vector Rect Size").setValue([w, h]);
      if (r) sh.property("ADBE Vector Rect Roundness").setValue(r);
    }
    if (fill) byMN("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue(fill);
    if (stroke) {
      var st = byMN("ADBE Vector Graphic - Stroke");
      st.property("ADBE Vector Stroke Color").setValue(stroke);
      st.property("ADBE Vector Stroke Width").setValue(sw || 2);
    }
    if (o.anchorLeft) {
      // grow from the left edge (highlight bars, progress)
      sh = byMN(shapeMN);
      sh.property(o.ellipse ? "ADBE Vector Ellipse Position" : "ADBE Vector Rect Position").setValue([w / 2, 0]);
    }
    P(l).setValue([x, y]);
    return l;
  }
  function dotted(name, x0, y0, x1, y1, color, into) {
    var l = shapeLayer(name, into);
    // vertices are layer-space: pin the layer to the comp origin, or they
    // inherit the default centre position and land half a comp away
    P(l).setValue([0, 0]);
    l.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
    function vec() { return l.property("ADBE Root Vectors Group").property(1).property("ADBE Vectors Group"); }
    vec().addProperty("ADBE Vector Shape - Group");
    vec().addProperty("ADBE Vector Graphic - Stroke");
    vec().addProperty("ADBE Vector Filter - Trim");
    var v = vec(), sp = null, st = null, tm = null;
    for (var i = 1; i <= v.numProperties; i++) {
      var mn = v.property(i).matchName;
      if (mn === "ADBE Vector Shape - Group") sp = v.property(i);
      if (mn === "ADBE Vector Graphic - Stroke") st = v.property(i);
    }
    var s = new Shape(); s.vertices = [[x0, y0], [x1, y1]]; s.closed = false;
    sp.property("ADBE Vector Shape").setValue(s);
    st.property("ADBE Vector Stroke Color").setValue(color);
    st.property("ADBE Vector Stroke Width").setValue(4);
    st.property("ADBE Vector Stroke Line Cap").setValue(2);
    function stroke() { var vv = vec(); for (var q = 1; q <= vv.numProperties; q++) if (vv.property(q).matchName === "ADBE Vector Graphic - Stroke") return vv.property(q); return null; }
    try {
      stroke().property("ADBE Vector Stroke Dashes").addProperty("ADBE Vector Stroke Dash 1");
      stroke().property("ADBE Vector Stroke Dashes").addProperty("ADBE Vector Stroke Gap 1");
      stroke().property("ADBE Vector Stroke Dashes").property("ADBE Vector Stroke Dash 1").setValue(1);
      stroke().property("ADBE Vector Stroke Dashes").property("ADBE Vector Stroke Gap 1").setValue(12);
    } catch (eD) {}
    v = vec();
    for (var j = 1; j <= v.numProperties; j++) if (v.property(j).matchName === "ADBE Vector Filter - Trim") tm = v.property(j);
    return { layer: l, trim: tm.property("ADBE Vector Trim End") };
  }
  function shadowFor(target, w, h, r, x, y, into) {
    // soft card shadow: an ink box, 7% opacity, offset and blurred
    var s = box(target + " SHADOW", w, h, r, C.ink, null, 0, x, y + 8, { into: into });
    O(s).setValue(7);
    s.property("ADBE Effect Parade").addProperty("ADBE Gaussian Blur 2");
    s.property("ADBE Effect Parade").property(1).property("ADBE Gaussian Blur 2-0001").setValue(22);
    return s;
  }
  function pal(over) {
    var p = { ink: HX.ink, brand: HX.brand, paper: HX.paper, hole: HX.hole, muted: HX.muted };
    for (var k in over) if (over.hasOwnProperty(k)) p[k] = over[k];
    return p;
  }

  // ---------------------------------------------------------------- comps
  function footage(file) {
    var base = decodeURI(new File(file).name);
    for (var i = 1; i <= app.project.numItems; i++) {
      var it = app.project.item(i);
      if (it instanceof FootageItem && it.file && it.file.fsName === new File(file).fsName) return it;
    }
    var item = app.project.importFile(new ImportOptions(new File(file)));
    item.parentFolder = T._assets;
    return item;
  }
  function shotByName(name) {
    for (var i = 0; i < T.screens.length; i++) if (T.screens[i].name === name) return footage(T.screens[i].file);
    return null;
  }
  function subComp(name, w, h) {
    var c = app.project.items.addComp(name, w, h, 1, T.duration, T.fps);
    c.parentFolder = T._parts;
    return c;
  }
  function place(c, name, x, y) {
    var l = fresh(comp.layers.add(c), name);
    P(l).setValue([x, y]);
    l.motionBlur = true;
    return l;
  }

  // a brand icon: the client's own pictogram file when the kit has one (CBA
  // allows nothing else), else the drawn tile. Fit inside size x size.
  function icon(into, name, glyph, x, y, size, o) {
    o = o || {};
    var f = T.pictograms && T.pictograms[glyph];
    if (f && new File(f).exists) {
      var it = footage(f);
      var l = fresh(comp_(into).layers.add(it), name);
      var sc = size / Math.max(it.width, it.height) * 100;
      S(l).setValue([sc, sc]);
      P(l).setValue([x, y]);
      try { l.collapseTransformation = true; } catch (eC) {}
      return l;
    }
    if (T.pictogramsOnly) report.warnings.push("no pictogram for " + glyph + " (" + name + "); drew a tile");
    var t = o.bare ? APOSTLE.drawGlyph(comp_(into), name, glyph, x, y, size, pal(o.pal || {})) :
      APOSTLE.drawTile(comp_(into), name, glyph, x, y, size, pal(o.pal || {}));
    t.startTime = 0;
    t.comment = "apostle instr|" + GROUP;
    return t;
  }
  // x is the left edge, or the right edge with o.right; centred on y
  function logo(into, name, x, y, h, o) {
    o = o || {};
    if (!T.logo || !new File(T.logo).exists) {
      var bx = o.right ? x - 58 : x + 58;
      var lb = box(name + " BOX", 116, 40, 6, null, C.ink, 2, bx, y, { into: into });
      var lt = txt(name, "LOGO", F.bold, 15, C.ink, bx, y + 5, { center: true, tracking: 150, into: into, keepCase: true });
      return [lb, lt];
    }
    var it = footage(T.logo);
    var l = fresh(comp_(into).layers.add(it), name);
    var sc = h / it.height * 100;
    S(l).setValue([sc, sc]);
    var half = it.width * sc / 200;
    P(l).setValue([o.right ? x - half : x + half, y]);
    return [l];
  }

  // ---------------------------------------------------------------- top bar
  function topBar() {
    GROUP = "TOP BAR";
    var tIn = 0;
    for (var i = 0; i < T.cards.length; i++) if (T.cards[i].type === "title") tIn = T.cards[i].tOut - 0.3;
    if (T.label) show(txt("REVIEW LABEL", T.label, F.bold, 14, C.muted, LX + 90, 77, { tracking: 120 }), tIn + 0.08, null, { from: [0, -12] });
  }

  // built last, so it sits over the cards; arrives with the title card's type
  function logoMark() {
    GROUP = "LOGO";
    var lg = logo(null, "LOGO", LOGO.right, LOGO.bottom - LOGO.h / 2, LOGO.h, { right: true });
    for (var j = 0; j < lg.length; j++) {
      show(lg[j], 0.15, null, { from: [0, 12] });
      // off over pages whose art runs under the corner (plan.logoHide)
      var hs = T.logoHide || [];
      for (var k = 0; k < hs.length; k++) anim(O(lg[j]), [[hs[k][0] - 0.35, 100, hs[k][0], 0, "in"], [hs[k][1], 0, hs[k][1] + 0.35, 100, "out"]]);
    }
  }

  // ---------------------------------------------------------------- pages
  function page(pg) {
    var tIn = pg.tIn, tOut = pg.tOut;
    var ey = txt("P" + pg.id + " EYEBROW", pg.eyebrow, F.bold, 20, C.ink, LX, 262, { tracking: 140 });
    show(ey, tIn, tOut, { from: [0, 16] });
    if (pg.step) {
      var ew = ey.sourceRectAtTime(0, false).width;
      var x0 = LX + ew + 26;
      for (var i = 0; i < pg.total; i++) {
        var done = i < pg.step - 1, cur = i === pg.step - 1;
        var col = C.line;
        if (done) col = C.ink;
        if (cur) col = C.brand;
        var d = box("P" + pg.id + " PROGRESS " + (i + 1), 26, 6, 3, col, null, 0, x0 + i * 34, 255, { anchorLeft: true });
        show(d, tIn + 0.04 + i * 0.03, tOut, { from: [0, 0], to: [0, 0], dur: 0.3 });
        if (cur) anim(S(d), [[tIn + 0.35, [0, 100], tIn + 0.95, [100, 100], "out"]]);
      }
    }
    // headings: Black, tightly tracked, shrunk to fit short of the phone
    var size = 92, base1 = 356, lead = 96, maxW = 1060, widest = 0, hd = headingCase(pg.heading);
    for (var m = 0; m < hd.length; m++) widest = Math.max(widest, textWidth(hd[m], F.black, size, HEAD_TRACK, { keepCase: true }));
    if (widest > maxW) { size = Math.floor(size * maxW / widest); lead = Math.round(size * 1.04); }
    for (var li = 0; li < hd.length; li++) {
      var hl2 = txt("P" + pg.id + " HEADING " + (li + 1), hd[li], F.black, size, C.ink, LX, base1 + li * lead, { tracking: HEAD_TRACK, keepCase: true });
      show(hl2, tIn + 0.08 + li * 0.09, tOut, { from: [0, 40], dur: 0.7 });
    }
  }

  function slotXY(it) {
    if (it.layout === "grid") {
      var col = it.slot % 2, row = Math.floor(it.slot / 2);
      return { x: LX, y: SLOT.top + row * SLOT.step, w: SLOT.wGrid, col: col, xo: col * (SLOT.wGrid + SLOT.gapGrid) };
    }
    // a card on a numbered page sits under the page's full list of steps
    if (it.numAbove !== undefined) return { x: LX, y: 560 + it.numAbove * 64 + 10 + it.slot * SLOT.step, w: SLOT.wList, col: 0, xo: 0 };
    return { x: LX, y: SLOT.top + it.slot * SLOT.step, w: SLOT.wList, col: 0, xo: 0 };
  }
  function item(it) {
    var tIn = it.tIn, tOut = it.tOut, name = "ITEM " + it.n + " P" + it.page;
    if (it.kind === "num") {
      var y = 560 + it.slot * 64;
      var dot = box(name + " NUM", 38, 38, 0, C.ink, null, 0, LX + 19, y - 9, { ellipse: true });
      var nt = txt(name + " N", String(it.n), F.bold, 19, C.card, LX + 19, y - 2, { center: true });
      var tt = txt(name + " TEXT", it.title, F.regular, 28, C.ink, LX + 56, y, {});
      show(dot, tIn, tOut, { from: [-24, 0], scaleFrom: 0.6, dur: 0.45 });
      show(nt, tIn + 0.04, tOut, { from: [-24, 0], dur: 0.45 });
      show(tt, tIn + 0.08, tOut, { from: [-30, 0] });
      return;
    }
    var s = slotXY(it), cx = s.x + s.xo + s.w / 2, cy = s.y + SLOT.h / 2;
    var fill = C.card, strokeC = null;
    if (it.kind === "callout") fill = C.tint;
    var hgt = SLOT.h;
    if (it.kind === "search") { hgt = 68; strokeC = C.ink; }
    var sh = shadowFor(name, s.w, hgt, it.kind === "search" ? hgt / 2 : 16, cx, cy);
    var card = box(name + " CARD", s.w, hgt, it.kind === "search" ? hgt / 2 : 16, fill, strokeC, 2, cx, cy);
    var parts = [sh, card];
    if (it.kind === "search") {
      var mg = icon(null, name + " LENS", "search", s.x + s.xo + 40, cy, 34, { bare: true });
      var ht = txt(name + " TEXT", it.text || it.title || "", F.regular, 26, C.ink, s.x + s.xo + 70, cy + 9, {});
      parts.push(mg, ht);
    } else {
      var tile = icon(null, name + " ICON", it.glyph || "check", s.x + s.xo + 52, cy, 58);
      var hasSub = !!it.sub;
      var ti = txt(name + " TITLE", it.title || "", F.bold, 25, C.ink, s.x + s.xo + 94, hasSub ? cy - 4 : cy + 9, {});
      parts.push(tile, ti);
      if (hasSub) parts.push(txt(name + " SUB", it.sub, F.regular, 18, C.muted, s.x + s.xo + 94, cy + 24, {}));
    }
    for (var i = 0; i < parts.length; i++) {
      show(parts[i], tIn + (i < 2 ? 0 : 0.06 + i * 0.03), tOut, { from: [-34, 0], dur: 0.55, opacity: (i === 0 ? 7 : 100) });
    }
    // the newest card is the active one: a brand outline while it is current
    if (it.kind === "card" && it.activeUntil) {
      var ring = box(name + " ACTIVE", s.w + 6, SLOT.h + 6, 18, null, C.brand, 4, cx, cy);
      show(ring, tIn + 0.35, Math.min(it.activeUntil, tOut), { from: [0, 0], to: [0, 0], scaleFrom: 1.04, dur: 0.35 });
    }
  }
  function pinItem(it) {
    var y = SLOT.top + it.slot * SLOT.step + SLOT.h / 2;
    var tile = icon(null, "PIN LOCK", "lock", LX + 46, y, 76);
    show(tile, it.tIn, it.tOut, { from: [-30, 0], scaleFrom: 0.7 });
    for (var i = 0; i < 6; i++) {
      var x = LX + 120 + i * 50;
      var ring = box("PIN DOT " + (i + 1), 30, 30, 0, null, C.ink, 3, x, y, { ellipse: true });
      show(ring, it.tIn + 0.1 + i * 0.04, it.tOut, { from: [0, 14], dur: 0.4 });
      var fillT = it.tIn + 0.7 + i * 0.32;
      var dot = box("PIN FILL " + (i + 1), 30, 30, 0, C.ink, null, 0, x, y, { ellipse: true });
      show(dot, fillT, it.tOut, { from: [0, 0], to: [0, 0], scaleFrom: 0.2, dur: 0.25, ease: "snap" });
    }
  }

  // ---------------------------------------------------------------- phone
  function phone() {
    var iw = PHONE.w - 2 * PHONE.bezel, ih = PHONE.h - 2 * PHONE.bezel;
    var pc = subComp(T.name + " PHONE", PHONE.w, PHONE.h);
    var cx = PHONE.w / 2, cy = PHONE.h / 2;
    box("BODY", PHONE.w, PHONE.h, PHONE.r, C.ink, null, 0, cx, cy, { into: pc });
    box("DISPLAY", iw, ih, PHONE.r - PHONE.bezel, C.card, null, 0, cx, cy, { into: pc });
    var matte = box("DISPLAY MATTE", iw, ih, PHONE.r - PHONE.bezel, C.card, null, 0, cx, cy, { into: pc });
    var spanStarts = [];
    for (var s0 = 0; s0 < T.phone.length; s0++) spanStarts.push(T.phone[s0].tIn);
    var scaleOf = {};
    for (var i = 0; i < T.shots.length; i++) {
      var sh = T.shots[i], item = shotByName(sh.shot);
      if (!item) { report.warnings.push("screen missing: " + sh.shot); continue; }
      var l = fresh(pc.layers.add(item), "SHOT " + (i + 1) + " " + sh.shot);
      var sc = iw / item.width * 100;
      scaleOf[sh.shot] = iw / item.width;
      tr(l).property("ADBE Anchor Point").setValue([item.width / 2, 0]);
      S(l).setValue([sc, sc]);
      P(l).setValue([cx, PHONE.bezel]);
      var next = (i + 1 < T.shots.length) ? T.shots[i + 1].t : null;
      var fromPhone = false;
      for (var q = 0; q < spanStarts.length; q++) if (Math.abs(spanStarts[q] - sh.t) < 0.06) fromPhone = true;
      if (fromPhone) { l.inPoint = Math.max(0, sh.t - 0.02); }
      else {
        anim(P(l), [[sh.t, [cx, PHONE.bezel + 90], sh.t + 0.5, [cx, PHONE.bezel], "out"]]);
        anim(O(l), [[sh.t, 0, sh.t + 0.3, 100, "out"]]);
        l.inPoint = Math.max(0, sh.t - 0.02);
      }
      if (next !== null) l.outPoint = next + 0.55;
      try { l.setTrackMatte(matte, TrackMatteType.ALPHA); } catch (eM) {}
      l.motionBlur = true;
      if (sh.glare) {
        var gl = box("GLARE " + (i + 1), 300, 190, 0, C.card, null, 0, cx + 30, cy - 140, { into: pc, ellipse: true });
        gl.property("ADBE Effect Parade").addProperty("ADBE Gaussian Blur 2");
        gl.property("ADBE Effect Parade").property(1).property("ADBE Gaussian Blur 2-0001").setValue(55);
        anim(O(gl), [[sh.t + 0.3, 0, sh.t + 0.9, 92, "out"]]);
        gl.inPoint = sh.t; if (next !== null) gl.outPoint = next + 0.55;
        try { gl.setTrackMatte(matte, TrackMatteType.ALPHA); } catch (eG) {}
      }
    }
    matte.enabled = false;
    // highlight rings, in capture pixels scaled into the display
    for (var r = 0; r < T.rings.length; r++) {
      var rg = T.rings[r], k = scaleOf[rg.shot] || (iw / 1125);
      var rw = rg.rect[2] * k, rh = rg.rect[3] * k;
      var rx = (cx - iw / 2) + rg.rect[0] * k + rw / 2, ry = PHONE.bezel + rg.rect[1] * k + rh / 2;
      var ring = box("RING " + (r + 1), rw, rh, 10, null, C.brand, 4, rx, ry, { into: pc });
      var tint = box("RING TINT " + (r + 1), rw, rh, 10, C.brand, null, 0, rx, ry, { into: pc });
      O(tint).setValue(0);
      anim(O(tint), [[rg.tIn, 0, rg.tIn + 0.4, 14, "out"], [rg.tOut - 0.25, 14, rg.tOut, 0, "in"]]);
      tint.inPoint = rg.tIn; tint.outPoint = rg.tOut + 0.02;
      anim(O(ring), [[rg.tIn, 0, rg.tIn + 0.25, 100, "out"], [rg.tOut - 0.25, 100, rg.tOut, 0, "in"]]);
      anim(S(ring), [[rg.tIn, [112, 112], rg.tIn + 0.5, [100, 100], "out"]]);
      ring.inPoint = rg.tIn; ring.outPoint = rg.tOut + 0.02;
    }
    // the front camera: an Android punch-hole, or the iPhone island
    if (T.device === "android") box("CAMERA", 17, 17, 0, C.ink, null, 0, cx, PHONE.bezel + 20, { into: pc, ellipse: true });
    else box("ISLAND", 104, 30, 15, C.ink, null, 0, cx, PHONE.bezel + 22, { into: pc });

    var L = place(pc, "PHONE", PHONE.x, PHONE.y);
    var segsP = [], segsO = [], segsR = [], i2;
    O(L).setValue(0);
    for (i2 = 0; i2 < T.phone.length; i2++) {
      var sp = T.phone[i2], a = sp.tIn, b = sp.tOut;
      segsP.push([a, [PHONE.x + 300, PHONE.y + 20], a + 0.7, [PHONE.x, PHONE.y], "out"]);
      segsR.push([a, 9, a + 0.7, 0, "out"]);
      segsO.push([a, 0, a + 0.35, 100, "out"]);
      if (b < T.duration - 0.05) {
        segsP.push([b - 0.45, [PHONE.x, PHONE.y], b, [PHONE.x + 320, PHONE.y + 30], "in"]);
        segsR.push([b - 0.45, 0, b, -7, "in"]);
        segsO.push([b - 0.3, 100, b, 0, "in"]);
      }
    }
    anim(P(L), segsP); anim(O(L), segsO); anim(Rz(L), segsR);
    // a slow idle float so a held screen is never dead still
    P(L).expression = "value + [0, 6 * Math.sin(time * 1.25)]";
    // badges ride the phone's top-right corner
    for (var bI = 0; bI < T.badges.length; bI++) {
      var bd = T.badges[bI];
      var bl = (T.pictograms && T.pictograms[bd.kind]) ? icon(null, "BADGE " + (bI + 1) + " " + bd.kind, bd.kind, 0, 0, 110) :
        APOSTLE.drawBadge(comp, "BADGE " + (bI + 1) + " " + bd.kind, bd.kind, 0, 0, 118, pal({}));
      bl.startTime = 0;
      bl.comment = "apostle instr|" + GROUP;
      // parent WITHOUT a jump and give phone-local coords: a plain .parent
      // assignment converts using the phone's off-screen pose at time 0
      bl.setParentWithJump(L);
      P(bl).setValue([PHONE.w - 8, 118]);
      show(bl, bd.tIn, bd.tOut, { from: [0, 0], to: [0, 0], scaleFrom: 0.3, dur: 0.45, ease: "snap" });
    }
  }

  // ---------------------------------------------------------------- props
  function propIn(L, pr) {
    // trim the in point first: setting it after the out point drags the out
    // point later by the same amount
    L.inPoint = Math.max(0, pr.tIn - 0.02);
    var segsP = [[pr.tIn, [PROP.x + 340, PROP.y + 20], pr.tIn + 0.75, [PROP.x, PROP.y], "out"]];
    var segsO = [[pr.tIn, 0, pr.tIn + 0.4, 100, "out"]];
    var segsR = [[pr.tIn, 10, pr.tIn + 0.75, 0, "out"]];
    if (pr.tOut < T.duration - 0.05) {
      segsP.push([pr.tOut - 0.45, [PROP.x, PROP.y], pr.tOut, [PROP.x + 340, PROP.y + 30], "in"]);
      segsO.push([pr.tOut - 0.3, 100, pr.tOut, 0, "in"]);
      segsR.push([pr.tOut - 0.45, 0, pr.tOut, -8, "in"]);
      L.outPoint = pr.tOut + 0.02;
    }
    anim(P(L), segsP); anim(O(L), segsO); anim(Rz(L), segsR);
  }
  function labelSwaps(pc, pr, first, cx, y) {
    var labels = [{ t: pr.tIn + 0.5, text: first }];
    for (var i = 0; i < pr.events.length; i++) if (pr.events[i].text && (pr.events[i].action === "label" || pr.events[i].action === "move")) labels.push({ t: pr.events[i].t, text: pr.events[i].text });
    for (var j = 0; j < labels.length; j++) {
      if (!labels[j].text) continue;
      var nx = (j + 1 < labels.length) ? labels[j + 1].t : null;
      var lt = txt("LABEL " + (j + 1), labels[j].text, F.bold, 19, C.ink, cx, y, { center: true, tracking: 110, into: pc });
      var p = P(lt).value;
      anim(P(lt), nx === null ? [[labels[j].t, [p[0], p[1] + 14], labels[j].t + 0.45, p, "out"]] :
        [[labels[j].t, [p[0], p[1] + 14], labels[j].t + 0.45, p, "out"], [nx - 0.2, p, nx, [p[0], p[1] - 10], "in"]]);
      anim(O(lt), nx === null ? [[labels[j].t, 0, labels[j].t + 0.3, 100, "out"]] :
        [[labels[j].t, 0, labels[j].t + 0.3, 100, "out"], [nx - 0.2, 100, nx, 0, "in"]]);
      lt.inPoint = labels[j].t; if (nx !== null) lt.outPoint = nx + 0.02;
    }
  }
  function pulses(pc, x, y, times, d) {
    for (var i = 0; i < times.length; i++) for (var k = 0; k < 2; k++) {
      var t = times[i] + k * 0.35;
      var e = box("PULSE " + (i + 1) + "." + (k + 1), d, d, 0, null, C.brand, 6, x, y, { into: pc, ellipse: true });
      anim(S(e), [[t, [80, 80], t + 1.0, [175, 175], "out"]]);
      anim(O(e), [[t, 100, t + 1.0, 0, "out"]]);
      e.inPoint = t; e.outPoint = t + 1.02;
    }
  }
  function passportArt(pc, x, y, w, h, tag) {
    box(tag + " BOOK", w, h, 22, C.navy, null, 0, x, y, { into: pc });
    var ttl = txt(tag + " TITLE", "PASSPORT", F.bold, Math.round(w * 0.085), C.gold, x, y - h * 0.33, { center: true, tracking: 300, into: pc });
    box(tag + " CREST", w * 0.36, w * 0.36, 0, null, C.gold, 4, x, y - h * 0.06, { into: pc, ellipse: true });
    if (!T.pictogramsOnly) APOSTLE.drawGlyph(pc, tag + " STAR", "star", x, y - h * 0.06, w * 0.2, pal({ ink: HX.gold })).startTime = 0;
    APOSTLE.drawGlyph(pc, tag + " CHIP", "epassport", x, y + h * 0.3, w * 0.3, pal({ ink: HX.gold })).startTime = 0;
    return ttl;
  }
  function propPassport(pr) {
    var pc = subComp(T.name + " PROP passport", 700, 720), cx = 350;
    passportArt(pc, cx, 300, 330, 460, "PASSPORT");
    var pt = [];
    for (var i = 0; i < pr.events.length; i++) if (pr.events[i].action === "pulse") pt.push(pr.events[i].t);
    pulses(pc, cx, 300 + 460 * 0.3, pt, 120);
    labelSwaps(pc, pr, pr.label, cx, 600);
    propIn(place(pc, "PROP passport", PROP.x, PROP.y), pr);
  }
  function propNfc(pr) {
    var pc = subComp(T.name + " PROP nfc", 760, 760), cx = 380, cy = 330;
    var book = box("PASSPORT BOOK", 300, 420, 22, C.navy, null, 0, cx, cy + 40, { into: pc });
    Rz(book).setValue(-7);
    var chip = APOSTLE.drawGlyph(pc, "PASSPORT CHIP", "epassport", cx + 14, cy + 160, 92, pal({ ink: HX.gold }));
    chip.startTime = 0; Rz(chip).setValue(-7);
    var back = box("PHONE BACK", 220, 450, 36, C.ink, null, 0, cx, cy, { into: pc });
    var grp = [back], lensC = [0.06, 0.06, 0.06], rimC = [0.3, 0.3, 0.3];
    if (T.device === "android") {
      // Android: three lenses stacked in a vertical pill, flash beside it
      grp.push(box("CAMERA BUMP", 64, 176, 32, [0.18, 0.18, 0.18], null, 0, cx - 56, cy - 118, { into: pc }));
      for (var lz = 0; lz < 3; lz++) grp.push(box("LENS " + (lz + 1), 38, 38, 0, lensC, rimC, 3, cx - 56, cy - 170 + lz * 52, { into: pc, ellipse: true }));
      grp.push(box("FLASH", 14, 14, 0, [0.85, 0.85, 0.8], null, 0, cx - 4, cy - 184, { into: pc, ellipse: true }));
    } else {
      grp.push(box("CAMERA BUMP", 92, 92, 24, [0.18, 0.18, 0.18], null, 0, cx - 48, cy - 160, { into: pc }));
      grp.push(box("LENS 1", 32, 32, 0, lensC, rimC, 3, cx - 66, cy - 178, { into: pc, ellipse: true }));
      grp.push(box("LENS 2", 32, 32, 0, lensC, rimC, 3, cx - 30, cy - 142, { into: pc, ellipse: true }));
    }
    var tMove = null, tBuzz = null;
    for (var i = 0; i < pr.events.length; i++) {
      if (pr.events[i].action === "move") tMove = pr.events[i].t;
      if (pr.events[i].action === "buzz") tBuzz = pr.events[i].t;
    }
    var landT = pr.tIn + 0.9;
    for (var g = 0; g < grp.length; g++) {
      var p = P(grp[g]).value;
      anim(P(grp[g]), [[pr.tIn + 0.2, [p[0], p[1] - 560], landT, p, "out"]]);
      // searching: a slow circle while nothing reads, then still
      if (tMove !== null) {
        P(grp[g]).expression = "var a = " + tMove.toFixed(2) + ", b = " + (tBuzz === null ? (tMove + 2.5) : tBuzz).toFixed(2) + ";\n" +
          "if (time > a && time < b) { var k = Math.min(1, (time - a) / 0.4) * Math.min(1, (b - time) / 0.4); value + [34 * Math.sin((time - a) * 3.2) * k, 22 * Math.cos((time - a) * 3.2) * k]; } else value;";
      }
      if (tBuzz !== null) {
        Rz(grp[g]).expression = "var t = time - " + tBuzz.toFixed(2) + "; (t > 0 && t < 0.8) ? 3.2 * Math.sin(t * 80) * (1 - t / 0.8) : 0";
      }
    }
    var reads = [landT + 0.2];
    if (tBuzz !== null) reads.push(tBuzz);
    pulses(pc, cx, cy + 40, reads, 200);
    if (tBuzz !== null) {
      var ok = (T.pictograms && T.pictograms.tick) ? icon(pc, "READ OK", "tick", cx + 150, cy - 210, 110) :
        APOSTLE.drawBadge(pc, "READ OK", "tick", cx + 150, cy - 210, 110, pal({}));
      ok.startTime = 0;
      anim(S(ok), [[tBuzz + 0.3, [20, 20, 100], tBuzz + 0.75, [100, 100, 100], "snap"]]);
      anim(O(ok), [[tBuzz + 0.3, 0, tBuzz + 0.5, 100, "out"]]);
    }
    labelSwaps(pc, pr, "HOLD IT TO THE BACK OF YOUR PHONE", cx, 690);
    propIn(place(pc, "PROP nfc", PROP.x, PROP.y), pr);
  }
  function propPath(pr) {
    // NODE: pictogram size, and the clear space a link leaves either side
    var pc = subComp(T.name + " PROP path", 900, 620), cy = 290, NODE = 144, CLEAR = NODE / 2 + 30;
    var nodes = [];
    for (var i = 0; i < pr.events.length; i++) if (pr.events[i].action === "node") nodes.push(pr.events[i]);
    var n = nodes.length, xs = [450];
    if (n === 2) xs = [250, 650];
    if (n >= 3) xs = [140, 450, 760];
    for (var j = 0; j < n; j++) {
      var nd = nodes[j], x = xs[Math.min(j, xs.length - 1)];
      if (j > 0) {
        var ln = dotted("LINK " + j, xs[j - 1] + CLEAR, cy, x - CLEAR, cy, C.ink, pc);
        anim(ln.trim, [[nd.t - 0.45, 0, nd.t + 0.1, 100, "io"]]);
        ln.layer.inPoint = Math.max(0, nd.t - 0.47);
      }
      var tile = icon(pc, "NODE " + (j + 1), nd.glyph || "check", x, cy, NODE);
      // pop relative to the fitted scale: keying a flat 100% drew every
      // pictogram at its PNG's native size, whatever NODE said
      var s0 = S(tile).value;
      anim(S(tile), [[nd.t, [s0[0] * 0.1, s0[1] * 0.1, 100], nd.t + 0.55, [s0[0], s0[1], 100], "snap"]]);
      anim(O(tile), [[nd.t, 0, nd.t + 0.2, 100, "out"]]);
      tile.inPoint = nd.t;
      var lb = txt("NODE LABEL " + (j + 1), nd.label || "", F.bold, 27, C.ink, x, cy + NODE / 2 + 66, { center: true, into: pc });
      var p = P(lb).value;
      anim(P(lb), [[nd.t + 0.12, [p[0], p[1] + 16], nd.t + 0.6, p, "out"]]);
      anim(O(lb), [[nd.t + 0.12, 0, nd.t + 0.45, 100, "out"]]);
      lb.inPoint = nd.t;
    }
    if (pr.traveler && n >= 2) {
      // "dot": a small brand dot travelling above the nodes, not an icon
      var ty = cy - 128, tv;
      if (pr.traveler === "dot") { ty = cy - NODE / 2 - 34; tv = box("TRAVELER", 22, 22, 0, C.brand, C.ink, 2, xs[0], ty, { into: pc, ellipse: true }); }
      else tv = icon(pc, "TRAVELER", pr.traveler, xs[0], ty, 76, { bare: true });
      var a = nodes[1].t, b = Math.max(nodes[n - 1].t + 0.6, a + 1.2);
      anim(P(tv), [[a, [xs[0], ty], b, [xs[Math.min(n - 1, xs.length - 1)], ty], "io"]]);
      anim(O(tv), [[a - 0.2, 0, a + 0.1, 100, "out"]]);
      tv.inPoint = a - 0.2;
    }
    propIn(place(pc, "PROP path", PROP.x - 40, PROP.y + 20), pr);
  }
  // stat: the numbers a viewer must remember. A Black numeral counts up on
  // a gold marker, with the unit and qualifier under it; each `value` event
  // hands over to the next figure with a fresh count.
  function splitNum(v) {
    var m = String(v).match(/^([^0-9]*)([0-9]+(?:\.[0-9]+)?)(.*)$/);
    if (!m) return null;
    return { pre: m[1], n: parseFloat(m[2]), dec: (m[2].split(".")[1] || "").length, post: m[3] };
  }
  function propStat(pr) {
    var pc = subComp(T.name + " PROP stat", 900, 700), cx = 450;
    var vals = [{ t: pr.tIn + 0.35, value: pr.value, unit: pr.unit, sub: pr.sub }];
    for (var i = 0; i < pr.events.length; i++) if (pr.events[i].action === "value") vals.push({ t: pr.events[i].t, value: pr.events[i].value, unit: pr.events[i].unit, sub: pr.events[i].sub });
    for (var j = 0; j < vals.length; j++) {
      var v = vals[j], nx = (j + 1 < vals.length) ? vals[j + 1].t : null, tag = "STAT " + (j + 1);
      var num = txt(tag + " VALUE", String(v.value), F.black, 230, C.ink, cx, 330, { center: true, tracking: -20, into: pc });
      var w = num.sourceRectAtTime(0, false).width;
      var bar = box(tag + " MARKER", w + 30, 56, 6, C.brand, null, 0, cx - w / 2 - 15, 300, { into: pc, anchorLeft: true });
      bar.moveAfter(num);
      var parts = [bar, num];
      if (v.unit) parts.push(txt(tag + " UNIT", v.unit, F.xbold, 46, C.ink, cx, 420, { center: true, tracking: -5, into: pc }));
      if (v.sub) parts.push(txt(tag + " SUB", v.sub, F.regular, 28, C.muted, cx, 474, { center: true, into: pc }));
      var sn = splitNum(v.value);
      // count only bare figures, multipliers, percentages and money: a date
      // like "1 Oct" counting up from 0 reads as a glitch
      if (sn && !/^\s*[x%]?\s*$/i.test(sn.post)) sn = null;
      if (sn) {
        num.property("ADBE Text Properties").property("ADBE Text Document").expression =
          "var t = Math.min(1, Math.max(0, (time - " + (v.t + 0.1).toFixed(2) + ") / 0.9)); var e = 1 - Math.pow(1 - t, 3);\n" +
          JSON.stringify(sn.pre) + " + (" + sn.n + " * e).toFixed(" + sn.dec + ") + " + JSON.stringify(sn.post) + ";";
      }
      for (var k = 0; k < parts.length; k++) {
        var p = P(parts[k]).value, d0 = v.t + (k === 0 ? 0.35 : (k - 1) * 0.08);
        var segP = [[d0, [p[0], p[1] + (k === 0 ? 0 : 40)], d0 + 0.6, p, "out"]];
        var segO = [[d0, 0, d0 + 0.3, 100, "out"]];
        if (nx !== null) { segP.push([nx - 0.25, p, nx, [p[0], p[1] - 40], "in"]); segO.push([nx - 0.25, 100, nx, 0, "in"]); parts[k].outPoint = nx + 0.02; }
        anim(P(parts[k]), segP); anim(O(parts[k]), segO);
        parts[k].inPoint = Math.max(0, d0 - 0.02);
      }
      anim(S(bar), [[v.t + 0.45, [0, 100], v.t + 1.1, [100, 100], "out"]]);
    }
    propIn(place(pc, "PROP stat", PROP.x - 20, PROP.y + 20), pr);
  }
  // hero: one idea, one big icon
  function propHero(pr) {
    var pc = subComp(T.name + " PROP hero", 700, 700), cx = 350;
    var tile = icon(pc, "HERO ICON", pr.glyph || "star", cx, 270, 300);
    anim(S(tile), [[pr.tIn + 0.2, [40, 40, 100], pr.tIn + 0.9, [100, 100, 100], "snap"]]);
    var lbs = [{ t: pr.tIn + 0.45, text: pr.label }];
    for (var i = 0; i < pr.events.length; i++) if (pr.events[i].action === "label") lbs.push({ t: pr.events[i].t, text: pr.events[i].text });
    for (var j = 0; j < lbs.length; j++) {
      if (!lbs[j].text) continue;
      var nx = (j + 1 < lbs.length) ? lbs[j + 1].t : null;
      var lt = txt("HERO LABEL " + (j + 1), headingCase([lbs[j].text])[0], F.black, 44, C.ink, cx, 540, { center: true, tracking: HEAD_TRACK, into: pc, keepCase: true });
      var p = P(lt).value;
      anim(P(lt), nx === null ? [[lbs[j].t, [p[0], p[1] + 24], lbs[j].t + 0.5, p, "out"]] : [[lbs[j].t, [p[0], p[1] + 24], lbs[j].t + 0.5, p, "out"], [nx - 0.2, p, nx, [p[0], p[1] - 16], "in"]]);
      anim(O(lt), nx === null ? [[lbs[j].t, 0, lbs[j].t + 0.3, 100, "out"]] : [[lbs[j].t, 0, lbs[j].t + 0.3, 100, "out"], [nx - 0.2, 100, nx, 0, "in"]]);
      lt.inPoint = lbs[j].t; if (nx !== null) lt.outPoint = nx + 0.02;
    }
    propIn(place(pc, "PROP hero", PROP.x, PROP.y + 10), pr);
  }

  function propFan(pr) {
    var pc = subComp(T.name + " PROP fan", 1500, 1900), cols = 3, cw = 250, gap = 44;
    for (var i = 0; i < pr.files.length; i++) {
      var item = shotByName(pr.files[i]);
      if (!item) continue;
      var c = i % cols, r = Math.floor(i / cols);
      var sc = cw / item.width * 100, hh = Math.min(item.height * sc / 100, 560);
      var x = 260 + c * (cw + gap) + cw / 2, y = 200 + r * 600 + (c === 1 ? -220 : 0) + hh / 2;
      var sh = box("CARD SHADOW " + (i + 1), cw, hh, 22, C.ink, null, 0, x, y + 10, { into: pc });
      O(sh).setValue(9);
      sh.property("ADBE Effect Parade").addProperty("ADBE Gaussian Blur 2");
      sh.property("ADBE Effect Parade").property(1).property("ADBE Gaussian Blur 2-0001").setValue(26);
      var frame = box("CARD " + (i + 1), cw + 10, hh + 10, 24, C.card, C.line, 2, x, y, { into: pc });
      var l = fresh(pc.layers.add(item), "SHOT " + (i + 1));
      tr(l).property("ADBE Anchor Point").setValue([item.width / 2, 0]);
      S(l).setValue([sc, sc]);
      P(l).setValue([x, y - hh / 2]);
      l.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
      var mk = l.property("ADBE Mask Parade").property(1), ms = new Shape();
      var mh = hh / (sc / 100);
      ms.vertices = [[0, 0], [item.width, 0], [item.width, mh], [0, mh]]; ms.closed = true;
      mk.property("ADBE Mask Shape").setValue(ms);
      var t = pr.tIn + 0.15 + i * 0.07;
      var parts = [sh, frame, l];
      for (var k = 0; k < parts.length; k++) {
        var p = P(parts[k]).value;
        anim(P(parts[k]), [[t, [p[0], p[1] + 160], t + 0.8, p, "out"]]);
        anim(O(parts[k]), [[t, 0, t + 0.4, k === 0 ? 9 : 100, "out"]]);
      }
    }
    var L = place(pc, "PROP fan", 1460, 560);
    Rz(L).setValue(-13);
    // a slow upward drift across the whole span: the questions keep coming
    anim(P(L), [[pr.tIn, [1500, 700], pr.tOut, [1440, 300], "io"]]);
    anim(O(L), pr.tOut < T.duration - 0.05 ? [[pr.tIn, 0, pr.tIn + 0.3, 100, "out"], [pr.tOut - 0.35, 100, pr.tOut, 0, "in"]] : [[pr.tIn, 0, pr.tIn + 0.3, 100, "out"]]);
    L.inPoint = pr.tIn; if (pr.tOut < T.duration - 0.05) L.outPoint = pr.tOut + 0.02;
  }

  // ---------------------------------------------------------------- cards
  function card(cd, idx) {
    GROUP = "CARD|" + idx;
    var nul = fresh(comp.layers.addNull(), "CARD " + (idx + 1) + " " + cd.type);
    tr(nul).property("ADBE Anchor Point").setValue([0, 0]);
    P(nul).setValue([0, 0]);
    nul.enabled = false;
    var kids = [];
    var bg = box("CARD " + (idx + 1) + " BG", W + 40, H + 40, 0, C.brand, null, 0, W / 2, H / 2);
    kids.push(bg);
    if (cd.type === "chapter") {
      var ey = txt("CARD " + (idx + 1) + " STEP", "STEP " + cd.step + " OF " + cd.total, F.bold, 22, C.ink, LX, 330, { tracking: 140 });
      var nm = txt("CARD " + (idx + 1) + " NUMERAL", cd.numeral, F.black, 300, C.ink, LX - 12, 640, { tracking: -30 });
      var tt = txt("CARD " + (idx + 1) + " TITLE", headingCase([cd.title])[0], F.black, 78, C.ink, LX, 762, { tracking: HEAD_TRACK, keepCase: true });
      kids.push(ey, nm, tt);
    } else {
      var by = cd.type === "title" ? 470 : 500;
      var cl = headingCase(cd.heading);
      for (var i = 0; i < cl.length; i++) {
        kids.push(txt("CARD " + (idx + 1) + " LINE " + (i + 1), cl[i], F.black, 120, C.ink, LX, by + i * 124, { tracking: HEAD_TRACK, keepCase: true }));
      }
      if (cd.sub) kids.push(txt("CARD " + (idx + 1) + " SUB", cd.sub, F.regular, 34, C.ink, LX, by + cd.heading.length * 124 + 10, {}));
    }
    for (var k = 0; k < kids.length; k++) {
      try { kids[k].setParentWithJump(nul); } catch (eJ) { kids[k].parent = nul; }
      kids[k].motionBlur = true;
    }
    var tIn = cd.tIn, tOut = cd.tOut;
    var enters = cd.type !== "title";
    if (enters) anim(P(bg), [[tIn, [W / 2, H / 2 + H + 40], tIn + 0.55, [W / 2, H / 2], "out"]]);
    for (var j = 1; j < kids.length; j++) {
      var d0 = (enters ? tIn + 0.32 : 0.15) + (j - 1) * 0.09;
      var p = P(kids[j]).value;
      anim(P(kids[j]), [[d0, [p[0], p[1] + 70], d0 + 0.7, p, "out"]]);
      anim(O(kids[j]), [[d0, 0, d0 + 0.35, 100, "out"]]);
    }
    for (var n = 0; n < kids.length; n++) kids[n].inPoint = Math.max(0, tIn - 0.02);
    nul.inPoint = Math.max(0, tIn - 0.02);
    if (tOut < T.duration - 0.05) {
      anim(P(nul), [[tOut - 0.6, [0, 0], tOut, [0, -H - 60], "in"]]);
      for (var m = 0; m < kids.length; m++) kids[m].outPoint = tOut + 0.02;
      nul.outPoint = tOut + 0.02;
    }
  }

  // ---------------------------------------------------------------- captions
  function captions() {
    GROUP = "CAPTIONS";
    for (var i = 0; i < T.captions.length; i++) {
      var c = T.captions[i];
      var tw = textWidth(c.text, F.regular, CAP.size, 0, { lowerOnly: true });
      var pill = box("CC " + (i + 1) + " PILL", tw + 32 * 2, CAP.h, CAP.h / 2, C.ink, null, 0, W / 2, CAP.y);
      var t = txt("CC " + (i + 1) + " TEXT", c.text, F.regular, CAP.size, C.card, W / 2, CAP.y + 10, { center: true, lowerOnly: true });
      var parts = [pill, t];
      for (var k = 0; k < parts.length; k++) show(parts[k], c.tIn, c.tOut, { from: [0, 10], to: [0, 0], dur: 0.28, exit: 0.16 });
    }
  }

  // ---------------------------------------------------------------- sections
  // A finished build is folded into one precomp per part, so the master reads
  // as the film's outline (CBA, 2026-10-13: "organise each part into sections
  // instead of 350+ layers"), top to bottom:
  //   LOGO / CAPTIONS / chapter, title and outro cards / STEP sections (left
  //   column + props) / PHONE (with its badges) / TOP BAR / BG
  // Each precomp is full length and time-aligned, so timing is unchanged; the
  // master layer is trimmed to the span its layers occupy.
  function stepOfPage(id) {
    for (var i = 0; i < T.pages.length; i++) if (T.pages[i].id === id) return T.pages[i].step || 0;
    return 0;
  }
  function stepAt(t) {
    var st = 0;
    for (var i = 0; i < T.pages.length; i++) if (T.pages[i].tIn <= t + 0.01) st = T.pages[i].step || 0;
    return st;
  }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function sectionKey(step) { return "STEP|" + (step || 0); }
  function sectionName(key) {
    var a = key.split("|");
    if (a[0] === "STEP") {
      var st = parseInt(a[1], 10);
      if (!st) return "00 INTRO";
      for (var i = 0; i < T.cards.length; i++) if (T.cards[i].type === "chapter" && T.cards[i].step === st) return pad2(st) + " " + T.cards[i].title.toUpperCase();
      return pad2(st) + " STEP";
    }
    if (a[0] === "CARD") {
      var cd = T.cards[parseInt(a[1], 10)];
      if (cd.type === "chapter") return "CARD " + pad2(cd.step) + " " + cd.title.toUpperCase();
      return cd.type === "title" ? "CARD TITLE" : "CARD OUTRO";
    }
    return key;
  }
  function organise() {
    var keys = [], seen = {}, i;
    for (i = 1; i <= comp.numLayers; i++) {
      var c = comp.layer(i).comment, k = c.indexOf("apostle instr|") === 0 ? c.substring(14) : null;
      if (k && k !== "BG" && !seen[k]) { seen[k] = true; keys.push(k); }
    }
    var folder = app.project.items.addFolder("SECTIONS");
    folder.parentFolder = T._folder;
    var made = {};
    for (var q = 0; q < keys.length; q++) {
      var idx = [], tIn = T.duration, tOut = 0;
      for (i = 1; i <= comp.numLayers; i++) {
        var L = comp.layer(i);
        if (L.comment === "apostle instr|" + keys[q]) {
          idx.push(i);
          if (!L.nullLayer) { tIn = Math.min(tIn, L.inPoint); tOut = Math.max(tOut, L.outPoint); }
        }
      }
      if (!idx.length) continue;
      var nm = T.name + " " + sectionName(keys[q]);
      var pc = comp.layers.precompose(idx, nm, true);
      pc.parentFolder = folder;
      pc.motionBlur = true;
      pc.bgColor = C.bg;
      var layer = null;
      for (i = 1; i <= comp.numLayers; i++) if (comp.layer(i).source === pc) layer = comp.layer(i);
      layer.name = sectionName(keys[q]);
      layer.comment = "apostle section|" + keys[q];
      layer.motionBlur = true;
      layer.inPoint = Math.max(0, tIn); layer.outPoint = Math.min(T.duration, tOut);
      made[keys[q]] = layer;
      report.sections = report.sections || [];
      report.sections.push(layer.name + " (" + idx.length + " layers)");
    }
    // stacking, bottom -> top
    var order = ["TOP BAR", "PHONE"], cardsK = [], steps = [];
    for (var k2 in made) if (made.hasOwnProperty(k2)) {
      if (k2.indexOf("STEP|") === 0) steps.push(k2);
      if (k2.indexOf("CARD|") === 0) cardsK.push(k2);
    }
    var byNum = function (a, b) { return parseInt(a.split("|")[1], 10) - parseInt(b.split("|")[1], 10); };
    steps.sort(byNum); cardsK.sort(byNum);
    order = order.concat(steps, cardsK, ["CAPTIONS", "LOGO"]);
    for (var o = 0; o < order.length; o++) if (made[order[o]]) made[order[o]].moveToBeginning();
    for (i = 1; i <= comp.numLayers; i++) if (comp.layer(i).name === "BG") { comp.layer(i).moveToEnd(); break; }
  }

  // ---------------------------------------------------------------- build
  // removes a previous build of this exact name (its APOSTLE/<name> folder:
  // master, subcomps, imported assets). Only ever things this builder made.
  function removePrevious(name) {
    var removed = 0;
    for (var i = app.project.numItems; i >= 1; i--) {
      var it = app.project.item(i);
      if (it instanceof FolderItem && it.name === "APOSTLE/" + name) { it.remove(); removed++; }
    }
    return removed;
  }

  function build(timelinePath, opts) {
    report = { status: "success", warnings: [] };
    opts = opts || {};
    try {
      T = JSON.parse(rd(timelinePath));
      if (opts.replace) report.replaced = removePrevious(T.name);
      C = T.colors; F = T.fonts; HX = T.hex;
      app.beginUndoGroup("Apostle instructional build");
      try {
        // never overwrite: <name>, else <name> rebuild N
        var name = T.name, n = 1, taken = true;
        while (taken) {
          taken = false;
          for (var i = 1; i <= app.project.numItems; i++) if (app.project.item(i).name === name) taken = true;
          if (taken) { n++; name = T.name + " rebuild " + n; }
        }
        T.name = name;
        T._folder = app.project.items.addFolder("APOSTLE/" + name);
        T._assets = app.project.items.addFolder(name + " ASSETS");
        T._assets.parentFolder = T._folder;
        T._parts = app.project.items.addFolder("PARTS");
        T._parts.parentFolder = T._folder;
        comp = app.project.items.addComp(name, W, H, 1, T.duration, T.fps);
        comp.parentFolder = T._folder;
        comp.motionBlur = true;
        comp.bgColor = C.bg;
        GROUP = "BG";
        var bg = fresh(comp.layers.addSolid(C.bg, "BG", W, H, 1, T.duration), "BG");
        bg.moveToEnd();

        // bottom -> top: every addX puts the new layer on top
        topBar();
        for (var p = 0; p < T.pages.length; p++) { GROUP = sectionKey(T.pages[p].step); page(T.pages[p]); }
        // the newest item on a page is "active" until the next one arrives
        for (var it = 0; it < T.items.length; it++) {
          var cur = T.items[it], nx = null;
          for (var q = it + 1; q < T.items.length; q++) if (T.items[q].page === cur.page) { nx = T.items[q]; break; }
          if (nx) cur.activeUntil = nx.tIn;
        }
        for (var it2 = 0; it2 < T.items.length; it2++) {
          GROUP = sectionKey(stepOfPage(T.items[it2].page));
          if (T.items[it2].kind === "pin") pinItem(T.items[it2]);
          else item(T.items[it2]);
        }
        GROUP = "PHONE";
        phone();
        for (var pr = 0; pr < T.props.length; pr++) {
          var P0 = T.props[pr];
          GROUP = sectionKey(stepAt(P0.tIn));
          if (P0.type === "passport") propPassport(P0);
          else if (P0.type === "nfc") propNfc(P0);
          else if (P0.type === "path") propPath(P0);
          else if (P0.type === "fan") propFan(P0);
          else if (P0.type === "stat") propStat(P0);
          else if (P0.type === "hero") propHero(P0);
          else report.warnings.push("unknown prop " + P0.type);
        }
        for (var c = 0; c < T.cards.length; c++) card(T.cards[c], c);
        captions();
        logoMark();
        if (opts.organise !== false) organise();
      } finally {
        app.endUndoGroup();
      }
      report.master = comp.name;
      report.duration = T.duration;
      report.layers = comp.numLayers;
      report.sections = report.sections || [];
      return JSON.stringify(report);
    } catch (e) {
      return JSON.stringify({ status: "error", error: e.toString(), line: e.line || null, warnings: report.warnings });
    }
  }

  $.global.APOSTLE_INSTR = { build: build, version: "1.2.0" };
})();
