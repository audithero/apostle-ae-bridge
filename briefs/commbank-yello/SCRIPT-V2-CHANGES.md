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

Legend: 🔴 = content gap, a fact in the VO or script that the build does not show. ⚪ = wording only.

### Video 5 — Cards + Travel

| Beat | Built | Script v2 | |
|---|---|---|---|
| 1 | Be rewarded like never before with CommBank Yello. | …CommBank Yello *(no period)* | ⚪ |
| 3 | Search and book in the CommBank app. | Search + book flights, hotels, car rental via Travel Booking | ⚪ |
| 5 | Exclusive travel offers. | Exclusive Travel Offers. **24/7 Customer Support.** | 🔴 24/7 support is in the VO but never shown |
| 6 | Use and earn Yello points with Travel Booking. | …**5x points per $1 on hotel and car rental. 2x points per $1 on flights.** | 🔴 the earn rates are in the VO but never shown |
| 7 | $25 monthly Travel Credit. | From 1 Oct: $25 Monthly Travel Credit for Ultimate. **$10 Monthly Travel Credit for Smart.** | 🔴 the $10 Smart credit is in the VO but never shown |
| 8 | Enjoy more travel benefits than ever. | + **Travel. Dining. Memberships. Airport Lounge Passes\*** | 🔴 second super for this beat, missing |

Note: script super 3 reads "Search + book **fights**" — typo for "flights". Corrected on the way in.

### Video 6 — Dine In Deals

| Beat | Built | Script v2 | |
|---|---|---|---|
| 2 | Easier to find the best places to eat. | Dine In Deals in the CommBank app. | ⚪ |
| 6 | 2. Add the card to your digital wallet. | 2. Add Dine In Deals card directly to digital wallet | ⚪ |
| 7 | 3. Pay with the card and save. | 3. Pay with the Dine In Deals card and save | ⚪ |
| 8 | No codes. No vouchers. No awkward moments. | …No awkward **redemption** moments. | ⚪ |
| 9 | $10 monthly Dining Credit. | From 1 Oct: $10 Monthly Dining Credit **(up to $120 in total)** | 🔴 the $120 cap appears nowhere in the build |
| 11 | Find out more. | To find out more, visit commbank.com.au/commbankyello or search CommBank Yello on One.CBA | ⚪ endcard already carries the URL as sub |

### Video 7 — Cards CVP

| Beat | Built | Script v2 | |
|---|---|---|---|
| 6 | Up to 1.5 Yello points per $1 spent. | **CommBank Yello Tiers** + **2x Yello Points on International Spend** | 🔴 one recorded beat, two supers → needs two moments |
| 7 | Travel. Dining. Memberships. | + **\*Eligibility criteria applies** | 🔴 required disclaimer missing |
| 8 | 1 October 2026: international transaction fee waiver removed. | + **1 Jan 2027: spend-based fee waivers cease (Smart & Ultimate)** + **insurance provider detail changes** | 🔴 two of three regulatory items missing; all three are in the VO |
| 9 | Find out more. | To find out more, visit commbank.com.au/card-updates… | ⚪ endcard sub already correct (card-updates, not commbankyello) |

Beat 6 is the structurally interesting one: the new script splits tier earn and international earn
into two VO lines, but the **recording has them as a single continuous sentence**. So this is not a
retime — it is one beat carrying two moments, which is exactly what the moments system is for.

---

## C. What this means for the build

1. Only Video 1 needs new audio. Everything else is a supers-and-art pass on locked timing.
2. Nine 🔴 content gaps, all of them facts the voiceover already speaks but the screen never shows.
   These are the ones that matter — a frontline viewer hears "$10 Travel Credit with the CommBank
   Smart credit card" and sees a super that only mentions $25.
3. Every 🔴 gap gets a red guide layer in its scene comp naming the required change.
