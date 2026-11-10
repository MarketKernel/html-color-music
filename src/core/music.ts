/**
 * The composer: from a seed, a whole song — style, key, mode, tempo, a form of
 * sections, chord progressions with smooth voice leading, a melodic motif per
 * section, bass, arpeggio and drum patterns, and the sounds to play them with.
 * Then, bar by bar, the notes. No audio here: src/app/audio.ts plays what this
 * writes, and the tests read it.
 *
 * What makes it sound composed rather than random is repetition: a section
 * keeps its progression and its two-bar motif, the motif follows the chords,
 * a chorus comes back as it was, and strong beats land on chord tones.
 */
import { createRng, type Rng } from './rng';

export type Style =
  | 'ambient'
  | 'dreamy'
  | 'synthwave'
  | 'lofi'
  | 'house'
  | 'techno'
  | 'chiptune'
  | 'downtempo'
  | 'cinematic'
  | 'liquid';

export const STYLES: readonly Style[] = ['ambient', 'dreamy', 'synthwave', 'lofi', 'house', 'techno', 'chiptune', 'downtempo', 'cinematic', 'liquid'];

export const STYLE_NAMES: Record<Style, string> = {
  ambient: 'Ambient',
  dreamy: 'Dream pop',
  synthwave: 'Synthwave',
  lofi: 'Lo-fi',
  house: 'House',
  techno: 'Techno',
  chiptune: 'Chiptune',
  downtempo: 'Downtempo',
  cinematic: 'Cinematic',
  liquid: 'Liquid',
};

export type Voice = 'pad' | 'arp' | 'lead' | 'bass' | 'kick' | 'snare' | 'clap' | 'hat' | 'openhat' | 'rim' | 'shaker' | 'tom' | 'crash' | 'riser';
export const DRUM_VOICES: readonly Voice[] = ['kick', 'snare', 'clap', 'hat', 'openhat', 'rim', 'shaker', 'tom'];

export type Layer = 'drums' | 'bass' | 'pad' | 'arp' | 'lead';
export type Role = 'intro' | 'verse' | 'chorus' | 'break' | 'outro';

export type PadKind = 'warm' | 'glass' | 'strings' | 'epiano' | 'organ' | 'chip';
export type ArpKind = 'pluck' | 'bell' | 'chip' | 'marimba';
export type LeadKind = 'saw' | 'square' | 'sine' | 'bell' | 'chip' | 'flute';
export type BassKind = 'saw' | 'sub' | 'acid' | 'fm' | 'square';
export type PadRhythm = 'hold' | 'stabs' | 'pulse' | 'strum' | 'comp';
export type ArpShape = 'up' | 'down' | 'updown' | 'random' | 'pinky';

export interface NoteEvent {
  voice: Voice;
  /** Sixteenths from the start of the bar; a bar has 16. Fractions are strums and swing-free nudges. */
  step: number;
  /** In sixteenths. */
  length: number;
  midi: number;
  /** 0..1 */
  velocity: number;
  /** -1..1, left to right. */
  pan: number;
}

export interface Chord {
  degree: number;
  /** MIDI of the chord's root, in the octave below middle C. */
  root: number;
  /** Pitch classes of every tone, root first. */
  classes: number[];
  /** The notes the pad plays: led smoothly from the chord before. */
  voicing: number[];
  name: string;
}

export interface MotifNote {
  /** 0..31: the motif spans two bars. */
  step: number;
  length: number;
  /** Scale steps from the motif's anchor. */
  offset: number;
}

export interface Section {
  role: Role;
  bars: number;
  layers: Layer[];
  chords: Chord[];
  /** How many bars each chord lasts: ½, 1 or 2. */
  chordBars: number;
  motif: MotifNote[];
  bassPattern: BassPattern;
  arpShape: ArpShape;
  /** Sixteenths per arpeggio note. */
  arpRate: number;
  drums: DrumPattern | null;
  /** 0..1: how busy and bright this part is; the visuals follow it. */
  energy: number;
}

export interface Sound {
  pad: { kind: PadKind; brightness: number; detune: number; attack: number; release: number; rhythm: PadRhythm };
  arp: { kind: ArpKind; brightness: number; decay: number };
  lead: { kind: LeadKind; brightness: number; vibrato: number };
  bass: { kind: BassKind; brightness: number };
  kit: { kickPitch: number; kickDecay: number; snareTone: number; hatTone: number };
  fx: { reverb: number; delay: number; delaySteps: number; pump: number };
}

export interface Song {
  seed: string;
  title: string;
  style: Style;
  bpm: number;
  /** 0..0.45 of the swung unit. */
  swing: number;
  /** 1: swing sixteenths, 2: swing eighths. */
  swingUnit: number;
  tonic: number;
  mode: ModeName;
  key: string;
  sections: Section[];
  sound: Sound;
}

// ---- Theory ----------------------------------------------------------------

export type ModeName = 'ionian' | 'dorian' | 'phrygian' | 'lydian' | 'mixolydian' | 'aeolian' | 'harmonic' | 'majorPenta' | 'minorPenta';

interface Mode {
  name: string;
  /** Seven notes for building chords. */
  chords: readonly number[];
  /** The notes melodies use: the same seven, or five of them. */
  melody: readonly number[];
  minor: boolean;
}

const IONIAN = [0, 2, 4, 5, 7, 9, 11];
const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];

export const MODES: Record<ModeName, Mode> = {
  ionian: { name: 'major', chords: IONIAN, melody: IONIAN, minor: false },
  dorian: { name: 'dorian', chords: [0, 2, 3, 5, 7, 9, 10], melody: [0, 2, 3, 5, 7, 9, 10], minor: true },
  phrygian: { name: 'phrygian', chords: [0, 1, 3, 5, 7, 8, 10], melody: [0, 1, 3, 5, 7, 8, 10], minor: true },
  lydian: { name: 'lydian', chords: [0, 2, 4, 6, 7, 9, 11], melody: [0, 2, 4, 6, 7, 9, 11], minor: false },
  mixolydian: { name: 'mixolydian', chords: [0, 2, 4, 5, 7, 9, 10], melody: [0, 2, 4, 5, 7, 9, 10], minor: false },
  aeolian: { name: 'minor', chords: AEOLIAN, melody: AEOLIAN, minor: true },
  harmonic: { name: 'harmonic minor', chords: [0, 2, 3, 5, 7, 8, 11], melody: [0, 2, 3, 5, 7, 8, 11], minor: true },
  majorPenta: { name: 'major pentatonic', chords: IONIAN, melody: [0, 2, 4, 7, 9], minor: false },
  minorPenta: { name: 'minor pentatonic', chords: AEOLIAN, melody: [0, 3, 5, 7, 10], minor: true },
};

export const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

const mod = (n: number, m: number): number => ((n % m) + m) % m;

/** The MIDI note of scale index `index` (0 is the tonic at `base`), any octave. */
export function scaleNote(base: number, scale: readonly number[], index: number): number {
  const octave = Math.floor(index / scale.length);
  return base + 12 * octave + (scale[mod(index, scale.length)] as number);
}

export type ChordShape = 'triad' | 'seventh' | 'ninth' | 'sus2' | 'sus4' | 'add9';

/** Semitones above the root for the chord on `degree` (0-based) of a seven-note scale. */
export function chordIntervals(scale: readonly number[], degree: number, shape: ChordShape): number[] {
  const at = (k: number): number => scaleNote(0, scale, degree + k) - (scale[mod(degree, 7)] as number) - 12 * Math.floor(degree / 7);
  switch (shape) {
    case 'triad':
      return [0, at(2), at(4)];
    case 'seventh':
      return [0, at(2), at(4), at(6)];
    case 'ninth':
      return [0, at(2), at(6), at(8)];
    case 'sus2':
      return [0, at(1), at(4)];
    case 'sus4':
      return [0, at(3), at(4)];
    case 'add9':
      return [0, at(2), at(4), at(8)];
  }
}

/**
 * The shape, unless on this degree it would grind: a sus2 a semitone above
 * the root (phrygian), a sus4 on the tritone (lydian), a ninth that is a
 * minor ninth. Those become the plain triad or seventh.
 */
export function pleasantShape(scale: readonly number[], degree: number, shape: ChordShape): ChordShape {
  const intervals = chordIntervals(scale, degree, shape);
  if (shape === 'sus2' && intervals[1] === 1) return 'triad';
  if (shape === 'sus4' && intervals[1] === 6) return 'triad';
  if ((shape === 'ninth' || shape === 'add9') && mod(intervals.at(-1) as number, 12) === 1) return shape === 'ninth' ? 'seventh' : 'triad';
  return shape;
}

/** A chord's name from its root and intervals: C, Am7, Gsus4, F♯m7♭5, B♭add9… */
export function chordName(rootClass: number, intervals: readonly number[]): string {
  const has = (n: number): boolean => intervals.some((i) => mod(i, 12) === n);
  const root = NOTE_NAMES[mod(rootClass, 12)] as string;
  const third = has(4) ? 'maj' : has(3) ? 'min' : has(5) ? 'sus4' : has(2) ? 'sus2' : 'none';
  const fifth = has(7) ? 7 : has(6) ? 6 : has(8) ? 8 : 0;
  const seventh = has(11) ? 'maj7' : has(10) ? '7' : '';
  const ninth = third !== 'sus2' && has(2);
  let name = root;
  if (third === 'min') name += fifth === 6 && !seventh ? 'dim' : 'm';
  else if (third === 'maj' && fifth === 8) name += 'aug';
  if (seventh === 'maj7') name += third === 'min' ? '(maj7)' : 'maj7';
  else if (seventh === '7') name += ninth ? '9' : '7';
  if (third === 'min' && fifth === 6 && seventh) name += '♭5';
  if (third === 'sus4' || third === 'sus2') name += third;
  if (ninth && seventh !== '7') name += 'add9';
  return name;
}

/**
 * Places the chord's tones in [low, high] as close as possible to the voicing
 * before it — the way a keyboard player moves the fewest fingers. At most four
 * tones; the fifth goes first when there are more.
 */
export function voiceLead(classes: readonly number[], previous: readonly number[] | null, low: number, high: number): number[] {
  let tones = [...new Set(classes.map((c) => mod(c, 12)))];
  if (tones.length > 4) tones = tones.filter((_, i) => i !== 2).slice(0, 4);
  const options = tones.map((pc) => {
    const out: number[] = [];
    for (let m = low; m <= high; m++) if (mod(m, 12) === pc) out.push(m);
    return out;
  });
  const target = previous && previous.length ? previous : null;
  const centre = (low + high) / 2;
  let best: number[] = [];
  let bestCost = Infinity;
  const pick = (i: number, chosen: number[]): void => {
    if (i === options.length) {
      const sorted = [...chosen].sort((a, b) => a - b);
      const spread = (sorted.at(-1) as number) - (sorted[0] as number);
      let cost = spread > 16 ? (spread - 16) * 3 : 0;
      for (let k = 1; k < sorted.length; k++) if ((sorted[k] as number) - (sorted[k - 1] as number) < 2) cost += 6;
      if (target) {
        // Each new note against the nearest note of the old chord, and the reverse.
        for (const n of sorted) cost += Math.min(...target.map((t) => Math.abs(t - n)));
        for (const t of target) cost += 0.5 * Math.min(...sorted.map((n) => Math.abs(t - n)));
      } else {
        cost += Math.abs(sorted.reduce((s, n) => s + n, 0) / sorted.length - centre);
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = sorted;
      }
      return;
    }
    for (const m of options[i] as number[]) pick(i + 1, [...chosen, m]);
  };
  pick(0, []);
  return best;
}

// ---- Styles ----------------------------------------------------------------

/** Sixteen steps each: x full, o softer, . a ghost that may or may not play, - rest. */
export type DrumPattern = Partial<Record<'kick' | 'snare' | 'clap' | 'hat' | 'openhat' | 'rim' | 'shaker' | 'tom', string>>;

export type BassPattern = 'hold' | 'half' | 'eighths' | 'octaves' | 'offbeat' | 'rootFifth' | 'synco' | 'walk' | 'gallop';

interface StyleDef {
  bpm: [number, number];
  swing: [number, number];
  swingUnit: number;
  modes: readonly (readonly [ModeName, number])[];
  shapes: readonly (readonly [ChordShape, number])[];
  chordBars: readonly (readonly [number, number])[];
  drums: readonly DrumPattern[] | null;
  bass: readonly BassPattern[];
  pads: readonly PadKind[];
  padRhythms: readonly (readonly [PadRhythm, number])[];
  arps: readonly ArpKind[];
  arpRates: readonly number[];
  leads: readonly LeadKind[];
  basses: readonly BassKind[];
  /** Chance of a note on each eighth of the motif. */
  density: [number, number];
  reverb: [number, number];
  delay: [number, number];
  pump: [number, number];
  energy: number;
}

const FOUR = 'x---x---x---x---';
const BACKBEAT = '----x-------x---';

const STYLE_DEFS: Record<Style, StyleDef> = {
  ambient: {
    bpm: [58, 76], swing: [0, 0], swingUnit: 1,
    modes: [['lydian', 3], ['ionian', 2], ['dorian', 2], ['majorPenta', 2], ['aeolian', 1]],
    shapes: [['add9', 3], ['sus2', 2], ['seventh', 2], ['triad', 1], ['sus4', 1]],
    chordBars: [[2, 1]], drums: null, bass: ['hold'],
    pads: ['warm', 'glass', 'strings'], padRhythms: [['hold', 1]],
    arps: ['bell', 'marimba'], arpRates: [2, 4], leads: ['sine', 'bell', 'flute'], basses: ['sub'],
    density: [0.15, 0.3], reverb: [0.75, 1], delay: [0.3, 0.6], pump: [0, 0], energy: 0.35,
  },
  dreamy: {
    bpm: [78, 104], swing: [0, 0.1], swingUnit: 1,
    modes: [['ionian', 3], ['lydian', 2], ['majorPenta', 2], ['mixolydian', 1], ['dorian', 1]],
    shapes: [['add9', 3], ['seventh', 2], ['triad', 2], ['sus2', 1]],
    chordBars: [[1, 1], [2, 2]],
    drums: [
      { kick: 'x-------x-------', rim: BACKBEAT, shaker: '.o.o.o.o.o.o.o.o' },
      { kick: 'x-----x---x-----', snare: BACKBEAT, hat: 'o-o-o-o-o-o-o-o-' },
    ],
    bass: ['hold', 'half', 'rootFifth'], pads: ['glass', 'warm', 'epiano'], padRhythms: [['hold', 3], ['strum', 1]],
    arps: ['pluck', 'bell'], arpRates: [1, 2], leads: ['bell', 'sine', 'flute'], basses: ['sub', 'fm'],
    density: [0.3, 0.5], reverb: [0.6, 0.9], delay: [0.35, 0.6], pump: [0, 0.2], energy: 0.55,
  },
  synthwave: {
    bpm: [92, 118], swing: [0, 0], swingUnit: 1,
    modes: [['aeolian', 4], ['dorian', 2], ['ionian', 1], ['harmonic', 1]],
    shapes: [['triad', 3], ['add9', 1], ['seventh', 1]],
    chordBars: [[1, 2], [2, 1]],
    drums: [
      { kick: 'x-------x-------', snare: BACKBEAT, hat: 'o-o-o-o-o-o-o-o-' },
      { kick: FOUR, snare: BACKBEAT, hat: '..o...o...o...o.' },
    ],
    bass: ['eighths', 'octaves', 'gallop'], pads: ['warm', 'strings'], padRhythms: [['hold', 2], ['pulse', 1]],
    arps: ['pluck', 'chip'], arpRates: [1, 2], leads: ['saw', 'square'], basses: ['saw', 'square'],
    density: [0.35, 0.55], reverb: [0.5, 0.8], delay: [0.3, 0.5], pump: [0.3, 0.6], energy: 0.75,
  },
  lofi: {
    bpm: [68, 88], swing: [0.25, 0.4], swingUnit: 2,
    modes: [['dorian', 3], ['ionian', 2], ['aeolian', 2], ['mixolydian', 1]],
    shapes: [['seventh', 4], ['ninth', 3], ['add9', 1]],
    chordBars: [[1, 2], [2, 1]],
    drums: [
      { kick: 'x-------x-x-----', snare: BACKBEAT, hat: 'o-o-o-o-o-o-o-o-' },
      { kick: 'x------xx-----o-', snare: BACKBEAT, hat: 'o-.-o-.-o-.-o-o-' },
      { kick: 'x-----x---x-----', rim: BACKBEAT, hat: 'o-o-o-o-o-o-o-o-' },
    ],
    bass: ['walk', 'hold', 'synco'], pads: ['epiano'], padRhythms: [['comp', 2], ['strum', 2], ['hold', 1]],
    arps: ['marimba', 'bell'], arpRates: [2], leads: ['sine', 'flute', 'bell'], basses: ['sub', 'fm'],
    density: [0.3, 0.5], reverb: [0.4, 0.7], delay: [0.2, 0.45], pump: [0, 0.15], energy: 0.5,
  },
  house: {
    bpm: [118, 126], swing: [0, 0.15], swingUnit: 1,
    modes: [['dorian', 3], ['aeolian', 2], ['ionian', 2], ['mixolydian', 1]],
    shapes: [['seventh', 3], ['ninth', 2], ['triad', 1]],
    chordBars: [[1, 2], [2, 1]],
    drums: [
      { kick: FOUR, clap: BACKBEAT, openhat: '--x---x---x---x-', shaker: '.o.o.o.o.o.o.o.o' },
      { kick: FOUR, clap: BACKBEAT, openhat: '--x---x---x---x-', hat: 'o-o-o-o-o-o-o-o-' },
    ],
    bass: ['offbeat', 'synco', 'octaves'], pads: ['organ', 'warm', 'epiano'], padRhythms: [['stabs', 3], ['hold', 1]],
    arps: ['pluck'], arpRates: [1, 2], leads: ['bell', 'square'], basses: ['saw', 'fm', 'sub'],
    density: [0.3, 0.5], reverb: [0.4, 0.7], delay: [0.3, 0.5], pump: [0.4, 0.75], energy: 0.85,
  },
  techno: {
    bpm: [124, 134], swing: [0, 0.08], swingUnit: 1,
    modes: [['phrygian', 2], ['aeolian', 3], ['minorPenta', 1], ['dorian', 1]],
    shapes: [['triad', 2], ['sus2', 2], ['sus4', 1], ['seventh', 1]],
    chordBars: [[2, 2], [1, 1]],
    drums: [
      { kick: FOUR, openhat: '--x---x---x---x-', shaker: '.o.o.o.o.o.o.o.o', clap: '------------x---' },
      { kick: FOUR, hat: 'oooooooooooooooo', rim: '---o--o----o--o-', clap: BACKBEAT },
    ],
    bass: ['offbeat', 'synco', 'gallop'], pads: ['glass', 'warm'], padRhythms: [['stabs', 2], ['hold', 2]],
    arps: ['pluck', 'chip'], arpRates: [1], leads: ['square', 'bell'], basses: ['acid', 'saw'],
    density: [0.2, 0.4], reverb: [0.4, 0.7], delay: [0.35, 0.6], pump: [0.5, 0.8], energy: 0.9,
  },
  chiptune: {
    bpm: [120, 150], swing: [0, 0], swingUnit: 1,
    modes: [['ionian', 3], ['aeolian', 2], ['majorPenta', 1], ['mixolydian', 1]],
    shapes: [['triad', 4], ['sus4', 1]],
    chordBars: [[1, 3], [0.5, 1]],
    drums: [
      { kick: FOUR, snare: BACKBEAT, hat: 'o-o-o-o-o-o-o-o-' },
      { kick: 'x-----x-x-------', snare: '----x-------x--x', hat: 'oooooooooooooooo' },
    ],
    bass: ['octaves', 'eighths', 'gallop'], pads: ['chip'], padRhythms: [['pulse', 2], ['stabs', 1]],
    arps: ['chip'], arpRates: [1], leads: ['chip', 'square'], basses: ['square'],
    density: [0.45, 0.7], reverb: [0.15, 0.35], delay: [0.1, 0.3], pump: [0, 0], energy: 0.8,
  },
  downtempo: {
    bpm: [80, 98], swing: [0.05, 0.2], swingUnit: 1,
    modes: [['aeolian', 2], ['dorian', 3], ['phrygian', 1], ['minorPenta', 1]],
    shapes: [['seventh', 3], ['add9', 2], ['triad', 1], ['sus2', 1]],
    chordBars: [[2, 2], [1, 1]],
    drums: [
      { kick: 'x-----x---x-----', snare: BACKBEAT, hat: 'o-.-o-.-o-.-o-.o', shaker: '..o...o...o...o.' },
      { kick: 'x--x------x-----', snare: '----x--------x--', hat: 'o-o-o-o-o-o-o-o-' },
    ],
    bass: ['hold', 'synco', 'rootFifth'], pads: ['warm', 'strings', 'epiano'], padRhythms: [['hold', 3], ['strum', 1]],
    arps: ['pluck', 'marimba'], arpRates: [1, 2], leads: ['sine', 'saw', 'flute'], basses: ['sub', 'fm'],
    density: [0.25, 0.45], reverb: [0.55, 0.85], delay: [0.35, 0.6], pump: [0.1, 0.35], energy: 0.6,
  },
  cinematic: {
    bpm: [64, 84], swing: [0, 0], swingUnit: 1,
    modes: [['aeolian', 3], ['harmonic', 1], ['dorian', 1], ['lydian', 2]],
    shapes: [['triad', 3], ['sus2', 1], ['sus4', 1], ['add9', 1]],
    chordBars: [[2, 1]],
    drums: [{ tom: 'x-------o-----o-' }, { tom: 'x--o--x---o-----' }],
    bass: ['hold'], pads: ['strings', 'warm'], padRhythms: [['hold', 1]],
    arps: ['bell', 'marimba'], arpRates: [2, 1], leads: ['flute', 'sine', 'bell'], basses: ['sub'],
    density: [0.2, 0.35], reverb: [0.8, 1], delay: [0.2, 0.4], pump: [0, 0], energy: 0.45,
  },
  liquid: {
    bpm: [164, 176], swing: [0, 0.05], swingUnit: 1,
    modes: [['dorian', 2], ['aeolian', 2], ['ionian', 1], ['lydian', 1]],
    shapes: [['seventh', 2], ['ninth', 2], ['add9', 2]],
    chordBars: [[2, 2], [1, 1]],
    drums: [
      { kick: 'x---------x-----', snare: BACKBEAT, hat: 'o-o-o-o-o-o-o-o-', shaker: '.o.o.o.o.o.o.o.o' },
      { kick: 'x-----x---x-----', snare: '----x-------x--.', hat: 'o.o.o.o.o.o.o.o.' },
    ],
    bass: ['hold', 'half', 'synco'], pads: ['warm', 'strings', 'glass'], padRhythms: [['hold', 1]],
    arps: ['pluck', 'bell'], arpRates: [2, 1], leads: ['sine', 'bell'], basses: ['sub', 'fm'],
    density: [0.2, 0.4], reverb: [0.6, 0.85], delay: [0.3, 0.55], pump: [0.15, 0.4], energy: 0.8,
  },
};

const BASS_PATTERNS: Record<BassPattern, readonly (readonly [number, number, 'R' | 'F' | 'O' | '3' | 'A'])[]> = {
  hold: [[0, 16, 'R']],
  half: [[0, 8, 'R'], [8, 8, 'R']],
  eighths: [0, 2, 4, 6, 8, 10, 12, 14].map((s) => [s, 2, 'R'] as const),
  octaves: [0, 2, 4, 6, 8, 10, 12, 14].map((s, i) => [s, 2, i % 2 ? 'O' : 'R'] as const),
  offbeat: [[2, 2, 'R'], [6, 2, 'R'], [10, 2, 'R'], [14, 2, 'O']],
  rootFifth: [[0, 6, 'R'], [6, 2, 'R'], [8, 6, 'F'], [14, 2, 'R']],
  synco: [[0, 3, 'R'], [3, 3, 'R'], [6, 4, 'F'], [10, 2, 'R'], [12, 4, 'O']],
  walk: [[0, 4, 'R'], [4, 4, '3'], [8, 4, 'F'], [12, 4, 'A']],
  gallop: [[0, 2, 'R'], [3, 1, 'R'], [4, 2, 'R'], [7, 1, 'O'], [8, 2, 'R'], [11, 1, 'R'], [12, 2, 'F'], [15, 1, 'O']],
};

/** Common progressions, scale degrees from 0, for major-like and minor-like modes. */
const MAJOR_PROGRESSIONS = [
  [0, 4, 5, 3], [0, 5, 3, 4], [5, 3, 0, 4], [0, 3, 0, 4], [1, 4, 0, 5], [0, 5, 1, 4],
  [3, 4, 2, 5], [0, 3, 5, 4], [0, 2, 3, 4], [3, 0, 4, 5], [0, 3], [0, 4, 3, 3],
];
const MINOR_PROGRESSIONS = [
  [0, 5, 2, 6], [0, 6, 5, 6], [0, 3, 4, 0], [0, 5, 3, 4], [5, 6, 0, 0], [0, 2, 6, 3],
  [0, 3, 6, 2], [3, 4, 0, 0], [0, 6, 3, 5], [0, 3], [0, 5, 6, 4], [5, 3, 0, 6],
];
const MODAL_PROGRESSIONS: Partial<Record<ModeName, number[][]>> = {
  dorian: [[0, 3], [0, 3, 0, 6], [0, 6, 3, 0], [1, 0]],
  mixolydian: [[0, 6, 3, 0], [0, 6], [0, 3, 6, 3]],
  lydian: [[0, 1], [0, 1, 4, 0], [0, 1, 6, 4]],
  phrygian: [[0, 1], [0, 1, 0, 6], [0, 6, 5, 1]],
};

/** Where a chord tends to go next: functional harmony, loosely. */
const NEXT: Record<number, readonly (readonly [number, number])[]> = {
  0: [[3, 3], [4, 3], [5, 3], [1, 1], [2, 1]],
  1: [[4, 4], [3, 1], [6, 1]],
  2: [[5, 3], [3, 2]],
  3: [[4, 3], [0, 2], [1, 1], [5, 1]],
  4: [[0, 4], [5, 3], [3, 1]],
  5: [[3, 3], [1, 2], [4, 2], [2, 1]],
  6: [[0, 3], [2, 1], [5, 1]],
};

function progression(rng: Rng, mode: ModeName): number[] {
  const modal = MODAL_PROGRESSIONS[mode];
  if (modal && rng.chance(0.45)) return rng.pick(modal);
  if (rng.chance(0.7)) return rng.pick(MODES[mode].minor ? MINOR_PROGRESSIONS : MAJOR_PROGRESSIONS);
  // A walk on NEXT from the tonic; the diminished chord of the key is stepped over.
  const dim = MODES[mode].minor ? 1 : 6;
  const out = [0];
  while (out.length < 4) {
    const next = rng.weighted(NEXT[out.at(-1) as number] as (readonly [number, number])[]);
    if (next !== dim || rng.chance(0.15)) out.push(next);
  }
  return out;
}

const ADJECTIVES = ['Violet', 'Amber', 'Velvet', 'Neon', 'Quiet', 'Golden', 'Liquid', 'Electric', 'Silver', 'Crimson', 'Lunar', 'Hidden', 'Endless', 'Paper', 'Glass', 'Northern', 'Slow', 'Distant', 'Prism', 'Coral', 'Midnight', 'Opal', 'Saffron', 'Cobalt'];
const NOUNS = ['Drift', 'Bloom', 'Tide', 'Echo', 'Garden', 'Signal', 'Orbit', 'Mirage', 'Current', 'Lantern', 'Horizon', 'Spiral', 'Aurora', 'Cascade', 'Ember', 'Nebula', 'Harbour', 'Ripple', 'Comet', 'Meadow', 'Fractal', 'Lagoon', 'Satellite', 'Monsoon'];

// ---- The song --------------------------------------------------------------

const FORMS: readonly (readonly (readonly [Role, number])[])[] = [
  [['intro', 4], ['verse', 8], ['chorus', 8], ['break', 4], ['chorus', 8], ['outro', 4]],
  [['intro', 4], ['verse', 8], ['verse', 8], ['chorus', 8], ['outro', 4]],
  [['intro', 8], ['chorus', 8], ['break', 8], ['chorus', 8], ['outro', 4]],
  [['intro', 4], ['verse', 8], ['chorus', 8], ['verse', 8], ['chorus', 8], ['outro', 4]],
  [['intro', 4], ['chorus', 8], ['verse', 8], ['break', 4], ['chorus', 8]],
];

const ROLE_ENERGY: Record<Role, number> = { intro: 0.3, verse: 0.6, chorus: 1, break: 0.4, outro: 0.3 };

function layersFor(role: Role, style: Style, rng: Rng): Layer[] {
  const quiet = style === 'ambient' || style === 'cinematic';
  const layers = new Set<Layer>(['pad']);
  switch (role) {
    case 'intro':
      if (rng.chance(0.5)) layers.add('arp');
      if (!quiet && rng.chance(0.3)) layers.add('drums');
      break;
    case 'verse':
      layers.add('bass');
      if (!quiet || rng.chance(0.3)) layers.add('drums');
      layers.add(rng.chance(0.5) ? 'arp' : 'lead');
      break;
    case 'chorus':
      layers.add('bass').add('lead').add('arp');
      if (!quiet || rng.chance(0.6)) layers.add('drums');
      break;
    case 'break':
      layers.add(rng.chance(0.5) ? 'arp' : 'lead');
      if (rng.chance(0.4)) layers.add('bass');
      break;
    case 'outro':
      layers.add(rng.chance(0.5) ? 'lead' : 'arp');
      break;
  }
  return [...layers];
}

function makeMotif(rng: Rng, density: number, syncopated: boolean): MotifNote[] {
  const onsets: number[] = [];
  for (let step = 0; step < 32; step += 2) {
    const strong = step % 8 === 0;
    if (rng.chance(strong ? density + 0.3 : density)) {
      onsets.push(syncopated && !strong && rng.chance(0.25) ? step + 1 : step);
    }
  }
  if (onsets.length < 3) for (const s of [0, 6, 16]) if (!onsets.includes(s)) onsets.push(s);
  onsets.sort((a, b) => a - b);
  const notes: MotifNote[] = [];
  let offset = rng.pick([0, 2, 4]);
  for (let i = 0; i < onsets.length; i++) {
    const step = onsets[i] as number;
    const next = onsets[i + 1] ?? 32;
    const gap = next - step;
    const length = i === onsets.length - 1 ? Math.max(gap, 4) : Math.max(1, gap - (rng.chance(0.3) ? 1 : 0));
    notes.push({ step, length: Math.min(length, 12), offset });
    offset += rng.weighted([[-2, 2], [-1, 4], [0, 1], [1, 4], [2, 2], [3, 1], [-3, 1], [4, 0.4], [-4, 0.4]]);
    offset = Math.max(-5, Math.min(7, offset));
  }
  return notes;
}

/** The whole song for a seed, optionally of a given style. */
export function makeSong(seed: string, wanted?: Style | null): Song {
  const rng = createRng(`${seed}/song`);
  const style = wanted ?? rng.pick(STYLES);
  const def = STYLE_DEFS[style];
  const mode = rng.weighted(def.modes);
  const tonic = rng.int(0, 11);
  const bpm = rng.int(def.bpm[0], def.bpm[1]);
  const swing = def.swing[1] > 0 ? Math.round(rng.range(def.swing[0], def.swing[1]) * 100) / 100 : 0;
  const scale = MODES[mode].chords;
  // Chord roots sit around C3 so voicings and bass have room either side.
  const rootBase = 48 + tonic - (tonic > 6 ? 12 : 0);

  const buildChords = (degrees: readonly number[], previous: number[] | null): Chord[] => {
    let last = previous;
    return degrees.map((degree) => {
      const shape = pleasantShape(scale, degree, rng.weighted(def.shapes));
      const intervals = chordIntervals(scale, degree, shape);
      const root = scaleNote(rootBase, scale, degree);
      const rootClass = mod(root, 12);
      const classes = intervals.map((i) => mod(rootClass + i, 12));
      const voicing = voiceLead(classes, last, 53, 76);
      last = voicing;
      return { degree, root: root > rootBase + 6 ? root - 12 : root, classes, voicing, name: chordName(rootClass, intervals) };
    });
  };

  const pads = rng.pick(def.pads);
  const sound: Sound = {
    pad: {
      kind: pads,
      brightness: rng.range(0.25, 0.8),
      detune: rng.range(4, 14),
      attack: style === 'house' || style === 'techno' || style === 'chiptune' ? rng.range(0.005, 0.03) : rng.range(0.15, 1.2),
      release: rng.range(0.4, 2.2),
      rhythm: rng.weighted(def.padRhythms),
    },
    arp: { kind: rng.pick(def.arps), brightness: rng.range(0.3, 0.9), decay: rng.range(0.15, 0.6) },
    lead: { kind: rng.pick(def.leads), brightness: rng.range(0.3, 0.85), vibrato: rng.range(0, 1) },
    bass: { kind: rng.pick(def.basses), brightness: rng.range(0.2, 0.75) },
    kit: { kickPitch: rng.range(42, 58), kickDecay: rng.range(0.25, 0.6), snareTone: rng.range(160, 240), hatTone: rng.range(6000, 10000) },
    fx: {
      reverb: rng.range(def.reverb[0], def.reverb[1]),
      delay: rng.range(def.delay[0], def.delay[1]),
      delaySteps: rng.pick([3, 3, 2, 4, 6]),
      pump: rng.range(def.pump[0], def.pump[1]),
    },
  };

  // Parts that return come back the same: one plan per role, made the first time it appears.
  const form = rng.pick(FORMS);
  const plans = new Map<Role, Omit<Section, 'role' | 'bars' | 'layers' | 'energy'>>();
  let lastVoicing: number[] | null = null;
  const sections: Section[] = form.map(([role, bars]) => {
    let plan = plans.get(role);
    if (!plan) {
      const verse = plans.get('verse') ?? plans.get('chorus');
      const degrees = (role === 'intro' || role === 'outro' || role === 'break') && verse && rng.chance(0.6) ? verse.chords.map((c) => c.degree) : progression(rng, mode);
      const chordBars = rng.weighted(def.chordBars);
      plan = {
        chords: buildChords(degrees, lastVoicing),
        chordBars,
        motif: makeMotif(rng, rng.range(def.density[0], def.density[1]) * (role === 'chorus' ? 1.2 : 1), style !== 'ambient' && style !== 'cinematic'),
        bassPattern: rng.pick(def.bass),
        arpShape: rng.pick(['up', 'down', 'updown', 'random', 'pinky'] as const),
        arpRate: rng.pick(def.arpRates),
        drums: def.drums ? rng.pick(def.drums) : null,
      };
      plans.set(role, plan);
    }
    lastVoicing = plan.chords.at(-1)?.voicing ?? lastVoicing;
    return { role, bars, layers: layersFor(role, style, rng), energy: Math.min(1, ROLE_ENERGY[role] * (0.5 + def.energy * 0.7)), ...plan };
  });

  return {
    seed,
    title: `${rng.pick(ADJECTIVES)} ${rng.pick(NOUNS)}`,
    style,
    bpm,
    swing,
    swingUnit: def.swingUnit,
    tonic,
    mode,
    key: `${NOTE_NAMES[tonic]} ${MODES[mode].name}`,
    sections,
    sound,
  };
}

export const songBars = (song: Song): number => song.sections.reduce((sum, s) => sum + s.bars, 0);
export const stepSeconds = (song: Song): number => 60 / song.bpm / 4;
export const barSeconds = (song: Song): number => (60 / song.bpm) * 4;

/** How late a step plays with the song's swing, in steps. */
export function swingOffset(song: Song, step: number): number {
  const unit = song.swingUnit;
  const whole = Math.round(step);
  if (Math.abs(step - whole) > 1e-6 || whole % unit !== 0) return 0;
  return (whole / unit) % 2 === 1 ? song.swing * unit : 0;
}

/** The chord sounding at a step of a bar of a section. */
export function chordAt(section: Section, bar: number, step: number): Chord {
  const index = Math.floor((bar + step / 16) / section.chordBars + 1e-9) % section.chords.length;
  return section.chords[index] as Chord;
}

const DRUM_VELOCITY: Record<string, number> = { x: 1, o: 0.65, '.': 0.32 };
const DRUM_PAN: Partial<Record<Voice, number>> = { hat: 0.25, openhat: -0.2, shaker: 0.4, rim: -0.15, tom: -0.1 };

/** Every note of one bar of one section; the same each time for the same song. */
export function barEvents(song: Song, sectionIndex: number, bar: number): NoteEvent[] {
  const section = song.sections[sectionIndex];
  if (!section) return [];
  const rng = createRng(`${song.seed}/bar/${sectionIndex}/${bar}`);
  const events: NoteEvent[] = [];
  const has = (layer: Layer): boolean => section.layers.includes(layer);
  const add = (voice: Voice, step: number, length: number, midi: number, velocity: number, pan = 0): void => {
    events.push({ voice, step, length, midi, velocity: Math.max(0, Math.min(1, velocity)), pan });
  };
  const lastBar = bar === section.bars - 1;
  const next = song.sections[sectionIndex + 1];
  const chordStarts: number[] = [];
  for (let step = 0; step < 16; step++) {
    const position = bar + step / 16;
    if (Math.abs(position / section.chordBars - Math.round(position / section.chordBars)) < 1e-9) chordStarts.push(step);
  }
  const chordLength = section.chordBars * 16;

  // Pad
  if (has('pad')) {
    const rhythm = song.sound.pad.rhythm;
    for (let step = 0; step < 16; step++) {
      const chord = chordAt(section, bar, step);
      const voicing = chord.voicing;
      const starts = chordStarts.includes(step);
      if (rhythm === 'hold' && starts) for (const m of voicing) add('pad', step, chordLength, m, 0.55);
      else if (rhythm === 'strum' && starts) voicing.forEach((m, i) => add('pad', step + i * 0.18, chordLength - i * 0.18, m, 0.5 + i * 0.04));
      else if (rhythm === 'stabs' && [2, 6, 10, 14].includes(step) && (step !== 6 || rng.chance(0.6))) for (const m of voicing) add('pad', step, 1.5, m, 0.5);
      else if (rhythm === 'pulse' && step % 2 === 0) for (const m of voicing) add('pad', step, 1.6, m, step % 4 === 0 ? 0.5 : 0.38);
      else if (rhythm === 'comp' && (step === 0 || step === 6 || (step === 10 && rng.chance(0.6)) || (step === 13 && rng.chance(0.3)))) {
        voicing.forEach((m, i) => add('pad', step + i * 0.08, step === 0 ? 5 : 3, m, 0.45 + rng.range(-0.05, 0.05)));
      }
    }
  }

  // Bass
  if (has('bass')) {
    const rootOf = (chord: Chord): number => (chord.root - 12 < 33 ? chord.root : chord.root - 12);
    // A held bass changes with the chord, however long the chord is; the patterns repeat each bar.
    const pattern = section.bassPattern === 'hold' ? chordStarts.map((step) => [step, chordLength, 'R'] as const) : BASS_PATTERNS[section.bassPattern];
    for (const [step, length, kind] of pattern) {
      const chord = chordAt(section, bar, step);
      let midi = rootOf(chord);
      const fifth = chord.classes[2] ?? chord.classes[1] ?? chord.classes[0] ?? 0;
      const third = chord.classes[1] ?? 0;
      const above = (pc: number): number => midi + mod(pc - midi, 12);
      if (kind === 'O') midi += 12;
      else if (kind === 'F') midi = above(fifth);
      else if (kind === '3') midi = above(third);
      else if (kind === 'A') {
        // Approach the next chord's root from a step away.
        midi = rootOf(chordAt(section, bar + 1, 0)) + (rng.chance(0.5) ? 1 : -1);
      }
      add('bass', step, length * 0.92, midi, step % 4 === 0 ? 0.85 : 0.7);
    }
  }

  // Arpeggio over the voicing and the octave above it
  if (has('arp')) {
    const rate = section.arpRate;
    const sound = song.sound.arp;
    for (let step = 0; step < 16; step += rate) {
      const chord = chordAt(section, bar, step);
      const notes = [...chord.voicing, ...chord.voicing.map((m) => m + 12)].sort((a, b) => a - b);
      const i = Math.round((bar * 16 + step) / rate);
      let midi: number;
      switch (section.arpShape) {
        case 'up':
          midi = notes[i % notes.length] as number;
          break;
        case 'down':
          midi = notes[notes.length - 1 - (i % notes.length)] as number;
          break;
        case 'updown': {
          const cycle = notes.length * 2 - 2;
          const k = i % cycle;
          midi = notes[k < notes.length ? k : cycle - k] as number;
          break;
        }
        case 'random':
          midi = rng.pick(notes);
          break;
        case 'pinky':
          midi = i % 2 === 0 ? (notes[0] as number) : (notes[notes.length - 1 - ((i >> 1) % 3)] as number);
          break;
      }
      const accent = step % 4 === 0 ? 0.62 : 0.45;
      add('arp', step, Math.max(0.8, rate * (0.6 + sound.decay)), midi, accent + rng.range(-0.05, 0.05), Math.sin(i * 1.7) * 0.5);
    }
  }

  // Lead: the section's motif, anchored on the chord, strong beats on chord tones
  if (has('lead')) {
    const scale = MODES[song.mode].melody;
    const base = 60 + song.tonic - (song.tonic > 7 ? 12 : 0);
    const pair = bar - (bar % 2);
    const half = bar % 2;
    const anchorChord = chordAt(section, pair, 0);
    // The scale index nearest to the anchor chord's root around the lead's register.
    let anchor = 0;
    let bestDistance = Infinity;
    for (let index = -4; index < 16; index++) {
      const m = scaleNote(base, scale, index);
      const d = Math.abs(m - 74) + (anchorChord.classes.includes(mod(m, 12)) ? 0 : 3);
      if (d < bestDistance) {
        bestDistance = d;
        anchor = index;
      }
    }
    const phraseEnd = lastBar || (section.bars >= 8 && bar % 4 === 3);
    const notes = section.motif.filter((n) => n.step >= half * 16 && n.step < half * 16 + 16);
    notes.forEach((note, i) => {
      if (rng.chance(0.12) && i > 0) return;
      const step = note.step - half * 16;
      let midi = scaleNote(base, scale, anchor + note.offset + (rng.chance(0.12) ? rng.pick([-1, 1]) : 0));
      const chord = chordAt(section, bar, step);
      if (step % 8 === 0 || (phraseEnd && i === notes.length - 1)) {
        // Strong beats and phrase ends on the nearest chord tone (the root to end a section).
        const wanted = phraseEnd && i === notes.length - 1 && lastBar ? [chord.classes[0] as number] : chord.classes;
        let best = midi;
        for (let d = 0; d <= 6; d++) {
          if (wanted.includes(mod(midi - d, 12))) { best = midi - d; break; }
          if (wanted.includes(mod(midi + d, 12))) { best = midi + d; break; }
        }
        midi = best;
      }
      while (midi > 88) midi -= 12;
      while (midi < 60) midi += 12;
      const length = phraseEnd && i === notes.length - 1 ? Math.max(note.length, 16 - step) : note.length;
      add('lead', step, Math.min(length, 16 - step + 8), midi, 0.6 + (step % 4 === 0 ? 0.1 : 0) + rng.range(-0.06, 0.06), 0.1);
    });
  }

  // Drums
  if (has('drums') && section.drums) {
    const fill = lastBar && next && next.energy > section.energy && song.style !== 'cinematic';
    for (const [voice, line] of Object.entries(section.drums) as [Voice, string][]) {
      for (let step = 0; step < 16; step++) {
        if (fill && step >= 12 && (voice === 'snare' || voice === 'clap' || voice === 'hat' || voice === 'openhat')) continue;
        const ch = line[step] ?? '-';
        const velocity = DRUM_VELOCITY[ch];
        if (velocity === undefined) continue;
        if (ch === '.' && !rng.chance(0.55)) continue;
        add(voice, step, voice === 'openhat' ? 2 : 1, 0, velocity + rng.range(-0.06, 0.04), DRUM_PAN[voice] ?? 0);
      }
    }
    if (fill) {
      const voice: Voice = section.drums.snare || song.style === 'house' || song.style === 'techno' ? 'snare' : 'tom';
      for (let step = 12; step < 16; step++) add(voice, step, 1, 0, 0.45 + (step - 12) * 0.15, (step - 13.5) * 0.2);
    } else if (bar % 4 === 3 && rng.chance(0.35) && section.drums.kick) {
      add('kick', 14, 1, 0, 0.55);
    }
  }

  // A crash where the drums come in or a chorus starts; a riser into a bigger part
  const previous = song.sections[sectionIndex - 1];
  if (bar === 0 && has('drums') && section.drums && (!previous || !previous.layers.includes('drums') || section.role === 'chorus')) {
    add('crash', 0, 16, 0, 0.7);
  }
  if (lastBar && next && next.energy - section.energy >= 0.25) add('riser', 0, 16, 0, 0.55);

  events.sort((a, b) => a.step - b.step);
  return events;
}
