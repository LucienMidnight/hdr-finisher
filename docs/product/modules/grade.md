# Module PRD: Grade

## October 26: GPU Denoise preparation

Noise measurement now runs on the renderer's graphics card for Grade, Library,
GPU export and Proof. The CPU remains the fallback for an unavailable, failed
or insufficient-memory GPU. Export no longer performs CPU noise measurement
before entering the GPU queue. Bounded source windows retain actual pixels:
at most 1 MP, without resizing; the host fits only compact GPU statistics.
Reconstruction and Highlight compression arithmetic are unchanged.

Measurements are kept as versioned JSON in the managed Library preview cache.
They survive visits and restarts while that cache is retained. Identity includes
source pixels, size and resampling geometry, excluding finishing controls and
HDR/SDR names. Full-size Grade/export/Proof share the native source measurement;
reduced pictures measure their own pixels. Authored SDR bases stay separate.
Clearing/evicting preview data or changing source interpretation requires a new
measurement. GPU allocation respects the existing memory budget and Library
admission; repeated requests within a page share work. Proof inherits its source
owner's identity, with a distinct identity for a reduced source.

Proposed before implementation: finished SDR mean Delta E 2000 <1 and p99 <3;
finished HDR mean Delta E ITP <1 and p99 <3 against the current CPU measurement.
Steve allows approximate measurement and CPU/GPU differences; preview and export
must agree perceptually. No per-pixel colour maximum; Highlight compression is
an exact ceiling allowing only encoder rounding. All 13 existing Denoise corpus
cases passed at two strengths in both renditions: worst HDR mean 0.152/p99 2.350,
SDR mean 0.012/p99 0.124. Existing GPU reconstruction parity and Full-tier Denoise
checks passed. Real 42 MP RAW preparation: CPU 809–969 ms, GPU 169–176 ms (about 93 ms
compute), two matched runs excluding RAW development. Fallback delivery also
keeps/reuses the native measurement; no usable GPU is required to retain it.
Final fast-suite results and focused reruns are recorded in the
[Library status block](photo-library.md#start-here-library-responsiveness-status-october-26-2026).

**Photo framing (October 24, 2026).** Background retains the viewer-surround
preference. Frame authors the saved two-layer photo frame with grouped undo/redo;
Fit includes it and 100% retains photo-pixel mapping. Requirements and validation
belong to [Export and Proof](export-and-proof.md#8-photo-framing--requirements-recorded-october-24-2026).

**Toggle knob (October 24, 2026).** Shared on/off switches use Steve’s darker v002 transparent Blender knob render over the existing recessed track, chosen to make its shading easier to see on Steve’s HDR screen. The track remains 46 by 20 px; the 24 px knob extends slightly above and below its rails. Checked state, focus and keyboard behaviour remain unchanged; knob motion respects reduced-motion preferences.

**Panel alignment (October 24, 2026).** Left and right rails remain adjustable on Grade, Proof and Export. The logo, File menu and left-panel content share a consistent leading edge. The Control Panel title occupies the shared preview-header height with a divider immediately beneath it; Global / Local / Retouch remain full-width tabs.

- **Owner:** Steve
- **Master PRD:** [PRD](../PRD.md)
- **Last status check:** October 23, 2026, HSL integration against the code.
- **Code:** backend `adjustments.py`, `detail.py`, `finishing.py`,
  `local_adjustments.py`, `mask_softness.py`, `mask_work.py`,
  `denoise_adaptive.py`, `sdr_match*.py`, `sessions.py`, `projects.py`,
  `models.py`; frontend panel files (see the
  [code map](../../technical/code-map.md)), `group-presets.js`,
  `grade-saving.js`, `sdr-match-ui.js`.

**Control Panel presentation (October 23, 2026).** Global / Local / Retouch
are full-width tabs. Module titles use the neutral uppercase RAW Development
title token; one changed-state dot sits to the right of the title. Object key
order and numeric roundoff below 1e-12 are not edits (UI comparison only). HDR/SDR switching avoids redundant control moves to
preserve scrolling. Local tools sit below the adjustment list, followed by
visible mask actions, then Brush settings and Mask settings; there is no More
menu for these actions. Retouch has an explicit Inpaint Brush and Stop painting
control, and its preview overlay accepts painting in Retouch mode. Shared
HDR/SDR metadata captions above these controls are removed. The panel title is centered in the shared preview-header height; the scrollbar track stays visible at a fixed width
with or without overflow in all three modes.

**Wheel presentation (October 23, 2026).** HSL and Color Wheels share primary
colour directions (red upper left, yellow top, blue lower right), with more
saturated hue bands. Grading wheels have eight radial sections. HSL channel
buttons remain round. Pick / Add / Subtract are persistent modes; Show selection
is a separate pressed-state button that displays the mask overlay. Wheel
numeric fields use the existing recessed instrument surfaces.

## 1. Purpose

Grade one photo into two excellent renditions, HDR and SDR, while seeing
true HDR. The controls should be photographic, predictable and quick, and
every edit must be undoable.

## 2. Scope

- The HDR and SDR lanes and their panels: Tone, Highlight Compression,
  Exposure Bands (tone equalizer), Color, Lift/Gamma/Gain, Base Rendition
  (SDR), HSL, Curves, Color Grading, Detail, Black & White, Vignette, Denoise.
- Crop, rotate, straighten, perspective, lens corrections.
- Local adjustments and masks (brush, gradients, luminance, colour,
  combined masks). V1 must add a healing brush in the local adjustment
  module (one Retouch brush with Inpaint, Heal and Clone modes) and hue
  selection as a local-adjustment mask; neither is built.
- Match entire HDR grade (SDR Match).
- Group presets, history and undo, saving (autosave and explicit save),
  projects.

Film Look has its own module ([film-look](film-look.md)). The renderer
that draws the preview belongs to [preview-and-gpu](preview-and-gpu.md).

## 3. Decisions

| Decision | Date |
| --- | --- |
| HDR and SDR are independent branches after source interpretation. An HDR control never changes the SDR side, and the reverse. | 2026-08 |
| HDR controls stay continuous at neutral, keep luminance order and add no hidden ceiling. Values above the curve range pass through. | 2026-08 |
| Detail (Texture, Clarity, Sharpen) is corrective and separate from Film Look's fixed-scale character. Global Detail runs after the colour grade and before local adjustments; local Detail runs inside each local grade. | 2026-09 |
| Match entire HDR grade captures the whole HDR recipe (global, locals, Detail, Film Look, vignette, grain) and builds an SDR base from it. SDR controls stay as trims. Rematch and Revert are single history steps. | 2026-09 |
| HDR Lift/Gamma/Gain is deprecated now that Exposure Bands exists. Remove it after real-photo checks, unless a workflow needs it. The SDR trims stay. | 2026-08, pending |
| A healing brush in the local adjustment module and hue selection as a local-adjustment mask are required for v1. Both are unbuilt; detailed interaction and rendering design remain to be specified. | Steve, 2026-10-21 |
| Retouch starts on the CPU, preserving a fallback for later GPU work. Inpaint is the default, targeting PatchMatch with Krita as the main reference; Heal follows darktable/GIMP and Clone shares the brush infrastructure. See the [development plan](../../technical/local-adjustments.md#retouch-brush-development-plan-october-21-2026). Quality/performance are not yet validated. | Steve, 2026-10-21 |
| Retouch repairs are shared by HDR/SDR and run before crop/rotation and denoise. Content-dependent selections see the repaired source. After repair changes, show Rematch required and retain existing SDR Match controls until an explicit Rematch. The current Match materializes editable controls, not a separate baked photo; imported authored SDR remains independent until explicitly replaced through Match. | Steve, 2026-10-22 |
| The inspected v3 PatchMatch examples are accepted for proceeding with implementation. Skip further natural-dust study work; Steve will test natural dust manually when the tool and settings exist. This is not general photographic validation. | Steve, 2026-10-22 |
| Smoother sun and bright-sky gradients: prototype an AgX-style **Attenuate** Highlight Color mode beside the existing modes so Steve can switch between them, with an Attenuation control; the existing modes stay. Judged by eye on HDR crops (sunset IMG_3129), not by hue metrics. | Steve, 2026-10-22 |
| Luma follows Gradient: default settings remain unused until a range edit or photo sample (Gradient until placement). Unused rows convert on another tool and disappear when left, without history. | Steve, 2026-10-23 |
| Control Panel uses Global / Local / Retouch modes, a shared HDR grade / SDR grade folder choice and separate Match action. Section numbers are removed; disclosures use triangles. Local tools create adjustments directly and Erase moves into Brush settings. Retouch gets its own panel. | Steve, 2026-10-23 |
| Slider drags make one undo step per gesture. | 2026-08 |
| Only the current project schema is accepted; older projects are rejected with a message. No migration before 1.0. | 2026-10 |

## 4. Current state (October 18, 2026)

**Built:** all panels listed above, local adjustments and masks, geometry
and lens corrections, Denoise, Black & White, SDR Match, group presets
(save, apply, delete), autosave, history, projects.

**Not built or open**

- **V1 Retouch brush (healing requirement):** Inpaint, Heal and Clone in
  the local adjustment module. CPU first; later GPU work is separate.
  Not built. Follow the [development plan](../../technical/local-adjustments.md#retouch-brush-development-plan-october-21-2026);
  shared source placement and explicit SDR Rematch behavior are decided above;
  complete feature remains unbuilt until release validation is finished; Heal/Clone
  prototypes were added October 23 (see the later note).
  **Prototype implemented October 21:** isolated bounded CPU PatchMatch engine,
  background jobs/cancellation/revision guard, completed-patch cache and a
  synthetic comparison viewer. Float HDR/negative preservation and donor
  exclusion are tested. **Quality update October 22:** clean-context tone
  continuation substantially reduces the curved-highlight depression and
  restores smooth gradients. The viewer adds four real-photo backgrounds
  with injected dust. **Texture follow-up after Steve's review:** v3 restores
  lost detail using one coherent, boundary-matched donor for affected small
  spots. Stochastic texture, photo sky, sand and foliage retain fine detail;
  the other eight study results are unchanged from v2. Foliage shapes can
  still change, and larger/source-starved repairs can still smooth detail.
  Steve accepted these examples and approved interactive integration on October
  22. Natural-dust testing is deferred to his manual use of the tool/settings;
  no natural-dust validation is claimed.
  **Integration groundwork October 22:** a serializable source-space stroke
  recipe, bounded native-window preparation and completed-patch composition
  are implemented separately from the app. JSON replay through the worker/cache
  and exact agreement across read-window boundaries are tested.
  **Interactive Inpaint prototype October 22:** Local Adjustments now offers
  source-space click/stroke input, native size/hardness, bounded search, patch
  radius, iterations, explicit seed, Retry, selection, enable/remove and Cancel.
  Each completed gesture is a revisioned history edit; ordered recipes save in
  projects and replay before all preview levels, masks, Match, Proof, export and
  Library source reduction. Repairs share interpreted native source before crop,
  rotation and lane Denoise; GPU finishing remains in use. Completed patches
  are cached independently of grades; the October 23 follow-up below fixes
  the original changing current/future donor exclusions.
  Cancellation and newer edits retain the last valid document/picture. Proof's
  cache includes the source epoch. See the technical plan for checks and use.
  Publication currently needs one additional full native image owner, admitted
  against the existing host memory reserve; solves remain bounded. Large or
  source-starved strokes can fail explicitly. Heal, Clone, source picking,
  broader performance work and Steve's manual natural-dust testing remain open.
  **Responsiveness follow-up October 22:** brush redraws reuse the overlay canvas
  and coalesce to animation frames; painted coverage and live Search-limit
  feedback are visible. Actual dragged-stroke repair/rejection is tested.
  Untransformed native GPU sources refresh bounded solved pixels while derived
  caches still reset; transformed/reduced sources use the existing reload path.
  Three paired 24 MP warm-view measurements reached 0.67–0.82 seconds versus
  1.03–1.33 seconds with full reload (about 37% median improvement), with the
  same default algorithm/settings. This meets the initial one-second target in
  that focused case. Cold source/Denoise preparation, transformed views and
  Steve's assessment of brush responsiveness remain open. No broad speed or
  natural-dust acceptance is claimed; the complete three-mode tool is unbuilt.
  **Size-entry fix October 22:** Steve's running brush had Size 100, beyond the
  prototype's 1–64 native-pixel range, so strokes were rejected. Manual Size
  entries now return to the supported range on commit and before processing;
  blank entries restore 12. The range is printed beside Size. A corrected 100→64
  entry is covered by an actual click, saved radius and repaired preview pixels.
  The processing bounds are unchanged; larger dust spots remain outside this milestone.
  **Larger automatic Inpaint October 23:** brush diameter reaches 1,024 native
  pixels. Search bounds follow stroke size; patch radius, iterations and seed
  are internal, with Retry choosing another seed. Size and Hardness remain
  visible. Large strokes use conservative donor exclusion and a bounded working
  scale before native feathering; the existing small-spot solver budgets stay
  unchanged. Large repairs can soften fine texture and still need Steve's
  assessment. Very long or source-starved strokes can fail with an explanation.
  Pointer sampling follows brush size and painting no longer rebuilds the recipe
  on every pointer move. Warm small-spot performance keeps the existing
  one-second target (focused follow-up: 0.70–1.04 seconds while the Python
  suite was running); no general latency guarantee is claimed.
  **Stable corrections and brush follow-up October 23:** hardness defaults to
  10%; changing Size redraws the brush cursor without pointer movement. Each
  repair uses the immutable original and prior-defect footprints frozen in its
  recipe. Adding/removing unrelated repairs cannot change its donor selection;
  Retry explicitly changes the seed. Publication rebuilds only changed painted
  footprints and their overlapping repairs; GPU refresh uploads only changed
  regions. Exact stability and full project replay pass, including a disabled
  repair cache. Old repair projects may replay differently under this corrected
  donor policy. The acceptance target is Steve's maximum one second through the
  presented frame: the focused warm 24 MP check with twelve spots (new spots
  100 native pixels) measured 0.34–0.68 seconds for native-view deletion and
  0.80–0.94 seconds at fit. Startup, active Denoise preparation, transformed
  views and very large overlapping strokes are not a general latency guarantee.
  `tools/retouch_detail_study.py` reproduces a labeled synthetic comparison and
  standalone viewer in `output/retouch-detail-study/`. Stronger interiors with
  outer feathering remove broad defects better than the 10% soft brush, but
  soften texture. A two-band original-detail prototype retains grain/pattern
  alignment on luminance blotches, but also retains opaque-object outlines.
  A clean-strip donor-detail prototype replaces grain without recovering its
  original pixel alignment and can mismatch structured patterns. Descriptive
  tone error, texture correlation and strength are reported against known
  clean references; they do not establish natural-photo quality acceptance.
  Basis: [darktable frequency separation](https://docs.darktable.org/usermanual/development/en/darkroom/processing-modules/wavelets/).
  Steve subsequently requested selectable in-app prototypes for real-photo
  testing; see the October 23 prototype controls note below. Validation: focused
  recipe/integration checks and both Retouch Electron drivers passed; required
  fast suites: 585 JavaScript checks and 2,424 Python checks passed (3 Python
  skips); their existing unrelated failures remain (3 edit-sync helper failures
  and 6 frontend wording contracts).
- **V1 hue-selection mask:** add hue selection as a local-adjustment mask,
  compatible with the existing combined-mask workflow. Not built; selection
  controls and hue evaluation remain to be specified.

- **Highlight and Shadow Desaturation** as general Color controls
  (COLOR-DESAT-01). They were removed from Film Look in the rebuild and
  are meant to return here. The film-look plan counts on them.
- **Presets window management** (PRESETS-01), built October 27 (see section 5): rename, confirmed Update, import and
  selected export are built; Steve’s app check is pending.
- **Match entire HDR grade fault** reported October 11: a match reported
  success with wrong colours, and later the automatic match failed. Not
  investigated; Steve's photos and message are not recorded yet.
- **Local Clarity** (brush or mask) still adds a per-tile reach and costs
  more GPU work than global Clarity (CLARITY-01).
- **HDR Lift/Gamma/Gain** is still shown (deprecation pending).
- **Local-grade transfer between lanes** (copy a local grade or mask from
  HDR to SDR). Not started.
- **Black & White** is built; slider strength, fade points and preset
  values wait on Steve's testing (BW-01).
- Legacy shader inputs 156 (`FILM_LOOK_ENABLED`) and 157
  (`FILM_FINISH_STRENGTH`) are still in the parameter layout; whether they
  are still read is unconfirmed.
- Save state shows beside the photo name. The dot on the Grade tab when
  seen from the Library is missing.
- **Attenuate (AgX-style) Highlight Color, prototype (October 22):** built
  for HDR and SDR on CPU and WebGPU, with Attenuation 0–90% (default 20%;
  0% equals per-channel rolloff). Its shoulder stays concave so Highlight
  Detail can no longer make orange–magenta bands (fixed October 22).
  Smooth color rolloff got the same protection for hue (Steve approved,
  October 22) while its brightness and greys stay as before, so existing
  grades change only where colours used to band. GPU matches the CPU within the existing
  parity tolerance (`tests/highlight-attenuate-parity.js`). Open: Steve's
  judgement on real photos, whether it becomes the default, and the SDR look
  (not reviewed). See the
  [technical reference](../../technical/highlight-compression.md#attenuate-agx-style-prototype).

### Control Panel modes — first implementation (October 23, 2026)

HSL was fast-forwarded into local main at af4403f on Steve's instruction.
The Control Panel now has Global, Local and Retouch modes, shared folder tabs
and Match action, unnumbered triangle disclosures, and Color sliders / Color
wheels display names. Viewer tools end on mode changes. Local settings have
fold-outs, a four-tool strip and More menu. Retouch uses instrument sliders,
folded Advanced settings, newest-first repairs and selected-row Retry/Remove.
Existing processing, saved fields, bounds and Match actions are retained.

The unused-adjustment lifecycle is now implemented as a session-only draft,
excluded from processing and saved documents. Brush becomes used on its first
stroke, Gradient on placement, Path on completion, and Luma on a range edit or
photo sample (Steve approved the Luma rule October 23). Another tool converts
an unused draft; another row, mode or photo discards it without a history edit.
Creation and first content use one create command. New behavior checks cover
drafts, conversion, repeated tool clicks, row selection and first-content edits;
they have not been run. Interaction-driver migration and real-app screenshots
remain pending, so keep the brief open. Tests are deferred until after Steve tunes HSL, explicitly
requested October 23; only JavaScript syntax and diff whitespace were checked.
All eight reference PNGs were reviewed. The reference server responds on
127.0.0.1:8139; Codex queued its browser tab, but this chat has no controllable
browser surface for rendered inspection or app screenshots. HSL design and
real-photo review remain after the control-panel work. Heal/Clone prototypes
are now available; their quality review remains open (October 23 note below).

## 5. Open work, in order

**V1 scope (Steve, October 26, 2026):** items 1, 3, 8 and 9 and the new
Sharpen review below are v1. Item 2 waits on Steve's recorded photo. Items 4
and 5 (removing HDR Lift/Gamma/Gain; the PIPE-01, DETAIL-01 and CLARITY-01
reviews) are after v1. Items 6 and 7 are unchanged and not v1 requirements.

- **Sharpen v1 accepted by Steve, October 27, 2026.** Keep the method.
  The earlier impression came from judging zoomed out; sharpening works at
  100%. Global and local Detail use the existing tooltip style to remind:
  “Judge sharpening at 100% zoom.” No rendered pixels changed.
- **V2 sharpening exploration:** use the October 27 comparison below as the
  starting point for methods that amplify noise less: deconvolution/capture
  sharpening, edge or noise masking, and darktable’s diffuse-or-sharpen
  approach. Compare quality and processing cost before choosing.

1. Highlight and Shadow Desaturation in Color (COLOR-DESAT-01).
2. Investigate the Match fault once Steve has recorded a photo and message.
3. **PRESETS-01 finishing touches, October 27.** Search opens focused, filters
   built-in and saved names without case sensitivity, and shows a plain empty
   result. Arrows and Enter apply filtered choices; Escape clears then closes.
   Single exports suggest `<name>-preset.json`, preserving case, replacing
   spaces with hyphens and removing illegal filename characters; multiple
   exports use the section plus `-presets.json`. The save name remains editable.
   Focused filename/filter checks: passed; fast suites deferred to batch end.
   Steve should try search, arrows/Enter, two Escapes and single/multiple export.
   Saved
   presets support Rename, confirmed Update from current settings, selected
   export to JSON and import through the existing preset storage. Name clashes
   keep both with “(imported)” (numbered for repeated clashes); built-ins have
   no rename/update/delete actions. Import validates every record and group
   before saving. Native buttons, checkboxes, Tab/Space/Enter and existing
   prompt/confirmation dialogs retain keyboard operation. Projects and settings
   files are unaffected. Small round-trip/clash/identity checks: 3 passed; batch fast-check
   results are recorded below. Steve should select two presets, export/import,
   rename one and confirm/cancel Update.
4. Decide, with Steve, whether to remove HDR Lift/Gamma/Gain.
5. Reviews before 1.0: whole-pipeline order (PIPE-01), Texture against
   Microcontrast (DETAIL-01), local Clarity cost (CLARITY-01).
6. Local-grade transfer between lanes (its own piece of work).
7. Remove unused legacy shader inputs, if confirmed unused.
8. **Required for v1 (Steve, October 21, 2026):** healing brush in the
   local adjustment module, and hue selection as a local-adjustment mask.
   Specify and implement both; neither is built.
9. Claude's design pass on the integrated global/local HSL panel, then
   Steve's real-photo HDR review. The required hue-selection mask remains
   separate open work in item 8.

### Sharpen investigation — October 27, 2026

**Investigation complete; Steve accepted the method for v1 on October 27.
Delivery discrepancy remains open. No pixel code or sharpening method changed.** The comparison is
`codebase/output/sharpen-review/index.html`, with two read-only badminton RAWs,
DSC07147.ARW and DSC07178.ARW. Off, default, working and strong are matched
512-pixel crops at 100%, in SDR PNG and true HDR PQ AVIF; a labeled tone-mapped
PNG fallback is available. The page was opened in Chrome: all 16 images loaded
at 512 × 512, and the actual layout/crops were inspected. Loader defaults,
without saved grades or Denoise, are explicit in `recipe.json`; photo folders
were not written. Scripts under `codebase/tools/sharpen_review*` reproduce it.

**What it does.** Sharpen is a luminance unsharp mask in exposure stops: take
log2 brightness, subtract a blurred brightness image, and add a scaled portion
of that difference. The blur approximates a Gaussian using three separable box
passes, so radius changes are quantized rather than continuously changing every
sample. Amount (0–200) scales that added contrast; zero is off, and the default
is zero. Radius (0.3–3 original pixels, default 0.8) sets the width of affected
edges. Threshold (0–100, default 10) rejects small contrast differences: 100
means 0.5 EV, default 10 means 0.05 EV, with a smooth 0.04 EV transition. It
is a contrast gate, not a subject-edge/noise mask. A high-ISO grain sample may
still qualify. The change is applied as one RGB gain to preserve colour ratios.

A 3 × 3 local-extrema fence bounds the excursion to 12% of the local log range,
capped at 0.25 EV. This limits halos, but does not promise no visible edging.
The strong real-photo crops visibly boost noise, especially skin, and edge
contrast; they do not restore focus or motion detail. The moderate setting is
Amount 80 / Radius 0.8 / Threshold 10; strong is 200 / 3 / 0. Off and default
are intentionally identical, not mislabeled active sharpening.

**Order and viewing size.** Source interpretation and Denoise precede grading.
Global Detail follows Primaries, HSL, Curves and Color Grading, after tone
controls; Texture and Clarity contributions are computed before Sharpen within
Detail. The local-grade stack follows, then Film Look and Vignette. Final
highlight compression follows those effects. Export output sharpening is a
separate edge-aware, two-scale filter after output resizing; it does not reuse
Grade’s Sharpen filter. It was disabled in this review’s exports.

HDR uses ACEScg luminance and preserves values above SDR white; SDR uses linear
sRGB luminance and clamps changed RGB to 0–1. Both use the same contrast method,
so HDR does not have an independent capture-sharpening algorithm. The final HDR
compression, when enabled, limits the finished brightness, not the Sharpen
stage itself. All twelve decoded exports stayed below the 1000-nit target
(maximum 184.824 nits). These crops do not exercise specular edges near that
target; this is not a general bright-edge ceiling or halo proof.

At 100%, the detail preview uses native pixels. At Fit, a screen preview scales
the radius by proxy/source size (with a 0.3-pixel floor); a radius below 0.35
processing pixels makes the blur a passthrough. For a 7968-pixel photo in a
2560-pixel screen preview, default Radius 0.8 falls into that cutoff even with
Amount raised. The Radius 0.3 endpoint also does nothing at native size.
This shared CPU/GPU behavior explains an apparently dead control at Fit; it is
a limitation of the current scale/filter policy, not evidence of a disconnected
slider. A thumbnail quick draw is likewise unsuitable for judging fine detail.

**Checks and disagreement.** The existing Electron `detail-control-reference`
passed all 80 global/local HDR/SDR cases using its unchanged limits (relative
luminance p99 ≤2%, maximum ≤5%). A separate production-path check exported
padded crops through actual GPU and forced CPU delivery: two photos × off,
working, strong × two renderers, Ultra HDR JPEG quality 100, 4:4:4, full-size
quality-100 gain map, no dithering/resizing/output sharpening. Renderer labels
confirmed each route. Decoded HDR and SDR comparisons used the existing finished
colour limits: mean <1 and p99.9 ≤3, without a per-pixel maximum.

**Export agreement failed even with Sharpen off.** Off HDR mean 1.048–1.217,
p99.9 5.725–6.816; off SDR mean 0.226–0.246, p99.9 3.044–3.148. Active HDR
worst mean 1.421 / p99.9 9.070; active SDR worst mean 0.359 / p99.9 3.469.
All twelve lane comparisons exceeded at least one limit. This is an existing
production delivery discrepancy demonstrated with a neutral Detail stage;
the isolated Sharpen check passes. Do not claim GPU preview, CPU fallback and
export agree end-to-end. Record it as an open delivery issue; no speculative
pixel fix or tolerance relaxation was made in this investigation. Full numbers
and decoded brightness checks are beside the crops in `export-agreement.json`.

**Comparison and one recommendation.**
[darktable’s classic Sharpen](https://docs.darktable.org/usermanual/4.2/en/module-reference/processing-modules/sharpen/)
uses unsharp mask; its newer
[diffuse or sharpen](https://docs.darktable.org/usermanual/development/en/module-reference/processing-modules/diffuse/)
models and reverses blur with iterative, edge-oriented processing, at much
higher computational cost. [Lightroom’s documentation](https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/retouch-photos.html)
describes Amount, Radius, Detail and a separate edge Masking control, and
recommends judging at 100%; it does not disclose its exact filter there.
HDR Finisher has a simple contrast threshold rather than that separate masking
control or deconvolution/capture-sharpening stage.

Steve decided **keep the present method for v1**, judged at 100%, with the
in-app reminder (October 27). Trade-off: fast processing and verified isolated CPU/GPU
behavior, but limited blur recovery, disappearing small-radius effects at Fit
and noise amplification. More advanced sharpening is v2 exploration. The production delivery
agreement failure remains separate open work and must not be marked passed.

Part 2 validation: no pixel changes; fast checks deferred to this batch’s end.
Steve should hover Sharpen in Detail and judge the effect at 100%.

### October 27 batch validation

Fast suites ran once at batch end: JavaScript 635 passed / 2 failed;
Python 2,608 passed / 2 failed / 3 skipped. Unrelated failures, unchanged:

- `library-scenes`: selected photo joining development-ahead loses its CPU fallback when the GPU decoder fails (`decoder failed`).
- `library-single-ready`: the isolated fixture does not define `HDRLibraryScreenPreviews`.
- `test_rgb_description_precedes_pixels_and_keeps_publication_guards[None]`: RGB SourceReference luminance fixture mismatch.
- `test_library_native_source_uses_same_repair_before_reduction`: CaptureCache fixture lacks the `defer_store` keyword.

Part 1 used exactly one disposable-database D:\Photos profile; no second
profile after final corrections. Part 2’s three small portable-preset checks
passed. Part 3’s existing 80-case Detail reference passed; the twelve decoded
GPU/CPU export lane comparisons exceeded finished-colour limits even with
Sharpen off, as reported above. No rendered-pixel change or tolerance change.
Generated photo crops and logs stay local under ignored `codebase/output/`;
reproduction scripts and these findings are committed. No push.

### HSL integration and handoff (October 23, 2026)

Built in the app: independent HDR/SDR channels, one selection per local
grade, wheel and keyboard handles, Pick/Add/Subtract photo sampling, selection
overlay, per-channel reset, section bypass/reset, Adjustment Presets, undo,
project/saved-grade serialization and selective Library paste. Global HSL runs
after Primaries and before Curves; local HSL runs after White Balance/Saturation
and before Curves/Color Grading. Steve approved these local placements and
copying HSL selections, corrections and bypass unchanged into editable SDR
Match grades; colour-wheel translation and highlight-only attenuation do not
apply. Neutral HSL is exact passthrough, including the GPU early return.

For Claude:

- Global settings are `hdr.hsl_section_enabled` / `sdr.hsl_section_enabled`
  and `hdr.hsl` / `sdr.hsl`, each `{channels: [...]}`. A channel has `id`,
  `name`, `kind` (`all`, `band`, `custom`) and `recipe`. All plus eight ordered
  bands are fixed; four Custom channels may be added (13 total).
- Local `hdr_grade` / `sdr_grade` have `hsl_section_enabled` and `hsl`, one
  recipe. A recipe has `version: 1`, `ranges`, `hue` (±180°), `saturation`
  (±100%), `luminance` (±2 EV), `uniformity` (0–100) and `opacity` (0–1).
  Each range has `center` (0–360°), `width` (1–180° core half-width),
  `feather` (1–90°) and `subtract`. Maximum 32 ranges per channel, 416 per
  global lane and 32 per local grade. Limits are enforced and shown in the
  panel; a band keeps one included range. No migration code was added.
- Panel and styles: `codebase/frontend/hsl-panel.js`, `hsl.css`; markup in
  `index.html`. Existing slider, token, history and preset machinery is used.
  Shared JS engine: `hsl-engine.js`; production shader: `hsl-shader.js`.
  Python fallback and selection: `backend/hdr_finisher/hsl.py`; actual stage
  taps and overlay: `hsl_sampling.py`. The prototype imports the shared JS
  engine, so its engine is not a second maintained copy.
- The prototype's Oklab/OKLCh operation, signed/HDR handling, grey protection,
  max inclusion/exclusion, circular uniformity and default band centres and
  widths are retained. Global channels add deltas measured from the same
  input, in one GPU operation on the app device. Approved CAT02 conversions
  connect ACEScg HDR to D65 linear sRGB. Original GPU slots 0–197 are unchanged;
  slots 198/199 are count/reserved, then 13 blocks of 136 floats (1968 total).
- Picking averages a 5×5 neighbourhood in linear light from the real HSL
  stage input, including disabled local grades. Requests use a 1000-pixel
  proxy (bounded 256–1600), up to 512 stroke samples and the existing
  256-local limit. Local selection overlays include the grade's mask.
  Section/lane/session changes reject stale selections.
- Picker refinement (October 23, 2026): overlapping sampled hue ranges
  merge into a wider arc, including across red. Disjoint colours keep separate
  arcs; included and subtracted ranges merge independently. Dragging through
  nearby colours expands the selection without accumulating wheel handles.
- The prototype remains runnable; only its engine import path changed.
  The hue-selection mask leaf is not built by this integration.

Validation for the frontend integration commit: 573 JavaScript tests passed;
2,414 Python tests passed and 3 skipped. The registered HSL app driver passed
picker/add/subtract, wheel mouse/keyboard/delete, channel switching, one-step
undo/redo, preset save/apply, local grading, selection overlay, GPU preview,
exact neutral GPU passthrough and active GPU/CPU export/Proof. A final wheel
interaction exposed focus restoring to a non-focusable arc; focus now returns
to the keyboard handle and the driver waits for the edit acknowledgement
before measuring its mouse position. The final app check passed.
The unchanged finished-file limits are mean <1 and p99.9 ≤3 (ΔE2000 for SDR,
ΔITP for HDR). Neutral colour-stage checks and existing neutral GPU/CPU
export/Proof checks passed; the real-photo 800-nit ceiling check passed on
both renderers, with Proof byte-identical to export. No tolerances changed.
The initial suites exposed old parameter-count, section-count and model
serialization expectations; these were updated for the new HSL fields and
buffer tail, retaining all original parameter positions. The model test now
checks settings round trips and cache identity behaviour instead of a JSON
text hash. An unrelated Library source-file replacement check failed in the
initial Python run; no Library source ownership code was changed. It passed
in the final complete suite, with no outstanding fast-suite failures.

Known broader rendering limit: a highly saturated synthetic sweep (HSV
saturation .8, exposure levels −5 through +5) already exceeds the existing
GPU/CPU finished-file perceptual limits with HSL bypassed. The HSL arithmetic
probe agrees within the prototype limits and the moderate all-hue delivery
fixture passes the unchanged limits with HSL active. General photographic
acceptance, especially HDR appearance, still needs Steve's review; this work
does not claim that the unrelated saturated stress case is fixed.

### HSL prototype direction (Steve, October 22, 2026)

Steve approved building an isolated HSL/color-range prototype, leaving Claude
to refine the frontend. Share the eventual color operation between global
and local grades and share selection controls with the required hue mask.
The picker supports Pick, Add and Subtract: maintain disjoint included ranges
and feathered exclusions rather than filling every hue between samples.

The standalone prototype is in `codebase/tools/hsl-prototype/`; its README
documents the engine API, launch command, validation and frontend handoff.
It provides one multi-range correction, a GPU implementation with CPU
fallback, a photo picker and a demonstration local ellipse. It now shares its JS engine with the integrated app. Independent channels,
pipeline placement and persistence are built; Claude's design pass, Steve's
HDR visual acceptance and the hue-mask leaf remain open. This does not mark
the v1 hue-selection mask built.

Steve's decisions (October 22, 2026), after trying the prototype: the global
module uses DxO-style channels (All plus eight bands, each with its own edit,
refinable with the picker) plus up to four Custom channels for any
multi-colour pick. A local grade uses one multi-colour selection with one
edit, and the bands are quick starts. Both share one engine and one wheel.
Wheel ranges are control points; right-click deletes, as with path nodes.
Presets use the app's Adjustment Presets dialog. Global HSL runs after
Primaries and before Curves in both HDR and SDR; local HSL sits in the same
relative place inside each local grade. Codex builds the integration
(archived brief: `docs/technical/archive/briefs/codex-brief-hsl-integration-2026-10-22.md`); Claude
does a design pass afterwards.

## 6. Out of scope

Pixel painting and retouching beyond the required v1 Retouch brush,
layers and compositing, AI-based selection.

## 7. Detail and history

- Original tool definitions: [HDR_Finisher_PRD_v1.2 section 6](../archive/HDR_Finisher_PRD_v1.2.md);
  deferred items (Denoise, Clarity, Black & White, NEXT-01, PIPE-01,
  DETAIL-01): sections 11a to 11b of the same file.
- Local adjustments: [GPU_Local_Adjustments_and_Live_Scopes_Sprint_PRD](../archive/GPU_Local_Adjustments_and_Live_Scopes_Sprint_PRD.md),
  [local adjustments technical](../../technical/local-adjustments.md)
- Denoise: [denoising](../../technical/denoising.md)
- SDR Match: [sdr-match](../../technical/sdr-match.md)
- Minor bugs (all closed except MINOR-08, shelved):
  [Next_Sprint_Minor_Bug_Backlog](../archive/Next_Sprint_Minor_Bug_Backlog.md)
- User guide: [grade HDR](../../user-guide/grade-hdr.md),
  [grade SDR](../../user-guide/grade-sdr.md),
  [controls reference](../../user-guide/grading-controls-reference.md)

### Inpaint prototype controls — October 23, 2026

Steve requested the comparison methods inside the app for real-photo testing.
Standard inpaint remains the default with 10% hardness. The method menu adds
Edge feather, Preserve original texture and Replace texture from donors, each
marked prototype. All three reconstruct a full interior before applying an
independent edge feather (default 25% of radius); texture methods add a 0–100%
amount (default 100%). Original detail retains the native 5×5 high-pass residual
for tone/blotch correction. Donor detail uses clean PatchMatch correspondences
at native pixel phase, replacing rather than doubling the filled high-frequency
residual. Unlike the study's manual clean-strip donor, this selects donors
automatically. Pattern alignment and unwanted original-object outlines still
need Steve's real-photo assessment. Filtering runs in cancellable 64-row bands.

Apply settings updates a selected repair with its existing seed, frozen donor
exclusions and search rectangle when Size is unchanged. Retry explicitly changes
the seed. Methods, feather and amount save/replay with the repair and support
undo/redo across all shared-source consumers. Inner and outer cursor rings show
the full correction core and feather extent.

Validation criteria: Standard output unchanged; zero Texture amount equals Edge
feather exactly; deterministic saved replay, unchanged pixels outside the stroke,
finite unclamped HDR/negative values, and identical finished source for preview,
Proof and export. Known analytic texture fixtures check actual original-versus-
donor residual selection; natural-photo quality is deliberately left to Steve.
The existing one-second warm 24 MP deletion target also applies to donor-detail
repairs in the focused benchmark.

Validation outcome: both focused Electron drivers passed, including all three
prototype controls, same-seed Apply, undo/redo and bounded/full GPU refresh
agreement. Warm 24 MP multi-spot deletion measured 0.35–0.49 seconds at native
view and 0.81–0.96 seconds at fit, within the one-second target. The required
fast suites passed 585 JavaScript and 2,444 Python checks (3 Python skips);
only the known 3 edit-sync helper failures and 6 frontend wording-contract
failures remain. No test limits were relaxed. Real-photo quality acceptance
remains with Steve.

### Real-photo inpaint direction — October 23, 2026

Steve tested small dark spots on a textured real photo. Preserve original
texture with 71% Edge feather and 100% Texture amount worked well; Edge feather
alone still smoothed the center, and donor texture blended poorly. New brush
repairs now start with the successful original-texture settings. The other
methods remain available for comparison, and selecting a saved repair restores
its own recorded method and settings. This is acceptance of the direction for
small dark spots, not general acceptance for larger object removal.

Validation: focused Electron interaction passed with the new 71%/100% painted
recipe and saved-repair settings restoration. Required checks: 585 JavaScript
and 2,444 Python passes, 3 Python skips; the same 3 edit-sync helper failures
and 6 frontend wording failures remain. Processing and timing limits unchanged.

### Clone and Heal prototypes — October 23, 2026

Steve requested both brushes and supplied DSC00264.ARW for graded-photo
testing. Clone transfers user-selected original working pixels directly; Heal
transfers native source texture plus a harmonic boundary-difference correction
(smooth RGB correction on a maximum 128-by-128 grid; donor texture is never
resized). This follows the boundary-matching principle described in the
[GIMP healing reference](https://developer.gimp.org/core/algorithm/healing/),
with an independently implemented matrix-free conjugate-gradient solve. The existing Retouch CPU-first
exception applies; preview still uses the GPU after native source publication.

Both tools share Size, Edge feather, Opacity, source-space strokes, Apply
settings, selection, bypass, removal, history and saved replay. Alt-click or
Set source picks an anchor; each stroke starts at that anchor, maintaining a
fixed source offset while dragging. Cyan source circle and connector show
where pixels come from; selecting a saved repair restores its source. Choose
a new source and Apply to refine it. Retry remains Inpaint-only. Source pixels
come from the immutable interpreted original, before grading and prior repairs;
source strokes crossing the photo edge fail without replacing the last result.
Clone is direct copying; Heal is explicitly prototype pending Steve’s quality
review, especially across high-contrast edges, image borders and large strokes.

Validation criteria: exact integer-offset core copying and zero-opacity identity;
correct feather math; constant-tone healing preserves known donor checker detail
within 2e-7 on the small fixture and 5e-6 on the large bounded-grid fixture;
finite HDR/negative values without clipping; cancellation, stable saved/history
replay and shared Proof/export pixels. App tests cover both source-picking paths,
dragging, opacity and source editing. The supplied-photo comparison uses a
disposable copy with the saved global grade and RAW import settings, omitting
existing repairs; owner RAW/sidecar hashes must stay unchanged. Photo quality
is a labeled visual comparison, not an invented numerical acceptance gate.

The first graded-photo pass exposed a 2.2-second Heal update versus about
0.8 seconds for Clone. The harmonic solver now uses conjugate gradients rather
than repeated relaxation, with the same boundary constraints and maximum grid
size. The photo update target for this follow-up is one second through the
updated frame, leaving the established numerical fixture limits unchanged.

Validation outcome: both focused Electron drivers passed, including Inpaint
regression and manual-source controls, source edits, opacity and history. The
supplied-photo check used Steve’s saved grade on a disposable RAW copy, omitted
15 existing repairs for comparison, and verified unchanged owner RAW/sidecar
hashes. The final measured paint-to-frame times were 0.80 seconds for Clone and
1.24 seconds for Heal (down from 2.22); Heal remains above the one-second aim
and needs Steve’s responsiveness/quality assessment before more timing work.
Labeled crops and an HTML viewer are generated in output/retouch-transfer/.
Required checks: 585 JavaScript and 2,458 Python passes, 3 Python skips. The
same unrelated 3 edit-sync helper and 6 frontend wording failures remain. No
existing test tolerance or performance budget was relaxed.

### Compact Local and Retouch stacks — October 23, 2026

Steve requested six visible compact rows and a permanent scrollbar rail in
Local, with the same presentation in Retouch. Both stacks now use a fixed
six-row viewport with 32-pixel rows; the outer surface owns scrolling, so
there is no nested list scrollbar. The track remains painted and reserved
when the stack is empty or short. Retouch puts all Inpaint, Heal and Clone
repairs together at the top, with tool icons directly below and explicit
method labels in each row. Resume and Stop painting are compact icon actions.

Choosing any repair-tool icon clears the selected saved repair and activates
that tool for a new repair on the next stroke. Each tool has an independent
brush draft (size, feather, opacity and source); selecting an existing row
still restores that repair for Apply. Sources and drafts reset between photos.
Repair pixels, saved recipes and processing limits are unchanged.

Validation: the focused Electron panel and Clone/Heal checks passed, covering
six-row fit, seventh-row overflow, nontransparent short-list rails, shared
list ordering, independent sources/settings, and creating mixed repair jobs
without changing earlier jobs. Existing pixel, source editing, history and
preview checks passed. Required JavaScript: 585 passes and the same 3 unrelated
edit-sync helper failures. Python: 2,457 passes, 3 skips, the same 6 frontend
wording failures plus an unrelated Library source-ownership test failure
(`test_source_ownership_merges_tiers_promotes_and_rejects_stale_publication`,
expected ValueError not raised). No Library or pixel-processing code changed.


### Use the whole machine — October 25, 2026

Gamut, brush, grain and Denoise CPU work now share a machine-sized pool instead of half-CPU/eight-worker limits. Nested work runs inline to avoid pool deadlock. Retouch keeps the existing two-ROI memory allowance while allowing independent solves to overlap. Full limits, scratch timings and validation are recorded in
[Photo Library Part A](photo-library.md#part-a--use-the-whole-machine-october-25-2026).
