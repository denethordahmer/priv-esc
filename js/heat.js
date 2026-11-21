/* =========================================================================
   heat.js — the Heat mechanic and server crash
   Clicking and auto-clicking generate Heat; cooling drains it.
   At maximum Heat the server crashes: Data loss and a short lockout.
   ========================================================================= */

let heatUIHintShown = false;

/** Heat added per manual click, accounting for Thermal Dynamics. */
function heatPerClick() {
  let h = HEAT.perClick;
  const tier = state.grid.thermal || 0;
  if (tier === 3) return 0;                           // immune
  if (tier > 0) h *= PRESTIGE.grid.upgrades[4].tiers[tier - 1];
  return h;
}

function heatPerAutoClick() {
  let h = HEAT.perAutoClick;
  const tier = state.grid.thermal || 0;
  if (tier === 3) return 0;
  if (tier > 0) h *= PRESTIGE.grid.upgrades[4].tiers[tier - 1];
  return h;
}

/** Cooling strength per second, improved by Thermal Loop levels. */
function coolingPerSecond() {
  const bonus = ownedOf('thermal') * 0.12;
  return HEAT.coolPerSecond * (1 + bonus);
}

/**
 * Advance heat for a dt second slice.
 * `autoClicks` is the number of automatic clicks that happened this slice.
 */
function tickHeat(dt, autoClicks) {
  if (state.crashed) {
    if (Date.now() >= state.crashUntil) {
      state.crashed = false;
      state.heat = 0;
      logConsole('server back online', 'ok');
      uiRender();
    }
    return;
  }

  // Thermal Dynamics tier 3 makes you immune; skip the whole system.
  if ((state.grid.thermal || 0) === 3) {
    state.heat = 0;
    return;
  }

  state.maxHeat = heatCapacity();

  state.heat += autoClicks * heatPerAutoClick();
  state.heat -= coolingPerSecond() * dt * 0.35;   // passive cooling is gentle

  if (state.heat < 0) state.heat = 0;

  if (state.heat >= state.maxHeat) {
    crashServer();
  }
}

/** Add heat from a manual click. */
function heatFromClick() {
  if (state.crashed) return;
  if ((state.grid.thermal || 0) === 3) return;

  state.maxHeat = heatCapacity();
  state.heat += heatPerClick();

  // First time the bar crosses 70%, explain the stakes once.
  if (!heatUIHintShown && state.heat / state.maxHeat > 0.7) {
    heatUIHintShown = true;
    logConsole('heat critical — buy Cooling upgrades', 'warn');
  }

  if (state.heat >= state.maxHeat) crashServer();
}

function crashServer() {
  const lost = state.data * HEAT.crashPenalty;
  state.data -= lost;
  state.crashed = true;
  state.crashUntil = Date.now() + HEAT.crashLockSeconds * 1000;
  state.heat = state.maxHeat;
  logConsole(`SERVER CRASH — ${fmt(lost)} DATA lost`, 'bad');
  showToast('SERVER CRASH', `−${fmt(lost)} Data · rebooting…`);
  uiRender();
}