#version 300 es
// The rendered picture onto the screen, scaled up to the canvas: exposure set
// from the frame's average (its 1×1 mipmap), a glow taken from the blurrier
// levels, colour fringes on the snare, a vignette, a film tone curve and a
// touch of noise so slow gradients do not band.
precision highp float;

uniform sampler2D uImage;
uniform vec2 uOut;
uniform float uGlow;
uniform float uBeat;
uniform float uSnare;
uniform float uFlash;
uniform float uCalm;
uniform float uClock;
uniform float uTopLevel;

out vec4 outColor;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uOut;
  vec2 dir = uv - 0.5;
  float lively = 1.0 - uCalm;
  float fringe = 0.0015 + 0.006 * uSnare * lively;
  vec3 col;
  col.r = texture(uImage, uv + dir * fringe).r;
  col.g = texture(uImage, uv).g;
  col.b = texture(uImage, uv - dir * fringe).b;

  vec3 glow = textureLod(uImage, uv, 3.0).rgb * 0.45 + textureLod(uImage, uv, 5.0).rgb * 0.55;
  col += glow * glow * uGlow * (1.0 + 0.8 * uBeat * lively);

  // Auto exposure, partway: a dark scene is lifted, a blinding one brought down, each keeps its mood.
  float average = dot(textureLod(uImage, vec2(0.5), uTopLevel).rgb, vec3(0.299, 0.587, 0.114));
  col *= clamp(pow(0.3 / max(average, 0.01), 0.7), 0.7, 2.6);
  col += vec3(0.9, 0.95, 1.0) * uFlash * 0.12 * lively;

  // The ACES film curve: lifts the darks, rolls bright parts off instead of clipping them flat.
  col *= 1.0 - 0.5 * dot(dir, dir);
  col = clamp(col * (2.51 * col + 0.03) / (col * (2.43 * col + 0.59) + 0.14), 0.0, 1.0);
  col += (hash12(gl_FragCoord.xy + fract(uClock) * 100.0) - 0.5) / 255.0;
  outColor = vec4(col, 1.0);
}
