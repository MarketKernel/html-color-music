/**
 * The PWA's PNG icons, drawn from assets/icon.svg by headless Chrome into
 * assets/pwa/. Run it after changing the icon; the PNGs are committed, so the
 * build needs no browser.
 *
 *   node tools/icons.mjs
 *
 * The plain icons keep the SVG's rounded corners on a transparent ground. The
 * maskable one and Apple's fill the square to the edge: the system cuts its
 * own shape out of them, and the note already sits inside the safe circle.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launch } from './chrome.mjs';
import { root } from './load.mjs';

const svg = (await readFile(join(root, 'assets', 'icon.svg'), 'utf8')).replace(/<\?xml[\s\S]*?\?>/, '').trim();
const square = svg.replaceAll(' rx="16"', '');
const ICONS = [
  ['icon-192.png', 192, svg],
  ['icon-512.png', 512, svg],
  ['icon-maskable-512.png', 512, square],
  ['apple-touch-icon.png', 180, square],
];

const browser = await launch({ width: 600, height: 600 });
if (!browser) {
  console.error('No Chrome found — set CHROME=/path/to/chrome.');
  process.exit(1);
}
const { send, evaluate } = browser;
const dir = join(root, 'assets', 'pwa');
await mkdir(dir, { recursive: true });
try {
  await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  for (const [name, size, source] of ICONS) {
    const uri = `data:image/svg+xml;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
    await evaluate(`new Promise((resolve, reject) => {
      document.body.style.margin = '0';
      const img = new Image(${size}, ${size});
      img.style.display = 'block';
      img.onload = resolve;
      img.onerror = () => reject(new Error('the SVG did not load'));
      img.src = ${JSON.stringify(uri)};
      document.body.replaceChildren(img);
    })`);
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: size, height: size, scale: 1 } });
    await writeFile(join(dir, name), Buffer.from(data, 'base64'));
    console.log(`assets/pwa/${name} ${size}×${size}`);
  }
} finally {
  await browser.close();
}
