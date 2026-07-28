// Session preflight probe — run via bridge-exec.sh or ae-run.sh
var libPath = "/Volumes/Apostle_8TB 1/00.AAA_PROJECTS_GITHUB/ae-apostle-bridge/apostle/apostle.jsx";
$.evalFile(new File(libPath));
var p = app.project.file;
return {
  aeVersion: app.version,
  project: p ? decodeURI(p.name) : "(unsaved)",
  dirty: app.project.dirty,
  numItems: app.project.numItems,
  apostleVersion: $.global.APOSTLE ? $.global.APOSTLE.version : null
};
