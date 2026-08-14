# GPU Local Adjustments Phase 0/1 Validation — 2026-08-14

This record covers Phase 0 instrumentation and Phase 1 opacity/scheduling work from the GPU Local Adjustments and Live Scopes sprint. CPU/export rendering remains authoritative. Phase 2 feather-kernel work has not started.

## Acceptance result

Phase 1 passes its Luma opacity exit gate at the measured 962-pixel preview size:

- isolated input-to-preview p95 is **6.2 ms**, below the 30 ms requirement;
- a 30-event opacity drag issues **zero** draft or committed mask requests;
- interactive scopes remain live, with 11 scope requests during a 508.6 ms drag (about 21.6 Hz), nine of which carried an uncommitted local stack;
- the final opacity input reaches the preview in 7.7 ms and a scope presentation in 5.2 ms;
- all 10 isolated opacity samples produced distinct rendered-scope fingerprints;
- no browser errors were recorded.

Luma Feather remains a Phase 2 target. Its isolated input-to-preview p95 is 85.9 ms because a structural mask change still requires the exact CPU feather compilation. The Phase 1 scheduler reduces a 30-event feather drag from eight draft requests to one latest-state request in this run, but it does not claim the final feather latency gate.

### Direction-reversal stability follow-up

A post-validation manual report exposed flicker when a held local slider reversed direction. The scope client treated every HTTP 409 as an edit conflict, including intentional stale-scope cancellation, and could reload committed locals over the optimistic gesture. Scope responses also validated only their echoed generation, not whether that generation was still the newest presentation serial.

The correction distinguishes stale cancellation from revision conflicts, preserves an active optimistic local during a real revision refresh, rejects any scope generation older than the current presentation serial, and gives each GPU submission an immutable adjustment/local snapshot. A 30-input triangular opacity gesture now records 30 strictly increasing preview serials and 10 strictly increasing scope generations, nine distinct scope fingerprints, zero mask requests, and 8.9 ms isolated opacity p95. The result is retained locally in `codebase/output/performance/gpu-local-adjustments-phase1-stability.json`.

## Benchmark environment and method

Both phases used the same deterministic setup:

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
| Isolated samples | Opacity 10, Feather 6 |
| Rapid drag | 30 input events over approximately 0.51 seconds |
| Percentiles | Ascending sort, index `floor((n - 1) * percentile)` |

Phase 0 was recorded at 2026-08-14T07:37:19.005Z. The final Phase 1 run was recorded at 2026-08-14T08:19:43.026Z. Generated JSON is retained locally at `codebase/output/performance/gpu-local-adjustments-phase0.json` and `gpu-local-adjustments-phase1.json`; these ignored artifacts are reproducible evidence, not the durable record.

The Phase 0 harness measured scope presentation freshness, but the baseline scope request path did not serialize uncommitted local values. That correctness gap was made explicit during Phase 1 validation. The final harness records draft-local scope payloads and a fingerprint of rendered scope data, while an API regression proves an uncommitted local stack changes the returned channels without changing the session edit document.

The browser exposed WebGPU `timestamp-query`, but Edge returned zero for every timestamp sample in this run. GPU timestamp values are therefore reported as unavailable; event-to-presentation wall-clock timing, queue completion, request transport, and backend CPU headers are the authoritative attribution sources for this record.

## Phase 0 instrumentation

The repeatable benchmark now records:

- input event, scheduler queue, preview presentation, mask presentation, and scope presentation times;
- draft-mask, committed-mask, scope, and edit-command request counts;
- backend mask CPU time through `X-CPU-Mask-Ms`;
- mask and scope transport duration;
- WebGPU mask wait, command submission, queue completion, and optional timestamp-query duration;
- source, resolution, viewport, browser, adapter, cache bytes/entries, stale results, cancellations, and browser errors.

The frontend exposes read-only performance snapshots through `HDRFinisherPerformance`, and emits generation-aware custom presentation events used by the harness. Instrumentation is opt-in for GPU timing so normal authoring does not pay query/readback overhead.

## Before/after measurements

| Interaction | Phase 0 median | Phase 0 p95 | Phase 1 median | Phase 1 p95 | Result |
|---|---:|---:|---:|---:|---|
| Luma opacity → preview | 34.4 ms | 39.8 ms | 3.5 ms | **6.2 ms** | Phase 1 gate passed |
| Luma opacity → scope | 33.6 ms | 37.5 ms | 30.0 ms | 32.1 ms | Live; draft content verified in Phase 1 |
| Luma feather → preview | 76.2 ms | 80.8 ms | 83.9 ms | 85.9 ms | Phase 2 bottleneck retained visibly |
| Luma feather → scope | 33.0 ms | 34.4 ms | 40.6 ms | 41.1 ms | Live, below 100 ms |
| Scheduler queue | 0.8 ms | 4.2 ms | 1.6 ms | 4.4 ms | Fixed 16 ms delay removed |
| WebGPU queue completion | 1.7 ms | 3.0 ms | 1.8 ms | 3.5 ms | Stable |

Rapid-drag request behavior changed as follows:

| 30-event drag | Phase 0 | Phase 1 |
|---|---:|---:|
| Opacity draft masks | 7 | **0** |
| Opacity committed masks | 2 | **0** |
| Opacity scope requests | 2 | **11** |
| Feather draft masks | 8 | **1** |
| Feather scope requests | 2 | **7** |

Across the final Phase 1 run, 46 scope requests carried a draft local stack. The harness observed all 10 isolated opacity values and 11 structural feather values in those payloads. Phase 1 recorded one superseded frontend result and six backend cancellations. These are expected latest-state behavior after active scope/mask work is aborted; no stale result was presented and the benchmark error list was empty.

## Phase 1 implementation

- Simple Luma, Gradient, and Brush leaves cache a spatial `r8unorm` mask with mask opacity removed from its identity. Mask opacity is now a scalar WebGPU uniform and Canvas-overlay alpha.
- Boolean mask expressions retain exact per-leaf opacity semantics and continue through the exact mask path.
- Backend preview caches retain spatial masks across ordinary adjusted-frame invalidation and clear them when the source changes.
- Local opacity and supported local grade controls use the shared preview scheduler. Structural mask changes retain the last valid adjusted image while exact latest-state masks compile.
- Draft masks use request-animation-frame scheduling, active-request cancellation, generation/revision/signature rejection, and one latest pending state instead of a serialized backlog plus fixed 16 ms delay.
- Scope requests carry the current draft local-adjustment stack and supersede older in-flight scope work. The last valid scope remains displayed during refresh.
- Stale-scope 409 responses never reload committed edit state, and only the newest normalized scope presentation serial may draw.
- GPU frames snapshot adjustments and locals before asynchronous resource acquisition so an in-flight render cannot observe a later-mutated object graph.
- Overlapping Brush commits do not schedule an intermediate adjusted preview while a newer stroke gesture is active.

## Parity and preservation evidence

The approved observable browser parity envelope remains mean absolute channel error ≤0.75% of full scale, p95 channel error ≤2.5%, and pixels differing by more than eight code values ≤4.5%.

The direct canvas parity sweep passed 129 HDR/SDR cases:

| Metric | Result | Limit |
|---|---:|---:|
| Worst mean absolute channel error | **0.0289%** | 0.75% |
| Worst p95 channel error | **0.3922%** | 2.5% |
| Pixels over eight code values | **0%** | 4.5% |

The parity harness now reads the GPU and CPU canvas bitmaps directly. DOM screenshots were rejected for numerical comparison because redesigned UI chrome can overlap the canvas element and contaminate a locator screenshot.

Spatial masks for deterministic Luma, Gradient, and Brush fixtures are also compared directly with the authoritative float CPU influence. All stay within one `r8unorm` code step after applying mask opacity.

Regression results:

- `425 passed, 2 warnings` for the full Python suite, including draft-scope content and non-mutation coverage;
- JavaScript syntax checks passed for the app, scheduler, WebGPU renderer, local benchmark, and parity harness;
- Luma interaction passed, including add/remove sampling and a 208,060-pixel overlay;
- local-adjustment interaction passed for four mask types and live scopes;
- Gradient interaction passed, including zoom alignment, midpoint editing, fan, and luminance refinement;
- Brush interaction passed twice after the final scheduling fix, including Shift Edge/Feather parity, paint/erase accumulation, three overlapping eraser commits, bypass, invert, and hidden overlay state.

Browser suites should run serially against the default in-memory session limit. Running several independent suites concurrently can evict one another's sessions and produces intentional 404s unrelated to feature behavior.

## Reproduction

From `codebase/`, with a fresh server:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.hdr_finisher.main:app --host 127.0.0.1 --port 8765
npm run test:gpu-local-adjustments -- --url http://127.0.0.1:8765 --phase phase0
npm run test:gpu-local-adjustments -- --url http://127.0.0.1:8765 --phase phase1
.\.venv\Scripts\python.exe -m pytest -q tests
$env:HDR_FINISHER_URL = "http://127.0.0.1:8765"
node tools/playwright_gpu_parity.js tests/fixtures/hdr_headroom.tiff output/performance/gpu-local-phase1-parity
npm run test:local-adjustments
npm run test:luma-mask
npm run test:brush-mask
npm run test:gradient-mask
```

## Next phase

Phase 2 should move Luma feathering to a separable compute pipeline with bounded intermediates and explicit transition-quality tests. It must retain the one-code-step mask parity test, latest-state cancellation, live reduced scopes, and the exact CPU/export reference path.
