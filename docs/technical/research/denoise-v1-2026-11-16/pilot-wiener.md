# Pilot-guided empirical Wiener trial — November 16, 2026

The tuned self-pilot is the strongest all-ISO Wiener variant: 37.46 / 31.79 / 25.20 dB SDR.
That beats current defaults by 2.04 / 1.87 / 1.35 dB, but tuned current already achieves 37.12 / 31.43 / 25.08 dB.
Its edge sharpness improves over tuned current, yet ISO 25600 still reaches only 0.693 of clean, below the 0.90 requirement.
Bayer-guided Wiener leads the held-out real pairs by 1.91 dB over defaults; direct neural chroma brings back low/mid-ISO halos and colour shifts.
No variant meets the complete proposed quality contract; keep the shipping Denoise unchanged.

## Scope and reproducibility

Research only, on `t3/pilot-guided-wiener`, based on `feat/denoise-v1` at
`5d594ac8`, with public-pairs merge `56cff0de` subsequently incorporated.
Adapter code is committed in `e8335fd9`, bounded tooling in `e35fc744`;
the later merge preserves valid-pixel masks in both full and half scores.
MacBook Neo, Apple A18 Pro, 8 GB, CPU only, one native thread.
Setup ran from the Git root. Every long/heavy measurement and the broad
Python checks use the existing machine-wide lock and a 2.5 GB process-tree
RSS guard. No Electron, WebGPU, app code, app dependency, saved grade, budget
or production output changes. CPU/GPU agreement and final encoded output
are **not** qualified by this experiment.

The full harness run has 27 synthetic cases (nine at each ISO equivalent
1600/6400/25600), eight real crops, eleven adapters and zero adapter errors.
It takes 299.34 s; worker high-water RSS is 1.609 GB. Noise fits, truth,
camera matrices, WB, seeded sensor noise and 16-bit AHD transport are exactly
the inherited harness's. Fits from single frames and extrapolated ISO are
provisional, not calibrated camera profiles; no inference uses clean truth.
Current tuning is the existing in-sample grid selection, not a new oracle.

Local evidence (output files are not committed):

- `codebase/output/denoise-v1/pilot-wiener/results-full.json`: every full/half
  metric, input provenance, model, diagnostic and adapter description.
- `codebase/output/denoise-v1/pilot-wiener/review/index.html`: common-transform
  synthetic and real comparisons, plus four native crops per RAW/variant.
- `controls.json`, `independent-grids.json`, `native-*.json` and `*-guard.json`
  in that same output directory: complete sweeps, independent probes, clocks
  and sampled process-tree memory. `tables.md` is a regenerable table extract.
- `pairs/results-pairs.json`, `pairs/summary.json`, `pairs/tables.md` and
  `pairs/review/index.html`: all eleven public-pair comparisons, masks,
  scene-balanced held-out/seen summaries and the separate review page.

The quality/pairs guard receipts retain the exact adapter lists and commands.
Run them from `codebase` with this venv, `PYTHONPATH=backend`, the existing
`tools/gpu-run-lock.py` wrapper and `candidates/guard.py`; never run both
measurements concurrently. The pairs entry point is
`python -I tools/denoise_eval/datasets/evaluate.py --set pairs`, with
`--pairs output/denoise-v1/datasets/rawnind/pairs`. Rebuild the tables/review
using `python -m tools.denoise_eval.candidates.pilot_wiener_report`.

Adapters: `codebase/tools/denoise_eval/candidates/pilot_wiener.py` factories
`self_both`, `tuned_both`, `bayer_both`, `self_luma`, `tuned_luma`, `bayer_luma`.
The other five adapters are Off, current default, current tuned PSNR, current
tuned sharpness and verified RawNIND Bayer at strength 1.0. Optional neural
linear was not included: the requested Bayer comparison already answers the
pilot/demosaic question without doubling the model/runtime coverage.

`onnxruntime==1.32.0` is installed only in this worktree's venv. The copied,
31.1 MB Bayer model remains under ignored output; verified SHA-256 is
`da27509dab6a2915da67e988acd86cf71f9d5bbc8d1aa0ed32933578a887b901`.
The pinned licence text/model grant and conversion provenance are retained
in [RawNIND's existing report](rawnind-prototype.md), “Scope and
reproducibility” and “Verification, November 16”: upstream GPL-3 code and
GPL-3/CC-BY-4.0 checkpoint grant. Nothing new is redistributed or bundled.

## What is implemented

This is the **pilot-guided coefficient shrinkage idea**, not BM3D's block
matching, collaborative 3D transform or full second-stage implementation.
For noisy AHD source `N`, pilot `P`, component `c` and scale `j`:

1. Use current Denoise's exact orthonormal `OPPONENT` matrix (first row is
   equal RGB weights, not the separate ACEScg physical-luminance row).
2. Decompose both frames using its five undecimated separable B3 à-trous
   levels, identical reflection/frame-edge semantics.
3. Reuse **current Denoise's measured RGB noise model**, fitted to noisy AHD,
   not the raw camera fit propagated through demosaic. Spatial variance is
   `c*y² + a*y + b`, evaluated on the current smoothed ACEScg luminance;
   per-component/per-band measured sigma factors supply the band variance.
4. Pilot power is `box3x3(P_band²)`. Locked analysis settings are radius 1
   and `k=1`. Unit gain is `g=Ppower/(Ppower+k*band_variance)`.
5. Both-Wiener output is original noisy coarse base plus
   `Σ(g * noisy_band)`. The code uses the algebraically equivalent
   `original + Σ((g-1)*noisy_band)` to keep neutral controls exact.

Self-pilot means current default output. Tuned-pilot means current PSNR-tuned
output, using its nearest measured ISO for a real photo. Bayer-pilot means
the **corrected** RawNIND Bayer output in the same source orientation,
WB/camera-to-ACEScg frame and exposure. No fitted colour correction, reference
alignment search, resampling or per-tile gain matching is introduced.

For `*_both`, every retained source detail coefficient keeps its sign and
its squared magnitude cannot increase: `0≤g≤1`. A tiny-array test checks
that inequality **coefficient by coefficient** across strengths, not only a
global energy sum. This excludes injecting a neural coefficient into those
bands. It does **not** prove all residual texture is genuine: input noise can
survive, spatially varying shrinkage can distort edges, and re-decomposing
the redundant reconstructed frame is not the same coefficient array.

`*_luma` uses Wiener only for component 0 and directly substitutes pilot
chroma, including its coarse chroma base, at normal settings. It therefore
**does not have the chroma no-invention guarantee**. It explicitly tests the
proposed exception, rather than silently claiming the same safety as both.

## Cached analysis and proposed live controls

Prepare performs the noise fit, pilot, decompositions and gains once.
Resolve reads only original pixels, noisy bands, cached gains and (for the
direct-chroma experiment) pilot-minus-original chroma bands/base. It calls
neither the network nor à-trous/noise estimation. A test replaces the analysis
function with a failing stub while changing controls to enforce this boundary.

For each band/component, `s=(2 Amount)*(2 Luminance or 2 Color Noise)*size`.
The four size multipliers are twice their slider value, covering levels 0,
1, 2 and 3–4 respectively. Recover the new gain cheaply from the cached unit
gain: `g_s=g/(g+s²*(1-g))`; when `s=0`, use exactly 1. All gains stay [0,1].
Detail Recovery uses current Denoise's fine-band multiplier and floor: below
0.5, stronger noise variance on the first two bands; above 0.5, a retained
coefficient floor. Show noise is original minus resolved result. Recalculate
invalidates pilot/analysis only when source, geometry, pilot or locked settings
change; exposure/grade changes downstream must not invalidate it.

Direct chroma instead blends each cached chroma band/base with weight
`clamp(s,0,1)` (fine-band recovery modifies the first two bands). At normal
Amount/Color Noise 0.5 it takes the pilot. At zero Color Noise chroma is
untouched; the upper half saturates at the pilot and **cannot clean further**.
That plateau is a known control-design limitation, not a speed or quality pass.
No source coefficient is extrapolated away from the pilot to fake extra strength.

Bypass, Amount zero, both component sliders zero and all four sizes zero are
exact identity, including alpha. Float32 reconstruction/grid checks allow
2e-7 linear units for accumulation-order differences only; this new numerical
allowance does not relax the brief's perceptual mean <1 / p99 <3 limits.
The inherited timing allowance is ±10%; these are single-run timings, not
regression comparisons or a measured action-to-screen improvement.

The reference deliberately caches FP32 source coefficients and unit gains
for inspectability, not a production-ready retained-cache layout. It refuses
ordinary adapter inputs above one million pixels. Native experiments stream
512px cores/66px halos into temporary disk chunks. A future implementation
would need a compact proxy/bounded tile residual cache admitted inside the
**existing** memory owner; no extra RAM/VRAM entitlement is proposed here.
CPU recombination proves the live-slider *dependency* contract, not next-frame
GPU presentation. Preparing at native resolution and repeatedly reading a
multi-GB disk cache is not an acceptable live-preview architecture.

## Reading the quality tables

Full and half-resolution tables below include **every adapter**, not only
winners. PSNR/SSIM and colour means are arithmetic per-scene means; a table's
p99 is the mean of per-scene p99 values, not a pooled pixel percentile.
Flat standard deviations/ratios are per-ISO medians over the nine cases.
Texture columns are all-scene min–max at sigma .5–1, 1–2, 2–4, 4–8 px;
near-zero clean energy makes some ratios unstable. MTF/halo are the one
slanted-edge case per ISO. Bleed excludes scenes without suitable edges.
These proxies do not override inspection or turn a failed detail gate into a pass.

Half resolution averages each non-overlapping 2×2 block in **scene-linear
RGB before display encoding**, then computes the same SDR/PQ PSNR and
ΔE2000/ΔE ITP. This reduces AHD-versus-neural demosaic differences; it neither
erases them nor replaces the native-frequency detail contract. All Wiener
luma coefficients and both-Wiener chroma originate in ordinary AHD. Direct
pilot chroma remains the explicit different-demosaic exception.

Tuned-both gains over already-tuned current are only **0.34 / 0.36 / 0.12 dB**
SDR. Its edge MTF50 improves **0.965→1.033 / 0.820→0.923 / 0.628→0.693**.
Both-Wiener removes most of RawNIND's halo penalty, but the neural pilot's
missing edge coefficients are not recovered: Bayer-both reaches only
**0.941 / 0.828 / 0.692**, versus RawNIND's **0.867 / 0.847 / 0.843**.
Bayer-luma is the high-ISO fidelity alternative (**26.98 dB**), not an
all-ISO winner: **33.60 dB** at ISO 1600 and **10.63% / 8.73%** low/mid-ISO
halos, with a high-ISO MTF50 of **0.863**.

## Per-ISO measurements

### ISO 1600: full resolution

| Method | SDR dB | SSIM | ΔE00 mean/p99 | HDR dB | SSIM | ΔE ITP mean/p99 |
| --- | --- | --- | --- | --- | --- | --- |
| Off | 29.04 | 0.673 | 5.554/15.598 | 32.83 | 0.767 | 16.943/53.332 |
| Current default | 35.41 | 0.890 | 3.089/10.363 | 40.06 | 0.939 | 7.871/33.182 |
| Current tuned | 37.12 | 0.896 | 2.585/9.116 | 41.03 | 0.940 | 7.057/30.990 |
| Current sharp | 37.12 | 0.896 | 2.585/9.116 | 41.03 | 0.940 | 7.057/30.990 |
| RawNIND Bayer | 32.95 | 0.869 | 3.555/18.461 | 38.74 | 0.914 | 8.604/56.560 |
| self both | 36.10 | 0.888 | 2.938/10.155 | 40.64 | 0.938 | 7.493/32.649 |
| tuned both | 37.46 | 0.896 | 2.556/9.037 | 41.56 | 0.942 | 6.816/29.865 |
| bayer both | 36.31 | 0.889 | 2.803/11.977 | 40.12 | 0.929 | 7.828/42.251 |
| self luma | 35.59 | 0.880 | 3.105/10.417 | 40.37 | 0.935 | 7.862/33.195 |
| tuned luma | 37.27 | 0.896 | 2.584/9.119 | 41.33 | 0.941 | 7.018/30.414 |
| bayer luma | 33.60 | 0.879 | 3.513/18.326 | 38.82 | 0.923 | 8.196/55.298 |

### ISO 1600: half resolution (2×2 area)

| Method | SDR dB | ΔE00 mean/p99 | HDR dB | ΔE ITP mean/p99 |
| --- | --- | --- | --- | --- |
| Off | 32.64 | 4.343/12.237 | 38.02 | 12.178/36.790 |
| Current default | 37.48 | 2.684/8.989 | 43.71 | 6.702/24.507 |
| Current tuned | 38.63 | 2.248/8.156 | 45.13 | 6.069/22.238 |
| Current sharp | 38.63 | 2.248/8.156 | 45.13 | 6.069/22.238 |
| RawNIND Bayer | 34.75 | 3.122/15.449 | 42.14 | 7.042/39.306 |
| self both | 37.96 | 2.566/8.987 | 44.29 | 6.438/24.449 |
| tuned both | 39.06 | 2.214/8.096 | 45.38 | 5.858/22.234 |
| bayer both | 38.34 | 2.407/10.330 | 44.56 | 6.444/28.167 |
| self luma | 37.53 | 2.697/9.042 | 43.86 | 6.733/24.794 |
| tuned luma | 38.80 | 2.245/8.149 | 45.45 | 6.040/22.043 |
| bayer luma | 35.47 | 3.087/15.270 | 42.52 | 6.673/36.856 |

### ISO 1600: noise, structure and edges

| Method | Flat σ Y/C | Flat ratio Y/C | Texture min–max per band | MTF50/clean | Extra halo | Bleed mean/p99 |
| --- | --- | --- | --- | --- | --- | --- |
| Off | 0.016/0.032 | 1.000/1.000 | 1.008–187.120; 1.011–35.755; 1.003–8.908; 0.999–2.570 | 1.000 | 0.36% | 0.044/0.227 |
| Current default | 0.004/0.010 | 0.231/0.303 | 0.050–4.998; 0.107–2.501; 0.294–1.398; 0.296–1.299 | 0.995 | 0.22% | 0.035/0.213 |
| Current tuned | 0.002/0.004 | 0.097/0.133 | 0.001–1.201; 0.022–1.232; 0.096–1.384; 0.095–1.499 | 0.965 | 0.10% | 0.039/0.236 |
| Current sharp | 0.002/0.004 | 0.097/0.133 | 0.001–1.201; 0.022–1.232; 0.096–1.384; 0.095–1.499 | 0.965 | 0.10% | 0.039/0.236 |
| RawNIND Bayer | 0.003/0.004 | 0.131/0.120 | 0.006–0.713; 0.180–1.068; 0.547–1.982; 0.840–3.167 | 0.867 | 7.32% | 0.089/0.394 |
| self both | 0.003/0.008 | 0.162/0.257 | 0.012–2.624; 0.062–1.868; 0.208–1.217; 0.205–1.323 | 1.015 | 0.15% | 0.034/0.215 |
| tuned both | 0.002/0.004 | 0.094/0.131 | 0.001–1.116; 0.017–1.151; 0.060–1.287; 0.060–1.383 | 1.033 | 0.13% | 0.037/0.236 |
| bayer both | 0.002/0.004 | 0.088/0.130 | 0.008–0.884; 0.083–1.191; 0.338–2.117; 0.358–3.008 | 0.941 | 0.10% | 0.049/0.231 |
| self luma | 0.003/0.010 | 0.178/0.302 | 0.010–3.152; 0.059–2.166; 0.207–1.297; 0.205–1.496 | 1.003 | 0.16% | 0.035/0.212 |
| tuned luma | 0.002/0.004 | 0.094/0.133 | 0.001–1.226; 0.017–1.239; 0.060–1.490; 0.060–1.703 | 1.024 | 0.13% | 0.039/0.236 |
| bayer luma | 0.002/0.004 | 0.102/0.120 | 0.009–1.359; 0.101–1.630; 0.399–2.071; 0.452–2.586 | 1.175 | 10.63% | 0.090/0.411 |

### ISO 6400: full resolution

| Method | SDR dB | SSIM | ΔE00 mean/p99 | HDR dB | SSIM | ΔE ITP mean/p99 |
| --- | --- | --- | --- | --- | --- | --- |
| Off | 23.13 | 0.448 | 9.985/23.877 | 26.64 | 0.581 | 32.501/103.996 |
| Current default | 29.92 | 0.806 | 5.600/17.333 | 34.87 | 0.902 | 15.258/54.900 |
| Current tuned | 31.43 | 0.859 | 4.652/15.216 | 35.91 | 0.927 | 13.531/50.913 |
| Current sharp | 31.04 | 0.845 | 4.875/15.131 | 35.48 | 0.917 | 14.016/49.284 |
| RawNIND Bayer | 31.26 | 0.841 | 4.266/19.059 | 36.21 | 0.910 | 11.770/59.545 |
| self both | 30.53 | 0.827 | 5.282/16.828 | 35.35 | 0.913 | 14.486/53.338 |
| tuned both | 31.79 | 0.860 | 4.617/15.065 | 36.26 | 0.929 | 13.282/48.988 |
| bayer both | 30.96 | 0.856 | 4.760/16.283 | 35.55 | 0.921 | 13.751/54.438 |
| self luma | 30.08 | 0.805 | 5.608/17.343 | 35.09 | 0.905 | 15.139/54.771 |
| tuned luma | 31.60 | 0.860 | 4.651/15.226 | 36.14 | 0.929 | 13.477/50.336 |
| bayer luma | 31.09 | 0.845 | 4.238/19.092 | 35.57 | 0.916 | 11.716/59.097 |

### ISO 6400: half resolution (2×2 area)

| Method | SDR dB | ΔE00 mean/p99 | HDR dB | ΔE ITP mean/p99 |
| --- | --- | --- | --- | --- |
| Off | 26.22 | 8.320/20.806 | 31.74 | 24.044/69.357 |
| Current default | 31.53 | 5.140/15.664 | 37.91 | 13.815/43.224 |
| Current tuned | 32.62 | 4.333/14.300 | 39.21 | 12.386/37.661 |
| Current sharp | 32.57 | 4.501/13.936 | 38.93 | 12.673/37.649 |
| RawNIND Bayer | 32.83 | 3.847/16.099 | 39.30 | 10.268/42.779 |
| self both | 31.94 | 4.886/15.373 | 38.37 | 13.265/42.341 |
| tuned both | 32.99 | 4.286/13.994 | 39.50 | 12.206/37.273 |
| bayer both | 32.47 | 4.374/14.705 | 38.97 | 12.384/39.865 |
| self luma | 31.57 | 5.149/15.668 | 38.01 | 13.786/43.465 |
| tuned luma | 32.82 | 4.331/14.317 | 39.47 | 12.357/37.268 |
| bayer luma | 32.66 | 3.821/16.002 | 38.80 | 10.233/40.804 |

### ISO 6400: noise, structure and edges

| Method | Flat σ Y/C | Flat ratio Y/C | Texture min–max per band | MTF50/clean | Extra halo | Bleed mean/p99 |
| --- | --- | --- | --- | --- | --- | --- |
| Off | 0.032/0.065 | 1.000/1.000 | 1.088–663.104; 1.049–133.428; 1.019–29.908; 1.020–7.108 | 0.964 | 2.19% | 0.084/0.312 |
| Current default | 0.009/0.019 | 0.250/0.298 | 0.055–17.104; 0.109–6.667; 0.279–3.718; 0.283–2.252 | 0.916 | 0.88% | 0.057/0.270 |
| Current tuned | 0.004/0.009 | 0.105/0.150 | 0.001–1.130; 0.021–1.219; 0.085–1.485; 0.085–1.767 | 0.820 | 0.17% | 0.063/0.286 |
| Current sharp | 0.009/0.011 | 0.228/0.190 | 0.062–18.111; 0.114–4.709; 0.282–2.815; 0.285–1.962 | 0.927 | 0.66% | 0.057/0.275 |
| RawNIND Bayer | 0.004/0.006 | 0.078/0.096 | 0.006–0.948; 0.051–1.248; 0.260–1.930; 0.681–2.397 | 0.847 | 7.58% | 0.092/0.394 |
| self both | 0.006/0.016 | 0.183/0.258 | 0.014–7.418; 0.062–4.268; 0.193–2.223; 0.192–2.258 | 0.934 | 0.25% | 0.055/0.274 |
| tuned both | 0.003/0.009 | 0.099/0.156 | 0.001–1.119; 0.016–1.414; 0.052–1.740; 0.053–2.404 | 0.923 | 0.16% | 0.059/0.282 |
| bayer both | 0.003/0.008 | 0.092/0.140 | 0.005–0.785; 0.044–1.181; 0.175–2.449; 0.362–3.690 | 0.828 | 0.18% | 0.068/0.279 |
| self luma | 0.007/0.019 | 0.202/0.299 | 0.012–10.825; 0.060–5.420; 0.191–2.613; 0.191–2.516 | 0.931 | 0.23% | 0.057/0.270 |
| tuned luma | 0.004/0.009 | 0.102/0.151 | 0.001–1.190; 0.016–1.248; 0.052–1.925; 0.053–2.639 | 0.922 | 0.21% | 0.063/0.286 |
| bayer luma | 0.004/0.006 | 0.091/0.092 | 0.006–1.093; 0.051–1.395; 0.206–1.986; 0.450–2.371 | 1.051 | 8.73% | 0.092/0.405 |

### ISO 25600: full resolution

| Method | SDR dB | SSIM | ΔE00 mean/p99 | HDR dB | SSIM | ΔE ITP mean/p99 |
| --- | --- | --- | --- | --- | --- | --- |
| Off | 17.29 | 0.221 | 16.346/32.221 | 20.28 | 0.340 | 62.788/175.416 |
| Current default | 23.85 | 0.626 | 10.392/26.968 | 29.23 | 0.797 | 30.786/96.833 |
| Current tuned | 25.08 | 0.790 | 9.321/25.086 | 30.52 | 0.889 | 27.224/82.081 |
| Current sharp | 18.51 | 0.253 | 14.958/30.920 | 22.94 | 0.410 | 52.280/142.330 |
| RawNIND Bayer | 27.98 | 0.796 | 5.794/20.769 | 32.89 | 0.894 | 19.000/68.035 |
| self both | 24.32 | 0.690 | 9.946/26.742 | 29.68 | 0.835 | 29.269/93.805 |
| tuned both | 25.20 | 0.792 | 9.323/25.208 | 30.61 | 0.891 | 27.185/83.099 |
| bayer both | 25.03 | 0.805 | 9.200/23.762 | 30.72 | 0.899 | 26.520/76.348 |
| self luma | 23.99 | 0.645 | 10.340/26.947 | 29.41 | 0.815 | 30.305/96.485 |
| tuned luma | 25.18 | 0.794 | 9.326/25.177 | 30.67 | 0.893 | 27.141/82.413 |
| bayer luma | 26.98 | 0.796 | 5.769/20.636 | 31.57 | 0.896 | 19.973/70.076 |

### ISO 25600: half resolution (2×2 area)

| Method | SDR dB | ΔE00 mean/p99 | HDR dB | ΔE ITP mean/p99 |
| --- | --- | --- | --- | --- |
| Off | 19.91 | 14.433/29.199 | 24.97 | 47.118/129.343 |
| Current default | 25.08 | 9.888/25.643 | 31.47 | 28.680/81.265 |
| Current tuned | 26.00 | 8.959/23.557 | 32.62 | 25.853/66.304 |
| Current sharp | 21.18 | 13.166/28.358 | 26.82 | 41.298/113.355 |
| RawNIND Bayer | 29.30 | 5.399/18.079 | 35.50 | 17.567/52.218 |
| self both | 25.39 | 9.545/25.448 | 31.82 | 27.669/78.887 |
| tuned both | 26.11 | 8.955/23.681 | 32.73 | 25.824/67.086 |
| bayer both | 26.08 | 8.823/22.358 | 32.83 | 25.176/62.128 |
| self luma | 25.12 | 9.862/25.607 | 31.55 | 28.436/81.217 |
| tuned luma | 26.11 | 8.961/23.573 | 32.79 | 25.785/66.016 |
| bayer luma | 28.13 | 5.378/17.867 | 33.78 | 18.568/53.611 |

### ISO 25600: noise, structure and edges

| Method | Flat σ Y/C | Flat ratio Y/C | Texture min–max per band | MTF50/clean | Extra halo | Bleed mean/p99 |
| --- | --- | --- | --- | --- | --- | --- |
| Off | 0.069/0.128 | 1.000/1.000 | 1.630–2301.981; 1.277–450.632; 1.069–103.017; 1.062–21.333 | 0.916 | 7.26% | 0.160/0.478 |
| Current default | 0.022/0.042 | 0.314/0.335 | 0.045–168.584; 0.107–42.580; 0.266–11.258; 0.275–5.392 | 0.737 | 0.63% | 0.103/0.372 |
| Current tuned | 0.011/0.018 | 0.170/0.149 | 0.001–22.019; 0.020–9.777; 0.065–3.224; 0.067–2.645 | 0.628 | 0.27% | 0.110/0.384 |
| Current sharp | 0.063/0.106 | 0.911/0.818 | 1.413–1765.224; 1.228–369.999; 1.046–87.516; 1.031–19.655 | 0.910 | 6.10% | 0.141/0.443 |
| RawNIND Bayer | 0.011/0.013 | 0.109/0.099 | 0.007–3.956; 0.148–3.995; 0.373–1.584; 0.622–2.096 | 0.843 | 8.96% | 0.100/0.392 |
| self both | 0.016/0.036 | 0.232/0.294 | 0.014–99.571; 0.063–28.966; 0.168–6.463; 0.175–4.636 | 0.741 | 0.50% | 0.100/0.372 |
| tuned both | 0.011/0.018 | 0.165/0.145 | 0.001–18.555; 0.015–9.581; 0.041–3.578; 0.045–3.731 | 0.693 | 0.30% | 0.106/0.375 |
| bayer both | 0.009/0.022 | 0.124/0.179 | 0.005–2.704; 0.040–3.177; 0.135–2.065; 0.295–3.776 | 0.692 | 0.23% | 0.104/0.363 |
| self luma | 0.018/0.042 | 0.255/0.335 | 0.013–115.498; 0.065–31.385; 0.171–7.825; 0.179–4.788 | 0.735 | 0.53% | 0.101/0.373 |
| tuned luma | 0.011/0.018 | 0.165/0.150 | 0.001–17.531; 0.015–8.634; 0.041–3.263; 0.044–3.832 | 0.694 | 0.29% | 0.110/0.386 |
| bayer luma | 0.013/0.011 | 0.102/0.089 | 0.007–2.345; 0.053–2.441; 0.162–1.691; 0.330–2.132 | 0.863 | 1.68% | 0.098/0.396 |

## Public noisy/clean pairs

Reused the verified local CC0 RawNIND subset through an output-only symlink;
no data was downloaded or added to Git. The inherited preparation and exclusions
are documented in [public-pairs.md](public-pairs.md). The merged manifest selects
43 RAWs from 12 scenes; screening leaves **52 crops, 11 scenes, four cameras**:
**four held-out scenes / six captures / 19 crops**, and **seven training-seen
scenes / 13 captures / 33 crops**. RawNIND was trained on the latter; their results
are diagnostic, never independent validation. Accepted noisy ISO is only
1600/3200/6400, with ISO100 references. No accepted high-ISO real-pair result
exists; rejected cases are missing evidence, not passes.

Both frames use the inherited shared camera/WB/ACEScg tail. Noisy CFA samples
are untouched; clean-only translation registration and one per-capture RGB gain
are fixed before any candidate runs. Registration, reference noise, interpolation
and illumination remain possible confounds. Every adapter uses the same valid
mask. Half resolution is a 2×2 area mean on scene-linear RGB **before** the common
display transform, accepting a block only when all four source pixels are valid.
It reduces demosaic sensitivity; it does not erase registration/colour errors or
replace the full-resolution structure contract.

All eleven adapters, including standalone RawNIND Bayer, completed with **zero
errors**, 402.03 s and 1.228 GB peak RSS. Tables are **scene-balanced**: average
crops within capture, captures within scene, then scenes equally. Reported p99 is
the average of scene-balanced crop p99 values, not a pooled pixel percentile.
The low/mid ISO-band table is exploratory: held-out ISO6400 has only one scene.

**Held-out winner: Bayer-both**, 35.52 dB SDR, **+1.91 dB over default / +.69 dB
over tuned**. Its half-resolution advantage persists (37.41 vs 35.62/36.67 dB),
so a different demosaic alone does not explain the gain. Mean/p99 colour error
also falls. But local edge energy is only .763 of clean, below default's .834
(above tuned's .715); this is a gradient proxy, **not MTF50 or a halo pass**.
Tuned-both, the synthetic winner, is effectively tied with tuned on these pairs
(34.80 vs 34.83 dB). On training-seen scenes Bayer-both is 35.27 vs default 34.43;
Bayer-luma and standalone Bayer are below default there. Do not combine these
populations or claim new high-ISO/MTF/halo qualification.

At 128px review scale the inspected held-out and seen crops look cleaner, but
printed/mesh dot patterns change in the neural alternatives. These thumbnails
cannot establish 1:1 fine-detail safety; the synthetic 1:1 failures still apply.

| Variant | What the held-out pairs add | Decision |
| --- | --- | --- |
| self-both | +.32 dB SDR vs default, edge energy .815 vs .834 | Small cleanup; no complete pass |
| tuned-both | -.03 dB vs tuned, edge energy .775 vs .715 | Synthetic gain does not generalize to a fidelity win here |
| Bayer-both | Best SDR/HDR/half fidelity; edge energy .763 vs default .834 | Most promising real-pair pilot; still reject current sharpness/texture failures |
| self-luma | +.09 dB vs default, edge energy .817 | No useful case over self-both |
| tuned-luma | -.02 dB vs tuned, edge energy .775 | No useful case over tuned-both; direct chroma lacks invariant |
| Bayer-luma | +1.43 dB vs default, edge energy .844; worse colour tails than Bayer-both | No advantage worth synthetic halo/colour risks |

### Public pairs, held-out: full resolution

| Method | Scenes/captures/crops | SDR dB | SSIM | ΔE00 mean/p99 | HDR dB | SSIM | ΔE ITP mean/p99 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Current default | 4/6/19 | 33.61 | 0.836 | 3.772/12.435 | 40.47 | 0.944 | 8.480/28.330 |
| Off | 4/6/19 | 27.68 | 0.589 | 7.033/19.426 | 33.32 | 0.783 | 17.888/55.310 |
| Current tuned | 4/6/19 | 34.83 | 0.885 | 3.043/10.429 | 41.49 | 0.964 | 7.096/25.153 |
| Current sharp | 4/6/19 | 34.78 | 0.884 | 3.050/10.469 | 41.46 | 0.964 | 7.104/25.197 |
| bayer both | 4/6/19 | 35.52 | 0.902 | 2.830/9.883 | 42.12 | 0.969 | 6.483/23.121 |
| bayer luma | 4/6/19 | 35.04 | 0.895 | 3.001/12.168 | 41.88 | 0.967 | 6.666/26.674 |
| self both | 4/6/19 | 33.93 | 0.847 | 3.591/12.194 | 40.76 | 0.949 | 8.093/27.954 |
| self luma | 4/6/19 | 33.70 | 0.839 | 3.764/12.446 | 40.58 | 0.947 | 8.421/28.307 |
| tuned both | 4/6/19 | 34.80 | 0.878 | 3.087/10.779 | 41.47 | 0.961 | 7.129/25.366 |
| tuned luma | 4/6/19 | 34.82 | 0.882 | 3.051/10.472 | 41.46 | 0.962 | 7.123/25.448 |
| RawNIND Bayer | 4/6/19 | 35.07 | 0.896 | 2.983/12.104 | 42.01 | 0.967 | 6.522/25.970 |

### Public pairs, held-out: half resolution

| Method | SDR dB | ΔE00 mean/p99 | HDR dB | ΔE ITP mean/p99 |
| --- | --- | --- | --- | --- |
| Current default | 35.62 | 3.224/10.797 | 42.77 | 7.180/23.435 |
| Off | 30.90 | 5.502/15.807 | 37.39 | 13.154/39.487 |
| Current tuned | 36.67 | 2.621/9.031 | 43.51 | 6.100/21.071 |
| Current sharp | 36.65 | 2.626/9.076 | 43.53 | 6.092/21.052 |
| bayer both | 37.41 | 2.432/8.458 | 44.30 | 5.572/19.155 |
| bayer luma | 37.06 | 2.567/10.305 | 44.16 | 5.605/20.653 |
| self both | 35.89 | 3.083/10.603 | 42.99 | 6.894/23.130 |
| self luma | 35.66 | 3.221/10.797 | 42.81 | 7.160/23.460 |
| tuned both | 36.74 | 2.650/9.307 | 43.63 | 6.086/21.005 |
| tuned luma | 36.71 | 2.623/9.069 | 43.57 | 6.095/21.218 |
| RawNIND Bayer | 37.08 | 2.552/10.259 | 44.24 | 5.480/20.022 |

### Public pairs, held-out: noise and structure proxies

| Method | Flat σ Y/C | Flat ratio Y/C | Texture ratio per band | Local edge energy/clean | Bleed mean/p99 | Removed-edge correlation |
| --- | --- | --- | --- | --- | --- | --- |
| Current default | 0.009/0.022 | 0.443/0.482 | 1.160; 0.839; 0.854; 0.918 | 0.834 | 0.034/0.117 | -0.040 |
| Off | 0.020/0.047 | 1.000/1.000 | 9.441; 2.908; 1.306; 1.051 | 1.794 | 0.059/0.185 | 0.000 |
| Current tuned | 0.007/0.015 | 0.356/0.340 | 0.575; 0.624; 0.727; 0.848 | 0.715 | 0.032/0.110 | 0.025 |
| Current sharp | 0.007/0.016 | 0.366/0.342 | 0.688; 0.681; 0.752; 0.857 | 0.737 | 0.032/0.110 | 0.021 |
| bayer both | 0.005/0.014 | 0.283/0.308 | 0.578; 0.693; 0.798; 0.899 | 0.763 | 0.029/0.101 | -0.041 |
| bayer luma | 0.006/0.014 | 0.294/0.309 | 0.744; 0.804; 0.851; 0.914 | 0.844 | 0.033/0.124 | -0.015 |
| self both | 0.008/0.021 | 0.418/0.460 | 1.002; 0.790; 0.838; 0.915 | 0.815 | 0.033/0.116 | -0.047 |
| self luma | 0.008/0.022 | 0.422/0.481 | 0.989; 0.803; 0.845; 0.917 | 0.817 | 0.034/0.117 | -0.047 |
| tuned both | 0.007/0.016 | 0.374/0.361 | 0.713; 0.707; 0.790; 0.891 | 0.775 | 0.031/0.110 | -0.029 |
| tuned luma | 0.007/0.016 | 0.374/0.341 | 0.722; 0.706; 0.787; 0.888 | 0.775 | 0.032/0.110 | -0.005 |
| RawNIND Bayer | 0.005/0.014 | 0.295/0.308 | 0.484; 0.733; 0.864; 0.950 | 0.799 | 0.033/0.123 | 0.060 |

### Public pairs, held-out: ISO bands

| ISO band | Method | Scenes/captures/crops | SDR full dB | SDR half dB | HDR full dB | HDR half dB |
| --- | --- | --- | --- | --- | --- | --- |
| low: <=3200 | Current default | 4/5/15 | 33.95 | 36.02 | 40.72 | 43.08 |
| low: <=3200 | Off | 4/5/15 | 28.42 | 31.61 | 34.04 | 38.03 |
| low: <=3200 | Current tuned | 4/5/15 | 34.97 | 36.89 | 41.60 | 43.70 |
| low: <=3200 | Current sharp | 4/5/15 | 34.97 | 36.89 | 41.60 | 43.70 |
| low: <=3200 | bayer both | 4/5/15 | 35.66 | 37.62 | 42.21 | 44.48 |
| low: <=3200 | bayer luma | 4/5/15 | 35.08 | 37.18 | 41.92 | 44.28 |
| low: <=3200 | self both | 4/5/15 | 34.22 | 36.25 | 40.97 | 43.28 |
| low: <=3200 | self luma | 4/5/15 | 34.03 | 36.06 | 40.82 | 43.12 |
| low: <=3200 | tuned both | 4/5/15 | 34.95 | 36.97 | 41.58 | 43.83 |
| low: <=3200 | tuned luma | 4/5/15 | 34.96 | 36.94 | 41.57 | 43.76 |
| low: <=3200 | RawNIND Bayer | 4/5/15 | 35.06 | 37.14 | 41.96 | 44.29 |
| mid: 3201..12800 | Current default | 1/1/4 | 36.76 | 38.35 | 44.54 | 46.09 |
| mid: 3201..12800 | Off | 1/1/4 | 27.71 | 31.34 | 35.24 | 39.40 |
| mid: 3201..12800 | Current tuned | 1/1/4 | 38.49 | 39.79 | 45.60 | 46.70 |
| mid: 3201..12800 | Current sharp | 1/1/4 | 38.08 | 39.66 | 45.31 | 46.89 |
| mid: 3201..12800 | bayer both | 1/1/4 | 39.08 | 40.59 | 46.32 | 47.63 |
| mid: 3201..12800 | bayer luma | 1/1/4 | 38.97 | 40.55 | 46.18 | 47.55 |
| mid: 3201..12800 | self both | 1/1/4 | 37.39 | 38.87 | 45.11 | 46.53 |
| mid: 3201..12800 | self luma | 1/1/4 | 36.94 | 38.43 | 44.79 | 46.20 |
| mid: 3201..12800 | tuned both | 1/1/4 | 38.72 | 40.11 | 45.99 | 47.22 |
| mid: 3201..12800 | tuned luma | 1/1/4 | 38.56 | 39.90 | 45.80 | 46.97 |
| mid: 3201..12800 | RawNIND Bayer | 1/1/4 | 39.11 | 40.79 | 46.46 | 47.96 |

### Public pairs, seen by RawNIND: full resolution

| Method | Scenes/captures/crops | SDR dB | SSIM | ΔE00 mean/p99 | HDR dB | SSIM | ΔE ITP mean/p99 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Current default | 7/13/33 | 34.43 | 0.877 | 3.165/9.865 | 41.62 | 0.959 | 6.624/22.523 |
| Off | 7/13/33 | 29.31 | 0.700 | 5.771/15.703 | 36.42 | 0.880 | 11.722/39.130 |
| Current tuned | 7/13/33 | 34.17 | 0.867 | 3.099/9.715 | 41.21 | 0.954 | 6.927/24.085 |
| Current sharp | 7/13/33 | 34.32 | 0.871 | 3.081/9.638 | 41.39 | 0.955 | 6.795/23.445 |
| bayer both | 7/13/33 | 35.27 | 0.892 | 2.747/8.498 | 42.24 | 0.963 | 5.904/20.723 |
| bayer luma | 7/13/33 | 34.00 | 0.867 | 3.550/14.064 | 41.21 | 0.955 | 6.917/29.178 |
| self both | 7/13/33 | 34.61 | 0.880 | 3.063/9.690 | 41.76 | 0.960 | 6.499/22.408 |
| self luma | 7/13/33 | 34.46 | 0.876 | 3.166/9.858 | 41.66 | 0.959 | 6.637/22.473 |
| tuned both | 7/13/33 | 34.59 | 0.874 | 2.990/9.512 | 41.66 | 0.957 | 6.566/22.926 |
| tuned luma | 7/13/33 | 34.37 | 0.873 | 3.087/9.693 | 41.47 | 0.957 | 6.838/23.698 |
| RawNIND Bayer | 7/13/33 | 33.93 | 0.867 | 3.545/14.045 | 41.18 | 0.953 | 6.861/29.262 |

### Public pairs, seen by RawNIND: half resolution

| Method | SDR dB | ΔE00 mean/p99 | HDR dB | ΔE ITP mean/p99 |
| --- | --- | --- | --- | --- |
| Current default | 36.71 | 2.596/7.844 | 44.44 | 5.372/16.216 |
| Off | 32.72 | 4.382/11.762 | 40.82 | 8.511/24.959 |
| Current tuned | 36.23 | 2.572/7.791 | 43.73 | 5.814/17.742 |
| Current sharp | 36.48 | 2.548/7.729 | 44.06 | 5.640/17.058 |
| bayer both | 37.56 | 2.211/6.583 | 45.04 | 4.789/14.582 |
| bayer luma | 36.37 | 2.941/11.526 | 44.19 | 5.514/19.705 |
| self both | 36.85 | 2.514/7.743 | 44.54 | 5.291/16.131 |
| self luma | 36.67 | 2.601/7.836 | 44.40 | 5.411/16.245 |
| tuned both | 36.77 | 2.453/7.558 | 44.33 | 5.418/16.565 |
| tuned luma | 36.48 | 2.556/7.767 | 44.07 | 5.705/17.572 |
| RawNIND Bayer | 36.32 | 2.932/11.479 | 44.17 | 5.443/19.721 |

### Public pairs, seen by RawNIND: noise and structure proxies

| Method | Flat σ Y/C | Flat ratio Y/C | Texture ratio per band | Local edge energy/clean | Bleed mean/p99 | Removed-edge correlation |
| --- | --- | --- | --- | --- | --- | --- |
| Current default | 0.008/0.017 | 0.510/0.483 | 0.733; 0.709; 0.799; 0.899 | 0.728 | 0.025/0.090 | -0.055 |
| Off | 0.017/0.035 | 1.000/1.000 | 6.253; 3.030; 1.468; 1.093 | 1.590 | 0.045/0.145 | 0.000 |
| Current tuned | 0.007/0.015 | 0.470/0.449 | 0.355; 0.495; 0.647; 0.808 | 0.600 | 0.027/0.098 | 0.022 |
| Current sharp | 0.008/0.015 | 0.491/0.448 | 0.580; 0.594; 0.701; 0.839 | 0.652 | 0.026/0.096 | -0.001 |
| bayer both | 0.007/0.014 | 0.460/0.405 | 0.436; 0.596; 0.749; 0.883 | 0.678 | 0.023/0.083 | -0.003 |
| bayer luma | 0.007/0.015 | 0.457/0.453 | 0.589; 0.712; 0.801; 0.902 | 0.772 | 0.030/0.131 | 0.006 |
| self both | 0.008/0.016 | 0.492/0.465 | 0.659; 0.662; 0.774; 0.891 | 0.712 | 0.025/0.090 | -0.056 |
| self luma | 0.008/0.017 | 0.495/0.483 | 0.644; 0.673; 0.788; 0.896 | 0.711 | 0.025/0.090 | -0.057 |
| tuned both | 0.008/0.015 | 0.471/0.431 | 0.473; 0.577; 0.708; 0.854 | 0.662 | 0.025/0.095 | -0.023 |
| tuned luma | 0.008/0.015 | 0.475/0.450 | 0.479; 0.579; 0.709; 0.854 | 0.665 | 0.027/0.098 | -0.014 |
| RawNIND Bayer | 0.008/0.015 | 0.498/0.451 | 0.437; 0.689; 0.852; 0.951 | 0.757 | 0.030/0.130 | 0.088 |

### Public pairs, seen by RawNIND: ISO bands

| ISO band | Method | Scenes/captures/crops | SDR full dB | SDR half dB | HDR full dB | HDR half dB |
| --- | --- | --- | --- | --- | --- | --- |
| low: <=3200 | Current default | 7/8/23 | 34.87 | 37.29 | 41.66 | 44.51 |
| low: <=3200 | Off | 7/8/23 | 31.10 | 34.42 | 37.90 | 42.06 |
| low: <=3200 | Current tuned | 7/8/23 | 34.29 | 36.44 | 41.01 | 43.54 |
| low: <=3200 | Current sharp | 7/8/23 | 34.29 | 36.44 | 41.01 | 43.54 |
| low: <=3200 | bayer both | 7/8/23 | 35.44 | 37.85 | 42.10 | 44.93 |
| low: <=3200 | bayer luma | 7/8/23 | 33.97 | 36.40 | 40.86 | 43.93 |
| low: <=3200 | self both | 7/8/23 | 34.93 | 37.31 | 41.69 | 44.50 |
| low: <=3200 | self luma | 7/8/23 | 34.86 | 37.22 | 41.64 | 44.41 |
| low: <=3200 | tuned both | 7/8/23 | 34.74 | 37.02 | 41.48 | 44.16 |
| low: <=3200 | tuned luma | 7/8/23 | 34.48 | 36.69 | 41.26 | 43.87 |
| low: <=3200 | RawNIND Bayer | 7/8/23 | 33.86 | 36.34 | 40.83 | 43.91 |
| mid: 3201..12800 | Current default | 5/5/10 | 34.87 | 36.61 | 42.42 | 44.57 |
| mid: 3201..12800 | Off | 5/5/10 | 27.66 | 31.09 | 35.22 | 39.58 |
| mid: 3201..12800 | Current tuned | 5/5/10 | 35.00 | 36.61 | 42.24 | 44.08 |
| mid: 3201..12800 | Current sharp | 5/5/10 | 35.43 | 37.31 | 42.73 | 45.00 |
| mid: 3201..12800 | bayer both | 5/5/10 | 36.21 | 37.98 | 43.38 | 45.48 |
| mid: 3201..12800 | bayer luma | 5/5/10 | 35.14 | 37.12 | 42.62 | 44.94 |
| mid: 3201..12800 | self both | 5/5/10 | 35.22 | 36.91 | 42.70 | 44.78 |
| mid: 3201..12800 | self luma | 5/5/10 | 34.96 | 36.62 | 42.54 | 44.57 |
| mid: 3201..12800 | tuned both | 5/5/10 | 35.43 | 37.15 | 42.70 | 44.68 |
| mid: 3201..12800 | tuned luma | 5/5/10 | 35.22 | 36.88 | 42.53 | 44.45 |
| mid: 3201..12800 | RawNIND Bayer | 5/5/10 | 35.16 | 37.22 | 42.72 | 45.09 |


## Native-frame time, memory and estimated GPU cost

Measured on this **MacBook Neo / A18 Pro / 8 GB**, one CPU thread, one run
per row, under the shared machine lock. Seconds below include every native
pixel; decomposition/gain and resolve clocks include temporary disk I/O.
Whole wait ends at a resolved ACEScg frame, **not a picture on screen**.
The total also includes about 0.20 s to prepare the baseline comparison crops.
Peak is the larger of worker high-water RSS and the sampled process-tree RSS,
in decimal GB; all six runs finish below the unchanged 2.5 GB abort guard.

| Photo | Variant | MP | Decode+AHD s | Noise fit s | Pilot s | Bands+gains s | Resolve s | Total s | Peak GB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| IMG_0790.CR2 | tuned_both | 18.02 | 1.97 | 1.77 | 5.05 | 10.56 | 2.82 | 22.36 | 0.943 |
| IMG_0790.CR2 | bayer_both | 18.02 | 1.62 | 1.46 | 7.44 | 9.22 | 2.32 | 22.27 | 1.380 |
| IMG_0790.CR2 | bayer_luma | 18.02 | 2.01 | 1.78 | 9.92 | 11.72 | 3.93 | 29.57 | 1.380 |
| 2025_0730_1331_3.arw | tuned_both | 42.39 | 3.97 | 1.85 | 12.31 | 28.86 | 7.40 | 54.60 | 1.536 |
| 2025_0730_1331_3.arw | bayer_both | 42.39 | 3.71 | 1.62 | 18.28 | 26.86 | 6.62 | 57.27 | 1.871 |
| 2025_0730_1331_3.arw | bayer_luma | 42.39 | 3.98 | 1.81 | 21.71 | 29.08 | 9.34 | 66.13 | 1.658 |

Bayer-both was added after the public-pair ranking, so the two best-supported
variants have full-frame evidence alongside the high-ISO Bayer-luma experiment.
These are separate single runs, not a controlled speed comparison: even the
identical Bayer pilot takes different times in the later runs. No speedup is
inferred from that variation.

Tuned pilots use current PSNR-tuned controls and the same globally measured
noise model; Bayer uses the corrected strength-1 model with a precomputed
unity-WB camera-RGB exposure anchor accumulated during AHD development.
The neural pilot alone takes 7.44–9.92 / 18.28–21.71 s, of which ONNX inference
is 6.76–9.13 / 16.87–20.05 s (35 / 77 fixed sensor tiles). There is no unclipped-sensor
native speed shortcut. Baseline comparison crops use the global model and
66px halos, rather than unrelated per-crop noise fits.

At full resolution the deliberately inspectable cache is 3.24 GB / 7.63 GB
on temporary disk, plus source/pilot spools; it is removed when each run ends.
This is **not** a cache-size request or a live-preview implementation.
Native cached resolve itself takes 2.32–9.34 s, far from next-frame display.
The small 512² control experiment below tests the dependency split only.

A purely pixel-proportional **24 MP CPU estimate** from these complete waits
is 29.8–30.9 s tuned-both / 29.7–32.4 s Bayer-both / 37.4–39.4 s Bayer-luma. These suggest the proposed
45 s CPU preparation budget might be possible, but are not measured 24 MP
passes. No 61 MP, whole-app peak/settled, installer, export or accelerator
qualification is claimed.

### GPU stage cost — estimated, never run

Current Denoise already has the required five-level separable B3 WebGPU
operations. A direct FP32 RGBA implementation needs about 1,920 bytes/pixel
of naive read/write traffic for two five-level, two-axis, five-tap
source/pilot decompositions. Allowing coefficient differences, local power,
variance and gain traffic makes a rough 2,400 bytes/pixel. At the measured
512-core/66-halo geometry, duplicated work multiplies this by about 1.58.
With an **assumed**, not measured, effective 20–40 GB/s, that is approximately
**1.7–3.4 s at 18 MP, 2.3–4.6 s at 24 MP, 4.0–8.0 s at 42 MP** for the
Wiener preparation stage, excluding pilot/noise fit, dispatches and readback.
Texture caching/fusion could reduce traffic; occupancy and contention could
increase time. Reusing source bands already admitted by Denoise would avoid
one decomposition. A 24 MP cached resolve reading roughly 160–220 bytes/pixel
has a 0.10–0.26 s traffic-only estimate at that same assumed bandwidth, so a
full-frame GPU resolve does **not** establish next-frame responsiveness.
Visible-region/proxy work and the existing cache owner would need a separate
bounded design. No estimated number is a GPU budget pass, measured ≥50%
action-to-screen gain, or reason to add a new production route.

## Control sweep and safeguards

All six variants were swept at **0 / 0.5 / 1.0**, for Amount and Color Noise,
on fabric and slanted-edge targets at all three ISOs: 216 measured resolves.
The table uses the slanted edge's genuinely flat side patches; numbers run
left-to-right in slider order. Y/C are residual standard deviations divided
by noisy-input standard deviations after SDR encoding, not opponent-space
coefficients. Display encoding couples the reported luma/chroma: changing
Color Noise can affect both, even though cached opponent luma stays fixed.

| Variant | ISO | Control | Flat Y, 0→.5→1 | Flat C, 0→.5→1 | MTF50, 0→.5→1 |
| --- | --- | --- | --- | --- | --- |
| tuned_both | 1600 | amount | 1.000 → 0.043 → 0.029 | 1.000 → 0.067 → 0.048 | 1.000 → 1.033 → 0.942 |
| tuned_both | 1600 | color_noise | 0.450 → 0.043 → 0.037 | 0.959 → 0.067 → 0.048 | 0.967 → 1.033 → 1.040 |
| tuned_both | 6400 | amount | 1.000 → 0.051 → 0.034 | 1.000 → 0.078 → 0.058 | 0.964 → 0.923 → 0.783 |
| tuned_both | 6400 | color_noise | 0.523 → 0.051 → 0.044 | 1.005 → 0.078 → 0.058 | 0.869 → 0.923 → 0.922 |
| tuned_both | 25600 | amount | 1.000 → 0.040 → 0.029 | 1.000 → 0.057 → 0.046 | 0.916 → 0.693 → 0.583 |
| tuned_both | 25600 | color_noise | 0.586 → 0.040 → 0.038 | 1.056 → 0.057 → 0.046 | 0.630 → 0.693 → 0.693 |
| bayer_luma | 1600 | amount | 1.000 → 0.026 → 0.024 | 1.000 → 0.031 → 0.031 | 1.000 → 1.175 → 1.044 |
| bayer_luma | 1600 | color_noise | 0.451 → 0.026 → 0.026 | 0.959 → 0.031 → 0.031 | 0.919 → 1.175 → 1.175 |
| bayer_luma | 6400 | amount | 1.000 → 0.024 → 0.024 | 1.000 → 0.021 → 0.021 | 0.964 → 1.051 → 0.906 |
| bayer_luma | 6400 | color_noise | 0.527 → 0.024 → 0.024 | 1.006 → 0.021 → 0.021 | 0.820 → 1.051 → 1.051 |
| bayer_luma | 25600 | amount | 1.000 → 0.023 → 0.021 | 1.000 → 0.022 → 0.022 | 0.916 → 0.863 → 0.762 |
| bayer_luma | 25600 | color_noise | 0.586 → 0.023 → 0.023 | 1.057 → 0.022 → 0.022 | 0.642 → 0.863 → 0.863 |

Amount zero bypasses exactly. Increasing Amount lowers flat residuals while
also reducing sharpness; raising it to 1 is not automatically a fidelity
improvement. Tuned-both Color Noise removes chroma progressively without
re-running the pilot or decomposition. Bayer-luma reaches its direct-pilot
chroma endpoint at 0.5 and plateaus at 1; this variant's colour control
therefore does **not** have a satisfactory full-range response.

The fabric sweep exposes the trade-off rather than proving a flat-noise
pass: at ISO 6400 tuned-both Amount 0 / .5 / 1 gives 23.78 / 19.10 / 19.01 dB
on that pattern. Its automatically selected low-gradient masks contain real
fabric, so residual ratios above one there are not evidence of added sensor
noise. At ISO 25600 the same sweep is 17.50 / 18.89 / 18.84 dB. Do not hide
that structure damage behind the far better flat-edge scores.

A non-bypass 512² CPU resolve takes 15.38–63.15 ms (median 28.06 ms,
p95 37.41 ms); zero-Amount bypass takes 0.08–0.42 ms (median 0.10 ms),
with no model/decomposition calls. This does not meet or time the app's
next-frame GPU presentation contract. All sweep records and the fabric/edge
comparison table remain in `controls.json` / `tables.md`.

Independent shifted-grid preparation uses 137px analysis cores with an
83px shift, and separately shifted 128-sensor-pixel neural tiles, rather
than merely slicing a single already-resolved frame. Worst measured
Bayer-both SDR mean/p99 is 0.0022/0.0331 ΔE00 and HDR 0.0029/0.0448 ΔE ITP;
Bayer-luma is 0.0069/0.1057 and 0.0095/0.1470. Self/tuned grids are at float
roundoff (mean about 4e-8, p99 0). All pass mean <1 / p99 <3.
AHD 768-style tiled development is separately checked against whole AHD
on the 512px synthetic scene using 128px test cores and a 16px halo: exact.

The **developed-HDR stage** is exposure-covariant at every integer stop
from −6 to +6 with correctly scaled fixed noise/pilot inputs: scaled-back
SDR/HDR mean/p99 is exactly zero for all six variants. The generic harness
also scales raw sensor inputs for Bayer; upstream [0,1] clipping saturates
those probes and produces large differences (about 40 ΔE in extreme cases).
That is a real raw-pilot limitation, not a pass for a developed-HDR neural
route. RGB pilots retain finite/negative/above-white sentinel values,
alpha and bypass; direct chroma has only 1.19e-7 constant-frame roundoff.
The inherited common display transform enforces its display cap, but this
CPU-only trial does not validate GPU agreement, the production finished-pixel
highlight ceiling, or any encoded output. No HDR contract is relaxed.

## Visual findings and variant verdicts

### Synthetic detail inspection

The review also retains 1:1 256px central crops of fabric, fine text and
stars at ISO 6400/25600, including each pilot and all six Wiener variants.
Fabric's clean tight weave becomes broad diagonal bands in both the tuned
pilot and tuned-both; Bayer's own demosaic also changes that weave. Wiener
does not restore the lost fine structure. The central fine-text crop is
mostly flat background with a column of tiny glyphs: current/tuned-both
retain more glyph form, while the Bayer pilot turns them into soft coloured
dots and Bayer-luma only partially restores their outlines. The star field
has coloured rings and a low-frequency magenta background in tuned-both,
especially at ISO 25600. Bayer-luma has less coloured speckle but broader,
softer points. None supports a claim of perfectly preserved stars/text/fabric.

### Inspected native crops

All four crop roles from both native RAWs were inspected at 1:1, with the
same display lift for every method in a row. Flat and deep-shadow rows use
+6 stops; the source locations and exact lifts are in each native JSON.
These are real noisy photographs with **no clean truth**. The automatic
"texture" selection is a bright light boundary in the Canon and sign
lettering in the Sony, not clean fabric/hair detail.

- **Canon, flat/shadow:** current default leaves coarse coloured mottling;
  tuned current and tuned-both leave fewer but conspicuous magenta/red
  specks. Tuned-both is not a night-and-day improvement over tuned current.
  Bayer-luma removes many coloured specks but keeps broad reddish clouds
  and a different shadow colour. No clean reference establishes its accuracy.
- **Canon, bright/edge:** tuned-both preserves the existing bright boundary
  without an obvious new broad halo in these crops, but residual bright/dark
  spots remain. Bayer-luma has smoother surroundings and more conspicuous
  coloured edge contours. The white display region is clipped by the common
  review transform, so this is not an HDR highlight-ceiling test.
- **Sony, flat/shadow:** tuned-both again leaves isolated coloured spots;
  Bayer-luma is much smoother but changes the dark region toward brown/grey.
  That colour change must not be counted as recovered scene information.
- **Sony, sign/edge:** tuned-both is close to tuned current on lettering.
  Bayer-luma produces thin dark/pink outlines around the red letters and a
  less grainy, more softened background. The different demosaic/chroma is
  visible even though Wiener luma uses only AHD source coefficients.
- **Later Bayer-both crops, both RAWs:** the same four roles were inspected
  at 1:1. Coloured specks are reduced substantially, but broad magenta/brown
  shadow clouds and isolated outliers remain. Sony lettering stays legible;
  its surroundings and narrow features look smoother. These no-truth crops
  cannot establish unchanged fine structure or accurate shadow colour.

### Limits, not just headline fidelity

The fidelity verdict uses **both SDR and HDR** PSNR and SSIM against current
default, not the more flattering of the two lanes. A pass needs improvement
at every ISO and at least +1 dB at 6400/25600. Baseline tuning is shown
separately; no ≥1 dB improvement over *tuned* current is claimed.

| Variant | Fidelity gate | MTF50 ≥.90 | Halo ≤2% | Coefficient safety | Verdict |
| --- | --- | --- | --- | --- | --- |
| self-both | Fail: gains <1 dB at 6400/25600; ISO1600 SSIM slightly lower | Pass 1600/6400; fail 25600 (.741) | Pass all three | Source Y/C attenuation proved | Reject: mild cleanup, insufficient gain and high-ISO sharpness |
| tuned-both | Pass all three on the reported per-ISO aggregates | Pass 1600/6400; fail 25600 (.693) | Pass all three | Source Y/C attenuation proved | Best all-ISO experiment; reject complete contract |
| Bayer-both | Fail: HDR gain only .679 dB at 6400; ISO1600 SSIM lower | Pass 1600; fail 6400/25600 (.828/.692) | Pass all three | Source Y/C attenuation proved | Reject: removes neural halos, but loses pilot-missing edges |
| self-luma | Fail: gains <1 dB at 6400/25600; SSIM lower in some lanes | Pass 1600/6400; fail 25600 (.735) | Pass all three | Source Y only; direct pilot C unqualified | Reject: weaker than self-both and saturated colour control |
| tuned-luma | Pass all three on the reported per-ISO aggregates | Pass 1600/6400; fail 25600 (.694) | Pass all three | Source Y only; direct pilot C unqualified | Reject: no useful gain over tuned-both; saturated colour control |
| Bayer-luma | Fail: worse ISO1600 fidelity and only .694 dB HDR gain at 6400 | Pass 1600/6400; fail 25600 (.863) | Fail 1600/6400 (10.63%/8.73%); pass 25600 (1.68%) | Source Y only; neural C not protected | Best high-ISO alternative; reject low/mid-ISO artefacts and high-ISO sharpness |

**Every variant also fails the all-case colour, flat-noise, texture and
colour-bleed requirements.** The following counts make that qualification
explicit rather than calling an average a universal pass. Each triple is
ISO 1600 / 6400 / 25600. Colour requires all SDR/HDR mean and p99 measures
no worse than default within that case. Texture requires every measured
band inside .85–1.15. Flat requires Y≤.50 and C≤.30 simultaneously.

| Variant | Colour cases passing /9 | Flat cases passing /9 | Texture cases passing /6 | Bleed cases passing /8 | Real crops with lower removed-edge correlation /8 |
| --- | --- | --- | --- | --- | --- |
| self-both | 7/6/5 | 6/6/5 | 2/2/0 | 4/4/4 | 1 |
| tuned-both | 7/5/5 | 8/8/7 | 2/2/0 | 3/2/4 | 1 |
| Bayer-both | 4/5/5 | 6/7/8 | 1/0/0 | 3/3/5 | 2 |
| self-luma | 4/2/3 | 4/5/3 | 2/2/0 | 4/3/3 | 2 |
| tuned-luma | 5/5/5 | 8/8/7 | 2/1/0 | 2/2/4 | 1 |
| Bayer-luma | 2/5/6 | 6/6/7 | 0/1/0 | 2/2/3 | 4 |

The real-structure proxy is the inherited **signed** correlation, not a
changed absolute-value rule. Neither a texture-ratio failure nor a lower
correlation alone proves hallucination or its absence. No skin/hair-specific
clean reference, temporal repeatability or encoded-delivery test was added.
The coefficientwise invariant is narrower than "no invented detail" after
redundant synthesis and visual display; direct chroma cannot claim it at all.

All six pass the independently shifted-grid and developed-stage exposure
probes. RGB safety sentinels pass with the float32 qualification above;
raw Bayer exposure clipping, GPU agreement, whole-app memory, installer
size, final/encoded HDR ceiling and next-frame presentation remain
**unqualified**, not waived. The native prototype's process RSS passes the
requested research guard, not the whole-app memory contract.

**Recommendation:** do not replace shipping Denoise or adopt a network on
these results. The tuned self-pilot demonstrates a modest, non-neural
coefficient-selection improvement, not the requested high-ISO noise removal
without structural damage. Direct neural chroma buys more noise removal at
the cost of exactly the colour/edge risks this trial was meant to expose.

## Validation and hand-over

Fast checks after incorporating the public-pairs code and mask regression:

- `node --test tests/*.test.js`: **1091 passed, one skipped, zero failures**.
- Guarded `.venv/bin/python -m pytest tests -q`: **3944 passed, 151 skipped,
  one xpassed, zero failures**, 275.96 s, sampled process-tree peak 2.124 GB.
- Focused pilot/harness/public-pair tests: **32 passed**. This includes 12
  pilot/half-score tests; the new pair regression corrupts a partially
  invalid 2×2 block and proves that none of it enters half-resolution scores.
- Report tooling compiles, the compact review rebuild checks every linked
  image and its size, and `git diff --check` is clean. No agreed number was
  loosened. No unrelated pre-existing test failure was encountered.

The earlier pre-pairs suite also passed (3934 passed, 151 skipped, one
xpassed). Optional neural-linear model tests remain skipped because this
task installs only the requested Bayer checkpoint. Logs retained in
`codebase/output/denoise-v1/pilot-wiener/validation/{node,python}.log`.
The figure's chart payload, literal imports and script syntax pass the
offline Visualize checker; chart rendering is separate from denoiser checks.

No GPU driver covers this CPU-only experimental adapter. The usual Electron
Library check and GPU/Proof/export tests were deliberately **not run**, as
requested; this is not a production Denoise or preview/export-parity sign-off.
No app requirements, cache allowances, source photographs or protected test
projects were modified. Neither model nor dataset is committed or bundled.
All six native source/pilot/band disk caches are automatically removed on
normal completion and on a guarded termination. Only JSON evidence and small
review crops remain; no per-run RAW copies were made.

The synthetic/native review page is 18.32 MB, with 609 linked images,
including 1:1 detail/native crops; no full-resolution exports are retained.
The public-pair review is separate (19.21 MB) and linked from that page;
each page's asset folder is below 20 MB, not their combined size. Steve can
delete the entire local `pilot-wiener/` review/evidence folder after review;
do not delete the shared corpus, dataset symlink target or another worker's
output. The checkpoint may also be removed from this worktree's ignored
candidate output after the trial is no longer needed.

Output-size check: **12.9 GB at start, 13.0 GB at completion**, below the
100 GB limit; almost all is the setup-linked `test-photos` corpus. This trial's
retained evidence is about 42 MB, with separate <20 MB review folders. Native
multi-GB disk intermediates and temporary inspection composites are removed.
