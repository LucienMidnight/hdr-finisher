# Classical Denoise prototypes — November 16, 2026

Tuning current Denoise gains 1.51 dB at ISO 6400, but its PSNR winner loses edge detail.
Neither classical reference beats the tuned baseline; neither is ready to replace the current Denoise.
Darktable wavelets soften detail; GALOSH leaves conspicuous structured artifacts in lifted shadows.
The complete 18/42 MP trials take 143/329 seconds for NumPy wavelets and 39/76 seconds for serial C GALOSH.
All four full-frame trials stay below the 2.5 GB research cap; no app defaults or shipping pixels change.

## Scope and evidence

Phase 2 of the [quality-trial brief](../../briefs/denoise-v1-quality-trial-2026-11-16.md),
using its unchanged **proposed**, not newly approved, limits. MacBook Neo,
Apple A18 Pro, 8 GB, November 16, 2026. CPU only, one native thread, shared
cross-worktree GPU-run lock; no Electron, WebGPU, downloads of paired datasets,
or app integration. The branch base is `01992e9c` (harness `da0d5ace`); each measurement
JSON records the Git HEAD. This report and its adapters are the changes on top.
Prototype implementation is committed as `f032d924`; the final record also
automatically selects Windows executable/linker conventions and uses a C11
portable clock in the local OpenMP shim. These build-only details do not
change filtering maths or the Python-measured stage clocks. Mac was rebuilt
and the ten focused tests rerun; Windows/Linux native builds remain untested.

The full set is 27 synthetic scenes (nine per ISO equivalent 1600, 6400, 25600)
and eight real crops (four per RAW). It includes generated edges, stars, text,
fabric, colours and gradients plus two low-ISO binned photographic sources.
All methods use identical AHD, WB, camera-to-ACEScg and display transforms.
Synthetic truth is not a real noisy/clean pair. The single-frame per-CFA
Poisson–Gaussian fits and ISO extrapolation are provisional; dual-gain
transitions, demosaic correlation, banding and fixed-pattern noise are not
calibrated away. No extra synthetic banding was requested in this run.

Retained local evidence, relative to the repository:

- `codebase/output/denoise-v1/results-full.json`: every case, noise fit,
  output metric, exposure/tile/safety diagnostic and adapter description.
- `codebase/output/denoise-v1/review/index.html`: all comparisons, strength
  curves and four native 256-pixel crops per full-frame RAW. Full-set thumbnails
  are 128 pixels to keep all thirteen variants within the review-size budget;
  metrics always use the original 512/640-pixel arrays, not thumbnails.
- `codebase/output/denoise-v1/classical-tuning.json`: all 81 control settings
  and per-scene scores, not just the winners.
- `codebase/output/denoise-v1/full-{darktable,galosh}-{IMG_0790,2025_0730_1331_3}.json`:
  split clocks, fit state and native crop coordinates/lifts; matching
  `*-guard.json` records process-tree memory and termination status.
- `codebase/output/denoise-v1/galosh-build/build.json`: source hashes, compiler
  command and every build-copy modification. Pinned source hashes also live
  in tracked `codebase/tools/denoise_eval/candidates/source-provenance.json`.

## Implementation contracts and departures

### Darktable profiled wavelets

NumPy reference of the generalized-Anscombe **RGB** branch and edge-aware
25-tap B-spline wavelet decomposition, BayesShrink and bias-corrected inverse.
Core source: `src/iop/denoiseprofile.c` and `src/common/eaw.c`, pinned at
`b407398a1b9d03d552f59d7227bd3eff66045495`. GPL-3.0-or-later notices remain
in the module header and repository third-party notices. No profile database,
darktable binary or learned weights are included. Optional NLM was not ported.

The RGB harness bridge reverses the camera matrix/exposure lift into
WB camera-linear RGB after AHD and reverses that bridge after filtering.
Per-CFA fits use `variance = a*signal + b`; the two greens are averaged, WB
multiplies shot gain by WB and **read variance by WB squared**. No substitution
of read standard deviation for variance. Non-RAW RGB without a camera profile
uses the existing measured-noise Denoise fallback, not a borrowed camera fit.

The pinned EAW helper uses clamped/nearest boundaries, not the mirror boundary
suggested in the survey. One to seven active scales derive a cumulative halo
`2*(2**scales-1)` (254 at seven scales). Nine bounded frame-global sampling
windows estimate Bayes thresholds once; all tiles share them. This is **not**
the full upstream module or its newer configurable shadow-power VST, and
sampled threshold statistics are not upstream's exact whole-frame sums.
The reference uses exact `exp2` rather than the upstream fast approximation.
Most importantly, the fitted sensor model has **no empirical correction for
AHD noise correlation**. A disappointing result here does not prove every
darktable configuration or a better post-demosaic calibration is inferior.

Strength 0.50/0.75/1.00 blends the reconstructed correction in camera space;
zero and explicit bypass are exact. Alpha is copied unchanged. Negative
camera samples are restored rather than silently clamped; positive headroom
is not clipped by this RGB adapter.

### GALOSH RAW

Pinned FP32 `RAW_O` CPU core and header at
`11de0593cc8091933ad76d1d6d873f7dee537f15`. The four vendored source/licence
files are byte-identical to upstream. Apache-2.0 `LICENSE` and `NOTICE` remain
beside them. An offline `clang -O3` serial build succeeds on this Mac, with
no system-wide package installation. The output-only build copy uses a tiny
OpenMP shim, empty unused SSE includes and omission of two uncalled SSE
helpers. The canonical FP32 processing core remains scalar C, not a NumPy
reimplementation. The build receipt identifies all changes.

Pre-WB RGGB mosaic input is obtained by reversible axis flips, with no sensor
sites discarded. Calibrated `alpha` is mean CFA shot gain; `sigma_sq` is mean
CFA **read variance**. Blind mode calls the upstream noise estimator.
An extracted native IRLS fit supplies one global dark anchor. The noise fit,
dark anchor and unity GAT sigma are held for every tile: no per-tile noise or
black-point fitting. Unity GAT sigma is a deliberate normalization choice in
both calibrated and blind modes, not a claim to reproduce all upstream
standalone auto settings. Each independent harness crop is an input with one
shared fit; the full-frame trials fit the whole photo once.

The standalone positional strength is unused upstream; this adapter scales
native luma/chroma controls together (luma `0.5*strength`, chroma `strength`).
Strengths are 0.50/0.75/1.00. The 160-pixel halo conservatively covers WHT,
coarse LOESS, reconstruction and AHD support; origins align to eight pixels.
Output follows the same AHD/WB/ACEScg development as Off. Exact bypass means
exact equality to that development, not equality to a differently shaped RAW
array. RGB alpha/headroom sentinels are inapplicable to a mosaic-only adapter;
this is not an unrestricted scene-linear HDR RGB denoiser.

### Fair current-method tuning

81 settings: Amount 0.125/0.25/0.5/0.75/1.0 × Detail Recovery
0.25/0.5/0.75/1.0 × Luminance 0.5/0.75 × Color Noise 0.5/0.75, plus Off.
All four size controls remain at 0.5. Mean **per-scene** SDR PSNR selects the
winner across nine full-set synthetic scenes per ISO. The second selection
maximizes the same score subject to slanted-edge MTF50 ratio ≥0.90.
This is **in-sample grid tuning**, not held-out validation, a global optimum,
or per-real-photo hand tuning. Runtime picks the nearest tested ISO without
access to truth. No app default changes.

| ISO | Best PSNR: Amount / Detail / Luma / Color | SDR dB | MTF50 | Sharpness-respecting controls | SDR dB | MTF50 |
| --- | --- | --- | --- | --- | --- | --- |
| 1600 | .75 / .50 / .50 / .75 | 37.12 | .965 | same | 37.12 | .965 |
| 6400 | .75 / .50 / .50 / .75 | 31.43 | .820 | .50 / .50 / .50 / .75 | 31.04 | .927 |
| 25600 | .75 / .50 / .50 / .75 | 25.08 | .628 | .125 / .25 / .50 / .75 | 18.51 | .910 |

The high-ISO PSNR optimum is not a sharpness pass. At ISO 25600, enforcing the
edge limit costs 6.57 dB relative to the PSNR winner. The sharp choice there
does not beat the current default on PSNR; it exposes the trade-off instead
of hiding it by comparing only defaults.

## Full-set quality measurements

Numbers are arithmetic means of per-scene measurements, **including means of
per-scene p99 values**, not a pooled pixel percentile. Flat standard deviations
use display-encoded residuals versus truth; Y/C ratios compare with the noisy
input. Texture columns give the **min–max across all nine cases** in each
Gaussian band (sigma .5–1, 1–2, 2–4, 4–8 px), exposing violations that a mean
would hide. Ratios are unstable where clean-band energy is tiny; these are
harness proxies, not a claim to have localized invented texture. MTF/halo are
from each ISO's slanted edge. Full per-case results remain in JSON.
HDR colour is the harness's BT.2124 ΔE ITP (720-scaled, weighted ICtCp
distance), not an unscaled ICtCp number. The same definition is used for
all methods, tile checks and exposure probes.

The review page contains connected strength trade-off curves for every ISO:
SDR PSNR versus MTF50, with current-default, tuned-PSNR and tuned-sharp
references. A rightward point is not automatically better: the brief has only
a lower MTF bound, and oversharpening/texture/colour still need separate checks.

### ISO 1600

| Method | SDR dB | SDR SSIM | ΔE00 mean/p99 | HDR dB | HDR SSIM | ΔE ITP mean/p99 |
| --- | --- | --- | --- | --- | --- | --- |
| Off | 29.04 | 0.673 | 5.554/15.598 | 32.83 | 0.767 | 16.943/53.332 |
| Current default | 35.41 | 0.890 | 3.089/10.363 | 40.06 | 0.939 | 7.871/33.182 |
| Current tuned PSNR | 37.12 | 0.896 | 2.585/9.116 | 41.03 | 0.940 | 7.057/30.990 |
| Current tuned sharp | 37.12 | 0.896 | 2.585/9.116 | 41.03 | 0.940 | 7.057/30.990 |
| DT 0.50 | 32.90 | 0.820 | 3.539/10.688 | 35.79 | 0.861 | 10.586/40.357 |
| DT 0.75 | 34.84 | 0.890 | 2.645/9.107 | 36.84 | 0.886 | 8.452/40.428 |
| DT 1.00 | 35.75 | 0.909 | 2.160/9.105 | 37.25 | 0.889 | 7.502/42.131 |
| GALOSH cal 0.50 | 29.56 | 0.792 | 4.384/17.539 | 34.23 | 0.864 | 11.715/54.417 |
| GALOSH cal 0.75 | 31.59 | 0.867 | 3.139/14.612 | 36.42 | 0.915 | 8.304/43.839 |
| GALOSH cal 1.00 | 32.37 | 0.899 | 2.796/14.170 | 37.38 | 0.939 | 7.262/41.705 |
| GALOSH blind 0.50 | 29.53 | 0.792 | 4.354/17.093 | 34.15 | 0.861 | 11.749/54.265 |
| GALOSH blind 0.75 | 31.27 | 0.840 | 3.476/15.315 | 36.12 | 0.896 | 8.885/45.154 |
| GALOSH blind 1.00 | 31.87 | 0.850 | 3.353/15.898 | 36.95 | 0.903 | 8.219/44.672 |

| Method | Flat σ Y/C | Flat Y/C ratio | Texture min–max per band (.5–1 / 1–2 / 2–4 / 4–8) | MTF50 ratio | Extra halo | Bleed mean/p99 |
| --- | --- | --- | --- | --- | --- | --- |
| Off | 0.018/0.035 | 1.000/1.000 | 1.01–187.12 / 1.01–35.76 / 1.00–8.91 / 1.00–2.57 | 1.000 | 0.0036 | 0.044/0.227 |
| Current default | 0.010/0.018 | 0.566/0.500 | 0.05–5.00 / 0.11–2.50 / 0.29–1.40 / 0.30–1.30 | 0.995 | 0.0022 | 0.035/0.213 |
| Current tuned PSNR | 0.008/0.013 | 0.476/0.344 | 0.00–1.20 / 0.02–1.23 / 0.10–1.38 / 0.10–1.50 | 0.965 | 0.0010 | 0.039/0.236 |
| Current tuned sharp | 0.008/0.013 | 0.476/0.344 | 0.00–1.20 / 0.02–1.23 / 0.10–1.38 / 0.10–1.50 | 0.965 | 0.0010 | 0.039/0.236 |
| DT 0.50 | 0.011/0.021 | 0.618/0.580 | 0.54–48.68 / 0.50–8.25 / 0.50–2.14 / 0.49–1.02 | 1.289 | 0.0012 | 0.034/0.190 |
| DT 0.75 | 0.008/0.015 | 0.474/0.404 | 0.37–13.06 / 0.32–2.15 / 0.31–1.00 / 0.31–1.02 | 1.459 | 0.0000 | 0.033/0.209 |
| DT 1.00 | 0.007/0.012 | 0.406/0.309 | 0.08–3.67 / 0.04–0.96 / 0.08–1.00 / 0.17–1.03 | 1.627 | 0.0079 | 0.036/0.254 |
| GALOSH cal 0.50 | 0.015/0.027 | 0.857/0.788 | 0.28–40.57 / 0.40–11.36 / 0.82–4.27 / 0.83–1.66 | 0.888 | 0.0020 | 0.067/0.436 |
| GALOSH cal 0.75 | 0.012/0.019 | 0.700/0.570 | 0.22–18.20 / 0.37–7.72 / 0.84–3.18 / 0.85–1.44 | 0.891 | 0.0013 | 0.058/0.403 |
| GALOSH cal 1.00 | 0.011/0.017 | 0.637/0.505 | 0.22–10.44 / 0.37–5.90 / 0.78–2.72 / 0.86–1.37 | 0.892 | 0.0013 | 0.058/0.401 |
| GALOSH blind 0.50 | 0.015/0.026 | 0.858/0.786 | 0.18–39.17 / 0.30–11.22 / 0.72–4.25 / 0.73–1.66 | 0.915 | 0.0058 | 0.067/0.441 |
| GALOSH blind 0.75 | 0.013/0.021 | 0.782/0.614 | 0.05–17.00 / 0.16–7.54 / 0.56–3.14 / 0.56–1.44 | 0.917 | 0.0019 | 0.060/0.421 |
| GALOSH blind 1.00 | 0.013/0.019 | 0.760/0.576 | 0.01–9.37 / 0.10–5.52 / 0.50–2.64 / 0.50–1.37 | 0.919 | 0.0013 | 0.061/0.421 |


### ISO 6400

| Method | SDR dB | SDR SSIM | ΔE00 mean/p99 | HDR dB | HDR SSIM | ΔE ITP mean/p99 |
| --- | --- | --- | --- | --- | --- | --- |
| Off | 23.13 | 0.448 | 9.985/23.877 | 26.64 | 0.581 | 32.501/103.996 |
| Current default | 29.92 | 0.806 | 5.600/17.333 | 34.87 | 0.902 | 15.258/54.900 |
| Current tuned PSNR | 31.43 | 0.859 | 4.652/15.216 | 35.91 | 0.927 | 13.531/50.913 |
| Current tuned sharp | 31.04 | 0.845 | 4.875/15.131 | 35.48 | 0.917 | 14.016/49.284 |
| DT 0.50 | 26.85 | 0.612 | 6.966/18.764 | 29.59 | 0.718 | 21.245/75.851 |
| DT 0.75 | 28.44 | 0.710 | 5.503/17.894 | 30.05 | 0.757 | 17.684/76.418 |
| DT 1.00 | 28.79 | 0.750 | 4.697/19.568 | 29.91 | 0.758 | 16.059/80.924 |
| GALOSH cal 0.50 | 25.56 | 0.614 | 7.190/22.838 | 30.36 | 0.751 | 20.377/76.093 |
| GALOSH cal 0.75 | 27.76 | 0.731 | 5.322/19.096 | 32.55 | 0.853 | 14.953/59.385 |
| GALOSH cal 1.00 | 28.64 | 0.790 | 4.740/18.128 | 33.56 | 0.896 | 13.375/54.812 |
| GALOSH blind 0.50 | 25.56 | 0.615 | 7.157/22.716 | 30.37 | 0.750 | 20.245/76.063 |
| GALOSH blind 0.75 | 27.61 | 0.713 | 5.417/19.630 | 32.44 | 0.830 | 14.952/60.665 |
| GALOSH blind 1.00 | 28.24 | 0.744 | 5.157/19.875 | 33.24 | 0.860 | 13.806/58.002 |

| Method | Flat σ Y/C | Flat Y/C ratio | Texture min–max per band (.5–1 / 1–2 / 2–4 / 4–8) | MTF50 ratio | Extra halo | Bleed mean/p99 |
| --- | --- | --- | --- | --- | --- | --- |
| Off | 0.037/0.069 | 1.000/1.000 | 1.09–663.10 / 1.05–133.43 / 1.02–29.91 / 1.02–7.11 | 0.964 | 0.0219 | 0.084/0.312 |
| Current default | 0.014/0.027 | 0.430/0.403 | 0.06–17.10 / 0.11–6.67 / 0.28–3.72 / 0.28–2.25 | 0.916 | 0.0088 | 0.057/0.270 |
| Current tuned PSNR | 0.010/0.017 | 0.316/0.248 | 0.00–1.13 / 0.02–1.22 / 0.08–1.49 / 0.09–1.77 | 0.820 | 0.0017 | 0.063/0.286 |
| Current tuned sharp | 0.014/0.020 | 0.412/0.299 | 0.06–18.11 / 0.11–4.71 / 0.28–2.81 / 0.28–1.96 | 0.927 | 0.0066 | 0.057/0.275 |
| DT 0.50 | 0.021/0.041 | 0.592/0.600 | 0.29–194.35 / 0.28–34.17 / 0.26–7.64 / 0.25–1.87 | 1.281 | 0.0036 | 0.062/0.293 |
| DT 0.75 | 0.016/0.032 | 0.452/0.464 | 0.09–71.98 / 0.08–9.40 / 0.07–2.09 / 0.07–0.81 | 1.477 | 0.0011 | 0.058/0.306 |
| DT 1.00 | 0.013/0.029 | 0.401/0.423 | 0.02–36.04 / 0.01–2.05 / 0.00–0.74 / 0.00–0.73 | 1.677 | 0.0005 | 0.061/0.369 |
| GALOSH cal 0.50 | 0.024/0.043 | 0.674/0.642 | 0.28–156.35 / 0.42–46.82 / 0.85–15.08 / 0.85–4.17 | 0.898 | 0.0055 | 0.085/0.447 |
| GALOSH cal 0.75 | 0.018/0.028 | 0.519/0.421 | 0.22–67.34 / 0.39–30.98 / 0.84–10.52 / 0.85–3.21 | 0.914 | 0.0037 | 0.072/0.408 |
| GALOSH cal 1.00 | 0.015/0.023 | 0.454/0.356 | 0.21–29.79 / 0.38–22.83 / 0.85–8.59 / 0.85–2.92 | 0.921 | 0.0026 | 0.071/0.402 |
| GALOSH blind 0.50 | 0.023/0.043 | 0.673/0.640 | 0.22–148.35 / 0.35–46.22 / 0.77–14.88 / 0.77–4.11 | 0.904 | 0.0056 | 0.085/0.454 |
| GALOSH blind 0.75 | 0.019/0.029 | 0.553/0.439 | 0.12–62.75 / 0.25–30.21 / 0.65–10.32 / 0.65–3.16 | 0.919 | 0.0035 | 0.073/0.423 |
| GALOSH blind 1.00 | 0.018/0.026 | 0.529/0.396 | 0.02–29.31 / 0.12–22.68 / 0.51–8.53 / 0.52–2.89 | 0.925 | 0.0028 | 0.073/0.423 |


### ISO 25600

| Method | SDR dB | SDR SSIM | ΔE00 mean/p99 | HDR dB | HDR SSIM | ΔE ITP mean/p99 |
| --- | --- | --- | --- | --- | --- | --- |
| Off | 17.29 | 0.221 | 16.346/32.221 | 20.28 | 0.340 | 62.788/175.416 |
| Current default | 23.85 | 0.626 | 10.392/26.968 | 29.23 | 0.797 | 30.786/96.833 |
| Current tuned PSNR | 25.08 | 0.790 | 9.321/25.086 | 30.52 | 0.889 | 27.224/82.081 |
| Current tuned sharp | 18.51 | 0.253 | 14.958/30.920 | 22.94 | 0.410 | 52.280/142.330 |
| DT 0.50 | 20.78 | 0.361 | 12.656/28.548 | 23.41 | 0.492 | 41.759/127.367 |
| DT 0.75 | 21.86 | 0.454 | 10.648/27.024 | 23.70 | 0.542 | 36.087/125.685 |
| DT 1.00 | 21.97 | 0.505 | 9.589/28.342 | 23.62 | 0.549 | 33.866/130.105 |
| GALOSH cal 0.50 | 20.74 | 0.390 | 12.103/28.917 | 25.33 | 0.560 | 38.416/112.635 |
| GALOSH cal 0.75 | 23.11 | 0.530 | 9.319/24.686 | 27.96 | 0.725 | 28.267/87.389 |
| GALOSH cal 1.00 | 24.30 | 0.624 | 8.256/23.470 | 29.39 | 0.809 | 24.836/78.057 |
| GALOSH blind 0.50 | 20.66 | 0.386 | 12.148/28.898 | 25.11 | 0.552 | 38.868/113.741 |
| GALOSH blind 0.75 | 22.90 | 0.505 | 9.392/24.955 | 27.57 | 0.685 | 28.737/91.189 |
| GALOSH blind 1.00 | 23.70 | 0.566 | 8.581/24.012 | 28.56 | 0.756 | 25.916/83.707 |

| Method | Flat σ Y/C | Flat Y/C ratio | Texture min–max per band (.5–1 / 1–2 / 2–4 / 4–8) | MTF50 ratio | Extra halo | Bleed mean/p99 |
| --- | --- | --- | --- | --- | --- | --- |
| Off | 0.077/0.131 | 1.000/1.000 | 1.63–2301.98 / 1.28–450.63 / 1.07–103.02 / 1.06–21.33 | 0.916 | 0.0726 | 0.160/0.478 |
| Current default | 0.027/0.049 | 0.365/0.369 | 0.05–168.58 / 0.11–42.58 / 0.27–11.26 / 0.28–5.39 | 0.737 | 0.0063 | 0.103/0.372 |
| Current tuned PSNR | 0.015/0.026 | 0.218/0.199 | 0.00–22.02 / 0.02–9.78 / 0.07–3.22 / 0.07–2.64 | 0.628 | 0.0027 | 0.110/0.384 |
| Current tuned sharp | 0.070/0.108 | 0.911/0.819 | 1.41–1765.22 / 1.23–370.00 / 1.05–87.52 / 1.03–19.66 | 0.910 | 0.0610 | 0.141/0.443 |
| DT 0.50 | 0.043/0.084 | 0.564/0.638 | 0.39–634.12 / 0.39–122.24 / 0.29–27.27 / 0.27–5.65 | 1.124 | 0.0154 | 0.119/0.392 |
| DT 0.75 | 0.031/0.070 | 0.423/0.531 | 0.13–261.61 / 0.12–42.40 / 0.08–9.21 / 0.07–1.90 | 1.196 | 0.0033 | 0.109/0.409 |
| DT 1.00 | 0.027/0.066 | 0.372/0.502 | 0.03–142.79 / 0.02–11.79 / 0.01–2.57 / 0.00–0.82 | 1.272 | 0.0000 | 0.113/0.447 |
| GALOSH cal 0.50 | 0.043/0.078 | 0.575/0.593 | 0.41–542.14 / 0.62–177.82 / 0.93–57.70 / 0.91–13.19 | 0.871 | 0.0146 | 0.125/0.454 |
| GALOSH cal 0.75 | 0.031/0.047 | 0.414/0.355 | 0.27–159.14 / 0.51–128.94 / 0.88–42.62 / 0.86–10.04 | 0.884 | 0.0073 | 0.101/0.408 |
| GALOSH cal 1.00 | 0.024/0.036 | 0.341/0.277 | 0.23–77.92 / 0.48–93.44 / 0.86–34.06 / 0.83–9.00 | 0.900 | 0.0059 | 0.096/0.396 |
| GALOSH blind 0.50 | 0.044/0.078 | 0.584/0.599 | 0.38–544.27 / 0.59–183.25 / 0.90–59.20 / 0.87–13.46 | 0.868 | 0.0235 | 0.125/0.457 |
| GALOSH blind 0.75 | 0.033/0.049 | 0.448/0.372 | 0.24–188.24 / 0.47–138.73 / 0.82–45.09 / 0.80–10.42 | 0.881 | 0.0112 | 0.101/0.409 |
| GALOSH blind 1.00 | 0.028/0.040 | 0.391/0.306 | 0.15–100.05 / 0.34–116.74 / 0.70–39.73 / 0.69–9.69 | 0.878 | 0.0085 | 0.098/0.402 |

## Tile, exposure and hard-contract diagnostics

| Method | Shift ΔE00 mean/p99 | Shift ΔE ITP mean/p99 | Worst exposure ΔE00 mean/p99 | Worst exposure ΔE ITP mean/p99 | RGB sentinel |
| --- | --- | --- | --- | --- | --- |
| Off | 0.000000/0.000000 | 0.000000/0.000000 | 0.000/0.000 | 0.000/0.000 | pass |
| Current default | 0.000000/0.000000 | 0.000000/0.000000 | 0.000/0.000 | 0.000/0.000 | pass |
| Current tuned PSNR | 0.000000/0.000000 | 0.000000/0.000000 | 0.000/0.000 | 0.000/0.000 | pass |
| Current tuned sharp | 0.000000/0.000000 | 0.000000/0.000000 | 0.000/0.000 | 0.000/0.000 | pass |
| DT 0.50 | 0.000000/0.000000 | 0.000000/0.000000 | 0.000/0.000 | 0.000/0.000 | pass |
| DT 0.75 | 0.000000/0.000000 | 0.000000/0.000000 | 0.000/0.000 | 0.000/0.000 | pass |
| DT 1.00 | 0.000000/0.000000 | 0.000000/0.000000 | 0.000/0.000 | 0.000/0.000 | pass |
| GALOSH cal 0.50 | 0.000000/0.000000 | 0.000000/0.000000 | 42.000/53.532 | 163.425/180.236 | not_applicable |
| GALOSH cal 0.75 | 0.000000/0.000000 | 0.000000/0.000000 | 41.568/51.719 | 163.141/178.616 | not_applicable |
| GALOSH cal 1.00 | 0.000000/0.000000 | 0.000000/0.000000 | 41.440/51.292 | 163.073/178.422 | not_applicable |
| GALOSH blind 0.50 | 0.000000/0.000000 | 0.000000/0.000000 | 41.355/51.651 | 163.868/179.029 | not_applicable |
| GALOSH blind 0.75 | 0.000000/0.000000 | 0.000000/0.000000 | 40.634/48.723 | 163.582/176.169 | not_applicable |
| GALOSH blind 1.00 | 0.000000/0.000000 | 0.000000/0.000000 | 40.019/43.956 | 163.365/171.824 | not_applicable |

All shifted-grid probes meet mean <1 / p99 <3 in both display lanes.
All RGB-method exposure probes meet those limits. Every GALOSH exposure
probe fails at the range extremes: fixed AHD development clips normalized
mosaic values at high positive exposure. The huge errors qualify this
mosaic/development path, not a universal failure of GALOSH's raw core.
The raw core was not independently qualified for arbitrary HDR floats.

CPU/GPU agreement, GPU slider responsiveness and production HDR delivery
ceilings are **not tested**, not passes. The harness's fixed 1000-nit display
cap cannot validate the app's finished-render or encoded-output ceiling.
The harness passes empty metadata to its RGB sentinel, so the darktable rows
there exercise its **current-Denoise fallback**, not the camera-profiled
wavelet core. The separate tiny-array tests do exercise that core with an
explicit camera profile, alpha and negative/above-white values. Neither is
whole-pipeline production HDR validation.
No pinned shader, output tolerance, memory allowance or numerical limit was
relaxed. Tiny-array tests additionally check finite output, exact bypass,
alpha, negative/headroom handling and actual shifted internal tile boundaries.
VST numerical inversion allows absolute 2e-6; Monte Carlo inverse-of-mean
bias allows max(1% of signal, 0.0002) at four positive means, 100,000 samples
each. That stochastic tolerance is stated before the check; it is not a
claim of exact unbiasedness at clipped black or every signal level.

## Real RAWs and visual findings

| Real RAW (four crops) | Method | Flat σ Y/C | Flat Y/C ratio | Removed-noise edge correlation |
| --- | --- | --- | --- | --- |
| 2025_0730_1331_3.arw | Off | 0.192/0.172 | 1.000/1.000 | 0.000 |
| 2025_0730_1331_3.arw | Current default | 0.157/0.081 | 0.781/0.531 | -0.036 |
| 2025_0730_1331_3.arw | Current tuned PSNR | 0.153/0.063 | 0.758/0.439 | -0.027 |
| 2025_0730_1331_3.arw | Current tuned sharp | 0.153/0.063 | 0.758/0.439 | -0.027 |
| 2025_0730_1331_3.arw | DT 0.50 | 0.151/0.123 | 0.755/0.734 | 0.088 |
| 2025_0730_1331_3.arw | DT 0.75 | 0.141/0.115 | 0.696/0.687 | 0.097 |
| 2025_0730_1331_3.arw | DT 1.00 | 0.136/0.115 | 0.667/0.686 | 0.105 |
| 2025_0730_1331_3.arw | GALOSH cal 0.50 | 0.169/0.136 | 0.861/0.811 | 0.123 |
| 2025_0730_1331_3.arw | GALOSH cal 0.75 | 0.168/0.116 | 0.854/0.712 | 0.104 |
| 2025_0730_1331_3.arw | GALOSH cal 1.00 | 0.168/0.114 | 0.855/0.702 | 0.102 |
| 2025_0730_1331_3.arw | GALOSH blind 0.50 | 0.165/0.119 | 0.838/0.716 | 0.127 |
| 2025_0730_1331_3.arw | GALOSH blind 0.75 | 0.158/0.090 | 0.790/0.568 | 0.109 |
| 2025_0730_1331_3.arw | GALOSH blind 1.00 | 0.155/0.079 | 0.772/0.515 | 0.102 |
| IMG_0790.CR2 | Off | 0.202/0.237 | 1.000/1.000 | 0.000 |
| IMG_0790.CR2 | Current default | 0.141/0.131 | 0.680/0.611 | 0.037 |
| IMG_0790.CR2 | Current tuned PSNR | 0.130/0.100 | 0.623/0.492 | 0.060 |
| IMG_0790.CR2 | Current tuned sharp | 0.130/0.100 | 0.623/0.492 | 0.060 |
| IMG_0790.CR2 | DT 0.50 | 0.162/0.196 | 0.801/0.836 | 0.085 |
| IMG_0790.CR2 | DT 0.75 | 0.149/0.184 | 0.730/0.791 | 0.092 |
| IMG_0790.CR2 | DT 1.00 | 0.142/0.183 | 0.699/0.788 | 0.095 |
| IMG_0790.CR2 | GALOSH cal 0.50 | 0.175/0.186 | 0.864/0.798 | 0.115 |
| IMG_0790.CR2 | GALOSH cal 0.75 | 0.165/0.147 | 0.813/0.654 | 0.109 |
| IMG_0790.CR2 | GALOSH cal 1.00 | 0.158/0.136 | 0.779/0.615 | 0.107 |
| IMG_0790.CR2 | GALOSH blind 0.50 | 0.175/0.185 | 0.864/0.797 | 0.122 |
| IMG_0790.CR2 | GALOSH blind 0.75 | 0.164/0.146 | 0.811/0.652 | 0.117 |
| IMG_0790.CR2 | GALOSH blind 1.00 | 0.158/0.135 | 0.776/0.612 | 0.114 |

No real clean truth is available. These are means across four independently
selected crops per photo; selected “flat” masks may retain scene structure.
At full strength neither new method reaches the proposed real-photo 0.50
luma / 0.30 chroma reduction, even on these four-crop means. Their removed-noise
edge correlations are higher than current default on both photos, warning
that structure is removed too. Blind GALOSH is not consistently better than
calibration; the fit is not a cure for the visible artifacts.

Native crops were inspected side by side at the **same** exposure lift per
role, recorded in the frame JSON, capped at +6 stops. Observations at full
strength, not scored against nonexistent clean real-photo truth:

- **IMG_0790.CR2, ISO 3200:** wavelets suppress coloured speckle around the
  flame but soften its boundary and turn the darkest flat/shadow crops into
  a strong magenta field with residual dots. GALOSH has more fine noise
  around the flame and structured block/worm-like material in deep shadows.
- **2025_0730_1331_3.arw, ISO 4000:** the bright sign is smoother with both
  methods; GALOSH has coloured/jagged edge material. Wavelets substantially
  blur the lifted vertical structure. GALOSH leaves obvious coloured
  outliers, coarse rectangular/worm-like texture and uneven deep shadows.
- No tile grid is obvious in these selected native crops. That is not an
  exhaustive whole-frame seam inspection; the shifted-grid diagnostics below
  are the quantitative test on harness-sized inputs.
- Automated “texture” crop selection chose the flame boundary on the Canon
  and a bright sign on the Sony, not representative fabric/skin/hair.
  Generated and low-ISO photographic targets therefore carry the texture
  evidence. No claim of preserved real fabric, hair or natural skin follows.

Very noisy real-photo flats and the large lifts make profile mismatch and
black-region bias conspicuous. Their change is a reason **not to ship these
references**, not proof of a fundamental limit of either upstream method.

## Full-native time and memory

| Method | RAW | MP | Prep s | Denoise s | Develop s | Wall s incl inventory | Peak RSS GB¹ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| darktable | 2025_0730_1331_3.arw | 42.39 | 2.18 | 314.93 | 4.91 | 328.85 | 1.638 |
| darktable | IMG_0790.CR2 | 18.02 | 2.28 | 132.46 | 2.01 | 143.47 | 1.787 |
| galosh | 2025_0730_1331_3.arw | 42.39 | 0.51 | 65.21 | 3.95 | 76.16 | 1.244 |
| galosh | IMG_0790.CR2 | 18.02 | 0.49 | 30.52 | 1.68 | 39.42 | 0.995 |

¹ Conservative peak is max(parent OS high-water RSS, sampled process-tree
RSS). The watchdog samples every 0.2 seconds and sums descendants, including
GALOSH subprocesses; it aborts above 2,500,000,000 bytes. Sampled RSS is not a
proof that an arbitrarily short excursion cannot occur. None of the four
runs aborted. These are research-process peaks, **not whole-app** memory.

Prep includes sensor normalization plus global adapter state. Denoise includes
all tile filtering and GALOSH subprocess I/O. Development includes AHD,
WB/colour tail and review reference development; the RGB wavelet reference
also pays for the reversible camera bridge. Wall time additionally includes
6–7 seconds of all-corpus inventory/calibration, scratch I/O and crop writing;
therefore the three stages intentionally do not sum to wall time. All native
sensor pixels are filtered (18.02 and 42.39 MP), not a resized proxy. Sensor
and developed scratch arrays are memory-mapped and deleted; no whole output
or duplicate RAW is retained. Native cores: wavelets 1024 + derived halo,
GALOSH 768 +160. No screen presentation is included, so these are **not**
action-to-visible-picture timings.

### Estimated implementation cost — not a benchmark

A C/SIMD wavelet implementation has **not** been built. As a low-confidence
costing assumption, use 0.2–1.25 microseconds per output pixel for equivalent
tiled native filtering. That gives 3.6–22.5 seconds (18.02 MP) and 8.5–53.0
seconds (42.39 MP) of filtering. Holding the measured non-filtering overhead
unchanged gives approximately **15–34 seconds** and **22–67 seconds** of
research wall time respectively. These broad estimates are conditional on
the stated native throughput; they are not speed or quality passes and are
not a speed-up comparison against the current app. Additional native
threshold-statistics and memory-transfer work could change them materially.

GALOSH's times above already measure serial optimized FP32 **C**; there is no
additional “C port” acceleration to claim. WGSL times for either method are
unknown: no GPU implementation, upload/readback or CPU/GPU parity was run.
Do not budget a GPU integration from the NumPy/C gap. Measure a whole
action-to-picture path and its expected ≥50% gain before proposing that work.
The NumPy wavelet reference plainly misses the proposed 45-second CPU/24 MP
preparation budget. GALOSH is closer, but whole-app preparation, GPU's
15-second budget, export cost and live-slider behavior remain unqualified.
No installer was built; source/binary size is not packaged-install size.
These descriptive single runs carry a ±10% timing noise allowance, recorded
in the harness README before measurement; no repeat was needed to chase
within-tolerance variation. Mac times are not compared with PC baselines.

## Verdict against the proposed limits

| Method | Quality against current and the proposed contract | Verdict |
| --- | --- | --- |
| Current default | Reference, not a pass of all new proposed limits: ISO 25600 MTF .737; texture/flat targets also missed. | Keep as unchanged control, not evidence the targets should be loosened. |
| Current tuned PSNR | SDR gains +1.71 / +1.51 / +1.23 dB at 1600/6400/25600; HDR gains about +.98 / +1.04 / +1.29 dB. MTF .965 / .820 / .628; texture still fails. | Fairer PSNR benchmark, **not** a new default or sharpness pass. |
| Current tuned sharp | MTF .965 / .927 / .910 meets the edge threshold. ISO 6400 improves SDR by 1.12 dB; ISO 25600 loses 5.34 dB versus default and has 6.1% extra halo. | Useful trade-off control, fails the combined contract. |
| Darktable wavelet reference, full | SDR 35.75 / 28.79 / 21.97 dB: mid/high −1.13 / −1.88 dB versus default and −2.64 / −3.11 versus tuned PSNR. HDR is substantially worse at mid/high ISO; HDR colour and texture fail. MTF 1.63 / 1.68 / 1.27 passes the one-sided bound but is not evidence of retained real detail. Full-strength slanted-edge halo passes; native photos show softening and shadow colour bias. | **Do not advance this adapted reference to app integration.** Correlation/profile/threshold calibration remains a research limitation; NumPy cost also misses CPU speed. |
| GALOSH calibrated, full | SDR 32.37 / 28.64 / 24.30 dB: mid/high −1.28 / +.45 dB versus default (both fail the required +1); −2.79 / −.78 versus tuned PSNR. MTF .892 / .921 / .90004: low ISO fails; high ISO just passes as measured, not an invented margin. Texture/flat/exposure targets and native artifacts reject it. Full-strength slanted-edge halo passes. | **Do not advance to app integration.** Native C is much faster than NumPy wavelets, but speed cannot rescue failed quality. |
| GALOSH blind, full | SDR 31.87 / 28.24 / 23.70 dB; mid/high −1.67 / −.15 versus default. MTF .919 / .925 / .878: high ISO fails. Texture, flat residuals, extreme exposure and visible artifacts remain. | **No improvement over the calibrated prototype overall; do not advance.** |

The 0.50/0.75 variants in the tables/curves do not yield a method that passes
all ISOs and all limits. Some single scores improve while other constraints
get worse. All 455 candidate/case evaluations are finite with **zero adapter
errors**, but that operational pass is not a quality pass. CPU/GPU parity,
production export/Proof, GPU preparation/export speed, real clean-pair
validation, arbitrary HDR RGB support for GALOSH and whole-app memory remain
**unqualified**. No shipping recommendation, new GPU route or relaxed
threshold follows. Steve's review/approval remains required for any change.

## Licence and patent record

- **Darktable:** GPL-3.0-or-later core maths, compatible with this GPL-3
  project. Copyright and source/commit notices are retained, and repository
  GPL text accompanies the port. No model/data redistribution is involved.
- **GALOSH:** Apache-2.0 source, `LICENSE` and `NOTICE` retained unmodified.
  Build-copy modifications are disclosed above and in `build.json`. The
  survey/upstream disclosure identifies **US provisional 64/058,343, filed
  May 6, 2026**. Apache §3 supplies a contributor patent grant for necessarily
  infringed contributor claims; it is **not blanket freedom-to-operate
  clearance**, nor evidence that no third-party claims exist. This trial
  does not resolve any separate patent investigation for distribution.
- No BM3D/BM4D package, unclear model weights or new runtime download is
  included. Source links and the survey's wider exclusions remain in
  [candidates.md](candidates.md). Provenance is pinned, not “latest”.

## Reproduction, checks and retained output

Build with `python -m tools.denoise_eval.candidates.build_galosh`; then run
`python -m tools.denoise_eval.candidates.tune` and
`python -m tools.denoise_eval.candidates.measure`. Full-frame CLI:
`python -m tools.denoise_eval.candidates.full_frame --method darktable --photo IMG_0790.CR2`
(substitute `galosh` and/or `2025_0730_1331_3.arw`). For **each** heavy command,
use `.venv/bin/python tools/gpu-run-lock.py --label denoise-classical-<run> --`
and the `candidates/guard.py` watchdog as documented in the harness README.
The adapters also load independently via the `module:factory` contract.

The full quality run completed in 665.97 seconds: 455 finite evaluations,
zero adapter errors, conservative research RSS 1.150 GB; the finished review
is **17,312,494 bytes (17.31 MB)**, below the 20 MB allowance.

- `node --test tests/*.test.js`: **1091 passed, one skipped, zero failed**.
- `.venv/bin/python -m pytest tests -q`, under shared lock/watchdog:
  **incomplete**, stopped around 70% after 161.12 seconds when sampled
  process-tree RSS reached **2.524 GB**, above the unchanged 2.5 GB research
  watchdog. Exit was SIGTERM, not an established assertion failure. This is
  not reported as a full-suite pass or assumed to be a pre-existing failure;
  no unrelated-test investigation or raised memory allowance followed.
- Focused `.venv/bin/python -m pytest tests/test_denoise_classical.py -q`,
  also under the lock/watchdog: **10 passed in 5.40 seconds** after the
  portable build update, GALOSH built and included (no native skips).
  The original measurement build also passed all ten in 6.06 seconds.
  This covers the added prototype tests
  independently of the interrupted broad suite.
- `git diff --check` passed. No Electron/Library/GPU checks were run: this
  is a CPU-only non-shipping prototype task and the request forbids them.

Output-size check: **12.9 GB at start, 13.0 GB at end**, below the 100 GB
limit; 12.9 GB is the shared photographic fixture folder. Temporary full-frame
memmaps, GALOSH exchange files, duplicate downloaded reference sources,
build-copy scratch, inspection contact sheets and this task's interrupted
pytest temporary directory were removed. Keep the cited review, measurement
JSON/logs, compiled local GALOSH binary/build receipt and inline comparison
source until Steve reviews them. No original RAW or protected project was
modified, and no generated full-size photo is committed.
