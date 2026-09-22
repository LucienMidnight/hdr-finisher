# Preview Performance Architecture Review

**Date:** 2026-09-22  
**Reviewed revision:** `35996e5` (`Fix preview rendering races and performance`)  
**Scope:** Main product PRD, Stable Exact Full Preview sprint PRD, current preview/tile implementation, VRAM management, local-adjustment path, and current performance evidence

**Revision note:** Updated after comparison with an independent static audit supplied on 2026-09-22. Newly incorporated findings are the hidden native-resolution exact-peak scope render, halo amplification, unused viewport priority, sticky GPU-disable behavior, canvas-resize risk, and uncoalesced Denoise control work. Claims from that audit that were not supported as written are qualified below.

## Executive summary

The performance problem is real, and it is primarily architectural rather than simply a missing GPU flag.

The current renderer does use WebGPU, but “Tiled” mostly means “reuse a small set of processing textures while still loading, retaining, and processing the entire image.” A 42 MP edit still touches every tile, gathers every local mask, builds one enormous GPU submission, waits for GPU readback, and often starts additional SDR/scope work afterward.

That explains the reported symptoms:

- Full-tiled sliders intentionally do not render while moving; the old frame remains until a complete Full frame finishes.
- Switching from Full to 4K can wait behind already-submitted Full work because GPU work cannot be cancelled once submitted.
- A settled Direct preview can silently start a second, native-resolution tiled render solely to calculate the exact scope peak. That work shares the foreground GPU queue.
- Local adjustments can launch 176 mask requests per local layer, with a backend cache race capable of compiling the same full-resolution mask many times concurrently.
- Fixed 512-pixel tiles can become mostly halo when Detail or film-neighbourhood radii grow with image size, multiplying work per useful output pixel.
- The nominal 2 GiB GPU budget is incomplete and did not match observed GPU memory growth.
- There is no evidence that ordinary Full edits currently fall back to CPU. Instead, the GPU is intermittently starved by CPU mask work, HTTP transport, synchronization, and readbacks.

In non-technical terms: the app divided the job into tiles to prevent some huge temporary allocations, but it still insists on completing almost the entire giant job before showing anything. It can then repeat the giant job invisibly just to update one scope number. For local adjustments, it also asks the backend for hundreds of tile pieces even though the backend first builds the entire mask. The result is a lot of coordination and waiting surrounding relatively short bursts of actual GPU work.

## Architecture as implemented

The main division is sound:

- Python/FastAPI owns source decoding, canonical scene-linear ACEScg data, authoritative edits, CPU rendering, scopes, and export.
- The browser/Electron frontend owns interaction, preview scheduling, WebGPU rendering, and presentation.
- The selected preview tier is intended to stay exact; interaction may retain the previous accepted frame but may not substitute a lower-resolution render.
- WebGPU chooses Direct or Tiled using a logical memory plan.
- Tiled rendering creates a 512-pixel tile grid with halos, runs the adjustment graph tile by tile, and composites all tiles into the canvas.
- CPU/export remains the authoritative reference.

The architectural boundary is appropriate. The problems are mostly inside the frontend tiled executor, its backend mask interface, and resource scheduling.

## Major findings

| Priority | Finding | Likely user-visible effect |
|---|---|---|
| Critical | Settled Direct scopes can trigger a hidden native-resolution tiled render | 4K edits and tier changes queue behind work unrelated to the visible preview |
| Critical | Local-mask request fan-out and cache stampede | Multi-second local adjustments, CPU spikes, retries |
| Critical | A Full tiled render is one non-preemptible whole-image GPU transaction, with no viewport supplied | Tier changes and new edits wait behind obsolete work; visible-first ordering is ineffective |
| High | “Tiled” still retains whole-image source and presentation textures | High VRAM use, allocation pressure, slow cold tiers |
| High | Fixed tiles plus resolution-scaled halos amplify processing | Several times more GPU work than the output pixel count suggests |
| High | Full-tiled deliberately has no interactive slider frames | Sliders feel unresponsive even when working correctly |
| High | GPU readbacks and scope work are in the presentation path | GPU/CPU synchronization stalls |
| High | VRAM accounting omits active and in-flight resources | Budget can say “safe” while real use is much higher |
| High | Some GPU errors permanently disable WebGPU for the session | One transient non-recoverable error can turn later edits into CPU previews |
| Medium | Denoise input handling performs reconstruction and a draft per input | Slider events serialize expensive work instead of coalescing |
| Medium | Inactive HDR/SDR lane preparation and scopes run after each settle | Sustained background CPU/GPU load |
| Medium | Existing performance gates do not measure the most important workflows | Passing tests conceal poor real interaction |

### 1. Direct-tier exact scopes can launch a hidden Full render

Exact peak is enabled by default in `frontend/app.js` around lines 344–348 and 1953–1962. After a settled Direct WebGPU presentation, `runGpuScopeRequest()` first reads a reduced scope and then awaits `measureExactScopePeak()` around lines 4892–4960. That function requests the native long edge and calls `renderTiledTo(..., measureOnly: true)` around lines 4431–4470.

This means a settled 4K Direct edit can cause two GPU jobs:

1. the requested 4K preview;
2. a native-resolution tiled execution that paints nothing and exists only to obtain one exact maximum value.

The exact-peak job is conditional: it runs for settled GPU scopes with no scope region and only when the accepted presentation is Direct. Full Tiled presentations instead use the CPU scope path. It also does **not** delay the Direct frame that was already presented. The sharper statement is that it is awaited by the settle/scope sequence and occupies the same WebGPU queue, so the next user edit, source upload, or tier change can wait behind it. The cache key includes edit/generation state, so normal edits invalidate the previous answer.

This is a high-confidence architectural cause, but its real cost still needs an A/B trace on the reported machine; the supplied comparison report did not measure it.

Recommended repair:

- Turn exact peak off by default for authoring, or run it only after a genuine idle window.
- Never begin it while foreground work is pending; abort between small tile batches when a new generation arrives.
- Reuse an exact peak already produced by a Full tiled presentation instead of recomputing it through a separate scope route.
- Keep proxy-derived scopes visibly labelled during interaction and upgrade the number asynchronously.
- Measure edit-to-edit and Full → 4K latency with exact peak enabled and disabled before and after the change.

### 2. Local masks are the most severe immediate defect

A 7968×5320 image produces 176 tiles. Before the GPU encodes anything, the frontend builds a complete `tiles × active locals` mask matrix using nested `Promise.all` calls in `frontend/webgpu-preview.js` around line 2134. One local therefore starts up to 176 mask requests at once; eight locals can mean 1,408 requests.

The backend’s “mask tile” endpoint is tile-sized only at the network boundary. It calls `compiled_local_mask()` for the entire image and slices the requested rectangle afterward. This is explicitly documented and performed in `backend/hdr_finisher/main.py` around lines 1009–1041.

More seriously, the mask cache checks under a lock, releases the lock, compiles the full mask, and only then reacquires the lock. Concurrent misses can therefore compile the same 42 MP mask simultaneously—a classic cache stampede. See `backend/hdr_finisher/render_cache.py` around lines 754–771.

The full-resolution mask cache is only 160 MiB. A single 42 MP R8 mask is roughly 40 MiB, so a handful of local masks can churn it. The independent report correctly identified the browser request fan-out, but its description of the backend as cheap after memoization is incomplete: warm slices can be cheap, while a cold concurrent miss can perform the full compilation repeatedly because compilation happens outside the lock. Browser connection limits may cap transport concurrency, but they do not make this architecture safe or efficient.

This is highly consistent with the reported local-adjustment delays. In the current run, the Full brush/local test took roughly 36–40 seconds end-to-end and a later local exposure update encountered `tiled-encode-failed: mask tile unavailable or superseded` before recovering.

Recommended repair:

1. Immediately add per-mask single-flight compilation so only one request can compile a given mask identity.
2. Limit mask fetch concurrency to perhaps 4–8 requests, with cancellation by generation.
3. Replace 176 independent requests with a batch or streamed tile protocol.
4. Longer term, rasterize analytic masks—gradients, luminance ranges, simple paths—directly in WGSL from their compact definitions.
5. For brush masks, maintain an authoritative tiled mask store and update only changed tiles. Do not repeatedly compile a full image merely to return one rectangle.
6. Preserve mask cache identity across grading, opacity, and unrelated edit revisions. The recent commit improved this, but the overall request architecture still dominates.

### 3. Tiled GPU work cannot be meaningfully cancelled or prioritize the viewport

The tile scheduler can order visible tiles first, but that priority has no effect in the current path for two reasons. First, `encodeTiledGeneration()` does not pass a viewport to `scheduler.plan()`, so the scheduler treats the whole frame as visible. Second, all tiles are encoded into one command buffer and submitted together. The encoder is created in `frontend/webgpu-preview.js` around line 2204 and the complete frame is submitted once around line 2415.

For a 42 MP image, this can contain 176 tiles multiplied by:

- global adjustment passes;
- every active local layer;
- Detail analysis/composition passes;
- Denoise work;
- spatial film passes;
- final composition and peak reduction.

Once submitted, a newer slider value or a change to 4K cannot remove that work from the WebGPU queue. “Latest wins” currently means the obsolete result will not be accepted—not that the obsolete computation stops.

This is a strong explanation for Full → 4K hanging: the new 4K render may be logically newer, but its uploads and GPU work sit behind an old Full submission.

Recommended repair:

- Submit small batches, such as 4–8 tiles, and recheck generation before each batch.
- Stop submitting the remaining batches immediately when superseded.
- Render into a generation-specific offscreen target while retaining the old visible presentation.
- Render the visible viewport first. At 100% zoom, only visible source tiles should be needed for immediate feedback.
- Run offscreen/full-image completion later when it is required for exact scopes or whole-image inspection.

This changes the renderer from “whole-frame tiling” into an actual cancellable tile executor. Progressive visible-tile presentation is not merely an implementation tweak: the current PRD requires atomic replacement of the complete visible set. The product must define “visible set” as the actual viewport and permit generation-safe viewport replacement, while keeping the previous complete presentation behind incomplete regions.

### 4. Resolution-scaled halos can multiply tile work

The tile core is fixed at 512×512, but the Detail and film-neighbourhood halos are derived partly from the full frame diagonal and effect radii in `frontend/webgpu-preview.js` around lines 504–584 and 1565–1575. Each tile processes its core plus the halo on every relevant pass. As the halo grows, adjacent tiles repeatedly process large overlapping regions.

The amplification for an interior square tile is approximately:

`((tileSize + 2 × halo) / tileSize)²`

For example, a 136-pixel halo makes a 512-pixel core execute over roughly 784×784 pixels, or about 2.34× the core area, before accounting for multiple passes. A 256-pixel halo makes it 4×. Edge tiles reduce the aggregate somewhat, but Detail stacks and locals multiply the repeated work. The exact amplification depends on settings and edge coverage and should be emitted as telemetry rather than inferred from nominal tile count.

Recommended repair:

- Choose tile size adaptively from halo and budget instead of fixing it at 512. A starting heuristic such as `max(512, 4 × halo)`, capped by texture limits and memory admission, is worth benchmarking—not adopting unmeasured.
- Add `processedPixels / outputPixels`, pass count, halo, and effective tile dimensions to performance traces.
- Consider multi-scale or separable whole-axis strategies for very large-radius effects, where ordinary overlapping tiles are inherently wasteful.
- Re-evaluate Detail band caching with the adaptive grid; larger tiles reduce overlap but raise per-tile residency.

The Detail cache deserves special scrutiny. A cache hit can reconstruct a target halo by scanning candidate tiles and issuing multiple texture copies. Because entries store tile-core band textures while consumers often need a haloed region, a nominal hit is not necessarily cheap, and the pinned working set can exceed the intended cache budget during one generation. This is a plausible secondary source of command-buffer size and VRAM pressure; it needs GPU timing and residency telemetry before being labelled a proven dominant cause.

### 5. The source side is not truly tile-resident

The sprint PRD requires that only needed source tiles remain resident during Tiled execution.

The implementation instead allocates one texture for the full selected-tier source in `frontend/webgpu-preview.js` around lines 4310–4317. It downloads row strips into staging buffers and fills that whole texture.

The bounded transport avoids one giant browser response, which is useful, but it does not bound source VRAM. For the test image, the source texture alone is 339,118,080 bytes.

Each source chunk is also serialized through:

1. fetch;
2. staging-buffer creation;
3. copy submission;
4. `queue.onSubmittedWorkDone()`;
5. only then fetch/upload the next chunk.

This occurs in `frontend/webgpu-preview.js` around lines 4329–4371. Because `onSubmittedWorkDone()` covers prior work on the queue, a cold 4K upload can indirectly wait for an older Full render.

Recommended repair:

- For Tiled execution, use a small ring of reusable source-tile textures instead of a full-image source texture.
- Pipeline fetch, decode, upload, and execution: while tile batch N runs, prepare N+1.
- Use bounded staging-buffer reuse and per-batch completion, not a global queue drain after every strip.
- Retain full source textures only for Direct mode.

### 6. Tiled rendering still requires multiple whole-image surfaces

The renderer’s own plan lists these 42 MP resources:

- full source proxy: 339 MB;
- full presentation surface: 339 MB;
- retained presentation overlap: 339 MB;
- tile working graph: about 13 MB;
- staging and other resources.

The planner acknowledges these whole-image allocations in `frontend/webgpu-preview.js` around lines 640–665.

The reported “constant 8.4 MB tiled working set” in the sprint evidence refers only to the reusable processing graph, not total residency. The current diagnostic plan for the test image predicts approximately 1.15 GB even before important omissions.

A stronger future design would decouple exact processing resolution from canvas backing size:

- Process visible source pixels at the exact selected tier.
- Present into a viewport-sized canvas.
- At 1:1 zoom, request exact visible tiles.
- At Fit, process exact tiles but downsample their final presentation into the screen-sized viewport.
- Build full-image results only for export, global measurements, or explicit background completion.

That would preserve exact selected-tier arithmetic without requiring a 42 MP swapchain for ordinary viewing.

### 7. Full-tiled intentionally provides no live slider frames

The current scheduler checks whether the minimum graph is guaranteed to tile. If so, every interactive draft is declined with `pre-dispatch-tiled`. See `frontend/app.js` around lines 1971 and 2124–2132.

This is no longer wasteful in the way described by the older PRD text—the refusal now happens before dispatch—but it means Full-tiled behavior is:

1. move slider;
2. continue showing the old frame;
3. wait for the 110 ms settle delay;
4. process an entire exact Full frame;
5. replace the old frame.

That is why local adjustments “take multiple seconds to land.” It is current intended behavior, not necessarily a fallback.

The product requirement that no lower-resolution proxy be substituted does not require recomputing every offscreen pixel before any feedback. Exact visible-region tiling is the best way to reconcile truthful resolution with responsiveness.

### 8. Per-frame peak readback and scope synchronization delay acceptance

Every tiled frame allocates or uses the peak target, copies its reduction to a readback buffer, submits, and awaits `mapAsync` before the render returns. See `frontend/webgpu-preview.js` around lines 2408–2429. This is distinct from the second native exact-peak render described in Finding 1: this readback is embedded in the tiled presentation itself, while Finding 1 is an additional measure-only generation after a Direct presentation.

This creates a GPU → CPU synchronization barrier on the preview path. Highlight-anchor modes can add another whole-image measurement before rendering around lines 1885–1893.

Recommended repair:

- Do not block presentation on scope peak readback unless the adjustment graph itself needs that value.
- Present the accepted frame first.
- Publish scopes and diagnostics asynchronously against the same generation.
- Cache highlight anchors by the narrowest valid dependency identity.
- During active editing, debounce scopes more aggressively or suspend them until idle.

### 9. VRAM accounting is not a reliable admission boundary

The live memory snapshot hardcodes transient bytes to zero because resources pending destruction cannot currently be measured. See `frontend/webgpu-preview.js` around lines 1423–1452.

It also does not fully account for:

- swapchain/canvas textures;
- active upload buffers;
- resources queued for deferred destruction;
- all per-generation parameter buffers;
- browser/Dawn internal staging;
- command buffers;
- some tiled presentation overlap;
- temporary duplication during tier and lane changes.

The Direct plan also estimates cached proxies as `target frame size × number of cached proxy entries`, even when those entries have different dimensions. See `frontend/webgpu-preview.js` around line 1022.

Proxy retention is limited to two tiers per lane, not globally, around lines 4162–4170. HDR Full + HDR 4K + SDR Full + SDR 4K can therefore coexist.

On the RTX 4070 Ti 12 GB test machine, system-reported dedicated GPU memory rose by roughly 2.1 GB during the Full local-adjustment test, from about 3.9 to 6.0 GB. That figure is system-wide rather than isolated to the app, but the timing and subsequent drop make it strong evidence that the logical snapshot is not the true peak.

Recommended repair:

- Introduce one central GPU allocator/resource registry.
- Require a reservation before every texture or buffer allocation.
- Track current, in-flight, deferred-destroy, presentation, staging, and cache bytes separately.
- Use one global LRU across lanes and tiers.
- Evict inactive-lane and obsolete-tier proxies before admitting a new tier.
- Never let cache “minimum floors” exceed actual free budget.
- Treat the configured budget as a hard application limit plus allocation-backoff telemetry.

Auto currently means a fixed 2 GiB logical budget. On this 12 GB GPU, that forces the 42 MP graph into Tiled even though the reported Direct plan is roughly 2.84 GiB. A calibrated higher budget could make Full Direct substantially faster on powerful GPUs, but Auto should not be raised until accounting is trustworthy.

### 10. Canvas lifecycle and sticky failure handling can turn stalls into visible failures

The Direct path deliberately waits for masks before resizing the visible canvas, which is good. The Tiled path, however, resizes the canvas before `encodeTiledGeneration()` gathers all tile masks. Changing canvas backing dimensions clears the current content. If mask fetch/compilation is slow, fails, or is superseded, the old frame can be lost before the replacement is ready. This is a high-confidence mechanism in `frontend/webgpu-preview.js` around lines 1863–1867 and 2613–2650, but a prolonged blank during the reported Full → 4K transition has not yet been reproduced, so the user-visible outcome remains unconfirmed.

Separately, `renderGpuDraft()` sets `state.gpuPreview.available = false` after a thrown render error that is not explicitly marked `recoverable`, around `frontend/app.js` lines 10332–10342. This is sticky for the session and can make later edits use the CPU route. It is too broad to say that *every* fetch or allocation hiccup does this—some expected conditions are returned as refusals or marked recoverable—but one transient unclassified error can disable acceleration far beyond the failing frame.

Recommended repair:

- Never resize or reconfigure the visible canvas until a replacement presentation is ready. Prefer a retained/offscreen presentation texture and one final generation-checked composite.
- Classify validation bugs, device loss, allocation pressure, supersession, transport errors, and unsupported graphs separately.
- Retry recoverable failures after eviction/backoff; rebuild the device on device loss; disable WebGPU only after a bounded failure policy, not one generic exception.
- Add an automated transient-error recovery test and visible-canvas continuity capture.

`renderTiledTo()` also bypasses the `activeRenderCount` guard used by `renderTo()`. Because exact-peak diagnostics call it directly, resource reset/destruction can race a tiled measurement. This is primarily a correctness and stability risk, but failures from that race can feed the sticky-disable path above.

### 11. Denoise slider input is not coalesced

`updateLiveDenoiseControl()` awaits `resolveDenoiseProxy()` and then awaits a full `renderGpuDraft()` for each input event around `frontend/app.js` lines 9515–9532. Unlike the main preview scheduler, this function does not use a one-in-flight/one-latest pending model. Rapid input can therefore create overlapping async handlers, reconstruction churn, and obsolete draft requests.

Recommended repair:

- Route Denoise controls through the same generation-aware scheduler as other edits.
- Allow one reconstruction/render in flight and retain only the latest pending control state.
- During drag, update only the visible Direct/viewport result; commit exact selected-tier completion on settle.

### 12. Background work magnifies every settled edit

After a successful visible settle, the app calls `prepareInactivePreview()` in `frontend/app.js` around line 4276. In single-view mode this may load the other HDR/SDR lane at the selected tier, including Full, around lines 11272–11307.

The project’s existing measurement found 24 inactive SDR source-tile requests totaling 1,945 ms and three scope requests totaling 1,726 ms per Full edit.

Recommended repair:

- Do not eagerly prepare an inactive Full lane in single-view mode.
- Prepare it when the user hovers or presses comparison, switches lanes, or the machine is genuinely idle.
- Give visible-current-generation work strict priority over scopes, inactive lanes, and cache warming.
- Cancel background work immediately when foreground work arrives.

## Current measurements

The current HEAD was run against the included 7968×5320 fixture on an NVIDIA GeForce RTX 4070 Ti with 12 GB VRAM.

### Tone benchmark

- 4K Direct gesture: 1,629.9 ms.
- Full Tiled gesture: 1,421.9 ms.
- Full reported settle tail: 169.3 ms.
- 37 Full interactive drafts were intentionally refused before dispatch.
- Zero CPU preview fallbacks.
- Ten scope requests consumed 929 ms.
- Raw result: `codebase/output/performance/review-full-tier-tone-cost.json`.

### Existing tier-change benchmark

- 4K → Full: 245 ms.
- No blank compositor samples.
- This does not test the reported Full → 4K transition while Full work is already queued.
- Raw result: `codebase/output/performance/review-tier-change-blank.json`.

### Full brush/local scenario

- Roughly 36–40 seconds end-to-end, including setup, Full preparation, brush creation, mask commit, feather update, and local exposure.
- Full stayed on WebGPU/Tiled.
- Local exposure encountered a mask-tile supersession/refusal before retry recovery.
- GPU compute was mostly 7–41%, with intermittent higher activity and one brief 100% sample.
- Dedicated GPU memory rose by roughly 2.1 GB during the run.

The tone benchmark is useful for detecting CPU fallback regressions, but it is not a responsiveness benchmark. Its Full path produces no live slider frames, and much of its measured “gesture time” is scripted event/pause time. The local-mask scenario is far more representative of the reported problem.

## Performance-test gaps

The present suite is strong on parity and correctness but weak on perceived interaction latency.

Important missing or underrepresented scenarios include:

- Full → 4K while an expensive Full frame is already submitted;
- settled 4K edits with exact peak enabled versus disabled, including the next-input queue delay;
- cold and warm local-mask edits at Full;
- local grading changes where mask geometry did not change;
- one, four, eight, and larger local stacks at 24–42 MP;
- halo amplification across default, high Detail, bloom, halation, and mixed local-Detail settings;
- time to first current visible tile, not merely final Ready state;
- cancellation latency after GPU submission begins;
- foreground latency while inactive-lane and scope work is running;
- rapid Denoise slider input with counts for requests, reconstructions, and accepted frames;
- transient source/mask/allocation failure followed by verified GPU recovery;
- canvas continuity from the last accepted frame through failed or superseded tiled work;
- real application VRAM peak versus logical plan;
- packaged Electron behavior on multiple GPU classes.

The sprint evidence correctly records that the hardware matrix remains deferred. The current results should not be generalized to integrated GPUs, unified-memory systems, or other browser/GPU backends without measurement.

## Recommended delivery sequence

### Immediate stabilization

1. Disable or genuinely idle-gate the separate native exact-peak scope render.
2. Add mask single-flight and bounded request concurrency.
3. Preserve the accepted canvas until a replacement is complete; make GPU failure recovery non-sticky for transient errors.
4. Defer inactive Full-lane preparation and lower the priority of all scope work.
5. Coalesce Denoise input to one in-flight and one latest pending state.
6. Add generation-aware abort signals to source and mask fetches.
7. Globally evict obsolete tiers and lanes before new allocation.
8. Add A/B benchmarks for Full → 4K in flight and exact peak on/off.

These should reduce the worst stalls without changing image semantics.

### Core renderer correction

1. Replace full-source residency with a reusable source-tile pool.
2. Submit small cancellable tile batches.
3. Pass the real viewport to the scheduler and define atomic replacement over that viewport.
4. Keep the previous frame visible in a separate presentation target.
5. Render exact visible tiles first.
6. Select tile dimensions from halo and the admitted working set; measure amplification explicitly.
7. Move masks to GPU evaluation or a genuinely tiled authoritative store.
8. Move scopes and full-image completion into lower-priority generation-bound jobs.

This is the change most likely to make Full feel responsive.

### Structural hardening

Split the two frontend monoliths—`app.js` is over 17,000 lines and `webgpu-preview.js` over 7,000—into explicit components:

- render coordinator/state machine;
- source tile provider;
- mask provider;
- GPU resource allocator;
- Direct executor;
- Tiled executor;
- presentation manager;
- scope/measurement worker.

The current shared mutable state and broad generation counters make race fixes highly path-dependent. The recent history shows several individual race repairs, but the architecture keeps creating new variants.

## Final assessment

The current problem should not be framed as “the GPU path is broken and falling back to CPU.” On the tested flow, the GPU path is active and CPU fallback is absent.

The more accurate diagnosis is:

1. settled Direct scopes can enqueue an unexpected native-resolution render after the requested preview;
2. local masks are bottlenecked by a severe backend/frontend fan-out design;
3. tiled rendering is whole-frame, monolithic, non-preemptible, and not currently viewport-aware;
4. resolution-scaled halos can make fixed-size tiling perform several times the nominal pixel work;
5. source and presentation residency remain whole-image;
6. synchronization, Denoise input, and background work repeatedly stall or compete with foreground rendering;
7. VRAM admission is based on an incomplete logical model and failure recovery is too coarse;
8. the existing performance gates emphasize correctness and fallback prevention, not perceived interaction latency.

The tile implementation successfully established parity and reduced some intermediate texture sizes. It has not yet delivered the virtualized, cancellable, visible-region-first architecture needed for responsive 24–42 MP editing.

## Assessment of the supplied independent report

The supplied report is strong—approximately **8.5/10** as an engineering audit. It is better than the original version of this report in static breadth and remediation structure. Its confidence labels, decisive experiments, negative controls, and explicit constraint list make it useful for planning. Most importantly, it found the native exact-peak render, unused viewport priority, halo amplification, sticky GPU-disable path, Denoise event serialization, and `activeRenderCount` gap that the original review had missed or underemphasized.

Its main limitation is that it is a static causal analysis, not a performance profile. Several findings are credible mechanisms but are presented more conclusively than the evidence supports:

- The exact-peak render is conditional on a settled Direct GPU scope with no region. It does not block the frame that has already presented; it blocks the settle chain and can delay subsequent GPU work. An enabled/disabled trace is still required to quantify it.
- The backend mask path is not reliably “cheap” after memoization. That is true for a warm hit, but the compile-outside-lock race permits a cold cache stampede. The other report misses this more serious backend defect.
- A browser connection-limit assumption is implementation-dependent and is not a substitute for explicit bounded concurrency.
- Not every fetch/allocation issue permanently disables WebGPU. Expected refusals and errors marked recoverable are exempt; the real defect is that an unclassified thrown error disables it too broadly.
- `tileSize ≈ 4 × halo` is a useful experiment, not yet a safe prescription. Larger tiles trade overlap for larger transient textures and cache entries.
- Fetching one whole-frame mask per local would reduce request count but can add large transfers and full-frame browser memory. Single-flight compilation plus batched or streamed tiles—and eventually GPU analytic masks—is a better target.

Overall, the two reports are complementary. The supplied report is stronger on static path enumeration and proposed experiments; this report is stronger on measured current behavior, the cold-mask cache race, actual GPU/VRAM observations, and distinguishing proven bottlenecks from plausible mechanisms. The revised priority order combines both.

## Reviewed references

- `docs/product/HDR_Finisher_PRD_v1.2.md`
- `docs/product/Stable_Exact_Full_Preview_Sprint_PRD_2026-09-19.md`
- `docs/technical/sprint-wrap-evidence-2026-09-21.md`
- `frontend/app.js`
- `frontend/webgpu-preview.js`
- `frontend/tile-scheduler.js`
- `frontend/preview-scheduler.js`
- `backend/hdr_finisher/main.py`
- `backend/hdr_finisher/render_cache.py`
- `backend/hdr_finisher/cpu_strips.py`
- `tests/performance/full-tier-tone-cost.js`
- `tests/performance/tier-change-blank-canvas.js`
- `tests/full-tier-brush-feather.js`
- Independent static report supplied as `Pasted text.txt` on 2026-09-22
