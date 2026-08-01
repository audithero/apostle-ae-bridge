// fix-blank-transits.jsx — stop the camera crossing empty space.
//
// A station's content fades out at the end of its beat, and the NEXT station's
// content does not reveal until just after arrival (the v2.2 contract). So for
// the back half of every transit there is nothing on either plane unless the
// camera can see BOTH stations at once.
//
// lateralTruck, whipOrbit and dollyZoom already handle this — the build pulls
// them back in z (or yaws them to look back) at the transit midpoint, after
// pixel QA caught fully-white mid-truck frames. `crane` never got the same
// treatment: it arcs UP and keeps looking forward, straight at a blank plane.
// Rendered proof at VIDEO_001 t=40.8s: an entirely empty yellow frame.
//
// This pulls every mid-transit control point back in z so both the outgoing
// and incoming stations stay in shot through the move. It is a post-process on
// the existing keys, so it does not require a retime (which would re-lay the
// camera and discard the transit-weight pass).
//
// Identifying a mid-transit key: station arrivals are marked by the rig's
// station markers, and the transit-weight pass adds an overshoot key at
// arrival+0.05 and a settle at arrival+0.38. So any position key that is NOT
// within 0.45s after an arrival, and sits strictly between two arrivals, is a
// mid-transit control point.

var FBT_TAG = "apostle transit depth";
var FBT_PULLBACK = 420;      // matches the lateralTruck / whipOrbit mitigation
var FBT_ARRIVAL_WINDOW = 0.45;

function fbtArrivals(rig, compDur) {
  var out = [];
  var mk;
  try { mk = rig.property("Marker"); } catch (e) { return out; }
  if (!mk) return out;
  for (var k = 1; k <= mk.numKeys; k++) {
    var t = mk.keyTime(k);
    if (t >= 0 && t <= compDur) out.push(t);
  }
  return out;
}

function fixBlankTransits() {
  app.beginUndoGroup("Apostle fix blank transits");
  var report = { masters: [], skipped: [] };
  try {
    for (var i = 1; i <= app.project.numItems; i++) {
      var comp = app.project.item(i);
      if (!(comp instanceof CompItem)) continue;

      var rig = null;
      for (var L = 1; L <= comp.numLayers; L++) {
        if (comp.layer(L).name === "APOSTLE RIG") { rig = comp.layer(L); break; }
      }
      if (!rig) continue;
      if (rig.comment && rig.comment.indexOf(FBT_TAG) !== -1) {
        report.skipped.push(comp.name.substring(0, 40) + " (already)");
        continue;
      }

      var pos = rig.property("ADBE Transform Group").property("ADBE Position");
      if (pos.numKeys < 3) { report.skipped.push(comp.name.substring(0, 40) + " (no transits)"); continue; }

      var arr = fbtArrivals(rig, comp.duration);
      var deepened = 0, already = 0;

      for (var k = 1; k <= pos.numKeys; k++) {
        var t = pos.keyTime(k);

        // is this an arrival / overshoot / settle key?
        var nearArrival = false;
        for (var a = 0; a < arr.length; a++) {
          if (t >= arr[a] - 0.01 && t <= arr[a] + FBT_ARRIVAL_WINDOW) { nearArrival = true; break; }
        }
        if (nearArrival) continue;

        // must sit strictly between two arrivals to be a transit control point
        var before = -1, after = -1;
        for (var a2 = 0; a2 < arr.length; a2++) {
          if (arr[a2] < t) before = arr[a2];
          if (arr[a2] > t && after < 0) after = arr[a2];
        }
        if (before < 0 || after < 0) continue;

        var v = pos.keyValue(k);
        if (v.length < 3) continue;

        // reference depth = midpoint of the two stations either side
        var iPrev = k - 1, iNext = k + 1;
        if (iPrev < 1 || iNext > pos.numKeys) continue;
        var zPrev = pos.keyValue(iPrev)[2];
        var zNext = pos.keyValue(iNext)[2];
        var zRef = (zPrev + zNext) / 2;
        var target = zRef - FBT_PULLBACK;

        if (v[2] <= target + 1) { already += 1; continue; }  // truck/whip already pulled back
        pos.setValueAtTime(t, [v[0], v[1], target]);
        deepened += 1;
      }

      rig.comment = (rig.comment ? rig.comment + " " : "") + FBT_TAG;
      report.masters.push({
        comp: comp.name.substring(0, 44),
        midKeys: deepened + already,
        deepened: deepened,
        alreadyPulledBack: already
      });
    }
  } finally {
    app.endUndoGroup();
  }
  return report;
}
