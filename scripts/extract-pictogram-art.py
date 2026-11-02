#!/usr/bin/env python3
"""extract-pictogram-art.py — recover usable artwork from the CBA pictogram set.

    python3 scripts/extract-pictogram-art.py <svg-dir> <out-dir> [--only name,name]

Why this exists
---------------
The pictogram library ships as .svg plus a batch-converted .ai mirror. Neither
is usable in After Effects as delivered:

  * 324 of the 501 SVGs contain NO vector geometry at all. They are a single
    <rect> filled by a <pattern> that wraps an embedded base64 PNG — a bitmap
    in an SVG envelope. Every usefully-named pictogram this brief needs (plane,
    gift, star, coin stack, dining, store, offers, bank card, ...) is one
    of these.
  * The .ai mirror was produced from those SVGs by a converter that wrote plain
    PDF with neither the vector data nor the embedded bitmap. In AE they import
    at the right dimensions with an alpha channel and render COMPLETELY BLANK —
    which is why 147 correctly-placed pictogram layers showed nothing.

Only 176 SVGs are genuinely vector, and all but ~22 of those are unnamed
("Group 459", "Vector-3"), so the true-vector subset cannot cover the brief.

What this does
--------------
Pulls the embedded PNG back out of each raster SVG, trims its transparent
margin, and re-centres it on a square canvas of the original artboard size.
Trimming and re-centring matters: the source artboards pad inconsistently (the
plane sits high-left inside its 284x284 box), so fitting the raw artboard to a
tile puts the art visibly off-centre inside the circle.

The result is correct, on-brand artwork that actually renders. It is RASTER,
at 284px — enough for a 108px tile or a 310px hero, not for a big push-in.
That is a property of the source assets, not of this script: the vector
originals are not in the delivered library.
"""

import argparse
import base64
import os
import re
import sys

from PIL import Image
import io

EMBED = re.compile(r'xlink:href="data:image/png;base64,([^"]+)"')
VIEWBOX = re.compile(r'viewBox="([\d.\-]+) ([\d.\-]+) ([\d.\-]+) ([\d.\-]+)"')


def extract(svg_path):
    """Return (PIL.Image, artboard_size) or (None, reason)."""
    with open(svg_path, "r", errors="ignore") as fh:
        s = fh.read()
    if "<path" in s and "<image" not in s:
        return None, "true vector — leave as .ai"
    m = EMBED.search(s)
    if not m:
        return None, "no embedded PNG and no paths"
    raw = base64.b64decode(m.group(1))
    img = Image.open(io.BytesIO(raw)).convert("RGBA")
    vb = VIEWBOX.search(s)
    size = int(round(float(vb.group(3)))) if vb else max(img.size)
    return img, size


def trim_and_centre(img, canvas):
    bbox = img.getbbox()          # alpha-aware bounding box
    if bbox:
        img = img.crop(bbox)
    # scale down only if the trimmed art exceeds the canvas
    w, h = img.size
    if w > canvas or h > canvas:
        k = min(canvas / w, canvas / h)
        img = img.resize((max(1, int(w * k)), max(1, int(h * k))), Image.LANCZOS)
        w, h = img.size
    out = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    out.paste(img, ((canvas - w) // 2, (canvas - h) // 2), img)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("svg_dir")
    ap.add_argument("out_dir")
    ap.add_argument("--only", default="")
    args = ap.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    wanted = [n for n in args.only.split(",") if n] if args.only else None

    done, skipped, missing = [], [], []
    names = wanted if wanted else [
        os.path.splitext(f)[0] for f in sorted(os.listdir(args.svg_dir)) if f.endswith(".svg")
    ]

    for name in names:
        src = os.path.join(args.svg_dir, name + ".svg")
        if not os.path.exists(src):
            missing.append(name)
            continue
        img, info = extract(src)
        if img is None:
            skipped.append((name, info))
            continue
        canvas = info
        out = trim_and_centre(img, canvas)
        dest = os.path.join(args.out_dir, name + ".png")
        out.save(dest)
        done.append((name, canvas))

    for n, c in done:
        print(f"  extracted {n} -> {c}x{c}")
    for n, why in skipped:
        print(f"  skipped   {n}: {why}")
    for n in missing:
        print(f"  MISSING   {n}.svg", file=sys.stderr)
    print(f"\n{len(done)} extracted, {len(skipped)} skipped, {len(missing)} missing")


if __name__ == "__main__":
    main()
