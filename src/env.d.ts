/** package.json's version, as build.mjs puts it in: 0.1.0, or 0.1.0+1a2b3c4 off a release. */
declare const __APP_VERSION__: string;

/** Shaders are plain GLSL files; esbuild hands them over as text. */
declare module '*.glsl' {
  const source: string;
  export default source;
}
