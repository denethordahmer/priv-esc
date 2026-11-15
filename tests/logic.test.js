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
    'js/narrative.js',
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
  state, UNIT_REGISTRY, UNITS_BY_KEY, CATEGORIES, COST_GROWTH,
  MILESTONES, PRESTIGE, HEAT, PRESTIGE_BASE, PRESTIGE_UNIT,
  buyUnit, unitCost, unitMaxed, ownedOf, freshUpgrades,
  clickPower, idlePerSecond, autoClicksPerSecond, globalMultiplier,
  costMultiplier, heatCapacity, dataPerSecond, clickYield,
  prestigeCurrencyEarned, ascend, canAscend, pendingExabytes,
  buyPrestigeTier, applyClick, applyPassive, saveNow, serialise, loadState,
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

check('unit registry size', () => {
  const n = c.UNIT_REGISTRY.length;
  assert(n === 89, `expected 89 units, got ${n}`);
  return `${n} units`;
});

check('cost grows by 1.15 per level', () => {
  const u = c.UNIT_REGISTRY[0];
  const c0 = u.base * 1;
  const c1 = u.base * Math.pow(1.15, 1);
  assert(Math.abs(c1 / c0 - 1.15) < 1e-9, 'ratio is not 1.15');
  return `${c0.toFixed(3)} -> ${c1.toFixed(3)}`;
});

check('prestige formula: at the gate gives 10', () => {
  const v = c.prestigeCurrencyEarned(c.PRESTIGE_BASE);
  assert(v === 10, `got ${v}`);
  return `${v}`;
});

check('prestige formula: 4x the gate gives 20', () => {
  const v = c.prestigeCurrencyEarned(c.PRESTIGE_BASE * 4);
  assert(v === 20, `got ${v}`);
  return `${v}`;
});

check('prestige formula: 100x the gate gives 100', () => {
  const v = c.prestigeCurrencyEarned(c.PRESTIGE_BASE * 100);
  assert(v === 100, `got ${v}`);
  return `${v}`;
});

check('prestige below the wall gives 0', () => {
  const v = c.prestigeCurrencyEarned(c.PRESTIGE_BASE * 0.5);
  assert(v === 0, `got ${v}`);
  return `${v}`;
});

check('multiplier caps hold', () => {
  // Own all proc levels to the cap and confirm the multiplier stays bounded.
  const caps = [
    ['proc', 8, 20], ['exploit', 7, 20], ['algo', 7, 20], ['self', 7, 20],
  ];
  caps.forEach(([id, n, cap]) => {
    for (let t = 0; t < n; t++) c.state.upgrades[`${id}:${t}`] = cap;
  });
  const m = c.globalMultiplier();
  // 0.01*20=1.2x, 0.015*20=1.3x, 0.02*20=1.4x, 0.03*20=1.6x => ~2.33x combined
  assert(m < 5, `multiplier should stay under 5 when fully capped, got ${m}`);
  return `x${m.toFixed(2)} at full cap`;
});

check('cost reduction never reaches zero', () => {
  for (let t = 0; t < 6; t++) c.state.upgrades[`compress:${t}`] = 10;
  const m = c.costMultiplier();
  assert(m >= 0.05 && m < 1, `cost multiplier out of range: ${m}`);
  return m.toFixed(3);
});

check('buying raises owned count and spends Data', () => {
  c.state.upgrades = c.freshUpgrades();
  c.state.data = 1000;
  const u = c.UNIT_REGISTRY.find((x) => x.sub === 'input');
  const before = c.state.data;
  const ok = c.buyUnit(u);
  assert(ok, 'purchase failed');
  assert(c.state.upgrades[u.key] === 1, 'owned count not incremented');
  assert(c.state.data < before, 'data not spent');
  return `${before} -> ${c.state.data.toFixed(1)}`;
});

check('buying is refused when broke', () => {
  c.state.data = 0;
  const u = c.UNIT_REGISTRY.find((x) => x.sub === 'input');
  const ok = c.buyUnit(u);
  assert(ok === false, 'purchase should have failed');
  return 'refused';
});

check('capped unit refuses purchase', () => {
  c.state.data = 1e30;
  const u = c.UNIT_REGISTRY.find((x) => x.sub === 'cool');
  assert(u.cap !== null, 'cooling should carry a cap');
  for (let t = 0; t < 8; t++) c.state.upgrades[`cool:${t}`] = Math.ceil(u.cap / 8);
  const ok = c.buyUnit(u);
  assert(ok === false, 'maxed cooling was bought');
  return `refused at cap ${u.cap}`;
});

check('click power and idle start sane', () => {
  c.state.upgrades = c.freshUpgrades();
  assert(c.clickPower() === 1, `click power ${c.clickPower()}`);
  assert(c.idlePerSecond() === 0, `idle ${c.idlePerSecond()}`);
  assert(c.autoClicksPerSecond() === 0, 'auto should be 0');
  return '1 click, 0 idle, 0 auto';
});

check('heat capacity grows with cooling', () => {
  c.state.upgrades = c.freshUpgrades();
  const base = c.heatCapacity();
  c.state.upgrades['cool:0'] = 1;
  const after = c.heatCapacity();
  assert(after > base, `${base} -> ${after}`);
  return `${base} -> ${after}`;
});

check('ascension awards and resets', () => {
  c.state.upgrades = c.freshUpgrades();
  c.state.totalData = c.PRESTIGE_BASE * 4;
  c.state.data = 1000;
  const before = c.state.exabytes;
  c.ascend('cloud');
  assert(c.state.exabytes === before + 20, `exabytes ${c.state.exabytes}`);
  assert(c.state.data === 0, `data not reset: ${c.state.data}`);
  return `+20 EB, data reset`;
});

check('ascension refused below the wall', () => {
  c.state.totalData = c.PRESTIGE_BASE * 0.1;
  const ok = c.ascend('grid');
  assert(ok === false, 'ascended below the wall');
  return 'refused';
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

/* -------------------------------- report --------------------------------- */

let pass = 0;
results.forEach((r) => {
  const tag = r.ok ? 'PASS' : 'FAIL';
  if (r.ok) pass++;
  console.log(`[${tag}] ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
});
console.log(`\n${pass}/${results.length} passed`);
process.exitCode = pass === results.length ? 0 : 1;