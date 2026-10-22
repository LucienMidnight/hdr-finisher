# HSL / color-range prototype

Steve authorized this isolated prototype on October 22, 2026. The production
frontend and render paths are untouched so Claude can continue app work.

## Try it

From `codebase`, run `node tools/hsl-prototype/launch.cjs`. It opens a separate
Electron window with a temporary profile and a localhost server serving only
the prototype's four frontend files. It never starts the app backend or opens
saved projects. Closing the window stops its server.

Open an ordinary JPEG/PNG/WebP, or use the generated demo. Click/drag on the
photo with Pick, Add or Subtract; the eight color dots also provide shortcuts.
Pick replaces the selection. Add unions separate hue ranges without filling
the gap between them. Subtract excludes hues across all included ranges.
Remove an exclusion to restore a hue. Drag wheel arcs to move their centers;
edit width and softness for the selected range. Each range has a solid core
and a smooth feather on either side. Included arcs are outside the wheel;
excluded arcs are inside. A sampling stroke, wheel drag or slider gesture
forms one undo step. Recipe files persist color settings, not the source photo
or the demonstration local mask.

## Shared engine contract for Claude

- `engine.mjs`: pure selection, picker and CPU color functions; no DOM or app
  globals. `selection(rgb, ranges).weight` is the reusable hue-mask output.
- `gpu.mjs`: WGSL implementation and bounded disposable compute wrapper.
  `process(pixels, recipe, mask)` accepts an optional local mask. The local
  mask multiplies the color selection and Amount. Alpha is preserved.
- Input/output is RGBA Float32 **D65 linear sRGB**, allowing values above 1
  and negative channels. Never pass ACEScg/D60 directly: use the app's approved
  primaries/whitepoint conversion before and after this operation. Do not
  gamma-encode or clamp intermediate working pixels.
- Recipe v1 contains included/excluded hue ranges plus one shared correction:
  Hue in degrees, Saturation in percent (-100 gives zero chroma), Luminance
  in exposure stops, Uniformity from 0 to 100, Amount from 0 to 1. It is an
  isolated recipe, not an extension of the app's saved project schema yet.
- Oklab/OKLCh processing is an experimental choice, **not an implementation of
  DxO's proprietary algorithm**. Saturation changes chroma at fixed Oklab
  lightness. Luminance scales linear RGB exposure through Oklab. Neutral and
  unselected pixels pass through exactly. Soft chroma protection reduces
  unreliable near-gray hue selection; the threshold uses C/abs(L), so simply
  raising exposure does not change selection strength.
- Selection is measured from the input to this operation before corrections.
  Included weights combine by maximum, exclusions by maximum, then multiply
  include * (1-exclude). Overlap never compounds the correction. Uniformity
  pulls toward a circular blend of the active included range centers; this
  prevents an abrupt nearest-center seam where neighboring ranges overlap.
- The picker averages a 5x5 neighborhood in linear light, weighted by alpha.
  A drag collects distinct ranges; samples within 3 degrees of an existing
  same-sign center are deduplicated. The prototype supports up to 32 ranges
  with an explicit message at capacity, never silent truncation.
- GPU compilation/device errors fall back to CPU in the demo. UI renders are
  serialized and reject stale revisions. Its GPU wrapper allocates/readbacks
  per render for inspection; **production must reuse the app device, buffers,
  caches and GPU presentation path**, with its existing device-loss handling.

## Frontend and app handoff

Keep Pick/Add/Subtract, photo sampling, multiple feathered arcs, selection
preview, editable range center/width/softness, removal, reset, one undo per
gesture, save/reopen and keyboard access.

Claude redesigned the front end on October 22, 2026, using DxO PhotoLab's
HSL palette as the reference. A Global / Local grade switch shows the two
proposed layouts. Steve has not yet confirmed this split:

- **Global**: DxO-style channels. All, plus eight bands (red, orange, yellow,
  green, aqua, blue, purple, magenta), each a separate v1 recipe with its own
  range and H/S/L/Uniformity/Amount. Band centres are measured in Oklab hue
  from representative colours; the core width is 35% and the feather 50% of
  the gap to the nearer neighbour. The picker refines the selected band (Pick
  moves it; Add/Subtract add ranges). **Custom channels** (up to 4) hold any
  multi-colour pick. Picking while All is selected creates one.
- **Local grade**: one recipe (Codex's model) applied inside the demo
  ellipse. The eight dots are quick starts. It samples and selects from its
  own stage input, which is the global HSL output.
- **Wheel**: outer ring = source hues, dimmed outside the current channel's
  selection; inner ring = what each hue becomes after the whole module. Bars
  drag one range edge (the opposite edge stays put, the centre follows);
  outer dots drag the softness (symmetric); the centre dot or the arc moves
  the range; the inner dot is the Hue shift target. Handles are focusable
  sliders (arrows; Shift = 5°). Double-click a slider to reset it.

**Channel composition (prototype only):** every channel with an effect is
measured from the same input, and the effects add: `out = in + Σ(channel_k(in)
− in)`. The UI runs one `gpu.process` per active channel. Production should
evaluate all channels in one shader pass from the same input. Whether
overlapping hue shifts should add, or blend by weight, needs Steve's visual
check. The All channel is a 180° range, so the near-grey chroma protection
still applies to it.

Saved recipe files are now `{version: 2, kind: 'hsl-prototype', global:
[channels], local: recipe}`. Loading a plain v1 recipe puts it into the
current channel. `window.hslPrototype.recipe` is the current channel's
recipe; `.state` holds both modules.

Expose this same operation globally and in each local grade with independent
HDR/SDR parameters. Reuse hue selection as a mask leaf in combined masks,
evaluated from the app's fixed mask source; that differs intentionally from
HSL selecting colors at its own stage input. The existing shared-mask policy
must not acquire different shapes between HDR and SDR. Specify exact global
and local stage placement in the Grade PRD before integration.

Open: app GPU shader integration, CPU fallback in Python, project/history
schema, independent channel edits, native hue-mask leaf, HDR/SDR controls,
scopes, Library, Proof/export and final frontend. Production integration must
retain the final HDR highlight ceiling and use the existing delivery checks.
No export or production preview behavior is changed by this prototype.

## Limits and validation

The UI browser-decodes ordinary photos into an sRGB preview and scales to
1000 pixels on the long edge. Display is SDR with output-only gamut clipping;
RAW/HDR file loading, HDR display, gamut compression and photographic HDR
quality are not qualified. The local ellipse is only a demonstration mask.
Luminance is not DxO's luminance algorithm, and HDR appearance needs Steve's
review on skies, foliage, skin, saturated highlights and dark colors.

Before measurement, prototype GPU/CPU agreement is set to mean normalized
Oklab distance below .002 and 99th percentile below .01, giving room below
the approximate .02 SDR just-noticeable scale. Normalize each pair by their
shared max(1, RGB peak) for this engineering comparison. This is **not** the
app's agreed finished-HDR perceptual tolerance or proof of HDR fidelity.
Zero masks and neutral operations must preserve floats exactly, and HDR
processing must retain values above 1. Behavior tests cover separated ranges,
exclusions, red wrap, feathering, exposure-independent selection, gray
rejection, sampling, uniformity, masks and recipe validation.

Run `node --test tests/hsl-prototype.test.js` and, serially with other GPU
drivers, `node tests/run-native-electron.js tests/hsl-prototype-gpu.js` with
`HDR_FINISHER_ELECTRON_WINDOW_SIZE=2560x1440`. The GPU driver requires a real
WebGPU adapter, exercises actual UI controls and saves a screenshot under
`output/hsl-prototype/`. Follow AGENTS.md for the required fast suites.

October 22 validation: all 571 fast Node tests passed; Python reported 2397
passed and 3 skipped. The focused native Electron GPU/interaction driver
passed, including photo sampling, Pick/Add/Subtract, recipe loading, undo/redo,
slider entry and GPU/CPU switching. The interface screenshot was inspected.
HDR photographic acceptance and production integration remain open.

## Sources

The Oklab matrices adapt Björn Ottosson's public-domain conversion at
https://bottosson.github.io/posts/oklab/ (2021-01-25 matrix revision; accessed
October 22, 2026). The source explicitly offers this code in the public domain
or under MIT. Original selection/composition and UI code are authored here.
WGSL built-ins and buffer behavior follow https://www.w3.org/TR/WGSL/.
