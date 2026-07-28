# Apostle AE Bridge

Closed-loop system: Claude Code drives a live After Effects instance on macOS via this MCP server (fork of `a-y-ibrahim/after-effects-mcp`) and a watched-folder file bridge. Apostle additions live in `apostle/`, `.claude/`, `scripts/`, `docs/` — never modify upstream `src/` beyond thin tool wiring, so upstream merges stay clean.

## Build conventions (v2.2.0)

- Every build is **versioned and foldered**: master comp `<base>_vNNN` under project folder `APOSTLE/<base>_vNNN/{01_MASTER, 02_SCENES, 03_ASSETS}`. Never create loose comps at the project root; never overwrite an existing version.
- **Fonts are master-controlled**: guide text layers `FONT Heading` / `FONT Body` on the master comp hold PostScript names; linked text styles read from them. To change fonts, edit those layers' text — do not touch per-layer fonts.
- **Verify motion, not just stills**: after any animation-affecting change, render a short strip across at least one transit and one entrance (still frames alone missed every v2.1 motion bug — empty transits, ghost arrivals).
- The master comp has a full-frame 2D `MASTER BG` solid (color-linked to CONTROL). Do not delete it — without it, transits cross white void with visible plane edges.

## Commands

- Build server: `npm run build` (output: `build/index.js`)
- Install bridge panel (needs sudo): `sudo npm run install-bridge`
- Register with Claude Code (already done, local scope): `claude mcp add AfterEffectsMCP -- node "<abs path>/build/index.js"`
- Bridge folder: `~/Documents/ae-mcp-bridge` (override: `AE_MCP_BRIDGE_DIR`)
- Pull upstream fixes: `git fetch upstream && git merge upstream/main`

## Session preflight (every session, and after any AE restart or tool timeout)

1. Run `scripts/preflight.sh`. It finds a working transport (bridge panel first, AppleScript DoScript fallback) and reports project name, dirty state, and library version. Only if it exits 1 stop and ask the user — AE is either not running or blocked by a modal dialog.
2. AE preference required: Scripting & Expressions > "Allow Scripts to Write Files and Access Network" enabled. Project expression engine: JavaScript. For MCP-native tools the **MCP Bridge Auto** panel must be open (Window menu > mcp-bridge-auto.jsx, Auto-run checked); the DoScript fallback needs neither.
3. Never queue commands into a transport that didn't answer the preflight ping.
4. Save policy: **never** `app.project.save()` or `app.project.close()` on the user's project without their say-so — an open production project may hold unsaved human work, and saving also bakes test comps into it. Crash safety comes from snapshots instead: every successful `buildFromBeats` writes its beats + report to `<repo>/.apostle-runs/` (gitignored), and a world lost to a crash/restart rebuilds in seconds from its snapshot. Comps are disposable; beats JSON is the source of truth.

## Verification loop contract

After any build or edit, in this order:
1. Deterministic checks first (no image tokens): `checkExpressionErrors`, `checkTextSafeMargins`, `checkCameraDistance` (in `apostle/apostle.jsx`, via `run-script`).
2. `serializeCompState(compName)` — compact state JSON.
3. Only if needed: render 4–8 sampled frames (station arrivals, transit midpoints, text entrance completions). Half-res (`sips -Z 800`), never full-res, never every frame. Pair every image with the state JSON.
4. Fix via `run-script`, re-check. Hard cap: **8 passes per task**, then stop and report. If the same defect survives two consecutive fix attempts, report it as blocked instead of thrashing.

## Token discipline

Claude Code warns at 10k tokens of tool output and caps at 25k (`MAX_MCP_OUTPUT_TOKENS` to raise). Frames must be few and small. State JSON is size-capped (depth 6). Images are the expensive last resort, not the first check.

## ExtendScript rules (ES3 only)

No `const`/`let`, no arrow functions, no template literals, no `forEach`/`map`/`filter`, no `Object.keys`, no spread, no `class`, no `async`. `var` and classic `for` loops only. Every entry point wrapped in `app.beginUndoGroup`/`app.endUndoGroup` — one undo group per command.

Verified AE/ExtendScript traps (each one cost a debugging pass — do not reintroduce):

1. **No chained ternaries.** ExtendScript parses `a ? b : c ? d : e` left-associatively, silently returning the wrong branch. Use if/else.
2. **Pin `layer.startTime = 0` immediately after creating any layer via script.** AE creates layers at the comp's current playhead time; a nonzero startTime shifts every subsequent keyframe in composite space while `keyTime`/`valueAtTime` stay self-consistent in layer time — DOM checks pass, renders are wrong.
3. **Never set `collapseTransformation` on 3D scene precomps.** Collapsed 3D precomp groups composite in layer-stack order instead of z-sorting under the camera — the top scene paints over every station.
4. The bridge's `executeScript` wraps code in a function: use `return`, and `$.evalFile` results need explicit `$.global.X = X` to persist.
5. `app.effects` is 0-based (unlike the 1-based DOM collections).

## Loading the Apostle library

Every `run-script`/`executeScript` call that uses APOSTLE functions must start with:

```javascript
if (typeof $.global.APOSTLE === "undefined") { $.evalFile(new File("<repo>/apostle/apostle.jsx")); }
```

Reload explicitly (unconditional `$.evalFile`) after editing apostle.jsx. `scripts/bridge-exec.sh <command> [args-json]` (or `executeScript --file <f.jsx>`) drives the file bridge from the shell when MCP tools aren't loaded. If the bridge panel is dead but AE is responsive, `scripts/ae-run.sh <f.jsx> [timeout]` runs the same script contract via AppleScript DoScript — no panel needed.

## HandyCam order of operations (if the HandyCam rig path is used)

**Phase 3 verdict: HandyCam cannot do station transport.** Its Position Offset is shake-scale local offset — the Setup-baked look-at target stays pinned near the rig home, so corridor-scale offsets put the camera ON the target plane facing backward (verified by check + frames). The expression rig is the default; `meta.rig = "auto"` resolves to expression; use HandyCam only as explicit opt-in shake/polish on a static rig position.

1. Script applies HandyCam effect to a **clean null with NO transform keyframes**.
2. **Human clicks Setup once** (compiled-effect button; unscriptable — this is the one manual step; a marker on the null says so).
3. Script keyframes only the effect's own properties (Position Offset / Local Transform / Orbit — matchNames in `apostle/matchnames-handycam.md`). The null's raw Transform is only for static rig relocation.
4. Never keyframe the null's Transform.Position with HandyCam applied — it double-transforms the rig.

The expression rig (`buildRigExpression`) is fully autonomous and plugin-free; HandyCam must never be required.
