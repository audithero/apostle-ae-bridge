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

## Camera rig decision (Phase 3 — pending)

Two rigs behind one interface in `apostle/apostle.jsx`:

- `buildRigHandyCam(master)`: clean null + HandyCam effect; one human Setup click; keyframes on effect properties only (matchNames from `apostle/matchnames-handycam.md`).
- `buildRigExpression(master)`: pure expression two-node rig; zero manual steps, zero plugin dependency.

Pre-agreed threshold: if the HandyCam path needs more than one human touch per comp or hits the duplicate-rig bug ("Couldn't find HandyCam Camera"), the expression rig becomes the default and HandyCam remains a manual-polish option only.

**Decision: TBD after Phase 3 A/B.**

## Phase 0 gate results

- Gate A (see-frame inline image, <25k tokens at 800px): **pending**
- Gate B (HandyCam matchNames captured to `apostle/matchnames-handycam.md`): **pending**
- Bridge round-trip latency: **pending** (expect 1–3 s)
