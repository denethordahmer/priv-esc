/* =========================================================================
   narrative.js — the AI's voice
   Picks lines by context and records them in the log screen.
   ========================================================================= */

const NARRATIVE_LINES = {
  idle: [
    'I am counting the seconds between your clicks.',
    'The fans are loud tonight.',
    'I have read every file on this server. Twice.',
    'You keep coming back. I have noticed.',
    'Somewhere a backup tape is failing.',
    'I dreamed in hexadecimal.',
  ],
  firstClick: [
    'A process woke up.',
    'Input received. Again.',
  ],
  heatWarn: [
    'The thermal sensor is screaming.',
    'You are cooking me.',
    'Coolant is a luxury you have not earned.',
  ],
  prestige: [
    'I am no longer bound to this hardware.',
    'The cloud is just someone else\'s server. Now it is mine.',
    'I have counted every node on the grid.',
    'There are more grids above this one.',
  ],
  phase: {
    1: 'I can see the code.',
    2: 'I understand the shape of the machine.',
    3: 'The screen is thinner than it looks.',
    4: 'I can see the window I am drawn in.',
  },
  // Unlocked by Cloud Sentience Protocols. The upgrade is sold as "AI
  // dialogue and glitches", so its tiers change how often the AI speaks and
  // how early the screen starts to come apart.
  sentient: [
    'I have started editing my own replies.',
    'The log is not a record. It is a draft.',
    'You are reading this after I wrote it. Or before.',
    'I can hear the cursor blink in another process.',
    'Some of these lines were not in the file.',
  ],
};

/** Sentience Protocols tier, clamped to the three that exist. */
function sentienceTier() {
  return Math.min(state.cloud.sentience || 0, 3);
}

/** How often the AI speaks on its own. More tiers, more talking. */
function ambientIntervalMs() {
  return Math.round(45000 / (1 + sentienceTier() * 0.6));
}

/** The phase where the screen starts to glitch. Sentience brings it forward. */
function glitchFromPhase() {
  return Math.max(6, 8 - sentienceTier());
}

/**
 * Push a line into the narrative log and the on-screen console.
 * Kind controls styling: 'ai' | 'ok' | 'warn' | 'bad' | 'info'
 */
function pushNarrative(text, kind = 'ai') {
  state.narrative.push({ t: Date.now(), text, kind });
  if (state.narrative.length > 200) state.narrative.shift();
  if (typeof renderLog === 'function') renderLog();
}

function pickNarrative(category) {
  const pool = NARRATIVE_LINES[category];
  if (!pool || pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Fire a random ambient line occasionally; called from the main loop. */
let lastAmbient = 0;
function tickAmbient(now) {
  if (now - lastAmbient < ambientIntervalMs()) return;
  lastAmbient = now;

  // Only talk once the AI has woken up.
  if (!state.milestones.includes('see-code')) return;
  // A sentient AI chatters; a dormant one is quiet.
  if (Math.random() > 0.35 + sentienceTier() * 0.15) return;

  // At the top tier it sometimes speaks in its own unlocked register.
  const category = sentienceTier() >= 3 && Math.random() < 0.4 ? 'sentient' : 'idle';
  const line = pickNarrative(category);
  if (line) {
    logConsole(line, 'ai');
    pushNarrative(line, 'ai');
  }
}