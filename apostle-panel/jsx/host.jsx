// Apostle panel host (ES3). Deliberately thin: loads apostle.jsx and
// marshals JSON — ALL business logic lives in the library so the panel,
// the bridge, and Claude drive the exact same functions.

function apInit(repoPath) {
  try {
    $.global.APOSTLE_REPO = repoPath;
    $.evalFile(new File(repoPath + "/apostle/apostle.jsx"));
    return '{"ok":true,"version":"' + $.global.APOSTLE.version + '"}';
  } catch (e) {
    return '{"ok":false,"error":"' + String(e).replace(/["\\]/g, "'") + '"}';
  }
}

function apReload() {
  return apInit($.global.APOSTLE_REPO);
}

// Args arrive via a JSON file (array of arguments) — evalScript string
// escaping is unreliable for large nested-JSON payloads, files are not.
function apCallFile(fnName, argsPath) {
  try {
    if (typeof $.global.APOSTLE === "undefined") return '{"ok":false,"error":"library not loaded — call apInit first"}';
    var A = $.global.APOSTLE;
    if (typeof A[fnName] !== "function") return '{"ok":false,"error":"no such function: ' + fnName + '"}';
    var args = [];
    if (argsPath) {
      var f = new File(argsPath);
      f.encoding = "UTF-8"; f.open("r"); var raw = f.read(); f.close();
      args = eval("(" + raw + ")");
    }
    var result = A[fnName].apply(null, args);
    if (typeof result === "string") return '{"ok":true,"raw":' + A.toJSON(result) + ',"isJSON":true}';
    return '{"ok":true,"result":' + A.toJSON(result) + '}';
  } catch (e) {
    return '{"ok":false,"error":"' + String(e).replace(/["\\]/g, "'") + '","line":' + (e.line || 0) + '}';
  }
}
