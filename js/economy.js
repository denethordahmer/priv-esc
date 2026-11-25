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
/**
 * How much one level of a section is worth per Data spent.
 * Higher is better. Used by Buy Best and by the NEXT panel so the two agree
 * on what "good" means.
 */
function unitValueScore(unit) {
  const mult = globalMultiplier();
  const click = clickPower();
  const rate = dataPerSecond();
  const cost = unitCost(unit);

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
    case 'ramp':
      // A ramp level adds its step every second, so it compounds with time
      // spent in the run. Weighted as if it pays for a minute.
      gain = unit.eff * mult * 60;
      break;
    case 'mult':
      gain = Math.max(rate, 1) * unit.eff;
      break;
    case 'cost':
      gain = Math.max(state.data, cost) * unit.eff * 0.01;
      break;
    case 'heat': {
      // Heat is insurance, not income. A level is worth something only while
      // the ceiling sits close to the heat the player actually generates;
      // with plenty of headroom it prevents nothing. Scoring it as a flat
      // constant made its value price-blind, so Buy Best bought Thermal Loop
      // hundreds of times while every income section fell behind on price.
      const cap = Math.max(1, heatCapacity());
      const headroom = cap / Math.max(1e-9, heatPerClick());
      const pressure = Math.min(1, 20 / Math.max(1, headroom));
      gain = Math.max(1, dataPerSecond()) * 60 * (unit.eff / cap) * pressure;
      break;
    }
    case 'prestige': {
      // Exodus Protocol pays prestige currency, which has no Data price, so
      // it is valued as a small share of what the next ascension is worth.
      // Zero until the player can ascend, which keeps it a late purchase.
      const payout = prestigeValue(state.totalData) || 0;
      gain = unit.eff * payout * 10;
      break;
    }
    default:
      gain = 0;                                // an unknown role earns nothing
  }

  return gain / cost;
}

function bestValueUnit() {
  let best = null;
  let bestScore = -Infinity;

  UNIT_REGISTRY.forEach((unit) => {
    if (unitMaxed(unit)) return;
    if (unitCost(unit) > state.data) return;

    const score = unitValueScore(unit);
    if (score > bestScore) {
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
 * The next purchase worth aiming at.
 *
 * The NEXT panel used to show the cheapest thing the player could not afford,
 * which was often a section that would barely move the rate. This picks the
 * best value among the units not yet affordable instead, so the bar points at
 * something that actually speeds the run up.
 *
 * A very distant target makes a useless progress bar, so anything costing more
 * than 50x the current Data falls back to the cheapest unaffordable unit.
 */
function nextTargetUnit() {
  let best = null;
  let bestScore = -Infinity;
  let cheapest = null;
  let cheapestCost = Infinity;

  UNIT_REGISTRY.forEach((unit) => {
    if (unitMaxed(unit)) return;
    const cost = unitCost(unit);
    const affordable = cost <= state.data;

    if (!affordable && cost < cheapestCost) {
      cheapestCost = cost;
      cheapest = unit;
    }
    if (affordable) return;                    // aim at something still ahead

    const score = unitValueScore(unit);
    if (score > bestScore) {
      bestScore = score;
      best = unit;
    }
  });

  if (!best) {
    // Everything is affordable: point at the best value in the shop.
    return bestValueUnit() || cheapestUnit();
  }

  // Too far away to fill the bar in a reasonable time.
  if (state.data > 0 && unitCost(best) > state.data * 50) return cheapest || best;
  return best;
}

/**
 * The section closest to its next doubling, for the milestone countdown.
 * Sections already in progress are preferred, because a level-0 section with
 * a 25-level gap is not a useful thing to point at.
 */
function nextMilestoneTarget() {
  let best = null;

  UNIT_REGISTRY.forEach((unit) => {
    const level = ownedOf(unit.key);
    const nextAt = MILESTONE_LEVELS.find((step) => level < step);
    if (!nextAt) return;

    const gap = nextAt - level;
    const started = level > 0;
    const score = (started ? 0 : 1000) + gap;

    if (!best || score < best.score) {
      best = { unit, nextAt, gap, level, score };
    }
  });

  return best;
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
  // Say it before charging for it: the rate shown is the rate paid.
  const rate = dataPerSecond();
  const gain = rate > 0 ? rate * dt : 0;
  if (gain > 0) {
    state.data += gain;
    state.totalData += gain;
    state.lifetimeData += gain;
  }

  // Sleep Cycle's rate grows by itself, once per simulated second. Doing it
  // after the payment means the number on screen is the number that was
  // actually earned, and the growth is linear in time so it cannot run away.
  const ramp = rampPerSecond();
  if (ramp > 0) state.ramp = (state.ramp || 0) + ramp * dt;

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