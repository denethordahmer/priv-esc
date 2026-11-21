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

  // Every section now lives on one screen. The two tabs that remain are a
  // split between the rig and the code, which is how the shop reads.
  wrap.innerHTML = '';
  [['hardware', '🔥', 'Rig'], ['software', '💻', 'Code']].forEach(([id, icon, label]) => {
    const btn = document.createElement('button');
    btn.className = `cat-tab ${id === activeCat ? 'is-active' : ''}`;
    btn.innerHTML = `<span class="cat-icon">${icon}</span><span>${label}</span>`;
    btn.addEventListener('click', () => {
      activeCat = id;
      renderUpgrades();
    });
    wrap.appendChild(btn);
  });
}

/* Which tab each section sits on, so the split stays even. */
const SECTION_TAB = {
  keystroke: 'hardware',
  daemon: 'hardware',
  thermal: 'hardware',
  reflex: 'hardware',
  exploit: 'software',
  compress: 'software',
  sleep: 'software',
  exodus: 'software',
};

function renderSubList() {
  const wrap = document.getElementById('sub-list');
  if (!wrap) return;

  const buyableOnly = state.settings.buyableOnly;
  wrap.innerHTML = '';

  UNIT_REGISTRY.forEach((unit) => {
    if (SECTION_TAB[unit.key] !== activeCat) return;
    if (buyableOnly && state.data < unitCost(unit)) return;
    wrap.appendChild(upgradeRow(unit));
  });
}

/** What one level of a section is worth, in the unit that section produces. */
function sectionEffectText(unit) {
  const eff = unit.eff;
  switch (unit.kind) {
    case 'mult': return `+${(eff * 100).toFixed(0)}% all output`;
    case 'cost': return `−${(eff * 100).toFixed(0)}% prices`;
    case 'heat': return `+${fmt(eff)} heat cap`;
    case 'click': return `+${fmt(eff)} per tap`;
    case 'offline': return `+${(eff * 100).toFixed(0)}% offline`;
    case 'auto': return `+${(eff).toFixed(1)} taps/s`;
    case 'prestige': return `+${(eff * 100).toFixed(0)}% ascension`;
    default: return `+${fmt(eff)} /s`;
  }
}

function upgradeRow(unit) {
  const level = ownedOf(unit.key);
  const cost = unitCost(unit);
  const affordable = state.data >= cost;

  const row = document.createElement('button');
  row.className = `up-row ${affordable ? 'is-affordable' : ''} ${level > 0 ? 'is-owned' : ''}`;
  row.dataset.unit = unit.key;

  // Milestone progress is the section's own ladder: 25, 50, 100, 200, 400,
  // 800. Showing the next one turns "keep buying" into a visible goal.
  const nextAt = nextSectionMilestone(unit);
  const gates = sectionMilestones(unit);
  const milestone = nextAt
    ? `<span class="up-milestone">NEXT ×2 at Lv ${nextAt}</span>`
    : `<span class="up-milestone is-done">ALL MILESTONES ×${Math.pow(2, gates)}</span>`;

  row.innerHTML = `
    <span class="up-name">${unit.name}</span>
    <span class="up-desc">${unit.desc}</span>
    <span class="up-meta">
      <span class="up-owned">Lv ${level}</span>
      <span class="up-effect">${sectionEffectText(unit)}</span>
      <span class="up-cost">${fmt(cost)}</span>
    </span>
    ${milestone}`;

  row.addEventListener('click', () => {
    const mult = buyMultiplier();
    if (mult === 1) {
      if (buyUnit(unit)) uiRender();
    } else if (buyMany(unit, mult) > 0) {
      uiRender();
    }
  });

  // Selling is a separate control so a tap on the row still buys.
  if (level > 0) {
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
      // The level cap is printed so a maxed line reads as finished, not broken.
      const total = owned * up.step;
      const shown = up.id === 'fabrication'
        ? `−${Math.round(Math.min(0.75, total) * 100)}% costs`
        : `+${Math.round(total * 100)}% Data`;
      const levelLabel = up.maxLevels ? `Lv ${owned}/${up.maxLevels}` : `Lv ${owned}`;
      row.innerHTML = `
        <span class="pr-name">${up.name}</span>
        <span class="pr-desc">${up.desc}</span>
        <span class="pr-tiers"><span class="pr-tier is-bought">${levelLabel}</span><span class="pr-tier">${shown}</span></span>
        <span class="pr-cost">${maxed ? 'MAX' : `${fmt(cost)} ${path.currency === 'Exabytes' ? 'EB' : 'GN'}`}</span>`;
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
      // Update the fields that move without rebuilding the rows, because a
      // rebuild between a pointerdown and its click would swallow the tap.
      // Rows are matched by unit key: the shop only shows the current tab, so
      // counting rows would point at the wrong section.
      document.querySelectorAll('#sub-list .up-row').forEach((row) => {
        const unit = UNITS_BY_KEY.get(row.dataset.unit);
        if (!unit) return;

        const level = ownedOf(unit.key);
        const cost = unitCost(unit);
        const affordable = state.data >= cost;
        row.classList.toggle('is-affordable', affordable);

        const ownedEl = row.querySelector('.up-owned');
        if (ownedEl) ownedEl.textContent = `Lv ${level}`;

        const costEl = row.querySelector('.up-cost');
        if (costEl) costEl.textContent = fmt(cost);

        const msEl = row.querySelector('.up-milestone');
        if (msEl) {
          const nextAt = nextSectionMilestone(unit);
          if (nextAt) {
            msEl.textContent = `NEXT ×2 at Lv ${nextAt}`;
            msEl.classList.remove('is-done');
          } else {
            msEl.textContent = `ALL MILESTONES ×${Math.pow(2, sectionMilestones(unit))}`;
            msEl.classList.add('is-done');
          }
        }
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

  // The title screen can be dismissed before boot() loads the save, so the
  // toggle is refreshed again after the game starts.
  window.refreshSoundToggle = () => {
    if (sound) sound.checked = state.settings.sound === true;
  };

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

  const panelButton = document.getElementById('btn-music-panel');
  const panel = document.getElementById('music-panel');
  const list = document.getElementById('music-list');
  const hint = document.getElementById('music-panel-hint');

  const paintTracks = () => {
    if (!list) return;
    const info = typeof musicState === 'function' ? musicState() : { tracks: [], selected: null };
    list.innerHTML = '';

    const row = (name, length, value) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.className = 'music-item';
      btn.type = 'button';
      btn.dataset.track = value || '';
      btn.setAttribute('role', 'option');
      const on = (info.selected || '') === (value || '');
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      btn.classList.toggle('is-active', on);

      const label = document.createElement('span');
      label.className = 'music-item-name';
      label.textContent = name;
      btn.appendChild(label);

      if (length) {
        const len = document.createElement('span');
        len.className = 'music-item-length';
        len.textContent = length;
        btn.appendChild(len);
      }

      btn.addEventListener('click', () => {
        setMusicTrack(value || null);
        if (hint) hint.textContent = value || 'Shuffle';
        paintTracks();
        saveNow(false);
      });

      li.appendChild(btn);
      list.appendChild(li);
    };

    row('Shuffle all', '', null);
    info.tracks.forEach((t) => row(t.name, t.length, t.name));

    if (hint) hint.textContent = info.selected || 'Shuffle';
  };

  if (panelButton && panel) {
    panelButton.addEventListener('click', () => {
      const open = panelButton.getAttribute('aria-expanded') === 'true';
      panelButton.setAttribute('aria-expanded', open ? 'false' : 'true');
      panel.hidden = open;
      if (!open) paintTracks();
    });

    // discoverTracks() is async, so the list is often empty at this point.
    // audio.js calls this again when the manifest has been read.
    window.refreshMusicPanel = paintTracks;

    const info = typeof musicState === 'function' ? musicState() : { selected: null };
    if (hint) hint.textContent = info.selected || 'Shuffle';
    paintTracks();
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