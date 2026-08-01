#!/usr/bin/env node
/**
 * apply-pictogram-map.cjs — stamp branded pictogram names onto moments files.
 *
 *   node scripts/apply-pictogram-map.cjs <map.json> <moments/*.json ...> [--dry]
 *
 * Walks every moment and, wherever it finds a `glyph`, resolves it through the
 * map to a bank pictogram and writes it alongside as `picto`. The original
 * `glyph` is deliberately LEFT IN PLACE: it is the documented fallback if a
 * pictogram is ever missing from the project, and it keeps the moments file
 * readable as intent ("this is a coin") rather than as an asset filename.
 *
 * Resolution order for each glyph occurrence:
 *   1. map[glyph][<label of the object carrying the glyph>]
 *   2. map[glyph]._default
 *   3. nothing — leave the native glyph alone
 */

const fs = require('fs');

function resolve(map, glyph, label) {
  const entry = map[glyph];
  if (!entry) return null;
  if (label && Object.prototype.hasOwnProperty.call(entry, label)) return entry[label];
  return entry._default || null;
}

function walk(node, map, stats) {
  if (Array.isArray(node)) {
    node.forEach((n) => walk(n, map, stats));
    return;
  }
  if (!node || typeof node !== 'object') return;

  if (typeof node.glyph === 'string') {
    const label = typeof node.label === 'string' ? node.label : null;
    const picto = resolve(map, node.glyph, label);
    if (picto) {
      node.picto = picto;
      stats.mapped += 1;
      stats.pairs[`${node.glyph}${label ? ` [${label.replace(/\r/g, ' ')}]` : ''} -> ${picto}`] =
        (stats.pairs[`${node.glyph}${label ? ` [${label.replace(/\r/g, ' ')}]` : ''} -> ${picto}`] || 0) + 1;
    } else {
      stats.skipped += 1;
      stats.unmapped[node.glyph] = (stats.unmapped[node.glyph] || 0) + 1;
    }
  }

  for (const k of Object.keys(node)) {
    if (k === 'glyph' || k === 'picto') continue;
    walk(node[k], map, stats);
  }
}

function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const files = args.filter((a) => !a.startsWith('--'));
  if (files.length < 2) {
    console.error('usage: apply-pictogram-map.cjs <map.json> <moments.json ...> [--dry]');
    process.exit(2);
  }
  const map = JSON.parse(fs.readFileSync(files[0], 'utf8'));
  const total = { mapped: 0, skipped: 0 };

  for (const f of files.slice(1)) {
    const doc = JSON.parse(fs.readFileSync(f, 'utf8'));
    const stats = { mapped: 0, skipped: 0, pairs: {}, unmapped: {} };
    walk(doc.scenes || [], map, stats);
    total.mapped += stats.mapped;
    total.skipped += stats.skipped;
    if (!dry) fs.writeFileSync(f, JSON.stringify(doc, null, 1) + '\n');
    const un = Object.keys(stats.unmapped);
    console.log(
      `${dry ? '[dry] ' : ''}${f.split('/').pop()}: ${stats.mapped} mapped, ${stats.skipped} left native` +
        (un.length ? ` (${un.join(', ')})` : '')
    );
  }
  console.log(`\ntotal: ${total.mapped} pictograms stamped, ${total.skipped} left as native glyph art`);
}

main();
