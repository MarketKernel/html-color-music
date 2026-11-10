/**
 * Plays a Song: a look-ahead scheduler on the AudioContext's own clock. Each
 * bar is written by core/music.ts just before it is due, and every note is
 * started at its exact time, so timing does not depend on the page's frame
 * rate. The same times go out as cues — kick, snare, chord, new section — that
 * the picture reads when the audio clock reaches them: that is what keeps the
 * colours in time with the music.
 *
 * Each song plays into its own channel faders. Skipping fades those out and
 * starts the next song on fresh ones; whatever the old song had scheduled
 * plays into silence and is collected.
 */
import { barEvents, chordAt, stepSeconds, swingOffset, type Song, type Voice } from '../core/music';
import { makeRack, playArp, playBass, playDrum, playLead, playPad, type Rack } from './instruments';

export type Cue =
  | { kind: 'note'; time: number; voice: Voice; midi: number; velocity: number }
  | { kind: 'chord'; time: number; name: string; root: number }
  | { kind: 'section'; time: number; section: number }
  | { kind: 'bar'; time: number; section: number; bar: number };

interface SongChannels {
  faders: GainNode[];
  pad: GainNode;
  arp: GainNode;
  lead: GainNode;
  bass: GainNode;
  drums: GainNode;
  ducks: GainNode[];
}

export class Engine {
  readonly ctx: AudioContext | OfflineAudioContext;
  private readonly rack: Rack;
  private readonly input: GainNode;
  private readonly volume: GainNode;
  private readonly analyser: AnalyserNode;
  private readonly reverbIn: GainNode;
  private readonly delayIn: GainNode;
  private readonly delays: DelayNode[];
  private readonly samples: Float32Array<ArrayBuffer>;
  private song: Song | null = null;
  private channels: SongChannels | null = null;
  private cursor = { section: 0, bar: 0, time: 0 };
  private cues: Cue[] = [];
  private timer = 0;
  /** Called with the time the song ends, when its last bar has been scheduled. */
  onSongEnd: (time: number) => void = () => undefined;

  /** `offline` renders into a buffer instead of the speakers: the sound test measures the mix that way. */
  constructor(offline?: OfflineAudioContext) {
    const ctx = offline ?? new AudioContext({ latencyHint: 'playback' });
    this.ctx = ctx;
    this.rack = makeRack(ctx);

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 10;
    compressor.ratio.value = 3.5;
    compressor.attack.value = 0.01;
    compressor.release.value = 0.2;
    this.input = ctx.createGain();
    this.input.gain.value = 0.72;
    this.volume = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.samples = new Float32Array(this.analyser.fftSize);
    // The analyser listens before the volume: muted, the picture still moves with the music.
    this.input.connect(compressor).connect(this.analyser).connect(this.volume).connect(ctx.destination);

    // Reverb: a generated impulse — two decaying noise tails, one per ear.
    const reverb = ctx.createConvolver();
    const seconds = 3.4;
    const impulse = ctx.createBuffer(2, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const data = impulse.getChannelData(c);
      let low = 0;
      for (let i = 0; i < data.length; i++) {
        const fall = (1 - i / data.length) ** 3.2;
        // A one-pole lowpass that closes along the tail: later reflections are darker.
        const k = 0.9 - 0.75 * (i / data.length);
        low = low * (1 - k) + (Math.random() * 2 - 1) * k;
        data[i] = low * fall * (i < ctx.sampleRate * 0.012 ? 0 : 1);
      }
    }
    reverb.buffer = impulse;
    this.reverbIn = ctx.createGain();
    const reverbOut = ctx.createGain();
    reverbOut.gain.value = 0.55;
    this.reverbIn.connect(reverb).connect(reverbOut).connect(this.input);

    // Ping-pong delay: left feeds right feeds left, darker on every pass.
    this.delayIn = ctx.createGain();
    const left = ctx.createDelay(2);
    const right = ctx.createDelay(2);
    this.delays = [left, right];
    const feedback = ctx.createGain();
    feedback.gain.value = 0.42;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 3200;
    const panL = ctx.createStereoPanner();
    panL.pan.value = -0.7;
    const panR = ctx.createStereoPanner();
    panR.pan.value = 0.7;
    const delayOut = ctx.createGain();
    delayOut.gain.value = 0.5;
    this.delayIn.connect(left);
    left.connect(panL).connect(delayOut);
    left.connect(right);
    right.connect(panR).connect(delayOut);
    right.connect(tone).connect(feedback).connect(left);
    delayOut.connect(this.input);
    delayOut.connect(this.reverbIn);

    if (!offline) this.timer = window.setInterval(() => this.tick(), 50);
  }

  /** The audio clock as heard: what is coming out of the speakers now. */
  now(): number {
    const ctx = this.ctx;
    return ctx instanceof AudioContext ? ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0) : ctx.currentTime;
  }

  get playing(): boolean {
    return this.ctx.state === 'running';
  }

  setVolume(volume: number): void {
    // Perceived loudness follows the square, roughly.
    this.volume.gain.setTargetAtTime(volume * volume, this.ctx.currentTime, 0.05);
  }

  async pause(): Promise<void> {
    if (this.ctx instanceof AudioContext) await this.ctx.suspend();
  }

  async resume(): Promise<void> {
    if (this.ctx instanceof AudioContext) await this.ctx.resume();
    this.tick();
  }

  /**
   * Starts `song` at `at` (now, if not given). The song playing fades out over
   * `fade` seconds: short for a skip, long at a natural end so its last notes
   * ring out.
   */
  play(song: Song, at?: number, fade = 0.25): void {
    const t = Math.max(at ?? 0, this.ctx.currentTime + 0.08);
    if (this.channels) {
      for (const fader of this.channels.faders) {
        fader.gain.setTargetAtTime(0, t, fade / 4);
        const done = fader;
        window.setTimeout(() => done.disconnect(), (t - this.ctx.currentTime + fade * 2 + 0.5) * 1000);
      }
    }
    this.cues = this.cues.filter((cue) => cue.time < t);
    this.song = song;
    this.channels = this.makeChannels(song);
    const delay = song.sound.fx.delaySteps * stepSeconds(song);
    for (const d of this.delays) d.delayTime.setTargetAtTime(delay, t, 0.05);
    this.cursor = { section: 0, bar: 0, time: t };
    this.tick();
  }

  private makeChannels(song: Song): SongChannels {
    const ctx = this.ctx;
    const fx = song.sound.fx;
    const faders: GainNode[] = [];
    const ducks: GainNode[] = [];
    const channel = (level: number, reverb: number, delay: number, ducked: boolean): GainNode => {
      const fader = ctx.createGain();
      fader.gain.value = level;
      fader.connect(this.input);
      if (reverb > 0) {
        const send = ctx.createGain();
        send.gain.value = reverb;
        fader.connect(send).connect(this.reverbIn);
      }
      if (delay > 0) {
        const send = ctx.createGain();
        send.gain.value = delay;
        fader.connect(send).connect(this.delayIn);
      }
      faders.push(fader);
      if (!ducked) return fader;
      const duck = ctx.createGain();
      duck.connect(fader);
      ducks.push(duck);
      return duck;
    };
    return {
      faders,
      ducks,
      pad: channel(1, 0.7 * fx.reverb, 0.12 * fx.delay, true),
      arp: channel(0.9, 0.45 * fx.reverb, 0.65 * fx.delay, true),
      lead: channel(0.85, 0.5 * fx.reverb, 0.5 * fx.delay, false),
      bass: channel(1, 0.04 * fx.reverb, 0, true),
      drums: channel(0.9, 0.12 * fx.reverb, 0, false),
    };
  }

  /** Schedules every bar that starts before the look-ahead runs out. */
  tick(): void {
    if (this.ctx.state !== 'running') return;
    // Timers in a hidden tab fire once a second at best: look further ahead there.
    this.scheduleUntil(this.ctx.currentTime + (document.hidden ? 1.6 : 0.3));
  }

  /** Schedules every bar that starts before `until`, on to the next song if this one ends. */
  scheduleUntil(until: number): void {
    while (this.song && this.cursor.time < until) {
      if (this.cursor.section >= this.song.sections.length) {
        const end = this.cursor.time;
        this.song = null;
        this.onSongEnd(end);
        return;
      }
      this.scheduleBar(this.song);
    }
  }

  private scheduleBar(song: Song): void {
    const channels = this.channels as SongChannels;
    const { section: index, bar, time } = this.cursor;
    const section = song.sections[index];
    if (!section) return;
    const step = stepSeconds(song);
    if (bar === 0) this.cues.push({ kind: 'section', time, section: index });
    this.cues.push({ kind: 'bar', time, section: index, bar });
    for (let s = 0; s < 16; s++) {
      const position = bar + s / 16;
      const ratio = position / section.chordBars;
      if (Math.abs(ratio - Math.round(ratio)) < 1e-9) {
        const chord = chordAt(section, bar, s);
        this.cues.push({ kind: 'chord', time: time + s * step, name: chord.name, root: chord.root });
      }
    }
    const sound = song.sound;
    for (const note of barEvents(song, index, bar)) {
      const t = time + (note.step + swingOffset(song, note.step)) * step;
      const duration = note.length * step;
      switch (note.voice) {
        case 'pad':
          playPad(this.rack, channels.pad, note, t, duration, sound.pad);
          break;
        case 'arp':
          playArp(this.rack, channels.arp, note, t, duration, sound.arp);
          break;
        case 'lead':
          playLead(this.rack, channels.lead, note, t, duration, sound.lead);
          break;
        case 'bass':
          playBass(this.rack, channels.bass, note, t, duration, sound.bass);
          break;
        default:
          playDrum(this.rack, channels.drums, note, t, duration, sound.kit);
          if (note.voice === 'kick' && sound.fx.pump > 0.05) {
            // Sidechain pumping: the pad, arpeggio and bass duck under each kick.
            for (const duck of channels.ducks) {
              duck.gain.setValueAtTime(1 - sound.fx.pump * 0.75 * note.velocity, t);
              duck.gain.setTargetAtTime(1, t + 0.02, step * 1.3);
            }
          }
      }
      this.cues.push({ kind: 'note', time: t, voice: note.voice, midi: note.midi, velocity: note.velocity });
    }
    this.cursor.time += 16 * step;
    this.cursor.bar += 1;
    if (this.cursor.bar >= section.bars) {
      this.cursor.bar = 0;
      this.cursor.section += 1;
    }
  }

  /** The cues whose time has come, in order; they are removed. */
  takeCues(until: number): Cue[] {
    if (!this.cues.length) return [];
    this.cues.sort((a, b) => a.time - b.time);
    let n = 0;
    while (n < this.cues.length && (this.cues[n] as Cue).time <= until) n++;
    return this.cues.splice(0, n);
  }

  /** Loudness now, 0..1. */
  level(): number {
    this.analyser.getFloatTimeDomainData(this.samples);
    let sum = 0;
    for (let i = 0; i < this.samples.length; i++) sum += (this.samples[i] as number) ** 2;
    return Math.min(1, Math.sqrt(sum / this.samples.length) * 3);
  }

  close(): void {
    window.clearInterval(this.timer);
    if (this.ctx instanceof AudioContext) void this.ctx.close();
  }
}
