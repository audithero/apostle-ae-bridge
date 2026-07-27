# Apostle AE Bridge — Architecture

(Upstream server internals: see `docs/ARCHITECTURE.md`. This file covers the Apostle layer.)

## System

```
Claude Code ──stdio──▶ MCP server (Node, this repo, build/index.js)
                          │ writes command JSON (unique commandId, atomic write)
                          ▼
                   ~/Documents/ae-mcp-bridge/   (shared folder, AE_MCP_BRIDGE_DIR to override)
                          ▲
                          │ writes result JSON (same commandId)
                   AE ScriptUI bridge panel (src/scripts/mcp-bridge-auto.jsx, polls on timer,
                          │ executes against AE DOM, one undo group per command)
                          ▼
                   apostle/apostle.jsx (comp builder, state serializer, frame renderer, checks)
```

There is no socket into AE; ExtendScript cannot open one. The watched-folder file bridge is the proven pattern across every working AE MCP.

## Fork provenance

True GitHub fork of `a-y-ibrahim/after-effects-mcp` (forked at upstream v1.10.0, July 2026). `upstream` remote is configured for pulling fixes; upstream is a convenience, not a dependency. Chosen over `Dakkshin/after-effects-mcp` for: `see-frame` (visual feedback), `contact-sheet`, locale-independent matchNames, per-command IDs, atomic writes, documented macOS + Claude Code setup.

Layout note vs. the build brief: upstream keeps the bridge panel at `src/scripts/mcp-bridge-auto.jsx` (copied to `build/scripts/` at build time), not a top-level `bridge/` dir. We follow upstream's layout to keep merges clean. All Apostle additions live in `apostle/`, `.claude/`, `scripts/`, `docs/`.

## Upstream MCP tools (v1.10.0, key ones)

`run-script` / `execute-script` (arbitrary ExtendScript), `see-frame`, `contact-sheet`, `check-bridge`, `run-bridge-test`, `get-results`, `inspect-comp`, `inspect-layer`, `create-composition`, `create-camera`, `create-text-layer`, `apply-effect`, `set-effect-property`, `set-effect-keyframe`, `add-marker(s)`, render-queue tools, `render-aerender`, `match-reference`, plus audio/data-driven animation tools. 46 tools total.

## Phase 1 results (2026-07-27)

`apostle/apostle.jsx` v2.0.0 ports the ApostleCompositor build pipeline and adds `serializeCompState`, `dumpPropTree`, `renderKeyFrames` (saveFrameToPng + async guard, Render Queue fallback), and the three deterministic checks. Acceptance run: sample-beats built into a 48.6s 7-beat corridor world, expression rig, all checks green, 5 sampled frames visually verified correct.

The closed loop caught three latent bugs inherited from (or invisible to) the blind builder:

1. **Chained-ternary parsing** — ExtendScript is left-associative on `?:` chains; corridor station spacing silently evaluated to 2300 instead of 3200 in every prior build.
2. **Playhead-relative layer creation** — script-created layers start at the CTI, shifting rig/camera keyframes in composite space while DOM reads stay layer-time-consistent (checks pass, pixels wrong).
3. **Collapsed 3D precomps don't z-sort** — `collapseTransformation = true` on scene layers made the top-of-stack scene occlude every station regardless of camera position. This was very likely a root cause of the old "sections not working" symptom alongside the HandyCam double-transform.

Trade-off accepted: with collapse off, scenes rasterize at comp resolution; softness would only appear if the camera ever got nearer than ~1530px to a plane (station rest distance is 1700, and checkCameraDistance flags anything under 300).

MCP tool wiring: upstream `run-script`/`execute-script` + the loader snippet (CLAUDE.md) cover all APOSTLE entry points; no new `src/` tools were needed. `see-frame` remains available for quick in-AE downscaled captures; `renderKeyFrames` + `scripts/downscale-frame.sh` is the primary loop path.

## Camera rig decision (Phase 3 A/B, 2026-07-28)

Two rigs behind one interface in `apostle/apostle.jsx`:

- `buildRigHandyCam(master)`: clean null + HandyCam effect; one human Setup click; keyframes on effect properties only (matchNames from `apostle/matchnames-handycam.md`).
- `buildRigExpression(master)`: pure expression two-node rig; zero manual steps, zero plugin dependency.

Pre-agreed threshold: if the HandyCam path needs more than one human touch per comp or hits the duplicate-rig bug ("Couldn't find HandyCam Camera"), the expression rig becomes the default and HandyCam remains a manual-polish option only.

**Decision: expression rig is the default. HandyCam is explicit opt-in for static-position shake/polish only; `meta.rig = "auto"` resolves to expression.**

A/B protocol: identical sample-beats (7-beat CommBank corridor) through both rigs. Expression arm = APOSTLE_P1/P2 builds — all checks green, frames verified, zero manual steps. HandyCam arm = APOSTLE_HC build — Setup click done, effect keyframes laid correctly (13 keys on Position Offset, zero transform keys on the null), expressions clean, margins green. Results that decided it:

1. **HandyCam cannot do station transport.** `checkCameraDistance` reported zGap = 0 at stations 2–7 (camera exactly ON each scene plane); rendered frames corroborated: blank at the station-2 dwell, off-by-one scene at every later station. Sampling the Setup-generated (obfuscated) camera expressions showed why: camera position tracks Position Offset, but the look-at target is baked at Setup as controller + [0, 0, 2666.7] and stays pinned near the rig home — so a corridor-scale offset translates the camera onto the target plane facing backward. Position Offset is shake-scale by design. Small offsets (station 1, ≤ tens of px) frame correctly.
2. The only HandyCam-native big-move path is keyframing the controller's transform — exactly the double-transform bug that broke the old panel. The expression chain is obfuscated compiled-plugin output; not scriptably fixable with confidence.
3. **Human-touch count: 2 for one comp.** The Setup click is per-build, and an AE restart that predates a save forces a rebuild + re-click (this happened in the A/B itself).
4. Caveats recorded: HandyCam is unregistered on this machine ("some features are disabled" — conceivably related, unverifiable here); a licensed install might behave differently, but the touch-count and double-transform findings stand regardless.

The deterministic camera check and the rendered frames agreed exactly (zGap 0 ⇔ blank/off-by-one frames) — the closed loop diagnosed a third-party plugin's internals without opening a UI.

## Phase 2 results (2026-07-28)

`.claude/skills/verify-comp/SKILL.md` encodes the loop (check order: expression errors → safe margins → camera distance → serialize → 4–8 downscaled frames; 8-pass cap; same-defect-twice = blocked). Acceptance: three deliberate defects injected into a fresh APOSTLE_P2 build (super stripped of its autoFit expression and pushed 542 px past the left margin; opacity expression referencing a missing layer; rig station-4 key shifted +500 px x). Pass 1 detected all three exactly; fixes (remove orphan expression / mirror healthy sibling's autoFit + x / snap rig key to scene position) went green on pass 2; four rendered frames confirmed visually. **2 of 8 passes, zero human input.**

Transport note: the run used `scripts/ae-run.sh`, an AppleScript-DoScript fallback added when the bridge panel died mid-session — same contract as `bridge-exec.sh executeScript --file` (top-level `return`, JSON result), works whenever AE itself is responsive, no panel needed.

## Phase 0 gate results (2026-07-27, AE 26.2.1, bridge v1.10.0)

- **Gate A — PASS (disk-file path)**: `seeFrame` bridge command rendered MASTER at 800×450 (21 KB PNG, in-AE temp-comp downscale) in 0.45 s; Claude Code read it from disk as a native inline image at negligible token cost. The MCP-native `see-frame` tool path (ImageContent over stdio) still needs verification in a session where the AfterEffectsMCP tools are loaded (server was registered mid-session); the disk-file path is the brief's approved fallback and is fully working.
- **Gate B — PASS**: HandyCam (`PEHC`) property tree captured to `apostle/matchnames-handycam.md`. Orbit, Position Offset, Local Transform, Lens, and Wiggle matchNames all identified. Bonus: `PEHC-0047` "Initialised" is a scriptable Setup-was-clicked check. ⚠️ HandyCam is **unregistered** on this machine ("some features are disabled") — weigh in Phase 3.
- **Bridge round-trip latency**: 0.25 s (ping), 0.45 s (frame render) — far under the expected 1–3 s. Panel poll interval is fast enough for tight loops.
