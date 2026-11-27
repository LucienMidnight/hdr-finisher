# Image-Processing Pipeline: Technical Contract

**Status:** Current implementation reference for contributors and AI coding agents.
**Verified tone/order changes:** November 16, 2026, `feat/watermark-and-library-polish` (N1/N2). Other historical sections retain their stated scope.
**Scope:** Import, working representation, HDR/SDR grading, local adjustments, preview, scopes, proof, export, caching, and rules for adding image operations.

This document explains the pipeline as it runs today, including the reasons behind its ordering and performance architecture. It is deliberately more implementation-oriented than the [color-pipeline specification](../concepts/color-pipeline.md) and more image-path-specific than the [system architecture](architecture.md).

When this document disagrees with running code or tests, code and tests win. Update this page in the same change. The repository's broader authority order is active code/tests, reproducible evidence, validation records, user documentation, then PRDs and design history.

**Linked SDR, November 16:** whole Match first fits the common HDR creative
scene and the trial's SDR output tail. Only the selected fit passing all
safeguards links; otherwise the independent generated/authored paths below
remain current. The linked branch evaluates HDR Tone/colour, ordered HDR locals
and Film once, then converts/scales that scene into SDR, applies the explicit
SDR output exposure, delivery finishing, SDR HC and gamut boundary. It skips
all independent SDR pre-Film controls and locals. HDR's output stage is unchanged.
Linked ordering alone measures inversions beyond those already in the Match
target using the same eight bins and .005 allowance. [Current Match contract](sdr-match.md#current-recipe-and-output-contract).

## November 19: signed channels at the SDR gamut boundary

After the SDR shoulder, negative linear sRGB channels go to black before
conversion to OKLab at any brightness. In affected pixels, a toe eases
small positive channels into zero and joins the identity curve at the
smaller of the negative excursion or 0.001 linear sRGB. Its width tends to
zero at the nonnegative boundary. Legal colours bypass it, and excursions
above SDR white still use the adaptive OKLab projection. A tie at the
blue vertex uses the same cusp as nearby nonnegative colours so rounding
cannot cause a jump between CPU and WebGPU. The same rule applies to
generated, authored and Linked SDR. Signed editing stages and the HDR
delivery ceiling remain intact.

## November 16 N2: global Tone and aligned wheel ranges

Global Tone is now one frozen-guide operation: Blacks, Shadows, Midtones,
Highlights and Whites, after Exposure Bands/foundation and before HSL, curves,
wheels, locals and Film Look. Blacks no longer runs in the early exposure
helpers. CPU, GPU preview, Library and delivery share the order and conservative
parameter-only limiter; zero is an exact bypass. No texture/budget/tolerance
changes. Finished Library thumbnail/screen-preview versions advance so old
finished pixels are not reused.

`D_HDR=.18`, `G_HDR=.0324`; `D_SDR=100/203`, `G_SDR=.18*100/203` in the
lane's linear units. Authored SDR shares the latter without another placement.
`P_HDR=target_nits*.18/project_reference_white_nits` even with HC bypassed;
`P_SDR=1`. Center/Width defaults: Shadows −1.5/5 EV, Midtones 0/4 EV,
Highlights HDR +2.25/4.5 EV, SDR +1.75/3.5 EV. Wheels use the same `log2(Y/G)`
selection in both lanes, including locals and Match translation.

This intentionally changes non-zero global Blacks/zones and non-neutral wheel
grades. Local Tone curves and full Match rebuild are N3a; range preview is N3b.
See [the built tone design](briefs/tone-endpoints-design-2026-11-15.md) for
weights, endpoint overlap, calibration and limiter derivation.

## November 15 N1: final cap and delivery finishing

Both SDR paths retain signed/above-white headroom through creative controls
and Film Look, then resize and sharpen before Highlight Compression and the
unconditional gamut boundary. SDR output sharpening uses an extended sRGB
signal rather than clipping its guide at white; pixels whose limited
sharpening correction is zero retain their original RGB. CPU/GPU share this
rule. Extreme neutral-paper output uses scaled half-float GPU storage, as HDR
already did; no texture size or memory budget changes.

## November 15 W3: SDR headroom boundary

Wheels edit their weighted ranges without limiting RGB. SDR contrast keeps
above-white RGB through its luminance-only gain. Film Look's final strength
mix, structure and vignette also keep headroom. Finished SDR passes through
the existing hue-preserving adaptive OKLCh sRGB gamut mapper, replacing
independent channel clipping. N1 moves the SDR shoulder after Film Look and all finishing, immediately before the final gamut mapper.
Preview/scopes map after film/vignette; delivery defers the same mapping
until after resize/sharpening. Bypassing the shoulder still produces legal
SDR white and gamut. HDR's exact delivery ceiling is unchanged.

This is an intentional output change. Match now fits Peak Detail against the
finished highlight region as well as fitting its ordinary body controls. The
existing +0.5 EV white-area-growth guard passes at 0.410 percentage points
versus the unchanged 1.000 allowance; the normal matched colour gate also
passes. This is recipe fitting, not another render stage or a modified gamut
mapper. See the November 15 W3 record in [Grade](../product/modules/grade.md).

## 1. The shortest correct mental model

```text
source file
  -> format-specific decode and source corrections
  -> one normalized float32 scene-linear ACEScg source (signed for RAW)
     (+ an independent display-linear sRGB authored SDR source when supplied)
  -> session + bounded source-proxy/cache state
  -> geometry
  -> HDR or SDR global grade
  -> ordered local grades
  -> Film Look (negative/development with density grain, paper/scan) and spatial finishing
  -> vignette
  -> delivery resize/sharpening when delivering
  -> final Highlight Compression and delivery gamut boundary
  -> preview/scopes OR delivery encoding
```

The application has two renderers with different jobs:

- The CPU/NumPy path is the numerical authority for proof and export.
- The WebGPU path mirrors the grade for low-latency authoring preview. Unsupported GPU work must fall back; it must not silently change the result.

The source, proxy, viewport, and output size are separate concepts. A proxy can change resolution without changing the crop, zoom, scroll position, canvas geometry, or export dimensions.

## 2. Non-negotiable invariants

Future changes should preserve these unless a deliberate architecture migration replaces them with measured evidence and updated tests.

1. **Normalize once.** The retained HDR working source is H×W×3, scene-linear ACEScg/AP1 D60, `float32`. RAW sources retain signed samples, including noisy readings below sensor black. Do not repeatedly decode, develop RAW, convert color spaces, or copy the full source during ordinary grading.
2. **Keep authored SDR independent.** A gain-map source may retain a separately decoded display-linear sRGB SDR base. It is not merely a fresh tone map of HDR and must survive project-reference-white changes.
3. **Proxy before grade.** Interactive CPU work downsamples the source before expensive grading. Never place an unconditional full-resolution filter in the per-slider path.
4. **Geometry precedes creative grading.** Masks are evaluated against a fixed, geometry-transformed source. A later grade must not move its own selection boundary.
5. **Order is semantic.** HDR, generated SDR, and authored SDR are different branches. Locals run in list order. Film effects, vignette, and grain occupy deliberate positions.
6. **Grain develops inside Film Look.** Density grain is resolved in the negative before paper/scan and the Look Strength mix. Delivery resize/sharpening resamples the completed film; no separate grain pass follows it. Final Highlight Compression follows delivery finishing.
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
| Range | signed for RAW; HDR values may exceed 1.0; non-RAW decoder contracts are unchanged |
| Scene anchor | 0.18 equals project HDR Reference White, normally 203 nits or optionally 100 nits |

PQ and HLG sources first become absolute luminance, then project-relative scene values, then ACEScg. This preserves absolute luminance when decoder and project reference whites differ. The generated SDR branch's creative `0.18 -> approximately 0.493` anchor is separate; it is not a physical 100-nit conversion.

For supported Bayer RAWs, **Pixel cleanup → Remove hot pixels** is an optional
per-photo source-development operation, off by default. The order is unpack →
signed per-phase black/white normalization → cleanup → Opposed color highlight
reconstruction → WB/AHD → camera/ACEScg → Edge colour → Denoise. It is not a
post-demosaic RGB speck filter. X-Trans, linear DNG and non-RAW sources do not
offer it.

`raw_pixel_cleanup.py` owns the four per-CFA-phase single-frame noise fits and
shared thresholds. Compare the center with all eight same-phase neighbors:
excess >max(8σ, 0.02), with variance `a*max(center,0)+b+DN_step²/12`.
An adjacent other-colour rise >max(2.5σ, 2 DN), relative to that site's
same-phase median, preserves the candidate. Preserve 5×5 context ≥0.98 and
the four-pixel border. Repair with the mean of the most consistent opposite
pair, tie order horizontal, vertical, then diagonals; all decisions read the
original mosaic. No camera defect maps, cold-pixel mode or adjustable strength.

CPU sensor edits use 256-row normalized strips and preserved four-row original
seam context, re-encoding only repaired sites into LibRaw's DN buffer. GPU
normalization reads the immutable packed mosaic with the same profile/threshold
uniform; no extra full-frame image is allocated. Both feed repaired samples to
clipping evidence and signed AHD. Off skips profile estimation and selects the
unchanged normalization shader. An unavailable noise fit is a no-op. The entire
RAW recipe is saved and included in source/development identities; cleanup
changes and their Undo/Redo re-develop the source rather than reusing old pixels.
Finished CPU/GPU agreement remains mean <1, p99 <3 (SDR ΔE2000 / HDR ΔE ITP);
the new parity driver awaits the combined real-GPU validation.

RAW source conversion preserves finite negative channels instead of applying the
import-time neutral-axis projection. Bayer black subtraction and AHD use signed
sensor-DN intermediates; the upper DN transport limit remains 65,535. White
levels, camera white balance, calibration and lens correction order are unchanged.
X-Trans still uses its existing unsigned LibRaw demosaic and is an explicit open
qualification/implementation gap, not a signed-Bayer fallback.

Signed RGB reaches source analysis, adaptive Denoise model setup and filtering,
HDR/generated-SDR exposure, local stacks, Detail, Film strength/structure mixing,
vignette and delivery resampling/sharpening. Positive peak, variance and log-luma
guides do not overwrite that source. Independently authored SDR retains its
existing contract. Negative Blacks deliberately crushes to black; Film physical
exposure/density inputs remain nonnegative. Final output-gamut mapping and codec
input bounds still floor finished light. Every pre-encode HDR path must stay at
or below the exact target; only encoded re-decode has the 1% rounding allowance.

NaN/Inf, malformed dimensions and out-of-range half-float handoffs remain invalid.
Finite negatives are not GPU errors. Signed half transport checks both absolute
ends against 65,504 instead of silently clipping; ordinary RGB decoder/storage
policies are not broadened by this change. Source, source-colour, developed scene,
Denoise measurement and finished-picture identities invalidate clipped caches.
Saved controls are kept, with no old-renderer/migration path.

November 17 integration is not release-qualified: real-device RAW/Denoise/stage,
Proof/export/encoder-ceiling comparisons and cross-platform packaging remain
required. The full covering slow-test group exceeds the 30-minute approval gate.

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
| 1 | Exposure, contrast/pivot | Scene-linear ACEScg tone foundation |
| 3 | White balance, ACEScg primaries/tint, saturation/vibrance | Scene-referred color |
| 4 | Tone equalizer / Exposure Bands | Scene-EV bands |
| 5 | Frozen-guide five-control Tone, then HSL | Global endpoint and broad-zone shaping |
| 6 | Shared-domain curves | Global curves |
| 7 | Global color grading and Detail | Global creative grade before locals |
| 8 | Ordered local layers | Each layer grades and blends the running result using a stable source mask |
| 9 | Lens Filter | Energy-conserving film-plane PSF, or None bypass |
| 10 | Film Resolution | Fine-detail scatter before the negative |
| 11 | Halation | Fixed-threshold coloured edge scatter |
| 12 | Negative/development and grain | Grain perturbs developed film density |
| 13 | Paper and scan | Slides skip paper; Scan Sharpening and Lab Levels; one Look Strength mix |
| 14 | Detail structure and Vignette | Independent finishing after Film Look |
| 15 | Delivery resize and output sharpening (when delivering) | Resample the completed film, including its grain |
| 16 | Highlight Compression (Peak Fit, Fixed cap, Soft Ceiling or Clip), then delivery-primary ceiling | Final target after creative work and finishing |

With Highlight Compression enabled, the final HDR target is a delivery guarantee; the existing encoded-file ceiling checks remain unchanged.

### 5.2 Generated SDR lane

Generated SDR starts from the ACEScg HDR source:

1. SDR exposure in scene-linear ACEScg.
2. Independent SDR scene color adjustments.
3. Apply the fixed SDR placement where scene-linear `0.18` maps to display-linear `100/203`.
4. Convert with CAT02 to display-linear sRGB.
5. Retain the placed linear-sRGB headroom; no early shoulder or gamut mapping.
6. display-linear tone equalizer / Exposure Bands.
7. contrast.
8. frozen-guide five-control Tone, then HSL.
9. Shared-domain curves.
10. global color grading and Detail.
11. ordered local layers.
12. lens filter, film resolution, halation, negative and density grain, paper/scanner, one Look Strength mix.
13. Detail structure and vignette.
14. output resize/sharpening when delivering, then Highlight Compression and unconditional hue-preserving sRGB gamut mapping to `[0, 1]`.

The scene-to-display conversion boundary is important. Moving a scene-linear control after it changes both its numerical meaning and its visual behavior.

### 5.3 Authored SDR lane

When a source contains an authored SDR rendition, the branch begins from its retained display-linear sRGB pixels:

1. apply geometry to the authored SDR source;
2. exposure and B&W;
3. retain display-linear headroom (no early Highlight Compression);
4. tone equalizer;
5. contrast;
6. temporarily convert sRGB to ACEScg for scene-color operations, then return with headroom retained;
7. frozen-guide five-control Tone, HSL, curves, global color grading and Detail;
8. ordered local layers;
9. Film Look, including negative/density grain before paper/scan, and spatial finishing;
10. vignette;
11. output resize/sharpening when delivering, then optional Highlight Compression and unconditional hue-preserving sRGB gamut mapping to `[0, 1]`.

Do not collapse this branch into generated SDR. The authored base is a distinct creative endpoint in a gain-map source. Existing SDR grades intentionally render through the new final-shoulder order; there is no compatibility renderer.

### 5.4 Local-layer internal order

Within one local layer, the CPU applies its supported tone/zone/exposure/contrast operations, then white balance/saturation, curves, and color grading before blending with `mask × opacity`. SDR color work temporarily uses ACEScg where required. Layers are sequential and therefore generally non-commutative.

#### Shared global and local curves

HDR enters the curve stage as scene-linear ACEScg. Both generated and authored
SDR enter through the CAT02 linear-sRGB-to-ACEScg matrix divided by
`SDR_SCENE_TO_DISPLAY_SCALE`, then return through the other matrix and multiply
by the same scale. Off or all-neutral curves bypass those conversions exactly.

The shared graph uses `log1p(v / .004) / log(901)` for positive scene values
and the matched linear tangent through zero below black. Decode uses the
inverse. Scene reference white is always 0.18. A 1,024-sample monotone cubic LUT
is linearly interpolated and extended outside its graph using the two closest
samples at either endpoint. Luma uses AP1 weights, applying a neutral black
floor plus a luminance gain above 1e-5 and an additive correction at or below
1e-5. R, G and B map individual AP1 channels. Signed and above-white pixels
remain available to the later finishing stages. The old HDR transfer belongs
only to the film-response helpers, not to editable curves or Tone.

### 5.5 Film and grain separation

`_apply_film_look` applies the lens filter, film resolution, halation, negative/density grain, paper/scanner and the single master mix before Detail structure. Grain is developed inside Film Look, not dispatched after vignette or regenerated after delivery resizing. Delivery resize/sharpening resamples the completed film before final Highlight Compression. Export and full-size Proof use the same CPU reference.

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
  -> lens filter (27 weighted separable Gaussian components on the quarter grid)
  -> film resolution, then halation
  -> negative + density grain, paper/scanner
  -> one Look Strength mix, then Detail and vignette
  -> display mapping and diagnostic overlay
```

The global shaders mirror the CPU branch order and parameter meanings. Global and local curves use the same evaluator. An unsupported GPU route or device loss falls back to CPU. A GPU approximation must not pretend to be authoritative when parity is unknown.

RGBA16F transport is preferred when the proxy is finite and representable; RGBA32F is the fallback. Rows are packed to WebGPU's alignment requirements. Proxy textures are retained at no more than two levels per lane and concurrent fetches are deduplicated.

GPU delivery finishing owns each texture and buffer immediately after allocation. Local cleanup releases completed scratch; job cleanup releases anything left by allocation, pipeline compilation, binding, cancellation or encoder-handoff failure. Readback strips use 256-byte-aligned rows and remove padding before handing float samples to the encoder. Shaders, admission budgets and finishing order are unchanged by this ownership rule.

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
2. `apply_adjustments(..., include_grain=True, include_output_highlight_compression=False)` at full source resolution, developing grain inside Film Look;
3. apply output resizing, then edge-aware sharpening;
4. apply final output Highlight Compression and the delivery gamut boundary;
5. transform to the delivery color encoding and encode;
6. validate/independently decode where required;
7. atomically replace the destination with the completed artifact.

HDR delivery is ACEScg to linear BT.2020, scene values to absolute nits using project reference white, then PQ. Apply codec-specific 203-nit conventions exactly once at the named codec boundary. SDR delivery encodes the processed linear-sRGB branch to sRGB.

Gain-map outputs render matched full-resolution HDR and SDR endpoints independently. Proof creates and reads an encoded artifact, inspects its metadata, and reconstructs the actual base/alternate relationship at the requested headroom; it is not simply a screenshot of the authoring canvas.

### JPEG Ultra HDR gain-map cleanup is not image denoising

The JPEG Ultra HDR exporter currently performs a bounded, SDR-guided filter on the generated logarithmic gain map before repacking/validating the delivery file. This changes publishing metadata/residual data only. It does **not** denoise the authored HDR image, the authored SDR image, the working source, preview, or grading pipeline. Refer to it as **delivery-only gain-map cleanup** to avoid confusing it with the reverted authored-image denoiser.

## 10. Denoising rollback and historical isolation design

**November 26 status:** the rollback below is history. Authored-image Denoise
is implemented for preview and delivery. Simple uses `adaptive-atrous-v1`,
Clean Grain adds brightness-grain fitting and colour cleanup, and experimental
Micro Grain develops signed Bayer samples before its scene-light stage.
`denoise_measurement.py` owns shared measurement identities; the source stage
precedes ordinary creative grading. See the [Denoise module PRD](../product/modules/denoise.md)
for current controls, defaults and supported routes. The old Haar-cache worktree
snapshot and proposed sequence below do not describe the shipping algorithm.

### 10.1 Established facts

The first shared interactive authored-image denoising implementation was removed on August 25, 2026. The surviving rollback record is in the [main PRD](../product/archive/HDR_Finisher_PRD_v1.2.md#denoise-implementation-rollback-2026-08-25). The prototype itself was reverted before a durable implementation commit, so its exact removed code is not an authoritative source.

Observed failures were:

- all grading sliders became noticeably laggy at 1K even when denoise had never been enabled or adjusted;
- preview presentation became unstable: changing Exposure could make the image appear to zoom out;
- 1K/2K/4K and interactive/settled handoffs changed viewport scale instead of replacing pixels within a stable view;
- restoring the pre-denoise frontend, WebGPU shader, adjustment model, and backend restored responsiveness.

That evidence establishes an integration regression. It does not, by itself, prove which single line or algorithm caused it. Likely causes such as unconditional generalized shader/state overhead or coupling proxy dimensions to layout are useful hypotheses, not historical facts.

The August 2026 `feature/denoising` worktree snapshot contained an interactive authored-image denoising stage after geometry and before the established Exposure/Color/Film/local pipeline. It lazily analyzes the active 1K/2K/4K geometry-corrected proxy into a compact two-level Haar residual cache, retains both original and resolved proxies, and lets the four live controls reconstruct without analysis. The stage is absent from full-resolution export, and a never-enabled Off document retains the established pre-denoise route with zero denoise allocations or dispatches. The separate Ultra HDR delivery gain-map cleanup described above remains active and is not part of authored-image denoising.

The [Denoising v2 implementation contract](denoising.md) records the historical wavelet-cache direction, the implemented Phase 0–3 evidence, and the then-unresolved per-device memory-budget stop gate (subsequently closed, as that document records). Broader technology research remains non-normative.

### 10.2 Required gates before denoise returns

A future denoiser must not be implemented as “one more adjustment” until its execution class and cache boundary are explicit.

1. **Choose semantics first.** Decide whether it is source correction, a cached pre-grade preparation, a creative grade, or export-only processing. That choice determines its space, order, persistence, cache key, preview approximation, and scope behavior.
2. **Prove the off path.** With denoise disabled, route through the established pipeline before analysis, allocation, cache signature expansion, texture upload, shader pass, or scope invalidation. Compare output byte-for-byte or with an explicitly justified transport tolerance.
3. **Never re-develop RAW per edit.** Source-aware metadata/analysis may be computed once and cached. Ordinary sliders must not cause RAW decode, demosaic, or full-source denoise.
4. **Proxy before expensive interactive work.** The draft path operates on a bounded source proxy or a precomputed cached proxy product. Full-resolution filtering is reserved for explicit settle/export work with cancellation and bounded memory.
5. **Compute once, resolve many.** Cache one compact wavelet analysis per required source/lane/tier and let live controls recombine its residual evidence. Local denoise masks are out of scope for v2; a future local design must never run one denoiser per layer.
6. **Design CPU, GPU, scopes, and export together.** CPU defines the numerical contract. WebGPU must match or explicitly fall back. Scopes must analyze the same processed result. Export must state whether it recomputes at full resolution, how tiles overlap, and how Film Look grain is resampled before the final cap.
7. **Tile spatial algorithms with halos.** Full-resolution neighborhoods require bounded tiles/strips plus enough overlap to avoid seams. Track peak live bytes, not only final-array size.
8. **Keep viewport state independent.** A denoised or refined proxy carries source dimensions/aspect identity; it never owns CSS width, zoom, or scroll state.
9. **Preserve scheduler/backpressure behavior.** New work needs revision/generation checks, cancellation, latest-wins presentation, single-flight computation, and bounded queues. No image-sized readback fallback.
10. **Measure representative worst cases before landing.** Include 24 MP and 42 MP RAW/rendered sources; 1K/2K/4K preview; interactive, settle, lane switch, scope, proof, and export; GPU and CPU fallback; feature off and on; repeated edits; memory growth; cancellation and stale-result tests.

Minimum regression expectations remain the recorded preview budget: visible-slider p95 at or below 50 ms, first usable scope at or below 100 ms, settled scope at or below 250 ms, no encoded-preview churn during supported WebGPU grading, and no stale presentations. The August 9 validation record for this baseline and memory evidence is unavailable.

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
