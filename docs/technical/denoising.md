# Denoising v2: Wavelet Cache Implementation Contract

**Status:** Approved implementation direction. Phases 0 and 1 are accepted on `feature/denoising`. Phase 2 WebGPU analysis/resolve and Phase 3 UI/document integration are implemented and pass the measured correctness, isolation, viewport, and packaged-Electron timing gates described below. Final Phase 2 acceptance remains open because sections 7 and 10 require an explicit per-device GPU byte budget, but this contract does not define one and the browser WebGPU API does not expose driver heap usage. Do not advance to corpus tuning or export until that budget conflict is resolved.
**Decision date:** August 25, 2026.
**Pipeline baseline:** `95060fa`; see [Image Processing Pipeline](image-processing-pipeline.md).
**Research archive:** [Denoising Technology Watch — August 2026](denoising-technology-watch-2026.md) is background only and is not an implementation plan.

## 1. Purpose

This document is the canonical plan for the next authored-image denoising attempt. It replaces the previous broad research and prototype proposals.

The goal is not merely to make a good still denoiser. It is to make denoising behave like a native finishing control:

- the main controls remain smooth while dragged;
- Enable/Disable is an immediate A/B comparison;
- Exposure, Color, Film, scopes, zoom, and scrolling do not trigger denoise analysis;
- expensive choices are explicit recalculation events, not unruly sliders;
- the disabled path remains the established pre-denoise pipeline;
- HDR range, lane semantics, and export ordering remain correct.

The central design is to analyze a stable proxy once into a compact multiscale wavelet cache, then resolve different denoise strengths cheaply from that cache.

## 2. Non-negotiable product contract

### 2.1 A slider means interactive

Every denoise slider must produce a meaningful result during the drag, ideally in the next presented frame. A control that requires wavelet re-analysis is not a slider.

The initial live controls are:

- **Amount**
- **Luminance**
- **Color Noise**
- **Detail Recovery**

These controls may only reweight or recombine cached data. They must not decode the source, rebuild geometry, repeat wavelet analysis, change preview tier, recreate WebGPU, or request an encoded preview.

A fine/coarse balance control may become live later only if profiling proves it is also a reconstruction-only operation.

### 2.2 Expensive settings are locked analysis settings

Settings that change the decomposition or noise model use presets or an explicit value plus a **Recalculate Denoise** action. Examples include:

- noise character or apparent noise-size preset;
- analysis level count or quality;
- photo/render source model;
- a future custom analysis parameter.

Changing one of these settings marks the denoise analysis as pending. Recalculation is asynchronous, cancellable, single-flight, and latest-wins. The previous valid image remains visible until the replacement is complete, then the new cache and resolved proxy swap atomically.

Initial preset names should stay modest until tuned against a real corpus. A reasonable starting set is **Photo / Fine**, **Photo / Mixed**, **Render / Fine**, **Render / Coarse**, and **Custom**, with **Photo / Fine** as the default candidate.

Noise size is preset-driven because it is usually stable enough to choose once, but it is not universally constant. Sensor noise is fine-grained; demosaic can create larger chroma structures; resampling and compression change apparent scale; Monte Carlo render noise has different structure. If profiling later proves that size only changes cached-band weights, it may graduate to a live control.

### 2.3 A/B must be immediate

The geometry-corrected original proxy is always retained. Once analysis exists, the resolved denoised proxy is retained too.

- **Off** selects the original proxy.
- **On** selects the current resolved denoised proxy.
- Toggling does not run analysis or reconstruction.
- The Off route uses the untouched established shader/pipeline, not a per-pixel `if (denoiseEnabled)` added to its hot path.

The canvas rectangle, source identity, zoom, scroll position, and 200% inspection point never change during a toggle, recalculation, or cache handoff.

## 3. Processing order

The user may adjust denoise late in the finishing workflow, but its processing position should be early:

```text
decode and normalize to scene-linear ACEScg
    -> stable preview proxy
    -> geometry
    -> wavelet analysis / denoise source selection
    -> Exposure and global tone
    -> Color
    -> Local adjustments
    -> Film effects and vignette
    -> output resize / sharpen where applicable
    -> authored grain
```

This placement is intentional:

- **After geometry:** the cache represents the image the user actually sees, and the existing CPU/GPU boundary already provides a geometry-corrected source. Geometry changes are infrequent and may explicitly invalidate analysis.
- **Before Exposure and Color:** ordinary grading remains independent of denoise. Putting analysis after grading would make those controls invalidate it or would analyze creatively amplified noise.
- **Before structure, sharpening, film, and grain:** later operations must not sharpen noise before removal, and authored grain must never be mistaken for source noise.

HDR Finisher currently receives an already developed and normalized RGB source. Therefore v2 is a universal scene-linear RGB wavelet denoiser, not a darktable-style camera-profiled RAW redevelopment stage.

Processing order and UI order are separate concerns. It is fine for Denoise to appear as a finishing tool while executing before the grade.

## 4. Wavelet model

### 4.1 What is cached

A wavelet decomposition separates an image into a smooth low-frequency base and signed detail coefficients at several spatial scales. These are not binary masks. They describe how image values differ from coarser representations.

The implementation should derive a compact set of removable-noise residuals, such as:

- fine and medium luminance residuals;
- fine and medium chroma residuals;
- an ambiguous detail/noise residual used by Detail Recovery.

The exact coefficient shrinkage and edge/detail confidence math must first be defined in a deterministic CPU reference. The GPU implementation must preserve those semantics.

A conceptual live resolve is:

```text
removed = amount * (
    luminance * cachedLumaResiduals
  + colorNoise * cachedChromaResiduals
  - detailRecovery * cachedCoherentDetail
)

denoised = original - removed
```

The production formula will need bounded weights and safeguards, but the architectural rule is fixed: live controls combine cached evidence; they do not repeat analysis.

### 4.2 HDR and color requirements

Analysis and reconstruction operate in the documented scene-linear ACEScg working space. They must:

- preserve negative finite values where the pipeline permits them;
- preserve values above reference white;
- avoid normalization to `[0, 1]`;
- avoid display-referred gamma-space filtering;
- keep neutral settings equivalent to the original source within the defined precision tolerance;
- keep authored HDR and SDR lane behavior explicit and testable.

Luminance/chroma separation must be numerically defined for the working space rather than borrowed from an 8-bit display-referred algorithm.

## 5. Runtime architecture

```text
geometry-corrected proxy -----------------------------> original proxy
           |
           +-> structural wavelet analysis -> cached residual pyramid
                                                  |
live slider weights ------------------------------> fast GPU resolve
                                                  |
                                                  v
                                           denoised proxy

original/denoised source selector -> established grade -> scopes -> presentation
```

There are two execution classes:

1. **Analysis:** expensive, asynchronous, and run only when the source, geometry, proxy identity, algorithm, or locked analysis settings change.
2. **Resolve:** a small GPU pass that recombines cached residuals when a live denoise slider changes.

The resolved denoised proxy is itself cached. Moving Exposure, Color, Curves, Film controls, locals, or scopes must reuse it; those changes run neither analysis nor denoise resolve.

### 5.1 Cache identity

The analysis key contains only inputs that truly affect analysis:

```text
session/source identity
authored lane identity
proxy long-edge tier
geometry signature
analysis preset or custom structural values
denoise algorithm/version
```

Live weights are not part of the analysis key. They belong to the resolved-proxy key/state.

### 5.2 First use and recalculation

On first Enable, if no valid cache exists, retain the original image while building the default analysis asynchronously. The UI reports that denoise is preparing; it does not resize or replace the canvas. Completion creates the first resolved proxy and swaps it atomically.

For later structural changes:

1. edit a preset or custom value;
2. mark the analysis dirty without disturbing the current image;
3. press **Recalculate Denoise**;
4. build a new cache in the background;
5. discard stale completions and atomically install only the latest result.

Scopes continue to describe the currently presented source. They do not churn during analysis and update normally after the atomic swap.

### 5.3 Isolation from the baseline hot path

The denoise-enabled source route and its resources are created lazily. With denoise unused or Off:

- allocate no coefficient textures or denoise intermediates;
- dispatch no analysis or resolve pass;
- add no denoise work to encoded-preview requests or scope scheduling;
- preserve the established base shader and presentation behavior.

Before implementing wavelets, benchmark a selector-only seam using two known test textures. This proves source selection and atomic handoff without confusing integration overhead with denoise math.

## 6. Proxy scale, zoom, and tiling

The first implementation uses the existing stable 1K/2K/4K proxy tiers. A 4K proxy is the authoritative interactive denoise source at the 4K tier. At 200% zoom the user is inspecting enlarged 4K pixels, not requesting a hidden full-resolution denoise job.

Do not build an interactive ROI or source-resolution tile scheduler for v2. It adds invalidation, seam, handoff, and viewport risks before evidence says it is necessary. Revisit it only if real-device testing proves a 4K cached result is inadequate.

Full-resolution export is different: it may later use internal tiles or strips with correct halos to bound memory. That implementation detail must never leak into interactive zoom or canvas ownership.

## 7. Memory contract

Memory is a first-class acceptance criterion. A 4096 × 3072 RGBA16F texture is approximately 96 MiB. Original plus resolved proxies are already about 192 MiB before coefficients, scratch storage, the established grading pipeline, or authored lanes.

A naïve undecimated pyramid with five full-resolution RGBA16F bands would add roughly 480 MiB and is not acceptable. Prefer:

- a decimated/mip-like pyramid, whose total samples approach about 4/3 of one full-resolution image;
- packed precision appropriate to the evidence, for example `r16float` luma and `rg16float` chroma only after accuracy tests;
- reusable scratch textures;
- caches for only the active source/lane/tier;
- a measured per-device GPU byte budget and graceful allocation failure;
- explicit eviction of inactive tiers/lanes before the active coefficient cache.

Once built, coefficients for the active document, lane, and preview tier remain resident while interactive denoise controls are in use. Evicting them on every panel close would break the slider contract. Any constrained-device fallback, such as offering a 2K analysis instead of 4K, must be explicit and tested rather than a silent quality change.

Measure the current pipeline's real GPU footprint before choosing the final representation. The estimates above are guardrails, not proof that a particular device has enough headroom.

## 8. Export contract

Full-resolution export comes only after interactive isolation passes. It uses the same semantic analysis settings and live weights through a deterministic CPU reference or a proven equivalent implementation.

- Process the full-resolution normalized source, never upscale the preview proxy.
- Bound memory with strips/tiles and sufficient multiscale halo, or another proven bounded decomposition.
- Preserve scene-linear HDR range and authored HDR/SDR relationships.
- Match GPU preview behavior within documented tolerances.
- Keep resize/sharpen ordering deliberate and keep authored grain after denoise.

Export must not be added while preview performance or viewport stability is still unresolved.

## 9. Implementation sequence and stop gates

Each phase stops for measurement and review before the next one begins.

### Phase 0 — Baseline and selector seam

- Record real Electron timings, frame cadence, GPU memory, and viewport state on representative ORF, TIFF, and EXR documents at 1K/2K/4K.
- Add instrumentation that distinguishes analysis, resolve, grading, scopes, proxy requests, allocations, and presentation.
- Implement and benchmark only the lazy source selector and atomic swap.
- Verify that the unused/Off path remains the existing pipeline with no hidden denoise resources or work.

Implementation note, August 25, 2026: the diagnostic seam lazily retains an original geometry-corrected proxy and one known resolved test texture, switches the pre-grade bind source without changing the established WGSL grade shader, and records proxy, allocation, grading, scope, presentation, selector, analysis, and resolve telemetry. Packaged Electron runs passed the ORF, TIFF, and EXR 1K/2K/4K selector gates on an NVIDIA Lovelace adapter. The ORF measurements used `P2160774.ORF` read-only from the user-authorized external photo corpus. Phase 0 is accepted.

### Phase 1 — CPU reference

- Define one deterministic compact decimated wavelet decomposition.
- Define luminance/chroma residual extraction, coherent-detail evidence, shrinkage, and reconstruction.
- Add neutral, finite-value, negative-value, HDR-headroom, residual, and repeatability tests.
- Validate photo and render samples before optimizing.

Implementation note, August 25, 2026: `hdr_finisher.denoise_reference` defines the deterministic `compact-haar-residual-v1` reference. It uses a two-level decimated 2x2 Haar pyramid, ACEScg AP1 luminance coefficients, `R-Y`/`B-Y` chroma components, explicit preset noise sigmas scaled analytically per Haar level, bounded removable-coefficient confidence, one coherent-detail scalar per coefficient, and reconstruction-only live weights. Noise sigma is a locked analysis setting rather than a live control; this avoids a non-portable global median/readback step in the WebGPU port. The reference retains signed float32 values without range normalization or display transfer functions. Neutral, finite-value, negative-value, HDR-headroom, cache-size, repeatability, luma/chroma independence, synthetic photo, synthetic render, real ORF, and linear EXR checks pass. Phase 1 is accepted for the Phase 2 port; preset tuning remains deferred to Phase 4.

### Phase 2 — WebGPU analysis cache and resolve

- Port the approved reference semantics to lazy WebGPU analysis.
- Implement narrow cache keys, reusable scratch storage, memory accounting, cancellation, and atomic latest-wins installation.
- Keep one default preset until the cache and live resolve pass all performance gates.
- Cache both the original and resolved denoised proxies.

Implementation note, August 25, 2026: `compact-haar-residual-v1` is ported to two WebGPU analysis dispatches and one direct two-level reconstruction dispatch. The persistent cache is six decimated `rgba16float` evidence textures plus one full-size resolved `rgba16float` proxy; analysis scratch is destroyed after queue completion, live resolves reuse the resolved allocation, and failed/stale candidates are destroyed without replacing the last valid selector. CPU/GPU comparison over 768 RGB samples has maximum absolute error `0.0009765625` (tolerance `0.002`). Final packaged ORF measurements on an NVIDIA Lovelace adapter were: 1K analysis-to-present `49.1 ms`, resolve p95 `5.5 ms`; 2K `89.8 ms`, `14.8 ms`; 4K `209.9 ms`, `22.8 ms`. All live thresholds, latest-wins checks, unrelated-grade isolation, scope thresholds, and zero encoded-preview-request checks pass. Logical denoise residency is `11.6 / 46.4 / 185.6 MiB` at 1K/2K/4K, while total instrumented pipeline residency is `44.5 / 159.3 / 594.9 MiB`. These are resource-size totals, not driver heap measurements. The missing explicit per-device budget prevents final Phase 2 acceptance.

### Phase 3 — UI and document integration

- Add the four live sliders and locked preset/recalculation workflow.
- Add Preparing, Ready, Dirty, Recalculating, and recoverable Error states.
- Persist settings with explicit schema/version semantics without broadening unrelated adjustment signatures.
- Test rapid toggling, dragging, zooming, scrolling, lane switching, scopes, reload, and proxy-tier changes.

Implementation note, August 25, 2026: the current branch adds lane-specific, schema-versioned denoise settings; the four reconstruction-only controls; a locked Photo / Fine preset; explicit Recalculate; A/B; and Off, Preparing, Ready, Dirty, Recalculating, and recoverable Error states. The active 1K/2K/4K tier is pinned while its original/resolved pair is retained, and switching to an inactive lane evicts the previous lane's coefficient/resolved cache. Source and packaged ORF UI runs pass at every proxy tier, including 200% zoom/scroll stability, rapid reversal, A/B, preset/recalculate, Exposure isolation, lane eviction/restoration, and retained-original disable. Backend tests cover schema validation, undo/redo, project round-trip, and RAW-redevelopment preservation. This phase is implemented for evaluation but is not accepted ahead of the unresolved Phase 2 memory stop gate.

### Phase 4 — Corpus tuning and additional presets

- Tune a small photo/render corpus across fine noise, coarse chroma, smooth gradients, skin, foliage, stars, text, CG edges, and HDR highlights.
- Add presets only when they correspond to measurably different analysis behavior.
- Profile memory/device classes and define any explicit quality fallback.

### Phase 5 — Full-resolution export parity

- Add the memory-bounded full-resolution implementation.
- Validate preview/export parity, edge halos, seams, HDR range, output order, and 24–42 MP memory behavior.

Do not add local denoise masks, neural models, multiple algorithms, or source-resolution interactive tiling between these phases.

## 10. Acceptance gates

All timings are measured in the packaged Electron application on named reference hardware, not inferred from headless tests.

### Disabled and unrelated-control behavior

- Denoise unused/Off allocates no denoise resources and dispatches no denoise work.
- Off output follows the established source route, with any transport tolerance documented.
- Existing visible sliders preserve the pipeline baseline: p95 response no worse than 50 ms, first scope no worse than 100 ms, settled scope no worse than 250 ms, no encoded-preview requests, and no stale final scope.
- With a resolved denoised proxy selected, unrelated grade controls run no wavelet analysis or resolve. Their p95 regression should remain within 10% of measured baseline unless a tighter measured threshold is adopted.

### Interactive denoise behavior

- Enable/Disable presents the selected cached source on the current or next animation frame and records zero analysis/resolve calls.
- Live denoise sliders target p95 resolve-to-present of at most 16.7 ms at 1K/2K and at most 33 ms at 4K on reference hardware, with no main-thread stalls or interaction queue buildup.
- Rapid slider reversal is latest-wins; releasing a control cannot present an older value afterward.
- Recalculation keeps the old valid frame interactive, accepts cancellation/replacement, and installs only the newest cache.

### Stability and correctness

- Zoom, scroll, CSS canvas rectangle, aspect ratio, and inspection point remain unchanged across toggles, recalculation, completion, lane changes, and 1K/2K/4K transitions.
- Rapid A/B at 200% does not trigger analysis, tier swaps, or encoded preview work.
- Scopes match the presented original or denoised source and settle without stale results.
- Device loss, allocation failure, project reload, undo/redo, and document switching recover without corrupting the base pipeline.
- Neutral resolve matches the original within the defined precision tolerance.
- CPU and GPU references agree within documented numerical and visual tolerances.
- Residual inspection shows targeted noise rather than coherent edges, texture, color boundaries, or HDR highlight structure.
- Peak and sustained GPU memory remain within the explicit device budget at every supported tier.

If a phase fails one of these gates, isolate and fix that phase. Do not compensate by adding more caches, algorithms, preview requests, or UI complexity.

## 11. Explicitly out of scope for v2

- camera/ISO profile databases and RAW re-development;
- darktable-style camera-domain profiled denoise parity;
- NLM, BM3D, OIDN, ONNX, or other neural modes;
- local denoise masks or one denoiser per local layer;
- interactive full-source ROI/tile refinement;
- downloadable models or multiple selectable engines;
- sophisticated recovery of externally authored grain;
- full-resolution export before interactive gates pass.

These may be researched later, but they must not broaden the first wavelet-cache implementation.

## 12. Why this differs from darktable and RawTherapee

darktable's pixelpipe and profiled denoise demonstrate two useful principles: module order matters, and wavelet modes can separate multiscale luma/chroma treatment. darktable can place denoise early because it owns camera-domain RAW development and camera/ISO noise profiles. HDR Finisher currently begins from an already developed, normalized RGB source, so copying that exact stage or profile model would be false precision.

RawTherapee likewise offers multiscale luminance/chrominance controls and preview considerations, but its editor owns a different RAW pipeline and processing graph. The transferable lesson is to separate expensive analysis from cheap parameter application—not to reproduce its module wholesale.

Useful background:

- [darktable pixelpipe and module order](https://docs.darktable.org/usermanual/development/en/special-topics/pixelpipe-and-module-order/)
- [darktable denoise (profiled)](https://docs.darktable.org/usermanual/development/en/module-reference/processing-modules/denoise-profiled/)
- [RawTherapee Noise Reduction](https://rawpedia.rawtherapee.com/Noise_Reduction)

## 13. Rollback record that must remain visible

The August 25, 2026 authored-image prototype was fully rolled back. Manual Electron testing showed severe slider lag at 1K even when denoise had not been used, plus proxy-tier/viewport instability during denoise updates. Restoring the pre-denoise frontend, shader, model, and backend restored responsiveness.

This proves that the former integration and hot-path shape was unacceptable. It does **not** prove that bilateral math alone caused the failure; the exact low-level bottleneck was not isolated. The selector-first sequence and instrumentation gates above exist to prevent that ambiguity from recurring.

There is currently no authored-image denoise stage in import, preview, grading, locals, or full-resolution export.

The separate JPEG Ultra HDR delivery-only gain-map cleanup remains active. It filters generated gain-map data during publishing and must never be described or reused as authored-image denoising.
