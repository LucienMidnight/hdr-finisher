Film Look finish costs more GPU time than the lens glow.
Caching glow can help lens Strength, but cannot alone promise the drag target.
The W9 RAW fixture is 42 MP; a separate 24 MP fixture does not exercise clipped highlights.
RAW checkpoint savings depend on which stages can be skipped and whether their pixels fit in memory.
These are research measurements and estimates; no fix or pixel-agreement qualification was built.

A1b, 2026-11-13. Base: `b2ce850da62ae8c2c3480b78e718d36490119d1e`, branch `research/a1b-measure`. Judge differences within roughly 10% as noise. Only this report is committed; research instrumentation remains uncommitted in this worktree. No merge, push or installer. Test-photo copies were opened read-only in intent, with Grade autosave disabled; no source save was requested.

Measurement 1 — Film Look and lens drag

Method (measured): `tests/performance/grade-release-sweep.js`, the W9 driver, on `output/test-photos/grade-24mp.tiff`, Portra 400, SDR Fit, 2560×1440 Electron. Lens dependency: Black Pro Mist, size 1. Two native-pointer drag trials per control, plus one lens-only repeat. Commands, from `codebase`:

```
python "D:/AI/AI Projects/HDR Finisher Tool/gpu-run-lock.py" --label a1b-film --minutes 8 -- node tests/run-in-electron.js tests/performance/grade-release-sweep.js --batch film-look --lanes sdr --zooms fit --samples 2 --followup --respect-only --only "lens_strength|stock_color|grain_amount|print_exposure" --output ../scratch/film --label a1b
```

Repeat: same command with label `a1b-film-config`, `--minutes 4`, `--samples 1`, `--only lens_strength`, output `../scratch/film2`. Both passed. Adapter supports `timestamp-query`. Research hooks put beginning/end timestamps on every render pass and resolve/read them asynchronously. Quantization observed: about 0.066 ms; zero means below that granularity. This adds query/readback overhead and is not an uninstrumented speed benchmark. GPU timestamps exclude queue scheduling and display scanout. Pass samples are selected by the drag time window and the full-size finish pass, excluding small scope renders.

All times in the following table are **measured ms**, min–max over sampled full-size drag frames, 2026-11-13. Lens: 26 frames; stock: 43; grain: 32; print: 42. The last three are combined ranges where their grouping is identical.

| GPU group | Lens Strength | Stock/grain/print |
| --- | ---: | ---: |
| Before film: base | 0.066–0.131 | 0.066–0.131 |
| Response plus final response copy | 0–0.066 | 0–0.131 |
| Lens extract | 0–0.066 | Not run |
| 27 horizontal glow passes | 13.369–14.090 | Not run |
| 27 vertical glow passes | 13.500–14.221 | Not run |
| Lens and scatter, each | 0–0.066 | Not run |
| Halation extract, H, V, each | 0.066–0.131 | 0.066–0.131 |
| Finish | 40.370–41.878 | 40.370–42.074 |
| Scan | 0–0.066 | 0–0.066 |
| Structure | Inactive; response copy above | Inactive |
| Present composite | 0–0.066 | 0–0.066 |
| Sum of timestamped passes | 68.289–69.730 | 40.829–42.598 |

Measured presentations/s: lens 7.73–8.45 in the two-trial run, 9.85 in the repeat; stock 13.71–14.67; grain 10.31–15.71; print 11.82–13.92. These include native gesture pacing and instrumentation, so do not replace W9's uninstrumented baseline. Lens trial reciprocal average interval is approximately 101–129 ms (measured arithmetic), much longer than its roughly 69 ms of GPU execution. Removing GPU work does not guarantee that the remaining scheduling interval disappears.

Measured configuration: frame and spatial viewport both 1613×1075, grid divisor 1. `spatialGridScale` uses 1 below 2048, 2 below 4096, then 4: "reduced grid" is actually full size here. Captured source-pixel scale is 1613/6000, gate 36×24 mm, lens size 1. The following are **estimated by exact shader arithmetic from measured dimensions**, not individually timed tap counts. Sigma is in grid pixels; radius is capped at 68; taps are per axis. Rows retain component ordering.

| Components | Sigma | Radius | Taps |
| --- | --- | --- | --- |
| 1–3 | .256 / .728 / 1.323 | 1 / 2 / 4 | 3 / 5 / 9 |
| 4–6 | .576 / 1.638 / 2.977 | 2 / 5 / 9 | 5 / 11 / 19 |
| 7–9 | 1.141 / 3.243 / 5.892 | 3 / 10 / 18 | 7 / 21 / 37 |
| 10–12 | 2.281 / 6.485 / 11.784 | 7 / 19 / 35 | 15 / 39 / 71 |
| 13–15 | 4.563 / 12.970 / 23.568 | 14 / 39 / 68 | 29 / 79 / 137 |
| 16–18 | 3.650 / 10.376 / 18.854 | 11 / 31 / 57 | 23 / 63 / 115 |
| 19–21 | 6.724 / 19.113 / 34.729 | 20 / 57 / 68 | 41 / 115 / 137 |
| 22–24 | 12.386 / 35.207 / 63.972 | 37 / 68 / 68 | 75 / 137 / 137 |
| 25–27 | 22.815 / 64.852 / 117.838 | 68 / 68 / 68 | 137 / 137 / 137 |

Measured redundant work: all 26/26 sampled lens frames reran base, response, extraction and all glow pairs, despite only Strength changing. All 43/43 stock, 32/32 grain and 42/42 print frames reran base and halation despite their upstream inputs staying unchanged. This conclusion combines observed pass execution with the dependency graph; no pixel hash was taken at each intermediate. Finish legitimately depends on the dragged controls. `filmResponseFragmentMain` is currently a copy, not the costly stock/print shader; that work is in `finishFragmentMain`/`applyFilmLook`.

Ranked ideas; every forecast and memory figure below is **estimated**, not a built optimization:

| Priority / idea | GPU frame forecast; whole drag interval forecast | Memory / risk / effort |
| --- | --- | --- |
| 1. Cache response and summed glow for Strength-only changes | About 41–43 ms GPU, saving about 27 ms. Holding observed pacing overhead fixed: about 74–102 ms whole interval. Best GPU-bound ceiling about 24/s; 20/s on screen remains unproven. | Up to 27.7 MB VRAM for two RGBA16F Fit surfaces; aliasing the response copy can reduce it. Glow needs a separate lifetime because halation overwrites shared spatial scratch. Exact reuse can preserve settled/export pixels. Estimated 8–16 agent-hours including invalidation and focused parity checks. |
| 2. Per-sigma pyramid, wide components at 1/8 or 1/16 | If glow falls from 27 ms to 1–5 ms, about 42–47 ms GPU and 75–107 ms whole interval. This is an optimistic arithmetic model, not a measured pyramid. | Approximately 1–10 MB extra Fit scratch depending on packing/lifetimes. Changes sampled kernels, capped support and reconstruction; settled pixels change. Estimated 16–32 agent-hours including perceptual agreement and seam/edge checks. |
| 3. Drag-only coarser spatial grid, exact release | Divisor 2 could reduce glow toward 3–7 ms, giving about 45–49 ms GPU and 78–109 ms whole interval. Divisor 4 might approach 42–45 ms GPU. Finish remains about 41 ms at full resolution. | Reuse/reallocate smaller scratch; no necessary persistent cache. Drag pixels change; exact release can preserve settled/export pixels if cancellation/generation handling is correct. Estimated 4–8 agent-hours. |

For the two stock controls and grain, all three glow-focused ideas leave the roughly 41 ms finish cost intact. A whole-film half-resolution drag could also reduce finish and reach roughly 15–22 ms GPU (estimated), but that is a broader approximation than a reduced *spatial* grid and still needs measured whole-frame scheduling. Investigate finish specialization before promising 20/s.

CPU export uses the same 27-component model (`backend/hdr_finisher/lens_filter.py`), summing bounded normalized outer-product Gaussian kernels and using bounded FFT convolution. GPU uses separable weighted sums and the shared component constants. A pyramid is not algebraically identical to either current discrete convolution. Keep exact settled rendering for a drag-only experiment; any settled/export change requires existing agreed perceptual tolerances and full care for Proof/export ("Still strict"). No such agreement test was run here.

Measurement 2 — RAW redevelopment

CPU method (measured): `.venv/Scripts/python.exe` from the junctioned environment; research scripts `scratch/raw24.py` and `scratch/raw42.py` monkeypatch timed functions around `decode_raw`. Each executes a discarded warm-up cycle followed by three warm cycles of Expand (Edge Colour, 1%), Method (Edge Colour, .5%), and focal (opposed colour, 35 mm). These are repeat redevelopments with warm OS/module caches, not retained-session checkpoint implementations. CPU route was explicitly selected with `highlight_edge_gpu.source_work(cpu_only=True)`: no graphics were run outside the lock. A forced CPU route does not measure the faulty-VRAM GPU rejection penalty. Tables show nested timings: do not add decode/correction totals to their child stages.

Commands (2026-11-13): `codebase/.venv/Scripts/python.exe scratch/raw24.py` and `codebase/.venv/Scripts/python.exe scratch/raw42.py`. The latter uses W9's `output/test-photos/DSC00264.ARW`, decoded 7968×5320 (42.39 MP). The independent Canon `gpu-raw/IMG_7723.CR3` decodes 6024×4020 (24.22 MP); Edge Colour reports `no_clipped_pixels`, and lens correction has no applicable profile. Therefore it is not evidence that the slow W9 cases are cheap at 24 MP. An initial 18 MP Canon exploratory run was discarded from these comparisons.

All table values are **measured seconds**, three warm trials, min–max, on the 42.39 MP Sony:

| Stage | Expand | Method | Focal |
| --- | ---: | ---: | ---: |
| File open (`rawpy.imread`, excludes lazy unpack) | .0003–.0007 | .0003–.0007 | .0003–.0005 |
| Pre-demosaic highlight reconstruction | .746–.916 | .787–.851 | .774–.969 |
| Demosaic/postprocess | .793–.903 | .784–.870 | .836–.885 |
| Decode total, including unpack/metadata/transport | 2.602–2.939 | 2.439–2.909 | 2.648–2.978 |
| Camera RGB normalization | .246–.281 | .220–.273 | .230–.290 |
| Colour conversion | .384–.411 | .334–.378 | .369–.386 |
| CPU Edge Colour | 10.235–10.949 | 10.429–11.514 | Not run |
| Lens correction | 2.395–2.673 | 2.395–2.529 | 2.436–2.653 |
| Corrections total | 14.481–15.295 | 14.786–15.429 | 3.135–3.314 |
| Complete decode_raw | 17.084–18.235 | 17.697–18.097 | 5.914–6.294 |

All values below are **measured seconds**, three warm trials, on the 24.22 MP Canon (nonqualifying highlight/lens fixture):

| Stage | Expand | Method | Focal |
| --- | ---: | ---: | ---: |
| Decode total | 1.253–1.280 | 1.175–1.242 | 1.182–1.303 |
| Pre-demosaic reconstruction | .150–.175 | .162–.172 | .171–.173 |
| Demosaic/postprocess | .456–.496 | .443–.462 | .452–.485 |
| Colour conversion | .188–.195 | .191–.209 | .182–.198 |
| Edge Colour no-op check | .071–.073 | .065–.081 | Not run |
| Lens correction | Below .0001 | Below .0001 | Below .0001 |
| Complete decode_raw | 2.227–2.319 | 2.214–2.239 | 1.522–1.639 |

File open alone is misleading: rawpy performs work lazily. Unpack was not isolated from metadata and transport in the standalone trials; decode total includes all of them. Proxy/mips, upload and first settled picture are outside `decode_raw`, and cannot be inferred by subtracting these CPU times from old W9 whole-wait figures: the app enables parallel import bands and the fixtures/settings differ.

Checkpoint memory (all figures **estimated**, decimal bytes, nominal pixel counts):

| Retained object | 24 MP | 42 MP |
| --- | ---: | ---: |
| Pre-lens float32 RGB (12 bytes/pixel) | 288,000,000 | 504,000,000 |
| Pre-edge RGB plus float32 clip-ratio plane (16 bytes/pixel) | 384,000,000 | 672,000,000 |
| Pre-lens plus current RGB source | 576,000,000 | 1,008,000,000 |
| Pre-edge plus current RGB source | 672,000,000 | 1,176,000,000 |

Against the 600,000,000-byte Grade aggregate cap, a pre-lens checkpoint at 24 MP leaves only 24,000,000 bytes for other retained arrays when the current source is retained. At 42 MP, the checkpoint alone fits but the pair does not. Pre-edge alone exceeds the cap at 42 MP; its pair exceeds the cap even at 24 MP. Actual Sony dimensions are slightly larger than nominal 42 MP. These figures exclude transient decode/lens working arrays, masks and mips. Admission must count unique backing arrays and evict/refuse as appropriate; neither checkpoint is a free additional cache. No cap change is proposed. Neither needs VRAM on a CPU implementation.

CPU-only checkpoint forecasts, **estimated from measured stage subtraction**, assuming exact reusable inputs and negligible lookup/copy overhead:

| Rank / checkpoint | Saving and remaining backend wait on qualifying Sony | Risk / effort |
| --- | --- | --- |
| 1. Pre-lens for focal | Save 3.28–3.64 s; retain about 2.44–2.65 s lens work. Whole-wait saving is at most that skipped work, not all 5.91–6.29 s. | Exact float32 checkpoint can preserve pixels, but lens correction consumes input: checkpoint needs immutable ownership/copy-on-use. Memory makes 42 MP retention inadmissible alongside current source. Estimated 8–16 agent-hours including invalidation, memory admission and tests. |
| 2. Pre-edge for Expand | Save at most 4.37–4.74 s from 17.08–18.24 s backend decode; roughly 12.6–13.6 s of edge/lens work remains. It does not skip edge reconstruction or a subsequent GPU attempt. | Must retain both RGB and clipping ratio with matching threshold, WB and reconstruction provenance. Inadmissible pair under the current cap at both nominal sizes. Estimated 12–24 agent-hours including ownership/admission and pixel tests. |

Highlight Method invalidates the pre-edge data because opposed-colour reconstruction happens before demosaic; a pre-edge checkpoint is not a Method-change shortcut. A pre-lens checkpoint also must be invalidated by Method or Expand. Smaller checkpoints, lossy storage, disk checkpoints and new GPU kernels were not measured. Whole-wait forecasts need the app evidence below and must not be obtained by subtracting standalone CPU times from W9.

Electron whole-wait qualification (measured, 2026-11-13): the successful run was:

```
# A1B_RAW_LOG points to scratch/electron-raw4.jsonl
python "D:/AI/AI Projects/HDR Finisher Tool/gpu-run-lock.py" --label a1b-raw4 --minutes 6 -- node tests/run-in-electron.js tests/performance/grade-release-sweep.js --batch raw-highlights --input output/test-photos/DSC00264.ARW --output ../scratch/raw-app4 --label a1b
```

Research driver changes: open through `desktop.grantSourcePath`/`openStagedDesktopSource`, disable autosave, call the existing `applyRawImportSettings`, assert import generation advances, then wait for the current exact presentation plus two animation frames. Two actual trials per change (the reused report template's `samples: 3` field is stale and is not the trial count). Method trials switch opposed colour to Edge Colour at .5%, resetting to opposed outside the timer. Expand trials use 1% and 1.1%; focal uses 35 and 36 mm with opposed colour. Source hash: `e646d44a86cef88ff73af27ed60a683bf8ce2f7f62110ea042f84fedc56a4e00`. This is editor completion telemetry, not physical display scanout.

Two earlier sweep attempts stalled before redevelopment; a third handler-only attempt returned without a durable source. All their apparent action timings are discarded. The final run asserts real redevelopment and has matching backend decode logs for every trial. The desktop path restores an existing source recipe before the controlled changes; it is not an unqualified cold-load comparison.

All values in the following table are **measured seconds**, two warm trials, min–max, with the app's parallel import bands enabled. Nested totals overlap child rows.

| Stage / user wait | Method | Expand | Focal |
| --- | ---: | ---: | ---: |
| Highlight reconstruction, pre-demosaic | .737–.754 | .772–.925 | .882–.919 |
| Demosaic/postprocess | .774–.800 | .795–.803 | .785–.797 |
| Transport diagnostics | .145–.149 | .162–.174 | .151–.154 |
| Decode total, including file read/unpack | 1.732–1.783 | 1.823–1.961 | 1.916–1.961 |
| Camera RGB normalization | .046–.047 | .047–.048 | .048–.049 |
| Colour conversion | .073–.075 | .076–.081 | .074–.075 |
| GPU Edge Colour handoff including transport/result check | 6.080–6.102 | 6.123–6.160 | Not run |
| CPU Edge Colour fallback | Not run | Not run | Not run |
| Lens correction | 2.435–2.467 | 2.437–2.451 | 2.475–2.480 |
| Complete decode_raw | 11.227–11.342 | 11.367–11.569 | 4.541–4.588 |
| Complete loader, including analysis | 12.204–12.344 | 12.353–12.562 | 5.522–5.607 |
| Complete prepare_session | 12.374–12.508 | 12.515–12.732 | 5.690–5.776 |
| After session preparation to exact settled picture | .206–.207 | .943–.949 | .939–1.142 |
| Whole action to exact settled picture | 12.582–12.715 | 13.464–13.675 | 6.629–6.918 |

The after-preparation row is **measured arithmetic** from the matching whole-wait and nested session timers. It includes proxy/mips, requests, upload, scheduling and first render; it is not an isolated upload measurement. Individual `SourceMipStore.level` calls across this run were measured below .001 s for resident levels up to .407 s for builds; changed Expand/focal actions rebuilt levels whereas Method trials reused matching levels. These calls can overlap and must not be summed as a serial critical path. Upload was not separately isolated; file unpack was not independently isolated from the decode total. Those two requested substage splits remain a measurement limitation, not zero-cost claims.

GPU route: backend diagnostics report `renderer: gpu`, `fallback_reason: null` on every edge trial, clipped fraction .03361116. The reconstruction log reports about 5.956–6.046 s inside the GPU job (measured), and 1,872,588,496 bytes peak job memory (reported telemetry, measured by that job's accounting, not a whole-process census). The encompassing Python handoff above is slightly longer. No range-check failure was reproduced, and no retry or CPU fallback ran. Therefore this run cannot quantify the failed-GPU-plus-CPU case. The separate forced-CPU table remains useful for that backend route, but must not be added to these GPU times as if a failure had occurred.

Whole-wait checkpoint forecasts, **estimated using the matching app stages**: a pre-lens focal checkpoint could skip about 2.07–2.11 s, taking the measured 6.63–6.92 s wait toward 4.56–4.81 s (about 30–32% saved). A pre-edge Expand checkpoint could skip at most 2.81–2.96 s, taking 13.46–13.68 s toward 10.5–10.9 s (about 21–22% saved). Both assume immutable usable checkpoint data, negligible restore cost and unchanged downstream preparation/mips. They are upper savings bounds because stage residuals can include work that still needs doing. At 42 MP their retained-array pairs exceed the current cap, so these are conditional benefits, not deployable cache promises. Neither change removes half the whole wait. The effort/memory/pixel risks in the checkpoint table still apply. Method needs a different checkpoint before its changed reconstruction input, not either of these two.

Graphics use and output accounting

Measured shared-lock occupancy: first film run about 70 s, lens repeat about 17 s, stopped RAW sweeps about 106 s and 114 s, discarded no-op RAW run about 33 s, successful RAW run about 109 s: approximately 7.5 graphics minutes total, well below the 30-minute allowance. Lock-queue time is excluded. All Electron/GPU runs went through the shared wrapper; aborted runs were stopped by terminating only their identified child process trees and the wrapper released each lock.

Measured output-size command: `.venv/Scripts/python.exe tools/output_size.py`, from `codebase`. Initial worktree-only check before linking shared output: 0.0 GB. Shared output check after linking, before final runs: 45.9 GB; largest folders test-photos 35.6 GB, release-checks 3.0 GB, grade-dng 1.3 GB, library-dng-warp 1.1 GB, edge-colour-raw 1.0 GB. Shared output is being used by other researchers; its final size is recorded below. No test photo was copied per run. No product change or pixel validation is claimed, so broad release checks were not run.

Final measured shared output: **45.9 GB**, same rounded size before/after. Measured scratch retained after failed cleanup: **4,036,024 bytes**. Commit scope is this report alone; instrumentation changes in Python, WebGPU and the drivers remain uncommitted on the research worktree and must never be merged.

Automatic approval review rejected deletion of `scratch/` and the two stopped-run profiles `C:/Users/Steve/AppData/Local/Temp/hdr-finisher-electron-test-cgWRK6` and `hdr-finisher-electron-test-v7qbfX`, stating only "blocked by policy". They remain; no user files were deleted to work around that rejection.

