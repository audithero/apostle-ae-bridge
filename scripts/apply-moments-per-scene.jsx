// apply-moments-per-scene.jsx — apply a moments doc one scene per call.
//
// APOSTLE.applyMoments() processes a whole document inside a single
// beginUndoGroup. On the larger videos that is many hundreds of layer
// creations in one undo group, and After Effects becomes unreliable partway
// through — the failures move around between runs (a shape group losing
// addProperty, a scalar property handed a vector) and none of them reproduce
// when the same scene is applied on its own. Splitting the document into one
// applyMoments call per scene keeps each undo group small and has been stable.
//
// Behaviour is otherwise identical: applyMoments is idempotent per scene, and
// scenes do not depend on one another.
//
// Usage (via scripts/ae-run.sh), with the moments path in the second line:
//   var MOMENTS_PATH = "...";

var REPO = "/Volumes/Apostle_8TB 1/00.AAA_PROJECTS_GITHUB/ae-apostle-bridge";

if (typeof $.global.APOSTLE === "undefined") {
  $.evalFile(new File(REPO + "/apostle/apostle.jsx"));
}

function applyMomentsPerScene(momentsPath) {
  var f = new File(momentsPath);
  f.open("r");
  var raw = f.read();
  f.close();
  var doc = JSON.parse(raw);
  var scenes = doc.scenes || [];
  var out = { file: momentsPath.split("/").pop(), scenes: 0, moments: 0, layers: 0, failures: [] };

  // Scenes intermittently fail with "Function c.addProperty is undefined" —
  // a vectors-group handle going stale mid-build. It is NOT deterministic:
  // the same scene that fails one run succeeds the next, and which scenes
  // fail moves around between runs. It tracks how much work AE has already
  // done in the session, so it reads as host memory/handle pressure rather
  // than anything in the data. Retry with a cache purge in between clears it.
  // applyMoments is idempotent per scene, so a retry is always safe.
  var MAX_TRIES = 4;

  for (var s = 0; s < scenes.length; s++) {
    var one = { meta: doc.meta, palette: doc.palette, scenes: [scenes[s]] };
    var ok = false;
    var lastErr = "";
    var tries = 0;

    while (!ok && tries < MAX_TRIES) {
      tries += 1;
      if (tries > 1) {
        try { app.purge(PurgeTarget.ALL_CACHES); } catch (eP) {}
      }
      var res = null;
      try {
        res = JSON.parse(APOSTLE.applyMoments(JSON.stringify(one)));
      } catch (e) {
        lastErr = e.toString();
        continue;
      }
      if (res.status !== "success") { lastErr = res.error || "unknown"; continue; }
      var rs = (res.scenes && res.scenes[0]) || {};
      if (rs.error) { lastErr = rs.error; continue; }
      ok = true;
      out.scenes += 1;
      out.moments += rs.moments || 0;
      out.layers += rs.layers || 0;
      if (tries > 1) out.retried = (out.retried || 0) + 1;
    }

    if (!ok) out.failures.push({ beatId: scenes[s].beatId, error: lastErr, tries: tries });
  }
  return out;
}
