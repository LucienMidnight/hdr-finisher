# Performance Review Baseline — Heavy Project and Resumed Module Measurements

**Captured:** September 30, 2026  
**Status:** Scoped native-drag pass and one 30-minute endurance attempt complete; wider measurement/correlation gates remain open  
**Sprint:** [GPU Performance Review Sprint](../../product/GPU_Performance_Review_Sprint_PRD_2026-09-29.md)  
**Revision:** `a320d3cfd66643bf92c6e8b0677563b2bef92deb` on `main`, dirty because the measurement harness and sprint document were uncommitted  
**Policy:** Measurement only. The source project was opened through a desktop grant, was not saved, and the disposable Electron process was killed after capture.

## Current result

**Later targeted changes:** Steve authorized optimization before closing the wider measurement gates. [The first targeted pass](high-impact-performance-changes-2026-09-30.md) records brush rasterization and post-Match recovery changes with separate before/after evidence. All measurements below remain the earlier baseline; they must not be silently pooled with the changed implementation. The original stall was reported during approximately 30 minutes of active editing, definitely within one hour.

The strongest measured slowdowns are CPU/backend dependencies and eligibility boundaries, not a demonstrated GPU device error: Match approximately 17–23 seconds, first Exact Peak enable about 20.6 seconds, and non-neutral local luma curves about 25–32 seconds through settled scopes. Ordinary supported control commits mostly settle below 150 ms at the median. The half-VRAM Auto budget is correct; the original minutes-long mature-session stall remains unreproduced.

The completed automatic-anchor endurance attempt adds native-zoom tasks up to 56,113 ms, SDR brush-feather release tails up to 22,125 ms, and nominal 500-ms exposure gestures stretching to 26,897 ms. Backend working set peaked at 23.53 GiB; registered GPU allocations approached but did not exceed the half-VRAM budget at checkpoints. These are measured pressure/backpressure signals, not a diagnosed GPU failure.

## Initial runs 01–03

Three clean-process reproductions found no GPU device error or VRAM-budget breach. Match took 17.02–22.59 seconds, dominated by an 11.79–16.17-second backend Match request followed by a 5.11–6.29-second CPU SDR preview, while accepted WebGPU work was approximately 30–46 ms per 1,606-pixel exact frame. Run 03 also found native-edge CPU mask compilation from a background canonical highlight measurement overlapping Match.

## Fixture and environment

| Item | Value |
|---|---|
| Saved project | `D:\Photos\Play_Raw\Fantastic light over village - AdamFromCanada\DSC00950.hdrfinisher` |
| Project size / SHA-256 | 11,560 bytes / `246BA308DCBA22C5483C32ED4C31F5C81A2804504CD01DEC2482B6D5BE307D56` |
| RAW source | `DSC00950.ARW` |
| RAW size / SHA-256 | 36,667,392 bytes / `91762691CBA4B6653848EEF8DEEBF30D956BAB9B7C44192272FC008BA9E4B5E4` |
| CPU | AMD Ryzen 5 7600, 6 cores / 12 logical processors |
| System RAM | 67,823,108,096 bytes |
| GPU | NVIDIA Lovelace WebGPU adapter, timestamp queries available, non-fallback |
| Power / viewport | AC / 2560×1440 |
| Visible exact target | 1,606-pixel processing edge; 1,006×1,005 cropped output |

The raw JSON files are intentionally disposable and ignored by Git:

`ai/codebase/output/performance/review/2026-09-30-heavy-project-run-01.json`

`ai/codebase/output/performance/review/2026-09-30-heavy-project-run-02.json`

`ai/codebase/output/performance/review/2026-09-30-heavy-project-run-03.json`

Command:

```powershell
node tests/run-in-electron.js tests/performance/heavy-project-baseline.js --project "D:\Photos\Play_Raw\Fantastic light over village - AdamFromCanada\DSC00950.hdrfinisher" --output output/performance/review/2026-09-30-heavy-project-run-01.json
```

## End-to-end timings

| Operation | Task/exact completion | Preview event latency | Scope event latency | Sample interpretation |
|---|---:|---:|---:|---|
| Open mature project | 14,266.6 ms | 9,905.4 and 14,265.5 ms | 8,258.6 and 10,229.6 ms | Fresh disposable process |
| First HDR → SDR switch | 144.6 ms | 24.7 ms | 142.5 ms | First switch after open |
| Warm SDR → HDR switch | 120.7 ms | 19.0 ms | 114.2 ms | Same process and graph |
| Warm HDR exposure edit | 325.2 ms | 156.5 ms | 293.0 ms | +0.05 EV representative pointwise edit |
| Exposure restore | 142.8 ms | 57.9 ms | 139.7 ms | Restored original value |
| Match entire HDR grade | 22,591.9 ms | 16,334.0 and 22,492.2 ms | three events; final 22,579.9 ms | Controlled in-memory Match; project not saved |

These are individual observations. They do not support p95 claims.

### Runs 02–03 repeat

| Operation | Run 01 | Run 02 | Run 02 preview / scopes |
|---|---:|---:|---|
| Open mature project | 14,266.6 ms | 9,931.6 ms | 6,628.2 ms first preview; 5,234.5 ms scope event |
| First HDR → SDR switch | 144.6 ms | 113.0 ms | 20.1 / 110.6 ms |
| Warm SDR → HDR switch | 120.7 ms | 117.4 ms | 20.0 / 115.5 ms |
| Warm HDR exposure edit | 325.2 ms | 116.3 ms | 40.1 / 113.6 ms |
| Exposure restore | 142.8 ms | 157.8 ms | 46.9 / 153.7 ms |
| Match entire HDR grade | 22,591.9 ms | 18,104.1 ms | 13,470.6 ms first preview; 18,095.5 ms final scopes |

Run 03 measured 10,230.1 ms project open, 112.6 ms HDR→SDR, 130.9 ms SDR→HDR, 117.7 ms exposure edit, 151.8 ms restore, and 17,015.3 ms Match. Across the three Match runs, the median was 18,104.1 ms. This completes the sprint's initial three controlled samples, but it is still too small for a reliable p95.

## Match decomposition

| Stage/evidence | Measured duration | Interpretation |
|---|---:|---|
| `POST /sdr-match` | 16,168 ms | Backend CPU analysis/fitting and document result dominate the first portion. Internal candidate-pass stage timings are not yet emitted. |
| First post-Match SDR WebGPU presentation | about 16,334 ms from start | First new SDR frame appeared shortly after the backend response. |
| `GET /proxy-stream/sdr?long_edge=7362...` | 185 ms | Run 01 requested an unexpected native-ish source after Match; the visible exact target remained 1,606 pixels. Run 02 requested this edge during the SDR preparation immediately before Match, not inside Match. |
| `POST /preview/sdr` | 6,292 ms | CPU whole-preview request accounts for nearly all remaining wall time. |
| Final exact SDR WebGPU presentation | about 22,492 ms from start | Second exact frame followed the CPU request. |
| Final settled scopes | 22,579.9 ms from start | User-visible completion milestone. |

Across runs 01–03, `/sdr-match` ranged from 11,787 to 16,168 ms (median 12,509), and `/preview/sdr` ranged from 5,106 to 6,292 ms (median 5,472). Run 03 captured the CPU preview request body and confirmed `long_edge: 1606`; the fallback itself was not accidentally rendering the 7,362-pixel native edge.

The GPU stage trace records `render-refused` with reason `peak:newer-render-started` near the handoff from Match to presentation. It is plausible that competing refinement/peak work caused the CPU fallback, but these runs do not establish causality. A cross-layer operation/generation ID is still required.

Code inspection explains why this race can be expensive without yet proving which concurrent render owns it. `setSdrMatch()` directly calls `renderGpuDraft()` and, for any false result, immediately calls `renderPreviewForLane()`. The ordinary `settlePreview()` path treats `peak:newer-render-started` as transient, can retry the GPU, and explicitly avoids a CPU fallback for transient refusals. Match does not use that transient-refusal guard. This is a measured-path hypothesis for a later optimization review, not authorization to change routing before the trace has a cross-layer operation ID.

### Native highlight-anchor overlap

Run 03 correlated the 7,362-pixel work to `measureExactHighlightAnchor()`, not to the 1,606-pixel visible preview. When highlight compression uses automatic maximum measurement, a display render requests one canonical native finished-image reduction. The app launches a tiled, `measureOnly` WebGPU render at `previewTargetLongEdge("full")` and includes every active local adjustment. GPU execution is tiled, but non-analytic masks are compiled as whole-image arrays by the CPU backend before bounded tiles cross to the browser.

Two 7,362-pixel local-mask batch requests started in the 128 ms pre-Match SDR switch and remained active for 13,158–13,159 ms. They overlapped nearly all of the subsequent 11,787 ms `/sdr-match`. After Match returned, six additional 7,362-pixel mask batches were launched; completed examples took 183, 217, 1,308, and 1,404 ms, with two still pending when capture ended. The visible CPU `/preview/sdr` ran at 1,606 pixels for 5,106 ms in parallel with part of that mask work.

This explains both why native-scale CPU work appears during a zoomed-out exact preview and why a nominally GPU measurement can raise backend RSS. It does not yet prove how much faster Match would be without overlap; that requires a controlled negative comparison after the measurement plan approves one.

## GPU execution and memory

Recent exact 1,606-pixel WebGPU frames recorded 30.21–40.63 ms GPU execution and 38.5–48.9 ms queue completion in the warm portion of the run. The initial project frame had roughly 31.46 ms GPU execution but approximately 2,075 ms queue completion and 215.9 ms encode/submit, showing why total frame latency cannot be inferred from shader time alone.

| GPU state | After project open | After Match |
|---|---:|---:|
| Logical resident bytes | 290,836,120 | 561,085,736 |
| Allocator registered bytes | 224,535,000 | 493,993,720 |
| Allocator entries | 10 | 237 |
| Auto budget | 6,439,305,216 | 6,439,305,216 |
| Evictions / over-budget bytes | 0 / 0 | 0 / 0 |

After Match, registered allocation consisted of:

| Kind | Entries | Bytes |
|---|---:|---:|
| Source proxy | 4 | 355,915,104 |
| Mask tile | 226 | 99,589,408 |
| Tile graph | 1 | 26,356,800 |
| Local mask | 5 | 10,110,348 |
| Scene luminance | 1 | 2,022,060 |

All fresh runs used only a small fraction of the intended half-VRAM budget. Runs 02 and 03 finished with 465,256,920 registered bytes across 173 entries; run 03 logical residency was 532,348,936 bytes. Run 03 board-wide NVIDIA use stayed between 2,076 and 2,350 MiB on a 12,282 MiB card. None reproduced the earlier mature-session snapshot of about 4.66 GiB logical residency and 3,913 allocator entries; that remains an endurance/replay target rather than a dismissed observation.

## Process working-set evidence from run 02

The enhanced runner located the Electron process tree, including the Python backend sidecar, and took snapshots outside each measured interval.

| Snapshot after operation | Process-tree working set | Largest backend Python working set | Electron GPU-process working set |
|---|---:|---:|---:|
| Open mature project | 3,132,334,080 | 2,079,055,872 | 554,844,160 |
| First HDR → SDR switch | 3,182,522,368 | 1,930,743,808 | 727,089,152 |
| Warm SDR → HDR switch | 3,492,990,976 | 2,233,016,320 | 726,822,912 |
| Warm exposure edit | 4,548,743,168 | 3,286,777,856 | 723,566,592 |
| Exposure restore | 5,514,555,392 | 4,351,746,048 | 647,294,976 |
| Match | 3,097,055,232 | 1,978,224,640 | 499,150,848 |

Run 03 repeated the shape: 5,365,112,832 tree bytes and 4,174,790,656 backend bytes after exposure restore, falling to 3,062,484,992 and 1,980,030,976 after Match.

The backend working set grew by more than 2 GiB across two small pointwise edits even though the logical GPU allocator remained well below budget, then dropped after Match. Point snapshots cannot distinguish live arrays from allocator high-water behavior or determine the true peak. This is nevertheless a stronger CPU-memory lead than a GPU-capacity explanation for the clean-session slowdown.

## Backend cache evidence

After Match, backend diagnostics reported 944,839,309 managed bytes across 24 entries: 434,652,480 source bytes, 455,331,336 proxy bytes, and 54,855,493 local-mask bytes. There were 13 hits, 26 misses, 10 evictions, 9 single-flight waits, one stale cancellation, and one in-flight item.

Source-mip diagnostics recorded five cold builds totaling 2,053.35 ms (410.67 ms mean), ten memory hits, no disk hits, and no failures. Memory and disk source-mip stores each contained five entries totaling about 55.43 MB.

## Findings to carry forward

1. No evidence in this run supports a WebGPU device error, fallback adapter, allocator pressure, or a failure of the half-VRAM Auto policy.
2. Match is presently the clearest bottleneck in this fixture. Backend Match plus the CPU preview explain almost the entire 17.02–22.59-second wait.
3. The final WebGPU Direct renders are fast relative to the task wall time; dependencies, routing, and competing generations deserve measurement before shader optimization.
4. The 7,362-pixel work is the canonical highlight-anchor measurement. With locals active, it triggers CPU whole-mask compilation and can outlive a fast visible lane switch, overlapping the next user task.
5. The Match GPU call has repeatedly lost a peak-measurement race and fallen directly into a 5.11–6.29 second CPU preview path; the ordinary settle path handles the same refusal class as transient.
6. Scope settling materially trails the first presented frame in ordinary edits and defines the final Match completion milestone.
7. The fresh process cannot explain the earlier multi-hour memory state. A scripted mature-session replay with OS RSS and whole-board VRAM sampling is still needed.

## Measurement defects and limits

- Some existing `submitToPresentMs` samples are negative. The presentation callback uses an animation-frame timestamp that can predate submission within the same frame, so those values are invalid and excluded.
- Run 01 had no per-operation network grouping and no point-in-time process-tree RSS. Run 02 captured both.
- A whole-board VRAM number includes the desktop compositor and other applications; it must not be treated as app-attributed use.
- Point-in-time working set is not peak RSS. A low-overhead time-series sampler is still needed for peaks.
- The Match backend exposes only its total request time here; semantic translation, candidate count, fitting, and quality evaluation remain aggregated.

## Next measurement sequence

1. Add repeated warm pointwise samples without repeating Match, followed by spatial/detail representatives.
2. Capture response-level CPU mask time and payload counts for the native anchor batches.
3. Add RAW import stage capture using a temporary session.
4. Build the shortened mature-session replay needed to reproduce or bound the high-residency screenshot session.
5. Add a controlled negative comparison for overlapping canonical-anchor work only after the measurement review authorizes it.

The static control inventory is available from `tests/performance/control-inventory.js`; it currently classifies all 147 fixed `data-path` controls with no duplicates or unclassified paths. It also lists the dynamic control families that require purpose-built drivers.

No performance changes are proposed by this baseline.

## Resumed Electron measurements — September 30

GPU-capable Electron runs succeeded when launched with full process access outside the restricted execution environment. Earlier GPU-subprocess launch failures therefore do not establish a driver/device failure in the application. All runs below use disposable profiles and do not save the source project.

Raw evidence is under `ai/codebase/output/performance/review/`. Percentiles use the sorted sample at `floor((n - 1) * fraction)`; with ten samples this is a descriptive p95, not a precise tail estimate. Commit-path measurements include automation dispatch and observation overhead; they are not continuous-pointer-drag measurements.

| Completed batch | File | Coverage | Median range, ms | Largest sample, ms |
|---|---|---|---:|---:|
| Pointwise | `2026-09-30-pointwise-electron-10.json` | 26 HDR/SDR module-family rows × 10 | 52.8–76.3 | 249.5 |
| Spatial/detail/film | `2026-09-30-spatial-electron-10.json` | 18 HDR/SDR rows × 10 | 49.7–78.6 | 252.8 |
| Curves and dynamic exposure bands | `2026-09-30-dynamic-electron-10.json` | 10 HDR/SDR rows × 10 | 73.6–109.6 | 285.3 |
| Local grades and masks | `2026-09-30-locals-electron-10.json` | 5 rows × 10; brush grades both lanes, mask edits HDR | 90.5–136.5 | 729.2 |
| Structural/highlight/overlay/geometry | `2026-09-30-structure-electron-10.json` | 9 rows × 10; mixed endpoints below | 18.7–139.2 | 3,713.6 |

Structural results: highlight softness HDR/SDR medians 53.7/56.5 ms; peak detail 61.6/48.6 ms; exposure-band smoothing 54.2 ms. Geometry straighten and ratio commit medians were 139.2 and 131.8 ms, with maxima 1,308.8 and 611.5 ms. Overlay opacity measured compositor feedback at 18.7 ms median; overlay mode alternated enable and off, yielding a misleading pooled 36.8 ms median but 3,689.9 ms descriptive p95 and 3,713.6 ms maximum. Split directions before drawing conclusions: off is immediate compositing; enable waits for backend-backed settled overlay state.

Ordinary static pointwise/spatial tests pin automatic highlight anchoring to Manual to isolate control processing. Dynamic/local tests retain fixture anchoring and must not be pooled with the isolated samples. Local gradient/luminance tests retain fixture geometry; their labels do not claim an analytic GPU mask route. Individual GPU-tail records retain route and render details, but operation IDs and scope-stage decomposition remain incomplete.

### Electron Match phase split

`2026-09-30-electron-resume.json` captured open at 12,295.7 ms and Match through settled scopes at 20,339.6 ms. The backend Match request took 14,766 ms, followed by a 5,425 ms CPU SDR-preview request. The response timing header splits the backend work:

| Stage | ms | Candidate renders |
|---|---:|---:|
| Source proxy | 480.212 | — |
| Settled HDR | 1,081.957 | — |
| Target build | 19.497 | — |
| Semantic translation | 531.880 | — |
| Neutral tonal fit | 1,025.515 | — |
| Exposure refinement | 9,814.150 | 9; render subtotal 9,376.110 ms |
| Base candidate | 817.685 | 1; render subtotal 789.967 ms |
| Tone equalizer merge | 939.765 | 1; render subtotal 877.626 ms |
| Document commit | 22.782 | — |
| Whole backend request | 14,756.391 | analysis edge 768 |

Candidate render subtotals are nested inside their stages, not additive. Materialization total was 13,156.512 ms. Semantic-control fitting and RGB/luma refinement were effectively skipped in this fixture. Exposure refinement is the largest measured backend component; this is a finding, not authorization to change it.

### Measurement corrections and exclusions

- Presentation instrumentation now records `performance.now()` inside the animation-frame callback and stores the frame timestamp separately. Earlier negative submission-to-presentation values remain excluded; rendering behavior is unchanged.
- Exploratory Edge dynamic/local/denoise timings included a fixed 75 ms delay and insufficient fresh-event checks; they are excluded from the Electron baseline. The corrected dynamic harness waits for a new current-lane/current-generation preview plus a new scope event and puts pacing outside the timed interval.
- The interrupted Edge structural run waited for a scope event when switching an overlay off; that is a harness defect, not evidence of an application hang. Overlay measurements now wait for matching settled overlay state when enabled; off/opacity transitions use compositor feedback. These distinct endpoints must remain explicit.
- Earlier Edge Fit/100% times included preparation within the timed interval and are excluded. Pan compositor feedback does not establish completion of any deferred rendering.
- The first corrected Electron denoise attempt timed out on the first live-control sample waiting for preview/scope events. No denoise latency row is claimed. The live update is now awaited, and future timeouts persist state and events for diagnosis.

### Fresh-process RAW import

Evidence: `2026-09-30-raw-electron-cold-{1,2,3}.json`; three separate Electron launches and backend processes, one import each. The generic file's sample-class text describes a single-backend driver; these particular commands supply true process-cold repetitions (OS filesystem cache was not flushed).

| Milestone | Run 1 ms | Run 2 ms | Run 3 ms |
|---|---:|---:|---:|
| Backend source ready, phase timestamp | 2,811 | 2,765 | 2,734 |
| First/exact HDR presentation | 3,467.0 | 3,427.0 | 3,309.5 |
| Settled scopes | 4,988.4 | 4,959.9 | 4,829.4 |
| Task observation complete | 4,997.1 | 4,966.4 | 4,835.5 |

CPU RAW development/demosaic took 1,703–1,750 ms, primary color conversion 250–267 ms, lens correction 62–63 ms, source analysis 609–625 ms, metadata 15–31 ms, and session indexing 16–31 ms. Zero-length notification phases are not separate measured work. The polled ready totals (2,781–2,890 ms) include polling tail; use the phase timestamps above for backend work.

Final presentation was Direct WebGPU at 1,504 px from the 7,362 × 4,920 source. Timestamp-query GPU execution measured 2.95–3.21 ms; source proxy wait was 482–518 ms. Scope map/readback elapsed 1,482–1,496 ms, with 7.4–8.0 ms unpacking. Queue completion was 1,485–1,499 ms. These waits overlap and are not additive or pure GPU execution. Their cold-start delay is a separate follow-up measurement target.

Reproduction command, run independently with a different output filename three times:

```powershell
node tests/run-in-electron.js tests/performance/raw-import-baseline.js --raw "D:\Photos\Play_Raw\Fantastic light over village - AdamFromCanada\DSC00950.ARW" --samples 1 --output output/performance/review/2026-09-30-raw-electron-cold-1.json
```

### Short memory-sampled replay

Evidence: `2026-09-30-memory-replay-electron.json`, produced by the baseline driver with `--replay-cycles 3`. Open → lane switches → exposure edits → Match → three HDR/SDR switch/edit cycles completed, with 61 approximately one-second OS samples and no sampler errors. This is a short cache-growth probe, not a recreation of a multi-hour session. Per-operation process snapshots and time-series sampling introduce overhead and make these results unsuitable for pooling with isolated control sweeps.

- Peak sampled Electron-tree working set: 5,916,221,440 bytes (5.51 GiB).
- Peak sampled Python working set: 4,742,438,912 bytes (4.42 GiB).
- Peak whole-board VRAM: 5,268 MiB, including desktop/other applications; not app-attributed.
- Final GPU registered allocation: 2,140,475,608 bytes across 2,766 entries; no evictions or over-budget bytes.
- Final logical residency: 2,207,567,624 bytes. Dominant caches: 2,431 mask tiles (1,066,594,048 bytes) and 324 detail-band tiles (679,477,248 bytes).
- Configured Auto budget remained 6,439,305,216 bytes. NVIDIA non-fallback adapter and timestamp queries remained available.
- Match settled in 17,367.5 ms. The original minutes-long stall and 14.49 GiB backend state were not reproduced.

The replay does reproduce substantial tile-entry growth without exhausting the budget. It does not yet establish whether this growth plateaus, improves latency, or accumulates over a longer spatial/local workflow.

### Remaining baseline gates (updated)

The baseline is **not complete**. Still required: remaining module-family and trusted-drag coverage; lane coverage for applicable local masks; scope region and authoritative overlay readiness; a longer spatial/local mature replay; and stronger operation correlation/stage decomposition. Fresh-process RAW, isolated denoise, viewer tasks and a short memory replay are now measured. The original minutes-long mature-session slowdown remains not reproduced.

### Denoise isolation

`2026-09-30-denoise-electron-manual.json` pins highlight anchoring to Manual, with initialization before the measured live-control interval. Live amount commits measured HDR median/p95/max 204.3/211.7/221.2 ms and SDR 203.0/210.5/242.2 ms, ten samples each. Three recalculation samples per lane measured HDR median/max 245.6/257.9 ms and SDR 233.8/236.5 ms; do not treat these as stable p95 estimates.

Diagnostics identify `adaptive-atrous-v1`, with GPU resolve dispatches and four tiles per reconstruction. The legacy wavelet `analysisDispatches` counter remains zero and cannot stand in for adaptive execution. This measures the native adaptive recalculation task, not a legacy wavelet analysis pass.

The automatic-fixture comparison (`2026-09-30-denoise-electron-diagnostic.json`) timed out waiting for a fresh preview after the first live edit, although denoise reported ready, controls amount 0.51, two resolves and two swaps. This is an event/presentation investigation, **not** a measured 120-second compute cost. Manual anchoring restores the expected events; causal refusal capture is still required before labeling the reason definitively.

### Viewer and scopes

`2026-09-30-viewer-electron-complete.json` completed all ten workflow rows. An earlier partial file stopped only because the Local Adjustments panel was collapsed; the harness now opens it before the button test.

| Task | Samples | Median ms | Maximum ms |
|---|---:|---:|---:|
| Histogram/waveform switch | 10 | 96.3 | 193.4 |
| Histogram/vectorscope switch | 10 | 29.4 | 41.6 |
| Composite/luma channel | 10 | 38.6 | 42.3 |
| Detailed/reference detail | 10 | 42.2 | 54.7 |
| Fit → 100% | 3 | 196.4 | 552.2 |
| 100% → Fit | 3 | 135.9 | 151.2 |
| Pan compositor feedback | 3 | 16.0 | 35.5 |
| Single/side-horizontal compare, mixed directions | 6 | 13.3 | 858.6 |
| Local-overlay compositor feedback | 10 | 38.1 | 488.8 |

Exact Peak first enable took **20,642.1 ms** in the completed run, repeating the earlier **20,601.0 ms** first enable. Later toggles in the same process were much faster. The pooled three-toggle median (57.3 ms) conceals this cold cost and must not be reported as peak-enable latency. Direction/cache class needs dedicated samples.

Fit processed 1,606 px; 100% accepted native edge 7,362 px. Warm zooms often reused scopes and emitted no new scope event, so zoom rows measure exact presentation plus existing settled state, not a fresh-scope computation. Compare mixes cache-restored single and rendered split layouts; split directions for interpretation. Pan and local overlay rows measure compositor feedback only, not deferred GPU/mask completion.

### Local curves: measured whole-preview CPU eligibility boundary

The expanded local-grade test completed WB, saturation and contrast-pivot rows in both lanes (ten each): medians 64.9–91.7 ms, largest sample 128.9 ms, and zero new local-mask requests across these 60 observations. Its first local-luma edit then settled on CPU/backend rather than WebGPU. That exploratory run accidentally selected the luminance-range local for its luma case; it is routing evidence, not a clean brush-curve latency baseline.

`2026-09-30-local-detail-opacity-electron-10.json` adds ten samples per lane for local detail and opacity with pre-row restoration. Detail medians HDR/SDR were 106.2/96.4 ms; opacity 104.9/94.3 ms. The maximum across these rows was 143.3 ms. Mask-request and route evidence are retained per observation. Network reuse is evidence of no new mask transport; it does not by itself exclude in-process GPU mask computation.

The corrected brush case, `2026-09-30-local-curves-electron-3.json`, observes CPU acceptance plus the following animation-frame callback in the disposable test process. It does not change product routing. Three alternating edits mix two non-neutral CPU renders and one restored-neutral GPU render; **do not pool them as a uniform slider median**.

| Brush local luma state | HDR preview / settled ms | SDR preview / settled ms | Accepted route |
|---|---:|---:|---|
| First non-neutral edit | 30,506.0 / 31,754.5 | 23,801.0 / 25,085.7 | CPU AVIF / CPU PNG |
| Restore neutral curve | 9.2 / 166.0 | 8.3 / 125.5 | WebGPU Direct |
| Second non-neutral edit | 24,691.5 / 25,928.8 | 23,742.9 / 25,022.7 | CPU AVIF / CPU PNG |

The four CPU samples each started **21 preview requests**; only one finished-preview request was captured per observation in this harness version. Failed/aborted requests were not yet logged, so the remainder must not be presumed completed CPU work or summed. The completed HDR requests took 10,945 and 5,211 ms; SDR 4,470 and 3,775 ms. Task wall time is substantially longer than that final request, warranting scheduler/cancellation correlation. Future runs also capture request failures.

Code evidence: `gpuPreviewEligible` requires every active local to pass `supportsLocalAdjustments`; `gpuLocalSupported` rejects non-neutral local curves and non-neutral color-grading wheels, balance or blending. Thus one such local can route the **whole lane preview** to CPU. No shader/device error is required. This is an explicit support boundary, not yet classified as an implementation bug or optimization proposal. The benchmark introduced these non-neutral local curves; it does not prove that this boundary caused the original saved-fixture stall.

The three-sample curve exploration leaves a non-neutral luma curve in the disposable session before later RGB rows, so those RGB rows are compound unsupported-graph measurements, not isolated RGB costs. The driver now restores the selected local to its pre-row baseline between rows. Ten homogeneous CPU warm samples and isolated grading-wheel measurements remain open.

### Native-drag and endurance measurement protocol

The continuation adds `heavy-project-review-common.js`, `heavy-project-drag-review.js`, `heavy-project-long-session.js`, and the read-only `summarize-review.js`. These are disposable test drivers, not renderer or fallback changes.

The drag driver schedules 12 native pointer moves over nominal 500 ms. Actual browser timestamps capture the longer real gesture, including input pacing and host round trips. `inputToFirstFrameMs` starts at the first input/invalidation; `gestureToFirstFrameMs` includes initial pointer positioning and the canvas drag threshold. The application generates synthetic input/change events inside its custom instrument controls, but the originating pointer sequence must be trusted and an edit must be verified. Native overlapping luma thumbs are handled separately from enhanced rails.

Release completion requires a settled scheduler scope callback at the current lane/application generation, followed by ready, exact, correct-edge presentation and a non-updating scope. A zero release-to-exact value means that the final exact frame was already accepted during the drag; it is not zero GPU compute time. A missing fresh scope event remains null rather than being invented; scope-callback completion/reuse and observed stable state are retained separately. Canvas, wheel and coordinate-handle rows also verify actual invalidations. Geometry records two-rAF draft compositor feedback separately from Apply-to-ready/exact; that draft observation is not authoritative resampling completion.

The isolated sweep pins highlight anchoring to Manual and explicitly enables the fixture's bypassed Color and Color Grading modules outside the clock. Other measured recipes are captured per row. Native sliders can clamp values beyond their UI range (the original HDR lift is -1 while its rail minimum is -0.5); model and rail before/after values are retained. This is a disposable perturbed grade, not a source-file change. Cache state is **not** guaranteed cold on the first interaction in a row, and alternating warm observations cannot substitute for cold-cache replication.

Interpretation correction: the earlier pointwise **commit** driver preserved the fixture's disabled Color and Color Grading sections. Those rows measure editing/scheduling with those sections bypassed, not active Color/Wheel processing. They remain valid route/interaction observations but must not be used as enabled-module GPU-cost baselines. The new native-drag pass explicitly distinguishes this preparation.

The endurance driver instead retains the source's automatic anchors. Its active duration is at least 30 minutes, finishing the in-progress cycle, followed by two minutes idle. Cycles exercise both lanes' exposure/detail/brush feather, 100% zoom, pan, Fit, and Match on cycle 1 and every fifth cycle. Each cycle retains registered allocator/by-kind/logical memory and failure-policy snapshots; process working set/private bytes and whole-board VRAM are sampled at nominal one-second cadence. Sampling is not app-attributed physical VRAM, exact peak allocation tracing, or a backend cache ownership census. `X-CPU-Mask-Ms` is backend operation wall time including cache/wait work, not isolated CPU execution time; overlapping requests must not be summed.

The running endurance attempt was launched before the final drag-only timestamp refinements. Its `inputToFirstFrameMs` is gesture-start-to-first-frame; use the nested drag's release metrics and total task times for interpretation. Later drag artifacts use the refined input/invalidation origin. No benchmark processes run concurrently on the GPU.

**Display-placement correction:** Steve reported that the first full drag attempt and the isolated red-curve retry initially straddled an HDR and an SDR monitor; he moved both onto the HDR monitor during their runs. The exact intervention timestamps were not captured. Retain their release measurements as exploratory coverage, but do not treat them as controlled cross-display latency baselines. Steve confirmed HDR is the Windows primary display. Subsequent runs opt into `HDR_FINISHER_REVIEW_PRIMARY_DISPLAY=1`, clamp the disposable window wholly inside that display's work area, and retain display inventory, window bounds, actual CSS viewport and device-pixel ratio. Primary-display placement does not itself verify Windows HDR/color-management state. Earlier endurance display containment was not recorded and must not be assumed.

The initial ten-sample drag attempt completed 20 rows and six red-curve observations before a strict settled-scope-callback wait timed out at 180 seconds. Its diagnostic showed a ready, exact WebGPU presentation, so this timeout is **not** evidence of a 180-second GPU render or reproduction of the reported stall. Keep the failed artifact; exclude its incomplete red-curve row from the ten-sample ledger. A fresh isolated retry completed ten red-curve drags in each lane. The helper now correlates first feedback to at least the first invalidated application generation and retains both generations. Initial full-attempt first-feedback fields lack that guard and are exploratory only; release metrics already require final-generation exact presentation and settled scopes.

### Completed fixed-display native-drag coverage

Two disjoint completed artifacts form the controlled ledger: `2026-09-30-drag-remaining-electron-10.json` (45 rows / 450 observations) and `2026-09-30-drag-fixed-display-retry-electron-10.json` (22 rows / 220 observations). Together: **67 unique representative rows × ten = 670 verified native drags**, no page errors, minimum 15 trusted pointer events per observation, all final presentations WebGPU at processing edge 1,606. Neither initial repositioned artifact nor the incomplete curve row is pooled into this ledger.

Both recorded primary display `3850099094` / Mi Monitor, bounds `(0,0,2560,1440)`, CSS viewport 2560×1440, DPR 1. Actual gestures ranged **593.3–1,020.5 ms**, not the nominal 500 ms. Manual highlight anchors isolate this pass; enabled Color/Color Grading and per-row recipes are retained. The two disposable sessions have different edit histories: paired lanes are representative workload observations, not identical-state lane comparisons. This closes the requested representative drag pass, **not all 147 sliders or every boundary/cache/stage distinction**.

All values below are milliseconds; n=10 per populated lane. Release means pointer-up → observed ready/exact/matching non-updating scopes after the settled callback. First feedback is application presentation/rAF observation correlated to the first invalidated generation, not GPU completion or physical scanout. Nearest-rank p95 at n=10 is the maximum.

| Representative drag | HDR release median / p95 | SDR release median / p95 | First feedback median HDR / SDR |
|---|---:|---:|---:|
| Exposure | 107.2 / 139.1 | 45.9 / 69.1 | 16.0 / 12.3 |
| Contrast pivot | 102.9 / 119.4 | 47.8 / 89.0 | 10.4 / 7.6 |
| Lift | 71.2 / 97.9 | 58.4 / 63.9 | 7.1 / 9.1 |
| Lift range | 49.6 / 96.3 | 49.5 / 64.2 | 7.0 / 8.2 |
| Saturation | 66.8 / 100.9 | 53.2 / 64.0 | 9.1 / 10.7 |
| White balance Kelvin | 76.0 / 96.8 | 59.7 / 66.9 | 7.6 / 8.1 |
| Color Grading blending | 62.5 / 107.0 | 46.0 / 67.1 | 8.1 / 8.5 |
| Black & White reds | 64.4 / 108.8 | 55.9 / 71.0 | 9.2 / 9.7 |
| Vignette amount | 62.4 / 108.6 | 60.3 / 65.2 | 10.2 / 9.9 |
| Vignette feather | 93.2 / 101.2 | 46.5 / 65.0 | 8.7 / 9.1 |
| Film look strength | 61.0 / 104.4 | 46.4 / 63.5 | 16.5 / 11.9 |
| Film red response | 63.3 / 98.9 | 59.9 / 68.2 | 11.2 / 10.7 |
| Clarity amount | 77.8 / 107.0 | 51.9 / 73.5 | 11.8 / 11.6 |
| Microcontrast | 63.7 / 98.7 | 47.0 / 65.5 | 11.2 / 11.6 |
| Halation radius | 89.0 / 104.8 | 56.9 / 67.2 | 10.9 / 11.0 |
| Bloom radius | 75.8 / 103.0 | 62.2 / 81.1 | 11.9 / 11.5 |
| Grain amount | 56.9 / 97.9 | 59.2 / 66.6 | 11.2 / 11.2 |
| Highlight softness (soft ceiling) | 89.5 / 100.0 | 63.8 / 77.0 | 11.4 / 13.1 |
| Highlight peak detail (peak fit) | 85.4 / 100.0 | 59.6 / 66.8 | 10.8 / 11.4 |
| Curve luma node | 67.5 / 94.3 | 69.0 / 153.8 | 4.4 / 4.7 |
| Curve red node | 66.8 / 88.5 | 66.9 / 83.9 | 4.6 / 4.4 |
| Exposure-band node amount | 80.4 / 140.4 | 57.0 / 70.6 | 10.1 / 5.4 |
| Exposure-band node position | 82.7 / 118.9 | 58.0 / 68.0 | 4.9 / 5.2 |
| Exposure-band smoothing | 47.5 / 77.3 | — | 7.2 / — |
| Color-wheel pad | 127.2 / 225.9 | 139.0 / 244.8 | 11.2 / 6.2 |
| Vignette center handle | 61.3 / 81.8 | 61.0 / 114.0 | 5.1 / 5.3 |
| Brush local exposure | 85.2 / 118.9 | 80.9 / 99.7 | 11.8 / 12.2 |
| Brush opacity | 82.2 / 105.8 | 85.9 / 95.1 | 6.5 / 7.1 |
| Brush mask feather | 164.1 / 698.8 | 162.5 / 197.4 | 677.6 / 667.7 |
| Gradient fan | 161.7 / 165.6 | 161.3 / 167.0 | 661.4 / 651.5 |
| Luma reference upper rail | 165.3 / 167.5 | 161.8 / 170.3 | 661.9 / 665.8 |
| Luma refined upper rail | 165.5 / 169.6 | 162.4 / 165.5 | 657.2 / 669.4 |
| Denoise amount | 54.3 / 83.8 | 73.5 / 81.9 | 12.1 / 14.0 |

| Shared geometry transaction | n | Release → two-rAF draft median / p95 | Apply → observed stable median / p95 |
|---|---:|---:|---:|
| Straighten drag + Apply | 10 | 14.3 / 15.6 | 278.5 / 966.9 |
| Perspective horizontal drag + Apply | 10 | 16.6 / 21.9 | 718.1 / 2,490.1 |

Geometry's Apply endpoint is observed after result/value audit reads; the release-to-stable endpoint is captured earlier. Do not subtract these fields as if their endpoints were identical. Draft two-rAF timing is compositor observation, not authoritative resampling. Geometry first-feedback fields include the subsequent authoritative Apply and are not an isolated during-drag responsiveness metric.

Supported scalar/canvas drags generally produced early feedback, but mask feather/fan/luma rail first-feedback medians **651.5–677.6 ms** occur late in or after their gestures; fast release alone conceals that delay. Wheel medians were fast but first-feedback tails reached 729.2 ms HDR / 794.4 ms SDR. The largest captured backend mask header in the 45-row batch was 1,742.464 ms; it can overlap gestures/preparation and is not an isolated shader or CPU-stage baseline. No whole-preview CPU fallback was observed in this controlled pass. The automatic-anchor endurance workload below is much slower and must not be pooled with this Manual-anchor pass.

Recompute the complete row summaries without combining retries:

```powershell
node tests/performance/summarize-review.js output/performance/review/2026-09-30-drag-remaining-electron-10.json output/performance/review/2026-09-30-drag-fixed-display-retry-electron-10.json
```

The summarizer rejects duplicate row names; artifacts retain recipes, native inputs, generation correlation, request completion/abort metadata and code hashes. Future Electron drag/endurance runs default to containment on the primary HDR monitor; `HDR_FINISHER_REVIEW_PRIMARY_DISPLAY=0` explicitly opts out and must be recorded as a changed protocol.

### Completed long-session attempt

Artifact: `2026-09-30-long-session-electron.json`. **Completed:** 30 minutes 16.807 seconds active, 36 cycles, 404 tasks including eight Match operations, then two minutes idle; 1,647 nominal one-second OS/board samples. No page errors, sampler errors, disabled GPU, or failure-policy records were observed. This is one bounded attempt, not the three independent mature sessions required by the wider sprint.

| Automatic-anchor replay task | n | Median task ms | p95 task ms | Maximum task ms |
|---|---:|---:|---:|---:|
| SDR → HDR switch | 36 | 67 | 142 | 177 |
| HDR → SDR switch | 36 | 63 | 980 | 1,087 |
| HDR exposure drag, including gesture | 36 | 3,802 | 9,713 | 10,176 |
| SDR exposure drag, including gesture | 36 | 6,759 | 26,608 | 27,267 |
| HDR clarity drag, including gesture | 36 | 885 | 1,681 | 2,072 |
| SDR clarity drag, including gesture | 36 | 1,332 | 4,715 | 6,883 |
| HDR brush feather, including gesture | 36 | 1,267 | 2,312 | 11,747 |
| SDR brush feather, including gesture | 36 | 1,978 | 22,925 | 23,190 |
| Fit → 100% | 36 | 8,164 | 53,768 | 56,113 |
| 100% → Fit | 36 | 182 | 1,060 | 1,299 |
| Match handler → exact/ready/scopes | 8 | 16,392 | 42,716 | 42,716 |

Task wall time includes gesture delivery and task preparation; it is not GPU kernel time. Pan changed scroll programmatically (median 5 ms, maximum 22 ms) and Fit followed immediately: these are not authoritative deferred pan/catch-up timings. Match invokes the button's handler directly, not a native button click. p95 uses nearest rank; with eight Match samples it is the maximum. Recipes evolve under edits and Match, so these are workload distributions, not homogeneous clean-cache module baselines.

**During-drag versus release:** HDR exposure gestures had median 3,661.5 ms, maximum 10,066.8 ms; SDR median 6,550.7 ms, maximum **26,897.1 ms**, despite a nominal 500-ms schedule. SDR release-to-observed-stable was median 96.6 ms, maximum 293.7 ms; HDR 80.9/230.3 ms. Thus short release timings conceal substantial **input delivery/backpressure during the gesture**. Browser dispatch acknowledgements, UI work and host round trips are included; this is not evidence of a 26.9-second GPU kernel or an exact physical-mouse trace. Main-thread/dispatch instrumentation is needed to locate the cost. Brush feather release tails reached 10,600.9 ms HDR and 22,125.0 ms SDR.

**CPU dependencies with a GPU final frame:** all recorded final presentations remained WebGPU. The first HDR feather task's draft/spatial mask headers reported 10,000–10,111 ms and the first SDR 9,266–9,425 ms. Another SDR feather task reported 16,480–16,645 ms; the largest SDR feather mask header was 22,204.251 ms. These are backend mask-operation wall times, while final display GPU timestamps in the initial slow cases were about 30–35 ms. Background native-edge mask requests also lasted up to **68,508.172 ms**; some requests started during a short task and completed much later. Attribute them by their full start/end interval, not by the row in which they started, and do not sum overlapping headers. This directly demonstrates CPU/backend dependencies without requiring whole-preview CPU fallback.

| Memory evidence | Measurement |
|---|---|
| Backend Python peak working set | 25,265,586,176 bytes = **23.53 GiB** |
| Backend peak private bytes | 28,375,531,520 bytes = **26.43 GiB** |
| Owned process-tree peak working set | 26,523,217,920 bytes = 24.70 GiB |
| Whole-board physical VRAM peak | **11,513 MiB**; not app-attributed |
| Registered allocator peak at cycle checkpoints | 6,403,145,336 bytes; budget 6,439,305,216 |
| End/idle registered residency | 6,400,730,896 bytes; 13,106 entries |
| End/idle mask-tile residency | 5,713,099,424 bytes; **13,010 tiles**, about 89% of registered bytes |
| End/idle detail-band tiles | 169,869,312 bytes; 81 tiles |
| Evictions by active completion | **7,026** entries, 4,024,021,440 cumulative bytes |
| Recorded allocator over-budget | **0** at all cycle checkpoints |
| End/idle logical resident bytes | 6,530,259,752; logical accounting is not a physical VRAM trace |

At active completion and after 120 seconds idle, backend working set was 871,907,328 bytes (0.812 GiB), private bytes 1,387,978,752 (1.293 GiB), and whole-board VRAM **10,443 MiB**. Registered GPU bytes, tile counts and cumulative evictions were unchanged throughout that idle tail. CPU memory therefore had a large **transient/fluctuating peak**, not a demonstrated persistent 23.5-GiB leak. GPU caches remained resident at the configured budget. The roughly 6-GiB registered budget versus 10–11-GiB whole-board use is an accounting/attribution question; it does not establish that this app alone used the board total or exceeded its allocator budget.

**Reproduction classification:** reproduced high CPU-memory pressure, GPU mask-cache saturation/eviction and tens-of-seconds CPU-dependent work/input backpressure. **Did not reproduce** the original minutes-long zoomed-out Display exact/scopes stall or a GPU device error. Lane-switch tasks completed in at most 1,087 ms; the longest task was a 56,113-ms native zoom. No optimization is authorized from this attempt alone.

Follow-up packets for future threads:

1. **DRAG-MAIN:** correlate native input timestamps/dispatch acknowledgements with long main-thread tasks and render/coordinator generations; distinguish browser delivery delay from encoded/submitted GPU work.
2. **MASK-CPU:** capture backend compile/raster/cache/singleflight/wait stages and cancellation across the 1,600/1,606/native-edge requests; explain long background work and transient private-memory peaks.
3. **CACHE-VRAM:** census physical app-attributed allocations, retained/unregistered resources and pending destruction; explain mask-tile key cardinality, detail eviction/rebuild and idle residency at the half-VRAM budget.
4. **REPRO-LONGER:** only after those correlations, replay the exact original long-session actions or a longer bounded session. Do not substitute this 30-minute attempt for proof that the original report is fixed or impossible.

### Verification at this checkpoint

The source project and RAW SHA-256 hashes still match the fixture manifest. JavaScript syntax checks pass, `git diff --check` has no whitespace errors, SDR Match state/materialization tests pass (34), and import-job tests pass (2). No algorithm, cache policy, GPU budget, fallback policy or source project was changed. Harness and timing instrumentation changes are the only implementation changes.
