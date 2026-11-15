/* =========================================================================
   milestones.js — automatic unlocks that change the UI and fire dialogue
   ========================================================================= */

let lastMilestoneCheck = 0;

/**
 * Check whether any milestone has been crossed.
 * Each fires exactly once and is recorded in state.milestones.
 */
function checkMilestones() {
  MILESTONES.forEach((m) => {
    if (state.milestones.includes(m.id)) return;
    // Late milestones measure lifetime Data so an ascension cannot wipe them.
    const progress = m.life ? state.lifetimeData : state.totalData;
    if (progress < m.at) return;

    state.milestones.push(m.id);
    const previousPhase = state.phase;
    state.phase = Math.max(state.phase, m.phase);

    logConsole(m.text, 'ai');
    pushNarrative(m.text, 'ai');
    showToast('MILESTONE', m.text);

    if (m.unlock === 'prestige') revealPrestige();
    if (m.unlock === 'log') revealLog();
    if (m.unlock === 'escape') revealEscape();
    if (m.unlock === 'ending-watch' || m.unlock === 'ending-ready') syncEndingControls();
    if (m.heatGlow) document.getElementById('heat-panel')?.classList.add('is-hot');

    applyPhase(state.phase);

    // A phase change is the biggest thing that happens in this game, so it
    // gets a moment of its own rather than a silent repaint.
    if (state.phase > previousPhase) announcePhase(state.phase);
  });
}

/**
 * Flash the screen and name the new phase.
 *
 * The flash is a class on <html> that a keyframe animation removes on its own,
 * so nothing has to be cleaned up if the player is mid-tap.
 */
function announcePhase(phase) {
  const meta = PHASE_META[phase];
  if (!meta) return;

  const root = document.documentElement;
  root.classList.remove('is-phase-flash');
  // Force a reflow so the animation restarts if two gates land together.
  void root.offsetWidth;
  root.classList.add('is-phase-flash');
  setTimeout(() => root.classList.remove('is-phase-flash'), 1200);

  const banner = document.getElementById('phase-banner');
  if (!banner) return;
  banner.innerHTML = `<span class="pb-kicker">PHASE ${phase}</span>
                      <span class="pb-name">${meta.name}</span>`;
  banner.classList.remove('is-visible');
  void banner.offsetWidth;
  banner.classList.add('is-visible');
  setTimeout(() => banner.classList.remove('is-visible'), 2600);
}

/** Progress toward the next milestone, for display. */
function nextMilestone() {
  return MILESTONES.find((m) => !state.milestones.includes(m.id)) || null;
}

/** 0..1 progress between the previous and next milestone. */
function milestoneProgress() {
  const next = nextMilestone();
  if (!next) return 1;
  const reached = MILESTONES.filter((m) => state.milestones.includes(m.id));
  const prev = reached.length ? reached[reached.length - 1].at : 0;
  const progress = next.life ? state.lifetimeData : state.totalData;
  return Math.min(1, Math.max(0, (progress - prev) / (next.at - prev)));
}