#!/usr/bin/env node
"use strict";
// Check for and install Apostle AE Bridge updates from the command line.
//   node scripts/update.cjs            check (prints current, latest, notes)
//   node scripts/update.cjs --apply    download, verify and install
//   node scripts/update.cjs --channel beta [--apply]   switch channel (remembered)
// Same code path as the panel's update button (scripts/lib/updater.cjs).
const path = require("path");
const u = require("./lib/updater.cjs");

const argv = process.argv.slice(2);
const DEST = path.resolve(__dirname, "..");
const chIdx = argv.indexOf("--channel");

(async () => {
  if (chIdx !== -1) {
    const s = u.writeSettings({ channel: argv[chIdx + 1] });
    console.log("update channel: " + s.channel);
  }
  if (argv.includes("--apply")) {
    const r = await u.updateNow(DEST, { onProgress: (m) => console.log("… " + m) });
    if (r.status === "updated") {
      console.log("Updated " + r.from + " → " + r.to + ".");
      if (r.notes) console.log("\n" + r.notes + "\n");
      console.log("Close and reopen the Apostle panel, and restart Claude (/exit, then claude).");
    } else {
      report(r);
    }
    return;
  }
  report(await u.checkForUpdate(DEST));
})().catch((e) => { console.error("update failed: " + e.message); process.exit(1); });

function report(r) {
  if (r.status === "dev") return console.log("Developer install (git checkout, " + (r.current || "?") + "): update with git pull.");
  if (r.status === "unknown-install") return console.log("No release.json here: reinstall from a release zip.");
  if (r.status === "current") return console.log("Up to date: " + r.current + " (" + r.channel + ").");
  console.log("Update available: " + r.current + " → " + r.latest.version + " (" + r.channel + ")");
  if (r.latest.notes) console.log("\n" + r.latest.notes + "\n");
  console.log("Install it: node scripts/update.cjs --apply   (or the update button in the Apostle panel)");
}
