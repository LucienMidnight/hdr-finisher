# Phase 4 — tiled execution, parity and measured residency

**Recorded:** 2026-09-19
**Sprint:** [Stable Exact Preview Tiers and Full-Resolution Processing](../product/Stable_Exact_Full_Preview_Sprint_PRD_2026-09-19.md)
**Status:** **3 of 4 exit gates met.** Gate 4 (CPU Full through a bounded path) is open.
**Supersedes:** the modelled residency figures in
[phase-4-tile-scheduler-checkpoint-2026-09-19.md](phase-4-tile-scheduler-checkpoint-2026-09-19.md),
which are now replaced by measurements.
**Adapter:** NVIDIA `lovelace` (RTX 4070 Ti), not a fallback, headless Edge with
`--enable-unsafe-webgpu --enable-features=Vulkan,UseSkiaRenderer`

Tiled execution is reachable **only** from
`window.HDRFinisherPerformance.renderTiledTier()`. Nothing in the normal render
path calls it, so every user-visible render is still Direct. That was the agreed
sequencing: build it behind a flag, prove parity, then enable.

## How tiled execution works

Each tile is copied out of the resident proxy into a tile-sized source texture,
run through the same pipelines Direct uses, and composited into the canvas at
its global origin. Because every intermediate pass reads its input at the
fragment position **and its input is the same tile**, those shaders need no
knowledge that they are running on a tile at all.

Only one shader needed changing. The composite pass renders into the whole
canvas while its input is a single tile, so it is the one place that converts a
global fragment position into a tile-local texel:

```wgsl
let tileOrigin = vec2i(i32(p[160]), i32(p[161]));
let coordinate = clamp(vec2i(input.position.xy) - tileOrigin, vec2i(0), vec2i(dimensions) - vec2i(1));
```

`PARAM_COUNT` went from 160 to 162 to carry that origin. **Direct leaves both at
zero**, so its arithmetic is bit-identical to before — which the parity result
below confirms from the opposite direction.

Per-tile origins live in one storage buffer with a slot per tile, bound at an
offset. A `queue.writeBuffer` per tile would have landed once for the whole
submission rather than once per tile, which would have given every tile the last
tile's origin. Binding at an offset keeps the whole generation in **one command
buffer and one submission**, which is what makes replacement atomic.

### Two things that cost real time, recorded so nobody repeats them

1. **Copying finished tiles into the canvas does not work.** The canvas accepted
   `COPY_DST` (usage reported 18), the copies raised no validation error, and
   the canvas stayed empty. Chromium presents the swapchain only for a texture
   that was *rendered* to. The composite pass therefore renders directly into
   the canvas with `setScissorRect` per tile.
2. **`drawImage()` cannot read back a WebGPU canvas** in headless Chromium — it
   returns fully transparent pixels even for a Direct render that is visibly
   correct. An early version of the parity test used it and reported a 62.5%
   failure that was entirely an artefact of the measurement. The test now takes
   an element screenshot and decodes it, which compares what the compositor
   actually shows.

## Gate 1 — Direct and Tiled pointwise results meet parity thresholds

**Status: met, byte-exact.**

`codebase/tests/tiled-direct-parity.js`, run against a non-neutral grade
(exposure +0.85, contrast +18, saturation +12, white balance 5200 K) so the
comparison exercises real tone mapping rather than an identity transform:

| Source | Capture | Tile size | Tiles | Submissions | Max channel delta | Differing pixels |
|---|---|---:|---:|---:|---:|---|
| Test pattern | 1058 × 597 | 256 | 12 | 1 | **0** | **0 / 631,626** |
| Test pattern | 1058 × 597 | 512 | 4 | 1 | **0** | **0 / 631,626** |
| 42.4 MP EXR | 424 × 633 | 512 | 4 | 1 | **0** | **0 / 268,392** |
| 42.4 MP EXR | 424 × 633 | 1024 | 1 | 1 | **0** | **0 / 268,392** |

The tolerance in the test is `maxDelta <= 1`; the measured value is 0.

**Honest limit on the capture.** An element screenshot captures the canvas as
composited, at CSS size × device pixel ratio. For the test pattern that is
1058 × 597 against a 1024 × 576 backing store — effectively 1:1, so those rows
are a near-native comparison and are the primary evidence. For the 42.4 MP
source the preview is fit to the viewport, so that comparison is at display
scale and could in principle average away a sub-pixel seam. The tile counts
confirm the tiled path really ran at tier resolution internally (48 tiles at 4K,
below), but a native-resolution comparison at 42 MP would be stronger and is
worth adding when Full becomes selectable.

## Gate 2 — Fit and zoomed views never show a mixed generation

**Status: met.**

- The scheduler's rules are covered by 17 deterministic cases (see the checkpoint document).
- Every tiled generation is **one command buffer and one submission**, asserted by the parity test. The canvas presents the complete assembly or nothing, so a partially replaced frame cannot reach the screen.
- `presentableGeneration` returned the current generation after each run, meaning every visible tile was accepted at the same generation.

## Gate 3 — 24 MP, 42 MP and 8K remain within configured budgets

**Status: met, and now measured rather than modelled.**

Measured on the 42.4 MP source, tile size 512, reading live diagnostics:

| Tier | Preview dimensions | Tiles | Direct resident | **Tiled working set** | Source proxy | Reduction |
|---|---|---:|---:|---:|---:|---:|
| 1K | 684 × 1024 | 4 | 29.6 MB | **8.4 MB** | 5.6 MB | 71.7% |
| 2K | 1367 × 2048 | 12 | 125.6 MB | **8.4 MB** | 22.4 MB | 93.3% |
| 4K | 2735 × 4096 | 48 | 478.5 MB | **8.4 MB** | 89.6 MB | 98.2% |

**The tiled working set is constant at 8.4 MB across every tier.** That is the
property the whole design is for: the graph's intermediates stop following the
image. Direct's resident set grows 16× between 1K and 4K; tiled does not grow at
all.

The source proxy still scales with the tier, because Phase 4 keeps the source
and the presentation surface whole. Removing that is the per-tile source
residency described in PRD 5.4, for which the Phase 3 tile transport already
exists.

## Gate 4 — CPU Full through a bounded path

**Status: not met.** No CPU tiled/strip execution has been written. This is
backend work that touches nothing the GPU path uses.

## What keeps a graph off the tiled path

Refusals are explicit and returned to the caller; there is no silent fallback.
The parity test asserts that a vignette produces `["vignette"]` rather than a
quiet Direct render.

| Refusal | Why |
|---|---|
| local adjustments | masks are full-frame — Phase 5 |
| detail | needs a radius-derived halo — Phase 5 |
| spatial film effects | multiscale over the whole image — Phase 7 |
| mask overlay | full-frame mask |
| vignette | normalizes to the whole image |
| grain (with amount > 0) | seeds on absolute image coordinates |
| denoise | aligned evidence tiles — Phase 6 |

Grain is section-enabled by default, so the refusal is on grain that actually
contributes; zero-amount grain leaves pixels alone and cannot make a tile
disagree with the whole frame.

## Fixed regression: `gpu-highlight-compression-parity`

**Found, diagnosed and fixed.** It passes 6/6 again, matching the pre-sprint
rate.

Failure rates, six runs each on the same adapter and server:

| Tree | Result |
|---|---|
| Pre-sprint `83bca70` | 6 pass / 0 fail |
| Phase 4 checkpoint `ecb3c4a` | 3 pass / 3 fail |
| With tiled execution, before the fix | 1 pass / 5 fail |
| **With the fix** | **6 pass / 0 fail** |

### What it actually was

My first two hypotheses were wrong, and guessing cost more than instrumenting
would have. Adding a recorded reason to every declining return found it in one
run:

1. `renderGpuDraft` returned `renderer-returned-nothing` — so the refusal was
   inside `renderTo`, not in the draft guards.
2. Splitting that guard gave `peak:newer-render-started` — `serial !==
   this.renderSerials.get(canvas)`, meaning another render on the same canvas
   started during the highlight-peak `await`.
3. Logging the caller of every render named it: the scheduler's **interactive**
   frame, at `longEdge: 889`, starting **1 ms** into the settled render's peak
   measurement.

889 is `bootstrapProxyLongEdge()`. The suite deliberately renders at
`longEdge: 512` while the tier is 1K, so the accepted presentation is never
exact, so `selectedTierReady()` is false, so the scheduler's interactive frame
takes the bootstrap path instead of rendering at the tier. That placeholder
frame then supersedes a settled render that had already paid for its source
upload and its peak measurement.

### The fix

Outside a gesture there is no responsiveness to win by starting a second render,
so both callers that can start one while another is running now stand down:

- `onFrame` returns early when `!state.previewScheduler?.interacting && state.gpuDraftInFlight`.
- `refinePreview` awaits `state.gpuDraftInFlight` and re-checks its guards, because the render it waited for may well have left nothing to refine.

During a gesture, `interacting` is true and latest-wins still applies, which is
the documented contract.

`renderGpuDraft` became a thin wrapper that records the pending render, with the
former body in `renderGpuDraftInner`.

### It also made interaction faster

Re-running the latency harness after the fix, against the same 42.4 MP source:

| Tier | Input p95 before | Input p95 after | Present p95 after | Target |
|---|---:|---:|---:|---:|
| 1K | 3.2 ms | **2.3 ms** | 5.0 ms | 16.7 ms |
| 2K | 3.4 ms | **1.9 ms** | 4.7 ms | 16.7 ms |
| 4K | 3.1 ms | **1.9 ms** | 4.9 ms | 33 ms |

`failures: NONE`, stale 0, non-exact presentations 0. Fewer wasted renders is
simply less work on the main thread.

### Diagnostics kept

The reason-recording survives, because a falsy render was otherwise impossible
to diagnose from a failure message: `state.lastGpuDraftRefusal` and
`gpuPreview.lastRenderRefusal`, both set only on declining paths. The
per-render stack capture and the per-call `isCurrent` instrumentation were
removed — they were triage-only and sat on hot paths.

## Regression evidence

| Suite | Result |
|---|---|
| Full Python suite (`.venv`) | `1073 passed, 3 skipped, 0 failed` |
| `node --test` over six deterministic suites | `tests 62 / pass 62 / fail 0` |
| Direct/Tiled parity | byte-exact at 4 configurations |
| `webgpu-shader-compilation` | PASS |
| `gpu-scope-parity` | PASS |
| `sdr-match-gpu-interaction`, `sdr-gamut-gpu-parity` | PASS |
| `device-loss-fallback`, and 7 further browser suites | PASS |
| `gpu-highlight-compression-parity` | **PASS, 6/6** — see the fixed regression above |

Two test constants moved with `PARAM_COUNT`: the frontend contract test now
asserts 162 plus the tile-origin symbols, and the allocation-agreement suite's
local copy of `PARAM_COUNT` was updated. Both are deliberate, and the parity
result is the evidence that the index change did not disturb Direct.

## Known cost

`renderTiledTo` duplicates the preamble of `renderTo` — proxy load, surface
configuration, parameter and curve buffers, and the highlight-peak anchor. That
was chosen over refactoring the working path while tiled execution was unproven.
Now that parity holds, the two should converge before tiled execution is wired
into admission, or they will drift.

## Next

1. CPU tiled/strip execution and cancellation (gate 4).
2. Converge `renderTiledTo` and `renderTo` onto one pass-chain encoder.
3. Wire tiled execution into admission, so a graph Direct cannot fit renders tiled instead of relying on the allocation backoff.
4. Engineering-only Full selection, once the above hold.
5. A native-resolution parity comparison at 42 MP.
