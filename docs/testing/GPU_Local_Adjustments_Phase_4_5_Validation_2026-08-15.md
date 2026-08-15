# GPU Local Adjustments Phase 4/5 Validation — 2026-08-15

## Outcome

Phases 4 and 5 pass their automated engineering gates on the benchmark workstation. The app now retains mixed mask leaves as a GPU Boolean graph, shares leaf resources, avoids mask transport for influence-only edits, scales through the required 16/32/64-local cases, survives destructive WebGPU device loss through the CPU fallback, and completes the Edge endurance and release-regression matrix.

Physical HDR/SDR display and delivery-path validation remains intentionally manual. Installer validation is a later, separate step.

## Environment

- Windows 10/11 x64 workstation
- Microsoft Edge 151.0.4129.86
- WebGPU adapter reported as NVIDIA Lovelace
- Python project virtual environment and Node/Playwright from `codebase/`
- Browser suites executed serially because the current local server owns one active editing session

## Phase 4 implementation

- The local-mask API can address a retained graph leaf by dot-separated `mask_path`, while preserving authoritative backend mask compilation.
- WebGPU composes Union as `max(left, right)`, Intersect as `left × right`, and Subtract as `left × (1 − right)`, then applies graph inversion.
- Luma leaves remain generated/refined on the GPU. Brush, Gradient, and other spatial leaves are fetched once and retained; identical leaf identities are shared across locals.
- Leaf opacity, graph operator, graph inversion, local opacity, and supported grade changes recompose without CPU mask regeneration or upload.
- Single-channel `r16float` graph intermediates and lazy Luma refinement resources reduce residency.

## Phase 4 evidence

### Mixed-leaf graph interaction

`node tests/mask-graph-interaction.js --url http://127.0.0.1:8765`

- Union, Intersect, Subtract, and inverted Subtract passed.
- Undo/redo and server serialization converged.
- The Gradient leaf used the addressable `mask_path`; the Luma leaf required no CPU mask transport.
- Influence-only graph edits issued **zero mask requests**.
- Initial/settled retained-mask resources were 4.72/7.87 MB with one graph.

### Boolean numerical parity

`node tools/playwright_gpu_parity.js test-pattern output/performance/gpu-mask-graph-parity --mask-graph-only`

- Four Boolean/inversion cases passed.
- Worst mean absolute error: **0.000853**.
- Worst p95 channel error: **0.003922**.
- Visibly changed fraction: **0**.

### Many-local scaling

`node tests/performance/many-local-layers.js --url http://127.0.0.1:8000`

| Locals | Influence completion p95 | Retained mask memory | Influence mask requests |
|---:|---:|---:|---:|
| 16 | 7.2 ms | 8.33 MB | 0 |
| 32 | 4.4 ms | 16.65 MB | 0 |
| 64 | 5.6 ms | 33.31 MB | 0 |

The worst result remains below the 96 MB mask-resource gate.

## Phase 5 evidence

### Device loss and fallback

`node tests/device-loss-fallback.js --url http://127.0.0.1:8765`

Destroying the active WebGPU device produced the explicit `WebGPU device lost: Device was destroyed.` status, switched presentation to the CPU canvas using raw RGBA8 transport, accepted subsequent editing and scope work, and restored the WebGPU authoring renderer after reload.

### Local interaction and live-scope performance

`node tests/performance/gpu-local-adjustments.js --url http://127.0.0.1:8000 --phase phase5`

- Luma Opacity preview/scope p95: **5.8/17.5 ms**.
- Luma Feather preview/scope p95: **4.8/18.8 ms**.
- Rapid final-preview propagation: **1.5–1.7 ms**.
- Backend mask and scope requests during the measured GPU interactions: **zero**.
- GPU queue-completion p95: **20.4 ms**; GPU scope-total p95: **7.8 ms**.

The spatial-mask benchmark also passed: zoom p95 11.1 ms, overlay p95 2.7 ms, brush-stroke p95 2.0 ms, erase commit response 57 ms, and erase post-processing 21.5 ms.

### EXR/TIFF endurance matrix

The enforced test ran 30 measured control repetitions and 100 settle/resource repetitions for each of fast, high-quality, and forced-CPU-fallback modes on both the linear Blender EXR and HDR TIFF. It ran on an isolated server port to prevent unrelated stale browser sessions from replacing the server's single active session.

| Input | Mode | Frame p95 | Scope p95 | Unexpected browser errors |
|---|---|---:|---:|---:|
| Blender EXR | Fast | 4.9 ms | 74.5 ms | 0 |
| Blender EXR | High quality | 6.6 ms | 72.3 ms | 0 |
| Blender EXR | CPU fallback | 4.6 ms | 73.7 ms | 0 |
| HDR TIFF | Fast | 5.1 ms | 69.1 ms | 0 |
| HDR TIFF | High quality | 5.5 ms | 67.9 ms | 0 |
| HDR TIFF | CPU fallback | 4.2 ms | 72.0 ms | 0 |

Expected stale-request HTTP 409 responses in the forced fallback scenarios are recorded separately from genuine console errors.

### Release regression matrix

- GPU/CPU histogram, waveform, and vectorscope parity passed; worst distribution error was 0.060% and worst peak error was 0.030%.
- Local stack, Brush, Gradient, Luma, mask graph, startup state, source disclosures, direct grading entry, curves, exposure bands, proofing, comparison visibility, overlay behavior, undo/redo, and HDR/SDR navigation passed in Edge.
- Proofing retained stale-proof visibility, suspend/resume behavior, authored visibility, and target controls with no browser errors.
- The alpha harness passed pytest, JavaScript syntax, capability checks, AVIF/JPEG Ultra HDR sample export validation, and browser layout smoke.
- Full deterministic suite after the post-validation Brush/Gradient interaction corrections: **437 passed**, with two existing dependency deprecation warnings.

## Explicit exception and remaining work

The broad legacy test-pattern GPU/CPU sweep continues to fail its saturated `hdr.blue_purity = 65` case at approximately 0.0209 mean absolute error and 0.077 visibly changed fraction. The same outlier is present in the earlier Phase 2 parity report. The Phase 4 Boolean-mask differential cases pass cleanly, and no threshold was loosened to conceal the older exception.

Remaining release work:

1. Run the physical HDR/SDR monitor and delivery validation with manually selected display, browser, export, and delivery settings.
2. Decide whether to correct or approve a narrowly documented envelope for the saturated-blue test-pattern exception after visual/color review.
3. Build and validate the installer after application and physical-delivery sign-off.
