/**
 * Seeded randomness. The first numbers for a fixed seed are pinned: they decide
 * what every saved seed sounds and looks like, so they must never change.
 */
import { checker, load } from '../tools/load.mjs';

const { check, done } = checker();
const R = await load('core/rng');

const first = (seed, n = 4) => {
  const rng = R.createRng(seed);
  return Array.from({ length: n }, () => Math.round(rng.next() * 1e9));
};

check('pinned numbers for "aurora"', first('aurora'), [32262462, 507118179, 672627456, 637883059]);
check('the same seed, the same numbers', first('x1'), first('x1'));
check('a neighbouring seed starts elsewhere', first('aurorb')[0] !== first('aurora')[0], true);
check('a fork is its own stream', R.createRng('x').fork('a').next() !== R.createRng('x').fork('b').next(), true);
check('a fork is repeatable', R.createRng('x').fork('a').next(), R.createRng('x').fork('a').next());

const rng = R.createRng('ranges');
let inRange = true;
const seen = new Set();
for (let i = 0; i < 5000; i++) {
  const f = rng.next();
  const n = rng.int(-2, 3);
  seen.add(n);
  if (!(f >= 0 && f < 1) || n < -2 || n > 3 || !Number.isInteger(n)) inRange = false;
}
check('next() in [0, 1), int() within its ends', inRange, true);
check('int() reaches both ends', [...seen].sort((a, b) => a - b), [-2, -1, 0, 1, 2, 3]);

const counts = { a: 0, b: 0 };
const w = R.createRng('weights');
for (let i = 0; i < 4000; i++) counts[w.weighted([['a', 3], ['b', 1]])] += 1;
check('weighted() follows the weights (about 3:1)', counts.a / counts.b > 2.4 && counts.a / counts.b < 3.8, true);
check('weighted() skips zero weights', R.createRng('z').weighted([['never', 0], ['always', 1]]), 'always');
check('shuffle keeps every item', R.createRng('s').shuffle([1, 2, 3, 4, 5]).sort(), [1, 2, 3, 4, 5]);

let k = 0;
check('newSeed from a fixed stream', R.newSeed(() => [0.1, 0.5, 0.9, 0.3, 0.7, 0][k++ % 6]), 'ds6kya');
check('newSeed avoids look-alikes', /[01ilo]/.test(Array.from({ length: 300 }, () => R.newSeed(Math.random)).join('')), false);
check('cleanSeed: trims and lowers', R.cleanSeed('  My Seed!  '), 'my-seed');
check('cleanSeed: nothing usable', R.cleanSeed(' !!! '), '');
check('cleanSeed: at most 32 characters', R.cleanSeed('x'.repeat(50)).length, 32);

done('rng');
