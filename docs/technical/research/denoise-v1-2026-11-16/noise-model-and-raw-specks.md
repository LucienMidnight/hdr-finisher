# Noise-model trial — November 17, 2026

## Plain-language result

**We found why the Canon noise estimate breaks, but fixing that estimate does
not fix the specks. Do not ship this candidate as a quality improvement.**
The current Denoise method and shipping controls remain unchanged.

A nearly uniform, clipped **bright** area reports zero noise and overwhelms
the numerical fit. This is not a noiseless sensor, nor proof that shadow noise
was underestimated: a later measurement already compensates with very large
noise multipliers. Restoring a sensible brightness-dependent model predicts
**less** noise in the darkest areas. On the native Canon comparisons it leaves
more ringed, worm-like grain and colour variation, not RawNIND's clean shadows.
On public pairs it changes essentially nothing. A simpler model gives tiny
average gains but loses more edge detail.

**Recommendation:** keep the diagnostic, adapters and regression tests. Treat
the fit collapse as a documented numerical defect, not a safe stand-alone
pixel change. A future repair must jointly validate the model and its band
calibration on real lifted shadows; merely replacing the solver is not enough.
No GPU port is justified by this quality result.

**Scope handoff:** Steve moved before-demosaic speck/hot-pixel processing to a
separate RAW development agent. Its already-written adapter/tests and completed
receipts were preserved in `3cdabe6d`, `8b818d38` and the profile-error handoff
`3b733b91`; work on it stopped. Historical RAW results remain in those receipts,
not in the final decision columns or this recommendation. No RAW chroma step
or shipping RAW integration was added.

## Conditions and evidence

MacBook Neo / Apple A18 Pro / 8 GB; rawpy 0.27.1 / LibRaw 0.22.1; CPU,
one native thread. Expensive runs were serial under the shared GPU lock and
unchanged 2.5 GB process-tree research guard. No production processing, GPU,
shader, export/Proof, project or cache-budget change. Setup installed CPU ONNX
runtime into the ignored venv; existing verified Bayer weights and approved
public pairs were reused, with no dataset/weight download. Private RAWs came
only from `<photosRoot>/HDR Test Images`. No photos or datasets enter Git.

Base `fdd45efd`; quality adapters `3cdabe6d`; native comparisons and clean-input
probes `8b818d38`. Receipts retain evaluated revisions. Later changes restrict
final crops to models, fix receipt selection and document outcomes; evaluated
model filtering is unchanged. Evidence under
`codebase/output/denoise-v1/noise-model-raw-specks/`:

- `audit.json`: 18-file inventory, native models/sample windows, brightness
  observations and sensor-margin diagnostics.
- `quick/results-quick.json`, `full/results-full.json`: synthetic/real windows,
  detail/colour, lifted tails and safety diagnostics.
- `heldout/results-pairs.json`, `seen/results-pairs.json`: separate public
  groups; `summary.json` rebuilds aggregates from these receipts.
- `clean-probes.json`: generated clean inputs, not an independent clean
  photographic set.
- `native-current-*.json`, `native-corrected-*.json`, `*-guard.json`: native
  CPU stages, process memory and serial execution receipts.

Brief §3 limits stay unchanged: ≥1 dB high-ISO gain, colour no worse, flat
residual Y≤.5/C≤.3, texture .85–1.15 in every band, MTF50≥.90, extra halo≤2%,
bleed no worse, perceptual seams/preview-export mean<1/p99<3. The proposed
ISO25600 MTF relaxation is **not** used. Tails are descriptive, not new pass
thresholds. Timings use the existing ±10% descriptive allowance; no UI speedup
is claimed.

## 1. Why IMG_0790's fit is degenerate

Native Canon `IMG_0790.CR2`, 3464×5202 / 18.02 MP / ISO3200, has 12 brightness
observations. Eleven contain measurable noise: darkest Y=.00124214, variance
5.84125×10⁻⁷. Brightest Y=1.25302 has 100,457 selected pixels and **57.47%
exactly zero high-pass responses**. Its lower quartile therefore reports
zero variance.

`denoise_adaptive._fit_variance` weights relative residuals by
`sqrt(count)/max(variance,1e-20)`. The zero bin weighs about 6×10¹³ times the
informative darkest bin. It dominates numerical rank; useful observations
disappear. Result: a=c=0, b=1e−20. A behavioural test reproduces the collapse
with known Poisson–Gaussian observations plus one clipped-bright bin.

Stable fitting gives a=.000306695, b=3.99389×10⁻⁷, c=0. Band-zero Y factor
changes from 49,470,350 to 1.97669 because factors compensate for model scale.
Old effective sigma is **.004947**, not 1e−10. At Y=.003, corrected effective
sigma is about .00227, **lower** than the old constant prediction. A tiny b
alone is not evidence of under-denoising.

### Corpus audit

Of 18 RAWs, 15 Bayer frames have a usable app camera bridge. Fuji X-Trans,
linear DxO DNG and DJI's missing camera matrix are explicitly excluded, not
given borrowed fits. Canon is the **only exact zero-bin collapse** among
those 15. `A7R00619.ARW` has a poorly conditioned almost-constant fit
(b=5.60×10⁻¹¹ becomes 1.87×10⁻⁸); band calibration absorbs that constant-scale
difference, not a new brightness shape. The other 13 native fits agree to
numerical precision. This does not prove all other cameras are safe.

### Why not substitute optical black or ISO?

Canon black levels are 2046/2047 DN, white 15094 DN. Its exposed margins are
mixed/contaminated: top p99≈14197/max16379, left max16373. Pooling them gives
std1092.65 DN, not credible read noise. Sony's native input exposes no usable
margin. No contaminated variance is used as a profile. ISO and black/white
alone do not determine conversion gain/read noise; a dark/flat capture series
or trustworthy camera profile is still needed.

Primary API references: [rawpy RawPy](https://letmaik.github.io/rawpy/api/rawpy.RawPy.html),
[rawpy Params](https://letmaik.github.io/rawpy/api/rawpy.Params.html),
[LibRaw data structures](https://www.libraw.org/docs/API-datastruct.html).
LibRaw `black_stat` is sums/counts, not sensor-noise calibration. Measurements
and explicit app import arguments, not newer API defaults, determine inputs.

## 2. Model variants and quality results

Own GPL-3 research in `codebase/tools/denoise_eval/candidates/noise_model_specks.py`:

- **Stable quadratic** (`factory`): discard zero-quartile/censored bins;
  scale signal/variance axes; solve nonnegative subsets of `cY²+aY+b`.
  Relative weights have a 2%-of-median variance floor; b retains a
  2%-of-minimum informative variance floor. Remeasure the same band/clumping
  calibration. Filtering and shipping controls are unchanged.
- **Poisson–Gaussian / PG** (`poisson_gaussian`): same safeguards but c=0,
  isolating removal of the quadratic term. Neither is laboratory calibration.
  With no informative bins, use the existing estimator fallback, not a
  guessed camera profile.
- **Native current/corrected** (`native_current`, `native_corrected`): reuse
  the same photograph's native-frame audit model, scaling a by exposure and
  b by exposure². Synthetic/public rows keep the crop-local current model in
  these columns; no camera fit is borrowed.

### Synthetic quick, then full

Quick: 21 generated cases + two real windows; full: 27 truth cases (nine per
ISO) + eight real windows. Zero adapter errors. Synthetic noise retains the
existing provisional Canon fits, clipped readout and binned noisy photographic
truth. No real ISO25600 clean skin/hair or lab calibration is claimed.
Controls: Amount .75 / Luminance .5 / Color Noise .75 / Detail Recovery .5;
all size controls .5. Mean PSNR dB, **SDR / HDR**:

| Method | ISO1600 | ISO6400 | ISO25600 |
| --- | ---: | ---: | ---: |
| Off | 29.04 / 32.83 | 23.13 / 26.64 | 17.29 / 20.28 |
| Current defaults | 37.12 / 41.03 | 31.43 / 35.91 | 25.08 / 30.53 |
| Stable quadratic | 37.12 / 41.03 | 31.43 / 35.91 | 25.08 / 30.52 |
| PG | 37.12 / 41.18 | 31.52 / 36.09 | 25.23 / 30.83 |
| Previous post-AHD cleanup | 37.02 / 40.81 | 31.28 / 35.78 | 25.10 / 30.53 |
| RawNIND Bayer alone | 32.95 / 38.74 | 31.26 / 36.21 | 27.98 / 32.89 |

Neither model supplies ≥1 dB improvement. PG slightly raises PSNR but lowers
ISO6400 MTF50/clean from **.820 to .773**; stable remains .820. Both miss .90;
ISO25600 current/stable are .628. Of 27 truth cases, current/stable have 16
texture-band failures, PG 15; each has four flat Y/C failures. These are
failures, not permission to relax the contract.

Clean-input probes preserve generated edge/fine text to float noise, but
**all three estimate fabric texture as noise**: clean fabric SDR PSNR19.20 dB,
finest texture-band energy ratio .00108. Stable fitting does not fix this
signal/noise ambiguity. No clean photographic native Canon reference exists
here to establish true point-detail preservation.

### Public pairs: held-out and seen separately

52 crops / 11 scenes / four cameras / ISO1600–6400. Held-out: 19 crops/four
scenes; seen-by-RawNIND-training: 33 crops/seven scenes. Weight crops within
capture, captures within scene, then scenes equally. Subjects differ; the
group difference is not itself a generalisation test. Held-out was already
used in earlier trials, not an untouched final test. Registration, gain,
clipping masks and low-ISO reference noise inherit `public-pairs.md`.

| Method | Held-out SDR / HDR PSNR | Held-out ΔE mean / p99 | Seen SDR / HDR PSNR | Seen ΔE mean / p99 |
| --- | ---: | ---: | ---: | ---: |
| Off | 27.68 / 33.32 | 7.03 / 19.43 | 29.31 / 36.42 | 5.77 / 15.70 |
| Current | 34.83 / 41.49 | 3.04 / 10.43 | 34.17 / 41.21 | 3.10 / 9.72 |
| Stable quadratic | 34.83 / 41.49 | 3.04 / 10.43 | 34.17 / 41.21 | 3.10 / 9.72 |
| PG | 34.87 / 41.52 | 3.03 / 10.38 | 34.28 / 41.29 | 3.07 / 9.63 |
| Previous cleanup | 34.89 / 41.55 | 3.01 / 10.25 | 34.19 / 41.23 | 3.08 / 9.62 |
| RawNIND Bayer | 35.07 / 42.01 | 2.98 / 12.10 | 33.93 / 41.18 | 3.55 / 14.04 |

Stable is unchanged to reported precision: these crop-local inputs do not
exhibit the native Canon collapse. PG's held-out +.04 dB is not the speck
solution. Fixed total +4-stop SDR supported held-out shadow luma p99.9:
.10639 current/stable, .10627 PG, .09480 old cleanup, .06657 RawNIND;
chroma .37911, .37954, .36667, .28323, respectively. PG marginally worsens
chroma. Support: six crops/three captures/two scenes, not all 19 crops.
Seen support: 14 crops/six captures/four scenes; current/stable luma p99.9
.06207, PG .06087. Zero adapter errors in both groups.

## 3. Crops to look at: native correction gets worse

Final PNGs/manifest are regenerated **in place** under
`codebase/output/denoise-v1/decision/`: fixed coordinates/transforms, 256×256
pixels at 1:1, no resizing. New columns: `noise_model_corrected.png`,
`native_model_current.png`, `native_model_corrected.png`; original
Off/current/post-AHD/RawNIND/clean comparisons remain. Clean is included
only where a reference exists.

Look first at **canon-dark-shadow** and **canon-flame-edge-lifted**. Compare
`native_model_current` with `native_model_corrected`, then `rawnind_bayer`.
The corrected fit turns isolated ringed specks into more extensive fine
worm-like/rimmed structure and leaves colour variation. It does not reproduce
RawNIND's smooth surroundings. `denoise_v2_app` is the crop-local default,
**not** the native-model baseline: the clipped bright bin can lie outside
its context, concealing the global-fit defect.

Native-model lifted-tail contrast proxies, not error against clean:

| Canon row | Shadow support | Native current Y / C p99.9 | Corrected Y / C p99.9 | RawNIND Y / C p99.9 |
| --- | ---: | ---: | ---: | ---: |
| Flame edge lifted | 2862 pixels | .04673 / .05443 | .16381 / .13065 | .00240 / .00499 |
| Dark shadow | 10 pixels | .00767 / .01235 | .04171 / .03308 | .00086 / .00243 |

Dark-shadow support is too small for a strong numerical claim; inspect pixels.
Real detail can count in no-truth contrast tails; fewer small islands can also
mean larger merged blotches. Do not rank on island count alone. Flame support
and the visual result contradict the proposed cleanup win. Sony wall/sign,
held-out foliage/print and synthetic fabric/fine-text/star-field remain detail
controls, not qualification of every kind of point detail.

## 4. Native CPU cost and possible shipping route

November 17, `8b818d38`; **every row: MacBook Neo A18 Pro / 8 GB, CPU one
native thread**, shared lock, bounded 768-pixel cores/66-pixel filter halos,
24-pixel AHD support. Every native output pixel is processed; no whole-photo
output/cache retained. One observation per condition:

| Input / method | RAW open to resolved pixels | Model analysis | Adaptive filter | Peak process RSS |
| --- | ---: | ---: | ---: | ---: |
| Canon 18.02 MP / current | 6.878 s | 1.737 s | 3.496 s | .662 GB |
| Canon 18.02 MP / corrected | 7.564 s | 2.002 s | 3.770 s | .666 GB |
| Sony 42.39 MP / current | 15.266 s | 1.994 s | 9.434 s | .715 GB |
| Sony 42.39 MP / corrected | 15.819 s | 2.022 s | 9.877 s | .714 GB |

Analysis includes some AHD; subclocks overlap and must not be summed. These
are research preparation costs, not action-to-screen, live controls, disk
persistence or app memory/speed qualification. Differences lie within the
descriptive ±10% allowance; no speedup claim.

If a later jointly calibrated model succeeds, prepare once into the existing
Denoise model/wavelet cache, preserving instant control algebra. Store the
same small coefficients/band factors; no new full-size planes. CPU
`denoise_adaptive.py` and GPU `denoise-measurement.js` must share censored-bin
policy, scaled nonnegative solve, weight floor, band/tail calibration,
insufficient-data fallback and exposure units. The GPU solver is separate;
this CPU research **does not certify preview/export parity**. Qualification
must use unchanged finished SDR ΔE00/HDR perceptual tolerances and exact HDR
ceiling, not per-pixel CPU equality.

This model-only step stays **after existing demosaic/highlight development**.
Opposed color and Edge colour keep their order; preserve finite negative and
above-white samples. CPU import and `library-gpu-raw.js` must each hand their
developed source to equivalent Denoise estimation, with representative
reconstruction outputs in parity tests. No new sensor pass is needed here;
RAW defect integration belongs to the separate agent. Cache identity must
invalidate if a future model algorithm changes; no budget increase proposed.
A GPU failure still gets one try then CPU fallback.

## 5. Validation, cleanup and recommendation

Twelve focused behavioural tests passed: clipped-bright collapse/recovery,
nonnegative/exposure-scaled fitting, unchanged same-shape band calibration,
finite negative/above-white RGB, exact alpha/bypass/zero Amount, native-model
scaling/no borrowed synthetic profile, plus preserved historical RAW safeguards.
RGB exposure probes −6…+6 stops pass, as do shifted-grid probes (SDR/HDR
mean/p99 within the unchanged limits); full safety diagnostics pass. These
are not GPU-preview/CPU-export tests. Historical Bayer-adapter
exposure probes can fail because the inherited DNG bridge clips; do not claim
HDR qualification from them.

Fast checks from `codebase`:

- `node --test tests/*.test.js`: **1091 passed, one skipped, zero failures**.
- `.venv/bin/python -m pytest tests -q`: **3970 passed, 150 skipped,
  one xpassed, one warning**, 276.09 s; shared lock/2.5 GB guard, exit 0.
- No GPU driver directly covers these CPU research adapters. No broad app,
  Library or release sweep substitutes for missing shipping parity coverage.

The initial 288-pixel decision set with historical RAW columns exceeded the
unchanged 13 MB cap (13,023,898 bytes); rejected, not waived. Final model-only
crops use the permitted 256-pixel 1:1 option: **8,916,075 bytes**, 12 rows,
36.238 s guard wall and 1.117 GB peak tree RSS. Obsolete RAW-column PNGs were
removed; no cap was loosened. Output-size checks passed: start 12.9 GB,
end 13.0 GB, below 100 GB (12.9 GB is the shared approved test-photo input).
Only referenced compact receipts/reviews remain; sources/prepared
public inputs are reused, not copied per run.

**Do not ship either model variant for this problem.** The original fit is
numerically wrong, but its compensated output was smoother in these shadows;
a plausible replacement is not automatically a better denoiser. This trial
neither solves specks/blotches nor establishes detail-safe calibration. Keep
current defaults and the reproducible failure. The separate RAW development
study must answer its own question: this negative model result is not a
RAW-method verdict.
