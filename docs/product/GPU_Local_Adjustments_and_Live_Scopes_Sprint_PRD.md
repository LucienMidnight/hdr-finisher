# GPU Local Adjustments and Live Scopes Sprint

**Date:** August 14, 2026  
**Last updated:** August 14, 2026  
**Status:** In progress — Phases 0–3 implemented and validated; Phase 4 is next  
**Owner:** HDR Finisher engineering  
**Implementation commits:** `99e2395` (Phases 0/1), `fc929e6` (Phase 2)  
**Related plan:** [Interactive Preview, Instant Scopes, and Image Pipeline Performance Sprint](Interactive_Preview_and_Scopes_Performance_Sprint_PRD.md)  
**Related product requirements:** [HDR Finisher PRD v1.2](HDR_Finisher_PRD_v1.2.md)  
**Validation records:** [Phase 0/1 validation](../testing/GPU_Local_Adjustments_Phase_0_1_Validation_2026-08-14.md), [Phase 2 validation](../testing/GPU_Local_Adjustments_Phase_2_Validation_2026-08-14.md), [Phase 3 validation](../testing/GPU_Local_Adjustments_Phase_3_Validation_2026-08-14.md)

## 1. Sprint outcome

Make local adjustments—starting with Luma masks—feel immediate while keeping scopes live and preserving exact export behavior.

The governing architecture is:

> Parameters are authoritative; preview pixels are disposable. During interaction, preview pixels and supported masks stay on the GPU.

The browser retains a non-destructive GPU preview graph. Python/NumPy remains the authoritative reference, export, proof, and fallback implementation. Ordinary Luma opacity and feather input no longer travels through the old CPU → HTTP mask → JavaScript expansion → GPU upload loop.

Phases 0–3 have achieved the retained local-preview and GPU live-scope portions of this outcome on the benchmark workstation:

- Luma Opacity p95 improved from 39.8 ms to 4.8 ms.
- Luma Feather p95 improved from 80.8 ms to 4.8 ms.
- A 30-event back-and-forth Feather drag reaches its final visible preview in 5.8 ms.
- Measured Phase 2 Luma interactions issue zero draft or committed mask HTTP requests.
- Scopes remain live and generation ordered during local interaction.
- Histogram, waveform, and vectorscope analysis now comes from the current authored GPU output with compact reusable readback; interactive scope p95 is 25.8 ms and sustained rapid drags present 18–19 updates per second.
- The Stage 3 browser run issued zero backend scope requests and GPU/CPU scope parity stayed within 0.21% distribution error and 0.03% peak error.
- CPU/export behavior, WebGPU fallback, and existing Brush/Gradient behavior remain intact.

The overall sprint is not complete. Phases 4 and 5 remain for mask-graph generalization and release hardening.

## 2. Implementation status and handoff

| Phase | Status | Exit-gate result | Durable evidence |
|---|---|---|---|
| Phase 0 — Reproduce and instrument | Complete | Baseline reproduced with queue, transport, CPU mask, GPU, presentation, scope, generation, and environment attribution | Phase 0/1 validation record |
| Phase 1 — Remove avoidable work | Complete | Luma Opacity 6.2 ms p95 at 962 px; zero mask requests; live scopes | Commit `99e2395` |
| Direction-reversal stability follow-up | Complete | 30 increasing preview serials, 10 increasing scope generations, zero mask requests, no stale presentation | Commit `99e2395` |
| Phase 2 — GPU Luma qualification and feathering | Complete | Luma Feather 4.8 ms p95; final drag propagation 5.8 ms; no CPU mask transport | Commit `fc929e6` |
| Phase 3 — GPU-backed live scopes | Complete | 25.8 ms isolated presentation p95; 18–19 Hz rapid-drag cadence; zero backend scope requests; image preview remained within budget | Phase 3 validation record |
| Phase 4 — Generalize the mask graph | Not started | Required: consistent retained architecture for Luma, Brush, and Gradient | Future phase |
| Phase 5 — Hardening and release evidence | Partially covered, not complete | Phase-specific regression/fallback evidence exists; full release matrix remains | Future phase |

The working tree intentionally contains this uncommitted PRD update. Do not assume unrelated modified QA images or untracked design assets belong to this sprint.

## 3. Product and architecture decisions

### 3.1 Decisions retained from the original plan

1. **Scopes remain live during adjustments.** Interactive scopes may use reduced precision, resolution, or cadence, but they must not pause, clear, or disappear. Higher-precision scopes replace them after the interaction settles.
2. **The preview is multi-tiered.** Interaction favors latency; a short idle period permits full-preview and scope refinement; CPU/reference work runs only for validation, fallback, proofing, export, or an unsupported GPU operation.
3. **Opacity is influence, not mask geometry.** Mask opacity, local-adjustment opacity, and pixel-local grade values update uniforms/buffers and redraw. They do not regenerate a simple Luma, Brush, or Gradient mask.
4. **Feathering is a reusable mask-refinement stage.** It operates on a cached base mask and reruns only the refinement passes.
5. **GPU residency is the default supported interaction path.** Avoid image-sized readback and per-input image or mask transport.
6. **CPU/export remains authoritative.** Interactive optimization must not redefine export color, mask semantics, ordering, proofing, or persistence.
7. **Correctness outranks implementation novelty.** Existing WebGPU render-pass machinery is preferred when it meets the measured budget.

### 3.2 Decisions made during implementation

#### Separate spatial mask identity from influence

Simple mask leaves now cache unit-opacity spatial coverage. `mask_opacity` is excluded from their cache identity and is supplied independently to the WebGPU local-grade shader and Canvas fallback overlay. Local-adjustment opacity is likewise a scalar parameter. This is the central Phase 1 invalidation fix.

Boolean mask expressions deliberately retain exact per-leaf opacity semantics and remain on the exact CPU mask path. Flattening those expressions into the simple-leaf optimization would change mask algebra, so it was not done.

#### Use the fixed ACEScg proxy as the Luma source

The Luma selector is derived from the fixed geometry-transformed HDR/ACEScg proxy, never from pixels after local grading. HDR and SDR display lanes therefore select the same scene content, and changing local order or grade values cannot move Luma selection boundaries.

#### Retain full-resolution floating-point Luma masks

Phase 2 uses full active-preview resolution (`962 × 541` in the benchmark) for scene luminance, qualification, and Feather refinement. No interactive mask downsampling tier was added because full-resolution refinement already meets the latency goal and 100% Feather remains within the approved parity envelope. Adding adaptive resolution would create an interactive-to-settled transition and extra parity risk without a measured benefit.

#### Use render passes, not a new compute pipeline

The separable Feather implementation extends the renderer's existing full-screen render-pass infrastructure. It uses one horizontal and one vertical refinement pass. This met the 4.8 ms p95 gate, so a compute-shader rewrite was not justified. Compute remains an option for later reductions, very large masks, or GPU scopes if measurements show a material advantage.

#### Preserve exact CPU fallback boundaries

Standalone, default-geometry Luma masks use the retained GPU path. Brush, Gradient, Boolean masks, non-default geometry, unsupported local-grade combinations, WebGPU-unavailable cases, and device loss continue through their existing CPU/fallback behavior. This bounded rollout preserves behavior while avoiding a risky mask-system rewrite.

#### Treat generations as presentation ownership

Preview, mask, and scope results are accepted only when their generation, edit revision, selected-local identity, and relevant signature still match current UI state. A render receives immutable snapshots of global adjustments and locals before asynchronous resource acquisition. An older request may finish, but it cannot mutate or present resources owned by a newer frame.

#### Keep scope work behind image presentation

Phase 3 renders a compact analysis texture from the same current GPU film/spatial textures as the visible preview. Two-buffer reusable pools provide asynchronous readback with backpressure; the last valid scope stays visible while busy, and generation checks reject obsolete results before presentation. The exact CPU scope path remains available for unsupported geometry, proof, comparison, and WebGPU fallback.

## 4. Original baseline and reproduced Phase 0 baseline

The pre-sprint Edge/WebGPU observations at a representative 962 px preview were:

| Operation | Original median | Original p95 / representative tail |
|---|---:|---:|
| Global adjustment frame propagation | 2.3–3.2 ms | 4.4–5.3 ms |
| Luma Opacity overlay propagation | 32.8 ms | 36.0 ms |
| Luma Opacity final committed image | 41 ms | — |
| Luma Feather overlay propagation | 76.7 ms | 94.1 ms |
| Luma Feather final committed image | 89 ms | — |
| Backend unfeathered mask compile | 9.9 ms | — |
| Backend blur alone | 38.1 ms | — |
| Backend full mask compile at 50% Feather | 50 ms | — |
| Heavy Brush overlay baseline | 0.6 ms | — |
| Brush post-process | 27.9 ms | — |
| Brush final commit | 67 ms | — |

Feather compile cost rose materially with preview edge length:

| Long edge | Approximate CPU compile time |
|---:|---:|
| 384 px | 6.1 ms |
| 512 px | 16.1 ms |
| 640 px | 22.7 ms |
| 768 px | 42.1 ms |
| 962 px | 51 ms |

The repeatable Phase 0 harness reproduced the product-level behavior at 962 px:

| Interaction | Phase 0 median | Phase 0 p95 |
|---|---:|---:|
| Luma Opacity → preview | 34.4 ms | 39.8 ms |
| Luma Opacity → scope | 33.6 ms | 37.5 ms |
| Luma Feather → preview | 76.2 ms | 80.8 ms |
| Luma Feather → scope | 33.0 ms | 34.4 ms |
| Scheduler queue | 0.8 ms | 4.2 ms |
| WebGPU queue completion | 1.7 ms | 3.0 ms |

The bottlenecks were:

- a fixed 16 ms draft delay before useful work;
- full mask regeneration for opacity-only changes;
- CPU floating-point blur requiring 12 full-image passes;
- serialized request coalescing that let obsolete work delay the latest state;
- local controls not fully integrated with the interaction scheduler;
- scope and refinement work competing with preview freshness;
- mutable state observed by asynchronous rendering and incomplete stale-scope admission checks.

## 5. Performance and behavior goals

### 5.1 Primary budgets

| Result | Target | Current status |
|---|---:|---|
| Input to newly presented local-adjustment preview | ≤30 ms p95 | Passed for Luma Opacity and Feather |
| Stretch goal for uniform-only changes | ≤16.7 ms p95 | Passed for Luma Opacity |
| Live interactive scope cadence | one update every 30–60 ms when device permits | Passed in Phase 3: 25.8 ms isolated p95 and 18–19 Hz rapid-drag cadence |
| Settled full-preview replacement | within 100–200 ms after input ends | Passed for supported GPU Luma; no distinct replacement frame is required |
| Settled higher-precision scopes | within 100–250 ms after input ends | Passed; 256 × 256 compact settled analysis replaces the reduced interactive tier |
| Stale preview or scope applied | 0 | Passed in Phase 1/2 instrumentation |

If the machine cannot sustain both maximum image rate and maximum scope rate, image presentation has priority. Scopes must degrade gracefully rather than stop, with a practical lower bound of 15 Hz and the last valid scope continuously visible.

### 5.2 Correctness goals

- Preserve HDR/WCG range, transfer-function, and color-space behavior.
- Use the same Luma qualification, edge extension, Feather mapping, normalization, and operation order in CPU and GPU implementations.
- Keep observable CPU/GPU parity within the approved envelope.
- Produce no visible jump between interactive and settled results.
- Keep WebGPU-unavailable and device-loss fallback functional.
- Do not regress Brush, Gradient, Path, overlays, comparison, HDR/SDR lanes, proof, history, or export.

## 6. Implemented retained preview graph

The supported Luma path now behaves as this retained graph:

1. **Source/proxy texture:** cached by session, lane, and long edge; proxy fetches are single-flight.
2. **Scene-luminance texture:** cached `rgba16float`, derived from the fixed HDR/ACEScg proxy using AP1 weights `(0.2722287, 0.6740818, 0.0536895)`.
3. **Luma base mask:** cached `rgba16float` EV trapezoid generated by a qualification render pass.
4. **Mask refinement:** two reusable full-resolution `rgba16float` targets for horizontal and vertical Feather passes; inversion is applied at the end of refinement.
5. **Influence:** mask opacity and local opacity supplied as scalar parameters, outside spatial identity.
6. **Local grade:** supported pixel-local grades sample the retained mask between the global base pass and Film Look.
7. **Display and overlay:** the selected Luma overlay and local grade sample the same retained mask texture.
8. **Scopes:** histogram, waveform, vectorscope, peak, clipping, and statistics analyze a compact render from the same current GPU output resources. Interactive and settled tiers use reusable asynchronous readback buffers; unsupported paths retain the authoritative CPU implementation.

### 6.1 Dependency invalidation actually enforced

| Parameter or event | Invalidation behavior |
|---|---|
| Simple mask opacity | Uniform/overlay-alpha update and redraw only |
| Local-adjustment opacity | Uniform update and redraw only |
| Supported pixel-local grade value | Parameter-buffer update and redraw only |
| Luma range/refined range | New Luma base identity; regenerate base and dependent refinement |
| Luma Feather | Reuse cached base; rerun horizontal/vertical refinement only |
| Luma inversion | Reuse cached base; rerun/refinalize refinement output |
| Source/session replacement | Destroy proxy, luminance, local-mask, intermediate, and parameter resources |
| Proxy edge change | Select/create the matching proxy/luminance/mask level; stale levels are bounded |
| Simple Brush/Gradient geometry | Existing spatial-mask path and cache identity apply |
| Boolean expression or unsupported geometry | Exact CPU mask path remains authoritative |

### 6.2 Luma semantics

- Scene luminance is computed from the fixed ACEScg source and converted to EV as `log2(max(Y, 1e-8) / 0.18)`.
- Qualification reproduces the CPU four-handle trapezoid: rising ramp, full region, and falling ramp.
- Feather is evaluated after qualification and before expression inversion and mask opacity.
- The UI Feather value is clamped to its existing `0.05` range, normalized, and mapped to the CPU semantic sigma `0.09 × amount × dimension` independently for X and Y.
- Each separable pass uses a bounded 25-tap Gaussian approximation with clamped edge sampling.
- Zero Feather can use the base mask directly when inversion is not requested.
- The overlay and grade consume the same spatial result, preventing overlay/image disagreement.

### 6.3 Resource ownership and cancellation

- Scene-luminance generation is single-flight per session and long edge.
- Local Luma masks are keyed by session, local ID, edge, and base-mask identity.
- Each entry owns the base, horizontal, and refined texture plus reusable parameter buffers.
- The renderer checks current-generation ownership after asynchronous proxy acquisition and before changing a refinement target.
- GPU diagnostics report mask events, whether scene luminance/base/refinement work ran, encode/submit time, retained texture counts, and retained byte estimates.
- Instrumentation is opt-in; normal authoring does not pay timestamp-query or readback overhead.
- Caches remain bounded by the existing 96 MiB preview / 160 MiB large-preview local-mask budgets.

### 6.4 CPU responsibilities retained

Python/NumPy continues to own:

- file decode and encode;
- metadata, project/history serialization, and session state;
- robust click/drag source sampling with low-precision averaging and outlier rejection;
- authoritative export color management and delivery rendering;
- exact reference masks and differential tests;
- proofing and unsupported-operation rendering;
- fallback rendering when WebGPU is unavailable, fails initialization, or is lost.

## 7. Phase-by-phase implementation record

### 7.1 Phase 0 — Reproduce and instrument

Implemented a repeatable Edge/Playwright benchmark for isolated Luma Opacity and Feather changes, 30-event rapid drags, direction reversals, settled propagation, and concurrent scope updates.

The harness records:

- input, scheduler queue, preview, mask-overlay, and scope presentation timestamps;
- preview serials and scope generations;
- draft-mask, committed-mask, scope, and edit-command request counts;
- backend CPU mask time through `X-CPU-Mask-Ms`;
- mask/scope transport duration and request cancellation;
- WebGPU mask acquisition, command submission, queue completion, and optional timestamp-query time;
- current draft-local scope payloads and rendered-scope content fingerprints;
- source fixture, preview/scope resolution, browser, viewport, adapter, cache entries/bytes, stale results, and browser errors.

The frontend exposes read-only snapshots through `HDRFinisherPerformance` and emits generation-aware presentation events for the harness. GPU timing is opt-in. Edge exposed `timestamp-query`, but returned zero-valued samples on the benchmark machine, so wall-clock presentation, queue completion, transport, and backend timing are the authoritative measurements.

Phase 0 also established the observable browser parity envelope:

- mean absolute channel error ≤0.75% of full scale;
- p95 channel error ≤2.5%;
- pixels differing by more than eight code values ≤4.5%.

### 7.2 Phase 1 — Remove avoidable work

Implemented:

- unit-opacity spatial caching for simple Luma, Gradient, and Brush leaves;
- mask opacity and local opacity as WebGPU buffer values and Canvas overlay alpha;
- retained backend spatial-mask caches across ordinary adjusted-frame invalidation;
- shared preview-scheduler participation for local opacity and supported local-grade controls;
- immediate/rAF-coalesced draft scheduling with no fixed 16 ms delay;
- active-request cancellation plus one latest pending state instead of a serialized backlog;
- admission checks for generation, revision, selected local, and mask signature;
- live reduced-resolution scope requests carrying the current uncommitted local stack;
- last-valid-scope retention while new scope work is pending;
- Brush overlap protection so a stale intermediate preview is not scheduled during a newer gesture.

Phase 1 results at 962 px:

| Interaction | Phase 0 p95 | Phase 1 p95 | Result |
|---|---:|---:|---|
| Luma Opacity → preview | 39.8 ms | **6.2 ms** | Exit gate passed |
| Luma Opacity → scope | 37.5 ms | 32.1 ms | Live; draft content verified |
| Luma Feather → preview | 80.8 ms | 85.9 ms | Correctly remained visible as Phase 2 bottleneck |
| Luma Feather → scope | 34.4 ms | 41.1 ms | Live |
| Scheduler queue | 4.2 ms | 4.4 ms | Fixed delay removed; p95 remained bounded |
| WebGPU queue completion | 3.0 ms | 3.5 ms | Stable |

Rapid-drag request behavior:

| 30-event drag | Phase 0 | Phase 1 |
|---|---:|---:|
| Opacity draft masks | 7 | **0** |
| Opacity committed masks | 2 | **0** |
| Opacity scope requests | 2 | **11** |
| Feather draft masks | 8 | **1** |
| Feather scope requests | 2 | **7** |

### 7.3 Direction-reversal flicker correction

Manual testing after the first Phase 1 pass found visible preview flicker and matching histogram jumps while reversing a held local-adjustment slider. One-direction motion was less likely to expose it because reversals create more superseded requests and out-of-order completions.

The problem was generation ownership, not mask math:

1. The scope client treated every HTTP 409 as an edit conflict.
2. Intentional stale-scope cancellation also returns 409.
3. That path could reload committed locals over the active optimistic gesture.
4. Scope admission validated the generation echoed by a response but did not prove it was still the newest presentation serial.
5. An asynchronous GPU frame could observe later mutations to the adjustment/local object graph unless it owned a snapshot.

The fix:

- distinguishes expected stale cancellation from a true edit-revision conflict;
- does not reload committed state for stale-scope cancellation;
- preserves the active optimistic local stack during a real revision refresh;
- rejects any scope generation older than the current normalized presentation serial;
- snapshots global adjustments and locals for each GPU submission.

The triangular 30-input opacity validation recorded 30 strictly increasing preview serials, 10 strictly increasing scope generations, nine distinct scope fingerprints, zero mask requests, and 8.9 ms isolated Opacity p95. No stale image or scope was presented.

### 7.4 Phase 2 — GPU Luma qualification and feathering

Implemented:

- a retained `rgba16float` scene-luminance texture derived once per active proxy;
- a dedicated GPU qualification pass matching the CPU EV trapezoid;
- a Luma base-mask identity excluding mask opacity, Feather, and inversion;
- two reusable full-resolution floating-point refinement targets;
- separable horizontal/vertical Gaussian render passes;
- direct GPU overlay composition from the same texture used by the grade;
- a current-render callback that blocks stale generations before refinement mutation;
- single-flight proxy/luminance acquisition and mask-resource diagnostics;
- exact CPU/fallback routing for masks and grades outside the bounded GPU Luma path.

Phase 2 results at 962 px:

| Interaction | Median | p95 | Result |
|---|---:|---:|---|
| Luma Opacity → preview | 4.6 ms | **4.8 ms** | Pass |
| Luma Opacity → GPU overlay | 4.6 ms | **4.8 ms** | Pass |
| Luma Feather → preview | 4.6 ms | **4.8 ms** | Pass |
| Luma Feather → GPU overlay | 4.6 ms | **4.8 ms** | Pass |
| Luma Feather → live scope | 26.9 ms | **28.6 ms** | Live; six distinct isolated fingerprints |
| GPU mask acquisition/encoding | 0.0 ms | 0.1 ms | No CPU mask transport |
| GPU queue completion | 1.5 ms | 4.4 ms | Stable |

The final 30-event back-and-forth Feather drag reached preview in 5.8 ms and the next current scope in 56.4 ms. It produced 30 strictly increasing preview serials, nine strictly increasing scope generations, nine distinct scope fingerprints, and 11 live-scope requests, nine of which carried the uncommitted local stack. It issued zero mask HTTP requests.

After 103 instrumented GPU-mask events, the retained graph held one scene-luminance texture and two Luma base/refinement sets, totaling 24,981,312 local-mask bytes. The two sets represented the initial broad mask and the narrowed benchmark mask. No WebGPU validation or page error occurred.

### 7.5 Phase 3 — GPU-backed live scopes

Implemented:

- a compact `rgba16float` analysis render sourced from the current retained film and spatial textures;
- histogram, waveform, vectorscope, peak, clipping, percentile, and guide generation from that compact authored output;
- reduced interactive sampling and 256 × 256 settled sampling;
- two reusable readback buffers per scope geometry with asynchronous mapping and intentional backpressure;
- image-first submission: scope mapping never blocks visible preview presentation;
- generation, lane, and mode admission checks before scope presentation;
- last-valid-scope retention when both readback buffers are occupied;
- exact CPU fallback for unsupported geometry, proof/comparison states, and unavailable WebGPU;
- separate encode, readback, unpack, total, transport, resource, freshness, and source instrumentation;
- Edge GPU/CPU parity coverage for histogram, waveform, and vectorscope.

Phase 3 results at 962 px preview resolution:

| Measurement | Median | p95 / result |
|---|---:|---:|
| Luma Opacity → scope | 22.6 ms | **25.0 ms** |
| Luma Feather → scope | 24.4 ms | **25.8 ms** |
| Compact GPU scope total | 8.0 ms | **12.0 ms** |
| GPU readback | 5.6 ms | **9.8 ms** |
| GPU unpack | 1.5 ms | **3.8 ms** |
| Rapid Opacity drag | — | 11 presentations / 570.7 ms; final scope 52.3 ms |
| Rapid Feather drag | — | 10 presentations / 541.0 ms; final scope 22.4 ms |
| Backend scope transport | — | **0 requests** |

Preview p95 stayed at 6.1 ms for Opacity and 3.4 ms for Feather in the isolated run. Rapid-drag preview serials and scope generations were strictly increasing, the last valid scope remained visible under backpressure, and no browser or WebGPU error occurred. GPU/CPU parity measured 0.03% worst peak error and 0.21% worst normalized distribution/centroid error across all three scope modes.

## 8. Benchmark environment and method

| Item | Value |
|---|---|
| Browser | Microsoft Edge 151.0.4129.78, headless |
| OS | Windows |
| GPU | NVIDIA Lovelace adapter |
| Viewport | 1440 × 1000, DPR 1 |
| Fixture | `hdr_delivery_proof_pattern.tiff`, 1280 × 720 float32 working image |
| Working space | ACEScg |
| Preview | 962 px interactive and settled long edge |
| Interactive scopes | 384 px long edge |
| Phase 0/1 isolated samples | Opacity 10, Feather 6 |
| Rapid drag | 30 input events over approximately 0.51 seconds |
| Percentiles | Ascending sort, index `floor((n - 1) × percentile)` |

Phase 0 was recorded at `2026-08-14T07:37:19.005Z`; the final Phase 1 run at `2026-08-14T08:19:43.026Z`. Generated JSON is retained locally under `codebase/output/performance/`. Those ignored files are reproducible evidence; the dated validation records are the durable conclusions.

## 9. Correctness, parity, and preservation evidence

### 9.1 Phase 1 broad preview parity

The direct GPU/CPU canvas sweep passed 129 HDR/SDR cases:

| Metric | Result | Limit |
|---|---:|---:|
| Worst mean absolute channel error | **0.0289%** | 0.75% |
| Worst p95 channel error | **0.3922%** | 2.5% |
| Pixels over eight code values | **0%** | 4.5% |

The harness compares canvas bitmaps directly. DOM screenshots are unsuitable for numerical parity because UI chrome can overlap the canvas and contaminate the sample.

Deterministic simple Luma, Gradient, and Brush spatial masks are also compared with authoritative float CPU influence and remain within one `r8unorm` code step after mask opacity is applied.

### 9.2 Phase 2 Luma Feather parity

The Phase 2 direct-canvas sweep compares 0%, 25%, 50%, and 100% Luma Feather at `962 × 541` against CPU `preview-raw` output carrying the same draft local stack:

| Worst metric | Result | Limit |
|---|---:|---:|
| Mean absolute channel error | **0.7230%** | 0.75% |
| p95 channel error | **2.3529%** | 2.5% |
| Pixels over eight code values | **1.5660%** | 4.5% |

Zero Feather is effectively exact in the observable comparison. The 100% Feather case is limiting but passes every approved threshold. Because interactive and settled preview use the same full-resolution retained texture, there is no approximation-resolution handoff or replacement jump.

### 9.3 Regression and fallback results

- Full Python suite: **427 passed, 2 warnings** after Phase 2.
- JavaScript syntax checks passed for the app, renderer, scheduler-related interaction tests, benchmark, and parity tool.
- Luma interaction passed, including GPU-resident overlay behavior and sampling.
- Local-adjustment interaction passed for Brush, Gradient, Luma, and Path with live scopes.
- Brush passed paint, erase, Shift Edge, Feather, opacity, inversion, bypass, and overlapping-commit checks.
- Gradient passed geometry, midpoint, fan, Luma refinement, zoom alignment, and overlay checks.
- Forced no-WebGPU smoke testing remained `Settled`, with no page errors; sampled frame p95 was 3.0 ms and scope p95 was 5.8 ms on the small deterministic fixture.
- Export/proxy invariance passed: exercising a 256 px interactive proxy and Luma mask before a 512 px authoritative render produced an array-identical result to a fresh authoritative render.
- No stale preview or scope presentation was observed in the measured Phase 1/2 runs.

Expected 409 responses can appear in high-quality/fallback console output when a newer generation intentionally supersedes older work. They are cancellation signals, not necessarily edit conflicts. They must never blank the image/scopes or reload committed state over an active gesture.

Browser interaction suites should run serially against the default in-memory session limit. Concurrent independent suites can evict one another's sessions and produce intentional 404 responses unrelated to product behavior.

## 10. Delivery plan

### Phase 3 — GPU-backed live scopes — complete

The reduced-resolution CPU scope bridge was replaced on the supported WebGPU path. The CPU implementation remains the exact fallback and reference.

Delivered:

- histogram, waveform, vectorscope, peak, and clipping analysis from the same current GPU output texture used for visible preview;
- reduced bins/sample density during interaction;
- compact asynchronous readback using reusable buffers;
- explicit generation/revision rejection before scope presentation;
- preview-first submission order with no scope wait on image presentation;
- a higher-precision settled scope after approximately 100–150 ms idle;
- graceful cadence reduction under load while preserving the last valid scope.

The benchmark measures queue delay, GPU analysis/submission, map/readback time, presentation freshness, stale rejection, resource reuse, and image-path impact separately.

**Exit gate: passed.** Scopes remained visible, updated at 18–19 Hz during rapid drags, and reached 25.8 ms isolated p95 while image preview stayed within budget and no stale scope was applied.

### Phase 4 — Generalize the mask graph

- Apply mask-source/refinement/influence separation to all supported Brush and Gradient configurations.
- Add incremental Brush rasterization or dirty-region updates where measurement justifies the complexity.
- Add GPU Boolean mask operations only where product behavior requires them and exact per-leaf opacity semantics are preserved.
- Share scheduling, cache, diagnostics, and differential-test infrastructure across local-adjustment types.
- Address mask texture packing/batching before signing off the 16/32/64-local-layer performance targets.

**Exit gate:** Luma, Brush, and Gradient use a consistent retained-mask architecture without performance or correctness regression.

### Phase 5 — Hardening and release evidence

- Validate device loss, unsupported adapters, proxy changes, zoom/resize, HDR/SDR switching, overlays, comparison, undo/redo, proof, export, and long-running editing.
- Expand differential CPU/GPU cases across black, near-black, reference white, saturated HDR, 1,000/4,000/10,000 nit values, narrow Luma ranges, broad Feather transitions, and source edges.
- Measure GPU-memory stability across repeated edits, source changes, proxy levels, and many local layers.
- Publish final before/after median and p95 results with environment metadata.
- Update architecture, testing, troubleshooting, and user documentation.

**Exit gate:** automated gates pass, fallbacks are demonstrated, final evidence is recorded, and no correctness exception is hidden behind an interactive approximation.

## 11. Test inventory and remaining gaps

| Required coverage | Current state |
|---|---|
| Opacity changes do not regenerate/upload a mask | Implemented and measured: zero requests |
| Luma-range invalidation affects base and downstream stages | Implemented and instrumented |
| Feather reuses cached base | Implemented and instrumented |
| Rapid input coalesces; obsolete generations never apply | Implemented, including reversal regression |
| Interactive scopes continue during local drags | Implemented on the GPU path at 18–19 Hz under measured load |
| Settled scopes replace interactive scopes only when current | Implemented with generation/lane/mode admission guards |
| GPU/CPU Luma qualification and Feather parity | Implemented for four Feather levels plus broad parity suite |
| Interactive/settled transition tolerance | Passed without adaptive resolution; same texture is retained |
| Brush and Gradient regression | Passing |
| No-WebGPU fallback | Passing smoke matrix |
| Device-loss recovery | Runtime listener/fallback retained; full destructive-device test remains Phase 5 |
| Long-running resource reuse and no validation errors | Initial diagnostics passing; expanded endurance remains Phase 5 |
| Export invariance | Automated proxy/cache invariant passing |
| GPU-backed scope numerical parity | Passing for histogram, waveform, and vectorscope |
| Many-local-layer scaling and batching | Not complete; Phase 4 |

## 12. Reproduction

From `codebase/`, start a fresh server and run browser suites serially:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.hdr_finisher.main:app --host 127.0.0.1 --port 8765
npm.cmd run test:gpu-local-adjustments -- --url http://127.0.0.1:8765 --phase phase2-final
npm.cmd run test:gpu-scopes -- --url http://127.0.0.1:8765
$env:HDR_FINISHER_URL = "http://127.0.0.1:8765"
node tools/playwright_gpu_parity.js test-pattern output/performance/gpu-local-phase2-parity-962-local --local-luma-only
npm.cmd run test:luma-mask
npm.cmd run test:local-adjustments
npm.cmd run test:brush-mask
npm.cmd run test:gradient-mask
npm.cmd run test:performance -- --url http://127.0.0.1:8765 --inputs tests/fixtures/hdr_headroom.tiff --repetitions 2 --memory-repetitions 3
.\.venv\Scripts\python.exe -m pytest -q tests
```

Phase-specific benchmark commands remain available:

```powershell
npm.cmd run test:gpu-local-adjustments -- --url http://127.0.0.1:8765 --phase phase0
npm.cmd run test:gpu-local-adjustments -- --url http://127.0.0.1:8765 --phase phase1
npm.cmd run test:gpu-local-adjustments -- --url http://127.0.0.1:8765 --phase phase2-final
npm.cmd run test:gpu-local-adjustments -- --url http://127.0.0.1:8765 --phase phase3-final
```

Generated JSON belongs under ignored `codebase/output/performance/`. Durable results belong in dated documents under `docs/testing/`.

## 13. Out of scope

This sprint does not require:

- moving authoritative export to the GPU;
- rewriting the complete preview pipeline;
- reducing final export precision or color accuracy;
- stopping or clearing scopes during interaction;
- full-resolution source analysis on every input event;
- compute shaders when existing render passes meet the budget;
- adaptive mask downsampling without a measured need and parity evidence;
- unrelated UI redesign beyond status needed to communicate preview/scope freshness or fallback.

## 14. Deliverables

| Deliverable | Status |
|---|---|
| GPU-resident Luma qualification and Feather | Complete |
| Uniform-only opacity and supported grade updates | Complete |
| Interaction-aware latest-generation scheduling | Complete |
| Live interactive scopes with current draft state | Complete on supported GPU path; exact CPU fallback retained |
| GPU-backed interactive and settled scope tiers | Complete |
| CPU/GPU differential and regression tests | Complete through Phase 3, including all three scope modes |
| Edge/Playwright performance harness | Complete |
| Before/after Phase 0/1, Phase 2, and Phase 3 reports | Complete |
| General retained mask graph for Brush/Gradient/Boolean | Pending Phase 4 |
| Final release hardening and documentation | Pending Phase 5 |

## 15. Definition of done

The sprint will be done when:

- representative Luma Opacity and Feather interactions remain ≤30 ms p95, or a measured device-specific exception is documented with graceful behavior;
- scopes remain live during every supported local interaction and settle to higher precision afterward;
- GPU-backed scope analysis meets cadence and freshness gates without delaying image presentation;
- mask opacity and local opacity do not trigger mask recompilation;
- the supported interactive path performs no routine image-sized CPU round-trip or GPU readback;
- current-generation preview and scope results cannot be replaced by stale work;
- CPU/GPU mask, grade, and scope parity pass their approved thresholds;
- Brush, Gradient, Path, HDR/SDR lanes, overlays, comparison, history, proof, and export tests pass;
- WebGPU fallback and device-loss recovery are demonstrated;
- memory/resource stability and many-local-layer behavior are signed off;
- final performance results and remaining limitations are recorded in the repository.

As of this update, the local Luma preview, scheduling, stale-generation, parity, fallback, regression, and GPU-backed scope portions are complete through Phase 3. Generalized mask residency and final hardening remain open.

## 16. Implementation map for the next thread

| Area | Primary files |
|---|---|
| GPU preview graph, Luma textures, refinement, compact scope readback, diagnostics | `codebase/frontend/webgpu-preview.js` |
| Interaction scheduling, optimistic locals, GPU/CPU scope routing, scope admission, rendering | `codebase/frontend/app.js`, `codebase/frontend/preview-scheduler.js` |
| CPU mask semantics and authoritative reference | `codebase/backend/hdr_finisher/local_adjustments.py` |
| Preview/mask/scope API and cancellation headers | `codebase/backend/hdr_finisher/main.py` |
| Cache identity and invalidation | `codebase/backend/hdr_finisher/render_cache.py` |
| Performance and scope parity harnesses | `codebase/tests/performance/gpu-local-adjustments.js`, `codebase/tests/gpu-scope-parity.js` |
| GPU/CPU canvas parity | `codebase/tools/playwright_gpu_parity.js` |
| Browser behavior regressions | `codebase/tests/luma-mask-interaction.js`, `local-adjustments-interaction.js`, `brush-mask-interaction.js`, `gradient-mask-interaction.js` |
| Durable phase results | `docs/testing/GPU_Local_Adjustments_Phase_0_1_Validation_2026-08-14.md`, `GPU_Local_Adjustments_Phase_2_Validation_2026-08-14.md`, `GPU_Local_Adjustments_Phase_3_Validation_2026-08-14.md` |
