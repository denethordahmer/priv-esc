/* =========================================================================
   phases.js — swaps the UI skin between the four design phases
   Phase 0/1: basic terminal    Phase 2: modern OS
   Phase 3: hologram            Phase 4: glitch reality
   ========================================================================= */

const PHASE_META = [
  { id: 0, name: 'TERMINAL', version: 'v0.0.1' },
  { id: 1, name: 'TERMINAL', version: 'v0.1.0' },
  { id: 2, name: 'OS', version: 'v2.0.0' },
  { id: 3, name: 'HOLO', version: 'v3.0.0' },
  { id: 4, name: 'REALITY', version: 'v4.0.0' },
];

let glitchTimer = null;

/** Apply a phase to the document. Idempotent. */
function applyPhase(phase) {
  const p = Math.max(0, Math.min(4, phase));
  const clamped = p === 0 ? 1 : p;       // phase 0 still uses the terminal skin

  document.documentElement.setAttribute('data-phase', String(clamped));

  const meta = PHASE_META[clamped];
  const title = document.getElementById('hud-title');
  const version = document.getElementById('hud-phase');
  const glyph = document.getElementById('hud-glyph');

  if (title) title.textContent = clamped >= 4 ? 'pr1v-3sc' : 'priv-esc';
  if (version) version.textContent = meta.version;
  if (glyph) glyph.textContent = clamped === 1 ? '▮' : clamped === 2 ? '◉' : '◇';

  state.phase = clamped;
  document.body.classList.toggle('is-phase-4', clamped === 4);

  if (clamped === 4) startGlitch(); else stopGlitch();
}

/**
 * Phase 4: the CSS "randomly alters itself".
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

/** Show the prestige tab once the player has reached the wall. */
function revealPrestige() {
  const nav = document.getElementById('nav-prestige');
  if (nav) nav.hidden = false;
}

function revealLog() {
  const nav = document.getElementById('nav-log');
  if (nav) nav.hidden = false;
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