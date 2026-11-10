#version 300 es
// The picture, drawn into a texture the size of the render: one or two scenes
// (two while one takes over from the other), each a pattern seen through a
// fold of space and a bend of it, coloured by a cosine palette; then mixed
// with the previous frame, a little zoomed and turned, for trails.
//
// The pattern, warp and symmetry numbers are the indices of PATTERNS, WARPS
// and SYMMETRIES in src/core/scene.ts.
precision highp float;
precision highp int;

struct Slot {
  int pattern;
  int warp;
  int sym;
  float folds;
  vec4 knobs;
  vec2 center;
  float zoom;
  float time;
  float angle;
  float warpAmt;
  vec3 pa;
  vec3 pb;
  vec3 pc;
  vec3 pd;
  float palShift;
  float bands;
  float sat;
};

uniform Slot uA;
uniform Slot uB;
uniform vec2 uRes;
uniform sampler2D uPrev;
uniform float uMix;
uniform int uTransition;
uniform float uFeedback;
uniform float uFbZoom;
uniform float uFbTurn;
uniform float uDt;
uniform float uBeat;
uniform float uSnare;
uniform float uNote;
uniform float uEnergy;
uniform float uLevel;
uniform float uCalm;
uniform float uChordHue;
uniform float uClock;

out vec4 outColor;

#define PI 3.14159265
#define TAU 6.28318531

mat2 rot(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = m * p;
    a *= 0.5;
  }
  return v;
}

vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec2 cdiv(vec2 a, vec2 b) { return vec2(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / max(dot(b, b), 1e-12); }

vec2 symmetry(vec2 p, int s, float n) {
  if (s == 1) {
    p.x = abs(p.x);
  } else if (s == 2) {
    p = abs(p);
  } else if (s == 3) {
    float seg = TAU / n;
    float a = mod(atan(p.y, p.x), seg);
    a = abs(a - seg * 0.5);
    p = length(p) * vec2(cos(a), sin(a));
  } else if (s == 4) {
    float seg = TAU / n;
    float a = mod(atan(p.y, p.x) + seg * 0.5, seg) - seg * 0.5;
    p = length(p) * vec2(cos(a), sin(a));
  }
  return p;
}

vec2 warp(vec2 p, int w, float amt, float t) {
  if (w == 1) {
    float r = length(p);
    p = rot(amt * 1.6 * sin(t * 0.6 + r * 2.2)) * p;
  } else if (w == 2) {
    p += amt * 0.7 * (vec2(fbm(p * 1.4 + t * 0.25), fbm(p * 1.4 + vec2(5.2, 1.3) - t * 0.25)) - 0.5);
  } else if (w == 3) {
    float r = length(p);
    p += p / max(r, 1e-3) * sin(r * 10.0 - t * 3.0) * 0.06 * amt;
  } else if (w == 4) {
    p = p / max(dot(p, p), 0.03) * (0.5 + 0.5 * amt);
  } else if (w == 5) {
    // The angle folded to 0..π: atan jumps from π to -π on the left, a seam otherwise.
    p = vec2(abs(atan(p.y, p.x)) / PI * 2.0 - 1.0, log(max(length(p), 1e-4)) - t * 0.3);
  } else if (w == 6) {
    // Mirrored repeats (a triangle wave, not fract): neighbouring tiles meet without a seam.
    p = (abs(fract(p * (0.6 + amt * 0.8) * 0.25 + 0.25) * 2.0 - 1.0) - 0.5) * 2.4;
  } else if (w == 7) {
    float r = length(p);
    p *= 1.0 + amt * 0.45 * sin(r * 3.0 - t * 2.0);
  }
  return p;
}

// ---- Patterns: each returns (palette coordinate, brightness) -----------------

vec2 plasma(vec2 p, float t, vec4 k) {
  vec2 f = 1.5 + k.xy * 4.0;
  float v = sin(p.x * f.x + t * 1.3) + sin(p.y * f.y - t * 1.7) + sin((p.x + p.y) * (2.0 + k.z * 3.0) + t)
          + sin(length(p * (2.0 + k.w * 4.0) + vec2(sin(t * 0.5), cos(t * 0.3)) * 2.0) - t * 2.0);
  return vec2(v * 0.125 + 0.5, 0.85 + 0.15 * sin(v * 2.0));
}

vec2 domainWarp(vec2 p, float t, vec4 k) {
  p *= 1.2 + k.x * 1.8;
  vec2 q = vec2(fbm(p + t * 0.15), fbm(p + vec2(5.2, 1.3) - t * 0.1));
  vec2 r = vec2(fbm(p + 4.0 * q + vec2(1.7, 9.2) + 0.25 * t), fbm(p + 4.0 * q + vec2(8.3, 2.8) + 0.2 * t));
  float f = fbm(p + (3.0 + k.y * 2.0) * r);
  return vec2(f * 1.2 + length(q) * 0.6 + r.x * 0.3, 0.45 + 1.1 * f * f + 0.25 * length(r));
}

vec2 mandelbrot(vec2 p, float t, vec4 k, vec2 center) {
  float depth = 4.0 + k.x * 4.5;
  float scale = 1.7 * exp(-(0.5 - 0.5 * cos(t * 0.12)) * depth);
  vec2 c = center + p * scale;
  vec2 z = vec2(0);
  float n = 0.0;
  float trap = 1e9;
  const int MAX = 220;
  int limit = 120 + int(k.y * 100.0);
  for (int i = 0; i < MAX; i++) {
    if (i >= limit) break;
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    trap = min(trap, abs(z.x + z.y * (k.z - 0.5)));
    if (dot(z, z) > 256.0) break;
    n += 1.0;
  }
  if (n >= float(limit)) return vec2(log(trap + 1e-4) * 0.08, 0.12 + 0.2 * exp(-trap * 6.0));
  float sn = n - log2(log2(dot(z, z))) + 4.0;
  return vec2(sqrt(sn) * 0.22 + trap * 0.2, 0.55 + 0.6 * exp(-trap * 4.0));
}

vec2 julia(vec2 p, float t, vec4 k, vec2 center) {
  vec2 z = p * (1.2 + k.x * 0.4);
  vec2 c = center + 0.035 * vec2(cos(t * 0.37), sin(t * 0.53));
  float n = 0.0;
  float trap = 1e9;
  for (int i = 0; i < 160; i++) {
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    trap = min(trap, length(z - vec2(k.y - 0.5, k.z - 0.5)));
    if (dot(z, z) > 64.0) break;
    n += 1.0;
  }
  if (n >= 160.0) return vec2(trap * 1.5 + 0.3, 0.35 + 0.6 * exp(-trap * 3.0));
  float sn = n - log2(log2(dot(z, z))) + 4.0;
  return vec2(sn * 0.035, 0.25 + 0.9 * smoothstep(0.0, 25.0, sn));
}

vec2 newton(vec2 p, float t, vec4 k) {
  float degree = k.x < 0.5 ? 3.0 : (k.x < 0.8 ? 4.0 : 5.0);
  vec2 z = rot(t * 0.05) * p * (1.0 + k.y);
  vec2 relax = vec2(1.0 + 0.35 * sin(t * 0.4), 0.25 * sin(t * 0.27));
  float n = 0.0;
  for (int i = 0; i < 40; i++) {
    // z^(d-1) by repeated multiplication; d is a whole number.
    vec2 zp = vec2(1, 0);
    for (int j = 0; j < 4; j++) if (float(j) < degree - 1.0) zp = cmul(zp, z);
    vec2 f = cmul(zp, z) - vec2(1, 0);
    vec2 df = degree * zp;
    vec2 step = cmul(relax, cdiv(f, df));
    z -= step;
    if (dot(step, step) < 1e-6) break;
    n += 1.0;
  }
  float root = floor(mod(atan(z.y, z.x) / TAU * degree + 0.5, degree));
  return vec2(root / degree + n * 0.025, 1.1 - n * 0.022);
}

vec2 kaliset(vec2 p, float t, vec4 k, vec2 center) {
  // Few iterations and smooth orbit traps: more of them turns the filaments into glitter.
  vec2 z = p * (0.45 + k.x * 0.4);
  vec2 c = center + 0.05 * vec2(sin(t * 0.21), cos(t * 0.17));
  float trap = 1e9, ring = 1e9, sum = 0.0;
  for (int i = 0; i < 9; i++) {
    z = abs(z) / dot(z, z) - c;
    trap = min(trap, abs(z.y * (0.5 + k.y)));
    ring = min(ring, abs(length(z) - 0.6));
    sum += exp(-length(z));
  }
  return vec2(sum * 0.12 + ring * 0.5, 0.2 + 0.9 * exp(-trap * 5.0) + 0.5 * exp(-ring * 8.0));
}

vec2 voronoi(vec2 p, float t, vec4 k) {
  p *= 2.5 + k.x * 4.0;
  vec2 cell = floor(p), f = fract(p);
  float f1 = 8.0, f2 = 8.0;
  vec2 id = vec2(0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(x, y);
      vec2 o = 0.5 + 0.4 * sin(t * (0.6 + k.z) + TAU * hash22(cell + g));
      float d = length(g + o - f);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = cell + g;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  float edge = f2 - f1;
  float v = hash12(id) + f1 * 0.35;
  float shade = k.y > 0.5 ? 0.25 + 1.4 * exp(-edge * 18.0) + 0.3 * (1.0 - f1) : smoothstep(0.0, 0.07, edge) * (1.15 - f1 * 0.5);
  return vec2(v, shade);
}

vec2 truchet(vec2 p, float t, vec4 k) {
  p *= 3.0 + k.x * 5.0;
  vec2 id = floor(p), f = fract(p) - 0.5;
  if (hash12(id) > 0.5) f.x = -f.x;
  vec2 a = f - vec2(0.5), b = f + vec2(0.5);
  float da = abs(length(a) - 0.5), db = abs(length(b) - 0.5);
  vec2 q = da < db ? a : b;
  float d = min(da, db);
  float along = atan(q.y, q.x) / (PI * 0.5);
  float w = 0.08 + k.y * 0.14;
  float line = smoothstep(w, w - 0.04, d);
  float flow = 0.5 + 0.5 * sin((along + mod(id.x + id.y, 2.0)) * PI * 2.0 - t * 4.0);
  return vec2(hash12(id) * 0.4 + along * 0.15 + t * 0.05, 0.12 + line * (0.6 + 0.6 * flow) + exp(-d * 30.0) * 0.25);
}

vec2 interference(vec2 p, float t, vec4 k) {
  float v = 0.0;
  float freq = 10.0 + k.x * 20.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    vec2 src = 0.9 * vec2(sin(t * (0.3 + fi * 0.07) + fi * 2.1), cos(t * (0.23 + fi * 0.05) + fi * 1.3));
    v += sin(length(p - src) * freq - t * 4.0);
  }
  v /= 5.0;
  return vec2(v * 0.5 + 0.5 + length(p) * 0.08, 0.55 + 0.6 * abs(v));
}

vec2 spiral(vec2 p, float t, vec4 k) {
  float r = length(p), a = atan(p.y, p.x);
  float arms = floor(2.0 + k.x * 6.0);
  float s = a * arms + log(max(r, 1e-4)) * (3.0 + k.y * 8.0) - t * 3.0;
  return vec2(s / TAU * 0.2 + r * 0.25, (0.55 + 0.45 * sin(s)) * smoothstep(0.0, 0.15, r));
}

vec2 tunnel(vec2 p, float t, vec4 k) {
  float r = length(p), a = atan(p.y, p.x);
  float sides = floor(3.0 + k.x * 6.0);
  float depth = 0.35 / max(r, 1e-3) + t * 1.2;
  float twist = a + depth * (k.y - 0.5) * 0.6;
  float c = sin(depth * TAU * (1.0 + k.z)) * sin(twist * sides);
  return vec2(depth * 0.15 + twist / TAU, (0.35 + 0.75 * smoothstep(-0.2, 0.2, c)) * clamp(r * 2.2, 0.0, 1.0));
}

vec2 metaballs(vec2 p, float t, vec4 k) {
  float sum = 0.0;
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    vec2 b = vec2(sin(t * (0.4 + 0.1 * fi + k.x * 0.2) + fi * 1.7) * 1.2, cos(t * (0.33 + 0.07 * fi) + fi * 2.3) * 0.75);
    sum += (0.05 + 0.04 * k.y) / dot(p - b, p - b);
  }
  float rim = exp(-abs(sum - 1.0) * 6.0);
  return vec2(sum * 0.12, 0.2 + 0.8 * smoothstep(0.85, 1.2, sum) + 0.8 * rim);
}

vec2 gyroid(vec2 p, float t, vec4 k) {
  vec3 q = vec3(p * (3.0 + k.x * 5.0), t * 0.5);
  float g = dot(sin(q), cos(q.yzx));
  vec3 q2 = q * 2.1 + 1.3;
  float g2 = dot(sin(q2), cos(q2.yzx));
  float lines = exp(-abs(g) * (4.0 + k.y * 8.0));
  return vec2(g * 0.2 + g2 * 0.08 + 0.5, 0.3 + lines * 1.0 + 0.2 * g2);
}

vec2 apollonian(vec2 p, float t, vec4 k) {
  vec2 z = p * (0.9 + k.x * 0.5) + 0.12 * vec2(sin(t * 0.2), cos(t * 0.15));
  float scale = 1.0;
  float s = 1.15 + 0.15 * k.y + 0.04 * sin(t * 0.3);
  for (int i = 0; i < 9; i++) {
    z = -1.0 + 2.0 * fract(0.5 * z + 0.5);
    float r2 = max(dot(z, z), 1e-5);
    float f = s / r2;
    z *= f;
    scale *= f;
  }
  float d = 0.25 * abs(z.y) / scale;
  return vec2(log(scale) * 0.12 + t * 0.03, 0.35 + 0.9 * exp(-d * 300.0));
}

vec2 marble(vec2 p, float t, vec4 k) {
  float f = fbm(p * (1.2 + k.x * 1.5) + vec2(t * 0.15, -t * 0.1));
  float g = fbm(p * 2.3 - vec2(t * 0.1, 0.0) + f * 2.0);
  float v = sin((p.x * cos(k.y * 3.0) + p.y * sin(k.y * 3.0)) * 3.0 + f * (6.0 + k.z * 6.0) + t * 0.6);
  return vec2(v * 0.3 + g * 0.6, 0.6 + 0.4 * v * v + 0.3 * g);
}

vec2 moire(vec2 p, float t, vec4 k) {
  float freq = 25.0 + k.x * 35.0;
  vec2 c1 = 0.35 * vec2(sin(t * 0.3), cos(t * 0.23));
  vec2 c2 = -0.35 * vec2(sin(t * 0.27 + 1.0), cos(t * 0.31));
  float a = sin(length(p - c1) * freq);
  float b = sin(length(p - c2) * freq);
  vec2 q = rot(t * 0.05) * p;
  float c = sin(q.x * freq * 0.8);
  float v = a * b * (k.y > 0.5 ? c : 1.0);
  return vec2(length(p) * 0.25 + v * 0.15 + t * 0.02, 0.5 + 0.5 * v);
}

vec2 harmonograph(vec2 p, float t, vec4 k) {
  float a1 = floor(1.0 + k.x * 4.0), a2 = floor(2.0 + k.y * 4.0);
  float drift = t * 0.07;
  vec2 prev = vec2(0);
  float best = 1e9, along = 0.0, glow = 0.0;
  const int N = 150;
  for (int i = 0; i <= N; i++) {
    float s = float(i) / float(N) * TAU;
    vec2 q = vec2(sin(a1 * s + drift) + 0.35 * sin((a2 + 1.0) * s - drift * 1.3),
                  sin(a2 * s) + 0.35 * cos((a1 + 2.0) * s + drift)) * 0.62;
    if (i > 0) {
      vec2 pa = p - prev, ba = q - prev;
      float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
      float d = length(pa - ba * h);
      glow += exp(-d * 90.0);
      if (d < best) {
        best = d;
        along = s;
      }
    }
    prev = q;
  }
  return vec2(along / TAU + t * 0.03, 0.05 + 1.2 * exp(-best * 70.0) + 0.06 * glow);
}

vec2 starburst(vec2 p, float t, vec4 k) {
  float r = length(p), a = atan(p.y, p.x);
  float rays = floor(5.0 + k.x * 20.0);
  // Noise on the circle's direction, not its angle, so nothing jumps where atan wraps.
  float n = noise(vec2(cos(a), sin(a)) * rays * 0.25 + vec2(r * 2.0 - t, 0.0));
  float beams = pow(0.5 + 0.5 * sin(a * rays + t * 0.5 + n * 3.0), 3.0 + k.y * 6.0);
  float core = 0.15 / (r + 0.15);
  return vec2(a / TAU + r * 0.4 - t * 0.05, beams * (0.4 + core) + core * 0.6);
}

vec4 hexCoords(vec2 p) {
  const vec2 s = vec2(1.0, 1.7320508);
  vec4 hc = floor(vec4(p, p - vec2(0.5, 1.0)) / s.xyxy) + 0.5;
  vec4 h = vec4(p - hc.xy * s, p - (hc.zw + 0.5) * s);
  return dot(h.xy, h.xy) < dot(h.zw, h.zw) ? vec4(h.xy, hc.xy) : vec4(h.zw, hc.zw + 0.5);
}

vec2 hexLattice(vec2 p, float t, vec4 k) {
  vec4 h = hexCoords(p * (3.0 + k.x * 5.0));
  vec2 q = abs(h.xy);
  float edge = 0.5 - max(dot(q, vec2(0.5, 0.8660254)), q.x);
  float ring = sin(length(h.zw) * (0.8 + k.y) - t * 3.0);
  float pulse = 0.55 + 0.45 * ring;
  float shade = smoothstep(0.0, 0.05, edge) * pulse * (0.7 + 0.5 * smoothstep(0.35, 0.0, edge)) + exp(-edge * 40.0) * 0.4;
  return vec2(hash12(h.zw) * 0.25 + length(h.zw) * 0.05 - t * 0.04, shade);
}

vec2 aurora(vec2 p, float t, vec4 k) {
  float acc = 0.0, v = 0.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float y = (fbm(vec2(p.x * (0.8 + k.x) + t * 0.15 + fi * 3.1, fi)) - 0.5) * 1.6 + (fi - 2.0) * 0.18;
    float band = exp(-abs(p.y - y) * (6.0 + k.y * 10.0)) * (0.6 + 0.4 * sin(p.x * 30.0 + fi + fbm(p * 4.0 + t) * 4.0));
    acc += band * (1.0 - fi * 0.12);
    v += band * fi * 0.18;
  }
  return vec2(v / max(acc, 1e-3) + p.y * 0.2, 0.08 + acc * 1.5);
}

vec2 pattern(int id, vec2 p, float t, vec4 k, vec2 center) {
  switch (id) {
    case 0: return plasma(p, t, k);
    case 1: return domainWarp(p, t, k);
    case 2: return mandelbrot(p, t, k, center);
    case 3: return julia(p, t, k, center);
    case 4: return newton(p, t, k);
    case 5: return kaliset(p, t, k, center);
    case 6: return voronoi(p, t, k);
    case 7: return truchet(p, t, k);
    case 8: return interference(p, t, k);
    case 9: return spiral(p, t, k);
    case 10: return tunnel(p, t, k);
    case 11: return metaballs(p, t, k);
    case 12: return gyroid(p, t, k);
    case 13: return apollonian(p, t, k);
    case 14: return marble(p, t, k);
    case 15: return moire(p, t, k);
    case 16: return harmonograph(p, t, k);
    case 17: return starburst(p, t, k);
    case 18: return hexLattice(p, t, k);
    default: return aurora(p, t, k);
  }
}

vec3 render(Slot s, vec2 p) {
  p = rot(s.angle) * p;
  p /= s.zoom * (1.0 + 0.05 * uBeat * (1.0 - uCalm));
  p = symmetry(p, s.sym, s.folds);
  p = warp(p, s.warp, s.warpAmt * (0.85 + 0.3 * uEnergy), s.time);
  vec2 vs = pattern(s.pattern, p, s.time, s.knobs, s.center);
  float x = vs.x * s.bands + s.palShift + uChordHue + uNote * 0.04;
  vec3 col = s.pa + s.pb * cos(TAU * (s.pc * x + s.pd));
  col = max(col, 0.0) * vs.y;
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  return max(mix(vec3(l), col, s.sat), 0.0);
}

vec3 hueShift(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 p = (frag - 0.5 * uRes) / uRes.y * 2.0;
  vec2 uv = frag / uRes;

  // How much of the new scene shows at this pixel.
  float m = uMix;
  if (uTransition == 1) {
    float r = length(p) / length(vec2(uRes.x / uRes.y, 1.0));
    float e = uMix * 1.3;
    m = 1.0 - smoothstep(e - 0.12, e + 0.01, r);
  } else if (uTransition == 2) {
    float n = fbm(uv * 5.0 + 3.7);
    float e = uMix * 1.3 - 0.15;
    m = smoothstep(n - 0.06, n + 0.06, e);
  } else if (uTransition == 3) {
    float a = atan(p.y, p.x) / TAU + 0.5;
    float e = uMix * 1.1 - 0.05;
    m = smoothstep(a - 0.05, a + 0.05, e);
  }
  if (uMix <= 0.0) m = 0.0;
  if (uMix >= 1.0) m = 1.0;

  vec3 col;
  if (m <= 0.0) col = render(uA, p);
  else if (m >= 1.0) col = render(uB, p);
  else col = mix(render(uA, p), render(uB, p), m) + 0.35 * m * (1.0 - m) * 4.0 * vec3(1.0, 0.95, 0.9) * (uTransition == 0 ? 0.0 : 1.0);

  // Trails: the last frame, zoomed and turned about the centre, fading in time.
  float frames = uDt * 60.0;
  float aspect = uRes.x / uRes.y;
  vec2 c = uv - 0.5;
  c.x *= aspect;
  c = rot(uFbTurn * frames) * c / pow(uFbZoom + 0.006 * uBeat * (1.0 - uCalm), frames);
  c.x /= aspect;
  vec3 prev = texture(uPrev, c + 0.5).rgb;
  prev = hueShift(prev, 0.01 * frames);
  float keep = pow(uFeedback * (1.0 - 0.35 * uBeat * (1.0 - uCalm)), frames);
  col = mix(col, prev * 0.995, keep);

  outColor = vec4(col, 1.0);
}
