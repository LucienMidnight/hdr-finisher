# Separate colour wavelets before demosaic — November 20, 2026

## A. Research plan (written before measuring)

Signed, linear Bayer only; no new grain. Keep round one's input preparation, AHD, grades for inspection, flat patches and marked sites. Change only the filter on the prepared mosaic, after harsh-speck cleanup and highlight reconstruction. Test three channel bases and one-factor wavelet ablations on the same four RAWs before proposing any app work.

### 1. Separate brightness and colour on the mosaic

- **Independent phases (control).** Pack the four locations of a Bayer cell and wavelet-filter each with its own noise. This is the Bayer organisation in [darktable `rawdenoise`](https://github.com/darktable-org/darktable/blob/master/src/iop/rawdenoise.c), though this trial does not use its clamped square-root transform. [Akiyama, Tanaka and Okutomi (2015)](https://ieeexplore.ieee.org/document/7351714) also use four pseudo-channels for CFA denoising. This baseline has no intrinsic colour/brightness channels: filter phases independently and project the two control groups' band corrections onto complementary brightness/colour subspaces in synthesis. It tests whether doing the separation *before* thresholding matters.
- **Fixed opponent (first choice).** For white-balanced phases ordered `R,G1,G2,B`, let `L=(R+G1+G2+B)/4`, `C1=R−G`, `C2=B−G`, `Gd=G1−G2`, with `G=(G1+G2)/2`. The inverse is `G=L−(C1+C2)/4`, `R=G+C1`, `B=G+C2`, `G1,G2=G±Gd/2`; undo WB and the phase permutation on exit. [Hirakawa, Meng and Wolfe (2007)](https://statistics.fas.harvard.edu/sites/g/files/omnuum10116/files/statistics-2/files/xlm_acoustics_speech_signal_processing_2007_vol_1_597-600.pdf) show why Bayer mixes luminance and modulated chrominance and how wavelets can separate their content; a packed 2×2 transform is a cheaper approximation and can mistake within-cell edges for colour. [Danielyan et al. (2009)](https://webpages.tuni.fi/foi/papers/LNLA2009-BM3D_CFA_denoising.pdf) exploit cross-phase correlation in raw BM3D. The lesson here is to share evidence, not to run patch search in an interactive tile.
- **Noise-whitened constrained PCA (challenger).** In white-balanced units whiten at a fixed 1% neutral signal using measured phase noise. Anchor a neutral brightness axis by inverse-variance weighting; keep the green difference as a named axis. Remove its reference noise correlation from the two colour rows, whiten those rows, then rotate them to diagonalise the covariance of smoothed, frame-sampled colour. Freeze the matrix and inverse for all tiles. [Zhang et al. (2009)](https://doi.org/10.1109/TIP.2008.2011384) adapt PCA to neighbouring CFA samples; this smaller, frame-fixed variant keeps two sliders interpretable and avoids learning different transforms at tile boundaries. The whitening is exact at the reference level under the diagonal noise assumption, not at every pixel.

For every basis use `V=diag(a·max(signal,0)+b+quantisation floor)` in signed, phase-normalised units; estimate the signal with a 5×5 packed-pixel mean. For a transform matrix `A` including white balance and phase order, noise covariance is `A V Aᵀ`. Use its diagonal for marginal shrink thresholds; the opponent noise can still have cross-covariance. All three coordinate maps are invertible without clipping. Only the noise predictor uses a nonnegative signal; the filtered mosaic stays signed relative to black. The CPU harness rounds back to a sensor code for existing AHD as in round one; the shader design needs no such re-quantisation.

### 2. Wavelet, scale and shrink rule

Use five undecimated à trous levels: separable `[1,2,1]/4`, strides `1,2,4,8,16` on packed cells. Filter differences of adjacent lowpasses and retain the final lowpass. Set each band's sigma to the local propagated channel sigma times the L2 norm of the *difference* between the two cumulative 2D impulse responses (so overlapping levels are not treated as independent). This is a locally stationary noise approximation; edge-avoiding filters make the stationary gain nominal, not exact. Heavier colour weighting on the middle/coarse bands targets the 8–32 native-pixel band, not just single-pixel specks.

Compare (1) signed soft threshold (cheap reference), (2) local BayesShrink (noise variance over estimated signal standard deviation, adapting [Chang, Yu and Vetterli (2000)](https://pubmed.ncbi.nlm.nih.gov/18262991/) to 5×5 noise-normalised neighbourhood energy and bounding the threshold multiplier), and (3) local Wiener (estimate positive signal energy above the same noise floor and shrink according to its ratio to noise). Both adaptive variants use bounded neighbourhoods, not whole-tile statistics. Use direct variance weighting for all tests. The [generalised Anscombe and unbiased inverse](https://webpages.tuni.fi/foi/invansc/index.html) would be an informative phase-domain control, but the standard square-root branch has a floor where signed shadows matter; after mixing R/G/B a difference plane is not a Poisson count either. Defer it rather than silently clamp or change the comparison's shadow response. The [profiled darktable filter](https://github.com/darktable-org/darktable/blob/master/src/iop/denoiseprofile.c) and [its documentation](https://docs.darktable.org/usermanual/4.2/en/module-reference/processing-modules/denoise-profiled/) are useful precedents for measured noise and independent wavelet controls, not implementations of these Bayer transforms.

### 3. Stop colour at edges and lights

Compare plain colour à trous with the same pyramid whose taps are weighted by differences in a **fixed, lightly denoised L pilot**. The fixed guide means moving Luminance does not move the Color thresholds or outline. Use noise-aware range weights on the separable taps; this is an approximation to [Dammertz, Sewtz, Hanika and Lensch (2010)](https://highperformancegraphics.org/previous/www_2010/media/RayTracing_I/HPG2010_RayTracing_I_Dammertz.pdf) and [Hanika et al. (2011)](https://jo.dreggn.org/home/2011_atrous.pdf), with a contrast-edge precedent in the [darktable equalizer](https://docs.darktable.org/usermanual/4.0/en/module-reference/processing-modules/contrast-equalizer/). Keep the same hard RAW light guard across arms. A joint bilateral with a denoised L guide is the single-scale alternative ([Tomasi and Manduchi (1998)](https://doi.org/10.1109/ICCV.1998.710815) for the domain/range formulation), but a broad footprint costs more and gives less explicit control over the target frequency band. The guided à trous arm already tests range weighting across several scales; defer the stand-alone bilateral.

### 4. Preserve strands, lashes and fabric

Compare fixed, lighter fine-scale L weights plus a local structure-tensor gate against the same wavelets with protection off; isolate the scale-only and fine-residual return alternatives on the same opponent/Wiener arm. The gate uses both directional coherence and gradient SNR, so faint random directional noise is not automatically protected ([Weickert (1999)](https://www.mia.uni-saarland.de/weickert/Abstracts/ced-col.html)). The residual arm returns part of the first band's *removed input detail*, not generated grain. [RawTherapee's open noise controls](https://github.com/RawTherapee/RawTherapee/blob/dev/rtgui/tools/dirpyrdenoise.cc) and [wavelet implementation](https://github.com/RawTherapee/RawTherapee/blob/dev/rtengine/ipwavelet.cc) motivate separate luminance, chrominance and detail controls. Start with the fixed scales plus gate, not a third knob for recovery.

### 5. Treat the two greens separately

Strong fine-band shrink on `Gd`, but reduce it where the L gradient along the actual green-to-green diagonal rises above measured noise. A clean true edge yields a green imbalance because the two green samples are at different positions, the same Bayer sampling issue identified by the CFA literature above. Compare against the same green schedule without this directional protection, including the alternate Canon phase arrangement.

### 6. Two controls and comparison rules

Scale the L bands with **Luminance** and C1/C2/Gd with **Color**. Zero means no correction in that subspace before demosaic; it does not promise perfectly independent finished RGB after AHD. Start with thresholds expressed in measured sigma, a deliberately light L sweep setting (50% of its nominal multiplier), and a Color sweep of 0/25/50/75/100/150%. Use the same colour profile across images. Do not propose colour size unless the sweep shows a reproducible scale-specific need instead of just insufficient separation between noise and real detail.

Rank wavelet arms across both development photos at per-photo pooled brightness RMS within ±1% of Clean Grain; report unmatched cases, never count them as passes. Hold the selected method fixed on the two holdouts. Run the fixed-L Color sweep separately so no fitting can hide brightness cross-talk. For each arm also compare an explicitly lighter Standard pass, with its Amount capped at half the current default, re-measuring the early RGB noise on the same sensor-aligned fit patches where practical and leaving grain synthesis off. Use all 63 fixed marks with the round-one `>25%` **and** `>2/255` rule, ≥0.90 texture, no higher 8–32 px shadow colour and strictly finer shadow grain. For the atrium keep the fixed three anchors, measure positional centre as well as peak and core-minus-ring excess, and report against Clean Grain **and** unfiltered development. The latter distinguishes changing the light from preserving an original that Clean Grain already changed. The primary pass still uses Clean Grain.

## B. Photo tests

**No arm passed.** The wavelets consistently made shadow brightness grain finer. Doing colour and luminance separately before filtering improved some results over round one, but did not make any of the four photos clear all its screens.

### Setup and measurements

The round-one harness hash-checked the four originals (`IMG_0790.CR2`, `_DSC7970.ARW`, `DSC05622.ARW`, `DSC01212.ARW`), captured their prepared mosaics and reused the same development, marks, crop rectangles, display lifts and scoring. The 38 Canon and 25 Sony marked coordinates were taken from the previous receipts, where they were localized once on Standard, not re-centered after each treatment. The five nominal band gains are `0.80039, 0.27288, 0.11978, 0.05777, 0.02862` (packed-pixel grid). The L multipliers are `(0.65, 1.15, 2.7, 3.6, 3.6)`, the colour multipliers `(2.5, 4, 8, 12, 16)`, and the green-difference multipliers `(4.5, 4, 5, 6, 8)`, all fine-to-coarse. `Flat L` replaces the L schedule with `1.7` at each level and disables the tensor. `Scale only` keeps the fine/coarse schedule but disables the tensor; `Residual return` uses scale only and keeps 35% of the first-band correction in the picture. This is measured-input detail, not grain generation. PCA samples 64 small, uniformly spaced sensor windows and freezes its matrix per photo. At both controls zero the round-one RAW development reproduced; at nonzero controls the prototype asserted that guarded sensor values were unchanged and that each control's isolated packed-basis correction changed the other subspace by less than `2×10⁻⁶` normalized units.

Brightness matching uses pooled scene-Y RMS normalized by each reference patch, not the whole image. Hair/face/skirt are the texture hard screens; lashes, flame edges and shirt are diagnostic. Colour and grain screens include the separate check shadow where provided. Figures are not clean-reference accuracy scores: texture above 1 does not establish detail recovery, and a flat patch can contain subject structure as well as noise. Luminance strength was fitted for each method on each photo before comparison; the already-unseen holdout content did not select the method or its scale weights.

### Which building blocks helped?

`C/S/H/A` = Canon / Sony portrait / ISO 10000 holdout / atrium. “Colour” is the main shadow's 8–32 px colour RMS divided by Clean Grain (≤1 wanted); “texture” is the weaker required texture across the two development photos (≥0.90 wanted). Marks are total unique materially worse out of 63 (zero wanted). Rejected brightness matches are flagged instead of counted as quality passes. All early-only arms gave finer main and check shadow grain and missed at least the colour or light/texture screens; the full per-photo measurements retain every screen and secondary patch.

| Early method at Color 100% | Main shadow colour C/S/H/A | Worse marks | Development texture floor | Brightness match exceptions |
| --- | --- | ---: | ---: | --- |
| Independent phases + Wiener | 2.01 / 2.57 / 3.77 / 2.42 | 22 | .40 | — |
| Fixed opponent + Wiener | 1.91 / 2.60 / 3.70 / 2.55 | 23 | .57 | — |
| Whitened PCA + Wiener | 2.00 / 2.68 / 3.78 / 2.51 | 19 | .51 | — |
| Opponent + soft | 1.94 / 2.16 / 3.23 / 2.94 | 22 | .32 | — |
| **Opponent + local Bayes** | **1.78 / 1.81 / 3.18 / 2.36** | **21** | **.75** | — |
| Opponent + Wiener, guided colour | 2.61 / 4.74 / 5.24 / 2.91 | 24 | .26 | Sony +4.9% |
| Opponent + Wiener, flat L | 2.05 / 2.68 / 3.79 / 2.55 | 20 | .59 | — |
| Opponent + Wiener, scale only | 1.91 / 2.57 / 3.77 / 2.50 | 20 | .37 | — |
| Opponent + Wiener, residual return | 1.87 / 3.26 / 4.44 / 2.51 | 29 | .38 | Sony +177%, holdout +157% |
| Opponent + Wiener, no green gate | 1.89 / 2.52 / 3.69 / 2.99 | 21 | .59 | — |
| Opponent + soft, guided colour | 2.35 / 4.10 / 4.71 / 2.96 | 25 | .30 | — |
| Opponent + local Bayes, guided colour | 2.35 / 4.08 / 4.82 / 2.87 | 27 | .32 | — |

- **Basis:** Plain opponent beats phase-by-phase for the worst development texture (.57 vs .40), not on both mottling scores or marks. PCA saved four marks vs opponent/Wiener and did better on Sony hair (.73 vs .57), but Canon face lost more (.51 vs .63), and the main shadow colour was slightly worse on both. There is no measured reason to prefer the extra PCA fit.
- **Shrink:** The plain opponent/local Bayes arm retained the most worst-case texture of the brightness-matched Canon and Sony trials while also having the lowest main-shadow colour on both. It is the comparison lead, not a passing candidate. The gains based on local wavelet energy did not reliably separate noise from fine structure.
- **Edge guidance:** Guidance preserved some colour edges (Canon skirt edge projection rises from .56 to .92 for Bayes), but left more mottling across all four photos in all three paired rule comparisons. The Sony hair and holdout hair were especially poor with guided colour. An L-only direction signal does not distinguish chroma-only texture from chroma noise; this implementation is not an acceptable fix for edge bleed.
- **L and green protection:** Tensor plus scale weights preserve more fine detail than scale weights alone on the two development images (.57 vs .37 worst-case), but still fail .90, and even flat L beat the gated Wiener arm on Sony hair (.81 vs .57). The residual return could not reach the Sony brightness target. Green direction gating raises Canon face/skirt texture (.63/.80 vs .62/.78) and lowers the atrium's dark mottling (2.55× vs 2.99×); it gives up two marks overall and makes little difference to the other dark patches. It is not a proven default.

### The leading early-only result

| Photo | Pooled brightness difference | Grain, Clean → Bayes | Main shadow colour RMS ×1,000, Clean → Bayes | Required texture | Worse marks |
| --- | ---: | ---: | ---: | --- | ---: |
| Canon ISO 3200 | −0.02% | 7.95 → **4.01 px** | .124 → .221 | face .75; skirt .90 | 16/38 |
| Sony ISO 6400 | +0.19% | 14.83 → **3.93 px** | .110 → .198 | hair .84 | 5/25 |
| Sony ISO 10000 holdout | −0.07% | 13.49 → **3.86 px** | .096 → .306 | hair .05 | — |
| Atrium ISO 800 | −0.04% | 9.92 → **9.70 px** | .266 → .628 | three lights, below | — |

The three noisy photos improve on round one's colour ratios (about 2.4× / 4.4× / 5.1× → 1.78× / 1.81× / 3.18×), and the 21 worsened marks are down from 26. But the Sony shirt's texture diagnostic is .024 and the Canon skirt's colour-edge score is .56; the nominal skirt *brightness* texture pass does not mean intact fabric. The Sony's spare mid-flat is still 21% noisier than Clean Grain and its spare shadow is 38% quieter, despite the pooled fit. Do not use that fit as a claim of equal noise in every part of the picture.

**Atrium, against both references.** The protected Bayes centres have exactly the same RGB means and peak brightness as unfiltered signed development. Against Clean Grain the centroid shifts are .005/.009/.012 native px (all under .10 px, or 2% of the 5 px core radius); core-minus-ring excess differences are 0.10%/0.78%/0.61% (all under 2%). But the blue-pole peak is 4.5% lower, and the worst individual centre-channel differences are 30.6%/3.9%/15.1%. All three thus fail the conservative Clean Grain centre-value test. The comparison is not evidence that the RAW light centres moved or dimmed: Clean Grain itself changes the centre colours, notably blue. Against unfiltered development, smoothing the *ring* changes blue-pole excess by 10.6%; the other two stay within 1.4%. Fixing both centre and surrounding contrast cannot be inferred from protecting sensor samples alone.

### Color slider sweep — fixed light Luminance

Plain opponent/Bayes, Luminance held at **50% on all four photos**. Values are main-shadow 8–32 px colour RMS divided by Clean Grain. The target is **1.00× or less**, including the separate shadow check where available, while also clearing all the other screens.

| Photo | 0% | 25% | 50% | 75% | 100% | 150% | Lowest passing Color |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Canon | 25.65× | 5.31× | 2.54× | 1.89× | 1.69× | 1.59× | None |
| Sony portrait | 62.48× | 15.62× | 7.38× | 4.94× | 4.25× | 3.97× | None |
| ISO 10000 holdout | 64.78× | 15.75× | 7.36× | 5.36× | 4.85× | 4.78× | None |
| Atrium | 4.46× | 2.91× | 2.67× | 2.58× | 2.50× | 2.50× | None |

- **No minimum, even for colour alone.** No main shadow crossed 1.00×. At fixed Luminance the last step (100% → 150%) reduced the remaining mottling by about 6%, 7%, 2% and <1%, respectively. That is a plateau within this sweep, not a prediction about what unlimited smoothing would do. The median fitted C1/C2 sigma in the main dark patches (×1,000) was 7.07/4.49, 11.93/11.02, 10.63/10.48 and 1.22/1.55. This explains some absolute noise differences, but not how close the pictures got to their different Clean Grain targets: the higher-sigma portrait ends up closer than the holdout after, and even before, matching brightness. With only four photos and no passing minimum, there is no evidence for a universal default or a camera-specific slider mapping. Neither of the noisy Sony shadows nor the Canon's main shadow had guarded cells; their remaining mottling is not explained by the light guard. The atrium main shadow had 1.7% guarded cells.
- **The controls are separate on RAW but not on the picture.** With Luminance fixed, moving Color from 0% to 100% changes pooled brightness RMS vs Clean Grain from +175% to −9% on Canon and +1,484% to +360% on Sony. The ratios are large in part because Clean Grain's targets are quiet. Color changes only the designated packed planes, but after AHD those different within-cell samples can change inferred brightness. In the companion sweep which re-fits L per Color setting, the 150% points still miss at 1.69×/1.38×/3.03×/2.35×, respectively; Sony hair is .86 and three Sony marks still worsen. Very low Color could not be brightness-matched on the noisy photos even with L up to 600%. No setting passes with either protocol. Keep **two** controls for further work; a colour-size control would not solve this coupling or recover the missed detail.

### With a lighter later Standard pass

For each method at Color 100%, start with enough early L to leave about 5% brightness-noise headroom (or the closest attainable point without increasing early L beyond its standalone fit). Refit the app's RGB noise estimator on the early output using the same sampled-window layout in sensor orientation. Use today's Standard filter with `detail_recovery=.65`, `finest_noise=.40`, `coarse_noise=.65`, other bands unchanged, and refit Amount on the same flats, capped at `.375` (half the usual `.75`). No late grain. An unmatched light late pass is reported as such instead of being compared as a successful match. The first test with a fixed weaker early dose did not leave comparable headroom on the Canon and Sonys, which is why the final pairing uses the per-photo fit.

| Early method + lighter Standard | Main shadow colour C/S/H/A | Worse marks | Development texture floor | Brightness match exceptions |
| --- | --- | ---: | ---: | --- |
| Independent phases + Wiener | 1.84 / 2.30 / 3.50 / 2.56 | 19 | .41 | atrium +5.1% |
| Fixed opponent + Wiener | 1.42 / 2.29 / 3.35 / 2.62 | 19 | .60 | atrium +4.9%, selected Amount 0 |
| Whitened PCA + Wiener | 1.62 / 2.28 / 3.18 / 2.63 | 18 | .49 | atrium +5.0% |
| Opponent + soft | 1.77 / 1.98 / 2.78 / 2.82 | 18 | .34 | Sony +3.5%, holdout +1.03%, atrium +4.2% |
| **Opponent + local Bayes** | **1.64 / 1.72 / 3.06 / 2.50** | **22** | **.74** | Sony +4.8%, holdout +4.2%, atrium +5.0% |
| Opponent + Wiener, guided colour | 2.10 / 4.18 / 4.59 / 3.02 | 22 | .26 | atrium +5.0% |
| Opponent + Wiener, flat L | 1.56 / 2.15 / 3.09 / 2.64 | 17 | .57 | atrium +4.9% |
| Opponent + Wiener, scale only | 1.42 / 2.32 / 3.34 / 2.65 | 16 | .39 | atrium +5.1% |
| Opponent + Wiener, residual return | 1.63 / 1.42 / 2.01 / 2.60 | 16 | .22 | Sony +73%, holdout +61%, atrium +4.9% |
| Opponent + Wiener, no green gate | 1.41 / 2.19 / 3.35 / 3.18 | 19 | .60 | atrium +5.0% |
| Opponent + soft, guided colour | 2.16 / 3.56 / 4.00 / 2.85 | 24 | .34 | atrium +4.2% |
| Opponent + local Bayes, guided colour | 2.09 / 3.56 / 4.29 / 2.96 | 27 | .63 | atrium +4.8% |

All paired arms retain the finer shadow grain, but no pair clears the colour/texture/mark screens; no atrium pair comes within ±1% with this pairing and Amount cap. Among the matched comparisons, the round-two Bayes lead on Canon improves its mottling from 1.78× to 1.64× but still has 16 worsened marks, with face texture falling from .75 to .74. Opponent/Wiener with a late pass shows a larger Canon improvement (1.91× → 1.42×), at a worse .60 texture floor across its two development photos. The apparently better combined Sony Bayes numbers are not matched and cannot establish a win. These early candidates should neither replace the later stages nor be added ahead of them. A weaker, genuinely shadow-only early colour pass followed by a distinct late residual treatment is a future test, not a rescue proven here.

## C. WebGPU

**No round-two GPU timing or shader run.** The brief makes timing conditional on a quality pass. Running the 110% visible-region and full-frame workloads under `tools/gpu-run-lock.py` would take the shared Neo GPU without a qualifying candidate. For context only, the [different round-one filter](predemosaic-denoise.md#macbook-neo-webgpu-trial) ran at 7.4–7.7 ms warm on the 2430×1017 Canon visible core; its resident padded-tile batches took 46–70 ms for Canon and 83–84 ms for Sony. Those are not speed or memory estimates for five wavelet scales, a later Standard stage, or the complete Grade wait.

If a quality-passing variant preserves the structure of plain opponent/Bayes, the following is a **proposed**, not implemented, WGSL schedule. Use one thread per packed cell, integer `textureLoad`, separate read and write storage views, and even sensor origins. Keep signed `rgba32float` between passes; use 32-bit floats initially for both quiet negatives and variance. Reuse tile surfaces; do not allocate full-frame four-channel scratch.

| Dispatch | Read → write |
| --- | --- |
| 1 · pack, transform, variance and guard seed | Prepared signed `r32float` mosaic → `rgba32float` opponent planes and diagonal variance; `r32uint` seed. Compute phase-local mean/variance on the bounded support. |
| 2–4 · guide and gates | One fixed L pilot in `r32float`; gradient moments and horizontal seed expansion in pass 3; reduce the local tensor and green direction to `rg32float`, and finish vertical `r32uint` guard in pass 4. |
| 5–19 · five levels, three passes each | Horizontal stride taps, vertical taps with band and noise-normalised squared energy, then 5×5 energy and shrink into a ping-pong `rgba32float` correction accumulator. Reuse the previous/next lowpass, tap, band and energy scratch. Retaining the final lowpass is equivalent to subtracting accumulated removed detail from the original. Guided colour, if revived, would change both tap passes. |
| 20 · inverse and handoff | Inverse transform of corrections, protected-cell passthrough, write signed `r32float` mosaic for AHD; no early clamping or grain synthesis. |

Nominal cumulative lowpass radius is 31 packed px (62 native px). Add support for the 5×5 shrink neighbourhood and local variance/guide, taking at least 70 native px before rounding; the CPU research uses a conservative **80 native px per side for this filter**, then **12 px more for AHD**, or **158 px including a later 66 px Standard margin**, plus any lens/scale reach. On each photo all early methods gave the same primary shadow after widening that 80 px margin by 24 px. This verifies sampled CPU windows, not a general GPU seam guarantee. After a quality pass, check CPU/GPU parity and edge-only windows, then time the 110% Canon core and reused 1536-native-pixel core tiles for 5202×3464 Canon and 7968×5320 Sony full frames under the shared lock. Measure app waits separately; Grade does not yet own the mosaic.

## Evidence and reproduction

From `codebase`, run `.venv/bin/python output/predemosaic-round2-2026-11-20/study.py <canon|sony|ordinary|atrium>` serially, then the same command with `--sweep bayes`. `--late-only` refreshes paired results in an existing receipt; `--crops-only bayes` regenerates the review PNGs without a new sweep. The ignored [round-two output][output] contains `study.py`, `wavelets.py`, four `*-methods.json` receipts with per-mark scores and all flats, four `*-sweep.json` receipts with fixed and refitted L results, and the full crops. `node output/predemosaic-round2-2026-11-20/receipts.cjs bayes` prints the summaries. Clean Grain and zero-strength references were checked against round one's receipts; review PNGs are 1:1 with fixed lifts, not finished HDR exports.

Repository checks: Node 1,125 passed / 1 skipped; Python 4,316 passed / 150 skipped / 1 unexpected pass and a dependency deprecation warning. No failures. No app GPU check covers this research-only change. Scratch output finished at 15.5 GB, below the 100 GB limit.

## For Steve

- **What I tried:** separate brightness and colour in each four-pixel RAW cell, then clean them at different wavelet sizes. The simple split plus a filter that adapts to nearby texture did best overall on the Canon and Sony portrait. The more elaborate split offered no clear benefit. Edge guidance kept some colour edges but also kept more blotches. Protecting directions helped some details, not enough; the extra treatment of the two green pixels made only a small, mixed difference.
- **What it looks like:** at the same brightness noise, shadow grain went from **8.0 to 4.0 px** on Canon and **14.8 to 3.9 px** on Sony. Colour blotches were still about **1.8×** Clean Grain on both photos, **21 of 63** marks worsened, and the ISO 10000 photo lost most of the hair texture. See [Canon shadow][canon-shadow], [Canon face][canon-face], [Sony hair][sony-hair], [ISO 10000 hair][holdout-hair] and [atrium lights][lights].
- **What the Color control showed:** the photos responded differently, but none was clean enough at any tested setting, even 150%. Turning it up also changed how bright the grain looked after RAW development. Keep two controls in research; do not add a size control or set a shipping default from this result. Compare [Canon Color sweep][canon-sweep] and [Sony Color sweep][sony-sweep].
- **Speed:** there is no new GPU number because nothing passed. Round one's different filter took about 7.5 ms for the Canon visible area; it doesn't tell us how fast this new filter would be in Grade.
- **Next step:** keep today's Denoise. If we try again, limit early colour cleanup to confidently quiet shadows and keep it away from hair, fabric and the surroundings of small lights. Compare it to the [earlier shadow-only late treatment](grain-size-and-colour.md) first. Only time or wire up a new route after it passes the photo checks.

[output]: ../../../../codebase/output/predemosaic-round2-2026-11-20/
[canon-shadow]: ../../../../codebase/output/predemosaic-round2-2026-11-20/crops/canon-background.png
[canon-face]: ../../../../codebase/output/predemosaic-round2-2026-11-20/crops/canon-face.png
[sony-hair]: ../../../../codebase/output/predemosaic-round2-2026-11-20/crops/sony-hair.png
[holdout-hair]: ../../../../codebase/output/predemosaic-round2-2026-11-20/crops/ordinary-hair.png
[lights]: ../../../../codebase/output/predemosaic-round2-2026-11-20/crops/atrium-blue-pole-light.png
[canon-sweep]: ../../../../codebase/output/predemosaic-round2-2026-11-20/crops/canon-colour-sweep.png
[sony-sweep]: ../../../../codebase/output/predemosaic-round2-2026-11-20/crops/sony-colour-sweep.png
