# GPU Local Adjustments Phase 2 Validation — 2026-08-14

This record covers Phase 2 of the GPU Local Adjustments and Live Scopes sprint: retained GPU Luma qualification, cached separable feathering, GPU mask-overlay composition, current-generation rejection, and CPU/export preservation. Phase 0/1 evidence is recorded separately.

## Acceptance result

Phase 2 passes its three exit gates on the representative 962 px Edge/WebGPU preview:

- isolated Luma Feather input-to-preview p95 is **4.8 ms**, below the 30 ms requirement;
- the GPU-resident mask overlay has the same **4.8 ms p95** presentation time;
- final visible preview propagation after a 30-event back-and-forth feather drag is **5.8 ms**, below the 50 ms requirement;
- the drag presents 30 strictly increasing preview serials and nine strictly increasing scope generations, with nine distinct rendered-scope fingerprints;
- there are **zero** draft or committed mask HTTP requests during the measured interactions;
- the interactive and settled preview use the same retained GPU mask, so no replacement frame or visible handoff occurs.

No adaptive mask-resolution tier was added. Full 962 × 541 floating-point masks meet the latency target and the 100% feather parity case remains inside the approved observable envelope, so downsampling would add transition risk without a measured need.

## Architecture delivered

- The existing HDR proxy is retained as the fixed ACEScg source for both HDR and SDR local-mask evaluation.
- A per-session/per-edge `rgba16float` scene-luminance texture is derived once using the CPU reference weights `(0.2722287, 0.6740818, 0.0536895)` and remains GPU-resident.
- A dedicated qualification pass implements the CPU EV trapezoid against fixed scene luminance, never locally graded pixels.
- Luma base identity excludes Mask Opacity, Feather, and inversion. Range changes regenerate the base; Feather and inversion reuse it.
- Feather uses two reusable full-resolution `rgba16float` targets and separable horizontal/vertical render passes. The user control maps to the CPU semantic sigma `0.09 × amount × dimension`.
- Mask Opacity and local-adjustment opacity remain buffer values. The selected Luma overlay and local grade sample the same retained mask texture.
- A current-render callback is checked after asynchronous source acquisition and before any refinement target is changed. Obsolete generations cannot mutate the mask used by a newer frame.
- Proxy fetches are single-flight per session/lane/edge. GPU diagnostics expose mask events and retained resource counts without routine image-sized readback.
- Brush, Gradient, Boolean masks, non-default geometry, WebGPU-unavailable, and device-loss cases retain their existing CPU/fallback paths.

## Performance measurements

Environment matches Phase 0/1: Edge 151.0.4129.78, Windows, NVIDIA Lovelace, 1440 × 1000 viewport, DPR 1, 1280 × 720 ACEScg proof pattern, 962 px preview, and 384 px interactive scopes.

| Interaction | Median | p95 | Result |
|---|---:|---:|---|
| Luma Opacity → preview | 4.6 ms | 4.8 ms | Pass |
| Luma Opacity → GPU overlay | 4.6 ms | 4.8 ms | Pass |
| Luma Feather → preview | 4.6 ms | **4.8 ms** | Pass |
| Luma Feather → GPU overlay | 4.6 ms | **4.8 ms** | Pass |
| Luma Feather → live scope | 26.9 ms | 28.6 ms | Live; six distinct isolated fingerprints |
| GPU mask acquisition/encoding | 0.0 ms | 0.1 ms | No CPU transport |
| GPU queue completion | 1.5 ms | 4.4 ms | Stable |

The final 30-event feather drag reaches preview in 5.8 ms and the next current scope in 56.4 ms. It produces nine distinct scope fingerprints and issues 11 live-scope requests, nine carrying the uncommitted local stack. Preview and scope generations are strictly increasing.

Instrumentation recorded one Luma base regeneration for the narrowed benchmark range and 35 refinement passes for the Feather sweep/drag. After 103 instrumented GPU mask events the retained graph held one scene-luminance texture and two Luma base/refinement sets (the initial broad mask and narrowed benchmark mask), totaling 24,981,312 local-mask bytes. No WebGPU validation or page errors occurred.

## CPU/GPU parity and transition continuity

The direct-canvas parity sweep uses the 1280 × 720 proof pattern at 962 × 541 and compares four Luma Feather levels (0%, 25%, 50%, and 100%) against a CPU `preview-raw` render carrying the same draft local stack. The approved observable envelope remains MAE ≤0.75%, p95 channel error ≤2.5%, and pixels differing by more than eight code values ≤4.5%.

| Worst metric | Result | Limit |
|---|---:|---:|
| Mean absolute channel error | **0.7230%** | 0.75% |
| p95 channel error | **2.3529%** | 2.5% |
| Pixels over eight code values | **1.5660%** | 4.5% |

Zero Feather is effectively exact in the observable canvas comparison. The widest Feather case is the limiting case but remains within every approved gate. Interactive and settled WebGPU presentation use the same full-resolution texture and therefore do not introduce an approximation-resolution handoff.

## Preservation and fallback evidence

- Full Python suite: **427 passed, 2 warnings**.
- Luma interaction: passed with GPU-resident overlay resources and no Canvas-authoritative dependency.
- Local-adjustment interaction: passed for Brush, Gradient, Luma, and Path.
- Brush interaction: passed paint, erase, Shift Edge, Feather, opacity, inversion, bypass, and overlapping commit checks.
- Gradient interaction: passed geometry, midpoint, fan, Luma refinement, zoom alignment, and overlay checks.
- Forced no-WebGPU smoke matrix: CPU fallback remained `Settled`, with no page errors; sampled frame p95 was 3.0 ms and scope p95 5.8 ms on the small deterministic fixture.
- Export/proxy invariance: an automated cache test proves that exercising a 256 px interactive proxy and Luma mask before the 512 px authoritative render produces an array-identical result to a fresh authoritative render.
- JavaScript syntax checks passed for the app, renderer, interaction tests, benchmark, and parity tool.

Expected stale-work HTTP 409 messages can appear in high-quality/fallback console logs when a newer generation intentionally supersedes an older request. No stale response is presented, no task reports a page error, and the last valid image/scopes remain visible.

## Reproduction

From `codebase/`, with a fresh server on port 8765:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.hdr_finisher.main:app --host 127.0.0.1 --port 8765
npm.cmd run test:gpu-local-adjustments -- --url http://127.0.0.1:8765 --phase phase2-final
$env:HDR_FINISHER_URL = "http://127.0.0.1:8765"
node tools/playwright_gpu_parity.js test-pattern output/performance/gpu-local-phase2-parity-962-local --local-luma-only
npm.cmd run test:luma-mask
npm.cmd run test:local-adjustments
npm.cmd run test:brush-mask
npm.cmd run test:gradient-mask
npm.cmd run test:performance -- --url http://127.0.0.1:8765 --inputs tests/fixtures/hdr_headroom.tiff --repetitions 2 --memory-repetitions 3
.\.venv\Scripts\python.exe -m pytest -q tests
```

Generated JSON remains ignored under `codebase/output/performance/`; this dated record is the durable result.
