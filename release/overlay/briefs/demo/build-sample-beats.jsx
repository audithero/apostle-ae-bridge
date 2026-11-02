// Build the corridor demo (apostle/sample-beats.json) in the open AE project.
// Run from the package folder:  scripts/ae-run.sh briefs/demo/build-sample-beats.jsx 600
// It creates APOSTLE/NORTHWIND_DEMO_v001 (a new version each run; nothing is overwritten).
var REPO = $.global.APOSTLE_REPO || new File($.fileName).parent.parent.parent.fsName;
$.evalFile(new File(REPO + "/apostle/apostle.jsx"));
var f = new File(REPO + "/apostle/sample-beats.json");
f.encoding = "UTF-8"; f.open("r"); var beats = f.read(); f.close();
return JSON.parse(APOSTLE.buildFromBeats(beats));
