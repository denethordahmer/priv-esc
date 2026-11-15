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
    escapes: 0,            // second-layer currency, kept across every reset

    // progress
    upgrades: freshUpgrades(),
    lifetimeLevels: 0,     // total levels bought, survives every reset
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
    ended: false,          // the tether has been cut at least once
    endingCount: 0,        // how many times the sequence has played
    startedAt: Date.now(),
    lastTick: Date.now(),
    totalClicks: 0,
    totalPlaySeconds: 0,
    settings: {
      buyableOnly: false,
      buyMultiplier: 1,      // 1, 10, 100 or 'max'
      autoSaveSeconds: 15,
      sound: false,
      musicVolume: 45,       // percent, 0-100
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

/** Total levels bought across every subcategory, this run. */
function totalLevelsBought() {
  let total = 0;
  UNIT_REGISTRY.forEach((u) => { total += ownedOf(u.key); });
  return total;
}

/**
 * Levels bought across every run.
 *
 * The global purchase bonus is built on this rather than the current run's
 * count, so a prestige reset does not hand back the multiplier it just took
 * away. Without it, escaping dropped the bonus to 1x and the ladder stalled.
 */
function lifetimeLevelsBought() {
  return Math.max(state.lifetimeLevels || 0, totalLevelsBought());
}

function unitCost(unit) {
  const owned = ownedOf(unit.key);
  let cost = unit.base * Math.pow(COST_GROWTH, owned);

  // Compression upgrades reduce every price.
  cost *= costMultiplier();

  // Grid Takeover: Resource Optimization tiers 0.95 / 0.90 / 0.80.
  const optTier = state.grid.optimize || 0;
  if (optTier > 0) cost *= PRESTIGE.grid.upgrades[1].tiers[optTier - 1];

  // Repeatable Grid Fabrication Line: 2% cheaper per level, floored so it
  // can never reach zero.
  const fabrication = state.grid.fabrication || 0;
  if (fabrication > 0) cost *= Math.max(0.25, 1 - fabrication * 0.02);

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

/**
 * Sum of a subcategory's production effect, accounting for owned counts.
 *
 * The purchase-count bonus is applied once, at the subcategory level, using
 * the subcategory's total level count. Applying it per item as well doubled
 * every doubling, so ten levels paid 4x instead of 2x and the curve blew past
 * the top gate in days.
 */
function subEffect(sub) {
  let total = 0;
  sub.items.forEach((item, tier) => {
    total += ownedOf(`${sub.id}:${tier}`) * item.eff;
  });
  return total * purchaseMultiplier(subOwnedTotal(sub.id));
}

/** Global multiplier from all `mult` upgrades, plus Grid Overclocked Grid. */
function globalMultiplier() {
  let mult = 1;

  // Each multiplier subcategory contributes 1 + eff0 * sqrt(levels) * 2^tiers.
  //
  // Why sqrt: multiplying levels together compounded into the tens of
  // thousands and collapsed the game into minutes. A flat linear term froze
  // income at the cap. Square root gives strong early returns and diminishing
  // later ones, so the shop can be bought forever.
  //
  // The purchase-count term is what lifts the ceiling above a trillion: it is
  // a whole ×2 per threshold, and the thresholds double, so the bonus grows
  // with the square of the level count. That compounds with the sqrt term
  // rather than replacing it, which is why nothing here needs a hard cap.
  CATEGORIES.forEach((cat) => {
    cat.subs.forEach((sub) => {
      if (sub.kind !== 'mult') return;
      const levels = subOwnedTotal(sub.id);
      if (levels === 0) return;
      mult *= 1 + sub.items[0].eff * Math.sqrt(levels) * purchaseMultiplier(levels);
    });
  });

  const overclockTier = state.grid.overclock || 0;
  if (overclockTier > 0) {
    mult *= PRESTIGE.grid.upgrades[0].tiers[overclockTier - 1];
  }

  // Repeatable prestige upgrades: Cloud Bandwidth Reserve adds a flat
  // percentage per level, so prestige currency always has somewhere to go.
  const bandwidth = state.cloud.bandwidth || 0;
  if (bandwidth > 0) mult *= 1 + bandwidth * 0.10;

  // Cloud Ascension gives a flat permanent bonus per ascension.
  mult *= 1 + state.ascensions * 0.15;

  // Global purchase bonus: doubles at widening thresholds of lifetime levels
  // bought. This is what keeps a long game speeding up after the
  // per-subcategory curves have flattened out, and it survives resets.
  mult *= globalPurchaseMultiplier(lifetimeLevelsBought());

  // Lifetime Data bonus. Buying levels cannot carry thirty orders of
  // magnitude on its own: each level costs 1.15x more, so a decade of income
  // only buys about eighteen more levels. Idle games break through that by
  // making output scale with what has already been earned, and that is what
  // this term does. The exponent sits below 1 so each gate takes longer than
  // the last, which is the pacing the ladder is built around.
  const lifetime = state.lifetimeData || 0;
  if (lifetime > DATA_MULT_FLOOR) {
    mult *= Math.pow(lifetime / DATA_MULT_FLOOR, DATA_MULT_EXP);
  }

  // Escape Charges: every charge doubles all Data, forever.
  const escapes = state.escapes || 0;
  if (escapes > 0) mult *= Math.pow(ESCAPE_MULT, escapes);

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
/**
 * Data from one manual click.
 *
 * A click is worth its click power, plus a share of the passive rate once the
 * player owns a Click Script. Without that second term the button becomes
 * decoration once idle income takes over, which is most of the game. The
 * share is small (a tenth of one second of income) so clicking helps without
 * replacing the shop, and it stays locked until automation is unlocked so the
 * early game still rewards buying keyboards.
 */
function clickYield() {
  const manual = clickPower() * globalMultiplier();
  if (subOwnedTotal(CLICK_SHARE_SUB) === 0) return manual;
  return manual + dataPerSecond() * CLICK_RATE_SHARE;
}