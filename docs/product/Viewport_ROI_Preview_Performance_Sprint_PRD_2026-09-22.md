# Viewport-Driven ROI Preview Performance Sprint

**Date:** September 22, 2026  
**Status:** Implementation started; Phase 0 product approval and packaged-hardware evidence remain hard gates  
**Owner:** HDR Finisher product and engineering  
**Application target:** Responsive, truthful authoring preview for 24–42 MP and 8K-class sources  
**Primary platforms:** Packaged Windows and macOS application shells, with WebGPU as the primary interactive path and a bounded CPU fallback  
**Competitive target:** Interaction should feel comparable to DxO PhotoLab, Adobe Lightroom, and darktable on equivalent hardware  
**Amends:** [Stable Exact Preview Tiers and Full-Resolution Processing Sprint](Stable_Exact_Full_Preview_Sprint_PRD_2026-09-19.md)  
**Related product requirements:** [HDR Finisher PRD v1.2](HDR_Finisher_PRD_v1.2.md)  
**Technical basis:** [Preview performance architecture review](../technical/preview-performance-architecture-review-2026-09-22.md), [review feedback](../technical/preview-performance-architecture-feedback-2026-09-22.md)

## 1. Executive summary

The current preview architecture processes a user-selected whole-image tier independently of the pixels visible on screen. On the 7968×5320 reference image, Full processes 42.4 MP to display roughly 3.1 MP at Fit, roughly 3.7 MP at 100% zoom, and roughly 0.92 MP at 200% zoom on a 2560×1440 viewport. Tiling reduces some temporary allocations but does not remove this excess work: the implementation still prepares the whole selected tier, processes every tile, and replaces the frame only when the full visible canvas is complete.

This sprint replaces the **exact selected tier** contract with an **exact for the displayed view** contract:

> Processing scale is derived from viewport × zoom × device-pixel ratio and is clamped at native scale 1.0. During interaction, a clearly identified coarse pass may be shown, but it must use the same graph and refine unconditionally to an exact-at-display-scale result. At zoom of 100% or greater, the refined visible region uses native source sampling and export-scale spatial radii.

The user-facing 1K/2K/4K/Full selector is replaced by a latency preference—**Responsive, Balanced, Precise**—while a resolution override remains available only in diagnostics. The renderer becomes a region-of-interest (ROI) pull pipeline with two coordinated paths:

- a small whole-image preview pipe for histogram, waveform, mask overview, navigation, and inexpensive global analysis;
- a full-quality ROI pipe that processes only the displayed source region at the scale required by the screen.

The sprint also fixes defects that remain relevant under the new contract: mask compilation stampedes, unbounded mask-request fan-out, non-preemptible GPU submissions, unsafe canvas replacement, sticky GPU disablement, uncoalesced Denoise input, incomplete resource accounting, and pixel transport that serializes through HTTP.

This is a product-contract change and a renderer redesign. It must not be implemented as a collection of isolated performance patches inside the current whole-frame tier architecture.

## 2. Problem statement and verified baseline

The current design has four structural problems.

### 2.1 Work does not track the display

The canvas backing store is sized to the selected tier while zoom is applied with CSS. The renderer is not given the real viewport. Consequently:

- Fit at Full computes approximately 14 times as many pixels as are displayed on the reference setup.
- At 100% zoom, 4K is stretched from 4096 pixels to the 7968-pixel source width, so the nominal 1:1 view is actually a 1.94× upsample.
- At 200% zoom, Full still computes all 42.4 MP although less than 1 MP of source is visible.
- Visible-first tile ordering exists in `frontend/tile-scheduler.js` but is unreachable because `frontend/webgpu-preview.js` never supplies a viewport.

### 2.2 Tiled execution remains whole-frame and non-preemptible

The current Tiled path:

- retains a whole selected-tier source texture;
- sizes the presentation canvas to the whole tier;
- fetches all local-mask tiles before encoding;
- encodes all tiles into one command buffer;
- submits once and cannot stop obsolete GPU work;
- waits for peak readback before returning.

A newer edit may invalidate the result, but it cannot remove already-submitted work from the queue.

### 2.3 Foreground work is mixed with analysis and background work

A settled Direct preview can start a second native-resolution Tiled render for exact peak measurement. Inactive HDR/SDR preparation, scopes, Denoise reconstruction, source uploads, and foreground rendering share queues without a strict foreground priority policy.

### 2.4 Local masks and resources have independent defects

- One 42 MP local can fan out to roughly 176 mask requests.
- Concurrent cold tile requests can compile the same whole-image mask repeatedly because compilation occurs outside the cache lock.
- GPU admission uses an incomplete logical ledger and a fixed 2 GiB Auto budget.
- Some unclassified render errors disable WebGPU for the remainder of the session.
- The current Full local-adjustment scenario took roughly 36–40 seconds end to end on the reference workstation.

## 3. Product goals

### G1. Interaction cost follows the viewport

Ordinary authoring work scales primarily with displayed pixels and active graph complexity, not total source megapixels.

### G2. Truthful inspection at every zoom

- Below 100% zoom, the refined preview is correctly filtered for the display resolution.
- At 100% zoom, one processed source pixel maps to one device pixel after device-pixel-ratio handling; no tier upsample is allowed.
- Above 100% zoom, processing remains at native scale 1.0 and magnification does not invent extra image information.
- At zoom of 100% or greater, spatial effects use export-scale radii over the visible ROI.

### G3. Immediate current-edit feedback

A stale exact frame must not be the only feedback during a gesture. A current-generation coarse frame may be shown during interaction when needed to meet the selected latency target, provided that it is labelled and always refines.

### G4. Foreground work is preemptible and prioritized

New input supersedes obsolete source fetches, mask work, CPU tasks, unsubmitted tile batches, scopes, inactive-lane preparation, and cache warming. Already submitted GPU work is bounded by small batches.

### G5. Bounded, recoverable resource behavior

The application tracks and reserves its working, presentation, cache, staging, in-flight, and deferred-destroy resources. Allocation pressure degrades through eviction, smaller coarse scale, Tiled execution, or CPU fallback without clearing the accepted frame or permanently disabling GPU acceleration after one transient error.

### G6. Export remains authoritative

No preview preference changes export dimensions, processing precision, operation order, color intent, metadata, or encoder settings. Refined ROI parity is validated against the export/reference implementation with module-appropriate tolerances.

## 4. Authoritative product decisions

### 4.1 Replace the resolution selector

The normal preview menu contains:

| Preference | Initial latency target | Coarse-pass policy |
|---|---:|---|
| **Responsive** | 33 ms | Adapt scale aggressively during interaction; exact refinement is mandatory. |
| **Balanced** | 66 ms | Default. Prefer exact first-pass output when recent timing predicts it will fit. |
| **Precise** | 150 ms | No coarse pass; render exact-at-display-scale from the first visible update. |

The values are starting targets, not permanent constants. They must be tuned from packaged-app measurements. The preference controls latency behavior only; it never changes export.

The 1K/2K/4K/Full selector is removed from the normal product UI after the replacement control passes acceptance. A diagnostic-only override remains for parity, memory, and regression testing.

### 4.2 Processing scale contract

For each render request, the coordinator computes:

- source-space visible rectangle;
- output device-pixel rectangle;
- processing scale required to cover the output without undersampling;
- graph halo in source pixels at that scale;
- minimum padded ROI;
- priority and generation.

Processing scale must not exceed native scale 1.0. The renderer must not process more pixels merely because CSS magnification exceeds 100%.

The first implementation should use a minimum padded ROI of approximately 1024×1024 source pixels at native scale, bounded at image edges. This is a tuning parameter, not a fidelity rule. Telemetry must determine the final value.

### 4.3 Coarse and refined presentations

The renderer may produce two presentations for one edit generation:

1. **Interactive — Coarse:** current edit, same graph, reduced processing scale selected by the latency controller.
2. **Ready — Display Exact:** current edit at the scale required by the viewport, with no hidden tier substitution.

Rules:

- Coarse output must be visibly distinguishable through a subtle status label; it must never say Ready.
- Refinement is unconditional after input stops or capacity becomes available.
- A coarse result may never replace a newer refined result.
- Coarse and refined passes must have identical adjustment order, constants, enabled modules, mask semantics, and color pipeline. Only scale-dependent sampling and radii may differ according to the declared scale contract.
- The previous accepted presentation remains visible behind missing regions until a generation-safe replacement is ready.
- Rapid input retains at most one in-flight generation plus one latest pending generation per foreground pipe.

### 4.4 Viewer states

| State | Meaning | Visible content |
|---|---|---|
| **Interactive — Coarse** | Current edit is visible at a temporary reduced scale. | Current coarse ROI plus retained valid background where necessary |
| **Updating — Display Exact** | Exact-at-display-scale work is running. | Latest current coarse result or last accepted exact result |
| **Ready — Display Exact** | Visible viewport matches the current edit at required display scale. | Current refined ROI |
| **Preparing View** | No valid ROI exists for the requested image/zoom/viewport. | Previous valid presentation or import surface, truthfully labelled |
| **Preview unavailable** | GPU and permitted recovery paths failed. | Last accepted presentation when available |

Progress may be shown within Preparing or Updating. It does not create additional states.

### 4.5 Exactness terminology

The product must distinguish:

- **Display exact:** sufficient source sampling and processing scale for the current viewport.
- **Native-region exact:** native scale 1.0 over the visible source region, applicable at zoom ≥100%.
- **Export parity:** refined ROI agrees with the authoritative export/reference graph within the approved tolerance for each module class.
- **Byte-identical:** reserved for comparisons within the same execution path where byte equality is actually demonstrated.

The UI must not claim byte-exact export matching unless the test corpus proves it. This avoids turning GPU floating-point implementation differences into a false product promise while preserving the stronger native-region inspection guarantee.

### 4.6 Scope and exact-peak policy

- Interactive and settled histogram/waveform scopes come from the small whole-image preview pipe and identify their freshness.
- Scope work is lower priority than foreground ROI work.
- The separate native-resolution exact-peak render is disabled by default for continuous authoring.
- An exact whole-image adjusted peak may run after a true idle window, on explicit request, or when required by an enabled adjustment. It must be cancellable between tile batches and must not delay foreground presentation.
- Until exact analysis completes, the UI must label the peak as preview-derived rather than presenting it as a delivery-safe exact value.
- If an exact peak has already been produced by relevant current-generation work, consumers reuse it.

### 4.7 CPU-only behavior

CPU-only systems use the same viewport/scale contract. Work runs outside the UI thread, is cancellable between strips/tiles, and retains the accepted frame. Responsive and Balanced may use a coarse pass; Precise waits for exact-at-display-scale output. Export remains unchanged.

## 5. Target architecture

### 5.1 Render coordinator

A dedicated coordinator owns:

- edit, viewport, scale, source, and lane generations;
- foreground versus background priority;
- one-in-flight/one-latest-pending coalescing;
- cancellation tokens for fetch, CPU, and unsubmitted GPU batches;
- presentation acceptance;
- coarse-to-refined lifecycle;
- timing feedback for the latency controller.

`app.js` emits intent and presents state; it must no longer coordinate individual source, mask, scope, and renderer races directly.

### 5.2 Two preview pipes

#### Whole-image preview pipe

Purpose:

- navigation thumbnail;
- histogram and waveform;
- mask overview;
- coarse global analysis;
- initial Fit placeholder while exact display work arrives.

It uses a bounded persistent mip level appropriate to the analysis/display request. It does not silently stand in for a Ready ROI result.

#### Full-quality ROI pipe

Purpose:

- visible authoring result;
- 1:1 and magnified inspection;
- local adjustment feedback;
- exact-at-display-scale refinement.

It accepts a source-space rectangle, processing scale, output rectangle, halo requirements, generation, and priority. It returns generation-labelled tiles or an atomic viewport presentation.

### 5.3 Persistent multi-resolution source cache

The cache stores correctly filtered, scene-linear source levels so Fit and low-zoom views do not reread and downsample the full decoded image on every edit.

Required contract:

- key by source content/epoch, decoder version, source color transform version, orientation, and cache format version;
- store pre-adjustment canonical scene-linear data; grade changes must not invalidate source mips;
- keep geometry mapping explicit so crop/rotation/perspective ROI requests resolve to the required source regions and halos;
- build levels atomically and tolerate interruption;
- use byte-bounded memory and disk LRUs;
- validate odd dimensions, HDR headroom, negative values, orientation, and edge filtering;
- remove or migrate stale cache versions safely;
- expose cold/warm hit, bytes read, bytes generated, and build duration telemetry.

A color mip and a maximum-preserving analysis pyramid answer different questions. Do not substitute a max pyramid for display filtering or claim an adjusted exact peak from source-only maxima.

### 5.4 Tile and pan cache

Processed ROI tiles are keyed by at least:

- source and geometry identity;
- lane and edit generation;
- processing scale/mip level;
- globally anchored source/output rectangle;
- graph/module identity;
- relevant mask identities;
- color/presentation format.

Panning reuses overlapping valid tiles and renders only newly exposed edges. Zoom changes may reuse source mips but must not reuse processed pixels whose scale-dependent graph result is invalid.

### 5.5 Cancellable GPU executor

- Pass the real viewport to the tile scheduler.
- Submit small batches, initially 4–8 tiles, with a generation check before every batch.
- Tune batch size from measured cancellation latency and submission overhead.
- Use generation-specific offscreen targets or a retained tile atlas.
- Composite only current-generation complete regions.
- Never resize or clear the visible canvas before a replacement is ready.
- Use a viewport-sized presentation surface rather than a whole-image swapchain.
- Track processed pixels, output pixels, halo amplification, passes, batch count, submission time, queue wait, and cancellation delay.

### 5.6 Source and mask providers

The source provider serves ROI tiles from the persistent mip cache through a bounded ring of reusable GPU textures and staging buffers. Fetch/decode/upload of batch N+1 should overlap execution of batch N without global `queue.onSubmittedWorkDone()` drains.

The mask provider must:

- use per-mask single-flight compilation immediately;
- bound network and compile concurrency;
- preserve identity across unrelated grade changes;
- batch or stream tile payloads rather than creating one request per tile;
- evaluate compact analytic masks in WGSL where parity permits;
- maintain a genuinely tiled authoritative store for brush masks and update only dirty tiles.

### 5.7 GPU resource allocator

Every GPU allocation requires a reservation from a central registry. The registry records:

- working-set bytes;
- presentation bytes;
- cache bytes;
- staging/upload/readback bytes;
- in-flight bytes;
- deferred-destroy bytes;
- untracked contingency.

Budgets are separate for working, presentation, and cache pools under one global eviction policy. Auto is calibrated from verified device information plus a safe allocation probe where supported. The fixed 2 GiB value remains a conservative fallback only until calibration is proven. Auto must not be raised before ledger agreement and failure recovery pass.

### 5.8 Failure policy

Errors are classified as:

- superseded/cancelled;
- recoverable transport failure;
- recoverable allocation pressure;
- unsupported graph;
- shader/validation defect;
- device loss;
- permanent initialization failure.

Only permanent initialization failure or repeated unrecoverable validation failure may disable WebGPU for the session. Allocation pressure triggers eviction/backoff; device loss triggers device rebuild; transport errors retry within a bounded policy. All paths retain the accepted frame.

### 5.9 Module parity policy

Python/NumPy remains the export/reference authority. WGSL is the interactive implementation. Each module declares:

- scale behavior and radius conversion;
- halo or multiscale dependency;
- GPU/CPU numerical tolerance;
- whether it can run coarse;
- cache dependencies;
- CPU fallback behavior.

New modules may not silently ship only in one path. Any GPU-only preview feature requires an explicit product label and export plan.

## 6. Delivery plan

Each phase ends with an independently reviewable checkpoint and saved evidence. A dependent phase may not begin until its stop gates are recorded.

### Phase 0 — Approve the contract and establish decisive baselines

**Goal:** Confirm the product change and remove uncertainty that would invalidate the design.

Work:

1. Approve, revise, or reject the replacement clause in Section 1.
2. Approve retirement of the normal 1K/2K/4K/Full selector and adoption of Responsive/Balanced/Precise.
3. Capture current packaged-app baselines on the 42.4 MP fixture at Fit, 100%, 200%, and a representative pan.
4. Measure slider-to-first-current-pixel, time-to-refined, queue delay, processed pixels, GPU memory, CPU time, source/mask bytes, and scope work.
5. Run exact peak enabled/disabled A/B measurements.
6. Run Full-at-Fit versus correctly mip-filtered Fit screenshot comparisons on grain, Detail, Denoise, halation, fine repeating detail, and saturated highlights.
7. Define approved parity tolerances per module class; identify where byte equality is required.
8. Record migration behavior for existing preview preferences.

Exit gates:

- Product owner signs off the display-driven contract and control replacement.
- Baselines and hardware metadata are saved in `codebase/output/performance/` or another named evidence location.
- The Fit filtering hypothesis has measured evidence; the PRD does not rely on it if disproven.
- No unresolved terminology exists for Display exact, Native-region exact, Export parity, or Byte-identical.

Stop condition: if the selected-tier doctrine remains authoritative, do not execute Phases 2–5 of this PRD. Return to a narrower defect-remediation sprint.

### Phase 1 — Stabilize defects that survive the redesign

**Goal:** Remove severe races and queue pollution without building throwaway whole-frame features.

Work:

1. Idle-gate or disable automatic native exact-peak measurement.
2. Add backend per-mask single-flight keyed by canonical mask identity.
3. Add bounded, generation-aware mask request concurrency and batch transport.
4. Preserve the accepted canvas until a complete replacement is ready.
5. Replace generic sticky GPU disablement with the failure taxonomy in Section 5.8.
6. Coalesce Denoise input to one in-flight plus one latest pending state.
7. Add abort signals/generation checks to source and mask work.
8. Include direct `renderTiledTo()` work in active-render lifetime protection.

Exit gates:

- Concurrent cold requests compile one mask identity once.
- Rapid local edits never exceed the configured request/compile limits.
- A superseded or failed render never clears the accepted frame.
- A synthetic recoverable allocation or transport failure does not permanently disable WebGPU.
- Denoise rapid-input tests show bounded reconstruction/render counts and latest-state acceptance.
- Exact-peak analysis never starts while foreground work is queued.

### Phase 2 — Introduce the coordinator, viewport contract, and retained presentation

**Goal:** Make viewport ROI a first-class request while preserving current output as a fallback.

Work:

1. Extract render coordination and generation ownership from `app.js`.
2. Define immutable viewport requests containing source rect, output rect, DPR, zoom, scale, halo, lane, and generations.
3. Pass the real viewport to `tile-scheduler.js`.
4. Add a viewport-sized offscreen/retained presentation target.
5. Implement small-batch tiled submission with cancellation checks.
6. Add processed/output pixel and halo-amplification telemetry.
7. Implement minimum-ROI padding and globally anchored tile keys.
8. Establish the display-scale pan cache.
9. Keep an engineering switch that compares legacy whole-frame output with ROI output.

Exit gates:

- Scheduler traces show offscreen tiles are not part of the foreground batch.
- A new input stops further obsolete submissions within 50 ms on reference hardware.
- Warm pan renders only newly exposed tiles and meets the pan gate in Section 8.
- The visible canvas is never cleared between generations.
- ROI pointwise output matches a crop of the legacy/reference output within approved tolerance.
- Legacy mode remains available behind diagnostics until the complete graph passes.

### Phase 3 — Add the persistent mip source and scale-aware full graph

**Goal:** Make Fit and magnified ROI fast without weakening spatial correctness.

Work:

1. Implement the persistent multi-resolution source cache from Section 5.3.
2. Route ROI source requests to the appropriate mip and region.
3. Define scale propagation for Detail, Denoise, grain, bloom, halation, softness, masks, and geometry.
4. Port all active nodes to the ROI request contract.
5. Implement the small whole-image preview pipe for scopes/navigation/mask overview.
6. Add GPU analytic-mask evaluation where parity is established; retain tiled brush masks.
7. Add local Detail/Denoise cache identities that include scale and upstream inputs.
8. Implement cold-cache build progress and cancellation.

Exit gates:

- A warm Fit render does not read or upload the full native image.
- 100% view has a 1:1 processed-to-device-pixel mapping after DPR handling.
- At zoom ≥100%, refined ROI passes export/reference parity for grain, Detail, Denoise, masks, and spatial film effects.
- No tile seams appear at maximum supported radii, geometry boundaries, mask boundaries, or image edges.
- Cache invalidation tests cover source replacement, color-pipeline version, geometry, edit, scale, and corruption.
- Cold and warm source-cache timings and disk/RAM footprints are recorded.

### Phase 4 — Add adaptive coarse refinement and replace the UI control

**Goal:** Deliver continuous current-edit feedback across hardware classes.

Work:

1. Add the latency controller using recent per-graph timing and the selected target.
2. Implement labelled coarse-first rendering for Responsive and Balanced.
3. Make refinement unconditional and generation-safe.
4. Add Responsive/Balanced/Precise UI, help text, persistence, and diagnostics.
5. Migrate existing preferences:
   - 1K → Responsive;
   - 2K or 4K → Balanced;
   - Full → Precise.
6. Retain the previous preference in migration diagnostics for supportability.
7. Remove the normal tier selector only after the new control passes gates.

Exit gates:

- Coarse output is never labelled Ready.
- Refined output matches a no-coarse control within the same-path byte/tolerance contract.
- Rapid reversal presents zero stale coarse or refined frames.
- The latency controller converges without oscillating visibly between scales.
- Preferences round-trip and migrate without modifying project/export state.
- The old tier selector is inaccessible in normal UI and remains available in diagnostics.

### Phase 5 — Resource allocator, transport topology, and release hardening

**Goal:** Make the new pipeline safe and competitive beyond the reference workstation.

Work:

1. Introduce mandatory central GPU reservations and global LRU eviction.
2. Calibrate Auto budget and retain a safe fallback when device memory cannot be established.
3. Replace per-strip global queue drains with a staged ring and batch-local completion.
4. Prototype binary socket, shared-memory/file-backed, or frontend decode transport; select using measured copies, latency, complexity, and platform support.
5. Defer inactive-lane work until true idle or explicit comparison intent.
6. Add device-loss rebuild, cache corruption recovery, and endurance tests.
7. Run the supported hardware matrix.

Exit gates:

- Logical peak agrees with instrumented application allocations within 15%; remaining driver/browser overhead is reported separately.
- No test exceeds the admitted application budget without a classified recovery.
- Foreground work preempts scopes, inactive lanes, cache warming, and background exact analysis.
- Selected pixel transport materially reduces copies or latency and passes Windows/macOS packaging/security requirements.
- Discrete GPU, integrated/unified GPU, and CPU-only results are recorded; unsupported configurations are disclosed rather than inferred.

## 7. Workstream ownership and implementation map

| Workstream | Primary files/components | Required outputs |
|---|---|---|
| Product state and UI migration | `frontend/app.js`, `frontend/index.html`, styles, `frontend/application-shell.js` | latency preference, viewer states, migration tests |
| Render coordinator | new focused frontend module plus `frontend/preview-scheduler.js` | immutable request contract, priority, cancellation, telemetry |
| ROI/tile execution | `frontend/webgpu-preview.js`, `frontend/tile-scheduler.js` | viewport plans, small batches, retained presentation, pan cache |
| Source cache/provider | `backend/hdr_finisher/render_cache.py`, `main.py`, geometry helpers; frontend source upload path | persistent mips, ROI transport, cache versioning |
| Mask provider | `backend/hdr_finisher/render_cache.py`, `local_adjustments.py`, `main.py`; WGSL mask path | single-flight, batching, analytic/tiled masks |
| Scope worker | `frontend/app.js`, WebGPU scope code, `backend/hdr_finisher/scopes.py` | preview pipe, priority, freshness, exact-analysis policy |
| GPU allocator | new focused frontend module plus `frontend/webgpu-preview.js` | reservations, pool budgets, LRU, recovery |
| CPU ROI fallback | `backend/hdr_finisher/preview.py`, `cpu_strips.py`, `adjustments.py` | cancellable ROI/scale execution and parity |
| Tests/evidence | `tests/`, `tests/performance/`, Electron harness | latency, parity, resource, recovery, hardware reports |

The implementation should extract components while the pipeline is being changed. Do not first reproduce the new architecture inside the existing 17,000-line `app.js` and 7,000-line `webgpu-preview.js` and defer decomposition to a later cleanup.

## 8. Acceptance gates

All latency measurements use input-event timestamp to the first compositor-observable current-generation pixel, not handler duration or command submission time. Report median, p95, worst, sample count, cold/warm state, graph, viewport, source, hardware, driver, OS, Electron/Chromium version, and power mode.

Initial reference setup: 7968×5320 fixture, 2560×1440 viewport, packaged app, named RTX 4070 Ti workstation. Phase 0 may revise numeric targets only with recorded evidence and product approval.

### 8.1 Responsiveness

| Metric | Target |
|---|---:|
| Slider-to-current-pixel, Fit, Balanced | <50 ms p95 |
| Slider-to-refined, Fit, Balanced | <100 ms p95 |
| Slider-to-refined, 100% zoom | <100 ms p95 |
| Slider-to-current-pixel, 200% zoom | <50 ms p95 |
| Warm pan to current pixels | <33 ms p95 |
| First visible ROI after cold zoom/view change | <150 ms p95 |
| Obsolete-work cancellation before next batch | <50 ms p95 |
| Warm local-grade edit with unchanged mask geometry | <100 ms p95 |
| Warm mask-geometry edit | <200 ms p95 |
| UI input handler duration | <16.7 ms p95 |

The target is zero intentional “no interactive frame” behavior in the ROI-capable graph. Unsupported nodes must be disclosed and routed through a retained-frame fallback rather than silently lowering fidelity.

### 8.2 Correctness

- At 100% zoom, presented device pixels are not produced by CSS upsampling a smaller backing store.
- Refined output at zoom ≥100% matches the export/reference crop within approved per-module tolerances.
- Direct, Tiled/ROI, GPU, and CPU paths pass their declared parity contracts.
- Coarse-to-refined convergence changes scale only; graph semantics and edit generation are identical.
- Grain is deterministic across tile order, pan, Direct/ROI execution, and repeated renders.
- Detail, Denoise, bloom, halation, softness, geometry, masks, locals, HDR range, negative values, and image edges have seam coverage.
- Scopes describe a named accepted or preview-pipe generation and never a discarded generation.
- Export bytes and metadata are identical for identical project state regardless of preview preference.

### 8.3 Resource behavior

- Presentation memory scales with viewport, not source dimensions.
- Warm Fit does not upload the whole native source.
- Source, mask, and processed caches are byte-bounded and globally evictable.
- Peak application-controlled allocation is within 15% of the logical registry on instrumented tests.
- Zero uncategorized allocations exist in owned WebGPU code.
- Allocation failure retains the frame and follows the declared recovery ladder.
- Repeated pan/zoom/edit/lane/compare cycles do not show monotonic GPU or host-memory growth.

### 8.4 Required benchmark matrix

Run at minimum:

- Fit, 100%, 200%, and 400%;
- cold and warm source cache;
- pointwise grade, maximum Detail radius, Denoise, film spatial effects, one local, four locals, and eight locals;
- mask grading change versus mask geometry change;
- exact peak on/off and explicit exact analysis;
- rapid reversal and tier-preference migration;
- device loss, transient transport error, allocation pressure, and corrupt disk-cache entry;
- discrete GPU, integrated/unified GPU, and CPU-only reference machines;
- standard-DPI and high-DPI displays, including the adverse case of a 4K display on integrated graphics.

Negative controls must prove that tests detect:

- the current 4K-at-100% upsample;
- a stale-generation presentation;
- a seam at a tile boundary;
- an exact-peak job competing with foreground work;
- duplicate cold mask compilation;
- a canvas clear before replacement;
- an untracked GPU allocation.

## 9. Telemetry contract

Every preview generation records:

- request and accepted generation IDs;
- source, lane, edit, geometry, viewport, and scale identities;
- preference and target latency;
- coarse/refined mode;
- viewport/output/source pixel counts;
- processed pixels and `processedPixels / outputPixels`;
- tile count, visible count, halo, effective work dimensions, and pass count;
- queue delay, source wait, mask wait, encode, submit, GPU completion, readback, composite, and total visible latency;
- cancelled before fetch, before encode, between batches, or stale after submit;
- source/mask bytes and cache hits/misses;
- memory by allocator pool;
- failure class and recovery action;
- foreground/background priority and any priority inversion.

Performance evidence must use this telemetry rather than inferring responsiveness from total scripted scenario duration.

## 10. Risks and mitigations

### R1. ROI parity fails for spatial effects

Mitigation: each node declares scale and halo behavior; keep legacy diagnostic comparison; block that node from Ready ROI status until seam and export/reference parity pass.

### R2. Persistent mips alter HDR values or fine texture

Mitigation: store scene-linear float data, version filters, test negative/HDR values and odd dimensions, and keep display filtering separate from maximum-oriented analysis.

### R3. Coarse feedback causes a visible refinement jump

Mitigation: use the same graph, adapt only scale, label Coarse, set a minimum scale, and measure coarse/refined perceptual deltas on high-frequency and spatial-effect fixtures.

### R4. Small ROI plus large halo becomes inefficient

Mitigation: minimum-ROI floor, pan cache, telemetry-driven tile/batch sizes, and multiscale strategies for large-radius nodes. Do not adopt `tileSize = 4 × halo` without measurement.

### R5. Disk cache becomes large or stale

Mitigation: byte cap, global LRU, versioned keys, atomic writes, corruption recovery, user-visible clear-cache action, and no project dependence on cache presence.

### R6. Device-memory calibration is unreliable

Mitigation: treat Electron GPU information as a hint, validate an allocation probe, preserve a conservative fallback, and never infer physical VRAM from WebGPU alone.

### R7. Transport redesign expands platform/security scope

Mitigation: benchmark at least two options; retain authenticated loopback transport until the replacement passes packaging, path, permissions, cleanup, and crash-recovery review.

## 11. Explicit non-goals

This sprint does not:

- change export resolution, color science, adjustment order, metadata, or encoder quality;
- replace the Denoise algorithm or retune its presets solely for preview performance;
- guarantee that a preview-derived whole-image peak is exact;
- make delivery encodes continuous during grading;
- promise one universal latency on all hardware without reporting the tested configuration;
- infer competitor internals as a release gate; the gate is measured HDR Finisher behavior;
- remove CPU fallback;
- expose physical VRAM as a certainty when the platform cannot provide it;
- require GPU-only implementations without an explicit product decision;
- delete the legacy tier path before ROI correctness, migration, and recovery gates pass.

## 12. Preference migration and documentation

- Migration is device/profile preference state, never project state.
- Suggested mapping is 1K → Responsive, 2K/4K → Balanced, Full → Precise.
- Users see a one-time concise explanation: preview now follows the displayed view; export quality is unchanged.
- Help explains Coarse, Display exact, Native-region exact, and exact analysis without implying that Fit is export-resolution processing.
- Diagnostics expose viewport, scale, mip, mode, generation, cache, memory, and legacy override.
- Existing projects open without schema changes caused solely by this sprint.

## 13. Definition of done

The sprint is complete when:

- the display-driven processing contract is approved and documented;
- the normal resolution selector is replaced by Responsive/Balanced/Precise;
- Fit, 1:1, magnified zoom, and pan use viewport-derived ROI requests;
- 1:1 inspection contains no tier upsample;
- refined native-region output passes export/reference parity for the supported graph;
- coarse output is truthful, labelled, generation-safe, and always refines;
- persistent source mips make warm Fit independent of full native-source upload;
- foreground rendering is batched, cancellable, and prioritized over scopes/background work;
- local mask compilation is single-flight and request concurrency is bounded;
- Denoise input is coalesced;
- visible presentation survives cancellation, transient failure, allocation pressure, and device recovery;
- the central resource ledger and cache limits pass agreement/endurance gates;
- headline latency, correctness, resource, and hardware-matrix evidence is published;
- export output is unchanged for identical project state;
- no undocumented release blocker or waived gate remains in the handoff ledger.

## 14. Required handoff ledger

For every phase, record:

- commit or named working-tree checkpoint;
- commands and fixture versions;
- hardware/application metadata;
- raw evidence paths;
- before/after metrics;
- passed, failed, waived, and deferred gates;
- negative controls executed;
- remaining risks and the next safe edit.

No phase may be described as complete from code review alone when its gate requires runtime measurement.

## 15. Live implementation and handoff ledger

This section is the authoritative continuation point for agents working through the sprint. Update it after each completed implementation step. A checked work item means the named code change and its focused automated tests are complete; it does not imply that the phase exit gates or packaged-app measurements have passed.

### 15.1 Phase status

| Phase | Status | Gate note |
|---|---|---|
| Phase 0 | **Pending product/hardware gate** | The display-driven contract, control replacement, parity tolerances, migration behavior, 42.4 MP packaged baselines, and Fit filtering A/B still require product-owner decisions and reference-hardware evidence. No approval is inferred from starting safe Phase 1 defect work. |
| Phase 1 | **In progress** | Work items 1, 2, 3, 4, and 8 are implemented below; item 3's batch transport landed in the 15.3 checkpoint and item 4's presentation gate in 15.4. The phase remains open until items 5–7 and every runtime exit gate pass. |
| Phases 2–5 | **Not started** | Do not begin dependent architecture work until the Phase 0 stop gate is resolved and recorded. |

### 15.2 Working-tree checkpoint — 2026-09-22

Checkpoint name: `phase-1-mask-concurrency-singleflight-and-exact-peak-opt-in` (uncommitted working tree)

Completed work:

- [x] **Phase 1.1 — Disable automatic native exact-peak analysis.** `frontend/app.js` and `frontend/index.html` now default Exact peak to off. Exact measurement remains available through explicit user opt-in, and preview-derived peak disclosure remains active while it is off. The Electron exact-peak scenario was updated to assert the new default while continuing to exercise both enabled and disabled behavior.
- [x] **Phase 1.2 — Add backend per-mask single-flight keyed by canonical mask identity.** `SessionRenderCache` now gives one request ownership of a cold mask compile while concurrent requests wait for its result. The key includes source epoch, edge, geometry signature, local identity, and spatial mask signature. Source replacement cannot let an obsolete compile repopulate the current cache.
- [x] **Phase 1.3a — Bound and cancel frontend mask-tile requests.** The new `HDRMaskRequestCoordinator` limits foreground mask fetches to six concurrent requests, gives explicit background analysis a separate two-request queue, aborts active requests from a superseded generation, and checks currency before allowing queued work to start. `fetch` now receives the generation's abort signal. Phase 1.3 remains open because batch/stream transport is not implemented yet.
- [x] **Phase 1.8 — Include direct `renderTiledTo()` work in active-render lifetime protection.** Public tiled calls now increment the shared active-render counter before their first asynchronous source operation and release it in `finally`. Deferred destruction cannot run while an exact/background tiled render is awaiting or encoding, including error paths.

Files changed:

- `codebase/backend/hdr_finisher/render_cache.py`
- `codebase/frontend/app.js`
- `codebase/frontend/index.html`
- `codebase/frontend/mask-request-coordinator.js`
- `codebase/tests/test_render_cache.py`
- `codebase/tests/test_frontend_contract.py`
- `codebase/tests/mask-request-coordinator.test.js`
- `codebase/tests/tiled-render-lifetime.test.js`
- `codebase/tests/scope-exact-peak.js`
- this PRD

Verification:

- `codebase/.venv/Scripts/python.exe -m pytest tests/test_render_cache.py tests/test_api.py tests/test_frontend_contract.py -q`
  - Result: **140 passed**, 1 upstream Starlette deprecation warning, 3.67 s.
- `node --check frontend/app.js`
  - Result: **passed**.
- `node --check tests/scope-exact-peak.js`
  - Result: **passed**.
- `node --test tests/mask-request-coordinator.test.js`
  - Result: **2 passed**, 60.94 ms.
- `node --check frontend/mask-request-coordinator.js`
  - Result: **passed**.
- `node --check frontend/webgpu-preview.js`
  - Result: **passed**.
- `node --test tests/tiled-render-lifetime.test.js tests/mask-request-coordinator.test.js`
  - Result: **3 passed**, 66.81 ms.
- `node --test`
  - Result: **112 passed**, 0 failed, 8.01 s (complete auto-discovered JavaScript unit suite).
- `git diff --check`
  - Result: **passed**; Git reported only the repository's existing LF-to-CRLF checkout warnings.

Focused negative controls added or updated:

- Four concurrent cold requests for one mask identity must invoke the authoritative compiler exactly once, return the same cached array, record three single-flight waits, and leave one cache entry.
- A mask compile crossing source replacement must leave zero obsolete cache entries; the next request must compile the new source and create exactly one current entry.
- Static frontend contract checks fail if Exact peak returns to a checked/default-on state.
- Nine queued mask tasks with a configured concurrency of three must never exceed three active workers.
- Replacing a six-task generation after its first two requests start must abort those two and must never start the four obsolete queued requests; the new generation must complete normally.
- A direct tiled render paused on proxy loading must keep `activeRenderCount` at one, defer a requested destruction, and flush that destruction only after a synthetic failure exits through `finally`.

Gate accounting:

- **Passed in focused automated coverage:** concurrent cold requests compile one mask identity once.
- **Partially addressed, runtime evidence pending:** exact-peak analysis is disabled by default, but the packaged-app negative control proving an explicitly requested/background exact analysis never competes with queued foreground work has not run.
- **Passed in deterministic unit coverage:** mask fetch concurrency is bounded, active obsolete fetches receive abort signals, and obsolete queued requests do not start.
- **Passed in deterministic unit coverage:** direct `renderTiledTo()` work participates in active-render lifetime protection on both pending and error paths.
- **Not yet passed:** packaged rapid-local-edit concurrency evidence, batch mask transport, retained-canvas failure behavior, failure taxonomy, Denoise coalescing, and broader source abort/generation propagation.
- **Deferred evidence:** Electron/WebGPU runtime tests and the 42.4 MP packaged fixture were not run in this checkpoint.

Before/after metrics:

- Cold same-identity mask compile fan-out in the new deterministic test: **4 compiler calls before the fix's modeled behavior → 1 compiler call after**; three callers wait on the owning flight.
- Mask HTTP fan-out: **unbounded `tiles × locals` simultaneous fetches → at most 6 foreground or 2 explicit-background fetches per renderer instance**. Packaged latency and throughput effects are not yet measured.
- Exact-peak default: **automatic/on → explicit opt-in/off**. No latency claim is recorded until packaged measurement runs.

Remaining risks:

- The browser request ceiling indirectly bounds backend compilation initiated by one renderer instance, but the backend does not yet enforce a process-wide distinct-identity compile limit across clients.
- Existing tile transport still issues one HTTP request per tile; batching/streaming and generation-aware request limits remain required.
- Explicit exact-peak work can still contend with foreground rendering after the user enables it; priority/idle gating remains required before the related exit gate can pass.

Next safe edit:

1. Complete Phase 1.3 with a bounded batch mask-tile endpoint/response format so one generation does not require one HTTP request per tile, while retaining the new coordinator as the generation and concurrency guard.
2. Add API reassembly/parity tests for edge tiles, halos, multiple locals, stale revisions, and malformed/out-of-bounds batch entries.
3. Re-run the focused Python/API suite plus the mask interaction and performance Electron scenarios; record raw output under `codebase/output/performance/` before marking any runtime gate passed.

### 15.3 Working-tree checkpoint — 2026-09-22 (batched mask transport)

Checkpoint name: `phase-1-mask-batch-transport` (uncommitted working tree, continuing 15.2)

This checkpoint closes items 1 and 2 of the 15.2 next-safe-edit list and executes item 3 in Chromium/Edge. The packaged (Electron) half of item 3 remains deferred.

Completed work:

- [x] **Phase 1.3 — Bound mask transport with a batch endpoint.** `POST /api/session/{session_id}/local-mask-tiles` accepts a bounded batch of globally anchored tile rectangles sharing one edit revision. Each distinct `(local_id, mask_path)` identity is compiled once and every requested rectangle is sliced from that one array. Entries entirely outside the compiled mask, unknown locals, and invalid mask paths are reported per entry instead of failing the batch. The response is one length-prefixed container: magic, entry count, manifest length, JSON manifest, then length-prefixed r8 payloads. The backend caps a batch at 64 entries and 128 MiB of haloed tiles.
- [x] **Frontend batch planning and reassembly.** `HDRMaskTileBatch.plan` groups tiles by local into batches bounded at 64 tiles / 32 MiB, and `HDRMaskTileBatch.parse` reassembles the container. `webgpu-preview.js` sends each batch through the existing generation-aware `HDRMaskRequestCoordinator`, so one HTTP request and one coordinator slot now carry many tiles. Resident tiles are still answered from `maskTiles` without a request, so a pan or grade-only edit fetches only newly exposed tiles.
- [x] **Shared tile slicing.** The single-tile and batch endpoints share `_slice_mask_tile`, so an identical rectangle returns identical geometry and bytes on either route; the per-tile endpoint remains for diagnostics and parity tests.
- [x] **Phase 1.3 tests.** API reassembly/parity coverage and JS unit coverage for the planner, parser, and batch-slot behavior, plus a static frontend contract that fails if the per-tile route returns to the tile loader.

Files changed:

- `codebase/backend/hdr_finisher/main.py`
- `codebase/backend/hdr_finisher/models.py`
- `codebase/frontend/mask-request-coordinator.js`
- `codebase/frontend/webgpu-preview.js`
- `codebase/tests/test_api.py`
- `codebase/tests/test_frontend_contract.py`
- `codebase/tests/mask-request-coordinator.test.js`
- `codebase/tests/performance/tiled-mask-batch-transport.js` (new)
- `codebase/package.json`
- this PRD

Verification:

- `codebase/.venv/Scripts/python.exe -m pytest tests/test_render_cache.py tests/test_api.py tests/test_frontend_contract.py -q`
  - Result: **144 passed**, 1 upstream Starlette deprecation warning, 3.69 s.
- `codebase/.venv/Scripts/python.exe -m pytest tests/test_local_adjustments.py tests/test_source_tile_api.py tests/test_preview_resolution_contract.py tests/test_cpu_strips_api.py tests/test_api.py tests/test_render_cache.py tests/test_frontend_contract.py -q`
  - Result: **282 passed**, 17 warnings (16 upstream Pillow `mode` deprecations), 6.77 s.
- `node --test`
  - Result: **116 passed**, 0 failed, 9.20 s (was 112 before this checkpoint; +4 batch tests).
- `node --check frontend/mask-request-coordinator.js` and `node --check frontend/webgpu-preview.js`
  - Result: **passed**.
- Runtime, Chromium/Edge WebGPU against a local dev server (`127.0.0.1:8799`, delivery-proof test pattern 1280×720, tiled execution forced):
  - `node tests/performance/tiled-mask-batch-transport.js --url http://127.0.0.1:8799`
    - Result: **passed**. `rendered: true`, `execution: "tiled"`, `batchRequests: 2`, `perTileRequests: 0`, `batchTiles: [4, 6]`, batch HTTP statuses `[200, 200]`, no page errors. Evidence: `codebase/output/performance/tiled-mask-batch-transport.json`.
  - `node tests/mask-graph-interaction.js --url http://127.0.0.1:8799`
    - Result: **passed**; `maskRequestsDuringInfluenceEdits: 0`, undo/redo intact.
  - `node tests/full-tier-brush-feather.js --url http://127.0.0.1:8799` (42.4 MP fixture, Full, bloom halo, tiled, brush feather race)
    - Result: **passed**; viewer ready, no Unavailable event, no bounded-CPU fallback. The recorded `mask tile unavailable or superseded` refusal is the scenario's deliberately injected superseded settled generation, and refinement recovered to Ready.
  - Dev-server access log recorded `POST /api/session/{id}/local-mask-tiles HTTP/1.1 200 OK` during the batch scenario.
- Electron harness: **deferred, not passed**. `node tests/run-in-electron.js tests/mask-graph-interaction.js` failed with `Error: Process failed to launch!` from Playwright's Electron launcher; the Electron binary itself runs (`electron --version` → v24.18.1). No packaged-app gate is claimed from this checkpoint.

Focused negative controls added or updated:

- A batch of six tiles for one identity reassembles byte-identical to the whole-mask endpoint and reports `X-Mask-Batch-Compiles: 1`; two locals in one batch report `2`.
- An edge tile, an outside tile, an unknown local, and an invalid mask path in one batch produce `ok` / `outside` / `missing` / `invalid` entries with correct clamped geometry, and only the one valid identity compiles.
- The batch entry for an edge rectangle is byte-identical to the single-tile endpoint response for the same rectangle, including clamped tile geometry.
- Stale `edit_revision` and mismatched `geometry_signature` → 409; malformed geometry JSON → 400; empty tiles, zero width, oversized halo, 65 entries, and a 128 MiB-plus batch → 422.
- `HDRMaskTileBatch.plan` groups by local, honors tile and byte caps, and preserves tile order; batches count as coordinator slots, not tiles (6 tiles → 3 batches at cap 2, maxObserved 2).
- The container parser rejects an unrecognized magic and a truncated payload.
- Runtime: a tiled render with an active local issues zero `/local-mask-tile/` requests and at least one `/local-mask-tiles` request whose largest batch carries more than one tile.
- Static frontend contract: the tile loader must call the batch route, must not call the per-tile route, and must plan batches from locals × tiles.

Gate accounting:

- **Passed in focused automated coverage:** bounded batch transport; one compile per mask identity per batch; per-entry error semantics; malformed/stale/oversize rejection.
- **Passed in Chromium/Edge runtime coverage:** a tiled render with an active local uses only batched mask requests; the 42.4 MP brush-feather race retains the frame and does not fall back to CPU.
- **Not yet passed:** packaged-app rapid-local-edit request/compile limits; retained-canvas failure behavior; failure taxonomy; Denoise coalescing; source abort/generation propagation; a process-wide backend compile limit across clients.
- **Deferred evidence:** the Electron harness cannot launch in this environment; the 42.4 MP packaged baseline and the Phase 0 gates remain pending.

Before/after metrics:

- Mask HTTP requests for a tiled generation with one local: **one per tile per local → one per bounded batch**. Runtime test pattern: 10 tiles requested across two generations → **2 batch requests, 0 per-tile requests**, batch sizes 4 and 6.
- Mask compiles per batch: **independent of tile count**; reported by `X-Mask-Batch-Compiles` (1 for one identity, 2 for two).
- Response framing: **one length-prefixed container per batch** instead of one HTTP response per tile; the frontend parses it once and still caches per tile.
- No latency claim is recorded from these runs; they are transport-shape evidence, not timing evidence.

Remaining risks:

- Batch caps live in two places (frontend 64 tiles / 32 MiB, backend 64 entries / 128 MiB). A future tile-size or halo increase can silently split a generation into more requests; the batch headers are recorded but not yet surfaced in application diagnostics.
- Concurrent tiled generations can still race on the shared presentation canvas. During scenario development, forcing tiled and immediately calling `renderTiledTier` produced `validation: Scissor rect (x: 512, y: 512, width: 512, height: 208) is not contained in the render area dimensions {width: 1024, height: 576}` because one generation resized the canvas while another encoded against the previous size. This is a concrete repro for the Phase 1.4 retained-presentation gate; the new scenario now waits for settle so it measures transport only.
- Explicit background exact analysis still shares the two-slot background coordinator; idle/priority gating remains required.
- The backend still enforces no process-wide distinct-identity compile limit across clients.

Next safe edit:

1. Phase 1.4 — preserve the accepted canvas until a complete replacement is ready. Add the concurrent-generation repro above as a deterministic negative control: one generation must not resize or clear the presentation target another generation is encoding against.
2. Then Phase 1.5 failure taxonomy, Phase 1.6 Denoise input coalescing, and Phase 1.7 source abort/generation propagation.
3. Re-run the mask interaction scenarios through the Electron harness once it can launch in the target environment, and record packaged evidence under `codebase/output/performance/`.

### 15.4 Working-tree checkpoint — 2026-09-22 (presentation gate and retained accepted frame)

Checkpoint name: `phase-1-presentation-gate` (uncommitted working tree, continuing 15.3)

This checkpoint closes item 1 of the 15.3 next-safe-edit list (Phase 1.4) and turns the recorded concurrent-generation repro into a deterministic negative control.

Completed work:

- [x] **Phase 1.4 — presentation is a per-canvas critical section.** `frontend/presentation-gate.js` owns the gate. A generation may resize a canvas's drawing buffer and encode into it only while it holds that canvas's gate, staleness is re-checked after the wait, and a superseded generation returns before its resize callback runs. The gate is released at submission, not at the end of the render, so readbacks, cache trims and mask fetches never hold it.
- [x] **Both presentation paths take the gate.** The tiled encoder (`encodeTiledGeneration`) and the direct encoder in `renderTo` acquire it immediately before `getCurrentTexture()` and release it in a `finally` at `queue.submit`. The gate's two resize callbacks are the only places the presented canvas is resized, and a frontend contract test enforces that count.
- [x] **Resize deferred to presentation time.** `renderTiledTo` no longer resizes before the tile graph, masks and parameter buffers are ready, and `renderTo` no longer resizes before the intermediate graph and bind groups exist. Preparation failures (allocation, mask transport, staleness) now leave the accepted frame on screen instead of a cleared canvas.
- [x] **`renderTiledTo` registers a render serial**, so a newer tiled generation supersedes an older one at the renderer level exactly as `renderTo` already did, and the diagnostic `renderTiledTier` path participates in the same currency rules.
- [x] **Gate unit coverage and a runtime negative control** for the recorded repro.

Files changed:

- `codebase/frontend/presentation-gate.js` (new)
- `codebase/frontend/webgpu-preview.js`
- `codebase/frontend/index.html`
- `codebase/tests/presentation-gate.test.js` (new)
- `codebase/tests/performance/presentation-gate.js` (new)
- `codebase/tests/test_frontend_contract.py`
- `codebase/package.json`
- this PRD

Verification:

- `node --test`
  - Result: **121 passed**, 0 failed (was 116; +5 gate tests).
- `codebase/.venv/Scripts/python.exe -m pytest tests/test_render_cache.py tests/test_api.py tests/test_frontend_contract.py -q`
  - Result: **145 passed**, 1 upstream Starlette deprecation warning, 3.72 s.
- `codebase/.venv/Scripts/python.exe -m pytest tests/test_local_adjustments.py tests/test_source_tile_api.py tests/test_preview_resolution_contract.py tests/test_cpu_strips_api.py tests/test_api.py tests/test_render_cache.py tests/test_frontend_contract.py -q`
  - Result: **283 passed**, 17 warnings (16 upstream Pillow `mode` deprecations), 7.46 s.
- `node --check` on `webgpu-preview.js`, `presentation-gate.js`, and both scenarios: **passed**.
- Runtime, Chromium/Edge WebGPU against the dev server (`127.0.0.1:8799`, delivery-proof test pattern 1280×720, tiled execution forced), scenarios run one at a time:
  - `node tests/performance/presentation-gate.js --url http://127.0.0.1:8799`
    - Result: **passed**. Same-size pair (512 and 512 from a 512 canvas): first refused `superseded-before-presentation`, second rendered, canvas unchanged at 512×288, the one compositor sample was painted (peak 245), no blank frame. Different-size pair (1024 and 1280 from the same 512 canvas, the recorded repro): first refused by the gate, second rendered at 1280×720, **zero validation refusals**, final compositor peak 245. Evidence: `codebase/output/performance/presentation-gate.json`.
  - `node tests/performance/tiled-mask-batch-transport.js --url http://127.0.0.1:8799`
    - Result: **passed** again; 2 batch requests, 0 per-tile requests, batch sizes 4 and 6.
  - `node tests/mask-graph-interaction.js --url http://127.0.0.1:8799`
    - Result: **passed**.
  - `node tests/full-tier-brush-feather.js --url http://127.0.0.1:8799` (42.4 MP, Full, bloom halo, tiled, brush feather race)
    - Result: **passed**; Ready/Full, no Unavailable event, no CPU fallback.
  - `node tests/performance/tier-change-blank-canvas.js --url http://127.0.0.1:8799`
    - Result: **passed**; 4K→Full in 2190 ms on tiled execution, 12/12 compositor samples painted, 0 blank, 0 CPU fallbacks.
  - Note: running two WebGPU scenarios concurrently on this machine starved one of them (a batch-transport run timed out while another browser scenario held the GPU). Scenarios are evidence when run one at a time.

Focused negative controls added or updated:

- Unit: presentations to one canvas never overlap; a superseded generation is refused before its resize callback runs; staleness is rechecked after the wait rather than at the call; separate canvases do not block each other; release is idempotent and the gate is reusable.
- Runtime: no refusal may be a device validation error; the presented canvas must match the winning generation's proxy size; a superseded same-size generation must never blank the accepted frame; a superseded generation must not change the canvas size; the superseded call must be the stale one and the newest must present.
- Static: `presentation-gate.js` must load before `webgpu-preview.js`; `presentationGate.acquire(` must appear exactly twice; `if (canvas.width !== proxy.width) canvas.width = proxy.width;` must appear exactly twice, both inside the gate; the direct presentation section from the resize to `queue.submit` must contain no `await`.

Gate accounting:

- **Passed:** a superseded generation never resizes or clears the accepted frame; concurrent generations at different sizes no longer produce validation errors; the accepted frame survives a tier change and a 42.4 MP refinement race; the batch transport still behaves after the presentation change.
- **Not yet passed:** Phase 1.5 failure taxonomy; Phase 1.6 Denoise coalescing; Phase 1.7 source abort/generation propagation; packaged-app evidence (the Electron harness still fails to launch in this environment); the Phase 0 baselines.
- **Residual:** an encode that fails after the gate has resized (validation or allocation inside the encode) can still leave the canvas cleared; the Phase 2 viewport-sized offscreen target is what removes resize-clear entirely, and only the repeated-unrecoverable-validation path of Section 5.8 may disable the device. A generation that becomes stale mid-encode still completes and presents its own complete frame before the newer one replaces it; cancellation between tiles belongs with Phase 2's small-batch submission.

Before/after metrics:

- Concurrent same-size pair: **possible cleared frame → accepted frame never blank** (min sampled peak 245 across the overlap).
- Concurrent different-size pair: `validation: Scissor rect … is not contained in the render area dimensions …` → **zero validation refusals**, winner presents 1280×720.
- Resize timing: **before** tile-graph/mask/buffer preparation → **after** it, immediately before the composite pass.
- Presentation canvas resize sites in the renderer: **4 (two per path) → 2**, both inside the gate.
- No latency claim is recorded from these runs; the tier-change figure above is the scenario's own reported number, not a new baseline.

Next safe edit:

1. Phase 1.5 — replace generic sticky GPU disablement with the failure taxonomy in Section 5.8. Add a synthetic recoverable allocation or transport failure and prove WebGPU is not permanently disabled and the accepted frame survives.
2. Then Phase 1.6 Denoise input coalescing and Phase 1.7 source abort/generation propagation.
3. Re-run the mask and presentation scenarios through the Electron harness once it can launch in the target environment, and record packaged evidence under `codebase/output/performance/`.
