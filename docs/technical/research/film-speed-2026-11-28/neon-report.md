# Making Film Look Feel Realtime — Rendering-Architecture Exploration

**Scope & basis:** Research only, no code changes or commits. Inspected merged sprint code on `sprint/cleanup-audit-2026-11-28` (`a6df0067`, including O1 `ee691ebe` and O4 `3583dd9a`), MacBook Neo (Apple A18 Pro, 8 GB unified RAM, `1408×794` points / `2816×1588` backing px) audit data, and prior A18 Pro GPU pass timings. No GPU runs were taken so the active main audit kept full priority on the GPU lock.

---

## Plain-Language Summary for Steve

### What Film Look costs today — and why

With Film Look off, dragging Exposure on a 24 MP or 50 MP photo at Fit updates in **~35–50 ms** (feels instant) and settles immediately (**~0 ms** extra). With Film Look on (Portra 400 + Black Pro-Mist + Halation + Grain + Print Contrast + Scan Sharpening, after the O1 speedup):

- **Dragging Exposure:** **~1,000 ms** to first visible update, **~750 ms** more to settle after you let go.
- **Dragging Film's own sliders** (Look Strength, Lens Strength, Halation, Grain, Print Contrast): **500–1,000 ms** to first update, **550–600 ms** to settle.
- **At 100% zoom on a 50 MP Sony:** **~7.2 s** for an Exposure drag and **~3.0–3.5 s** for Film's own sliders (pre-O1 baseline; still multi-second after O1).

**Why it is so slow — two giant culprits, plus three smaller leaks:**

1. **Film Grain is computed from scratch 16 times per pixel on settle (~520–560 ms at Fit).** To avoid shimmery grain when zoomed out, the shader simulates 16 sub-pixel samples of a 3-layer Poisson crystal field at every pixel (**~2.85 billion** crystal checks per Fit frame). While you drag, it silently drops to 1 sample (~22 ms) so the frame is faster — *but* that makes the drag frame "approximate", so the moment you release the mouse the app **throws it away** and spends another ~600 ms drawing the 16-sample version, visibly shifting the grain texture.
2. **Lens Diffusion (Black Pro-Mist / Glimmerglass / Pro-Mist / Cinebloom) runs 54 full-size blur passes (~150–250 ms at Fit on every Exposure/Tone/Denoise edit, and several seconds at 100%).** Each filter is built from 27 separate Gaussian blurs run one after another at full Fit resolution (`1283×855` — the app only drops to half resolution above `2048 px`). Even after O1 precomputed the tap weights, a single Exposure edit still runs **54 render passes** and **~3.05 billion** texture reads at Fit. At 100% zoom on 50 MP, the wide glow also inflates every `512×512` tile with a **300-pixel border** (`1112×1112` = **4.7× more pixels per tile** for every stage in the pipeline!).
3. **Why first feedback (~1 s) is even worse than settle (~0.6 s):**
   - Because each drag frame takes longer than the ~40 ms between mouse steps, earlier drag frames are already out-of-date by the time the GPU finishes them.
   - Because grain drops to 1 sample during drag, the app can **never** keep the last drag frame on release — you wait for the drag frame *plus* the full 16-sample settle frame (**~400 ms + ~600 ms ≈ 1.0 s**).
   - Dragging **Print Contrast** also asks the Python backend over HTTP to rebuild and re-send the stock's 3D tables (~220,000 numbers) on every notch of the slider, stalling the render before the GPU even starts.
4. **Stock colour/print runs up to 4 manual 3D table lookups per pixel (~15–25 ms at Fit, much more at 100%),** instead of using the GPU's built-in hardware 3D LUT sampler, and **Scan Sharpening** runs an unseparated 2D blur loop (up to 49 taps/pixel at 100%).

### How real-time photo & video apps solve this (DaVinci Resolve, Dehancer, Lightroom, FilmConvert, Apple Core Image)

None of those tools run 54 full-size blur passes, 2.85 billion procedural grain checks, or 4 software 3D table lookups per pixel. They stay at **60–120 fps** — with **dragging, settled preview, and export looking identical** — using three classic GPU building blocks:
1. **A mipmap blur pyramid** (1/2, 1/4, 1/8, 1/16, 1/32 resolution) for Mist and Halation: 12 tiny passes instead of 54 full-res passes (**~50× less work**).
2. **A pre-baked, mipmapped grain texture volume** (generated once from the same physical crystal math, stored as a small tileable 3D/layered texture): **1 hardware texture lookup** per pixel instead of 2,592 loops (**~300× less work**), with smooth anti-aliasing at every zoom level.
3. **One baked hardware 3D LUT** (`33³` or `65³` GPU 3D texture) for the film stock + print paper + contrast curve: **1 hardware lookup** per pixel instead of 4 software lookups, with Print Contrast morphed locally in <0.1 ms (no backend round trip).

---

## Ranked Options Table (Ordered by Steve's Direction)

Steve's direction: **no visible draft-then-swap; prefer a fast, artistic WYSIWYG Film engine where dragging = settled = export = Proof.** Options below are ranked **first by Class (c) WYSIWYG re-architecture** (ordered by ms saved), then **Class (a) identical-output engineering wins**, then **Class (b) drag-only drafts** (showing which are safe vs rejected).

*Baseline (merged sprint code, post-O1, MacBook Neo A18 Pro, Fit): Exposure drag ~1,000 ms first feedback / ~750 ms settle (24 MP) and ~850–950 ms ff / ~650–700 ms settle (50 MP); Film own sliders 500–1,000 ms ff / 550–600 ms settle.*

| Rank | Option | Class | Expected Saving at Fit — 24 MP (ff / settle) | Expected Saving at Fit — 50 MP (ff / settle) | Effort & Risk | Visible Look Difference vs Today (for before/after crops) |
| --- | --- | --- | --- | --- | --- | --- |
| **1** | **C1 · Pre-baked exposure-conditioned mipmapped grain volume** (bake our own Poisson-disk crystal physics once into a tileable `512×512×8` mipmapped texture; sample once per pixel; same volume on CPU export) | **(c) WYSIWYG** (drag = settled = export) | **~450–550 ms ff** *(eliminates drag→settle re-render)* / **~520–560 ms settle** *(540 → ~2 ms)* | **~450–550 ms ff** / **~520–560 ms settle** | Medium effort, Medium risk (must match GPU & CPU export sampling; check tile periodicity on large flat skies) | **Subtle-to-moderate texture refinement:** Keeps the exact same organic silver/dye crystal character, clumping, shadow/midtone/highlight response, and colour separation, because it is baked from the *same* grain generator. Differs in two ways: (1) individual grains are tiled over a `512×512` (or dual-offset non-repeating) patch rather than unique per coordinate — dual-layer prime-offset sampling prevents visible tiling; (2) at Fit zoom, mipmapped filtering looks slightly cleaner and more consistent with 100%/export than today's 4×4 box average — and **zero shift on slider release**. |
| **2** | **C2 · Multi-scale Gaussian / Dual-Kawase blur pyramid for Lens Diffusion (Mist) & Halation** (6–7 octave pyramid `1/2..1/64`, fitting the 27-component radial PSF + RGB dispersion onto octave weights; whole-frame pyramid at 100% zoom/export) | **(c) WYSIWYG** (drag = settled = export) | **~150–250 ms ff** on Exposure/Tone / **~150–200 ms settle** *(Mist 200 → ~4 ms; Halation 8 → ~2 ms)* | **~110–190 ms ff** on Exposure/Tone / **~110–160 ms settle** *(lower 50 MP cap today)* | Medium effort, Low-Med risk (extends existing `clarityMapPlan` pyramid pattern; replaces CPU FFT in `lens_filter.py` with same pyramid) | **Near-invisible in normal photos (≤ 0.3% peak MTF error verified mathematically):** An 8-octave pyramid reproduces Black Pro-Mist's 27-component radial profile and warm/cool halo split to within **0.003 MTF error**. Around extreme point lights (streetlamps/sunstars), the outer glow tail is actually **smoother and reaches further** than today's hard 54 px Fit truncation cap (which cuts off the widest 7 components early), and 100% zoom matches Fit more closely. |
| **3** | **C3 · Single baked hardware 3D LUT (`texture_3d<f32>`, `33³`/`65³`) for Stock + Print + Scan + client-side Print Contrast morph** (0.05 ms GPU compute bake when stock/print controls change; apply grain via exposure/density-mapped LUT; remove Python HTTP fetch for Print Contrast) | **(c) WYSIWYG** (drag = settled = export) | **~15–25 ms** per frame (all sliders); **+100–300 ms** saved on cold `Print Contrast` notches | **~15–25 ms** per frame (all sliders); **+100–300 ms** saved on cold `Print Contrast` notches | Medium effort, Medium risk (must preserve HDR highlight headroom above 1.0 via log2 shaper + Neutral ideal-paper highlight behavior) | **Virtually invisible on measured stocks (typically < 0.2 ΔE):** Log-shaper + `65³` (or `33³`) trilinear 3D LUT matches the 2-stage negative+print+scan tables closely across SDR and HDR. Only subtle difference: if grain is moved to pre-LUT exposure space (`rgb * exp2(stops)`) instead of post-negative density space, highlight/shadow grain contrast shifts slightly on high-contrast stocks (can be avoided completely by keeping a tiny 1D density→RGB local-gamma scale or splitting negative/print LUTs). |
| **4** | **C4 · Fused Film pass + separable Scan Sharpening** (combine Lens mix + Halation apply + Grain + Stock LUT + Look Strength + Vignette + Output Exposure into 1–2 passes; make `scan_sharpening` 1D H+V instead of 7×7 2D loop; remove `response` identity copy) | **(c) / (a)** *(fusion is (a) except minor f16 rounding; separable sharpen is (a) bit-exact to 0.01)* | **~10–18 ms** per frame at Fit *(huge at 100% zoom: eliminates 49-tap 2D loop)* | **~10–18 ms** per frame at Fit *(huge at 100% zoom)* | Low-Med effort, Low risk (reduces 10 full-res passes to 3–4) | **Invisible (< 0.05 ΔE):** Removing intermediate half-float round-trips actually *increases* precision slightly. Separable Gaussian sharpening is mathematically identical to the 2D Gaussian kernel. |
| **5** | **A1 · Keep exact drag frame on release (`approximate: false`) + drop superseded frames cleanly** (automatic once C1 removes 1-sample draft grain! Plus fix `R5-10` live-scope preemption and `finishInteractive` `pruneGrain: true` if old grain remains) | **(a) Identical output** *(enabled by C1)* | **~400–600 ms ff** *(eliminates the bimodal 450→1050 ms jump)* / **~550–600 ms settle** *(settle drops to ~0 ms!)* | **~400–600 ms ff** / **~550–600 ms settle** | Low effort, Low risk (reuses existing `preview-pipeline.js:312` fast path that Tone already uses!) | **Zero change** — by definition, what you see on the last drag frame *is* the settled frame. |
| **6** | **A2 · Downstream stage caching (pre-halation & pre-stock intermediates) + hoist constant `middleGrey` calibration** (skip Halation blur when dragging Grain/Stock/Look Strength; skip Lens+Scatter+Halation when dragging Print/Stock/Look Strength) | **(a) Identical output** | **~5–15 ms** on Film's own sliders *(smaller once C1+C2+C3 are in place; worth ~20–40 ms on today's code)* | **~5–15 ms** on Film's own sliders | Low effort, Low risk (+8.8 MB VRAM at Fit if an extra cache texture is kept) | **Zero change** — exact bit-for-bit reuse of unchanged upstream pixels. |
| **7** | **A3 · Client-side `film_print_morph.py` port (for Print/Shadow/Highlight Contrast)** (can ship independently of C3! Morph the 256-sample 1D `print_curves` in JS/WGSL and upload 3 KB instead of fetching 3 MB JSON from Python) | **(a) Identical output** | **~80–250 ms** on every new `Print Contrast` slider notch | **~80–250 ms** on every new `Print Contrast` slider notch | Low effort (~100 lines JS), Very low risk (pure `erf` + bisection on 256 floats) | **Zero change** — bit-identical 256-sample curve. |
| **8** | **A4 · Enable `shader-f16` ALU on Apple Silicon / Metal** *(note: textures are ALREADY `rgba16float`!)* | **(a) Near-identical** | **~3–8 ms** (after C1–C4; ~15–30 ms on heavy today shaders) | **~3–8 ms** | Low-Med effort, Low risk (optional feature check; keep `f32` accumulators for stock/grain coords) | **Invisible** — textures are already 16-bit half-float (`rgba16float`). |
| **9** | **B1 · Subtle drag-only pyramid depth trim (e.g. omit widest `1/32` Mist octave or run Halation at `1/2` during drag)** | **(b) Drag-only (subtle)** | **~2–5 ms** *(already negligible once C2 is built)* | **~2–5 ms** | Low effort, Low risk | **Barely perceptible** (very soft outer bloom tail). **Not needed** once C2 runs in ~4 ms WYSIWYG. |
| **10** *(Not recommended)* | **B2 · Drag-time half-res proxy (`fasterDragging: true`) or skipping Grain/Mist while dragging** | **(b) Drag-only (visible swap)** | ~200–500 ms ff, **0 ms settle** *(settle still ~600–750 ms!)* | ~200–500 ms ff, **0 ms settle** | Already half-built (`HDRPreviewLatencyController`) | **REJECTED by Steve's direction:** Causes an obvious sharpness/grain/glow pop when releasing the slider, and leaves settle slow (~600–750 ms). |

---

## Recommended Path (Reaches ≤ 100 ms WYSIWYG — Target ~20–35 ms Film Cost)

Combine **C1 + C2 + C3 + C4 (+ A1/A3 automatic wins)** into one clean, unified Film Look v2 rendering architecture shared across preview, Proof, GPU export, and CPU export:

### Projected End-to-End Performance (MacBook Neo A18 Pro, 8 GB)

| Scenario | Today (Post-O1) | With C1 + C2 + C3 + C4 (WYSIWYG) | Film Cost Added |
| --- | --- | --- | --- |
| **24 MP Fit — Exposure drag (Film ON)** | ~1,000 ms ff / ~750 ms settle | **~55–85 ms ff / ~0–20 ms settle** | **~20–35 ms** *(target ≤ 100 ms)* |
| **50 MP Fit — Exposure drag (Film ON)** | ~850–950 ms ff / ~650–700 ms settle | **~55–85 ms ff / ~0–20 ms settle** | **~20–35 ms** *(target ≤ 100 ms)* |
| **24 & 50 MP Fit — Film's own sliders** | 500–1,000 ms ff / 550–600 ms settle | **~45–70 ms ff / ~0–20 ms settle** | **~12–25 ms** *(target ≤ 100 ms)* |
| **50 MP 100% Zoom — Exposure drag** | ~7,200 ms ff / ~4,800 ms settle *(baseline)* | **~250–450 ms ff / ~0–100 ms settle** | **~100–200 ms** *(~15–20× faster!)* |
| **50 MP 100% Zoom — Film's own sliders** | ~3,000–3,550 ms ff / ~1,100–1,700 ms settle | **~180–350 ms ff / ~0–100 ms settle** | **~80–150 ms** *(~10–15× faster!)* |
| **24 MP / 50 MP GPU Export & Proof** | 204 tiles inflated **4.72×** by 300 px halo + 54 Mist passes/tile | **~4×–8× faster Film stage** (tile area shrinks **4.2×**; per-tile GPU work drops **>20×**) | Matches preview |
| **24 MP / 50 MP CPU Fallback Export** | Tiled 1024² FFTs + Python Poisson crystal splatting + 4× 33³ lookups | **~3×–6× faster Film stage** (same pyramid + 3D LUT + tiled grain volume in NumPy) | Matches preview |

### What Steve has to accept as a trade-off (and verify with crops)

1. **Film Look becomes a clean v2 artistic engine (no old-renderer compatibility, per pre-1.0 rule):** Existing saved Film grades will render slightly differently in three minor ways — Steve should review side-by-side before/after crops of 4–5 real photos (portrait, night point-lights, blue sky, B&W, HDR highlight) before locking it in:
   - **Grain (C1):** Same physical crystal shape and density response, but sampled from a large tiled/blended volume rather than unique infinite-plane coordinates, and smoothly mipmapped at Fit (so Fit matches export *better* than before, and stops jumping on release).
   - **Mist / Halation (C2):** Indistinguishable on normal scenes (~0.3% MTF match); around bright point light sources at Fit, the outer halo will actually be *more* natural and smoother because it no longer hits the artificial 54 px cutoff.
   - **Stock / Print Colour (C3):** Virtually identical (< 0.2 ΔE) on measured stocks; if grain is moved before the 3D LUT, extreme shadows/highlights may show a tiny shift in grain contrast (avoidable if we keep the 1D density-slope modulation).
2. **Saved-test / parity updates:** Existing pinned Film parity tests (`film-stock-parity`, `lens-filter-parity`, `grain-parity`) compare GPU against the *old* CPU math (`lens_filter.py` FFT, `film_grain.py` splat). Both GPU and CPU must move to the new pyramid + grain volume + 3D LUT together, keeping strict GPU↔CPU and Preview↔Export↔Proof parity intact!

---
---

# Technical Architecture Deep Dive

## 1. Complete Film Look Architecture Map (Merged Sprint Code, `a6df0067`)

### Audit Recipe & Resolution Geometry

The audit (`codebase/tests/performance/grade-module-impact.js:62-66`) tests a realistic stacked Film grade:
- `film_stock: kodak_portra_400`, `look_strength: 80`, `print_contrast: 20`
- `lens_filter: black_pro_mist`, `lens_strength: 0.3`, `lens_size: 1.0`
- `halation_enabled: true`, `halation_amount: 25`, `halation_radius: 0.20`
- `grain_enabled: true`, `grain_amount: 28`
- `film_resolution: 90` (enables `scatterComputeMain`)
- `scan_sharpening: 25`

On MacBook Neo (`1408×794` points, 2× Retina), Fit processing resolution is **`1283×855`** (1.10 MP) for 24 MP (`IMG_7723.CR3`, `scale = 0.2138`) and **`1285×857`** (1.10 MP) for 50 MP (`DSC00636.ARW`, `scale = 0.1484`).
Critically, `HDRGraphScale.spatialGridScale(w, h)` (`graph-scale.js:62`, `webgpu-shaders.js:2305`) uses:
- `longEdge < 2048` → **`spatialGrid = 1`** (full Fit resolution!)
- `2048 ≤ longEdge < 4096` → `spatialGrid = 2` (1/2 resolution)
- `longEdge ≥ 4096` → `spatialGrid = 4` (1/4 resolution)

Therefore, on MacBook Neo Fit, **every single Mist pass and Halation pass executes at 100% full Fit resolution (`1283×855`)** — actually *more* spatial pixels than a 2048 px PC preview (`1024×683`)!

### Pass-by-Pass Inventory (`encodeFilmChain`, `webgpu-preview.js:9564-9668`)

| # | Pass / Entrypoint | Resolution (24 MP Fit / 50 MP 100% per tile) | Format | Full-Frame R/W & Tap Count (24 MP Fit) | Re-runs on Exposure / Tone / Denoise? | Re-runs on Film sliders? | Est. GPU Time (A18 Pro, 24 MP Fit) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | `baseFragmentMain` (Tone/Color/Curves, upstream) | `1283×855` / `1112×1112` tile | `rgba16float` | 1 R + 1 W (8.8 MB each) | Yes | Yes *(always re-encoded!)* | ~4–6 ms |
| 1 | `lensWeightsFragmentMain` (O1 tap table) | `515×27` | `r32float` | Tiny (55 KB W) | **Yes** (Mist cache miss) | No (only on Lens Filter / Size) | <0.1 ms |
| 2 | `lensExtractFragmentMain` | `1283×855` (`sgrid=1`) / `278×278` tile | `rgba16float` | 4 texel reads + 1 W | **Yes** (Mist miss) | No (only Lens Filter / Size) | ~1–2 ms |
| 3–56 | **27× `lensHorizontalFragmentMain` + 27× `lensVerticalFragmentMain`** | `1283×855` (`sgrid=1`) / `278×278` tile | `rgba16float` (`spatialA` ↔ `spatialB`, additive blend on V) | **54 passes!** `sum(2*ext+1) = 1,391` per axis = **2,782 taps/px** (**3.05B texel loads + 3.05B weight loads**); ~1,185 MB RT bandwidth. `cap = 54` (24 MP) / `37` (50 MP) / `64` (100%) | **Yes** (cache key `lensGlowCacheKey` includes entire base/detail/local/Denoise grade) | **No** when dragging Look, Lens Strength, Halation, Grain, Print, Scan (`lensGlowKey` cache hit!). **Yes** on Lens Filter / Size. | **~150–250 ms** (24 MP) / **~110–190 ms** (50 MP) *(post-O1; was ~600–900 ms pre-O1)* |
| 57 | `copyTextureToTexture` (`spatialB → lensGlowTexture`) | `1283×855` | `rgba16float` | 1 R + 1 W (17.6 MB) | **Yes** (Mist miss) | No (cached) | ~0.5 ms |
| 58 | `lensFragmentMain` (mix `original` + `glow`) | `1283×855` / `1112×1112` tile | `rgba16float` | 1 + 4 (bilinear) R, 1 W (`finishView`) | Yes | Yes (every Film slider) | ~2 ms |
| 59 | `scatterComputeMain` (`film_resolution < 100`) | `1283×855` (`8×32` WG, shared mem) / `1112×1112` tile | `rgba16float` | 1 R + 1 W; radius `1 px` at Fit (`5 px` at 50 MP 100%) | Yes | Yes (every Film slider, even Grain/Print/Look!) | ~2–3 ms |
| 60 | `spatialExtractFragmentMain` (Halation edge extract) | `1283×855` (`sgrid=1`) / `278×278` tile | `rgba16float` (only `.a` used!) | 4 × 5 = **20 texel reads/px**, 1 W (`spatialA`) | Yes | Yes (every Film slider, M5-3!) | ~3–5 ms |
| 61–62 | `spatialBlurHorizontal` + `spatialBlurVertical` (Halation) | `1283×855` (`sgrid=1`) / `278×278` tile | `rgba16float` (`spatialA` ↔ `spatialB`) | `radius = 3.08` (`ext=3`, 14 taps H+V) at Fit; `ext=5` at 50 MP 100% | Yes | Yes (every Film slider, M5-3!) | ~3–4 ms |
| 63 | `finishFragmentMain` (**Halation apply + Grain + Film Stock**) | `1283×855` / `1112×1112` tile | `rgba16float` (`finishView`) | **Reads:** `filmInput` (6 taps incl. 5-tap `halationEdgeSource`), `spatialA` (4 taps bilinear), **`filmStock` storage buffer (~144–192 scattered f32 loads/px!)**. **ALU:** Grain = **16 subsamples × 3 ch × 9 cells × ~6 grains = ~2,592 crystal evals/px** settled (`2.84B` evals/frame); **1 subsample** (~162 evals/px, *unpruned!*) interactive. Stock = up to 4× `stockPrintScan` + `middleGrey` recomputed per pixel! | Yes | Yes (every Film slider — even `Look Strength` or `Scan Sharpening` recomputes all 16 grain subsamples!) | **Settled: ~540–580 ms** *(Grain ~520–550 ms + Stock ~15–25 ms + Halation ~3 ms)*. **Interactive (1-sample): ~25–45 ms** *(Grain ~12–20 ms + Stock ~15–25 ms)* |
| 64 | `scanFragmentMain` (`scan_sharpening` + `look_strength` + Vignette + Output Exp) | `1283×855` / `1112×1112` tile | `rgba16float` (`filmView`) | `scan_sharpening`: 2D unseparated loop with `exp()` inside — **3×3 (9 taps)** at 24 MP Fit, **1 tap** at 50 MP Fit, **7×7 (49 taps!)** at 100% zoom! Plus `original` R + 1 W | Yes | Yes | ~3–5 ms at Fit *(~35–60 ms across 100% tiles!)* |
| 65 | `filmResponseFragmentMain` (**redundant identity copy**) | `1283×855` / `1112×1112` tile | `rgba16float` (`filmView → finishView`) | 1 R + 1 W (17.6 MB) — pure copy when Lens/Scatter ran & Structure is off (`webgpu-preview.js:9664`) | Yes | Yes | ~1–2 ms |
| 66 | `fragmentMain` (`composite` to swapchain) | `1283×855` | swapchain (`rgba16float` HDR / `bgra8unorm` SDR) | 1 R + 1 W + Highlight Compression | Yes | Yes | ~2–3 ms |

### Where the time actually goes (cross-checked against A18 Pro hardware measurements)

1. **Settled Fit, Film's own sliders (~550–600 ms observed):**
   - `lensGlowKey` hits cache (0 ms Mist).
   - Fixed pipeline overhead (`base` + `lens` + `scatter` + `halation` + `scan` + `response` copy + `composite` + stock LUT + JS/submit): **~40–60 ms**.
   - **16-sample settled Grain (`finishPrunedGrain`)**: **~500–540 ms** (~90% of settle time!). Directly corroborated by `docs/product/modules/film-look.md:199-201`, which measured isolated 16-sample grain on this exact MacBook Neo at `1024 px` as **337 ms** (GPU timestamp) vs **13.5 ms** with grain off — scaling by `(1283/1024)^2 = 1.57×` gives **~529 ms**!
2. **Settled Fit, Exposure drag (~750 ms observed post-O1):**
   - Same **~550–600 ms** above **+ ~150–200 ms** for the 54-pass Black Pro-Mist miss (`findings-O1.jsonl` O1-2 measured HDR Black Pro-Mist at 1520 px `scale=1.0` as `2585 → 780 ms`; at 1283 px `scale=0.2138`, `cap` drops from 256 to 54 and pixel count is 0.71× → **~150–220 ms**).
   - Note why **24 MP Fit is slower than 50 MP Fit** in the audit (`3085 ms` vs `1892 ms` pre-O1): `lensExtent` caps at `floor(256 * source_pixel_scale / spatialGrid)`. For 24 MP, `scale = 0.2138 → cap = 54` (109 taps/axis); for 50 MP, `scale = 0.1484 → cap = 37` (75 taps/axis) — so 24 MP actually runs **24% more Mist taps** and **9× more scan-sharpen taps** at Fit!
3. **Interactive drag frame (1-sample grain):**
   - **Film's own sliders (Mist cached):** ~40–65 ms GPU + ~15 ms JS/rAF/fence = **~55–80 ms**. (Matches `film-look.md:190`: *"about 22 ms of each live Fit picture to Film finish despite its one grain sample"* + ~25 ms for base/lens/scatter/halation/scan/copy/composite!)
   - **Exposure drag (Mist miss):** ~55–80 ms + ~150–250 ms Mist = **~220–330 ms** per interactive frame!

---

## 2. Why First Feedback (~1.0 s) Is Worse Than Settle (~0.6–0.75 s)

Tracing `adjustment-controls.js`, `app-boot.js:193-284`, `preview-scheduler.js`, `preview-pipeline.js:290-370`, `scope-requests.js:143-164`, and `grade-module-impact.js:287-495` reveals **five interacting causes** — and explains the striking **bimodal `~440 ms` vs `~1,040 ms`** samples in `module-impact-typical-fit.json`:

1. **Draft grain (`usesDraftGrain`) forces a mandatory second render on every release.**
   - During drag, `renderToFrame` (`webgpu-preview.js:6507, 6693`) selects `finishInteractive` (`grainSampleLimit = 1`) and marks `result.approximate = true` (`acceptedPresentation.exact = false`).
   - On pointer-up, `settlePreviewFrame` (`preview-pipeline.js:312-324`) checks `acceptedPresentation.exact` — which is **always `false`** whenever Grain is active! So the last drag frame is *always discarded* and replaced by a fresh **~550–600 ms** 16-sample render.
2. **Per-step generation bump + GPU fence (`waitForSubmittedWork`) drops intermediate drag frames from counting as current — creating the 440 ms vs 1,040 ms bimodality.**
   - `pointerDrag` sends 9 mouse moves over **~373 ms** (~41 ms per step — confirmed by Film-OFF `whole 416 ms - settle 43 ms = 373 ms`).
   - With Film OFF, a frame takes **~33 ms** (< 41 ms step interval), so step 1 finishes *before* step 2 arrives → `first_feedback = 33 ms`, and because `exact === true`, `settle ≈ 0–43 ms`.
   - With Film ON (own sliders, Mist cached), an interactive frame takes **~55–80 ms** (> 41 ms step interval!). `app-boot.js:251` awaits `waitForSubmittedWork()` before starting the next frame, and `pacedPreviewInteraction` (`preview-pipeline.js:5-19`) lets each snapshot finish rather than cancelling it. By the time frame `G1` resolves `onSubmittedWorkDone()`, `G2` has already incremented `state.previewGeneration[lane]`, so `scopePresentationMatches` (`scope-requests.js:148`) marks `G1..G8` stale (`currentAtCompletion = false`).
   - At `t ≈ 373 ms`, `G9` + `pointerup` (`endInteraction()`) arrive while `G8` is still on the GPU:
     - **Lucky race (~40% of samples):** `G9` renders one interactive frame (~60 ms) right after `G8` finishes → `first_feedback ≈ 373 + 60 ≈ 430–450 ms`, followed by the mandatory 600 ms settle (`whole ≈ 1,030 ms`).
     - **Unlucky race (~60% of samples):** `endInteraction()` arms settle, `app-boot.js:232` / `preview-scheduler.js:203` skips the non-interacting interactive frame `G9`, and the **first** current frame to complete is the settled 16-sample frame → **`first_feedback ≈ 373 + 60 + 600 ≈ 1,040 ms`** (identical to `whole_wait_ms`!).
3. **Exposure drags hit the 54-pass Mist miss during the drag AND/OR on settle.**
   - Each interactive Exposure frame takes **~250–330 ms** (post-O1), so `G1` occupies almost the entire 373 ms drag. After release, the GPU finishes `G1` (stale), then runs `G9` settled (Mist miss ~200 ms + 16-sample grain ~550 ms = **~750 ms settle**), landing at **~1,000–1,100 ms** first feedback!
4. **`Print Contrast` / `Shadow Contrast` / `Highlight Contrast` stall on a synchronous HTTP fetch + JSON parse + buffer upload.**
   - `film-stocks.js:142` puts `contrast=<value>` in the URL query string (`GET /api/film-stocks/kodak_portra_400?contrast=...`).
   - `film_stock.py:475-509` runs `apply_print_curves_morph` in Python (morphing only a 256-sample 1D curve — 768 floats!), then **serializes the entire stock including both 33³ 3D tables (~220,000 floats ≈ 2–3 MB of JSON text)**, parses it on the JS main thread, and uploads **880 KB** to `filmStockBuffer` (rotating through an 8-slot LRU ring `variant-0..7`!).
   - `webgpu-preview.js:5808` **`await`s** this fetch before encoding the frame! Every untouched slider notch pays a full HTTP + JSON + upload stall.
5. **Secondary scheduling/shader leaks:**
   - `finishInteractive` (`webgpu-preview.js:9799`) sets `grainSampleLimit: 1` **without** `pruneGrain: true`, missing the free conservative cell/radius early-out that `finishPrunedGrain` uses.
   - `R5-10` (`preview-scheduler.js:222`): an interactive scope readback can submit onto the FIFO GPU queue ahead of the next pending drag frame.
   - `fasterDragging` (`app-state.js:416`) defaults to `false`, disabling `HDRPreviewLatencyController` (though under Steve's direction we do *not* want visible coarse drag frames anyway).
   - `O1-4` (`webgpu-preview.js:6163`): Tiled Grade does not forward `tier`/`coarse`, so 100% zoom drags don't even get draft grain where `scale < 1`.

*(Note: there is **no** pipeline recompilation during drag — all Film pipelines are cached in `this.pipelines` per surface format. Bind groups are created per frame, which is cheap in WebGPU, though `detailPass` recreates a bind group every call.)*

---

## 3. Real-Time Rendering Architecture Mapped Onto This Code

Here is how modern real-time film/photo engines (DaVinci Resolve Film Look Creator / OpenFX Mist, Dehancer, FilmConvert, Lightroom, Apple Core Image) hit **<16 ms** WYSIWYG, mapped directly onto `webgpu-shaders.js`, `webgpu-preview.js`, `graph-scale.js`, and the Python CPU fallback.

### C1 · Pre-Baked Exposure-Conditioned Mipmapped Grain Volume (Saves ~520–560 ms settle, ~450–550 ms ff)

**Why today's shader is slow:** `filmGrainStops` (`webgpu-shaders.js:2458-2581`) evaluates a stochastic Poisson crystal union procedurally at every pixel × 3 dye layers × 9 neighbor cells × ~6 crystals/cell × **16 subsamples** at Fit (`2,592` evaluations/pixel).

**Real-time architecture:** Notice that `grainLayerNoise(u, signal, salt, opacity, clumping, edge, midSpread)` is a pure function of spatial coordinate `u` and normalized exposure `signal ∈ [0, 1]` (where everything above linear `~0.17`, i.e., `srgbEncode ≥ 0.45`, saturates to `signal = 1.0`!).
- **Bake once on GPU (compute shader, ~3–5 ms) whenever `seed`, `grain_size`, `grain_softness`, or `grain_film_type` changes** — *never* on Exposure, Tone, Denoise, Stock, Print, Look Strength, Grain Amount, Grain Chroma, or Shadow/Midtone/Highlight Response drags!
- **Texture layout:** A tileable **`512×512` × 8 exposure slices (`signal = 0, 1/7, ..., 1`)** `rgba8snorm` (or `rgba16float`) 2D texture array (or 3D texture) **with a full hardware mipmap chain** (`512, 256, 128, 64, 32...`).
  - **VRAM cost:** `512 × 512 × 8 slices × 4 bytes (rgba8snorm) × 1.33 (mips)` = **~11 MB** (or `256×256×8` `rgba8snorm` = **2.8 MB**; `rgba16float` at `256×256×8` = **5.6 MB**). Easily fits inside the 4 GB MacBook Neo / 2 GB GPU budget.
  - **Bake generator:** Uses the **exact same Poisson-disk + mottle physics** as `grainLayerNoise` (with periodic wrap at tile size `T`, storing R/G/B dye layers in `.rgb` — or 1 channel for B&W — normalized to zero mean / unit std per slice!).
  - **Preventing visible tiling on flat skies:** Either use `512×512` (covers ~14 mm on a 35 mm frame at medium grain) OR blend two offset/rotated taps at prime scales (`0.7071 * (sample(uv) + sample(rot90(uv * 1.31 + offset)))` — 2 hardware lookups, mathematically zero periodicity, preserves exact variance `0.5 + 0.5 = 1.0`!).
  - **Runtime sampling (drag, settled, 100%, GPU export):**
    - Compute continuous mip level `lod = log2(max(1.0, grainPitchRatio))` so zoomed-out Fit automatically reads the exact anti-aliased mip level (**replacing 16× supersampling with 1 hardware trilinear mip lookup!**).
    - Linearly interpolate between the two bracketing exposure slices `floor(signal * 7)` and `ceil(signal * 7)` (or 1 hardware trilinear lookup in a `texture_3d`!).
    - Apply `grain_chroma`, `shadow/midtone/highlight_response`, and `grain_amount` in-shader (identical math to lines 2542–2555).
    - **Variance compensation across mips:** Standard box mipmapping reduces noise variance by `1/4` per mip (`1/2` std per octave) — which is *physically right* when averaging sub-pixel grain! Apply the exact same `pixelCoverage` attenuation factor (`scale`) as today, or tune one mip-bias constant so Fit grain strength matches 100%/export visually.
  - **Runtime cost:** **~1–2 ms** at Fit (down from **~540 ms** — a **>250× speedup!**).
  - **CPU export parity (`film_grain.py`):** Bake the exact same small `256×256×8` (or `512×512×8`) tileable volume + mip levels once per export in Python/NumPy (~20–40 ms total!), then bilinearly index it per chunk — making CPU fallback export **5×–10× faster** too and guaranteed to match GPU preview/Proof!
  - **Bonus scheduling win (A1):** Because grain now runs in ~1–2 ms at full quality, **delete `usesDraftGrain` (`approximate: true`) completely!** Every drag frame is `exact: true`, so `settlePreviewFrame` keeps it verbatim (**settle drops from 600 ms → ~0 ms**, zero texture shift on release!).

---

### C2 · Multi-Scale Blur Pyramid for Lens Diffusion (Mist) & Halation (Saves ~150–250 ms ff & settle at Fit; ~4–6 s at 100% zoom!)

**Why today's Mist is slow:** `lens-filters.js` decomposes each lens filter into **27 Gaussian components** (`9 radial bands × 3 sub-Gaussians`), spanning `σ = 0.20 px` to `93.7 px` at Fit (`158 px` at 50 MP 100%; `247 px` for Cinebloom at Fit). Today, `encodeFilmChain` runs **54 separate full-spatial-grid passes** (27H + 27V) at `1283×855`, executing **3.05 billion** texel reads and **1.18 GB** of render-target traffic per frame. Component `c00` (`σ = 0.20 px`) has weight `5.9e-6` at ±1 px (literally an identity copy burning 2 full-frame passes!), while `c20..c26` (`σ = 28..94 px`) get brutally truncated at `cap = 54 px` (`0.58σ`!).

**Real-time architecture (Jimenez CoD:AW / Dual-Kawase / Resolve Mist Pyramid — extending HDR Finisher's own `clarityMapPlan`):**
- **Step 1 — Downsample chain (6–7 mip levels, `L0 = 1/1` → `L6 = 1/64`):**
  - Run a 13-tap Jimenez tent/Gaussian downsample (or separable 5-tap `[1, 4, 6, 4, 1]/16` binomial filter) from `L0` → `L1` (`642×428`) → `L2` (`321×214`) → `L3` (`161×107`) → `L4` (`81×54`) → `L5` (`41×27`) → `L6` (`21×14`).
  - Total pixel area across ALL 6 downsampled levels: `1/4 + 1/16 + 1/64 + ... = 0.33×` of one Fit frame!
  - Total VRAM for all 6 mip levels (`rgba16float`): **`~3.0 MB`** at Fit (and only **`~14 MB`** for the *entire* 50 MP photo starting from `1/4` resolution!).
- **Step 2 — Single-pass weighted upsample-and-accumulate (6 tiny passes, `L6 → L0`):**
  - Each level `L_k` represents an effective Gaussian basis `G(σ_k)` with `σ_k ≈ 2^k * σ_0` (doubling each octave: `0, 0.6, 1.5, 3.5, 8, 18, 42, 95 px`).
  - Precompute (once per filter + `lens_size` + `ppm` in JS, <0.05 ms!) the **per-octave RGB weights `w_k = (w_r, w_g, w_b)`** that fit the exact 27-component radial MTF (`sum_i w_i exp(-0.5 (k σ_i)^2)`) by linear least squares across the 7–8 octaves!
  - **Mathematical accuracy check (run directly on `lens-filters.js` Black Pro-Mist):**
    - 8-octave basis `[0, 0.6, 1.5, 3.5, 8, 18, 42, 95 px]` matches the exact 27-component Black Pro-Mist frequency response to **`max |MTF error| = [0.00385, 0.00243, 0.00306]`** (~**0.3% peak error** across all spatial frequencies and all 3 RGB channels, preserving the exact warm/cool chromatic halo gradient of bands 6–14!).
    - On the upsample pass (`L_{k+1} → L_k`), blend `3×3` tent-upsampled `accum_{k+1}` + `w_k * mip_k` (just 1 hardware bilinear tent upsample + multiply-add per level!).
  - **Total passes for ALL 27 components:** **6 downsample + 6 upsample = 12 tiny passes** (total area `0.66×` of one frame; **~35 MB** RT traffic vs **1,185 MB** today = **34× less bandwidth**, **~120× fewer texture fetches!**).
  - **Estimated GPU time on A18 Pro at Fit:** **~3–5 ms** (down from **~150–250 ms** post-O1!).
- **Step 3 — Share the same pyramid pattern for Halation!**
  - Run Halation's `spatialExtract` (at `1/2` resolution when `halationRadius >= 2`, or `1/1` for ultra-tight radii), then run Halation blur on the pyramid (2–4 tiny passes, **~1–2 ms** instead of 8–10 ms full-res, and works cleanly even at large `halation_radius` without hitting the 64-texel loop!).
  - Note: in `spatialExtractFragmentMain`, Halation only writes `.a` (1 channel!), yet allocates two full 4-channel `rgba16float` textures. Packing into `r16float` (2 bytes/px vs 8 bytes/px) cuts Halation bandwidth **4×**.
- **Step 4 — Massive 100% Zoom & Export Win (Eliminating the 300 px Tile Halo!):**
  - Today, at 100% zoom on 50 MP (`DSC00636.ARW`, `8660×5773`), `graph-scale.js:374` computes **`halo = 300 px`** on every side because of Mist (`64 × 4 = 256 px`) + Halation (`5.2 × 4 = 21 px`) + Direct (`13 px`). Every `512×512` tile inflates to **`1112×1112`** (**4.72× pixel area!**).
  - Look at how this codebase **already solves this for Clarity** (`encodeSurroundClarityMap`, `webgpu-preview.js:5289`): build the wide blur levels (`L2 = 1/4` down to `L6 = 1/64`) **once for the whole frame** from the reduced Fit/2K render (only **~14 MB** total for 50 MP!), and sample that surround pyramid inside each 100% tile!
  - Only the tiny local octaves (`L0`, `L1`, `scatter`, `scan_sharpening`, `halationEdge`) need a tile halo — shrinking the tile halo from **`300 px` → `~16–24 px`**!
  - Every `512×512` tile shrinks from **`1112×1112` (1.24 MP) → `544×544` (0.30 MP)** — a **4.2× reduction in tiled pixel work across EVERY pass in the graph** (Base, Detail, Locals, Scatter, Halation, Grain, Stock, Scan) at BOTH 100% zoom AND GPU Export!
  - **CPU export parity (`lens_filter.py`):** Replace the slow `512×512` tiled `np.fft.rfft2` (`fft_size = 1024/2048`) with the **exact same 7-level separable `[1,4,6,4,1]/16` pyramid + tent upsample** in NumPy — simpler, lower peak RAM, no FFT padding overhead, **~3×–5× faster on CPU**, and visually identical to GPU!

---

### C3 · Hardware 3D Stock LUT (`texture_3d<f32>`) + Client-Side Print Morph (Saves ~15–25 ms/frame + kills ~100–300 ms Print Contrast HTTP stall)

**Why today's `filmStockStage` is heavy:**
1. Every pixel recomputes the frame-constant `middle` (`toneGain`, `webgpu-shaders.js:2072`) via `stockDensity` + `stockPrintScan` (two 1D curves + two 33³ storage-buffer trilinear lookups = 48 scalar loads wasted at every single pixel!).
2. Every pixel evaluates up to **3 more** `stockPrintScan` + **2 more** `stockDensity` calls (for `grey`, `grey + delta`, and `rgb + delta`), doing **~144–192 scattered `f32` storage-buffer loads per pixel** without hardware 3D texture caching or hardware trilinear interpolation!
3. Dragging `Print Contrast`, `Shadow Contrast`, or `Highlight Contrast` hits `GET /api/film-stocks/<id>?contrast=X`, serializing ~220k floats as JSON on every slider notch and stalling `renderToFrame` (`webgpu-preview.js:5808`).

**Real-time architecture:**
1. **Port `film_print_morph.py` (319 lines, pure `erf` + bisection on 256 floats) to JS (~100 lines) — ships even before the 3D LUT (Option A3)!**
   - Load each stock's base curves + 2 tables **once** (no `?contrast=...` variants needed, shrinks the 29-slot `25 MB` `filmStockBuffer`!).
   - When `print_contrast`, `shadow_contrast`, or `highlight_contrast` moves, morph the 256-sample `print_curves` (3 KB!) locally in **< 0.1 ms** and upload just 3 KB — **zero HTTP fetch, zero JSON parse, zero stall**.
2. **Bake the entire `stockDensity → coupler → print → scan` chain into ONE hardware `texture_3d<f32>` (`rgba16float`, `33×33×33` = 288 KB or `65×65×65` = 2.2 MB) via a tiny GPU compute pass (~0.05 ms)!**
   - Only re-bakes when a stock/print/development parameter changes (never on Exposure, Contrast, Tone, Denoise, Lens, Halation, Grain, Look Strength, or Scan Sharpening drags!).
   - **Shaper for HDR headroom:** Use a log2 shaper `u = clamp((log2(max(rgb, 1e-6)) - minLog) / (maxLog - minLog), 0, 1)` (covering `-12 EV` to `+6 EV` or matching today's `referenceWhite` split above 1.0 so HDR highlights keep exact hue ratios!).
   - **One hardware `textureSampleLevel(bakedStockLut, linearSampler, shaper(rgb), 0.0)`** replaces all 144–192 scattered storage-buffer reads + `log2`/`exp2`/matrix ALU!
   - **Precompute `toneGain` and 1D `greyCurve` (256 floats)** during the same 0.05 ms bake pass — eliminates the per-pixel `middle` and `grey` 3D lookups completely!
   - **How Grain interacts with the 3D LUT (two clean choices for Steve's crops):**
     - **Option C3a (Simplest, fastest — 1 lookup total):** Apply grain in log-exposure space right before the 3D LUT: `rgb_grained = rgb * exp2(stops)`. Matches exposure-based film grain naturally; tiny contrast difference on heavily curved stocks.
     - **Option C3b (Density-accurate — 1 LUT lookup + 1D slope):** Store local luminance-gamma slope `dY/dD` in a 1D curve (or in the LUT's `.a` channel!) to scale `stops` before the LUT, or bake **two** small `33³` `rgba16float` 3D textures (`negLut` + `printScanLut`, 576 KB total!) so grain stays strictly in density space between negative and print (`2` hardware `textureSampleLevel` calls = still <1 ms!). **C3b is strongly recommended if Neutral/extreme stocks show any grain-contrast drift under C3a.**
   - **Neutral ideal-paper edge case:** Keep Neutral's simple analytic curve (no 3D LUT needed — Neutral is purely per-channel 1D curves + 16.0 white cap, which bakes into a **256-entry 1D LUT** in 0.01 ms!).
   - **VRAM savings:** Replacing the 29-slot flat `filmStockBuffer` (~25 MB) with 1–2 active `33³`/`65³` `rgba16float` 3D textures (**0.3–2.2 MB**) **saves ~22 MB of VRAM**!

---

### C4 · Pass Fusion, Separable Scan Sharpening, Dead-Copy Removal & Stage Caching (Saves ~10–18 ms at Fit; ~40–60 ms at 100%)

Today, even with Mist cached, `encodeFilmChain` runs **10 full-resolution passes** (`base` → `lens` → `scatter` → `spatialExtract` → `blurH` → `blurV` → `finish` → `scan` → `response` identity copy → `composite`), reading and writing ~180 MB of `rgba16float` framebuffers per Fit frame:

1. **Eliminate the redundant `filmResponseFragmentMain` identity copy (`webgpu-preview.js:9664`):** Return the actual output texture view (`filmView` vs `finishView`) from `encodeFilmChain` instead of hard-coding `finishTexture` as the output! Immediately saves 1 full-frame pass (~1.5–2 ms at Fit, 18× at 100% zoom).
2. **Fuse `lens` + `halation apply` + `grain` + `stock 3D LUT` + `look_strength` + `vignette` + `output_exposure`:**
   - When `film_resolution == 100` (no scatter) and `scan_sharpening == 0` and `structure == 0`: **ALL of Film Look's per-pixel work collapses into ONE SINGLE PASS** reading `baseTexture` + `mistPyramid` + `halationPyramid` + `grainVolume` + `stockLut3D`, writing `finishTexture` directly!
   - Even with `film_resolution < 100` (scatter) and `scan_sharpening > 0` active:
     - Fuse `lens` mix directly into the start of `scatterComputeMain` (reads `base` + `mistPyramid` into workgroup shared memory → writes `filmInput` — **saves 1 full-frame pass!**).
     - Replace `scan_sharpening`'s 7×7 (49-tap!) 2D unseparated loop (`webgpu-shaders.js:2726-2733`) with a **separable compute pass** (or fuse into `structureComputeMain` using the *same* `filmDetailBlur` shared-memory kernel!). At 100% zoom, 49 taps + 49 `exp()` calls per pixel drops to 7H + 7V shared-memory taps with precomputed weights (**~5× faster**!).
     - Even better: when `scan_sharpening` is 0 or fused, total full-res passes drop from **10 → 3** (`base` → `scatter/lens` → `finish/scan/vignette` → `composite`)!
3. **Cache `base` / post-lens intermediate for Film's own sliders (A2):**
   - Right now, dragging `Look Strength`, `Grain Amount`, `Halation Amount`, or `Print Contrast` STILL re-runs `baseFragmentMain`, `lensFragmentMain`, `scatterComputeMain`, and all 3 Halation passes!
   - Keep `baseTexture` keyed by pre-Film grade identity (already resident in `intermediate.baseTexture` — **0 MB extra VRAM!**) and keep `halationTexture` keyed by pre-halation identity (`M5-3`, ~2 MB at `r16float` 1/2 res). Dragging any downstream Film slider skips `base`, `Mist`, `scatter`, and `Halation` completely — running **only 1–2 passes (~5–10 ms total)**!
4. **Fix `R5-10` (frame-first scope admission) & optional `shader-f16` ALU:**
   - Ensure `preview-scheduler.js:222` starts the pending drag frame *before* firing a deferred interactive scope readback so scopes never steal the GPU FIFO queue mid-drag.
   - Request optional `"shader-f16"` on Apple Silicon (Metal) for per-pixel math in the fused Film pass (~1.5× ALU speedup, lower register pressure).

---

## 4. Impact Summary: 100% Zoom, Export/Proof, Memory & Validation

### 100% Zoom (50 MP `DSC00636.ARW`, `8660×5773`, Tiled)
- **Biggest multiplier:** Moving wide Mist (`L2..L6`) and Halation onto a whole-frame reduced pyramid eliminates the **280+ px spatial halo** from every tile.
- Each `512×512` tile shrinks from **`1112×1112` (1.24 MP, 4.72× area)** to **`~544×544` (0.30 MP, 1.13× area)** — a **4.2× speedup across EVERY tiled stage** (not just Film, also Base, Detail, and Locals when Film is on!).
- Per-tile Mist work drops from **54 passes/tile** to **0 passes/tile** (just 1 bilinear read of the whole-frame pyramid + tiny `L0`/`L1` local mix).
- Separable `scan_sharpening` eliminates the 49-tap 2D `exp()` loop on all 18 visible tiles.
- **Projected 100% Exposure drag:** **7.2 s → ~250–450 ms** (~15–20× faster), with **~0–100 ms** settle and no memory-ceiling stall (C-3).

### Export & Proof (24 MP & 50 MP)
- **GPU Export & Proof (`gpu-delivery.js`):** Always executes in `tiled` mode (`tileSize = 512`), so it inherits the **exact same 4.2× tile-area reduction** (204 tiles at 50 MP drop from 252 MP of tile pixels to 60 MP!) plus the >20× faster per-tile Film shader → **~4×–8× faster Film export/Proof**!
- **CPU Fallback Export (`adjustments.py`, `lens_filter.py`, `film_grain.py`, `film_stock.py`):**
  - Replacing tiled 1024²/2048² 2D FFTs (`lens_filter.py`) with the same 7-level separable pyramid cuts CPU Lens time ~3–5× and cuts temporary RAM.
  - Replacing per-grain Python/NumPy splatting (`film_grain.py`) with sampling the same baked `256×256×8` / `512×512×8` mipmapped grain volume cuts CPU Grain time ~5–10×.
  - Replacing 4× 33³ Python trilinear lookups (`film_stock.py`) with the same single baked 3D LUT cuts CPU Stock time ~3–4×.
  - **Strict parity preserved:** Because GPU preview, GPU export/Proof, and CPU fallback export all run the exact same pyramid + grain volume + 3D LUT algorithm, Preview = Proof = GPU Export = CPU Export within tight ΔE tolerances, and the exact HDR highlight ceiling (`clipToOutputTarget`) is untouched.

### Memory Impact on 8 GB MacBook Neo (4 GB App Ceiling / 2 GB GPU Budget)
Net **VRAM reduction** at Fit and 100%:
- **Removed:** 29-slot flat `filmStockBuffer` (~25 MB → shrinks to ~1–2 MB for active stock + 3D LUTs), `lensKernel` r32float (55 KB), huge `1112×1112` tiled working textures at 100% zoom (**saves ~40–60 MB** of tiled scratch!).
- **Added:** Mist/Halation pyramid mips (~3 MB at Fit; ~14 MB whole-frame surround at 50 MP 100%) + mipmapped grain volume (**~3–11 MB** depending on `256²` vs `512²` `rgba8snorm`).
- **Net change:** **~10–15 MB LESS VRAM at Fit**, **~25–45 MB LESS VRAM at 100% zoom**.

### Suggested Implementation & Visual Sign-Off Sequence
1. **Quick zero-risk win first (A3 + dead copy + `R5-10`):** Port `film_print_morph.py` to JS (kills `Print Contrast` HTTP stall), remove the `response` identity copy, and fix scope queue preemption — zero pixel change, immediate relief.
2. **Build C2 (Blur Pyramid for Mist + Halation)** on GPU + CPU, generate before/after crops (especially night point lights & Black Pro-Mist / Cinebloom) for Steve's sign-off.
3. **Build C1 (Pre-baked Mipmapped Grain Volume)** on GPU + CPU, remove `usesDraftGrain` (`approximate: false`), generate Fit + 100% + flat-sky crops for Steve's sign-off. *(This is the single biggest drop — ~550 ms settle + ~500 ms first feedback gone in one stroke!)*
4. **Build C3 (Baked Hardware 3D Stock LUT) + C4 (Pass Fusion & Separable Scan Sharpening)**, verify HDR highlight ceiling and Portra/Ektar/Velvia/Neutral crops, then run the Film/Lens/Grain parity + `grade-module-impact --module film` re-audit on 24 MP Fit, 50 MP Fit, and 50 MP 100%.
