# Color Music

Endless generative colour and music in **one HTML file**. Open `color-music.html`, press Start,
and it plays: a new song when one ends, a new picture for every part of the song, the colours
moving in time with the beat. Nothing is downloaded and nothing is sampled; every note and every
pixel is computed in the page as it plays.

- **Pictures**: 20 patterns drawn by one WebGL2 shader — Mandelbrot and Julia zooms, Newton and
  Apollonian fractals, the Kaliset, domain-warped noise, plasma, Voronoi cells, Truchet tiles,
  interference, log spirals, a tunnel, metaballs, gyroid slices, marble, moiré, harmonograph
  curves, starbursts, a hex lattice, aurora curtains. Each scene folds space (mirror,
  kaleidoscope, rotation), bends it (swirl, noise, ripple, inversion, polar, tiles, bulge),
  colours it with a cosine palette from ten families, and leaves trails through feedback.
- **Music**: ten styles — ambient, dream pop, synthwave, lo-fi, house, techno, chiptune,
  downtempo, cinematic, liquid — in nine modes on any key. Chord progressions with smooth voice
  leading, a melodic motif per part that follows the chords, bass, arpeggios and drum patterns
  with fills, crashes and risers; synthesised instruments (detuned pads, FM electric piano and
  bells, plucks, acid bass, chip pulses, flute), reverb, ping-pong delay and sidechain pumping.
- **In time**: the audio engine schedules every note on the audio clock and sends the same
  times to the picture. Kicks punch the zoom and the glow, snares fringe the colours, crashes
  flash, chords shift the palette around the circle of fifths, quiet parts move slower than
  loud ones, and a new part of the song brings a new scene with a fade, an iris, a dissolve or
  a sweep.

## Run it

Open `build/color-music.html` in a browser — from disk is fine — and press **Start** (browsers
let a page make sound only after a click). It needs WebGL2 for the picture: Chrome, Edge,
Firefox and Safari 15+ all have it. Without it the page shows a plain gradient and the music
still plays.

Three ways to have it, all the same page:

- **The file**: `color-music-<version>.html` from a
  [release](https://github.com/MarketKernel/html-color-music/releases), with `SHA256SUMS.txt`
  beside it. It stays the version it is.
- **Online**: <https://marketkernel.github.io/html-color-music/>, built from `main`.
- **Installed**: the online page installs as an app (Chrome and Edge: the install button in the
  address bar; Safari on iPhone and iPad: Share → Add to Home Screen). It plays offline once it
  has been opened and updates when you say so — see [GitHub Pages](#github-pages).

### Controls

| | |
| --- | --- |
| <kbd>Space</kbd> | play / pause |
| <kbd>N</kbd> or <kbd>→</kbd> | next song |
| <kbd>V</kbd> | new picture |
| <kbd>M</kbd> | mute |
| <kbd>F</kbd> | full screen |
| <kbd>I</kbd> | details and options |
| <kbd>H</kbd> | hide the controls |

The controls fade while the music plays; moving the pointer or touching the screen brings them
back. Media keys and the system's now-playing panel work too, and the screen stays on while it
plays.

**Details and options** (the ⓘ button) shows the song, style, key, tempo, the chord now
playing, the part of the song and the scene. There you can also:

- **Seed**: every song comes from a short seed, shown here. Type one and press Play to hear
  that song again — the same seed always makes the same song.
- **Music**: keep to one style.
- **Pictures**: keep to one pattern.
- **Change picture**: every part of the song, every four bars, or once a song.
- **Calm motion**: slower movement and no flashes. It starts on when the system asks for
  reduced motion.

These choices, the volume and mute are remembered in the browser (`localStorage`).

### On a phone

Tap Start; tap the picture to bring the controls back. The details open as a sheet above the
player bar.

## Privacy

The page reaches nothing outside itself: its Content-Security-Policy is
`default-src 'none'; connect-src 'none'`, and the build fails on any external `src` or `href`.
There are no fonts, images or scripts from elsewhere, no analytics, no requests at all. The
installed app's copy lets in only its own manifest, icons and service worker, from its own
address; `connect-src` stays `'none'`.

## Build

```sh
./build.sh            # npm ci on the first run, then node build.mjs
npm run build         # → build/color-music.html (about 90 KB) and build/pages/ (the PWA)
npm run watch         # rebuild on every change
npm run check         # typecheck, unit tests, build, browser tests — "done" means this is green
npm run shots         # screenshots of every screen and pattern into shots/
npm run icons         # redraw assets/pwa/*.png from assets/icon.svg (needs Chrome)
```

Node 22 or later. The dependencies are esbuild and TypeScript, both only for the build.

The browser tests need a local Chrome (`CHROME=/path/to/chrome` to pick one; without one they
are skipped). WebGL runs on SwiftShader, Chrome's software GPU, so they need no graphics card:

- `tests/app.mjs` drives the built page: Start, the audio clock advancing bars and chords, a
  typed seed replaying the song the composer makes for it, next song, new picture, pause, mute,
  every one of the 20 patterns drawing something neither black nor flat, the options
  remembered, a phone's screen; then `build/pages/`: the service worker in control, the
  manifest installable, the page playing with the server gone, and a new deploy that waits
  for Update.
- `tests/sound.mjs` renders the chorus of songs of every style through the real engine into an
  `OfflineAudioContext` and measures the mix: no clipping, headroom, a sensible loudness, every
  style within a few decibels of the others.

## Versions and releases

The version is written in one place, `package.json`. The build puts it into the page (the
bottom of the details panel) and into the PWA's cache name. A build of the commit tagged
`v<version>` shows it as it is; any other adds its commit, `0.1.0+1a2b3c4`, so a page from
`main` on GitHub Pages is not taken for the release.

```sh
npm version minor           # 0.1.0 -> 0.2.0: package.json, package-lock.json, a commit and the tag v0.2.0
git push --follow-tags      # the tag starts .github/workflows/release.yml
```

The release workflow stops if the tag and `package.json` disagree, runs the checks, then
attaches `color-music-<tag>.html` and `SHA256SUMS.txt` to the GitHub release.
`.github/workflows/test.yml` runs the same checks on every push and pull request.

## GitHub Pages

`.github/workflows/pages.yml` builds and tests every push to `main` and deploys
`build/pages/` to GitHub Pages (Settings → Pages → Source: GitHub Actions): the page, a
manifest, icons and a service worker. Every path is relative, so it works under
`/html-color-music/`. The settings and the volume belong to that address, apart from those of a
copy opened from disk.

Each deploy changes the cache name in `sw.js`, so the browser picks up the new worker by
itself — on a launch with a connection, every few hours while the app stays open, or when
"Check for updates" at the bottom of the details panel asks. The new worker downloads its
version into a cache of its own and waits; the running one keeps serving the old page, offline
too, and the song playing is not cut off. The details panel, with a dot on its button, and the
start screen then say "Version … is ready. Update": Update lets the new worker in and reloads
the page, which says once that it has been updated. Without the button the new version starts
once every window of the app has been closed.

That is also the trade-off: an installed PWA runs whatever the last deploy put there, while a
downloaded file stays the version it is.

## Layout

```text
build.mjs              esbuild bundles src/app/main.ts; styles, shaders and icon are inlined into one HTML file;
                       build/pages/ adds the manifest, icons and service worker
.github/workflows/     test.yml (every push), pages.yml (main → GitHub Pages), release.yml (tag v* → release)
assets/                icon.svg; pwa/ — its PNGs for the installed app (npm run icons)
src/core/              no DOM; runs in Node under the unit tests
  rng.ts               seeded randomness (sfc32): one seed → the whole song and its scenes
  music.ts             the composer: styles, modes, chords, voice leading, motifs, bars of notes
  palette.ts           cosine palettes in ten families
  scene.ts             scenes: pattern, fold, warp, palette, speed, trails, transition
  settings.ts          what is remembered, checked on the way in
src/app/               the page
  template.html        markup and the Content-Security-Policy
  styles.css           dark glass over the picture; --accent follows the palette
  main.ts              wiring, the frame loop, cues → pulses, controls
  renderer.ts          WebGL2: scene pass with feedback (ping-pong), present pass, adaptive resolution
  scene.glsl           the 20 patterns, folds, warps, palettes, transitions, trails
  present.glsl         auto exposure, glow from mipmaps, colour fringes, vignette, film curve
  quad.vert.glsl       a full-screen triangle
  audio.ts             the engine: look-ahead scheduler on the audio clock, mix bus, reverb, delay, cues
  instruments.ts       synthesised pads, keys, plucks, leads, basses and drums
  update.ts            the installed app's updates: finds a waiting worker, Update lets it in
src/pwa/sw.js          the PWA's service worker: offline from its own cache, waits to take over
tests/                 unit tests (rng, music, palette, scene, settings) and the two browser tests
tools/                 load.mjs (src/ for Node), chrome.mjs (DevTools protocol), shots.mjs, icons.mjs
```

## Limitations

- Fractal zooms stop at about 10⁻⁴: the shader works in 32-bit floats.
- The render is smaller than the screen when the GPU cannot keep up (the share is shown at the
  bottom of the details panel); fine fractal detail is softer then.
- Timers in a background tab fire once a second; the engine schedules further ahead there, so
  the music keeps going, but the picture pauses until the tab is visible.
- Songs are generated, not recorded: there is nothing to download or export yet.

## License

MIT — see [LICENSE](LICENSE).
