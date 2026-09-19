# Stable Exact Preview Tiers and Full-Resolution Processing Sprint

**Date:** September 19, 2026  
**Status:** Approved direction; Phases 0-4 complete  
**Owner:** HDR Finisher engineering  
**Application target:** A staged preview-pipeline release that restores Full preview without silent resolution fallback  
**Primary platforms:** Packaged Windows and macOS application shells, with and without usable WebGPU  
**Related product requirements:** [HDR Finisher PRD v1.2](HDR_Finisher_PRD_v1.2.md)  
**Related preview work:** [Interactive Preview and Scopes Performance Sprint](Interactive_Preview_and_Scopes_Performance_Sprint_PRD.md), [GPU Local Adjustments and Live Scopes Sprint](GPU_Local_Adjustments_and_Live_Scopes_Sprint_PRD.md)  
**Related technical contracts:** [Image Processing Pipeline](../technical/image-processing-pipeline.md), [Denoising v2](../technical/denoising.md)

## 1. Executive summary

This sprint restores **Full** as a preview-resolution choice while making every preview tier stable and truthful. The resolution selector will offer **1K, 2K, 4K, and Full**. Once a selected tier has produced its first valid image, interaction must retain that tier's last valid result until a current replacement is complete. The application must not silently substitute a lower-resolution proxy while a control is moving and then jump to a higher-resolution result after the control settles.

The same contract applies to all four tiers. A 4K user receives exact 4K processing throughout interaction; a Full user receives source-resolution processing throughout interaction. Users who need more speed explicitly select a lower tier.

Full remains available when WebGPU is unavailable. GPU execution may be Direct or Tiled. CPU execution may be full-frame, tiled/strip, or disk-backed. These are internal execution choices and do not change the selected processing resolution. Full may be slow on CPU, but it is not hidden or disabled solely because a machine is expected to be slow.

The previous Full attempt repeatedly failed and returned to 4K on the director's system. This sprint therefore does not expose a Direct-only Full implementation as a finished feature. Bounded source transport, tile-aware execution, measured memory admission, and a CPU-safe route are release requirements.

The sprint also formalizes new cache boundaries for Denoise and Detail. Denoise retains its correct separation between expensive analysis and live reconstruction, but moves from monolithic full-frame resources to aligned evidence tiles plus transient reconstruction. Detail moves from two retained full-frame intermediates to bounded tile-local band caches plus transient scratch. These changes preserve the existing authoring model while making selected-tier rendering sustainable at 24–42 MP and 8K.

## 2. Authoritative product decisions

### 2.1 Resolution choices

The preview-resolution menu contains:

- **1K**
- **2K**
- **4K**
- **Full**

The chosen value is the processing-resolution contract, not a target the application may quietly reduce under load.

### 2.2 Stable selected-tier behavior

After a tier has produced its first valid result:

- keep the last valid image from that same tier visible while new work runs;
- update control state immediately;
- coalesce superseded work and use latest-generation-wins admission;
- swap a complete current result atomically;
- never present a stale generation;
- never replace it with a lower-resolution interaction proxy;
- preserve zoom, pan, inspection point, comparison position, and viewport geometry.

When the user first changes tiers, the preceding tier may remain visible while the new tier is prepared, but it must be labeled truthfully. For example: **Preparing Full — showing previous 4K result**. It must not be presented as a completed Full result.

### 2.3 Four viewer states

| State | Meaning | Visible image |
|---|---|---|
| **Ready — {tier}** | The accepted image matches the current edit generation. | Current selected-tier result |
| **Updating — {tier}** | A new generation is running. | Last valid result from the same tier |
| **Preparing {tier}** | The selected tier has no accepted result yet. | Previous tier or import surface, explicitly labeled |
| **{tier} unavailable** | Direct, tiled, and permitted recovery paths failed at runtime. | Last valid presentation when available |

Progress text may appear inside Preparing or Updating without creating additional state-machine states.

### 2.4 Interaction policy

- No general **Apply** button is introduced.
- Denoise retains **Recalculate** for settings that change its expensive analysis.
- Denoise reconstruction controls remain live.
- Detail controls remain live.
- Expensive work retains the old exact-tier image and shows Updating.
- A future loupe may provide focused inspection, but it is not the only route to the real Denoise or Detail result.
- Viewport position, zoom, and qualifier bounds may prioritize tiles and control residency. They must not reduce processing quality.

### 2.5 CPU availability

All preview resolutions are available on CPU-only systems. Host-resource checks choose safer execution; they do not remove Full from the menu or automatically replace it with 4K.

CPU Full guarantees:

- source-resolution processing before display downsampling;
- background execution that does not block the UI thread;
- cancellation and latest-wins behavior;
- retained last-valid presentation;
- bounded host RAM and temporary-storage use;
- truthful progress and errors.

CPU Full is allowed to take seconds. It does not promise continuous live rendering.

## 3. Verified current implementation baseline

The following facts were verified against the September 19, 2026 worktree and are implementation constraints for this sprint.

### 3.1 Resolution and lifecycle

- The frontend is plain JavaScript, not TypeScript.
- Preview options are currently the string values `"1024"`, `"2048"`, and `"4096"`.
- Resolution helpers call `Number()` on the selected value, so a `"full"` sentinel requires explicit branching.
- `applyPreviewResolution()` currently resets the GPU session, invalidates the preview, marks active Denoise dirty, and schedules recalculation.
- Session reset currently restores the preview resolution to 1K.
- Preview resolution and GPU memory budget are not application preferences.
- CPU preview errors can clear the current image, which conflicts with retained-presentation behavior.

### 3.2 GPU residency and diagnostics

- `ensureIntermediate()` allocates four full-size `rgba16float` grading textures: Base, Film, Finish, and Local.
- Active Detail adds two full-size `rgba16float` intermediates.
- Active spatial film processing adds two quarter-width/quarter-height `rgba16float` intermediates.
- The current diagnostic calculation counts three grading intermediates even though four are allocated. It under-reports logical residency by eight bytes per pixel.
- Denoise adds decimated evidence textures, reconstruction scratch for deeper configurations, and a full-size resolved texture.
- GPU local masks use full active-preview resolution; Boolean mask graphs can retain additional full-resolution `r8unorm` node textures.

### 3.3 Transport and admission

- The GPU source path fetches the entire geometry-fixed proxy as one RGBA16F response and then uploads it to a texture.
- Values that cannot use half-float transport may require RGBA32F, doubling the source payload.
- CPU-authored spatial masks are fetched separately as full-frame byte payloads.
- Backend preview preflight currently uses a 16,384-pixel dimension cap, a 26 MP cap, and an 80-byte-per-pixel estimate above the 4K baseline.
- The backend cannot observe WebGPU device limits, frontend allocation state, or physical driver heap usage, so it cannot own GPU admission.
- True source/geometry tile extraction and tile-aware rendering do not currently exist.

### 3.4 Denoise and Detail

- Denoise Phase 2 analysis and Phase 3 UI/document integration exist in the current code.
- Denoise analysis settings create a reusable wavelet-evidence cache.
- Amount, Luminance, Color Noise, and Detail Recovery reconstruct from that cache.
- The current Denoise cache is full-tier and lane-specific; the resolved result is a full-size `rgba16float` texture.
- Authored Denoise is not yet in the full-resolution export path.
- The Denoise technical document's rollback section incorrectly describes the rolled-back prototype as the current implementation state.
- Detail currently runs separable full-frame horizontal and vertical passes whenever active.
- The final vertical Detail result packs four band responses, but both full-size intermediates remain allocated.
- Detail participates in the CPU/export adjustment path; Denoise currently does not.

## 4. Memory baseline and admission policy

### 4.1 Confirmed minimum logical residency

The table below describes one active canvas with an RGBA16F source, four grading intermediates, two Detail intermediates, spatial film intermediates, and a two-level Denoise configuration. It is a logical resource-size model, not a physical VRAM measurement.

| Resource | 24 MP | 42 MP | 8K UHD |
|---|---:|---:|---:|
| Source texture | 183.1 MiB | 320.4 MiB | 253.1 MiB |
| Four grading intermediates | 732.4 MiB | 1,281.7 MiB | 1,012.5 MiB |
| Detail intermediates | 366.2 MiB | 640.9 MiB | 506.2 MiB |
| Spatial film intermediates | 22.9 MiB | 40.1 MiB | 31.6 MiB |
| Two-level Denoise resources | 400.5 MiB | 701.0 MiB | 553.7 MiB |
| **Combined logical minimum** | **1,705.2 MiB** | **2,984.0 MiB** | **2,357.2 MiB** |

Four-level Denoise raises the combined totals to approximately 1,730.2 MiB, 3,027.9 MiB, and 2,391.8 MiB respectively. Each full-resolution `r8unorm` mask or mask-graph intermediate adds approximately one byte per pixel.

These totals exclude the canvas swapchain, comparison surfaces, scopes, buffers, transfer staging, cached alternate tiers, driver padding, and implementation overhead. The Denoise document's historic 594.9 MiB total at 4K is an instrumented logical total from the earlier implementation and must be treated as a lower bound until the four-texture diagnostic error is corrected.

### 4.2 User-controllable GPU budget

Add **Settings → Performance → Maximum GPU memory for previews**:

- Auto — default; initially a 2 GiB logical application budget
- 1 GiB
- 2 GiB
- 3 GiB
- 4 GiB
- 6 GiB
- 8 GiB
- 12 GiB
- Custom

WebGPU does not expose reliable physical VRAM capacity. The setting is therefore an application allocation budget, not detected physical memory.

The budget decides Direct versus Tiled execution and cache eviction. It never decides whether a resolution option is visible.

### 4.3 Direct admission

The frontend renderer admits Direct execution only when:

- output dimensions fit `device.limits.maxTextureDimension2D` and all other relevant device limits;
- the predicted peak including retained-presentation overlap fits the configured budget;
- planned texture formats and usages are supported;
- actual allocation succeeds.

The predicted peak includes source residency, active node resources, masks, Denoise and Detail caches, transient scratch, scopes, staging, comparison lanes, and a contingency margin.

Allocation failure retries through Tiled execution. It must not silently change preview resolution.

## 5. Target architecture

### 5.1 Ownership boundary

| Responsibility | Owner |
|---|---|
| GPU limits, logical GPU budget, allocation attempts, tile residency, GPU cache eviction | Frontend renderer |
| Source decode, source epoch, host RAM, temporary storage, geometry-aware tile production | Backend |
| CPU Direct versus tiled/strip/disk-backed selection | Backend |
| Requested tier, presented tier, generation, viewer status | Frontend application state |
| Export execution and delivery encoding | Backend, using shared processing semantics |

Backend GPU rejection based on the existing generic preview estimate is replaced by host-resource reporting and tile-production admission. Full must not fail merely because a backend estimate assumes a monolithic GPU graph.

### 5.2 Direct execution

Direct uses one full-sized texture graph when the device and configured logical budget can safely support it. Source upload may still be chunked so the browser never needs a single image-sized response buffer.

### 5.3 Tiled execution

Tiled execution processes the selected tier exactly, with:

- global output coordinates;
- inverse geometry mapping;
- module-specific halos;
- wavelet alignment;
- deterministic grain coordinates;
- bounded tile and scratch caches;
- visible-region priority;
- generation-safe scheduling;
- seam-free assembly;
- atomic replacement of all currently visible tiles.

At Fit, the whole image is visible, so all image tiles complete before replacement. At magnified zoom, visible tiles complete first and offscreen tiles can follow or be generated on demand.

No mixed-generation tile set may be visible.

### 5.4 Bounded source and mask transport

Introduce a geometry-aware tile transport contract containing:

- session/source epoch;
- lane;
- selected tier and exact output dimensions;
- geometry signature;
- core output rectangle;
- requested halo;
- pixel format;
- working space.

For Direct execution, the renderer may allocate a full source texture but fill it incrementally. For Tiled execution, only needed source tiles remain resident.

The backend must eventually extract a post-geometry output region without first constructing the complete transformed frame.

Masks follow the same bounded model:

- Brush and Gradient masks are generated or transported by region.
- Luminance masks are derived from the corresponding source tile on the GPU when possible.
- Boolean graph intermediates use tiled, global-coordinate resources.
- Feather and other spatial operations declare halos.

## 6. Cache and invalidation contract

### 6.1 Shared cache matrix

| Resource | Residency | Cache identity | Invalidated by |
|---|---|---|---|
| Decoded canonical source | Backend source cache | Source epoch and interpretation | Source replacement/redevelopment |
| Geometry-fixed source tile | Bounded backend/frontend cache | Source epoch, lane input, geometry, tier, rectangle, halo, format | Source, lane-input, geometry, tier |
| GPU mask tile | Bounded node cache | Source/mask input, geometry, mask node, rectangle, halo | Qualifying source, mask shape/settings, geometry |
| Denoise evidence tile | Persistent within budget | Denoise input identity, algorithm, analysis settings, tier, aligned tile, level | Source/input, geometry, analysis settings, tier |
| Denoise resolved tile | Visible/warm only | Evidence identity plus live control signature | Live controls or evidence identity |
| Detail packed-band tile | Visible/warm only | Detail input identity, tier, tile, required radii | Upstream input, tier, relevant radius |
| Detail horizontal scratch | Transient | Current dispatch only | Every dispatch |
| Spatial film scratch | Transient/bounded | Node input and current tile | Upstream node/settings |
| Accepted presentation | Retained independently | Lane, tier, edit generation, geometry | Replaced only by complete accepted generation |
| Scope result | Small bounded cache | Accepted presentation identity and scope settings | Accepted generation or scope settings |

Caches use render-node input identity instead of the broad document revision wherever possible. A downstream edit must not invalidate an upstream cache.

Cross-lane cache sharing is permitted only when node-input identities are exactly equal. HDR and SDR must not share resources merely because they came from the same imported file.

### 6.2 Denoise cache strategy

The current conceptual split remains authoritative:

#### Analysis settings

- preset/method;
- wavelet level count;
- threshold;
- scene-linear luminance sigma;
- scene-linear chroma sigma.

These settings generate wavelet evidence and retain the explicit **Recalculate** workflow.

#### Live reconstruction controls

- Amount;
- Luminance;
- Color Noise;
- Detail Recovery.

These reconstruct from evidence and do not rerun analysis.

For selected-tier tiled execution:

- align evidence tiles to `2^levels` boundaries;
- retain evidence by level within the GPU budget;
- keep reconstruction scratch transient;
- retain resolved output only for visible and warm tiles;
- keep the old accepted presentation visible during reconstruction;
- reconstruct newly visible tiles from evidence during zoom or pan;
- use the same evidence and reconstruction semantics for GPU preview, CPU reference, and export.

Changing live controls invalidates only resolved tiles. Changing analysis settings invalidates evidence and requires Recalculate. Downstream Exposure, grading, Detail, Film Look, scopes, and presentation changes do not invalidate Denoise evidence.

### 6.3 Denoise controls and presets

Do not reduce Denoise to preset-only operation during this sprint. DxO's small set of processing modes still exposes sliders through progressive disclosure, while darktable combines automatic and manual control. The architecture change does not by itself justify deleting controls or changing stored results.

Keep the existing controls and document schema during the cache migration. After corpus tuning, evaluate the following presentation:

- always visible: **Strength** and **Detail Recovery**;
- Advanced: **Luminance** and **Color Noise**;
- visible method/preset selector;
- Custom analysis settings behind Custom, with Recalculate.

Amount currently acts as a master multiplier over luminance and chroma reconstruction. Its apparent overlap with Luminance must be evaluated against the corpus before changing labels, defaults, math, or schema.

Photo Fine, Photo Mixed, Render Fine, and Render Coarse describe noise structures rather than ascending quality. Their names and number remain provisional until corpus acceptance.

### 6.4 Detail cache strategy

Keep the current Texture, Clarity, and Sharpen controls. They represent distinct operations and do not need to become presets.

For each selected-tier tile:

1. Acquire the exact input tile plus the maximum required Detail halo.
2. Generate horizontal blur into transient scratch.
3. Generate the final packed vertical/band result.
4. Retain only the packed result for visible or warm tiles.
5. Composite live amount and threshold changes from the packed bands.

The first implementation may keep all four current band responses in one RGBA16F tile. This halves retained Detail residency relative to the current two full-frame intermediates. Finer per-band caches are added only if measurements justify them.

Invalidation rules:

| Change | Required work |
|---|---|
| Texture amount | Composite only |
| Clarity amount | Composite only |
| Sharpen amount | Composite only |
| Sharpen threshold | Composite only |
| Clarity radius | Regenerate packed bands for affected tiles |
| Sharpen radius | Regenerate packed bands for affected tiles |
| Upstream source/grade | Invalidate affected band tiles |
| Preview tier | Use a distinct tier identity |

Local Detail is sequential. Its cache key includes the preceding local-stack identity. Initially retain visible tiles only for the active local operation and invalidate downstream local Detail nodes when an earlier local changes. Do not retain a full-source Detail cache for every local layer.

## 7. Module execution contract

| Module family | Selected-tier behavior |
|---|---|
| Geometry, crop, rotation, perspective | Establish output coordinates and inverse-map source tiles |
| Exposure, white balance, curves, color, HDR/SDR grading | Pointwise exact tile passes; no halo |
| Local masks and qualifiers | Global coordinates; explicit qualification and feather halos |
| Texture, clarity, sharpening | Tile-local Detail bands with radius-derived halos |
| Denoise | Aligned multilevel evidence tiles and shared reconstruction semantics |
| Vignette | Full-image normalized coordinates |
| Grain | Deterministic seed and absolute image coordinates; no tile restarts |
| Halation, bloom, softness | Tile-aware multiscale passes with declared halos |
| Scopes | Accumulate only from an accepted selected-tier generation |
| Mask overlays | Same tile coordinates and generation as the image below |
| HDR/SDR comparison and A/B | Explicit matching tier and generation identities |
| Proof and export | Reuse the same processing order and tile-capable kernels |

## 8. Resolution representation and persistence

Use an explicit JavaScript contract:

```js
/** @typedef {"1024"|"2048"|"4096"|"full"} PreviewResolution */
```

Add runtime validation and branch before every numeric conversion. The `"full"` sentinel must never reach `Number()` or a numeric `long_edge` query.

Track separately:

- requested preview tier;
- presented preview tier;
- presented edit generation;
- execution mode: Direct GPU, Tiled GPU, Direct CPU, or Tiled CPU;
- preparation/update progress;
- retained-presentation identity.

Persist preview resolution and GPU-memory preference per device through application preferences. Opening a source, replacing a session, or restoring a project does not reset the user's preview tier. Resetting application preferences may restore 1K and Auto.

Changing tiers must not reset the GPU session or clear the current preview. Old-tier resources are retired only after the new tier is accepted and only when the budget requires eviction.

## 9. Denoise documentation and export parity

Update the Denoise technical contract during the Denoise phase:

- preserve the August 25 rollback as historical evidence about the failed prototype;
- state that the prototype was later replaced by the current Phase 2/3 implementation;
- remove the current-tense claim that no authored-image preview Denoise stage exists;
- close the Phase 2 memory stop gate only after the new budget is implemented and measured;
- keep Phase 4 corpus tuning as a product-acceptance gate;
- implement Phase 5 Full/export parity through the shared tile-capable executor.

Full infrastructure may be implemented while corpus tuning proceeds, but **Full with Denoise cannot be described as export-exact until authored Denoise participates in full-resolution export and passes corpus, seam, HDR-range, CPU/GPU, and preview/export parity gates.**

## 10. Staged delivery plan

Each phase must end in an independently reviewable commit or explicitly recorded uncommitted checkpoint. Do not begin a dependent phase until its exit gate is recorded in Section 12.

### Phase 0 — Freeze contracts and correct instrumentation

**Goal:** Establish trustworthy measurements and state contracts before adding Full.

Work:

- Add the semantic `PreviewResolution` convention and runtime normalization tests.
- Inventory every numeric preview-resolution coercion.
- Correct the four-versus-three grading-texture diagnostic.
- Separate planned, resident, transient, cached, and peak logical bytes in diagnostics.
- Record masks, comparison lanes, scope pools, Denoise, Detail, staging, and retained-presentation overlap.
- Establish named 1K/2K/4K baselines plus static 24 MP, 42 MP, and 8K memory models.
- Add generation/presentation diagnostics needed by later phases.

Exit gate:

- Diagnostic totals agree with allocations in deterministic tests.
- Existing 1K/2K/4K behavior and exports remain unchanged.
- Baseline evidence is saved with hardware and application metadata.

Handoff evidence:

- implementation commit/checkpoint;
- allocation inventory;
- baseline result paths;
- unresolved discrepancies.

### Phase 1 — Stable-tier lifecycle for 1K, 2K, and 4K

**Goal:** Implement the final interaction contract before introducing Full.

Work:

- Add requested-tier versus presented-tier state.
- Implement Ready, Updating, Preparing, and Unavailable.
- Refactor resolution switching so it does not reset the renderer or clear the viewport.
- Retain the last accepted presentation during GPU and CPU work.
- Remove interaction-time lower-resolution substitution from 4K and any equivalent tier downgrade.
- Make image, overlay, comparison, and scope acceptance generation-safe.
- Preserve zoom, scroll, comparison, and inspection coordinates across updates.
- Persist the selected tier in application preferences.

Exit gate:

- 1K, 2K, and 4K never change processing resolution during a gesture.
- Rapid reversal presents no stale image, overlay, or scope.
- CPU errors retain the previous image.
- Tier changes are atomic and do not reset viewport geometry.

Handoff evidence:

- state-transition tests;
- rapid-input browser trace;
- CPU fallback trace;
- preference round-trip tests.

### Phase 2 — Frontend GPU planner and configurable budget

**Goal:** Replace fixed backend GPU assumptions with a measured renderer-owned plan.

Work:

- Add the GPU-memory preference and schema migration.
- Build a render-plan inventory for every active node and cache.
- Include retained-frame overlap and transient peak in admission.
- Read relevant WebGPU device limits.
- Implement allocation backoff from Direct to Tiled-ready mode.
- Change backend preflight to report host constraints without deciding GPU viability.
- Keep all resolution choices visible in Auto, GPU, and CPU rendering modes.

Exit gate:

- Planner decisions are deterministic for recorded resource graphs.
- No heuristic memory estimate disables Full.
- Allocation failure is recoverable and retains the current presentation.
- Denoise Phase 2 has an explicit enforceable logical byte budget.

Handoff evidence:

- plan snapshots for 24 MP, 42 MP, and 8K;
- preference/UI evidence;
- allocation-failure recovery test;
- backend/frontend responsibility note.

### Phase 3 — Geometry-aware bounded transport

**Goal:** Remove image-sized Full source and mask responses.

Work:

- Define source-tile and mask-tile API contracts.
- Bind requests to source epoch, geometry, lane input, tier, rectangle, and halo.
- Implement bounded RGBA16F transport with RGBA32F fallback.
- Implement post-geometry region extraction without full transformed-frame materialization.
- Stream Direct source textures in bounded chunks.
- Add request cancellation, single-flight reuse, and stale-source rejection.
- Record time-to-first requested tile and transferred bytes.

Exit gate:

- A 42 MP source can begin Full preparation without an image-sized browser response buffer.
- Source and mask tile assembly matches current full-frame proxy/mask output within approved tolerance.
- Geometry seams and edge padding pass for crop, rotation, perspective, and source boundaries.

Handoff evidence:

- API contract and fixtures;
- transfer-size measurements;
- geometry parity results;
- cancellation/stale-generation results.

### Phase 4 — Tile scheduler and pointwise render graph

**Goal:** Establish exact Tiled execution and expose Full only behind an engineering flag.

Work:

- Implement globally anchored tile identity, LRU residency, visible-region priority, and bounded scratch.
- Implement halo metadata even for nodes that currently require zero halo.
- Port geometry and pointwise global grading nodes.
- Implement atomic visible-region assembly and no-mixed-generation admission.
- Implement Direct/Tiled selection without changing tier.
- Add CPU tiled/strip execution foundation and cancellation.
- Add engineering-only Full selection for controlled validation.

Exit gate:

- Direct and Tiled pointwise results meet parity thresholds.
- Fit and zoomed views never show a mixed generation.
- 24 MP, 42 MP, and 8K jobs remain within configured budgets.
- CPU Full executes through a bounded path on the reference CPU-only configuration.

Handoff evidence:

- Direct/Tiled comparison corpus;
- scheduler traces;
- peak residency report;
- CPU cancellation and bounded-memory results.

### Phase 5 — Masks, locals, and Detail cache

**Goal:** Make the primary neighborhood and local-authoring tools tile-safe.

Work:

- Port Brush, Gradient, Luma, Path, Boolean mask graphs, feathering, overlays, and local grading.
- Preserve existing Brush/Gradient interaction invariants from the local-adjustments sprint.
- Add tile/global-coordinate mask parity and halo tests.
- Replace full-frame Detail intermediates with packed Detail-band tile caches and transient horizontal scratch.
- Reuse packed bands for amount and threshold changes.
- Regenerate bands for radius or upstream-input changes.
- Implement active-local cache identity and downstream local invalidation.

Exit gate:

- Mask and local results are seam-free and remain within existing CPU/GPU parity limits.
- Detail amount/threshold drags perform no band analysis when radii and input are unchanged.
- Detail peak residency remains bounded at 24 MP, 42 MP, and 8K.
- Global and local Detail match the CPU reference across tile boundaries.

Handoff evidence:

- mask/local regression results;
- Detail cache hit/miss trace;
- maximum-radius seam results;
- local-stack invalidation trace.

### Phase 6 — Tiled Denoise evidence and reconstruction

**Goal:** Preserve live Denoise controls without monolithic Full-resident resources.

Work:

- Implement `2^levels`-aligned evidence tiles.
- Port one- through four-level analysis and reconstruction.
- Separate persistent evidence, transient scratch, and visible resolved tiles.
- Keep Recalculate for analysis changes and live reconstruction for Amount/Luminance/Color/Detail Recovery.
- Add zoom/pan reconstruction from cached evidence.
- Add CPU reference/tiled execution with the same cache identity.
- Correct the Denoise technical document's current-state and rollback sections.
- Close the explicit memory-budget stop gate when measurements pass.

Exit gate:

- Tile seams, wavelet alignment, odd dimensions, and image edges pass.
- Live-control changes issue no analysis dispatch when evidence is valid.
- Analysis changes cannot replace the previous valid Denoise result until complete.
- Two- and four-level 24 MP, 42 MP, and 8K memory traces remain within budget.
- Existing preview-tier Denoise correctness and timing gates do not regress without a documented exception.

Handoff evidence:

- evidence-cache diagnostics;
- reconstruction parity corpus;
- memory traces;
- updated Denoise contract;
- remaining corpus-tuning issues.

### Phase 7 — Spatial film effects, scopes, comparison, and proofing

**Goal:** Complete tile coverage across the remaining preview modules.

Work:

- Port halation, bloom, softness, spatial film response, and deterministic grain.
- Define exact halos or multiscale tile strategies for each effect.
- Derive scopes only from accepted selected-tier generations.
- Support tile-wise scope accumulation without exposing partial generations.
- Make HDR/SDR comparison and A/B identify tier and generation explicitly.
- Preserve proof behavior and route unsupported operations through exact CPU processing.

Exit gate:

- Film effects are seam-free at maximum supported radii.
- Grain is identical across tile order, pan, and Direct/Tiled modes.
- Scopes describe the displayed generation and never update from discarded work.
- Comparison never presents unlike tiers as an exact comparison without disclosure.

Handoff evidence:

- spatial seam pack;
- deterministic grain tests;
- scope-generation trace;
- comparison/proof regression results.

### Phase 8 — Export parity and Denoise corpus acceptance

**Goal:** Make Full a credible final-output inspection mode.

Work:

- Add authored Denoise to the full-resolution export graph.
- Reuse the same Denoise analysis/reconstruction semantics in preview and export.
- Reuse tile-capable Detail and spatial-effect kernels/order where applicable.
- Tune or reject Denoise presets against the approved photo/render corpus.
- Evaluate progressive disclosure for Strength, Detail Recovery, Luminance, and Color Noise without changing results silently.
- Validate preview/export operation order, HDR range, negative values, masks, and edges.

Exit gate:

- Full preview and export meet numerical and visual parity thresholds.
- Denoise presets and defaults pass the corpus or are revised with explicit migration.
- Full with Denoise may be labeled export-exact.
- Existing export formats and proof routes do not regress.

Handoff evidence:

- corpus manifest and decisions;
- preview/export parity report;
- export performance and memory report;
- any approved UI/schema migration.

### Phase 9 — Public Full release and endurance hardening

**Goal:** Remove the engineering gate and ship Full as a durable option.

Work:

- Run packaged-app testing on discrete GPU, integrated/unified GPU, CPU-only, and device-loss configurations.
- Exercise Direct and Tiled rendering across repeated edits, tier changes, source changes, HDR/SDR switching, comparison, overlays, undo/redo, proof, and export.
- Validate physical HDR and SDR display behavior.
- Verify application-preference migration and recovery.
- Publish final performance, memory, parity, and known-limit evidence.
- Update user-facing help for preview tiers, GPU budget, CPU expectations, and status meanings.

Exit gate:

- Full is available and recoverable on all supported configurations.
- No tested failure silently returns to 4K.
- Direct and Tiled paths pass endurance and device-loss testing.
- The complete deterministic suite and packaged browser suites pass, apart from explicitly documented unrelated prerequisites.
- Release documentation identifies remaining limitations without weakening the selected-tier contract.

Handoff evidence:

- final environment matrix;
- endurance report;
- physical display sign-off;
- release notes and known limitations.

## 11. Global acceptance gates

### 11.1 Responsiveness and presentation

- UI input handling target: no more than 16.7 ms p95.
- Updating or Preparing feedback appears within 100 ms.
- 1K/2K cached and pointwise operations target no more than 16.7 ms p95 on named reference hardware.
- 4K cached and pointwise operations target no more than 33 ms p95.
- Expensive 4K work may remain in Updating but may not lower its processing resolution.
- Full has no universal completion-time promise; it must remain cancellable, visibly progressing, memory-bounded, and nonblocking.
- Stale image, tile, overlay, or scope presentation count is zero.

### 11.2 Correctness

- Direct versus Tiled parity passes approved numerical and visual tolerances.
- GPU versus CPU parity passes for supported nodes.
- Full preview versus export parity passes before export-exact labeling.
- Tile seams are tested at geometry, source, mask, Detail, Denoise, bloom, halation, and local-adjustment boundaries.
- Negative values, HDR headroom, neutral axes, saturated highlights, and deterministic grain are preserved.
- Fit view and magnified pan/zoom are both covered.

### 11.3 Resource behavior

- Measured logical residency stays within the configured GPU budget.
- Host RAM and temporary-storage use stay within the backend plan.
- Allocation failure changes execution strategy rather than resolution.
- Cache eviction cannot destroy resources referenced by submitted GPU work.
- Source replacement and new edit generations cannot repopulate stale caches.

## 12. Phase status and handoff ledger

Update this table at every phase boundary or whenever work stops unexpectedly. Link durable evidence stored in the repository; use precise local paths for intentionally ignored benchmark output.

| Phase | Status | Commit/checkpoint | Exit gate | Evidence and next action |
|---|---|---|---|---|
| 0 — Contracts and instrumentation | Complete | `ba58d6d` on `main` (parent `83bca70`) | Closed | All three gate conditions met. Evidence: [`phase-0-exit-gate-evidence-2026-09-19.md`](../technical/phase-0-exit-gate-evidence-2026-09-19.md), [`phase-0-gpu-logical-memory-baselines-2026-09-19.md`](../technical/phase-0-gpu-logical-memory-baselines-2026-09-19.md), [`phase-0-preview-resolution-boundary-inventory-2026-09-19.md`](../technical/phase-0-preview-resolution-boundary-inventory-2026-09-19.md). Six discrepancies carried forward, listed in the evidence document. |
| 1 — Stable existing tiers | Complete | `903bdef` on `main` | Closed | All five gate conditions met on the CPU route. Evidence: [`phase-1-stable-tier-lifecycle-evidence-2026-09-19.md`](../technical/phase-1-stable-tier-lifecycle-evidence-2026-09-19.md). GPU timing measurement and Phase 7 scope/comparison tightening carried forward. |
| 2 — GPU planner and budget | Complete | `69ca21e` on `main` | Closed | All four gate conditions met. Evidence: [`phase-2-gpu-planner-evidence-2026-09-19.md`](../technical/phase-2-gpu-planner-evidence-2026-09-19.md). A `tiled` decision currently means "Direct was not admitted"; Phase 4 builds the scheduler that acts on it. |
| 3 — Bounded transport | Complete | `4ac3aba` on `main` | Closed | All four gate conditions met. Evidence: [`phase-3-bounded-transport-evidence-2026-09-19.md`](../technical/phase-3-bounded-transport-evidence-2026-09-19.md). Source transport is bounded; mask transport is Phase 5. The Phases 0-2 "environment defect" is retracted there. |
| 4 — Tile scheduler and pointwise graph | Complete | `55bb3e6` on `main` (follow-ups `8081d42`, `a552aed`, `de6608e`, `7f3e857`; earlier checkpoints `ce67149`, `e0ae5cc`, `ace4f43`) | Closed | **All four gate conditions and all four ordered follow-ups met.** Gates 1-3 (Direct/Tiled parity byte-exact, one submission per generation, measured constant 8.4 MB tiled working set): [`phase-4-tiled-execution-evidence-2026-09-19.md`](../technical/phase-4-tiled-execution-evidence-2026-09-19.md). Gate 4 (CPU Full through a bounded path): [`phase-4-cpu-bounded-full-evidence-2026-09-19.md`](../technical/phase-4-cpu-bounded-full-evidence-2026-09-19.md) — 42.4 MP at Full, byte-exact, peak host RAM 4,083 MB to 496 MB, cancellation in 0.19 s of a 14.4 s job. Tiled admission and truthful CPU scope fallback: [`phase-4-tiled-admission-scope-evidence-2026-09-19.md`](../technical/phase-4-tiled-admission-scope-evidence-2026-09-19.md). Engineering Full and native 42.4 MP parity: [`phase-4-full-selection-native-parity-evidence-2026-09-19.md`](../technical/phase-4-full-selection-native-parity-evidence-2026-09-19.md). |
| 5 — Masks, locals, Detail | Complete | `e26c5ba` on `main` (with Phase 6; base `24dc9dc`) | Closed | **All four gate conditions met.** Evidence: [`phase-5-masks-locals-detail-evidence-2026-09-19.md`](../technical/phase-5-masks-locals-detail-evidence-2026-09-19.md). Gate 1: Direct/Tiled parity byte-exact (maxDelta 0, 0 differing pixels) over a global-Detail + Brush + Path local stack at tile sizes 256 and 512, and again at maximum Detail radii (halo 73). Gate 2: amount/threshold drags run zero band analysis; a global amount drag reuses global bands and rebuilds only the downstream local ones. Gate 3: **measured** at 24 MP, 42 MP and 8K — peak residency 964.7-965.1 MB, a 0.4 MB spread, inside a 1 GiB budget. Gate 4: the seam tiling introduces against the CPU reference is 0.0000 at both tile sizes, measured differentially against a Direct control. Three defects found and fixed along the way: the diagnostics did not count the Phase 5 caches, the cache bounds ignored non-cache residency, and the post-submit trim was a race. `path-mask-interaction` (carried-forward item 9) was a test defect and is fixed. |
| 6 — Denoise | Complete | `e26c5ba` on `main` (with Phase 5; base `24dc9dc`) | Closed | **All five gate conditions met.** Evidence: [`phase-6-tiled-denoise-evidence-2026-09-20.md`](../technical/phase-6-tiled-denoise-evidence-2026-09-20.md). Gate 1: tiled analysis and reconstruction are **bit-identical** to the whole-image routines — a Haar transform over non-overlapping 2x2 blocks needs no halo, only a `2**levels`-aligned origin. 44 CPU cases across levels 1-4, odd dimensions and partial edges; 32 GPU configurations with zero differing samples, including odd 1023x575 proxies. Gate 2: four live-control drags issue **0** analysis dispatches, enforced statically as well. Gate 3: a superseded analysis leaves the previous selector, cache identity and resolved texture untouched. Gate 4: six measured traces (2 and 4 levels at 24 MP, 42 MP and 8K) within the shipped 2 GiB budget, with analysis scratch **2.6-2.8 MB at every size** against ~106 MB whole-image. Gate 5: `denoise-selector-seam` and the rest of the suite unchanged. Also: the Denoise contract's sections 5.1, 6, 7 and 9 are corrected and its Phase 2 memory stop gate is closed; the cache identity is pinned across CPU and GPU by a shared fixture; and a chunk-size dependence in the CPU reference (`np.tensordot` via BLAS) was found and fixed. Remaining: the resolved proxy is still whole-frame. |
| 7 — Spatial film, scopes, comparison | Not started | — | Open | Depends on tile scheduler. |
| 8 — Export parity and corpus | Not started | — | Open | Depends on tile-capable modules and Denoise. |
| 9 — Public release and hardening | Not started | — | Open | Depends on every earlier release gate. |

### Current handoff checkpoint

**Last updated:** September 20, 2026
**Last completed phase:** Phase 6 — tiled Denoise evidence and reconstruction. **All five exit gates closed.**
**Active phase:** none. Phase 7 (spatial film effects, scopes, comparison, proofing) is the next safe implementation phase.

**Branch and base:** `main`. Phases 5 and 6 landed together as **`e26c5ba`**, on base `24dc9dc`. They share `webgpu-preview.js`, so splitting them into two commits would have meant splitting one file's hunks and risking a commit that did not build; one commit with both phases described was the honest option. The files it touches:

Phase 5 — masks, locals and Detail:

- `codebase/backend/hdr_finisher/main.py` — the bounded `local-mask-tile` endpoint;
- `codebase/frontend/webgpu-preview.js` — `PARAM_COUNT` 162 to 166, haloed tiled execution, the packed Detail band cache, mask tiles, the sequential local stack, the corrected memory ledger and free-budget cache sizing;
- `codebase/tests/tiled-direct-parity.js`, `tiled-cpu-detail-parity.js` (new), `performance/detail-cache-residency.js` (new), `path-mask-interaction.js`, `render-plan-admission.test.js`, `test_api.py`, `test_frontend_contract.py`, `webgpu-allocation-agreement.test.js`.

Phase 6 — tiled Denoise:

- `codebase/backend/hdr_finisher/denoise_tiles.py` (**new**) — aligned tiles, tiled analysis and reconstruction, the shared cache identity;
- `codebase/backend/hdr_finisher/denoise_reference.py` — `_rgb_to_components` made chunk-independent;
- `codebase/frontend/webgpu-preview.js` — rect-aware denoise shaders, tiled analysis with one reusable scratch chain, per-tile evidence, region reconstruction, denoise counters;
- `codebase/tests/test_denoise_tiles.py` (**new**), `denoise-tiled-parity.js` (**new**), `denoise-cache-identity.test.js` (**new**), `performance/denoise-memory-trace.js` (**new**), `fixtures/denoise-cache-identity.json` (**new**);
- `docs/technical/denoising.md` — sections 5.1, 6, 7 and 9 corrected, Phase 2 memory stop gate closed.

**Commands used:**

- `codebase/.venv/Scripts/python.exe -m pytest -q`, **run from `codebase/`** — running it from the repository root collects `codebase/output/libultrahdr-build/.../googletest` and fails at collection with 8 errors. Result: `1254 passed, 3 skipped`.
- `node --test tests/*.test.js` from `codebase/`: `tests 77 / pass 77 / fail 0`.
- With the dev server running, from `codebase/`:
  - `node tests/tiled-direct-parity.js --url http://127.0.0.1:8000`
  - `node tests/tiled-cpu-detail-parity.js --url http://127.0.0.1:8000`
  - `node tests/denoise-tiled-parity.js --url http://127.0.0.1:8000`
  - `node tests/performance/detail-cache-residency.js --url http://127.0.0.1:8000 --inputs <24MP>,<42MP>,<8K>`
  - `node tests/performance/denoise-memory-trace.js --url http://127.0.0.1:8000 --inputs <24MP>,<42MP>,<8K>`
- 20 browser suites via `npm run test:<name>`: 20 / 20 pass.

**Generated inputs for the memory gates.** The 24 MP and 8K sources are synthetic and **ignored by Git**, at `codebase/output/residency-media/residency-24mp-6000x4000.tiff` and `residency-8k-7680x4320.tiff`. Regenerate with `build_hdr_test_pattern(width, height)` from `backend/hdr_finisher/test_pattern.py`. The 42 MP source is the committed `codebase/local-test-media/inputs/Affinity_DSC06898_DisplayP3_Linear_32f.exr` (7968 x 5320).

**Active failure or unresolved decision:** none. Follow-ups are recorded in each phase's evidence document; none block Phase 7.

**Next safe edit:** Phase 7, spatial film effects, scopes, comparison and proofing. The remaining Phase 6 item — making the resolved denoise proxy per-tile — is a render-path change and can be taken with Phase 7 or after it.

**Repository note:** the git repository root is `ai/`, not the enclosing `HDR Finisher Tool/` directory, which has a `.git` containing only `info/` and is not a repository.

**Server:** a uvicorn dev server was started on `127.0.0.1:8000` from `.claude/launch.json` for the browser suites and stopped afterwards. No app or server process is intentionally left running.

## Environment: use the project venv

**`codebase/.venv` is the project environment — Python 3.12.10 with every declared dependency installed, including `imagecodecs`, `rawpy`, and `lensfunpy`.** `desktop/lib/runtime.js` resolves exactly that interpreter for the dev Electron shell. Run the suite as:

```
codebase/.venv/Scripts/python.exe -m pytest -q
```

Phases 0-2 recorded an "environment defect" claiming a missing Python 3.12 environment and 23 prerequisite failures. **That is retracted.** Those runs used the global `python` (3.10.10) and never checked for the venv. In the correct interpreter the suite is fully green and always was. The retraction is recorded at the top of each of the three earlier evidence documents and in the Phase 3 evidence. The `run_app.py` guard requiring Python 3.12 is correct and needs no workaround; the Electron shell and `npm start` work as shipped.

## Completed work by phase

**Phase 0:** semantic `PreviewResolution` contract with an explicit `"full"` sentinel; preview-tier and GPU-budget preference schema; corrected four-versus-three grading residency; categorized planned/resident/transient/cached/peak diagnostics with static 24 MP/42 MP/8K models; device-limit capture; coercion and allocation inventories; and `webgpu-allocation-agreement.test.js`, which proves the diagnostics equal the renderer's own allocation calls through a recording `GPUDevice` stub.

**Phase 1:** `deriveViewerState()` producing Ready/Updating/Preparing/Unavailable from a snapshot; truthful presentation identity (`requestedTier`, `exact`, a `tier` that is `null` for a placeholder, `schedulerTier`); removal of interaction-time resolution downgrade, with the bounded proxy surviving only as `bootstrapProxyLongEdge()`; `applyPreviewResolution()` no longer resetting the GPU session; both CPU routes retaining the last valid presentation through `markPreviewUnavailable()`; generation- and geometry-safe overlay acceptance; Updating reported on the generation bump.

**Phase 2:** `buildRenderPlan()` enumerating every resource with an explicit lifetime; `planRender()` merging live renderer state; the `maximumGpuMemoryGiB` preference reaching the renderer; a two-valued `direct`/`tiled` admission decision that cannot express refusing a resolution; an allocation guard in `ensureIntermediate` that backs off to Tiled and keeps the previous presentation; and a backend preflight that reports host constraints instead of deciding GPU viability.

**Phase 3:**

- `apply_geometry_region(image, geometry, rect)` extracts one post-geometry output rectangle. `geometry_resample_stage()` names the route: `index` (quarter turns, flips, crop) is pure slicing over numpy views with no full-frame allocation; `perspective` composes the projective matrix with a translation so Pillow renders only the requested window; `roll` still materializes, because `Image.rotate(expand=True)` owns expansion and safe-inset geometry this module does not yet reproduce for a window.
- `GET /api/session/{id}/source-tile/{kind}` carries source epoch, lane, tier, geometry signature, core rectangle, halo, and pixel format, and answers with the delivered and core rectangles, the full output size, the resample stage, and the identity headers. It has **no `long_edge` ceiling**, because the response no longer scales with the tier. Stale epoch, geometry, or revision is answered 409 rather than with pixels from another state.
- `RenderCache.geometry_source_tile()` refuses with `TileUnavailableError` in the one case a per-tile result would not reproduce the whole-frame one, so a parity-breaking tile can never be served silently.
- `loadProxyStreamed()` allocates one destination texture and fills it from full-width row strips bounded by `maxSourceChunkBytes` (16 MiB), keeping each chunk's row pitch identical to the whole-frame case. `loadProxy()` takes this route when the whole frame would exceed the budget and falls back when the backend declines. `sourceTransportMetrics` records route, chunk count, transferred bytes, largest response buffer, and time-to-first-tile.
- The planner's `upload-staging` entry, a placeholder since Phase 2, is now populated with the chunk budget.

**Phase 4:**

- `tile-scheduler.js` owns global tile identity, declared halos, visible-region priority, bounded LRU residency and no-mixed-generation admission. `buildTiledPlan()` brings 24 MP, 42 MP and 8K inside the Auto budget and rescues a graph Direct cannot fit.
- `renderTiledTo()` renders the selected tier tile by tile in **one command buffer and one submission**, so the canvas presents the complete assembly or nothing. Direct/Tiled parity is **byte-exact** (maxDelta 0) at four configurations. Measured tiled working set is a **constant 8.4 MB** across 1K/2K/4K while Direct grows to 478 MB.
- `tiledExecutionRefusals()` names every node that would make a tile disagree with the whole image, and returns it to the caller rather than falling back silently.
- `cpu_strips.py` is the CPU half: `render_in_strips()` produces the same frame `apply_adjustments` does from a working set that follows a byte budget rather than the image, extracting post-geometry strips through the Phase 3 `apply_geometry_region`, and stopping between strips when superseded. `strip_execution_refusals()` mirrors the GPU refusal table.
- The three whole-frame reductions a pointwise graph still needs — the HDR and SDR Peak Fit anchors and the HDR delivery-ceiling branch — are measured once in bounded reduction passes and injected through `HighlightAnchor`, which is what makes the bounded result byte-identical rather than merely close. The robust 0.9999-quantile measurement is reproduced exactly from a retained top-*k*, not approximated.
- `PreviewRequest.execution` is the bounded CPU entry: `"whole"` is the shipped public route, while engineering Full sets `"strips"`; an unsupported graph is answered 409 with the refusal list rather than silently running whole-frame.

**Phase 5:**

- The parameter block carries the full output extent (164/165) and the valid tile extent (162/163) alongside Phase 4's tile origin, raising `PARAM_COUNT` to **166**. Detail derives its radii from the *image* diagonal rather than the bound texture's, which is what makes a tile's Detail agree with Direct's; `validTileDimensions()` clamps sampling to the part of the tile texture that holds real pixels. Direct leaves all six at zero and is unchanged.
- The band shaders no longer branch on amount. A cached band cannot depend on the amounts that consume it, or its key would be lying.
- `GET /api/session/{id}/local-mask-tile/{local_id}` serves one globally anchored, haloed mask rectangle. **Mask compilation stays whole-image and authoritative** — feather peak normalization and Boolean graphs cannot be made to agree at a tile edge if each tile compiles its own mask — so only transport is bounded, never semantics.
- `detailBandIdentity()` excludes texture amount, clarity amount, sharpen amount and sharpen threshold, and includes every radius and every upstream input. A local band's input identity accumulates the global parameters and each preceding local's mask, grade and opacity, so an earlier local invalidates the bands of every local below it.
- `detailBandTile()` counts hits and misses **separately for global and local scope**. A global amount drag must reuse global bands and rebuild local ones; a single combined counter cannot tell that from a cache that does not work.
- `trimDetailBandTiles()` and `trimMaskTiles()` bound both caches by LRU with the current generation pinned, so submitted work can never reference a destroyed texture.
- `tiledExecutionRefusals()` no longer refuses local adjustments, Detail or the mask overlay. Spatial film, vignette and seeded grain remain refusals and are Phase 7.
- **The memory diagnostics now count the Phase 5 caches.** `detailBandTile()` and `loadLocalMaskTile()` create real device textures, and neither those nor the tiled working graph were in `resourceMemorySnapshot()`, so a tiled render reported a smaller peak than a Direct one while holding more. That broke the Phase 0 contract that the diagnostics equal the renderer's own allocations.
- **`cacheBudgetBytes()` sizes both caches from what is actually free** — the budget, less a 10% contingency matching the planner's, less the non-cache resident set — instead of taking a flat 60% and 15% of the total. The flat fractions left too little for the proxy, presentation surface and working graph, and a measured peak could exceed the budget the planner had just admitted the render against.
- The unpinned post-submission trim is retained as `pendingCacheTrim`, so a measurement can await the steady state instead of racing it.

**Phase 6:**

- Denoise needs **no halo**. `compact-haar-residual-v1` is a Haar transform over non-overlapping 2x2 blocks, so a tile whose origin is a multiple of `2 ** levels` decomposes exactly as the whole image does there. That one rule — plus contiguous tiles, a trailing span under two pixels absorbed into its neighbour, and the last tile running to the image edge so edge padding matches — makes tiled analysis and tiled reconstruction **bit-identical**, not merely close.
- `backend/hdr_finisher/denoise_tiles.py` is the CPU half: `analyze_denoise_tiled()`, `resolve_denoise_tiled()` with an optional region, the aligned tile grid, and `denoise_cache_identity()`. Each tile runs the *unmodified* reference, so the tiled path cannot drift away from the thing it is checked against.
- The denoise shaders take explicit rects. `AnalysisParams` gains an output extent, a source origin and a valid sub-rect — the last because levels 1 and above read a reusable scratch texture larger than the tile's own low band, and clamping to the allocation would invent edge pixels the whole-image run never sees. `ResolveParams` gains an output/original origin, zero for the intermediate passes that write to tile-local scratch.
- Analysis walks tiles with **one reusable scratch chain** sized to the largest tile. Measured analysis scratch is 2.6-2.8 MB at 24 MP, 42 MP and 8K alike, against about 106 MB for a whole-image two-level chain at 42.4 MP.
- Evidence is per-tile textures rather than whole-image bands, addressable under the same identity with the tile rectangle appended.
- `denoiseCounters.analysisDispatches` makes the live-control contract checkable rather than assertable-by-inspection; `test_denoise_phase_two_...` additionally asserts `resolveDenoiseProxy`'s body never names `pipelines.analysis`.
- `resolveDenoiseProxy(controls, { region })` rebuilds only the tiles a region touches. A request is honoured at tile granularity, and the renderer reports the rounded rectangle as `selector.resolvedRegion` so a caller can tell what is current.
- **A chunk-size dependence in the CPU reference was found and fixed.** `_rgb_to_components` used `np.tensordot`, which dispatches to BLAS and accumulates differently depending on how many rows it is handed, so a pixel came out up to one ULP apart depending on whether it was analysed whole or as a tile. A reference whose result depends on how the work is chunked cannot be the reference for a tiled implementation.
- The cache identity is now one function written twice — Python and JavaScript — and pinned by `tests/fixtures/denoise-cache-identity.json`, which both sides assert against.

**Validation:**

- Full Python suite in the venv, run from `codebase/`: `1254 passed, 3 skipped, 0 failed` at the Phase 6 boundary (`1210` at Phase 5) (Phase 4 closed at `1208`; Phase 4 adds 133; Phase 3 closed at `1073`, and the pre-Phase-4 baseline was `1075`).
- `node --test` over the deterministic suites: `tests 77 / pass 77 / fail 0` at the Phase 6 boundary (`72` at Phase 5, `69` at Phase 4).
- 19 browser suites at the Phase 5 boundary: 19 / 19 pass, including the mask, local-authoring and GPU-parity surface Phase 5 touches. `path-mask` passes 8 consecutive runs after its test defect was fixed.
- Three Phase 5 gate harnesses pass: `tiled-direct-parity`, `tiled-cpu-detail-parity` and `performance/detail-cache-residency`.
- Earlier, at the Phase 3 boundary: Full Python suite in the venv: `1073 passed, 3 skipped, 0 failed`. Before Phase 3 it was `1017 passed, 3 skipped, 0 failed`; the +56 are this phase's new cases.
- `node --test` over `source-transport`, `render-plan-admission`, `viewer-state-transitions`, `webgpu-memory-diagnostics`, `webgpu-allocation-agreement`: `tests 41 / pass 41 / fail 0`.
- 16 Playwright browser suites pass, including `perspective-interaction` and `perspective-preview-ownership`.
- Live server trace: the real 1024x576 output reassembled from 6 strips is **byte-identical** to the whole-frame proxy, with peak chunk at 16.7% of the frame, identical row pitch, and time-to-first-tile 9.8 ms against 59.5 ms for the complete transfer.
- `test_geometry_region.py` (40 cases) compares region extraction against `apply_geometry` itself across a grid of uneven tiles, every boundary edge, single-row and single-column tiles, clamped rects, and odd dimensions. `test_source_tile_api.py` (16 cases) reassembles live endpoint tiles for rotate, flips, crop, rotate+crop, perspective, and roll.

**Approved tolerance:** every route is exact except a windowed projective resample not anchored at the warped origin, where composing the matrix with a translation perturbs float32 in its last bits. Worst case measured: 6e-08 absolute, 9e-08 relative, on 2 of 1680 samples, about four orders of magnitude below RGBA16F transport precision.

**Evidence:** `docs/technical/phase-3-bounded-transport-evidence-2026-09-19.md`, `phase-2-gpu-planner-evidence-2026-09-19.md`, `phase-1-stable-tier-lifecycle-evidence-2026-09-19.md`, `phase-0-exit-gate-evidence-2026-09-19.md`, `phase-0-gpu-logical-memory-baselines-2026-09-19.md`, `phase-0-preview-resolution-boundary-inventory-2026-09-19.md`.

**Carried-forward items:**

1. ~~**No GPU trace for Phases 1-3.**~~ **Closed 2026-09-19.** Measured on a real NVIDIA `lovelace` adapter (RTX 4070 Ti, not a fallback) through headless Edge with `--enable-unsafe-webgpu`, on a 42.4 MP source, 30 inputs per tier inside one gesture. Every section 11.1 target passes: input handling 3.1-3.4 ms p95 against 16.7 ms; submit-to-present 5.0 / 2.9 / 2.3 ms at 1K / 2K / 4K against 16.7 / 16.7 / 33 ms; feedback 0 ms p95 against 100 ms; **zero** stale results and **zero** non-exact presentations at every tier. The streamed transport ran for real: 4K took 6 chunks with a 16.8 MB peak response against a 90 MB total. Harness `codebase/tests/performance/exact-tier-latency.js`; evidence `docs/technical/exact-tier-gpu-latency-2026-09-19.md`; raw report at the ignored path `codebase/output/performance/exact-tier-latency-42mp.json`. Full now has native parity evidence, but not the 30-input gesture latency trace; it remains engineering-only. The multi-host environment matrix is Phase 9.
2. **The `roll` region route still materializes** the rotated frame and slices it. Parity is exact and the browser response is still bounded; only the backend allocation is not.
3. ~~**Mask transport is still whole-frame.**~~ **Closed 2026-09-19.** `GET /api/session/{id}/local-mask-tile/{local_id}` serves bounded, globally anchored, haloed mask tiles, and the tiled route uses them instead of the whole-frame payload. Compilation remains whole-image and authoritative. `test_local_mask_tiles_reassemble_the_authoritative_global_mask` proves a tiled reassembly is byte-identical to the whole-frame mask. Evidence: [`phase-5-masks-locals-detail-evidence-2026-09-19.md`](../technical/phase-5-masks-locals-detail-evidence-2026-09-19.md).
4. **The 16,384-pixel bound remains on the older endpoints** — but no longer on the mask path, whose tiled consumer landed in Phase 5 — (`PreviewRequest`, `GeometryMapRequest`, `LocalMaskPreviewRequest`, `LocalLuminanceSampleRequest`, `/proxy`, `/local-mask`). They retire as their consumers move to tiles.
5. ~~**Tiled execution does not exist yet.**~~ **Closed 2026-09-19.** Phase 4 built the scheduler, and follow-up 2 (`a552aed`) wires the planner's `tiled` decision into the normal render path. Evidence: [`phase-4-tiled-admission-scope-evidence-2026-09-19.md`](../technical/phase-4-tiled-admission-scope-evidence-2026-09-19.md).
6. Scopes still derive from any accepted generation rather than an exact selected-tier generation, and comparison lanes do not yet state tier and generation explicitly — both Phase 7.
7. `window.HDRFinisherPerformance` render/denoise hooks still call `Number(longEdge)` with no numeric-contract validation.
8. ~~Full remains absent from the preview selector and the Settings menu.~~ **Engineering gate closed 2026-09-19, `de6608e`.** Public HTML still exposes only 1K/2K/4K. `?engineeringFullPreview=1` installs Full in both selectors, sends CPU Full through strips and lets the GPU planner choose Direct or Tiled. Evidence: [`phase-4-full-selection-native-parity-evidence-2026-09-19.md`](../technical/phase-4-full-selection-native-parity-evidence-2026-09-19.md).

9. ~~**`path-mask-interaction` fails, and it predates this sprint.**~~ **Closed 2026-09-19.** It was a **test** defect, not a product one. A Path node or handle drag only commits when the pointer gesture registered movement (`gesture.changed`), so a press that missed the handle produced no request at all and the test waited the full 30 s for one that was never coming. The press missed because the drag setup letterboxes the preview and then reads the handle position after a fixed 50 ms wait; when layout had not settled the box read back at the old size. Both waits are now conditions, and each Path drag waits for the gesture to register before releasing. **8 consecutive passes.** Detail in [`phase-5-masks-locals-detail-evidence-2026-09-19.md`](../technical/phase-5-masks-locals-detail-evidence-2026-09-19.md). Original note: Line 460's `waitForResponse` for the `/edit-commands` commit of an out-of-image Path handle drag times out. Reproduced at the pre-sprint release commit `83bca70`, on its own suite, server and port: 1 pass / 2 fail. At head it is 0 pass / 4 fail. A separate local-adjustments defect, not a preview-execution one; it is not fixed by Phase 4 and should not be attributed to it. Detail in [`phase-4-cpu-bounded-full-evidence-2026-09-19.md`](../technical/phase-4-cpu-bounded-full-evidence-2026-09-19.md).

**Phase 4 follow-ups, in order:**

1. ~~Converge `renderTiledTo` and `renderTo` onto one pass-chain encoder.~~ **Done, `8081d42`.** `sourcePixelScaleFor`, `graphActivity`, `highlightAnchorRequest`, `uploadParamsAndCurves` and `bindGraphResources` are now single definitions both routes call. The highlight-peak cache key was the drift risk that mattered: it is a list of parameter indices that must mean the same thing on both routes, or a Direct and a Tiled render of the same grade stop sharing a cache entry and the shoulder moves when execution changes. What genuinely differs stays separate with the reason recorded: only Direct declines to await the anchor on an interactive frame, because Tiled is never the interactive route.

2. ~~**Wire tiled execution into admission**, so a graph Direct cannot fit renders tiled instead of relying on the allocation backoff.~~ **Done, `a552aed`.** The normal render path acts on the planner before Direct allocation, accepted presentations identify their execution, tiled acceptance drops the stale whole-frame scope source, and scopes deliberately use CPU until Phase 7 supplies a tiled GPU source. The forced low-budget browser branch is recorded in [`phase-4-tiled-admission-scope-evidence-2026-09-19.md`](../technical/phase-4-tiled-admission-scope-evidence-2026-09-19.md).

3. ~~**Engineering-only Full selection**, once 2 holds.~~ **Done, `de6608e`.** Public selectors are unchanged; the engineering query flag exposes Full coherently in both menus. GPU Full uses admission and CPU Full requests strips.

4. ~~A native-resolution Direct/Tiled parity comparison at 42 MP.~~ **Done, `7f3e857`.** The 5320×7968 reference frame was compared across all 42,389,760 compositor pixels at tile sizes 256 and 512: zero differing pixels and max channel delta 0 for both, with one tiled presentation submission per generation. Evidence: [`phase-4-full-selection-native-parity-evidence-2026-09-19.md`](../technical/phase-4-full-selection-native-parity-evidence-2026-09-19.md).

### Follow-up 2's Phase 7 dependency — resolved for admission

The landed wiring splits the encoding half of `renderTiledTo` into an `encodeTiledGeneration(canvas, context, proxy, surface, pipelines, params, options)` that both the engineering entry and `renderTo` call. `renderTo` acts on `plan.decision.mode === "tiled"` before `ensureIntermediate`, rather than after a Direct allocation fails.

**The blocker was scopes.** `analyzeScope` samples `scopeSources[canvas].filmTexture`, a whole-frame finish texture that tiled execution deliberately does not produce — that absence is the point of the design. A missing or unusable GPU scope source previously made `runGpuScopeRequest` return false, after which `runQueuedGpuScopeRequest` could relabel the freshness readout with the *previous* scope's tier. Routing real renders through Tiled without addressing that would have silently presented a stale scope as settled, which section 11 forbids.

The landed resolution carries an `execution` field on the accepted presentation (`"direct"` or `"tiled"`), has the tiled path drop the stale `scopeSources` entry, and excludes `execution === "tiled"` from both `gpuScopeEligible()` and the GPU-wait guard so the existing CPU scope route takes over. It is correct but slower. `tiled-admission-scope-fallback.js` forces a tiled decision with the low-budget planner branch and proves a new CPU scope becomes Settled with zero GPU-scope calls.

The required discriminating test passes; follow-up 2 is closed. A generic suite run alone would not have exercised this branch.

**Reference hardware note:** the director's RTX 4070 Ti reports `maxTextureDimension2D` of **8192**, not 16384. A source whose Full long edge exceeds 8192 cannot be Direct-admitted on this machine at all, which is precisely the case Phase 4's tiled execution exists for. The 42.4 MP test source has a 7968 long edge and still fits.

**Resolved blocker:** `gpu-highlight-compression-parity` regressed during this sprint and is now fixed; it passes 6/6, matching pre-sprint. The cause was the scheduler's interactive frame taking the bootstrap path (`longEdge: 889`) and superseding a settled render 1 ms into its highlight-peak measurement, because the suite renders below the tier so `selectedTierReady()` is never true. Outside a gesture both `onFrame` and `refinePreview` now stand down while a render is in flight; during a gesture latest-wins still applies. The fix also cut input-handling p95 from 3.1-3.4 ms to 1.9-2.3 ms. Detail in [`phase-4-tiled-execution-evidence-2026-09-19.md`](../technical/phase-4-tiled-execution-evidence-2026-09-19.md).

**Phase 4 is closed.** All four ordered follow-ups are complete. Phase 5 is the next safe implementation phase.

The work that closed it, in the order it landed (historical; each item is now done):

1. **Thread a tile origin through the fragment entry points.** The shaders derive the source texel straight from `input.position.xy`, clamped to `textureDimensions(sourceTexture)`, so source and destination coordinates are 1:1 and the sampling logic needs no change. Rendering into a tile-sized target makes that position tile-local, so each entry point needs a `globalCoordinate(position)` that adds a tile origin carried in two new slots, raising `PARAM_COUNT` from 160 to 162. That is roughly fifteen fragment entry points in `webgpu-preview.js`; `test_webgpu_pipeline_preserves_cpu_section_order_and_lane_specific_exposure_bands` asserts `const PARAM_COUNT = 160` and will need updating with them.
2. **Encode one generation as one submission.** Take one `getCurrentTexture()`, encode every tile pass into a single command encoder, and submit once. The canvas then presents the complete assembly or nothing, so atomicity comes from the architecture rather than from a lock. Drive the order from `HDRTileScheduler.plan().tiles`, which is already sorted visible-first, nearest-the-viewport-centre-first.
3. **Direct versus Tiled parity corpus** over the pointwise graph — this is exit gate 1.
4. **Measured tiled residency** at 24 MP, 42 MP and 8K, replacing the modelled figures currently backing exit gate 3.
5. **CPU tiled/strip execution and cancellation** — exit gate 4. Landed as `cpu_strips.py`.
6. **Engineering-only Full selection**, only once 1-5 hold. Completed in `de6608e`, after tiled admission was wired. Native 42.4 MP parity then closed in `7f3e857`. No app or server process is intentionally left running.

When handing work to another task, replace the checkpoint above with:

- exact branch and commit or uncommitted file list;
- completed checklist items and tests;
- commands used and output/evidence paths;
- active failure or unresolved decision;
- next safe edit;
- any generated artifacts that are ignored by Git;
- whether the app/server is still running and how it was started.

## 13. Initial implementation map

| Area | Primary files |
|---|---|
| Resolution state, viewer states, scheduling, persistence integration | `codebase/frontend/app.js` |
| Resolution menu and performance settings UI | `codebase/frontend/index.html`, frontend styles, `codebase/frontend/application-shell.js` |
| GPU planner, allocation diagnostics, Direct/Tiled graph, caches | `codebase/frontend/webgpu-preview.js` |
| Preview scheduling and generation ownership | `codebase/frontend/preview-scheduler.js`, `codebase/frontend/app.js` |
| Source/mask tile APIs and host-resource planning | `codebase/backend/hdr_finisher/main.py` |
| Source epochs, geometry-fixed source cache, tile extraction | `codebase/backend/hdr_finisher/render_cache.py` |
| CPU Detail reference | `codebase/backend/hdr_finisher/detail.py` |
| CPU Denoise reference | `codebase/backend/hdr_finisher/denoise_reference.py` |
| Adjustment order and export integration | `codebase/backend/hdr_finisher/adjustments.py`, exporters and finishing pipeline |
| Denoise document/schema | `codebase/backend/hdr_finisher/models.py`, `docs/technical/denoising.md` |
| Performance and browser validation | `codebase/tests/`, `codebase/tools/`, ignored `codebase/output/performance/` evidence |

Line numbers are intentionally omitted because this sprint will materially change these files. Each implementation task must re-read the current code before editing.

## 14. Explicit non-goals

This sprint does not require:

- replacing the wavelet Denoise algorithm solely because preview architecture changes;
- reducing Denoise to three preset-only choices;
- replacing Detail controls with presets;
- adding neural models, camera/ISO noise profiles, or local Denoise masks;
- guaranteeing instantaneous Full rendering on every machine;
- exposing a Direct-only Full option as a finished feature;
- using lower-resolution interaction proxies after selected-tier readiness;
- treating a loupe as the only accurate preview surface;
- moving all delivery encoding to the GPU;
- claiming physical VRAM measurement through WebGPU;
- weakening export precision, color accuracy, HDR range, or metadata.

## 15. Definition of done

The sprint is complete when:

- 1K, 2K, 4K, and Full obey the same stable selected-tier contract;
- Full is available on supported GPU and CPU-only configurations;
- no tested resource or allocation failure silently changes Full to 4K;
- Direct and Tiled execution are selected by measured resource planning;
- source and mask transport is bounded;
- Denoise evidence and Detail bands use bounded tile caches;
- Denoise live controls and Detail controls remain interactive without lower-resolution substitution;
- authored Denoise participates in full-resolution export;
- Full preview and export parity passes for every supported module;
- memory, cancellation, stale-generation, seam, device-loss, and endurance gates pass at 24 MP, 42 MP, and 8K;
- the Denoise technical contract and user documentation describe the shipped behavior accurately;
- the final handoff ledger contains reproducible evidence and no undocumented release blocker.
