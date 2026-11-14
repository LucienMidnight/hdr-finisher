# Module PRD: Preview and GPU

- **Owner:** Steve
- **Master PRD:** [PRD](../PRD.md)
- **Last status check:** October 18, 2026, against the code.
- **Code:** frontend `webgpu-preview.js`, `webgpu-shaders.js`, `gpu-*.js`
  (including `gpu-param-layout.js`, `graph-scale.js`), `render-plan*.js`,
  scopes UI; backend `render_cache.py`, `cpu_strips.py`, `preview.py`,
  `scopes.py`, `overlay.py`, `peak_*.py`.

## November 14: Mac tiled scope harness correction

The unchanged base `87b91385` renders the admission-fallback fixture completely
and accepts the correct generation on the Mac. The failure was the driver's
hard-coded two-submission assertion, not a partially presented image: six
512-pixel tiles, batches of four, and a final presentation need three
submissions. The assertion now checks the batch-derived submission count,
complete processed area, non-cancellation and matching accepted/presentable
generations. It still exercises the real low-budget planner and requires
Tiled/WebGPU, no stale Direct scope texture, no GPU scope attempt, and a
fresh CPU scope. The final Mac check passes all of these. No renderer,
scheduler, batch size, memory budget or output changed.

This is a portable harness assumption, not proof of a Metal atomicity defect.
It can fail on a PC with the same tile/batch geometry; current PC hardware was
not available. The old evidence used four tiles, and the two-submission pin
dates from October 3, before the current six-tile observation. The current
release known-failure list does not enumerate this failure.

The lens driver also cancels setup preview timers/follow-ups before its
explicit comparison frame, avoiding Fit-versus-requested-size captures on
the smaller Mac window. Stable lens captures still miss the unchanged byte
gate; see the [Film Look follow-up](film-look.md). No shared shader or
export/delivery code was edited. The Film panel Enter/Space helper passes on
unchanged base and final code; its reported failure remains unconfirmed.

MacBook Neo, Apple A18 Pro, 8 GB, 1408x794-point window setting; all GPU checks are serial
through `tools/gpu-run-lock.py`. Evidence:
`codebase/output/macparity-base-scope.log` and
`codebase/output/macparity-final-scope.log`.

The default 90-second plain-Electron Library smoke also ran on this final
test-only change: six of 33 pictures, incomplete-coverage failure, no memory
or responsiveness-limit violation. This matches the previously recorded Mac
stall class, not a demonstrated regression from these driver changes; it was
not investigated or rerun. Evidence:
`codebase/output/quick-library-check/macparity/report.json`.

## November 13–14: P1-C Library GPU recovery safety

Library development now permits at most one device-loss recovery for the same
work, then selects the CPU. The count survives requeue, reservation cancellation
and a loss before work registration; a lost device is counted once, not again
when its operation throws. The temporary budget clears only after development
and native handoff both succeed. Pixel rejection still goes straight to the
CPU even when device loss, reservation cancellation or an allocation error
arrives at the same time.

The session failure key now includes source identity, the existing backend
`PictureErrors` source/settings revision, source-quality identity, complete RAW
import settings, repair context and requested output sizes. Canonical object
and size ordering prevents equivalent work from bypassing a remembered
rejection. Changed sources/settings get their own opportunity; unchanged
permanent failures do not resubmit. This reuses the existing revision owner,
not a second persistent failure store; its explicit retry behaviour is unchanged.

Checks: behavioural regressions cover permanent rejection, changed settings,
the device-loss callback, admission cancellation, pre-registration loss,
native-handoff loss and successful recovery. The backend metadata check passes.
Real MacBook Neo GPU injection (`library-gpu-recovery.js`, shared lock,
1408x794 points) passes: permanent OOM makes one GPU attempt, two device losses
make two attempts total, both photos finish on the CPU, reservations clear and
no broken-photo record remains. No agreed limit was relaxed.
Logs: `codebase/output/p1c-library-recovery.log`,
`codebase/output/p1c-node-suite.log`, `codebase/output/p1c-python-suite.log`.

The default 90-second plain-Electron Library check runs without app errors
or memory-limit violations, but shows only 2/33 photos (first at 0.5 s; ten
never). No scene development completes, so this is not a Library progress
acceptance pass. The existing mixed-folder admission stall remains outside
this safety fix; no extra timing run or budget change was made. Evidence:
`codebase/output/quick-library-check/p1c-gpu-safety/report.json`.

The additional `library-temporary-recovery.js --invalid-input` real-app check
also stalled without a completed scenario; it was deliberately stopped after
about seven minutes, not rerun. Sidecar/cache cleanup completed. Its end-to-end
input-rejection-to-CPU scenario remains unqualified; see the Grade module and
`codebase/output/p1c-edge-cpu-fallback.log`.

Remaining, outside P1-C: narrow Grade's broad out-of-memory/timeout temporary
classification (proposal 3.10). PC hardware confirmation is still needed.

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
| Only the 60 measured lens cases and SDR Velvia physical chain replace the byte-mean gate with fixed perceptual caps shared by PC and Mac. Lens HDR-editing-lane mean ≤ 0.161, p99.9 ≤ 1.155; lens SDR mean ≤ 0.248, p99.9 ≤ 1.202; SDR Velvia physical chain mean ≤ 0.125, p99.9 ≤ 1.065. Three-repeat worst + 0.005 mean / + 0.020 p99.9, rounded upward to 0.001; 68 strictly passing lens cases, two-level byte p99.9 and structural/coverage checks stay strict. Both editing lanes here are SDR presentations (ΔE 2000); true HDR ΔE ITP and delivery ceilings are unchanged. See Film Look for measurements. | Steve, 2026-11-14 |
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

1. **Completed; stale entry reconciled November 13:** export, Proof and
   Library pictures share the hidden GPU delivery renderer. Verified
   `desktop/main.js` creates the hidden `gpu-delivery.html` window; delivery
   implementation and qualification are recorded in Export and Proof.
2. Measure Crop and Rotate cost if Steve finds them slow.
3. Preview settling, as its own piece of work.
4. Linux HDR gradient dithering.
5. The "Later" performance rows, when Steve asks.
6. Narrow Grade's out-of-memory/timeout retry classification to established
   external contention; Library's P1-C recovery bound does not change it.

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

