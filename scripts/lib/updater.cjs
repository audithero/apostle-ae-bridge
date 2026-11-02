"use strict";
// Apostle AE Bridge self-updater. Shared by the panel (Node 17 inside CEP),
// scripts/update.cjs (CLI) and the tests. Dependency-free.
//
// Releases live on R2 behind https://updates.apostle.io/ae-bridge/:
//   channels/<channel>/latest.json   { payload: base64(JSON), signature: base64 }
//   releases/<version>/Apostle-AE-Bridge-<version>.zip
// The payload is signed with the release key (ed25519; private half in the
// publisher's Keychain, public half in apostle-panel/release-key.pub). Nothing
// is downloaded, unpacked or applied unless the signature verifies, and the zip
// must match the signed size and sha256. The host only has to be reachable.

const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const PRODUCT = "apostle-ae-bridge";
const BASE_URL = "https://updates.apostle.io/ae-bridge";
const CHANNELS = ["stable", "beta"];
const SETTINGS_FILE = path.join(os.homedir(), ".apostle", "update.json");
const STAGING_ROOT = path.join(os.homedir(), "Library", "Caches", "Apostle AE Bridge", "updates");

// ---- versions --------------------------------------------------------------
// semver subset: MAJOR.MINOR.PATCH[-pre.N]; a prerelease sorts before its release
function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(v || "").trim());
  if (!m) return null;
  return { nums: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split(".") : [] };
}
function compareVersions(a, b) {
  const A = parseVersion(a), B = parseVersion(b);
  if (!A || !B) throw new Error("not a version: " + (!A ? a : b));
  for (let i = 0; i < 3; i++) if (A.nums[i] !== B.nums[i]) return A.nums[i] < B.nums[i] ? -1 : 1;
  if (!A.pre.length || !B.pre.length) return A.pre.length === B.pre.length ? 0 : (A.pre.length ? -1 : 1);
  for (let i = 0; i < Math.max(A.pre.length, B.pre.length); i++) {
    const x = A.pre[i], y = B.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn && yn && +x !== +y) return +x < +y ? -1 : 1;
    if (xn !== yn) return xn ? -1 : 1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

// ---- install + settings ------------------------------------------------------
function readInstalled(dest) {
  try { return JSON.parse(fs.readFileSync(path.join(dest, "release.json"), "utf8")); } catch (e) { return null; }
}
// A git checkout is a developer install: it updates with git, never with this.
function isDevInstall(dest) { return fs.existsSync(path.join(dest, ".git")); }

function readSettings() {
  try {
    const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    return { channel: CHANNELS.includes(s.channel) ? s.channel : "stable", lastCheck: s.lastCheck || 0 };
  } catch (e) { return { channel: "stable", lastCheck: 0 }; }
}
function writeSettings(patch) {
  const s = Object.assign(readSettings(), patch || {});
  if (!CHANNELS.includes(s.channel)) throw new Error("unknown channel: " + s.channel);
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2) + "\n");
  return s;
}

// ---- signing ----------------------------------------------------------------
function publicKeyFrom(dest) {
  const b64 = fs.readFileSync(path.join(dest, "apostle-panel", "release-key.pub"), "utf8").trim();
  return crypto.createPublicKey({ key: Buffer.from(b64, "base64"), format: "der", type: "spki" });
}
function signManifest(payloadObj, privateKeyB64) {
  const payload = Buffer.from(JSON.stringify(payloadObj), "utf8");
  const key = crypto.createPrivateKey({ key: Buffer.from(privateKeyB64, "base64"), format: "der", type: "pkcs8" });
  return { payload: payload.toString("base64"), signature: crypto.sign(null, payload, key).toString("base64") };
}
// Returns the payload object, or throws. Checks product and channel too, so a
// validly signed manifest can't be replayed onto the wrong product or channel.
function verifyManifest(manifest, publicKey, channel) {
  if (!manifest || typeof manifest.payload !== "string" || typeof manifest.signature !== "string") throw new Error("malformed update manifest");
  const payload = Buffer.from(manifest.payload, "base64");
  if (!crypto.verify(null, payload, publicKey, Buffer.from(manifest.signature, "base64"))) throw new Error("update manifest signature is invalid");
  const p = JSON.parse(payload.toString("utf8"));
  if (p.product !== PRODUCT) throw new Error("manifest is for " + p.product);
  if (channel && p.channel !== channel) throw new Error("manifest is for channel " + p.channel + ", wanted " + channel);
  if (!parseVersion(p.version)) throw new Error("manifest has no valid version");
  if (!/^[0-9a-f]{64}$/.test(p.sha256 || "") || !(p.size > 0) || !p.path) throw new Error("manifest is missing the file, size or sha256");
  return p;
}

// ---- network ------------------------------------------------------------------
function get(url, { maxBytes = 512 * 1024 * 1024, toFile = null, redirects = 3, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!/^https:\/\//.test(url)) return reject(new Error("refusing non-https URL: " + url));
    const req = https.get(url, { headers: { "User-Agent": PRODUCT + "-updater", "Cache-Control": "no-cache" } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).toString(), { maxBytes, toFile, redirects: redirects - 1, timeoutMs }));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error("HTTP " + res.statusCode + " for " + url)); }
      let n = 0;
      const chunks = [];
      const out = toFile ? fs.createWriteStream(toFile) : null;
      res.on("data", (c) => {
        n += c.length;
        if (n > maxBytes) { req.destroy(new Error("download larger than expected")); return; }
        if (out) out.write(c); else chunks.push(c);
      });
      res.on("end", () => {
        if (out) out.end(() => resolve(n)); else resolve(Buffer.concat(chunks));
      });
      res.on("error", reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timed out fetching " + url)));
    req.on("error", reject);
  });
}

// ---- the three steps ------------------------------------------------------------
// 1. check: is a newer, validly signed release available on this install's channel?
async function checkForUpdate(dest, { channel, baseUrl = BASE_URL } = {}) {
  const installed = readInstalled(dest);
  if (isDevInstall(dest)) return { status: "dev", current: installed && installed.version };
  if (!installed || !parseVersion(installed.version)) return { status: "unknown-install" };
  const ch = channel || readSettings().channel;
  const raw = await get(baseUrl + "/channels/" + ch + "/latest.json", { maxBytes: 64 * 1024 });
  const latest = verifyManifest(JSON.parse(raw.toString("utf8")), publicKeyFrom(dest), ch);
  try { writeSettings({ lastCheck: Date.now() }); } catch (e) {}
  const newer = compareVersions(latest.version, installed.version) > 0;
  return { status: newer ? "available" : "current", current: installed.version, channel: ch, latest };
}

// 2. stage: download, verify size + sha256, unpack, and check the unpacked
// release says what the manifest said.
async function stageUpdate(latest, { baseUrl = BASE_URL, stagingRoot = STAGING_ROOT, onProgress } = {}) {
  const dir = path.join(stagingRoot, latest.version);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const zip = path.join(dir, "release.zip");
  if (onProgress) onProgress("downloading " + latest.version + " (" + Math.round(latest.size / 1e6 * 10) / 10 + " MB)");
  const n = await get(baseUrl + "/" + latest.path.replace(/^\/+/, ""), { toFile: zip, maxBytes: latest.size + 1 });
  if (n !== latest.size) throw new Error("download is " + n + " bytes, expected " + latest.size);
  const sha = crypto.createHash("sha256").update(fs.readFileSync(zip)).digest("hex");
  if (sha !== latest.sha256) throw new Error("download checksum does not match the signed release");
  if (onProgress) onProgress("unpacking");
  const unpack = path.join(dir, "unpacked");
  execFileSync("/usr/bin/ditto", ["-x", "-k", zip, unpack]);
  const root = path.join(unpack, "Apostle AE Bridge");
  const rel = readInstalled(root);
  if (!rel || rel.version !== latest.version || rel.product !== PRODUCT) throw new Error("unpacked release does not match the manifest");
  return root;
}

// 3. apply: the NEW release's apply-update.sh copies it over the install,
// keeping the user's briefs, brand kits, runs and .env.
function applyStaged(stagedRoot, dest) {
  const script = path.join(stagedRoot, "scripts", "apply-update.sh");
  return execFileSync("/bin/bash", [script, stagedRoot, dest], { encoding: "utf8", timeout: 300000 });
}

async function updateNow(dest, opts = {}) {
  const chk = await checkForUpdate(dest, opts);
  if (chk.status !== "available") return chk;
  const staged = await stageUpdate(chk.latest, opts);
  if (opts.onProgress) opts.onProgress("installing " + chk.latest.version);
  applyStaged(staged, dest);
  const now = readInstalled(dest);
  if (!now || now.version !== chk.latest.version) throw new Error("update copied but the install still reports " + (now && now.version));
  try { fs.rmSync(path.dirname(path.dirname(staged)), { recursive: true, force: true }); } catch (e) {}
  return { status: "updated", from: chk.current, to: chk.latest.version, notes: chk.latest.notes || "" };
}

module.exports = {
  PRODUCT, BASE_URL, CHANNELS, parseVersion, compareVersions, readInstalled, isDevInstall,
  readSettings, writeSettings, signManifest, verifyManifest, publicKeyFrom,
  checkForUpdate, stageUpdate, applyStaged, updateNow
};
