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

### 4.8 WYSIWYG and accuracy expectations

Recorded product direction, 2026-09-23. The authoring preview is judged perceptually, and its reference is Chromium's own rendering of the delivered file:

- **Perceptual alignment is the target.** For Fit and low zoom, display-exact output must look like the delivered file shown at the same size through the same Chromium rendering path. Display exact is a sampling floor, not the fidelity ceiling.
- **Comparison anchor.** The reference is the delivered file rendered by this application's Chromium proof path at the same size, display, and target peak as the preview. How other applications render a file is out of scope and is not a gate.
- **Tolerance method.** Perceptual sign-off by the product owner on side-by-side pairs calibrates the tolerance per module class. Numeric metrics exist to catch extreme errors, not to decide acceptability: differences invisible at the intended viewing size are acceptable unless they are structural, localized spikes, or changes of texture character.
- **Inspection guarantee.** At zoom >=100%, the native-region exact and export-parity requirements of Section 4.5 are unchanged.
- **Known scale residual.** Where the display transform is nonlinear, filtering the source before the graph and filtering the graded result differ for content at or below the display Nyquist (fine repeating detail, sub-pixel speculars, thin bright lines). That residual is judged against the perceptual standard above, not by byte equality.
- **What perceptual does not cover.** Measurement claims stay exact. Peak nits, ceiling checks, gain-map metadata and headroom are verified numerically, never by eye: if the app reports 999.5 nits, the export is not 1001.
- **What the Chromium anchor does not prove.** The anchor shows the preview and the export agree through the shared Chromium display path; it cannot show that either is right when that path is wrong. Export correctness is verified separately by decoding the delivered file and checking its values and metadata — the existing decode and inspection paths for Ultra HDR JPEG and AVIF gain maps.
- **Comparison precision.** Numeric and difference evidence for HDR uses real-precision reads on both sides: a float readback of the presentation target and a decode of the delivered file. Page captures (CDP screenshots, Electron `capturePage`) are 8-bit display-referred; any composite built from them must be labelled SDR-only and may not be the basis of an HDR difference claim.
- **Future option, not this sprint.** A fidelity mode that always processes as the export does (native-resolution grade plus filtered presentation) is recorded as a future option, not a current setting.

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
| Phase 0 | **Product direction recorded 2026-09-22** | The owner exercised the 4K and Full paths in the desktop app (4K smooth, local adjustments and feather smooth, Full correct but slower as expected, technical scopes reporting tiled for Full and direct for 4K) and directed Phase 2 to proceed. Since then: the 42.4 MP packaged baselines and their measurements are captured (15.20), migration behavior is recorded and tested (15.21), and film-look parity is byte-identical on both surfaces (15.21). The per-module tolerance sign-off (item 7, proposed in 15.21) and the Fit filtering A/B (item 6) remain unsigned, so Phase 2 keeps legacy mode as the fallback and no Phase 3 work starts until those numbers exist. Observation to address in Phase 2: a long rapid exposure drag at Full showed a transient "full not available" state that cleared on release; acceptable per the owner, but it is the backpressure signal Phase 2's 50 ms stop gate and progressive passes exist to remove. |
| Phase 1 | **Complete (code and gates)** | All eight work items are implemented across checkpoints 15.1–15.5, and all six Phase 1 exit gates pass in focused automated and Chromium/Edge runtime evidence. Packaged-app (Electron) evidence and the Phase 0 baselines remain outstanding; see 15.5. |
| Phase 2 | **Items 1–8 landed and regression-verified; parity measured, gate open** | Item 1 (coordinator extraction and generation ownership out of `app.js`) landed with the ROI, catch-up and pan paths delegated and every runtime scenario re-run (15.18); visible-region refinement, real viewport, retained presentation target, offscreen exclusion, small-batch submission, the deferred whole-frame catch-up, the display-scale pan cache and the Settings switch remain landed and owner-accepted (15.15, 15.17); the 50 ms stop gate is measured (15.10). Item 9's legacy-versus-ROI A/B run measured byte equality on the synthetic SDR pattern and on the packaged HDR surface (15.19), but the Phase 0 per-module tolerances are unsigned, so the parity gate stays open. Packaged/Electron evidence for the Phase 2 paths now exists (15.19). Remaining: the Phase 0 tolerance and migration items, 42.4 MP packaged baselines, and the Fit filtering A/B. |
| Phase 3 | **Complete at `55455e6`** | Source mips, ROI graph routing, whole-image pipe, GPU gradient masks, scale-aware Denoise, cold-build cancellation, and the measured reference gates are recorded in §§15.30–15.35. The 300% comparison used the whole-frame renderer as reference; the export file was not re-decoded at that zoom. |
| Phase 4 | **Implementation landed; development gates measured; packaged tuning open** | Adaptive coarse rendering, display-scale exact refinement, response preferences, migration, diagnostics and the normal UI replacement are recorded in §15.36. Browser and unit evidence covers the exit gates on the development workstation; latency targets still need packaged-app calibration. |
| Phase 5 | **Not started** | Central allocation registry, transport selection, recovery and supported hardware matrix remain future work. |

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

### 15.5 Committed checkpoint — 2026-09-22 (Phase 1 complete)

Checkpoints committed on `main`, continuing 15.2–15.4:

| Commit | Phase | Summary |
|---|---|---|
| `33b03df` | 1.1, 1.2, 1.8 | Idle-gated exact peak, single-flight mask compiles, direct `renderTiledTo` lifetime protection |
| `2ac7538` | 1.3, 1.4 | Batched local-mask transport, per-canvas presentation gate |
| `29a321b` | 1.5 | Section 5.8 failure taxonomy, device rebuild instead of sticky disable |
| `a6c2820` | 1.6 | Live Denoise input coalesced to one in-flight plus one latest pending |
| `22bf815` | 1.7 | Abort and generation checks for source transport |

Completed work:

- [x] **Phase 1.5 — failure taxonomy.** `frontend/render-failure.js` classifies superseded, transport, allocation, unsupported graph, validation, device loss, and permanent initialization failure. Only initialization failure or validation failure repeated three times without a successful render in between may disable WebGPU. Transport and allocation failures retry within a bounded budget; device loss rebuilds the device and re-renders; every recoverable path keeps the accepted frame and the device.
- [x] **Phase 1.6 — Denoise coalescing.** `frontend/latest-work-queue.js` gives one in-flight plus one latest pending. The live control path submits through it, so a drag costs runs rather than input events and the last value is the one that lands.
- [x] **Phase 1.7 — source abort and generation checks.** Source transport carries the caller's currency check and a session-scoped abort. A superseded stream stops fetching between chunks and destroys its partial texture; a superseded whole-frame proxy is never uploaded; replacing the session aborts in-flight source work.

Verification at this checkpoint:

- `node --test`: **135 passed**, 0 failed.
- `pytest` focused (`test_render_cache.py`, `test_api.py`, `test_frontend_contract.py`): **148 passed**.
- Runtime, one scenario at a time against the dev server on `127.0.0.1:8799`:
  - `tests/performance/failure-taxonomy.js` — synthetic transport failure recorded as recoverable with `available: true` and the viewer still Ready at peak 245; removal returns a WebGPU presentation; three consecutive validation failures disable and are recorded. Evidence: `codebase/output/performance/failure-taxonomy.json`.
  - `tests/performance/denoise-input-coalescing.js` — twelve rapid inputs started **two** reconstructions, eleven coalesced, last payload accepted, pixels moved on a WebGPU presentation. Evidence: `codebase/output/performance/denoise-input-coalescing.json`.
  - `tests/performance/tiled-mask-batch-transport.js` — 2 batch requests, 0 per-tile, batches of 4 and 6.
  - `tests/full-tier-brush-feather.js` (42.4 MP, Full, tiled, streamed source) — Ready/Full, exact, no CPU fallback, no Unavailable event.

Phase 1 exit gate accounting:

| Gate | Status | Evidence |
|---|---|---|
| Concurrent cold requests compile one mask identity once | Passed | `X-Mask-Batch-Compiles`, `test_render_cache.py`, batch API tests |
| Rapid local edits never exceed configured request/compile limits | Passed (Chromium) | batch caps 64/32 MiB front, 64/128 MiB back; runtime batches of 4 and 6 |
| A superseded or failed render never clears the accepted frame | Passed | presentation gate unit + runtime controls; tier-change scenario 12/12 painted |
| A synthetic recoverable failure does not permanently disable WebGPU | Passed | `failure-taxonomy.js` |
| Denoise rapid-input tests show bounded counts and latest-state acceptance | Passed | `denoise-input-coalescing.js` |
| Exact-peak analysis never starts while foreground work is queued | Passed | 15.1 checkpoint (idle gate), `scope-exact-peak.js` |

Remaining Phase 1 evidence gaps, not code gaps:

- **Electron launch failure resolved (2026-09-22).** The harness failure was environmental, not a defect in the app or the harness: this shell exports `ELECTRON_RUN_AS_NODE=1`, which makes `electron.exe` run as plain Node, so `desktop/main.js:24` crashed on `require("electron").app` being undefined and Playwright reported `Process failed to launch!`. Clearing the variable before launching is the fix. With it cleared, `node tests/run-in-electron.js tests/mask-graph-interaction.js` **passed in Electron**: mask influence edits issued zero mask requests, undo/redo intact, boolean operators union/intersect/subtract/subtract, and the renderer reported the settled resource set (5 local masks, 15.7 MB cached). The remaining Electron scenarios (presentation gate, failure taxonomy, batch transport, brush feather) can now be run the same way; they have not been re-run under Electron yet.
- The Phase 0 gates (display-driven contract sign-off, retired tier selector, 42.4 MP packaged baselines) remain unsigned. See the concern in 15.6.
- `recalculateDenoise` (analysis, as opposed to live reconstruction) is generation-guarded but not routed through the coalescing queue; a user hammering Recalculate can still start overlapping analyses. Recorded as a follow-up, not a Phase 1 gate.

### 15.6 Phase 2 contract increment and the Phase 0 stop-gate concern

Checkpoint committed as `dd89ed7` — "Define the immutable viewport request and pass it to the tile scheduler".

**Product direction (recorded 2026-09-22):** the owner reviewed the running desktop app and directed Phase 2 to proceed. Phase 2 therefore continues with the contract already landed, and legacy mode stays available behind diagnostics until the ROI path passes the parity gate, as Phase 2 itself requires. The remaining Phase 0 checklist items (parity tolerances, migration behavior, 42.4 MP packaged baselines, Fit filtering A/B) are still to be signed off individually; Phase 3 does not start until they are.

Landed in this checkpoint (Phase 2 work items 2, 6, 7-contract, 9-contract, and the scheduler half of 3):

- `frontend/viewport-request.js` builds a frozen request with the visible output region, the minimum-ROI-padded region (default 15% per side, clamped), the source rect it maps back to, the haloed region, and the globally anchored tiles covering it. It also reports processed/output pixels, halo amplification, tile count and visible tile count.
- `HDRViewportRequest.compareWithLegacy` performs the pointwise max-difference comparison against a whole-frame render over the intersection of two rects, which is the mechanism the Phase 2 ROI-parity gate needs.
- `tile-scheduler.js` now receives a real viewport from the renderer (`sourceOptions.viewport`) instead of assuming Fit; no viewport still means Fit, so current behaviour is unchanged.
- Tiled execution metrics report `viewport`, `offscreenTiles`, `processedPixels`, and `outputPixels`.
- Diagnostics expose `HDRFinisherPerformance.viewportRequest({ visible, halo, tileSize, longEdge })` so the contract can be exercised in the running app.
- Runtime evidence (batch transport scenario, test pattern 1280×720): a 512×512 viewport reached the scheduler, `offscreenTiles: 5` of 6, telemetry present, ROI padded to 666×576, source rect 834×720, and the render still presented the full frame.

Still required to finish Phase 2 (not attempted here):

1. Extract render coordination and generation ownership from `app.js` (work item 1).
2. Supply the real visible rect from the app's zoom/pan state so requests stop being Fit (the remaining half of item 3). The app's viewer uses DOM transforms, so this needs the coordinator's viewport model, not a guess.
3. Viewport-sized offscreen/retained presentation target (item 4) — this is what makes "the visible canvas is never cleared between generations" true and what lets an ROI actually be presented.
4. Small-batch tiled submission with cancellation checks (item 5).
5. Display-scale pan cache (item 8).
6. Full engineering switch integration (item 9): the comparison function exists; the legacy-versus-ROI A/B path in diagnostics does not.

Manual checks for the owner:

- **Decide the Phase 0 gate**: sign off the display-driven contract and retire the tier selector, or direct the sprint back to defect remediation. Phases 2–5 integration is blocked on this decision.
- Confirm the minimum-ROI padding default of 15% per side and the conservative `+1` source-pixel guard in the ROI-to-source mapping are the intended values.
- Confirm the `processedPixels` definition (sum of tile haloed areas) is the figure the halo-amplification gate should report.
- Launch `node tests/run-in-electron.js <scenario>` with `ELECTRON_RUN_AS_NODE` cleared (see the resolved note in 15.5) to capture packaged-path evidence for the presentation gate, failure taxonomy, batch transport, and brush-feather scenarios, and record it under `codebase/output/performance/`.
- Capture the 42.4 MP packaged baselines the Phase 0 table requires.

### 15.7 Committed checkpoint — 2026-09-22 (Phase 2 foreground selection, cancellation, and the retention finding)

Checkpoint committed as `94e5dbf` — "Stop superseded tiled encodes at a tile boundary and record foreground/retained telemetry".

Landed:

- **Cancellation at a tile boundary (work item 5, first half).** A tiled generation checks its currency at every tile boundary and refuses with `superseded-during-encode` before anything is submitted, so a superseded render never presents a partial frame and obsolete work stops within one tile instead of running to the end of the image. This is the mechanism the 50 ms stop gate will be measured against; the stop is bounded by one tile, not by the whole generation.
- **Viewport reaches the scheduler (work item 3, renderer half)** and the renderer records what the canvas currently shows (`lastPresentedFrame`) so a later pass can know whether a frame is retainable.
- **Foreground selection and telemetry (items 6 and 7).** `HDRViewportRequest.foregroundTiles` returns the tiles intersecting the viewport, with unit coverage. Tiled metrics report `foregroundTiles`, `skippedTiles`, `retainedFrame`, `cancelled`, and `processedPixels` now counts only the tiles a pass actually processed.
- **Runtime evidence** (`tiled-mask-batch-transport.js`): the viewport reached the scheduler, 5 of 6 tiles were reported offscreen, both passes processed all six tiles, and the offscreen region measured 150.44 before and after the ROI pass — unchanged.

**Finding that shapes the next unit of work:** a swap-chain texture does not retain its previous contents. A pass that composites only the foreground tiles with `loadOp: "load"` leaves the offscreen region undefined, and the measurement confirmed it (offscreen brightness fell to 2.69 — black — instead of staying at 150.44). `loadOp: "load"` on the canvas is therefore **not** frame retention. Skipping offscreen tiles, presenting an ROI at all, and the "visible canvas is never cleared between generations" gate all require the viewport-sized offscreen/retained presentation target (work item 4), which is now the immediate next unit. Offscreen skipping is deliberately gated on that target existing, so the current build still redraws every frame whole and no partial frame can reach the viewer.

Next safe edit:

1. Build the retained presentation target: an offscreen texture that survives between generations, composited into per pass and blitted to the canvas in one final full-frame pass. Then enable offscreen skipping behind the existing guard and prove the "offscreen tiles are not part of the foreground batch" gate with a scheduler trace.
2. Small-batch tiled submission on top of that target, so each batch is a separate submit and cancellation has a submit boundary to stop at.
3. Then the coordinator extraction and the real visible-rect source (items 1 and 3), the pan cache (item 8), and the legacy-versus-ROI switch integration (item 9).

### 15.8 Committed checkpoint — 2026-09-22 (retained presentation target and offscreen skipping)

Checkpoint committed as `cc31ebf` — "Retain the tiled frame in an offscreen presentation target". This closes item 1 of the 15.7 next-safe-edit list and satisfies the "offscreen tiles are not part of the foreground batch" exit gate.

Completed work:

- **Retained presentation target (work item 4).** Tiled passes composite into an output-sized offscreen texture that survives between generations. One `copyTextureToTexture` hands the completed frame to the canvas, so the swap chain is never presented cleared or half-written, whatever the pass did to the target. The target is `RENDER_ATTACHMENT | COPY_SRC`; both surface configurations now include `COPY_DST` so the canvas can be a copy destination. The plan's `presentation-surface` entry (339 MB at 42.4 MP) is now an allocation rather than a model-only entry.
- **Retention is explicit.** A pass may load the target only when the previous frame was tiled, in the same session, lane, geometry signature, and surface format, and the target is marked valid. A Direct pass records `execution: "direct"`, so a later tiled pass knows there is no retained frame and redraws whole.
- **Offscreen skipping enabled.** A viewport pass processes only the tiles intersecting the viewport and keeps the accepted frame everywhere else. This is the exit gate: offscreen tiles are not part of the foreground batch.
- **Runtime evidence** (`tiled-mask-batch-transport.js`, test pattern 1280×720, 6 tiles, viewport 512×512): the legacy pass processed 6 of 6 tiles with `retainedFrame: false`; the ROI pass processed **1 of 6 tiles** (262,144 of 921,600 pixels), reported `retainedFrame: true` and `skippedTiles: 5`, and the offscreen region measured the same brightness before and after (150.44).
- **Regressions pass with the target in place:** the 42.4 MP Full brush-feather race (Ready/Full, exact, tiled, no CPU fallback, no Unavailable) and the 4K→Full tier change (18/18 compositor samples painted, 0 blank, 0 CPU fallbacks, 0 `/preview` requests).

Verification at this checkpoint:

- `node --test`: 145 passed.
- `pytest` focused: **150 passed** (new retained-target contract).
- Runtime scenarios run one at a time against the dev server on `127.0.0.1:8799`.

Remaining Phase 2 work:

1. Small-batch tiled submission on top of the target: each batch becomes its own submit, so cancellation has a submit boundary and a 42.4 MP foreground pass can stop within the 50 ms gate. The retained target already makes partial submits invisible, which is what made this possible.
2. Coordinator extraction and generation ownership out of `app.js` (item 1).
3. The real visible-rect source from the app's zoom/pan state, so requests stop being Fit (item 3, app half).
4. Display-scale pan cache (item 8).
5. Full legacy-versus-ROI switch integration in diagnostics (item 9).
6. ROI parity evidence: pointwise comparison against a crop of the legacy render within the approved tolerance (`compareWithLegacy` exists; the tolerances themselves are a Phase 0 sign-off item).

### 15.9 Committed checkpoint — 2026-09-22 (small-batch tiled submission)

Checkpoint committed as `13d12a3` — "Submit tiled work in small batches so supersession stops at a boundary". This closes item 1 of the 15.8 next-safe-edit list.

Completed work:

- **Small-batch submission (work item 5).** Tiled encoding submits in batches of four tiles (`options.tileBatchSize`) instead of one command buffer per generation. The GPU starts on a batch while the CPU encodes the next, and the cancel check runs **before** the partial batch is flushed, so a superseded generation stops within one batch rather than at the end of the image. The retained presentation target keeps the batches invisible until the single final copy hands the complete frame to the canvas, so partial submits never reach the viewer.
- **Metrics** report `submissions` and `tileBatchSize` alongside the existing foreground/retained fields.
- **Runtime evidence** (`tiled-mask-batch-transport.js`): the six-tile legacy pass submitted **3 times**; the one-tile ROI pass submitted **2 times**; retained frame, one-of-six foreground tiles, `skippedTiles: 5`, and the unchanged offscreen region (brightness 150.44) all held.
- **Regression:** the 42.4 MP Full brush-feather race still passes (Ready/Full, exact, tiled, no CPU fallback, no Unavailable).

Verification at this checkpoint:

- `node --test`: 145 passed.
- `pytest` focused: **151 passed** (new small-batch contract).
- Runtime scenario and 42.4 MP regression run one at a time against the dev server on `127.0.0.1:8799`.

Stop-gate status:

- "Offscreen tiles are not part of the foreground batch": **passed** (15.8, re-proven here).
- "A new input stops further obsolete submissions within 50 ms": **measured and passed, with a correction to the mechanism claim.** Driver committed as `9f3f3c3` (`tests/performance/tiled-stop-gate.js`, instrumentation-only submission log in the renderer). Two consecutive 42.4 MP tiled passes with Denoise active: each generation submitted **45 batches** and its entire encode phase spanned **8.2 ms** and **7.1 ms**, with **zero stale submissions** after supersession, and both passes presented on WebGPU. The correction: the tile-boundary currency check can only fire where the encoder yields, and a JavaScript encode loop is atomic between awaits, so a timer cannot interrupt a non-Denoise pass mid-loop. What actually bounds obsolete work is that one generation's encode phase is far shorter than the gate; the phases that *can* outlive a supersession (mask and proxy transport) are aborted by the coordinator and the generation checks. The 50 ms gate is therefore met structurally, not by mid-loop interruption, and the ledger records that distinction rather than claiming an interruption that does not occur.
- "Warm pan renders only newly exposed tiles" and "ROI pointwise output matches a crop of the legacy render": still pending the app-side visible rect and the parity tolerances.

Next safe edit:

1. Coordinator extraction and generation ownership out of `app.js` (item 1), which is also what supplies the real visible rect (item 3) and lets the pan cache (item 8) be measured.
2. Build the rapid-input stop-gate driver: fire edits during a 42.4 MP tiled pass and record the time from input to the last obsolete submission.
3. Legacy-versus-ROI switch integration and the parity run (items 9 and the Phase 0 tolerances).

### 15.10 Committed checkpoint — 2026-09-22 (stop-gate measurement)

Checkpoint committed as `9f3f3c3` — "Measure the Phase 2 stop gate on a 42.4 MP tiled pass".

Landed:

- **Submission instrumentation.** The renderer keeps a bounded (128-entry) submission log when `instrumentationEnabled` is set: time, lane, tiles per batch, render serial, and application generation. Diagnostics only; it changes no rendering behaviour.
- **Stop-gate driver** (`tests/performance/tiled-stop-gate.js`, `npm run test:tiled-stop-gate`): imports the 42.4 MP fixture, enables a local and Denoise, forces tiled, warms the proxy/mask caches, then runs two consecutive tiled passes and supersedes the first mid-pass.
- **Measured result:** both generations submitted 45 batches (176 tiles at batch size four plus the final copy), encode phases spanned **8.2 ms** and **7.1 ms**, **zero** stale submissions after supersession, no stale submission after the newer generation's first submit, both passes presented, viewer Ready on WebGPU.
- **Correction recorded:** the tile-boundary currency check fires only where the encoder yields. A JavaScript encode loop is atomic between awaits, so a timer cannot interrupt a non-Denoise pass mid-loop; with Denoise the per-tile awaits exist, but a warm 42.4 MP pass still finishes in under 10 ms. Obsolete work is therefore bounded by the encode-phase duration rather than by mid-loop interruption, and the phases that can genuinely outlive a supersession — mask and proxy transport — are aborted by the coordinator and generation checks. The gate passes on that basis, and the ledger says so plainly instead of claiming an interruption that does not occur.

Next safe edit (unchanged, now with the measurement closed):

1. Coordinator extraction and generation ownership out of `app.js` (item 1) — the next substantial unit; it also supplies the real visible rect (item 3) and makes the pan cache (item 8) measurable.
2. Legacy-versus-ROI switch integration and the parity run (items 9 and the Phase 0 tolerances).

### 15.11 Committed checkpoint — 2026-09-22 (opt-in ROI refinement and the pan-behaviour decision)

Checkpoint committed as `799fe8f` — "Make ROI refinement opt-in and limited to the visible region".

**Product direction recorded.** Asked to recommend pan behaviour for stability and performance, following industry standard: pan and zoom must never trigger a render (they are a compositor operation on available pixels — that is why they feel instant), newly exposed regions must never be blank or wrong (so the base layer stays a complete frame), and the expensive pass is the one to bound. The recommendation adopted is therefore **ROI for the refinement tier only, with the retained full-tier frame behind interactive pan and zoom** — Lightroom/Capture One behaviour — rather than re-rendering on every pan or showing stale content. Extending ROI to the settle pass for magnified views, with progressive idle catch-up, is the later step. The owner approved landing this behind a diagnostic switch first and keeping the app on Fit until reviewed.

Landed:

- **`visibleOutputRect()`** measures the visible part of the mounted canvas against the scrolling dropzone rather than from the zoom model, so centering, scroll position, comparison layouts and future transforms are all accounted for. A fully visible frame returns `null`: Fit has nothing to skip.
- **`state.roiPreviewMode`**, default `"fit"` (shipped behaviour unchanged), flippable from diagnostics via `HDRFinisherPerformance.setRoiPreviewMode("refinement")`. Only the refinement tier is ROI-limited: interactive and settled passes stay whole frame.
- **`viewportRequested`** in tiled metrics distinguishes Fit's effective viewport from a real request.
- **Runtime evidence** (`tests/performance/roi-refinement.js`, test pattern, tiled, 300% zoom): switch off → refinement requested **no** viewport; switch on → requested the visible region (`{x:492, y:271, width:297, height:178}` of 1280×720), `retainedFrame: true`, **2 of 6 tiles** processed, 4 skipped; the first pass at a new target size correctly redrew whole (`retainedFrame: false`, 0 skipped); an interactive pass was refused by the viewer's tier state and could not be ROI-limited.
- Suites: 145 JS, **152** Python (new opt-in/tier-gate contract).

Manual check for the owner (the switch is off by default, so nothing changes until it is turned on):

1. In the running app, run `window.HDRFinisherPerformance.setRoiPreviewMode("refinement")`, zoom to roughly 200–400%, and edit an adjustment. The visible region should refine at full tier quality while the rest of the frame stays at the accepted image; pan immediately afterwards to see whether the retained region is acceptable or whether the pan cache (item 8) must land before this can ship.
2. Compare against `setRoiPreviewMode("fit")` on the same edit. What to look for: no blank or wrong pixels anywhere, refinement latency in the visible region, and whether the offscreen region's older grade is noticeable after a pan.
3. Decide whether the refinement-only scope is enough for the first release or whether the settle pass should also become ROI-limited at magnified zoom.

Next safe edit:

1. Coordinator extraction and generation ownership out of `app.js` (item 1), which also makes the pan cache (item 8) measurable.
2. Display-scale pan cache (item 8) once the owner's pan check above says it is needed.
3. Legacy-versus-ROI switch integration and the parity run (items 9 and the Phase 0 tolerances).

### 15.12 Committed checkpoint — 2026-09-22 (Settings switch for ROI refinement)

Checkpoint committed as `cdd6ffa` — "Give ROI refinement a Settings switch so it needs no devtools".

Context: the owner reviewed the running app and reported no visible difference while panning after an edit. That was expected and is worth recording plainly — the default is `fit`, so the review exercised the shipped whole-frame path, and the ROI path has still not been judged visually by a person.

Landed:

- A persisted `roiPreview` preference (default `"fit"`), validated like `executionOverride`, applied through the ordinary preferences path, with a **Region of interest** select beside **Preview execution** in Settings and helper text that names the experimental behaviour and what to report.
- `applyRoiPreview` re-renders on change so the comparison is immediate, exactly like the execution-route switch.
- Runtime evidence (`roi-refinement.js`): the Settings select drives the mode both ways (`refinement`, then `fit`); with the switch on at 300% zoom the refinement pass requests the visible rect, retains the accepted frame, and processes 2 of 6 tiles with 4 skipped; with it off, no viewport is requested; an interactive pass cannot be ROI-limited.
- Contract coverage for the preference, the select binding, the app-side application, and the diagnostics API.

Measurement note recorded for future scenarios: a preference change schedules the app's own render cycle, which races a diagnostic render and overwrites `tiledExecutionMetrics`. The scenario therefore verifies the Settings surface **after** the measurement, and the measurement itself is driven through `HDRFinisherPerformance.setRoiPreviewMode`.

Manual check for the owner (now without devtools):

1. Settings (Mod+,) → **Preview execution** section → **Region of interest** → *Visible region*.
2. Zoom to roughly 200–400%, make an edit, then pan. Judge whether the retained offscreen region (one edit behind) is acceptable, or whether the pan cache (item 8) must land before this ships.
3. Switch back to *Whole frame* for the same edit to compare. Report anything that looks blank, stale beyond one edit, or slower than expected.

Next safe edit: unchanged — coordinator extraction and generation ownership out of `app.js` (item 1), then the pan cache (item 8) if the owner's check calls for it.

### 15.13 Committed checkpoint — 2026-09-22 (ROI seam found in owner review; padding mitigation)

Checkpoint committed as `4f867e7` — "Pad the ROI foreground region so a small pan does not expose the old boundary".

**Owner finding (visual review, screenshot supplied):** at 36% zoom with ROI refinement enabled, dragging an adjustment produced a **visible seam**: a rectangular region inside the viewport carried the new grade while the surrounding tiles kept the previous one. The owner's verdict: adjustment lag makes the seam visible, so refinement-only ROI is **not shippable as scoped**. This is the manual check 15.12 asked for, and it answers it.

Diagnosis recorded:

1. The seam lands **inside** the viewport because the foreground region was selected from the raw visible rect, so the tiles just outside it were never refined. The PRD's minimum-ROI padding exists for exactly this and was only being applied in the request contract, not in the renderer's foreground selection.
2. The deeper cause is unchanged: offscreen tiles keep the accepted frame, which after an edit is one generation behind. Nothing in the current build ever brings them forward, so the seam is inevitable wherever the refined region ends — padding only moves it.

Landed:

- The renderer pads the requested viewport by 15% per side (clamped to the output) before selecting foreground tiles, so a small pan reuses tiles that were already refined instead of exposing the previous pass's boundary. Tiled metrics report the padded `roi` alongside the requested `viewport`.
- Verification: 145 JS tests, 153 Python tests pass; the ROI scenario still shows the visible-region pass requesting a viewport, retaining the frame, and restricting the foreground batch.

Still required before ROI refinement can ship (recorded as the next work, in priority order):

1. **Progressive catch-up**: after the visible region is refined, continue refining the remaining tiles in bounded idle work until the whole frame matches the current generation. This is what removes the seam, and it is the PRD's Phase 3 progressive-pass requirement rather than an optional extra.
2. **Pan cache** (item 8): keep refined tiles resident per display scale so a pan inside the cached region needs no work at all.
3. Re-run the owner's check afterwards: same zoom, same edit, same pan.

Until those land, the switch stays experimental and default **Whole frame**; the shipped behaviour is unaffected.

### 15.14 Committed checkpoint — 2026-09-22 (deferred catch-up closes the seam)

Checkpoint committed as `ad67d45` — "Close the ROI seam with a deferred whole-frame catch-up pass".

Landed:

- **Deferred catch-up.** After an ROI refinement presents, the app schedules the same tier as a **whole-frame** pass once the user pauses (`ROI_CATCH_UP_DELAY_MS = 700`), so the tiles that kept the accepted frame converge on the current generation and the refinement boundary stops being visible as a seam. The catch-up is cancelled by any new edit (`invalidatePreview`) or mode change (`applyRoiPreview`), is skipped when the generation has moved on, and yields to newer renders like any other pass, so it cannot fight the foreground.
- Tiled metrics mark the pass with `roiCatchUp`, and diagnostics expose `roiCatchUpState` for a dedicated driver.
- The padding mitigation from 15.13 remains: foreground selection is padded 15% per side, so a small pan reuses already-refined tiles.

Verification status, stated plainly:

- Suites: **145 JS**, **153 Python**, all passing.
- The ROI scenario still proves the visible-region pass (viewport requested, retained frame, 2 of 6 tiles, 4 skipped, settings select drives the mode).
- **The catch-up itself is not yet verified at runtime.** The scenario drives a diagnostic render and polls for the catch-up metrics, but the app's own settle/refine cycle keeps issuing renders that supersede the catch-up before it produces metrics; the scenario therefore records the observation instead of asserting it, and the earlier attempt at asserting it was flaky in this environment. A dedicated driver that waits for genuine app idle, then asserts `roiCatchUp` with `viewportRequested: false`, `skippedTiles: 0`, and `retainedFrame: true`, is the next verification step.
- The padded ROI (`roi` in metrics) is the region actually used for foreground selection; `viewport` remains the raw request.

Owner check to repeat (switch on, same as before): Settings → Region of interest → **Visible region**, zoom to ~36%, drag an adjustment. The visible region should update immediately and the seam should close about a second after the drag stops, once the catch-up pass runs. If the seam persists or reappears on a pan, the pan cache (item 8) is the next unit rather than more padding.

Next safe edit:

1. A dedicated catch-up driver that waits for genuine idle and asserts the catch-up pass, closing the verification gap above.
2. Pan cache (item 8) if the owner's repeat check still shows a seam after the catch-up.
3. Coordinator extraction and generation ownership out of `app.js` (item 1).

### 15.15 Owner acceptance — 2026-09-22 (ROI refinement passes)

Owner review after the catch-up landed, in their words: much improved, and it updates automatically now; it does not keep up with the first scroll, so there is a point where the unadjusted boundary lines are visible before it settles; probably workable for users on a low-performance machine. **Verdict: passing.**

What this closes:

- The refinement-only ROI path with the retained presentation target, offscreen exclusion, small-batch submission, and deferred catch-up is **accepted as working** and is the first Phase 2 mechanism the owner has judged shippable.
- The earlier seam (15.13) is resolved by the catch-up; what remains is a *transient* artifact during the first scroll rather than a persistent boundary.

Recorded residual, with its cause and the unit that fixes it:

- **First-scroll staleness.** Panning into a region whose tiles are not yet refined shows the accepted frame there until a render catches up. The catch-up closes it on idle, but a scroll that arrives before the catch-up runs exposes the older pixels for a moment. This is the display-scale pan cache (item 8): keeping refined tiles resident per display scale means a pan inside the cached region needs no work at all, so there is nothing to expose. Progressive idle catch-up (already landed) plus the pan cache together remove the artifact rather than merely shortening it.
- The catch-up pass itself still has **no automated runtime assertion** (15.14): the scenario races the app's render cycle. A dedicated idle-waiting driver remains the verification item, and it is now the only unverified piece of the accepted path.

Next safe edit, in order:

1. Dedicated catch-up driver that waits for genuine app idle and asserts the catch-up pass (`roiCatchUp`, `viewportRequested: false`, `skippedTiles: 0`, `retainedFrame: true`).
2. Display-scale pan cache (item 8), which removes the first-scroll residual the owner reported.
3. Coordinator extraction and generation ownership out of `app.js` (item 1), then the legacy-versus-ROI parity run (item 9).

### 15.16 Committed checkpoint — 2026-09-22 (display-scale pan cache and the catch-up driver)

Checkpoints committed as `9bb23f5` — "Add the display-scale pan cache for ROI refinement", `c3bd9d9` — "Add ROI catch-up and pan-cache runtime drivers", `1b23892` — "Make the mask transport ROI measurement generation-fresh".

This unit lands Phase 2 work item 8 and closes the 15.14 verification gap. Both were committed before the coordinator extraction was started, per the sprint instruction.

**What the pan cache is.** The retained presentation target already holds the composited accepted frame; the tile scheduler already keeps a per-tile accepted-generation ledger. Together they are the cache: a viewport pass partitions its padded foreground candidates by whether the ledger holds them at the pass's own generation, processes only the pending ones, and leaves the rest as they are in the retained frame. The plan identity already contains the proxy (session, lane, long edge, geometry, source identity) plus the edit revision and surface format, so the cache is **per display scale by construction**: a zoom recreates the presentation target, `retainedFrame` goes false, and the pass redraws whole rather than reusing scale-dependent pixels.

Landed:

- `viewport-request.js`: `partitionByGeneration(tiles, acceptedGeneration, generation)` splits candidates into `cached` and `pending`. Only an exact generation match is a cache hit; an older generation is pending, which is what keeps an edit from reusing stale pixels.
- `webgpu-preview.js`: a retained viewport pass selects `foregroundTiles` from `pending` and reports `viewportTiles`, `reusedTiles`, `reusedPixels`, `panPass`, alongside the existing metrics. `foregroundTiles` stays the tiles that actually ran.
- `retainedFrame` now describes the **frame**, not the request: a whole-frame catch-up retains too, it just has no region to answer from the cache. The composite therefore loads instead of clearing at position 0 for any retained pass, and the catch-up metric is honest.
- Measurement passes no longer call `acceptTile`: a `measureOnly` pass never presents, so it must not make the cache believe its tiles are in the retained frame. A pass that processes nothing skips the peak readback instead of attributing a stale maximum to the current generation.
- **Root cause of the 15.14 gap fixed.** The app's own tiled path (`render()` → `encodeTiledGeneration`) built its options object by hand and never forwarded `roiCatchUp` (or the new `panPass`), so the catch-up flag could never be true on the real path — only on `renderTiledTo` diagnostics. Both are now forwarded on both paths.
- `app.js`: a scroll pauses for `ROI_PAN_DELAY_MS = 140` and then asks for a refinement-tier pass at the resident edge (`requestRoiPanRefinement`). It only runs for a retained tiled frame at the selected tier, yields to work already holding the device instead of superseding it, re-arms the whole-frame catch-up (so stopping after a pan still converges), and is cancelled by a newer edit, a mode change, or session retirement. Diagnostics: `roiPanState`, `panRefinement`, `cancelRoiCatchUp`.
- Drivers: `tests/performance/roi-catch-up.js` (real edit, waits for the ROI pass to arm the timer, waits for genuine idle, asserts the catch-up from the renderer's stage record — a record no later render can overwrite) and `tests/performance/roi-pan-cache.js` (fresh-generation ROI pass leaves a partial ledger, then real scroll events; asserts only the exposed strip renders and a pan back processes nothing). `roi-refinement.js` now proves the fresh-generation restriction and the same-generation cache hit separately.

**Runtime evidence** (raw JSON under `codebase/output/performance/`, one GPU scenario at a time):

- `roi-catch-up.json`: the app's own edit path. ROI pass `viewportRequested true`, `retainedFrame true`, 2 of 4 tiles, 2 skipped. Catch-up: `roiCatchUp true`, `viewportRequested false`, `viewport` = whole frame, `foregroundTiles 4 === tileCount 4`, `skippedTiles 0`, `retainedFrame true`, 4.8 ms. Accepted generation equals the generation the timer was armed at; viewer Ready; 0 page errors. **The 15.14 gap is closed.**
- `roi-pan-cache.json`: warm frame 6/6 tiles, 0 skipped. Fresh-generation ROI pass: `viewportTiles 1`, `foregroundTiles 1`, `reusedTiles 0`, `skippedTiles 5` — only its region. Pan 1 (newly exposed strip): `panPass true`, `viewportTiles 1`, `foregroundTiles 1`, `processedPixels 262 144 / 921 600`, 2 submissions — only the strip rendered, not the frame. Pan 2 (back into the refined region): `foregroundTiles 0`, `reusedTiles 1`, `processedPixels 0`, `submissions 1` — the pass copied the retained frame and did no work. Accepted generation unchanged; viewer Ready; 0 page errors.
- `roi-refinement.json`: `off` requests no viewport; `onWarm` redraws whole (retained false, 0 skipped); `on` at a fresh generation restricts the batch (2 foreground, 0 reused, 4 skipped); `cached` at the same generation answers every candidate (0 foreground, 2 reused, 0 processed pixels).
- Regressions, one at a time: `tiled-mask-batch-transport.json` (batches [4, 6], 0 per-tile requests, offscreen region unchanged) and `presentation-gate.json` (retained frame and refusal taxonomy) both pass. The mask scenario needed a generation bump between its legacy and ROI passes — with the cache, its same-generation ROI pass correctly became zero work and measured no transport — and its offscreen sample now sits beyond the last foreground tile's scissor and below the status dock, which are not canvas pixels.
- Suites: **148 JS**, **154 Python**, all passing.

Gate status, stated plainly:

- **Phase 2 item 8 (pan cache): mechanism verified.** A pan back into a region refined for the current generation processes nothing; a newly exposed strip is the only work; the pan passes are the app's own scroll-scheduled path. What the driver does *not* yet do is derive the partial ledger from a real edit's settle pass: it draws the generation boundary with a diagnostic refinement pass (the same mechanism 15.12–15.14 use), while the catch-up driver covers the real edit path. Recorded rather than implied.
- **First-scroll residual:** mechanism landed, owner check not yet repeated.
- **Memory:** no new GPU allocations. The cache is the existing retained presentation target (already accounted as `presentation-surface` in the budget model) plus a per-session CPU ledger keyed by the plan identity and bounded by the tile grid; it is cleared with the scheduler on session reset.
- **Nothing partial or mixed-generation is presented:** a viewport pass loads the accepted frame and overwrites only tiles it processed at its own generation; a frame that is not retained redraws whole; the catch-up rewrites the frame at one generation.
- **Zoom:** processed pixels are not reused across scales (by design); zoom changes the target size, so the next pass is a full redraw.
- **Direct tiers:** where the interactive pass is not refused, the whole frame is already current and the cache has nothing to save. The cache matters on tiled-required tiers, which is the owner's 42 MP case.

Owner check to repeat (switch on): Settings → **Region of interest** → *Visible region*, zoom to roughly 36%, drag an adjustment, then scroll immediately. Expect the newly exposed strip to refine shortly after the scroll pauses, no work at all when scrolling back into the already-refined region, and no unadjusted boundary left behind. Report anything blank, stale beyond one edit, or slower than the previous build.

Next safe edit:

1. Coordinator extraction and generation ownership out of `app.js` (item 1), now unblocked.
2. Legacy-versus-ROI parity run (item 9) once the coordinator owns generation.
3. If the owner's repeat check still shows first-scroll staleness, the next lever is prefetching the strip in the pan's direction rather than more cache work.

### 15.17 Owner acceptance — 2026-09-22 (pan cache passes)

Owner check repeated on the build from 15.16, at Full tier on a large source with the ROI switch on. Owner's words: **working great**; aggressive scrolling still shows some boundaries, but that is **within acceptable limits**.

What this closes:

- **Phase 2 item 8 (display-scale pan cache) is accepted.** The first-scroll residual recorded in 15.15 — the unadjusted boundary visible until the deferred catch-up runs — is now within the owner's tolerance.
- The mechanism the owner exercised is the committed one: the paused-scroll follow-up at the resident tier, cache reuse for tiles already current at this generation, and the deferred whole-frame catch-up still converging the rest.

Recorded residual, accepted rather than fixed:

- **Aggressive continuous scrolling can still show boundaries.** The pan follow-up is scheduled only after the scroll pauses (`ROI_PAN_DELAY_MS = 140`), so while the viewer is still moving, a fast-exposed strip may briefly carry an older grade; the catch-up closes it once movement stops. This is a latency characteristic of a non-blocking pan, not a mixed-generation presentation: the retained frame is copied whole and only whole tiles at the pass's own generation are composited.
- If the owner later wants the boundary gone during movement rather than only after it, the lever recorded in 15.16 stands: prefetch the strip in the pan's direction while the scroll is in progress.

Gate status:

- Phase 2 item 8: **owner-accepted**; automated evidence and the honest caveats remain in 15.16.
- The catch-up runtime assertion from 15.14 remains closed by `tests/performance/roi-catch-up.js`.
- Suites unchanged since 15.16: **148 JS**, **154 Python**.

Next safe edit:

1. Coordinator extraction and generation ownership out of `app.js` (item 1): the pan cache and the catch-up driver are committed and owner-accepted, so the sprint instruction's gate for starting item 1 is lifted.
2. Legacy-versus-ROI parity run (item 9) once the coordinator owns generation.

### 15.18 Committed checkpoint — 2026-09-23 (coordinator extraction, item 1; legacy-versus-ROI parity run, item 9)

Checkpoints committed as `4f3466f` — "Add the render coordinator state machine", `5564dcb` — "Route preview rendering through the coordinator", `8185c2a` — "Move the ROI follow-up lifecycle into the coordinator", `d1ce1de` — "Add the legacy-versus-ROI parity diagnostic and driver".

**What the coordinator is.** `frontend/render-coordinator.js` is a pure state machine: no DOM, no GPU, no rendering. `dispatch` and `present` are injected by `app.js`, so the module is unit-testable without an adapter and `app.js` is left to emit intent and present state. It owns:

- **Five generations per lane** — edit, viewport, scale, source, lane. Tokens snapshot all five; `token.isCurrent()` gates on edit and source (the generations that invalidate work), and the viewport/scale/lane generations drive follow-up decisions and telemetry. `noteEdit` bumps the generation, cancels the deferred follow-ups and stops the in-flight render at its next boundary; `noteSource` retires every lane's tokens, pending intent, viewport, scale and retained-frame record; `noteViewport`/`noteScale` bump only on a real change.
- **Foreground versus background priority** with **one in-flight / one latest pending**. A foreground submission cancels the in-flight token (which stops it at its next tile boundary) and becomes the pending slot; rapid submissions collapse onto it and a replaced pending resolves `false` with a `coalesced-by-newer-render` refusal. Background work never displaces foreground work: it waits behind it, is refused (`background-deferred`) when a foreground pending exists, and a foreground submission supersedes it.
- **Cancellation tokens.** Each intent carries a token with an `AbortController` signal and `cancel(reason)`. The app passes `request.isCurrent` into the renderer's existing per-tile guard (fetch, CPU controllers and unsubmitted GPU batches all stop through that path), and the app-domain facts a token cannot know — geometry signature, session id, compare peek, active lane — stay in `renderGpuDraftInner`'s guard.
- **Presentation acceptance.** `present(request, result)` is the app's acceptance call; the coordinator stores the accepted record and every presentation path mirrors it through `noteAccepted`, so the pan candidate and follow-up freshness read one record.
- **Coarse-to-refined lifecycle.** Catch-up is armed only after a viewport pass presents (never after a refusal), skipped when the generation moved, the mode changed or the lane is inactive, and its own pass carries no viewport. The pan follow-up yields to busy work and re-arms itself, and its pass re-arms the catch-up.
- **Timing feedback.** Dispatch and queue latency per request plus the preview-scheduler snapshot, exposed as `HDRFinisherPerformance.renderCoordinator()`.

**What `app.js` keeps.** Intent and presentation. `renderGpuDraft` measures the visible region, notes it on the coordinator and submits intent; `renderGpuDraftInner` is the dispatch callback; the ROI functions are adapters that keep their diagnostic names. `state.previewGeneration` is a **transitional mirror**: the coordinator is its only writer, written back from the coordinator generation after `noteEdit`/`noteSource`, so every existing reader stays valid until the mirror is removed.

**Behavior-preservation details worth recording:**

- The dispatch serial is assigned **per dispatch, not per submission** (`request.dispatchSerial`), so a coalesced intent that never starts cannot invalidate the presentation record of the render that actually presented. This is what keeps the rAF `serial !== state.gpuRenderSerial` semantics identical.
- `suspendGeometryPreviewWork` cancels both lanes' tokens and keeps its serial bump, so a render that had already presented is also retired from the record path.
- The follow-up delays stay in `app.js` as the named constants (`ROI_CATCH_UP_DELAY_MS = 700`, `ROI_PAN_DELAY_MS = 140`) and are passed to the coordinator; the diagnostics mode flip sets the coordinator mode **without** cancelling an armed timer, preserving `roiPanState().timerPending` semantics that the pan driver measures.
- Boot order: the delay constants are declared before `boot()` runs, because the coordinator is constructed during it. `8185c2a` had them below the call site (temporal dead zone); `d1ce1de` moved them to the top of `app.js`.

**Runtime evidence** (raw JSON under `codebase/output/performance/`, one GPU scenario at a time):

- `roi-catch-up.json`: the app's own edit path. ROI pass `viewportRequested true`, 2 of 4 tiles, 2 skipped. Catch-up `roiCatchUp true`, `viewportRequested false`, whole frame 4/4, `retainedFrame true`, accepted generation equals the armed generation; viewer Ready; 0 page errors.
- `roi-pan-cache.json`: newly exposed strip renders alone (1 foreground tile); a pan back into the refined region does no work (`foregroundTiles 0`, `reusedTiles 1`, 1 submission) and the accepted generation is unchanged.
- `roi-refinement.json`: `off`/`onWarm`/`on`/`cached` all as recorded in 15.16.
- `tiled-stop-gate.json`: 45 submissions per generation, longest encode span 8.6/8.2 ms, 0 stale submissions after supersession, both generations rendered.
- `presentation-gate.json`: unchanged taxonomy — the stale same-size generation refuses `superseded-before-presentation`, the newest presents, min sampled peak 245.
- `tiled-mask-batch-transport.json`: batches [4, 6], 0 per-tile requests, offscreen region unchanged.
- `tier-change-blank-canvas`: 0 blank samples across two runs, painted throughout, 0 CPU fallbacks. Wall time 3015 ms and 3891 ms for 4K→Full against 2190 ms recorded at 15.4 — **flagged for the packaged baseline**, not a gate failure; the scenario's gates are blank samples and fallbacks, and machine load during this session is the likely source.
- `full-tier-brush-feather` (42.4 MP): Ready/Full, exact, tiled, no Unavailable events, and the deliberate superseded mask refusal recovers.
- `mask-graph-interaction`: 0 mask requests during influence edits, undo/redo intact.
- `roi-parity.json` (item 9): legacy whole-frame and ROI passes at the same tier, a newer generation between them so the ROI pass re-renders instead of reusing; the visible 238×143 region (34 034 pixels) compared pointwise — **`maxAbsDifference 0`**; the ROI pass re-rendered 2 tiles with 0 reused and a retained frame. Coordinator record: 5 submits/5 dispatched, 0 coalesced, 0 dropped, 0 cancelled, `queueDelayMs` all 0, catch-up armed.

**Gate status, stated plainly:**

- **Phase 2 item 1: mechanism landed and regression-verified.** Honest caveats: (a) `state.previewGeneration` remains a single-writer compatibility mirror, not removed; (b) the queue is per lane, so cross-lane device contention behaves as before; (c) the coordinator adds no new allocations. The 1241 ms dispatch inside the parity run is the app's own whole-frame source transport, not queueing — `queueDelayMs` is 0 for every request.
- **Phase 2 item 9: the A/B path and the run exist; the gate is measured, not closed.** The run measured byte equality on the synthetic SDR test pattern at 300% zoom. The **Phase 0 per-module tolerance sign-off is outstanding**, so the 1/255 judgement in the evidence is provisional. Modules with grain, Detail, Denoise and spatial film were not active in this run, and the HDR surface path was not covered. The evidence is what the tolerance decision should be made from.
- **Still owed and not skipped:** the Phase 0 checklist items — parity tolerances (7), migration behavior (8), 42.4 MP packaged baselines (3), Fit filtering A/B (6) — and packaged/Electron evidence. Phase 3 remains untouched.
- **Suites:** **161 JS** (148 + 13 coordinator unit tests), **157 Python** (154 + 3 contract tests). All passing.

Owner checks to batch when convenient (nothing here blocks continued sprint work):

1. ROI switch on, zoom to roughly 36%, drag an adjustment, then scroll immediately. Expect the strip to refine shortly after the scroll pauses, zero work when scrolling back into the refined region, and no unadjusted boundary beyond one edit. This is the 15.16/15.17 check, now running through the coordinator.
2. Change tier 4K→Full on a large source and compare the pause against the previous build; the two timings above are the reference.
3. Optional: `npm run test:roi-parity` on a real source (the diagnostic needs a magnified view; it is also on `HDRFinisherPerformance.roiParity({ tolerance })`).

Next safe edit: packaged/Electron evidence for the Phase 2 paths and the 42.4 MP packaged baselines, then the tolerance and migration Phase 0 items. Do not start Phase 3.

### 15.19 Packaged evidence — 2026-09-23 (Electron runs of the Phase 2 paths)

Committed as `ae578d9` — "Make two ROI runtime drivers robust to packaged window geometry".

All runs used `node tests/run-in-electron.js <driver>` with `ELECTRON_RUN_AS_NODE` cleared (a wrapper script removes it), one GPU scenario at a time. Evidence JSON carries an `electron-` prefix under `codebase/output/performance/` so the Chromium runs are preserved beside it.

Results:

- `electron-roi-catch-up.json`: ROI pass 2 of 6 tiles, 4 skipped, retained; catch-up whole frame 6/6, `roiCatchUp true`, `viewportRequested false`, accepted generation equals the armed generation; viewer Ready; 0 page errors.
- `electron-roi-pan-cache.json`: warm frame 6/6; ROI pass 1 of 6; pan 1 (exposed strip) 1 tile, 262 144 processed pixels; pan 2 (back into the refined region) `foregroundTiles 0`, `reusedTiles 1`, 0 processed pixels, 1 submission; accepted generation unchanged; 0 page errors.
- `electron-roi-refinement.json`: `off` requests no viewport; the warm pass answered from the cache (`answeredFromCache true`, `redrewWhole false`) because the packaged window's settle chose the same 1280×720 target, so the retained target survived; the fresh-generation pass restricts to 2 foreground / 0 reused / 4 skipped; the same-generation pass is 0 foreground / 2 reused / 0 processed; the settings select drives the mode; 0 page errors.
- `electron-roi-parity.json`: **correction to 15.18** — the packaged surface is HDR (`rgba16float`), so this run exercises the half-float readback path 15.18 recorded as uncovered. 297×168 = **49 896 pixels compared, `maxAbsDifference 0`**; the ROI pass re-rendered 2 tiles with a retained frame; coordinator record 5 submits/5 dispatched, 0 coalesced, 0 dropped, 0 cancelled, `queueDelayMs` all 0; 0 page errors.
- `electron-presentation-gate.json`: `hdr true`, unchanged taxonomy (stale same-size generation refuses `superseded-before-presentation`, newest presents), min sampled peak 255; 0 page errors.
- `electron-failure-taxonomy.json`: transport failures keep the device available and the frame painted (255 before and after); three validation failures disable it at the threshold; 0 page errors.
- `electron-tiled-mask-batch-transport.json`: legacy 6/6 tiles (its retained frame is recorded, not asserted), ROI 4/6 with the retained frame, offscreen brightness unchanged at 232.84, one 6-tile batch, 0 per-tile requests; 0 page errors.
- `full-tier-brush-feather` (42.4 MP, packaged, no JSON file): Ready/Full, exact, tiled, no Unavailable events, and the deliberate superseded mask refusal recovers.

Driver fixes that packaged geometry required (committed in `ae578d9`):

- `roi-refinement.js`: the warm-pass assertion now accepts either a whole redraw (target recreated by a size change) or a cache-answered pass (target survived because the packaged settle chose the same size). The fresh-generation control below it is unchanged and deterministic; the summary records which branch was taken.
- `tiled-mask-batch-transport.js`: "the legacy pass is a full-frame pass" no longer requires `retainedFrame === false`. Since 15.16, retention describes the frame, not the route, so the assertion is `skippedTiles === 0 && foregroundTiles === tileCount` and `retainedFrame` is recorded in the summary.

Observation, recorded rather than hidden: the first Electron `roi-parity` launch timed out waiting for `gpuPreview.available`; the immediate retry produced identical numbers to the Chromium run. A transient GPU-process initialization on that launch, not a defect in the code under test.

Gate status:

- **Packaged/Electron evidence for the Phase 2 paths: closed** for these scenarios. Phase 1's remaining packaged debt (presentation gate, failure taxonomy, batch transport, brush feather) is also closed by the runs above.
- Still owed: the 42.4 MP packaged baselines at Fit, 100%, 200% and a representative pan (Phase 0 item 3) and its measurements (item 4), the Fit filtering A/B (item 6), the per-module tolerance sign-off (item 7), and migration behavior for existing preview preferences (item 8).
- Suites unchanged: **161 JS**, **157 Python**.

Next safe edit: the 42.4 MP packaged-baseline driver (Fit / 100% / 200% / pan), then the remaining Phase 0 sign-offs. Do not start Phase 3.

### 15.20 Packaged baselines — 2026-09-23 (42.4 MP, Fit / 100% / 200% / pan)

Committed as `22dc36a` — "Add the 42.4 MP packaged baseline driver". Evidence: `codebase/output/performance/electron-packaged-baselines.json` (Electron) and `packaged-baselines.json` (Chromium, for comparison).

The driver (`tests/performance/packaged-baselines.js`, also `npm run test:packaged-baselines`) loads the 7968×5320 noisy TIFF, forces tiled execution, and for each view state makes a real exposure change, recording slider-to-frame, first presentation at the edit's generation, the stable tier/edge/pixels, the coordinator's queue and dispatch latency, the planned peak GPU bytes, long tasks, JS heap, and the source bytes pulled. At 200% it pans 400 px and samples the retained frame.

**Packaged (Electron), 42.4 MP:**

| State | slider→frame | → first current | tier | processed px | submissions | dispatch (warm) | queue delay | peak logical | heap |
|---|---|---|---|---|---|---|---|---|---|
| Fit | 4.1 ms | 691.5 ms | Full 7968 tiled | 42 389 760 | 45 | 4 289 ms cold → 43/53 ms | ≈0 | 2 256 653 018 B | 161.9 MB |
| 100% | 4.6 ms | 283.9 ms | Full 7968 tiled | 42 389 760 | 45 | 162.8 ms | ≈0 | 2 629 682 906 B | 7.3 MB |
| 200% | 5.2 ms | 404.8 ms | Full 7968 tiled | 42 389 760 | 45 | 275 ms | ≈0 | 2 629 682 906 B | 8.2 MB |

Pan at 200%: 359 ms from scroll to the sampled frame (350 ms of that is the driver's own settle wait), retained-frame luma 0.815 (painted, not blank), accepted generation equals the current generation, viewer Ready. 0 page errors, 0 long tasks in the packaged window.

**Chromium, same fixture (comparison):** resident tier 1024 tiled (700 416 processed px), Fit 847.6 ms → current (cold proxy upload 5.6 MB), 100%/200% 137.8/140.1 ms, pan luma 0.364. The packaged app chooses Full where Chromium chooses 1024 — the display-scale policy difference the Phase 0 contract is about; both are recorded rather than reconciled here.

Observations for the tolerance and Fit-filtering decisions, recorded rather than acted on:

- Warm full-frame passes at Full are 43–275 ms of dispatch for 42.4 MP in the packaged build, with queue delay at zero — the coordinator is not adding a queueing tax at this size.
- The 100% and 200% planned peaks (2 629 682 906 B) exceed the 2 GiB Auto budget, and the plan says so, while tiled execution proceeds. The baseline records it; whether the budget model should treat this as a violation or the display-tier policy should avoid Full here is a Phase 0 decision.
- The only long task observed anywhere was a single 102 ms event during the Chromium cold load; the packaged window showed none.

Gate status: Phase 0 item 3 (42.4 MP packaged baselines) now has raw evidence at all four view states. Item 4's measurements are present for the same run (frame latency, time to current/stable, queue delay, processed pixels, planned GPU bytes, heap, long tasks, source bytes); scope-work timing is covered by the existing scope instrumentation rather than this driver. Items 6 (Fit filtering A/B), 7 (per-module tolerance sign-off) and 8 (migration behavior) remain. Suites unchanged: **161 JS**, **157 Python**.

Next safe edit: per-module parity runs (grain, Detail, Denoise, halation, spatial film) to feed the tolerance sign-off, then the Fit filtering A/B. Do not start Phase 3.

### 15.21 Phase 0 evidence — 2026-09-23 (film-look parity, migration behavior, tolerance proposal)

Committed as `4a79114` — "Test preview preference migration behavior" and `9594b66` — "Add a film-look graph to the parity scenario".

**Per-module parity with a film-look graph.** The parity driver now takes `--film`, which applies a representative film-look graph through the real controls — grain amount 40 / size 60, halation 35, bloom 25, image softness 15, microcontrast 20 — and waits for Ready before running the A/B. The graph exercises the module classes the Phase 0 tolerance table names (grain, halation/bloom around saturated highlights, and fine-structure softness/microcontrast) together.

- `roi-parity-film.json` (Chromium, SDR surface): 238×143 = **34 034 pixels, `maxAbsDifference 0`**, ROI pass 2 foreground tiles, retained frame, 0 page errors.
- `electron-roi-parity-film.json` (packaged, HDR `rgba16float` surface): 297×168 = **49 896 pixels, `maxAbsDifference 0`**, 0 page errors.
- Coordinator in both runs: 8 submits / 8 dispatched, 0 coalesced, 0 dropped, 0 cancelled, `queueDelayMs` all 0.

**Tolerance proposal for the owner (evidence, not sign-off).** On the synthetic fixture, with tone/color edits and the film-look graph above, the legacy whole-frame route and the ROI route are **byte-identical over the visible region on both surfaces**. The proposal that follows from that is: byte equality is the tolerance wherever both routes run the same graph through the same deterministic renderer (tone, color, curves, film look including grain, halation, bloom and structure); a numeric tolerance is needed only where the route changes the computation rather than its ordering. Two classes are **not covered by this evidence and should not be signed off from it**: Denoise reconstruction (a separate analysis pipeline, not active in these runs) and any export/reference comparison (different implementation). Detail-band and spatial-film module classes were active only as part of the film-look graph, not isolated.

**Migration behavior (Phase 0 item 8), now tested rather than described.** `tests/viewer-state-transitions.test.js` asserts `normalizedPreviewResolution` maps unknown, empty, null and differently-cased stored values to the 1024 default while preserving the four real options; `tests/test_preview_resolution_contract.py::test_preview_preferences_migrate_unknown_values_to_the_default` locks the two-stage migration (normalize, then require the selector to carry the option, else default), the startup removal of the legacy UI keys, and the ROI preference normalization (`"refinement"` else `"fit"`). A preference file from another build cannot select a tier this build cannot present.

Gate status:

- Phase 0 item 3 (42.4 MP packaged baselines) and item 4 (measurements): raw evidence in 15.20. Item 8 (migration behavior): recorded and tested here.
- Phase 0 item 6 (Fit filtering A/B): **still open**; no measurement yet. It needs a fixture with the named content classes and a mip-filtered comparator, which does not exist in this tree.
- Phase 0 item 7 (tolerance sign-off): **owner decision**; the proposal above is the evidence it should be made from. Denoise and export parity are explicitly uncovered.
- Suites: **162 JS** (161 + migration case), focused Python trio **157**, full Python suite **1331 passed / 3 skipped**.

Owner checks to batch (nothing blocks continued work):

1. Decide the Phase 0 tolerance table from the evidence above, or name what additional per-module runs are needed (Denoise is the obvious one).
2. Confirm the Fit filtering A/B fixture and comparator approach, or defer the item with a recorded reason.
3. The Phase 2 manual checks from 15.18 remain valid; the packaged build now has evidence for every Phase 2 path (15.19).

Next safe edit: the Fit filtering A/B (or a recorded deferral), then the Denoise parity run. Do not start Phase 3.

### 15.22 Phase 0 item 6 — 2026-09-23 (Fit filtering A/B measured)

Committed as `fb2b222` — "Add the Fit filtering A/B driver, fixture, and comparator". Evidence: `codebase/output/performance/fit-filtering-ab.json` plus the captured PNGs under `codebase/output/performance/fit-filtering/`. Run: `node tests/performance/fit-filtering-ab.js --url http://127.0.0.1:8799` (also `npm run test:fit-filtering`).

**What the unit built.**

- `tests/performance/fit-filtering-fixture.js`: one deterministic 4096×2304 ACEScg scene-linear float TIFF, six 384-px bands — smooth midtones (grain), textured midtones (Detail), noisy midtones (Denoise), bright sources on dark (halation), fine repeating detail (zone plate plus 1–2 px gratings), saturated highlights. Values are unmarked float data, so the loader passes both branches identical source pixels. 113 MB, too large to commit; generated once per machine into temp, the `large-noisy-tiff.js` pattern.
- `tests/performance/fit-filtering-compare.js`: the comparator. Two equal-size RGBA8 screenshots in, display-unit statistics out — max/mean/p95/p99 worst-channel delta, counts above 1 and 2 levels, mean luma delta, a 2×2-averaged "half" comparison (a difference that survives block averaging is a picture difference, not a sampling phase), and a mean-absolute-luma-gradient "energy" that says how much fine detail each side kept. 10 unit tests cover the arithmetic.
- `tests/performance/fit-filtering-ab.js`: imports the fixture, forces tiled execution, sets Fit, and for each of six scenarios runs both branches with the graph, zoom and framed image held fixed:
  - **full-at-fit** — tier `full` (4096), the graph runs at source resolution and the browser shows the downscaled result (today's packaged Fit behavior);
  - **display-scale** — the tier closest to the on-screen size (1024 against an 889-px pane, ratio 1.15), so the graph runs on that tier's per-channel Lanczos scene-linear source at roughly display scale.
  Both branches are captured as screenshots of the mounted canvas — what the user sees — and compared per band. Denoise is included: its selector is bound to the tier edge, so each branch gets its own analysis at its own scale.

**Why this does not need the Phase 3 mip cache.** The tier proxy is already a correctly filtered, scene-linear, pre-adjustment source, so the display-scale branch is the visual contract the mip path must preserve; the cache changes how that filtered source is produced, not what it looks like. Recorded so this item's evidence is not entangled with unvalidated Phase 3 code. The driver asserts both branches took the tiled route and were exact, so a silent fallback cannot produce a green-looking run.

Observation for future diagnostic drivers: setting the tier through the `#preview-resolution` select persists the preference through the application shell, whose preference echo calls `applyExecutionOverride` with the stored value and silently clears a forced route. The first run fell back to Direct at every branch because of this; the driver now applies the tier through `applyPreviewResolution` and re-asserts the route. The product behavior is arguably correct (the persisted preference wins); the trap is in the driver.

**Evidence (Chromium, SDR surface, tiled, exact, 0 page errors).** Display-scale versus full-at-fit, 0–255 display units, on each scenario's focus band:

| scenario | focus band | max | p99 | mean | detail energy (display / full) |
|---|---|---:|---:|---:|---:|
| grain | smooth midtones | 4 | 2 | 0.82 | 0.5 / 0.6 |
| detail | textured midtones | 31 | 8 | 2.16 | 5.3 / 6.5 |
| denoise | noisy midtones | 27 | 10 | 2.59 | 1.6 / 4.2 |
| halation | bright sources on dark | 94 | 93 | 6.42 | 1.7 / 1.7 |
| fine-detail | fine repeating detail | 65 | 53 | 17.23 | 1.7 / 17.0 |
| highlights | saturated highlights | 208 | 82 | 8.42 | 4.4 / 4.1 |

Interpretation, stated plainly:

- **grain** is the tightest class: max 4, p99 2, mean 0.82. The grain field rendered at 1024 is the grain field rendered at 4096 within a few levels.
- **Detail and Denoise** differ at the 8–10 p99 level with moderate means. Denoise's energy (1.6 vs 4.2) says the display-scale route is the *cleaner* one: the source is filtered before denoise runs, so less residual per-pixel noise survives.
- **halation** differs sharply but locally — p99 93 with identical global energy. The glow radius is a scale-dependent spatial effect and the two branches place it differently; this is the class the tolerance table has to decide.
- **fine repeating detail** is the expected big one. The source's 1–2 px gratings are below the display tier's Nyquist, so the display-scale branch averages them to flat fields (energy 1.7) while full-at-fit shows moiré (energy 17.0). The display-scale result is the more truthful rendering of detail the screen cannot show.
- **saturated highlights**: localized large differences at speculars (max 208) between the browser's downscale of the 4096 frame and the ~1:1 display frame; band mean 8.42.
- Whole-frame comparison of the same pairs: max 200–208, and 114–121 after 2×2 averaging — the differences survive block averaging, so they are not half-pixel sampling phase. The per-band table is the informative view.
- Cross-check: the first (Direct-route) run's focus-band metrics matched the tiled run exactly, and the driver's screenshots are deterministic.

**Gate status, stated plainly:**

- Phase 0 item 6: **measured, not signed off.** The numbers above are the evidence; which differences are acceptable, and whether Fit should process at display scale for these classes, is the item 7 owner decision. Uncovered and not to be signed off from this run: the packaged/HDR surface, export/reference parity, and the legacy-versus-ROI Denoise parity (the Denoise scenario here compares two *scales*, not two routes).
- Suites: **172 JS** (162 + 10 comparator unit tests), full JS suite passing. No Python touched by this unit.

Next safe edit: the Denoise parity run — extend the parity scenario to cover Denoise reconstruction, the main gap in the 15.21 tolerance proposal — then the per-module tolerance sign-off. Do not start Phase 3.

### 15.23 Denoise parity — 2026-09-23 (the 15.21 gap, ROI route)

Committed as `031cfa3` — "Add the Denoise scenario to the parity driver". Evidence: `codebase/output/performance/roi-parity-denoise.json` (Chromium, SDR surface) and `electron-roi-parity-denoise.json` (packaged, HDR `rgba16float` surface). Run: `node tests/performance/roi-parity.js --url <url> --denoise` (Chromium) and `node tests/run-in-electron.js tests/performance/roi-parity.js --denoise --output output/performance/electron-roi-parity-denoise.json` (packaged).

**What changed.** `roi-parity.js` takes `--denoise` (enable Denoise reconstruction through the real controls — amount 1, then wait for the runtime to reach ready) and `--input <file>` (load a file source; the plain run still uses the test pattern). Without `--input` the Denoise run uses the generated 2400×1600 noisy TIFF, because a smooth fixture gives the reconstruction nothing to do. The summary records the source, the Denoise settings and identity, and cumulative counter snapshots before / ready / after; assertions require the analysis to have dispatched and the parity passes to have resolved more tiles than the enable-time render, so a run cannot look green with the pipeline idle. Default output names are suffixed (`roi-parity-denoise.json`, `roi-parity-film.json`) so a flag run cannot overwrite the plain evidence.

**Evidence.**

| run | tier | visible region | compared pixels | maxAbsDifference | analysis (dispatches / tiles / evidence) | resolve tiles ready → after |
|---|---|---:|---:|---:|---|---|
| Chromium, SDR | 1024 | 127×76 | 9 652 | **0** | 2 / 1 / 5 253 120 B | 5 → 11 |
| Packaged, HDR | 2400 (Full) | 297×168 | 49 896 | **0** | 12 / 6 / 28 800 000 B | 26 → 48 |

- Both runs: Denoise `selectedSource resolved`, `cacheReady true`, identity bound to the tier edge (`:hdr:1024:` / `:hdr:2400:`), settings amount 1 / luminance 0.5 / color noise 0.5 / detail recovery 0.5.
- ROI pass in both: `viewportRequested true`, 2 foreground tiles, retained frame, tiled, a newer generation than the legacy pass (2 → 3).
- Coordinator: Chromium 7 submits / 7 dispatched, 1 coalesced, 1 cancelled; packaged 8 / 8, 0 coalesced / dropped / cancelled; `queueDelayMs` ≈ 0 in both.
- Regression: the plain test-pattern run after the change reproduces 15.18 exactly — 238×143 = 34 034 pixels, `maxAbsDifference 0`, 2 foreground tiles, retained frame, 0 page errors.
- 0 page errors in all three runs.

**Interpretation.** The tile-wise Denoise reconstruction produces the same pixels as the whole-frame reconstruction over the visible region, on both surfaces, including the packaged Full tier where the analysis covered 6 tiles. This is the evidence the 15.21 tolerance proposal named as its main gap. It covers the legacy-versus-ROI route comparison only; export/reference parity is a different implementation and remains uncovered.

**Gate status:**

- Phase 0 item 7's Denoise gap: **covered for legacy-versus-ROI parity**. The owner's tolerance decision remains open, now with Denoise evidence in hand.
- Suites unchanged by this unit (no Python touched; JS unchanged): **172 JS**. Phase 3 untouched.

Next safe edit: export/reference parity — the remaining uncovered class in the 15.21 proposal — or hold for the owner's tolerance decision. Do not start Phase 3.

### 15.24 Owner review of the Fit filtering A/B — 2026-09-23 (screenshots read as jarring; measured cause)

The owner reviewed the twelve PNGs from 15.22 and reported that the scenarios look "wildly different" when flipped back and forth, specifically that the fine repeating detail band — checkerboard and stripes — is "basically invisible" in display-scale mode. No code changed and nothing was signed off; this section records the reaction and the measurements taken in response.

Measurements on the same PNGs (889×501 each, luma 0–255):

| band / feature | full-at-fit | display-scale |
|---|---|---|
| grain, smooth midtones | mean 119.50, sd 2.56 | mean 119.50, sd 2.48 |
| Detail, textured midtones | 117.35, sd 8.28 | 117.44, sd 6.75 |
| Denoise, noisy midtones | 120.91, sd 5.56 | 121.36, sd 2.59 |
| halation, glow profile through the bright line | rise over ~5 px, peak 248 | rise over ~7 px, peak 244 |
| halation, dot region | mean 43.8, sd 47.5 | mean 52.7, sd 54.6 |
| fine detail, gratings region | sd 24.46 | sd 2.83 |
| fine detail, zone plate | sd 25.01 | sd 10.36 |
| highlights, soft blob | 231.41, sd 20.94 | 231.59, sd 20.91 |
| highlights, 16× patch | 232.44, sd 44.95 | 238.01, sd 29.68 |

**What the measurements say.**

- The module classes the tolerance table names are close. Grain is indistinguishable; Detail is within a level with slightly lower texture contrast; the halation glow is 1–3 px wider on one side with a peak within 4 levels; the large highlight blob is identical. The graph is already scale-aware for these: halation/bloom derive their radii from the processing frame's physical gate, and Detail's sharpen radius is scaled by the proxy-to-source ratio (`p[155]`).
- The dramatic difference is content at or below the display resolution: the 1–2 px gratings and checkerboards, per-pixel noise, and specks a few source pixels wide. At display scale these average to the flat value a correct filter must produce; the full-at-fit branch shows moiré, residual noise and aliased specks because the browser's downscale of the 4096 canvas is a crude filter. The display-scale branch is the more truthful rendering of that content — the full-at-fit branch is not "sharper", it is showing false detail.
- Denoise's display-scale band is smoother because the source is filtered before the analysis runs; the fixture's noise is per-pixel, so this is the same effect.
- The fixture is a deliberate worst case and every screenshot carries the same fine-detail strip, so flipping any pair shows that strip first. Normal photographic texture behaves like the Detail band.

**Consequence for the decision.** The screenshot comparison alone conflates (a) graph behaviour at the processing scale with (b) the browser's sampling of a full-resolution canvas for display. (a) measures close; (b) is where the jarring difference comes from, and (b) is what the display-scale path fixes. Before the tolerance sign-off, the measurement that separates them: read back both processed frames and downsample the full-at-fit frame with a correct (Lanczos) filter to the display size, then compare. The comparator from 15.22 already has the statistics half; the driver needs a readback capture and a resampler.

Recorded as the reason that follow-up exists, not as a rejection of the display-scale contract.

### 15.25 Fit A/B corrected — 2026-09-23 (reference is the export look; residual is the view transform)

Committed as `4a59c29` — "Rebuild the Fit A/B reference from the processed frames". Evidence: `codebase/output/performance/fit-filtering-ab.json`, the review pairs under `codebase/output/performance/fit-filtering/` (`<scenario>-reference.png`, `<scenario>-preview.png`, `<scenario>-difference.png`), and the superseded browser screenshots under `fit-filtering/screen/`.

**Owner direction, recorded.** The finishing app has to be judged perceptually: when the user moves grain, Detail, halation or Denoise, the preview must align with the file they will export, and from the owner's point of view display and full should look identical. The 15.22 review set did not set that up — it compared the display-scale render against the browser's own crude downscale of a 4096-px canvas — so it was a waste of the owner's time. Test setups from here on must present the export look at screen size and ask for a "close enough" judgement.

**What changed.**

- `fit-filtering-compare.js` gained `lanczosResampleRgba` (separable Lanczos-3 with precomputed taps, self-contained so it can be injected into the page) plus four unit tests: constant field, identity, a sub-Nyquist checker converging to its mean, and a monotone ramp.
- `fit-filtering-ab.js` now captures the **processed frames**: the retained presentation target is read back in 384-row strips and both branches are reduced to the canvas CSS box (889×500) with the same Lanczos filter. The primary comparison is `reference` (full-tier frame — what the exported file looks like at this size) versus `preview` (display-tier frame — what display-scale Fit shows). Screenshots are kept under `screen/` as secondary evidence only.
- Graph-state assertions: every scenario/branch must show its scenario's values, and every tracked key not named by a scenario must sit at its default. This caught a driver bug: a value-tracking guard in the reset loop silently skipped halation and bloom, so three scenarios shared one graph and read as a scale result. The reset is now unconditional, selects reset to their marked option, and the film-look parity driver returns and asserts the verified state.
- `--only` selects scenarios for iteration.
- Re-ran the film-look parity with the verified graph on both surfaces: `roi-parity-film.json` 34 034 pixels and `electron-roi-parity-film.json` 49 896 pixels, **`maxAbsDifference 0`**, halation 35 and bloom 25 confirmed active in the recorded state. The 15.21 claim now has a state-verified graph.

**Result (Chromium, SDR, tiled, exact, 0 page errors).** Reference versus preview, p99 / mean in 0–255 units, per band:

| scenario | smooth | texture | noise | halation | fine | highlights |
|---|---|---|---|---|---|---|
| grain | 2 / 0.87 | 2 / 0.85 | 4 / 0.90 | 75 / 3.94 | 26 / 14.48 | 115 / 6.47 |
| detail | 2 / 0.31 | 3 / 0.66 | 5 / 0.78 | 82 / 4.02 | 27 / 14.55 | 118 / 6.48 |
| denoise | 1 / 0.19 | 3 / 0.86 | 4 / 0.75 | 75 / 3.74 | 25 / 14.57 | 115 / 6.29 |
| halation | 1 / 0.18 | 2 / 0.46 | 4 / 0.71 | 95 / 6.89 | 21 / 11.33 | 87 / 8.71 |
| fine-detail | 1 / 0.18 | 2 / 0.45 | 4 / 0.69 | 75 / 3.78 | 26 / 14.61 | 115 / 6.31 |
| highlights | 1 / 0.18 | 2 / 0.45 | 4 / 0.69 | 75 / 3.78 | 26 / 14.61 | 115 / 6.31 |

Feature measurements on the same pairs: the grain band is indistinguishable (mean 114.01, sd 25.37 on both); the averaged checkerboard sits 12–13 levels brighter in the preview (gratings 155.78 vs 143.31, both flat); the halation line peaks 255 in the preview against 233 in the reference; the highlight band averages 5 levels brighter in the preview.

**What the numbers mean.**

- The module classes match: grain, Detail and Denoise bands average under one level apart with p99 ≤ 5. The graph is scale-aware for them.
- The residual is confined to content at or below the display Nyquist: the 1–2 px gratings and checkerboard, the 5-px bright line, sub-pixel speculars. There the difference is systematic and has one cause: **the display transform is nonlinear, so filtering the source before the graph is not the same as filtering the graded result.** The preview (filter then grade) shows unresolved high-contrast detail as a brighter, smoother average; the export viewed at the same size (grade then filter) shows it slightly darker and broader. Halation and bloom spread the same mismatch rather than causing it.
- This is inherent to display-scale processing. No better filter or cache removes it; only grading at full resolution and filtering the graded frame for display reproduces the export exactly (the slow path), and grading at a multiple of display scale would bound the error.
- **Consequence for the hypothesis:** the Fit filtering hypothesis is partially disproven as a perceptual-identity claim. Identity holds for grain, Detail, Denoise and normal texture; it does not hold exactly for sub-Nyquist high-contrast detail and speculars, where the difference is a property of the nonlinear view transform. Whether that residual is acceptable at Fit — or whether the final view must be a graded-then-filtered frame — is the owner's decision (Phase 0 item 7).
- Preview-versus-export parity remains a separate open item: the reference here is the renderer's own full frame, not an exported file.

**Gate status.** Phase 0 item 6: measured with the corrected reference; item 7 remains the owner's decision, now with the scale residual named and quantified. The 15.22/15.24 screenshot comparison is superseded as judgement evidence and retained only as the record of what the browser displays today. Suites: **176 JS** (172 + 4 resampler tests). No Python touched.

Next safe edit: export/reference parity — the preview frame against an actual exported file, which is the direct test of the owner's WYSIWYG requirement — or hold for the owner's tolerance decision. Do not start Phase 3.

### 15.26 WYSIWYG target and tolerance method — 2026-09-23 (owner direction; PRD 4.8 added)

Owner decisions from the design discussion, recorded as product direction:

1. **Perceptual alignment is the target.** The exactness terminology (display exact, native-region exact) is a floor, not the ceiling; everything else is a nice-to-have or noise.
2. **The comparison anchor is Chromium itself:** the delivered file as Chromium renders it versus the preview through this application's Chromium pipeline. How other applications render a file cannot be accounted for, and Chromium is the shared pipeline by design.
3. **The tolerance method is perceptual sign-off on side-by-side pairs** per module class; numeric metrics exist to catch extreme errors rather than to decide acceptability. Small pixel-level differences matter only when they are extreme errors.

PRD **4.8** was added with those statements, consistent with 4.5 (terms unchanged) and 12 (Fit is not export-resolution processing; it must be perceptually aligned with the export as displayed).

**The anchor already exists as a product feature.** `Show Chromium proof` renders the delivered file through the app's Chromium HDR pipeline (`backend/hdr_finisher/proofing.py`, `frontend/proofing-ui.js`) with delivery format and target peak selection. The export/reference parity run can use it directly instead of building a viewer.

**Where perceptual sign-off falls apart, and the mitigations (recorded so the method is not oversold):**

- It is not reproducible or automatable. Acceptable for the item 7 calibration; not for every regression. Mitigation: the sign-off calibrates a numeric bound per class; routine runs compare against the bound and flag extremes; the owner re-reviews only when a class changes or a bound is exceeded.
- Any review sheet that rescales images introduces its own filter; 15.24 showed the browser's downscale of a 4096-px canvas aliasing. Mitigation: capture both sides at display size with the harness (preview canvas screenshot and Chromium-proof screenshot at the same box) and compose side-by-side and difference sheets without further scaling.
- Flip comparison inflates sensitivity — 15.24's "jarring" reaction was mostly the stress fixture's sub-Nyquist content. Mitigation: judge side-by-side and isolated, at the intended viewing size.
- Grain and Denoise are texture-character judgements; pointwise metrics can read large while the eye sees the same texture. Mitigation: report texture/energy statistics beside pointwise numbers and name the class.
- HDR classes depend on the display path: the proof's target peak must match the preview's reference white and an HDR-capable display is required. Mitigation: sign HDR classes on the packaged configuration only, with the peak recorded.
- Format coverage: Chromium decodes PNG/JPEG/AVIF natively; this product already labels JPEG XL as limited browser support. Mitigation: gate the Chromium-anchored classes on formats Chromium decodes (SDR PNG/JPEG, Ultra HDR JPEG, AVIF gain map) and treat JXL through a different reference or an explicit exclusion.

**Gate status.** Phase 0 item 1 (contract approval): 4.8 is now written. Item 6: measured. Item 7: the method is defined, the table remains unsigned. Suites unchanged: **176 JS**. Phase 3 untouched.

Next safe edit: the export/reference parity run — export from a session, render the delivered file through the Chromium proof path, capture both sides at display size, and produce the side-by-side and difference sheets for the owner's perceptual sign-off. That is the direct test of 4.8 and the last uncovered class in 15.21.

### 15.27 Accuracy boundaries — 2026-09-23 (owner: what perceptual does not cover; the anchor's blind spot; HDR precision)

The owner added three constraints to the 4.8 target, now written into it:

1. **Measurement claims stay exact.** Peak nits, ceiling checks, gain-map metadata and headroom are checked numerically, never by eye. If the app reports 999.5 nits, the export is not 1001.
2. **The Chromium anchor proves agreement, not correctness.** Preview and proof share the same Chromium display path, so a wrong tone map, headroom or colour-management decision makes both sides wrong in the same way and they still match. The export therefore needs its own decode-and-verify check: values and metadata read from the delivered file.
3. **HDR evidence must be read at real precision on both sides.** CDP/Playwright page captures and Electron `capturePage` return display-referred 8-bit; a difference image built from them would look clean exactly where HDR errors live. Any composite from page captures is labelled SDR-only and may not support an HDR difference claim.

**What the tree already provides (verified, so the parity unit does not invent it):**

- Preview side: `readPresentationRegion` returns half-float values from the `rgba16float` presentation target — the same readback the route parity runs use.
- File side: `gainmap_decoders.decode_ultrahdr_jpeg` returns canonical HDR ACEScg plus the exact decoded SDR base with its gain-map metadata; `decode_avif` covers plain, direct-HDR and ISO 21496-1 gain-map AVIF; `avif_info.inspect_avif` reports gain-map presence, bit depth and headroom labels; capability gates already exist for both decoders.
- Screenshots remain valid for SDR-viewable composites only.

**Consequence for the next unit.** Export/reference parity begins with the precision capability check: confirm a float readback of the preview and a real-precision decode of the exported file for the chosen format, compare values and metadata numerically, and only then build the perceptual review sheets. Export correctness (decode plus metadata) is a separate assertion from preview-agrees-with-export; both must pass for the parity class to close, and the review sheet states which parts were read at real precision and which are SDR-only.

Gate status: item 7's method now includes the numeric/measurement boundary; the table remains unsigned. Suites unchanged: **176 JS**. Phase 3 untouched.

Next safe edit: export/reference parity with the precision precheck, per 4.8.

### 15.28 Export/reference parity run — 2026-09-23 (precision precheck, two assertions, review sheets; a proof-path defect found and fixed)

The export/reference parity unit was built and run: the last uncovered class in the 15.21 tolerance proposal. Evidence is raw under `codebase/output/performance/` (gitignored): `export-parity-export.json` + `export-parity-export/` (delivery-scale run on the Chromium surface) and `electron-export-parity.json` + `export-parity-electron/` (packaged run on the HDR surface).

**What was built.** `tests/performance/export-parity.js` drives a session through the real controls (delivery ceiling declared through the highlight section, format and encode settings applied through the export panel so the proof request and the export request read the same values), forces the display tier, reads the presentation target back as float, builds the app's own proof artifact through `Show Chromium proof`, downloads it, captures both sides at the same canvas box, composes side-by-side and x4-difference sheets with a provenance caption, and exports at delivery scale when the export endpoint is reachable. `tests/performance/export_parity_check.py` is the file side: decode, assertion 1, the named-encoding transform, one Lanczos-3 reduction for both sides, band and whole-frame statistics, reference PNGs. `tests/test_export_parity.py` (19 tests) covers the transform against analytic identities, the resampler, the comparator, the band crops, the ceiling rules, and a real JPEG Ultra HDR encode/decode when the bundled encoder is present.

**Precision precheck (1a), verified at run time.** Preview float readback is real only on the packaged surface: the packaged run read a 1024x576 `rgba16float` target; the Chromium surface presents `bgra8unorm`, so that run is labelled SDR-only and makes no HDR precision claim. The file side decodes at real precision: libultrahdr's linear f16 output for JPEG Ultra HDR (16f), with `decoder_reference_white_nits = 203` confirmed in the metadata; AVIF gain-map decode and `inspect_avif` exist behind their capability gates and were not exercised (format chosen: `jpeg_ultrahdr`). Page captures remain 8-bit display-referred and every sheet says so.

**Named common encoding.** The comparison is in the *preview presentation encoding*: display-referred, transfer-encoded, extended canvas convention (1.0 = 203 nits), or the SDR fallback otherwise. The export side is mapped through the preview's own transform — `displayHdr`/`displayEncode` from `webgpu-preview.js` with the shader's matrix constants, not a re-derivation. Analytic checks pin it: a neutral 0.18 encodes to exactly 1.0 at 203 nits, to `sRGB(100/203)` at 100 nits, and the transport clamp at 10 000 nits is exact. The alternative (inverting the preview back to scene-linear) is deliberately not used: the inverse transfer function amplifies half-float quantization on the preview side.

**Delivery declaration.** The run declares a delivery ceiling (highlight section enabled, peak fit, 1000 nits) through the real controls. Without a ceiling the fixture's 72 000-nit speculars exceed what any gain-map format can carry above a tone-mapped base, and the delivered file clips below the preview for a reason that says nothing about the preview.

**Assertion 1 — export correctness (decoded values and metadata versus declared settings).** Delivery-scale run, all six scenarios: sha256 matches the declared artifact, dimensions match, JPEG Ultra HDR container confirmed, capacity bounds sane, decoded headroom equals the app's reported `encoded_headroom` (2.2829 vs 2.283 stops), SDR base finite and in [0,1], and the strict ceiling holds — decoded peaks 991.7, 1007.5, 989.6, 992.4, 989.0, 989.0 nits against a 1011-nit allowance, zero pixels above. Proof-scale run: same metadata checks pass; the strict ceiling rule is reserved for delivery-scale encodes because a proof-sized encode overshoots it at sub-Nyquist speculars (below).

**Assertion 2 — preview agrees with export, in the named encoding.** Deltas are worst-channel, in encoding levels (1/255), after both sides are reduced to the 889x500 canvas box with the same filter.

| scenario / focus band | delivery-scale export run (SDR fallback encoding) | packaged proof-scale run (P3 extended encoding) |
| --- | --- | --- |
| grain / smooth | mean 1.87, p99 2.97, max 3.7 | mean 2.22, p99 5.14, max 16.5 |
| detail / texture | mean 2.87, p99 4.35, max 7.5 | mean 6.75, p99 13.35, max 20.5 |
| denoise / noise | mean 1.68, p99 4.91, max 13.5 | mean 2.14, p99 6.50, max 96.5 |
| halation / halation | mean 5.32, p99 55.24, max 56.4 | mean 12.43, p99 178.26, max 243.7 |
| fine-detail / fine | mean 8.54, p99 19.32, max 28.2 | mean 2.28, p99 13.90, max 57.5 |
| highlights / highlights | mean 13.06, p99 132.30, max 157.3 | mean 32.02, p99 369.08, max 429.2 |
| whole frame | mean 4.94-5.96, p99 92.0-93.0 | mean 7.74-10.75, p99 255.8-258.6 |

The two encodings are not comparable in magnitude: the SDR fallback's Reinhard compression shrinks scene differences that the extended encoding reports at full slope. The packaged numbers are the real-precision ones for the HDR class; the SDR run is the delivery-scale file check.

**Named residual classes and mechanisms (what the numbers are).**

1. **Sub-Nyquist content** (fine 8.5, texture 2.9 at delivery scale): the preview processes at the display tier and the export at source resolution; the same class 15.25 named, now with the file's own encode/decode in the chain.
2. **Grain and Denoise texture character** (smooth 1.9/2.2, noise 1.7/2.1): pointwise deltas read larger than the texture difference the eye sees; the sheets and the energy columns are the judgement, per 15.26.
3. **Halation and bloom edges** (p99 55/178): the glow's low-amplitude skirt survives the file at a slightly different amplitude and radius than the display-tier preview produces.
4. **Highlights: gain-map capacity versus SDR-base compression.** At the fixture's saturated specular patches the SDR base JPEG is dark (measured at patch 5: encoded 0.110, 0.008, 0.122) with the gain map saturated at 1.0, and the capacity (2.28 stops) cannot reconstruct the authored HDR (ceiling-compressed toward white, preview scene ~0.76). The delivered file therefore reads dark and saturated where the preview reads bright: delivered encoded (0.434, 0.126, 0.484) versus preview (1.865, 1.288, 1.319). Mechanism verified by splitting the delivered file and reading base and gain map directly. This is a format-capacity property at high-chroma speculars when the SDR rendition compresses below the HDR, not a preview error; it is the largest single contributor to the highlights band and is a candidate for the item 7 table and for an owner decision (the encode's capacity policy).
5. **Proof-scale ceiling overshoot at sub-Nyquist speculars.** The proof artifact (1200 long edge, the product's cap) decodes above the declared ceiling on 31-99 pixels of 810 000 (0.004-0.012%), up to 2.1x the ceiling, in the highlights band; the same grade exported at 4096 decodes at 989-1007 nits with zero pixels above. Mechanism: the guided gain-map denoise crosses sharp base edges where the speculars are sub-pixel at proof scale. Recorded, not asserted, for proof-scale encodes; the delivery-scale run carries the strict rule.

**A proof-path defect found and fixed.** The proof proxy session omitted `denoise`, so a proof artifact of a denoised edit showed a file the export endpoint would never produce — the anchor silently disagreed with the delivered file by construction. `ProofArtifactStore.create` now carries the session's denoise into the proxy, and `_request_signature` folds the denoise state in so a proof built before a denoise change can no longer be served for it unchanged. Two tests added in `tests/test_proofing.py`.

**Method notes recorded so this is not oversold.** The first packaged run read a 4096x2304 target because the packaged app's persisted tier preference was full resolution; the driver now forces the display tier through `applyPreviewResolution` (with the execution override re-asserted) and fails if the readback is not that tier — otherwise the run would have compared a full-resolution preview while calling it the display preview. The proof artifact is capped at 1200 long edge by the product; the delivery-scale run is the one whose file side is a real export.

**Gate status.** Assertion 1 passes on both surfaces; assertion 2 is measured and awaits the owner's perceptual sign-off on the sheets (`export-parity-export/*-side-by-side.png`, `export-parity-electron/*-side-by-side.png`, with x4 differences beside them). Suites: **176 JS**; Python **1352 passed, 3 skipped**. Phase 3 untouched.

Next safe edit: item 7's tolerance table, fed by this run — route parity is byte-equal (15.18/19/21/23), export parity comes from 15.28, and per-module isolated runs only if the owner names them.

### 15.29 Owner sign-off on export parity and the Phase 0 item 7 tolerance table — 2026-09-23

The owner reviewed the export/reference parity sheets and passed all of them: "all of the side-by-sides are passing for me." Reviewed set: the six scenarios of the packaged HDR run (`output/performance/export-parity-electron/*-side-by-side.png`, with the x4 differences beside them) and the delivery-scale export run (`output/performance/export-parity-export/*`). The owner's one question — the saturated purple/teal highlight patches in the delivered file where the preview reads near-white — was answered as 15.28 item 4 (gain-map capacity at high-chroma speculars) and accepted.

**Scope of the sign-off, stated so it is not oversold.** The sign-off is perceptual, on the 8-bit SDR-only composites, at the declared 1000-nit delivery target, on the packaged configuration with the peak recorded (per 15.26). It does not replace the numeric claims: peak nits, ceilings, metadata and headroom remain the decoded-file checks in 15.28, and any composite built from page captures still supports no HDR difference claim.

**Phase 0 item 7 — approved parity tolerances per module class.**

- **Byte equality required:** route parity (tiled versus whole-frame, ROI versus legacy) — byte-equal, 15.18/19/21/23. No tolerance is granted here.
- **Export parity: perceptual, per class, anchored on the accepted 15.28 numbers.** Accepted anchors from the packaged real-precision run, focus-band mean / p99 in encoding levels: grain (smooth) 2.22 / 5.14; detail (texture) 6.75 / 13.35; denoise (noise) 2.14 / 6.50; halation 12.43 / 178.26; fine-detail (fine) 2.28 / 13.90; highlights 32.02 / 369.08. The delivery-scale export run's numbers are the file-side check for the same classes. These anchors are the accepted values, not a tight bound: a routine run that exceeds an anchor flags the class for the owner's re-review rather than failing automatically (15.26's mitigation), and the owner re-reviews only when a class changes or an anchor is exceeded.
- **Accepted residual classes, named:** sub-Nyquist content at display-tier versus source-resolution processing; grain and Denoise texture character; halation and bloom skirt amplitude/radius; gain-map capacity at high-chroma speculars (the fixture's 72,000-nit patches; accepted as format behaviour, and a product decision — not a parity regression — if it appears in real content); proof-scale ceiling overshoot at sub-Nyquist speculars, recorded and not asserted, with the delivery-scale encode carrying the strict rule.
- **Per-module isolated runs:** not named by the owner; none scheduled. The six-scenario run covers the classes.

**Gate status.** Phase 0 items 3, 4, 6, 7 and 8 are now done (item 7 defined and signed here). Suites: **176 JS**; Python **1352 passed, 3 skipped**. Phase 3 untouched.

Next safe edit: return to the sprint plan with Phase 0 complete for items 3, 4, 6, 7 and 8; do not start Phase 3.

### 15.30 Committed checkpoint — 2026-09-23 (persistent source mip cache; Phase 3 item 1)

Committed as `87d38f3` — "Add the persistent multi-resolution source mip cache".

**What was built.** `SourceMipStore` in `backend/hdr_finisher/render_cache.py` implements the §5.3 contract:

- **Key.** `SourceMipIdentity` carries content fingerprint, byte size, dimensions, decoder version, color-transform version, orientation, lane (`hdr`/`sdr`), the reference white used at decode, a canonical user-interpretation/RAW-recipe string, and the cache format version. Its digest names the disk directory (`<root>/v1/<digest>/<edge>.f32`). Grade state is deliberately absent, so slider moves, overlays and presentation retargets cannot invalidate a level. `SOURCE_DECODER_VERSION` and `SOURCE_COLOR_TRANSFORM_VERSION` live in `loader.py`; the loader normalizes orientation at decode, so the key records `orientation=1` for the upright stored data.
- **Contents.** Levels are pre-adjustment canonical scene-linear data produced by the same `downsample_image` call the session always used, so a warm level is byte-identical to a cold one (tested). Levels at or above the native edge are never cached — the decoded image is returned unchanged.
- **Atomic build.** Single-flight per identity and level; the level file is written to a temp path and `os.replace`d. Interrupted temp files are swept on first use; a level that fails magic/version/shape/size/CRC32 validation is discarded and rebuilt rather than served.
- **Bounds.** Memory and disk are separate byte-bounded LRUs (defaults 256 MiB / 1 GiB; env-overridable) with per-edge eviction counters. Stale format-version directories are removed on first use.
- **Telemetry.** `source_mip` in `render_cache.diagnostics()` exposes memory/disk hits, cold builds, bytes read, bytes generated, build duration (total and mean), native passes, evictions, corrupt discards, stale removals, write failures, single-flight waits, and current RAM/disk footprints. The `/proxy` and `/source-tile` responses carry `X-Source-Level-State` (`built`/`memory`/`disk`/`native`/`session`), which is how the warm-Fit gate will be measured.
- **Wiring.** `sessions.py` builds the identity at session creation and on `update_source_interpretation` (which re-decodes the same file with different pixels); `replace_source` swaps identity and drops the old identity's memory; `set_color_context` intentionally does **not** invalidate mips. `tests/conftest.py` points the store at a temporary root so the suite never writes to application data. `HDR_FINISHER_SOURCE_CACHE_DISABLE` turns persistence off; `HDR_FINISHER_SOURCE_CACHE_DIR` relocates it.

**Evidence.** 14 new Python tests: byte-identical cold/warm/restart levels, identity coverage of every decode input and nothing else, grade-change non-invalidation through two cache instances, disk warm after memory drop, odd dimensions with 5000.0 and negative values preserved through a disk round-trip (edge rows included), corruption and truncation discarded and rebuilt, stale-version and interrupted-write sweeps, byte-bounded memory and disk LRUs, telemetry counters, native-edge pass-through, source replacement, color-context non-invalidation, and geometry tiles served from a warm mip equal to the cold path. One API test (`test_source_mip_levels_persist_across_sessions`) drives the real endpoints: `built` → `memory` within a session, then `disk` for a second session over the same content, byte-equal bodies, exactly one cold build.

**Gate status, stated plainly.** Phase 3 item 1 is implemented and tested on the backend. Not yet done and not claimed: the frontend ROI routing of item 2 (warm Fit still loads the tier proxy whole; the store currently serves the existing `/proxy` and `/source-tile` callers), the runtime cold/warm timing and footprint recording, and the remaining Phase 3 units. No §4 text changed. Suites: focused Python trio **171** (157 + 14); full Python **1366 passed / 3 skipped**; JS **176** unchanged.

Next safe edit: Phase 3 item 2 — route ROI source requests to the mip and region the pass needs (frontend source upload path), then measure the warm-Fit gate. Do not start Phase 4.

### 15.31 Committed checkpoint — 2026-09-23 (ROI mip/region routing; Phase 3 item 2)

Committed as `3513589` — "Route magnified ROI passes to their own mip region".

**What was built.** A refinement pass that carries a viewport now fetches only the source region it will actually process, from the mip level that pass needs:

- `HDRViewportRequest.sourceFetchRegion(visible, outputWidth, outputHeight, tileSize, halo)` (frontend/viewport-request.js) is the pure geometry: pad the visible rect by the plan's 15% ROI fraction, expand by the composed halo plus one tile (a tile that merely intersects the padded region may start a whole tile outside it), clamp to the frame. A node test proves the region contains every foreground tile's halo rect across viewports, tile sizes and halos.
- The renderer (`loadProxyRegion`) asks `/source-tile` for exactly that rect at the pass's `long_edge` with `halo=0`, one row-chunk at a time, and builds a proxy whose texture covers the delivered region while `width`/`height` stay the frame's. `loadProxy` gained an optional `region` (part of the proxy key); it declines the region route when the delivered rect is ≥90% of the frame or the endpoint cannot serve the geometry, and falls back to the existing whole-frame/streamed route.
- `encodeTiledGeneration` copies from the region proxy with a region-relative origin; the plan, presentation target, parameters and frame-anchored shader coordinates are unchanged. A coverage guard refuses the pass (`roi source region does not cover its foreground tiles`) rather than reading outside the texture, and `tiledExecutionMetrics` now carries `sourceRoute` (`region`/`streamed`/`whole-frame`), `sourceRegion`, `sourceTextureBytes` and `sourceFrameBytes`.
- Both the app path (`renderTo`, with a post-admission fallback to the whole frame when a viewport request is admitted Direct) and the diagnostic path (`renderTiledTo`) use `roiRegionFor`/`roiSourceHalo`, which derive the fetch region from the retained frame before the source is requested.

**Latent bug found and fixed.** `lastPresentedFrame.geometrySignature` stored the *global helper function* of the same name (a bare identifier resolving to `app.js`'s `geometrySignature()`), and the retention comparison in `encodeTiledGeneration` compared that function to itself, so it was accidentally true. Retention now stores and compares the signature string (`options.geometrySignature || "{}"`), and the predicate is the shared `retainedTiledFrame` helper used by both the fetch decision and the pan cache. This is what made the first region runs refuse: the region was sized for a retained pass while the encoder believed nothing was retained and planned every tile.

**Evidence** (`output/performance/roi-source-transport.json`, 4096x2304 fixture, tier Full, tiled, 200% zoom, refinement mode): the ROI pass fetched route `region`, region 1603x1373, 17.6 MB uploaded against a 75.5 MB native frame (23.3%), 4 foreground tiles, retained frame, and the ROI output was byte-equal to the whole-frame pass over 118,815 compared pixels (`maxAbsDifference` 0). Warm Fit at tier 1024: route `whole-frame`, exactly 4,718,592 bytes (the 1024 mip) against 75,497,472 native (6.2%), no cold build, no generated bytes, answered by the held proxy or the backend cache. Source-cache footprints recorded in the same artifact (memory 33.7 MB / disk 33.7 MB / 6 entries / 1 GiB disk budget at that moment).

**Gate status, stated plainly.** §8.3's warm-Fit gate is satisfied and measured at the display tier: the pass reads and uploads only the display mip, and the persistent cache answers without a cold build or generated bytes. The Full-at-Fit policy is deliberately unchanged (an explicit Full selection still processes native at Fit); Phase 4 item 7 owns the selector migration, and §4.3/§4.8 make display-exact the Fit target. Item 2's ROI routing is done for the tiled route; Denoise analysis remains a whole-frame load at the analysis edge, which is item 7's scale-aware identity work. Still open for the Phase 3 exit gates: the zoom ≥100% export/reference parity extension (including masks), the seam sweeps, the runtime invalidation matrix, the 100%-after-DPR check, and the full cold/warm timing and footprint recording. Suites: JS **180** (176 + 4); focused Python trio **171**; full Python **1366 passed / 3 skipped**. `roi-parity.js` re-run after the retention fix: byte-equal, viewport requested, 2 foreground tiles.

Next safe edit: Phase 3 item 3 — scale propagation for Detail, Denoise, grain, bloom, halation, softness, masks and geometry, with cache identities that include scale and upstream inputs. Do not start Phase 4.

### 15.32 Committed checkpoint — 2026-09-23 (the processing-scale contract; Phase 3 item 3)

Committed as `c786239` — "Declare the processing-scale contract for every spatial module".

**What was built.** `frontend/graph-scale.js` is the §5.9 declaration, and the renderer consumes it rather than keeping a second copy of the arithmetic:

- `processingScaleFor(sourceSize, frame)` is the canonical `min(1, frame_long_edge / source_long_edge)` — the same `source_pixel_scale` the backend uses (`detail.py`, `sessions.py`, `render_cache.py`). It is now the single derivation for `renderTiledTo`/`renderTo` (`sourcePixelScaleFor`), the ROI halo pre-computation, and the app's `viewportRequest` diagnostic, which now declares `scale` on the request instead of leaving it at the default 1.
- `MODULE_SCALE_CONTRACT` declares, for Detail (global and local), Denoise, grain, bloom, halation, softness (image structure), masks and geometry — plus vignette — the authored unit of every radius (`frame-diagonal`, `film-plane`, `source-pixels`, `normalized`, `pointwise`), the conversion, the reach that covers it, whether it may run coarse, the cache identity it is keyed by, and its CPU fallback. `Preview.graphScaleContract()` exposes the same declaration.
- The halo arithmetic moved verbatim into `detailRadii`/`detailReach`, `spatialReachDetail`/`spatialReach`, `composedReach` and `alignReach`; `graphActivity`, `sourcePixelScaleFor` and `gpuLocalDetailActive` delegate too, so the local-detail switch is one rule for the ordered chain, the band-stack metrics and the halo. `tiledExecutionMetrics` carries `processingScale`, the number the radius conversions used. The page loads the module before the renderer, and a missing script fails loudly instead of reserving a halo of zero.

**Scale propagation, per module, as the contract and tests assert it.** Detail's sharpen radius is the one live source-pixel unit and converts by the processing scale (3 px native → 0.75 px at 0.25) while texture and clarity are fractions of the frame diagonal; local Detail uses the same conversion. Halation is film-plane: the same physical radius reaches a quarter as far in a quarter-size frame (measured 4× within 1%). Grain's pitch is film-plane (a sub-pixel pitch reduces coverage instead of growing the field). Bloom and softness are frame-diagonal; softness's film-resolution blur is film-plane. Masks are normalized, compiled backend-side at the requested long edge (GPU luma feather σ = 0.09 × amount × long_edge), and mask tiles are keyed by `long_edge`. Geometry is applied before the graph and the ROI fetch region maps through the geometry-fixed frame at the pass's scale. Denoise is declared **scale-bound**: the analysis runs at one long edge and its evidence is indexed against that frame, so a pass at another scale renders undenoised rather than wrongly until it is re-analysed — item 7 owns making the analysis edge scale-aware. Cache identities already carry the scale: the proxy identity (and therefore the denoise evidence key, the detail band key and the pan-cache plan identity) includes `long_edge`; the detail band identity includes `p[155]` plus the upstream identity; mask tiles include `long_edge`; and the pan-cache partition is only consulted while the presentation target is valid, which a size change invalidates.

**Behavior-identical move, verified.** A throwaway differential over 20 000 randomized cases (frames 16–9000 px, random film gates, radii, amounts and locals; 160 000 comparisons of `detailTileHalo`, the three composed reaches, the three activity switches and `sourcePixelScaleFor`) is exactly equal to the inline math at HEAD.

**Evidence.** `tests/graph-scale.test.js` (12 tests): contract completeness and field shape; the CPU-reference scale including the upscale clamp and a region-proxy frame; source-pixel conversion for global and local Detail; the halo covering the independently re-derived shader radii at maximum settings; the halation film-plane ratio; quarter-grid anchoring and the 64-texel / 16 / 24 / 32 caps; composition and grid rounding; denoise alignment monotonicity and idempotence; the scale and upstream inputs in the band identity; the request's declared scale; the renderer's contract being the module's. `tests/test_frontend_contract.py` gains the wiring check (script order, the five delegations, the loud missing-script failure, the module list, the shader's `SPATIAL_SCALE` mirrored, the request's `scale`, the telemetry field). The six VM harnesses that evaluate the renderer now load the contract script first, mirroring the page.

**Runtime re-recorded after the move.** `tiled-film-parity.js`: byte-exact at maximum radii (`spatial-max` halo 136, `maxDelta` 0 over 631 626 samples; halation view map halo 20; grain view map halo 0; grain identical across tile sizes 256 and 512). `roi-parity.js`: byte-equal (`maxAbsDifference` 0 over 34 034 pixels). `roi-source-transport.js`: re-recorded (region 1603×1373, upload fraction 0.2332, byte-equal over 118 815 pixels; warm Fit at 1024 whole-frame 4 718 592 bytes, no cold build, no generated bytes, 9 warm hits). Artifacts under `output/performance/`.

**One stale driver assertion observed, not fixed.** `tiled-film-parity.js` ends by asserting one submission per generation; the run reports 4 (tileSize 256) and 2 (512) — including the halo-0 vignette/grain and grain-view-map cases — because commit `13d12a3` made tiled work submit in batches of four plus the final copy. Every parity result passes; the assertion predates small-batch submission and is not item 3's. Recorded, not changed.

**Gate status, stated plainly.** Item 3 is implemented, delegated and locked at unit level; the seam gate now has a passing run at maximum radii, and the warm-Fit transport evidence is re-recorded unchanged. Still open for the Phase 3 exit gates: the zoom ≥100% export/reference parity extension including masks, geometry/mask-boundary/image-edge seam sweeps, the runtime invalidation matrix, the 100%-after-DPR check, and the full cold/warm timing and footprint recording (15.31 recorded the transport side). Suites: JS **192** (180 + 12); focused Python trio **172**; full Python **1367 passed / 3 skipped**.

Next safe edit: Phase 3 item 4 — port all active nodes to the ROI request contract. Do not start Phase 4.

### 15.33 Implementation checkpoint — 2026-09-23 (active graph on the ROI request; Phase 3 item 4)

**What changed.** The tiled renderer builds one immutable, frame-anchored `HDRViewportRequest` from the actual proxy, source size, generation, processing scale, composed graph halo and viewport. Source-region fetch, scheduler ordering and foreground tile selection now use its visible rectangle, halo and padded ROI; the fetch helper accepts the same minimum-ROI fraction. The ordered node declaration includes active Denoise, masks, Detail, spatial film, vignette and grain along with pointwise grading nodes. A viewport render through `renderTo` is admitted to Tiled even when Direct would fit, because Direct processes the whole frame. The graph still runs every active stage in the existing order on each selected tile.

**Local-mask work follows the request.** Mask batches now contain only the pending foreground tiles, including their halo rectangles. Validation and cache pinning inspect those tiles only. A warm pan answered from the accepted tile ledger requests no new masks. `tiledExecutionMetrics` records the request identity fields, active nodes and mask tile count so the runtime route can be audited.

**Verification.** The ROI source-region coverage test now derives foreground tiles from the actual request and checks three padding fractions at image edges and interior positions. The local-mask transport driver asserts that the ROI pass requests no more mask tiles than it processes; its recorded run requested four masks for four foreground tiles and kept two offscreen tiles unchanged. `roi-source-transport` remained byte-equal to the whole-frame path over 118,815 pixels with a 0.2332 native upload fraction. `roi-parity` remained byte-equal over 34,034 pixels, and `roi-pan-cache` reused the previously accepted tile on pan-back with zero processed tiles. The film parity driver now checks bounded batch submissions plus one final presentation copy, replacing its obsolete one-submission assertion; all cases including maximum spatial radius were byte-equal. Node tests: 174 passed; the four focused request/scale/scheduler files: 46 passed. The first `roi-parity` run raced another browser driver and refused an interactive render; a serial rerun passed.

**Remaining Phase 3 work.** Item 5 is the separate small whole-image pipe. Item 6 covers GPU analytic masks, item 7 scale-aware local Detail/Denoise evidence, and item 8 cold-cache progress/cancellation. Phase 3 exit gates still need the zoom >=100% export/reference parity extension including masks, geometry/mask-boundary/image-edge seam sweeps, the runtime invalidation matrix, the 100%-after-DPR check, and complete cold/warm timing and footprint evidence. Do not start Phase 4.

Next safe edit: Phase 3 item 5 — implement the small whole-image preview pipe for scopes, navigation and mask overview.

### 15.34 Implementation checkpoint — 2026-09-23 (cold source-level progress and cancellation; Phase 3 item 8)

The source mip builder now reports completed filter channels through a session-scoped progress endpoint. The WebGPU source loader polls only while a source request is active and surfaces channel progress in the existing preview status. A superseded edit cancels an in-progress resize between channels and prevents its result from entering the memory or disk cache; single-flight waiters also stop waiting when superseded. Both whole-proxy and source-tile routes pass the session revision check into the mip builder and return 409 for stale work. Native and warm cache hits check currency before returning.

Focused cache/API tests pass (72); frontend syntax and diff checks pass. The full system-Python shell lacks the bundled imagecodecs/lensfun decoders and has a NumPy quantile difference; its two frontend contract assertions were updated to the actual foreground-only mask batching and immutable viewport request. Runtime cold/warm timing and footprint evidence is still owed. Items 5–7 and the Phase 3 exit gates remain open.

### 15.35 Phase 3 completion checkpoint — 2026-09-23 (whole-image pipe, analytic masks, scale-bound Denoise, exit gates)

**Whole-image pipe (item 5).** `frontend/whole-image-preview-pipe.js` makes a separate bounded request contract for scopes (1600 px), navigation (512 px), mask overview (1600 px), coarse analysis (960 px), and the initial Fit placeholder (1600 px). The live scope and mask-overview requests and the initial Fit refresh use those caps. A navigation thumbnail now requests its own graded 512 px overview, shows the visible rectangle, and pans the image on click; the inspection browser driver confirms a 512 px image and working pan at DPR 1 and 2. The whole-image result has its own identity and does not mark the ROI presentation Ready.

**GPU masks and scale-bound evidence (items 6–7).** A simple linear-gradient leaf with identity geometry, no fan and no luma qualifier is evaluated per tile in WGSL. The CPU mask route remains for every other analytic expression and for brush masks. At 1024 px, GPU versus CPU mask rendering differed by at most one 8-bit level (6095 of 2,359,296 samples); the GPU path produced four tiles and made no CPU mask requests. Denoise no longer pins later renders to its first analysis edge: a changed scale or upstream source/geometry identity triggers analysis at the requested edge before presenting resolved pixels. The 768→1024 browser run selected distinct resolved identities and increased analysis calls from two to three. The enable action commits settings before beginning analysis, closing the edit-revision race exposed by a native ROI fetch. Detail's global/local band identities and source-pixel conversion were already locked by §15.32; item 7's live scale transition is now exercised.

**Exit gate evidence.** `roi-source-transport.js` again records a warm 1024 px Fit pass with no cold source build or generated bytes, and a native 4096 px ROI source-upload fraction of 0.2332, byte-equal to the whole-frame reference. At 100%, the 2400 px fixture processes into a 2400 px backing store; CSS width is 2400 at DPR 1 and 1200 at DPR 2, so one processed pixel maps to one device pixel. The 300% native ROI A/B is byte-equal over 52,866 visible pixels with Denoise and spatial film effects active. The expanded reference sweep includes maximum Detail radii, 90° geometry, a gradient local mask, grain, bloom, halation, softness, and Denoise; top-left, center and bottom-right are byte-equal to the whole-frame path (three 52,866-pixel regions on the 2400×1600 fixture). This is **whole-frame renderer reference parity** at zoom, alongside the separate export artifact parity recorded in §15.27; the exported file itself was not re-decoded at 300% in this checkpoint. `tiled-film-parity.js` remains byte-exact at maximum spatial radii, including halo 136, across tile sizes 256 and 512. Brush-mask ROI transport remains bounded to its four foreground tiles.

**Cache invalidation and footprint.** The test matrix spans source replacement (`test_source_replacement_swaps_identity_and_drops_the_old_memory`), decoder/color-transform version and interpretation (`test_source_mip_identity_covers_every_decode_input_and_nothing_else`), geometry (`test_geometry_tiles_served_from_a_warm_mip_match_the_cold_path`), grade edits that correctly reuse pre-adjustment mips (`test_source_mip_cold_builds_do_not_invalidate_on_grade_changes`), processing scale and upstream band identity (`graph-scale.test.js`, `render-coordinator.test.js`), and corrupt or interrupted disk entries (`test_source_mip_corruption_is_discarded_and_rebuilt`, `test_source_mip_stale_versions_and_interrupted_writes_are_swept`). The 4096×2731 float32 scene-linear source benchmark at 1024 px measured 307.118 ms cold, 0.044 ms memory-warm and 10.749 ms disk-warm; native source storage was 134,234,112 bytes, the resident level 8,392,704 bytes, and the disk entry 8,392,748 bytes. These are local-machine observations, not latency guarantees. The repeatable driver and JSON are `tests/performance/source-mip-benchmark.py` and `output/performance/source-mip-benchmark.json`.

**Verification and scope.** Node tests: 162 passed. Python: 1368 passed, 3 skipped (virtual environment); frontend contract subset after the navigation change: 101 passed. Browser drivers: native inspection at DPR 1/2, GPU gradient parity, Denoise scale identity, native ROI parity with the spatial sweep (two serial passes), source transport, tiled film parity, and tiled brush-mask transport passed. The navigation thumb's response is intentionally capped and asynchronous; failure leaves the authoring presentation alone. All Phase 3 work items and the reference interpretation of its exit gates are complete. Phase 4 adaptive coarse refinement and control replacement have not started.

### 15.36 Phase 4 implementation checkpoint — 2026-09-23 (adaptive response and selector migration)

Implementation committed as `9c8315e` — "Add adaptive display-scale preview and response preferences". The subsequent ledger/diagnostics checkpoint adds the live viewport, processing scale, source level, generation, cache and working-set readouts.

**Work items 1–3: latency and refinement.** `frontend/preview-latency-controller.js` keeps an exponentially weighted per-graph cost per visible pixel, selects one of five coarse scales against 33 ms (Responsive) or 66 ms (Balanced), and holds adjacent scale decisions inside a 0.7–1.3 target band. Precise sends the exact scale as its first visible pass. A cold Balanced graph starts exact; a cold Responsive graph starts coarse. Existing scheduler settle and coordinator cancellation remain the exact follow-up: the settled pass targets the required display scale, generation/source/geometry checks prevent stale presentation, and a failed or obsolete settle still leaves refinement owed. Coarse is an explicit accepted-presentation fact and never produces a Ready status. A direct or tiled exact pass uses the same graph; only the declared processing scale and radius conversions differ.

**Work items 4–7: control and migration.** The normal Preview menu and Settings response field expose Responsive, Balanced and Precise. The 1K/2K/4K/Full control is removed from the normal menu and retained as an Off-by-default Settings diagnostic override. Device/profile preferences use schema 3. Existing 1K maps to Responsive, 2K/4K to Balanced, Full to Precise; migration records the previous tier and shows a dismissible one-time explanation. Neither the preference nor its migration touches project/export state. The user guide now defines Coarse, Display exact, Native-region exact and the diagnostic override. Fit derives the required scale from the displayed rectangle and source geometry (including crop and quarter rotation); 100% and higher use native scale. The preview output diagnostics report response, controller decisions, legacy override, viewport, processing scale, source level, generation, cache and working bytes.

**Measured development gates.** `tests/performance/phase4-preview.js` and its committed `output/performance/phase4-preview.json` record a real Edge/WebGPU run on the generated 2400×1600 source: migrated 2K → Balanced with previous tier retained, saved Responsive preference and notice dismissal survived reload, the diagnostic override switched 4K→Off, Fit reached a display-required 800 px rather than native 2400 px, the current 256 px coarse pass said `Coarse — refining to Display exact` and was not exact, then the accepted exact pass reached 800 px. A no-coarse exact rerender produced a byte-identical canvas PNG. Rapid reversal presented only generation 8, which was the final current generation, and its pass was not coarse. Normal 100% inspection reached a 2400 px backing store and 2400 CSS pixels at DPR 1. The separate `native-inspection-dpr.js` passed at DPR 1 and 2 (the latter had 2400 backing / 1200 CSS pixels). The Phase 3 300% Denoise/Detail/mask/film/rotation spatial sweep was rerun after this change: all three 52,866-pixel regions remained byte-equal to the whole-frame renderer (`maxAbsDifference` 0). This remains a renderer reference comparison, not a re-decode of an export file at 300%.

**Controller and suites.** Node tests exercise both Balanced branches, Precise exact-only behavior, per-graph timing separation, and thirty alternating 30/36 ms samples near the Responsive target; all thirty selected the same 1000 px scale rather than alternating. Display-scale unit cases cover Fit, crop, quarter rotation and 50/100/300% zoom. The full Node suite passed (204 tests); the full Python suite passed 1368, skipped 3. The repeatable driver records its own environment-independent assertions and the captured browser result. Browser results are one development-workstation run with a synthetic source; the coarse-label scenario seeds a slow timing sample to force that path. The 33/66/150 ms starting targets have **not** been tuned or guaranteed on packaged Windows/macOS builds or multiple hardware classes. That packaged calibration and visual stability observation remain open, so Phase 4 is not marked as final product acceptance.

### 15.37 Phase 4 browser-driver maintenance — 2026-09-23

The normal tier selector removal left older standalone browser and Electron drivers querying `#preview-resolution`. Drivers that intentionally compare 1K/2K/4K/Full now set the Settings-only diagnostic override. The UI interaction, startup, focus and menu drivers now exercise the normal Responsive/Balanced/Precise control. The Full-tier browser driver also enables the explicit Exact peak scope option before requiring `peak_exact`; its prior unconditional assertion timed out with that option off, after the CPU Full render itself had succeeded. On the development server at port 8799, the startup-state, preview-response/native-zoom, and GPU/CPU Full diagnostic browser drivers passed. Electron menu and focus drivers were updated but not executed against a packaged build. This maintenance does not change the Phase 4 packaged latency or visual stability acceptance status.
