/**
 * Scenes: repeatable per seed and index, every pattern reachable, fractals
 * spared the folds that ruin them, and the lists in src/core/scene.ts in step
 * with the switch statements of the shader.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checker, load, root } from '../tools/load.mjs';

const { check, done } = checker();
const S = await load('core/scene');

check('the same seed and index, the same scene', JSON.stringify(S.makeScene('aurora', 3, 0.5)), JSON.stringify(S.makeScene('aurora', 3, 0.5)));
check('another index, another scene', JSON.stringify(S.makeScene('aurora', 4, 0.5)) !== JSON.stringify(S.makeScene('aurora', 3, 0.5)), true);
check('a pattern can be pinned', S.makeScene('aurora', 3, 0.5, 7).pattern, 7);

const patterns = new Set();
const transitions = new Set();
const problems = [];
const FRACTAL_WARPS = new Set(['none', 'swirl', 'bulge', 'ripple']);
for (let i = 0; i < 800; i++) {
  const scene = S.makeScene(`s${i % 40}`, i, (i % 10) / 10);
  const info = S.PATTERNS[scene.pattern];
  patterns.add(scene.pattern);
  transitions.add(scene.transition);
  if (info.fractal && !FRACTAL_WARPS.has(S.WARPS[scene.warp])) problems.push(`${info.name} with ${S.WARPS[scene.warp]}`);
  if (S.SYMMETRIES[scene.symmetry] === 'kaleidoscope' && !(scene.folds >= 3 && scene.folds <= 12)) problems.push(`${scene.folds} folds`);
  if (!(scene.feedback >= 0 && scene.feedback <= 0.92)) problems.push(`feedback ${scene.feedback}`);
  if (!scene.name.startsWith(info.name)) problems.push(`name ${scene.name}`);
  if (scene.knobs.some((k) => k < 0 || k >= 1)) problems.push('knobs out of 0..1');
  if (!(scene.speed > 0 && scene.zoom > 0 && scene.bands >= 1)) problems.push('speed, zoom, bands');
}
check('every scene well-formed', problems.slice(0, 5), []);
check('every pattern turns up', patterns.size, S.PATTERNS.length);
check('every transition turns up', transitions.size, S.TRANSITIONS.length);

// The shader's switch statements number the same things.
const shader = await readFile(join(root, 'src/app/scene.glsl'), 'utf8');
const cases = [...shader.matchAll(/case (\d+): return (\w+)\(/g)].map((m) => Number(m[1]));
check('a shader case for every pattern but the last (the default)', cases, Array.from({ length: S.PATTERNS.length - 1 }, (_, i) => i));
check('the default is the last pattern, Aurora', /default: return aurora\(/.test(shader) && S.PATTERNS.at(-1).name === 'Aurora', true);
check('the shader knows every warp', new RegExp(`w == ${S.WARPS.length - 1}\\)`).test(shader) && !new RegExp(`w == ${S.WARPS.length}\\)`).test(shader), true);
check('the shader knows every symmetry', new RegExp(`s == ${S.SYMMETRIES.length - 1}\\)`).test(shader) && !new RegExp(`s == ${S.SYMMETRIES.length}\\)`).test(shader), true);
check('the shader knows every transition', new RegExp(`uTransition == ${S.TRANSITIONS.length - 1}\\)`).test(shader), true);

done('scene');
