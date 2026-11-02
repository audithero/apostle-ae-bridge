import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const u = require("../scripts/lib/updater.cjs");
const REPO = path.resolve(__dirname, "..");

function keypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return { publicKey, privB64: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64") };
}
const payload = (over = {}) => ({
  product: "apostle-ae-bridge", channel: "beta", version: "2.21.0-beta.1",
  path: "releases/2.21.0-beta.1/Apostle-AE-Bridge-2.21.0-beta.1.zip", size: 10, sha256: "a".repeat(64), ...over
});

describe("compareVersions", () => {
  it("orders releases and prereleases", () => {
    const sorted = ["2.20.0", "2.21.0-beta.2", "2.21.0-beta.10", "2.21.0", "2.21.0-beta.1", "10.0.0", "2.9.9"]
      .sort(u.compareVersions);
    expect(sorted).toEqual(["2.9.9", "2.20.0", "2.21.0-beta.1", "2.21.0-beta.2", "2.21.0-beta.10", "2.21.0", "10.0.0"]);
  });
  it("rejects non-versions", () => {
    expect(() => u.compareVersions("2.20", "2.20.0")).toThrow();
  });
});

describe("signed manifests", () => {
  const k = keypair();
  it("verifies a manifest signed with the matching key", () => {
    const m = u.signManifest(payload(), k.privB64);
    expect(u.verifyManifest(m, k.publicKey, "beta").version).toBe("2.21.0-beta.1");
  });
  it("rejects a tampered payload", () => {
    const m = u.signManifest(payload(), k.privB64);
    const forged = Buffer.from(JSON.stringify(payload({ sha256: "b".repeat(64) }))).toString("base64");
    expect(() => u.verifyManifest({ ...m, payload: forged }, k.publicKey, "beta")).toThrow(/signature/);
  });
  it("rejects another key's signature", () => {
    const m = u.signManifest(payload(), keypair().privB64);
    expect(() => u.verifyManifest(m, k.publicKey, "beta")).toThrow(/signature/);
  });
  it("rejects a valid manifest replayed onto another channel or product", () => {
    expect(() => u.verifyManifest(u.signManifest(payload(), k.privB64), k.publicKey, "stable")).toThrow(/channel/);
    expect(() => u.verifyManifest(u.signManifest(payload({ product: "other" }), k.privB64), k.publicKey, "beta")).toThrow(/other/);
  });
  it("the shipped public key is a valid ed25519 key", () => {
    expect(u.publicKeyFrom(REPO).asymmetricKeyType).toBe("ed25519");
  });
});

describe("apply-update.sh", () => {
  it("replaces app files, keeps the user's briefs, kits, runs and .env", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "apostle-apply-"));
    const src = path.join(root, "src"), dest = path.join(root, "dest");
    const w = (p: string, s: string) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
    // the install as the user has it
    w(path.join(dest, "release.json"), JSON.stringify({ product: "apostle-ae-bridge", version: "2.20.0" }));
    w(path.join(dest, "scripts", "old-only.cjs"), "dropped in the new release");
    w(path.join(dest, "scripts", "lib", "x.cjs"), "old");
    w(path.join(dest, "brands", "demo.json"), "USER EDITED");
    w(path.join(dest, "brands", "mine.json"), "user kit");
    w(path.join(dest, "briefs", "client", "brief.md"), "user brief");
    w(path.join(dest, ".apostle-runs", "run.json"), "run");
    w(path.join(dest, ".env"), "FAL_API_KEY=secret");
    // the new release
    w(path.join(src, "release.json"), JSON.stringify({ product: "apostle-ae-bridge", version: "2.21.0" }));
    w(path.join(src, "scripts", "lib", "x.cjs"), "new");
    w(path.join(src, "brands", "demo.json"), "new demo");
    w(path.join(src, "brands", "demo2.json"), "new kit");
    w(path.join(src, "CLAUDE.md"), "new notes");
    w(path.join(src, ".env"), "SHOULD NOT SHIP");
    execFileSync("/bin/bash", [path.join(REPO, "scripts", "apply-update.sh"), src, dest]);
    const r = (p: string) => fs.readFileSync(path.join(dest, p), "utf8");
    expect(JSON.parse(r("release.json")).version).toBe("2.21.0");
    expect(r("scripts/lib/x.cjs")).toBe("new");
    expect(fs.existsSync(path.join(dest, "scripts", "old-only.cjs"))).toBe(false);
    expect(r("CLAUDE.md")).toBe("new notes");
    expect(r("brands/demo.json")).toBe("USER EDITED");
    expect(r("brands/mine.json")).toBe("user kit");
    expect(r("brands/demo2.json")).toBe("new kit");
    expect(r("briefs/client/brief.md")).toBe("user brief");
    expect(r(".apostle-runs/run.json")).toBe("run");
    expect(r(".env")).toBe("FAL_API_KEY=secret");
    fs.rmSync(root, { recursive: true, force: true });
  });
});
