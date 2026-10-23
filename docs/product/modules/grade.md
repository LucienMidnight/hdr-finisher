# Module PRD: Grade

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
HDR/SDR metadata captions above these controls are removed. The panel title has
14 pixels of top padding; the scrollbar track stays visible at a fixed width
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
- **Presets window management** (PRESETS-01): rename, edit, import and
  export are missing.
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

1. Highlight and Shadow Desaturation in Color (COLOR-DESAT-01).
2. Investigate the Match fault once Steve has recorded a photo and message.
3. Presets window: rename, edit, import, export (PRESETS-01).
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
