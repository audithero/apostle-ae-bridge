<!-- concept.v1 — prompt template for the image model (concept generation).
     Placeholders: {{TEXT_INVENTORY}} {{DIMENSIONS}} {{NOTES}} {{HAS_REFS}}
     The FIRST image sent is always the current comp render; any further
     images are style references. -->

Redesign this motion-graphics frame. The first image is the current design of an After Effects composition ({{DIMENSIONS}}). Produce an improved layout of the SAME content.

Hard rules — never break these:
- Preserve every piece of messaging exactly. The frame must contain exactly this text, verbatim, with nothing added and nothing dropped: {{TEXT_INVENTORY}}
- Preserve the meaning and imagery of the original: same product, same brand, same message.
- Do not introduce content, logos, mascots, photos, or words from the style references. References are inspiration for style only — layout, typography, color, spacing, mood.
{{HAS_REFS}}

Improve, with restraint:
- Visual hierarchy: the primary message should read first, clearly.
- Spacing and alignment: consistent margins, breathing room, a clear grid.
- Typography: better scale contrast between heading and supporting text; clean, professional type. Keep text large enough to read at broadcast size.
- Balance and clarity: reduce clutter, strengthen focal point, professional color use.
- Stay achievable with native After Effects layers: flat color panels, simple geometric shapes, text. No photographic scenes, no 3D renders, no textures that a shape layer cannot make.

Client direction: {{NOTES}}

Output a single finished frame at the same aspect ratio.
