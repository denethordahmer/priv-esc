/* =========================================================================
   title.js — the title screen
   Fills the hex rain, animates the SYSTEM READY bar, and hands control to
   the game when START is pressed.
   ========================================================================= */

const TITLE_HEX_ROWS = 3;
const TITLE_HEX_COLS = 8;

/** Build a block of random hex codes, like the mockup's background. */
function buildHexBlock(rows, cols) {
  const lines = [];
  for (let r = 0; r < rows; r++) {
    const parts = [];
    for (let c = 0; c < cols; c++) {
      const value = Math.floor(Math.random() * 0xffff)
        .toString(16)
        .toUpperCase()
        .padStart(4, '0');
      parts.push(`0x${value}`);
    }
    lines.push(parts.join('  '));
  }
  return lines.join('\n');
}

/** Fill the two hex blocks and the segmented progress bar. */
function initTitleScreen() {
  const top = document.getElementById('title-hex-top');
  const bottom = document.getElementById('title-hex-bottom');
  if (top) top.textContent = buildHexBlock(TITLE_HEX_ROWS, TITLE_HEX_COLS);
  if (bottom) bottom.textContent = buildHexBlock(TITLE_HEX_ROWS, TITLE_HEX_COLS);

  const progress = document.getElementById('title-progress');
  if (progress) {
    progress.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const seg = document.createElement('i');
      progress.appendChild(seg);
    }
  }

  // The bar fills segment by segment, then holds at 100%.
  const pct = document.getElementById('title-pct');
  const segments = progress ? [...progress.children] : [];
  let filled = 0;

  const step = () => {
    if (filled < segments.length) {
      filled += 1;
      if (pct) pct.textContent = `${Math.round((filled / segments.length) * 100)}%`;
      setTimeout(step, 90 + Math.random() * 120);
    }
  };
  setTimeout(step, 220);
}

/** Show the title screen. */
function showTitleScreen() {
  const screen = document.getElementById('title-screen');
  if (!screen) return;
  screen.hidden = false;
  initTitleScreen();
}

/** Hide the title screen and start the game. */
function dismissTitleScreen() {
  const screen = document.getElementById('title-screen');
  if (!screen) return;
  screen.classList.add('is-gone');
  setTimeout(() => {
    screen.hidden = true;
    screen.remove();
  }, 440);
}

/** Wire the three title buttons. */
function initTitleControls(onStart) {
  document.getElementById('title-start')?.addEventListener('click', () => {
    dismissTitleScreen();
    onStart();
  });

  document.getElementById('title-options')?.addEventListener('click', () => {
    dismissTitleScreen();
    onStart();
    setTimeout(() => setScreen('settings'), 60);
  });

  document.getElementById('title-credits')?.addEventListener('click', () => {
    const screen = document.getElementById('title-screen');
    if (!screen) return;

    // Toggle: a second press closes the panel.
    const existing = screen.querySelector('.title-credits-panel');
    if (existing) { existing.remove(); return; }

    const panel = document.createElement('div');
    panel.className = 'title-credits-panel';
    panel.innerHTML = `
      <h2>CREDITS</h2>
      <dl>
        <div><dt>Design &amp; code</dt><dd>priv-esc</dd></div>
        <div><dt>Typefaces</dt><dd>Press Start 2P · VT323</dd></div>
        <div><dt>Built with</dt><dd>plain HTML, CSS and JavaScript</dd></div>
        <div><dt>Version</dt><dd>0.1.0</dd></div>
      </dl>
      <p class="title-credits-line">A rogue AI incremental. Built for the grid.</p>
      <button class="title-credits-close" type="button">CLOSE</button>`;

    screen.querySelector('.title-frame')?.appendChild(panel);
    panel.querySelector('.title-credits-close')
      ?.addEventListener('click', () => panel.remove());
  });
}