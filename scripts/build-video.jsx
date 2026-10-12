// Full VO-locked build for one video. Driven by $.global.APCFG (JSON string):
//   { slug, master, voMatch }  — voMatch is a substring of the imported audio item name
var REPO = $.global.APOSTLE_REPO || new File($.fileName).parent.parent.fsName; // set by bridge-exec.sh / ae-run.sh; $.fileName works under $.evalFile
$.evalFile(new File(REPO + "/apostle/apostle.jsx"));
function rd(p){var f=new File(p); f.open("r"); f.encoding="UTF-8"; var s=f.read(); f.close(); return s;}
var R=REPO+"/";
$.global.APBUILD = function (cfg) {
var out = {};

out.build = JSON.parse(APOSTLE.buildFromBeats(rd(R+"briefs/commbank-yello/beats/"+cfg.slug+".json")));
if (out.build.status !== "success") return out;

out.skin = JSON.parse(APOSTLE.applySkin(cfg.master, rd(R+"brands/commbank-yello-3.json")));

// place the recorded VO at the 2.0s head the timing model assumes
var p = app.project, master = null, added = [];
for (var i=1;i<=p.numItems;i++){ var it=p.item(i); if (it instanceof CompItem && it.name===cfg.master) master=it; }
if (master) {
  app.beginUndoGroup("Apostle: place VO");
  // VO start comes from the beats doc — a title card pushes it back
  var t = 2.0;
  try {
    var bd = JSON.parse(rd(R+"briefs/commbank-yello/beats/"+cfg.slug+".json"));
    if (bd.meta && bd.meta.voOffsetSec) t = bd.meta.voOffsetSec;
  } catch (eV) {}
  for (var k=0;k<cfg.voMatch.length;k++){
    for (var j=1;j<=p.numItems;j++){
      var f=p.item(j);
      if (!(f instanceof FootageItem)) continue;
      if (f.name.indexOf(cfg.voMatch[k]) < 0) continue;
      var L = master.layers.add(f);
      L.startTime = t;
      L.name = f.name + " - AUDIO VOICE OVER";
      L.enabled = false;          // audio-only: video switch off, audio on
      L.moveToBeginning();
      added.push({name:f.name, start:t, dur:f.duration});
      t = t + f.duration;
      break;
    }
  }
  app.endUndoGroup();
}
out.vo = added;
return out;
};
