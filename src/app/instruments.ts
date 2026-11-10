/**
 * The instruments, built from Web Audio nodes for each note: oscillators,
 * FM pairs and filtered noise, shaped by envelopes. Nothing is sampled, so
 * the page stays one file. Every node of a note stops by itself when the note
 * is over; the browser collects it.
 */
import type { NoteEvent, Sound } from '../core/music';

export interface Channels {
  pad: AudioNode;
  arp: AudioNode;
  lead: AudioNode;
  bass: AudioNode;
  drums: AudioNode;
}

export interface Rack {
  ctx: BaseAudioContext;
  noise: AudioBuffer;
  pulse: PeriodicWave;
}

const mtof = (m: number): number => 440 * 2 ** ((m - 69) / 12);

export function makeRack(ctx: BaseAudioContext): Rack {
  const length = ctx.sampleRate * 2;
  const noise = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  // A 25% pulse wave, the chiptune sound, from its Fourier series.
  const harmonics = 48;
  const real = new Float32Array(harmonics);
  const imag = new Float32Array(harmonics);
  for (let n = 1; n < harmonics; n++) imag[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * 0.25);
  return { ctx, noise, pulse: ctx.createPeriodicWave(real, imag) };
}

/** Attack, then decay to sustain, held until `end`, then released; returns when the note is silent. */
function adsr(param: AudioParam, t: number, end: number, peak: number, attack: number, decay: number, sustain: number, release: number): number {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + attack);
  param.setTargetAtTime(peak * sustain, t + attack, Math.max(decay, 0.001) / 3);
  // A second target picks up from wherever the first has got to: no need to cancel it.
  const off = Math.max(end, t + attack);
  param.setTargetAtTime(0, off, Math.max(release, 0.005) / 4);
  return off + release * 1.2;
}

/** A plucked or struck note: up at once, then an exponential fall. */
function strike(param: AudioParam, t: number, peak: number, decay: number): number {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + 0.004);
  param.setTargetAtTime(0, t + 0.004, decay / 4);
  return t + decay * 1.3;
}

function osc(rack: Rack, type: OscillatorType | 'pulse', frequency: number, detune = 0): OscillatorNode {
  const o = rack.ctx.createOscillator();
  if (type === 'pulse') o.setPeriodicWave(rack.pulse);
  else o.type = type;
  o.frequency.value = frequency;
  o.detune.value = detune;
  return o;
}

function gain(rack: Rack, value = 0): GainNode {
  const g = rack.ctx.createGain();
  g.gain.value = value;
  return g;
}

function filter(rack: Rack, type: BiquadFilterType, frequency: number, q = 0.7): BiquadFilterNode {
  const f = rack.ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = frequency;
  f.Q.value = q;
  return f;
}

function noiseSource(rack: Rack, t: number): AudioBufferSourceNode {
  const s = rack.ctx.createBufferSource();
  s.buffer = rack.noise;
  s.loop = true;
  s.loopStart = Math.random();
  s.start(t, Math.random() * 1.5);
  return s;
}

function panned(rack: Rack, out: AudioNode, pan: number): AudioNode {
  if (!pan) return out;
  const p = rack.ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  p.connect(out);
  return p;
}

function start(nodes: (OscillatorNode | AudioBufferSourceNode)[], t: number, stop: number): void {
  for (const n of nodes) {
    if (n instanceof OscillatorNode) n.start(t);
    n.stop(stop);
  }
}

/** A sine (or other) modulating a carrier's frequency, its depth falling from `index` to `rest`. */
function fm(rack: Rack, t: number, f: number, ratio: number, index: number, rest: number, fall: number, carrierType: OscillatorType = 'sine'): { carrier: OscillatorNode; modulator: OscillatorNode } {
  const carrier = osc(rack, carrierType, f);
  const modulator = osc(rack, 'sine', f * ratio);
  const depth = gain(rack);
  depth.gain.setValueAtTime(f * index, t);
  depth.gain.setTargetAtTime(f * rest, t, fall / 3);
  modulator.connect(depth).connect(carrier.frequency);
  return { carrier, modulator };
}

function vibrato(rack: Rack, t: number, targets: OscillatorNode[], cents: number, delay: number, rate = 5.2): OscillatorNode {
  const lfo = osc(rack, 'sine', rate);
  const depth = gain(rack);
  depth.gain.setValueAtTime(0, t);
  depth.gain.linearRampToValueAtTime(cents, t + delay + 0.3);
  lfo.connect(depth);
  for (const o of targets) depth.connect(o.detune);
  return lfo;
}

export function playPad(rack: Rack, out: AudioNode, note: NoteEvent, t: number, duration: number, sound: Sound['pad']): void {
  const f = mtof(note.midi);
  const v = note.velocity;
  const end = t + duration;
  const amp = gain(rack);
  amp.connect(panned(rack, out, note.pan));
  const sources: OscillatorNode[] = [];
  let stop: number;
  switch (sound.kind) {
    case 'epiano': {
      const body = fm(rack, t, f, 1, 1.4 + sound.brightness * 2, 0.25, 1.2);
      const tine = fm(rack, t, f, 14, 0.5 + sound.brightness, 0, 0.12);
      const tineAmp = gain(rack, 0.12);
      body.carrier.connect(amp);
      tine.carrier.connect(tineAmp).connect(amp);
      sources.push(body.carrier, body.modulator, tine.carrier, tine.modulator);
      stop = adsr(amp.gain, t, end, 0.11 * v, 0.005, 1.6, 0.35, 0.5);
      break;
    }
    case 'organ': {
      const lp = filter(rack, 'lowpass', 2500 + sound.brightness * 4000);
      lp.connect(amp);
      [1, 2, 3, 4].forEach((h, i) => {
        const o = osc(rack, 'sine', f * h, (i - 1.5) * 2);
        const g = gain(rack, [0.5, 0.35, 0.18, 0.12][i]);
        o.connect(g).connect(lp);
        sources.push(o);
      });
      stop = adsr(amp.gain, t, end, 0.09 * v, 0.004, 0.2, 0.75, 0.08);
      break;
    }
    case 'chip': {
      const o = osc(rack, 'pulse', f);
      o.connect(amp);
      sources.push(o);
      stop = adsr(amp.gain, t, end, 0.045 * v, 0.003, 0.1, 0.6, 0.05);
      break;
    }
    default: {
      // warm, glass, strings: detuned stacks through a lowpass that opens with the note.
      const glass = sound.kind === 'glass';
      const strings = sound.kind === 'strings';
      const types: OscillatorType[] = glass ? ['triangle', 'sine', 'triangle'] : ['sawtooth', 'sawtooth', strings ? 'sawtooth' : 'triangle'];
      const cutoff = (glass ? 2500 : 700) + sound.brightness * (strings ? 2600 : 2200);
      const lp = filter(rack, 'lowpass', cutoff * 0.5, glass ? 0.5 : 0.9);
      lp.frequency.setValueAtTime(cutoff * 0.4, t);
      lp.frequency.linearRampToValueAtTime(cutoff, t + Math.max(sound.attack, 0.05) * 1.5);
      lp.connect(amp);
      types.forEach((type, i) => {
        const ratio = glass && i === 1 ? 2 : !glass && i === 2 && !strings ? 0.5 : 1;
        const o = osc(rack, type, f * ratio, (i - 1) * sound.detune);
        const g = gain(rack, i === 2 ? 0.5 : 0.6);
        o.connect(g).connect(lp);
        sources.push(o);
      });
      if (strings) sources.push(vibrato(rack, t, sources.slice(), 7, 0.3, 5.5));
      const attack = strings ? Math.max(sound.attack, 0.35) : sound.attack;
      stop = adsr(amp.gain, t, end, (glass ? 0.07 : 0.06) * v, attack, 0.8, 0.8, sound.release);
    }
  }
  start(sources, t, stop);
}

export function playArp(rack: Rack, out: AudioNode, note: NoteEvent, t: number, duration: number, sound: Sound['arp']): void {
  const f = mtof(note.midi);
  const v = note.velocity;
  const amp = gain(rack);
  amp.connect(panned(rack, out, note.pan));
  const sources: OscillatorNode[] = [];
  let stop: number;
  switch (sound.kind) {
    case 'pluck': {
      const o = osc(rack, 'sawtooth', f);
      const o2 = osc(rack, 'square', f, 7);
      const lp = filter(rack, 'lowpass', 300, 3);
      lp.frequency.setValueAtTime(400 + sound.brightness * 5000, t);
      lp.frequency.setTargetAtTime(250, t, 0.05 + sound.decay * 0.15);
      const mix = gain(rack, 0.4);
      o.connect(lp);
      o2.connect(mix).connect(lp);
      lp.connect(amp);
      sources.push(o, o2);
      stop = strike(amp.gain, t, 0.1 * v, 0.25 + sound.decay * 0.8);
      break;
    }
    case 'bell': {
      const b = fm(rack, t, f, 3.5, 2 + sound.brightness * 3, 0.2, 0.8);
      b.carrier.connect(amp);
      sources.push(b.carrier, b.modulator);
      stop = strike(amp.gain, t, 0.08 * v, 1 + sound.decay * 2);
      break;
    }
    case 'chip': {
      const o = osc(rack, 'pulse', f);
      o.connect(amp);
      sources.push(o);
      stop = adsr(amp.gain, t, t + duration, 0.05 * v, 0.002, 0.08, 0.5, 0.03);
      break;
    }
    case 'marimba': {
      const o = osc(rack, 'sine', f);
      const o4 = osc(rack, 'sine', f * 4);
      const g4 = gain(rack);
      strike(g4.gain, t, 0.3, 0.06);
      o.connect(amp);
      o4.connect(g4).connect(amp);
      sources.push(o, o4);
      stop = strike(amp.gain, t, 0.13 * v, 0.35 + sound.decay * 0.5);
      break;
    }
  }
  start(sources, t, stop);
}

export function playLead(rack: Rack, out: AudioNode, note: NoteEvent, t: number, duration: number, sound: Sound['lead']): void {
  const f = mtof(note.midi);
  const v = note.velocity;
  const end = t + duration;
  const amp = gain(rack);
  amp.connect(panned(rack, out, note.pan));
  const sources: (OscillatorNode | AudioBufferSourceNode)[] = [];
  let stop: number;
  const wobble = (oscs: OscillatorNode[]): void => {
    if (sound.vibrato > 0.15 && duration > 0.25) sources.push(vibrato(rack, t, oscs, 8 + sound.vibrato * 18, Math.min(0.25, duration * 0.4)));
  };
  switch (sound.kind) {
    case 'saw':
    case 'square': {
      const type: OscillatorType = sound.kind === 'saw' ? 'sawtooth' : 'square';
      const a = osc(rack, type, f, -6);
      const b = osc(rack, type, f, 6);
      const lp = filter(rack, 'lowpass', 900 + sound.brightness * 4000, 1.5);
      a.connect(lp);
      b.connect(lp);
      lp.connect(amp);
      sources.push(a, b);
      wobble([a, b]);
      stop = adsr(amp.gain, t, end, 0.05 * v, 0.01, 0.3, 0.7, 0.18);
      break;
    }
    case 'sine': {
      const a = osc(rack, 'sine', f);
      const b = osc(rack, 'triangle', f * 2);
      const g = gain(rack, 0.12 + sound.brightness * 0.2);
      a.connect(amp);
      b.connect(g).connect(amp);
      sources.push(a, b);
      wobble([a, b]);
      stop = adsr(amp.gain, t, end, 0.11 * v, 0.02, 0.4, 0.75, 0.25);
      break;
    }
    case 'bell': {
      const b = fm(rack, t, f, 2, 1.5 + sound.brightness * 2.5, 0.3, 0.6);
      b.carrier.connect(amp);
      sources.push(b.carrier, b.modulator);
      stop = strike(amp.gain, t, 0.1 * v, 1.2 + duration);
      break;
    }
    case 'chip': {
      const o = osc(rack, 'square', f);
      o.connect(amp);
      sources.push(o);
      wobble([o]);
      stop = adsr(amp.gain, t, end, 0.04 * v, 0.002, 0.1, 0.8, 0.04);
      break;
    }
    case 'flute': {
      const a = osc(rack, 'sine', f);
      const b = osc(rack, 'sine', f * 2);
      const g = gain(rack, 0.08);
      const breath = noiseSource(rack, t);
      const bp = filter(rack, 'bandpass', f * 2, 4);
      const bg = gain(rack, 0.18);
      breath.connect(bp).connect(bg).connect(amp);
      a.connect(amp);
      b.connect(g).connect(amp);
      sources.push(a, b, breath);
      wobble([a, b]);
      stop = adsr(amp.gain, t, end, 0.11 * v, 0.07, 0.3, 0.8, 0.2);
      break;
    }
  }
  start(sources, t, stop);
}

export function playBass(rack: Rack, out: AudioNode, note: NoteEvent, t: number, duration: number, sound: Sound['bass']): void {
  const f = mtof(note.midi);
  const v = note.velocity;
  const end = t + duration;
  const amp = gain(rack);
  amp.connect(out);
  const sources: OscillatorNode[] = [];
  let stop: number;
  switch (sound.kind) {
    case 'sub': {
      const a = osc(rack, 'sine', f);
      const b = osc(rack, 'triangle', f * 2);
      const g = gain(rack, 0.08 + sound.brightness * 0.15);
      a.connect(amp);
      b.connect(g).connect(amp);
      sources.push(a, b);
      stop = adsr(amp.gain, t, end, 0.3 * v, 0.01, 0.4, 0.85, 0.08);
      break;
    }
    case 'acid': {
      const a = osc(rack, 'sawtooth', f);
      const lp = filter(rack, 'lowpass', 200, 12 + sound.brightness * 8);
      lp.frequency.setValueAtTime(250 + v * v * (800 + sound.brightness * 2600), t);
      lp.frequency.setTargetAtTime(180, t, 0.08);
      a.connect(lp).connect(amp);
      sources.push(a);
      stop = adsr(amp.gain, t, end, 0.11 * v, 0.003, 0.2, 0.7, 0.04);
      break;
    }
    case 'fm': {
      const b = fm(rack, t, f, 1, 1.5 + sound.brightness * 2.5, 0.3, 0.25);
      const sub = osc(rack, 'sine', f);
      const sg = gain(rack, 0.6);
      b.carrier.connect(amp);
      sub.connect(sg).connect(amp);
      sources.push(b.carrier, b.modulator, sub);
      stop = adsr(amp.gain, t, end, 0.2 * v, 0.004, 0.3, 0.7, 0.06);
      break;
    }
    default: {
      // saw, square: a filtered wave on a sine sub.
      const a = osc(rack, sound.kind === 'saw' ? 'sawtooth' : 'square', f);
      const sub = osc(rack, 'sine', f);
      const lp = filter(rack, 'lowpass', 200, 2);
      lp.frequency.setValueAtTime(300 + sound.brightness * 1400, t);
      lp.frequency.setTargetAtTime(160 + sound.brightness * 300, t, 0.12);
      const sg = gain(rack, 1.4);
      a.connect(lp).connect(amp);
      sub.connect(sg).connect(amp);
      sources.push(a, sub);
      stop = adsr(amp.gain, t, end, 0.12 * v, 0.004, 0.25, 0.75, 0.05);
    }
  }
  start(sources, t, stop);
}

export function playDrum(rack: Rack, out: AudioNode, note: NoteEvent, t: number, duration: number, kit: Sound['kit']): void {
  const v = note.velocity;
  const amp = gain(rack);
  amp.connect(panned(rack, out, note.pan));
  switch (note.voice) {
    case 'kick': {
      const o = osc(rack, 'sine', kit.kickPitch * 3);
      o.frequency.setValueAtTime(kit.kickPitch * 3.2, t);
      o.frequency.exponentialRampToValueAtTime(kit.kickPitch, t + 0.09);
      o.connect(amp);
      const click = noiseSource(rack, t);
      const hp = filter(rack, 'highpass', 3000);
      const cg = gain(rack);
      strike(cg.gain, t, 0.12 * v, 0.012);
      click.connect(hp).connect(cg).connect(amp);
      const stop = strike(amp.gain, t, 0.9 * v, kit.kickDecay);
      o.start(t);
      o.stop(stop);
      click.stop(t + 0.05);
      break;
    }
    case 'snare':
    case 'clap': {
      const n = noiseSource(rack, t);
      const bp = filter(rack, 'bandpass', note.voice === 'clap' ? 1200 : 2200, note.voice === 'clap' ? 1.2 : 0.8);
      const ng = gain(rack);
      n.connect(bp).connect(ng).connect(amp);
      if (note.voice === 'clap') {
        // Three quick slaps, then the tail.
        ng.gain.setValueAtTime(0, t);
        for (let i = 0; i < 3; i++) {
          ng.gain.setValueAtTime(0.5 * v, t + i * 0.011);
          ng.gain.setTargetAtTime(0.05, t + i * 0.011 + 0.001, 0.003);
        }
        ng.gain.setValueAtTime(0.4 * v, t + 0.034);
        ng.gain.setTargetAtTime(0, t + 0.034, 0.05);
      } else {
        strike(ng.gain, t, 0.45 * v, 0.18);
        const body = osc(rack, 'triangle', kit.snareTone);
        body.frequency.exponentialRampToValueAtTime(kit.snareTone * 0.7, t + 0.08);
        const bg = gain(rack);
        strike(bg.gain, t, 0.4 * v, 0.09);
        body.connect(bg).connect(amp);
        body.start(t);
        body.stop(t + 0.2);
      }
      amp.gain.value = 0.7;
      n.stop(t + 0.35);
      break;
    }
    case 'hat':
    case 'openhat':
    case 'shaker': {
      const n = noiseSource(rack, t);
      const hp = filter(rack, 'highpass', note.voice === 'shaker' ? 5000 : kit.hatTone, 0.9);
      n.connect(hp).connect(amp);
      const decay = note.voice === 'openhat' ? 0.28 : note.voice === 'shaker' ? 0.06 : 0.045;
      if (note.voice === 'shaker') {
        amp.gain.setValueAtTime(0, t);
        amp.gain.linearRampToValueAtTime(0.1 * v, t + 0.02);
        amp.gain.setTargetAtTime(0, t + 0.02, decay / 3);
      } else strike(amp.gain, t, (note.voice === 'openhat' ? 0.13 : 0.16) * v, decay);
      n.stop(t + decay * 2 + 0.05);
      break;
    }
    case 'rim': {
      const o = osc(rack, 'triangle', 1700);
      const bp = filter(rack, 'bandpass', 1700, 6);
      o.connect(bp).connect(amp);
      const stop = strike(amp.gain, t, 0.5 * v, 0.035);
      o.start(t);
      o.stop(stop);
      break;
    }
    case 'tom': {
      const o = osc(rack, 'sine', 130);
      o.frequency.setValueAtTime(140, t);
      o.frequency.exponentialRampToValueAtTime(70, t + 0.35);
      o.connect(amp);
      const stop = strike(amp.gain, t, 0.7 * v, 0.6);
      o.start(t);
      o.stop(stop);
      break;
    }
    case 'crash': {
      const n = noiseSource(rack, t);
      const hp = filter(rack, 'highpass', 4500, 0.6);
      const peak = filter(rack, 'peaking', 7500, 2);
      peak.gain.value = 6;
      n.connect(hp).connect(peak).connect(amp);
      const stop = strike(amp.gain, t, 0.12 * v, 1.8);
      n.stop(stop);
      break;
    }
    case 'riser': {
      const n = noiseSource(rack, t);
      const bp = filter(rack, 'bandpass', 300, 3);
      bp.frequency.setValueAtTime(300, t);
      bp.frequency.exponentialRampToValueAtTime(7000, t + duration);
      n.connect(bp).connect(amp);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(0.16 * v, t + duration * 0.97);
      amp.gain.linearRampToValueAtTime(0, t + duration + 0.02);
      n.stop(t + duration + 0.05);
      break;
    }
    default:
      break;
  }
}
