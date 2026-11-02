import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const REPO = path.resolve(__dirname, "..");

function w(p: string, s: string, mode?: number) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s);
  if (mode) fs.chmodSync(p, mode);
}

describe("install-core.sh", () => {
  it("installs a payload, reports each step, registers the bridge with Claude", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "apostle-core-"));
    const home = path.join(root, "home");
    const payload = path.join(root, "payload");
    const dest = path.join(home, "Applications", "Apostle AE Bridge");

    // a tiny release: the real apply-update.sh, a server that says "running"
    w(path.join(payload, "release.json"), JSON.stringify({ product: "apostle-ae-bridge", version: "9.9.9-test" }));
    fs.mkdirSync(path.join(payload, "scripts"), { recursive: true });
    fs.copyFileSync(path.join(REPO, "scripts", "apply-update.sh"), path.join(payload, "scripts", "apply-update.sh"));
    w(path.join(payload, "build", "index.js"), 'console.error("After Effects MCP Server running..."); setInterval(() => {}, 1000);\n');
    w(path.join(payload, "apostle-panel", "CSXS", "manifest.xml"), "<ExtensionManifest/>");

    // a claude stub (found first, at ~/.local/bin/claude) that records its args
    const argsLog = path.join(root, "claude-args.log");
    w(path.join(home, ".local", "bin", "claude"), `#!/bin/bash\necho "$*" >> "${argsLog}"\nexit 0\n`, 0o755);

    // an After Effects prefs file with script file access off
    const prefs = path.join(home, "Library", "Preferences", "Adobe", "After Effects", "26.3", "Adobe After Effects 26.3 Prefs.txt");
    w(prefs, '["Main Pref Section v2"]\r\t"Pref_SCRIPTING_FILE_NETWORK_SECURITY" = "0"\r');

    const nodeDir = path.dirname(process.execPath);
    const r = spawnSync("/bin/bash", [path.join(REPO, "scripts", "install-core.sh"), payload], {
      env: { HOME: home, PATH: `${nodeDir}:/usr/bin:/bin:/usr/sbin:/sbin`, APOSTLE_SKIP_NODE_DOWNLOAD: "1" },
      encoding: "utf8", timeout: 60000
    });
    expect(r.status, r.stderr).toBe(0);

    const lines = r.stdout.trim().split("\n");
    // every line is protocol, nothing else on stdout
    for (const l of lines) expect(l).toMatch(/^@@(step (files|node|claude|panel|prefs|connect) (running|done|warn|fail) .+|done .+)$/);
    const finished = lines.filter((l) => / (done|warn) /.test(l) && l.startsWith("@@step")).map((l) => l.split(" ")[1]);
    expect(finished).toEqual(["files", "node", "claude", "panel", "prefs", "connect"]);
    expect(lines[lines.length - 1]).toBe("@@done 9.9.9-test");

    // files and runtime
    expect(JSON.parse(fs.readFileSync(path.join(dest, "release.json"), "utf8")).version).toBe("9.9.9-test");
    const ownNode = path.join(dest, "runtime", "node", "bin", "node");
    expect(fs.existsSync(ownNode)).toBe(true);

    // claude: old registration removed, new one points at the install's own node
    const calls = fs.readFileSync(argsLog, "utf8").trim().split("\n");
    expect(calls[0]).toBe("mcp remove -s user AfterEffectsMCP");
    expect(calls[1]).toBe(`mcp add -s user AfterEffectsMCP -- ${ownNode} ${path.join(dest, "build", "index.js")}`);

    // panel symlink, bridge folder, prefs flipped with a backup
    const link = path.join(home, "Library", "Application Support", "Adobe", "CEP", "extensions", "apostle-panel");
    expect(fs.readlinkSync(link)).toBe(path.join(dest, "apostle-panel"));
    expect(fs.existsSync(path.join(home, "Documents", "ae-mcp-bridge"))).toBe(true);
    expect(fs.readFileSync(prefs, "utf8")).toContain('"Pref_SCRIPTING_FILE_NETWORK_SECURITY" = "1"');
    expect(fs.readFileSync(prefs + ".before-apostle", "utf8")).toContain('= "0"');

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("stops at the first failure with @@fail and exit 1", () => {
    const r = spawnSync("/bin/bash", [path.join(REPO, "scripts", "install-core.sh"), "/nonexistent-payload"], {
      env: { HOME: os.tmpdir(), PATH: "/usr/bin:/bin" }, encoding: "utf8"
    });
    expect(r.status).toBe(1);
    expect(r.stdout.trim().split("\n").pop()).toBe("@@fail files not a release folder: /nonexistent-payload");
  });
});
