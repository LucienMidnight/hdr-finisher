# Interactive Preview, Instant Scopes, and Image Pipeline Performance Sprint

**Date:** August 9, 2026  
**Status:** Implemented — automated release gates passed August 9, 2026; physical-display sign-off remains a release-certification step  
**Owner:** HDR Finisher engineering  
**Application target:** The next HDR Finisher performance release  
**Primary platforms:** Windows Chrome/Edge and macOS Chrome/Safari-capable application shells  
**Related product requirements:** [HDR Finisher PRD v1.2](HDR_Finisher_PRD_v1.2.md)

## 1. Executive summary

This sprint makes grading feel immediate without weakening export quality or silently changing the image pipeline. Its central product decision is that, on a supported GPU, the validated WebGPU result becomes the settled authoring preview. Routine slider changes must no longer trigger a CPU render, PNG/AVIF encode, network transfer, browser decode, and replacement of an already-current GPU image.

The sprint also makes scopes part of the interactive feedback loop. A useful histogram, waveform, and highlight-level indication must appear almost immediately while grading. A more detailed scope may replace it after the user pauses, but the last valid scope must never disappear while new data is being prepared.

Users receive one optional **High-quality preview** setting. It is off by default so the standard experience is fast on a wide range of machines. Enabling it increases preview and settled-scope resolution and permits an idle background refinement. It never changes export resolution, export math, or the quality of the delivered file.

The same sprint addresses the largest supporting costs found in the performance review: Apple HDR HEIC decoding and color conversion, oversized float32 proxy transfers, expensive waveform generation and JSON serialization, repeated WebGPU allocations, and frame caches governed by item count rather than memory.

## 2. Problem statement and measured baseline

The live WebGPU adjustment path is already responsive. On the benchmark Windows workstation, representative slider JavaScript handlers took approximately 1.5-1.6 ms and WebGPU submission took approximately 0.5-0.7 ms. The user-visible delays occur around that fast path:

| Area | Observed baseline | User impact |
|---|---:|---|
| Apple HDR HEIC load, 4032 x 3024 | approximately 4.0 s first run | The application feels slow before grading can begin. |
| Large 2000 x 2500 EXR load | approximately 0.8 s | Noticeable but acceptable; must not regress. |
| Large 2666 x 4000 TIFF load | approximately 1.6 s | Noticeable startup delay. |
| Settled waveform request | approximately 390-470 ms in browser | Scopes lag behind an adjustment and are too slow for confident highlight placement. |
| Repeated waveform canvas draw | approximately 26 ms median | A single redraw can miss a 60 Hz frame. |
| HDR 1600 px AVIF preview encode | approximately 583 ms | The slower encoded result replaces an already-fast GPU preview. |
| HDR 1600 px PNG fallback path | approximately 214 ms | Encode, transfer, and decode add latency unrelated to adjustment math. |
| SDR 1600 px default processing | approximately 323 ms before transport | SDR tone mapping makes CPU settling expensive even with neutral controls. |
| Tone Equalizer at 1600 px | approximately 142 ms HDR / 323+ ms SDR total path | Complex controls amplify CPU settling cost. |
| Curves at 1600 px | approximately 263 ms HDR | CPU refinement becomes visible as lag. |
| 1600 px RGBA32F proxy | approximately 30-33 MB | Avoidable transfer and GPU-memory pressure. |
| FastAPI-style scope model encoding | approximately 127 ms for an approximately 862 KB waveform payload | Serialization alone consumes much of the desired scope budget. |
| Repeated capability probe | approximately 210 ms | Session responses pay for an external process more than once. |

The current preview scheduler starts a 960 px scope request after roughly 90 ms and a 1600 px settled preview and scope after roughly 240 ms. On most SDR displays, headless environments, overlay states, and comparison states, the WebGPU surface is not retained as the settled result. The application therefore performs expensive backend work precisely when the user expects the image and scopes to be finished.

Memory also compounds the problem. A decoded 12 MP Apple HDR image can require approximately 140 MiB for the HDR float array and another similar allocation for its SDR reference. Processed-frame caches, two preview lanes, float32 proxies, transport buffers, and GPU copies can push app-managed image data beyond 500 MiB.

These measurements are diagnostic baselines from the August 9, 2026 performance review. Acceptance comparisons must be rerun on the same fixtures and benchmark machine before and after implementation.

## 3. Product goals

### G1. Immediate visual adjustment

Every slider and curve interaction produces a new visible GPU preview on the next available animation frame. A completed drag must look settled without waiting for an encoded backend image.

### G2. Scopes that can guide the grade

A useful scope preview must update quickly enough to guide highlight and white-point placement. Peak/highlight information is prioritized over drawing every final-density waveform cell. The interface retains the last valid scope and indicates freshness while an update is in progress.

### G3. Explicit performance/quality choice

The default experience is designed for speed and bounded memory. Users with a capable GPU and sufficient memory can enable **High-quality preview** for a larger settled proxy and more detailed scopes. The option is a preview preference, not an export-quality setting.

### G4. Trustworthy authoring parity

The GPU authoring preview must be validated against the CPU/export math. “Authoritative” means that its transforms, adjustment order, constants, curves, and tone-mapping behavior are within an agreed numerical and perceptual tolerance. It does not mean that the authoring preview must be encoded to the delivery format after every edit.

### G5. Lower loading, transport, and memory costs

Apple HDR HEIC ingestion becomes materially faster, proxy payloads are reduced, repeated capability work is eliminated, and caches are constrained by bytes as well as usefulness.

### G6. No export or proofing regression

Fast and high-quality preview modes must produce identical exports for identical source and adjustment state. Chrome Proof and explicit delivery-proof encodes retain their existing authority and on-demand behavior.

## 4. Non-goals

This sprint does not:

- reduce final export dimensions, bit depth, encoder quality, or gain-map fidelity;
- replace the CPU/export pipeline as the final-delivery authority;
- change HDR/SDR adjustment formulas, color-space intent, reference white, or export metadata;
- claim colorimetric monitor certification;
- make delivery-format PNG/AVIF/JPEG encoding continuous during grading;
- add local adjustments, masks, tiles for full-resolution editing, or a new image editor architecture;
- guarantee that a reduced-resolution scope detects every source-resolution one-pixel highlight;
- rebuild Chrome Proof automatically after each grade change;
- optimize unrelated application startup or packaging work unless it blocks the performance goals below.

## 5. Product behavior

### 5.1 Preview states

The viewer has four distinct states. They must be named consistently in code, diagnostics, and tests.

| State | Purpose | Expected work |
|---|---|---|
| **Interactive** | Feedback while a control is moving | One coalesced WebGPU render per animation frame; preview scopes at a throttled cadence. |
| **Settled authoring** | Stable grade after brief inactivity | Keep the current GPU surface; produce settled scopes; do not encode a delivery image. |
| **High-quality refinement** | Optional refinement after longer idle | Render a larger proxy and higher-detail scopes in the background, then swap atomically if still current. |
| **Proof/export** | Validate or create encoded delivery | Use the existing authoritative CPU/export and delivery-format encoding paths on explicit user action. |

The application must not use “draft” to imply inaccurate color. Interactive and settled previews may differ in spatial resolution or scope density, but both use the same adjustment semantics.

### 5.2 Default fast-preview behavior

**High-quality preview** is off by default.

When WebGPU is available:

1. Pointer input and keyboard adjustment update application state immediately.
2. Multiple input events in the same frame are coalesced into one render.
3. The active GPU canvas remains visible throughout the interaction and after it settles.
4. A preview scope update is scheduled immediately at a bounded cadence, with the first post-input result targeted within 100 ms.
5. After approximately 75-120 ms without input, the latest GPU image is marked settled and a settled-scope update is requested.
6. No PNG, AVIF, or JPEG authoring-preview encode is requested merely because the adjustment settled.
7. An explicit proof, export, unsupported-GPU state, or parity-protection fallback may still use the backend renderer.

Recommended fast-mode proxy policy:

- Choose resolution from the viewer's displayed pixel size multiplied by device pixel ratio.
- During interaction, clamp the long edge to approximately 768-1024 px.
- At settle, allow approximately 1024-1200 px when the displayed size benefits.
- Do not exceed source dimensions.
- Use a validated 16-bit floating-point GPU proxy where range and precision tests pass.

The exact limits may be tuned from measurements, but fast mode must remain bounded and display-aware rather than always requesting 1600 px.

### 5.3 High-quality preview behavior

When **High-quality preview** is enabled:

- interactive rendering remains identical to fast mode so control response never becomes sluggish;
- after approximately 100-200 ms idle, the application may prepare a 1600-2000 px GPU proxy, limited by source size and device capability;
- after approximately 400-600 ms idle, an optional backend refinement may run only if it provides a validated benefit that the GPU path cannot provide;
- refinement work is lower priority than input and preview-scope work;
- the current image remains visible until a complete, current-generation replacement is ready;
- stale results are discarded before encoding, serialization, upload, or DOM replacement wherever possible;
- memory-limit or device-loss handling can fall back to fast mode with a nonblocking explanation.

The preference is stored per device/browser profile, not baked into a source session or exported file. Its label or help text must state: “Uses more GPU memory for a larger preview. Export quality is unchanged.”

### 5.4 Scope behavior and freshness

Scopes are a first-class grading surface, not a secondary report.

#### Interactive scope tier

While a control moves, the application produces an approximate but useful scope from the active preview pipeline. The initial target is:

- histogram: 256 bins;
- waveform: approximately 256 horizontal samples by 128 vertical bins;
- highlight/peak indicator: computed and returned ahead of, or together with, the scope payload;
- update cadence: no more than one scope computation every 50-100 ms;
- first visible post-input update: <=100 ms at p95 on the benchmark machine;
- no scope canvas redraw longer than 12 ms at p95.

The existing scope remains visible until the new scope is complete. During an adjustment it may show a subtle **Updating** state. It must not clear, flash, collapse, or temporarily display zeros.

#### Settled scope tier

After input has been idle for approximately 100-150 ms, the application produces the normal-density authored scope at the visible scope size, normally no more than the current approximately 302 columns by 281 bins. The settled scope target is <=250 ms at p95 from the last input event in fast mode.

High-quality preview mode may use a 1600 px analysis proxy and a higher-density scope after longer idle. It must not delay the interactive or normal settled scope. A separate future “full-resolution analysis” action may be added, but full-source analysis is not automatic in this sprint.

#### Highlight and nit-level reliability

Because users rely on scopes to set white and highlight levels:

- the numeric peak/highlight readout and clipping flags are higher priority than waveform density rendering;
- scope labels identify **Preview** versus **Settled** freshness when the distinction is material;
- settled peak/highlight results are calculated from the same adjusted proxy represented by the settled authoring viewer;
- tests include small bright features, saturated highlights, neutral white patches, and values around named nit thresholds;
- downsampling must be evaluated for lost maxima. If average downsampling materially hides small highlights, use a max-preserving analysis reduction or disclose the preview-tier limitation while keeping the settled tier accurate to its proxy;
- switching HDR/SDR lanes, applying A/B comparison, or enabling overlays must not make the scope silently describe a different grade than its label.

### 5.5 No-WebGPU fallback

Machines without usable WebGPU must still receive a responsive default mode:

- maintain a persistent 768-960 px CPU working proxy;
- coalesce input and cancel stale generations;
- prefer a raw RGBA8 binary response rendered into a canvas over PNG encode, transfer, browser decode, and image-element replacement;
- use the lower end of the proxy range for SDR, where tone mapping is more expensive;
- generate a vectorized preview scope from the same CPU proxy;
- keep the last completed image and scope visible while new work is pending.

The CPU fallback has relaxed frame targets, but it must avoid redundant delivery encoding and stale work.

### 5.6 Overlays, comparison, and lane switching

Overlays and comparison currently reduce the situations in which the GPU surface can remain authoritative. This sprint moves routine overlays and A/B composition onto the GPU/canvas path where feasible.

- Enabling an overlay must not automatically force encoded backend settling.
- Comparison composition must reuse current lane surfaces and avoid reprocessing an unchanged lane.
- The inactive HDR/SDR lane is prepared only when idle and when predicted to be useful.
- Active input, scope preview, and active-lane settle always outrank inactive-lane preparation.
- Lane and comparison results carry generation identifiers so late work cannot replace current state.

## 6. Technical workstreams and requirements

### WS1. Interaction-aware preview scheduler (P0)

Replace independent debounce timers with one scheduler that knows whether the user is interacting, which lane and generation are current, which scope tier is needed, and whether the browser is idle.

Requirements:

- one animation-frame render at most per control update frame;
- separate generations for active image, active scopes, inactive lane, and optional refinement;
- `AbortController` cancellation for fetches plus generation checks before expensive server work and before applying a result;
- priority order: active image, interactive highlight data, interactive scopes, settled scopes, high-quality refinement, inactive lane;
- pointer-down/input/change/pointer-up signals where available; keyboard and programmatic changes receive equivalent settling behavior;
- instrumentation for queue delay, render time, request time, stale-result count, and result-application time;
- no full control-panel DOM traversal unless state affecting that panel changed. If measurements show `renderControlState` contributing to missed frames, cache references and update only changed readouts/classes.

### WS2. WebGPU preview as settled authoring authority (P0)

Requirements:

- keep the WebGPU canvas after settling in both HDR and SDR grading lanes when parity is validated;
- stop the automatic 1600 px encoded authoring-preview replacement in default fast mode;
- preserve CPU/export authority for proof and export;
- centralize or generate shared adjustment constants, matrices, LUT definitions, parameter ranges, and operation order used by CPU and GPU implementations;
- add numerical parity fixtures for neutral state and meaningful low/nominal/high values of every HDR and SDR control, including tone equalizer and curves;
- reuse GPU uniform/storage buffers, bind groups, textures, and configured canvas surfaces instead of allocating, configuring, and destroying them for every frame;
- resize or reconfigure a canvas only when its actual dimensions, color space, alpha mode, or device state changed;
- handle device loss by preserving the last valid image, reporting fallback state, and moving to the CPU path.

Initial parity thresholds to validate and tune before release:

- median display-transformed RGB relative error <=0.25%;
- p99 relative error <=1% away from documented discontinuities or clipping boundaries;
- peak-nit and clipping-threshold difference <=1%;
- no visible hue-order, monotonicity, neutral-axis, or lane-isolation regression.

If the existing CPU and GPU implementations disagree beyond the approved envelope, the discrepancy must be resolved or the affected operation must use a documented fallback. The sprint must not relabel an unvalidated approximation as authoritative.

### WS3. Display-aware half-float proxy pipeline (P1)

Requirements:

- replace unconditional 1600 px RGBA32F transfer with display-aware proxy levels;
- prefer RGBA16F for GPU transport and storage after precision/range validation;
- retain float32 canonical source data and all export math;
- maintain at most the proxy levels justified by the current display and high-quality preference;
- reuse proxy data across unchanged HDR/SDR lane operations where their source is shared;
- detect values outside safe half-float behavior and apply a reversible scale or use float32 for that source;
- avoid simultaneously retaining redundant fetch `ArrayBuffer`, typed-array, GPU staging-buffer, and texture copies longer than required.

At a representative 1600 x 1200 frame, RGBA16F should reduce the proxy payload from approximately 30.7 MB to approximately 15.4 MB.

### WS4. Instant scope pipeline (P0)

Preferred WebGPU path:

- add a compute or reduction pass operating on the current adjusted preview texture;
- produce compact histogram, waveform, peak, and clipping data;
- read back packed integer counters and small scalar results, not image-sized buffers;
- permit the peak/highlight result to complete before waveform rasterization;
- reuse readback buffers and avoid blocking the main render submission;
- discard stale readbacks by generation.

Backend/fallback path:

- replace per-column Python histogram loops with vectorized bin-index generation and `numpy.bincount`/equivalent aggregation;
- compute only the requested visible dimensions and cap routine scope analysis at the fast analysis-proxy size;
- return compact binary typed-array data or a directly serialized Pydantic JSON response; do not recursively pass large nested models through generic `jsonable_encoder`;
- cache scope results by source, lane, adjustment generation, proxy level, and dimensions;
- use single-flight computation so identical concurrent requests share work.

Frontend drawing:

- cache the waveform density canvas or bitmap when data and display dimensions are unchanged;
- remove full-grid flatten-and-sort work from every draw; return a robust peak/normalization value with the scope data or calculate it once per payload in linear time;
- reuse `ImageData` and offscreen canvases where dimensions permit;
- separate data freshness from cosmetic redraws such as panel resize;
- avoid allocating nested arrays when typed arrays suffice.

### WS5. CPU fallback and settled response transport (P1)

Requirements:

- add a raw RGBA8 preview response suitable for `ImageData`/canvas presentation;
- include dimensions, generation, lane, color/display interpretation, and cache identity in headers or a small metadata envelope;
- avoid image-format encoding for ordinary SDR fallback grading;
- measure whether WebCodecs/ImageDecoder offers a meaningful supported improvement before adding it; it is not required for completion;
- keep encoded AVIF/PNG paths only where actual encoded-format behavior is being proofed or where platform constraints require them.

### WS6. Apple HDR HEIC and general image loading (P1)

Requirements:

- calculate the Display-P3 linear base once and reuse it for the Apple HDR gain-map reconstruction and SDR reference;
- replace repeated general-purpose `colour-science` transforms in the hot path with validated float32 transfer functions and fixed matrices where the input/output spaces are known;
- avoid unnecessary float64 promotion and duplicate full-resolution intermediates;
- cache the external encoder/capability probe for the application process, with an explicit invalidation strategy only when executable configuration changes;
- profile cold and warm HEIC paths after each optimization;
- preserve auxiliary gain-map detection, metadata interpretation, color values, and HDR/SDR lane independence.

The target is at least a 35% reduction in the representative 12 MP Apple HDR HEIC ready time, with no material color or highlight reconstruction regression. EXR and TIFF loading must not regress by more than 10%.

### WS7. Memory-aware caches and concurrency (P1)

Requirements:

- replace the processed-frame cache's count-only limit with a byte budget and documented eviction policy;
- account for source arrays, SDR references, processed frames, CPU proxies, transport buffers, and GPU proxies in diagnostics where practical;
- retain the active result first, likely-next lane second, and reusable source proxies before speculative frames;
- add per-key single-flight behavior so duplicate requests share computation;
- do not hold a global render-cache lock through unrelated expensive work. Protect bookkeeping while allowing safe independent computations;
- release obsolete proxies and GPU resources after lane/source/preference changes;
- expose debug counters for bytes, entries, hits, misses, evictions, in-flight work, and stale cancellations.

Steady-state app-managed image payload for the representative 12 MP HEIC should target <=384 MiB in fast mode, excluding browser/runtime baseline overhead. Peak memory must be measured and documented; it must not grow with continued slider use.

### WS8. Settings, diagnostics, and documentation (P1)

Requirements:

- add the **High-quality preview** preference with accessible label, description, keyboard behavior, and persisted per-device state;
- default it to off for existing and new installations unless the user has explicitly chosen otherwise;
- show the active preview path and proxy level in developer diagnostics, not as permanent visual clutter;
- record WebGPU availability/device loss, proxy format/resolution, preview generation latency, scope tier/latency, and fallback reason;
- update the viewer/scopes user guide, architecture, troubleshooting, traceability, frontend contract tests, and relevant screenshots after labels settle;
- explain that export quality is invariant across preview modes.

## 7. Performance budgets and acceptance criteria

Unless otherwise stated, timing gates are p95 across at least 30 repetitions after one warm-up, on the same benchmark workstation and representative fixtures used for the baseline. Cold-load tests are run separately. Tests must record source, dimensions, browser, GPU, OS, build/commit, preview mode, and whether HDR display output was active.

### 7.1 Interaction and visual preview

| Requirement | Fast mode target | High-quality mode target |
|---|---:|---:|
| Slider input handler | <=4 ms | <=4 ms |
| Visible response after an input event | next animation frame; <=50 ms p95 | same |
| Frame interval during representative drag | <=16.7 ms p95, with no recurring >50 ms main-thread tasks | same interactive target |
| Fast settled-authoring state | <=150 ms after last input | <=150 ms before background refinement |
| Encoded authoring-preview requests during ordinary WebGPU grading | 0 | 0 unless a documented refinement requires one |
| Stale result replacing current image | 0 | 0 |

### 7.2 Scopes

| Requirement | Target |
|---|---:|
| First interactive histogram/waveform or priority highlight update | <=100 ms p95 after input |
| Interactive scope refresh cadence during sustained drag | at least 10 Hz when compute budget permits; never starve image rendering |
| Normal settled scope | <=250 ms p95 after last input |
| Scope canvas draw | <=12 ms p95 |
| Main-thread scope task | no recurring task >16.7 ms |
| Current scope visibility while updating | 100%; no blank/zero flash |
| Wrong-lane or stale scope applied | 0 |
| Peak/highlight threshold parity against settled adjusted proxy | <=1% or one display bin, whichever is larger |

If simultaneous 10 Hz waveform updates and 60 Hz image updates cannot be sustained, image rendering wins and the scope cadence degrades gracefully. Peak/highlight numbers should still update before full waveform density.

### 7.3 Loading, transport, and memory

| Requirement | Target |
|---|---:|
| Representative 12 MP Apple HDR HEIC ready time | >=35% faster than approximately 4.0 s baseline |
| Repeated capability-probe cost after first result | <1 ms lookup; no repeated external process |
| 1600 x 1200 GPU proxy payload | approximately 15.4 MB with RGBA16F, unless guarded fallback is required |
| EXR/TIFF load regression | <=10% |
| Fast-mode steady-state app-managed image payload for representative HEIC | <=384 MiB target |
| Memory growth after 100 representative slider settles | <=5% after caches reach steady state |

### 7.4 Correctness and UX

- Identical source and adjustment state exports byte-identically or numerically equivalently regardless of preview preference.
- HDR and SDR lanes remain independent.
- Preview mode changes do not mutate adjustments, proof settings, export settings, or source interpretation.
- Switching preview quality never blanks the viewer or scopes.
- The application correctly announces the checkbox and updating/fallback status to assistive technology without creating excessive live-region chatter.
- Existing overlays, A/B interaction, zoom, pan, lane switching, Chrome Proof, and export workflows continue to work.
- No uncaught browser error, unhandled promise rejection, WebGPU validation error, or leaked object URL is present in the automated interaction run.

## 8. Test and validation plan

### Automated tests

Add or extend tests for:

1. Scheduler generations, cancellation, priority, and stale-result rejection.
2. One-render-per-animation-frame event coalescing.
3. No encoded preview request during default WebGPU grading.
4. High-quality preference persistence, fallback, and export invariance.
5. GPU/CPU parity for every control and representative combinations.
6. HDR/SDR lane isolation and inactive-lane scheduling.
7. Scope histogram/waveform/peak correctness using deterministic gradients, steps, tiny highlights, saturated patches, and values around 100, 400, 1,000, 4,000, and 10,000 nit equivalents.
8. Scope tier freshness and generation labeling.
9. Vectorized/backend scope equivalence against the existing reference implementation.
10. Compact serialization/binary payload shape, dimensions, bounds, and MIME.
11. RGBA16F range/precision guards and RGBA32F fallback.
12. HEIC transform equivalence, gain-map reconstruction, and SDR-reference reuse.
13. Cache byte accounting, eviction, single-flight work, concurrency, and stable memory behavior.
14. WebGPU device-loss and no-WebGPU raw-canvas fallback.
15. Frontend accessibility and contract coverage for the new preference and status states.

### Browser performance harness

Create a repeatable Playwright/browser harness under `codebase/tests/` and write generated traces/results to `codebase/output/performance/`. It must:

- load representative EXR, TIFF, and Apple HDR HEIC inputs;
- exercise exposure, contrast, saturation, tone equalizer, curves, HDR/SDR switching, overlays, and comparison;
- record event-to-frame timing, animation-frame intervals, long tasks, preview and scope requests, payload sizes, stale cancellations, and settled times;
- test both preview modes and a forced no-WebGPU path;
- repeat interactions long enough to detect cache or memory growth;
- fail on budget regressions where the environment supplies reliable timing, and otherwise produce a clearly comparable report.

### Manual validation

On at least one Windows HDR display, one Windows SDR display, and one available macOS display:

- compare GPU settled preview to the current CPU reference across the deterministic HDR chart and representative photographic/CG images;
- grade primarily from scopes and confirm that white/highlight placement remains predictable;
- observe tiny highlight behavior between interactive and settled scope tiers;
- toggle high-quality preview during a session and confirm a non-disruptive swap;
- drag the browser between displays and toggle system HDR where supported;
- force device loss/fallback where practical;
- verify that explicit Chrome Proof and final exports remain unchanged.

Physical display observations belong in a dated validation log. Generated screenshots, traces, and reports belong under ignored `codebase/output/` unless deliberately curated into documentation.

## 9. Delivery sequence

### Milestone 1: Instrument and protect correctness

- Establish benchmark fixtures and performance harness.
- Add request/render/scope generation identifiers and timing diagnostics.
- Establish CPU/GPU parity tests and approve tolerances.
- Cache capability probing.

**Exit gate:** repeatable baseline plus no stale preview/scope application.

### Milestone 2: Make the GPU result the fast settled preview

- Implement the interaction-aware scheduler.
- Retain the GPU surface in HDR and SDR grading.
- Stop automatic encoded settling in default mode.
- Reuse WebGPU resources and avoid unchanged reconfiguration.
- Add the high-quality preference and display-aware proxy selection.

**Exit gate:** visual preview budgets pass and exports remain invariant.

### Milestone 3: Deliver instant scopes

- Implement priority peak/highlight feedback.
- Add GPU interactive scope reduction where supported.
- Vectorize and compact the backend fallback.
- Cache rasterization resources and remove repeated sort/allocation work.
- Add freshness/status UI and scope-tier tests.

**Exit gate:** interactive and settled scope budgets pass without image-frame regression.

### Milestone 4: Reduce proxy, fallback, load, and memory costs

- Validate and adopt RGBA16F proxy transport.
- Add the raw RGBA8 CPU preview fallback.
- Optimize Apple HDR HEIC transforms and intermediate allocations.
- Add byte-budgeted caches and per-key single-flight computation.
- Move overlays/comparison and inactive-lane work into the new priority model.

**Exit gate:** loading, payload, and steady-state memory goals pass.

### Milestone 5: Cross-platform hardening and documentation

- Run automated and manual matrices.
- Resolve or document device-specific fallbacks.
- Update user, technical, troubleshooting, traceability, and testing documentation.
- Record final before/after results and remaining limitations.

**Exit gate:** all P0 requirements and release gates pass; remaining P1 exceptions are explicitly approved and documented.

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| GPU and CPU math diverge in highlights or color. | Make parity tests a prerequisite to authority; share constants/order; retain guarded per-operation fallback. |
| Half-float loses extreme range or near-black precision. | Validate representative/extreme fixtures, scale reversibly where safe, and fall back to float32 per source. |
| Approximate scopes miss small hot pixels. | Prioritize max-preserving analysis/peak reduction, label scope tier, and validate tiny-highlight fixtures. |
| GPU scope readback stalls rendering. | Use asynchronous reusable buffers, small packed payloads, throttling, and image-first scheduling. |
| High-quality mode causes memory pressure or device loss. | Cap resolution by device limits, use byte budgets, release old levels before allocation, and fall back non-disruptively. |
| CPU fallback remains slow for SDR. | Use the smaller proxy, vectorized work, raw canvas transport, cancellation, and retained last-valid frames. |
| Background refinement creates churn with no visible value. | Keep it optional, idle-only, generation-checked, measurable, and removable if it does not improve parity or displayed detail. |
| Performance tests are noisy across machines. | Gate against a named benchmark setup, use p95 over repetitions, retain raw run metadata, and use relative comparisons elsewhere. |

## 11. Definition of done

This sprint is complete when:

- all P0 requirements are implemented and their acceptance budgets pass;
- **High-quality preview** is available, defaults off, persists per device, and cannot change export output;
- WebGPU grading settles without an encoded backend preview request in supported routine states;
- interactive scope feedback is visible within the target budget and settled scopes follow without blanking or stale application;
- peak/highlight behavior is covered by deterministic tests suitable for white/nit-point grading;
- CPU/GPU preview parity is measured and within the approved envelope;
- no-WebGPU grading avoids routine PNG/AVIF encode/decode settling;
- HEIC ready time improves by at least 35% on the benchmark fixture or an evidence-backed exception is approved;
- proxy payload and app-managed steady-state memory targets pass or guarded fallbacks are documented;
- the performance harness, automated correctness tests, and manual validation procedure are committed in their canonical locations;
- final before/after measurements and platform limitations are recorded durably;
- user-facing and technical documentation accurately describe preview quality, scope freshness, fallbacks, and export invariance.

## 12. Post-sprint opportunities

The following work is intentionally deferred until measurements show it is necessary:

- viewport-tiled full-resolution authoring at 100% zoom;
- an explicit full-source/high-resolution analysis command;
- adaptive automatic quality selection using measured GPU time and memory pressure rather than a user preference alone;
- worker-based or WebAssembly CPU image math in browsers without WebGPU;
- WebCodecs-based preview transport where platform support and color/HDR behavior are proven;
- deeper HEIF decoder replacement or native SIMD/GPU decode;
- user-configurable scope quality beyond the single high-quality preview preference.
