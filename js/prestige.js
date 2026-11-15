/* =========================================================================
   prestige.js — dual-path ascension
   Cloud Ascension spends Exabytes, Grid Takeover spends Grid Nodes.
   Each path upgrade has three tiers of potency.
   ========================================================================= */

/** Currency the next ascension would award, per the square-root rule. */
function pendingExabytes() {
  return prestigeCurrencyEarned(state.totalData);
}

function canAscend() {
  return state.totalData >= PRESTIGE_BASE;
}

/**
 * Perform an ascension. `path` is 'cloud' or 'grid'.
 * Resets Data and normal upgrades; keeps prestige upgrades and currencies.
 */
function ascend(path) {
  if (!canAscend()) return false;

  const earned = pendingExabytes();
  if (earned <= 0) return false;

  // Keep the other path's currency and upgrades. Only the chosen path gains.
  if (path === 'cloud') state.exabytes += earned;
  else state.gridNodes += earned;

  state.lastPrestigeCurrency = earned;
  state.ascensions += 1;

  // Reset the run.
  state.data = 0;
  state.totalData = 0;
  state.upgrades = freshUpgrades();
  state.heat = 0;
  state.crashed = false;
  state.phase = Math.max(state.phase, 1);   // never drops back to raw terminal
  state.maxHeat = heatCapacity();

  // Deep Web Cache grants starting Data on the next run.
  const cacheTier = state.cloud.cache || 0;
  if (cacheTier > 0) {
    state.data = PRESTIGE.cloud.upgrades[1].tiers[cacheTier - 1];
    state.totalData = state.data;
  }

  logConsole(`ASCENSION ${state.ascensions} — ${earned} ${path === 'cloud' ? 'Exabytes' : 'Grid Nodes'}`, 'ai');
  pushNarrative(`Ascension ${state.ascensions}. ${earned} ${path === 'cloud' ? 'Exabytes' : 'Grid Nodes'} extracted.`, 'ai');
  saveNow(false);
  uiRender();
  showToast('ASCENSION COMPLETE', `+${earned} ${path === 'cloud' ? 'Exabytes' : 'Grid Nodes'}`);
  return true;
}

/** Cost of the next tier of a prestige upgrade, or null if maxed. */
function nextPrestigeCost(pathId, upgrade) {
  const owned = pathId === 'cloud' ? (state.cloud[upgrade.id] || 0) : (state.grid[upgrade.id] || 0);
  if (owned >= 3) return null;
  return upgrade.costs[owned];
}

/** Buy the next tier of a prestige upgrade. */
function buyPrestigeTier(pathId, upgrade) {
  const owned = pathId === 'cloud' ? (state.cloud[upgrade.id] || 0) : (state.grid[upgrade.id] || 0);
  if (owned >= 3) return false;

  const cost = upgrade.costs[owned];
  const purse = pathId === 'cloud' ? state.exabytes : state.gridNodes;
  if (purse < cost) return false;

  if (pathId === 'cloud') {
    state.exabytes -= cost;
    state.cloud[upgrade.id] = owned + 1;
  } else {
    state.gridNodes -= cost;
    state.grid[upgrade.id] = owned + 1;
  }

  if (upgrade.id === 'thermal') state.maxHeat = heatCapacity();
  logConsole(`${upgrade.name} → Tier ${owned + 1}`, 'ok');
  uiRender();
  return true;
}

/** Current tier value, for display. */
function prestigeTierValue(pathId, upgrade) {
  const owned = pathId === 'cloud' ? (state.cloud[upgrade.id] || 0) : (state.grid[upgrade.id] || 0);
  if (owned === 0) return null;
  return upgrade.tiers[owned - 1];
}