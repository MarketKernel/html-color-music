/**
 * Headless Chrome over the DevTools protocol, with nothing but Node: the
 * browser is started with a debugging port and spoken to over the built-in
 * WebSocket. Shared by the page's test and the screenshots.
 *
 * Chrome comes from CHROME or the usual places; without one, `launch()`
 * returns null and the caller skips.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CHROME =
  process.env.CHROME ??
  [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].find((path) => existsSync(path));

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const NAVIGATED = /Inspected target navigated or closed|Cannot find context with specified id|Execution context was destroyed/;

/**
 * A browser with one page. `flags` are added to Chrome's; `errors` collects the
 * page's uncaught exceptions and console errors.
 */
export async function launch({ flags = [], width = 1280, height = 900 } = {}) {
  if (!CHROME) return null;
  const profile = await mkdtemp(join(tmpdir(), 'color-music-chrome-'));
  const args = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', `--window-size=${width},${height}`, ...flags];
  if (process.platform === 'linux') args.push('--no-sandbox');
  const chrome = spawn(CHROME, [...args, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('Chrome did not start')), 20000);
    chrome.stderr.on('data', (data) => {
      buffer += data;
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(buffer);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });
  const port = new URL(wsUrl).port;
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const target = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener('open', resolve));

  let id = 0;
  const waiting = new Map();
  const errors = [];
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && waiting.has(msg.id)) {
      waiting.get(msg.id)(msg);
      waiting.delete(msg.id);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      errors.push(msg.params.entry.text);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      waiting.set(n, (msg) => (msg.error ? reject(new Error(`${method}: ${JSON.stringify(msg.error)}`)) : resolve(msg.result)));
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(`${expression}\n${result.exceptionDetails.exception?.description ?? 'evaluation failed'}`);
    return result.result.value;
  };

  /** Polls `expression` until it is truthy; survives a navigation in between. */
  const until = async (expression, timeout = 8000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      try {
        if (await evaluate(expression)) return true;
      } catch (error) {
        if (!NAVIGATED.test(error.message)) throw error;
      }
      await sleep(50);
    }
    return false;
  };

  /** A real mouse click at a point of the page; `modifiers`: 8 is Shift. */
  const clickAt = async (x, y, { button = 'left', modifiers = 0 } = {}) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, modifiers });
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, x, y, button, clickCount: 1, modifiers });
    }
    await sleep(60);
  };

  /** A real mouse click in the middle of the element. */
  const click = async (selector, options) => {
    const point = await evaluate(`(() => {
      const n = document.querySelector(${JSON.stringify(selector)});
      if (!n) return null;
      n.scrollIntoView({ block: 'center' });
      const r = n.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2];
    })()`);
    if (!point) throw new Error(`Nothing to click: ${selector}`);
    await clickAt(point[0], point[1], options);
  };

  const shot = async (path) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    await writeFile(path, Buffer.from(data, 'base64'));
  };

  const close = async () => {
    ws.close();
    if (chrome.exitCode === null) {
      const exited = new Promise((resolve) => chrome.once('exit', resolve));
      chrome.kill();
      await exited;
    }
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  };

  return { send, evaluate, until, click, clickAt, shot, close, errors };
}
