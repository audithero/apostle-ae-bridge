# Apostle AE Bridge

Closed-loop system: Claude Code drives a live After Effects instance on macOS via this MCP server (fork of `a-y-ibrahim/after-effects-mcp`) and a watched-folder file bridge. Apostle additions live in `apostle/`, `.claude/`, `scripts/`, `docs/` — never modify upstream `src/` beyond thin tool wiring, so upstream merges stay clean.

## Build conventions (v2.2.0)

- Every build is **versioned and foldered**: master comp `<base>_vNNN` under project folder `APOSTLE/<base>_vNNN/{01_MASTER, 02_SCENES, 03_ASSETS}`. Never create loose comps at the project root; never overwrite an existing version.
- **Fonts are master-controlled**: guide text layers `FONT Heading` / `FONT Body` on the master comp hold PostScript names; linked text styles read from them. To change fonts, edit those layers' text — do not touch per-layer fonts.
- **Verify motion, not just stills**: after any animation-affecting change, render a short strip across at least one transit and one entrance (still frames alone missed every v2.1 motion bug — empty transits, ghost arrivals).
- The master comp has a full-frame 2D `MASTER BG` solid (color-linked to CONTROL). Do not delete it — without it, transits cross white void with visible plane edges.

## Brief pipeline (v2.4.0, Phase 5)

- Scripts live in `briefs/<client>/`; brand kits in `brands/<kit>.json`; parsed beats in `briefs/<client>/beats/`. Roadmap: `docs/phase5-8-roadmap.md`.
- Parse: `node scripts/parse-brief.cjs <script.md> --brand brands/<kit>.json --brief-id X --master-name NAME [--prior prev.json --script-version N]`. Claude is the primary parser for messy scripts; this is the deterministic path and cross-check. `--prior` inherits stable beatIds across revisions.
- Sync a revised script: parse with `--prior`, then `node scripts/diff-beats.cjs old.json new.json -o plan.json --canonical new.json` (the `--canonical` write-back is required — fuzzy-matched beatIds must land in the beats file or retime can't find the scene comps), then apply via library ops: `updateBeatText(master, beatId, {superText,url})` per text change + one `retimeBeats(master, beatsJSON)` when `needsRetime`.
- Surgical-edit invariant: scene comps of beats not named in the plan stay byte-identical (`hashCompState`). Scene comp contents are never rebuilt by sync — that's where human polish lives. Structural ops (insert/remove beat) are not built yet; a structural diff means rebuild for now.
- Beats are found by the `apostle beatId=<id>` comment tag on scene precomps, never by name or index.
- Verification of any build/sync must include rendered pixels before reporting success (Tim, 2026-07-28): sampled frames today, aerender in Phase 8.

## Apostle CEP panel (v2.7.0, Phase 7)

- `apostle-panel/` is a CEP extension (CSXS 11, AE 24+): Apostle-branded UI with tabs BRIEF (paste → parse → build; script sync with diff + apply), TIMING (per-beat duration overrides + retime), BRAND (typography via the same API as the retired ScriptUI fonts panel), MOTION (ease profile + handheld level), REVIEW (checks, self-render, queue a Claude review job), CLAUDE (one-shot `claude -p` + job list).
- Install: `scripts/install-panel.sh` (user-level symlink + PlayerDebugMode; **no sudo**). Uninstall with `--uninstall`. After install: restart AE, Window > Extensions > Apostle.
- Architecture rule: `jsx/host.jsx` is a thin JSON marshal (`apInit`/`apCallFile`, args passed via temp file — never inline evalScript strings). ALL logic lives in `apostle.jsx` and `scripts/*.cjs` (which export libs; the CLI and panel share them). Never fork logic into the panel.
- **Project-aware (v2.9.0)**: the panel polls `getProjectInfo` every 5s (and on tab switch); on a project change it rescopes localStorage memory per project file path (untitled projects never persist — a fresh project always starts clean), refreshes every comp dropdown, and clears panes that referenced the old project (BRIEF text is never cleared). BUILD re-reads the MASTER NAME field at build time — the beats doc's parse-time name must not win over a later rename. Masthead shows the open project name. Redesign runs stamp `run.project` and `applyPlan` refuses if a different project is open; review jobs and one-shot asks carry the project identity too. Brand kits stay global (`brands/*.json`) — BRAND tab has a kit editor (LOAD / SAVE / SAVE AS, typography + colors); unknown kit fields are preserved on save.
- Claude connection, three tiers: (1) **embedded interactive terminal** — CLAUDE tab runs the full Claude Code TUI inside the panel via `scripts/panel-relay.cjs` (dependency-free RFC6455 WebSocket server on 127.0.0.1:8471 + python3 pty bridge; panel auto-spawns it through a login shell, idle-exits after 10 min); (2) one-shot questions via `claude -p`; (3) job files `~/Documents/ae-mcp-bridge/jobs/<id>.json` (answer as `<id>.result.json`) for a watching headless session. Relay E2E test: `node scripts/panel-relay.cjs` + the ws client pattern in the repo history (handshake → TUI ANSI bytes → resize sentinel `\x00resize:cols,rows\n` → /exit).
- Verification of any build/sync must include rendered pixels before reporting success (Tim, 2026-07-28): the review-export skill is the loop; sampled frames or `renderMovie` + `scripts/extract-frames.sh`.

## AI comp redesign (v2.8.0)

- Three decoupled modules, swappable models: **analysis** (AE: `extractDesignSpec`, `captureCompReference`), **concept generation** (image model via fal.ai queue API), **reconstruction** (`claude -p` → rebuild-plan JSON → `applyRebuildPlan`). Providers live behind interfaces in `scripts/lib/redesign-providers.cjs`; model/params swap in `prompts/redesign/config.json`, never in code. Prompts are versioned files (`prompts/redesign/*.vN.md`).
- CLI: `node scripts/redesign.cjs analyze|concepts|reconstruct|apply` (see header). Panel: REDESIGN tab (NO./05). Both drive the same lib; the AE transport is injected at APOSTLE-function granularity (`aeCall`) — CLI uses the shell bridge, panel uses evalScript. Runs live in `.apostle-runs/redesign/<slug>-<n>/` (spec.json, reference.png, refs/, concepts/, plan.json, result.json).
- fal.ai key: `FAL_KEY`/`FAL_API_KEY` env, `FAL_API_KEY=` in the repo `.env` (gitignored — where Tim keeps it), or `~/.apostle/fal.key`; the panel only sees the files. `image_size` in config.json is an orientation map ({landscape, portrait, square} — gpt-image-1 only accepts its three fixed sizes); the orchestrator picks by comp aspect. Mock providers (`--provider mock`) run the whole pipeline offline. Style references are inspiration-only by prompt contract — their content must not enter concepts.
- `applyRebuildPlan` always targets a **duplicate** (`duplicateForRedesign` → `<name> REDESIGN vN`); the original comp is never modified. Plan schema: `apostle/redesign-plan-schema.json` (validated with retry before apply).
- **Master-link expressions are baked off any layer a plan touches** (style expression on sourceText AND the fit-width autoscale on Scale — the latter shrank a 96px heading to 27% and blanked frames until baked). A redesigned comp intentionally diverges from master font control. Entrance/exit animation survives edits: keyed transforms are delta-shifted, never overwritten.
- For text placement in plans, prefer `setTransform` + `bounds: [x,y]` (interpreter does the anchor/justification math); emit setFont before setTransform on the same layer.

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
