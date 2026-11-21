/* =========================================================================
   state.js — the single mutable game state and its factory
   Everything else reads and writes this object. No DOM code lives here.
   ========================================================================= */

const SAVE_VERSION = 5;

/*
 * The unit registry: one entry per section.
 *
 * Each section has exactly one unit, so the registry is the sections plus the
 * bookkeeping the shop needs (key, kind, cap). Keeping the registry shape
 * means the shop, the buy/sell code and the auto-buy helper keep working on
 * `unit.key` without knowing there used to be tiers.
 */
function buildUnitRegistry() {
  return SECTIONS.map((sub) => ({
    key: sub.id,
    id: sub.id,
    cat: sub.id,
    sub: sub.id,
    subName: sub.name,
    kind: sub.role,
    cap: null,
    name: sub.name,
    desc: sub.desc,
    base: sub.base,
    eff: sub.perLevel,
  }));
}

const UNIT_REGISTRY = buildUnitRegistry();
const UNITS_BY_KEY = new Map(UNIT_REGISTRY.map((u) => [u.key, u]));

function sectionById(id) {
  return UNITS_BY_KEY.get(id) || null;
}

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
    lifetimeData: 0,       // across ascensions, for flavour and the escape ladder
    exabytes: 0,
    gridNodes: 0,
    escapes: 0,            // second-layer currency, kept across every reset
    ramp: 0,               // Sleep Cycle's self-growing Data/s, kept across resets

    // progress
    upgrades: freshUpgrades(),
    lifetimeLevels: 0,     // total levels bought, survives every reset
    gatesPaid: [],         // ids of gates whose one-time reward was taken
    heat: 0,
    maxHeat: HEAT.baseMax,
    crashed: false,
    crashUntil: 0,

    // prestige
    ascensions: 0,
    cloud: {},             // id -> tier bought (1..3)
    grid: {},
    lastPrestigeCurrency: 0,
    prestigeRecord: 0,     // best run Data since the last escape; sets the gate

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
      musicTrack: null,      // null = shuffle the whole playlist
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
 * Level count for a section.
 * Kept as a named helper because the old build measured a subcategory's
 * combined tiers; callers still ask for "how far is this section".
 */
function subOwnedTotal(subId) {
  return ownedOf(subId);
}

/** Total levels bought across every section, this run. */
function totalLevelsBought() {
  let total = 0;
  UNIT_REGISTRY.forEach((u) => { total += ownedOf(u.key); });
  return total;
}

/**
 * Levels bought across every run.
 * Survives resets so the ledger on screen keeps counting up.
 */
function lifetimeLevelsBought() {
  return Math.max(state.lifetimeLevels || 0, totalLevelsBought());
}

/** Price of the level at a given owned count, before any bulk discount. */
function unitCostAtLevel(unit, owned) {
  let cost = unit.base * Math.pow(COST_GROWTH, owned);

  // Compression lowers every price.
  cost *= costMultiplier();

  // Grid Takeover: Resource Optimization tiers 0.95 / 0.90 / 0.80.
  const optTier = state.grid.optimize || 0;
  if (optTier > 0) cost *= PRESTIGE.grid.upgrades[1].tiers[optTier - 1];

  // Repeatable Grid Fabrication Line: 2% cheaper per level, floored so it
  // can never reach zero. Clamped at the cap for saves that went past it.
  const fabrication = Math.min(state.grid.fabrication || 0, FABRICATION_MAX_LEVELS);
  if (fabrication > 0) cost *= Math.max(0.25, 1 - fabrication * 0.02);

  return cost;
}

/** Price of the next level, at the player's current owned count. */
function unitCost(unit) {
  return unitCostAtLevel(unit, ownedOf(unit.key));
}

/** No shop section has a level cap; only the prestige lines do. */
function unitMaxed() {
  return false;
}

/**
 * Total price of buying `count` levels from here.
 *
 * Prices climb by COST_GROWTH per level, so a ×10 tap does not cost ten times
 * the single price: it costs the sum of ten rising prices. That sum has a
 * closed form, which keeps this exact for the ×100 and MAX options too.
 */
function bulkCost(unit, count) {
  if (!Number.isFinite(count)) count = affordableCount(unit, Infinity);
  if (count <= 0) return 0;
  return seriesTotal(unitCostAtLevel(unit, ownedOf(unit.key)), count);
}

/** How many levels of a unit the player can buy right now, up to `limit`. */
function affordableCount(unit, limit) {
  if (limit <= 0) return 0;
  const owned = ownedOf(unit.key);
  const cap = Math.min(limit, 10000);
  const first = unitCostAtLevel(unit, owned);
  if (first > state.data) return 0;

  // Invert the geometric series instead of summing it, so the MAX button
  // costs the same as ×1 even when thousands of levels are affordable.
  const g = COST_GROWTH;
  let n = Math.floor(Math.log(1 + (state.data * (g - 1)) / first) / Math.log(g));
  n = Math.max(0, Math.min(cap, n));
  // Floating-point log can land one either side; nudge until the total fits.
  while (n > 0 && seriesTotal(first, n) > state.data) n -= 1;
  while (n < cap && seriesTotal(first, n + 1) <= state.data) n += 1;
  return n;
}

/** Sum of `count` prices starting at `first`, rising by COST_GROWTH each level. */
function seriesTotal(first, count) {
  if (count <= 0) return 0;
  return first * (Math.pow(COST_GROWTH, count) - 1) / (COST_GROWTH - 1);
}

/**
 * Total cost-reduction factor from Compression.
 *
 * Reduction is linear in level and floored at 75% off, so there is a real end
 * point: the section stops being worth buying rather than compounding free.
 */
function costMultiplier() {
  const compress = ownedOf('compress') * 0.01;
  return Math.max(1 - compress, 0.25);
}

/** Output of one section, before the global multiplier. */
function sectionOutput(sub) {
  const level = ownedOf(sub.id);
  if (level === 0) return 0;
  return level * sub.eff * milestoneMultiplier(level);
}

/** A section's own milestone level count, for display. */
function sectionMilestones(sub) {
  return milestoneTiers(ownedOf(sub.id));
}

/** The next milestone level for a section, or null when all are passed. */
function nextSectionMilestone(sub) {
  const level = ownedOf(sub.id);
  return MILESTONE_LEVELS.find((step) => level < step) || null;
}

/** Global multiplier from Exploit Chain and the prestige terms. */
function globalMultiplier() {
  let mult = 1;

  // Exploit Chain: linear in levels, doubled by its own milestones.
  const exploit = sectionById('exploit');
  if (ownedOf('exploit') > 0) {
    mult *= 1 + sectionOutput(exploit);
  }

  const overclockTier = state.grid.overclock || 0;
  if (overclockTier > 0) {
    mult *= PRESTIGE.grid.upgrades[0].tiers[overclockTier - 1];
  }

  // Repeatable prestige upgrades: Cloud Bandwidth Reserve adds a flat
  // percentage per level, capped so it stays a bonus rather than an engine.
  // Clamped here as well as in the shop, because an old save can carry more
  // levels than the cap allows.
  const bandwidth = Math.min(state.cloud.bandwidth || 0, BANDWIDTH_MAX_LEVELS);
  if (bandwidth > 0) mult *= 1 + bandwidth * 0.10;

  // Cloud Ascension gives a flat bonus per ascension, also capped. Unbounded,
  // it produced thousands of ascensions a run and rebuilt the runaway.
  const ascensions = Math.min(state.ascensions || 0, ASCENSION_BONUS_RUNS);
  mult *= 1 + ascensions * ASCENSION_BONUS_PER_RUN;

  // Unspent prestige currency: +0.1% Data per unit held, capped at +100%.
  // This rewards banking instead of spending without becoming a second engine.
  const banked = Math.min(
    (state.exabytes || 0) + (state.gridNodes || 0),
    UNSPENT_BONUS_CAP_UNITS
  );
  if (banked > 0) mult *= 1 + banked * UNSPENT_BONUS_PER_UNIT;

  // One-time gate rewards: x5 per distinct gate crossed, paid once each.
  // Counted by distinct id so a duplicate in a hand-edited save cannot stack.
  const gates = new Set(state.gatesPaid || []).size;
  if (gates > 0) mult *= Math.pow(GATE_REWARD, gates);

  // Escape Charges: each charge doubles all Data. The charge count is capped
  // by the escape ladder itself, which pays eleven charges across the whole
  // game, so this tops out at x2048.
  const escapes = state.escapes || 0;
  if (escapes > 0) mult *= Math.pow(ESCAPE_MULT, escapes);

  // Lifetime Data multiplier: the one term that scales with what has already
  // been earned. Without it the linear shop stalls near 1e12 and the top of
  // the ladder is unreachable; too high and the runaway returns. The exponent
  // is measured and tested — see the note in data-upgrades.js.
  const lifetime = state.lifetimeData || 0;
  if (lifetime > DATA_MULT_FLOOR) {
    mult *= Math.pow(lifetime / DATA_MULT_FLOOR, DATA_MULT_EXP);
  }

  return mult;
}

/** Heat capacity from Thermal Loop and Thermal Dynamics. */
function heatCapacity() {
  let cap = HEAT.baseMax;
  cap += sectionOutput(sectionById('thermal'));

  const thermalTier = state.grid.thermal || 0;
  if (thermalTier === 3) return Infinity;
  if (thermalTier > 0) {
    cap *= PRESTIGE.grid.upgrades[4].tiers[thermalTier - 1];
  }
  return cap;
}

function clickPower() {
  return 1 + sectionOutput(sectionById('keystroke'));
}

function autoClicksPerSecond() {
  // Reflex Loop performs automatic taps. Each level is worth a tenth of a
  // tap per second, so ten levels is one tap a second.
  const reflex = ownedOf('reflex');
  if (reflex === 0) return 0;
  return reflex * sectionById('reflex').eff * milestoneMultiplier(reflex);
}

function idlePerSecond() {
  // Daemon Threads is the bought passive line. Sleep Cycle is added on top
  // as state.ramp, because its output grows by itself every second rather
  // than being a fixed amount per level.
  return sectionOutput(sectionById('daemon'));
}

/**
 * Data per second that Sleep Cycle adds to the idle rate each second.
 *
 * One level adds 0.1 per second, so the number on screen climbs while the
 * player watches even if they never buy anything else. The growth is linear
 * in time, which is why it cannot run away: it never multiplies by earnings.
 */
function rampPerSecond() {
  const level = ownedOf('sleep');
  if (level === 0) return 0;
  return level * sectionById('sleep').eff * milestoneMultiplier(level);
}

function dataPerSecondPerClick() {
  return clickPower() * globalMultiplier();
}

function dataPerSecond() {
  // Bought passive output plus the accumulated Sleep Cycle ramp.
  return (idlePerSecond() + (state.ramp || 0)) * globalMultiplier();
}

/**
 * Data from one manual click.
 *
 * A click is worth its click power, plus a share of the passive rate once the
 * player owns Build Pipeline. Without that second term the button becomes
 * decoration once passive income takes over, which is most of the game.
 */
function clickYield() {
  const manual = clickPower() * globalMultiplier();
  if (ownedOf('reflex') === 0) return manual;
  return manual + dataPerSecond() * CLICK_RATE_SHARE;
}
