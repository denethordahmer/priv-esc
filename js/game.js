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

  const close = () => { modal.hidden = true; };
  document.getElementById('offline-close').addEventListener('click', close, { once: true });
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); }, { once: true });
}

/** Fill in things that only need doing once. */
function buildStaticChrome() {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => setScreen(btn.dataset.screen));
  });

  document.getElementById('btn-prestige-cloud')?.addEventListener('click', () => {
    if (!canAscend()) return;
    const ok = window.confirm(
      `Ascend into the Cloud?\n\nYou will gain ${pendingExabytes()} Exabytes.\nData and normal upgrades reset.`
    );
    if (ok) ascend('cloud');
  });

  document.getElementById('btn-prestige-grid')?.addEventListener('click', () => {
    if (!canAscend()) return;
    const ok = window.confirm(
      `Seize the Grid?\n\nYou will gain ${pendingExabytes()} Grid Nodes.\nData and normal upgrades reset.`
    );
    if (ok) ascend('grid');
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
    showTitleScreen();
    initTitleControls(() => boot());
  });
});

// Expose a few internals for debugging from the console.
window.privEsc = { state, UNIT_REGISTRY, buyUnit, unitCost };