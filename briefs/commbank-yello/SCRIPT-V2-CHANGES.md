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
