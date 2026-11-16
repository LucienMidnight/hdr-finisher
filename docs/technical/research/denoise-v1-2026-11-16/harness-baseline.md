# Denoise v1 harness baseline

## Baseline (current Denoise)

November 16, 2026. MacBook Neo, A18 Pro, 8 GB; offline CPU, one native thread,
no Electron/GPU. The app is unchanged. `off` is plain AHD development;
`denoise_v2` is `adaptive-atrous-v1` with every `AdaptiveControls` value at 0.5.
Both see the same sensor input and fixed display transforms. This establishes
a comparison baseline, not approval of a replacement or of the proposed limits.

Quick: **13.9 s**, **0.82 GB peak process RAM**, 23 cases.
Full: **38.6 s**, **1.14 GB peak**, 35 cases. Includes inventory, calibration,
quality metrics, tile/exposure/safety probes and review writing. Timing noise
allowance ±10%; full runs varied 38.6–48.5 s on the shared Mac, outside that
band. These are descriptive tool timings, not a regression comparison. The
quick budget is 120 seconds, memory limit 2.5 GB. These are
harness times, not whole-app preparation times. Baseline app code: `0ba5593fc27249c3f09fb370108d8106e99936ff`.

Full-set arithmetic means of per-scene metrics, nine synthetic scenes per ISO:

| ISO equivalent | SDR PSNR dB, off → current | HDR PSNR dB, off → current | SDR SSIM, off → current | HDR SSIM, off → current |
| --- | --- | --- | --- | --- |
| 1600 | 29.04 → 35.41 | 32.83 → 40.06 | 0.673 → 0.890 | 0.767 → 0.939 |
| 6400 | 23.13 → 29.92 | 26.64 → 34.87 | 0.448 → 0.806 | 0.581 → 0.902 |
| 25600 | 17.29 → 23.85 | 20.28 → 29.23 | 0.221 → 0.626 | 0.340 → 0.797 |

Quick has smaller charts and excludes photographic synthetic truth; its numbers
are a separate baseline, not a timing or quality comparison with full:

| ISO equivalent | SDR PSNR dB, off → current | HDR PSNR dB, off → current |
| --- | --- | --- |
| 1600 | 29.51 → 32.34 | 32.75 → 35.24 |
| 6400 | 23.78 → 27.60 | 27.13 → 31.18 |
| 25600 | 17.62 → 21.99 | 21.03 → 26.83 |

The full slanted edge retains **99.5%, 91.6%, 73.7%** of clean MTF50 at the
three ISO levels. The highest ISO misses the proposed 90% sharpness target.
Extra halo is below 0.9% of edge height in these three cases. Median flat-patch
luma residual is 23.1% / 25.0% / 31.4% of noisy; chroma is 30.3% / 29.8% /
33.5%, so the proposed 30% chroma limit is not met at every level. Per-band
energy also falls outside 0.85–1.15 on several targets: cleaner does not mean
all texture survives. These are baseline limitations, not harness failures.

Full tile-shift differences are zero at reported perceptual precision (whole
comparison mean below 3e-9 ΔE2000). Re-prepared −6…+6 stop probes have zero
finished-pixel difference. Finite output, negative/above-white retention and
exact alpha/bypass pass. The fixed 1000-nit display cap passes; this is not
production delivery validation. CPU/GPU comparison is deliberately unavailable.

## Corpus and selections

| RAW | ISO | Camera |
| --- | --- | --- |
| `2025_0730_1331_3.arw` | 4000 | SONY ILCE-7RM3 |
| `A7R00619.ARW` | 500 | SONY ILCE-7RM3A |
| `DJI_0071-2.DNG` | 100 | DJI FC3170 |
| `DSC00264.ARW` | 800 | SONY ILCE-7RM3 |
| `DSC00950.ARW` | 50 | SONY ILCE-7R |
| `DSC01212.ARW` | 800 | SONY ILCE-7RM3 |
| `DSC04375.ARW` | 100 | SONY ILCE-7RM3 |
| `DSC04375_DxO-optical-corr-only.dng` | 100 | SONY ILCE-7RM3 |
| `DSC06615.ARW` | 100 | SONY ILCE-7RM3 |
| `DSCF6495.RAF` | 3200 | FUJIFILM X-E2S |
| `DSC_3931.NEF` | 360 | NIKON CORPORATION NIKON D7500 |
| `IMG_0114.CR2` | 100 | Canon Canon EOS 60D |
| `IMG_0790.CR2` | 3200 | Canon Canon EOS 60D |
| `IMG_3129.CR2` | 100 | Canon Canon EOS 700D |
| `IMG_7723.CR3` | 100 | Canon Canon EOS Rebel T8i |
| `Leica-X2-L1021324.DNG` | 100 | LEICA CAMERA AG LEICA X2 |
| `P1010004.ORF` | 800 | OLYMPUS IMAGING CORP. E-P5 |
| `P1150601.RW2` | 200 | Panasonic DMC-GX8 |

All 18 RAWs are inventoried. Fuji is X-Trans (no Bayer calibration); the DxO
DNG is linear. DJI has Bayer data but no usable camera matrix for the app’s
camera-linear bridge, so it is excluded from development comparisons and named
in JSON. No camera matrix is guessed.

Generated charts use the Canon EOS 60D response and the `IMG_0790.CR2` ISO-3200
noise fit: among high-ISO Bayer samples, it has positive shot/read terms in
all four positions and the strongest worst-channel fit. The Sony ISO-4000
frame is noisier by ISO but its single-frame read term is unidentified.

Low-ISO synthetic scenes: `DSC00950.ARW` (ISO 50) and `DSC04375.ARW` (ISO 100),
central 1024 px raw crops, same-CFA 2×2 binning and remosaicing to 512 px.
Noise uses the highest-ISO fit of the same camera model. Real inputs:
`2025_0730_1331_3.arw` (ISO 4000, highest Bayer ISO) and `IMG_0790.CR2`
(ISO 3200, darkest remaining surveyed source). Full takes distinct flat,
fabric/texture, edge and shadow windows from each 3×3 grid; quick takes the
first file’s flat crop and second file’s shadow crop. Every exact coordinate,
mask recipe and exposure lift is in the JSON. Lifts are at most +6 stops.
No external pairs were used or downloaded.

## Provisional sensor fits

`variance = a × signal + b` after black/white normalisation, separately for
four CFA positions (top-left, top-right, bottom-left, bottom-right). Shown below:
highest-ISO Bayer shot per camera; exact values, signal ranges, fit R² and all
other shot fits are in both JSON files. A zero constrained coefficient means
**unidentified in this single frame**, not an absence of shot/read noise.
Optical-black samples are recorded where accessible but never treated as a
calibrated dark frame.

| Camera / fit source ISO | a, four CFA positions | b, four CFA positions |
| --- | --- | --- |
| Canon Canon EOS 60D / `IMG_0790.CR2` ISO 3200 | 0.000987, 0.000932, 0.000988, 0.000963 | 7.23e-06, 7.54e-06, 7.67e-06, 8.08e-06 |
| Canon Canon EOS 700D / `IMG_3129.CR2` ISO 100 | 6.39e-05, 4.33e-05, 4.38e-05, 4.31e-05 | 1.15e-06, 2.74e-06, 2.46e-06, 8.94e-07 |
| Canon Canon EOS Rebel T8i / `IMG_7723.CR3` ISO 100 | 3.95e-05, 3.29e-05, 3.23e-05, 6.03e-05 | 4.07e-06, 1.22e-05, 1.25e-05, 7.78e-07 |
| DJI FC3170 / `DJI_0071-2.DNG` ISO 100 | 0.000114, 0.00025, 0.000236, 0.000224 | 7.63e-07, 0, 2.05e-06, 0 |
| LEICA CAMERA AG LEICA X2 / `Leica-X2-L1021324.DNG` ISO 100 | 3.12e-05, 3.35e-05, 3.39e-05, 3.05e-05 | 4.89e-08, 3.61e-08, 3.27e-08, 5.3e-08 |
| NIKON CORPORATION NIKON D7500 / `DSC_3931.NEF` ISO 360 | 7.5e-05, 6.33e-05, 6.37e-05, 7.54e-05 | 9.64e-07, 2.95e-06, 2.81e-06, 1.52e-06 |
| OLYMPUS IMAGING CORP. E-P5 / `P1010004.ORF` ISO 800 | 0.00015, 0.000154, 0.000156, 0.000151 | 1.22e-07, 1.08e-07, 3.39e-08, 1.59e-07 |
| Panasonic DMC-GX8 / `P1150601.RW2` ISO 200 | 0.00631, 0.0014, 0.00431, 0.00634 | 0, 0, 0, 0 |
| SONY ILCE-7R / `DSC00950.ARW` ISO 50 | 2.1e-05, 2.15e-05, 2.17e-05, 2.11e-05 | 0, 0, 0, 0 |
| SONY ILCE-7RM3 / `2025_0730_1331_3.arw` ISO 4000 | 0.00332, 0.0107, 0.00798, 0.00629 | 0, 0, 0, 0 |
| SONY ILCE-7RM3A / `A7R00619.ARW` ISO 500 | 0.000107, 0, 0, 6.32e-05 | 5.35e-06, 5.26e-05, 5.2e-05, 1.68e-05 |

Single-image texture can inflate variance; some lower-ISO profiles are poorly
identified. ISO extrapolation assumes a scales linearly and b quadratically;
dual-gain transitions are unknown. Binned truth still contains source noise.
Negative sensor noise is clipped by the shared sensor/AHD readout (fractions
are recorded; near-black targets can approach 50%). The resulting numbers
are fair comparisons on these fixed simulations, not laboratory camera
profiles or a claim about measured ISO-25600 photographs.

## Reproduce and inspect

Run commands, adapter interface and metric definitions:
[`codebase/tools/denoise_eval/README.md`](../../../../codebase/tools/denoise_eval/README.md).
Local retained evidence (regenerated in place; not committed):

- [`review/index.html`](../../../../codebase/output/denoise-v1/review/index.html): full-run noisy/truth/adapter crops, all using one SDR transform.
- [`results-quick.json`](../../../../codebase/output/denoise-v1/results-quick.json) and [`results-full.json`](../../../../codebase/output/denoise-v1/results-full.json): all measurements, fits, ISO inventory, crop provenance and controls.

Harness commit: `da0d5acee1f1958c1d98a5f6cb85452632a2d627`. Node fast suite:
1,091 pass / one skip. Python fast suite: 3,905 pass / 144 skips / one existing
xpass; 11 harness checks pass. Both completed runs have zero adapter errors;
review is 15.2 MB and every local asset link resolves. No Electron/GPU check
applies to CPU-only tooling. No production files or read-only projects changed.
Scratch output ended at 13.0 GB (100 GB limit); transient run logs/probe files
were removed, retaining only the two JSON results and the linked review assets.
