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

## Compile a brief with Opus 5.5 (v2.13.0)

- `scripts/compile-brief.cjs` (lib + CLI) takes a brief to built comps in two model passes with a human gate between them. **treatment**: brief + attachments (PDF/images are Read by the model, Word is converted with textutil, text is inlined) become `treatment.json`/`treatment.md`: logline, audience, structure, visual system, the full `voScript` per video, assets, library gaps, open questions. **approve** is a human act; `spec` refuses an unapproved run. **spec**: per video, the moment-by-moment spec (`apostle/video-spec-schema.json`). Then the deterministic **compile** to beats + moments, and **build** (buildFromBeats, then applySkin, applyMoments, optional applyTransitions, then the expression and safe-margin checks). The skill `compile-brief` is the interactive version of the same contract; the panel's BRIEF > COMPILE drives the same lib.
- The model is pinned in `prompts/compile/config.json` (`claude-opus-5-5`, effort high), with prompts versioned as `prompts/compile/*.vN.md`. Swap models there, never in code. Runs live in `.apostle-runs/compile/<client>-<n>/`, including every attempt's prompt and raw reply. Approved outputs publish to `briefs/<client>/{treatment.md, specs/, beats/, moments/}`.
- **Code does every number.** The model writes `cue`s (the verbatim opening words of the VO where a moment starts), never seconds. `scripts/lib/compile-spec.cjs` resolves timing in three modes: `wpm` (estimate, applies the readability floor itself so computeTiming never silently stretches a beat), `words` (align to a `vo-align.py` words.json; the spec is unchanged once VO is recorded), and `measured` (the CommBank spec form). On the six CommBank specs its output is byte-identical to `make-video.py`, and a test holds it to that.
- `scripts/lib/validate-spec.cjs` is the gate on model output. Errors go back to the model verbatim for up to `retries` attempts: unknown layout or glyph, a cue missing from or out of order in the beat VO, missing per-layout payloads, and **VO not verbatim** (the client's words are never reworded). Warnings are taste calls (long supers, the same layout three times in a row). `scripts/lib/capabilities.cjs` reads glyphs, ease profiles and transits straight out of `apostle.jsx`. A new MOM_GLYPHS entry reaches the model with no other edit; a new moment layout also needs its line in `LAYOUTS` there and in `apply-moments.cjs`.
- Moment layouts are 1920x1080 geometry. The validator rejects other resolutions until the layouts are generalised.
- `--provider mock` runs the whole pipeline offline (deterministic statements, plus a cue moment per long beat). Tests use it with `APOSTLE_COMPILE_RUNS`/`APOSTLE_BRIEFS_ROOT` pointed at a temp dir.
- The CLAUDE tab's terminal and one-shot ASK take a MODEL picker (default Opus 5.5). `panel-relay.cjs` whitelists `--model` and `--effort` with value patterns.

## Apostle CEP panel (v2.7.0, Phase 7)

- `apostle-panel/` is a CEP extension (CSXS 11, AE 24+): Apostle-branded UI with tabs BRIEF (paste → parse → build; script sync with diff + apply), TIMING (per-beat duration overrides + retime), BRAND (typography via the same API as the retired ScriptUI fonts panel), MOTION (ease profile + handheld level), REVIEW (checks, self-render, queue a Claude review job), CLAUDE (one-shot `claude -p` + job list).
- Install: `scripts/install-panel.sh` (user-level symlink + PlayerDebugMode; **no sudo**). Uninstall with `--uninstall`. After install: restart AE, Window > Extensions > Apostle.
- Architecture rule: `jsx/host.jsx` is a thin JSON marshal (`apInit`/`apCallFile`, args passed via temp file — never inline evalScript strings). ALL logic lives in `apostle.jsx` and `scripts/*.cjs` (which export libs; the CLI and panel share them). Never fork logic into the panel.
- **Project-aware (v2.9.0)**: the panel polls `getProjectInfo` every 5s (and on tab switch); on a project change it rescopes localStorage memory per project file path (untitled projects never persist — a fresh project always starts clean), refreshes every comp dropdown, and clears panes that referenced the old project (BRIEF text is never cleared). BUILD re-reads the MASTER NAME field at build time — the beats doc's parse-time name must not win over a later rename. Masthead shows the open project name. Redesign runs stamp `run.project` and `applyPlan` refuses if a different project is open; review jobs and one-shot asks carry the project identity too. **Identity tokens (v2.9.3)**: untitled projects are told apart by an `apostle:pid` token stamped into project XMP (`getProjectInfo` creates it only while untitled — a saved clean project is never dirtied by a metadata write); saving an untitled project migrates panel RAM state to the file-backed key instead of clearing it; `applyPlan` matches file path OR pid, and an unsaved current project never matches a saved run. Brand kits stay global (`brands/*.json`) — BRAND tab has a kit editor (LOAD / SAVE / SAVE AS, typography + colors); unknown kit fields are preserved on save.
- **Comp-first, not session-first (v2.11.0)**: every editing tab resolves its beats doc **per selected master comp**, never from one global in-panel doc. `resolveDoc(master)` tries panel memory (`state.docs[master]`), then the BRIEF tab's doc if it names that comp, then the newest matching build snapshot via `scripts/beats-store.cjs` (`.apostle-runs/<masterComp>-<ts>[-tag].json`, ranked by project stamp then timestamp; a snapshot stamping only the `.aep` basename still matches). Before this, TIMING and MOTION were dead ("Build a brief first") for any comp built by the CLI or by Claude — i.e. almost every real job — and, worse, would happily act on a doc belonging to a *different* master. TIMING re-applies the matching `briefs/*/moments/*.json` (matched on `meta.masterName`) after a retime, because moment windows are fractions of the VO window; MOTION does not, since it leaves beat durations alone. MOTION has its own MASTER selector — it used to silently read BRAND's.
- **BRAND writes colours too (v2.11.0)**: `SYNC TO COMP` sends typography via `applyTypography` (now including `safeMarginPct`) **and** colours via `applySkin` — sending typography alone is why editing the colour pickers appeared to do nothing. Omitting the `backdrop` key makes `applySkin` rewrite CONTROL only and leave the BACKDROP/CONFETTI comps alone. Know what a CONTROL swatch can and cannot repaint: master BG, scene BGs and brand-role moment art are **expression-linked** to CONTROL, but the gradient/beacon/confetti backdrop plane is **baked at build time** from the kit's `backdrop` block — hence the explicit, opt-in REBUILD BACKDROP FROM KIT (needs a loaded kit; recreates those comps). Fields always describe the *selected comp* (`readTypography` + `readBrandColors`); loading a kit into them is an explicit LOAD KIT click and says so. APPLY TO ALL MASTER COMPS pushes one house style across every video in the project.
- **Font pickers must be committed, not read raw (v2.11.0)**: the hidden PostScript field is what SYNC sends, but users type into the *family* combo. A family typed and never clicked in the dropdown left the two disagreeing, so SYNC re-applied the previous font and still reported success — and the style expression's `try { st = st.setFont(f) } catch {}` swallows a bad name in silence, so nothing anywhere said no. `commitFamily(pre)` now resolves the typed text (exact family → raw PostScript name → unambiguous partial) on blur and again before every sync, marks the field `.bad` and refuses to sync when nothing matches. AE also lists some families *twice under the same name* (CBA Beacon Sans: Regular–ExtraBold, then Black), so the picker labels duplicates with their style ranges and `commitFamily` prefers the entry carrying the selected style. SYNC re-reads the comp afterwards and reports NOT APPLIED if the font did not actually land — never trust a write here without reading it back.
- Claude connection, three tiers: (1) **embedded interactive terminal** — CLAUDE tab runs the full Claude Code TUI inside the panel via `scripts/panel-relay.cjs` (dependency-free RFC6455 WebSocket server on 127.0.0.1:8471 + python3 pty bridge; panel auto-spawns it through a login shell, idle-exits after 10 min); (2) one-shot questions via `claude -p`; (3) job files `~/Documents/ae-mcp-bridge/jobs/<id>.json` (answer as `<id>.result.json`) for a watching headless session. Relay E2E test: `node scripts/panel-relay.cjs` + the ws client pattern in the repo history (handshake → TUI ANSI bytes → resize sentinel `\x00resize:cols,rows\n` → /exit).
- Verification of any build/sync must include rendered pixels before reporting success (Tim, 2026-07-28): the review-export skill is the loop; sampled frames or `renderMovie` + `scripts/extract-frames.sh`.

## Moments — illustrated supers inside a scene (v2.10.0)

- A scene precomp holds one beat of VO, which is usually several ideas long. A **moment** is one idea: a super line, an optional sub, and an illustration, alive for its slice of the beat. `APOSTLE.applyMoments(momentsJSON)` builds them; CLI is `node scripts/apply-moments.cjs <moments.json> [--scenes 1,3] [--dry]`.
- Moment files live in `briefs/<client>/moments/<video>.json`. Windows are **fractions of the beat's VO window** (`from`/`to` in 0..1), taken from cumulative word position in that beat's VO — so a retime never invalidates the file. Re-run `applyMoments` after `retimeBeats` and the seconds recompute. `atSec`/`toSec` override with hard seconds.
- Layouts: `statement`, `hero`, `iconRow`, `chipRow`, `device`, `compare`, `hub`, `endcard`. Geometry is fixed per layout so the same kind of moment lands identically across scenes.
- Illustration is **native AE shape art only** — a glyph vocabulary (`MOM_GLYPHS`) of primitives drawn in a 100x100 box, in painter's order. `momAddPrims` reverses on the way in because AE contents index 1 is frontmost. Brand/background fills carry expressions onto CONTROL, so a brand-kit change still repaints the art.
- Glyph knock-outs use the `hole` role, remapped per batch to whatever the glyph sits ON (`{hole:"brand"}` inside a yellow tile). Forget the remap and the `renew`/`coin` knock-outs paint white blocks on the tile.
- Text in a moment goes through `styleExpr`/`autoFitExpr` exactly like a build super — fonts stay master-controlled, and Scale is never keyframed on text (it carries the autofit expression).
- **Moment 1 leads the camera (v2.13.1)**: the first moment of every scene starts `MOM_FIRST_LEAD` (0.8s) early, so it fades up while the camera is still flying in. Without it every transit crossed 0.4-1.0s of empty backdrop (VIDEO_008 scan: 31/132 sampled frames blank with no lead, none with the lead). Re-running applyMoments on an older build picks this up.
- **Moments cross-fade**: each moment after the first starts `lead` (0.3s) before its nominal time. Without the lead the outgoing fade and the incoming ramp sit end-to-end and every boundary shows ~0.3s of empty white frame — verify boundaries in motion, not just mid-moment stills.
- Re-running is idempotent: layers commented `apostle moment` are dropped first, along with the build's generic `Accent Bar` / `Device Frame (placeholder)`. The build's `Super` layer is reused as moment 1's super so the `updateBeatText` contract still finds it.

## Motion house style — expo easing + word reveal (v2.12.0)

- **Transform easing is an expression, not keyframe beziers.** `EASE_CORE` holds our own implementation of the Penner set; `applyEaseExpression(prop, name)` re-interpolates between the surrounding keys, so the personality swaps without touching a single key. Do **not** paste Ease and Wizz's generated code into the project — `inOutExpo` is the same curve and carries no plugin dependency.
- `EASE_PROFILES.curvaceous` (`reveal: "inOutExpo"`) is the CommBank Yello house style and is stamped as `meta.easeProfile` in all seven `briefs/commbank-yello/moments/*.json`. `momAnimate` applies it to moment Position and, on shapes, Scale. Text Scale never gets one — it carries the autofit expression and has no keys.
- **Word reveal**: supers and subs get a `Slide Up By Word` text animator (Position Y 7445, Opacity 0; range selector on **Words**, Ramp Up, Ease High 0 / Ease Low 100, Start 13, Offset −100→+100 **linear** over 40f). All the easing lives in Ease High/Low, none in the offset keys. The super leads; every sub in the same moment follows `MOM_REVEAL.stagger` (1.12s) later.
- **The mask band is the whole trick.** Each revealed layer gets generated `APOSTLE band N` rectangles — one per text line — sized from `sourceRectAtTime`. Without them every word is visible flying up through the frame. Measure *before* adding the animator: sampling afterwards reads the flown-out bounds, not the settled ones. The reveal owns masking on layers it touches (two ADD masks union, so a leftover hand-drawn band silently crops that one layer differently).
- **The reveal must always finish before the moment fades.** `momRevealMoment` compresses `dur` and `stagger` to fit `tOut - 0.34`. An earlier version only compressed when there was room to spare, so short moments kept the full 1.6s and their words were still arriving as the layer faded out.
- `textHoldTime` waits for the **last selector keyframe**, not just the last transform key. A text animator is still mid-flight long after Position has settled, and sampling in between reports a ~7000px `checkTextSafeMargins` violation on every revealed layer.
- **Scene comps cannot be verified by rendering them standalone**: `BG` is disabled in 65 of 68 (planes are transparent so MASTER BG shows through), so a solo scene render is a black frame. Render a time slice of the **master** instead — set `timeSpanStart`/`timeSpanDuration` on the render-queue item so the user's work area is never touched.

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
- Register with Claude Code (done 2026-10-12, **user scope**, so it survives cwd and path changes): `claude mcp add -s user AfterEffectsMCP -- node "<abs path>/build/index.js"`. Re-run it if the volume path changes.
- Repo path: the volume has been renamed under us (`/Volumes/Apostle_8TB 1` became `/Volumes/Apostle_8TB-1` by 2026-10-12). Never hardcode it. `bridge-exec.sh --file` and `ae-run.sh` set `$.global.APOSTLE_REPO` before a script runs; jsx scripts use `var REPO = $.global.APOSTLE_REPO || new File($.fileName).parent.parent.fsName;`. After a rename: re-run `scripts/install-panel.sh` and the `claude mcp add` above.
- Unit tests hang in vitest worker startup when run on the SMB share. Run them from a local copy (`rsync` the repo, excluding `.git`, to local disk, then `npx vitest run`).
- Bridge folder: `~/Documents/ae-mcp-bridge` (override: `AE_MCP_BRIDGE_DIR`)
- Pull upstream fixes: `git fetch upstream && git merge upstream/main`

## Session preflight (every session, and after any AE restart or tool timeout)

1. Run `scripts/preflight.sh`. It finds a working transport (bridge panel first, AppleScript DoScript fallback) and reports project name, dirty state, and library version. Only if it exits 1 stop and ask the user — AE is either not running or blocked by a modal dialog.
2. AE preference required: Scripting & Expressions > "Allow Scripts to Write Files and Access Network" enabled. Project expression engine: JavaScript. For MCP-native tools the **MCP Bridge Auto** panel must be open (Window menu > mcp-bridge-auto.jsx, Auto-run checked); the DoScript fallback needs neither.
3. Never queue commands into a transport that didn't answer the preflight ping.
4. Save policy: **never** `app.project.save()` or `app.project.close()` on the user's project without their say-so — an open production project may hold unsaved human work, and saving also bakes test comps into it. Crash safety comes from snapshots instead: every successful `buildFromBeats` writes its beats + report to `<repo>/.apostle-runs/` (gitignored), and a world lost to a crash/restart rebuilds in seconds from its snapshot. Comps are disposable; beats JSON is the source of truth.

## Verification loop contract

After any build or edit, in this order:
1. Deterministic checks first (no image tokens): `checkExpressionErrors`, `checkTextSafeMargins`, `checkCameraDistance` (in `apostle/apostle.jsx`, via `run-script`). **Always pass a comp name** — `checkExpressionErrors()` with no argument falls back to AE's active item, which in a panel-driven session is usually nothing, and reports an error instead of checking. `checkCameraDistance` referenced three symbols that were never defined (`layerWorldPos`, `CLIP_MIN_Z`, `FRAME_TOLERANCE_XY`) and threw on every run until v2.11.0 — if a check reports suspiciously little, confirm it actually ran.
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
6. **On a shape layer's vectors group, a property handle does not survive a later `addProperty` on that same group.** Both orderings fail, for opposite reasons: interleaving adds with writes makes the *group* handle stale (`Function c.addProperty is undefined`), while doing all the adds first and keeping what they returned makes the *child* handles stale (`ReferenceError: Object is invalid` on the first `setValue`). The only safe shape is: re-read the group before every add, and re-read each child by matchName after the last add — no handle may span an `addProperty`. This took out `momRect`, and with it every moment scene containing a rect, on 2026-08-01.

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
