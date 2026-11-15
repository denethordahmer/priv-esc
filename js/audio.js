/* =========================================================================
   audio.js — the music player

   Two separate contexts, because they are two different pieces of music:

     TITLE SCREEN   music/title.mp3, looped. Nothing else plays here.
     IN GAME        music/track1.mp3, track2.mp3 … in number order. These
                    start only after the player presses START, and title.mp3
                    never plays once the game is running.

   In game, each track fades out over its last two seconds, then there is a
   two second silence, then the next one starts. After the last track it loops
   back to the first.

   Nothing here fails if the folder is empty. The game stays silent and logs
   no errors, so a build without music still works.
   ========================================================================= */

const MUSIC_DIR = 'music/';
const FADE_SECONDS = 2;      // fade out over the last two seconds
const GAP_SECONDS = 2;       // silence between tracks
const DEFAULT_VOLUME = 45;   // percent, used until the player changes it
const MAX_TRACKS = 12;

/** The in-game playlist, in play order. Filled by discoverTracks(). */
let playlist = [];
let playlistIndex = 0;
let titleAvailable = false;

let currentAudio = null;
let fadeTimer = null;
let gapTimer = null;
let musicWanted = false;
let musicUnlocked = false;
/** 'title' or 'game'. Which context the player is in. */
let musicContext = 'title';

/**
 * Work out which tracks exist.
 *
 * A static page cannot list a folder, and probing for files that are not there
 * logs a 404 for each miss. So the build writes music/manifest.json listing
 * what is actually in the folder, and this reads it. If the manifest is
 * missing (a hand-made copy, or a track added after the build), it falls back
 * to probing, which still works and only costs a few 404s in the log.
 */
async function discoverTracks() {
  const probe = async (name) => {
    try {
      const res = await fetch(MUSIC_DIR + name, { method: 'HEAD' });
      return res.ok;
    } catch {
      return false;
    }
  };

  // Preferred path: the manifest written at build time.
  try {
    const res = await fetch(`${MUSIC_DIR}manifest.json`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      titleAvailable = data.title === true;
      playlist = Array.isArray(data.tracks) ? data.tracks.slice() : [];
      return { title: titleAvailable, tracks: playlist.slice(), source: 'manifest' };
    }
  } catch {
    // Fall through to probing.
  }

  titleAvailable = await probe('title.mp3');

  const found = [];
  for (let i = 1; i <= MAX_TRACKS; i += 1) {
    const name = `track${i}.mp3`;
    if (await probe(name)) found.push(name);
    else break;
  }

  playlist = found;
  return { title: titleAvailable, tracks: found.slice(), source: 'probe' };
}

/** True when the player has sound on. */
function soundOn() {
  return state.settings.sound === true;
}

/**
 * The volume to play at, as a 0-1 fraction.
 *
 * The Settings slider is the single source of truth. DEFAULT_VOLUME is only
 * the starting point for a new save.
 */
function musicVolume() {
  const pct = Number(state.settings.musicVolume);
  const safe = Number.isFinite(pct) ? pct : DEFAULT_VOLUME;
  return Math.max(0, Math.min(100, safe)) / 100;
}

/**
 * Apply a new volume from the Settings slider.
 *
 * A track that is mid-fade keeps its fade: the fade is a fraction of the
 * current volume, so it is recomputed from the new level rather than jumping.
 */
function setMusicVolume(pct) {
  const value = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
  state.settings.musicVolume = value;
  if (currentAudio && !currentAudio.paused) {
    currentAudio.volume = musicVolume();
  }
}

/** Build (or reuse) the <audio> element for a track. */
function audioFor(name) {
  if (currentAudio && currentAudio.dataset.name === name) return currentAudio;

  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
  }

  const el = new Audio(MUSIC_DIR + name);
  el.dataset.name = name;
  el.volume = musicVolume();
  el.preload = 'auto';
  currentAudio = el;
  return el;
}

/** Clear the fade and gap timers. */
function clearTimers() {
  if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null; }
  if (gapTimer) { clearTimeout(gapTimer); gapTimer = null; }
}

/** Start whatever the current context calls for. */
function playCurrent() {
  if (!musicWanted || !soundOn()) return;

  if (musicContext === 'title') {
    if (!titleAvailable) return;
    clearTimers();
    const el = audioFor('title.mp3');
    el.loop = true;
    el.volume = musicVolume();
    el.currentTime = 0;
    const attempt = el.play();
    if (attempt && typeof attempt.catch === 'function') {
      attempt.catch(() => { /* autoplay blocked; retried on the next gesture */ });
    }
    return;
  }

  // In game: the numbered playlist, with a fade and a gap between tracks.
  if (playlist.length === 0) return;

  clearTimers();
  const name = playlist[playlistIndex];
  const el = audioFor(name);
  el.loop = false;
  el.volume = musicVolume();
  el.currentTime = 0;

  const attempt = el.play();
  if (attempt && typeof attempt.catch === 'function') {
    attempt.catch(() => { /* autoplay blocked; retried on the next gesture */ });
  }

  // Fade out over the last FADE_SECONDS, then wait GAP_SECONDS, then advance.
  fadeTimer = setInterval(() => {
    if (!el.duration || !isFinite(el.duration)) return;
    const remaining = el.duration - el.currentTime;

    if (remaining <= FADE_SECONDS && remaining > 0) {
      el.volume = Math.max(0, musicVolume() * (remaining / FADE_SECONDS));
    }

    if (remaining <= 0.05) {
      clearTimers();
      el.pause();
      el.volume = 0;
      gapTimer = setTimeout(() => {
        playlistIndex = (playlistIndex + 1) % playlist.length;
        playCurrent();
      }, GAP_SECONDS * 1000);
    }
  }, 100);
}

/** Stop everything and reset the volume. */
function stopMusic() {
  clearTimers();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.volume = musicVolume();
  }
}

/**
 * Switch context. Called when the player presses START and when the game
 * returns to the title screen.
 *
 * The old track is stopped outright rather than faded: the two contexts are
 * different pieces of music, and a crossfade between them would sound like a
 * mistake.
 */
function setMusicContext(context) {
  if (musicContext === context) return;
  musicContext = context;
  stopMusic();
  if (context === 'game') playlistIndex = 0;
  playCurrent();
}

/**
 * Turn music on or off.
 *
 * Turning it on starts the right track for the current context; turning it
 * off stops immediately rather than fading, so the toggle feels instant.
 */
async function setSound(on) {
  state.settings.sound = on === true;
  musicWanted = state.settings.sound;

  if (!musicWanted) {
    stopMusic();
    return;
  }

  musicUnlocked = true;
  if (!titleAvailable && playlist.length === 0) await discoverTracks();
  playCurrent();
}

/**
 * Browsers block audio until the player interacts, so the first tap or key
 * press unlocks playback. The playlist is discovered once, at boot.
 */
function initAudio() {
  discoverTracks();

  const unlock = () => {
    if (musicUnlocked) return;
    musicUnlocked = true;
    if (soundOn()) playCurrent();
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}

/** Exposed for the settings screen and for tests. */
function musicState() {
  return {
    context: musicContext,
    title: titleAvailable,
    tracks: playlist.slice(),
    index: playlistIndex,
    playing: !!(currentAudio && !currentAudio.paused),
    name: currentAudio ? currentAudio.dataset.name : null,
    wanted: musicWanted,
  };
}
