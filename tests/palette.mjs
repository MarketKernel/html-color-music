/** Cosine palettes: colours stay near the displayable range, every family is reachable, colour helpers. */
import { checker, load } from '../tools/load.mjs';

const { check, done } = checker();
const P = await load('core/palette', 'core/rng');

check('hsl red', P.hsl(0, 1, 0.5).map((x) => +x.toFixed(3)), [1, 0, 0]);
check('hsl green', P.hsl(1 / 3, 1, 0.5).map((x) => +x.toFixed(3)), [0, 1, 0]);
check('cssColor clamps and rounds', P.cssColor([1.2, 0, 0.5]), '#ff0080');
check('paletteColor is a + b·cos(…)', P.paletteColor({ a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], c: [1, 1, 1], d: [0, 0.5, 0.25] }, 0).map((x) => +x.toFixed(3)), [1, 0, 0.5]);

const families = new Set();
const problems = [];
for (let i = 0; i < 600; i++) {
  const palette = P.makePalette(P.createRng(`p${i}`));
  families.add(palette.family);
  let light = 0;
  let spread = 0;
  for (let t = 0; t < 1; t += 0.05) {
    const [r, g, b] = P.paletteColor(palette, t);
    if (Math.max(r, g, b) > 1.25 || Math.min(r, g, b) < -0.3) problems.push(`${palette.family}: ${[r, g, b].map((x) => x.toFixed(2))}`);
    light += (0.299 * r + 0.587 * g + 0.114 * b) / 20;
    spread += (Math.max(r, g, b) - Math.min(r, g, b)) / 20;
  }
  if (light < 0.18 || light > 0.85) problems.push(`${palette.family}: average lightness ${light.toFixed(2)}`);
  if (palette.family !== 'mono' && spread < 0.15) problems.push(`${palette.family}: nearly grey`);
}
check('every palette in range, not too dark or pale, not grey', problems.slice(0, 5), []);
check('every family turns up', families.size, P.PALETTE_FAMILIES.length);
check('the same stream, the same palette', JSON.stringify(P.makePalette(P.createRng('q'))), JSON.stringify(P.makePalette(P.createRng('q'))));
check('a family can be asked for', P.makePalette(P.createRng('q'), 'ocean').family, 'ocean');

done('palette');
