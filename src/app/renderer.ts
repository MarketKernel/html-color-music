/**
 * WebGL2: the scene pass draws into one of two textures, reading the other
 * for trails (ping-pong), then the present pass puts it on the canvas with a
 * glow from its mipmaps. The render is smaller than the canvas and its size
 * follows the frame rate, so a laptop on battery stays smooth.
 *
 * Two scene slots: A shows, B takes over during a transition, then becomes A.
 * Each slot keeps its own clock, angle and palette phase, advanced in beats of
 * the music, so motion speeds up and slows down with the song.
 */
import type { Scene } from '../core/scene';
import presentSource from './present.glsl';
import sceneSource from './scene.glsl';
import vertexSource from './quad.vert.glsl';

export interface Pulse {
  /** Beats per second of the music now. */
  beatsPerSecond: number;
  /** 0..1, decaying: the kick, the snare/clap, melody notes, a crash. */
  beat: number;
  snare: number;
  note: number;
  flash: number;
  /** 0..1, smoothed: how busy the music is. */
  energy: number;
  level: number;
  /** Palette offset from the chord now playing. */
  chordHue: number;
  calm: boolean;
}

interface Slot {
  scene: Scene;
  time: number;
  angle: number;
  palShift: number;
}

interface Target {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
}

const SLOT_FIELDS = ['pattern', 'warp', 'sym', 'folds', 'knobs', 'center', 'zoom', 'time', 'angle', 'warpAmt', 'pa', 'pb', 'pc', 'pd', 'palShift', 'bands', 'sat'] as const;

export class Renderer {
  private readonly gl: WebGL2RenderingContext;
  private sceneProgram!: WebGLProgram;
  private presentProgram!: WebGLProgram;
  private locations = new Map<string, WebGLUniformLocation | null>();
  private targets: Target[] = [];
  private current = 0;
  private width = 0;
  private height = 0;
  private halfFloat = false;
  /** Render size as a share of the canvas; follows the frame rate. */
  private scale = 0.6;
  private frameTimes: number[] = [];
  private a: Slot | null = null;
  private b: Slot | null = null;
  private mix = 0;
  private mixStart = 0;
  private mixDuration = 1;
  private clock = 0;
  private lost = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.lost = true;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      this.setup();
    });
    this.setup();
  }

  private setup(): void {
    const gl = this.gl;
    this.halfFloat = !!gl.getExtension('EXT_color_buffer_float');
    this.sceneProgram = this.program(vertexSource, sceneSource);
    this.presentProgram = this.program(vertexSource, presentSource);
    this.locations.clear();
    this.targets = [];
    this.width = 0;
    this.height = 0;
    gl.bindVertexArray(gl.createVertexArray());
  }

  private program(vertex: string, fragment: string): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, source: string): WebGLShader => {
      const shader = gl.createShader(type) as WebGLShader;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        throw new Error(`Shader: ${gl.getShaderInfoLog(shader) ?? 'does not compile'}`);
      }
      return shader;
    };
    const program = gl.createProgram() as WebGLProgram;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error(`Shader program: ${gl.getProgramInfoLog(program) ?? 'does not link'}`);
    }
    return program;
  }

  private at(program: WebGLProgram, name: string): WebGLUniformLocation | null {
    const key = `${program === this.sceneProgram ? 's' : 'p'}:${name}`;
    if (!this.locations.has(key)) this.locations.set(key, this.gl.getUniformLocation(program, name));
    return this.locations.get(key) ?? null;
  }

  private resize(): void {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const ch = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    const w = Math.max(16, Math.round(cw * this.scale));
    const h = Math.max(16, Math.round(ch * this.scale));
    if (w === this.width && h === this.height && this.targets.length === 2) return;
    for (const t of this.targets) {
      gl.deleteTexture(t.texture);
      gl.deleteFramebuffer(t.framebuffer);
    }
    this.width = w;
    this.height = h;
    this.targets = [0, 1].map(() => {
      const texture = gl.createTexture() as WebGLTexture;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      const levels = Math.floor(Math.log2(Math.max(w, h))) + 1;
      gl.texStorage2D(gl.TEXTURE_2D, levels, this.halfFloat ? gl.RGBA16F : gl.RGBA8, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
      const framebuffer = gl.createFramebuffer() as WebGLFramebuffer;
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.generateMipmap(gl.TEXTURE_2D);
      return { texture, framebuffer };
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Shows `scene`, taking over from the one on screen over `seconds` (0: at once). */
  show(scene: Scene, seconds: number): void {
    const slot: Slot = { scene, time: Math.random() * 20, angle: 0, palShift: 0 };
    if (!this.a || seconds <= 0) {
      this.a = slot;
      this.b = null;
      this.mix = 0;
      return;
    }
    // A transition still running ends where it is: its new scene becomes the old one.
    if (this.b) this.a = this.b;
    this.b = slot;
    this.mix = 0;
    this.mixStart = this.clock;
    this.mixDuration = seconds;
  }

  /** The scene on screen, or coming on. */
  get scene(): Scene | null {
    return (this.b ?? this.a)?.scene ?? null;
  }

  /** Draws one frame; `dt` in seconds. */
  frame(dt: number, pulse: Pulse): void {
    if (this.lost || !this.a) return;
    const gl = this.gl;
    dt = Math.min(dt, 0.1);
    this.clock += dt;
    this.adapt(dt);
    this.resize();

    if (this.b) {
      this.mix = Math.min(1, (this.clock - this.mixStart) / this.mixDuration);
      // Eased, so the change starts and lands softly.
      if (this.mix >= 1) {
        this.a = this.b;
        this.b = null;
        this.mix = 0;
      }
    }
    const lively = pulse.calm ? 0.45 : 1;
    const beats = dt * pulse.beatsPerSecond;
    for (const slot of [this.a, this.b]) {
      if (!slot) continue;
      const surge = pulse.calm ? 0 : pulse.beat * 0.9;
      slot.time += beats * slot.scene.speed * lively * (0.75 + 0.5 * pulse.energy + surge) * 4;
      slot.angle += beats * slot.scene.spin * lively;
      slot.palShift += beats * slot.scene.paletteSpeed;
    }

    const previous = this.targets[this.current] as Target;
    this.current = 1 - this.current;
    const next = this.targets[this.current] as Target;

    // Scene pass
    gl.useProgram(this.sceneProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, next.framebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, previous.texture);
    const s = (name: string): WebGLUniformLocation | null => this.at(this.sceneProgram, name);
    gl.uniform1i(s('uPrev'), 0);
    gl.uniform2f(s('uRes'), this.width, this.height);
    this.slotUniforms('uA', this.a);
    this.slotUniforms('uB', this.b ?? this.a);
    const eased = this.mix * this.mix * (3 - 2 * this.mix);
    gl.uniform1f(s('uMix'), this.b ? Math.max(eased, 1e-4) : 0);
    gl.uniform1i(s('uTransition'), (this.b ?? this.a).scene.transition);
    const blend = (pick: (scene: Scene) => number): number => {
      const x = pick(this.a!.scene);
      return this.b ? x + (pick(this.b.scene) - x) * eased : x;
    };
    gl.uniform1f(s('uFeedback'), blend((x) => x.feedback) * (pulse.calm ? 0.9 : 1));
    gl.uniform1f(s('uFbZoom'), blend((x) => x.feedbackZoom));
    gl.uniform1f(s('uFbTurn'), blend((x) => x.feedbackTurn));
    gl.uniform1f(s('uDt'), dt);
    gl.uniform1f(s('uBeat'), pulse.beat);
    gl.uniform1f(s('uSnare'), pulse.snare);
    gl.uniform1f(s('uNote'), pulse.note);
    gl.uniform1f(s('uEnergy'), pulse.energy);
    gl.uniform1f(s('uLevel'), pulse.level);
    gl.uniform1f(s('uCalm'), pulse.calm ? 1 : 0);
    gl.uniform1f(s('uChordHue'), pulse.chordHue);
    gl.uniform1f(s('uClock'), this.clock);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindTexture(gl.TEXTURE_2D, next.texture);
    gl.generateMipmap(gl.TEXTURE_2D);

    // Present pass
    gl.useProgram(this.presentProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const p = (name: string): WebGLUniformLocation | null => this.at(this.presentProgram, name);
    gl.uniform1i(p('uImage'), 0);
    gl.uniform2f(p('uOut'), this.canvas.width, this.canvas.height);
    gl.uniform1f(p('uGlow'), blend((x) => x.glow));
    gl.uniform1f(p('uBeat'), pulse.beat);
    gl.uniform1f(p('uSnare'), pulse.snare);
    gl.uniform1f(p('uFlash'), pulse.flash);
    gl.uniform1f(p('uCalm'), pulse.calm ? 1 : 0);
    gl.uniform1f(p('uClock'), this.clock);
    gl.uniform1f(p('uTopLevel'), Math.floor(Math.log2(Math.max(this.width, this.height))));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private slotUniforms(prefix: string, slot: Slot): void {
    const gl = this.gl;
    const sc = slot.scene;
    const values: Record<(typeof SLOT_FIELDS)[number], number | number[]> = {
      pattern: sc.pattern,
      warp: sc.warp,
      sym: sc.symmetry,
      folds: sc.folds,
      knobs: sc.knobs,
      center: sc.center,
      zoom: sc.zoom,
      time: slot.time,
      angle: slot.angle,
      warpAmt: sc.warpAmount,
      pa: sc.palette.a,
      pb: sc.palette.b,
      pc: sc.palette.c,
      pd: sc.palette.d,
      palShift: slot.palShift,
      bands: sc.bands,
      sat: sc.saturation,
    };
    for (const field of SLOT_FIELDS) {
      const location = this.at(this.sceneProgram, `${prefix}.${field}`);
      const value = values[field];
      if (field === 'pattern' || field === 'warp' || field === 'sym') gl.uniform1i(location, value as number);
      else if (typeof value === 'number') gl.uniform1f(location, value);
      else if (value.length === 2) gl.uniform2fv(location, value);
      else if (value.length === 3) gl.uniform3fv(location, value);
      else gl.uniform4fv(location, value);
    }
  }

  /** Smaller render when frames run long, bigger when there is room. */
  private adapt(dt: number): void {
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 40) return;
    const sorted = [...this.frameTimes].sort((x, y) => x - y);
    const typical = sorted[Math.floor(sorted.length / 2)] as number;
    this.frameTimes = [];
    if (typical > 1 / 40) this.scale = Math.max(0.25, this.scale * 0.82);
    else if (typical < 1 / 55) this.scale = Math.min(1, this.scale * 1.1);
  }

  /** The share of the canvas the render covers, for the info panel. */
  get quality(): number {
    return this.scale;
  }
}
