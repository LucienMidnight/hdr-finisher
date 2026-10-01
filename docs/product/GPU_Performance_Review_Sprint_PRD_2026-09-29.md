# GPU Performance Review Sprint

**Date:** September 29, 2026  
**Status:** Wider measurement gates remain open; Steve authorized a first targeted optimization pass on September 30. See [targeted changes and focused verification](../technical/high-impact-performance-changes-2026-09-30.md). Historical measurement-only rules below describe the original sprint contract; this authorization supersedes the optimization-entry gate for the targeted pass.
**Primary fixture:** `D:\Photos\Play_Raw\Fantastic light over village - AdamFromCanada\DSC00950.hdrfinisher` with `DSC00950.ARW`  
**Reference workstation:** Steve's Windows workstation, NVIDIA GeForce RTX 4070 Ti (12 GiB), AC power  
**Related plans:** [Preview Responsiveness Tuning Sprint](Preview_Responsiveness_Tuning_Sprint_PRD_2026-09-25.md), [Viewport ROI Preview Performance Sprint](Viewport_ROI_Preview_Performance_Sprint_PRD_2026-09-22.md)  
**Related architecture review:** [Preview Performance Architecture Review](../technical/preview-performance-architecture-review-2026-09-22.md)  
**Recent structural baseline:** [Repo Cleanup and Code Audit Results](../design/Repo_Cleanup_and_Code_Audit_Results_2026-09-27.md)
**Controlled traces and resumed coverage:** [Heavy-project baseline and measurement ledger](../technical/performance-review-baseline-2026-09-30.md)

### September 30 continuation checkpoint

**Targeted optimization continuation:** Brush stroke accumulation now stays within stroke bounds, and post-Match presentation retries transient GPU cancellations rather than immediately falling back to CPU. Focused mask parity, regression tests and heavy-project checks passed; the 22-second endurance feather tail is not yet declared resolved. Steve clarified that the original stall occurred during active editing, probably around 30 minutes and definitely within one hour. The next endurance replay should target that duration/workflow rather than assume a multi-hour session. Details and exclusions are in the linked targeted-change report.

Completed fresh Electron warm batches: pointwise (26 rows), spatial/detail/film (18), dynamic curves/bands (10), local grades/masks (5), and structural/highlight/overlay/geometry (9), each with ten observations per row. These are representative processing-family commits, not complete drag or every-control coverage. Backend Match stage timings now expose candidate counts: exposure refinement alone measured 9,814 ms in the resumed Electron run. See the technical baseline for results and exclusions.

Fresh-process RAW import (three processes), short memory replay (61 samples), isolated denoise, and the viewer workflow driver now have results. First Exact Peak enable repeatedly costs about 20,600 ms. A non-neutral local curve forced CPU/backend presentation with `gpu-not-eligible`; CPU presentation was missing from the original GPU-event-only harness and is now observed in the disposable test process. Next: quantify these CPU-forced local families, expand remaining module/lane and trusted-drag coverage, and correlate the automatic-anchor denoise presentation refusal. Scope-stage decomposition, shared operation correlation, and the original mature-session slowdown remain open. No optimization-entry gate has been passed.

**Scoped continuation completed:** 67 unique representative native-drag rows × ten observations = **670**, with fixed HDR-primary display placement and per-row millisecond results in the baseline. Scalar rails, luma rails, curve/band nodes, wheel pads, vignette centers, local exposure/opacity/feather, gradient fan, denoise amount and geometry drag/Apply are covered. This is representative family coverage, not all 147 controls or stage/boundary/cache completion. Earlier repositioned/failed attempts are retained separately, not pooled.

One **30m16.807s active + 2m idle** original-automatic-anchor replay completed: 36 cycles, 404 tasks, eight Matches. It reproduced CPU-mask delays, input backpressure, backend working-set peaks of 23.53 GiB and GPU mask-cache saturation/eviction without a reported GPU device failure or checkpoint allocator-budget breach. The original minutes-long zoomed-out exact/scopes stall remains **not reproduced**. Next packets are DRAG-MAIN, MASK-CPU, CACHE-VRAM and REPRO-LONGER in the baseline; no optimization has been made or authorized.

## 1. Purpose

### Scoped drag/endurance continuation

The requested continuation closes the **representative native-drag pass** and one bounded **30-minute active replay plus two-minute idle tail** for the heavy fixture. It does not close every control, every boundary value, or the full sprint's stage-decomposition gates.

- `heavy-project-drag-review.js`: ten native-pointer observations per named row, HDR/SDR where applicable. Range rails use Control fine adjustment; overlaid luminance rails use their native thumbs. Canvas nodes, grading wheels, vignette center and geometry transactions are additional interaction types. Record actual gesture duration, input-to-first-feedback, release-to-exact, fresh matching scopes if emitted, scope-callback completion/reuse, and observed settled state. Geometry records draft compositor feedback and Apply-to-settled separately.
- `heavy-project-long-session.js`: original automatic anchors; exposure/detail drags, brush feather in both lanes, native zoom, pan, Fit and periodic Match. Keep per-operation route/request data, per-cycle GPU allocator/cache/failure snapshots, one-second process/whole-board samples, and a two-minute idle tail. Stop on a failed operation and preserve its evidence. A completed attempt without the original stall is **not reproduced**, not proof of absence.
- Both use the source project's in-memory session and a disposable Electron profile. No Save, no source edits, no processing/budget/cache-policy changes. Run GPU tests sequentially. Keep system/board memory attribution distinct from registered GPU allocations.
- The source bypasses Color and Color Grading; enable these outside the isolated drag clock and retain the measured recipe. Automatic peak analysis remains untouched in the endurance replay. These two workloads are deliberately different and must not be pooled.
- Raw artifacts remain under ignored `ai/codebase/output/performance/review`; durable measurements, exclusions, hashes and next investigation packets belong in the linked baseline. `summarize-review.js` produces a read-only compact summary.

Remaining wider-sprint distinctions (extremes, shader-stage cost, absent path-mask interactions, cold-cache replication and cross-layer operation IDs) stay open even when this scoped pass completes.

Measure where authoring time is spent before proposing performance changes. The review starts with the heavy real project that exposed the September 29 slowdown, then expands by module, slider processing family, and a small set of workflow tasks.

The primary questions are:

1. How many milliseconds pass from an input event to an exact presented frame and to settled scopes?
2. Which stages consume that time: scheduling, queueing, source or mask preparation, GPU execution, presentation, scope readback, or backend CPU work?
3. Which operations use Direct WebGPU, Tiled WebGPU, or CPU, and why was that route selected?
4. Which caches reduce repeated work, and which caches or retained allocations create pressure over a long grading session?
5. Which module and slider families are genuinely expensive, versus merely delayed behind unrelated queued work?

This is a characterization sprint. Instrumentation and benchmark fixtures may be added where necessary, but product algorithms, cache policies, quality, and routing are not changed until the baseline is reviewed.

## 2. Scope boundary

### In scope for the first pass

- RAW import through the first exact HDR frame and settled scopes.
- Opening the saved heavy project.
- Fit/zoomed-out `Display exact` authoring, plus 100% as a stress comparison.
- HDR and SDR global modules.
- Every distinct slider processing family, with at least one representative from every module that exposes it.
- Local-adjustment mask construction and local grade-only edits.
- HDR-to-SDR lane switching and **Match entire HDR grade**.
- Preview scheduling, render coordination, source transport, mask transport, GPU planning/execution, presentation, and scopes.
- CPU work that is required before or during a GPU preview, and every fallback that produces a CPU preview.
- Cache and memory behavior during a shortened replay of the mature-grade workflow.

### Deferred to later fan-out threads

- Export encoder performance and export parity.
- Chrome Proof generation.
- Packaging/startup and application-shell performance unrelated to import.
- Broad hardware, operating-system, and display matrices.
- Synthetic maximum-layer stress beyond what is needed to explain the primary fixture.
- Optimization proposals or implementation.

Deferred areas can be added as new work packets without changing the measurement contract in this document.

## 3. Rules of measurement

### 3.1 Do not mix different waits

Each recorded operation must report these milestones separately when applicable:

| Milestone | Definition |
|---|---|
| Input accepted | Trusted click, pointer/input, or task-start timestamp. |
| Scheduled | Work entered the preview scheduler or task coordinator. |
| Dispatched | The renderer/backend request actually began. |
| First feedback | First new frame presented for the current input, coarse or exact. |
| Exact preview | Exact frame for the current generation presented. |
| GPU complete | Submitted WebGPU work completed; use timestamp queries where supported and queue completion otherwise. |
| Scopes settled | Scopes correspond to the same lane/edit generation and no longer report Updating. |
| Task complete | User-visible operation completed, for example import or Match. |

Primary interactive metrics are **input → first feedback**, **input/release → exact preview**, and **input/release → settled scopes**. GPU encode/submission time must not be reported as GPU execution time.

### 3.2 Required sample classes

- **Cold:** first operation after launching the app and opening/importing the fixture.
- **Warm:** same graph and resolution after required source/mask data is resident.
- **Mature session:** after replaying the representative HDR grade and local-mask workload.
- **Recovery:** first operation after switching lane, zoom, preview tier, or another state that invalidates relevant caches.

For ordinary slider tests, record at least 10 warm samples and report median, p95, and maximum. Record at least three cold/recovery samples where practical. Expensive destructive tasks such as RAW import and Match may use three controlled repetitions initially; the report must show the sample count and must not imply a stable p95 from three samples.

### 3.3 Keep comparisons controlled

Every result row records:

- Git commit and dirty-worktree state.
- App version and packaged/development host.
- fixture identity and SHA-256; do not commit the photographer's RAW or project.
- lane, zoom, displayed edge, requested processing edge, and output dimensions.
- preview preference, ROI mode, scope mode/detail, and compare layout.
- grade/mask state and whether the operation changed graph structure.
- rendering mode, planned route, actual transport, and actual execution route.
- cold/warm/mature/recovery state.
- logical GPU budget, logical resident bytes, allocator entries/evictions/backoff.
- total board VRAM use as context, clearly separated from app-attributed logical use.
- backend RSS, Electron process working sets, and relevant cache counts.
- CPU model/thread policy, GPU/driver identity, display resolution/DPR, and background GPU workloads.

No run is compared with another if resolution, graph, scopes, or cache state silently differs.

### 3.4 Route truth is part of every timing

Allowed route labels are:

- `WebGPU Direct`
- `WebGPU Tiled`
- `CPU bounded/strip`
- `CPU whole-frame`
- `Mixed: GPU preview + CPU dependency`
- `Unknown` (a measurement defect to fix before drawing conclusions)

Every CPU or mixed row names the reason: unsupported graph feature, mask compilation, RAW decode/development, denoise, allocation/admission refusal, device loss, explicit CPU mode, or another recorded reason. A slow row without a route and reason is incomplete.

## 4. Primary fixture and replay states

The first fixture is the real project from the September 29 report:

- Sony RAW: `DSC00950.ARW`, 36,667,392 bytes.
- Saved project: `DSC00950.hdrfinisher`.
- Crop: approximately 0.626 × 0.937 of the source, 1:1 output.
- Five enabled local adjustments: three brush masks, one linear gradient, and one luminance-range mask.
- Brush content: 51 strokes and 514 points.
- HDR and SDR film graph includes grain, halation, and bloom.
- The observed HDR grade also used substantial Clarity, Sharpen, and Microcontrast.
- SDR Match was materialized into editable controls and marked `needs_review`; it was not using the legacy match-only rendering path.

Create repeatable checkpoints without altering the owner's source project:

| Checkpoint | Description | Reset requirement |
|---|---|---|
| H0 | Fresh launch before import | Restart app/backend. |
| H1 | RAW imported, neutral/default grade | New temporary session from the same RAW. |
| H2 | Saved mature HDR project opened, HDR lane | Reopen project; do not overwrite it. |
| H3 | H2 at Fit/zoomed-out `Display exact` | Record actual displayed/requested edges. |
| H4 | H2 at 100% | Record ROI and processed-pixel truth. |
| H5 | SDR lane before Match | Restore a controlled pre-Match project copy or undo atomically. |
| H6 | Immediately after Match | Include exact preview and scopes completion. |
| H7 | Warm post-Match SDR | Repeat non-destructive representative edits. |

The benchmark harness must work on a temporary project copy or an in-memory session. It must never overwrite the owner's `.hdrfinisher` file.

## 5. September 29 observed evidence

These values came from a live diagnostic capture of the reported session. They are clues and a starting baseline, not a controlled benchmark run.

### 5.1 GPU state

| Observation | Captured value |
|---|---:|
| Adapter | NVIDIA, Lovelace, non-fallback WebGPU adapter |
| Detected dedicated VRAM | 12,878,610,432 bytes (about 12 GiB) |
| Auto logical budget | 6,439,305,216 bytes (about 6 GiB; half of detected VRAM) |
| Logical resident allocation | 4,998,219,340 bytes (about 4.66 GiB) |
| Allocator over-budget bytes | 0 |
| Allocation backoff | 0 |
| Device loss/fallback evidence | None observed |
| Whole-board use from `nvidia-smi` | 8,601 MiB / 12,282 MiB, including other Windows applications |

The 6 GiB Auto policy was functioning. Whole-board use must not be mistaken for app-attributed use.

### 5.2 Resident GPU cache composition

| Kind | Entries | Logical bytes |
|---|---:|---:|
| Detail-band tiles | 1,595 | 3,220,935,040 |
| Mask tiles | 2,297 | 1,004,489,312 |
| Source proxies | 12 | 659,853,408 |
| Tile graph and other allocations | remainder | about 113 MiB |
| Total allocator entries | 3,913 | — |

Only two evictions had occurred. Future measurement must determine whether this residency is helpful reuse, harmless occupancy, or a contributor to later queue/allocation/transport latency.

### 5.3 Timing and process clues

| Observation | Captured value |
|---|---:|
| Final warm SDR exact render | about 22.9 ms |
| Final SDR requested processing edge | 1,204 px |
| Prior accepted HDR processing edge | 7,001 px |
| Recent long renderer/coordinator dispatches | about 27,500; 30,500; 30,000; and 55,350 ms |
| Recent scope update | about 3,115 ms |
| Recent settle operations | about 2,910 and 4,376 ms |
| Backend Python RSS | 15,553,835,008 bytes (about 14.49 GiB) |
| Scheduler inputs / frames | 5,084 / 3,186 |
| Coalesced frames / scopes | 1,302 / 101 |
| Stale results | 128 |

The September 29 live evidence did **not** identify a GPU error. It pointed to a mixture of mature-session cache residency, long dispatch/dependency waits, and high backend system-memory use. At that point Match end-to-end and RAW import had not yet been captured in milliseconds; the controlled traces below now cover Match, while RAW import remains open.

### 5.4 First controlled fresh-process trace (September 30)

Three diagnostic runs now supply initial milliseconds for the saved-project path. The fresh disposable processes did not reproduce the multi-hour session's 4.66 GiB logical GPU residency or 14.49 GiB backend RSS. The table below preserves run 01 in full; the following paragraphs summarize all three samples.

| Operation | Exact/task complete | First preview | Scopes settled | Key route evidence |
|---|---:|---:|---:|---|
| Open mature project | 14,266.6 ms | 9,905.4 ms | 10,229.6 ms | CPU/backend open and preview work, then WebGPU Direct exact |
| First HDR → SDR switch | 144.6 ms | 24.7 ms | 142.5 ms | WebGPU Direct |
| Warm SDR → HDR switch | 120.7 ms | 19.0 ms | 114.2 ms | WebGPU Direct |
| Warm HDR exposure edit | 325.2 ms | 156.5 ms | 293.0 ms | WebGPU Direct; GPU execution about 34–41 ms in nearby frames |
| Warm HDR exposure restore | 142.8 ms | 57.9 ms | 139.7 ms | WebGPU Direct |
| Match entire HDR grade | 22,591.9 ms | 16,334.0 ms | 22,579.9 ms | Mixed: 16,168 ms `/sdr-match`, then 6,292 ms CPU `/preview/sdr`, with final WebGPU Direct frames around 30 ms GPU time |

After Match, the allocator had 493,993,720 bytes registered across 237 entries against the correct 6,439,305,216-byte Auto budget. There were zero allocator evictions, over-budget bytes, or backoff events. The trace contained a `peak:newer-render-started` WebGPU refusal. Run 01 also requested a 7,362-pixel SDR proxy after the Match response while the visible exact target was 1,606 pixels; run 02 requested that edge during the unmeasured SDR preparation before Match but did not repeat it inside Match. Whether the refusal causes the CPU preview or merely shares the same scheduling race remains open.

Runs 02–03 repeated the important shape. Across all three samples Match took 17,015.3–22,591.9 ms (median 18,104.1), `/sdr-match` took 11,787–16,168 ms (median 12,509), and CPU `/preview/sdr` took 5,106–6,292 ms (median 5,472). Run 03 confirmed the CPU preview requested the correct 1,606-pixel edge. Final allocator state remained low at about 465 MB registered and 173 entries. Point-in-time process-tree sampling found 5,365,112,832–5,514,555,392 bytes total after the exposure restore, with the backend Python process at 4,174,790,656–4,351,746,048 bytes; the tree later fell to about 3.06–3.10 GB after Match. This is not a peak-RSS trace, but it confirms substantial transient/retained CPU memory even in a short clean session.

Run 03 identified the native-edge work. The renderer's canonical highlight-compression anchor calls `measureExactHighlightAnchor()`, selects the 7,362-pixel Full edge, performs a tiled measure-only GPU render, and includes all active local adjustments. Their masks are still compiled authoritatively by the CPU backend. Two 7,362-pixel mask batches started during the pre-Match SDR switch and ran for about 13,159 ms, overlapping almost the entire 11,787 ms Match request. Match then started six more native-edge mask batches while its visible CPU fallback correctly remained at 1,606 pixels. This overlap is a concrete contention and memory lead; it is not a VRAM-capacity event.

The baseline also exposed an instrumentation defect: some `submitToPresentMs` values are negative because the animation-frame timestamp predates a submission made within that frame. Those values are excluded until PERF-02 corrects the timestamp basis.

## 6. Measurement work packets

Each packet should be independently claimable by a future thread. A thread updates the status table, writes raw JSON below `ai/codebase/output/performance/`, and records durable conclusions in a dated file below `ai/docs/technical/`. Do not paste large raw traces into this PRD.

| ID | Work packet | Required output | Status | Owner/thread | Evidence |
|---|---|---|---|---|---|
| PERF-01 | Heavy-project reproducibility and safe checkpoint/reset workflow | Fixture manifest, hashes, checkpoint script/procedure | In progress | current thread | Safe disposable-profile driver and hashes in first controlled trace |
| PERF-02 | Timing schema and trace correlation | Shared operation/generation IDs across UI, coordinator, GPU, backend, and scopes | In progress | current thread | Preview/scope generations and per-operation request grouping added; cross-layer ID still open |
| PERF-03 | RAW import breakdown | Per-stage ms, CPU utilization/RSS, first preview and scopes milestones | In progress | current thread | Three fresh Electron/backend imports; phase, exact-preview and scopes ms captured; phase-attributed CPU/RSS remains open |
| PERF-04 | GPU planner and execution baseline | Direct/Tiled decisions, estimates, GPU execution ms, queue wait, present ms | In progress | current thread | Run 01 WebGPU Direct render timings and allocator snapshot |
| PERF-05 | Source transport and proxy/mip behavior | Fetch/decode/upload ms, bytes, hit/miss/eviction counts | In progress | current thread | Run 01 request durations and source-mip diagnostics |
| PERF-06 | Global module/slider sweep | Section 7 matrix completed for HDR and SDR | Representative drag pass complete; full matrix open | current thread | 147 controls inventoried; representative commit batches plus 67 fixed-display native-drag rows ×10; all individual paths, extremes, cold-cache and stage distinctions remain open |
| PERF-07 | Local masks and local grade sweep | Mask build/transport/cache plus grade-only timings | In progress | current thread | Five fixture-based rows × ten; additional local types, lane and grade-family coverage open |
| PERF-08 | Detail and film spatial graph | Per-module warm/cold GPU and any CPU dependency timings | In progress | current thread | Eighteen HDR/SDR warm representative rows × ten; cold/recovery decomposition open |
| PERF-09 | Scopes and overlays | Preview-independent and preview-blocked costs; readback/analysis/draw split | In progress | current thread | End-to-end scope settle times captured; internal split open |
| PERF-10 | HDR↔SDR lane switch and Match | Match analysis/fitting, document update, exact preview, scopes, memory deltas | In progress | current thread | First controlled Match and lane-switch trace |
| PERF-11 | Mature-session cache/RAM endurance | Timeline of GPU cache kinds, backend RSS, evictions, stale work, and latency | One bounded attempt complete; wider replication open | current thread | 30m16.807s active, 36 cycles / 404 tasks / 8 Matches, 1,647 OS/board samples, 2m idle. CPU WS peak 23.53 GiB; registered GPU near half-VRAM budget, 7,026 evictions. Original minutes-long stall/GPU error not reproduced; attribution and two additional sessions open |
| PERF-12 | CPU-forced-path inventory | Every fallback/dependency reason linked to measured rows | In progress | current thread | Post-Match CPU preview observed; causal refusal mapping open |
| PERF-13 | Baseline synthesis | Ranked bottlenecks with evidence and uncertainty; no fixes yet | Not started | — | — |

## 7. Module and slider measurement matrix

Test both lanes where a module has HDR and SDR behavior. For shared `current.*` modules, test HDR and SDR because shader branches, color spaces, and Match state may differ. Within a module, controls may share a processing family; test at least one representative of every family and record all controls covered by that representative. If two controls thought to share a path produce materially different traces, split them into separate rows.

| Module | Representative controls/actions | Processing families to cover | HDR | SDR | Cold ms | Warm median / p95 ms | Route / CPU reason | Status |
|---|---|---|---:|---:|---:|---:|---|---|
| RAW Development / Highlight Reconstruction | import defaults; reconstruction method/threshold/bypass when available | RAW decode, demosaic/develop, CPU preprocessing, source replacement | ✓ | n/a | — | — | — | Partial; baseline evidence captured |
| Crop & Rotate | straighten drag/apply, rotation, crop apply | geometry draft, resample, cache invalidation | ✓ | shared | — | — | — | Partial; baseline evidence captured |
| Perspective | horizontal, vertical, rotate, guided correction | geometry draft and authoritative resample | ✓ | shared | — | see native-drag ledger | WebGPU; draft compositor versus Apply recorded | Partial: representative horizontal drag/Apply; other axes/guides open |
| Denoise | enable/preset and each exposed parameter family | analysis, proxy creation, spatial/multiscale processing, stale-source handling | ✓ | ✓ | — | — | — | Partial; baseline evidence captured |
| Tone | exposure, contrast, pivot, shadow | pointwise; pivot-dependent tone | ✓ | ✓ | — | — | — | Partial; baseline evidence captured |
| Highlight Compression | start, target, softness, peak detail, measurement, bias, mode/color handling | peak measurement dependency, pointwise shoulder, detail/spatial path | ✓ | ✓ | — | — | — | Partial; baseline evidence captured |
| Exposure Bands | node amount/position, influence radius, smoothing, add/remove node, Match HDR bands | LUT/curve rebuild, neighborhood smoothing, graph-structure change | ✓ | ✓ | — | — | — | Partial; baseline evidence captured |
| Lift/Gamma/Gain | amount, range, pivot for each zone | pointwise with qualified ranges | ✓ | ✓ | — | — | — | Partial; baseline evidence captured |
| Curves | drag point, add/remove point, RGB versus luma | LUT rebuild and channel variants | ✓ | ✓ | — | — | — | Partial; baseline evidence captured |
| Color / Primaries | temperature, tint, saturation, vibrance, hue, purity | matrix/pointwise, perceptual/chroma branch | ✓ | ✓ | — | — | — | Partial; baseline evidence captured |
| Color Grading | wheel hue/saturation/luminance and qualification controls | pointwise plus zone qualification | ✓ | ✓ | — | — | — | Partial; baseline evidence captured |
| Black & White | enable and each tonal/color-family slider | guide/lattice dependency and pointwise mix | ✓ | ✓ | — | — | — | Partial; baseline evidence captured |
| Local Adjustments: masks | brush stroke/feather, linear gradient, luminance range/feather; path if separately exercised | mask rasterization, blur, CPU compilation, transport, tile cache | ✓ | shared masks | — | — | — | Partial; baseline evidence captured |
| Local Adjustments: grade | exposure, WB/tint, saturation/vibrance, tone/curve/detail representatives, opacity | grade-only reuse versus mask rebuild | ✓ | ✓ | — | — | — | Partial; baseline evidence captured |
| Detail | texture, clarity amount/radius, softness, microcontrast, sharpen amount/radius/threshold | multiscale bands, blur/neighborhood, cache identity | ✓ | ✓ | — | — | — | Partial; baseline evidence captured |
| Film Look: base/print | look strength, print strength/contrast, density, toe/shoulder, channel responses, desaturation | LUT/pointwise and tone-qualified work | ✓ | ✓ | — | — | — | Partial; baseline evidence captured |
| Film Look: halation | amount, sensitivity, physical extent, hue, saturation, enable/map | threshold map, spatial blur, compositing | ✓ | ✓ | — | — | — | Partial; baseline evidence captured |
| Film Look: bloom/diffusion | amount, sensitivity, spread, highlight detail, enable | threshold map, spatial blur, compositing | ✓ | ✓ | — | — | — | Partial; baseline evidence captured |
| Film Look: grain/resolution | amount, size, softness, chroma, tone responses, type/format/geometry, resolution | procedural field, multichannel grain, structural option change | ✓ | ✓ | — | — | — | Partial; baseline evidence captured |
| Vignette | amount, midpoint, roundness, feather, highlight protection, center drag | coordinate field, highlight-qualified pointwise work | ✓ | ✓ | — | — | — | Partial; baseline evidence captured |
| Viewer overlays | overlay opacity/threshold/mode, mask maps, comparison | independent overlay render/composite | ✓ | ✓ | — | — | — | Partial; baseline evidence captured |
| Scopes | histogram, waveform, vectorscope; detail/channel/region/exact peak | GPU readback, CPU/JS analysis, canvas draw, exact peak | ✓ | ✓ | — | — | — | Partial; baseline evidence captured |

### 7.1 Slider processing families checklist

Current module statuses above indicate partial representative coverage, not completion of every action in the row. Exact timing, lane, route, sample class and limitations live in the linked technical baseline. The family checklist below retains **No** until its full required timing distinction (for example drag versus release or cache miss versus reuse) has been met; a fast commit sample alone does not close a family.

This checklist prevents a fast pointwise slider from standing in for a heavier slider in the same visible panel.

| Family | Example | Required timing distinction | Covered |
|---|---|---|---|
| Pointwise scalar | Exposure, saturation | drag frame versus release/exact | Yes: representative HDR/SDR native rails; ms ledger recorded |
| Parameter-dependent pointwise | Contrast pivot, Lift range | ordinary value versus boundary/extreme | No |
| LUT/curve rebuild | Curves, Exposure Bands | LUT construction versus GPU application | No |
| Measurement-dependent | highlight peak mode/bias | cached peak versus fresh measurement | No |
| Neighborhood/spatial | clarity, softness, sharpen | cold radius/scale versus warm amount-only | No |
| Multiscale/band | detail graph, denoise | band cache miss versus reuse | No |
| Optical blur/composite | halation, bloom | map build, blur, composite separately | No |
| Procedural field | grain | field regeneration versus amount-only reuse | No |
| Geometry/resampling | crop, rotate, perspective | draft versus committed authoritative frame | No |
| Mask structure | brush/gradient/luma/path geometry | raster/compile/transport/cache | No |
| Mask feather/range | luma or brush feather | CPU/GPU locus and resolution scaling | No |
| Local grade-only | exposure inside an unchanged mask | prove zero mask rebuilds | No |
| Structural/discrete | enable, mode, add/remove node | graph rebuild and cache invalidation | No |

Before PERF-06 closes, generate a machine-readable inventory of current `data-path` controls and map every path to one matrix row/family. This guards against silently omitting a slider as the UI evolves.

The initial inventory is now generated by `tests/performance/control-inventory.js`. It classifies all 147 static `data-path` controls with zero duplicates and zero unclassified paths: 61 pointwise scalar, 31 parameter-dependent pointwise, 15 procedural, 12 optical blur/composite, 10 measurement-dependent, 8 neighborhood/spatial, 4 geometry, 3 structural/discrete, 2 multiscale/band, and 1 LUT/curve control. Dynamic controls that do not use a fixed `data-path`—curves, exposure-band nodes, local masks/grades, scopes, zoom/pan, and compare/overlay tasks—remain explicit additional families in the generated manifest.

## 8. Workflow task matrix

| Task | Start milestone | Required completion milestones | Repetitions | Baseline | Status |
|---|---|---|---:|---:|---|
| RAW import | file confirmed | metadata ready; decode/develop complete; first feedback; exact HDR; scopes settled | 3 cold | exact 3,309–3,467 ms; scopes 4,829–4,988 ms | Three fresh processes measured; see baseline for stages |
| Open mature project | open confirmed | project parsed; source ready; exact HDR; scopes settled | 3 cold | median 10,230.1 ms; range 9,931.6–14,266.6; n=3 | Initial sample complete |
| HDR → SDR lane switch | tab click | first SDR frame; exact SDR; scopes settled | 3 cold + 10 warm | median 113.0 ms; range 112.6–144.6; n=3 | In progress |
| SDR → HDR lane switch | tab click | first HDR frame; exact HDR; scopes settled | 3 cold + 10 warm | median 120.7 ms; range 117.4–130.9; n=3 | In progress |
| Match entire HDR grade | button click | backend response; document applied; exact SDR; scopes settled; comparison pane if active | 3 controlled | median 18,104.1 ms; range 17,015.3–22,591.9; n=3 | Initial sample complete |
| Fit/zoomed-out exact | zoom action or layout settle | exact frame and scopes at recorded displayed edge | 3 cold + 10 warm | endurance median 182 ms, max 1,299; earlier viewer batch in ledger | Partial; fresh scope versus reuse/cold distinctions open |
| 100% zoom | zoom action | exact visible region/frame, scopes, deferred catch-up if any | 3 cold + 10 warm | endurance median 8,164 ms, max 56,113; earlier warm viewer batch in ledger | Partial; native-edge dependency correlation open |
| Pan at 100% | pointer start/release | feedback, exact visible region, catch-up completion | 10 warm | earlier compositor / endurance programmatic scroll only | Partial; authoritative deferred catch-up still unmeasured |
| Scope mode/detail change | control change | matching scope drawn and settled | 10 warm | representative mode/channel/detail batches in ledger | Partial; stage decomposition and region coverage open |
| Mature edit replay (at least ten minutes) | first scripted edit | per-operation trace plus final memory/cache snapshot | 3 sessions | one 30-minute active / 2-minute idle attempt; see endurance ledger | 1/3 attempts complete; exact original stall not reproduced |

## 9. Match-specific breakdown

PERF-10 must treat Match as a pipeline, not one wall-clock number:

1. pending edit synchronization;
2. 768-pixel analysis source/proxy acquisition;
3. settled HDR analysis render;
4. local-mask compilation for translation;
5. semantic SDR translation;
6. candidate render/fitting passes, counted and timed by type;
7. quality-metric evaluation;
8. edit-document commit and frontend state application;
9. SDR source/mask preparation and GPU render;
10. exact SDR presentation;
11. settled scope readback/analysis/draw;
12. cache and process-memory deltas at each major boundary.

Record candidate-pass counts because total Match time may vary with whether the image crosses refinement thresholds. Record the requested preview edge after Match; do not assume it from the zoom label.

## 10. CPU-forced-path ledger

PERF-12 maintains this table. A CPU dependency is not automatically a bug; it is made explicit so its cost can be judged.

| Operation/module | Intended route | Actual route | CPU work or fallback reason | CPU ms | Blocks preview? | Evidence | Status |
|---|---|---|---|---:|---|---|---|
| RAW import | CPU + later GPU preview | — | decode/develop/metadata/reconstruction | — | Yes | — | Open |
| Match analysis/fitting | CPU analysis + GPU final preview | Mixed | Backend `/sdr-match`; internal phase split still missing | 11,787–16,168 | Yes | Runs 01–03 network traces | In progress |
| Canonical highlight anchor with locals | Tiled GPU measurement with prepared masks | Mixed | native-edge local masks compiled by CPU backend; two pre-Match batches overlapped Match for ~13,159 ms | 13,158–13,159 per overlapping batch | Background contention | Run 03 operation-correlated request trace | In progress |
| Local masks | WebGPU preview with prepared masks | — | identify whole-mask compile/feather cases | — | — | — | Open |
| Local non-neutral curves / color grading | Whole preview GPU only if all active locals are supported | CPU/backend for non-neutral local curves; local grading guard also rejects non-neutral wheels/balance/blending | `gpuLocalSupported` rejects non-neutral curves or grading; one unsupported active local makes `gpuPreviewEligible` false for the lane | Timing in progress | Yes | Local-grade diagnostic accepted CPU image and `gpu-not-eligible`; `webgpu-preview.js` eligibility guard | In progress |
| Denoise | determine from active graph | — | record analysis/proxy/fallback reason | — | — | — | Open |
| Exact scopes | GPU readback plus analysis | GPU plus analysis | end-to-end settled captured; readback/analysis/draw split missing | — | No for preview; yes for settled state | Run 01 preview/scope events | In progress |
| Preview fallback after Match | WebGPU expected | CPU `/preview/sdr`, then WebGPU Direct | `peak:newer-render-started` refusal observed in all controlled runs; Match lacks the ordinary settle path's transient-refusal guard | 5,106–6,292 | Yes for final settle | Runs 01–03 request and GPU-stage traces | In progress |

Any fallback without an emitted reason becomes an instrumentation defect in PERF-02.

## 11. Evidence layout

Suggested durable outputs:

```text
ai/docs/technical/performance-review-baseline-2026-09-29.md
ai/codebase/output/performance/review/<commit>/<run-id>/manifest.json
ai/codebase/output/performance/review/<commit>/<run-id>/operations.json
ai/codebase/output/performance/review/<commit>/<run-id>/memory-timeline.json
ai/codebase/output/performance/review/<commit>/<run-id>/summary.json
```

`output/performance/` remains disposable and ignored. The technical baseline contains the exact commands, percentile method, selected summary tables, anomalies, and links or relative paths to retained local artifacts. Do not commit the private RAW/project or giant traces.

Existing harnesses should be extended or composed before adding overlapping scripts:

- `tests/performance/headline-latency.js`
- `tests/performance/exact-tier-latency.js`
- `tests/performance/gpu-local-adjustments.js`
- `tests/performance/detail-cache-residency.js`
- `tests/performance/film-look-interaction.js`
- `tests/performance/local-mask-performance.js`
- `tests/performance/source-mip-benchmark.py`
- `tests/performance/phase5-endurance.js`
- `tests/sdr-match-gpu-interaction.js`

## 12. Review gates

### Baseline-complete gate

The first-pass baseline is complete only when:

- the heavy project can be replayed safely and repeatably;
- every Section 7 module has a measured row for each applicable lane;
- every Section 7.1 processing family is covered;
- RAW import and Match have stage-level milliseconds, not only total wall time;
- every timed preview states Direct/Tiled/CPU/Mixed and its processed resolution;
- exact-preview and scopes-settled times are separate;
- GPU execution is separated from queueing, preparation, and presentation;
- backend RSS and GPU cache residency are tracked through the mature-session replay;
- all unexpected CPU paths have a recorded reason;
- the observed September 29 slowdown can either be reproduced or is explicitly classified as not yet reproduced.

### Optimization-entry gate

Only after the baseline review may a follow-up sprint rank and authorize changes. Each proposed change must cite a measured bottleneck, name the metric it is expected to improve, preserve image/parity requirements, and define a negative control. Architectural neatness or high resource use alone is not sufficient evidence of a performance problem.

## 13. Open questions for measurement, not speculation

1. Why did the backend retain roughly 14.49 GiB after the mature session: live caches, in-flight work, allocator high-water behavior, or unintended retention?
2. Do thousands of retained detail/mask tiles improve subsequent edits enough to justify their residency, or do they increase later latency?
3. What portion of the 27–55 second dispatches was GPU execution versus waiting on source/mask/backend dependencies?
4. How much of Match time is candidate fitting versus post-Match exact preview and scopes?
5. Which module invalidations rebuild masks, detail bands, source proxies, or peak measurements unnecessarily?
6. Which CPU operations are required for correctness, and which are accidental fallbacks from a GPU-capable graph?
7. Does Fit/zoomed-out `Display exact` remain bounded to the displayed edge throughout lane switch and Match, including layout transitions?

Answer these with traces and repeatable timings before drafting fixes.

## 14. October 1 root-cause pass: what was found and what changed

This pass re-read the October 1 fresh-work endurance trace (`followup-2026-10-01-attempt-3/endurance.json`) request by request and profiled the backend in-process on the heavy project. The project and RAW were only read. Nothing here is committed; the changes are in the working tree alongside the earlier uncommitted instrumentation.

### 14.1 Why each operation is slow

| Operation | Cause | Kind |
|---|---|---|
| Native zoom (8.3 s median) | One full-resolution CPU compile of the edited brush mask: about 4.3 s rasterizing 435 overlapping stroke segments, about 2.75 s for the 12-pass feather over 36 MP, on one thread | Design; reduced to about 2.3 s by A and B below |
| Match (9.4 s median) | 28 full-pipeline candidate renders at about 270 ms each, one after another; no single hotspot | Design |
| Brush edit / feather release (0.4-0.5 s) | The same mask was compiled twice, at 1600 px for the overlay and 1606 px for the renderer, in 340 of 420 mask-compiling operations | Bug, fixed |
| Return to Fit tail (570-620 ms) | The backend had evicted the Fit-size masks, so all four were recompiled | Bug, fixed |
| Lane switch (59-69 ms) | The picture is exact in 17-25 ms; the rest is scopes settling | Not a problem |

### 14.2 Changes made

1. **Client aborts now reach the mask worker.** The desktop boundary was an `@app.middleware("http")` function. That wrapper hides the client disconnect from `Request.is_disconnected()`, so the disconnect half of commit `43924fb` never ran in the real app; its test passed only because it used a stand-in request object. The boundary is now a plain ASGI class (`DesktopRequestBoundary` in `main.py`) with the same authorization and response headers. A new test drives a real server and a real socket.
2. **Mask work stops for the right reason.** `mask_work.py` now separates *obsolete* work (the mask was edited away) from *abandoned* work (the client left). Obsolescence is judged by the mask's spatial identity and geometry, not the revision number, so a grade edit no longer cancels a compile whose result is still the mask that will be asked for next. An abandoned owner keeps computing while another request waits on its flight, and gets a 150 ms grace for the re-request to arrive. A finished, still-valid mask is cached even if its requester left. Grade edits (`clear_adjusted`) no longer detach mask flights.
3. **Mask cache eviction.** The budget now follows the largest edge held instead of the edge just inserted, and superseded shapes of an edited mask are evicted before live masks of untouched ones. In the trace, three untouched masks had been recompiled at native 33 times, about 113 s of 294 s of native compile time. The attribution to eviction rests on the code plus that pattern, not a controlled A/B.
4. **Overlay shares the renderer's mask size.** `whole-image-preview-pipe.js` lets the mask overlay use the renderer's edge up to 3200 px, so its request joins the renderer's compile instead of starting a near-duplicate.
5. **Option A: threaded brush rasterizer.** `_brush_masks` and the brush's pixel-metric conversion split frames of 16 MP and above into row bands on worker threads (`_over_row_bands`). Every pixel gets the same float32 operations in the same order. Against the committed rasterizer it is byte-identical on all three fixture brushes at 7,362 px, 1,606 px and a rotated 3,000 px grid, with and without an erase stroke. Main-brush native raster: 4,139 ms to 1,001 ms. Smaller frames stay single-threaded because a 6 MP raster measured about twice as slow threaded.
6. **Option B: reduced-resolution feather for painted masks.** Owner-approved on October 1 with a tolerance of 2 of 255 mask levels in place of byte identity. When the feather is at least 32 px wide (sigma), `_feather_mask` blurs block means instead of the full frame (`_gaussian_blur_reduced`) and interpolates back; the block size keeps the feather at least 16 coarse pixels wide and is capped at 32. Luminance-range masks and narrower feathers keep the full-resolution blur. Unfeathered masks are unchanged and byte-identical.

How B stays inside the tolerance, and what did not work:

- **Strokes are still painted at full resolution.** The first version painted them on the coarse grid too (the 0.38 s prototype). Fuzzing showed up to 13 levels of error for small marks and strokes at the frame edge: the feather rescales its result to the painted peak, so any error in painted area is multiplied across the whole mask. That variant was dropped; A is what makes the full-resolution paint affordable.
- **Each coarse pass is a box of exact fractional width**, solved so the six passes reproduce the full passes' spread after allowing for the spread that block averaging and interpolation add. Whole-pixel boxes on the coarse grid were up to 0.6% off in width, which the peak rescale turned into several levels.
- **The frame-edge pixel values are carried through every pass.** The full blur repeats the outermost pixel as padding on each pass. Inferring that pixel from the edge block was up to 10 levels off for hard marks against the frame edge; tracking it explicitly, with the true top and bottom rows riding through the horizontal passes, removed the error.

### 14.3 Measurements

Isolated compile of each project mask, committed code against the working tree, cropped project geometry:

| Mask | Edge | Before ms | After ms | Largest difference |
|---|---:|---:|---:|---|
| Main brush, 34 strokes, feathered | 7,362 | 7,255 | 1,726 | 1 level, on 1.7% of pixels |
| Second brush, 3 strokes, feathered | 7,362 | 4,304 | 1,141 | 1 level, on 1.7% of pixels |
| Unfeathered brush, 14 strokes | 7,362 | 999 | 603 | identical |
| Main brush | 1,606 | 215 | 113 | 1 level, on 0.6% of pixels |
| Second brush | 1,606 | 169 | 97 | 1 level, on 1.5% of pixels |
| Gradient and luminance masks | both | unchanged | unchanged | identical |

Accuracy of B beyond the fixture: 500 randomized brush masks over four seeds (soft, hard-edged, small, large, frame-edge, pressure-varying, erased, inverted and Shift Edge strokes; four frame sizes; straightened and flipped grids) all came within 1 level of the full-resolution feather. Finished frames of the heavy project rendered both ways differ by at most 1 SDR 8-bit level (0.3% of pixels at 1,606 px, 0.7% at 3,200 px) and at most 0.022 stops in HDR.

Heavy-project fresh-work replay in Electron (2560 x 1440, DPR 1, disposable profile, project never saved), 5 minutes and 25 cycles, against the first 25 cycles of the October 1 endurance run. One run per condition; the earlier run is from a different process and cache history, so treat these as directional:

| Operation | Before median / p95 / max ms | After median / p95 / max ms |
|---|---|---|
| Zoom to 100% | 8,256 / 9,966 / 10,791 | 2,288 / 2,597 / 5,241 |
| Fresh brush stroke, HDR | 488 / 563 / 745 | 243 / 362 / 524 |
| Fresh brush stroke, SDR | 453 / 592 / 630 | 239 / 371 / 387 |
| Feather release to exact, HDR | 383 / 425 / 469 | 170 / 229 / 442 |
| Feather release to exact, SDR | 380 / 423 / 425 | 172 / 330 / 334 |
| Return to Fit | 195 / 405 / 442 | 173 / 353 / 622 |
| Lane switch, SDR | 66 / 85 / 103 | 59 / 63 / 64 |
| Match | 9,610 / 10,594 / 10,594 | 9,240 / 10,194 / 10,194 |

In that replay no operation compiled the same mask at two sizes (before: 100 of 122), and masks nobody edited were compiled at native once each (before: 14 recompiles in the same span). The replay completed with no page errors. Artifact: `output/performance/review/rootcause-2026-10-01/short-after.json`. The Fit maximum rose from 442 to 622 ms on one sample and was not investigated.

### 14.4 Test status

- Python: 1,547 pass. One fails and predates this pass: `test_frontend_inventory_contract.py` expects 105 frontend contract tests and finds 106 in files this pass did not touch.
- Node: 318 pass. One fails and predates this pass: `webgpu-shaders.test.js` holds a byte hash for `SHADER_SOURCE` that no longer matches the committed shader file.
- Electron: `full-tier-brush-feather.js` and `local-adjustments-interaction.js` pass. `brush-mask-interaction.js` fails its live-Feather-versus-settled-mask comparison; it fails identically with this pass's changes set aside (the overlay canvas changes width between the test's two captures), so it also predates this pass.
- New tests: a real-socket abort through the desktop boundary; abandoned owner with and without a waiter; finished-mask caching; identity-based obsolescence; mask flights surviving grade edits; eviction order and budget; overlay edge sharing; threaded raster byte identity and cancellation; reduced feather within 2 levels on the cases that broke earlier attempts.

### 14.5 Not done, and open risks

- **No 30-minute endurance run.** The identity-based cancellation and flight sharing change behaviour the September 30 scheduling measurements relied on. The 5-minute replay is clean, but memory residency and long-session tails are unmeasured.
- **Native zoom is 2.3 s, not sub-second.** What remains is the full-resolution paint (about 1 s threaded), the geometry step and transport. Getting lower needs either painting at reduced resolution under a stated tolerance for small and edge marks, or the GPU; both wait on the tolerance and architecture decisions noted in the main PRD (section 11d).
- **Match** is unchanged. Rendering independent candidates in parallel measured 1.48 s to 0.50 s for six candidates with identical pixels and is the suggested next step.
- Parity baselines that hash feathered brush masks byte-for-byte, if any exist outside the suites run here, will need the 2-level tolerance.
- The repeated tile-batch fetches after a native zoom's exact frame (about 35 MB per local, several times) were noticed and not investigated.
- The three pre-existing test failures above are not fixed.
