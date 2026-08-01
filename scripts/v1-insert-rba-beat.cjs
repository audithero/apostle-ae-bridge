#!/usr/bin/env node
/**
 * v1-insert-rba-beat.cjs — script v2 adds a paragraph to Video 1 that was never recorded.
 *
 *   node scripts/v1-insert-rba-beat.cjs [--dry]
 *
 * The new paragraph (Reserve Bank of Australia / industry-wide interchange
 * reforms) does not go on the end of beat 1 — it goes INSIDE it. Beat 1 as
 * recorded runs three sentences:
 *
 *   [0.00 - 10.32] We're introducing a number of changes...
 *   [10.32 - 16.72] While we'll cover each change in detail...
 *   [16.72 - 27.32] The biggest change for Yello is that from 1 October...
 *                                                    ^ new paragraph belongs HERE
 *
 * So this splits beat 1 at the measured sentence boundary 16.72s, inserts a
 * silent beat for the new paragraph, and pushes everything downstream. The
 * split point is a real word boundary from the whisper pass
 * (vo/video1-vo-sentences.json), not an estimate — so when the pickup VO is
 * recorded it drops straight in with no re-cut of the existing audio.
 *
 * Writes beats + moments. Does NOT touch After Effects; the caller runs
 * applyBeatStructure then applyMoments, and splits the master's audio layer.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'briefs', 'commbank-yello');
const dry = process.argv.includes('--dry');

const SPLIT_AT = 16.72;   // measured sentence boundary inside beat 1
const NEW_DUR = 22.32;    // 53 words at Video 1's measured 142.7 wpm, frame-aligned at 25fps
const NEW_ID = 'at-the-same-time-you-might-see-chang';
const TAIL_ID = 'the-biggest-change-for-yello-is-that';

const NEW_VO =
  "At the same time you might see changes also following the Reserve Bank of Australia's announcement " +
  'of industry-wide interchange reforms, which will reshape Australian credit card marketing from ' +
  '1 October 2026. As the industry adapts to these changes, CommBank is evolving the reward and ' +
  'loyalty propositions to continue delivering value to customers.';

const TAIL_VO =
  'The biggest change for Yello is that from 1 October, we’ll be introducing CommBank Yello points, ' +
  'unlocking a whole new world of points and perks for our customers.';

const HEAD_VO =
  'We’re introducing a number of changes across the CommBank Yello and credit card programs as we ' +
  'evolve how customers are recognised and rewarded for their banking relationship. While we’ll cover ' +
  'each change in detail, they all support a simpler and more flexible rewards experience for customers.';

// ---------------------------------------------------------------- beats

const bPath = path.join(ROOT, 'beats', 'video1-vo-locked.json');
const beats = JSON.parse(fs.readFileSync(bPath, 'utf8'));
if (beats.beats.some((b) => b.beatId === NEW_ID)) {
  console.log('already inserted — nothing to do');
  process.exit(0);
}

const head = beats.beats[0];
const motion = JSON.parse(JSON.stringify(head.motion));

const newBeat = {
  id: 0,
  beatId: NEW_ID,
  sectionId: 'industry-product-context',
  vo: NEW_VO,
  superText: 'Industry-wide interchange reforms.',
  voSpokenWords: 53,
  silent: true,
  awaitingVO: true,
  stylePreset: 'listBuild',
  durationSec: NEW_DUR,
  voWindow: [SPLIT_AT, SPLIT_AT + NEW_DUR],
  transitIn: 'lateralTruck',
  motion: motion,
};

const tailBeat = {
  id: 0,
  beatId: TAIL_ID,
  sectionId: 'industry-product-context',
  vo: TAIL_VO,
  superText: 'Introducing CommBank Yello points.',
  voSpokenWords: 27,
  silent: false,
  stylePreset: 'titleCard',
  durationSec: +(head.durationSec - SPLIT_AT).toFixed(2),
  voWindow: [SPLIT_AT + NEW_DUR, head.voWindow[1] + NEW_DUR],
  transitIn: 'crane',
  motion: motion,
};

// beat 1 keeps its comp and its beatId — it just gets shorter
head.vo = HEAD_VO;
head.voSpokenWords = 48;
head.durationSec = SPLIT_AT;
head.voWindow = [0.0, SPLIT_AT];

// everything after beat 1 slides by the inserted duration
const rest = beats.beats.slice(1).map((b) => {
  b.voWindow = [+(b.voWindow[0] + NEW_DUR).toFixed(2), +(b.voWindow[1] + NEW_DUR).toFixed(2)];
  return b;
});

beats.beats = [head, newBeat, tailBeat, ...rest];
beats.beats.forEach((b, i) => { b.id = i + 1; });
beats.meta.scriptVersion = 2;
beats.meta.note =
  (beats.meta.note || '') +
  ' SCRIPT v2: beat 1 split at the measured 16.72s sentence boundary to admit the RBA/interchange' +
  ' paragraph as a silent beat (awaitingVO). Beats after it shift +' + NEW_DUR + 's; the master audio' +
  ' layer is split at the same point and its tail slipped by the same amount.';

// -------------------------------------------------------------- moments

const mPath = path.join(ROOT, 'moments', 'video1.json');
const moms = JSON.parse(fs.readFileSync(mPath, 'utf8'));

const headScene = moms.scenes[0];
// beat 1 now ends at 16.72 instead of 27.32, so its surviving moments must be
// re-expressed as fractions of the SHORTER window or they would run off the end
const oldDur = 27.32;
headScene.moments = headScene.moments
  .filter((m) => (m.voSec ? m.voSec[0] < SPLIT_AT : true))
  .map((m) => {
    if (m.voSec) {
      m.from = +(m.voSec[0] / SPLIT_AT).toFixed(4);
      m.to = +(Math.min(m.voSec[1], SPLIT_AT) / SPLIT_AT).toFixed(4);
    } else {
      m.from = +((m.from * oldDur) / SPLIT_AT).toFixed(4);
      m.to = +(Math.min((m.to * oldDur) / SPLIT_AT, 1)).toFixed(4);
    }
    return m;
  });
headScene.beatDurationSec = SPLIT_AT;
delete headScene.comp; // comp name is resolved by beatId tag; it no longer matches the text

const newScene = {
  beatId: NEW_ID,
  beatDurationSec: NEW_DUR,
  awaitingVO: true,
  moments: [
    {
      id: 'm1',
      layout: 'statement',
      picto: 'branch',
      super: 'Industry-wide interchange reforms.',
      sub: 'Announced by the Reserve Bank of Australia.',
      from: 0.0,
      to: 0.34,
    },
    {
      id: 'm2',
      layout: 'iconRow',
      super: 'Reshaping the Australian credit card market.',
      sub: 'From 1 October 2026.',
      tiles: [
        { picto: 'change', label: 'Interchange\rreforms' },
        { picto: 'CommBank Card', label: 'Credit card\rmarket' },
        { picto: 'calendar', label: 'From 1 Oct\r2026' },
      ],
      from: 0.34,
      to: 0.7,
    },
    {
      id: 'm3',
      layout: 'statement',
      picto: 'star',
      super: 'CommBank is evolving how customers are rewarded.',
      sub: 'To keep delivering value as the industry adapts.',
      from: 0.7,
      to: 1.0,
    },
  ],
};

const tailScene = {
  beatId: TAIL_ID,
  beatDurationSec: tailBeat.durationSec,
  moments: [
    {
      id: 'm1',
      layout: 'hero',
      picto: 'coin stack',
      glyph: 'coin',
      super: 'Introducing CommBank Yello points.',
      sub: 'From 1 October.',
      from: 0.0,
      to: 0.52,
    },
    {
      id: 'm2',
      layout: 'statement',
      picto: 'diamond',
      super: 'A whole new world of points and perks.',
      sub: '',
      from: 0.52,
      to: 1.0,
    },
  ],
};

moms.scenes = [headScene, newScene, tailScene, ...moms.scenes.slice(1)];
moms.meta.scriptVersion = 2;

if (!dry) {
  fs.writeFileSync(bPath, JSON.stringify(beats, null, 1) + '\n');
  fs.writeFileSync(mPath, JSON.stringify(moms, null, 1) + '\n');
}

console.log(`${dry ? '[dry] ' : ''}Video 1 restructured:`);
beats.beats.forEach((b) => {
  console.log(
    `  ${String(b.id).padStart(2)} ${b.beatId.slice(0, 36).padEnd(38)} dur=${String(b.durationSec).padStart(6)} ` +
      `win=[${b.voWindow[0]}, ${b.voWindow[1]}]${b.awaitingVO ? '   <-- AWAITING VO' : ''}`
  );
});
console.log(`\n  audio split point (comp time): ${(SPLIT_AT + (moms.meta.voOffsetSec || 0)).toFixed(2)}s, tail slips +${NEW_DUR}s`);
console.log(`  new master duration: ${(beats.beats.reduce((a, b) => a + b.durationSec, 0)).toFixed(2)}s of beats`);
