# Script v2 (2026-07-31) — assessment against recorded VO and built comps

Method: every `VO:` line in `script-v2-2026-07-31.md` concatenated per video and word-level diffed
against the concatenated `vo` text of `beats/video<N>-vo-locked.json` (which is the transcript of
what was actually recorded and measured). Supers diffed line-by-line against built `superText`.

## Headline

**The voiceover is effectively locked.** Videos 2, 3 and 4 are word-for-word identical. Videos 5, 6
and 7 differ only by punctuation or a script-side typo. **Video 1 is the only video with new spoken
content.** Everything else that changed is supers — which is exactly what the brief said would
happen ("supers to be added after copy finessing").

| Video | Recorded words | Script words | Similarity | Real VO change | Super changes |
|---|---|---|---|---|---|
| 1 | 370 | 423 | 0.928 | **YES — new 53-word paragraph** | n/a (no supers in script) |
| 2 | 234 | 234 | 1.000 | none | n/a |
| 3 | 298 | 298 | 1.000 | none | n/a |
| 4 | 326 | 326 | 1.000 | none | n/a |
| 5 | 242 | 242 | 0.996 | none (script typo) | **6 of 8 beats** |
| 6 | 137 | 137 | 0.993 | none (punctuation) | **6 of 11 beats** |
| 7 | 221 | 221 | 0.991 | none (punctuation) | **5 of 9 beats** |

---

## A. VO changes

### A1 — Video 1: NEW paragraph, not recorded 🔴 ACTION

Inserted after the first beat ("…simpler and more flexible rewards experience for customers."):

> At the same time you might see changes also following the Reserve Bank of Australia's announcement
> of industry-wide interchange reforms, which will reshape Australian credit card marketing from
> 1 October 2026. As the industry adapts to these changes, CommBank is evolving the reward and
> loyalty propositions to continue delivering value to customers.

53 words ≈ 21s at the measured pace of this read. **No recorded audio exists for this.**

Decision: build the beat now — supers, pictograms and a 21s hold — flagged red as awaiting VO, and
retime the rest of Video 1 around it. The video is then complete the moment the pickup VO lands.

### A2 — Video 5: script typo, no action

Script reads "customers are **showed** what might be the best time to book". The recorded VO says
"**shown**", which is correct. Recorded VO wins; script should be corrected, not the audio.

### A3 — Videos 6 & 7: punctuation only, no action

Trailing full stop on "One.CBA" differs. Not audible, not a super change.

---

## B. Super changes

> **Correction (applied 2026-08-01).** An earlier pass of this report compared the script's SUPER
> lines against each beat's `superText` and concluded there were nine content gaps. That comparison
> was wrong: `superText` is only a beat's *opening* super, and the **moments layer already carries
> the rest**. Checking the moments files directly, every fact flagged as missing is in fact already
> on screen — the $10 Smart travel credit, the $120 dining cap, 24/7 support, the 5x/2x earn rates,
> the 1 Jan 2027 waivers and the insurance-provider change all have their own moments.
>
> **There are no content gaps.** Script v2 changes no facts the build was not already showing.
> Everything in this section is wording, and it has all been applied.

Legend: ⚪ = wording only. (No 🔴 rows survived the correction above.)

### Video 5 — Cards + Travel

| Beat | Built | Script v2 | |
|---|---|---|---|
| 1 | Be rewarded like never before with CommBank Yello. | …CommBank Yello *(no period)* | ⚪ |
| 3 | Search and book in the CommBank app. | Search + book flights, hotels, car rental via Travel Booking | ⚪ |
| 5 | Exclusive travel offers. | Exclusive Travel Offers. **24/7 Customer Support.** | ⚪ already a moment ("24/7 customer support") — capitalised to match |
| 6 | Use and earn Yello points with Travel Booking. | …**5x points per $1 on hotel and car rental. 2x points per $1 on flights.** | ⚪ already a chipRow moment (5x hotels / 5x car / 2x flights) |
| 7 | $25 monthly Travel Credit. | From 1 Oct: $25 Monthly Travel Credit for Ultimate. **$10 Monthly Travel Credit for Smart.** | ⚪ already a second moment — "From 1 Oct" stamp added |
| 8 | Enjoy more travel benefits than ever. | + **Travel. Dining. Memberships. Airport Lounge Passes\*** | ⚪ beat split into two moments so both script supers land |

Note: script super 3 reads "Search + book **fights**" — typo for "flights". Corrected on the way in.

### Video 6 — Dine In Deals

| Beat | Built | Script v2 | |
|---|---|---|---|
| 2 | Easier to find the best places to eat. | Dine In Deals in the CommBank app. | ⚪ |
| 6 | 2. Add the card to your digital wallet. | 2. Add Dine In Deals card directly to digital wallet | ⚪ |
| 7 | 3. Pay with the card and save. | 3. Pay with the Dine In Deals card and save | ⚪ |
| 8 | No codes. No vouchers. No awkward moments. | …No awkward **redemption** moments. | ⚪ |
| 9 | $10 monthly Dining Credit. | From 1 Oct: $10 Monthly Dining Credit **(up to $120 in total)** | ⚪ $120 cap was already in the sub — "From 1 Oct" stamp added |
| 11 | Find out more. | To find out more, visit commbank.com.au/commbankyello or search CommBank Yello on One.CBA | ⚪ endcard already carries the URL as sub |

### Video 7 — Cards CVP

| Beat | Built | Script v2 | |
|---|---|---|---|
| 6 | Up to 1.5 Yello points per $1 spent. | **CommBank Yello Tiers** + **2x Yello Points on International Spend** | ⚪ already two moments; heading + earn rate now split super/sub |
| 7 | Travel. Dining. Memberships. | + **\*Eligibility criteria applies** | ⚪ disclaimer already present — reworded to the script's asterisked form |
| 8 | 1 October 2026: international transaction fee waiver removed. | + **1 Jan 2027: spend-based fee waivers cease (Smart & Ultimate)** + **insurance provider detail changes** | ⚪ all three already exist as moments m1/m2/m3 — no change needed |
| 9 | Find out more. | To find out more, visit commbank.com.au/card-updates… | ⚪ endcard sub already correct (card-updates, not commbankyello) |

Beat 6 is the structurally interesting one: the new script splits tier earn and international earn
into two VO lines, but the **recording has them as a single continuous sentence**. So this is not a
retime — it is one beat carrying two moments, which is exactly what the moments system is for.

---

## C. What this means for the build

1. **Only Video 1 needs new audio.** Everything else is a wording-and-art pass on locked timing.
2. **No content gaps.** Every fact script v2 spells out was already on screen via the moments layer.
   14 super/sub wording edits applied (`scripts/apply-super-updates-v2.cjs`), plus one beat split
   (V5 beat 8) so that both of the script's supers for that beat land.
3. The only red flag needed in AE is Video 1's unrecorded paragraph.

---

## D. Findings from the art + motion pass (2026-08-01)

### D1 — The pictogram library is 65% raster, not vector 🔴

The brief was to swap Apostle's drawn glyphs for the bank's pictograms and "make sure they are
all vector enabled as they are .ai files". They are not vector, and this is a property of the
delivered assets, not of the build:

| | count | |
|---|---|---|
| SVGs that are genuinely vector (`<path>`) | 176 | but ~154 are unnamed — "Group 459", "Vector-3" |
| SVGs that are a bitmap in an SVG wrapper | 324 | a `<rect>` filled by a `<pattern>` wrapping a base64 PNG |
| usefully-named true-vector pictograms | ~22 | calendar, change, chart, conversation, security, stopwatch, travel, warning… |

Every pictogram this brief needs — plane, gift, star, coin stack, dining, store, offers,
percentage, CommBank Card — is in the raster group.

Worse, the `Pictograms_AI` mirror is unusable. Those `.ai` files were produced from the SVGs by a
converter that kept neither the vector data nor the embedded bitmap: they import into AE at the
right dimensions with an alpha channel and **render completely blank**. That is why the first
render showed 147 correctly-placed, correctly-scaled, entirely invisible pictogram layers.

Resolution applied: `scripts/extract-pictogram-art.py` pulls the embedded PNG back out of each
SVG, trims its transparent margin and re-centres it on the original artboard square (the source
padding is inconsistent — the plane sits high-left in its 284x284 box, which would have shown as
off-centre art inside the tile). The 29 pictograms in use were extracted to
`01.MEDIA/GFX/Pictograms_PNG_AE/` and the project's footage items repointed at them. `calendar`
and `change` are genuinely vector and were left as `.ai`.

The artwork is now correct and on brand — verified in rendered pixels. **It is raster at 284px.**
That is fine for a 108px tile and a 310px hero, and it will soften in a hard push-in. Getting true
vector requires the original pictogram artwork from the design team; a 2022 file,
`BACKUP/APRIL_2026/.../Pictograms_brand_refresh_complete.ai`, IS real vector (1107 path
operators, zero embedded images) but is an older set on a single un-separated artboard.

### D2 — Blank frames in the back half of `crane` transits 🔴 open

`lateralTruck`, `whipOrbit` and `dollyZoom` were each given a mitigation after earlier pixel QA
caught white mid-transit frames. `crane` never was: it arcs up and looks forward at a plane whose
content has not revealed yet. Rendered proof: VIDEO_001 at t=40.8s is an entirely empty frame.

Measured geometry: stations sit 2400 apart, camera zoom 1493 on a 1920 comp, so the camera sees
~2460 wide at the transit midpoint — the incoming plane IS in frame. It is blank because the
first moment of a beat is pinned to reveal at arrival (`lead = 0` for moment 1).

`scripts/fix-blank-transits.jsx` pulls every mid-transit control point back in z, which widens the
move and shortens the dead window but does not close it. The real fix is to let moment 1 lead so
content fades up during the approach. That was attempted and reverted: see D3.

### D3 — After Effects session degradation 🔴 needs an AE restart

Through this session AE became progressively unreliable under scripted layer creation. It began as
intermittent, non-deterministic failures inside `applyMoments` — a vectors-group handle losing
`addProperty`, a scalar property handed a vector — which moved between runs and did not reproduce
per scene. The codebase already documents this class of AE 26 fault at `makeText`: *"AE 26
intermittently hands back a garbage TextDocument on the first .value read after addText
(fillColor rejects junk like [3126,1920,1080]); non-deterministic, project-state dependent."*

Mitigations that worked for a while: one undo group per scene rather than per document
(`scripts/apply-moments-per-scene.jsx`), plus retry with a cache purge between attempts.

It has now degraded past that. Nearly every scene fails with `ReferenceError: Object is invalid`,
deterministically, on all four retries, and reverting the last code change did not help. AE itself
is healthy (it answers preflight), so this is session state, and the remedy is an AE restart.

Because `applyMoments` clears a scene's moment layers before rebuilding them, the failed passes
left VIDEO_001–004 partially rebuilt. Nothing is lost: the beats and moments JSON are the source of
truth and every step is a re-runnable script. VIDEO_005–007 are untouched and intact.
