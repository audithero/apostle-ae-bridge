"use strict";
// Secret shared by the Apostle panel and scripts/panel-relay.cjs.
// ~/.apostle/relay.token, created once (exclusive create, so the panel and a
// relay starting at the same moment can't end up with different tokens),
// readable by this user only.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

function relayToken() {
  const dir = path.join(os.homedir(), ".apostle");
  const file = path.join(dir, "relay.token");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(file, crypto.randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  const tok = fs.readFileSync(file, "utf8").trim();
  if (tok.length < 32) throw new Error("relay token at " + file + " is too short; delete it and retry");
  return tok;
}

module.exports = { relayToken };
