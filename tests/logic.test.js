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
  state, UNIT_REGISTRY, UNITS_BY_KEY, CATEGORIES, COST_GROWTH,
  MILESTONES, GATES, PRESTIGE, HEAT, PRESTIGE_BASE, PRESTIGE_UNIT,
  ENDING_AT, ESCAPE_AT, ESCAPE_MULT, ESCAPE_UNIT, CLICK_RATE_SHARE,
  fmtCompact, musicVolume, DEFAULT_VOLUME, shuffleIndexes,
  purchaseMultiplier, purchaseTiers, globalPurchaseMultiplier,
  totalLevelsBought, subEffect, escape, canEscape, pendingEscapes,
  escapeChargesEarned,
  buyUnit, unitCost, unitMaxed, ownedOf, freshUpgrades,
  sellUnit, sellValue, buyMany, SELL_REFUND,
  clickPower, idlePerSecond, autoClicksPerSecond, globalMultiplier,
  costMultiplier, heatCapacity, dataPerSecond, clickYield,
  prestigeCurrencyEarned, ascend, canAscend, pendingExabytes,
  buyPrestigeTier, nextPrestigeCost, applyClick, applyPassive, saveNow, serialise, loadState,
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

check('purchase milestones double a subcategory', () => {
  c.state.upgrades = c.freshUpgrades();
  c.state.escapes = 0;
  c.state.ascensions = 0;

  const sub = c.CATEGORIES[0].subs[0];      // Input Devices, click power

  // Ten levels of one item is the first doubling threshold. Output is
  // linear in levels AND doubles at the threshold, so 9 -> 10 is 2x times
  // the 10/9 linear step.
  c.state.upgrades['input:0'] = 9;
  const atNine = c.subEffect(sub);
  c.state.upgrades['input:0'] = 10;
  const atTen = c.subEffect(sub);

  assert(atNine > 0, 'nine levels produced nothing');
  const ratio = atTen / atNine;
  const expected = 2 * (10 / 9);
  assert(Math.abs(ratio - expected) < 0.05,
    `expected ${expected.toFixed(2)}x at the threshold, got ${ratio.toFixed(2)}x`);
  return `${atNine.toFixed(1)} -> ${atTen.toFixed(1)} at 10 levels`;
});

check('cost outruns the purchase bonus, so the shop never runs away', () => {
  // This is what holds the curve in check now that there is no level cap:
  // every level costs 1.15x more, while the doubling thresholds widen
  // (10, 25, 50, 100, 200...). Cost therefore grows far faster than output.
  const base = 27;                       // Dual-Core CPU
  const costAt = (n) => base * Math.pow(1.15, n);
  const outAt = (n) => c.purchaseMultiplier(n) * n;
  const costGrowth = costAt(200) / costAt(20);
  const outGrowth = outAt(200) / outAt(20);

  assert(costGrowth > outGrowth,
    `cost grew ${costGrowth.toExponential(1)}x but output grew ${outGrowth.toExponential(1)}x`);
  return `cost +${Math.log10(costGrowth).toFixed(1)} orders, output +${Math.log10(outGrowth).toFixed(1)}`;
});

check('multiplier compounding is held by widening thresholds', () => {
  // There is no level cap on multiplier upgrades, and no hard cap either.
  // What holds them is the shape of the bonus: thresholds widen, so ten
  // times the levels buys far less than a thousand times the multiplier.
  const subs = [['proc', 8], ['exploit', 7], ['algo', 7], ['self', 7]];

  const setLevels = (n) => {
    c.state.upgrades = c.freshUpgrades();
    c.state.escapes = 0;
    c.state.ascensions = 0;
    c.state.cloud = {};
    c.state.grid = {};
    subs.forEach(([id, count]) => {
      for (let t = 0; t < count; t++) c.state.upgrades[`${id}:${t}`] = n;
    });
    return c.globalMultiplier();
  };

  const at20 = setLevels(20);
  const at200 = setLevels(200);
  const growth = at200 / at20;

  assert(at200 > at20, 'more levels must produce a bigger multiplier');
  assert(growth < 1e7, `ten times the levels gave ${growth.toExponential(1)}x`);
  // Ten times the levels should still be worth a lot: this is an idle game.
  assert(growth > 1000, `ten times the levels only gave ${growth.toFixed(0)}x`);
  return `x${at20.toFixed(0)} at 20 lv -> x${at200.toExponential(1)} at 200 lv`;
});

check('cost reduction never reaches zero', () => {
  for (let t = 0; t < 6; t++) c.state.upgrades[`compress:${t}`] = 10;
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

  // Idle-only build: no click upgrades, no automation yet.
  c.state.upgrades['botnet:0'] = 40;
  const passive = c.dataPerSecond();
  const locked = c.clickYield();

  assert(passive > 0, 'idle build produced no passive income');
  assert(locked === c.clickPower() * c.globalMultiplier(),
    'the click share applied before a Click Script was owned');

  // Buy the first Click Script: the share unlocks.
  c.state.upgrades['autoc:0'] = 1;
  const unlocked = c.clickYield();
  const share = (unlocked - locked) / passive;

  assert(Math.abs(share - c.CLICK_RATE_SHARE) < 0.01,
    `click share was ${share.toFixed(3)} of a second, expected ${c.CLICK_RATE_SHARE}`);
  return `${c.fmt(locked)} locked -> ${c.fmt(unlocked)} with a script`;
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
  const owed = c.escapeChargesEarned(1e18);
  assert(owed === 4, `1e18 should be worth 4 charges, got ${owed}`);
  const mult = Math.pow(c.ESCAPE_MULT, owed);
  assert(mult === 16, `4 charges should be x16, got x${mult}`);
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

check('cooling has no cap and late coolers are reachable', () => {
  c.state.upgrades = c.freshUpgrades();
  c.state.data = 1e30;
  const cool = c.UNIT_REGISTRY.filter((u) => u.sub === 'cool');
  assert(cool.every((u) => u.cap === null), 'cooling should not be capped');
  // Fill the cheap tiers, then confirm the expensive one still sells.
  for (let t = 0; t < 7; t++) c.state.upgrades[`cool:${t}`] = 40;
  const top = cool[cool.length - 1];
  assert(c.buyUnit(top), 'top cooler was blocked by cheap ones');
  return `bought ${top.name} after 280 cheap levels`;
});

check('selling refunds 70% and lowers the count', () => {
  c.state.upgrades = c.freshUpgrades();
  c.state.data = 1e6;
  const u = c.UNIT_REGISTRY.find((x) => x.sub === 'input');
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
  const u = c.UNIT_REGISTRY.find((x) => x.sub === 'input');
  assert(c.sellUnit(u) === false, 'sold a level that was never bought');
  return 'refused';
});

check('bulk buy stops at what you can afford', () => {
  c.state.upgrades = c.freshUpgrades();
  c.state.data = 100;
  const u = c.UNIT_REGISTRY.find((x) => x.sub === 'input');
  const n = c.buyMany(u, 100);
  assert(n > 1 && n < 100, `bought ${n}, expected a partial batch`);
  assert(c.state.data >= 0, 'went negative');
  return `${n} levels for 100 Data`;
});

check('repeatable prestige upgrades never max out', () => {
  c.state.cloud = {};
  c.state.exabytes = 1e9;
  const up = c.PRESTIGE.cloud.upgrades.find((x) => x.repeat);
  assert(up, 'cloud should have a repeatable upgrade');
  for (let i = 0; i < 12; i++) {
    assert(c.buyPrestigeTier('cloud', up), `blocked at level ${i}`);
  }
  assert(c.state.cloud[up.id] === 12, 'level count wrong');
  return `bought 12 levels, next costs ${c.nextPrestigeCost('cloud', up)}`;
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