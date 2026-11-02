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

// ---- Claude bridge, served by this panel (no ScriptUI panel needed) --------
// Loads build/scripts/mcp-bridge-auto.jsx in headless mode inside a function
// scope, so its ~100 top-level functions (getProjectInfo, deleteLayer, ...)
// stay private and never collide with globals here or in other scripts. The
// flag is cleared right after, so a ScriptUI copy opened later still builds UI.
function apBridgeInit(repoPath) {
  try {
    var f = new File(repoPath + "/build/scripts/mcp-bridge-auto.jsx");
    if (!f.exists) return '{"ok":false,"error":"missing build/scripts/mcp-bridge-auto.jsx (run npm run build)"}';
    f.encoding = "UTF-8"; f.open("r"); var src = f.read(); f.close();
    $.global.MCP_BRIDGE_HEADLESS = true;
    try {
      (function () { eval(src); })();
    } finally {
      $.global.MCP_BRIDGE_HEADLESS = false;
    }
    if (!$.global.MCP_BRIDGE) return '{"ok":false,"error":"bridge loaded but did not export MCP_BRIDGE"}';
    return '{"ok":true,"version":"' + $.global.MCP_BRIDGE.version + '"}';
  } catch (e) {
    $.global.MCP_BRIDGE_HEADLESS = false;
    return '{"ok":false,"error":"' + String(e).replace(/["\\]/g, "'") + '","line":' + (e.line || 0) + '}';
  }
}

// Run one server command. The command JSON arrives in a file (same reason as
// apCallFile); the result JSON string goes back to Node, which writes it.
function apBridgeRunFile(cmdPath) {
  try {
    if (!$.global.MCP_BRIDGE) return '{"status":"error","message":"bridge not loaded"}';
    var f = new File(cmdPath);
    f.encoding = "UTF-8"; f.open("r"); var raw = f.read(); f.close();
    var c = eval("(" + raw + ")");
    var out = $.global.MCP_BRIDGE.run(c.command, c.args || {}, c.commandId || "");
    if (out === null || out === undefined) return '{"status":"error","message":"bridge returned nothing","_commandId":"' + (c.commandId || "") + '"}';
    return String(out);
  } catch (e) {
    return '{"status":"error","message":"' + String(e).replace(/["\\]/g, "'") + '"}';
  }
}
