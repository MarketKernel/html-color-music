/**
 * Seeded randomness. Everything the page makes — the song, every scene, every
 * palette — comes from one short seed, so a seed typed back in replays the
 * same piece. sfc32 is small, fast and good enough for art; cyrb128 turns any
 * string into its four words of state.
 *
 * The outputs for a given seed are pinned in tests/rng.mjs: changing them
 * changes what every saved seed sounds and looks like.
 */

export interface Rng {
  /** A float in [0, 1). */
  next(): number;
  /** A float in [min, max). */
  range(min: number, max: number): number;
  /** An integer in [min, max], both ends included. */
  int(min: number, max: number): number;
  chance(probability: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** One of the items, each as likely as its weight. */
  weighted<T>(items: readonly (readonly [T, number])[]): T;
  shuffle<T>(items: readonly T[]): T[];
  /** An independent stream for a named part, the same for the same seed and label. */
  fork(label: string): Rng;
}

function cyrb128(text: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

export function createRng(seed: string): Rng {
  let [a, b, c, d] = cyrb128(seed);
  const next = (): number => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  // The state is mixed a little before use: neighbouring seeds start far apart.
  for (let i = 0; i < 12; i++) next();

  const rng: Rng = {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (probability) => next() < probability,
    pick: (items) => {
      if (items.length === 0) throw new Error('pick from an empty list');
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    weighted: (items) => {
      const total = items.reduce((sum, [, weight]) => sum + Math.max(0, weight), 0);
      if (!(total > 0)) throw new Error('weighted pick with no positive weight');
      let left = next() * total;
      for (const [item, weight] of items) {
        left -= Math.max(0, weight);
        if (left < 0) return item;
      }
      return (items.at(-1) as (typeof items)[number])[0];
    },
    shuffle: (items) => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j] as (typeof out)[number], out[i] as (typeof out)[number]];
      }
      return out;
    },
    fork: (label) => createRng(`${seed}/${label}`),
  };
  return rng;
}

/** Letters and digits that cannot be misread for one another: no 0/o, 1/l/i. */
const SEED_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** A fresh six-character seed from `random` (crypto in the page, a fixed stream in tests). */
export function newSeed(random: () => number): string {
  let seed = '';
  for (let i = 0; i < 6; i++) seed += SEED_ALPHABET[Math.floor(random() * SEED_ALPHABET.length)];
  return seed;
}

/** A seed typed by hand: trimmed, lower case, no spaces; empty when nothing usable is left. */
export function cleanSeed(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '').slice(0, 32);
}
