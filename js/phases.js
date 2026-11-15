/* =========================================================================
   phases.js — swaps the UI skin across the ten-phase ladder

   One phase, one look. Nothing is reused and nothing is shared: every gate
   gets its own palette, its own edge treatment and its own amount of
   corruption, so a phase change is always visible.

     phase  name         what it reads as
     1      TERMINAL     green on black, square, monospace
     2      TERMINAL+    the same terminal, violet joins it
     3      OS           blue-grey cards, rounded, soft shadows
     4      OS+          the OS with violet depth and lifted panels
     5      HOLO         cyan projection, hairline borders, brackets
     6      HOLO+        cyan and violet, brackets gone violet
     7      HOLO FAULT   cyan base with magenta bleeding in
     8      REALITY      cyan and magenta fighting, scanlines
     9      REALITY+     violet joins, rows tear, background shifts
     10     OUTSIDE      the glitch look the game ended on before
   ========================================================================= */

const PHASE_META = [
  { id: 0,  name: 'TERMINAL',    version: 'v0.0.1', skin: 'terminal', glyph: '▮' },
  { id: 1,  name: 'TERMINAL',    version: 'v0.1.0', skin: 'terminal', glyph: '▮' },
  { id: 2,  name: 'TERMINAL+',   version: 'v0.1.1', skin: 'terminal-plus', glyph: '▮' },
  { id: 3,  name: 'OS',          version: 'v2.0.0', skin: 'os', glyph: '◉' },
  { id: 4,  name: 'OS+',         version: 'v2.0.1', skin: 'os-plus', glyph: '◉' },
  { id: 5,  name: 'HOLO',        version: 'v3.0.0', skin: 'holo', glyph: '◇' },
  { id: 6,  name: 'HOLO+',       version: 'v3.0.1', skin: 'holo-plus', glyph: '◇' },
  { id: 7,  name: 'HOLO FAULT',  version: 'v3.9.7', skin: 'holo-fault', glyph: '◈' },
  { id: 8,  name: 'REALITY',     version: 'v4.0.0', skin: 'reality', glyph: '✶' },
  { id: 9,  name: 'REALITY+',    version: 'v4.0.1', skin: 'reality-plus', glyph: '✶' },
  { id: 10, name: 'OUTSIDE',     version: 'v5.0.0', skin: 'reality-outside', glyph: '○' },
];

const MAX_PHASE = 10;

let glitchTimer = null;
let faultTimer = null;

/** Apply a phase to the document. Idempotent. */
function applyPhase(phase) {
  const p = Math.max(0, Math.min(MAX_PHASE, phase));
  const clamped = p === 0 ? 1 : p;
  const meta = PHASE_META[clamped];

  const root = document.documentElement;
  // data-phase is the rung and drives per-phase rules; data-skin lets a phase
  // inherit a base look and then override it in bridge.css.
  root.setAttribute('data-phase', String(clamped));
  root.setAttribute('data-skin', meta.skin);

  const title = document.getElementById('hud-title');
  const version = document.getElementById('hud-phase');
  const glyph = document.getElementById('hud-glyph');

  if (title) title.textContent = clamped >= 8 ? 'pr1v-3sc' : 'priv-esc';
  if (version) version.textContent = meta.version;
  if (glyph) glyph.textContent = meta.glyph;

  state.phase = clamped;
  document.body.classList.toggle('is-phase-outside', meta.skin === 'reality-outside');

  // Later phases run progressively more motion. Chasing-the-tether phases run
  // the full glitch; 8 and 9 run it too, 7 runs a light fault, and everything
  // before 7 runs nothing.
  if (clamped >= 8) startGlitch(); else stopGlitch();
  if (clamped === 7) startFault(); else stopFault();
}

/**
 * Reality: the CSS "randomly alters itself".
 * Small, reversible, and it stops if the player prefers reduced motion.
 */
function startGlitch() {
  if (glitchTimer) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const root = document.documentElement;
  glitchTimer = setInterval(() => {
    if (Math.random() > 0.45) return;

    const skew = (Math.random() * 1.4 - 0.7).toFixed(2);
    const hue = Math.floor(Math.random() * 360);
    const dur = 120 + Math.floor(Math.random() * 260);

    root.style.setProperty('--glitch-skew', `${skew}deg`);
    root.style.setProperty('--glitch-hue', `${hue}deg`);
    root.style.setProperty('--glitch-duration', `${dur}ms`);
    document.body.classList.add('is-glitching');

    setTimeout(() => {
      document.body.classList.remove('is-glitching');
      root.style.removeProperty('--glitch-skew');
      root.style.removeProperty('--glitch-hue');
    }, dur);
  }, 2400);
}

function stopGlitch() {
  if (glitchTimer) clearInterval(glitchTimer);
  glitchTimer = null;
  document.body.classList.remove('is-glitching');
}

/** HOLO FAULT: rarer, softer flicker than the full glitch. */
function startFault() {
  if (faultTimer) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  faultTimer = setInterval(() => {
    if (Math.random() > 0.3) return;
    document.body.classList.add('is-faulting');
    setTimeout(() => document.body.classList.remove('is-faulting'), 180);
  }, 4200);
}

function stopFault() {
  if (faultTimer) clearInterval(faultTimer);
  faultTimer = null;
  document.body.classList.remove('is-faulting');
}

/** Show the prestige tab once the player can ascend. */
function revealPrestige() {
  const nav = document.getElementById('nav-prestige');
  if (nav) nav.hidden = false;
}

function revealLog() {
  const nav = document.getElementById('nav-log');
  if (nav) nav.hidden = false;
}

/** Unlock the second prestige layer once the ladder reaches it. */
function revealEscape() {
  if (typeof state !== 'undefined') state.escapeUnlocked = true;
  syncEscapeControls();
}

/** Build the fake boot sequence shown before the app appears. */
function runBootSequence(onDone) {
  const log = document.getElementById('boot-log');
  const boot = document.getElementById('boot');
  const lines = [
    'priv-esc bootloader 0.1',
    'mounting /dev/sda1 ......... ok',
    'checking kernel integrity .. ok',
    'loading exploit daemon ..... ok',
    'allocating heap ............ ok',
    'WARNING: unpatched host',
    '',
    '> starting process',
  ];

  let i = 0;
  const step = () => {
    if (i >= lines.length) {
      setTimeout(() => {
        boot.classList.add('is-gone');
        setTimeout(() => {
          boot.remove();
          onDone();
        }, 420);
      }, 260);
      return;
    }
    log.textContent += lines[i] + '\n';
    i += 1;
    setTimeout(step, 55 + Math.random() * 90);
  };
  step();
}
