#!/usr/bin/env node
/* =========================================================================
   tools/music-manifest.js — write music/manifest.json from the folder

   The game cannot list a folder, and probing for files that are not there
   logs a 404 for each miss. This writes the list once, at build time, so the
   game reads one small file instead.

   Run it after adding or renaming tracks:
     node tools/music-manifest.js
   ========================================================================= */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MUSIC = path.join(ROOT, 'music');
const OUT = path.join(MUSIC, 'manifest.json');

if (!fs.existsSync(MUSIC)) {
  console.error('No music/ folder. Nothing to do.');
  process.exit(1);
}

const files = fs.readdirSync(MUSIC);

const title = files.includes('title.mp3');

// Numbered tracks, in order, stopping at the first gap so a stray track9 with
// no track8 does not jump the queue.
const tracks = [];
for (let i = 1; i <= 12; i += 1) {
  const name = `track${i}.mp3`;
  if (files.includes(name)) tracks.push(name);
  else break;
}

const manifest = { title, tracks };
fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2) + '\n');

console.log('Wrote music/manifest.json');
console.log(`  title.mp3: ${title ? 'yes' : 'no'}`);
console.log(`  tracks:    ${tracks.length ? tracks.join(', ') : 'none'}`);

// Warn about files that will never play, which is the usual naming mistake.
const known = new Set(['title.mp3', 'manifest.json', 'README.txt', ...tracks]);
const strays = files.filter((f) => !known.has(f));
if (strays.length) {
  console.log('');
  console.log('Not used by the game:');
  strays.forEach((f) => console.log(`  ${f}`));
  console.log('Tracks must be named track1.mp3, track2.mp3 ... with no gaps.');
}
