/*
 * redesign-providers.cjs — model providers for the redesign pipeline,
 * behind two tiny interfaces so models can be swapped without touching
 * orchestration (scripts/redesign.cjs) or AE code (apostle.jsx):
 *
 *   ImageProvider.generate({prompt, images, outPath, params, timeoutSec, log})
 *     -> Promise<{path, meta}>   (one concept image written to outPath)
 *   PlanProvider.plan({prompt, model, timeoutSec, log})
 *     -> Promise<string>         (raw LLM text, parsed/validated by caller)
 *
 * Providers: fal (OpenAI image model via fal.ai queue API), claude-cli
 * (reconstruction LLM via `claude -p`), and offline mocks for both.
 * Dependency-free: node https + child_process only.
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");
const { spawn, execSync } = require("child_process");

// ---------------- helpers ----------------

function falKey() {
  if (process.env.FAL_KEY && process.env.FAL_KEY.trim()) return process.env.FAL_KEY.trim();
  const f = path.join(os.homedir(), ".apostle", "fal.key");
  try { if (fs.existsSync(f)) return fs.readFileSync(f, "utf8").trim(); } catch (e) {}
  return null;
}

function toDataUri(p) {
  const ext = path.extname(p).toLowerCase().replace(".", "");
  const mime = ext === "jpg" ? "image/jpeg" : "image/" + (ext || "png");
  return "data:" + mime + ";base64," + fs.readFileSync(p).toString("base64");
}

function httpsRequest(method, url, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { method, hostname: u.hostname, path: u.pathname + u.search, headers },
      (res) => {
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
      }
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error("request timeout: " + url)));
    if (body) req.write(body);
    req.end();
  });
}

async function downloadTo(url, outPath, timeoutMs) {
  if (url.startsWith("data:")) {
    const b64 = url.slice(url.indexOf(",") + 1);
    fs.writeFileSync(outPath, Buffer.from(b64, "base64"));
    return;
  }
  const r = await httpsRequest("GET", url, {}, null, timeoutMs);
  if (r.status !== 200) throw new Error("download failed " + r.status + ": " + url);
  fs.writeFileSync(outPath, r.body);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- image providers ----------------

const falImageProvider = {
  name: "fal",
  available() { return !!falKey(); },
  // model like "fal-ai/gpt-image-1/edit-image"; params passed through verbatim
  async generate({ prompt, images, outPath, model, params, timeoutSec, log }) {
    const key = falKey();
    if (!key) throw new Error("No fal.ai key. Set FAL_KEY or write it to ~/.apostle/fal.key");
    const headers = { "Authorization": "Key " + key, "Content-Type": "application/json" };
    const body = JSON.stringify(Object.assign(
      { prompt, image_urls: images.map(toDataUri) },
      params || {}
    ));
    log && log("fal: submitting to " + model + " (" + Math.round(body.length / 1024) + " KB payload)");
    const sub = await httpsRequest("POST", "https://queue.fal.run/" + model, headers, body, 60000);
    if (sub.status !== 200 && sub.status !== 202) {
      throw new Error("fal submit failed " + sub.status + ": " + sub.body.toString().slice(0, 400));
    }
    const q = JSON.parse(sub.body.toString());
    const statusUrl = q.status_url;
    const responseUrl = q.response_url;
    if (!statusUrl || !responseUrl) throw new Error("fal queue response missing status/response URLs: " + sub.body.toString().slice(0, 300));
    const deadline = Date.now() + timeoutSec * 1000;
    let st = q.status;
    while (st !== "COMPLETED") {
      if (Date.now() > deadline) throw new Error("fal generation timed out after " + timeoutSec + "s (last status " + st + ")");
      await sleep(3000);
      const sr = await httpsRequest("GET", statusUrl, headers, null, 30000);
      try { st = JSON.parse(sr.body.toString()).status; } catch (e) { st = "UNKNOWN"; }
      if (st === "FAILED" || st === "ERROR") throw new Error("fal generation failed: " + sr.body.toString().slice(0, 400));
      log && log("fal: " + st);
    }
    const rr = await httpsRequest("GET", responseUrl, headers, null, 60000);
    if (rr.status !== 200) throw new Error("fal result fetch failed " + rr.status + ": " + rr.body.toString().slice(0, 400));
    const out = JSON.parse(rr.body.toString());
    const imgs = out.images || (out.image ? [out.image] : []);
    if (!imgs.length || !imgs[0].url) throw new Error("fal result had no images: " + rr.body.toString().slice(0, 300));
    await downloadTo(imgs[0].url, outPath, 120000);
    return { path: outPath, meta: { requestId: q.request_id || null, model } };
  }
};

const mockImageProvider = {
  name: "mock",
  available() { return true; },
  // Offline pipeline test: the "concept" is the original frame passed
  // through a visible transform (rotate hue via sips) so downstream
  // stages can tell concepts apart from the reference.
  async generate({ images, outPath, log }) {
    fs.copyFileSync(images[0], outPath);
    try { execSync(`sips --setProperty format png "${outPath}" >/dev/null 2>&1`); } catch (e) {}
    log && log("mock image provider: copied reference as concept (offline test mode)");
    return { path: outPath, meta: { model: "mock" } };
  }
};

// ---------------- plan providers ----------------

function resolveClaudeBin() {
  if (process.env.CLAUDE_BIN && fs.existsSync(process.env.CLAUDE_BIN)) return process.env.CLAUDE_BIN;
  const home = os.homedir();
  const candidates = [
    path.join(home, ".local", "bin", "claude"),
    path.join(home, ".claude", "local", "claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude"
  ];
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch (e) {} }
  return "claude";
}

const claudeCliPlanProvider = {
  name: "claude-cli",
  available() { return true; },
  plan({ prompt, model, timeoutSec, cwd, log }) {
    return new Promise((resolve, reject) => {
      const bin = resolveClaudeBin();
      const args = ["-p", "--output-format", "text", "--allowedTools", "Read"];
      if (model) args.push("--model", model);
      log && log("claude-cli: running " + path.basename(bin) + " -p (" + Math.round(prompt.length / 1024) + " KB prompt)");
      const child = spawn(bin, args, { cwd: cwd || process.cwd(), stdio: ["pipe", "pipe", "pipe"] });
      let out = "", err = "";
      const killer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("claude -p timed out after " + timeoutSec + "s")); }, timeoutSec * 1000);
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", (e) => { clearTimeout(killer); reject(e); });
      child.on("close", (code) => {
        clearTimeout(killer);
        if (code !== 0 && !out.trim()) return reject(new Error("claude -p exited " + code + ": " + err.slice(0, 400)));
        resolve(out);
      });
      child.stdin.write(prompt);
      child.stdin.end();
    });
  }
};

const mockPlanProvider = {
  name: "mock",
  available() { return true; },
  // Deterministic offline plan: nudge the accent + heading — enough to
  // exercise validation, apply, and pixel verification without a model.
  async plan() {
    return JSON.stringify({
      schemaVersion: 1,
      summary: "Mock plan: left-align hierarchy test.",
      ops: [
        { op: "setTransform", layer: "Super", position: [820, 480], why: "mock move" },
        { op: "setFill", layer: "Super", color: [0.1, 0.1, 0.1], why: "mock restyle" }
      ]
    });
  }
};

// ---------------- registry ----------------

const imageProviders = { fal: falImageProvider, mock: mockImageProvider };
const planProviders = { "claude-cli": claudeCliPlanProvider, mock: mockPlanProvider };

module.exports = { imageProviders, planProviders, falKey, resolveClaudeBin, toDataUri };
