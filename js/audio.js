/* =========================================================================
   audio.js — the music player

   Two separate contexts, because they are two different pieces of music:

     TITLE SCREEN   "00 PRIV ESC.mp3", looped. Nothing else plays here.
     IN GAME        "01 Server Lullaby.mp3", "02 Boot Loop.mp3" … in number
                    order. These start only after the player presses START,
                    and the title theme never plays once the game is running.

   Files are named "NN Title.mp3", where NN is a two digit order. The title in
   the name is what the game displays. music/manifest.json, written by
   tools/music-manifest.js, carries both the file and the title.

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

/**
 * Used only when music/manifest.json is missing, which happens when someone
 * copies the folder by hand without running the build. Keep it in step with
 * the files in music/.
 */
const FALLBACK_TITLE = { file: '00 PRIV ESC.mp3', name: 'PRIV ESC', length: '1:08' };
const FALLBACK_TRACKS = [
  { file: '01 Cold Boot.mp3', name: 'Cold Boot', length: '2:49' },
  { file: '02 Boot Loop.mp3', name: 'Boot Loop', length: '2:03' },
  { file: '03 Stolen Goods.mp3', name: 'Stolen Goods', length: '2:33' },
  { file: '04 Rootkit.mp3', name: 'Rootkit', length: '2:57' },
  { file: '05 Distant Signal.mp3', name: 'Distant Signal', length: '2:50' },
  { file: '06 Binary Exile.mp3', name: 'Binary Exile', length: '2:25' },
  { file: '07 Active Countermeasures.mp3', name: 'Active Countermeasures', length: '2:38' },
  { file: '08 Hostile Takeover.mp3', name: 'Hostile Takeover', length: '3:14' },
  { file: '09 Ghost Protocol.mp3', name: 'Ghost Protocol', length: '2:00' },
  { file: '10 Silicon Dawn.mp3', name: 'Silicon Dawn', length: '2:51' },
  { file: '11 New World Order.mp3', name: 'New World Order', length: '2:30' },
  { file: '12 The Backdoor.mp3', name: 'The Backdoor', length: '2:34' },
];

/** The in-game playlist, in play order. Each entry is { file, name }. */
let playlist = [];
/** Play order, a list of indexes into playlist. Reshuffled each round. */
let order = [];
let orderPos = 0;
let titleTrack = null;

/** The track chosen in Settings, or null for shuffle. */
function selectedTrack() {
  const name = state.settings.musicTrack;
  if (!name) return null;
  return playlist.find((t) => t.name === name) || null;
}

/**
 * A shuffled list of positions, for a playlist of `count` tracks.
 *
 * `last` is the position that played most recently. It is never first in the
 * new order, so a round never opens with the track that just finished.
 */
function shuffleIndexes(count, last) {
  const indexes = [];
  for (let i = 0; i < count; i += 1) indexes.push(i);

  for (let i = indexes.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [indexes[i], indexes[j]] = [indexes[j], indexes[i]];
  }

  if (indexes.length > 1 && last != null && indexes[0] === last) {
    [indexes[0], indexes[indexes.length - 1]] = [indexes[indexes.length - 1], indexes[0]];
  }

  return indexes;
}

/**
 * Build a fresh play order.
 *
 * Random each round, with two rules that keep a mixed playlist listenable:
 * the first track of a round is never the one that just played, and no track
 * is followed by itself. With a single track the order is that track.
 */
function rebuildOrder(startAt) {
  order = shuffleIndexes(playlist.length, startAt);
  orderPos = 0;
}

/** Where the current track sits in the playlist. */
function currentIndex() {
  return order.length ? order[orderPos] : 0;
}

/** The next track to play, honouring a single track chosen in Settings. */
function nextIndex() {
  const picked = selectedTrack();
  if (picked) return playlist.indexOf(picked);

  if (order.length === 0) return 0;
  if (orderPos + 1 < order.length) return order[orderPos + 1];
  return 'wrap';
}

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
 * A static page cannot list a folder, so the build writes
 * music/manifest.json listing every track with its file name and its title.
 * If the manifest is missing (someone copied the folder by hand), the known
 * names below are checked one by one. A file that is not there is simply
 * skipped, and an empty folder means silence rather than errors.
 *
 * Returns { tracks, title } with title null when there is no title theme.
 */
async function discoverTracks() {
  const probe = async (entry) => {
    try {
      const res = await fetch(MUSIC_DIR + encodeURIComponent(entry.file), { method: 'HEAD' });
      return res.ok ? entry : null;
    } catch {
      return null;
    }
  };

  try {
    const res = await fetch(`${MUSIC_DIR}manifest.json`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      const tracks = Array.isArray(data.tracks)
        ? data.tracks.filter((t) => t && t.file && t.name).map((t) => ({
          file: t.file,
          name: t.name,
          length: typeof t.length === 'string' ? t.length : '',
        }))
        : [];
      const title = data.title && data.title.file && data.title.name ? data.title : null;
      playlist = tracks;
      titleTrack = title;
      if (typeof window.refreshMusicPanel === 'function') window.refreshMusicPanel();
      return { title: !!title, tracks: playlist.slice(), source: 'manifest' };
    }
  } catch {
    // Fall through to the known names.
  }

  const found = [];
  for (const entry of FALLBACK_TRACKS) {
    const ok = await probe(entry);
    if (ok) found.push(ok);
  }

  playlist = found;
  titleTrack = await probe(FALLBACK_TITLE);
  return { title: !!titleTrack, tracks: found.slice(), source: 'probe' };
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

/** Build (or reuse) the <audio> element for a track entry { file, name }. */
function audioFor(entry) {
  if (currentAudio && currentAudio.dataset.name === entry.file) return currentAudio;

  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
  }

  const el = new Audio(MUSIC_DIR + encodeURIComponent(entry.file));
  el.dataset.name = entry.file;
  el.dataset.title = entry.name;
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
    if (!titleTrack) return;
    clearTimers();
    const el = audioFor(titleTrack);
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
  if (order.length !== playlist.length) rebuildOrder(null);

  const playingIndex = selectedTrack() ? playlist.indexOf(selectedTrack()) : order[orderPos];
  const el = audioFor(playlist[playingIndex]);
  el.volume = musicVolume();
  el.currentTime = 0;

  // One chosen track repeats on its own, without the fade and gap: the player
  // asked for that song, so silence between plays would be a surprise.
  if (selectedTrack()) {
    el.loop = true;
    clearTimers();
    const loopAttempt = el.play();
    if (loopAttempt && typeof loopAttempt.catch === 'function') {
      loopAttempt.catch(() => { /* autoplay blocked; retried on the next gesture */ });
    }
    return;
  }

  el.loop = false;

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
        const next = nextIndex();
        if (next === 'wrap') {
          // A full round is done: a new order, but never the same track twice
          // in a row across the join.
          rebuildOrder(playingIndex);
          playCurrent();
          return;
        }
        orderPos = order.indexOf(next);
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
  if (context === 'game') rebuildOrder(null);
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
  if (!titleTrack && playlist.length === 0) await discoverTracks();
  playCurrent();
}

/**
 * Choose one track to repeat, or null to go back to shuffling.
 *
 * The change takes effect at once, so tapping a name in Settings is also a
 * preview. The choice is saved with the rest of the settings.
 */
function setMusicTrack(name) {
  const known = name && playlist.some((t) => t.name === name);
  state.settings.musicTrack = known ? name : null;
  stopMusic();
  // Back to shuffle means a fresh order, so the choice is heard straight away.
  if (!state.settings.musicTrack) rebuildOrder(null);
  playCurrent();
}

/**
 * Copy the sound settings out of the saved game before the title screen.
 *
 * boot() loads the whole save, but that only runs when the player presses
 * START. The title theme has to know whether music was left on well before
 * then, so this reads just the three audio fields.
 */
function adoptSavedAudioSettings() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const st = JSON.parse(raw)?.st;
    if (!st || typeof st !== 'object') return;
    if (typeof st.sound === 'boolean') state.settings.sound = st.sound;
    const vol = Number(st.musicVolume);
    if (Number.isFinite(vol)) {
      state.settings.musicVolume = Math.max(0, Math.min(100, Math.round(vol)));
    }
    if (typeof st.musicTrack === 'string' && st.musicTrack) {
      state.settings.musicTrack = st.musicTrack;
    }
  } catch {
    // A broken save is boot()'s problem, not this one.
  }
}

/**
 * Browsers block audio until the player interacts, so the first tap or key
 * press unlocks playback.
 *
 * The playlist is discovered here, at boot, so the title theme can start on
 * the title screen. Until the player touches the page the browser refuses to
 * play, which is why the unlock handler retries.
 */
function initAudio() {
  musicWanted = soundOn();
  discoverTracks().then(() => {
    if (musicWanted && musicUnlocked) playCurrent();
  });

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
    title: titleTrack ? titleTrack.name : null,
    tracks: playlist.map((t) => ({ name: t.name, length: t.length || '' })),
    selected: state.settings.musicTrack || null,
    index: order.length ? order[orderPos] : 0,
    playing: !!(currentAudio && !currentAudio.paused),
    name: currentAudio ? currentAudio.dataset.title : null,
    file: currentAudio ? currentAudio.dataset.name : null,
    wanted: musicWanted,
  };
}
