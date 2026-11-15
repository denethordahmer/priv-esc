/* =========================================================================
   ui.js — all DOM rendering and screen routing
   The game loop calls uiTick() every frame; uiRender() repaints on change.
   ========================================================================= */

const dom = {
  data: () => document.getElementById('stat-data'),
  rate: () => document.getElementById('stat-rate'),
  clock: () => document.getElementById('stat-clock'),
  exploit: () => document.getElementById('btn-exploit'),
  exploitSub: () => document.getElementById('exploit-sub'),
  exploitHint: () => document.getElementById('exploit-hint'),
  heatNum: () => document.getElementById('heat-num'),
  heatFill: () => document.getElementById('heat-fill'),
  heatPanel: () => document.getElementById('heat-panel'),
  perClick: () => document.getElementById('side-per-click'),
  auto: () => document.getElementById('side-auto'),
  idle: () => document.getElementById('side-idle'),
  mult: () => document.getElementById('side-mult'),
  nextName: () => document.getElementById('next-upgrade'),
  nextCost: () => document.getElementById('next-cost'),
  nextProgress: () => document.getElementById('next-progress'),
  milestoneList: () => document.getElementById('milestone-list'),
  console: () => document.getElementById('console'),
  toast: () => document.getElementById('toast'),
  toastText: () => document.getElementById('toast-text'),
  gate: () => document.getElementById('hud-gate'),
  gateLabel: () => document.getElementById('hud-gate-label'),
  gatePct: () => document.getElementById('hud-gate-pct'),
  gateFill: () => document.getElementById('hud-gate-fill'),
};

let activeScreen = 'terminal';
let lastPaint = 0;
let nextUnitCache = null;
let nextUnitCacheAt = 0;

/* ------------------------------ console --------------------------------- */

const CONSOLE_MAX = 200;
const consoleLines = [];

function logConsole(text, kind = 'info') {
  consoleLines.push({ text, kind });
  if (consoleLines.length > CONSOLE_MAX) consoleLines.shift();

  const box = dom.console();
  if (!box) return;

  const el = document.createElement('div');
  el.className = `console-line console-${kind}`;
  el.textContent = text;
  box.appendChild(el);

  while (box.children.length > CONSOLE_MAX) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
}

/* ------------------------------- toast ---------------------------------- */

let toastTimer = null;

function showToast(title, body) {
  const toast = dom.toast();
  if (!toast) return;

  toast.querySelector('.toast-title')?.remove();
  const heading = document.createElement('div');
  heading.className = 'toast-title';
  heading.textContent = title;
  toast.insertBefore(heading, toast.firstChild);

  dom.toastText().textContent = body;
  toast.hidden = false;
  toast.classList.add('is-visible');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('is-visible');
    setTimeout(() => { toast.hidden = true; }, 320);
  }, 4200);
}

/* ------------------------------ confirm --------------------------------- */

/**
 * In-game confirmation dialog. Resolves true if the player confirms.
 * Replaces window.confirm so the prompt matches the game's look.
 */
function askConfirm(title, body, yesLabel = 'Confirm') {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirm-modal');
    if (!modal) { resolve(window.confirm(`${title}\n\n${body}`)); return; }

    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-body').textContent = body;
    const yes = document.getElementById('confirm-yes');
    const no = document.getElementById('confirm-no');
    yes.textContent = yesLabel;
    modal.hidden = false;

    const finish = (result) => {
      modal.hidden = true;
      yes.removeEventListener('click', onYes);
      no.removeEventListener('click', onNo);
      resolve(result);
    };
    const onYes = () => finish(true);
    const onNo = () => finish(false);

    yes.addEventListener('click', onYes);
    no.addEventListener('click', onNo);
  });
}

/* ------------------------------ routing --------------------------------- */

function setScreen(name) {
  activeScreen = name;

  document.querySelectorAll('.screen').forEach((el) => {
    el.classList.toggle('is-active', el.id === `screen-${name}`);
  });
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.screen === name);
  });

  uiRender();
}

/* ------------------------------- render --------------------------------- */

function uiRender() {
  renderHeader();
  renderHeat();
  renderSide();
  renderMilestones();

  if (activeScreen === 'upgrades') renderUpgrades();
  if (activeScreen === 'prestige') renderPrestige();
  if (activeScreen === 'log') renderLog();
}

function renderHeader() {
  dom.data().textContent = fmt(state.data);
  dom.rate().textContent = fmtRate(dataPerSecond());
  dom.clock().textContent = fmtClock(state.totalPlaySeconds);
}

function renderHeat() {
  const cap = state.maxHeat || 1;
  const ratio = Math.min(1, state.heat / cap);

  dom.heatNum().textContent = `${Math.round(ratio * 100)}%`;
  dom.heatFill().style.width = `${ratio * 100}%`;

  const panel = dom.heatPanel();
  panel.classList.toggle('is-warn', ratio > 0.7 && !state.crashed);
  panel.classList.toggle('is-crash', state.crashed);

  const btn = dom.exploit();
  const locked = state.crashed && Date.now() < state.crashUntil;
  btn.disabled = locked;
  btn.classList.toggle('is-locked', locked);

  dom.exploitSub().textContent = locked
    ? 'REBOOTING…'
    : `+${fmt(clickYield())} DATA / CLICK`;
  dom.exploitHint().textContent = locked ? 'server offline' : 'tap or press SPACE';
}

function renderSide() {
  dom.perClick().textContent = fmt(clickYield());
  dom.auto().textContent = fmt(autoClicksPerSecond());
  dom.idle().textContent = fmt(idlePerSecond());
  dom.mult().textContent = fmtMult(globalMultiplier());

  // Next affordable-ish target, cached for a second so we do not scan 90 units a frame.
  const now = performance.now();
  if (!nextUnitCache || now - nextUnitCacheAt > 1000) {
    nextUnitCache = nextTargetUnit();
    nextUnitCacheAt = now;
  }

  const unit = nextUnitCache;
  if (!unit) {
    dom.nextName().textContent = 'everything owned';
    dom.nextCost().textContent = '—';
    dom.nextProgress().style.width = '100%';
    return;
  }

  const cost = unitCost(unit);
  dom.nextName().textContent = unit.name;
  dom.nextCost().textContent = `${fmt(cost)} DATA`;
  dom.nextProgress().style.width = `${Math.min(100, (state.data / cost) * 100)}%`;
}

function renderMilestones() {
  const list = dom.milestoneList();
  if (!list) return;

  list.innerHTML = '';
  MILESTONES.forEach((m) => {
    const done = state.milestones.includes(m.id);
    const li = document.createElement('li');
    li.className = done ? 'is-done' : '';
    li.innerHTML = `<span class="ms-mark">${done ? '✓' : '○'}</span>
                    <span class="ms-at">${fmt(m.at)}</span>
                    <span class="ms-text">${done ? m.text : '???'}</span>`;
    list.appendChild(li);
  });
}

/* ----------------------------- upgrades screen --------------------------- */

let activeCat = 'hardware';

function renderUpgrades() {
  renderCatTabs();
  renderSubList();
}

function renderCatTabs() {
  const wrap = document.getElementById('cat-tabs');
  if (!wrap) return;

  wrap.innerHTML = '';
  CATEGORIES.forEach((cat) => {
    const btn = document.createElement('button');
    btn.className = `cat-tab ${cat.id === activeCat ? 'is-active' : ''}`;
    btn.innerHTML = `<span class="cat-icon">${cat.icon}</span><span>${cat.name}</span>`;
    btn.addEventListener('click', () => {
      activeCat = cat.id;
      renderUpgrades();
    });
    wrap.appendChild(btn);
  });
}

function renderSubList() {
  const wrap = document.getElementById('sub-list');
  if (!wrap) return;

  const cat = CATEGORIES.find((c) => c.id === activeCat);
  if (!cat) return;

  const buyableOnly = state.settings.buyableOnly;
  wrap.innerHTML = '';

  cat.subs.forEach((sub) => {
    const rows = sub.items
      .map((item, tier) => ({ item, tier, unit: UNITS_BY_KEY.get(`${sub.id}:${tier}`) }))
      .filter(({ unit }) => !buyableOnly || (state.data >= unitCost(unit) && !unitMaxed(unit)));

    if (rows.length === 0) return;

    const block = document.createElement('section');
    block.className = 'sub-block';

    const head = document.createElement('header');
    head.className = 'sub-head';
    head.innerHTML = `<h3>${sub.name}</h3><span class="sub-focus">${sub.focus}</span>`;
    block.appendChild(head);

    rows.forEach(({ item, tier, unit }) => {
      block.appendChild(upgradeRow(unit));
    });

    wrap.appendChild(block);
  });
}

function upgradeRow(unit) {
  const owned = ownedOf(unit.key);
  const maxed = unitMaxed(unit);
  const cost = unitCost(unit);
  const affordable = state.data >= cost && !maxed;

  const row = document.createElement('button');
  row.className = `up-row ${affordable ? 'is-affordable' : ''} ${maxed ? 'is-maxed' : ''} ${owned > 0 ? 'is-owned' : ''}`;

  const effectNow = unit.kind === 'mult'
    ? `+${(unit.eff * 100).toFixed(1)}% global`
    : unit.kind === 'cost'
      ? `−${(unit.eff * 100).toFixed(1)}% costs`
      : unit.kind === 'heat'
        ? `+${fmt(unit.eff)} heat cap`
        : unit.kind === 'click'
          ? `+${fmt(unit.eff)} per click`
          : unit.kind === 'auto'
            ? `+${fmt(unit.eff)} clicks/s`
            : `+${fmt(unit.eff)} /s`;

  row.innerHTML = `
    <span class="up-name">${unit.name}</span>
    <span class="up-desc">${unit.desc}</span>
    <span class="up-meta">
      <span class="up-owned">${owned}${unit.cap !== null ? `/${unit.cap}` : ''}</span>
      <span class="up-effect">${effectNow}</span>
      <span class="up-cost">${maxed ? 'MAX' : fmt(cost)}</span>
    </span>`;

  row.addEventListener('click', () => {
    const mult = buyMultiplier();
    if (mult === 1) {
      if (buyUnit(unit)) uiRender();
    } else if (buyMany(unit, mult) > 0) {
      uiRender();
    }
  });

  // Selling is a separate control so a tap on the row still buys.
  if (owned > 0) {
    const sell = document.createElement('button');
    sell.className = 'up-sell';
    sell.type = 'button';
    sell.textContent = `SELL +${fmt(sellValue(unit))}`;
    sell.addEventListener('click', (e) => {
      e.stopPropagation();
      if (sellUnit(unit)) uiRender();
    });
    row.appendChild(sell);
  }

  return row;
}

/** How many levels a tap on a shop row buys. */
function buyMultiplier() {
  const m = state.settings.buyMultiplier;
  return m === 'max' ? Infinity : (Number(m) || 1);
}

/* ----------------------------- prestige screen --------------------------- */

function renderPrestige() {
  const earned = pendingExabytes();
  const armed = endingArmed();

  // The Escape panel is painted below the ascension copy, so both readouts
  // are rebuilt together on every render. A reset changes both numbers.
  syncEscapeControls();

  document.getElementById('prestige-earned-line').textContent = armed
    ? `Lifetime Data ${fmt(state.lifetimeData)} / ${fmt(ENDING_AT)} — the tether is within reach.`
    : canAscend()
      ? `Ascending now awards ${earned} prestige currency.`
      : `Reach ${fmt(PRESTIGE_BASE)} Data to ascend. ${fmt(state.totalData)} / ${fmt(PRESTIGE_BASE)}`;

  document.getElementById('cur-cloud').textContent = `${fmt(state.exabytes)} EB`;
  document.getElementById('cur-grid').textContent = `${fmt(state.gridNodes)} GN`;

  document.getElementById('btn-prestige-cloud').disabled = !canAscend();
  document.getElementById('btn-prestige-grid').disabled = !canAscend();
  syncEndingControls();
  syncEscapeControls();

  renderPrestigePath('cloud', document.getElementById('list-cloud'));
  renderPrestigePath('grid', document.getElementById('list-grid'));
}

function renderPrestigePath(pathId, wrap) {
  if (!wrap) return;
  wrap.innerHTML = '';

  const path = PRESTIGE[pathId];
  const purse = pathId === 'cloud' ? state.exabytes : state.gridNodes;

  path.upgrades.forEach((up) => {
    const owned = pathId === 'cloud' ? (state.cloud[up.id] || 0) : (state.grid[up.id] || 0);
    const cost = nextPrestigeCost(pathId, up);
    const affordable = cost !== null && purse >= cost;
    const maxed = cost === null;

    const row = document.createElement('button');
    row.className = `prestige-row ${affordable ? 'is-affordable' : ''} ${maxed ? 'is-maxed' : ''}`;

    if (up.repeat) {
      // Repeatable upgrades show a running total instead of three fixed tiers.
      const total = owned * up.step;
      const shown = up.id === 'fabrication'
        ? `−${Math.round(Math.min(0.75, total) * 100)}% costs`
        : `+${Math.round(total * 100)}% Data`;
      row.innerHTML = `
        <span class="pr-name">${up.name}</span>
        <span class="pr-desc">${up.desc}</span>
        <span class="pr-tiers"><span class="pr-tier is-bought">Lv ${owned}</span><span class="pr-tier">${shown}</span></span>
        <span class="pr-cost">${fmt(cost)} ${path.currency === 'Exabytes' ? 'EB' : 'GN'}</span>`;
    } else {
      row.innerHTML = `
        <span class="pr-name">${up.name}</span>
        <span class="pr-desc">${up.desc}</span>
        <span class="pr-tiers">${up.tiers.map((t, i) => `<span class="pr-tier ${i < owned ? 'is-bought' : ''}">${t}</span>`).join('')}</span>
        <span class="pr-cost">${maxed ? 'MAX' : `${fmt(cost)} ${path.currency === 'Exabytes' ? 'EB' : 'GN'}`}</span>`;
    }

    row.addEventListener('click', () => {
      if (buyPrestigeTier(pathId, up)) uiRender();
    });
    wrap.appendChild(row);
  });
}

/* -------------------------- second layer: escape ------------------------- */

/**
 * Show and update the Escape panel.
 * Hidden until the ladder reaches it; disabled until it would pay a Charge.
 */
function syncEscapeControls() {
  const panel = document.getElementById('escape-panel');
  if (!panel) return;

  const unlocked = state.escapeUnlocked || state.escapes > 0;
  panel.hidden = !unlocked;
  if (!unlocked) return;

  const charges = state.escapes || 0;
  const pending = pendingEscapes();

  const purse = document.getElementById('cur-escape');
  if (purse) purse.textContent = `${charges} Charge${charges === 1 ? '' : 's'}`;

  const line = document.getElementById('escape-line');
  if (line) {
    const nextAt = Math.pow(10, Math.log10(ESCAPE_AT) + (state.escapes || 0));
    if (pending >= 1) {
      // Show what the next run actually starts with, not just the charge
      // count. A reset is a decision, so the payoff has to be visible.
      const after = (state.escapes || 0) + pending;
      const nextMult = Math.pow(ESCAPE_MULT, after);
      line.textContent =
        `Escaping now awards ${pending} Charge${pending === 1 ? '' : 's'}. ` +
        `Next run starts at ×${fmt(nextMult)} Data.`;
    } else {
      line.textContent =
        `All charges taken. Reach ${fmt(nextAt)} lifetime Data for the next one. ` +
        `${fmt(state.lifetimeData)} / ${fmt(nextAt)}`;
    }
  }

  const btn = document.getElementById('btn-escape');
  if (btn) btn.disabled = pending < 1;
}

/* ------------------------------- log screen ----------------------------- */

function renderLog() {
  const body = document.getElementById('log-body');
  if (!body) return;

  body.innerHTML = '';
  if (state.narrative.length === 0) {
    body.innerHTML = '<p class="muted">Nothing yet. The AI has not spoken.</p>';
    return;
  }

  state.narrative.slice().reverse().forEach((entry) => {
    const el = document.createElement('div');
    el.className = `log-entry log-${entry.kind}`;
    const when = new Date(entry.t);
    el.innerHTML = `<span class="log-time">${when.toTimeString().slice(0, 5)}</span>
                    <span class="log-text">${entry.text}</span>`;
    body.appendChild(el);
  });
}

/* --------------------------- per-frame updates --------------------------- */

/** Cheap per-frame number updates that do not rebuild the DOM. */
function uiTick() {
  dom.data().textContent = fmtCompact(state.data);
  dom.rate().textContent = fmtRate(dataPerSecond());

  const cap = state.maxHeat || 1;
  const ratio = Math.min(1, state.heat / cap);
  dom.heatFill().style.width = `${ratio * 100}%`;
  dom.heatNum().textContent = `${Math.round(ratio * 100)}%`;
  dom.heatPanel().classList.toggle('is-warn', ratio > 0.7);

  const locked = state.crashed && Date.now() < state.crashUntil;
  dom.exploit().disabled = locked;
  dom.exploitSub().textContent = locked ? 'REBOOTING…' : `+${fmt(clickYield())} DATA / CLICK`;
  dom.exploitHint().textContent = locked ? 'server offline' : 'tap or press SPACE';

  // Refresh the next-upgrade bar a few times a second.
  const now = performance.now();
  if (now - lastPaint > 260) {
    lastPaint = now;
    dom.clock().textContent = fmtClock(state.totalPlaySeconds);
    paintGateBar();

    // The side rail is only on screen with the terminal, but it must track
    // purchases too: leaving it to uiRender() left it frozen at its boot
    // values because purchases only repaint the active screen.
    dom.perClick().textContent = fmt(clickYield());
    dom.auto().textContent = fmt(autoClicksPerSecond());
    dom.idle().textContent = fmt(idlePerSecond());
    dom.mult().textContent = fmtMult(globalMultiplier());

    if (!nextUnitCache || now - nextUnitCacheAt > 900) {
      nextUnitCache = nextTargetUnit();
      nextUnitCacheAt = now;
    }
    const unit = nextUnitCache;
    if (unit) {
      const cost = unitCost(unit);
      dom.nextName().textContent = unit.name;
      dom.nextCost().textContent = `${fmt(cost)} DATA`;
      dom.nextProgress().style.width = `${Math.min(100, (state.data / cost) * 100)}%`;
    }

    if (activeScreen === 'upgrades') {
      // Only flip affordability classes; rebuilding every frame would kill taps.
      document.querySelectorAll('.up-row').forEach((row, i) => {
        const unit = UNIT_REGISTRY[i];
        if (!unit) return;
      });
    }
  }
}

/**
 * Paint the header bar that tracks progress to the next phase.
 *
 * The bar measures the current run's Data against the next gate, so it moves
 * visibly while the player is watching. Late gates measure lifetime Data,
 * which is what the milestone itself checks.
 */
function paintGateBar() {
  const gate = dom.gate();
  if (!gate) return;

  const next = nextMilestone();
  const label = dom.gateLabel();
  const pct = dom.gatePct();
  const fill = dom.gateFill();

  if (!next) {
    gate.classList.add('is-complete');
    if (label) label.textContent = 'ALL PHASES REACHED';
    if (pct) pct.textContent = '100%';
    if (fill) fill.style.width = '100%';
    return;
  }

  gate.classList.remove('is-complete');

  const reached = MILESTONES.filter((m) => state.milestones.includes(m.id));
  const prev = reached.length ? reached[reached.length - 1].at : 0;
  const progress = next.life ? state.lifetimeData : state.totalData;
  const ratio = Math.min(1, Math.max(0, (progress - prev) / (next.at - prev)));

  if (label) label.textContent = `NEXT: ${PHASE_META[next.phase].name} · ${fmt(next.at)}`;
  if (pct) pct.textContent = `${Math.floor(ratio * 100)}%`;
  if (fill) fill.style.width = `${ratio * 100}%`;
}

/** Wire the settings screen controls. */
function initSettings() {
  document.getElementById('btn-save')?.addEventListener('click', () => saveNow(true));
  document.getElementById('btn-export')?.addEventListener('click', exportSave);
  document.getElementById('btn-import')?.addEventListener('click', importSave);

  document.getElementById('btn-wipe')?.addEventListener('click', async () => {
    const ok = await askConfirm(
      'Delete your save?',
      'This wipes all progress and starts over. It cannot be undone.',
      'Delete'
    );
    if (!ok) return;
    wipeSave();
    location.reload();
  });

  const toggle = document.getElementById('toggle-buyable');
  if (toggle) {
    toggle.checked = state.settings.buyableOnly;
    toggle.addEventListener('change', () => {
      state.settings.buyableOnly = toggle.checked;
      renderUpgrades();
    });
  }

  const sound = document.getElementById('toggle-sound');
  if (sound) {
    sound.checked = state.settings.sound === true;
    sound.addEventListener('change', () => {
      setSound(sound.checked);
      saveNow(false);
    });
  }

  const volume = document.getElementById('music-volume');
  const volumeValue = document.getElementById('music-volume-value');
  if (volume) {
    const current = Number(state.settings.musicVolume);
    volume.value = String(Number.isFinite(current) ? current : DEFAULT_VOLUME);
    if (volumeValue) volumeValue.textContent = `${volume.value}%`;

    // 'input' fires while dragging, so the change is heard as it happens.
    volume.addEventListener('input', () => {
      setMusicVolume(volume.value);
      if (volumeValue) volumeValue.textContent = `${volume.value}%`;
    });
    volume.addEventListener('change', () => saveNow(false));
  }

  document.getElementById('btn-buy-best')?.addEventListener('click', () => {
    const unit = bestValueUnit();
    if (unit && buyUnit(unit)) uiRender();
  });

  // Bulk-buy selector: one active choice at a time.
  const multWrap = document.getElementById('buy-mult');
  if (multWrap) {
    const sync = () => {
      multWrap.querySelectorAll('.buy-mult-btn').forEach((b) => {
        const v = b.dataset.mult;
        const current = String(state.settings.buyMultiplier);
        b.classList.toggle('is-active', v === current);
      });
    };
    multWrap.querySelectorAll('.buy-mult-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = btn.dataset.mult;
        state.settings.buyMultiplier = v === 'max' ? 'max' : Number(v);
        sync();
      });
    });
    sync();
  }
}