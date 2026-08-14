# GPU Local Adjustments Phase 3 Validation — 2026-08-14

## Outcome

Phase 3 is complete on the supported WebGPU path. Histogram, waveform, vectorscope, peak, clipping, and scope statistics are derived from a compact render of the same current authored GPU output used by the visible preview. The implementation uses asynchronous reusable readback buffers, preserves the last valid scope under backpressure, rejects obsolete generations before presentation, and retains the exact CPU scope implementation as fallback and reference.

The Edge benchmark passed the sprint exit gate: isolated scope presentation p95 was 25.8 ms, rapid drags sustained 18–19 presented updates per second, image presentation remained below the 30 ms budget, and no stale scope was presented.

## Environment

| Item | Value |
|---|---|
| Browser | Microsoft Edge 151.0.4129.78, headless Playwright |
| OS | Windows |
| GPU | NVIDIA Lovelace WebGPU adapter |
| Viewport | 1440 × 1000, DPR 1 |
| Fixture | `hdr_delivery_proof_pattern.tiff`, 1280 × 720 float32 ACEScg |
| Preview | 962 px interactive and settled long edge |
| Interactive analysis | compact reduced-density tier |
| Settled analysis | 256 × 256 `rgba16float` render/readback |
| Recorded run | `2026-08-14T14:00:14.408Z` |

## Performance results

| Measurement | Median | p95 | Maximum / final |
|---|---:|---:|---:|
| Opacity input → preview | 4.0 ms | 6.1 ms | 7.9 ms |
| Opacity input → scope | 22.6 ms | 25.0 ms | 28.6 ms |
| Feather input → preview | 2.7 ms | 3.4 ms | 4.1 ms |
| Feather input → scope | 24.4 ms | 25.8 ms | 26.2 ms |
| GPU scope total | 8.0 ms | 12.0 ms | 44.0 ms |
| GPU scope encode | 0.1 ms | 0.2 ms | 0.5 ms |
| GPU scope readback | 5.6 ms | 9.8 ms | 40.6 ms |
| GPU scope unpack | 1.5 ms | 3.8 ms | 5.3 ms |

The 30-input Opacity drag lasted 570.7 ms and presented 11 strictly increasing scope generations, approximately 19 updates per second. Its final scope arrived in 52.3 ms. The 30-input Feather drag lasted 541.0 ms and presented 10 strictly increasing scope generations, approximately 18 updates per second. Its final scope arrived in 22.4 ms.

Both rapid drags presented all 30 preview serials in order. Scope backpressure intentionally skipped obsolete generations instead of queuing them, and the last valid result stayed visible. The run made zero scope HTTP requests and zero mask HTTP requests. Scope transport therefore added no CPU or network work to supported interactions.

## Numerical parity

The Edge parity harness requests an exact CPU scope for the same current authored state and compares it with the settled compact GPU result.

| Scope | Peak relative error | Distribution / centroid error | Result |
|---|---:|---:|---|
| Histogram | 0.0298% | 0.0498% | Pass |
| Waveform | 0.0298% | 0.2034% | Pass |
| Vectorscope | 0.0298% | 0.0046% | Pass |

The automated limits are 3% peak error and 2.5% normalized distribution/centroid error. The settled 256 × 256 tier is used for parity and catches small highlight regions that a lower-density interactive sample may deliberately omit.

## Architecture and resource behavior

- The scope render samples the retained film and spatial textures used by the current visible frame and applies the same Film Look stage.
- Interactive work uses reduced sampling; settled work raises precision without changing the visible image.
- A maximum of two reusable buffers per scope geometry bounds readback concurrency. Busy pools return backpressure instead of starting CPU scope work.
- Generation, lane, and mode must still match at completion before a result can be presented.
- Proof, comparison, non-default geometry, unavailable WebGPU, and unsupported paths continue to use the authoritative CPU scope implementation.
- The final run retained two scope pools and three scope buffers. No WebGPU validation, console, or page error occurred.

## Regression evidence

- Full Python suite: **428 passed, 2 warnings**.
- Edge local-adjustments interaction: passed for Brush, Gradient, Luma, Path, histogram, waveform, vectorscope, and the crop modal guide/aspect controls.
- Edge proofing QA: passed for JPEG Ultra HDR, including HDR adaptation/SDR base switching, stale-proof retention, suspend/resume behavior, and zero console/page errors.
- Scope parity: passed for histogram, waveform, and vectorscope.
- Stage 3 performance harness: passed with zero browser errors and zero backend scope requests.

## Reproduction

From `codebase/`, run a fresh server, then execute browser suites serially:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.hdr_finisher.main:app --host 127.0.0.1 --port 8765
npm.cmd run test:gpu-scopes -- --url http://127.0.0.1:8765
npm.cmd run test:gpu-local-adjustments -- --url http://127.0.0.1:8765 --phase phase3-final
npm.cmd run test:local-adjustments -- --url http://127.0.0.1:8765
node tools\playwright_proofing_qa.js http://127.0.0.1:8765 tests\fixtures\hdr_headroom.tiff output\proofing-qa-stage3
.\.venv\Scripts\python.exe -m pytest -q tests
```

Generated reports and screenshots belong under `codebase/output/`. This document is the durable validation conclusion.

## Remaining work

Phase 4 generalizes the retained mask graph for Brush, Gradient, and Boolean configurations. Phase 5 covers device-loss testing, endurance and memory matrices, many-layer scaling, physical HDR display evidence, and release hardening. Those items do not reopen the Phase 3 GPU scope exit gate.
