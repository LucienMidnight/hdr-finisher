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
  pipeline placement and HDR/SDR sharing still need decisions.
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
