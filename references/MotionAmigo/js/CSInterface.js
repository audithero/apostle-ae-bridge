/**
 * Minimal CSInterface for AE MCP Bridge
 * Based on Adobe CEP CSInterface
 */

function CSInterface() {
    this.hostEnvironment = {
        appName: "AEFT",
        appVersion: "2025"
    };
}

/**
 * Evaluates a JavaScript expression in the ExtendScript context
 */
CSInterface.prototype.evalScript = function(script, callback) {
    if (callback === null || callback === undefined) {
        callback = function(result) {};
    }
    window.__adobe_cep__.evalScript(script, callback);
};

/**
 * Opens a page in the default system browser
 */
CSInterface.prototype.openURLInDefaultBrowser = function(url) {
    if (window.cep && window.cep.util) {
        return window.cep.util.openURLInDefaultBrowser(url);
    }
    return false;
};

/**
 * Gets system information
 */
CSInterface.prototype.getSystemPath = function(pathType) {
    var path = window.__adobe_cep__.getSystemPath(pathType);
    var OSVersion = this.getOSInformation();
    if (OSVersion.indexOf("Windows") >= 0) {
        path = path.replace("file:///", "");
    } else if (OSVersion.indexOf("Mac") >= 0) {
        path = path.replace("file://", "");
    }
    return decodeURI(path);
};

/**
 * Gets OS information
 */
CSInterface.prototype.getOSInformation = function() {
    var userAgent = navigator.userAgent;
    if ((navigator.platform === "Win32") || (navigator.platform === "Windows")) {
        return "Windows";
    } else if ((navigator.platform === "MacIntel") || (navigator.platform === "Macintosh")) {
        return "Mac";
    }
    return "Unknown";
};

/**
 * System path types
 */
CSInterface.SystemPath = {
    USER_DATA: "userData",
    COMMON_FILES: "commonFiles",
    MY_DOCUMENTS: "myDocuments",
    APPLICATION: "application",
    EXTENSION: "extension",
    HOST_APPLICATION: "hostApplication"
};