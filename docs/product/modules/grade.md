# Module PRD: Grade

- **Owner:** Steve
- **Master PRD:** [PRD](../PRD.md)
- **Last status check:** October 18, 2026, against the code.
- **Code:** backend `adjustments.py`, `detail.py`, `finishing.py`,
  `local_adjustments.py`, `mask_softness.py`, `mask_work.py`,
  `denoise_adaptive.py`, `sdr_match*.py`, `sessions.py`, `projects.py`,
  `models.py`; frontend panel files (see the
  [code map](../../technical/code-map.md)), `group-presets.js`,
  `grade-saving.js`, `sdr-match-ui.js`.

## 1. Purpose

Grade one photo into two excellent renditions, HDR and SDR, while seeing
true HDR. The controls should be photographic, predictable and quick, and
every edit must be undoable.

## 2. Scope

- The HDR and SDR lanes and their panels: Tone, Highlight Compression,
  Exposure Bands (tone equalizer), Color, Lift/Gamma/Gain, Base Rendition
  (SDR), Curves, Color Grading, Detail, Black & White, Vignette, Denoise.
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
  complete feature remains unbuilt until Heal, Clone and release validation are finished.
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
  are cached independently of grades and current/future defects exclude donors.
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

### HSL prototype direction (Steve, October 22, 2026)

Steve approved building an isolated HSL/color-range prototype, leaving Claude
to refine the frontend. Share the eventual color operation between global
and local grades and share selection controls with the required hue mask.
The picker supports Pick, Add and Subtract: maintain disjoint included ranges
and feathered exclusions rather than filling every hue between samples.

The standalone prototype is in `codebase/tools/hsl-prototype/`; its README
documents the engine API, launch command, validation and frontend handoff.
It provides one multi-range correction, a GPU implementation with CPU
fallback, a photo picker and a demonstration local ellipse. It is not wired
into the app. Production integration, independent channel settings, pipeline
placement, HDR visual acceptance, project persistence and the hue-mask leaf
remain open. This does not mark the v1 hue-selection mask built.

Claude's proposal (October 22, 2026), built in the prototype and awaiting
Steve's review: the global module uses DxO-style channels (All plus eight
bands, each with its own edit, refinable with the picker) plus Custom
channels for any multi-colour pick. A local grade uses one multi-colour
selection with one edit, and the bands are quick starts. Both share one
engine and one wheel.

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
