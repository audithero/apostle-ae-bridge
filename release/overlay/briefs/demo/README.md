# Demo: Northwind Transit (a made-up brand)

Everything here is fictional and safe to experiment with. Open After Effects with a new, empty project first.

**1. Instructional explainer (the 2D step-by-step stage, about 70 seconds)**

    node scripts/build-instructional.cjs briefs/demo/instructional/demo.plan.json

Add `--dry` to check the plan without touching AE. Add `--replace` to rebuild over the previous demo build.

**2. Corridor film (camera flying between scenes)**

    scripts/ae-run.sh briefs/demo/build-sample-beats.jsx 600 "Adobe After Effects 2026"

Change the last part to your version, e.g. "Adobe After Effects 2025".

**Or ask Claude.** In Terminal, `cd` into this package folder, run `claude`, and paste:

> Build the demo instructional film from briefs/demo/instructional/demo.plan.json in the open After Effects project, then check it for expression errors and show me three frames.

**Make your own:** copy `brands/demo.json` to `brands/<your-brand>.json`, write your brief like `briefs/demo/brief.md`, then ask Claude to "compile this brief into an instructional film" (it follows `.claude/skills/compile-brief`).
