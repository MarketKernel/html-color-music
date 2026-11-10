/**
 * The built page in headless Chrome, end to end: the picture runs before
 * Start; Start plays music whose bars and chords advance on the audio clock;
 * a typed seed replays the song core/music.ts makes for it; next song, new
 * picture, pause, mute; every pattern draws something that is neither black
 * nor flat; a style lock; calm motion; settings kept; a phone's screen. Then
 * the PWA of build/pages/: installable, offline from its service worker, and a
 * new deploy that waits for Update.
 *
 * WebGL runs on SwiftShader (Chrome's software GPU), so this works on a
 * machine or CI runner without a graphics card — slowly, which is why the
 * window is small.
 *
 * Needs `npm run build` first and a local Chrome (or `CHROME=/path/to/chrome`).
 * `--shots DIR` also saves screenshots into DIR, one per pattern among them.
 */
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { launch, sleep } from '../tools/chrome.mjs';
import { checker, load, root } from '../tools/load.mjs';

const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
const { check, done } = checker();
const { makeSong, STYLE_NAMES } = await load('core/music');
const { PATTERNS } = await load('core/scene');

const html = await readFile(join(root, 'build', 'color-music.html'));
const PAGES = join(root, 'build', 'pages');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
// Set, /pages/ is down: the connection is dropped, as with no network.
let pagesDown = false;
// Set, the server hands out a service worker of this version, with a cache of its own: a new deploy.
let nextVersion = null;
// /pages/… is build/pages/, any other path the single file.
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (!path.startsWith('/pages/')) {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(html);
    return;
  }
  if (pagesDown) return req.socket.destroy();
  const name = path.endsWith('/') ? 'index.html' : basename(path);
  try {
    let body = await readFile(join(PAGES, name));
    if (name === 'sw.js' && nextVersion) {
      body = body
        .toString()
        .replace(/const VERSION = '[^']*'/, `const VERSION = '${nextVersion}'`)
        .replace(/const CACHE = '[^']*'/, `const CACHE = 'color-music-${nextVersion}'`);
    }
    res.setHeader('content-type', TYPES[extname(name)] ?? 'application/octet-stream');
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await launch({
  width: 720,
  height: 480,
  flags: ['--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
if (!browser) {
  console.log('No Chrome found — set CHROME=/path/to/chrome. Skipping the browser test.');
  server.close();
  process.exit(0);
}
const { send, evaluate, until, click, errors } = browser;

/** A screenshot, saved when --shots is given, and its statistics measured in the page itself. */
async function picture(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  if (SHOTS) {
    await mkdir(SHOTS, { recursive: true });
    await writeFile(join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
  }
  return evaluate(`new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 160; c.height = 100;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, c.width, c.height);
      const px = g.getImageData(0, 0, c.width, c.height).data;
      let sum = 0, sq = 0, rg = 0, yb = 0, rg2 = 0, yb2 = 0;
      const n = px.length / 4;
      for (let i = 0; i < px.length; i += 4) {
        const r = px[i] / 255, gr = px[i + 1] / 255, b = px[i + 2] / 255;
        const l = 0.299 * r + 0.587 * gr + 0.114 * b;
        sum += l; sq += l * l;
        const a = r - gr, y = 0.5 * (r + gr) - b;
        rg += a; yb += y; rg2 += a * a; yb2 += y * y;
      }
      const mean = sum / n;
      const sd = Math.sqrt(Math.max(0, sq / n - mean * mean));
      const colour = Math.sqrt(Math.max(0, rg2 / n - (rg / n) ** 2) + Math.max(0, yb2 / n - (yb / n) ** 2));
      resolve({ mean: +mean.toFixed(3), sd: +sd.toFixed(3), colour: +colour.toFixed(3) });
    };
    img.src = 'data:image/png;base64,${data}';
  })`);
}

const text = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
const state = () => evaluate('document.body.dataset.state');
const setField = (selector, value, event = 'change') =>
  evaluate(`(() => { const n = document.querySelector(${JSON.stringify(selector)}); n.value = ${JSON.stringify(value)}; n.dispatchEvent(new Event(${JSON.stringify(event)})); })()`);
const KEYS = { i: 73, m: 77, n: 78, v: 86, h: 72, ' ': 32 };
const press = async (key) => {
  const code = KEYS[key];
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, windowsVirtualKeyCode: code, text: key });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode: code });
  await sleep(80);
};
const stored = () => evaluate(`JSON.parse(localStorage.getItem('color-music') ?? '{}')`);

try {
  await send('Page.navigate', { url });
  await until(`document.readyState === 'complete'`);
  await sleep(1200);

  // Before Start: the picture already runs, silently
  check('title', await evaluate('document.title'), 'Color Music');
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  check('version shown, as in package.json', (await text('#version')).split('+')[0], version);
  check('intro shown', await evaluate(`!document.querySelector('#intro').hidden`), true);
  check('WebGL2 works (no fallback)', await evaluate(`document.querySelector('#fallback').hidden`), true);
  check('a scene is described', (await text('#f-scene')).length > 3, true);
  const before = await picture('1-intro');
  check('intro: the picture is not black', before.mean > 0.04, true);

  // Start
  await click('#start');
  check('playing', await until(`document.body.dataset.state === 'playing'`, 5000), true);
  check('intro gone', await evaluate(`document.querySelector('#intro').hidden`), true);
  check('player bar shown', await evaluate(`!document.querySelector('#hud').hidden`), true);
  check('audio clock running', await until(`document.querySelector('#f-part').textContent.includes('bar 1 of')`, 6000), true);
  check('a chord named', await until(`document.querySelector('#f-chord').textContent !== '—'`, 8000), true);
  check('bars advance', await until(`document.querySelector('#f-part').textContent.includes('bar 2 of')`, 12000), true);

  // A typed seed plays the song the composer makes for it
  await press('i');
  check('panel opens with I', await evaluate(`!document.querySelector('#panel').hidden`), true);
  await setField('#seed', 'aurora', 'input');
  await evaluate(`document.querySelector('#seed-form').requestSubmit()`);
  const expected = makeSong('aurora', null);
  check('seed: title', await until(`document.querySelector('#now-title').textContent === ${JSON.stringify(expected.title)}`, 3000), true);
  check('seed: style, key and tempo', await text('#now-meta'), `${STYLE_NAMES[expected.style]} · ${expected.key} · ${expected.bpm} BPM`);
  check('seed: shown in the field', await evaluate(`document.querySelector('#seed').value`), 'aurora');
  check('seed: its first part plays', await until(`document.querySelector('#f-part').textContent.startsWith(${JSON.stringify(expected.sections[0].role[0].toUpperCase())})`, 6000), true);
  await picture('2-playing-panel');

  // Next song, new picture
  await click('#next');
  check('next song: a new seed', await until(`document.querySelector('#seed').value !== 'aurora'`, 3000), true);
  const sceneBefore = await text('#f-scene');
  await click('#visuals');
  check('new picture', await until(`document.querySelector('#f-scene').textContent !== ${JSON.stringify(sceneBefore)}`, 3000), true);

  // Pause and play
  await click('#play');
  check('paused', await until(`document.body.dataset.state === 'paused'`, 3000), true);
  check('button says play', await evaluate(`document.querySelector('#play').getAttribute('aria-label')`), 'Play');
  const frozen = await text('#f-part');
  await sleep(1500);
  check('paused: the song stands still', await text('#f-part'), frozen);
  await click('#play');
  check('playing again', await until(`document.body.dataset.state === 'playing'`, 3000), true);

  // Mute, remembered
  await press('m');
  check('muted', await evaluate(`document.querySelector('#mute').getAttribute('aria-pressed')`), 'true');
  check('mute remembered', (await stored()).muted, true);
  await press('m');
  check('unmuted', (await stored()).muted, false);

  // Every pattern draws: not black, not one flat colour
  await press('i');
  for (let i = 0; i < PATTERNS.length; i++) {
    await setField('#opt-pattern', String(i));
    await until(`document.body.dataset.pattern === '${i}'`, 2000);
    await sleep(1400);
    const stats = await picture(`pattern-${String(i).padStart(2, '0')}-${PATTERNS[i].name.toLowerCase().replace(/[^a-z]+/g, '-')}`);
    const ok = stats.mean > 0.03 && stats.sd > 0.012;
    check(`pattern ${PATTERNS[i].name} draws`, ok, true);
    if (!ok) console.error(`  ${PATTERNS[i].name}: ${JSON.stringify(stats)}`);
  }
  check('pattern lock remembered', (await stored()).pattern, PATTERNS.length - 1);
  await setField('#opt-pattern', '');
  check('any pattern again', (await stored()).pattern, null);

  // Style lock: the next song is of that style
  await setField('#opt-style', 'lofi');
  check('style lock: a lo-fi song', await until(`document.querySelector('#now-meta').textContent.startsWith('Lo-fi')`, 3000), true);
  check('style lock remembered', (await stored()).style, 'lofi');
  await setField('#opt-style', '');

  // Calm motion and the pace of pictures, remembered
  await evaluate(`document.querySelector('#opt-calm').click()`);
  check('calm remembered', (await stored()).calm, true);
  await evaluate(`document.querySelector('#opt-calm').click()`);
  await setField('#opt-pace', 'phrase');
  check('pace remembered', (await stored()).pace, 'phrase');

  // Idle: the controls fade while playing
  await evaluate(`document.querySelector('#panel-close').click()`);
  await press('h');
  check('H hides the controls', await until(`document.body.classList.contains('idle')`, 2000), true);
  await picture('3-fullscreen-picture');

  // A phone's screen: nothing wider than it, the panel inside it
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await evaluate(`document.dispatchEvent(new PointerEvent('pointermove'))`);
  await evaluate(`document.querySelector('#info').click()`);
  await sleep(400);
  check('phone: no sideways scroll', await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true);
  const fits = (selector) => evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })()`);
  check('phone: player bar fits', await fits('#hud'), true);
  check('phone: panel fits', await fits('#panel'), true);
  check('phone: panel and bar do not overlap', await evaluate(`document.querySelector('#panel').getBoundingClientRect().bottom <= document.querySelector('#hud').getBoundingClientRect().top`), true);
  await picture('4-phone');
  await send('Emulation.clearDeviceMetricsOverride');

  check('the single file offers no updates', await evaluate(`document.querySelector('#update').hidden`), true);
  check('no errors on the page', errors, []);

  // The PWA: its CSP lets in the manifest and the service worker, which keeps it offline
  const reload = async () => {
    await evaluate('window.__beforeReload = true');
    await send('Page.reload');
    return until(`!window.__beforeReload && document.readyState === 'complete'`, 15000);
  };
  const introShown = `!document.querySelector('#intro').hidden`;
  await send('Page.navigate', { url: `${url}pages/` });
  check('pwa: service worker in control', await until(`navigator.serviceWorker.controller !== null`, 15000), true);
  check('pwa: start screen', await until(introShown), true);
  check('pwa: manifest parsed', (await send('Page.getAppManifest')).errors, []);
  check('pwa: installable', (await send('Page.getInstallabilityErrors')).installabilityErrors, []);
  check('pwa: the page knows it is the PWA', await evaluate(`document.querySelector('meta[name="service-worker"]')?.content`), 'sw.js');
  pagesDown = true;
  await reload();
  check('pwa: offline', await until(introShown), true);
  await click('#start');
  check('pwa: plays offline', await until(`document.body.dataset.state === 'playing'`, 5000), true);
  check('pwa: offline music advances', await until(`document.querySelector('#f-part').textContent.includes('bar 1 of')`, 6000), true);

  // Updates: a new deploy installs beside the running version and waits for Update
  const updateLine = `(document.querySelector('#update')?.textContent ?? '')`;
  const workerVersion = () =>
    evaluate(`new Promise((resolve) => { const c = new MessageChannel(); c.port1.onmessage = (e) => resolve(e.data); navigator.serviceWorker.controller.postMessage('version', [c.port2]); })`);
  const running = await text('#version');
  check('pwa: the worker knows its version', await workerVersion(), running);
  // The panel comes back as it was left: open, after the phone's screen above.
  await evaluate(`document.querySelector('#panel').hidden && document.querySelector('#info').click()`);
  check('pwa: the panel offers a check', await until(`${updateLine} === 'Check for updates'`), true);
  await click('#update button');
  check('pwa: no server, no check', await until(`${updateLine}.startsWith('No connection: could not check for updates.')`), true);
  pagesDown = false;
  await click('#update button');
  check('pwa: nothing new', await until(`${updateLine}.startsWith('This is the latest version.')`), true);
  nextVersion = '9.9.9';
  await click('#update button');
  check('pwa: a new version ready', await until(`${updateLine}.startsWith('Version 9.9.9 is ready. Update')`, 15000), true);
  check('pwa: a dot on the details button', await evaluate(`document.querySelector('#info').classList.contains('icon-button--badge')`), true);
  check('pwa: the music goes on', await evaluate(`document.body.dataset.state`), 'playing');
  check('pwa: the old worker still serves', await workerVersion(), running);
  await evaluate('window.__beforeReload = true');
  await click('#update button');
  check('pwa: update reloads to the start screen', await until(`!window.__beforeReload && document.readyState === 'complete' && ${introShown}`, 15000), true);
  check('pwa: the new worker serves', await workerVersion(), '9.9.9');
  check('pwa: the old cache gone', await evaluate(`caches.keys()`), ['color-music-9.9.9']);
  check('pwa: no update offered now', await evaluate(`document.querySelector('#intro-update').hidden`), true);
  pagesDown = true;
  await reload();
  check('pwa: offline after the update', await until(introShown), true);
  pagesDown = false;

  // A new worker found while the start screen shows: said there
  nextVersion = '9.9.10';
  await evaluate(`navigator.serviceWorker.getRegistration().then((registration) => registration.update())`);
  check('pwa: ready, on the start screen', await until(`document.querySelector('#intro-update').textContent === 'Version 9.9.10 is ready. Update'`, 15000), true);
  nextVersion = null;

  // The page served is the same, only the worker changed: what the app ran before is set back to see the note
  await evaluate(`localStorage.setItem('color-music-version', '0.0.1')`);
  await reload();
  check('pwa: "updated" said once', await until(`document.querySelector('#toast').textContent === ${JSON.stringify(`Updated to version ${running}.`)} && !document.querySelector('#toast').hidden`), true);
  check('pwa: and remembered', await evaluate(`localStorage.getItem('color-music-version')`), running);
  check('pwa: no errors on the page, offline either', errors, []);
} finally {
  await browser.close();
  server.close();
}

done('app');
