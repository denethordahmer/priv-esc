/* =========================================================================
   save.js — LocalStorage persistence, auto-save, offline progress
   ========================================================================= */

const SAVE_KEY = 'priv-esc:save:v3';

/* ----------------------------- serialise -------------------------------- */

function serialise() {
  return JSON.stringify({
    v: SAVE_VERSION,
    d: state.data,
    t: state.totalData,
    lt: state.lifetimeData,
    ex: state.exabytes,
    gn: state.gridNodes,
    es: state.escapes,
    eu: state.escapeUnlocked === true,
    ll: state.lifetimeLevels || 0,
    u: state.upgrades,
    h: state.heat,
    a: state.ascensions,
    c: state.cloud,
    g: state.grid,
    ph: state.phase,
    ms: state.milestones,
    ed: state.ended,
    ec: state.endingCount,
    nl: state.narrative.slice(-200),
    sa: state.startedAt,
    tls: state.totalPlaySeconds,
    tcl: state.totalClicks,
    st: state.settings,
  });
}

/* ---------------------------- deserialise ------------------------------- */

function loadState(raw) {
  let d;
  try {
    d = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'Save file is not valid JSON.' };
  }
  if (!d || typeof d !== 'object') return { ok: false, reason: 'Save file is empty.' };

  // Merge known fields. Unknown keys are ignored, missing keys get defaults.
  const base = freshState();
  state.data = num(d.d, base.data);
  state.totalData = num(d.t, base.totalData);
  state.lifetimeData = num(d.lt, base.lifetimeData);
  state.exabytes = num(d.ex, 0);
  state.gridNodes = num(d.gn, 0);
  state.escapes = Math.max(0, Math.floor(num(d.es, 0)));
  state.escapeUnlocked = d.eu === true || state.escapes > 0;
  state.lifetimeLevels = Math.max(0, Math.floor(num(d.ll, 0)));
  state.heat = num(d.h, 0);
  state.ascensions = num(d.a, 0);
  state.phase = num(d.ph, 0);
  state.startedAt = num(d.sa, Date.now());
  state.totalPlaySeconds = num(d.tls, 0);
  state.totalClicks = num(d.tcl, 0);

  // Upgrades: only accept keys that exist in this build.
  state.upgrades = freshUpgrades();
  if (d.u && typeof d.u === 'object') {
    Object.keys(d.u).forEach((k) => {
      if (k in state.upgrades) state.upgrades[k] = Math.max(0, Math.floor(num(d.u[k], 0)));
    });
  }

  state.cloud = sanitisePrestigeTiers(d.c, PRESTIGE.cloud);
  state.grid = sanitisePrestigeTiers(d.g, PRESTIGE.grid);
  state.milestones = Array.isArray(d.ms) ? d.ms.filter((m) => typeof m === 'string') : [];
  state.ended = d.ed === true;
  state.endingCount = Math.max(0, Math.floor(num(d.ec, 0)));
  state.narrative = Array.isArray(d.nl) ? d.nl.slice(-200) : [];
  state.settings = Object.assign(base.settings, d.st && typeof d.st === 'object' ? d.st : {});

  // Older saves have no volume. Clamp whatever arrives so a hand-edited save
  // cannot set the music to 500% or NaN.
  const vol = Number(state.settings.musicVolume);
  state.settings.musicVolume = Number.isFinite(vol)
    ? Math.max(0, Math.min(100, Math.round(vol)))
    : DEFAULT_VOLUME;

  // A chosen track is a name from the playlist; anything else means shuffle.
  if (typeof state.settings.musicTrack !== 'string' || !state.settings.musicTrack) {
    state.settings.musicTrack = null;
  }

  state.maxHeat = heatCapacity();
  return { ok: true };
}

function sanitisePrestigeTiers(raw, path) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  path.upgrades.forEach((up) => {
    const t = Math.floor(num(raw[up.id], 0));
    if (up.repeat) {
      if (t >= 1) out[up.id] = t;      // repeatable upgrades have no ceiling
      return;
    }
    if (t >= 1 && t <= 3) out[up.id] = t;
  });
  return out;
}

function num(v, fallback) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

/* ------------------------------ saving ---------------------------------- */

let saveStatusTimer = null;

function saveNow(showStatus = false) {
  try {
    localStorage.setItem(SAVE_KEY, serialise());
    state.lastSaveAt = Date.now();
    if (showStatus) setSaveStatus('Saved just now.');
    return true;
  } catch (err) {
    setSaveStatus('Save failed: storage is full or blocked.');
    console.error('save failed', err);
    return false;
  }
}

function setSaveStatus(msg) {
  const el = document.getElementById('save-status');
  if (!el) return;
  el.textContent = msg;
  clearTimeout(saveStatusTimer);
  saveStatusTimer = setTimeout(() => { el.textContent = '—'; }, 4000);
}

function wipeSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch { /* storage may be blocked; the reload still resets in-memory state */ }
}

/* --------------------------- offline progress --------------------------- */

/**
 * Add Data produced while the tab was closed.
 *
 * An idle game's clock is wall time, so offline is the main way progress
 * happens: the player checks in, spends, and leaves. The cap is 24 hours by
 * default (Cloud Predictive Routing raises it to 36/48/72), and every Escape
 * Charge adds 5% to the efficiency, so long absences keep paying off as the
 * ladder climbs.
 */
function applyOfflineProgress() {
  const elapsedMs = Date.now() - state.lastTick;
  const elapsedSec = Math.max(0, elapsedMs / 1000);
  if (elapsedSec < 30) return null;

  const routingTier = state.cloud.routing || 0;
  const capHours = routingTier > 0 ? PRESTIGE.cloud.upgrades[2].tiers[routingTier - 1] : 24;
  const cappedSec = Math.min(elapsedSec, capHours * 3600);

  let rate = dataPerSecond();

  // Grid Synthetic Labor controls offline efficiency (75/100/150%).
  const laborTier = state.grid.labor || 0;
  const baseEfficiency = laborTier > 0 ? PRESTIGE.grid.upgrades[2].tiers[laborTier - 1] : 0.75;
  const efficiency = baseEfficiency + (state.escapes || 0) * ESCAPE_EFFICIENCY;

  const earned = rate * cappedSec * efficiency;
  if (earned <= 0) return null;

  state.data += earned;
  state.totalData += earned;
  state.lifetimeData += earned;

  return { seconds: cappedSec, actualSeconds: elapsedSec, earned };
}

/* ------------------------------ auto-save ------------------------------- */

let autoSaveAccumulator = 0;

function tickAutoSave(dt) {
  autoSaveAccumulator += dt;
  if (autoSaveAccumulator >= state.settings.autoSaveSeconds) {
    autoSaveAccumulator = 0;
    saveNow(false);
  }
}

/* --------------------------- export / import ---------------------------- */

async function exportSave() {
  const text = btoa(unescape(encodeURIComponent(serialise())));
  try {
    await navigator.clipboard.writeText(text);
    setSaveStatus('Save copied to clipboard.');
  } catch {
    // Fallback for browsers that block clipboard writes.
    window.prompt('Copy this save text:', text);
  }
}

async function importSave() {
  let text;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    text = window.prompt('Paste your save text:') || '';
  }
  text = text.trim();
  if (!text) return;

  let decoded;
  try {
    decoded = decodeURIComponent(escape(atob(text)));
  } catch {
    setSaveStatus('That does not look like an exported save.');
    return;
  }

  const result = loadState(decoded);
  if (!result.ok) {
    setSaveStatus(result.reason);
    return;
  }
  saveNow(false);
  setSaveStatus('Save imported. Reloading…');
  setTimeout(() => location.reload(), 700);
}