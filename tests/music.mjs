/**
 * The composer: chord theory with fixed answers, voice leading, a pinned song
 * for one seed, and for hundreds of seeds that every note is in range, in
 * time and in harmony where it should be.
 */
import { checker, load } from '../tools/load.mjs';

const { check, done } = checker();
const M = await load('core/music');
const mod = (n, m) => ((n % m) + m) % m;

// Theory
const major = M.MODES.ionian.chords;
check('I in C major', M.chordIntervals(major, 0, 'triad'), [0, 4, 7]);
check('vi is minor', M.chordIntervals(major, 5, 'triad'), [0, 3, 7]);
check('vii is diminished', M.chordIntervals(major, 6, 'triad'), [0, 3, 6]);
check('Imaj7', M.chordIntervals(major, 0, 'seventh'), [0, 4, 7, 11]);
check('V7', M.chordIntervals(major, 4, 'seventh'), [0, 4, 7, 10]);
check('ii9 drops the fifth', M.chordIntervals(major, 1, 'ninth'), [0, 3, 10, 14]);
check('sus4 on V', M.chordIntervals(major, 4, 'sus4'), [0, 5, 7]);

const names = [
  [0, [0, 4, 7], 'C'], [9, [0, 3, 7], 'Am'], [7, [0, 4, 7, 10], 'G7'], [0, [0, 4, 7, 11], 'Cmaj7'],
  [2, [0, 3, 7, 10], 'Dm7'], [11, [0, 3, 6], 'Bdim'], [11, [0, 3, 6, 10], 'Bm7♭5'], [7, [0, 5, 7], 'Gsus4'],
  [2, [0, 2, 7], 'Dsus2'], [0, [0, 4, 7, 14], 'Cadd9'], [2, [0, 3, 10, 14], 'Dm9'], [0, [0, 4, 8], 'Caug'], [10, [0, 4, 7], 'B♭'],
];
for (const [root, intervals, name] of names) check(`name ${name}`, M.chordName(root, intervals), name);

check('no sus2 on phrygian I (a semitone)', M.pleasantShape(M.MODES.phrygian.chords, 0, 'sus2'), 'triad');
check('no sus4 on lydian I (a tritone)', M.pleasantShape(M.MODES.lydian.chords, 0, 'sus4'), 'triad');
check('no minor ninth on phrygian I', M.pleasantShape(M.MODES.phrygian.chords, 0, 'add9'), 'triad');
check('sus2 on major I stays', M.pleasantShape(major, 0, 'sus2'), 'sus2');

const C = M.voiceLead([0, 4, 7], null, 53, 76);
check('voicing: the tones of the chord', C.map((m) => mod(m, 12)).sort((a, b) => a - b), [0, 4, 7]);
check('voicing: in range', C.every((m) => m >= 53 && m <= 76), true);
const F = M.voiceLead([5, 9, 0], C, 53, 76);
const moved = F.reduce((sum, n) => sum + Math.min(...C.map((c) => Math.abs(c - n))), 0);
check('C to F moves three semitones in all', moved, 3);
check('four tones at most', M.voiceLead([0, 4, 7, 11, 2], null, 53, 76).length, 4);
check('scaleNote wraps octaves', [M.scaleNote(60, major, 7), M.scaleNote(60, major, -1)], [72, 59]);

// One song, pinned: a change here changes what the seed "aurora" plays.
const song = M.makeSong('aurora');
check('pinned song', [song.title, song.style, song.key, song.bpm], ['Crimson Monsoon', 'downtempo', 'C♯ phrygian', 89]);
check('the same seed, the same song', JSON.stringify(M.makeSong('aurora')), JSON.stringify(song));
check('the same bar, the same notes', JSON.stringify(M.barEvents(song, 2, 3)), JSON.stringify(M.barEvents(song, 2, 3)));
check('a style lock is kept', M.makeSong('aurora', 'chiptune').style, 'chiptune');

// Swing and chord timing
const lofi = { ...M.makeSong('swing', 'lofi'), swing: 0.3 };
check('lo-fi swings eighths', [M.swingOffset(lofi, 2), M.swingOffset(lofi, 4), M.swingOffset(lofi, 1), M.swingOffset(lofi, 6)].map((x) => +x.toFixed(2)), [0.6, 0, 0, 0.6]);
const fast = { chordBars: 0.5, chords: ['a', 'b', 'c', 'd'] };
check('two chords a bar', [M.chordAt(fast, 0, 0), M.chordAt(fast, 0, 8), M.chordAt(fast, 1, 0), M.chordAt(fast, 2, 0)], ['a', 'b', 'c', 'a']);
const slow = { chordBars: 2, chords: ['a', 'b'] };
check('a chord over two bars', [M.chordAt(slow, 0, 0), M.chordAt(slow, 1, 15), M.chordAt(slow, 2, 0), M.chordAt(slow, 4, 0)], ['a', 'a', 'b', 'a']);

// Hundreds of seeds
const RANGES = { pad: [53, 76], bass: [28, 60], lead: [60, 88], arp: [53, 100] };
const styles = new Set();
const modes = new Set();
const problems = [];
let leadStrong = 0;
let leadStrongOnChord = 0;
for (let i = 0; i < 300; i++) {
  const s = M.makeSong(`seed-${i}`);
  styles.add(s.style);
  modes.add(s.mode);
  const seconds = M.songBars(s) * M.barSeconds(s);
  if (seconds < 40 || seconds > 360) problems.push(`${s.seed}: ${seconds.toFixed(0)} s long`);
  s.sections.forEach((section, si) => {
    if (!(section.energy > 0 && section.energy <= 1)) problems.push(`${s.seed}: energy ${section.energy}`);
    for (const chord of section.chords) {
      if (chord.voicing.some((m) => !chord.classes.includes(mod(m, 12)))) problems.push(`${s.seed}: voicing outside ${chord.name}`);
    }
    // Sixteenths still sounding from notes begun in earlier bars.
    let ringing = 0;
    for (let bar = 0; bar < section.bars; bar++) {
      const events = M.barEvents(s, si, bar);
      if (!events.length && ringing <= 0) problems.push(`${s.seed}: silent bar ${si}/${bar}`);
      ringing = Math.max(ringing - 16, ...events.map((e) => e.step + e.length - 16));
      for (const e of events) {
        if (!(e.step >= 0 && e.step < 16 && e.length > 0 && e.velocity >= 0 && e.velocity <= 1 && Math.abs(e.pan) <= 1)) problems.push(`${s.seed}: ${JSON.stringify(e)}`);
        const range = RANGES[e.voice];
        if (range && (e.midi < range[0] || e.midi > range[1])) problems.push(`${s.seed}: ${e.voice} ${e.midi} out of ${range}`);
        if (e.voice === 'pad' && !M.chordAt(section, bar, Math.floor(e.step)).classes.includes(mod(e.midi, 12))) problems.push(`${s.seed}: pad note off its chord`);
        if (e.voice === 'lead' && e.step % 8 === 0) {
          leadStrong += 1;
          if (M.chordAt(section, bar, e.step).classes.includes(mod(e.midi, 12))) leadStrongOnChord += 1;
        }
      }
    }
  });
}
check('every song well-formed', problems.slice(0, 5), []);
check('every style turns up', styles.size, M.STYLES.length);
check('every mode turns up', modes.size, Object.keys(M.MODES).length);
// Off-chord on a strong beat only by the motif's ±1 variation.
check('strong beats of the melody on chord tones (≥ 85%)', leadStrongOnChord / leadStrong >= 0.85, true);

done('music');
