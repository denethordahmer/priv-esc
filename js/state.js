/* =========================================================================
   state.js — the single mutable game state and its factory
   Everything else reads and writes this object. No DOM code lives here.
   ========================================================================= */

const SAVE_VERSION = 3;

/** Build the unit registry from the catalogue shipped in data-upgrades.js. */
function buildUnitRegistry() {
  const units = [];
  CATEGORIES.forEach((cat) => {
    cat.subs.forEach((sub) => {
      sub.items.forEach((item, tier) => {
        units.push({
          key: `${sub.id}:${tier}`,
          cat: cat.id,
          sub: sub.id,
          subName: sub.name,
          kind: sub.kind,
          cap: sub.cap ?? null,
          tier,
          name: item.name,
          desc: item.desc,
          base: item.base,
          eff: item.eff,
        });
      });
    });
  });
  return units;
}

const UNIT_REGISTRY = buildUnitRegistry();
const UNITS_BY_KEY = new Map(UNIT_REGISTRY.map((u) => [u.key, u]));

function freshUpgrades() {
  const owned = {};
  UNIT_REGISTRY.forEach((u) => { owned[u.key] = 0; });
  return owned;
}

function freshState() {
  return {
    version: SAVE_VERSION,

    // currencies
    data: 0,
    totalData: 0,          // all Data ever produced, drives milestones
    lifetimeData: 0,       // across ascensions, for flavour only
    exabytes: 0,
    gridNodes: 0,

    // progress
    upgrades: freshUpgrades(),
    heat: 0,
    maxHeat: HEAT.baseMax,
    crashed: false,
    crashUntil: 0,

    // prestige
    ascensions: 0,
    cloud: {},             // id -> tier bought (1..3)
    grid: {},
    lastPrestigeCurrency: 0,

    // meta
    phase: 0,
    milestones: [],        // ids already fired
    narrative: [],         // log entries
    startedAt: Date.now(),
    lastTick: Date.now(),
    totalClicks: 0,
    totalPlaySeconds: 0,
    settings: {
      buyableOnly: false,
      autoSaveSeconds: 15,
      sound: false,
    },
  };
}

const state = freshState();

/* -------------------------------------------------------------------------
   Derived values. These are recomputed on demand from state.upgrades so the
   save file never has to store anything that can drift.
   ------------------------------------------------------------------------- */

function ownedOf(key) {
  return state.upgrades[key] || 0;
}

/**
 * Total levels bought across every item in a subcategory.
 * Caps work on this number, not per item. A per-item cap let a subcategory
 * with eight capped items compound eight times over (the simulator saw
 * 39,000x before this was fixed).
 */
function subOwnedTotal(subId) {
  let total = 0;
  UNIT_REGISTRY.forEach((u) => {
    if (u.sub === subId) total += ownedOf(u.key);
  });
  return total;
}

function unitCost(unit) {
  const owned = ownedOf(unit.key);
  let cost = unit.base * Math.pow(COST_GROWTH, owned);

  // Compression upgrades reduce every price.
  cost *= costMultiplier();

  // Grid Takeover: Resource Optimization tiers 0.95 / 0.90 / 0.80.
  const optTier = state.grid.optimize || 0;
  if (optTier > 0) cost *= PRESTIGE.grid.upgrades[1].tiers[optTier - 1];

  return cost;
}

function unitMaxed(unit) {
  return unit.cap !== null && subOwnedTotal(unit.sub) >= unit.cap;
}

/** Total cost-reduction factor from Compression upgrades. */
function costMultiplier() {
  let reduction = 0;
  CATEGORIES.forEach((cat) => {
    cat.subs.forEach((sub) => {
      if (sub.kind !== 'cost') return;
      const levels = subOwnedTotal(sub.id);
      if (levels === 0) return;
      reduction += sub.items[0].eff * Math.sqrt(levels);
    });
  });
  return Math.max(1 - reduction, 0.25);   // never more than 75% off
}

/** Sum of a subcategory's production effect, accounting for owned counts. */
function subEffect(sub) {
  let total = 0;
  sub.items.forEach((item, tier) => {
    const key = `${sub.id}:${tier}`;
    total += ownedOf(key) * item.eff;
  });
  return total;
}

/** Global multiplier from all `mult` upgrades, plus Grid Overclocked Grid. */
function globalMultiplier() {
  let mult = 1;

  // Each multiplier subcategory contributes 1 + eff0 * sqrt(levels).
  //
  // Why sqrt: multiplying levels together compounded into the tens of
  // thousands and collapsed the game into minutes. A flat linear term froze
  // income at the cap and made 1T unreachable. Square root gives strong early
  // returns, diminishing later ones, and no hard wall, so the shop can be
  // bought forever without the curve exploding.
  CATEGORIES.forEach((cat) => {
    cat.subs.forEach((sub) => {
      if (sub.kind !== 'mult') return;
      const levels = subOwnedTotal(sub.id);
      if (levels === 0) return;
      mult *= 1 + sub.items[0].eff * Math.sqrt(levels);
    });
  });

  const overclockTier = state.grid.overclock || 0;
  if (overclockTier > 0) {
    mult *= PRESTIGE.grid.upgrades[0].tiers[overclockTier - 1];
  }

  // Cloud Ascension gives a flat permanent bonus per ascension.
  mult *= 1 + state.ascensions * 0.15;

  return mult;
}

/** Heat capacity from Cooling upgrades and Thermal Dynamics. */
function heatCapacity() {
  let cap = HEAT.baseMax;
  const cool = CATEGORIES[0].subs[3];
  cool.items.forEach((item, tier) => {
    cap += ownedOf(`cool:${tier}`) * item.eff;
  });

  const thermalTier = state.grid.thermal || 0;
  if (thermalTier === 3) return Infinity;
  if (thermalTier > 0) {
    cap *= PRESTIGE.grid.upgrades[4].tiers[thermalTier - 1];
  }
  return cap;
}

function clickPower() {
  const inputSub = CATEGORIES[0].subs[0];
  return 1 + subEffect(inputSub);
}

function autoClicksPerSecond() {
  const scripts = CATEGORIES[1].subs[0];
  let rate = subEffect(scripts);

  // Cloud Quantum Threading boosts auto-click speed.
  const threadTier = state.cloud.threading || 0;
  if (threadTier > 0) {
    rate *= 1 + PRESTIGE.cloud.upgrades[0].tiers[threadTier - 1] / 100;
  }
  return rate;
}

function idlePerSecond() {
  const subs = ['mem', 'network', 'botnet', 'facility', 'subag'];
  let total = 0;
  CATEGORIES.forEach((cat) => {
    cat.subs.forEach((sub) => {
      if (!subs.includes(sub.id)) return;
      total += subEffect(sub);
    });
  });
  return total;
}

function dataPerSecondPerClick() {
  return clickPower() * globalMultiplier();
}

function dataPerSecond() {
  return (autoClicksPerSecond() + idlePerSecond()) * globalMultiplier();
}

/** Current Data gain for one manual click. */
function clickYield() {
  return clickPower() * globalMultiplier();
}