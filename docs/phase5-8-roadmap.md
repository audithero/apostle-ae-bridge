# Apostle Phase 5–8 Roadmap: Brief-to-Build Pipeline & the Unified Apostle Panel

*Drafted 2026-07-28, after v2.3.0 (typography API + fonts panel). Supersedes nothing; builds on phases 0–4.*

## The end goal (Tim's brief, restated)

One beautiful, Apostle-branded panel inside After Effects that:

1. Takes a pasted client script/brief and splits it into sections and comps with correct overall timing.
2. Keeps the build **on brand** — fonts, colors, logo — per client.
3. Drives motion through a curated system (Easy-Ease-style easing personalities, HandyCam polish) so a brief gets **80–90% of the way animated automatically**, and the human only adjusts details.
4. Stays in sync when the client revises the script — surgical updates to text, timing, or individual comps, never a blind rebuild.
5. Is connected to Claude Code through the existing MCP/bridge, and Claude can **see its own output** — screenshot the final export, critique transitions and text layout against a rubric, and fix defects without a human eyeballing every frame.
6. Replaces panel sprawl: the ScriptUI fonts panel (v2.3.0) folds into this as one tab.

## What the references teach us

### MotionAmigo (`references/MotionAmigo/`) — the architectural blueprint

It is a **CEP extension** (manifest v11, AE 24+, `--enable-nodejs --mixed-context`): an HTML/CSS/JS panel — which is how you get real typography, a logo, and a designed UI instead of ScriptUI's native-widget look. Key findings from the bundle:

- **It embeds Claude Code itself.** The panel ships a `motionamigo-relay` binary (per-platform: macOS arm64, win x64) that spawns the `claude` CLI; the panel renders the session in an embedded xterm.js terminal. Strings in the bundle: `claude-code`, `claudeKeychainHasCredentials`, `claude upgrade`, `claude-opus-*`. So "AI-driven AE panel powered by the user's own Claude subscription" is a **proven, shipping pattern**.
- **Its "presets" are prompts, not keyframe data.** `presets/start-here-matrix-dots/preset.json` stores a natural-language instruction block plus timeline state. The AI does the building; the panel is intake + orchestration UI. This validates the Apostle model (beats JSON + Claude building via the library) — we're already ahead on the AE-side determinism.
- **`jsx/hostscript.jsx` (4.2k lines)** is their AE DOM layer: response envelopes (`successResponse`/`errorResponse`), conditional undo groups, keyframe velocity control, bounce/anticipation/squash-stretch expression generators, text layer creation with font/weight. Our `apostle.jsx` plays this role and is already further along for our use case — the CEP panel should call **the same APOSTLE library**, not grow a second one.

### Ease and Wizz (`references/easyease/`) — the easing model

175 expression files, one per (easing family × in/out/inout × scope). The core trick: a **keyframe-reading expression** — Penner easing functions that find the surrounding two keyframes and re-interpolate between them, honoring dimension count, returning `value` outside the key span. This means: animate with plain linear keyframes, apply personality as an expression afterward, swap personality without touching keys. That is exactly the "maximum control" model we want per-beat.

**Licensing note:** Ease and Wizz is Ian Haigh's paid product — we don't copy his files. The underlying Penner equations are BSD-licensed; we implement our own generator (same pattern, our code).

## Current state (what phases 0–4 already give us)

- `buildFromBeats`: beats JSON → versioned, foldered master comp with camera stations, transits (lateralTruck/crane/whipOrbit/dollyZoom/dollyPush), style presets (titleCard/listBuild/uiWalkthrough/endcard), WPM-derived timing, master BG, CONTROL layer, master font system.
- Typography API (v2.3.0): `readTypography`/`applyTypography`/`listFonts`/`findMasterComps`.
- Verification: `checkExpressionErrors`, `checkTextSafeMargins`, `checkCameraDistance`, `serializeCompState`, `renderKeyFrames`, verify-comp skill, 8-pass cap.
- Crash-safe snapshots in `.apostle-runs/`; preflight; DoScript fallback transport.
- Phase 3 verdict (stands): **HandyCam cannot do station transport** — expression rig owns camera movement; HandyCam is opt-in polish on a static rig position.

## Gap analysis → four phases

| Gap | Phase |
|---|---|
| No brief parser; beats JSON is hand-written. No script versioning/diff. Edits = rebuild. | **5** |
| One hardcoded easing feel; no entrance/exit variety; HandyCam polish not wired. | **6** |
| UI is ScriptUI one-offs; no brief intake surface; no brand kits; no Claude connection from inside AE. | **7** |
| Verification catches DOM/geometry errors but can't judge aesthetics or the final export. | **8** |

Order matters: the panel (7) is a UI over APIs that phases 5–6 must create first. The QA loop (8) needs the edit operations from 5 to act on its findings.

---

## Phase 5 — Brief pipeline & surgical editing (the data model)

**Goal: paste any of the three CommBank scripts → correct beats JSON; revise the script → minimal in-place edits.**

### 5.1 Beats schema v2 (`apostle/beats-schema.json`)

- `meta.briefId`, `meta.scriptVersion`, `meta.sourceScriptPath` — provenance for sync.
- **Stable `beatId`** per beat (slug from section + super text, assigned once, never regenerated on re-parse). Everything downstream — comp names, markers, diff, QA findings — keys on `beatId`, not array index.
- `sections[]`: the script's numbered chapters ("1. Earning", "2. Redeeming", …) grouping beats; sections drive folder structure, section-title beats, and pacing.
- `beats[].motion`: `{ transitIn, ease, entrance, exit, handycam }` — per-beat motion personality (consumed by Phase 6).
- Brand kit reference: `brand.kitId` resolving to `brands/<client>.json` (colors, heading/body PS names, logo footage path, safe margins). CommBank Yello kit is the first one.

### 5.2 Brief parser

Two-layer, like everything else in this repo:

- **Claude parses** (primary): a `parse-brief` prompt contract — raw script text in, beats JSON v2 out. Claude handles messy real-world briefs: joined wrap-lines, `SUPER: A. / B. C.` list syntax (→ listBuild items), numbered section headers (→ sections + section-title beats), paired SUPER+VO vs. SUPER-only beats, endcard detection (URL beat), style-preset inference (titleCard vs listBuild vs uiWalkthrough).
- **Deterministic fallback** (`scripts/parse-brief.js`, Node, testable offline): strict `SUPER:`/`VO:` line grammar for the regular case; used in tests and as a sanity cross-check on Claude's output (beat count, no dropped VO words).

Corpus: `briefs/commbank-yello/video{1,2,3}-*.md` (committed). Acceptance: all three parse to sensible section/beat structures; Video 1 yields 3 sections + intro + endcard.

### 5.3 Script sync & diff (`diffBeats`)

`diffBeats(oldBeats, newBeats)` → edit plan keyed by beatId:

- `textChanged` (super or VO wording) → update linked text layer sourceText + retime that beat from new word count.
- `beatAdded` / `beatRemoved` / `beatReordered` → structural ops.
- `motionChanged` / `styleChanged` → re-apply preset on that scene only.

Beat matching: beatId when present; else fuzzy match on super-text similarity so a re-parsed revised script inherits IDs from the previous version (word-overlap threshold, then manual-review list for ambiguous ones).

### 5.4 Surgical edit ops (`applyBeatEdits`)

New library functions, each one undo group, each snapshot-updating:

- `updateBeatText(master, beatId, {superText, vo})` — edit layers in place.
- `retimeBeats(master, beatsJSON)` — recompute station arrival/duration keys and ripple downstream beats; text entrance keys shift with their scene.
- `insertBeat` / `removeBeat` — add/remove scene precomp + station, ripple camera keys, renumber nothing (beatIds are stable).
- Invariant: **an edit that only touches beat N must leave beats ≠N byte-identical in `serializeCompState`** — that's the acceptance test.

This is the "maximum control" ask: client tweaks one SUPER line → one layer changes, timings ripple, nothing else rebuilt. Full rebuild remains available (it's cheap) but becomes the fallback, not the default — a rebuild discards any manual polish the human added, surgical edits don't.

### 5.5 Shared scenes across videos

The three scripts share near-identical beats ("Earn via Banking…" appears in all three). Parser tags identical beats with the same content hash; **v1 policy: still build per-video copies** (independent timing), but report reuse candidates. True precomp sharing across masters is a later optimization — flagged, not built.

---

## Phase 6 — Motion system (the 80–90% animated feel)

**Goal: builds feel designed, not templated; personality is data (per-beat), swappable after the fact.**

### 6.1 Apostle easing library (`apostle/ease.jsx`)

Own implementation of the Penner set as keyframe-reading expressions (Ease-and-Wizz pattern, our code): `outQuint`, `inOutQuint`, `outExpo`, `outBack` (overshoot), `outElastic`, plus AE-native keyframe ease application (`setTemporalEaseAtKey` with tuned influence) for cases where baked keys beat expressions (renders faster, exports cleaner via Bodymovin etc.).

- `applyEase(prop, keyRange, easeName, scope)` — expression path.
- `bakeEase(prop, keyRange, easeName)` — velocity/influence path.
- **Ease profiles** (named personalities, referenced from `beats[].motion.ease`): `corporate-smooth` (inOutQuint transits, outQuint entrances), `snappy` (outExpo, tighter transits), `playful` (outBack entrances, slight overshoot on transits). Brand kits declare a default profile; CommBank Yello = `corporate-smooth`.

### 6.2 Entrance/exit preset library

Text/scene entrance presets beyond the current fade/rise: `staggerRise` (per-line offset), `trackIn` (tracking animates from wide, pairs with the tracking sliders), `maskReveal`, `listCascade` (listBuild items with per-item offset — the `A. / B. C.` supers). Exits mirror entrances. All driven from `beats[].motion.entrance/exit`, all honoring the master font/style system.

### 6.3 HandyCam as the polish layer (respecting the Phase 3 verdict)

Transport stays on the expression rig — that verdict is verified and stands. HandyCam's role: **handheld life on top**. Implementation per the documented order of operations: script applies HandyCam to a clean null parented into the rig chain, marker instructs the one human Setup click, script keyframes only effect-internal properties (shake intensity ramps down at station arrivals, up during transits — matchNames already captured in `apostle/matchnames-handycam.md`). `beats[].motion.handycam: "off" | "subtle" | "energetic"`. Builds must never *require* it (plugin-free fallback stays default).

### 6.4 Motion QA additions

New deterministic checks for Phase 8 to use: `checkDeadTime` (camera static + no text animating for > threshold), `checkOvershootBounds` (overshoot easings never push text past safe margins mid-flight — extends `checkTextSafeMargins` to sample during entrances, not just at rest).

---

## Phase 7 — The unified Apostle panel (CEP)

**Goal: one branded panel; the fonts panel becomes a tab; brief-to-build happens without leaving AE.**

### 7.1 Shell

CEP extension modeled on MotionAmigo's manifest (CSXS 11, AE 24+, Node enabled): `apostle-panel/` in repo — `index.html`, CSS with Apostle brand (logo, brand fonts via @font-face, dark theme matching AE), `jsx/host.jsx` that **only** loads `apostle.jsx` and marshals JSON — zero business logic in the panel's ExtendScript. Dev mode via `PlayerDebugMode 1`; self-signed cert for packaging later. Install script: `scripts/install-panel.sh` (symlink into CEP extensions dir — no sudo needed; user-level CEP folder works, unlike ScriptUI Panels).

### 7.2 Tabs

1. **Brief** — paste/drop script; "Parse with Claude" → beats preview grouped by section (super text, VO, computed duration per beat, total duration); per-beat overrides (duration lock, style preset, motion personality); Build button. **Sync Script**: paste revision → diff view (changed/added/removed beats highlighted) → Apply (surgical ops from 5.4).
2. **Timing** — section timeline bars; drag to retime; total-duration target with proportional fit; WPM control.
3. **Brand** — brand-kit picker (`brands/*.json`); the v2.3.0 fonts UI absorbed here (family/weight dropdowns, size, tracking, Load/Sync); colors; logo.
4. **Motion** — ease profile per build, per-section or per-beat overrides; entrance/exit pickers; HandyCam level + guided Setup step ("click Setup on the marked null" with a Verify button that runs the post-Setup check from Phase 0).
5. **Review** — trigger verify-comp; thumbnails of sampled frames; findings list (from Phase 8) with "Fix with Claude" per finding.

### 7.3 Claude connection

- **v1 (ship first): the bridge folder is the transport.** Panel writes job files (`~/Documents/ae-mcp-bridge/jobs/<id>.json`: `{type: "parse-brief" | "build" | "sync-script" | "review", payload}`); a running Claude Code session watches (Monitor/loop) and answers with result files; panel polls and renders. No new infrastructure — this is the existing watched-folder pattern extended with a job type.
- **v2 (after v1 proves out): embedded session, MotionAmigo-style.** Small relay (node-pty wrapper) + xterm.js pane in the panel running Claude Code in this repo — the full agent visible inside AE. The relay binary is the only new engineering; MotionAmigo proves CEP tolerates it.

### 7.4 Panel sprawl cleanup

ScriptUI fonts panel stays until the Brand tab reaches parity, then `install-fonts-panel.sh` gains an `--uninstall` and the panel is retired. The APOSTLE library remains the single implementation both UIs call.

---

## Phase 8 — Closed-loop visual QA (Claude sees the export)

**Goal: Claude critiques its own output — "this transition is not right", "this text layout needs work" — from rendered pixels, not just DOM state.**

### 8.1 Inputs

- **Motion strips** (exists, extend): 6–10 frame bursts across each transit and entrance, half-res, assembled into contact sheets (`contact-sheet` tool) to keep image tokens low.
- **Final export ingestion** (new): point at a rendered `.mov`/`.mp4` (or AE render via aerender) → `scripts/extract-frames.sh` (ffmpeg) pulls frames at beat boundaries + transit midpoints keyed from the beats JSON timing map → same review path. This is the "screenshot the final export" ask — the QA loop runs on delivered pixels, catching render-only defects (fonts substituted at render, color shifts, dropped layers).

### 8.2 Critique rubric (`docs/qa-rubric.md`)

Per-beat, scored from frames + state JSON together, findings as structured JSON `{beatId, check, severity, evidence, suggestedFix}`:

- **Layout**: safe margins, text overlap/collision, optical centering, line-break quality, hierarchy (heading vs body scale contrast).
- **Transitions**: no empty-frame transits (the v2.1 bug class), arrival overshoot settles, no ghost/double text during handoff, transit duration feels matched to distance (px/sec band).
- **Timing**: text on screen ≥ reading time (word count × WPM + entrance), no dead air > threshold, endcard hold length.
- **Brand**: colors match kit within tolerance, correct fonts visibly applied (render-level check vs. the silent-substitution trap), logo present/clear.

### 8.3 The loop

`review-export` skill: extract → critique against rubric → findings mapped to beatIds → fixes via Phase 5 edit ops / Phase 6 motion params → re-render only affected spans → re-critique. Existing discipline applies: 8-pass cap, two-consecutive-failures = report blocked, deterministic checks always run before spending image tokens.

### 8.4 Acceptance (defect injection, like Phase 2)

Inject known defects — oversized heading breaking margins, a transit with no camera movement, a 40% shortened beat, wrong body font — render, and require the rubric review to catch ≥ 3 of 4 with correct beatId attribution and a fix that passes re-review.

---

## Sequencing & first milestone

Recommended order: **5 → 6 → 7(v1 jobs) → 8 → 7(v2 embedded terminal)**, with acceptance gates as above.

**Milestone 1 (next working session):** schema v2 + brief parser + all three CommBank scripts parsing → three built masters from pasted text alone, then a scripted revision of Video 2 synced surgically. That exercises the highest-risk data-model decisions before any UI exists.

## Decisions (Tim, 2026-07-28)

1. **CEP panel look**: build from the Apostle site's brand.
2. **Embedded Claude terminal (7.3 v2)**: yes — embed it (relay + xterm, MotionAmigo pattern). The job-file bridge remains the v1 stepping stone.
3. **HandyCam default**: **on for client work** (`subtle`), can be turned off per build.
4. **Render pipeline for 8.1**: **aerender is in scope** — the QA loop self-renders (sampled frames or full export) and must review pixels **before telling the user a build is working**. "It's working" claims are backed by rendered evidence, not DOM state alone.

## Risks

- **CEP lifespan**: Adobe is migrating to UXP, but AE UXP panels are still not viable for this scope; CEP is supported through current versions (MotionAmigo ships on it today). Revisit yearly.
- **ES3 discipline** now spans three surfaces (library, host.jsx, parse fallback in modern Node) — the library stays the only place AE logic lives.
- **Ease and Wizz licensing** — reference the pattern, implement Penner ourselves (tracked in 6.1).
- **Fuzzy beat matching** on heavily rewritten scripts can mis-pair — the diff view in the panel (and Claude's judgment in v1) is the human checkpoint before Apply.

## Phase 9 — AI comp redesign (v2.8.0, shipped 2026-07-28)

Feature brief (Tim): select a comp → generate improved design concepts (OpenAI image model via fal.ai, optional style references as inspiration-only) → pick one → reconstruct it natively in AE, fully editable.

Architecture (three decoupled modules, models swappable via `prompts/redesign/config.json`):
1. **Analysis** — `APOSTLE.extractDesignSpec` (text/fonts/colors/bounds/structure) + `captureCompReference` (full-res PNG, stable-size write guard).
2. **Concepts** — `scripts/lib/redesign-providers.cjs` ImageProvider: `fal` (queue API, data-URI uploads, poll+timeout+retry) / `mock` (offline). Prompt `concept.v1.md` preserves messaging verbatim, refs are style-only.
3. **Reconstruction** — PlanProvider `claude-cli` (`claude -p` reads original+concept PNGs, emits rebuild-plan JSON validated against `apostle/redesign-plan-schema.json`, one retry with errors fed back) → `APOSTLE.applyRebuildPlan` on a duplicate comp.

Verified E2E on SC02 (BANK REWARDS project): claude-produced 3-op plan rebuilt a hand-designed concept faithfully (left-margin block + 100px left-justified heading), entrance animation preserved (delta-shifted keys), pixels verified at settle + entrance-mid. Panel REDESIGN tab (NO./05) driven via CDP: analyze → gallery → select → apply through evalScript transport.

Bugs found by pixel verification (now guarded in `applyRebuildPlan`):
- Master style expression on sourceText silently swallows TextDocument writes → bake evaluated style + remove expression.
- Fit-width autoscale expression on Scale rendered restyled text at 27% or blank → bake all transform expressions on touched layers.
- `saveFrameToPng` returns before write completes → wait for stable file size.

Deferred: multi-comp batch redesign; concept upscale pass; reconstruction diff overlay (concept vs result) for auto-scoring in the QA loop.
