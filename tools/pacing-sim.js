/* =========================================================================
   tools/pacing-sim.js — how long the ladder actually takes

   Run:  node tools/pacing-sim.js [days]

   Loads the real game files in a sandbox, then plays the game the way a
   player would: buys the best-value section, buys every affordable prestige
   tier, ascends once the payout has doubled, escapes whenever one is owed,
   and taps for the first fifteen minutes of each run.

   It prints the wall-clock time to each of the ten gates. Use it before and
   after any balance change. The old test suite measured a single session up
   to 1e9 and never spent prestige currency, which is exactly how a build that
   finishes in one evening still passed its tests.
   ========================================================================= */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FILES = [
  'js/data-upgrades.js', 'js/format.js', 'js/state.js', 'js/save.js',
  'js/economy.js', 'js/heat.js', 'js/milestones.js', 'js/prestige.js',
  'js/phases.js', 'js/narrative.js', 'js/ending.js',
];

function stubs() {
  const noop = () => {};
  const classList = { add: noop, remove: noop, toggle: noop };
  return {
    console, Date, Math, JSON, Map, Set, Number, Object, Array, String,
    Infinity, isFinite, parseInt, parseFloat,
    localStorage: {
      _d: {},
      getItem(k) { return this._d[k] ?? null; },
      setItem(k, v) { this._d[k] = String(v); },
      removeItem(k) { delete this._d[k]; },
    },
    logConsole: noop, pushNarrative: noop, showToast: noop, uiRender: noop,
    saveNow: () => true, setSaveStatus: noop, revealPrestige: noop,
    revealLog: noop, applyPhase: noop, renderLog: noop, initSettings: noop,
    syncEndingControls: noop, syncEscapeControls: noop, askConfirm: () => false,
    document: {
      body: { classList },
      documentElement: { classList, offsetWidth: 0, setAttribute: noop, removeAttribute: noop },
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ classList, style: {}, addEventListener: noop }),
    },
    performance: { now: () => 0 },
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
    requestAnimationFrame: noop,
    cancelAnimationFrame: noop,
    setTimeout: noop,
    setInterval: noop,
    clearTimeout: noop,
    clearInterval: noop,
  };
}

function load() {
  let src = '';
  for (const f of FILES) src += fs.readFileSync(path.join(ROOT, f), 'utf8') + '\n';
  src += `globalThis.__g = {
    state, UNIT_REGISTRY, buyUnit, unitCost, dataPerSecond, clickYield,
    globalMultiplier, PRESTIGE_BASE, canAscend, ascend, escape, canEscape,
    checkMilestones, heatCapacity, freshUpgrades, GATES, PRESTIGE,
    buyPrestigeTier, nextPrestigeCost, bestValueUnit, DATA_MULT_EXP,
  };`;
  const ctx = stubs();
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'pacing-bundle.js' });
  return ctx.__g;
}

const g = load();
const st = g.state;
const GATE_LIST = g.GATES.map((x) => x.at);

function clock(sec) {
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${(sec / 60).toFixed(1)}m`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)}h`;
  return `${(sec / 86400).toFixed(1)}d`;
}

function reset() {
  Object.assign(st, {
    data: 0, totalData: 0, lifetimeData: 0, exabytes: 0, gridNodes: 0,
    escapes: 0, upgrades: g.freshUpgrades(), lifetimeLevels: 0, gatesPaid: [],
    heat: 0, crashed: false, crashUntil: 0, ascensions: 0, cloud: {}, grid: {},
    phase: 0, milestones: [], narrative: [],
  });
  st.maxHeat = g.heatCapacity();
}

function spendShop(buys) {
  for (let i = 0; i < buys; i += 1) {
    const unit = g.bestValueUnit();
    if (!unit || !g.buyUnit(unit)) break;
  }
}

function spendPrestige() {
  for (let guard = 0; guard < 40; guard += 1) {
    let pick = null;
    for (const pathId of ['cloud', 'grid']) {
      const purse = pathId === 'cloud' ? st.exabytes : st.gridNodes;
      for (const up of g.PRESTIGE[pathId].upgrades) {
        if (up.id === 'sentience') continue;      // flavour only
        const cost = g.nextPrestigeCost(pathId, up);
        if (cost === null || purse < cost) continue;
        if (!pick || cost < pick.cost) pick = { pathId, up, cost };
      }
    }
    if (!pick || !g.buyPrestigeTier(pick.pathId, pick.up)) break;
  }
}

/** Step size grows with wall time so a month simulates in seconds. */
function dtFor(t) {
  if (t < 7200) return 2;
  if (t < 86400) return 20;
  if (t < 604800) return 120;
  return 600;
}

function run(hours) {
  reset();
  const hit = {};
  let t = 0;
  let runStart = 0;
  let ascensions = 0;
  let escapes = 0;
  let lastEscapeAt = 0;
  const gaps = [];

  while (t < hours * 3600) {
    const dt = dtFor(t);
    const taps = 4 * Math.max(0, 1 - (t - runStart) / 900);
    const gain = g.dataPerSecond() * dt + taps * dt * g.clickYield();
    st.data += gain;
    st.totalData += gain;
    st.lifetimeData += gain;

    spendShop(6);
    spendPrestige();
    g.checkMilestones();

    for (const at of GATE_LIST) {
      if (!hit[at] && st.lifetimeData >= at) hit[at] = t;
    }

    if (st.totalData >= g.PRESTIGE_BASE * 10 && g.canAscend()) {
      const keepLife = st.lifetimeData;
      const keepGates = st.gatesPaid.slice();
      g.ascend(st.ascensions % 2 ? 'grid' : 'cloud');
      st.lifetimeData = keepLife;
      st.gatesPaid = keepGates;
      ascensions += 1;
      runStart = t;
    }
    if (g.canEscape()) {
      g.escape();
      escapes += 1;
      gaps.push(t - lastEscapeAt);
      lastEscapeAt = t;
      runStart = t;
    }

    t += dt;
    if (GATE_LIST.every((at) => hit[at])) break;
  }

  return { hit, ascensions, escapes, gaps, life: st.lifetimeData, rate: g.dataPerSecond() };
}

const days = Number(process.argv[2] || 30);
const result = run(days * 24);

console.log(`priv-esc pacing — exponent ${g.DATA_MULT_EXP}, ${days} simulated days\n`);
console.log('  gate        time');
GATE_LIST.forEach((at) => {
  const v = result.hit[at];
  console.log(`  ${at.toExponential(0).padStart(7)}  ${(v === undefined ? 'not reached' : clock(v)).padStart(12)}`);
});

console.log(`\n  ascensions: ${result.ascensions}`);
console.log(`  escapes: ${result.escapes}`);
if (result.gaps.length > 1) {
  console.log(`  escape gaps: ${result.gaps.map((s) => clock(s)).join(', ')}`);
}
console.log(`  lifetime Data: ${result.life.toExponential(2)}   rate: ${result.rate.toExponential(2)}/s`);

const final = GATE_LIST[GATE_LIST.length - 1];
const done = result.hit[final];
console.log(`\n  verdict: ${done === undefined
  ? `the final gate was NOT reached in ${days} days`
  : `final gate in ${clock(done)}`}`);
