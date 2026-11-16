# RawNIND UtNet2 Phase 2 prototype — November 16, 2026

Neither RawNIND variant is ready to replace the current Denoise.\
Linear cleans high-ISO flats well, but loses detail, adds halos and fails HDR/exposure checks.\
Bayer also changes a noise-free image substantially, so its differences are not just noise removal.\
Both are offline research adapters; the editor, requirements, controls and export are unchanged.\
Keep the current Denoise and compare the classical prototypes before considering more neural work.

**Bayer verification notice:** the original Bayer contracts, measurements,
range-fallback conclusions and native-speed qualification below are superseded
by **Verification, November 16** at the end. Earlier numbers are retained for
traceability. Linear results are unchanged.

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

## Verification, November 16

Bug found: the adapter counted green twice in its global exposure anchor and incorrectly rejected ordinary negative sensor read noise.\
What changed: use the AHD camera-RGB mean for gain, clip only normalised sensor input to upstream's [0,1], and verify the pinned demo independently.\
New verdict: full-strength Bayer now beats current Denoise at ISO 6400/25600, but no strength meets the complete quality contract; clean fine-pattern damage also occurs upstream.

### What was reproduced, and what was actually wrong

This verification starts from `d317c589`; its correction and verification
tooling are committed in `6fe14d32`. Conditions: MacBook Neo / Apple A18 Pro /
8 GB, CPU only. No Electron, WebGPU, CoreML or new training checkpoint was used.
The existing Bayer ONNX was copied from the specified sibling worktree, then
verified as SHA-256
`da27509dab6a2915da67e988acd86cf71f9d5bbc8d1aa0ed32933578a887b901`.
ORT 1.32.0 and psutil 7.2.2 are local venv-only research dependencies.

Read-only upstream snapshots, never committed:

- darktable-ai `76513a1e379b4265007bae768825b9a581944ff8`,
  `models/rawdenoise-nind/demo.py`, SHA-256
  `3667abc93564bad3646fd4530b7b07585a1e52e0b5c08169bee8ee48e5d1f06e`;
  its README and converter were inspected too. The demo has no local Python
  helper import: its colour conversion, tiler and save helpers are in that file.
- rawnind_jddc `e80fb7b14dc440bba38c01f312fd3cc02deb566c`,
  `src/rawnind/libs/rawproc.py` (SHA-256
  `6827d8b55e0c040b96e59b7ce86aef4d37e5c4d22ebaf6de3222ed87800749d8`),
  its `raw.py` demosaic/colour helper and the Bayer training config. The
  `camRGB_to_lin_rec2020_images` convention agrees with the demo.

They are under `codebase/output/denoise-v1/verify/upstream/`. The committed
`verify_rawnind.py` imports the hash-checked original demo rather than copying
its implementation. It calls the actual `pack_rggb`, `_run_tiled`, `_match_gain`,
`cam_rgb_to_lin_rec2020` and `_save`, then reads back the temporary uint16 TIFF
and deletes it. The CPU session uses one thread and bounded allocation options;
the same verified graph, FP32 tensors, tile sizes and arithmetic are used.

**The Bayer model emits un-white-balanced camera RGB at double the packed
resolution, with arbitrary learned gain.** It is not ACEScg or Rec.2020,
and its camera matrix is not baked in. The demo:

1. subtracts each CFA channel's black level and divides by global
   `raw.white_level - channel_black`, clipping the normalised sensor to [0,1];
2. packs R/G1/G2/B without applying WB, infers 512 packed tiles with 64 packed
   halo, and retains the corresponding 768 sensor-pixel cores;
3. matches the camera-RGB output mean to the packed sensor mean;
4. applies `XYZ_to_Rec2020 @ inverse(raw.rgb_xyz_matrix[:3,:])`, with **no
   additional WB**, then clips Rec.2020 to [0,1] and saves a **linear** TIFF/EXR
   (no display gamma; a colour-aware viewer must supply the view transform).

That final file-save clamp is **not** copied into the host: developed negative
and above-white scene values remain intact. The host correctly applies its own
single WB/calibrated camera-to-ACEScg tail to both AHD and neural camera RGB.
There was no evidence of a reversed matrix, double WB or already-Rec.2020 neural
output. Linear has a separate gain/colour path and was not rerun as a quality
candidate; its previous measurements and verdict remain unchanged.

**The gain bug was at the interface between those conventions.** A packed mean
weights R:G:B as 1:2:1; the camera-RGB mean weights them 1:1:1. The old adapter
copied the demo's sensor-mean anchor but compared with **unmatched** AHD, unlike
the same-path reference, where both demosaicers undergo the demo's match. On the
clean gradient the AHD mean needed a factor about 1.106 to reach that sensor
anchor, so only matching the neural result introduced an exposure shift.
The correction divides out that AHD matching factor: a single global
`mean(AHD camera RGB) / mean(neural camera RGB)` before the unchanged host tail.
This is not per-tile normalisation, a fitted colour correction, or a new limit.
It needs an additional AHD pass to obtain the exact anchor; the original native
Bayer timing rows do **not** measure this revised algorithm.

The standalone demo's plane selection is also not a spatial canonicalisation
for non-RGGB sensors. Its literal G1/G2 scan order and missing phase restoration
make it an unsuitable alignment oracle for Canon's GRBG mosaic. We reproduce
that literal path, but additionally take an even sensor crop beginning at its
red site (510×512 for the Canon charts) before feeding **both** AHD and the
unchanged demo. No shift search or resampling is used. The host's existing
phase-correct gather is retained. The independently inferred canonical camera
RGB, scaled by the AHD anchor and passed through the host matrix, agrees with
the corrected adapter to mean SDR ΔE2000 **<0.00001** on every reference scene.
This separates packing/alignment and host colour conversion from model change.

### Clean-mosaic and low-ISO reference comparison

Upstream columns use that canonical same-input/same-gain/same-matrix path,
before its file clamp; host columns use the original full crop and AHD truth.
The saved-TIFF comparisons are also recorded in `verify/reference.json`,
alongside literal-demo comparisons, matrices, CFA, crop coordinates and ranges.
Low-ISO rows are the two requested **unbinned** central 512×512 native crops,
normalised exactly by the demo's global-white convention. All sources are the
read-only approved photo set, not personal-folder copies.

| Clean scene | Upstream vs AHD: SDR dB / ΔE2000 mean | Corrected host vs AHD: SDR / HDR dB | Host ΔE2000 mean / p99 |
| --- | --- | --- | --- |
| slanted-edge | 36.80 / 0.531 | 36.94 / 41.38 | 0.562 / 10.915 |
| siemens-star | 27.90 / 3.489 | 28.02 / 33.21 | 3.568 / 33.212 |
| fine-text | 19.56 / 5.644 | 19.54 / 23.87 | 5.488 / 39.484 |
| colour-patches | 25.52 / 1.957 | 24.45 / 29.62 | 2.110 / 23.210 |
| smooth-gradient | 64.72 / 0.141 | 64.87 / 72.78 | 0.158 / 0.371 |
| star-field | 34.64 / 0.998 | 34.66 / 34.49 | 0.985 / 14.981 |
| binned DSC00950.ARW | 48.78 / 0.779 | 48.87 / 56.12 | 0.675 / 2.294 |
| binned DSC04375.ARW | 46.93 / 0.542 | 47.10 / 52.25 | 0.647 / 3.076 |
| fabric | 19.15 / 11.538 | 19.27 / 29.04 | 12.054 / 32.653 |
| low-ISO DSC04375.ARW | 44.56 / 0.773 | 44.66 / 49.31 | 0.890 / 2.692 |
| low-ISO DSC00950.ARW | 43.58 / 1.493 | 43.66 / 50.80 | 1.305 / 4.034 |

The nine-scene host clean mean is now **35.97 / 41.42 dB SDR/HDR**, superseding
28.73/34.44. Smooth-gradient fidelity rises **32.10 → 64.87 dB SDR**, and both
natural low-ISO crops now meet the illustrative 38 dB / mean ΔE <2 diagnostic.
But **the same-path upstream model still changes clean fabric and text badly**:
19.15 dB / mean ΔE 11.538 for fabric, 19.56 dB for text. Clean slanted-edge
MTF50 remains **0.875× AHD**, with **7.61%** additional halo in the corrected
host. This is a limitation of this specific packaged ONNX joint
denoise/demosaic result versus AHD, not a general verdict on RawNIND research
or proof of whether the original PyTorch checkpoint would behave identically.
There is no clean ground-truth demosaic that establishes which individual
fine-pattern pixels are physically correct; the brief still requires those
detail/halo safeguards.

### Corrected full-set quality tables

Same 27 synthetic cases (nine scenes × three ISOs), same seeds, calibration,
truth, transforms, masks and measures as above; plus the same eight real
640×640 crops. **Only Bayer is changed.** Off/current baselines reproduce the
earlier values. Arithmetic per-scene means, flat medians, complete scene/band
extrema and slanted-edge measures use the earlier aggregation convention.
The high-band proxy is not by itself proof of hallucination. No tolerance is
relaxed. The following tables supersede the original Bayer columns at **all
three strengths**, not the untouched linear columns.

#### ISO 1600 equivalent

| Measure | Off (AHD) | Current default | Bayer .5 | Bayer .75 | Bayer 1 |
| --- | --- | --- | --- | --- | --- |
| PSNR SDR / HDR dB | 29.04 / 32.83 | 35.41 / 40.06 | 30.68 / 35.23 | 31.81 / 36.77 | 32.95 / 38.74 |
| SSIM SDR / HDR | 0.673 / 0.767 | 0.890 / 0.939 | 0.805 / 0.884 | 0.862 / 0.917 | 0.869 / 0.914 |
| ΔE2000 mean / p99 | 5.554 / 15.598 | 3.089 / 10.363 | 3.947 / 13.694 | 3.440 / 15.585 | 3.555 / 18.461 |
| ΔE ITP mean / p99 | 16.943 / 53.332 | 7.871 / 33.182 | 10.853 / 48.117 | 9.009 / 50.597 | 8.604 / 56.560 |
| Flat luma std / noisy ratio | 0.0156 / 1.000 | 0.0043 / 0.231 | 0.0103 / 0.548 | 0.0059 / 0.301 | 0.0030 / 0.131 |
| Flat chroma std / noisy ratio | 0.0316 / 1.000 | 0.0098 / 0.303 | 0.0181 / 0.527 | 0.0100 / 0.275 | 0.0038 / 0.120 |
| Texture band medians | 2.161, 1.379, 1.228, 1.069 | 1.134, 1.092, 1.093, 0.979 | 1.019, 1.110, 1.528, 1.192 | 0.692, 1.004, 1.179, 1.036 | 0.287, 0.533, 1.023, 1.044 |
| Texture all scene/band min–max | 0.999–187.120 | 0.050–4.998 | 0.223–51.857 | 0.063–13.908 | 0.006–3.167 |
| MTF50 / clean | 1.000 | 0.995 | 0.886 | 0.867 | 0.867 |
| Additional halo % | 0.36 | 0.22 | 1.55 | 3.82 | 7.32 |
| Colour bleed mean / p99 | 0.044 / 0.227 | 0.035 / 0.213 | 0.060 / 0.269 | 0.073 / 0.329 | 0.089 / 0.394 |
| High-band proxy median / worst | 2.161 / 187.120 | 1.134 / 4.998 | 1.019 / 51.857 | 0.692 / 13.908 | 0.287 / 0.713 |

#### ISO 6400 equivalent

| Measure | Off (AHD) | Current default | Bayer .5 | Bayer .75 | Bayer 1 |
| --- | --- | --- | --- | --- | --- |
| PSNR SDR / HDR dB | 23.13 / 26.64 | 29.92 / 34.87 | 26.57 / 31.71 | 28.58 / 33.70 | 31.26 / 36.21 |
| SSIM SDR / HDR | 0.448 / 0.581 | 0.806 / 0.902 | 0.621 / 0.778 | 0.750 / 0.873 | 0.841 / 0.910 |
| ΔE2000 mean / p99 | 9.985 / 23.877 | 5.600 / 17.333 | 6.780 / 19.429 | 5.153 / 18.396 | 4.266 / 19.059 |
| ΔE ITP mean / p99 | 32.501 / 103.996 | 15.258 / 54.900 | 18.654 / 65.644 | 14.176 / 58.602 | 11.770 / 59.545 |
| Flat luma std / noisy ratio | 0.0318 / 1.000 | 0.0090 / 0.250 | 0.0197 / 0.508 | 0.0117 / 0.280 | 0.0042 / 0.078 |
| Flat chroma std / noisy ratio | 0.0645 / 1.000 | 0.0188 / 0.298 | 0.0356 / 0.536 | 0.0186 / 0.278 | 0.0057 / 0.096 |
| Texture band medians | 5.312, 2.275, 1.664, 1.246 | 1.265, 1.186, 1.273, 1.104 | 1.998, 1.432, 1.841, 1.538 | 0.964, 1.124, 1.651, 1.192 | 0.281, 0.530, 1.062, 1.095 |
| Texture all scene/band min–max | 1.019–663.104 | 0.055–17.104 | 0.246–186.483 | 0.069–52.438 | 0.006–2.397 |
| MTF50 / clean | 0.964 | 0.916 | 0.866 | 0.851 | 0.847 |
| Additional halo % | 2.19 | 0.88 | 2.78 | 5.30 | 7.58 |
| Colour bleed mean / p99 | 0.084 / 0.312 | 0.057 / 0.270 | 0.076 / 0.300 | 0.081 / 0.341 | 0.092 / 0.394 |
| High-band proxy median / worst | 5.312 / 663.104 | 1.265 / 17.104 | 1.998 / 186.483 | 0.964 / 52.438 | 0.281 / 0.948 |

#### ISO 25600 equivalent

| Measure | Off (AHD) | Current default | Bayer .5 | Bayer .75 | Bayer 1 |
| --- | --- | --- | --- | --- | --- |
| PSNR SDR / HDR dB | 17.29 / 20.28 | 23.85 / 29.23 | 21.76 / 27.57 | 24.56 / 29.99 | 27.98 / 32.89 |
| SSIM SDR / HDR | 0.221 / 0.340 | 0.626 / 0.797 | 0.383 / 0.603 | 0.557 / 0.776 | 0.796 / 0.894 |
| ΔE2000 mean / p99 | 16.346 / 32.221 | 10.392 / 26.968 | 11.570 / 27.396 | 8.402 / 24.043 | 5.794 / 20.769 |
| ΔE ITP mean / p99 | 62.788 / 175.416 | 30.786 / 96.833 | 34.314 / 99.680 | 24.864 / 79.780 | 19.000 / 68.035 |
| Flat luma std / noisy ratio | 0.0690 / 1.000 | 0.0217 / 0.314 | 0.0374 / 0.512 | 0.0210 / 0.288 | 0.0115 / 0.109 |
| Flat chroma std / noisy ratio | 0.1276 / 1.000 | 0.0420 / 0.335 | 0.0713 / 0.553 | 0.0341 / 0.277 | 0.0126 / 0.099 |
| Texture band medians | 17.893, 5.999, 3.688, 1.668 | 1.949, 1.589, 1.931, 1.647 | 5.312, 2.601, 2.746, 1.806 | 1.741, 1.382, 1.957, 1.765 | 0.228, 0.517, 1.309, 1.213 |
| Texture all scene/band min–max | 1.062–2301.981 | 0.045–168.584 | 0.371–563.782 | 0.100–155.359 | 0.007–3.995 |
| MTF50 / clean | 0.916 | 0.737 | 0.845 | 0.839 | 0.843 |
| Additional halo % | 7.26 | 0.63 | 4.08 | 5.77 | 8.96 |
| Colour bleed mean / p99 | 0.160 / 0.478 | 0.103 / 0.372 | 0.113 / 0.367 | 0.099 / 0.361 | 0.100 / 0.392 |
| High-band proxy median / worst | 17.893 / 2301.981 | 1.949 / 168.584 | 5.312 / 563.782 | 1.741 / 155.359 | 0.228 / 3.956 |

### Real crops: now neural, not fallback

All **24 Bayer preparations** (eight crops × three strengths) infer successfully
with model inputs in [0,1]; **zero AHD fallbacks**, finite outputs throughout.
Between 6.73% and 37.28% of sensor samples are clipped on these dark/noisy
crops. This is the requested upstream sensor convention, not a claim that
those camera signals originally contained no negative read noise. Baselines
already used the same sensor clip inside AHD development.

Cells retain the previous measures: flat luma/chroma ratios, then signed
method-noise/edge correlation. These are auto-scored regions without paired
clean truth; correlation is a diagnostic, not proof that every removed edge
was genuine detail. Negative current correlations are not converted to
absolute values to improve the candidate's apparent standing.

| Photo / region | Current | Bayer .5 | Bayer .75 | Bayer 1 |
| --- | --- | --- | --- | --- |
| 2025_0730_1331_3.arw-flat | 0.432/0.289; 0.013 | 0.550/0.547; 0.025 | 0.440/0.283; 0.024 | 0.399/0.112; 0.024 |
| 2025_0730_1331_3.arw-texture | 0.990/0.914; -0.209 | 0.993/0.897; 0.371 | 0.991/0.865; 0.383 | 0.991/0.854; 0.388 |
| 2025_0730_1331_3.arw-edge | 0.916/0.524; -0.014 | 0.930/0.640; 0.008 | 0.908/0.495; 0.008 | 0.899/0.436; 0.009 |
| 2025_0730_1331_3.arw-shadow | 0.787/0.398; 0.065 | 0.826/0.566; 0.059 | 0.786/0.372; 0.061 | 0.773/0.287; 0.064 |
| IMG_0790.CR2-flat | 0.376/0.346; 0.026 | 0.563/0.573; 0.031 | 0.314/0.295; 0.018 | 0.196/0.128; 0.009 |
| IMG_0790.CR2-texture | 0.994/0.851; 0.012 | 0.905/0.814; 0.129 | 0.868/0.734; 0.140 | 0.853/0.701; 0.149 |
| IMG_0790.CR2-edge | 0.933/0.890; -0.007 | 0.935/0.892; 0.098 | 0.918/0.865; 0.108 | 0.913/0.858; 0.119 |
| IMG_0790.CR2-shadow | 0.417/0.359; 0.119 | 0.619/0.619; 0.115 | 0.405/0.377; 0.123 | 0.313/0.252; 0.125 |

At strength 1 the Canon flat passes the proposed flat-noise ratios
(0.196/0.128), and the Sony flat improves chroma strongly (0.112) but has
more edge-correlated method noise than current (0.024 vs 0.013). Sony lifted
shadow luma remains 0.773 of input, above the 0.5 target. Texture/edge
correlation is worse than current on both cameras. The old real-crop
"Bayer equals AHD" conclusion is therefore **withdrawn**, not confirmed.

### Deep-shadow bias from the required sensor convention

Two effects must not be conflated. **Sensor clipping** changes the mean of
normalised raw samples below .01, including negative read noise. **Model vs
AHD shadow shift** is measured on pixels whose mean developed linear ACEScg
RGB is below .01, before the common viewing exposure; it includes model
restoration, demosaic and global gain, not clipping alone. All three colour
channels are averaged, not display-encoded or called luminance. The JSON
also retains per-channel changes, masks' counts and source coordinates.

All numerical values in the next table are **×10⁻³ linear units**, before
viewing exposure. Positive means brighter. Raw and developed columns are
different domains and must not be subtracted from each other.

| Photo / region | Developed shadow pixels | Raw clipping-only mean shift | AHD shadow mean | Bayer 1 minus AHD shadow mean |
| --- | --- | --- | --- | --- |
| 2025_0730_1331_3.arw-flat | 399245 | +0.0796 | 3.6173 | +0.1818 |
| 2025_0730_1331_3.arw-texture | 61151 | +0.0123 | 6.1421 | +2.3322 |
| 2025_0730_1331_3.arw-edge | 168105 | +0.0877 | 3.5108 | +0.5959 |
| 2025_0730_1331_3.arw-shadow | 345150 | +0.0780 | 3.6309 | +0.2733 |
| IMG_0790.CR2-flat | 398080 | +0.8049 | 2.7742 | +0.2485 |
| IMG_0790.CR2-texture | 177404 | +0.3783 | 4.8773 | +1.5005 |
| IMG_0790.CR2-edge | 50938 | +0.2023 | 6.1686 | +3.2987 |
| IMG_0790.CR2-shadow | 345121 | +0.7143 | 3.0824 | +0.0502 |

For .5 and .75 the developed mean shifts are exactly the corresponding
blend fractions apart from float rounding; raw clipping is identical at all
strengths. AHD(original normalised sensor) and AHD(pre-clipped sensor) have
**zero maximum RGB difference on all eight crops**, because AHD already clips
at this harness boundary. Thus there is no extra *differential* clipping-only
bias against the AHD comparator; the positive neural-minus-AHD shifts above
are additional measured restoration effects. There is no unclipped clean
sensor truth with which to certify absolute shadow accuracy.

### Safeguards and updated strength verdicts

Independent native model grids (one tile vs four, shifted by 384 sensor px)
pass: SDR ΔE2000 mean/p99 **0.0172/0.1450**, HDR ΔE ITP **0.0238/0.1895**.
The standard harness's cached-frame slice seam results are not used as
independent evidence. Developed exposure −6…+6, **after sensor development**,
scales back exactly in the separate negative/HDR sentinel (mean/p99 ΔE = 0).
At +6 its finished scene array spans approximately **−3.87…19.21**, proving
there is no downstream [0,1] clamp. RGB alpha is inapplicable to a 2D sensor
input; Bayer bypass remains the exact AHD result. No export/Proof, GPU or
production highlight-ceiling qualification is claimed.

The generic harness also scales the **raw sensor** by −6…+6; those results
remain recorded but are not a failure of developed HDR preservation: positive
scaling saturates [0,1] by the input convention Steve explicitly requested.
That raw-saturation experiment cannot supersede the post-development test.

| Strength | PSNR difference from current SDR/HDR, ISO 1600; 6400; 25600 | Verdict against proposed limits |
| --- | --- | --- |
| .5 | −4.73/−4.83; −3.35/−3.17; −2.09/−1.66 dB | Do not select: fidelity worse at every ISO; median chroma ratio 0.527–0.553 fails ≤0.30, MTF50 0.845–0.886 fails ≥0.90, texture/bleed and real structure fail. |
| .75 | −3.60/−3.29; −1.34/−1.17; +0.71/+0.75 dB | Do not select: low/mid ISO worse and high-ISO gain below +1 dB; MTF50 0.839–0.867, halo 3.82–5.77%, texture and real structure fail. |
| 1 | −2.47/−1.32; +1.34/+1.34; +4.13/+3.66 dB | Do not select: genuine mid/high-ISO fidelity gains and strong flat cleanup, but low-ISO fidelity/colour worse, low/mid colour p99 worse, MTF50 0.843–0.867, halo 7.32–8.96%, fine texture/bleed and real structure fail. |

**Answer to the review question: both.** The report overstated the Bayer
model's low/mid-ISO failure because the adapter had a gain-domain mismatch,
and it did not evaluate neural Bayer on real crops at all. Those conclusions
are corrected. The model's clean fabric/text/edge alteration, however,
survives a pinned, aligned upstream reference and is not explained by a host
WB/matrix/CFA bug. Keep current Denoise; do not reject all future RawNIND
models based on the flawed original adapter, and do not qualify this specific
ONNX model from PSNR improvements alone.

### Verification evidence and checks

- Full-set rerun: **35 cases × five adapters, zero errors**, shared-lock CPU
  run, **103.0 s**, sampled process peak **1.377 GB**. This is not a speedup
  comparison with the earlier eight-adapter run.
- Clean/no-noise and independently shifted native-grid probe completed under
  the same 2.5 GB guard. The pinned reference also records the eight real bias
  cases and developed-exposure sentinel. No model downloads or RAW copies are
  committed; temporary demo TIFFs and guard TEMP folders are removed.
- Results-based regressions check an arbitrary-gain camera output against AHD
  (would fail when green is counted twice), a real-model clean gradient's
  colour/exposure, equality of clipped/unclipped sensor invocations under the
  adopted convention, and retention of negative/above-white developed pixels.
  Actual-model checks skip if the optional model/runtime is absent.
- Retained evidence: `codebase/output/denoise-v1/rawnind/results-full.json`,
  `probes.json`, guard receipts and `review/index.html`;
  `codebase/output/denoise-v1/verify/reference.json` and
  `reference-before-fix.json`, read-only source snapshots and validation logs.
  The existing review directory is overwritten, not copied into a new gallery.

Final validation: **Node 1,091 passed / one skipped / zero failures**;
**Python 3,917 passed / 147 skipped / one xpassed / zero failures**, with the
existing Starlette/httpx deprecation warning. Python's guard samples a
**2.062 GB** peak; the final pinned reference samples **1.406 GB**, with no
guard abort. Reference/crop/bias preparation takes **54.8 s**, not a native
whole-photo or action-to-screen timing. The final review is **12,310,163 B**
(12.31 MB), every linked asset exists, and no temporary TIFF remains. Final
output size is **13.0 GB** including the 12.9 GB shared read-only photo link,
below 100 GB. No GPU driver covers these CPU-only research adapters and none
was launched. No production module, pinned shader, budget, saved project,
shipping requirement or dependency is changed.
