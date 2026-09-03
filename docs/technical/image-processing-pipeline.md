# Image-Processing Pipeline: Technical Contract

**Status:** Current implementation reference for contributors and AI coding agents.
**Verified against:** `95060fa` (`feature/denoising` and `main`), August 25, 2026.
**Scope:** Import, working representation, HDR/SDR grading, local adjustments, preview, scopes, proof, export, caching, and rules for adding image operations.

This document explains the pipeline as it runs today, including the reasons behind its ordering and performance architecture. It is deliberately more implementation-oriented than the [color-pipeline specification](../concepts/color-pipeline.md) and more image-path-specific than the [system architecture](architecture.md).

When this document disagrees with running code or tests, code and tests win. Update this page in the same change. The repository's broader authority order is active code/tests, reproducible evidence, validation records, user documentation, then PRDs and design history.

## 1. The shortest correct mental model

```text
source file
  -> format-specific decode and source corrections
  -> one normalized, non-negative float32 scene-linear ACEScg source
     (+ an independent display-linear sRGB authored SDR source when supplied)
  -> session + bounded source-proxy/cache state
  -> geometry
  -> HDR or SDR global grade
  -> ordered local grades
  -> film/spatial finishing
  -> vignette
  -> grain
  -> preview/scopes OR full-resolution output finishing and delivery encoding
```

The application has two renderers with different jobs:

- The CPU/NumPy path is the numerical authority for proof and export.
- The WebGPU path mirrors the grade for low-latency authoring preview. Unsupported GPU work must fall back; it must not silently change the result.

The source, proxy, viewport, and output size are separate concepts. A proxy can change resolution without changing the crop, zoom, scroll position, canvas geometry, or export dimensions.

## 2. Non-negotiable invariants

Future changes should preserve these unless a deliberate architecture migration replaces them with measured evidence and updated tests.

1. **Normalize once.** The retained HDR working source is H×W×3, non-negative, scene-linear ACEScg/AP1 D60, `float32`. Do not repeatedly decode, develop RAW, convert color spaces, or copy the full source during ordinary grading.
2. **Keep authored SDR independent.** A gain-map source may retain a separately decoded display-linear sRGB SDR base. It is not merely a fresh tone map of HDR and must survive project-reference-white changes.
3. **Proxy before grade.** Interactive CPU work downsamples the source before expensive grading. Never place an unconditional full-resolution filter in the per-slider path.
4. **Geometry precedes creative grading.** Masks are evaluated against a fixed, geometry-transformed source. A later grade must not move its own selection boundary.
5. **Order is semantic.** HDR, generated SDR, and authored SDR are different branches. Locals run in list order. Film effects, vignette, and grain occupy deliberate positions.
6. **Grain is last at the resolution being delivered.** Preview grain is generated at preview resolution. Export excludes ordinary grain, resizes and sharpens, then regenerates grain at final output resolution.
7. **Scopes consume the rendered branch.** They do not define another grade order. GPU scopes reuse the presented render; CPU scopes reuse the adjusted-frame cache.
8. **Overlays are diagnostics.** False color, zebras, clipping indicators, crop guides, and qualification maps do not enter proof or export pixels.
9. **Stale work never wins.** Frontend generations, backend edit revisions/tokens, cancellation, single-flight work, and latest-owner activation are correctness mechanisms as well as performance mechanisms.
10. **Caches are bounded and meaningfully keyed.** A cache key includes only state that changes its pixels. Avoid invalidating source proxies or spatial masks for unrelated grade/opacity changes.
11. **Disabled features cost effectively zero.** An off feature must bypass allocations, analysis, uploads, shader passes, cache churn, scope churn, and presentation changes. For a risky spatial feature, the disabled route should be the established route, not a new general path with neutral parameters.
12. **Preview quality cannot change viewport geometry.** Interactive, settled, and refinement handoffs replace pixels inside the same source-anchored view.

## 3. Import and source preparation

### 3.1 Import is a transaction

The cheap media-browser thumbnail is intentionally non-authoritative. It must not trigger full RAW development or gain-map reconstruction. Opening a source uses a single-worker full-resolution import path:

```text
decode -> interpret source -> normalize -> analyze -> build private session/cache
       -> activate only if this request is still the latest owner
```

An active session must never contain a mixture of old pixels and new metadata, reference white, analysis, or cache state. Large imports are serialized because a 42 MP HDR image, an SDR reference, and decoder/transformation temporaries can approach or exceed a gigabyte.

Entry points: [`loader.load_image`](../../codebase/backend/hdr_finisher/loader.py), [`sessions.prepare_session`](../../codebase/backend/hdr_finisher/sessions.py), and the import executor/routes in [`main.py`](../../codebase/backend/hdr_finisher/main.py).

### 3.2 Decode dispatch

`load_image` selects a format-specific decoder for gain-map JPEG/Ultra HDR, AVIF, Pillow bitmap formats, TIFF, OpenEXR, Radiance HDR/PFM, HEIF/HEIC, JPEG XL, DNG, and broader camera RAW. Decoder output is conformed to three color channels before normalization.

Format-specific source work belongs here, not in every render:

- Camera RAW uses controlled development (including white balance and demosaic choices). Recommended RAW exposure becomes an editable starting adjustment; it does not bake into the retained source.
- Required DNG opcodes and lens/source corrections are applied exactly once in their defined source-development path.
- Gain-map sources reconstruct HDR and may also retain the authored SDR rendition.
- Explicit user interpretation overrides are resolved before normalization. Unknown primaries stay unresolved rather than being guessed from file type or pixel values.

### 3.3 Normalized working representation

The HDR source invariant is:

| Property | Contract |
|---|---|
| Shape | H×W×3 RGB |
| Type | contiguous `float32` |
| Primaries/white | ACEScg/AP1, D60 |
| Transfer | scene-linear |
| Range | non-negative; HDR values may exceed 1.0 |
| Scene anchor | 0.18 equals project HDR Reference White, normally 203 nits or optionally 100 nits |

PQ and HLG sources first become absolute luminance, then project-relative scene values, then ACEScg. This preserves absolute luminance when decoder and project reference whites differ. The generated SDR branch's creative `0.18 -> approximately 0.493` anchor is separate; it is not a physical 100-nit conversion.

Sanitization maps NaN and negative infinity to zero, positive infinity to 65,504, and negative values to zero. The current application does not preserve signed scene-linear pixels.

Large color transforms run in bounded row strips (currently 128 rows) and reuse `float32` buffers where practical. This is a memory rule: a vectorized expression that creates several full-resolution temporaries can be slower and dramatically more memory-hungry than a bounded transform.

The optional authored SDR working source is display-linear sRGB `float32`. It is retained independently in `LoadedSession` and is selected by the SDR reference branch.

Implementation: [`color.py`](../../codebase/backend/hdr_finisher/color.py), [`color_context.py`](../../codebase/backend/hdr_finisher/color_context.py), [`raw_import.py`](../../codebase/backend/hdr_finisher/raw_import.py), and [`sessions.LoadedSession`](../../codebase/backend/hdr_finisher/sessions.py).

## 4. Session state, geometry, and masks

`LoadedSession` owns the full-resolution source, optional authored SDR, metadata/color context, editable adjustments, ordered local layers, and `SessionRenderCache`. Ordinary slider changes mutate adjustment state and invalidate render products; they do not replace or redevelop the source.

### 4.1 Geometry is first in a render

The CPU renderer applies destructive geometry in this order:

1. quarter rotation;
2. horizontal flip;
3. vertical flip;
4. straighten and valid-region crop;
5. user crop.

For GPU preview, the backend applies the same geometry to the requested source proxy before packing and uploading it. Geometry therefore remains upstream of both renderers.

### 4.2 Masks inspect a stable source

Local-mask qualification is source-anchored. A mask examines the fixed source transformed through the same geometry, not the progressively graded display result. This prevents a luma adjustment, color change, or local-layer reorder from changing the pixels selected by the mask itself.

Local layers then grade and blend one shared result in list order. CPU work is tiled at 512×512. The mask's spatial signature intentionally omits simple opacity, so opacity-only and grade-only changes can reuse spatial masks. Geometry, source, or structural mask changes invalidate them.

Implementation: [`finishing.apply_geometry`](../../codebase/backend/hdr_finisher/finishing.py), [`local_adjustments.py`](../../codebase/backend/hdr_finisher/local_adjustments.py), and mask caching in [`render_cache.py`](../../codebase/backend/hdr_finisher/render_cache.py).

## 5. Authoritative CPU grade order

[`adjustments.apply_adjustments`](../../codebase/backend/hdr_finisher/adjustments.py) is the clearest executable specification. It applies geometry, compiles source-anchored masks, and dispatches to the selected lane.

### 5.1 HDR lane

| Order | Stage | Domain / reason |
|---:|---|---|
| 1 | Exposure, shadow/black lift, contrast/pivot | Scene-linear ACEScg tone foundation |
| 2 | Highlight compression: soft ceiling and peak fit | Bounds extreme scene energy before downstream creative color; not a final output clamp |
| 3 | White balance, ACEScg primaries/tint, saturation/vibrance | Scene-referred color |
| 4 | Tone equalizer / Exposure Bands | Scene-EV bands |
| 5 | Lift, gamma, gain | Global tonal shaping |
| 6 | HDR curves | Global curves |
| 7 | Global color grading | Final global creative grade before locals |
| 8 | Ordered local layers | Each layer grades and blends the running result using a stable source mask |
| 9 | Film response and color density | Post-local film response |
| 10 | Halation | Spatial highlight effect |
| 11 | Bloom/diffusion | Spatial highlight effect |
| 12 | Image structure/microcontrast and film resolution/softness | Post-local spatial finishing |
| 13 | Vignette | Whole-frame finishing after the film look |
| 14 | Seeded grain | Last creative stage at the current render resolution |
| 15 | Non-negative clip | Enforce the HDR working/output invariant |

Highlight compression's configured peak is a stage-local target. Later color, locals, film effects, and grain may raise the final measured peak; do not treat it as a delivery hard clamp.

### 5.2 Generated SDR lane

Generated SDR starts from the ACEScg HDR source:

1. SDR exposure and shadow work in scene-linear ACEScg.
2. Independent SDR scene color adjustments.
3. Apply the fixed SDR placement where scene-linear `0.18` maps to display-linear `100/203`.
4. Convert with CAT02 to display-linear sRGB.
5. Apply SDR Highlight Compression, then gamut-compress toward display luminance.
6. display-linear tone equalizer / Exposure Bands.
7. contrast.
8. lift, gamma, gain.
9. SDR curves.
10. global color grading.
11. ordered local layers.
12. film response/color density, halation, bloom/diffusion, structure, and film resolution.
13. vignette.
14. seeded grain.
15. clamp to `[0, 1]` display-linear sRGB.

The scene-to-display conversion boundary is important. Moving a scene-linear control after it changes both its numerical meaning and its visual behavior.

### 5.3 Authored SDR lane

When a source contains an authored SDR rendition, the branch begins from its retained display-linear sRGB pixels:

1. apply geometry to the authored SDR source;
2. exposure and shadow work;
3. optionally apply SDR Highlight Compression (bypassed for newly imported authored bases);
4. tone equalizer;
5. contrast;
6. temporarily convert sRGB to ACEScg for scene-color operations, then return and gamut-compress;
7. lift/gamma/gain, curves, and global color grading;
8. ordered local layers;
9. film response and spatial finishing;
10. vignette;
11. grain;
12. clamp to `[0, 1]`.

Do not collapse this branch into generated SDR. The authored base is a distinct creative endpoint in a gain-map source. Legacy v4 projects without an SDR rendering-version marker continue through the retired Base Rendition/Highlight Recovery renderer so reopening a project does not alter its pixels.

### 5.4 Local-layer internal order

Within one local layer, the CPU applies its supported tone/zone/exposure/contrast operations, then white balance/saturation, curves, and color grading before blending with `mask × opacity`. SDR color work temporarily uses ACEScg where required. Layers are sequential and therefore generally non-commutative.

### 5.5 Film and grain separation

`_apply_film_look` contains film response, halation, bloom, structure, and film-resolution effects. The normal pipeline calls it without grain, applies vignette, then invokes `apply_final_grain`. Keep this separation: export needs to resize before generating final-resolution grain.

## 6. Interactive preview pipeline

### 6.1 Quality tiers do not define image geometry

The current frontend has 1K, 2K, and 4K requested preview choices. During interaction it derives a bounded draft edge from the displayed physical size (currently 512–1,024 px); settlement uses a bounded edge (currently 768–1,024 px); delayed refinement may request the chosen higher edge.

These sizes are pixel-density choices. CSS layout, aspect-ratio box, zoom, pan, and scroll must remain anchored to the session/source geometry. A newly returned 1K/2K/4K bitmap replaces pixels; it must not resize the viewport.

### 6.2 Scheduler contract

[`preview-scheduler.js`](../../codebase/frontend/preview-scheduler.js) separates image, scope, refinement, and inactive-lane generations. It:

- coalesces ordinary GPU interaction to at most one render per animation frame;
- keeps at most one active frame request plus the latest pending work;
- debounces scopes (currently 60 ms interactive) and settlement (110 ms);
- delays high-quality refinement (520 ms);
- runs inactive-lane preparation only during idle time;
- aborts or discards obsolete generation, geometry, lane, session, and revision results.

Routine GPU grading must not start CPU grading, delivery encoding, network transfer, and browser decode on every settlement. CPU/raw preview remains a fallback and explicit proof/encoded-preview path.

### 6.3 WebGPU stage mirror

[`webgpu-preview.js`](../../codebase/frontend/webgpu-preview.js) retains its device, shaders, pipelines, proxy textures, curves, local uniforms, masks, and intermediate textures. Its render graph is:

```text
geometry-fixed source proxy
  -> global HDR/SDR base shader
  -> one full-screen ping-pong blend per ordered local layer
  -> film-response pass
  -> quarter-resolution highlight extraction
  -> separable horizontal/vertical spatial blur
  -> composite halation + bloom + structure + resolution + vignette + grain
  -> display mapping and diagnostic overlay
```

The global shaders mirror the CPU branch order and parameter meanings. Some unsupported local curves/color-grading cases deliberately request CPU fallback. Device loss also falls back. A GPU approximation must not pretend to be authoritative when parity is unknown.

RGBA16F transport is preferred when the proxy is finite and representable; RGBA32F is the fallback. Rows are packed to WebGPU's alignment requirements. Proxy textures are retained at no more than two levels per lane and concurrent fetches are deduplicated.

HDR canvas presentation uses extended-range Display P3 under Chromium's 203-nit convention. SDR canvas presentation uses sRGB. This is display behavior, not delivery encoding or the colorimetric authority for export.

## 7. Render cache and invalidation

[`SessionRenderCache`](../../codebase/backend/hdr_finisher/render_cache.py) is a performance boundary, not a convenience dictionary.

Current principal limits are six adjusted frames, a 192 MiB combined proxy/adjusted-frame budget, and two retained source-proxy levels. Scope, mask, and analysis-map caches have their own bounds. Expensive same-key work is single-flight so concurrent preview/scope requests do not render the same pixels twice.

The adjusted-frame key includes lane, proxy edge, complete pixel-affecting adjustment state, ordered locals, and render color context. Viewer-only overlay values are stripped because they do not change adjusted pixels. Cached arrays are contiguous/read-only to prevent downstream mutation.

The key performance sequence is:

```text
full source -> bounded source proxy -> geometry/masks -> grade proxy -> cache result
```

not:

```text
full source -> full-resolution expensive grade/filter -> downsample for display
```

CPU scopes reuse the same adjusted frame and take a zero-copy post-geometry ROI view where possible. Grade edits clear adjusted frames/scopes while retaining reusable source proxies and spatial masks. A source replacement clears all dependent products.

Do not hold a global cache lock while doing unrelated expensive work. Preserve byte budgets, LRU eviction, per-key single-flight, and cancellation/currentness checks when adding a new cacheable product.

## 8. Scopes and overlays

Scopes answer “what is being shown by this processed branch?” rather than running an alternate grade.

- GPU scopes downsample/read back the already rendered film texture. A two-buffer readback pool bounds work. Under backpressure the application keeps the last valid scope instead of performing an image-sized CPU fallback.
- CPU scopes request the cached adjusted proxy and add scope mode, settings, and ROI to their cache key.
- HDR scopes transform the final ACEScg result to linear BT.2020 and map luma to reference nits.
- SDR scopes analyze the displayed nonlinear sRGB signal.

Qualification maps, mask previews, zebras, false color, and crop guides are presentation overlays. Keep their settings out of adjusted-frame keys unless they genuinely alter the underlying graded pixels, and never let them enter an export render.

Implementation: [`scopes.py`](../../codebase/backend/hdr_finisher/scopes.py), [`render_cache.py`](../../codebase/backend/hdr_finisher/render_cache.py), and the GPU readback path in [`webgpu-preview.js`](../../codebase/frontend/webgpu-preview.js).

## 9. Proof and export

Preview proxies are never export sources. Export rerenders the selected full-resolution session branch on CPU.

The shared export sequence in [`exporters.py`](../../codebase/backend/hdr_finisher/exporters.py) is:

1. deep-copy adjustment state and suppress viewer-only diagnostics;
2. `apply_adjustments(..., include_grain=False)` at full source resolution;
3. apply output resizing, then edge-aware sharpening;
4. regenerate seeded grain at the final delivery dimensions;
5. transform to the delivery color encoding and encode;
6. validate/independently decode where required;
7. atomically replace the destination with the completed artifact.

HDR delivery is ACEScg to linear BT.2020, scene values to absolute nits using project reference white, then PQ. Apply codec-specific 203-nit conventions exactly once at the named codec boundary. SDR delivery encodes the processed linear-sRGB branch to sRGB.

Gain-map outputs render matched full-resolution HDR and SDR endpoints independently. Proof creates and reads an encoded artifact, inspects its metadata, and reconstructs the actual base/alternate relationship at the requested headroom; it is not simply a screenshot of the authoring canvas.

### JPEG Ultra HDR gain-map cleanup is not image denoising

The JPEG Ultra HDR exporter currently performs a bounded, SDR-guided filter on the generated logarithmic gain map before repacking/validating the delivery file. This changes publishing metadata/residual data only. It does **not** denoise the authored HDR image, the authored SDR image, the working source, preview, or grading pipeline. Refer to it as **delivery-only gain-map cleanup** to avoid confusing it with the reverted authored-image denoiser.

## 10. Denoising rollback: what future work must learn

### 10.1 Established facts

The first shared interactive authored-image denoising implementation was removed on August 25, 2026. The surviving rollback record is in the [main PRD](../product/HDR_Finisher_PRD_v1.2.md#denoise-implementation-rollback-2026-08-25). The prototype itself was reverted before a durable implementation commit, so its exact removed code is not an authoritative source.

Observed failures were:

- all grading sliders became noticeably laggy at 1K even when denoise had never been enabled or adjusted;
- preview presentation became unstable: changing Exposure could make the image appear to zoom out;
- 1K/2K/4K and interactive/settled handoffs changed viewport scale instead of replacing pixels within a stable view;
- restoring the pre-denoise frontend, WebGPU shader, adjustment model, and backend restored responsiveness.

That evidence establishes an integration regression. It does not, by itself, prove which single line or algorithm caused it. Likely causes such as unconditional generalized shader/state overhead or coupling proxy dimensions to layout are useful hypotheses, not historical facts.

The `feature/denoising` worktree now contains an interactive authored-image denoising stage after geometry and before the established Exposure/Color/Film/local pipeline. It lazily analyzes the active 1K/2K/4K geometry-corrected proxy into a compact two-level Haar residual cache, retains both original and resolved proxies, and lets the four live controls reconstruct without analysis. The stage is absent from full-resolution export, and a never-enabled Off document retains the established pre-denoise route with zero denoise allocations or dispatches. The separate Ultra HDR delivery gain-map cleanup described above remains active and is not part of authored-image denoising.

The [Denoising v2 implementation contract](denoising.md) defines the authoritative wavelet-cache direction, records the implemented Phase 0–3 evidence, and identifies the unresolved per-device memory-budget stop gate. Broader technology research remains non-normative.

### 10.2 Required gates before denoise returns

A future denoiser must not be implemented as “one more adjustment” until its execution class and cache boundary are explicit.

1. **Choose semantics first.** Decide whether it is source correction, a cached pre-grade preparation, a creative grade, or export-only processing. That choice determines its space, order, persistence, cache key, preview approximation, and scope behavior.
2. **Prove the off path.** With denoise disabled, route through the established pipeline before analysis, allocation, cache signature expansion, texture upload, shader pass, or scope invalidation. Compare output byte-for-byte or with an explicitly justified transport tolerance.
3. **Never re-develop RAW per edit.** Source-aware metadata/analysis may be computed once and cached. Ordinary sliders must not cause RAW decode, demosaic, or full-source denoise.
4. **Proxy before expensive interactive work.** The draft path operates on a bounded source proxy or a precomputed cached proxy product. Full-resolution filtering is reserved for explicit settle/export work with cancellation and bounded memory.
5. **Compute once, resolve many.** Cache one compact wavelet analysis per required source/lane/tier and let live controls recombine its residual evidence. Local denoise masks are out of scope for v2; a future local design must never run one denoiser per layer.
6. **Design CPU, GPU, scopes, and export together.** CPU defines the numerical contract. WebGPU must match or explicitly fall back. Scopes must analyze the same processed result. Export must state whether it recomputes at full resolution, how tiles overlap, and where grain remains last.
7. **Tile spatial algorithms with halos.** Full-resolution neighborhoods require bounded tiles/strips plus enough overlap to avoid seams. Track peak live bytes, not only final-array size.
8. **Keep viewport state independent.** A denoised or refined proxy carries source dimensions/aspect identity; it never owns CSS width, zoom, or scroll state.
9. **Preserve scheduler/backpressure behavior.** New work needs revision/generation checks, cancellation, latest-wins presentation, single-flight computation, and bounded queues. No image-sized readback fallback.
10. **Measure representative worst cases before landing.** Include 24 MP and 42 MP RAW/rendered sources; 1K/2K/4K preview; interactive, settle, lane switch, scope, proof, and export; GPU and CPU fallback; feature off and on; repeated edits; memory growth; cancellation and stale-result tests.

Minimum regression expectations remain the recorded preview budget: visible-slider p95 at or below 50 ms, first usable scope at or below 100 ms, settled scope at or below 250 ms, no encoded-preview churn during supported WebGPU grading, and no stale presentations. See the [August 9 validation record](../testing/Interactive_Preview_Performance_Validation_2026-08-09.md) for the established baseline and memory evidence.

### 10.3 Approved isolation shape for denoise v2

The next attempt begins with a source-selector seam, then adds compact cached wavelet analysis and a cheap live resolve:

```text
geometry-corrected proxy -------------------------------> retained original proxy
          |
          +-> async structural wavelet analysis -> cached residual pyramid
                                                        |
live denoise weights ----------------------------> fast GPU resolve
                                                        |
                                                        v
                                               denoised proxy

original/denoised selector -> established grade pipeline
```

Build and benchmark the selector with no denoiser first. When unused or Off, it must select the original proxy and leave the established shader, pipeline, allocation, scheduling, and presentation behavior unchanged. Only first use or explicit recalculation may lazily allocate resources and launch analysis. Amount, Luminance, Color Noise, and Detail Recovery are reconstruction-only controls; Exposure, curves, film controls, locals, and scopes reuse the resolved proxy and must not run wavelet analysis or resolve.

The analysis key contains source/session identity, authored lane, proxy tier, preceding geometry signature, locked analysis settings, and algorithm version. Live weights are not analysis inputs. Completion swaps caches and source textures atomically without resetting WebGPU, resizing the visible canvas, changing its CSS rectangle, issuing zoom commands, or altering scroll.

The first release uses stable 1K/2K/4K proxies and deliberately avoids an interactive ROI/full-source tile scheduler. Full-resolution export may later use internal strips or tiles with halos after the interactive path passes its gates. The complete control contract, memory model, staged implementation, and real-Electron acceptance thresholds are authoritative in [Denoising v2](denoising.md).

## 11. How to place any new operation

Before coding, answer this table in the change description or a linked design note.

| Question | Why it matters |
|---|---|
| What representation enters and leaves: RAW mosaic, linear camera RGB, ACEScg, linear sRGB, or encoded delivery data? | Prevents color-space and transfer-function mistakes |
| Is it source correction, global grade, local grade, post-local look, output finishing, or delivery metadata processing? | Fixes semantic order and whether HDR/SDR branches share it |
| Does it depend on original/source pixels or the running graded result? | Determines mask/analysis stability and cache ownership |
| At which resolutions does it run: import once, proxy, settle, full export? | Prevents full-frame work from entering interaction |
| What exact state invalidates it? | Avoids flushing proxies/masks/results unnecessarily |
| What is the disabled fast path? | Prevents neutral-feature regressions |
| What are the CPU reference and WebGPU parity/fallback behaviors? | Prevents preview/export disagreement |
| Do scopes see it, and do overlays merely visualize it? | Prevents alternate hidden pipelines |
| Does output resize or grain have to precede/follow it? | Preserves resolution-dependent semantics |
| How are cancellation, single-flight, memory ceilings, tiles, and halos handled? | Prevents latency, stale-result, and memory regressions |
| Which state is persisted in `.hdrfinisher` projects, and how do older projects default? | Prevents project/schema breakage |
| Which neutral, parity, ordering, cache, performance, and export tests prove the contract? | Makes the decision durable |

### Required implementation surfaces

A pixel-affecting control normally requires coordinated updates to:

- project/adjustment schema and migration/default behavior;
- CPU renderer and branch ordering;
- WebGPU shader/uniform/render graph or an explicit fallback rule;
- adjusted-frame, proxy, mask, and analysis cache signatures/invalidation;
- frontend scheduling, cancellation, and presentation generations;
- scopes and overlays;
- proof/export and output validation;
- tests for neutral output, CPU/GPU parity, ordering, caching, stale work, memory, and performance;
- this document plus the relevant user/color documentation.

If only some surfaces are updated, the feature is incomplete even if its UI appears to work.

## 12. Code and test map

| Concern | Primary implementation |
|---|---|
| Decode and normalization | [`loader.py`](../../codebase/backend/hdr_finisher/loader.py), [`color.py`](../../codebase/backend/hdr_finisher/color.py), [`raw_import.py`](../../codebase/backend/hdr_finisher/raw_import.py) |
| Session and color context | [`sessions.py`](../../codebase/backend/hdr_finisher/sessions.py), [`color_context.py`](../../codebase/backend/hdr_finisher/color_context.py) |
| CPU grade order | [`adjustments.py`](../../codebase/backend/hdr_finisher/adjustments.py) |
| Geometry/output finishing | [`finishing.py`](../../codebase/backend/hdr_finisher/finishing.py) |
| Locals and masks | [`local_adjustments.py`](../../codebase/backend/hdr_finisher/local_adjustments.py) |
| Proxies/caches/scopes | [`render_cache.py`](../../codebase/backend/hdr_finisher/render_cache.py), [`scopes.py`](../../codebase/backend/hdr_finisher/scopes.py) |
| Backend routes and cancellation | [`main.py`](../../codebase/backend/hdr_finisher/main.py) |
| Preview scheduling/presentation | [`preview-scheduler.js`](../../codebase/frontend/preview-scheduler.js), [`app.js`](../../codebase/frontend/app.js) |
| WebGPU preview/scopes | [`webgpu-preview.js`](../../codebase/frontend/webgpu-preview.js) |
| Proof/export | [`preview.py`](../../codebase/backend/hdr_finisher/preview.py), [`exporters.py`](../../codebase/backend/hdr_finisher/exporters.py) |

Tests encoding especially important architecture assumptions include:

- `codebase/tests/test_render_cache.py`: proxy-before-grade, proxy reuse, geometry parity, mask reuse, and source invalidation;
- `codebase/tests/test_performance_pipeline.py`: single-flight and byte-budget eviction;
- `codebase/tests/test_adjustments.py` and parity suites: CPU order and neutral behavior;
- `codebase/tests/performance/preview-performance.js`: browser interaction budgets;
- `codebase/tests/gpu-scope-parity.js` and GPU-local suites: bounded GPU scope/local behavior.

Use symbols and current tests as the authority; line numbers drift. When changing ordering, add a focused regression test that fails if the stage moves.

## 13. Known documentation boundaries

- The color-pipeline and HDR/SDR user pages explain color behavior but, as of this verification, some summarized order lists omit geometry, locals, or vignette. Use the full tables in this page and `adjustments.py` for implementation order.
- Historical PRDs describe intent and recorded decisions; they are not proof that a proposed feature exists.
- The denoising research pages describe possible future engines. They do not add authored-image denoising to the current pipeline.
- The browser/display path is platform-dependent. Delivery encoders plus validators remain authoritative for exported color metadata and pixels.

Update the **Verified against** commit/date whenever a material pipeline review confirms this contract.
