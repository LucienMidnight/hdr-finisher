# Module PRD: Preview and GPU

- **Owner:** Steve
- **Master PRD:** [PRD](../PRD.md)
- **Last status check:** October 18, 2026, against the code.
- **Code:** frontend `webgpu-preview.js`, `webgpu-shaders.js`, `gpu-*.js`
  (including `gpu-param-layout.js`, `graph-scale.js`), `gpu-render-plan.js`,
  scopes UI; backend `render_cache.py`, `cpu_strips.py`, `preview.py`,
  `scopes.py`, `overlay.py`, `peak_*.py`.

## November 26: unused helpers and stale planning comments

Removed the uncalled in-flight-promise accessor and HSL byte-summing method
(confirmed against frontend, tests, tools and docs). Delivery now reads its job
size directly instead of optionally calling a geometry helper that does not
exist and always fell back to that same size. Viewport/tile comments describe
the shipped region route; Auto-budget comments name the existing calibration.

## November 26: explicit HSL parameter-buffer retirement

HSL selection parameter buffers now join the existing retired-resource list.
They stay alive through command encoding and are explicitly destroyed after
submission or abandonment, including the tiled-render cleanup path. Previously
only outgrown textures used that cleanup; buffers depended on garbage collection.
No shader, selection arithmetic, cache cap or image output changes.

## November 26: presentation setup recovery

A throwing staleness check or canvas-resize callback releases the canvas gate
before propagating its error. Later pictures can acquire the same gate rather
than waiting forever. Callback-failure regression tests cover both boundaries;
successful serialization and stale-frame refusal are unchanged.

## November 26: scope encoding failure cleanup

Scope encoding now releases its busy pool slot and active-scope count when
buffer writes or command setup throw before readback begins. The readback and
encoding failure paths share the same cleanup. A forced device-error regression
checks recovery without changing the scope shader or successful analysis.

## November 26: mask batch failure cleanup

A failed mask batch aborts sibling requests and waits for all workers to unwind
before returning the error. This keeps the caller's shared scene-mask pin alive
through body-reader and GPU cleanup. The mask coordinator regression tests
cover delayed sibling cleanup and preservation of the original failure.
No shader, output, concurrency cap or memory allowance changes.

## November 16: measured stage costs and exact scope cleanup

The follow-up records named GPU completion-path increments, CPU profiling,
source transport, scope readback/unpack, histogram build/draw, per-run memory
and machine load. One-sample Film finish still takes ~22 ms per live Fit
picture; cold source preparation can cost seconds, and CPU scope analysis
adds 14–89 ms per build. Display-paced inputs still yield ~18 fps. See the
[performance table](../../technical/performance-table.md) for overlapping-stage
limitations, seven-pair draft-grain comparison and unimplemented priorities.

CPU histogram/waveform analysis now reuses four double-precision scratch
values within each call rather than allocating arrays and callbacks for each
sample. Arithmetic, sampling, statistics, bounds and full output values are
unchanged; no persistent cache or budget grows. The same actual scope buffer
measures 29.85→16.35 ms over nine alternating pairs, with exact payload equality.
This removes CPU stalls, not the GPU/source bottleneck; no end-to-end gain is
claimed. No shader, settled image, Proof or export implementation changes.

## November 16: stale zoom work and busy-frame recovery

DSC01287.ARW on the minimum Mac reproduces real multi-second zoom waits.
A new zoom now retires the prior scale's coordinator work immediately; panning
cancels running/pending catch-up. Deferred catch-up validates its scale and has
background priority. Its existing four-tile batches wait for device completion,
so a new action can stop offscreen work before the whole native frame is queued.
Idle catch-up and its exact tile/render maths remain. No shader, tile size,
quality, cache share or memory allowance changes; delivery/Proof/measurement
submission policy is unchanged.

The recovery watchdog also waits for scheduler frames queued or waiting on their
GPU fence. Previously it could restart a valid long render repeatedly. GPU
scopes defer while the first GPU picture is preparing and cancel older CPU
scopes when they take over; cancelling CPU work cannot mark a pending GPU
scope fresh. CPU-only settings, GPU failure fallback and Proof retain CPU scopes.

Neo / A18 Pro / 8 GB / 1408×794, saved Ektar/grain/halation/Tamron grade:
controlled zoom during catch-up drops median first refined picture 2.174→.502 s,
final viewport 2.639→.883 s (three pairs, same finished crop bytes). One repeated
4K adjustment drops 23.840→1.666 s after watchdog repair; ordinary warm 4K
remains ~1.7 s. Auto/Fit grain and Peak Fit settling remain costly, and 50%
cache returns are mixed. These are scoped gains, not general instant-preview
acceptance. Full conditions, limits and before/after records are in the
[performance table](../../technical/performance-table.md).

Final qualification on Neo / 1408×794, serial shared GPU lock: all 12 grain
GPU/CPU-export cases pass; tiled Film is byte-exact; the real tiled-admission
CPU-scope fallback, Retina zoom/settings and zoom-stall recovery drivers pass.
The latter converges a normal burst in .509 s without recovery, then restores
an intentionally orphaned native preview in 1.511 s with one watchdog re-arm.
The Retina harness now checks the existing one-source-pixel-per-display-pixel
contract, rather than assuming PC CSS pixels. No tolerance was relaxed.

Final fast suites: Node 1101 passed / one skipped; Python 3894 passed /
144 skipped / one existing xpass. Default 90-second plain-Electron Library:
9/9 requested viewport pictures, no errors or memory violations, independent
peak 2.367 GB; not whole-folder qualification. Sources/sidecars are hash-exact,
Steve's app was left open, and temporary half-size/synthetic inputs were
removed. Scratch finishes at 14.1 GB (under 100 GB). Evidence: performance table
and `codebase/output/stacked-raw-*.log`. No push, release or installer build.
Further approximation or a grain-cache budget change needs Steve's decision;
Steve should try the app after restarting before more responsiveness work.

## November 25: shared-memory admission in Grade

On unified memory, Grade checks for room before loading a source and
before allocating a render graph or swapping the presentation surface.
It reclaims unused inputs, drains submitted work and asks for a fresh
memory sample before refusing. A refusal does not clear the current
picture, and a settled edit or zoom can use a screen-sized CPU replacement.
Sharp and soft canvas backing images count once each while both are
live. Keeping the inputs for an already presented Denoise tile does not
allow the tile cache to grow beyond its existing share. See the
[memory policy](memory-and-caches.md#november-25-shared-memory-admission-for-grade-preview).

## November 21: correlated Grade Grain decisions

The desktop log includes the GPU configuration and the reason and memory
snapshot for Grade Grain refusals and retries. Grade cancels replaced work
without holding a failure against the source. Temporary failures can retry
once after recovery, including after device rebuild. Sticky source failures
go to the existing fallback. The timeline links preparation and the accepted
route to the originating Grade action.
[Diagnostic log and reason codes](../../technical/logging.md)
## November 21: unified memory and narrower Grain calibration scratch

Grade Grain checks whole-app headroom on Apple Silicon in addition to the
existing graphics budget. Background pressure queues reclaim until renders
and scopes finish. A live reservation can release an unused source proxy
while its own source and the visible picture stay resident.

Grain calibration stores its single-channel variance in `r32float` when the
device can compile that storage pipeline. It keeps float32 values and the
same arithmetic, saving 12 bytes per calibration scratch pixel. Resolve
scratch that is reused for multi-channel work retains its existing formats.

## November 21: bounded native work for Grade Grain

Fine and Clean Grain use a single haloed calibration rectangle at a time.
The 512-pixel row cores split at the existing 512-pixel tile boundaries.
The planner uses the device texture limit, storage binding limit and
readback-buffer limit and reduces the partial sums in their original order.
Fit processes output row and column bands when the full-width native strip
is too wide for the working texture or a single source-tile request. Its
Lanczos and local range windows remain anchored to the full image. Only the
reduced Fit picture stays on the GPU for later presentation.

Each upload keeps the existing two-slot Grade strip ring. Individual
source-tile requests fit the endpoint's rectangle limits and the device's
staging capacity. Native Clean Grain tiles include the original wavelet and
Small or Large colour margins. Micro Grain checks its Bayer endpoint, padded
storage, dispatch and texture limits before sharing bands. The existing
resident-source delivery size gate still applies. The
[Windows PC measurements](../../technical/performance-table.md#november-21--large-photo-grain-in-grade)
record route and memory at 2 GiB. The merged GPU and logging paths also
passed with Clean Small at Fit and 110%, and with Bayer Micro Grain at 110%.
Finished HDR/SDR comparison and the large Micro Fit check are pending.

## November 15: CPU preview diagnostics and grain cancellation

Grade CPU preview requests now write `grade_preview_cpu` to the existing backend
log, with source path, HDR/SDR lane, requested long edge and source-proportional
width/height, plus the browser's reason. Reasons distinguish an explicit CPU
setting, unavailable GPU (with renderer detail), a photo disabled by the existing
failure policy, unsupported locals, and the renderer's refusal/validation/budget
reason. No route eligibility, GPU retry rule, shader or tolerance changed.

Leaving Grade, changing lane or retiring a session aborts preview and instrument
requests and drops queued scopes. CPU previews now watch disconnects just as
instruments already do. Cancellation reaches grain between reduced-preview
samples, layers, field preparation stages and splat bands. The shared CPU pool
starts queued foreground work before scopes and carries cancellation/priority
into its workers. Already running NumPy calls finish their current operation.

One existing 128-row grain chunk owns grain scratch at a time across requests;
visible preview work takes precedence, and scopes abandon grain when a visible
preview is waiting. Grain no longer fills the shared CPU pool with simultaneous
large fields. This bounds overlapping grain allocations without changing the
RAM setting; it is not a guarantee that the entire app stays below 4 GB. Seeds,
chunk boundaries, all 4?16 preview samples and image maths are unchanged. Exact
regression fixtures were generated from `88775059` before these changes: both
lanes, both film types, native/2x2/4x4 sampling, and multiple row chunks.

The November 15 DSC07752.ARW incident still needs Steve's reproduction with
these diagnostics. RAW plus grain is supported on the GPU; the evidence proves
that grain made the CPU fallback expensive, not why that fallback was chosen.
The likely trigger is renderer refusal/failure or GPU eligibility state during
the lane switch; no unsupported-grain rule was found. Grain speed optimisation
remains separate Film Look open work 6.

Validation on the Windows PC (2560x1440), November 15: Node fast suite
995 passed / 1 skipped; Python fast suite 3543 passed / 43 skipped, with the
known unrelated `test_js_python_settings_agree` Windows path-separator failure.
The final CPU cancellation/priority/exact-pixel group passes 11 tests; browser
cancellation/reason tests pass. `grain-parity.js` passes all 12 cases and
`tiled-film-parity.js` passes, serially through the shared GPU lock. The first
app launch was blocked by a temporary syntax error in concurrent Library work;
backend import passed before the successful checks. No tolerance changed.
Logs: `codebase/output/grain-node-fast-final.log`, `grain-python-fast.log`,
`grain-behaviour-final.log`, `grain-gpu-parity.log`, `grain-gpu-tiled.log`.
Scratch output remains 46.2 GB. Steve's running app was left open; restart it
before reproducing so its backend and browser load these changes.

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
export/delivery code was edited. The standalone Film panel helper passed on
unchanged base and final code. The subsequent release run identified the
combined-helper cause: the presets helper changed the collapsed class without
updating the disclosure button state. It now opens the real disclosure button;
the complete character/presets/panel UI follow-up passes. The separate extreme
HDR numerical case still fails on current code and v0.9.2.

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

The Navigate window can be moved by dragging the solid top strip, marked
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

**Whole-frame source memory refusal (November 26, 2026).** If the backend
cannot prepare the GPU source within available working memory, Grade tries
the CPU preview. If that preview also fails, the viewer shows Unavailable
with the reason and keeps any last valid picture. An obsolete request still
yields to the newer preview without showing an error.

**Native zoom after a straighten (November 26, 2026).** Grade needs the
geometry map's dimensions before it can fetch tiles. Ordinary maps sample at
most 49 coordinates, but the full-preview memory check could refuse them and
send the viewer down a whole-frame path it also could not afford. The check
now applies only to exact quarter turns made by combining the roll controls,
which allocate full-frame coordinate ramps. Image memory limits and rendered
pixels are unchanged. The overnight timeouts had no trace, but both live Mac
reproductions now finish with tiles. The driver reports the unmet condition
after a two-minute wait and has a six-minute attempt cap of its own.

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
7. **Completed November 25:** Navigate and scopes recover after a
   refused zoom or auxiliary GPU request without waiting for native
   resolution. The scope peak remains labelled as a preview or estimate.
   CPU Micro Grain instruments retry when a matching whole-picture source
   arrives; a viewport tile alone cannot supply it. The CPU Micro Grain
   viewport now grades Scan Sharpening's three-pixel reach around the
   visible region and trims it, so its edges match the whole frame.

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

