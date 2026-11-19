#!/usr/bin/env node
/* =========================================================================
   tools/music-manifest.js — write music/manifest.json from the folder

   The game cannot list a folder, so this writes the list once, at build time,
   with everything the settings panel needs: the file, the title and the
   length.

   Naming rule, so the folder order is also the playing order:

     00 PRIV ESC.mp3          the title theme, looped on the title screen
     01 Server Lullaby.mp3    first in-game track
     02 Boot Loop.mp3         second, and so on

   A two digit number, a space, then the title. The title is what the game
   shows; the number is what decides the order.

   Run it after adding or renaming tracks:
     node tools/music-manifest.js
   ========================================================================= */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MUSIC = path.join(ROOT, 'music');
const OUT = path.join(MUSIC, 'manifest.json');
const PATTERN = /^(\d{2})\s+(.+)\.mp3$/i;

/* ---- length, read from the MP3 itself -------------------------------- */

const BITRATES = {
  // [version][layer] -> kbps table, indexed by the 4 bit rate field
  1: {
    1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
    2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
    3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  },
  2: {
    1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  },
};
const SAMPLE_RATES = {
  1: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  25: [11025, 12000, 8000],
};

/** Seconds, or 0 when the file cannot be read as MPEG audio. */
function mp3Duration(file) {
  const buf = fs.readFileSync(file);

  let start = 0;
  if (buf.slice(0, 3).toString('latin1') === 'ID3' && buf.length > 10) {
    const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) |
      ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    start = 10 + size;
  }

  // Skip anything that is not a frame sync, such as leftover padding.
  while (start + 4 < buf.length &&
    !(buf[start] === 0xff && (buf[start + 1] & 0xe0) === 0xe0)) {
    start += 1;
  }
  if (start + 4 >= buf.length) return 0;

  const b1 = buf[start + 1];
  const b2 = buf[start + 2];
  const b3 = buf[start + 3];

  const versionBits = (b1 >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
  const version = versionBits === 3 ? 1 : versionBits === 2 ? 2 : versionBits === 0 ? 25 : 0;
  const layerBits = (b1 >> 1) & 3; // 3 = I, 2 = II, 1 = III
  const layer = layerBits === 3 ? 1 : layerBits === 2 ? 2 : layerBits === 1 ? 3 : 0;
  if (!version || !layer) return 0;

  const rateIndex = (b2 >> 4) & 15;
  const rateTable = version === 1 ? BITRATES[1] : BITRATES[2];
  const kbps = (rateTable[layer] || [])[rateIndex] || 0;
  const sampleRate = (SAMPLE_RATES[version] || [])[(b2 >> 2) & 3] || 0;
  if (!kbps || !sampleRate) return 0;

  const padding = (b2 >> 1) & 1;
  const frameLength = layer === 1
    ? Math.floor((12 * kbps * 1000 / sampleRate + padding) * 4)
    : Math.floor((layer === 2 ? 144 : 144) * kbps * 1000 / sampleRate + padding);

  // A Xing/Info header carries the exact frame count, which is right for VBR.
  const markerAt = start + (version === 1 && layer !== 1 ? 36 : 21);
  const marker = buf.slice(markerAt, markerAt + 4).toString('latin1');
  if (marker === 'Xing' || marker === 'Info') {
    const flags = buf.readUInt32BE(markerAt + 4);
    if (flags & 1) {
      const frames = buf.readUInt32BE(markerAt + 8);
      const samplesPerFrame = layer === 1 ? 384 : version === 1 ? 1152 : 576;
      return Math.round((frames * samplesPerFrame) / sampleRate);
    }
  }

  // Otherwise assume the first frame's bitrate holds for the whole file.
  const audioBytes = buf.length - start;
  return Math.round((audioBytes * 8) / (kbps * 1000));
}

/** Seconds as m:ss, which is what the settings list shows. */
function clock(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

/* ---- build ------------------------------------------------------------ */

if (!fs.existsSync(MUSIC)) {
  console.error('No music/ folder. Nothing to do.');
  process.exit(1);
}

const files = fs.readdirSync(MUSIC);
const numbered = [];
const strays = [];

for (const file of files) {
  const match = file.match(PATTERN);
  if (match) numbered.push({ file, num: Number(match[1]), name: match[2].trim() });
  else if (/\.mp3$/i.test(file)) strays.push(file);
}

numbered.sort((a, b) => a.num - b.num);

// A repeated number would make the order depend on the folder listing, which
// is filesystem specific. Say so instead of guessing.
const seen = new Set();
for (const entry of numbered) {
  if (seen.has(entry.num)) {
    console.error(`Two tracks share the number ${entry.num}: ${entry.file}`);
    process.exit(1);
  }
  seen.add(entry.num);
}

const withLength = (entry) => {
  const seconds = mp3Duration(path.join(MUSIC, entry.file));
  return { file: entry.file, name: entry.name, seconds, length: clock(seconds) };
};

const titleEntry = numbered.find((e) => e.num === 0) || null;
const tracks = numbered.filter((e) => e.num !== 0).map(withLength);

const manifest = {
  title: titleEntry ? withLength(titleEntry) : null,
  tracks,
};

fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2) + '\n');

console.log('Wrote music/manifest.json');
console.log(`  title:  ${titleEntry ? `${titleEntry.file} (${clock(mp3Duration(path.join(MUSIC, titleEntry.file)))})` : 'none'}`);
for (const t of tracks) console.log(`  ${t.length}  ${t.name}`);

if (strays.length) {
  console.log('');
  console.log('Not used by the game, because the name does not match "NN Title.mp3":');
  strays.forEach((f) => console.log(`  ${f}`));
}
