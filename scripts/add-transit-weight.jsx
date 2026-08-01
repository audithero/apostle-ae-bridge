// add-transit-weight.jsx — give the camera transits mass.
//
// The build eases every rig move with a single symmetric profile
// (corporate-smooth, influence 92/78). That is smooth, but smooth on its own
// reads floaty: the camera glides to a station and simply stops, like a value
// being interpolated rather than a body being moved. Nothing in the move tells
// you the camera has weight.
//
// This adds the one cue that does: a small OVERSHOOT past the station followed
// by a short SETTLE back onto it. A mass in motion cannot stop dead — it runs
// slightly past its mark and eases back. Doing that, and only that, is what
// separates "elegant and weighted" from "over the top": no bounce, no wobble,
// no secondary oscillation, one settle.
//
// Sizing: the overshoot is 2.2% of the distance travelled, capped at 95 units,
// so a long corridor run carries visibly more momentum than a short hop — the
// weight scales with the move instead of being a fixed tic. The settle is
// 0.38s, slow enough to read as deceleration rather than a snap.
//
// The overshoot lands AFTER the beat's arrival time, during the hold, so it
// never eats into the transit or delays the content reveal. Scene layer
// in/out points are untouched.
//
// Arrival times come from the rig's station markers, which the build writes at
// exactly the arrival of each beat — that distinguishes a real arrival from
// the mid-transit control points crane/whipOrbit/lateralTruck add.
//
// Idempotent: a rig already carrying the marker comment is skipped.

var TW_TAG = "apostle transit weight";
var TW_OVERSHOOT_FRAC = 0.022;
var TW_OVERSHOOT_MAX = 95;
var TW_OVERSHOOT_MIN = 12;
var TW_SETTLE = 0.38;
var TW_LEAD = 0.05;   // overshoot peak sits this long after nominal arrival

function twEaseArrays(prop, idx, influence, speed) {
  var n = 1;
  try { n = prop.keyInTemporalEase(idx).length; } catch (e) { n = 1; }
  var arr = [];
  for (var i = 0; i < n; i++) arr.push(new KeyframeEase(speed || 0, influence));
  return arr;
}

function twStationMarkerTimes(rig, compDur) {
  var times = [];
  var mk;
  try { mk = rig.property("Marker"); } catch (e) { return times; }
  if (!mk) return times;
  for (var k = 1; k <= mk.numKeys; k++) {
    var t = mk.keyTime(k);
    if (t > 0.001 && t < compDur) times.push(t);
  }
  return times;
}

function addTransitWeight() {
  app.beginUndoGroup("Apostle transit weight");
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

      if (rig.comment && rig.comment.indexOf(TW_TAG) !== -1) {
        report.skipped.push({ comp: comp.name.substring(0, 40), why: "already weighted" });
        continue;
      }

      var pos = rig.property("ADBE Transform Group").property("ADBE Position");
      if (pos.numKeys < 2) {
        report.skipped.push({ comp: comp.name.substring(0, 40), why: "rig has no transit keys" });
        continue;
      }

      var arrivals = twStationMarkerTimes(rig, comp.duration);
      var applied = 0, skippedNear = 0;

      // walk arrivals last-first: inserting keys shifts later indices
      for (var a = arrivals.length - 1; a >= 0; a--) {
        var tA = arrivals[a];

        // the key exactly at the arrival, and the one before it (the approach)
        var idxA = 0;
        for (var k = 1; k <= pos.numKeys; k++) {
          if (Math.abs(pos.keyTime(k) - tA) < 0.008) { idxA = k; break; }
        }
        if (!idxA || idxA < 2) { skippedNear += 1; continue; }

        var station = pos.keyValue(idxA);
        var prev = pos.keyValue(idxA - 1);

        // direction of travel and how far the camera actually moved
        var d = [station[0] - prev[0], station[1] - prev[1], (station[2] || 0) - (prev[2] || 0)];
        var dist = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
        if (dist < 1) { skippedNear += 1; continue; }

        var over = dist * TW_OVERSHOOT_FRAC;
        if (over > TW_OVERSHOOT_MAX) over = TW_OVERSHOOT_MAX;
        if (over < TW_OVERSHOOT_MIN) over = TW_OVERSHOOT_MIN;

        var ux = d[0] / dist, uy = d[1] / dist, uz = d[2] / dist;
        var peak = [station[0] + ux * over, station[1] + uy * over, (station[2] || 0) + uz * over];

        // do not run past the next arrival
        var tPeak = tA + TW_LEAD;
        var tRest = tA + TW_SETTLE;
        var nextT = (a + 1 < arrivals.length) ? arrivals[a + 1] : comp.duration;
        if (tRest > nextT - 0.25) { skippedNear += 1; continue; }

        // the nominal arrival key becomes the overshoot peak, and a new key
        // at tRest brings the camera back to the true station position
        pos.setValueAtTime(tPeak, peak);
        pos.setValueAtTime(tRest, station);

        // re-ease: the peak carries speed through, the rest key eases hard in
        var iPeak = 0, iRest = 0;
        for (var k2 = 1; k2 <= pos.numKeys; k2++) {
          if (Math.abs(pos.keyTime(k2) - tPeak) < 0.008) iPeak = k2;
          if (Math.abs(pos.keyTime(k2) - tRest) < 0.008) iRest = k2;
        }
        if (iPeak) {
          try {
            pos.setTemporalEaseAtKey(iPeak, twEaseArrays(pos, iPeak, 42), twEaseArrays(pos, iPeak, 62));
          } catch (eE1) {}
        }
        if (iRest) {
          try {
            pos.setTemporalEaseAtKey(iRest, twEaseArrays(pos, iRest, 88), twEaseArrays(pos, iRest, 88));
          } catch (eE2) {}
        }
        applied += 1;
      }

      rig.comment = (rig.comment ? rig.comment + " " : "") + TW_TAG;
      report.masters.push({
        comp: comp.name.substring(0, 44),
        arrivals: arrivals.length,
        weighted: applied,
        skippedTooTight: skippedNear
      });
    }
  } finally {
    app.endUndoGroup();
  }
  return report;
}
