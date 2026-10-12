---
name: compile-brief
description: Turn a client brief (script, PDF, deck, notes, images) into After Effects compositions with the Apostle library. A treatment comes first and needs human sign-off, then a moment-by-moment spec that is validated, compiled and built in AE. Use when asked to start a new project or video from a brief, to plan or compose a video, to write a treatment, or to build a brief in AE.
---

# compile-brief: from brief to built composition

You are the creative director first and the motion designer second. Code does
every number. The contract lives in `scripts/compile-brief.cjs`; this skill is how
an interactive session follows it. Prompts that encode the craft are in
`prompts/compile/treatment.v1.md` and `prompts/compile/spec.v1.md`. **Read both
before composing by hand.** They hold the rules learned on CommBank Yello.

## Two ways to run it

**A. Let the pipeline call the model** (headless, the same path the panel's
BRIEF > COMPILE uses). The model is pinned in `prompts/compile/config.json`.

```bash
node scripts/compile-brief.cjs treatment --client acme --brief briefs/acme/brief.md \
  --attach ~/Downloads/acme-deck.pdf --brand brands/acme.json --notes "staff-facing, 90s"
# show the human treatment.md; on their word:
node scripts/compile-brief.cjs revise  --run .apostle-runs/compile/acme-1 --notes "..."   # if asked
node scripts/compile-brief.cjs approve --run .apostle-runs/compile/acme-1
node scripts/compile-brief.cjs spec    --run .apostle-runs/compile/acme-1
node scripts/compile-brief.cjs build   --run .apostle-runs/compile/acme-1 --video <slug>
```

**B. Do the creative passes yourself, in this session**, when the human wants to
talk the treatment through. Write `treatment.json` to the shape in
`treatment.v1.md` and the spec to `apostle/video-spec-schema.json`, then hand off
to the deterministic tools:

```bash
node scripts/compile-brief.cjs capabilities                       # what the library can build
node scripts/compile-brief.cjs validate --spec briefs/acme/specs/x.json
node scripts/compile-brief.cjs compile  --spec briefs/acme/specs/x.json --brand brands/acme.json
node scripts/compile-brief.cjs build    --beats briefs/acme/beats/x.json --moments briefs/acme/moments/x.json --brand brands/acme.json
```

## Hard rules

1. **No build without an approved treatment.** Show the treatment (logline,
   structure, visual system, the full VO per video, assets needed, gaps, open
   questions) and wait for the human. `spec` refuses an unapproved run.
2. **The client's VO is never reworded.** `validate-spec` rejects any drift. A
   drafted VO (no script in the brief) is flagged for client approval.
3. **Compose from the capability list only.** Unknown layouts or glyphs fail
   validation. If the brief needs something the library cannot draw, put it under
   `libraryGaps` and use `placeholder`. Never invent.
4. **Never hand-compute timing.** `cue` places moments by what is said; durations,
   floors and windows come from `compile-spec.cjs`. With recorded VO, run
   `scripts/vo-align.py`, set `timing: {mode: "words", words: ".../words.json"}`
   and recompile. The spec does not change.
5. **Build, then prove it in pixels.** `build` runs the deterministic checks, but
   success is only reported after the `verify-comp` / `review-export` loop has
   looked at rendered frames across at least one transit and one entrance
   (CLAUDE.md). Never save the user's AE project.
6. Preflight first (`scripts/preflight.sh`). `build` needs a live AE.

## When things go wrong

- `spec` fails validation 3 times: read the errors in the thrown message and the
  `spec.<slug>.attempt*.raw.txt` files in the run dir. Usually the model is
  paraphrasing VO or inventing a glyph. Fix the spec by hand and use `compile`.
- A moment lands at the wrong time with recorded VO: the aligner warns when it
  falls back to a proportional guess (talent ad-libs, whisper spelling). Fix the
  `cue` to what was actually said, or pin the moment with measured timing.
- Something the treatment wants is a library gap: say so plainly and propose the
  smallest library addition (a new layout or glyph in `apostle.jsx`,
  `capabilities.cjs` picks glyphs up automatically, layouts need a line there).
