#!/usr/bin/env node
/**
 * apply-super-updates-v2.cjs — bring supers into line with script v2 (2026-07-31).
 *
 *   node scripts/apply-super-updates-v2.cjs [--dry]
 *
 * Every edit below is a WORDING change. Script v2 changed no facts that the
 * build was not already showing — the detail the script spells out in its
 * SUPER lines was already carried by the moments layer (see
 * SCRIPT-V2-CHANGES.md). So this touches super/sub strings only: no beat
 * durations, no moment windows, no retime.
 *
 * Beats `superText` and the matching moment `super` are updated together —
 * `superText` is what a rebuild would emit, the moment string is what is on
 * screen now, and they must not drift apart.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'briefs', 'commbank-yello');
const dry = process.argv.includes('--dry');

// video -> [{ beat: <beatId prefix>, moment: <moment id>, super?, sub?, chips?, tiles?, note }]
const EDITS = {
  'video5-vo-locked': [
    {
      beat: 'travel-booking-lets-customers-search', moment: 'm1',
      super: 'Search + book flights, hotels, car rental via Travel Booking.',
      note: 'script v2 super 3 (script typo "fights" corrected to "flights")',
    },
    {
      beat: 'travel-booking-gives-customers-acces', moment: 'm1',
      super: 'Exclusive Travel Offers.',
      note: 'script v2 super 5 capitalisation',
    },
    {
      beat: 'travel-booking-gives-customers-acces', moment: 'm2',
      super: '24/7 Customer Support.',
      note: 'script v2 super 5, second half',
    },
    {
      beat: 'and-eligible-credit-card-customers-w', moment: 'm1',
      super: 'From 1 Oct: $25 Monthly Travel Credit.',
      sub: 'For CommBank Ultimate credit card customers.',
      note: 'script v2 super 7 adds the "From 1 Oct" stamp',
    },
    {
      beat: 'and-eligible-credit-card-customers-w', moment: 'm2',
      super: 'From 1 Oct: $10 Monthly Travel Credit.',
      sub: 'For CommBank Smart credit card customers.',
      note: 'script v2 super 7, second half',
    },
  ],

  'video6-vo-locked': [
    {
      beat: 'thanks-to-commbank-yello-we-re-makin', moment: 'm1',
      super: 'Dine In Deals in the CommBank app.',
      sub: 'Making it easier to find the best places to eat.',
      note: 'script v2 super 2 replaces the paraphrase',
    },
    {
      beat: 'then-they-add-their-dine-in-deals-ca', moment: 'm1',
      super: '2. Add Dine In Deals card directly to digital wallet.',
      note: 'script v2 super 6',
    },
    {
      beat: 'then-customers-pay-with-the-dine-in', moment: 'm1',
      super: '3. Pay with the Dine In Deals card and save.',
      note: 'script v2 super 7',
    },
    {
      beat: 'no-codes-no-vouchers-and-no-awkward', moment: 'm1',
      super: 'No codes. No vouchers. No awkward redemption moments.',
      note: 'script v2 super 8 — "redemption" restored',
    },
    {
      beat: 'plus-from-october-1st-eligible-credi', moment: 'm1',
      super: 'From 1 Oct: $10 Monthly Dining Credit.',
      sub: 'Up to $120 in total. For eligible credit card customers.',
      note: 'script v2 super 9 — "From 1 Oct" stamp; $120 cap kept in sub',
    },
  ],

  'video7-vo-locked': [
    {
      beat: 'depending-on-their-tier-customers-ca', moment: 'm1',
      super: 'CommBank Yello Tiers',
      sub: 'Earn up to 1.5 Yello points on every $1 spent.',
      note: 'script v2 super 5 is a heading — the earn rate it displaced moves to the sub so no fact is lost',
    },
    {
      beat: 'depending-on-their-tier-customers-ca', moment: 'm2',
      super: '2x Yello Points on International Spend',
      note: 'script v2 super 6 capitalisation',
    },
    {
      beat: 'customers-can-also-enjoy-added-benef', moment: 'm1',
      super: 'Travel. Dining. Memberships.',
      sub: '*Eligibility criteria applies',
      note: 'script v2 super 7 — disclaimer given the script\'s exact asterisked form',
    },
  ],
};

// V5 beat 8 carries TWO script supers (8 and 9) against one moment. Split it
// so both land, which also gives the closing beat a beat of pacing instead of
// holding a single four-tile row for 11.85s.
const SPLITS = {
  'video5-vo-locked': [
    {
      beat: 'you-can-even-enjoy-added-benefits-in',
      note: 'script v2 supers 8 + 9 both belong to this beat',
      build(existing) {
        const row = JSON.parse(JSON.stringify(existing[0]));
        const lead = {
          id: 'm1', layout: 'statement',
          super: 'Enjoy more travel benefits than ever.',
          sub: '', from: 0, to: 0.28,
        };
        row.id = 'm2';
        row.super = 'Travel. Dining. Memberships. Airport Lounge Passes*';
        row.sub = '*Eligibility criteria applies';
        row.from = 0.28;
        row.to = 1;
        return [lead, row];
      },
    },
  ],
};

function pick(scenes, prefix) {
  return scenes.find((s) => String(s.beatId).indexOf(prefix.slice(0, 28)) === 0);
}

let changed = 0;
for (const [vid, edits] of Object.entries(EDITS)) {
  const mPath = path.join(ROOT, 'moments', `${vid}.json`);
  const bPath = path.join(ROOT, 'beats', `${vid}.json`);
  const mDoc = JSON.parse(fs.readFileSync(mPath, 'utf8'));
  const bDoc = JSON.parse(fs.readFileSync(bPath, 'utf8'));

  for (const e of edits) {
    const scene = pick(mDoc.scenes, e.beat);
    if (!scene) { console.error(`  !! ${vid}: no scene for ${e.beat}`); continue; }
    const mom = scene.moments.find((x) => x.id === e.moment);
    if (!mom) { console.error(`  !! ${vid}: no moment ${e.moment} in ${e.beat}`); continue; }
    if (e.super !== undefined) {
      console.log(`  ${vid} ${e.beat.slice(0, 24)} ${e.moment}\n     - ${JSON.stringify(mom.super)}\n     + ${JSON.stringify(e.super)}   (${e.note})`);
      mom.super = e.super;
      // moment 1 is the beat's headline super — keep beats in step
      if (e.moment === 'm1') {
        const beat = bDoc.beats.find((b) => String(b.beatId).indexOf(e.beat.slice(0, 28)) === 0);
        if (beat) beat.superText = e.super;
      }
      changed += 1;
    }
    if (e.sub !== undefined) mom.sub = e.sub;
  }

  for (const sp of (SPLITS[vid] || [])) {
    const scene = pick(mDoc.scenes, sp.beat);
    if (!scene) { console.error(`  !! ${vid}: no scene for split ${sp.beat}`); continue; }
    const built = sp.build(scene.moments);
    console.log(`  ${vid} ${sp.beat.slice(0, 24)} SPLIT ${scene.moments.length} -> ${built.length} moments   (${sp.note})`);
    scene.moments = built;
    const beat = bDoc.beats.find((b) => String(b.beatId).indexOf(sp.beat.slice(0, 28)) === 0);
    if (beat) beat.superText = built[0].super;
    changed += 1;
  }

  if (!dry) {
    fs.writeFileSync(mPath, JSON.stringify(mDoc, null, 1) + '\n');
    fs.writeFileSync(bPath, JSON.stringify(bDoc, null, 1) + '\n');
  }
}
console.log(`\n${dry ? '[dry] ' : ''}${changed} super edits applied`);
