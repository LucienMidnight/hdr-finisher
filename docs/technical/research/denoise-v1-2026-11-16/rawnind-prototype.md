# RawNIND UtNet2 Phase 2 prototype — November 16, 2026

Neither RawNIND variant is ready to replace the current Denoise.\
Linear cleans high-ISO flats well, but loses detail, adds halos and fails HDR/exposure checks.\
Bayer also changes a noise-free image substantially, so its differences are not just noise removal.\
Both are offline research adapters; the editor, requirements, controls and export are unchanged.\
Keep the current Denoise and compare the classical prototypes before considering more neural work.

## Scope and reproducibility

MacBook Neo, Apple A18 Pro, 8 GB unified memory; CPUExecutionProvider only,
one intra-op/inter-op/native thread, fixed 512 input tiles, no Electron/WebGPU.
This is Phase 2 of [the brief](../../briefs/denoise-v1-quality-trial-2026-11-16.md),
not approval to ship or relaxation of its proposed limits. The inherited ±10%
timing allowance is descriptive; no repeat-run regression or GPU speedup is claimed.

Implementation is committed in `7bce787f`; this report's commit records the
measurement outcome. Setup used `./codebase/tools/setup.sh`. Extra packages are **onnxruntime 1.32.0**
and **psutil 7.2.2**, installed only in this worktree's `codebase/.venv`.
App requirements are untouched. The two already-downloaded models and config were
copied, never re-downloaded, to
`codebase/output/denoise-v1/candidates/rawnind/rawdenoise-nind/`.

| Local file | Verified SHA-256 |
| --- | --- |
| model_linear.onnx | df957efadcc152c007d5d3b0917bdff9e41c0d4a0efe56584ef30b36393cd181 |
| model_bayer.onnx | da27509dab6a2915da67e988acd86cf71f9d5bbc8d1aa0ed32933578a887b901 |
| config.json | b4b9d94d6f8bb7c401ae36972e3feb4371f8471b5a8708159a5615654033761c |

Each model is about 31.1 MB. Weights stay ignored, not committed. The exact
code licence is [upstream LICENSE at the survey pin](https://github.com/trougnouf/rawnind_jddc/blob/e80fb7b14dc440bba38c01f312fd3cc02deb566c/LICENSE);
the checkpoint-specific grant is the same repository's
[README, Pre-trained models](https://github.com/trougnouf/rawnind_jddc/blob/e80fb7b14dc440bba38c01f312fd3cc02deb566c/README.md#pre-trained-models):
the survey records GPL-3 + CC-BY-4.0, selecting GPL-3 for this GPL app.
The converted [darktable model card and demo contract](https://github.com/darktable-org/darktable-ai/blob/76513a1e379b4265007bae768825b9a581944ff8/models/rawdenoise-nind/README.md)
identify the models, arbitrary learned output scale, packing and CoreML Bayer restriction.
No production installer was built; the 150 MB added-installer limit is unqualified.

### Adapter contracts actually implemented

- **Linear:** ACEScg/D60 → the app's CAT02 linear Rec.2020 transform; mirror-gather
  512 RGB tiles, trim 64 each side, retain 384; sum input/output over disjoint
  retained cores, use one frame-global `mean(input)/mean(raw_output)`, then the
  app's inverse colour transform. No clipping, gamma, per-tile normalisation,
  noise-level input, tone map or artistic grade. Finite out-of-training-range
  values are explicit extrapolation, not a claim of supported HDR restoration.
- **Bayer:** already black/white-normalised **pre-WB** mosaic, all four ordinary
  Bayer orientations canonicalised to spatial RGGB; packed `[R,G1,G2,B]`,
  512 packed tiles → 1024 camera RGB, trim 128, retain 768. Individual CFA-plane
  mirror gathering preserves the two greens; virtual phase padding is cropped
  back to the original sensor coordinates, not resampled. One retained-core
  global gain precedes **exactly one** app `_camera_rgb_to_acescg_float32` tail
  with its own as-shot WB and calibrated camera matrix. It replaces AHD; there
  is no AHD on the neural RGB output. This is the host-tail qualification, not
  a claim that the demo's differently-defined inverse camera matrix is equivalent.
- The upstream demo clips raw values into [0,1]. This adapter does **not**.
  Unsupported CFA/range uses the existing AHD route, with an explicit recorded
  reason. **All eight real quality crops use that range fallback** because
  their black-subtracted sensor inputs include negatives; no neural Bayer
  real-crop denoising gain is claimed. The separate full-frame Bayer timings
  deliberately opt into **unclipped experimental extrapolation**, not that
  default route. The neural path remains CPU-only, including when CoreML is available.
- Strength is `input + s*(denoised-input)` after the common ACEScg tail, with
  Bayer's input interpreted as the same plain-AHD developed reference. Values
  .5/.75/1 are measured, not a redesigned app control. RGB alpha and RGB bypass
  are copied exactly; Bayer bypass means exact AHD baseline, not a raw mosaic.
- Raw network scale is arbitrary: the linear 6400 fabric probe needs a
  normaliser about **−3.09e−10**, Bayer **1.10e−6**. A negative linear normaliser
  is the upstream scale convention, not a negative photographic exposure.
  Denominator magnitude <1e−12, nonfinite gain, or |gain|<1e−12 is an explicit
  failed attempt, never permission to invent a gain. The fixed gain guard is
  tied to these model hashes; zero and near-black RGB fail it. CPU graph
  optimisation disabled/basic produced the same large negative raw linear
  scale during diagnosis; it was not repaired by clipping or arbitrary rescaling.

## Quality measures by ISO

Full harness input/metric set: **27 synthetic cases (nine scenes at each ISO)**
plus **eight real crops** from the two specified high-ISO files. All adapters
see identical sensor readout and AHD truth. No external dataset was downloaded.
The current adapter is `adaptive-atrous-v1`, all default controls .5.

PSNR/SSIM and colour differences are arithmetic means of per-scene measures;
colour p99 is the mean of per-scene p99s, **not a pooled percentile**. Flat std
and ratios are separate per-scene medians. Texture cells list fine-to-coarse
band medians; the additional min–max covers **every valid scene/band**, so a
passing median cannot hide a failure. Bleed means/p99 average only suitable
edge scenes; `—` means unavailable, never a pass. MTF/halo use the slanted edge.
Flat residual numbers are display-SDR units; HDR colour is BT.2124 ΔE ITP
(the harness's scaled ICtCp distance), not SDR ΔE2000.

Synthetic calibration, clipped/quantised sensor simulation, incomplete real
noise truth and fixed SDR/PQ display transforms have the same limitations as
[the baseline](harness-baseline.md). In particular the generated targets use
one provisional Canon fit, and binned low-ISO truth still has some source noise.

### ISO 1600 equivalent

| Measure | Off (AHD) | Current default | Linear 1.0 | Bayer 1.0 |
| --- | --- | --- | --- | --- |
| PSNR dB SDR / HDR | 29.04 / 32.83 | 35.41 / 40.06 | 32.81 / 38.07 | 28.52 / 34.18 |
| SSIM SDR / HDR | 0.673 / 0.767 | 0.890 / 0.939 | 0.875 / 0.915 | 0.867 / 0.913 |
| ΔE2000 mean / p99 | 5.554 / 15.598 | 3.089 / 10.363 | 3.423 / 17.196 | 4.113 / 18.963 |
| ΔE ITP mean / p99 | 16.943 / 53.332 | 7.871 / 33.182 | 8.703 / 54.610 | 11.928 / 58.387 |
| Flat luma std / noisy ratio | 0.0156 / 1.000 | 0.0043 / 0.231 | 0.0038 / 0.211 | 0.0054 / 0.167 |
| Flat chroma std / noisy ratio | 0.0316 / 1.000 | 0.0098 / 0.303 | 0.0061 / 0.155 | 0.0039 / 0.123 |
| Texture band energy / clean (four medians) | 2.161, 1.379, 1.228, 1.069 | 1.134, 1.092, 1.093, 0.979 | 0.326, 0.891, 1.025, 1.048 | 0.304, 0.576, 1.109, 1.132 |
| Texture energy all scene/band min–max | 0.999–187.120 | 0.050–4.998 | 0.006–2.768 | 0.006–3.227 |
| MTF50 / clean | 1.000 | 0.995 | 0.916 | 0.867 |
| Additional halo (% edge height) | 0.36 | 0.22 | 7.73 | 7.16 |
| Colour bleed mean / p99 | 0.044 / 0.227 | 0.035 / 0.213 | 0.080 / 0.360 | 0.090 / 0.398 |
| Invented-detail proxy median / worst | 2.161 / 187.120 | 1.134 / 4.998 | 0.326 / 0.761 | 0.304 / 0.774 |

### ISO 6400 equivalent

| Measure | Off (AHD) | Current default | Linear 1.0 | Bayer 1.0 |
| --- | --- | --- | --- | --- |
| PSNR dB SDR / HDR | 23.13 / 26.64 | 29.92 / 34.87 | 30.32 / 34.84 | 27.61 / 33.12 |
| SSIM SDR / HDR | 0.448 / 0.581 | 0.806 / 0.902 | 0.848 / 0.908 | 0.843 / 0.910 |
| ΔE2000 mean / p99 | 9.985 / 23.877 | 5.600 / 17.333 | 4.571 / 18.485 | 4.743 / 19.463 |
| ΔE ITP mean / p99 | 32.501 / 103.996 | 15.258 / 54.900 | 12.910 / 59.293 | 14.655 / 61.087 |
| Flat luma std / noisy ratio | 0.0318 / 1.000 | 0.0090 / 0.250 | 0.0063 / 0.123 | 0.0065 / 0.117 |
| Flat chroma std / noisy ratio | 0.0645 / 1.000 | 0.0188 / 0.298 | 0.0068 / 0.124 | 0.0059 / 0.100 |
| Texture band energy / clean (four medians) | 5.312, 2.275, 1.664, 1.246 | 1.265, 1.186, 1.273, 1.104 | 0.402, 1.033, 1.065, 1.068 | 0.284, 0.573, 1.144, 1.180 |
| Texture energy all scene/band min–max | 1.019–663.104 | 0.055–17.104 | 0.006–2.563 | 0.007–2.306 |
| MTF50 / clean | 0.964 | 0.916 | 0.901 | 0.848 |
| Additional halo (% edge height) | 2.19 | 0.88 | 7.71 | 6.46 |
| Colour bleed mean / p99 | 0.084 / 0.312 | 0.057 / 0.270 | 0.084 / 0.369 | 0.093 / 0.397 |
| Invented-detail proxy median / worst | 5.312 / 663.104 | 1.265 / 17.104 | 0.402 / 1.173 | 0.284 / 1.012 |

### ISO 25600 equivalent

| Measure | Off (AHD) | Current default | Linear 1.0 | Bayer 1.0 |
| --- | --- | --- | --- | --- |
| PSNR dB SDR / HDR | 17.29 / 20.28 | 23.85 / 29.23 | 26.15 / 30.96 | 25.73 / 30.91 |
| SSIM SDR / HDR | 0.221 / 0.340 | 0.626 / 0.797 | 0.783 / 0.881 | 0.797 / 0.894 |
| ΔE2000 mean / p99 | 16.346 / 32.221 | 10.392 / 26.968 | 7.154 / 21.694 | 6.195 / 21.161 |
| ΔE ITP mean / p99 | 62.788 / 175.416 | 30.786 / 96.833 | 22.940 / 71.147 | 21.147 / 69.555 |
| Flat luma std / noisy ratio | 0.0690 / 1.000 | 0.0217 / 0.314 | 0.0113 / 0.167 | 0.0099 / 0.109 |
| Flat chroma std / noisy ratio | 0.1276 / 1.000 | 0.0420 / 0.335 | 0.0174 / 0.137 | 0.0132 / 0.101 |
| Texture band energy / clean (four medians) | 17.893, 5.999, 3.688, 1.668 | 1.949, 1.589, 1.931, 1.647 | 0.496, 1.076, 1.159, 1.130 | 0.213, 0.549, 1.316, 1.266 |
| Texture energy all scene/band min–max | 1.062–2301.981 | 0.045–168.584 | 0.007–20.294 | 0.008–3.978 |
| MTF50 / clean | 0.916 | 0.737 | 0.874 | 0.843 |
| Additional halo (% edge height) | 7.26 | 0.63 | 3.86 | 7.52 |
| Colour bleed mean / p99 | 0.160 / 0.478 | 0.103 / 0.372 | 0.096 / 0.385 | 0.100 / 0.395 |
| Invented-detail proxy median / worst | 17.893 / 2301.981 | 1.949 / 168.584 | 0.496 / 20.294 | 0.213 / 3.939 |

**Interpretation:** Linear 1.0 improves ISO-25600 SDR/HDR PSNR by **2.30/1.73 dB**,
but ISO-1600 is **2.60/1.99 dB worse**. At ISO 6400 its SDR gain is only
**0.40 dB**, while HDR is **0.03 dB worse**, failing the ≥1 dB requirement.
Bayer 1.0 is **6.89/5.88 dB worse at ISO 1600** and **2.31/1.75 dB worse at
6400**; its high-ISO gain **1.88/1.68 dB** cannot offset those failures.
Both clean median flats well, but neither meets every-scene texture/detail,
halo and colour requirements. The finest-band proxy can be residual noise
rather than genuinely invented structure; the visual evidence below remains necessary.

## Strength trade-off

Cells show SDR/HDR PSNR difference versus current defaults (dB), flat luma/chroma
median ratios, MTF50 ratio, and count of valid scene/band energies outside
0.85–1.15. Lower blend leaves more noise; it does not fix a model/domain mismatch.

### ISO 1600 strengths

| Variant | ΔPSNR SDR / HDR dB | Flat luma / chroma ratio | MTF50 / clean | Failing texture bands |
| --- | --- | --- | --- | --- |
| linear_half | -4.31 / -4.70 | 0.543 / 0.520 | 0.938 | 17/24 |
| linear_three_quarters | -3.27 / -3.19 | 0.350 / 0.333 | 0.921 | 15/24 |
| linear | -2.60 / -1.99 | 0.211 / 0.155 | 0.916 | 16/24 |
| bayer_half | -5.55 / -5.32 | 0.574 / 0.512 | 0.883 | 18/24 |
| bayer_three_quarters | -5.82 / -5.13 | 0.331 / 0.268 | 0.866 | 17/24 |
| bayer | -6.89 / -5.88 | 0.167 / 0.123 | 0.867 | 17/24 |

### ISO 6400 strengths

| Variant | ΔPSNR SDR / HDR dB | Flat luma / chroma ratio | MTF50 / clean | Failing texture bands |
| --- | --- | --- | --- | --- |
| linear_half | -3.02 / -3.25 | 0.510 / 0.525 | 0.914 | 17/24 |
| linear_three_quarters | -1.00 / -1.30 | 0.297 / 0.297 | 0.902 | 17/24 |
| linear | +0.40 / -0.03 | 0.123 / 0.124 | 0.901 | 17/24 |
| bayer_half | -3.56 / -3.25 | 0.509 / 0.525 | 0.864 | 19/24 |
| bayer_three_quarters | -2.44 / -1.99 | 0.335 / 0.271 | 0.851 | 20/24 |
| bayer | -2.31 / -1.75 | 0.117 / 0.100 | 0.848 | 17/24 |

### ISO 25600 strengths

| Variant | ΔPSNR SDR / HDR dB | Flat luma / chroma ratio | MTF50 / clean | Failing texture bands |
| --- | --- | --- | --- | --- |
| linear_half | -1.99 / -1.81 | 0.515 / 0.522 | 0.878 | 19/24 |
| linear_three_quarters | +0.63 / +0.41 | 0.333 / 0.280 | 0.874 | 19/24 |
| linear | +2.30 / +1.73 | 0.167 / 0.137 | 0.874 | 17/24 |
| bayer_half | -2.05 / -1.60 | 0.495 / 0.533 | 0.844 | 21/24 |
| bayer_three_quarters | +0.27 / +0.40 | 0.277 / 0.271 | 0.839 | 21/24 |
| bayer | +1.88 / +1.68 | 0.109 / 0.101 | 0.843 | 22/24 |

No strength meets the full contract. At .5/.75 the linear negatives sentinel
still fails; at 1.0 the worst HDR exposure p99 exceeds 3. The Bayer blends can
reduce the visual demosaic change, but retain more noise and still miss the
low/mid-ISO fidelity target. No per-image tuning or model selection was fitted
against these synthetic answers.

## Real-noise structure and flat residuals

Each cell is flat luma/chroma ratio, then method-noise/edge correlation.
Higher edge correlation suggests removed structure; it is not a truth-based
sharpness measurement. These are the harness's auto-scored regions, not
verified skin/sky patches. There is no portrait skin-accuracy claim.

| Photo / selected region | Current | Linear 1.0 | Bayer 1.0 |
| --- | --- | --- | --- |
| 2025_0730_1331_3.arw-flat | 0.432/0.289; 0.013 | 0.395/0.109; 0.023 | 1.000/1.000; 0.000 (AHD fallback) |
| 2025_0730_1331_3.arw-texture | 0.990/0.914; -0.209 | 0.990/0.859; 0.390 | 1.000/1.000; 0.000 (AHD fallback) |
| 2025_0730_1331_3.arw-edge | 0.916/0.524; -0.014 | 0.909/0.431; 0.010 | 1.000/1.000; 0.000 (AHD fallback) |
| 2025_0730_1331_3.arw-shadow | 0.787/0.398; 0.065 | 0.778/0.279; 0.064 | 1.000/1.000; 0.000 (AHD fallback) |
| IMG_0790.CR2-flat | 0.376/0.346; 0.026 | 0.221/0.133; 0.013 | 1.000/1.000; 0.000 (AHD fallback) |
| IMG_0790.CR2-texture | 0.994/0.851; 0.012 | 0.852/0.620; 0.134 | 1.000/1.000; 0.000 (AHD fallback) |
| IMG_0790.CR2-edge | 0.933/0.890; -0.007 | 0.908/0.853; 0.107 | 1.000/1.000; 0.000 (AHD fallback) |
| IMG_0790.CR2-shadow | 0.417/0.359; 0.119 | 0.305/0.196; 0.124 | 1.000/1.000; 0.000 (AHD fallback) |

The Bayer column is the explicit existing-path fallback on **all eight** real
crops, not neural denoising. Linear strongly cleans the Sony flat/shadow, but
sometimes removes edge-correlated content; this does not meet the strict
“less structure removed than current” requirement on every crop.

## Independent tile grids, exposure and HDR safety

Cached prepared-frame slicing makes the generic harness external grid probe
zero. That is **not** evidence about native inference seams. Independent
preparations on the 512 px ISO-6400 fabric move the actual model grid:

| Variant / native core / shift | SDR ΔE2000 mean / p99 | HDR ΔE ITP mean / p99 | Tiles unshifted / shifted |
| --- | --- | --- | --- |
| linear / 384 / 192 | 0.0208 / 0.1891 | 0.0249 / 0.2152 | 4 / 4 |
| bayer / 768 / 384 | 0.0177 / 0.1494 | 0.0240 / 0.1912 | 1 / 4 |

Both independent grid probes pass mean<1/p99<3 in both presentations. This is
one textured field, not proof against every possible full-frame seam. Native
full-photo review crops provide additional visual inspection, not a seam sweep.

Exposure below is the **worst per-stop** mean/p99 from re-prepared integer
stops −6…+6 on one ISO-6400 fabric probe, not a separate test at each ISO.
For Bayer, bright scaled sensor values leave the supported domain and use the
recorded AHD fallback; the large differences include clipping already present
in that existing baseline route. They must not be called neural exposure invariance.

| Adapter | Worst SDR mean / p99 | Worst HDR mean / p99 | Negative/HDR sentinel |
| --- | --- | --- | --- |
| off | 0.000 / 0.000 | 0.000 / 0.000 | pass |
| denoise_v2 | 0.000 / 0.000 | 0.000 / 0.000 | pass |
| linear_half | 0.502 / 1.098 | 0.805 / 1.715 | FAIL: not every negative retained |
| linear_three_quarters | 0.827 / 1.729 | 1.191 / 2.442 | FAIL: not every negative retained |
| linear | 1.197 / 2.465 | 1.579 / 3.204 | FAIL: not every negative retained |
| bayer_half | 42.394 / 53.523 | 166.086 / 183.083 | not applicable: raw adapter, unqualified |
| bayer_three_quarters | 41.559 / 49.594 | 167.021 / 180.667 | not applicable: raw adapter, unqualified |
| bayer | 41.515 / 47.095 | 168.200 / 180.024 | not applicable: raw adapter, unqualified |

Every measured case returned finite output, and RGB alpha/bypass were exact.
The linear HDR sentinel has some negative pixels, but does **not** retain every
negative sentinel value at any measured strength; constant HDR maximum drift
at 1.0 is **0.2764 scene-linear units**. Above-white values remain. This fails
the hard safety contract even without an explicit clamp. Separate 64 px
constant probes found saturated colour drift **0.0428** and reject zero/1e−7
near-black through the gain guard. Unsupported/failed attempts are not silently
turned into passes. No CPU/GPU agreement or production ceiling/encoding test
was run. The 1000-nit fixed-display-transform check passes but cannot qualify
unchanged production highlight compression or a new denoise integration.

## Bayer on clean synthetic mosaics: demosaic/restoration bias

No noise was added in this separate run; input is each scene's clean mosaic,
reference is its same plain AHD development. Thus this quantifies the combined
**new demosaic + learned clean-image alteration**, not just noise removed.
It cannot attribute every change to one of those two components.

| Clean scene | SDR / HDR PSNR dB vs AHD | SDR ΔE2000 mean / p99 |
| --- | --- | --- |
| slanted-edge | 30.00 / 37.97 | 1.982 / 11.324 |
| siemens-star | 26.08 / 32.13 | 4.643 / 33.702 |
| fine-text | 19.29 / 23.67 | 6.231 / 40.364 |
| colour-patches | 23.74 / 28.88 | 2.668 / 23.417 |
| smooth-gradient | 32.10 / 40.94 | 1.718 / 2.344 |
| star-field | 34.31 / 34.08 | 1.072 / 15.563 |
| fabric | 18.79 / 28.43 | 12.155 / 33.637 |
| DSC00950.ARW | 36.78 / 41.44 | 1.464 / 2.607 |
| DSC04375.ARW | 37.46 / 42.42 | 1.347 / 3.215 |

Mean per-scene PSNR is **28.73 dB SDR / 34.44 dB HDR with no added noise**.
The noise-free slanted edge falls to **0.875× AHD MTF50**, with **7.65%**
additional halo. Fabric changes by **12.155 mean / 33.637 p99 ΔE2000**;
fine text is **19.29 dB SDR**, with p99 ΔE2000 **40.364**. These are large
structure/colour changes already present before noisy-input restoration.
Therefore the noisy Bayer comparison cannot honestly be sold as a pure
noise-removal improvement. The photographic clean scenes are closer to AHD,
but do not erase the fine-pattern failures.

## Visual inspection and coverage limits

Inspected the shared SDR review images locally (matched transforms, enlarged
contact sheets only for inspection; contact sheets are disposable).

- Sony flat/shadow: linear removes much of the coloured grain, but the smooth
  background takes on broad cloudy/mottled transitions. The illuminated sign
  and surrounding fine structure become softer than off/current.
- Canon fire/texture and shadow: linear substantially reduces coloured noise,
  but smooths faint outlines and alters glow/edge neighbourhoods. Clipped-looking
  displayed flame/white areas are the common viewing transform, not evidence
  that the denoiser preserved scene-linear highlight data.
- Generated text/fabric: both neural outputs alter colour/detail and suppress
  the fine weave; a smoother-looking regular pattern is not proof of faithfully
  restored structure. Sparse stars become larger/coloured blotches; residual
  noise and learned bias cannot be separated by the invented-detail proxy alone.
- Bayer's real-quality thumbnails are labelled **AHD FALLBACK**. Native full-frame
  Bayer crops are labelled **experimental extrapolation** and are a separate
  unsupported-range trial. There are no aligned real clean/noisy pairs, no
  independently calibrated dark frame, no validated skin patch and no banding sweep.
- In those native Bayer extrapolations, the Canon flame border is softened with
  orange mottling left around it; the Sony sign retains coloured edge fringes
  and softened neighbouring structure. Smoother real crops do not override the
  clean-mosaic structural/colour failures or establish safe out-of-domain use.

## Full-frame timing, memory, validation and verdict

All native rows below are **measured once**, sequentially under the shared
machine lock, with the verified read-only corpus originals. Timing ends at the
prepared ACEScg result: it includes native decode/preparation, all model tiles,
global gain and colour conversion, but excludes review PNGs and screen drawing.
This is a standalone process, not the editor's action-to-clean-picture wait.
Sources and results are temporary disk-backed arrays; tile gathering is bounded,
with no full-frame mirror-padding copy. Every run has a 20 ms parent RSS guard
at 2.5 GB; no final native run was aborted. Reported RSS is the larger of worker
OS high-water RSS and the parent's whole-run sample (including review writing),
not whole-app memory or physical-footprint/VRAM qualification.

| File / CPU variant | Pixels | Decode/prep s | Session s | Inference s | Stitch/colour s | Total s | Peak RSS GB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| IMG_0790.CR2 / linear | 18.02 MP | 1.033 | 0.060 | 27.596 | 1.297 | 30.010 | 1.371 |
| IMG_0790.CR2 / Bayer extrapolation | 18.02 MP | 0.366 | 0.068 | 6.986 | 0.432 | 7.858 | 1.064 |
| 2025_0730_1331_3.arw / linear | 42.39 MP | 2.133 | 0.155 | 59.628 | 2.863 | 64.842 | 2.243 |
| 2025_0730_1331_3.arw / Bayer extrapolation | 42.39 MP | 0.235 | 0.047 | 15.828 | 0.975 | 17.101 | 1.519 |

The Sony native AHD path returns the app's portrait orientation (7968×5320);
Bayer stays in sensor orientation (5320×7968), and crop locations are transformed
accordingly. Linear uses the app's native camera-RGB normalisation before the
same WB/camera tail, not division by 65535. Bayer native rows opt into unsupported
unclipped negative/above-one input; they are **not** the default AHD fallback's
speed or validated Bayer quality. Inference, packing, global reduction and
colour conversion are included, not just multiplying a cold tile cost.

Native sensor ranges are −0.0787…1.0164 (Canon) and −0.0193…1.0689 (Sony),
so neither is within the Bayer model's default supported range. Canon uses
phase offset [1,0] to canonical RGGB; its two-green packing and camera tail
are covered by synthetic checks for all four Bayer orientations.

The native totals scaled linearly by pixel count give **estimated** 24 MP waits
of **36.71–39.97 s linear / 9.68–10.47 s Bayer**. These are not measured 24 MP actions;
tile rounding, decode cost, disk paging and thermal state need not scale
linearly. Neither proves the proposed ≤45 s CPU action-to-screen target or
the whole-app <4.4 GB peak/<3.4 GB settled requirements. No GPU/export reuse,
interactive slider, installer-size or 61 MP qualification was performed.

**CoreML was not attempted.** Both CPU variants already fail hard quality/HDR
requirements; there is no measured accelerator time, CPU/CoreML agreement or
claimed GPU/ANE gain. Bayer is CPU-only by construction.

### Verdict against the proposed limits

| Variant | Verdict | Decisive findings |
| --- | --- | --- |
| Linear .5 | Do not select | Low/mid-ISO fidelity regresses; insufficient default flat chroma reduction; texture and negative/HDR safeguards fail. |
| Linear .75 | Do not select | ISO 25600 improves only +0.63/+0.41 dB; ISO 1600/6400 regress, detail and HDR/exposure checks fail. |
| Linear 1 | Do not select | ISO 25600 +2.30/+1.73 dB, but ISO 6400 only +0.40/−0.03 dB, low ISO worse, >2% halos and detail/HDR failures. |
| Bayer .5 | Do not select | Every ISO's fidelity below current; texture/edge losses, and no qualified real-sensor operating range. |
| Bayer .75 | Do not select | High ISO only +0.27/+0.40 dB, lower ISOs worse; clean-image change and range/exposure failures remain. |
| Bayer 1 | Do not select | High ISO +1.88/+1.68 dB, lower ISOs worse; MTF50 below .90 throughout, large clean-mosaic alteration and range/exposure failures. |

Independent shifted-grid seams pass, finite outputs and exact RGB bypass/alpha
pass, and median synthetic flats are much cleaner at full strength. Those are
not substitutes for the failed detail, colour, exposure and hard HDR contracts.
Keep the present Denoise; compare the classical worker's results before choosing
any pipeline/control work. This report does not select a shipping replacement.

### Validation and retained evidence

- Corrected full quality run: **35 cases × eight adapters**, **228.93 s**,
  **1.535 GB** peak process RSS, **zero adapter errors**. The first completed
  numerical run exited nonzero only because pre-existing native review images
  pushed the combined folder to 20.669 MB. Review assembly was compacted without
  repeating the quality measurement; native strength .5/.75 images were removed,
  while all three strengths remain in the quality review. An earlier CFA-bug
  trial is superseded, not part of these results.
- Node fast suite: **1091 passed, one skipped, zero failed** (1092 tests).
- Final Python fast suite: **3914 passed, 144 skipped, one xpassed**, zero
  failures, **240.89 s**, **2.204 GB** sampled peak RSS; no guard abort.
  It includes the final optional model checks and CFA/WB/camera-tail assertions.
  The existing Starlette/httpx deprecation warning remains; no unrelated
  failures remain in the final run. Final review assembly: **18,254,941 bytes**
  (18.255 MB), all referenced images and stylesheets present.
- An initial Python run used scratch under this hidden `.t3` worktree; the
  Library's intentional hidden-folder filter caused 12 health-list assertions.
  The measurement wrapper now uses system TEMP for pytest and removes it on
  completion. Those failures are not attributed to the app or waived.
- Final output-size check: **13.0 GB** including the shared 12.9 GB test-photo
  link, below the 100 GB limit. Disposable contact sheets and native float
  scratch were removed; the linked review images and compact JSON/logs remain.
- No Electron/WebGPU/GPU check was run: these changes are standalone CPU research
  tools, not production denoise, rendering, Proof/export, shaders or budgets.

Review: `codebase/output/denoise-v1/rawnind/review/index.html`. Native rows provide
four labelled 256 px crops per photo/variant (flat, texture, edge, shadow) with
matched viewing lifts; there is no claim of a verified skin patch. Small quality
images are 128 px to keep the eight-way comparison bounded. Full JSON evidence:
`results-full.json`, `probes.json`, `full-*.json` and `guard-*.json` in
`codebase/output/denoise-v1/rawnind/`; fast-check logs are beside that directory.
Weights and machine-local output are deliberately ignored, not embedded in Git.
