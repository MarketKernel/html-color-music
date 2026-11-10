/**
 * Colour palettes as Inigo Quilez's cosine gradients,
 * colour(t) = a + b·cos(2π(c·t + d)) per channel: four vectors that make
 * anything from a rainbow to a two-tone print, cheap to evaluate in a shader
 * and smooth everywhere. Each family keeps the random part inside a range
 * that looks good: not muddy, not blown out.
 */
import type { Rng } from './rng';

export type Vec3 = [number, number, number];

export interface Palette {
  family: PaletteFamily;
  a: Vec3;
  b: Vec3;
  c: Vec3;
  d: Vec3;
}

export type PaletteFamily = 'rainbow' | 'classic' | 'duotone' | 'neon' | 'pastel' | 'sunset' | 'ocean' | 'mono' | 'acid' | 'tritone';

export const PALETTE_FAMILIES: readonly PaletteFamily[] = ['rainbow', 'classic', 'duotone', 'neon', 'pastel', 'sunset', 'ocean', 'mono', 'acid', 'tritone'];

export const PALETTE_NAMES: Record<PaletteFamily, string> = {
  rainbow: 'Rainbow',
  classic: 'Cosine',
  duotone: 'Duotone',
  neon: 'Neon',
  pastel: 'Pastel',
  sunset: 'Sunset',
  ocean: 'Ocean',
  mono: 'Monochrome',
  acid: 'Acid',
  tritone: 'Tritone',
};

const TAU = Math.PI * 2;

export function paletteColor(p: Palette, t: number): Vec3 {
  const ch = (i: 0 | 1 | 2): number => p.a[i] + p.b[i] * Math.cos(TAU * (p.c[i] * t + p.d[i]));
  return [ch(0), ch(1), ch(2)];
}

/** HSL (all 0..1) to RGB. */
export function hsl(h: number, s: number, l: number): Vec3 {
  const k = (n: number): number => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
}

const vec = (x: number, y: number, z: number): Vec3 => [x, y, z];
const same = (x: number): Vec3 => [x, x, x];

/** The gradient that runs from colour p to q and back: a + b·cos(2πt) with a mid, b half the difference. */
function between(p: Vec3, q: Vec3, frequency: number, phase: number): Pick<Palette, 'a' | 'b' | 'c' | 'd'> {
  return {
    a: vec((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2),
    b: vec((p[0] - q[0]) / 2, (p[1] - q[1]) / 2, (p[2] - q[2]) / 2),
    c: same(frequency),
    d: same(phase),
  };
}

export function makePalette(rng: Rng, wanted?: PaletteFamily): Palette {
  const family = wanted ?? rng.weighted<PaletteFamily>([
    ['rainbow', 2], ['classic', 4], ['duotone', 2], ['neon', 2], ['pastel', 1], ['sunset', 1.5], ['ocean', 1.5], ['mono', 0.7], ['acid', 1], ['tritone', 1.5],
  ]);
  const shift = rng.next();
  const jitter = (x: number, amount: number): number => x + rng.range(-amount, amount);
  switch (family) {
    case 'rainbow':
      return { family, a: same(0.5), b: same(0.5), c: same(rng.pick([1, 1, 2])), d: vec(shift, shift + 0.33, shift + 0.67) };
    case 'classic':
      return {
        family,
        a: vec(jitter(0.5, 0.1), jitter(0.5, 0.1), jitter(0.5, 0.1)),
        b: vec(jitter(0.45, 0.08), jitter(0.45, 0.08), jitter(0.45, 0.08)),
        c: rng.pick<Vec3>([same(1), vec(1, 1, 0.5), vec(1, 0.7, 0.4), vec(2, 1, 0), vec(0.8, 0.8, 0.5), vec(1, 1, 1.5)]),
        d: vec(rng.next(), rng.next(), rng.next()),
      };
    case 'duotone': {
      const h = rng.next();
      const second = h + rng.pick([0.5, 0.42, 0.58, 0.33]);
      return { family, ...between(hsl(h, rng.range(0.7, 1), rng.range(0.15, 0.3)), hsl(second % 1, rng.range(0.7, 1), rng.range(0.6, 0.78)), 1, shift) };
    }
    case 'neon':
      return { family, a: same(0.38), b: same(0.62), c: same(1), d: vec(shift, shift + rng.range(0.25, 0.4), shift + rng.range(0.55, 0.75)) };
    case 'pastel':
      return { family, a: same(0.72), b: same(0.26), c: same(1), d: vec(shift, shift + 0.33, shift + 0.67) };
    case 'sunset': {
      const warm = rng.range(-0.06, 0.06);
      return { family, a: vec(0.55, 0.36, 0.38), b: vec(0.45, 0.38, 0.3), c: vec(1, 1, 1), d: vec(warm, warm + 0.15, warm + rng.range(0.25, 0.4)) };
    }
    case 'ocean': {
      const cool = rng.range(-0.08, 0.08);
      return { family, a: vec(0.25, 0.48, 0.58), b: vec(0.25, 0.4, 0.42), c: vec(1, 1, 1), d: vec(cool + 0.6, cool + 0.45, cool + 0.35) };
    }
    case 'mono': {
      const tint = hsl(rng.next(), rng.range(0.5, 0.9), 0.55);
      return { family, a: vec(tint[0] * 0.55, tint[1] * 0.55, tint[2] * 0.55), b: vec(tint[0] * 0.5, tint[1] * 0.5, tint[2] * 0.5), c: same(1), d: same(shift) };
    }
    case 'acid':
      return { family, a: same(0.5), b: same(0.5), c: vec(rng.range(1.5, 2.5), rng.range(1, 2), rng.range(0.5, 1.5)), d: vec(shift, rng.next(), rng.next()) };
    case 'tritone': {
      // Three hues a third of a cycle apart; cosine phases set so each channel peaks once.
      const h = rng.next();
      const s = rng.range(0.75, 1);
      const p = hsl(h, s, 0.5);
      return { family, a: vec(0.5, 0.5, 0.5), b: vec(p[0] * 0.5 + 0.1, p[1] * 0.5 + 0.1, p[2] * 0.5 + 0.1), c: same(1), d: vec(h, h + 0.333, h + 0.667) };
    }
  }
}

/** A colour as #rrggbb, clamped. */
export function cssColor([r, g, b]: Vec3): string {
  const hex = (x: number): string => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
