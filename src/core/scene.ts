/**
 * A scene is everything the shader needs to draw one look: which pattern
 * (fractal, field, tiling…), how space is folded before it (kaleidoscope,
 * mirror) and bent (swirl, ripple, inversion…), the palette, the speed, how
 * much of the last frame lingers as a trail, and how this scene takes over
 * from the one before. The page picks a new one at every section of the song.
 *
 * The indices of PATTERNS, WARPS and SYMMETRIES are the shader's: the switch
 * statements in src/app/scene.glsl list them in the same order.
 */
import { makePalette, PALETTE_NAMES, type Palette } from './palette';
import { createRng, type Rng } from './rng';

export interface PatternInfo {
  name: string;
  /** Escape-time fractals and the like: folding space too much turns them to mush. */
  fractal: boolean;
}

export const PATTERNS: readonly PatternInfo[] = [
  { name: 'Plasma', fractal: false },
  { name: 'Domain warp', fractal: false },
  { name: 'Mandelbrot', fractal: true },
  { name: 'Julia set', fractal: true },
  { name: 'Newton fractal', fractal: true },
  { name: 'Kaliset', fractal: true },
  { name: 'Voronoi cells', fractal: false },
  { name: 'Truchet tiles', fractal: false },
  { name: 'Interference', fractal: false },
  { name: 'Log spiral', fractal: false },
  { name: 'Tunnel', fractal: false },
  { name: 'Metaballs', fractal: false },
  { name: 'Gyroid', fractal: false },
  { name: 'Apollonian', fractal: true },
  { name: 'Marble', fractal: false },
  { name: 'Moiré', fractal: false },
  { name: 'Harmonograph', fractal: false },
  { name: 'Starburst', fractal: false },
  { name: 'Hex lattice', fractal: false },
  { name: 'Aurora', fractal: false },
];

export const WARPS = ['none', 'swirl', 'noise', 'ripple', 'inversion', 'polar', 'tiles', 'bulge'] as const;
export const SYMMETRIES = ['none', 'mirror', 'quad', 'kaleidoscope', 'rotation'] as const;
export const TRANSITIONS = ['fade', 'iris', 'dissolve', 'sweep'] as const;

export type Warp = (typeof WARPS)[number];
export type Symmetry = (typeof SYMMETRIES)[number];

export interface Scene {
  pattern: number;
  warp: number;
  symmetry: number;
  /** Folds of the kaleidoscope, copies of the rotation. */
  folds: number;
  /** Pattern-specific knobs, each 0..1. */
  knobs: [number, number, number, number];
  /** A point of interest: the Mandelbrot zoom target, Julia's c, the Kaliset's offset. */
  center: [number, number];
  zoom: number;
  /** Radians per beat. */
  spin: number;
  /** Pattern time per beat. */
  speed: number;
  warpAmount: number;
  palette: Palette;
  /** Palette cycles per beat. */
  paletteSpeed: number;
  /** How many times the palette repeats over the pattern's range. */
  bands: number;
  /** 0..0.92: how much of the previous frame stays. */
  feedback: number;
  /** Zoom of the previous frame per frame, around 1. */
  feedbackZoom: number;
  feedbackTurn: number;
  glow: number;
  saturation: number;
  transition: number;
  name: string;
}

/** Spots of the Mandelbrot set worth zooming into. */
const MANDELBROT_SPOTS: readonly [number, number][] = [
  [-0.743643887, 0.131825904],
  [0.2549870375, -0.0005679791],
  [-0.1011, 0.9563],
  [-1.25066, 0.02012],
  [-0.7453, 0.1127],
  [-0.16, 1.0405],
  [-1.7687, 0.0017],
  [0.3602404434, -0.6413130610],
  [-0.722, 0.246],
  [-0.0452407411, 0.9868162204],
];

/** Julia parameters with interesting, connected-looking sets. */
const JULIA_SPOTS: readonly [number, number][] = [
  [-0.8, 0.156],
  [0.285, 0.01],
  [-0.7269, 0.1889],
  [-0.4, 0.6],
  [0.355, 0.355],
  [-0.70176, -0.3842],
  [-0.835, -0.2321],
  [0.37, 0.1],
  [-0.54, 0.54],
  [-0.123, 0.745],
];

function warpFor(rng: Rng, fractal: boolean): number {
  const weights: [Warp, number][] = fractal
    ? [['none', 6], ['swirl', 2], ['bulge', 1.5], ['ripple', 1]]
    : [['none', 3], ['swirl', 2], ['noise', 2.5], ['ripple', 1.5], ['inversion', 1], ['polar', 1.2], ['tiles', 1], ['bulge', 1]];
  return WARPS.indexOf(rng.weighted(weights));
}

function symmetryFor(rng: Rng, fractal: boolean): number {
  const weights: [Symmetry, number][] = fractal
    ? [['none', 6], ['kaleidoscope', 2], ['quad', 1]]
    : [['none', 3], ['mirror', 1.2], ['quad', 1.2], ['kaleidoscope', 3], ['rotation', 1.5]];
  return SYMMETRIES.indexOf(rng.weighted(weights));
}

/**
 * Scene `index` of a seed. `energy` (0..1) is the song's at that point: louder
 * parts get faster, busier scenes. `wanted` pins the pattern.
 */
export function makeScene(seed: string, index: number, energy: number, wanted?: number | null): Scene {
  const rng = createRng(`${seed}/scene/${index}`);
  const pattern = wanted ?? rng.int(0, PATTERNS.length - 1);
  const info = PATTERNS[pattern] as PatternInfo;
  const warp = warpFor(rng, info.fractal);
  const symmetry = symmetryFor(rng, info.fractal);
  const folds = symmetry === 3 ? rng.pick([3, 4, 5, 6, 6, 7, 8, 10, 12]) : symmetry === 4 ? rng.pick([2, 3, 4, 5, 6]) : 1;
  const palette = makePalette(rng);
  const lively = 0.6 + energy * 0.8;

  let center: [number, number] = [rng.range(-1, 1), rng.range(-1, 1)];
  let zoom = rng.range(0.7, 1.6);
  if (info.name === 'Mandelbrot') {
    center = rng.pick(MANDELBROT_SPOTS);
    zoom = 1;
  } else if (info.name === 'Julia set') {
    center = rng.pick(JULIA_SPOTS);
    zoom = rng.range(0.8, 1.3);
  } else if (info.name === 'Kaliset') {
    center = [rng.range(0.35, 0.75), rng.range(0.25, 0.65)];
  }

  // Strong feedback smears fast fractal zooms into mud; fields love it.
  const feedback = rng.weighted<number>([
    [0, 3],
    [rng.range(0.35, 0.6), 3],
    [rng.range(0.6, 0.85), info.fractal ? 0.5 : 2.5],
    [rng.range(0.85, 0.92), info.fractal ? 0 : 1],
  ]);

  const warpName = WARPS[warp] as Warp;
  const symmetryName = SYMMETRIES[symmetry] as Symmetry;
  const parts = [info.name];
  if (symmetryName === 'kaleidoscope') parts.push(`kaleidoscope ×${folds}`);
  else if (symmetryName === 'rotation') parts.push(`${folds}-fold`);
  else if (symmetryName !== 'none') parts.push(symmetryName);
  if (warpName !== 'none') parts.push(warpName);
  parts.push(PALETTE_NAMES[palette.family].toLowerCase());

  return {
    pattern,
    warp,
    symmetry,
    folds,
    knobs: [rng.next(), rng.next(), rng.next(), rng.next()],
    center,
    zoom,
    spin: rng.chance(0.25) ? 0 : rng.range(-0.06, 0.06) * lively,
    speed: rng.range(0.08, 0.22) * lively,
    warpAmount: rng.range(0.2, 1),
    palette,
    paletteSpeed: rng.range(0.005, 0.04) * (rng.chance(0.5) ? 1 : -1),
    bands: rng.weighted([[1, 3], [rng.range(1.5, 3), 3], [rng.range(3, 6), 1]]),
    feedback,
    feedbackZoom: 1 + rng.range(-0.004, 0.012),
    feedbackTurn: rng.range(-0.004, 0.004),
    glow: rng.range(0.15, 0.6),
    saturation: rng.range(0.95, 1.3),
    transition: rng.int(0, TRANSITIONS.length - 1),
    name: parts.join(' · '),
  };
}
