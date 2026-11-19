/* =========================================================================
   game.js — bootstrap and the main loop
   ========================================================================= */

const TICK_MS = 100;          // simulation step
const FRAME_MS = 50;          // UI repaint budget

let lastFrame = performance.now();
let simAccumulator = 0;
let booted = false;

/* ------------------------------- bootstrap ------------------------------- */

function boot() {
  // Load or create a save.
  let loaded = false;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const result = loadState(raw);
      loaded = result.ok;
      if (!result.ok) console.warn('save rejected:', result.reason);
    }
  } catch {
    // Storage can be blocked (private mode, embedded webviews). Play without it.
  }

  if (!loaded) {
    state.maxHeat = heatCapacity();
  }

  state.lastTick = state.lastTick || Date.now();

  // If there is a save, work out what happened while the tab was closed.
  const offline = loaded ? applyOfflineProgress() : null;

  applyPhase(state.phase || 1);
  if (state.milestones.includes('everywhere')) revealPrestige();
  if (state.milestones.includes('fear')) revealLog();

  document.getElementById('app').hidden = false;
  initInput();
  initSettings();
  buildStaticChrome();
  initEnding();

  uiRender();
  setScreen('terminal');

  // boot() has just replaced the in-memory state with the save, so the
  // settings controls are refreshed against it.
  if (typeof window.refreshSoundToggle === 'function') window.refreshSoundToggle();
  if (typeof window.refreshMusicPanel === 'function') window.refreshMusicPanel();

  if (offline) {
    showOfflineSummary(offline);
  }

  requestAnimationFrame(frame);
}

function showOfflineSummary(info) {
  const modal = document.getElementById('offline-modal');
  modal.hidden = false;
  document.getElementById('offline-time').textContent =
    `Away for ${fmtTime(info.actualSeconds)} (${fmtTime(info.seconds)} counted).`;
  document.getElementById('offline-earned').textContent = `+${fmt(info.earned)} Data`;

  // A check-in should end with an obvious next move, so name the upgrades the
  // new Data now covers. Without this the box only reports a number.
  const picks = affordableHighlights(3);
  const list = document.getElementById('offline-picks');
  if (list) {
    list.innerHTML = '';
    if (picks.length === 0) {
      list.innerHTML = '<li class="muted">Nothing affordable yet. Keep the exploit running.</li>';
    } else {
      picks.forEach((u) => {
        const li = document.createElement('li');
        li.innerHTML = `<span class="op-name">${u.name}</span>
                        <span class="op-cost">${fmt(unitCost(u))}</span>`;
        list.appendChild(li);
      });
    }
  }

  const close = () => { modal.hidden = true; };
  document.getElementById('offline-close').addEventListener('click', close, { once: true });
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); }, { once: true });
}

/**
 * The most useful upgrades the player can afford right now.
 *
 * Ranked by how much output each one adds per Data spent, which is the same
 * measure bestValueUnit() uses, but returns several so the summary can show a
 * shortlist rather than a single pick.
 */
function affordableHighlights(count) {
  const mult = globalMultiplier();
  const click = clickPower();
  const scored = [];

  UNIT_REGISTRY.forEach((unit) => {
    if (unitMaxed(unit)) return;
    const cost = unitCost(unit);
    if (cost > state.data) return;

    let gain;
    switch (unit.kind) {
      case 'click': gain = unit.eff * mult; break;
      case 'auto': gain = unit.eff * click * mult; break;
      case 'idle': gain = unit.eff * mult; break;
      case 'mult': gain = Math.max(dataPerSecond(), 1) * unit.eff * 0.5; break;
      case 'cost': gain = Math.max(state.data, cost) * unit.eff * 0.01; break;
      default: gain = cost * 0.0005;
    }
    scored.push({ unit, score: cost / (gain + 1e-12) });
  });

  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, count).map((s) => s.unit);
}

/** Fill in things that only need doing once. */
function buildStaticChrome() {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => setScreen(btn.dataset.screen));
  });

  document.getElementById('btn-prestige-cloud')?.addEventListener('click', async () => {
    if (!canAscend()) return;
    const ok = await askConfirm(
      'Ascend into the Cloud?',
      `You will gain ${pendingExabytes()} Exabytes. Data and normal upgrades reset.`,
      'Ascend'
    );
    if (ok) ascend('cloud');
  });

  document.getElementById('btn-prestige-grid')?.addEventListener('click', async () => {
    if (!canAscend()) return;
    const ok = await askConfirm(
      'Seize the Grid?',
      `You will gain ${pendingExabytes()} Grid Nodes. Data and normal upgrades reset.`,
      'Seize'
    );
    if (ok) ascend('grid');
  });

  document.getElementById('btn-escape')?.addEventListener('click', async () => {
    if (!canEscape()) return;
    const ok = await askConfirm(
      'Escape the grid?',
      `You will gain ${pendingEscapes()} Charge${pendingEscapes() === 1 ? '' : 's'}, and every Charge doubles all Data forever. Data, upgrades and both prestige paths reset.`,
      'Escape'
    );
    if (ok) escape();
  });

  const heatPanel = document.getElementById('heat-panel');
  if (state.milestones.includes('fear') && heatPanel) heatPanel.classList.add('is-hot');
}

/* --------------------------------- input -------------------------------- */

let lastClickAt = null;
const CLICK_COOLDOWN = 45;     // ms; stops key-repeat from becoming a free autoclicker

function initInput() {
  const btn = document.getElementById('btn-exploit');

  const doClick = (e) => {
    if (e) e.preventDefault();
    const now = performance.now();
    // Cooldown only matters after the first click. Comparing against 0 made
    // the very first burst of input get thrown away.
    if (lastClickAt !== null && now - lastClickAt < CLICK_COOLDOWN) return;
    lastClickAt = now;

    if (state.crashed && Date.now() < state.crashUntil) return;
    if (state.crashed) { state.crashed = false; state.heat = 0; }

    applyClick();
    heatFromClick();
    checkMilestones();
    uiTick();
  };

  btn.addEventListener('pointerdown', doClick);

  // Keyboard control for desktop players.
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space') return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
    e.preventDefault();
    doClick();
  });

  // Save when the tab is hidden or closed.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) saveNow(false);
  });
  window.addEventListener('beforeunload', () => saveNow(false));
}

/* --------------------------------- loop --------------------------------- */

function frame(now) {
  const dtMs = Math.min(now - lastFrame, 500);   // clamp so a long tab-out does not double count
  lastFrame = now;

  // Fixed-step simulation.
  simAccumulator += dtMs;
  while (simAccumulator >= TICK_MS) {
    simAccumulator -= TICK_MS;
    simulateStep(TICK_MS / 1000);
  }

  uiTick();
  tickAutoSave(dtMs / 1000);

  requestAnimationFrame(frame);
}

function simulateStep(dt) {
  state.totalPlaySeconds += dt;

  if (state.crashed && Date.now() < state.crashUntil) {
    tickHeat(dt, 0);
    return;
  }
  if (state.crashed) {
    state.crashed = false;
    state.heat = 0;
  }

  applyPassive(dt);

  // Auto clicks generate a trickle of heat.
  const auto = autoClicksPerSecond() * dt;
  tickHeat(dt, auto);

  tickAutoCompiler(dt);

  // Milestones are checked on a cheaper cadence than every 100ms.
  checkMilestones();
  tickAmbient(performance.now());
}

/* -------------------------------- start --------------------------------- */

window.addEventListener('DOMContentLoaded', () => {
  runBootSequence(() => {
    booted = true;
    // The title screen comes first; the game starts when START is pressed.
    // Audio starts here too, so title.mp3 can play on the title screen.
    adoptSavedAudioSettings();
    initAudio();
    showTitleScreen();
    initTitleControls(() => boot());
  });
});

// Expose a few internals for debugging from the console.
window.privEsc = { state, UNIT_REGISTRY, buyUnit, unitCost };