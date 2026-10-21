# Local adjustments

Local adjustments are an ordered stage between global color grading and post-local finishing. Film Look, vignette, and final grain therefore retain their existing order, including the grain-last contract.

## V1 additions planned (Steve, October 21, 2026)

- **Healing brush:** required in the local adjustment module for v1. Not
  implemented. See the Retouch brush development plan below for Inpaint,
  Heal and Clone modes, CPU-first reasoning and implementation gates.
- **Hue-selection mask:** required as a local-adjustment mask for v1,
  including use in the existing combined-mask workflow. Not implemented;
  selection controls and hue evaluation remain to be specified.

These are planned requirements, not part of the shipping contracts below.
The [Grade module PRD](../product/modules/grade.md) owns their scope and
implementation status.

## Retouch brush development plan (October 21, 2026)

**Status:** planned; no retouch engine or UI is implemented. This section
records Steve's agreed direction and the proposed development sequence.
The existing shipping contracts below do not yet include retouching.

### Problem and intended result

Sensor dust can leave many visible spots in a photograph, with no repair
tool in HDRF. Provide one Retouch brush within the local adjustment module:
click over a spot or paint over an irregular defect, inspect the repair,
and refine or undo it without leaving the app.

| Mode | Behaviour | Initial technical target |
| --- | --- | --- |
| Inpaint (default) | Automatically reconstruct the painted region from suitable surroundings; no source click required. | CPU PatchMatch, using Krita Smart Patch as the principal reference. |
| Heal | User chooses a source; transfer its texture and adapt it to the destination's surrounding tone and colour. | CPU darktable/GIMP-style boundary-matching healing. |
| Clone | User chooses a source; copy it directly through a feathered mask. | CPU masked source copying. |

Start with dust, small blemishes and modest unwanted details. Large object
removal, neural generation and frequency-separated retouching are later
possibilities, not first-version requirements. Inpainting here does not
require an AI model.

### Decisions and reasoning

- **One tool, several engines:** share gestures, size, feather, strength,
  selection, history and saved repair records. Show source alignment only
  for Heal/Clone; show search and quality options only for Inpaint.
- **CPU first, GPU later (Steve):** darktable felt slightly slower than
  preferred but usable, especially given its flexibility. Establish useful
  repair quality and a working CPU fallback before experimenting with a
  GPU engine. This is a specific exception to the general GPU-first rule.
- **PatchMatch is the inpainting target:** searching for existing image
  patches offers a general basis for textured as well as smooth repairs.
  Krita provides a concrete implementation with patch-size and accuracy
  controls. This is a reason to prototype it, not a measured claim that it
  is faster or better than every alternative in HDRF.
- **OpenCV is a comparison baseline:** Telea and Navier-Stokes fill inward
  from the defect boundary and may suffice for small spots on smooth
  backgrounds. Compare them cheaply before committing to the adapted
  engine. Float support is single-channel; HDR RGB needs adaptation and
  numerical validation, not an 8-bit conversion.
- **Borrow algorithms, avoid application dependencies:** isolate a small
  processing component rather than embed Krita or darktable. CPU-intensive
  loops should use compiled code where needed; keep them off the UI thread.
- **Preserve HDR:** process floating-point working pixels, including values
  above 1 and legitimate negative values. Do not clip repairs into SDR
  range. The colour space used to score source matches may differ from
  reconstruction space; establish it through the quality prototype.
- **Compute repairs when their inputs change:** cache completed patches.
  Repainting, changing repair settings or changing upstream pixels must
  invalidate affected results. Downstream grading must not repeat a search.
- **Deterministic results:** persist the algorithm version, settings and
  random seed or resolved source mapping needed for reproducible repairs.
  Zoom, tile boundaries, reopening and export must not choose new patches.

### Interaction requirements

- A click creates a spot repair; a drag creates one brushed repair and one
  undo step. Size, feather and strength are shared controls.
- Select, bypass, delete and refine an existing repair. Overlays show its
  extent and, for Heal/Clone, its editable source.
- Inpaint automatically searches a bounded neighbourhood, excluding the
  defect. Provide Retry for another candidate and optional source-search
  region control; expose patch size and quality under advanced settings.
- A retry is an intentional edit recorded in history. A failed or cancelled
  solve leaves the last valid image visible and does not overwrite it.
- Run jobs in a background worker with cancellation and revision checks;
  stale results cannot attach to a different image or newer edit.

### Development steps and completion gates

All steps are open. Mark implementation built only after it is committed.

1. **Quality prototype and algorithm choice.** Assemble representative dust
   on skies/gradients, textured foliage/ground, edge-crossing spots, image
   borders and HDR highlights. Compare a bounded CPU PatchMatch prototype
   with OpenCV where practical. Confirm no halos, obvious repeated texture,
   lost gradients or clipped highlights on the selected examples. Steve
   judges whether quality and responsiveness are useful before expansion.
2. **Specify integration before wiring the engine.** Decide exact pipeline
   placement, repair ordering, interaction with existing local grades,
   geometry and denoise, and whether repairs are shared between HDR/SDR or
   lane-specific. UI placement in Local Adjustments does not settle render
   placement. Resolve these in the Grade PRD before implementation.
   Define source-space coordinates, operation schema, algorithm/version/
   seed handling, cancellation, cache keys and memory ownership.
3. **Deliver Inpaint end to end.** Implement the isolated CPU engine,
   bounded search, defect exclusion and masked reconstruction. Wire click/
   stroke input, advanced controls, Retry, selection, bypass/delete, undo/
   redo, project save/reopen and cache invalidation. Full-resolution repair
   results must stay stable across preview tiers; scale cached results for
   display rather than independently choosing replacements at each zoom.
4. **Add Heal and Clone.** Reuse the brush and operation infrastructure;
   add source picking, editable source offset and aligned/non-aligned
   sampling. Define whether later repairs can sample earlier repairs.
   Honour those dependencies when recomputing or parallelizing patches.
5. **Complete rendering and delivery integration.** Feed CPU-generated
   patches into the existing GPU preview without moving the whole grade
   onto the CPU. Cover CPU fallback, scopes, Proof, export and Library
   pictures. Fetch source regions outside the viewport/crop as needed.
   Reconstruct across tile boundaries with sufficient context; never solve
   each output tile independently. Bound worker buffers, queued work,
   cached patches and GPU uploads within existing memory budgets.
6. **Validate and tune the first release.** Steve tests real dusty photos,
   many spots, long strokes, overlapping repairs and edits after cropping.
   Check untouched areas, HDR range, reopen determinism, undo/redo, stale
   job rejection and device-loss fallback. Measure only after documenting
   proposed responsiveness/memory tolerances under AGENTS.md. Follow its
   fast-check policy and focused GPU checks; delivery changes require all
   relevant export/Proof checks. Existing perceptual and HDR ceiling
   requirements remain in force.
7. **Later GPU experiment.** Preserve the operation/engine boundary and
   working CPU fallback. Prototype bounded GPU patch search and healing,
   batch independent repairs and cache results. Compare quality and actual
   interaction latency before replacing the CPU path. A successful CPU
   release does not depend on completing this experiment.

### References and reuse notes

- [Krita Smart Patch controls](https://docs.krita.org/en/reference_manual/tools/smart_patch.html)
  and [PatchMatch implementation](https://github.com/KDE/krita/blob/master/plugins/tools/tool_smart_patch/kis_inpaint.cpp):
  primary inpainting reference; inspected file is GPL-2.0-or-later.
- [darktable Retouch](https://github.com/darktable-org/darktable/blob/master/src/iop/retouch.c)
  and [healing solver](https://github.com/darktable-org/darktable/blob/master/src/common/heal.c):
  unified tool and float healing references; inspected files are
  GPL-3.0-or-later. Its OpenCL healing wrapper currently copies patches to
  the CPU solver and back; it is not an entirely GPU healing implementation.
- [GIMP healing algorithm guide](https://developer.gimp.org/core/algorithm/healing/):
  background for the healing approach adapted by darktable.
- [OpenCV inpainting API](https://docs.opencv.org/4.x/d7/d8b/group__photo__inpaint.html):
  lightweight comparison methods, with documented input-format constraints.
- [Resynthesizer](https://github.com/bootchk/resynthesizer):
  secondary texture-synthesis reference if PatchMatch results disappoint.
  [LaMa](https://github.com/advimman/lama) remains a later neural option,
  with separate HDR, runtime and model-distribution work.

HDRF declares GPL-3.0. Before importing code, check the exact revision,
file-level licences, provenance and dependencies, and record attribution
in THIRD_PARTY_NOTICES.md. The references above are research targets, not
dependencies already integrated or benchmarked in HDRF.

## State contract

`EditDocument` is the versioned public document. It contains the source reference and SHA-256 fingerprint, source-interpretation override, global `AdjustmentState`, and up to 256 ordered `LocalAdjustment` records. Every local record owns a stable UUID, name, bypass and opacity state, one shared recursive `MaskExpression`, and independent HDR and SDR `LocalGrade` payloads. Mask-expression nodes also carry stable IDs and an enabled state so the UI can address, bypass, and change the blend operator of individual sub-masks without splitting the owning local grade.

The local-adjustment stack uses an explicit two-step creation contract. A mask tool may be selected before pressing `+`, or `+` may create a transient **Pick a tool** row that is materialized only after a tool is selected. Once materialized, the row's tool is fixed and the creation-tool strip is locked while that row is selected; pressing `+` or creating a sub-mask opens a new tool choice. **Create sub-mask** in a parent adjustment's overflow menu creates the same transient picker as an indented child row. A sub-mask row has its own bypass and overflow controls; its overflow menu exposes Union, Intersection, and Subtract, but cannot create deeper sub-masks.

Selecting a sub-mask switches the editing overlay to a three-color comparison: parent-only coverage is red, child-only coverage is blue, and shared coverage is explicitly composited as bright magenta. These colors are derived from the two mask rasters rather than stacked translucent tints, so overlap remains unambiguous through feathered boundaries. Selecting the parent row returns to the normal configurable overlay color and displays the final mask resolved through the sub-mask's current blend mode. Tool controls and on-canvas gizmos are scoped to the selected row, so a child's Gradient handles, Path controls, or Brush cursor never leak into its parent's editor (and vice versa).

Mask leaves use normalized coordinates in the uncropped source. Supported shipping leaves are brush strokes, linear gradients, four-handle scene-EV luminance ranges, and closed paths with sharp or smooth Bezier nodes. A path retains the scalar `feather` baseline and adds optional `feather_mode` and `feather_nodes` fields. `feather_mode` defaults to `symmetric`, preserving schema-version-1 projects; new paths use `outer_boundary`, where `feather_nodes` is an independently editable closed Bezier boundary. Path anchors remain inside the source, while Bezier handles and feather anchors/handles may extend by one normalized source extent outside it. All values must be finite, both boundaries must be simple and contain at least three nodes, and a materialized feather boundary must contain the inner path. Sampled point and sampled gradient records are serializable, but evaluate to an empty mask unless `HDR_FINISHER_ENABLE_SAMPLED_MASKS=1`; release builds must keep that flag off until the documented IP review is complete.

### Path interaction contract

Path creation is an uncommitted canvas draft. Left-click adds a sharp corner; dragging past the pointer threshold creates a smooth node with symmetric handles. Clicking the first node or pressing Enter closes a three-or-more-node draft. Interacting elsewhere also closes a valid draft, while Escape or leaving a draft with fewer than three nodes cancels it. A draft is not sent to the edit history until it closes.

Closed paths have explicit Path and Feather edit modes. Only the active boundary exposes nodes and the selected node's handles, though both boundaries stay visible. Left-clicking a segment inserts a node with an exact cubic split; straight segments create sharp nodes and curved segments create smooth nodes. Right-click, Delete, or Backspace removes the selected node down to the three-node minimum. Sharp retracts the selected handles. Smooth derives a tangent from neighboring anchors; dragging either smooth handle preserves collinearity while keeping independent handle lengths.

Keyboard editing mirrors pointer editing: bracket keys select the previous or next node, `H` cycles node/in/out targets, arrow keys nudge the active target, `S` and `M` choose Sharp or Smooth, Enter splits the following segment, and Delete/Backspace removes. The selected-node status is announced in the controls, and the canvas carries the complete accessible command summary.

Entering Feather mode on a legacy symmetric path deliberately materializes the closest uniform outer boundary. The global Feather slider offsets the current feather shape by its delta, preserving local deviations; Reset Feather Shape rebuilds a uniform boundary at the current baseline. Invalid feather drags are clamped at the last simple, containing geometry. Feather anchors and handles may remain outside the image so edge masks are editable.

The Luma tool presents the active false-color preset bands as clickable quick ranges in the side panel, followed by a two-handle logarithmic reference-nit range for precise lower/upper-edge edits. A second two-handle Refine Range maps that complete reference interval to its full width and can move either final edge inward without changing the reference bounds. Presets and viewport samples reset refinement to the full reference interval. The final refined range automatically receives a 0.75 EV tonal ramp before spatial feathering and opacity. Viewport clicks and drags sample small neighborhoods from the fixed geometry-transformed ACEScg source, reject median-absolute-deviation outliers, smooth dragged samples, and quantize the result to quarter-stop bounds. The first picker gesture replaces the broad default interval, later gestures expand it, and Alt gestures contract the nearest side of the continuous interval. The picker never samples the displayed grade or PQ/SDR preview transport.

Linear gradients are full density at the first point and fade to zero at the second. Two ordered on-axis controls place the two-thirds and one-third falloff anchors. A signed fan control bows the zero-density boundary, and per-gradient opacity is applied to both the red editing overlay and the rendered grade. Optional four-handle scene-EV refinement can protect shadows or highlights.

Mask algebra is deliberately soft:

- Union: `max(a, b)`
- Intersection: `a * b`
- Subtraction: `a * (1 - b)`
- Inversion: `1 - a`
- Final influence: `clamp(mask * opacity)`

Content-dependent masks always inspect the fixed geometry-transformed ACEScg source. Local grades and local ordering cannot move selection boundaries. Scene luminance is `log2(Y / 0.18)` using AP1 luminance weights.

Standalone Luma Feather is a post-selection spatial smoothing stage. It is evaluated after the scene-EV trapezoid has been constructed and before expression Invert and mask Opacity, using the same peak-preserving float blur as the Brush whole-mask control but a calmer Luma-specific response. The Luma UI follows a linear source-space radius from 0 to 0.09 (half the former maximum, with a substantially calmer low end); Brush retains its existing response curve. Luma masks with non-zero Feather are compiled full-frame so tiled rendering cannot introduce seams. The red editing overlay and applied local grade both consume this compiled result.

## Synchronization and history

The session exposes `GET/PUT /api/session/{id}/edit-state` and `POST /api/session/{id}/edit-commands`. Commands carry an expected revision. A mismatch returns HTTP 409 with both expected and current revisions; preview, scope, proof, and export requests can also require an exact `edit_revision`.

The history stores forward and inverse commands, not image snapshots. It retains at most 100 entries or 64 MiB, clears redo after divergent edits, and coalesces browser slider gestures at change/settle boundaries.

## Rendering and caches

CPU preview and export share the pre-local/local/post-local ordering. The local stage processes 512 by 512 float tiles and reuses the destination tile; export does not allocate one full-resolution mask or image per layer. Preview masks compile to byte masks and live in a separate LRU: 96 MiB through a 1600-pixel proxy and 160 MiB above that. Simple leaf masks have a spatial identity that excludes `mask_opacity`; their cached byte mask is compiled at unit opacity and the influence scalar is applied afterward. Boolean expressions keep exact per-leaf opacity in their identity and evaluation. Grade-only and simple mask-opacity changes therefore reuse the spatial mask, while geometry or structural mask signatures compile a new entry. Adjusted-frame invalidation retains the spatial-mask LRU; source replacement clears it. Full adjusted frames remain inside the existing bounded frame cache.

WebGPU uploads compiled masks as budgeted `r8unorm` textures and applies supported pixel-local grades between the global base pass and Film Look using reusable RGBA16F ping-pong surfaces. The local-parameter uniform carries both adjustment opacity and simple-leaf mask opacity, so opacity drags do not request, compile, transfer, or upload masks. The overlay uses the same spatial canvas with draw-time alpha. A mask-signature LRU avoids uploading grade-only and mask-opacity-only changes. Curves or grading-wheel combinations that the local shader does not yet cover fall back to the authoritative CPU renderer. Packing mask textures into arrays and batching eight locals per shader pass is the remaining performance phase before the 16/32/64-layer targets can be signed off.

Local controls use the shared preview scheduler. Pixel-local opacity and grade changes render on the next animation frame. Structural masks keep the last valid adjusted image while an exact draft compiles; the mask-draft lane aborts superseded requests and admits a response only when generation, edit revision, selected local, and mask signature still match. Scope requests receive the current draft local stack at reduced interactive resolution, supersede older work, and never blank the last valid scope. Settled/refinement work remains generation checked.

Outer-boundary path feathering is full coverage inside the inner path, zero outside the feather boundary, and a smooth distance-based falloff through the annulus. Distance uses the image's shorter edge as its unit so a nominal offset is visually equal on non-square sources. Overlay drafts, preview, scopes, export, and CPU fallback share this evaluator. Legacy `symmetric` paths retain the previous centered boundary feather until editable feathering is deliberately enabled.

## Project files

`.hdrfinisher` files are atomically replaced ZIP containers with a manifest and compressed JSON edit document. They contain no source pixels. The first save of an uploaded temporary source requires the durable original path and verifies its SHA-256 fingerprint. Open validates the fingerprint and enters an explicit relink flow when the stored path is missing or changed. Projects never restore automatically at launch.
