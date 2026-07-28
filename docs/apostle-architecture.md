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

## Phase 4 results (2026-07-28)

Hardening after the live restart incident (AE restart rolled the project back to its last save and destroyed two built worlds):

- **Crash recovery**: `buildFromBeats` (lib v2.1.0) snapshots its input beats + build report to `<repo>/.apostle-runs/<masterName>-<timestamp>.json` on every successful build. Recovery contract: comps are disposable, beats JSON is the source of truth — a lost world rebuilds in one `buildFromBeats` call (~5 s measured).
- **Preflight**: `scripts/preflight.sh` probes the bridge panel (8 s timeout) then falls back to `scripts/ae-run.sh` (AppleScript DoScript), returning transport + project + dirty flag + library version as JSON. The two transports run the identical script contract.
- **Save policy** (CLAUDE.md): never save/close the user's project programmatically without their say-so; crash safety comes from snapshots, not saves.
- **Latency** (measured, warm): bridge panel round-trip 0.27–0.29 s; DoScript round-trip 0.22–0.25 s. Both idle-poll free of AE's render thread; no tuning needed. Build of a 7-beat world ≈ 5 s; 6-frame render pass ≈ 20 s.
- **Second production script end-to-end**: `apostle/demo-beats-redeem.json` — 6 beats + endcard, **gallery layout** (lateral +x stations, first non-corridor build), full transit vocabulary (lateralTruck, crane, whipOrbit, dollyZoom), `rig: "auto"` (verified it resolves to expression post-Phase-3). Result: all checks green on pass 1 (4,902 props, 8 text layers, 7 stations within 3 px at 1700 z-gap), 6 sampled frames all visually correct. Total 41.4 s world.
- Known limitation recorded: `stylePreset: "listBuild"` currently renders through the titleCard branch (super + accent bar) — no per-item list build yet. Timing/enum paths are exercised; the dedicated visual is future work.

## v2.2.0 — animation quality, project organization, master font control (2026-07-28)

User feedback after reviewing the Phase 1–4 builds in motion: animations had visible bugs, comps were dumped loose at the project root, and fonts weren't controllable from one place. A 6-frame diagnostic strip across a transit confirmed three motion defects that still-frame verification had never caught:

1. **Empty frames mid-transit** — the camera crossed transparent void between stations (rendered white, with an ugly gray plane-edge streak). Fix: full-frame 2D `MASTER BG` solid on the master comp, brand background color, expression-linked to CONTROL — plus gallery spacing tightened 2700 → 2400 so lateral trucks keep content on screen.
2. **Ghost arrivals** — text entrances started before the camera arrived (scene starts at arrive − 0.45; reveals fired at scene-time 0.3–0.5), so arrival frames caught half-played, semi-transparent entrances. Fix: reveals moved to scene-time 0.55+ — entrances now begin ~0.1 s *after* the camera lands.
3. **Indistinguishable transits** — the expression rig differentiated transit types by duration only. Fix: crane gets a vertical mid-arc (−260 px), whipOrbit gets a rig-yaw swing (0→26°→0), dollyZoom gets a camera-zoom ramp (1.18× easing to base). All keyed alongside the existing position keys, all eased.

**Project organization**: every build now creates `APOSTLE/<masterName>_vNNN/` with `01_MASTER`, `02_SCENES`, `03_ASSETS` (solid/null sources are re-filed out of the root Solids folder via build-time source tracking). Builds are auto-versioned — `_v001`, `_v002`, … scanning existing items; nothing is overwritten and nothing lands loose at the project root. The 25 flat test comps from Phases 1–4 were removed from the working project.

**Master font control**: two guide text layers on the master comp — `FONT Heading` and `FONT Body` (guide, video off) — hold PostScript font names as their text. Every linked text layer's style expression reads its font from the matching guide layer (and size/color from the CONTROL sliders as before). Changing every font in a build = retyping one layer. Verified live: heading swapped to AvenirNext-Bold via one text edit, rendered, reverted. The old 3-item font dropdown is gone (dropdowns can't hold arbitrary PS names); the safe-margin check skips guide/disabled layers.

Verified on `YELLO_REDEEM_v001` (demo-beats-redeem, gallery, rig auto→expression): checks green (8 text layers, 7 stations), 8-frame strip confirms the streak is gone, arrivals land crisp, and each transit flavor reads distinctly.

## Phase 0 gate results (2026-07-27, AE 26.2.1, bridge v1.10.0)

- **Gate A — PASS (disk-file path)**: `seeFrame` bridge command rendered MASTER at 800×450 (21 KB PNG, in-AE temp-comp downscale) in 0.45 s; Claude Code read it from disk as a native inline image at negligible token cost. The MCP-native `see-frame` tool path (ImageContent over stdio) still needs verification in a session where the AfterEffectsMCP tools are loaded (server was registered mid-session); the disk-file path is the brief's approved fallback and is fully working.
- **Gate B — PASS**: HandyCam (`PEHC`) property tree captured to `apostle/matchnames-handycam.md`. Orbit, Position Offset, Local Transform, Lens, and Wiggle matchNames all identified. Bonus: `PEHC-0047` "Initialised" is a scriptable Setup-was-clicked check. ⚠️ HandyCam is **unregistered** on this machine ("some features are disabled") — weigh in Phase 3.
- **Bridge round-trip latency**: 0.25 s (ping), 0.45 s (frame render) — far under the expected 1–3 s. Panel poll interval is fast enough for tight loops.
