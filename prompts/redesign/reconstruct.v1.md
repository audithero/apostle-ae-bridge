<!-- reconstruct.v1 — prompt template for the reconstruction LLM.
     Placeholders: {{ORIGINAL_PNG}} {{CONCEPT_PNG}} {{REF_LIST}} {{SPEC_JSON}}
     {{SCHEMA_JSON}} {{COMP_W}} {{COMP_H}}
     Sent via `claude -p`; the model Reads the image files itself. -->

You are reconstructing an approved design concept natively inside After Effects.

Read these image files now:
- ORIGINAL comp render: {{ORIGINAL_PNG}}
- APPROVED concept to reconstruct: {{CONCEPT_PNG}}
{{REF_LIST}}

Current composition spec (extracted live from AE — layer names here are the exact handles you must target):

```json
{{SPEC_JSON}}
```

Produce a rebuild plan: a JSON object that transforms the CURRENT comp into the APPROVED concept using native AE operations. The plan is applied to a duplicate of the comp, then reviewed by a human — favor fidelity to the concept over caution, but only use operations the schema allows.

Rules:
- Comp is {{COMP_W}}x{{COMP_H}} px, origin top-left. All colors are [r,g,b] floats 0-1.
- Reuse existing layers wherever the concept keeps their content: move/resize/restyle them with setTransform / setFont / setFill / setText. Only create new layers for elements the concept adds (panels, rules, shapes); only delete layers whose content the concept genuinely drops.
- Text content is sacred: never change wording via setText unless the concept only rearranges line breaks. If the concept appears to drop text, keep the layer and note it in `summary` instead of deleting.
- To move a layer, prefer `setTransform` with `bounds: [x, y]` — it places the layer's rendered top-left at that comp-pixel point and the interpreter handles all anchor/justification math. Use raw `position` only when you specifically want to set the transform anchor location. When an op changes a text layer's font, size or justification AND moves it, emit the setFont op BEFORE the setTransform op (placement is measured after restyling).
- Estimate positions, sizes and colors from the concept image carefully — sample the concept's actual proportions (e.g. a heading whose cap height is ~1/12 of frame height in the image should get a size that matches: comp height / 12 ≈ size in px is a reasonable first-order estimate for all-caps text).
- Every op gets a short `why`.
- Fonts: prefer the PostScript names already present in the spec (heading font for headings, body font for body). Only introduce another font if the concept clearly demands a different weight that exists in the same family.
- Keep it minimal: the smallest set of ops that faithfully reproduces the concept's layout, hierarchy, spacing and color.

The plan must validate against this JSON schema:

```json
{{SCHEMA_JSON}}
```

Output ONLY the JSON object. No markdown fences, no commentary before or after.
