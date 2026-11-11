# Module PRD: Preview and GPU

- **Owner:** Steve
- **Master PRD:** [PRD](../PRD.md)
- **Last status check:** October 18, 2026, against the code.
- **Code:** frontend `webgpu-preview.js`, `webgpu-shaders.js`, `gpu-*.js`
  (including `gpu-param-layout.js`, `graph-scale.js`), `render-plan*.js`,
  scopes UI; backend `render_cache.py`, `cpu_strips.py`, `preview.py`,
  `scopes.py`, `overlay.py`, `peak_*.py`.

## November 11: backend preview recovery and SDR noise identity

A failed source-proxy resize now releases the pending render, so the next
preview or scope request can retry instead of waiting indefinitely. Reduced
SDR noise measurements distinguish the authored SDR base from the scene
source; switching that choice no longer reuses the other picture's noise
model. Successful export/Proof rendering and files are unchanged. Regression
checks compare recovered preview pixels/scopes and cached noise models with
fresh results.

## November 8: movable Navigate window

The Navigate window can be moved by dragging its labelled title bar, marked
with two grip lines. Dragging the picture still pans the photo. Placement
lasts for the app session across photos, zoom and visibility changes; resizing
the viewer keeps the window inside its bounds. It starts at bottom-right on
app launch. No saved project or rendered output changes.

Validation: 847 JavaScript checks passed; Python had 3,084 passes and three
skips, with unrelated memory-poll timeout and existing Library cached-scene
failures. `view-tools-interaction.js` passed the new title drag, no-photo-pan,
hide/show, moved-thumbnail pan and viewer-boundary assertions before its
unrelated hidden Local Adjustments bypass button timeout. Local report:
`codebase/output/navigator-view-check.log`. The default Library check repeated
its existing drawing-gap failure (recorded in the performance table).

## 1. Purpose

Show the graded photo in true HDR, instantly, at any zoom, on the graphics
card, with scopes that can be trusted. The same GPU renderer is to become
the delivery renderer for export, Proof and Library pictures (see
[export-and-proof](export-and-proof.md)).

## 2. Principles (October 1, updated October 18, 2026)

1. **While editing, work is bounded by what is on screen.** Whole-image,
   full-resolution work happens at export and in Proof.
2. **Interactive work runs on the GPU.**
3. **Rigour goes where HDR matters.** Peak and highlight handling keep the
   tightest limits. Masks and tone only need to be perceptually identical.
4. **Cost per added local adjustment stays small and predictable.** More
   locals may cost speed, but there is never a cliff.
5. **No visible seams** when zooming, crossing a zoom threshold or panning.
6. **GPU and CPU agree within agreed tolerances,** not pixel for pixel. Since
   October 18, CPU export is no longer the exact reference (GPU first).

## 3. Decisions

| Decision | Date |
| --- | --- |
| Viewport-bounded preview: masks independent of resolution, small preview-against-export differences accepted, interactive work on the GPU. | Steve, 2026-10-01 |
| Stage tolerances (for example a painted-mask feather may differ by 2 of 255 levels) stay in force. Whole-image perceptual limits (ΔE 2000 / ΔE ITP, mean < 1.0, p99.9 ≤ 3.0) apply on top for delivery. | 2026-10-01, 2026-10-18 |
| GPU first for everything, including export. Superseded November 2 (next row). | Steve, 2026-10-18 |
| Speed where it is felt; the GPU where it pays: measure the whole wait first; a new GPU route needs about 50% or more off a noticeable wait, or a job the CPU can't do acceptably. Existing GPU routes (this preview, Library, delivery) stay. Master PRD philosophy 3. | Steve, 2026-11-02 |
| GPU failure rule: each GPU route makes one attempt, then uses its CPU fallback. A second GPU try only for a temporary failure outside the work (preemption, memory held by other work, device lost or renderer restarting, contention timeout). A result that fails a validity or range check, a compile or validation error, a job too large for the card, or no GPU goes straight to the CPU. Master PRD philosophy 3, "When a GPU attempt fails". | Steve, 2026-11-06 |
| Responsiveness is judged first by Steve using the app. A timing outside its tolerance that can't be explained is reported, and Steve tries the app before a test run is spent on it. | Steve, 2026-10 |

## 4. Current state (October 18, 2026)

**Built:** WebGPU renderer for the whole look (film stock, grain,
halation, Denoise, local adjustments and masks, geometry, lens), tiled
full-resolution rendering, viewport-bounded tiers with native zoom, GPU
scopes and navigation, GPU Match candidates, GPU memory budget (see
[memory-and-caches](memory-and-caches.md) for how VRAM and RAM budgets fit
together), device-loss
recovery, CPU fallback paths, preview-against-export comparison tools and
parity checks per stage.

SDR B&W anchor repair (October 21, 2026): hue-selective B&W now measures
its automatic maximum anchor on the existing bounded 1600-edge real-image
proxy. The packed peak-candidate atlas has unrelated neighbours and cannot
supply B&W's colour guide. Images within that edge use their native pixels;
larger images retain bounded editing measurement rather than a full-source
scan. The B&W parity check identifies the actual source working space and
compares GPU preview with CPU fallback preview. Its limits are unchanged.

**Open**

- PERF-04: background settle work at Full is cheap to feel but expensive to
  run. Suppressed at explicit Full in single view; auto tiers and compare
  keep the old behaviour by design.
- Optional full-resolution settle and faster refinement ("preview
  settling"). Not started.
- Linux: presentation-only dithering for HDR gradients (banding). Not built.
- Crop and Rotate may cost more speed than they should (11f). Not measured.
- REFWHITE-01: reference white on a file with its own HDR brightness.
  Behaviour unchanged.
- Known failures recorded in [known limitations](../../known-limitations.md):
  Black & White Direct/Tiled mismatch, uncompressed extreme HDR on
  Neutral, and the CF-SPEED, CF-DRIFT, CF-ROUTE and P3 rows marked "Later".

**GPU failure rule in preview (November 6, 2026, built).** The preview
failure policy (`render-failure.js`, `preview-pipeline.js`) makes at most one
GPU retry, only for a temporary cause: a timeout or network failure, out of
memory (other work may hold it) or a lost device. The frame stays on screen
during that retry. Card limits (too large for the adapter), validation,
unsupported graphs and unknown errors are not retried: that render uses the
CPU picture. Repeated validation failure (three in a row) now stops the GPU
only for that photo's Grade session instead of for the whole app. This is the
one place the rule's "already failed this session, go to the CPU" is not
applied at the first failure: the CPU preview is slow and refuses some graphs
(local adjustments, spatial film), so one failure does not switch a whole
photo to it. Initialization failure still disables the GPU everywhere.

## 5. Open work, in order

1. Serve GPU delivery: give export, Proof and Library pictures a hidden
   renderer that reuses this one (brief in Export and Proof).
2. Measure Crop and Rotate cost if Steve finds them slow.
3. Preview settling, as its own piece of work.
4. Linux HDR gradient dithering.
5. The "Later" performance rows, when Steve asks.

## 6. Detail and history

- Viewport-bounded design, tolerance policy and phase records:
  [Viewport_Bounded_GPU_Preview_PRD](../archive/Viewport_Bounded_GPU_Preview_PRD_2026-10-01.md)
  (section 15 lists everything deferred at the end of phase 3, and 16.22
  the phase 4 carry-overs)
- Earlier performance sprints: [GPU_Performance_Review](../archive/GPU_Performance_Review_Sprint_PRD_2026-09-29.md),
  [Viewport_ROI_Preview_Performance](../archive/Viewport_ROI_Preview_Performance_Sprint_PRD_2026-09-22.md),
  [Preview_Responsiveness_Tuning](../archive/Preview_Responsiveness_Tuning_Sprint_PRD_2026-09-25.md),
  [Stable_Exact_Full_Preview](../archive/Stable_Exact_Full_Preview_Sprint_PRD_2026-09-19.md),
  [Interactive_Preview_and_Scopes_Performance](../archive/Interactive_Preview_and_Scopes_Performance_Sprint_PRD.md),
  [Electron_Preview_Correctness](../archive/Electron_Preview_Correctness_Sprint.md)
- Full-tier deferred work (PERF-03 to PERF-07): [HDR_Finisher_PRD_v1.2 section 11b](../archive/HDR_Finisher_PRD_v1.2.md)
- Technical: [architecture, preview scheduling](../../technical/architecture.md),
  [highlight compression](../../technical/highlight-compression.md)

## November 6: graph frame polish

Histogram/waveform traces clip to their plotting frame; vectorscope density
clips to its circle. Curves and Exposure Bands clip their traces and share a
neutral device-pixel-aligned frame. Grid coordinates align to device pixels;
scales, samples, readings and label positions are unchanged. No image-render
or GPU changes. Grouped fast checks and graph review captures cover this UI.


The same November 6 frame/clip rule also covers both highlight-compression
charts, whose canvases now redraw at display resolution on resize. Their
transfer functions and values are unchanged.


Review follow-up: canvas outer borders are removed so each plotted graph has
one frame. The scope visual uses an explicit shrinking grid column to avoid
its intrinsic canvas size widening the narrow dock.


The narrow-window check also found a fixed 200 px readings width extending
past the compact grid track. Readings now follow their allocated width.


## November 8: SDR scope peak agreement

The GPU settled peak now measures sRGB display signal in SDR, matching the
CPU scope and the histogram bins. The September scope upgrade (`17ae1dfd`)
changed the CPU/binning domain but left the GPU peak reduction in linear light;
automatic settled measurement exposed that mismatch. HDR measurement and
rendered/exported pixels are unchanged. `gpu-scope-parity` passes all modes,
including SDR Exposure Bands, against the unchanged 3% peak limit.

## November 10: component-sheet graph frames and marks

Built: Curves, Exposure Bands, Highlight Compression and histogram canvases
paint panel-colour label gutters and restrict viewer fill to the grid rectangle.
End-label gutters are widened where needed. Exposure Bands uses a neutral
zero line, orange influence wash, and the shared yellow 4-by-3 dashed limit.
Highlight Compression uses a neutral curve, faint solid identity and labelled
yellow target line for HDR and SDR. Only graph drawing changes; all processing,
export/Proof output, tolerances and limits remain unchanged. Four-theme UI
review passes; grouped validation is in Desktop and release.

