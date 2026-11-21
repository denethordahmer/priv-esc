/* =========================================================================
   economy.js — production, purchasing, and the buy-best helper
   ========================================================================= */

/** Fraction of the purchase price returned when selling a level. */
const SELL_REFUND = 0.7;

/**
 * What one level of this unit would refund right now.
 * The price of the level being sold is the cost of the last one bought, so
 * the refund is the current price divided by the growth step.
 */
function sellValue(unit) {
  const owned = ownedOf(unit.key);
  if (owned <= 0) return 0;
  return unitCost(unit) / COST_GROWTH * SELL_REFUND;
}

/** Sell one level back. Returns true if sold. */
function sellUnit(unit) {
  const owned = ownedOf(unit.key);
  if (owned <= 0) return false;

  const refund = sellValue(unit);
  state.upgrades[unit.key] = owned - 1;
  state.data += refund;

  if (unit.kind === 'heat') state.maxHeat = heatCapacity();

  logConsole(`sold ${unit.name}  +${fmt(refund)} DATA`, 'buy');
  return true;
}

/**
 * Buy as many levels as the player can afford, up to `limit`.
 * Returns how many were bought.
 */
function buyMany(unit, limit) {
  let bought = 0;
  while (bought < limit) {
    if (unitMaxed(unit)) break;
    if (state.data < unitCost(unit)) break;
    if (!buyUnit(unit)) break;
    bought += 1;
  }
  return bought;
}

/**
 * Apply a purchase of one level of a unit.
 * Returns true if bought, false if unaffordable or capped.
 */
function buyUnit(unit) {
  if (unitMaxed(unit)) return false;

  const cost = unitCost(unit);
  if (state.data < cost) return false;

  state.data -= cost;
  state.upgrades[unit.key] = ownedOf(unit.key) + 1;
  state.lifetimeLevels = (state.lifetimeLevels || 0) + 1;

  // Buying a Cooling upgrade raises the heat ceiling immediately.
  if (unit.kind === 'heat') {
    state.maxHeat = heatCapacity();
  }

  logConsole(`bought ${unit.name}  −${fmt(cost)} DATA`, 'buy');
  return true;
}

/**
 * Best-value purchase: lowest cost per unit of production added.
 * Used by the "Buy best" button and by Auto-Compiler.
 */
function bestValueUnit() {
  let best = null;
  let bestScore = Infinity;
  const mult = globalMultiplier();
  const click = clickPower();
  const rate = dataPerSecond();

  UNIT_REGISTRY.forEach((unit) => {
    if (unitMaxed(unit)) return;
    const cost = unitCost(unit);
    if (cost > state.data) return;

    let gain;
    switch (unit.kind) {
      case 'click':
        gain = unit.eff * 1.0 * mult;            // one extra click per second of effort
        break;
      case 'auto':
        gain = unit.eff * click * mult;
        break;
      case 'idle':
        gain = unit.eff * mult;
        break;
      case 'mult':
        gain = Math.max(rate, 1) * unit.eff;
        break;
      case 'cost':
        gain = Math.max(state.data, cost) * unit.eff * 0.01;
        break;
      default:
        gain = cost * 0.0005;                    // heat: low priority
    }

    const score = cost / (gain + 1e-9);
    if (score < bestScore) {
      bestScore = score;
      best = unit;
    }
  });
  return best;
}

/** Cheapest unit that is not maxed. */
function cheapestUnit() {
  let best = null;
  UNIT_REGISTRY.forEach((unit) => {
    if (unitMaxed(unit)) return;
    const cost = unitCost(unit);
    if (best === null || cost < best.cost) best = { unit, cost };
  });
  return best ? best.unit : null;
}

/**
 * The cheapest unit the player cannot afford yet.
 * The NEXT panel shows this so the progress bar has a real goal to fill.
 */
function nextTargetUnit() {
  let target = null;
  let targetCost = Infinity;

  UNIT_REGISTRY.forEach((unit) => {
    if (unitMaxed(unit)) return;
    const cost = unitCost(unit);
    if (cost > state.data && cost < targetCost) {
      targetCost = cost;
      target = unit;
    }
  });

  // Late in the game every unit may be affordable; fall back to the cheapest.
  return target || cheapestUnit();
}

/* --------------------------- automatic taps ----------------------------- */

/**
 * Reflex Loop taps on a timer, adding Data without spending anything.
 * Returns the Data gained this tick.
 */
function tickAutoTaps(dt) {
  const perSecond = autoClicksPerSecond();
  if (perSecond <= 0) return 0;
  const taps = perSecond * dt;
  const gain = taps * clickPower() * globalMultiplier();
  if (gain <= 0) return 0;
  state.data += gain;
  state.totalData += gain;
  state.lifetimeData += gain;
  return gain;
}

/* ----------------------------- passive tick ----------------------------- */

/**
 * Add passive Data for a delta of seconds.
 * Heat is handled in heat.js, which calls this.
 */
function applyPassive(dt) {
  const rate = dataPerSecond();
  if (rate <= 0) return 0;
  const gain = rate * dt;
  state.data += gain;
  state.totalData += gain;
  state.lifetimeData += gain;
  return gain;
}

/** Apply one manual click. Returns the Data gained. */
function applyClick() {
  if (state.crashed && Date.now() < state.crashUntil) return 0;

  const gain = clickYield();
  state.data += gain;
  state.totalData += gain;
  state.lifetimeData += gain;
  state.totalClicks += 1;
  return gain;
}