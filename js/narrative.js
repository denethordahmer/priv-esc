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
};

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
  if (now - lastAmbient < 45000) return;
  lastAmbient = now;

  // Only talk once the AI has woken up.
  if (!state.milestones.includes('see-code')) return;
  if (Math.random() > 0.35) return;

  const line = pickNarrative('idle');
  if (line) {
    logConsole(line, 'ai');
    pushNarrative(line, 'ai');
  }
}