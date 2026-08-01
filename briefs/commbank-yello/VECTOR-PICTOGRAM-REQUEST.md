# Vector pictogram request — CommBank Yello 3.0 education videos

**Ask:** the 29 pictograms below as true vector artwork (native `.ai` with editable paths, or
`.svg` containing real `<path>` geometry). Outlined strokes are fine. One pictogram per file,
named exactly as in the first column.

## Why

The pictogram library we were given cannot be used as vector, and about two-thirds of it is not
vector at all:

* **324 of the 501 SVGs contain no vector geometry.** Each is a single `<rect>` filled by a
  `<pattern>` that wraps an embedded base64 PNG — a bitmap in an SVG envelope. Every pictogram
  this project needs is one of these.
* **176 SVGs are genuinely vector**, but roughly 154 of those are unnamed exports
  (`Group 459`, `Vector-3`), leaving only ~22 usable named vector pictograms.
* **The `Pictograms_AI` folder is unusable, and re-saving it will not help.** All 31 names we
  need are in that folder, but it is the same bitmaps in a different wrapper. Reading the files
  byte-for-byte (2026-08-01) shows two independent defects:
  * **29 of the 31 contain a raster, not paths.** Each `.ai` was made by opening the
    bitmap-in-SVG in Illustrator 24 and saving — `%%Title: (coin stack.svg)`, and the private
    art block carries `%%BeginRaster`/`BeginData` with zero path operators. The only two with
    real vector paths are `calendar` and `change`, which is exactly the pair already marked
    "already true vector" below.
  * **They were saved without "Create PDF Compatible File".** The PDF page every `.ai` exposes
    is an empty marked-content block (`/OC /MC0 BDC EMC`, 19 bytes) with no drawing operators at
    all. After Effects reads that PDF layer, which is why 147 correctly placed pictogram layers
    imported at the right dimensions with an alpha channel and rendered **completely blank**.

  So re-saving these with PDF compatibility on would fix the blankness and still leave 29
  bitmaps. The artwork has to come from whatever the pictograms were drawn in, not from here.

We are currently shipping artwork recovered from the embedded bitmaps: the PNG is extracted from
each SVG, its transparent margin trimmed, and it is re-centred on the original artboard square.
That looks correct and on brand, and it is what is in the build today. It is raster at 284px —
good for a 108px tile and a 310px hero, and it will visibly soften in any push-in or scale-up.

Anything delivered as real vector drops straight in: the build already places these through a
continuous-rasterisation path, so vector files scale losslessly at any camera move with no
changes to the project.

## What we need

Sorted by how often each appears. 147 placements across the seven videos.

| Pictogram | Uses | Videos | Stands for | Status |
|---|---|---|---|---|
| `coin stack` | 20 | V1V2V3V4V5V7 | Earn Yello points, Your points, Introducing CommBank Yello points. | **needs vector** |
| `offers` | 14 | V1V2V3V4V6V7 | Offers, Activate offer | **needs vector** |
| `star` | 11 | V1V2V4V5V6V7 | CommBank Yello, CommBank is evolving how customers, An expanded network of partners. | **needs vector** |
| `store` | 11 | V1V2V3V4V7 | Partner stores, Brand stores | **needs vector** |
| `shopping trolley` | 9 | V1V2V3V4V6V7 | Shopping, Daily essentials | **needs vector** |
| `percentage` | 8 | V1V2V4V6V7 | Discounts, Activate offer | **needs vector** |
| `plane` | 8 | V1V4V5V7 | Flights, Travel credits | **needs vector** |
| `gift` | 8 | V1V2V4V7 | Gift cards, Points for gift cards. | **needs vector** |
| `CommBank Card` | 5 | V1V2V3 | Eligible card purchases, Credit cards, Credit card market | **needs vector** |
| `change` | 5 | V1V2V4 | Interchange reforms, Transfer points to partner loyalty, Transfer points to loyalty program | already true vector |
| `luggage` | 5 | V1V2V4V7 | Travel | **needs vector** |
| `trophy` | 4 | V1V2V3 | Banking milestones, Milestones | **needs vector** |
| `branch` | 3 | V1V3 | Industry-wide interchange reforms., Earn points from your banking rela, Banking | **needs vector** |
| `document` | 3 | V1V2V3 | New products, Eligible products | **needs vector** |
| `card cycle` | 3 | V1V2V3 | Renewals | **needs vector** |
| `energy` | 3 | V1V4V7 | A first for CommBank., Flexibility., Earn unlimited Yello points per ye | **needs vector** |
| `bill` | 3 | V2V4V7 | Everyday essentials, Everyday value, Daily essentials | **needs vector** |
| `house` | 3 | V4V5 | Hotels | **needs vector** |
| `car` | 3 | V4V5 | Car hire, Car rental | **needs vector** |
| `tick` | 2 | V1V6 | In addition to credit card points., Just pay | **needs vector** |
| `megaphone` | 2 | V1V2 | Presale access | **needs vector** |
| `partnership` | 2 | V4V7 | Partners | **needs vector** |
| `dining` | 2 | V5V7 | Dining credits | **needs vector** |
| `keycard` | 2 | V5V7 | Lounge passes | **needs vector** |
| `no fees` | 2 | V6 | No codes, No vouchers | **needs vector** |
| `calendar` | 1 | V1 | From 1 Oct 2026 | already true vector |
| `diamond` | 1 | V1 | A whole new world of points and pe | **needs vector** |
| `birthday` | 1 | V4 | Special occasions | **needs vector** |
| `certified` | 1 | V5 | Best Price Guarantee | **needs vector** |
| `analytics` | 1 | V5 | Price Prediction | **needs vector** |
| `decreasing trend` | 1 | V5 | Auto Price Drop | **needs vector** |
`calendar` and `change` are already true vector in the delivered set and need no action — they are
listed only so the set is complete.

## Notes for whoever pulls these

* Names must match exactly (including spaces and case) — the build resolves pictograms by name.
* Square artboards are ideal but not required; the build trims and re-centres.
* Black line art with the Yello accent fill, exactly as the current set — no restyling wanted.
* If the source is a Figma file, "Export as SVG" with **Outline text** on and **Include bitmaps**
  off will reveal immediately whether a given pictogram is real vector: if the export contains
  `<image`, it is the bitmap version and is not what we need.
