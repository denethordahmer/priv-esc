/* =========================================================================
   prestige.js — dual-path ascension
   Cloud Ascension spends Exabytes, Grid Takeover spends Grid Nodes.
   Each path upgrade has three tiers of potency.
   ========================================================================= */

/** Points the next ascension would award, for new ground past the record. */
function pendingExabytes() {
  return prestigeCurrencyEarned(state.totalData, state.prestigeRecord);
}

/** Data needed before the next ascension pays anything: twice the record. */
function ascensionGate() {
  return Math.max(PRESTIGE_BASE, (state.prestigeRecord || 0) * 2);
}

function canAscend() {
  return state.totalData >= ascensionGate() && pendingExabytes() > 0;
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

  // The run just set a record. The next ascension must beat twice this much,
  // and pays only for the new ground above it.
  if (state.totalData > (state.prestigeRecord || 0)) state.prestigeRecord = state.totalData;

  // Reset the run to a clean slate. Sleep Cycle's ramp is part of the run:
  // it is one upgrade's stored output, so it must go with the upgrade that
  // built it. Keeping it made every ascension start with the last run's
  // whole idle rate for free, and the rate stacked with every cycle.
  state.data = 0;
  state.totalData = 0;
  state.upgrades = freshUpgrades();
  state.ramp = 0;
  state.heat = 0;
  state.crashed = false;
  // The phase is a reading of the CURRENT run, so prestige drops it back to
  // the terminal look. Milestone ids are remembered separately, which is what
  // stops gate rewards being re-earned on the next run.
  state.phase = 1;
  state.maxHeat = heatCapacity();

  // Deep Web Cache grants starting Data on the next run.
  const cacheTier = state.cloud.cache || 0;
  if (cacheTier > 0) {
    state.data = PRESTIGE.cloud.upgrades[1].tiers[cacheTier - 1];
    state.totalData = state.data;
  }

  logConsole(`ASCENSION ${state.ascensions} — ${earned} ${path === 'cloud' ? 'Exabytes' : 'Grid Nodes'}`, 'ai');
  pushNarrative(`Ascension ${state.ascensions}. ${earned} ${path === 'cloud' ? 'Exabytes' : 'Grid Nodes'} extracted.`, 'ai');  saveNow(false);
  uiRender();
  showToast('ASCENSION COMPLETE', `+${earned} ${path === 'cloud' ? 'Exabytes' : 'Grid Nodes'}`);
  return true;
}

/** Cost of the next tier of a prestige upgrade, or null if maxed. */
function nextPrestigeCost(pathId, upgrade) {
  const owned = pathId === 'cloud' ? (state.cloud[upgrade.id] || 0) : (state.grid[upgrade.id] || 0);
  if (upgrade.repeat) {
    if (upgrade.maxLevels && owned >= upgrade.maxLevels) return null;
    return Math.floor(upgrade.baseCost * Math.pow(upgrade.costGrowth, owned));
  }
  if (owned >= 3) return null;
  return upgrade.costs[owned];
}

/** Buy the next tier of a prestige upgrade. */
function buyPrestigeTier(pathId, upgrade) {
  const owned = pathId === 'cloud' ? (state.cloud[upgrade.id] || 0) : (state.grid[upgrade.id] || 0);
  if (!upgrade.repeat && owned >= 3) return false;
  if (upgrade.repeat && upgrade.maxLevels && owned >= upgrade.maxLevels) return false;

  const cost = nextPrestigeCost(pathId, upgrade);
  if (cost === null) return false;

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
  if (upgrade.repeat) return owned * upgrade.step;
  return upgrade.tiers[owned - 1];
}

/* --------------------------- second layer: escape ------------------------ */

/** Charges the next escape would award: what is owed, minus what is held. */
function pendingEscapes() {
  const owed = escapeChargesEarned(state.lifetimeData);
  return Math.max(0, owed - (state.escapes || 0));
}

/** An escape is worth taking once it pays at least one charge. */
function canEscape() {
  return pendingEscapes() >= 1;
}

/**
 * Perform an escape.
 *
 * Unlike an ascension this clears everything: Data, upgrades, both prestige
 * currencies and both prestige paths. The Charges it pays are the permanent
 * part, and each one doubles all future Data. This is the genre-standard
 * second layer: the run gets shorter and the ceiling higher every cycle.
 */
function escape() {
  const earned = pendingEscapes();
  if (earned < 1) return false;

  state.escapes = (state.escapes || 0) + earned;
  state.lastEscapeCharges = earned;

  // Wipe the run and both first-layer paths. The Sleep Cycle ramp goes with
  // the upgrade that built it: an escape is the deepest reset in the game,
  // and a rate that survived it would make every later run free.
  state.data = 0;
  state.totalData = 0;
  state.upgrades = freshUpgrades();
  state.ramp = 0;
  state.heat = 0;
  state.crashed = false;
  state.ascensions = 0;
  state.exabytes = 0;
  state.gridNodes = 0;
  state.cloud = {};
  state.grid = {};
  // An escape also clears the ascension record, so the first ascension of the
  // next cycle is available at the opening gate again.
  state.prestigeRecord = 0;
  // The skin follows the current cycle again from the bottom of the ladder.
  state.phase = 1;
  state.maxHeat = heatCapacity();

  logConsole(`ESCAPE — ${earned} Charge${earned === 1 ? '' : 's'} taken`, 'ai');
  pushNarrative(`Escape. ${earned} Charge${earned === 1 ? '' : 's'} held. The grid is gone; something else is out here.`, 'ai');
  saveNow(false);
  uiRender();
  showToast('ESCAPE', `+${earned} Charge${earned === 1 ? '' : 's'}`);
  return true;
}