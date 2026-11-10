/**
 * The mix, measured: for every style, the chorus of a few songs is rendered
 * by the real engine and instruments into an OfflineAudioContext in headless
 * Chrome, faster than real time, and the result checked — no NaN, no clipping,
 * some headroom, a sensible loudness, and no style much louder or quieter
 * than the others.
 *
 * The modules are bundled straight from src/ (no build needed) and run in a
 * blank page. Needs a local Chrome (or `CHROME=/path/to/chrome`).
 */
import { build } from 'esbuild';
import { launch } from '../tools/chrome.mjs';
import { checker, load, root } from '../tools/load.mjs';

const { check, done } = checker();
const { STYLES } = await load('core/music');
const SEEDS = ['one', 'two'];

const bundle = await build({
  stdin: {
    contents: `
      import { Engine } from './src/app/audio';
      import { makeSong, barSeconds } from './src/core/music';
      export async function render(seed, style) {
        const song = makeSong(seed, style);
        // The fullest part: the first chorus, alone.
        song.sections = [song.sections.find((s) => s.role === 'chorus') ?? song.sections[1]];
        const seconds = Math.min(10, song.sections[0].bars * barSeconds(song)) + 1;
        const rate = 32000;
        const ctx = new OfflineAudioContext(2, Math.round(rate * seconds), rate);
        const engine = new Engine(ctx);
        engine.setVolume(1);
        engine.play(song, 0);
        engine.scheduleUntil(seconds);
        const buffer = await ctx.startRendering();
        let peak = 0, sum = 0, n = 0, bad = 0, clipped = 0;
        for (let c = 0; c < buffer.numberOfChannels; c++) {
          const data = buffer.getChannelData(c);
          // The first half second is the fade-in of the reverb and the compressor: skipped.
          for (let i = Math.round(rate * 0.5); i < data.length; i++) {
            const x = data[i];
            if (!Number.isFinite(x)) { bad++; continue; }
            const a = Math.abs(x);
            if (a > peak) peak = a;
            if (a >= 0.999) clipped++;
            sum += x * x;
            n++;
          }
        }
        const db = (x) => +(20 * Math.log10(Math.max(x, 1e-9))).toFixed(1);
        return { style: song.style, peak: db(peak), rms: db(Math.sqrt(sum / n)), bad, clipped };
      }
    `,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  format: 'iife',
  globalName: 'Sound',
  target: 'es2022',
  loader: { '.glsl': 'text' },
  write: false,
  logLevel: 'silent',
});

const browser = await launch({ width: 400, height: 300, flags: ['--autoplay-policy=no-user-gesture-required'] });
if (!browser) {
  console.log('No Chrome found — set CHROME=/path/to/chrome. Skipping the sound test.');
  process.exit(0);
}

try {
  await browser.evaluate(bundle.outputFiles[0].text);
  const loudness = {};
  for (const style of STYLES) {
    const runs = [];
    for (const seed of SEEDS) runs.push(await browser.evaluate(`Sound.render(${JSON.stringify(seed)}, ${JSON.stringify(style)})`));
    const worst = runs.reduce((a, b) => (b.peak > a.peak ? b : a));
    check(`${style}: numbers only`, runs.every((r) => r.bad === 0), true);
    check(`${style}: no clipping`, runs.every((r) => r.clipped === 0), true);
    // The noise of hats and snares is random each run: half a decibel of slack on the peak.
    check(`${style}: headroom`, worst.peak <= -0.5, true);
    const rms = runs.map((r) => r.rms);
    loudness[style] = rms.reduce((a, b) => a + b, 0) / rms.length;
    const sensible = rms.every((x) => x > -30 && x < -10);
    check(`${style}: loudness between -30 and -10 dBFS`, sensible, true);
    console.log(`  ${style.padEnd(10)} rms ${rms.join(' / ')} dBFS, peak up to ${worst.peak} dBFS`);
  }
  const values = Object.values(loudness);
  const spread = Math.max(...values) - Math.min(...values);
  check(`styles within 12 dB of each other (${spread.toFixed(1)} dB)`, spread <= 12, true);
  check('no errors in the page', browser.errors, []);
} finally {
  await browser.close();
}

done('sound');
