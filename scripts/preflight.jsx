// Session preflight probe — run via bridge-exec.sh or ae-run.sh
var REPO = $.global.APOSTLE_REPO || new File($.fileName).parent.parent.fsName; // set by bridge-exec.sh / ae-run.sh; $.fileName works under $.evalFile
var libPath = REPO + "/apostle/apostle.jsx";
$.evalFile(new File(libPath));
var p = app.project.file;
return {
  aeVersion: app.version,
  project: p ? decodeURI(p.name) : "(unsaved)",
  dirty: app.project.dirty,
  numItems: app.project.numItems,
  apostleVersion: $.global.APOSTLE ? $.global.APOSTLE.version : null
};
