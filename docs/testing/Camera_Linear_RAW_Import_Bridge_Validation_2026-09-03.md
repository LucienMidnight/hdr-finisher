# Camera-Linear RAW Import Bridge Validation

**Date:** September 3, 2026  
**Sprint:** [Camera-Linear RAW Import Bridge](../product/Camera_Linear_RAW_Import_Bridge_Sprint_PRD_2026-09-03.md)  
**Engineering result:** Pass  
**Product-owner visual result:** Accepted; sprint closed September 3, 2026. Niagara, both Canon files, and the unclipped Nikon fixture pass; Sony `DSC04375.ARW` passes after exposure normalization; Sony `DSC00264.ARW` matches darktable's opposed-color limitation. The Fujifilm RAF is accepted with a documented low-exposure blue residual in clipped speculars.

## Outcome

Qualifying ordinary mosaiced RGB/RGBG Bayer and X-Trans RAWs now use the inspectable
`camera_linear_float_bridge_opposed_v2` route. LibRaw 0.22.1 retains AHD demosaic and supplies a
unity-WB, no-auto-scale camera-RGB `uint16` transport. HDR Finisher converts that transport to
`float32`, normalizes it once, applies as-shot white balance, converts camera RGB to XYZ/D65 and
then ACEScg/D60, and never clamps the canonical result to `[0, 1]`.

The visual-QA amendment adds one intentionally small highlight method: `opposed_color_v1`. It
operates on a temporary normalized `float32` CFA mosaic before AHD, uses the UI threshold with
darktable's `0.987` safety factor, estimates clipped photosites from the two opposing color channels
in a local 3x3 neighborhood, and applies a chrominance residual learned from nearby unclipped
photosites. Only repaired samples are re-encoded into LibRaw's writable `uint16` mosaic; that array
remains transport rather than the canonical representation. Values below the reconstruction mask
are byte-for-byte unchanged in the bridge output, while the final ACEScg image retains finite
negative and greater-than-one values.

The module is exposed between RAW Development and Denoise. Its bypass eye is the explicit Off
state; the only v1 method is Opposed color; and clipping threshold is the sole tuning control.
Method identity, algorithm version, enabled state, threshold, candidate/repaired counts,
chrominance statistics, stage, and transport overflow are inspectable in diagnostics. New imports
default to enabled. Projects created before the field existed are opened with an explicit disabled
recipe so their appearance is preserved.

Unsupported sensor/color models continue through the named
`legacy_libraw_aces_fallback_v1` path with an exact reason. No Blend/ReconstructDefault switch,
texture reconstruction, hot-pixel repair, denoise, alternate demosaic/RAW engine, camera rule, or
content-specific correction was added. Lensfun remains after RAW color development. Transactional
activation, re-development, cancellation, project state, preview/export parity, and orientation
behavior are preserved.

## Decoder and matrix contract

The development environment uses Python 3.12.10, NumPy 2.5.1, rawpy 0.27.0, and LibRaw 0.22.1.
The matrix orientation and white convention were established from the actual bundled APIs and
source, not inferred from the rawpy property name:

- rawpy's `rgb_xyz_matrix` is a direct copy of LibRaw `cam_xyz[4][3]`.
- LibRaw's `cam_xyz_coeff()` treats each `cam_xyz` row as an XYZ-to-camera response, normalizes the
  rows against D65, and pseudoinverts the result for its camera-to-output conversion.
- HDR Finisher therefore assembles RGB rows, validates repeated-green rows, normalizes the
  XYZ-to-camera rows against D65 `(0.95047, 1.0, 1.08883)`, inverts to camera-to-XYZ/D65,
  Bradford-adapts D65 to D60, and applies the existing XYZ/D60-to-ACEScg matrix.
- With `no_auto_scale=True`, LibRaw skips `scale_colors()`. Black subtraction has already occurred
  in the returned camera-RGB transport, so HDR Finisher divides by `(camera white - camera black)`
  without subtracting black a second time.
- Raw output color bypasses LibRaw's destination-space matrix construction. The requested Clip mode
  is recorded honestly as bypassed by no-auto-scale; spatial reconstruction is the preceding
  explicit HDR Finisher stage.

Audited sources: [rawpy 0.27.0 `_rawpy.pyx`](https://github.com/letmaik/rawpy/blob/v0.27.0/rawpy/_rawpy.pyx),
[LibRaw 0.22.1 `dcraw_process.cpp`](https://github.com/LibRaw/LibRaw/blob/0.22.1/src/postprocessing/dcraw_process.cpp),
[LibRaw 0.22.1 `utils_dcraw.cpp`](https://github.com/LibRaw/LibRaw/blob/0.22.1/src/utils/utils_dcraw.cpp), and
[LibRaw 0.22.1 color constants](https://github.com/LibRaw/LibRaw/blob/0.22.1/src/tables/colorconst.cpp).

The opposed method was validated against darktable's current implementation and parameters:
[opposed algorithm](https://github.com/darktable-org/darktable/blob/master/src/iop/hlreconstruct/opposed.c),
[reference calculation](https://github.com/darktable-org/darktable/blob/master/src/iop/hlreconstruct/segbased.c), and
[module defaults and clip factors](https://github.com/darktable-org/darktable/blob/master/src/iop/highlights.c).
Attribution is recorded in `THIRD_PARTY_NOTICES.md` under the repository's GPL-3.0-only license.

## Corpus integrity and method

The qualification tool verified every SHA-256 from the sprint PRD before opening a source. All
eight matched. The private corpus was read in place and was never copied into the repository.
Intermediate arrays were created only under an automatically removed directory inside ignored
`codebase/output/`. The retained ignored machine-readable evidence is
`codebase/output/camera-linear-raw-highlight-qualification-repeat3.json`, generated at
`2026-09-03T11:07:31Z`.

Each render ran in a fresh worker process. Required performance fixtures used three repeats and the
median; the other camera files used one repeat. The tool compared legacy, bridge with reconstruction
bypassed, and bridge with opposed reconstruction. It measured dimensions, dtype/contiguity,
finite/negative/greater-than-one counts, channel maxima, transport ceiling counts, deterministic
safely sub-clipped samples, runtime, and peak resident memory.

Reproduce the three-repeat qualification with:

```powershell
cd codebase
.\.venv\Scripts\python.exe tools\qualify_camera_linear_raw.py `
  --root "D:\Photos\HDR Test Images\Test Suite Images" `
  --output output\camera-linear-raw-highlight-qualification-repeat3.json `
  --repeats 3
```

The pytest wrapper is opt-in through `HDR_FINISHER_RAW_TEST_SUITE` and skips cleanly when the private
corpus is unavailable.

## Cross-vendor qualification

Every camera file selected the new bridge; no primary file fell back. Every result is oriented,
contiguous HxWx3 `float32` ACEScg with zero non-finite values. Dimensions below are displayed as
width x height. Candidate and repaired counts are grouped as RGB CFA photosites.

| File | CFA | Result | Candidate RGB | Repaired RGB | Legacy exact `65535` RGB | Bridge exact `65535` RGB | ACEScg maxima RGB | Outcome |
|---|---|---:|---:|---:|---:|---:|---:|---|
| `2L1B8631.CR2` | 2x2 RGBG | 5796x3870 | 59 / 746,665 / 123,706 | 0 / 725,992 / 1,299 | 0 / 22 / 5,119,281 | 0 / 0 / 0 | 2.2909 / 1.6943 / 2.2598 | Pass; critical ceiling removed and Niagara color visually accepted |
| `DSC00264.ARW` | 2x2 RGBG | 5320x7968 | 76,691 / 646,713 / 113,021 | 0 / 569,848 / 88,234 | 0 / 1,082,199 / 869,165 | 0 / 0 / 0 | 2.8793 / 2.2913 / 2.7225 | Reference-parity pass; saturated bokeh retains opposed-method pink/green boundary |
| `DSC04375.ARW` | 2x2 RGBG | 5320x7968 | 0 / 124,091 / 6,564 | 0 / 117,276 / 0 | 0 / 135,222 / 256,175 | 0 / 0 / 0 | 1.6419 / 1.7408 / 2.1587 | Pass after exposure normalization |
| `Fujifilm_X-E2S_DSCF6495.RAF` | 6x6 RGBG | 4934x3296 | 1,261 / 3,212 / 575 | 839 / 2,537 / 0 | 602 / 1,620 / 3,979 | 0 / 0 / 0 | 2.0488 / 1.6186 / 3.9451 | Conditional visual pass; low-exposure clipped speculars retain a blue residual |
| `Nikon_D7500_DSC_3931.NEF` | 2x2 RGBG | 5600x3728 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0.2890 / 0.2871 / 0.3300 | Numerical no-op pass; visual spot review remains |
| `noisy_canon_IMG_0790.CR2` | 2x2 RGBG | 5202x3464 | 136,781 / 252,006 / 62,987 | 0 / 228,665 / 0 | 352,672 / 543,273 / 0 | 0 / 0 / 0 | 3.4011 / 1.8759 / 1.7252 | Pass; Canon result visually accepted |

The difference between candidate and repaired counts is expected: the opposed estimate uses
`max(original, reference + chrominance)` and therefore never lowers a clipped photosite merely to
force a neutral result. Re-encoding produced zero `uint16` overflows in every file.

### Niagara before/after evidence

Niagara was re-hashed immediately before focused validation; its SHA-256 exactly matched the PRD
(`0099C675...B382D62F`). The old LibRaw ACES transport contained 5,119,281 blue samples at exactly
`65535`. The new camera-linear transport contains zero exact-ceiling samples in all channels. The
opposed stage repaired 727,291 photosites while preserving final ACEScg values through 2.2909,
1.6943, and 2.2598 rather than clipping them to one.

An ignored -2 EV side-by-side rendered from retained bridge arrays showed the broad purple/magenta
sheet over the sky and water with reconstruction bypassed and its removal with Opposed color. On a
deterministic changed-highlight sample, median magenta bias fell from 0.3804 to 0.2602 and p95 fell
from 0.5457 to 0.2798. Product-owner testing in the Electron application independently reported
that Niagara was working beautifully.

### Sony visual edge case

Product-owner testing found `DSC04375.ARW` visually sound after lowering exposure to the monitor's
range. `DSC00264.ARW` retains a pink interior and green lower boundary in large clipped bokeh whose
surrounding unclipped light is already strongly saturated. A matched darktable test with `inpaint
opposed`, threshold 1.000, the same white-balance intent, and matched exposure/contrast produced the
same behavior. This is therefore recorded as a known limitation of opposed-color inference under
complicated colored lighting, consistent with darktable's own source comments, rather than a
camera-specific regression or justification for a fitted correction. Segmentation-based recovery
is the intended future method if this scene class becomes a product priority.

### Fujifilm X-Trans visual edge case

The Fujifilm RAF's heavily clipped specular highlights remain acceptable at raised exposure, but
product-owner testing on the HDR display revealed blue residuals when exposure was lowered to
-2.30 EV. The blue separation is also visible as a residual channel tail in the histogram. This is
not a transport-ceiling regression: the bridge has zero exact `65535` samples and preserves a blue
ACEScg maximum of 3.9451. It is recorded as a conditional v1 pass because opposed-color inference
cannot guarantee neutral reconstruction when a specular has insufficient trustworthy opposing CFA
samples.

Future highlight-method qualification must inspect strongly clipped Bayer and X-Trans speculars at
both raised and substantially lowered exposure in HDR mode. Review must include the image and
channel-separated histogram so residual chroma that is hidden near display white is still caught.

## Safely sub-clipped parity

The legacy-to-new comparison sampled up to one million deterministic finite pixels with every
legacy channel between 0.001 and 0.8. RGB error is the per-pixel maximum absolute linear-RGB error;
luminance reports signed median EV and p99 absolute EV; chromaticity is Euclidean delta in CIE xy.

| File | RGB median | RGB p99 | Luma EV median | Luma abs. EV p99 | delta xy median | delta xy p99 |
|---|---:|---:|---:|---:|---:|---:|
| `2L1B8631.CR2` | 0.004005 | 0.023105 | +0.035389 | 0.140210 | 0.003937 | 0.043080 |
| `DSC00264.ARW` | 0.001772 | 0.052681 | +0.096427 | 0.503216 | 0.014023 | 0.129977 |
| `DSC04375.ARW` | 0.003627 | 0.030481 | +0.096539 | 0.155543 | 0.003385 | 0.024762 |
| `Fujifilm_X-E2S_DSCF6495.RAF` | 0.003408 | 0.038249 | +0.000345 | 0.244627 | 0.016233 | 0.152129 |
| `Nikon_D7500_DSC_3931.NEF` | 0.006183 | 0.026141 | +0.100341 | 0.179027 | 0.003521 | 0.025102 |
| `noisy_canon_IMG_0790.CR2` | 0.005526 | 0.131643 | -0.351240 | 1.879101 | 0.034164 | 0.309198 |

Opposed-on versus opposed-bypassed comparisons used a mask guaranteed to be safely below every
channel's reconstruction threshold. All six files measured exactly 0.0 p99 RGB error there,
confirming that reconstruction changes clipped candidates only.

Median exposure shifts above 0.05 EV are explained by the required normalization basis. The legacy
auto-scale path used LibRaw's global white; the bridge prefers valid per-channel camera whites.
`log2((global white - black) / (camera white - black))` predicts the observed median shifts: Niagara
+0.0353 EV, both Sony files +0.0961 EV, Nikon +0.1002 EV, noisy Canon -0.3506 EV, and Fujifilm 0 EV
because it uses the documented global-white fallback. No file-specific exposure or color fit was
applied. The p99 tails are concentrated in low-luminance/noisy pixels, real clipping, and finite
negative matrix results; moving WB from LibRaw's pre-AHD processing to the required post-AHD float
stage also changes AHD's local homogeneity decisions.

## Runtime and peak memory

| File | Repeats | Legacy median | Bridge + opposed median | Change | Opposed cost vs bridge bypass | RSS delta | One float32 frame |
|---|---:|---:|---:|---:|---:|---:|---:|
| `2L1B8631.CR2` | 3 | 2.416 s | 2.965 s | +22.7% | +0.727 s | -20.1 MiB | 256.7 MiB |
| `DSC00264.ARW` | 3 | 3.424 s | 4.049 s | +18.3% | +0.976 s | -17.8 MiB | 485.1 MiB |
| `Fujifilm_X-E2S_DSCF6495.RAF` | 3 | 2.413 s | 2.591 s | +7.4% | +0.226 s | +12.1 MiB | 186.1 MiB |
| `DSC04375.ARW` | 1 | 3.186 s | 3.269 s | +2.6% | not a repeated gate | -18.2 MiB | 485.1 MiB |
| `Nikon_D7500_DSC_3931.NEF` | 1 | 2.192 s | 2.029 s | -7.4% | no clipped photosites | -20.2 MiB | 239.0 MiB |
| `noisy_canon_IMG_0790.CR2` | 1 | 2.050 s | 2.363 s | +15.3% | not a repeated gate | -16.3 MiB | 206.2 MiB |

Niagara exceeded the PRD's 20% investigation threshold by 2.7 percentage points. The bypass render
completed in 2.238 s; the measured 0.727 s increment is the full-frame normalized mosaic,
candidate-mask/chrominance analysis, and 870,430 candidate reference evaluations. It is bounded,
deterministic work proportional to actual candidates, not an accidental second decode or camera
branch. Peak RSS decreased by 20.1 MiB versus legacy and stayed far below the allowance of one
additional HxWx3 float32 frame. The result is accepted for this correctness sprint; vectorized
reference reuse is an available general optimization if import latency becomes a measured product
problem.

## Route isolation and preserved behavior

- `iphone_16_pro_IMG_3324.HEIC` retained the HEIC/HEIF branch and fully decoded to contiguous,
  finite 5712x4284x3 float32 ACEScg. Apple HDR gain-map application remained true, the SDR reference
  remained present, and the canonical SHA-256 remained
  `5234ED67CEC1D0948F72DAB7772C47CDBEE886CE90E00D7E64C7F4796ED593FA`.
- The 72,480x4,096 line-scan DNG retained `linear_dng`. Read-only qualification intentionally ended
  at metadata/resource preflight: estimated import peak 5,946,228,736 bytes, pass; GPU full-frame
  compatibility false, proxy 4096x231. It never entered the mosaiced bridge.
- The Experimental DNG opcode route retains its forced orientation, exactly-once opcode audit,
  color pipeline, parameters, and Lensfun exclusion rules.
- LibRaw default orientation remains in force for ordinary RAW. Lensfun remains after float color
  development and before activation. Cancellation is checked around native calls and throughout
  reconstruction/normalization/color/Lensfun strips.
- Re-development remains transactional and preserves session identity, project association and
  reference white, adjustments, local masks, crop state, and saved RAW recipe. Preview and export
  consume the same retained canonical session image and invalidate downstream caches together.

## Fallback coverage

No primary corpus file encountered a legacy pipeline fallback. Deterministic tests cover missing or
invalid WB, invalid black/white levels, singular matrices, non-RGB CFA descriptions, materially
different four-color rows, missing/unwritable visible mosaics for reconstruction, bypass behavior,
and Bayer/X-Trans determinism. Unsupported bridge metadata selects
`legacy_libraw_aces_fallback_v1` and exposes `raw_pipeline` plus `raw_fallback_reason`. Fujifilm's
missing per-channel saturation metadata uses the documented LibRaw global-white normalization
fallback inside the bridge; it is not a legacy pipeline fallback.

## Automated verification

- Complete Python suite: **858 passed, 3 expected environment-gated skips**, 2 unrelated
  deprecation warnings, 44.18 seconds.
- Desktop shell unit suite: **15 passed**, 0 failed.
- Opt-in private-corpus pytest entry point: **1 passed** in 115.57 seconds.
- Frontend JavaScript syntax check: passed.
- Git whitespace validation: clean.

## Product-owner sign-off

The product owner accepted the engineering, routing, numerical, reference-parity, and visual
qualification and marked the sprint complete on September 3, 2026. Visual checks explicitly cover
Niagara, both Canon examples, both Sony examples, the Fujifilm RAF, and the unclipped Nikon NEF;
the Nikon fixture passes and exhibits no clipping issue. `DSC00264.ARW` and the low-exposure
Fujifilm speculars remain in the visual corpus as documented edge cases for deciding whether a
future segmentation-based method is warranted.
