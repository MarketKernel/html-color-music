/**
 * The page: wires the composer (core/music), the scenes (core/scene), the
 * renderer and the audio engine together, and runs the controls.
 *
 * The loop each frame reads the audio engine's cues up to what the speakers
 * are playing now and turns them into pulses — a kick, a snare, a chord, a new
 * part of the song — which the renderer turns into motion and colour. Before
 * Start the picture already runs on its own, silently; sound needs a click.
 */
import { barSeconds, STYLE_NAMES, STYLES, type Song, type Style, makeSong } from '../core/music';
import { cssColor, paletteColor, type Palette } from '../core/palette';
import { cleanSeed, newSeed } from '../core/rng';
import { makeScene, PATTERNS, type Scene } from '../core/scene';
import { type Pace, readSettings, type Settings } from '../core/settings';
import { Engine, type Cue } from './audio';
import { Renderer, type Pulse } from './renderer';
import { applyUpdate, canUpdate, checkForUpdate, justUpdated, startUpdates, type UpdateState } from './update';

const STORAGE = 'color-music';
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let settings: Settings = readSettings(safeRead(), reducedMotion);

function safeRead(): string | null {
  try {
    return localStorage.getItem(STORAGE);
  } catch {
    return null;
  }
}

function save(): void {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(settings));
  } catch {
    // Private windows may refuse; the settings still hold for this visit.
  }
}

const cryptoRandom = (): number => crypto.getRandomValues(new Uint32Array(1))[0]! / 4294967296;

// ---- Picture ----------------------------------------------------------------

const canvas = $<HTMLCanvasElement>('stage');
let renderer: Renderer | null = null;
try {
  renderer = new Renderer(canvas);
} catch (error) {
  console.warn(error);
  canvas.hidden = true;
  $('fallback').hidden = false;
  $('gl-note').hidden = false;
}

// ---- State -----------------------------------------------------------------

let seed = newSeed(cryptoRandom);
let song: Song = makeSong(seed, settings.style);
let sceneIndex = 0;
let engine: Engine | null = null;
let section = 0;
let energyTarget = song.sections[0]?.energy ?? 0.4;

const pulse: Pulse = {
  beatsPerSecond: song.bpm / 60,
  beat: 0,
  snare: 0,
  note: 0,
  flash: 0,
  energy: 0.4,
  level: 0,
  chordHue: 0,
  calm: settings.calm,
};
let chordHueTarget = 0;

function setState(state: 'intro' | 'playing' | 'paused'): void {
  document.body.dataset.state = state;
  const play = $('play');
  play.setAttribute('aria-label', state === 'paused' ? 'Play' : 'Pause');
  play.title = state === 'paused' ? 'Play (Space)' : 'Pause (Space)';
  if (state === 'playing') void keepAwake();
  else releaseAwake();
  updateMediaSession();
}

/** A new scene for this point of the song, coming in over `seconds`. */
function newScene(seconds: number): void {
  const scene = makeScene(seed, sceneIndex++, energyTarget, settings.pattern);
  renderer?.show(scene, seconds);
  showScene(scene);
}

function sceneSeconds(): number {
  return Math.max(0.8, Math.min(4, barSeconds(song)));
}

function showScene(scene: Scene): void {
  $('f-scene').textContent = scene.name;
  document.body.dataset.pattern = String(scene.pattern);
  accent(scene.palette);
}

/** The controls take their colours from the palette on screen, lifted so text stays readable. */
function accent(palette: Palette): void {
  const lift = (t: number): string => cssColor(paletteColor(palette, t).map((x) => 0.35 + Math.max(0, Math.min(1, x)) * 0.65) as [number, number, number]);
  const root = document.documentElement.style;
  root.setProperty('--accent', lift(0.15));
  root.setProperty('--accent-2', lift(0.6));
  const stops = [0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => cssColor(paletteColor(palette, t))).join(', ');
  $('swatch').style.background = `linear-gradient(90deg, ${stops})`;
  const fallback = $('fallback').style;
  fallback.setProperty('--c1', cssColor(paletteColor(palette, 0.1)));
  fallback.setProperty('--c2', cssColor(paletteColor(palette, 0.45)));
  fallback.setProperty('--c3', cssColor(paletteColor(palette, 0.8)));
}

function showSong(): void {
  const meta = `${STYLE_NAMES[song.style]} · ${song.key} · ${song.bpm} BPM`;
  $('now-title').textContent = song.title;
  $('now-meta').textContent = meta;
  $('f-title').textContent = song.title;
  $('f-style').textContent = STYLE_NAMES[song.style];
  $('f-key').textContent = song.key;
  $('f-tempo').textContent = `${song.bpm} BPM`;
  $('f-chord').textContent = '—';
  $('f-part').textContent = '—';
  const input = $<HTMLInputElement>('seed');
  if (document.activeElement !== input) input.value = seed;
  document.title = engine ? `${song.title} — Color Music` : 'Color Music';
  updateMediaSession();
}

/** Starts a new song: now (a skip) or at `at`, where the last one ends. */
function nextSong(at?: number, newSeedText?: string): void {
  seed = newSeedText ?? newSeed(cryptoRandom);
  song = makeSong(seed, settings.style);
  sceneIndex = 0;
  section = 0;
  showSong();
  if (engine) {
    engine.play(song, at, at === undefined ? 0.3 : 3);
    if (!engine.playing) void engine.resume().then(() => setState('playing'));
  } else {
    newScene(0.8);
  }
}

// ---- Audio cues → pulses ----------------------------------------------------

function handleCue(cue: Cue, late: boolean): void {
  switch (cue.kind) {
    case 'note':
      if (late) return;
      if (cue.voice === 'kick') pulse.beat = Math.max(pulse.beat, cue.velocity);
      else if (cue.voice === 'snare' || cue.voice === 'clap') pulse.snare = Math.max(pulse.snare, cue.velocity);
      else if (cue.voice === 'tom') pulse.beat = Math.max(pulse.beat, cue.velocity * 0.8);
      else if (cue.voice === 'crash') pulse.flash = settings.calm ? 0 : 1;
      else if (cue.voice === 'lead' || cue.voice === 'arp') pulse.note = Math.max(pulse.note, cue.velocity * (cue.voice === 'lead' ? 1 : 0.5));
      // Without drums, the pad's chords carry the pulse.
      else if (cue.voice === 'pad' && !song.sections[section]?.layers.includes('drums')) pulse.beat = Math.max(pulse.beat, cue.velocity * 0.35);
      break;
    case 'chord':
      $('f-chord').textContent = cue.name;
      // Around the circle of fifths: chords a fifth apart shift the colours a little, distant ones more.
      chordHueTarget = (((cue.root * 7) % 12) / 12) * 0.35;
      break;
    case 'section': {
      section = cue.section;
      const part = song.sections[section];
      energyTarget = part?.energy ?? 0.5;
      if (settings.pace === 'section' || (settings.pace === 'song' && section === 0)) newScene(sceneSeconds());
      break;
    }
    case 'bar': {
      const part = song.sections[cue.section];
      if (part) $('f-part').textContent = `${part.role[0]!.toUpperCase()}${part.role.slice(1)} · bar ${cue.bar + 1} of ${part.bars}`;
      if (settings.pace === 'phrase' && cue.bar % 4 === 0) newScene(sceneSeconds());
      break;
    }
  }
}

// ---- The loop ----------------------------------------------------------------

let last = performance.now();
function frame(now: number): void {
  const dt = Math.max(0, (now - last) / 1000);
  last = now;
  if (engine) {
    engine.tick();
    const heard = engine.now();
    for (const cue of engine.takeCues(heard)) handleCue(cue, cue.time < heard - 0.25);
    pulse.level = engine.level();
  }
  const playing = document.body.dataset.state === 'playing';
  pulse.beatsPerSecond = (song.bpm / 60) * (playing ? 1 : 0.3);
  pulse.beat *= Math.exp(-dt * 7);
  pulse.snare *= Math.exp(-dt * 9);
  pulse.note *= Math.exp(-dt * 5);
  pulse.flash *= Math.exp(-dt * 4);
  pulse.energy += ((playing ? energyTarget : 0.3) - pulse.energy) * Math.min(1, dt * 0.6);
  pulse.chordHue += (chordHueTarget - pulse.chordHue) * Math.min(1, dt * 1.5);
  pulse.calm = settings.calm;
  try {
    renderer?.frame(dt, pulse);
  } catch (error) {
    console.error(error);
    renderer = null;
  }
  requestAnimationFrame(frame);
}

// ---- Controls ------------------------------------------------------------------

async function start(): Promise<void> {
  if (engine) return;
  try {
    engine = new Engine();
  } catch (error) {
    toast('This browser cannot play Web Audio.');
    console.error(error);
    return;
  }
  engine.setVolume(settings.muted ? 0 : settings.volume);
  engine.onSongEnd = (end) => nextSong(end);
  await engine.resume();
  engine.play(song);
  showSong();
  $('intro').hidden = true;
  $('hud').hidden = false;
  $('now').hidden = false;
  $('panel').hidden = !settings.showInfo;
  $('info').setAttribute('aria-expanded', String(settings.showInfo));
  setState('playing');
  wake();
}

async function togglePlay(): Promise<void> {
  if (!engine) return start();
  if (engine.playing) {
    await engine.pause();
    setState('paused');
  } else {
    await engine.resume();
    setState('playing');
  }
  wake();
}

function setMuted(muted: boolean): void {
  settings.muted = muted;
  save();
  $('mute').setAttribute('aria-pressed', String(muted));
  $('mute').setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
  engine?.setVolume(muted ? 0 : settings.volume);
}

function togglePanel(open = $('panel').hidden): void {
  $('panel').hidden = !open;
  $('info').setAttribute('aria-expanded', String(open));
  settings.showInfo = open;
  save();
  wake();
}

async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    toast('Full screen is not available here.');
  }
}

let toastTimer = 0;
function toast(text: string): void {
  const node = $('toast');
  node.textContent = text;
  node.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (node.hidden = true), 2600);
}

// The controls fade while the music plays and nothing moves; any touch brings them back.
let idleTimer = 0;
let hudHidden = false;
function wake(): void {
  document.body.classList.remove('idle');
  window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    // Focus left on a clicked button does not count; focus from the keyboard (Tab) does.
    // H hides the controls even with the pointer resting on them.
    const busy = !$('panel').hidden || (!hudHidden && $('hud').matches(':hover')) || document.querySelector('.hud :focus-visible, .panel :focus-visible');
    if (document.body.dataset.state === 'playing' && !busy) document.body.classList.add('idle');
  }, hudHidden ? 0 : 2800);
}

// Screens should stay on while the music plays, as for a video.
let wakeLock: WakeLockSentinel | null = null;
async function keepAwake(): Promise<void> {
  if (wakeLock || !('wakeLock' in navigator) || document.hidden) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => (wakeLock = null));
  } catch {
    // Refused (battery saver, a frame without permission): the screen may sleep.
  }
}
function releaseAwake(): void {
  void wakeLock?.release();
  wakeLock = null;
}

/** Media keys and the system's now-playing panel. */
function updateMediaSession(): void {
  if (!('mediaSession' in navigator) || !engine) return;
  navigator.mediaSession.metadata = new MediaMetadata({ title: song.title, artist: 'Color Music', album: STYLE_NAMES[song.style] });
  navigator.mediaSession.playbackState = document.body.dataset.state === 'paused' ? 'paused' : 'playing';
}

function setupMediaKeys(): void {
  if (!('mediaSession' in navigator)) return;
  const on = (action: MediaSessionAction, handler: () => void): void => {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // An action this browser does not know.
    }
  };
  on('play', () => void togglePlay());
  on('pause', () => void togglePlay());
  on('nexttrack', () => nextSong());
}

// ---- Updates of the installed app ---------------------------------------------

function linkButton(text: string, action: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'link-button';
  button.textContent = text;
  button.addEventListener('click', action);
  return button;
}

/** "Version 1.2.3 is ready. Update", for the panel and the start screen. */
function updateReady(version: string | null): (Node | string)[] {
  return [version ? `Version ${version} is ready.` : 'A new version is ready.', ' ', linkButton('Update', applyUpdate)];
}

/**
 * The line under the version in the panel; when a new version is ready, also a
 * line on the start screen and a dot on the details button. Update reloads the
 * page, so it waits for a press: the song playing is not cut off.
 */
function showUpdate(state: UpdateState): void {
  const line = $('update');
  line.hidden = !canUpdate();
  const check = (): HTMLButtonElement => linkButton('Check for updates', () => void checkForUpdate());
  switch (state.kind) {
    case 'idle':
      line.replaceChildren(check());
      break;
    case 'checking':
      line.replaceChildren('Checking for updates…');
      break;
    case 'latest':
      line.replaceChildren('This is the latest version. ', check());
      break;
    case 'offline':
      line.replaceChildren('No connection: could not check for updates. ', check());
      break;
    case 'ready':
      line.replaceChildren(...updateReady(state.version), ' It also starts by itself the next time the app is opened.');
      break;
  }
  const ready = state.kind === 'ready';
  const intro = $('intro-update');
  intro.hidden = !ready;
  intro.replaceChildren(...(ready ? updateReady(state.version) : []));
  $('info').classList.toggle('icon-button--badge', ready);
}

function fillOptions(): void {
  const style = $<HTMLSelectElement>('opt-style');
  for (const s of STYLES) style.append(new Option(STYLE_NAMES[s], s));
  style.value = settings.style ?? '';
  const pattern = $<HTMLSelectElement>('opt-pattern');
  PATTERNS.forEach((p, i) => pattern.append(new Option(p.name, String(i))));
  pattern.value = settings.pattern === null ? '' : String(settings.pattern);
  $<HTMLSelectElement>('opt-pace').value = settings.pace;
  $<HTMLInputElement>('opt-calm').checked = settings.calm;
  const volume = $<HTMLInputElement>('volume');
  volume.value = String(settings.volume);
  setMuted(settings.muted);
}

function bind(): void {
  $('start').addEventListener('click', () => void start());
  $('play').addEventListener('click', () => void togglePlay());
  $('next').addEventListener('click', () => nextSong());
  $('visuals').addEventListener('click', () => newScene(0.6));
  $('mute').addEventListener('click', () => setMuted(!settings.muted));
  $('info').addEventListener('click', () => togglePanel());
  $('panel-close').addEventListener('click', () => togglePanel(false));
  $('fullscreen').addEventListener('click', () => void toggleFullscreen());
  if (!document.fullscreenEnabled) $('fullscreen').hidden = true;

  $<HTMLInputElement>('volume').addEventListener('input', (event) => {
    settings.volume = Number((event.target as HTMLInputElement).value);
    save();
    if (settings.muted && settings.volume > 0) setMuted(false);
    else engine?.setVolume(settings.muted ? 0 : settings.volume);
  });
  $('seed-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = $<HTMLInputElement>('seed');
    const typed = cleanSeed(input.value);
    if (!typed) {
      input.value = seed;
      return;
    }
    input.value = typed;
    input.blur();
    if (!engine) void start().then(() => nextSong(undefined, typed));
    else nextSong(undefined, typed);
  });
  $<HTMLSelectElement>('opt-style').addEventListener('change', (event) => {
    const value = (event.target as HTMLSelectElement).value;
    settings.style = value ? (value as Style) : null;
    save();
    nextSong();
  });
  $<HTMLSelectElement>('opt-pattern').addEventListener('change', (event) => {
    const value = (event.target as HTMLSelectElement).value;
    settings.pattern = value === '' ? null : Number(value);
    save();
    newScene(0.6);
  });
  $<HTMLSelectElement>('opt-pace').addEventListener('change', (event) => {
    settings.pace = (event.target as HTMLSelectElement).value as Pace;
    save();
  });
  $<HTMLInputElement>('opt-calm').addEventListener('change', (event) => {
    settings.calm = (event.target as HTMLInputElement).checked;
    save();
  });

  // A player bar button clicked with the mouse lets go of the focus: kept, the next key press
  // would light its focus ring and hold the controls on screen. From the keyboard it stays.
  $('hud').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('button');
    if (button && event.detail > 0) button.blur();
  });
  for (const type of ['pointermove', 'pointerdown', 'keydown', 'focusin'] as const) {
    document.addEventListener(type, () => {
      if (type !== 'keydown') hudHidden = false;
      wake();
    }, { passive: true });
  }
  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement;
    if (target.closest('input, select, textarea')) {
      if (event.key === 'Escape') target.blur();
      return;
    }
    const intro = document.body.dataset.state === 'intro';
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const act = (fn: () => void): void => {
      event.preventDefault();
      fn();
    };
    switch (key) {
      case ' ':
        if (target.closest('button')) return;
        act(() => void togglePlay());
        break;
      case 'Enter':
        if (intro) act(() => void start());
        break;
      case 'n':
      case 'ArrowRight':
        if (!intro) act(() => nextSong());
        break;
      case 'v':
        act(() => newScene(0.6));
        break;
      case 'm':
        act(() => setMuted(!settings.muted));
        break;
      case 'f':
        act(() => void toggleFullscreen());
        break;
      case 'i':
        if (!intro) act(() => togglePanel());
        break;
      case 'h':
        if (!intro) act(() => {
          hudHidden = true;
          wake();
        });
        break;
      case 'Escape':
        if (!$('panel').hidden) act(() => togglePanel(false));
        break;
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && document.body.dataset.state === 'playing') void keepAwake();
  });
}

$('version').textContent = __APP_VERSION__;
window.setInterval(() => {
  if (renderer) $('quality').textContent = `render ${Math.round(renderer.quality * 100)}%`;
}, 1000);
fillOptions();
bind();
setupMediaKeys();
showSong();
newScene(0);
requestAnimationFrame(frame);
startUpdates(showUpdate);
if (justUpdated()) toast(`Updated to version ${__APP_VERSION__}.`);
