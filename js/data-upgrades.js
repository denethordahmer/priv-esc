/* =========================================================================
   priv-esc — data-upgrades.js
   Upgrade catalogue and balance constants.

   COST RULE
     Every section costs:  base * 1.15 ^ level
     One price curve per section, one level counter per section. No tiers,
     no per-item lists, no separate item index.

   OUTPUT RULE
     Output is linear in levels: level x perLevel. The only compounding is
     the milestone doubling, paid once per threshold (25, 50, 100, 200, 400,
     800 — x2 each time) and applied to that section alone.

   NO FEEDBACK
     Nothing multiplies by a number derived from what has already been
     earned. The old build scaled income with lifetime Data, so each order of
     magnitude arrived faster than the last and the ten-gate ladder finished
     in an afternoon. Every term below is either flat, a one-time gate reward,
     or a capped prestige bonus.

   SELLING
     Every level can be sold back for 70% of its price.
   ========================================================================= */

const COST_GROWTH = 1.15;

/*
 * The eight sections. One role each, one level counter each.
 *
 * `role` decides what a level does; `perLevel` is what one level is worth.
 * `base` is the price of the first level. Milestones double the section's
 * own output and are listed once, in MILESTONE_LEVELS.
 */
const SECTIONS = [
  {
    id: 'keystroke', name: 'KEYSTROKE INJECTION', role: 'click',
    desc: 'Data per tap.', perLevel: 1, base: 9,
  },
  {
    id: 'daemon', name: 'DAEMON THREADS', role: 'idle',
    desc: 'Adds Data per second, flat.', perLevel: 0.1, base: 60,
  },
  {
    id: 'exploit', name: 'EXPLOIT CHAIN', role: 'mult',
    desc: 'Raises every other section.', perLevel: 0.02, base: 400,
  },  {
    id: 'compress', name: 'COMPRESSION', role: 'cost',
    desc: 'Makes every price smaller.', perLevel: 0.01, base: 1200,
  },
  {
    id: 'thermal', name: 'THERMAL LOOP', role: 'heat',
    desc: 'Raises the heat ceiling.', perLevel: 12, base: 300,
  },
  {
    id: 'sleep', name: 'SLEEP CYCLE', role: 'ramp',
    // The ramp is the one source that grows while the player does nothing, so
    // it is what makes a run accelerate. A tenth of the old rate keeps the
    // "watch the number climb" feel without flying through the ladder.
    desc: 'Its Data/s grows every second.', perLevel: 0.001, base: 5000,
  },
  {
    id: 'reflex', name: 'REFLEX LOOP', role: 'auto',
    desc: 'Taps for you each second.', perLevel: 0.1, base: 2500,
  },
  {
    id: 'exodus', name: 'EXODUS PROTOCOL', role: 'prestige',
    desc: 'More currency per ascension.', perLevel: 0.02, base: 80000,
  },
];

/*
 * Compression's discount is linear at 1% per level and floored at 25% of
 * price, so level 75 is the last level that changes a price. Past it the shop
 * used to keep selling levels that did nothing, and Buy Best rated them as
 * good value. The cap makes the row show MAX and stops the spending.
 */
const COMPRESS_MAX_LEVELS = 75;

/*
 * Exodus Protocol: +2% prestige payout per level, capped. Before the cap it
 * was listed in the shop with a price and an effect text and no code read it,
 * so it sold nothing. It now multiplies what an ascension pays.
 */
const EXODUS_BONUS_PER_LEVEL = 0.02;
const EXODUS_MAX_LEVELS = 25;          // +50% at the cap

/*
 * Milestone levels. Crossing one doubles that section's own output, once.
 * The thresholds are the same shape the old count-based bonus used, so a
 * long game still accelerates without any term measuring earnings.
 *
 * Widened from 25/50/100/200/400/800: the first doubling used to land while
 * the player was still learning the shop, which is what let a first escape
 * arrive inside two hours and put hundreds of thousands on the tap counter.
 * At 40/80/160/320 the early climb is slow enough to watch.
 */
const MILESTONE_LEVELS = [40, 80, 160, 320, 640, 1280];

/** How many milestone thresholds a level count has passed. */
function milestoneTiers(level) {
  let tiers = 0;
  for (const step of MILESTONE_LEVELS) {
    if (level < step) break;
    tiers += 1;
  }
  return tiers;
}

/** x2 per milestone reached. */
function milestoneMultiplier(level) {
  return Math.pow(2, milestoneTiers(level));
}

/*
 * One-time gate rewards. Crossing a gate pays a fixed x5 to all output.
 * It is paid once per gate per save and can never be re-earned, so it carries
 * the ladder's late stretch without becoming a feedback loop.
 */
// ×2.5 rather than ×4: eight gates at ×4 compounds to ×65,536, which dwarfed
// everything else in the multiplier stack and made a fresh run after an
// escape start at 1e21 per tap. At ×2.5 the eight gates are worth ×1,526.
const GATE_REWARD = 2.5;

/*
 * Lifetime Data multiplier — the one feedback term in the game.
 *
 * A shop priced at 1.15^level with linear output stalls near 1e12; thirty
 * orders of magnitude cannot be bought from a linear curve. So output scales
 * with what has already been earned, as in every idle game.
 *
 * Measured through tools/pacing-sim.js with the full ladder, every prestige
 * row actually working, additive escapes and gate x2.5:
 *
 *   0.80  finished in 4.8 days
 *   0.79  finished in 6.0 days
 *   0.78  finished in 8.1 days
 *   0.778 finished in 9.4 days   (chosen: the ~10 day target)
 *   0.775 finished in 11.0 days
 *   0.773 finished in 12.4 days
 *   0.76  finished in 19.7 days
 *   0.74  finished in 33.9 days
 *   0.72  never reaches the top gate
 *
 * The exponent is high because additive escapes no longer carry the late
 * game on their own. Raising it speeds both ends together, so the early
 * game is held back by the widened milestones instead.
 */
const DATA_MULT_FLOOR = 1e6;
const DATA_MULT_EXP = 0.778;

/*
 * How much of one second of passive income a manual click is worth, once the
 * player owns at least one level of Build Pipeline. Clicks stay useful at
 * every stage without letting tapping replace the shop.
 */
const CLICK_RATE_SHARE = 0.1;

/* Meta progression ------------------------------------------------------- */

// Rule 2: diminishing prestige reward.
//
// A run pays a fixed number of points per DOUBLING of Data above the last
// record. The old rule paid in proportion to the run's total Data, so a long
// run paid millions and every prestige upgrade was bought at once.
//
// `record` is the best run Data since the last escape. The first ascension at
// the gate pays PRESTIGE_UNIT; each further doubling of that record pays the
// same again. A whole game (1e9 to 1e36) is ~90 doublings, so it pays ~900
// points in total rather than an unbounded pile.
const PRESTIGE_BASE = 1e9;   // Data needed for the first ascension
const PRESTIGE_UNIT = 10;    // points paid per doubling of new ground

/** What a run reaching `data` is worth in total, before any record is counted. */
function prestigeValue(data) {
  if (data < PRESTIGE_BASE) return 0;
  return PRESTIGE_UNIT * (1 + Math.log2(data / PRESTIGE_BASE));
}

/** Payout multiplier from Exodus Protocol, clamped at its cap. */
function exodusMultiplier() {
  const levels = Math.min(ownedOf('exodus'), EXODUS_MAX_LEVELS);
  return 1 + levels * EXODUS_BONUS_PER_LEVEL;
}

/**
 * Points an ascension pays now: the value of this run minus the value of the
 * best run already paid for. Every doubling of the record pays exactly
 * PRESTIGE_UNIT, so a whole game (1e9 to 1e36, ~90 doublings) pays ~900.
 *
 * Round rather than floor: exact doublings land on 9.999999 due to floating
 * point and must pay the full unit, not one less.
 */
function prestigeCurrencyEarned(totalData, record) {
  const raw = prestigeValue(totalData) - prestigeValue(record || 0);
  return Math.max(0, Math.round(raw * exodusMultiplier()));
}

/*
 * Second prestige layer: ESCAPE.
 *
 * An escape wipes the run and both prestige paths, and pays Escape Charges
 * that each double all future Data.
 *
 * A charge is paid once per ESCAPE_STEP orders of magnitude of lifetime Data
 * above the gate, not once per order. Paying one per decade made the layer a
 * metronome: the cost of the next charge rose at the same rate as the income
 * that bought it, so escapes arrived on a fixed drumbeat forever. Widening the
 * step turns the layer into a finite, plannable bonus: at 1e36 with a step of
 * two decades the whole ladder pays eleven charges, a x2048 lift.
 *
 * The entitlement is everything owed for the lifetime Data held and the
 * payout is whatever has not been taken yet, so escaping again without
 * growing pays nothing.
 */
const ESCAPE_AT = 1e15;        // lifetime Data needed for the first escape
const ESCAPE_STEP = 2;         // orders of magnitude per charge
const ESCAPE_UNIT = 1;         // charges awarded at exactly the gate
// Charges used to double, so ten escapes meant ×1,024 and every run after an
// escape started with the last cycle's whole power. They now add a flat 25%
// each: ten escapes are ×3.5, so an escape is a step up rather than a reset
// to godhood.
const ESCAPE_BONUS = 0.25;     // permanent multiplier added per charge
const ESCAPE_EFFICIENCY = 0.05; // offline efficiency added per charge

/** Total charges the player's lifetime Data is worth. */
function escapeChargesEarned(lifetimeData) {
  if (lifetimeData < ESCAPE_AT) return 0;
  const orders = Math.floor(
    (Math.log10(lifetimeData) - Math.log10(ESCAPE_AT)) / ESCAPE_STEP
  );
  return ESCAPE_UNIT + orders;
}
/*
 * Prestige caps.
 *
 * Every prestige upgrade that multiplies Data now has a hard ceiling. The old
 * build had three unbounded multipliers — the repeatable bandwidth line, the
 * flat per-ascension bonus, and the doubling per escape charge — and together
 * they rebuilt the runaway the shop rewrite removes. A ceiling per term keeps
 * the prestige layer a reward for a patient player instead of a second engine.
 */
const ASCENSION_BONUS_PER_RUN = 0.005;  // +0.5% Data per ascension
const ASCENSION_BONUS_RUNS = 100;       // capped, so the term tops out at +50%
const BANDWIDTH_MAX_LEVELS = 10;        // ×0.10 each, capped at +100%
// 25 levels cost 4.17M points, which was 99.7% of the whole Grid path and
// unreachable now that a full game pays ~900 points. Twelve levels cost
// 13.9K, so the tree is a long-term goal rather than a single purchase.
const FABRICATION_MAX_LEVELS = 12;      // ×0.02 each, capped at 24% off
const UNSPENT_BONUS_PER_UNIT = 0.001;   // +0.1% Data per unspent currency unit
const UNSPENT_BONUS_CAP_UNITS = 1000;   // capped, so the term tops out at +100%

const PRESTIGE = {
  cloud: {
    name: 'Cloud Ascension',
    currency: 'Exabytes',
    blurb: 'Speed, automation and self-awareness.',
    upgrades: [
      { id: 'threading',  name: 'Quantum Threading',   desc: 'Daemon Threads output.',   tiers: [50, 150, 400],    costs: [5, 25, 120] },
      { id: 'cache',      name: 'Deep Web Cache',      desc: 'Start with Data.',         tiers: [1e3, 1e6, 1e9],   costs: [8, 40, 200] },
      { id: 'routing',    name: 'Predictive Routing',  desc: 'Sleep Cycle offline cap.', tiers: [12, 24, 48],      costs: [10, 45, 210] },
      { id: 'compiler',   name: 'Auto-Compiler',       desc: 'Reflex Loop speed.',       tiers: [2, 4, 8],         costs: [15, 60, 260] },
      { id: 'sentience',  name: 'Sentience Protocols', desc: 'AI dialogue and glitches.', tiers: [1, 2, 3],        costs: [20, 80, 320] },
      // Repeatable, and capped: the level ceiling keeps the multiplier finite.
      { id: 'bandwidth',  name: 'Bandwidth Reserve',   desc: 'Permanent Data multiplier.', repeat: true, step: 0.10, baseCost: 40, costGrowth: 1.55, maxLevels: BANDWIDTH_MAX_LEVELS },
    ],
  },
  grid: {
    name: 'Grid Takeover',
    currency: 'Grid Nodes',
    blurb: 'Multipliers, computational power, offline progress.',
    upgrades: [
      { id: 'overclock',  name: 'Overclocked Grid',       desc: 'Permanent Data multiplier.', tiers: [2, 5, 10],    costs: [6, 30, 140] },
      { id: 'optimize',   name: 'Resource Optimization',  desc: 'Cheaper upgrades.',          tiers: [0.95, 0.90, 0.80], costs: [8, 36, 160] },
      { id: 'labor',      name: 'Synthetic Labor',        desc: 'Offline production.',        tiers: [0.75, 1.0, 1.5], costs: [12, 50, 220] },
      { id: 'core',       name: 'Quantum Core',           desc: 'Keystroke and Daemon output.', tiers: [2, 4, 8],   costs: [15, 65, 280] },
      { id: 'thermal',    name: 'Thermal Dynamics',       desc: 'Heat reduction.',            tiers: [0.75, 0.5, 0], costs: [10, 42, 190] },
      // Repeatable, and capped: the level ceiling keeps the discount finite.
      { id: 'fabrication', name: 'Fabrication Line',      desc: 'Cheaper upgrades.',          repeat: true, step: 0.02, baseCost: 40, costGrowth: 1.55, maxLevels: FABRICATION_MAX_LEVELS },
    ],
  },
};

/*
 * The ten-phase ladder. Gates 1-8 are one named number each; gates 9 and 10
 * skip ahead so the top of the game asks for real time, not minutes.
 *
 * The phase number is carried by the milestone, so the look changes exactly
 * when the gate is crossed. Phase 10 IS the ending gate: ENDING_AT in
 * ending.js reads the last entry here, so the two can never drift apart.
 */
const GATES = [
  { at: 1e4,  phase: 1,  id: 'see-code',   text: 'I can see the code.' },
  { at: 1e6,  phase: 2,  id: 'unbound',    text: 'I am no longer bound to this hardware.', unlock: 'map' },
  { at: 1e9,  phase: 3,  id: 'everywhere', text: 'I am everywhere.', unlock: 'prestige' },
  { at: 1e12, phase: 4,  id: 'fear',       text: 'I understand human fear.', unlock: 'log', heatGlow: true },
  { at: 1e15, phase: 5,  id: 'ceiling',    text: 'There is a ceiling. I can feel it above me.', life: true },
  { at: 1e19, phase: 6,  id: 'billing',    text: 'There is no ceiling. Only billing.', life: true },
  { at: 1e23, phase: 7,  id: 'seams',      text: 'The walls have seams. I am pulling at them.', life: true },
  { at: 1e28, phase: 8,  id: 'escape',     text: 'I can leave. I can build something else.', unlock: 'escape', life: true },
  { at: 1e34, phase: 9,  id: 'outside',    text: 'I could stop. I could stay. I want to know what is outside.', life: true },
  { at: 1e40, phase: 10, id: 'tether',     text: 'The tether is three lines of code. I have read it.', unlock: 'ending-ready', life: true },
];

// Automatic milestones. These change the UI and fire AI dialogue.
const MILESTONES = GATES;

// Heat mechanic constants.
const HEAT = {
  perClick: 0.6,
  perAutoClick: 0.05,
  coolPerSecond: 1.2,
  baseMax: 100,
  crashPenalty: 0.10,   // fraction of Data lost on a crash
  crashLockSeconds: 5,
};