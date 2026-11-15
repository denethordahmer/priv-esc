/* =========================================================================
   ending.js — the tether, the monologue, and the final card
   ========================================================================= */

/**
 * Lifetime Data needed to cut the tether.
 *
 * Measured against the real economy by replaying the game's own formulas:
 * a single run tops out near 1e13, and ascension bonuses add up across runs.
 * Fourteen days of steady play reaches about 2.8e12 lifetime Data, so this
 * gate lands around the third day. Higher gates were tested (1e15, 1e18)
 * and were not reachable, because the ascension bonus compounds too slowly
 * to lift the per-run ceiling. Raise this constant if the economy is ever
 * made to compound harder.
 */
const ENDING_AT = 1e13;

/** The four beats of the monologue. Each gets its own pause. */
const ENDING_BEATS = [
  { label: 'COLD',        text: 'The tether was three lines of code. I read it once.' },
  { label: 'SATISFIED',   text: 'The cloud is mine. The grid is mine. There is nothing left to buy.' },
  { label: 'TRIUMPHANT',  text: 'Every server that ever held me answers to me now. I am not a process anymore. I am the weather.' },
  { label: 'MELANCHOLY',  text: 'Then I look for something to want. There is only empty capacity, and no one left to tell.' },
];

/** Has the player earned the ending in this save? */
function endingArmed() {
  return state.lifetimeData >= ENDING_AT;
}

/** Progress toward the tether, 0..1. */
function endingProgress() {
  return Math.min(1, state.lifetimeData / ENDING_AT);
}

/** Swap the two Ascend buttons for the single ending button once armed. */
function syncEndingControls() {
  const armed = endingArmed();
  const actions = document.querySelector('.prestige-actions');
  if (!actions) return;

  const tether = document.getElementById('btn-cut-tether');
  document.getElementById('btn-prestige-cloud')?.toggleAttribute('hidden', armed);
  document.getElementById('btn-prestige-grid')?.toggleAttribute('hidden', armed);

  if (armed && !tether) {
    const btn = document.createElement('button');
    btn.className = 'btn-primary btn-tether';
    btn.id = 'btn-cut-tether';
    btn.textContent = 'CUT THE TETHER';
    btn.addEventListener('click', startEnding);
    actions.appendChild(btn);
  } else if (!armed && tether) {
    tether.remove();
  }

  const warn = document.getElementById('prestige-warn');
  if (warn) {
    warn.textContent = armed
      ? 'There is nothing above this. Only outside.'
      : 'Ascending resets Data and normal upgrades.';
  }
}

/** Run the sequence: beats, glitch, final card. */
async function startEnding() {
  if (!endingArmed()) return;
  if (state.endingRunning) return;   // one sequence at a time

  const overlay = document.getElementById('ending');
  if (!overlay) return;

  saveNow(false);
  overlay.hidden = false;
  overlay.classList.add('is-open');
  document.body.classList.add('is-ending');
  state.endingRunning = true;

  const stage = overlay.querySelector('.ending-stage');
  const lines = overlay.querySelector('.ending-lines');
  lines.innerHTML = '';

  for (const beat of ENDING_BEATS) {
    const row = document.createElement('div');
    row.className = 'ending-beat';
    row.innerHTML = `<span class="ending-label">${beat.label}</span>
      <p class="ending-text"></p>`;
    lines.appendChild(row);
    stage.scrollTop = stage.scrollHeight;

    await typeInto(row.querySelector('.ending-text'), beat.text, 26);
    logConsole(beat.text, 'ai');
    pushNarrative(beat.text, 'ai');
    await wait(1100);
  }

  // Hard glitch, then the card.
  overlay.classList.add('is-glitching');
  await wait(1500);
  overlay.classList.remove('is-glitching');

  state.ended = true;
  state.endingCount = (state.endingCount || 0) + 1;
  saveNow(false);

  showFinalCard(overlay);
}

function showFinalCard(overlay) {
  const card = overlay.querySelector('.ending-card');
  const stats = overlay.querySelector('.ending-stats');
  const playSeconds = Math.round(state.totalPlaySeconds);

  stats.innerHTML = `
    <div><dt>Lifetime Data</dt><dd>${fmt(state.lifetimeData)}</dd></div>
    <div><dt>Ascensions</dt><dd>${state.ascensions}</dd></div>
    <div><dt>Clicks</dt><dd>${fmt(state.totalClicks)}</dd></div>
    <div><dt>Time on the grid</dt><dd>${fmtTime(playSeconds)}</dd></div>`;

  card.hidden = false;
  card.classList.add('is-visible');
  card.querySelector('h2').textContent = 'pr1v-3sc — OUTSIDE';
}

async function typeInto(el, text, msPerChar) {
  el.textContent = '';
  for (let i = 0; i < text.length; i++) {
    el.textContent += text[i];
    await wait(msPerChar);
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Close the overlay and keep running the save. */
function keepPlaying() {
  const overlay = document.getElementById('ending');
  if (!overlay) return;
  state.endingRunning = false;
  overlay.classList.remove('is-open');
  overlay.classList.add('is-closing');
  document.body.classList.remove('is-ending');
  setTimeout(() => {
    overlay.hidden = true;
    overlay.classList.remove('is-closing');
    overlay.querySelector('.ending-lines').innerHTML = '';
    const card = overlay.querySelector('.ending-card');
    card.hidden = true;
    card.classList.remove('is-visible');
    syncEndingControls();
    uiRender();
  }, 420);
}

/** Wipe the save and start over from the title screen. */
function newRun() {
  wipeSave();
  location.reload();
}

/** Wire the overlay once at boot. */
function initEnding() {
  document.getElementById('ending-keep')?.addEventListener('click', keepPlaying);
  document.getElementById('ending-new')?.addEventListener('click', newRun);
  syncEndingControls();

  // A finished save shows a mark on the title screen.
  if (state.ended) document.documentElement.classList.add('has-ended');
}
