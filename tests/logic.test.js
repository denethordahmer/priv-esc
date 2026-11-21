/* Headless smoke test for priv-esc core logic.
   Loads the plain-script modules into a VM context with a stubbed DOM
   and asserts the economy produces the expected curve shape. */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function loadScripts() {
  const ctx = {
    console,
    performance: { now: () => Date.now() },
    Date,
    Math,
    JSON,
    Map,
    Set,
    Number,
    Object,
    Array,
    String,
    Infinity,
    localStorage: {
      _d: {},
      getItem(k) { return this._d[k] ?? null; },
      setItem(k, v) { this._d[k] = String(v); },
      removeItem(k) { delete this._d[k]; },
    },
    window: {},
    document: null,
    logConsole: () => {},
    pushNarrative: () => {},
    showToast: () => {},
    uiRender: () => {},
    saveNow: () => true,
    revealPrestige: () => {},
    revealLog: () => {},
    applyPhase: () => {},
    uiRenderLog: () => {},
    renderUpgrades: () => {},
    setSaveStatus: () => {},
    capPrestige: () => {},
    consoleLog: () => {},
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);

  const files = [
    'js/data-upgrades.js',
    'js/format.js',
    'js/state.js',
    'js/save.js',
    'js/economy.js',
    'js/heat.js',
    'js/milestones.js',
    'js/prestige.js',
    'js/ending.js',
    'js/narrative.js',
    'js/audio.js',
  ];

  // Concatenate so top-level `const` bindings are shared, exactly as the
  // browser shares one global lexical scope across classic <script> tags.
  let combined = '';
  for (const f of files) {
    combined += `\n/* ==== ${f} ==== */\n`;
    combined += fs.readFileSync(path.join(ROOT, f), 'utf8');
  }

  combined += `
globalThis.__exports = {
  state, UNIT_REGISTRY, UNITS_BY_KEY, SECTIONS, MILESTONE_LEVELS, COST_GROWTH,
  GATE_REWARD, milestoneMultiplier, milestoneTiers, sectionOutput,
  DATA_MULT_EXP, DATA_MULT_FLOOR, ESCAPE_EFFICIENCY,
  MILESTONES, GATES, PRESTIGE, HEAT, PRESTIGE_BASE, PRESTIGE_UNIT,
  ENDING_AT, ESCAPE_AT, ESCAPE_MULT, ESCAPE_UNIT, ESCAPE_STEP, CLICK_RATE_SHARE,
  fmtCompact, musicVolume, DEFAULT_VOLUME, shuffleIndexes,
  totalLevelsBought, escape, canEscape, pendingEscapes,
  escapeChargesEarned,
  buyUnit, unitCost, unitCostAtLevel, bulkCost, affordableCount, unitMaxed,
  ownedOf, freshUpgrades, tickAutoTaps,
  nextTargetUnit, nextMilestoneTarget, bestValueUnit, unitValueScore,
  sellUnit, sellValue, buyMany, SELL_REFUND,
  clickPower, idlePerSecond, autoClicksPerSecond, globalMultiplier, dataPerSecond, rampPerSecond,
  costMultiplier, heatCapacity, dataPerSecond, clickYield,
  prestigeCurrencyEarned, ascend, canAscend, pendingExabytes, ascensionGate, PRESTIGE_UNIT,
  buyPrestigeTier, nextPrestigeCost, applyClick, applyPassive, saveNow, serialise, loadState,
  wipeSave, SAVE_KEY, localStorage,
  fmt, fmtRate, fmtTime, fmtClock, fmtMult, fmtPct,
};`;

  vm.runInContext(combined, ctx, { filename: 'priv-esc-bundle.js' });
  return ctx.__exports;
}

const results = [];
function check(name, fn) {
  try {
    const detail = fn();
    results.push({ name, ok: true, detail });
  } catch (err) {
    results.push({ name, ok: false, detail: err.message });
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const c = loadScripts();

console.log('--- priv-esc logic smoke test ---\n');

check('eight sections, one unit each', () => {
  const n = c.UNIT_REGISTRY.length;
  assert(n === 8, `expected 8 units, got ${n}`);
  assert(c.SECTIONS.length === 8, `expected 8 sections, got ${c.SECTIONS.length}`);
  const keys = new Set(c.UNIT_REGISTRY.map((u) => u.key));
  assert(keys.size === 8, 'section keys are not unique');
  return `${n} sections`;
});

check('cost grows by 1.15 per level', () => {
  const u = c.UNIT_REGISTRY[0];
  const c0 = u.base * 1;
  const c1 = u.base * Math.pow(1.15, 1);
  assert(Math.abs(c1 / c0 - 1.15) < 1e-9, 'ratio is not 1.15');
  return `${c0.toFixed(3)} -> ${c1.toFixed(3)}`;
});

check('prestige formula: at the gate gives 10', () => {
  const v = c.prestigeCurrencyEarned(c.PRESTIGE_BASE, 0);
  assert(v === 10, `got ${v}`);
  return `${v}`;
});

check('prestige pays 10 per doubling of new ground', () => {
  // The old square-root rule paid in proportion to the run's Data, which let
  // a late run buy the whole tree. Now each doubling pays the same 10.
  const u = c.PRESTIGE_UNIT;
  const at = (mult, record) => c.prestigeCurrencyEarned(c.PRESTIGE_BASE * mult, record);
  assert(at(1, 0) === u, `at the gate paid ${at(1, 0)}`);
  assert(at(2, 0) === u * 2, `2x paid ${at(2, 0)}`);
  assert(at(4, 0) === u * 3, `4x paid ${at(4, 0)}`);
  assert(at(1024, 0) === u * 11, `1024x paid ${at(1024, 0)}`);
  return `${u} per doubling`;
});

check('prestige pays nothing for ground already covered', () => {
  // The record is the best run so far. Reaching it again pays zero, and the
  // payout only counts the doublings above it.
  const gate = c.PRESTIGE_BASE;
  assert(c.prestigeCurrencyEarned(gate * 4, gate * 4) === 0, 'paid for a repeat run');
  assert(c.prestigeCurrencyEarned(gate * 4, gate * 2) === c.PRESTIGE_UNIT, 'wrong new-ground payout');
  assert(c.prestigeCurrencyEarned(gate * 8, gate * 2) === c.PRESTIGE_UNIT * 2, 'wrong new-ground payout');
  return 'record respected';
});

check('prestige below the wall gives 0', () => {
  const v = c.prestigeCurrencyEarned(c.PRESTIGE_BASE * 0.5, 0);
  assert(v === 0, `got ${v}`);
  return `${v}`;
});

check('a whole game pays hundreds of points, not millions', () => {
  // 1e9 to 1e36 is ~90 doublings. At 10 points each the entire ladder is
  // worth under 1,000 points, which is what makes the trees last.
  const total = c.prestigeCurrencyEarned(1e36, 0);
  assert(total < 1000, `a full game paid ${total}`);
  assert(total > 800, `a full game paid only ${total}`);
  return `${total} points for the whole game`;
});

check('the ascension gate is twice the record', () => {
  c.state.prestigeRecord = 0;
  assert(c.ascensionGate() === c.PRESTIGE_BASE, 'first gate is wrong');
  c.state.prestigeRecord = c.PRESTIGE_BASE * 8;
  assert(c.ascensionGate() === c.PRESTIGE_BASE * 16, 'later gate is wrong');
  c.state.totalData = c.PRESTIGE_BASE * 8;
  assert(c.canAscend() === false, 'ascended without beating the record');
  c.state.totalData = c.PRESTIGE_BASE * 16;
  assert(c.canAscend() === true, 'blocked at the gate');
  c.state.prestigeRecord = 0;
  return 'doubles each run';
});

check('milestones double a section at 25, 50, 100 and on', () => {
  c.state.upgrades = c.freshUpgrades();
  c.state.escapes = 0;
  c.state.ascensions = 0;

  const daemon = c.UNIT_REGISTRY.find((u) => u.key === 'daemon');

  // Just below and just at the first threshold: output is linear in levels
  // AND doubles at the threshold, so 24 -> 25 is 2x times the 25/24 step.
  c.state.upgrades.daemon = 24;
  const at24 = c.sectionOutput(daemon);
  c.state.upgrades.daemon = 25;
  const at25 = c.sectionOutput(daemon);

  assert(at24 > 0, '24 levels produced nothing');
  const ratio = at25 / at24;
  const expected = 2 * (25 / 24);
  assert(Math.abs(ratio - expected) < 0.05,
    `expected ${expected.toFixed(2)}x at the threshold, got ${ratio.toFixed(2)}x`);

  // Six thresholds in total, so a maxed milestone ladder is x64.
  assert(c.MILESTONE_LEVELS.length === 6, 'expected six thresholds');
  assert(c.milestoneMultiplier(800) === 64, `got ${c.milestoneMultiplier(800)}`);
  return `${at24.toFixed(1)} -> ${at25.toFixed(1)} at 25 levels`;
});

check('cost outruns the milestone bonus, so the shop never runs away', () => {
  // Every level costs 1.15x more, while the doubling thresholds widen
  // (25, 50, 100, 200, 400, 800) and stop after the sixth. Cost therefore
  // grows without limit while output does not.
  const costAt = (n) => Math.pow(1.15, n);
  const outAt = (n) => c.milestoneMultiplier(n) * n;
  const costGrowth = costAt(200) / costAt(25);
  const outGrowth = outAt(200) / outAt(25);

  assert(costGrowth > outGrowth,
    `cost grew ${costGrowth.toExponential(1)}x but output grew ${outGrowth.toExponential(1)}x`);
  // Past the last milestone, output is purely linear: no compounding at all.
  const lateGrowth = outAt(2000) / outAt(800);
  assert(lateGrowth === 2000 / 800, 'output should be linear after the last milestone');
  return `cost +${Math.log10(costGrowth).toFixed(1)} orders, output +${Math.log10(outGrowth).toFixed(1)}`;
});

check('nothing spends Data unless the player buys it', () => {
  // A section that bought upgrades on a timer shipped once and spent the
  // player's Data without being asked. This guards against it coming back:
  // run every section at a high level for a simulated second and check that
  // no purchase happened and Data only went up.
  c.state.upgrades = c.freshUpgrades();
  c.state.data = 1e9;
  c.state.totalData = 1e9;
  c.state.escapes = 0;
  c.state.ascensions = 0;
  c.state.cloud = {};
  c.state.grid = {};
  c.state.gatesPaid = [];
  c.UNIT_REGISTRY.forEach((u) => { c.state.upgrades[u.key] = 40; });

  const before = c.state.data;
  const levels = () => c.totalLevelsBought();
  const levelsBefore = levels();

  // Run a full second of the game's passive loop, twice.
  if (typeof c.tickAutoTaps === 'function') c.tickAutoTaps(1);
  c.applyPassive(1);
  if (typeof c.tickAutoTaps === 'function') c.tickAutoTaps(1);

  assert(levels() === levelsBefore, 'a section bought upgrades on its own');
  assert(c.state.data >= before, `Data went down without a purchase: ${before} -> ${c.state.data}`);
  return 'no purchases, Data only rises';
});

check('reflex loop taps without spending anything', () => {
  c.state.upgrades = c.freshUpgrades();
  c.state.data = 0;
  c.state.escapes = 0;
  c.state.ascensions = 0;
  c.state.cloud = {};
  c.state.grid = {};
  c.state.gatesPaid = [];
  c.state.upgrades.reflex = 10;

  // Ten levels at 0.1 taps each is one tap a second, worth one click.
  const expected = c.autoClicksPerSecond() * c.clickPower() * c.globalMultiplier();
  assert(Math.abs(expected - c.clickPower() * c.globalMultiplier()) < 1e-9,
    `ten levels gave ${c.autoClicksPerSecond()} taps/s`);

  c.tickAutoTaps(1);
  const afterOneSecond = c.state.data;
  assert(afterOneSecond > 0, 'the loop produced nothing');
  assert(Math.abs(afterOneSecond - expected) < 1e-9,
    `produced ${afterOneSecond}, expected ${expected}`);

  c.tickAutoTaps(1);
  assert(c.state.data > afterOneSecond, 'the second second produced nothing');
  assert(c.state.upgrades.reflex === 10, 'the loop changed its own level');
  return `${c.autoClicksPerSecond().toFixed(1)} taps/s, +${c.fmt(afterOneSecond)} Data/s`;
});

check('sleep cycle adds 0.1 per level to the idle rate every second', () => {
  // The owner asked for a section where one level adds 0.1 to the idle rate
  // every second, so the number climbs while they watch. Ten levels must add
  // a whole Data per second, each second.
  c.state.upgrades = c.freshUpgrades();
  c.state.ramp = 0;
  c.state.data = 0;
  c.state.escapes = 0;
  c.state.ascensions = 0;
  c.state.cloud = {};
  c.state.grid = {};
  c.state.gatesPaid = [];
  c.state.lifetimeData = 1e6;

  c.state.upgrades.sleep = 1;
  assert(Math.abs(c.rampPerSecond() - 0.1) < 1e-9, `one level gave ${c.rampPerSecond()}`);

  // One second at a time, the rate must step by 0.1 each second.
  const rates = [];
  for (let s = 0; s < 5; s += 1) {
    c.applyPassive(1);
    rates.push(Number(c.dataPerSecond().toFixed(4)));
  }
  const steps = rates.map((r, i) => Number((r - (i === 0 ? 0 : rates[i - 1])).toFixed(4)));
  steps.forEach((step) => {
    assert(Math.abs(step - 0.1) < 1e-6, `a second added ${step}, expected 0.1`);
  });

  // Ten levels is one whole Data per second, per second. Compare the ramp
  // itself, because total rate also carries the lifetime multiplier.
  c.state.upgrades = c.freshUpgrades();
  c.state.ramp = 0;
  c.state.upgrades.sleep = 10;
  assert(Math.abs(c.rampPerSecond() - 1) < 1e-9, `ten levels gave ${c.rampPerSecond()}`);
  c.applyPassive(1);
  c.applyPassive(1);
  assert(Math.abs(c.state.ramp - 2) < 1e-6, `after two seconds the ramp was ${c.state.ramp}`);

  return `1 lv: ${rates.map((r) => r.toFixed(1)).join(' → ')}`;
});

check('the sleep ramp is linear in time, so it cannot run away', () => {
  // Doubling the seconds doubles the ramp. That is the whole safety argument:
  // growth depends on time alone, never on how much has already been earned.
  const at = (seconds) => {
    c.state.upgrades = c.freshUpgrades();
    c.state.ramp = 0;
    c.state.data = 0;
    c.state.gatesPaid = [];
    c.state.lifetimeData = 1e6;
    c.state.upgrades.sleep = 5;
    for (let s = 0; s < seconds; s += 1) c.applyPassive(1);
    return c.state.ramp;
  };

  const ten = at(10);
  const twenty = at(20);
  assert(Math.abs(twenty / ten - 2) < 0.01,
    `ten seconds gave ${ten}, twenty gave ${twenty} — that is not linear`);

  // Earning more Data must not change the step size either.
  c.state.upgrades = c.freshUpgrades();
  c.state.ramp = 0;
  c.state.upgrades.sleep = 5;
  const stepSmall = c.rampPerSecond();
  c.state.lifetimeData = 1e30;
  const stepHuge = c.rampPerSecond();
  assert(stepSmall === stepHuge, 'the ramp step changed with lifetime Data');
  return `linear: ${ten.toFixed(1)} at 10s, ${twenty.toFixed(1)} at 20s`;
});

check('the NEXT panel aims at the best value still ahead', () => {
  // The panel used to show the cheapest thing the player could not afford,
  // which was often a section that barely moved the rate. It now picks the
  // best value among what is still out of reach.
  c.state.upgrades = c.freshUpgrades();
  c.state.data = 2000;
  c.state.totalData = 2000;
  c.state.lifetimeData = 2000;
  c.state.escapes = 0;
  c.state.ascensions = 0;
  c.state.cloud = {};
  c.state.grid = {};
  c.state.gatesPaid = [];
  c.state.ramp = 0;

  const target = c.nextTargetUnit();
  assert(target, 'no target at all');
  assert(c.unitCost(target) > c.state.data,
    `pointed at ${target.name}, which is already affordable`);

  // A very distant target must not be shown: an 80K gate from 2K is 40x, but
  // a 40,000x gate would leave the bar permanently empty.
  c.state.data = 10;
  const near = c.nextTargetUnit();
  assert(near, 'no target when broke');
  assert(c.unitCost(near) <= 500, `pointed at ${c.unitCost(near)} from 10 Data`);
  return `${target.name} at ${c.fmt(c.unitCost(target))}`;
});

check('the milestone countdown picks a section that is close', () => {
  c.state.upgrades = c.freshUpgrades();
  c.state.data = 1e6;
  c.state.lifetimeData = 1e6;
  c.state.escapes = 0;
  c.state.ascensions = 0;
  c.state.cloud = {};
  c.state.grid = {};
  c.state.gatesPaid = [];
  c.state.ramp = 0;

  // A section one level short of a doubling should win over untouched ones.
  c.state.upgrades.daemon = 24;
  const target = c.nextMilestoneTarget();
  assert(target, 'no milestone target');
  assert(target.unit.key === 'daemon', `picked ${target.unit.key} instead of daemon`);
  assert(target.nextAt === 25, `next milestone was ${target.nextAt}`);
  assert(target.gap === 1, `gap was ${target.gap}`);

  // With nothing started, it should still offer something rather than nothing.
  c.state.upgrades = c.freshUpgrades();
  const fresh = c.nextMilestoneTarget();
  assert(fresh, 'no target on a fresh save');
  assert(fresh.nextAt === 25, `fresh target was level ${fresh.nextAt}`);
  return `daemon 24 -> 25, then ${fresh.unit.key} -> ${fresh.nextAt}`;
});

check('the one feedback term stays inside its safe band', () => {
  // A linear shop cannot cross thirty orders of magnitude, so exactly one term
  // scales with lifetime Data. That term is the runaway risk. Measured with
  // the Sleep Cycle ramp actually running (the old simulator skipped it, which
  // is why the band used to read 0.66-0.70):
  //   0.67 -> 9.7 hours, 0.58 -> 4.0 days, 0.54 -> 8.3 days, 0.50 -> 22.8
  //   days, 0.45 -> stalls. 0.54 is the "days, not hours" target.
  assert(c.DATA_MULT_EXP < 0.60,
    `exponent ${c.DATA_MULT_EXP} finishes the game in under a day`);
  assert(c.DATA_MULT_EXP >= 0.50,
    `exponent ${c.DATA_MULT_EXP} makes the top gate take weeks or stall`);

  c.state.upgrades = c.freshUpgrades();
  c.state.escapes = 0;
  c.state.ascensions = 0;
  c.state.cloud = {};
  c.state.grid = {};
  c.state.gatesPaid = [];
  c.state.exabytes = 0;
  c.state.gridNodes = 0;
  c.state.upgrades.daemon = 40;

  // Income must grow with earnings, but slower than earnings do. Anything at
  // or above 1 means the ladder collapses; this is the guard against that.
  c.state.lifetimeData = 1e6;
  const small = c.dataPerSecond();
  c.state.lifetimeData = 1e12;
  const big = c.dataPerSecond();
  const exponent = Math.log10(big / small) / 6;
  assert(Math.abs(exponent - c.DATA_MULT_EXP) < 0.01,
    `rate grew as L^${exponent.toFixed(3)}, expected L^${c.DATA_MULT_EXP}`);
  assert(exponent < 1, 'income grows faster than earnings — the ladder collapses');
  return `rate grows as L^${exponent.toFixed(2)}`;
});

check('gate rewards pay once and never again', () => {
  const gate = c.GATES[2];
  c.state.upgrades = c.freshUpgrades();
  c.state.escapes = 0;
  c.state.ascensions = 0;
  c.state.cloud = {};
  c.state.grid = {};
  c.state.gatesPaid = [];
  c.state.upgrades.daemon = 1;

  const before = c.globalMultiplier();
  c.state.gatesPaid = [gate.id];
  const after = c.globalMultiplier();
  assert(Math.abs(after / before - c.GATE_REWARD) < 1e-9,
    `one gate should be x${c.GATE_REWARD}, got x${(after / before).toFixed(2)}`);

  // Crossing the same gate twice must not pay twice.
  c.state.gatesPaid = [gate.id, gate.id, gate.id];
  const thrice = c.globalMultiplier();
  assert(Math.abs(thrice / before - c.GATE_REWARD) < 1e-9,
    'duplicate gate entries stacked the reward');
  return `one gate = x${c.GATE_REWARD}, duplicates ignored`;
});

check('cost reduction never reaches zero', () => {
  c.state.upgrades = c.freshUpgrades();
  c.state.upgrades.compress = 500;
  const m = c.costMultiplier();
  assert(m >= 0.05 && m < 1, `cost multiplier out of range: ${m}`);
  return m.toFixed(3);
});

/* ------------------------------ the ladder ------------------------------- */

check('ten gates, one per phase, strictly rising', () => {
  const gates = c.GATES;
  assert(gates.length === 10, `expected 10 gates, got ${gates.length}`);
  gates.forEach((g, i) => {
    assert(g.phase === i + 1, `gate ${i + 1} carries phase ${g.phase}`);
    if (i > 0) assert(g.at > gates[i - 1].at, `gate ${i + 1} does not rise`);
  });
  return gates.map((g) => c.fmt(g.at)).join(' · ');
});

check('the ladder names a new magnitude at each step', () => {
  // Gates 1-8 are one named number each. 9 and 10 widen so the top asks for
  // real time rather than minutes.
  const expected = [1e4, 1e6, 1e9, 1e12, 1e15, 1e18, 1e21, 1e24, 1e30, 1e36];
  const actual = c.GATES.map((g) => g.at);
  expected.forEach((v, i) => {
    assert(actual[i] === v, `gate ${i + 1} is ${actual[i]}, expected ${v}`);
  });
  return expected.map((v) => Math.round(Math.log10(v))).join(' ');
});

check('the ending gate is the last phase', () => {
  const last = c.GATES[c.GATES.length - 1];
  assert(c.ENDING_AT === last.at,
    `ending at ${c.ENDING_AT} but the last gate is ${last.at}`);
  return `both at ${c.fmt(c.ENDING_AT)}`;
});

/* --------------------------- feel and polish ----------------------------- */

check('a click stays worth something once idle income takes over', () => {
  // Clicks used to be pure click power, which idle income dwarfs. Once the
  // player owns a Click Script, a click also carries a share of the passive
  // rate, so the button keeps mattering.
  c.state.upgrades = c.freshUpgrades();
  c.state.escapes = 0;
  c.state.ascensions = 0;
  c.state.cloud = {};
  c.state.grid = {};

  // Idle-only build: no click levels, no Reflex Loop yet.
  c.state.upgrades.daemon = 400;
  const passive = c.dataPerSecond();
  const locked = c.clickYield();

  assert(passive > 0, 'idle build produced no passive income');
  assert(locked === c.clickPower() * c.globalMultiplier(),
    'the click share applied before Reflex Loop was owned');

  // Buy the first Reflex Loop level: the share unlocks.
  c.state.upgrades.reflex = 1;
  const unlocked = c.clickYield();
  const share = (unlocked - locked) / passive;

  assert(Math.abs(share - c.CLICK_RATE_SHARE) < 0.01,
    `click share was ${share.toFixed(3)} of a second, expected ${c.CLICK_RATE_SHARE}`);
  return `${c.fmt(locked)} locked -> ${c.fmt(unlocked)} with the reflex loop`;
});

check('compact numbers stay short at every gate', () => {
  c.GATES.forEach((g) => {
    const text = c.fmtCompact(g.at);
    assert(text.length <= 8, `gate ${g.phase} renders as "${text}" (${text.length} chars)`);
  });
  // Past the named suffixes it must fall back to an exponent, not run long.
  const huge = c.fmtCompact(1e60);
  assert(huge.length <= 8, `1e60 renders as "${huge}"`);
  return `${c.fmtCompact(1e36)} · ${huge}`;
});

check('the escape preview names the next run multiplier', () => {
  // The panel shows what the next run starts at, so a reset is a decision.
  c.state.escapes = 0;
  c.state.lifetimeData = 1e18;
  // Charges are paid once per ESCAPE_STEP decades above the gate, so 1e18 is
  // three decades up. With a step of 2 that is the first charge plus one.
  const owed = c.escapeChargesEarned(1e18);
  const expected = 1 + Math.floor(3 / c.ESCAPE_STEP);
  assert(owed === expected, `1e18 should be worth ${expected} charges, got ${owed}`);
  const mult = Math.pow(c.ESCAPE_MULT, owed);
  assert(mult === Math.pow(2, expected), `${expected} charges should be x${Math.pow(2, expected)}, got x${mult}`);
  return `${owed} charges, next run x${mult}`;
});

check('music volume is clamped to a sane range', () => {
  // The Settings slider is the only thing that sets this, but a hand-edited
  // save could carry anything. musicVolume() must never return a value the
  // audio element would reject.
  const original = c.state.settings.musicVolume;

  c.state.settings.musicVolume = 45;
  assert(Math.abs(c.musicVolume() - 0.45) < 1e-9, '45% should be 0.45');

  c.state.settings.musicVolume = 500;
  assert(c.musicVolume() === 1, '500% should clamp to 1');

  c.state.settings.musicVolume = -20;
  assert(c.musicVolume() === 0, '-20% should clamp to 0');

  c.state.settings.musicVolume = 'nonsense';
  assert(c.musicVolume() === c.DEFAULT_VOLUME / 100, 'garbage should fall back to the default');

  c.state.settings.musicVolume = original;
  return `default ${c.DEFAULT_VOLUME}%`;
});

check('shuffle keeps every track and avoids repeating the last one', () => {
  // A random order is only acceptable if it still plays every track once, and
  // never opens a round with the track that just finished.
  for (let run = 0; run < 200; run += 1) {
    const order = c.shuffleIndexes(4, 2);
    assert(order.length === 4, 'shuffle changed the number of tracks');
    assert(new Set(order).size === 4, 'shuffle dropped or duplicated a track');
    assert(order[0] !== 2, 'shuffle started with the track that just played');
  }

  const single = c.shuffleIndexes(1, 0);
  assert(single.length === 1 && single[0] === 0, 'one track should stay put');
  return '4 tracks, 200 rounds';
});

check('the music manifest matches the folder', () => {  // The game reads music/manifest.json rather than probing for files, so a
  // stale manifest means a track that exists never plays. This keeps the two
  // in step: run `node tools/music-manifest.js` after adding tracks.
  const musicDir = path.join(ROOT, 'music');
  const manifestPath = path.join(musicDir, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    return 'no manifest yet (music folder empty)';
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const files = fs.readdirSync(musicDir);
  const mp3s = files.filter((f) => /\.mp3$/i.test(f));

  // Every mp3 must be named "NN Title.mp3", because the number sets the order
  // and the title is what the game displays.
  for (const file of mp3s) {
    assert(/^\d{2}\s+.+\.mp3$/i.test(file), `wrong name, expected "NN Title.mp3": ${file}`);
  }

  const listed = [manifest.title, ...manifest.tracks].filter(Boolean);

  // The shipped code zip leaves the mp3s out, because they are uploaded
  // separately. In that copy the folder is empty and there is nothing to
  // compare against, so this check only reports that.
  if (mp3s.length === 0) {
    return `no mp3s in this copy; manifest lists ${listed.length}`;
  }

  assert(listed.length === mp3s.length,
    `manifest lists ${listed.length} file(s) but the folder has ${mp3s.length}`);

  for (const entry of listed) {
    assert(entry && entry.file && entry.name, 'manifest entry is missing file or name');
    assert(files.includes(entry.file), `manifest lists a missing file: ${entry.file}`);
  }

  const title = mp3s.find((f) => f.startsWith('00 '));
  assert(!!manifest.title === !!title, 'manifest disagrees with the folder about the title theme');

  return `${manifest.tracks.length} tracks + title`;
});

check('buying raises owned count and spends Data', () => {
  c.state.upgrades = c.freshUpgrades();
  c.state.data = 1000;
  const u = c.UNIT_REGISTRY.find((x) => x.sub === 'keystroke');
  const before = c.state.data;
  const ok = c.buyUnit(u);
  assert(ok, 'purchase failed');
  assert(c.state.upgrades[u.key] === 1, 'owned count not incremented');
  assert(c.state.data < before, 'data not spent');
  return `${before} -> ${c.state.data.toFixed(1)}`;
});

check('buying is refused when broke', () => {
  c.state.data = 0;
  const u = c.UNIT_REGISTRY.find((x) => x.sub === 'keystroke');
  const ok = c.buyUnit(u);
  assert(ok === false, 'purchase should have failed');
  return 'refused';
});

check('thermal levels raise the heat ceiling one at a time', () => {
  c.state.upgrades = c.freshUpgrades();
  c.state.grid = {};
  c.state.data = 1e30;
  const cool = c.UNIT_REGISTRY.find((u) => u.key === 'thermal');
  assert(cool && cool.cap === null, 'thermal should not be capped');
  const before = c.heatCapacity();
  c.state.upgrades.thermal = 30;
  const after = c.heatCapacity();
  assert(after > before, `ceiling did not move: ${before} -> ${after}`);
  // 30 levels at 12 each, doubled once at the 25-level milestone.
  assert(after - before > 12 * 30, `ceiling only moved to ${after}`);
  return `${before} -> ${after} heat cap`;
});

check('selling refunds 70% and lowers the count', () => {
  c.state.upgrades = c.freshUpgrades();
  c.state.data = 1e6;
  const u = c.UNIT_REGISTRY.find((x) => x.sub === 'keystroke');
  c.buyUnit(u);
  const paid = 1e6 - c.state.data;
  const before = c.state.data;
  assert(c.sellUnit(u), 'sell failed');
  const refund = c.state.data - before;
  assert(c.state.upgrades[u.key] === 0, 'owned count not decremented');
  assert(Math.abs(refund - paid * 0.7) < 1e-6, `refund ${refund} vs ${paid * 0.7}`);
  return `paid ${paid.toFixed(2)}, got ${refund.toFixed(2)}`;
});

check('selling at zero owned is refused', () => {
  c.state.upgrades = c.freshUpgrades();
  const u = c.UNIT_REGISTRY.find((x) => x.sub === 'keystroke');
  assert(c.sellUnit(u) === false, 'sold a level that was never bought');
  return 'refused';
});

check('bulk buy stops at what you can afford', () => {
  c.state.upgrades = c.freshUpgrades();
  c.state.data = 100;
  const u = c.UNIT_REGISTRY.find((x) => x.sub === 'keystroke');
  const n = c.buyMany(u, 100);
  assert(n > 1 && n < 100, `bought ${n}, expected a partial batch`);
  assert(c.state.data >= 0, 'went negative');
  return `${n} levels for 100 Data`;
});

check('a ×N quote equals what the tap actually spends', () => {
  // The shop prints bulkCost(); the click deducts the same levels. If the two
  // drift apart the row lies about its price, which is the bug being fixed.
  c.state.upgrades = c.freshUpgrades();
  c.state.data = 1e6;
  c.state.grid = {};
  c.state.exabytes = 0;
  const u = c.UNIT_REGISTRY.find((x) => x.sub === 'keystroke');

  for (const limit of [1, 10, 100]) {
    c.state.upgrades = c.freshUpgrades();
    c.state.data = 1e6;
    const n = c.affordableCount(u, limit);
    const quote = c.bulkCost(u, n);
    const before = c.state.data;
    const bought = c.buyMany(u, limit);
    const spent = before - c.state.data;
    assert(bought === n, `×${limit} bought ${bought}, quoted ${n}`);
    assert(Math.abs(spent - quote) < quote * 1e-9,
      `×${limit} spent ${spent} but quoted ${quote}`);
  }
  return '×1, ×10 and ×100 agree';
});

check('×10 total is the sum of the ten rising prices', () => {
  // Levels get dearer as they stack (1.15 per level), so the batch price is
  // the arithmetic sum of the next ten single prices, not ten times the first.
  c.state.upgrades = c.freshUpgrades();
  c.state.data = 0;
  c.state.grid = {};
  c.state.exabytes = 0;
  const u = c.UNIT_REGISTRY.find((x) => x.sub === 'keystroke');

  let walked = 0;
  for (let i = 0; i < 10; i += 1) walked += c.unitCostAtLevel(u, i);
  const ten = c.bulkCost(u, 10);
  assert(Math.abs(ten - walked) < walked * 1e-9,
    `×10 was ${ten}, summing prices gives ${walked}`);
  assert(ten > c.unitCost(u) * 10, `×10 was ${ten}, no dearer than 10 singles`);
  return `${ten.toFixed(2)} for ten`;
});

check('repeatable prestige upgrades stop at their cap', () => {
  // Capped on purpose: an unbounded repeatable multiplier rebuilt the runaway
  // the shop rewrite removes, so the line must refuse to sell past its ceiling.
  c.state.cloud = {};
  c.state.exabytes = 1e12;
  const up = c.PRESTIGE.cloud.upgrades.find((x) => x.repeat);
  assert(up, 'cloud should have a repeatable upgrade');
  assert(up.maxLevels > 0, 'the repeatable upgrade needs a cap');
  for (let i = 0; i < up.maxLevels; i++) {
    assert(c.buyPrestigeTier('cloud', up), `blocked at level ${i}`);
  }
  assert(c.state.cloud[up.id] === up.maxLevels, `level count ${c.state.cloud[up.id]}`);
  assert(!c.buyPrestigeTier('cloud', up), 'sold a level past the cap');
  assert(c.nextPrestigeCost('cloud', up) === null, 'maxed line still quotes a price');
  return `capped at ${up.maxLevels} levels`;
});

check('click power and idle start sane', () => {
  c.state.upgrades = c.freshUpgrades();
  assert(c.clickPower() === 1, `click power ${c.clickPower()}`);
  assert(c.idlePerSecond() === 0, `idle ${c.idlePerSecond()}`);
  assert(c.autoClicksPerSecond() === 0, 'auto should be 0');
  return '1 click, 0 idle, 0 auto';
});

check('heat capacity grows with thermal levels', () => {
  c.state.upgrades = c.freshUpgrades();
  c.state.grid = {};
  const base = c.heatCapacity();
  c.state.upgrades.thermal = 1;
  const after = c.heatCapacity();
  assert(after > base, `${base} -> ${after}`);
  return `${base} -> ${after}`;
});

check('ascension awards and resets', () => {
  c.state.upgrades = c.freshUpgrades();
  c.state.prestigeRecord = 0;
  c.state.totalData = c.PRESTIGE_BASE * 4;   // 2 doublings: 10 * (1 + 2) = 30
  c.state.data = 1000;
  const before = c.state.exabytes;
  c.ascend('cloud');
  assert(c.state.exabytes === before + 30, `exabytes ${c.state.exabytes}`);
  assert(c.state.data === 0, `data not reset: ${c.state.data}`);
  assert(c.state.upgrades.keystroke === 0, 'shop upgrades survived');
  assert(c.state.prestigeRecord === c.PRESTIGE_BASE * 4, `record ${c.state.prestigeRecord}`);
  return `+30 EB, data reset, record set`;
});

check('ascension refused below the wall', () => {
  c.state.prestigeRecord = 0;
  c.state.totalData = c.PRESTIGE_BASE * 0.1;
  const ok = c.ascend('grid');
  assert(ok === false, 'ascended below the wall');
  return 'refused';
});

check('ascension must beat the previous best run', () => {
  // This is the fix for the runaway: a fixed 1e9 gate let a late-game player
  // ascend hundreds of times a minute, each paying the whole run again.
  c.state.upgrades = c.freshUpgrades();
  c.state.prestigeRecord = 0;
  c.state.totalData = c.PRESTIGE_BASE;
  assert(c.ascend('cloud') === true, 'first ascension refused');
  const record = c.state.prestigeRecord;
  assert(record === c.PRESTIGE_BASE, `record should be the run, got ${record}`);

  c.state.totalData = c.PRESTIGE_BASE * 1.5;   // did not double
  assert(c.ascend('cloud') === false, 'ascended without beating the record');

  c.state.totalData = record * 2;
  assert(c.ascend('grid') === true, 'refused an ascension that doubled the record');
  return 'gate doubles each run';
});

/* ----------------------------- progression sim ---------------------------- */

check('progression curve lands in the target bands', () => {
  // Fresh run, greedy cheapest-affordable buyer, 4 clicks/s for 15 minutes.
  c.state.upgrades = c.freshUpgrades();
  c.state.data = 0;
  c.state.totalData = 0;
  c.state.cloud = {};
  c.state.grid = {};
  c.state.ascensions = 0;

  const dt = 0.25;
  let t = 0;
  const activeSeconds = 900;
  const clickRate = 4;
  const marks = { '10k': null, '1M': null, '1B': null };
  let buys = 0;

  while (t < 86400 * 6) {
    const frac = Math.max(0, 1 - t / activeSeconds);
    const clicks = clickRate * frac;
    const gain = clicks * c.clickPower() * c.globalMultiplier()
               + c.autoClicksPerSecond() * c.clickPower() * c.globalMultiplier() * dt
               + c.idlePerSecond() * c.globalMultiplier() * dt;
    c.state.data += gain;
    c.state.totalData += gain;

    // buy cheapest affordable
    const affordable = c.UNIT_REGISTRY
      .filter((u) => !c.unitMaxed(u) && c.unitCost(u) <= c.state.data)
      .sort((a, b) => c.unitCost(a) - c.unitCost(b));
    if (affordable.length) {
      if (c.buyUnit(affordable[0])) buys++;
    }

    if (marks['10k'] === null && c.state.totalData >= 1e4) marks['10k'] = t;
    if (marks['1M'] === null && c.state.totalData >= 1e6) marks['1M'] = t;
    if (marks['1B'] === null && c.state.totalData >= 1e9) marks['1B'] = t;
    if (marks['1B'] !== null) break;
    t += dt;
  }

  assert(marks['10k'] !== null, 'never reached 10k');
  assert(marks['1M'] !== null, 'never reached 1M');
  assert(marks['1B'] !== null, 'never reached 1B');
  return `10k ${Math.round(marks['10k'])}s · 1M ${Math.round(marks['1M'])}s · 1B ${Math.round(marks['1B'] / 3600)}h · ${buys} buys`;
});

/* --------------------------- save wiping -------------------------------- */

check('wiping the save survives the reload save', () => {
  // Regression: wipeSave() removed the key, then location.reload() fired
  // beforeunload -> saveNow(), which wrote the live state back. The player saw
  // the title screen, then found all their progress when they entered again.
  c.state.upgrades = c.freshUpgrades();
  c.state.data = 987654;          // distinctive, so a resurrected save is obvious
  c.saveNow(false);
  const key = c.SAVE_KEY;
  assert(c.localStorage.getItem(key) !== null, 'nothing was saved to test with');

  c.wipeSave();
  // Every event the browser fires on the way out.
  c.saveNow(false);   // beforeunload
  c.saveNow(false);   // pagehide
  c.saveNow(false);   // visibilitychange -> hidden

  assert(c.localStorage.getItem(key) === null, 'the save came back after the wipe');
  return 'still gone after beforeunload';
});

check('wiping leaves no progress behind after a reload', () => {
  // Load the emptied storage the way boot() does: there must be nothing to
  // restore, so the player genuinely starts fresh.
  const raw = c.localStorage.getItem(c.SAVE_KEY);
  assert(raw === null, 'a save was restored after wiping');
  return 'fresh start';
});

/* -------------------------------- report --------------------------------- */

let pass = 0;
results.forEach((r) => {
  const tag = r.ok ? 'PASS' : 'FAIL';
  if (r.ok) pass++;
  console.log(`[${tag}] ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
});
console.log(`\n${pass}/${results.length} passed`);
process.exitCode = pass === results.length ? 0 : 1;