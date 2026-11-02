#!/usr/bin/env node
/*
 * panel-relay.cjs — local WebSocket ↔ PTY relay for the Apostle panel's
 * embedded Claude terminal (the MotionAmigo pattern, without a compiled
 * binary): a dependency-free RFC6455 server + a python3 pty bridge, both
 * stock on macOS. Binds 127.0.0.1 ONLY.
 *
 * Each WebSocket connection gets its own `claude` TUI session (spawned in
 * the repo, TERM=xterm-256color). Browser→relay frames are keystrokes;
 * relay→browser binary frames are raw PTY bytes for xterm.js. A text
 * frame starting "\x00resize:" sets the PTY size (cols,rows).
 *
 * Usage: node scripts/panel-relay.cjs [--port 8471] [--cwd <repo>]
 * Exits itself after 10 idle minutes with no clients.
 */
"use strict";
const net = require("net");
const crypto = require("crypto");
const { spawn } = require("child_process");
const path = require("path");

const argv = process.argv.slice(2);
const opt = (f, d) => { const i = argv.indexOf(f); return i !== -1 ? argv[i + 1] : d; };
const PORT = Number(opt("--port", "8471"));
const CWD = opt("--cwd", path.join(__dirname, ".."));
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

// Resolve the claude binary explicitly: the user's PATH entry for it often
// comes from .zshrc, which non-interactive login shells (and therefore the
// pty's zsh -lc) never source — first field failure was "command not
// found: claude" inside the panel terminal.
function resolveClaude() {
  const fs = require("fs");
  const os = require("os");
  if (process.env.CLAUDE_BIN && fs.existsSync(process.env.CLAUDE_BIN)) return process.env.CLAUDE_BIN;
  const home = os.homedir();
  const candidates = [
    path.join(home, ".local", "bin", "claude"),
    path.join(home, ".claude", "local", "claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude"
  ];
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch (e) {} }
  try {
    const out = require("child_process").execSync("/bin/zsh -lc 'command -v claude' 2>/dev/null", { timeout: 10000 }).toString().trim();
    if (out) return out;
  } catch (e) {}
  return "claude"; // last resort: let the shell try
}
const CLAUDE_BIN = resolveClaude();

// Shared secret. Browsers let any web page open a WebSocket to 127.0.0.1, so
// without this a site visited while the relay runs could start a claude
// session (with --dangerously-skip-permissions) in the repo. The token lives
// in a file only this user can read; the panel reads it and sends ?token=.
// relayToken() is shared with the panel (same file, same create-once rule).
const RELAY_TOKEN = require("./lib/relay-token.cjs").relayToken();
function tokenOk(q) {
  for (const kv of q.split("&")) {
    if (kv.indexOf("token=") !== 0) continue;
    const got = Buffer.from(decodeURIComponent(kv.slice(6)));
    const want = Buffer.from(RELAY_TOKEN);
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  }
  return false;
}

// python pty bridge: stdin -> pty master, pty master -> stdout. Control
// line on fd 3 would be cleaner but pipes beyond stdio are awkward with
// spawn; instead resize commands arrive on stdin as \x00resize:COLS,ROWS\n
// (NUL never occurs in keyboard input).
const PY = `
import os, pty, select, subprocess, sys, fcntl, termios, struct, signal
cols, rows = 100, 30
master, slave = pty.openpty()
def setsize(c, r):
    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", r, c, 0, 0))
setsize(cols, rows)
env = dict(os.environ)
env["TERM"] = "xterm-256color"
extra = sys.argv[3] if len(sys.argv) > 3 else ""
p = subprocess.Popen(["/bin/zsh", "-lc", "exec " + "'" + sys.argv[2] + "' " + extra], stdin=slave, stdout=slave,
                     stderr=slave, preexec_fn=os.setsid, env=env, cwd=sys.argv[1])
os.close(slave)
buf = b""
while p.poll() is None:
    r, _, _ = select.select([master, 0], [], [], 0.5)
    if master in r:
        try:
            data = os.read(master, 65536)
        except OSError:
            break
        if not data: break
        os.write(1, data)
    if 0 in r:
        data = os.read(0, 65536)
        if not data: break
        buf += data
        while b"\\x00resize:" in buf:
            pre, rest = buf.split(b"\\x00resize:", 1)
            if b"\\n" not in rest:
                buf = pre + b"\\x00resize:" + rest
                break
            line, buf2 = rest.split(b"\\n", 1)
            buf = pre + buf2
            try:
                c, r2 = line.decode().split(",")
                setsize(int(c), int(r2))
                os.killpg(os.getpgid(p.pid), signal.SIGWINCH)
            except Exception:
                pass
        if buf:
            os.write(master, buf)
            buf = b""
try:
    os.killpg(os.getpgid(p.pid), signal.SIGTERM)
except Exception:
    pass
`;

// ---------------- minimal RFC6455 ----------------
function wsAccept(key) {
  return crypto.createHash("sha1").update(key + GUID).digest("base64");
}
function encodeFrame(payload, opcode) {
  const len = payload.length;
  let header;
  if (len < 126) header = Buffer.from([0x80 | opcode, len]);
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([header, payload]);
}
// returns {frame:{opcode,payload}, rest} or null if incomplete
function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let off = 2;
  if (len === 126) { if (buf.length < 4) return null; len = buf.readUInt16BE(2); off = 4; }
  else if (len === 127) { if (buf.length < 10) return null; len = Number(buf.readBigUInt64BE(2)); off = 10; }
  let mask = null;
  if (masked) { if (buf.length < off + 4) return null; mask = buf.slice(off, off + 4); off += 4; }
  if (buf.length < off + len) return null;
  const payload = Buffer.from(buf.slice(off, off + len));
  if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
  return { frame: { opcode, payload }, rest: buf.slice(off + len) };
}

let clients = 0;
let lastActivity = Date.now();

const server = net.createServer((sock) => {
  let upgraded = false;
  let acc = Buffer.alloc(0);
  let pty = null;

  sock.on("data", (chunk) => {
    lastActivity = Date.now();
    if (!upgraded) {
      acc = Buffer.concat([acc, chunk]);
      const headEnd = acc.indexOf("\r\n\r\n");
      if (headEnd === -1) return;
      const head = acc.slice(0, headEnd).toString();
      const keyMatch = head.match(/Sec-WebSocket-Key:\s*(\S+)/i);
      if (!keyMatch || !/GET/.test(head)) { sock.end("HTTP/1.1 400 Bad Request\r\n\r\n"); return; }
      const query = ((head.split("\r\n")[0].split(" ")[1] || "").split("?")[1] || "");
      let authed = false;
      try { authed = tokenOk(query); } catch (e) {}
      if (!authed) { sock.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return; }
      // per-session claude flags via query string (?args=...), whitelisted —
      // the panel's SKIP PERMISSIONS toggle rides in here
      const ALLOWED_FLAGS = new Set(["--dangerously-skip-permissions", "--continue", "--resume"]);
      // flags that take one value, with the shape that value must have
      const ALLOWED_VALUED = { "--model": /^[a-z0-9][a-z0-9.\-[\]]*$/i, "--effort": /^(low|medium|high|xhigh|max)$/ };
      let extraArgs = [];
      try {
        for (const kv of query.split("&")) {
          if (kv.indexOf("args=") !== 0) continue;
          const toks = decodeURIComponent(kv.slice(5)).split(" ").filter(Boolean);
          for (let i = 0; i < toks.length; i++) {
            if (ALLOWED_FLAGS.has(toks[i])) extraArgs.push(toks[i]);
            else if (ALLOWED_VALUED[toks[i]] && ALLOWED_VALUED[toks[i]].test(toks[i + 1] || "")) { extraArgs.push(toks[i], toks[i + 1]); i++; }
          }
        }
      } catch (e) {}
      sock.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + wsAccept(keyMatch[1]) + "\r\n\r\n");
      upgraded = true;
      acc = acc.slice(headEnd + 4);
      clients++;
      pty = spawn("python3", ["-c", PY, CWD, CLAUDE_BIN, extraArgs.join(" ")], { cwd: CWD });
      pty.stdout.on("data", (d) => { try { sock.write(encodeFrame(d, 0x2)); } catch (e) {} });
      pty.stderr.on("data", (d) => { try { sock.write(encodeFrame(d, 0x2)); } catch (e) {} });
      pty.on("exit", () => { try { sock.write(encodeFrame(Buffer.from("\r\n[claude session ended]\r\n"), 0x2)); sock.end(encodeFrame(Buffer.alloc(0), 0x8)); } catch (e) {} });
      if (acc.length === 0) return;
      chunk = Buffer.alloc(0); // fall through to frame parsing with acc
    } else {
      acc = Buffer.concat([acc, chunk]);
    }
    let out;
    while ((out = decodeFrame(acc)) !== null) {
      acc = out.rest;
      const { opcode, payload } = out.frame;
      if (opcode === 0x8) { sock.end(encodeFrame(Buffer.alloc(0), 0x8)); break; }
      if (opcode === 0x9) { sock.write(encodeFrame(payload, 0xa)); continue; }
      if ((opcode === 0x1 || opcode === 0x2) && pty && pty.exitCode === null) pty.stdin.write(payload);
    }
  });
  const cleanup = () => {
    if (upgraded) { clients--; }
    if (pty && pty.exitCode === null) { try { pty.kill("SIGTERM"); } catch (e) {} }
  };
  sock.on("close", cleanup);
  sock.on("error", cleanup);
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") { console.log("relay already running on " + PORT); process.exit(0); }
  console.error(e.toString());
  process.exit(1);
});
server.listen(PORT, "127.0.0.1", () => console.log("apostle relay listening on 127.0.0.1:" + PORT));

setInterval(() => {
  if (clients === 0 && Date.now() - lastActivity > 10 * 60 * 1000) {
    console.log("idle — exiting");
    process.exit(0);
  }
}, 30000);
