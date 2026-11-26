# Demosaic noise research — November 17, 2026

## Plain-language result

**These demosaic changes do not fix the dark pits. Do not ship them as the
solution.** A softer interpolation changes the specks, and the directional
MMSE trial improves average held-out picture scores, but the Canon shadow
still has obvious dark centres with coloured/light rims. Light sensor-plane
smoothing makes this particular problem worse after current Denoise, even
though it reduces the noise before Denoise. Combining the two does not help.

Bilinear interpolation also loses clean edge/text detail. The directional
trial avoids that particular blur, but its clean fabric result and coloured
fine-detail artifacts do not establish a safe universal replacement. Keep
signed RAW development and the shipping controls; keep the calibration
repair's separate flame benefit. No new automatic ISO/noise switch is earned.

This is a negative result for **the implementations measured here**, not for
every classical demosaicer. In particular, the `lmmse` column is our own
linear-MMSE-style experiment, **not RawTherapee's complete LMMSE**. Actual
upstream LMMSE/IGV, RCD, PPG and VNG were not ported or measured. If further
classical work is wanted, a faithful signed upstream LMMSE trial remains a
reasonable separate experiment; do not present this report as rejecting it.

## Pre-measurement contract

Signed AHD development of both noisy and clean Bayer is the primary baseline.
Keep shipping Denoise controls, frozen seed/inventory, inherited masks and the
dark-noise report's fixed signed-AHD shadow support. Run every variant with and
without the informative-calibration repair. RawNIND Bayer runs alone.

Compare signed bilinear interpolation, an independently written directional
linear-MMSE-style colour-difference trial, light variance-stabilised per-CFA
Wiener smoothing followed by AHD, and smoothing plus the directional trial.
The directional trial is **not RawTherapee LMMSE** and is not evidence that
upstream LMMSE, RCD, PPG or VNG cannot help. No upstream implementation copied.
The smoothing strength .65 is fixed before looking at held-out pair results.

Use inherited ±10% descriptive CPU timing allowance: these are single-thread
minimum-Mac research costs, not live action-to-screen times. Quality/tail
numbers are diagnostic, not new relaxed acceptance limits. Finished CPU/GPU
SDR ΔE2000 and HDR ΔE ITP must have mean <1, p99 <3 if integrated; this CPU
experiment does not claim to measure that agreement. Preserve the exact
finished HDR ceiling; fixed display clipping alone cannot qualify delivery.

Prioritize quick synthetic, Canon decision crops and held-out pairs. Do not
exceed approximately 90 minutes of heavy computation; report omissions.

## What was measured

- MacBook Neo, Apple A18 Pro, 8 GB unified memory, one CPU/native thread.
  Every heavy evaluation and both complete fast suites use the shared
  `tools/gpu-run-lock.py`; evaluation trees have the inherited 2.5 GB guard.
  They run serially, including while another agent works on production RAW.
- App version 0.9.3, initial HEAD `e440bfc7`; Git fetched first, no missing
  `origin/main` commits. This research branch has no upstream configured.
  Frozen inventory comes from the preceding dark-noise signed-full receipt,
  SHA-256 recorded in each receipt. No recalibration, new seed or winning
  crop selection. Inputs are the approved test-photo folder and previously
  prepared, approved public pair/model stores, linked rather than copied.
- Quick: 21 clean-reference synthetic cases plus two private crops. Full:
  27 clean-reference synthetic/binned-RAW cases plus eight private crops.
  Held-out: 19 crops, six captures, four scenes. Seen by RawNIND: 33 crops,
  13 captures, seven scenes, reported separately. Pair means weight crops
  within capture, captures within scene, then scenes equally.
- Signed AHD is the inherited research adapter, not the other agent's
  unfinished shipping implementation. Both noisy and clean Bayer develop
  signed; frozen masks and capture-global alignment/gains are unchanged.
  Synthetic below-black noise is regenerated from the original seed and
  re-clipping must exactly reproduce the frozen noisy Bayer. Private RAWs
  have no clean ground truth; public clean RAW retains capture/alignment noise.
- Filter the unlifted image, then apply each decision row's fixed lift.
  Metrics are the existing fixed SDR/sRGB and 1000-nit-capped HDR/PQ
  presentations. RawNIND Bayer runs alone, with its existing hash-verified
  checkpoint and documented negative-sensor clipping; not followed by Denoise.
  No new network, checkpoint, sensor-calibration dataset or app dependency.

### Independent adapters and attribution

`candidates/demosaic_noise.py` contains four comparisons, each followed by
unchanged current Denoise and separately by current Denoise with the existing
`dark_noise` informative-calibration repair:

1. **Bilinear:** signed normalized same-colour convolution; measured sites
   are preserved exactly. No homogeneity/direction choice or RGB correction.
2. **Directional MMSE (`lmmse` in receipts):** horizontal/vertical green-minus-
   sampled-colour estimates, five-tap binomial pilot, nine-sample directional
   signal/residual statistics, local linear MMSE shrinkage, inverse-variance
   fusion, then bilinear colour-difference reconstruction. Measured sites
   remain exact. No gamma, range clipping, median enhancement or EECI passes.
3. **RAW .65 + AHD:** process the four CFA positions independently, including
   separate greens. Use the inherited provisional per-plane shot/read model.
   Above black, use `2*x/(sqrt(a*x+b)+sqrt(b))`; below black, continue linearly
   as `x/sqrt(b)`. This transform is monotonic, signed and invertible. In that
   approximate unit-noise domain, attenuate the single 3×3 binomial high-pass
   band using a 5×5 local Wiener energy estimate, fixed strength .65; inverse
   transform, signed AHD, current Denoise. This is light RAW NR, **not** a
   defect detector or replacement of rare sensor samples by a median.
4. **RAW .65 + MMSE:** the same independent sensor-plane step, followed by
   the directional trial. Denoise first-band settings are not secretly reduced
   or increased. Since the primary case worsens rather than over-smooths,
   reducing downstream first-band strength is not a demonstrated rescue.

All code is independently written within this GPL-3 repository. Generic local
linear-MMSE ideas were checked against the GPL-3.0-or-later RawTherapee-derived
`librtprocess` LMMSE source by Gabor Horvath and contributors, pinned at
`9a858270acb2096e2e403d932760ee688fcac425`. No upstream source was vendored or
represented as ported. Its gamma LUT and several nonnegative clamps make
calling it on signed samples unchanged inappropriate; a black pedestal is
already disqualified by the signed-shadow research. No non-commercial code.

Primary references, checked November 17, 2026:

- [RawTherapee's demosaic documentation](https://github.com/RawTherapee/RawPedia/blob/master/content/Demosaicing/index.md)
  recommends LMMSE/IGV with Noise Reduction for very noisy/high-ISO input.
- [Pinned GPL-3-or-later LMMSE implementation](https://github.com/CarVac/librtprocess/blob/9a858270acb2096e2e403d932760ee688fcac425/src/demosaic/lmmse.cc)
  is the attribution/design reference, not this experiment's implementation.
- [darktable's demosaic manual](https://docs.darktable.org/usermanual/development/en/module-reference/processing-modules/demosaic/)
  likewise distinguishes noisy-image LMMSE from overshoot-prone alternatives.
- Prior local GALOSH RAW and darktable profiled-wavelet results and licensing:
  [classical-prototypes.md](classical-prototypes.md). Neither previous adapter
  is relabelled or assumed to work on signed data here.

## Diagnosis: demosaic changes the pattern, not the whole cause

The same-CFA noise is already extreme. Keeping every measured photosite
means even bilinear interpolation can propagate large sensor excursions.
Removing AHD's hard direction/homogeneity choice therefore does **not** remove
all compact noisy energy. This trial supports demosaic dependence, but not
the stronger claim that AHD's decisions are the sole cause of the pits.

On the fixed 288px Canon shadow support, before Denoise, the lifted local-
median luma residual p99.9 is .36003 for AHD, .30428 for bilinear, .34062 for
the MMSE trial, .31888 for RAW .65 + AHD, and .28957 for RAW .65 + MMSE.
Those are noise-pattern measurements, not detail-preservation verdicts.

After Denoise, the light RAW step is worse, not better: .16275 → .19059
with AHD, and .14336 → .20941 with MMSE. Lower ordinary grain is therefore
not enough. Re-estimation and changed noise correlation leave rare energetic
components disproportionately visible. The upstream RAW Wiener step itself
also protects locally energetic samples; it is not a robust outlier cure.
This explanation is consistent with the retained pixels/models, not proof
that a different robust RAW or joint demosaic/denoise algorithm must fail.

### Canon dark shadow: the deciding crop

Same signed-AHD support, unlifted filtering, +4-stop display. The tail is
**a visibility proxy, not clean truth or an agreed pass threshold**. Dark/
bright islands count connected 1–25px residual components beyond ±.05.

| Method, followed by current Denoise unless Off | Luma p99.9 | Chroma p99.9 | Dark / bright islands |
| --- | ---: | ---: | ---: |
| Signed Off | .36003 | .63314 | 2979 / 3049 |
| Signed AHD current | .16275 | .18805 | 144 / 110 |
| Signed AHD current + calibration repair | .16275 | .18805 | 144 / 110 |
| Bilinear | .15467 | .21123 | 112 / 73 |
| Bilinear + repair | .15467 | .21123 | 112 / 73 |
| Directional MMSE trial | .14336 | .15201 | 122 / 72 |
| MMSE + repair | .14336 | .15201 | 122 / 72 |
| RAW .65 + AHD | .19059 | .24172 | 208 / 167 |
| RAW .65 + AHD + repair | .19059 | .24172 | 208 / 167 |
| RAW .65 + MMSE | .20941 | .23496 | 430 / 369 |
| RAW .65 + MMSE + repair | .20941 | .23496 | 430 / 369 |
| RawNIND Bayer alone | .01373 | .01628 | 0 / 1 |

The MMSE trial trims the luma tail by about 12%, not the order-of-magnitude
visual change provided by RawNIND here. Bilinear's slightly smaller luma
tail accompanies **larger chroma tails**. Inspection of the native-pixel
PNGs confirms conspicuous ringed specks in all four classical variants.

The flame is still a separate calibration problem. At the same fixed lifted
flame-edge crop, signed AHD current .38288 becomes .07564 with the repair.
Bilinear is .30288 → .07820; MMSE .37395 → .22942; RAW+AHD .33984 → .14832;
RAW+MMSE .33441 → .33441. RawNIND alone is .00939. Changing interpolation
also changes the model/calibration behaviour; it does not obsolete that bug.

## Broader quality and clean detail

### Held-out public pairs

Equal-scene means; higher PSNR/SSIM is better. The gradient ratio is relative
to clean, and can contain residual noise, so it is not a pure sharpness score.

| Method | SDR PSNR dB | SDR SSIM | Edge gradient energy / clean |
| --- | ---: | ---: | ---: |
| Signed Off | 27.685 | .5905 | 1.789 |
| Signed AHD current | 34.907 | .8859 | .709 |
| AHD + repair | 34.922 | .8868 | .708 |
| Bilinear | 34.923 | .8924 | .644 |
| Bilinear + repair | 34.921 | .8924 | .644 |
| MMSE trial | 35.484 | .9018 | .686 |
| MMSE + repair | 35.484 | .9019 | .685 |
| RAW .65 + AHD | 35.138 | .8892 | .729 |
| RAW .65 + AHD + repair | 35.173 | .8915 | .723 |
| RAW .65 + MMSE | 35.558 | .9014 | .714 |
| RAW .65 + MMSE + repair | 35.559 | .9014 | .714 |
| RawNIND Bayer alone | 35.066 | .8958 | .799 |

The MMSE gains on this independent split are real measurements, not grounds
for claiming the original Canon defect fixed. RawNIND's much cleaner Canon
shadow likewise does not establish universal superiority on synthetic charts
or these noisy, registered low-ISO references.

### Synthetic full, seen pairs, MTF/halo/bleed/texture and safety

Full includes 27 clean-reference cases (seven generated targets and two binned
RAW scenes, each at three noise levels) and eight private crops without clean
truth. The full PSNR/SSIM means below include only the 27 reference cases;
private pictures are inspected and have noise/tail diagnostics, not invented
reference scores. Seen-pair results are separate equal-scene means, **not
held-out RawNIND validation**. The repair is measured for every method even
where the rounded result is unchanged.

| Method | Full SDR PSNR / SSIM | Seen-pair SDR PSNR / SSIM |
| --- | ---: | ---: |
| Signed Off | 23.163 / .4482 | 29.315 / .6998 |
| Signed AHD current | 33.161 / .8652 | 34.167 / .8672 |
| AHD + repair | 33.161 / .8652 | 34.167 / .8672 |
| Bilinear | 32.678 / .8647 | 34.019 / .8663 |
| Bilinear + repair | 32.678 / .8647 | 34.019 / .8663 |
| MMSE trial | 33.804 / .8677 | 34.536 / .8721 |
| MMSE + repair | 33.804 / .8677 | 34.536 / .8721 |
| RAW .65 + AHD | 33.736 / .8559 | 34.391 / .8652 |
| RAW .65 + AHD + repair | 33.736 / .8559 | 34.385 / .8652 |
| RAW .65 + MMSE | 33.286 / .8508 | 34.720 / .8727 |
| RAW .65 + MMSE + repair | 33.286 / .8508 | 34.719 / .8727 |
| RawNIND Bayer alone | 30.741 / .8360 | 33.925 / .8670 |

Held-out HDR clean-reference error (mean / mean of crop p99s, ΔE ITP) is
6.967 / 24.322 for current AHD, 6.719 / 24.379 bilinear, 6.497 / 23.130
MMSE, 6.830 / 23.971 RAW+AHD, 6.484 / 22.776 RAW+MMSE, and
6.522 / 25.968 RawNIND. These are **noisy-versus-clean errors, not CPU/GPU
agreement or a newly accepted tolerance**. The full generated/binned set also
shows mixed HDR changes: bilinear lowers mean error (10.985 → 8.870), yet its
average crop p99 worsens (50.109 → 61.959). MMSE is 9.478 / 54.338.
The JSON preserves SDR ΔE2000, HDR ΔE ITP, half-resolution results and all
repair comparisons. Aggregate PSNR gains alone are not enough to choose a
Canon shadow fix.

Detail diagnostics explain why. Slanted-edge MTF50 at ISO 1600 / 6400 /
25600 and the largest extra halo fraction across those levels are:

| Method | MTF50, cycles/pixel | Largest extra halo fraction |
| --- | ---: | ---: |
| Current AHD | .2101 / .1690 / .1396 | .00266 |
| Bilinear | .1594 / .1507 / .1221 | .00084 |
| MMSE trial | .2166 / .1720 / .1395 | .00468 |
| RAW+AHD | .2156 / .1804 / .1293 | .00278 |
| RAW+MMSE | .2144 / .1873 / .1361 | .00651 |
| RawNIND Bayer alone | .1843 / .1801 / .1791 | .08964 |

Held-out colour-bleed p99, averaged by scene, is .1097 current, .1142 bilinear,
.0978 MMSE, .1041 RAW+AHD, .0952 RAW+MMSE and .1226 RawNIND (smaller is better;
this is the harness's colour-bleed proxy, not ΔE). Repair versions and scene
support counts remain in `heldout.json`.

For the ISO-6400 fabric, texture energy / signed clean energy at Gaussian
band scales .5 / 1 / 2 / 4 pixels is:

| Method | Four texture energy ratios | Four residual / clean energy ratios |
| --- | ---: | ---: |
| Current AHD | .0011 / .0214 / .0863 / .0869 | .9851 / .8545 / .5336 / .5354 |
| Bilinear | .0015 / .0408 / .2173 / .2219 | .9750 / .7768 / .3013 / .3004 |
| MMSE trial | .0009 / .0173 / .0630 / .0627 | .9875 / .8734 / .5962 / .5982 |
| RAW+AHD | .0011 / .0235 / .1004 / .1016 | .9836 / .8432 / .4980 / .4996 |
| RAW+MMSE | .0010 / .0195 / .0766 / .0768 | .9858 / .8606 / .5547 / .5564 |
| RawNIND Bayer alone | .0063 / .1928 / 1.1251 / 1.1440 | .9466 / .5959 / .0173 / .0190 |

The first two fine bands are badly suppressed by all methods on this difficult
target. Energy can contain noise or false texture; it is not a retained-detail
percentage. Residual energy includes missing detail, not just invented detail.
The independent clean comparison below is needed because the signed-AHD clean
reference itself contains demosaic artifacts.

Noisy fine-text mean PSNR across the three ISOs is 26.597 current, 19.179
bilinear, 24.016 MMSE, 27.232 RAW+AHD and 24.139 RAW+MMSE. Star-field SSIM
is .8305, .8808, .8217, .7905 and .7642 respectively. Cleaner-looking star
backgrounds must not be mistaken for preserved point lights. RawNIND scores
19.625 dB text and .6617 star SSIM on these synthetic targets despite its
decisively better Canon shadow. These artificial charts do not represent its
photographic training distribution.

The exposure probe tests every integer stop from −6 through +6 for current,
repair, and all eight trial variants: 130 outputs, all finite. Dividing by
the applied exposure gives zero measured SDR/HDR perceptual difference from
the corresponding zero-stop output. Exposure is applied after signed sensor
development (WB/matrix), before Denoise; Bayer, the RAW noise profile and
sensor saturation do not change. Thus this tests the filter's power-of-two
exposure equivariance, **not demosaic response to differently exposed or
saturated sensors**. All fixed HDR/PQ presentations stay within the harness's
1000-nit clamp, by construction. Neither production HDR highlight safety nor
real GPU RAW parity was measured. RawNIND is not included in this filter
equivariance probe; its separate existing exposure limitations are unchanged.

### Clean input: do not choose a universal default from noisy scores

Nine 512px clean mosaics are compared separately: seven generated targets and
two binned low-ISO RAW scenes. Score against signed AHD **and**, for generated
targets, the independent analytic RGB scene after the same camera-gamut clip.
This avoids treating AHD's own artifacts as ideal demosaic truth. RAW smoothing
keeps the fixed simulated ISO-1600 profile in this stress test; it is not a
measured low-ISO camera-calibrated noise profile.

| Clean target, independent analytic reference | AHD PSNR | Bilinear | MMSE trial | RAW+AHD | RAW+MMSE |
| --- | ---: | ---: | ---: | ---: | ---: |
| Fine text | 23.308 | 20.241 | 25.082 | 23.298 | 25.088 |
| Siemens star | 32.018 | 32.857 | 32.229 | 32.146 | 32.371 |
| Fabric | 22.439 | 27.151 | 21.890 | 22.592 | 22.041 |

Bilinear's clean slanted-edge MTF50 is .17566 versus AHD .21098, a roughly
17% loss; the analytic target is .19732. Its fine-text PSNR falls about 3 dB.
Better fabric/star PSNR does not cancel that loss. The MMSE trial retains
edge MTF50 (.21083), but extra halo fraction is .00897 versus AHD .00694;
fabric PSNR falls .55 dB. Fine-text analytic PSNR improves, so the clean result
is mixed, not a blanket claim of detail loss everywhere. No universal
zipper/maze-free guarantee is established by seven synthetic scenes and two
binned RAWs. No new acceptance tolerance is invented to call these passes.

Visual inspection of the clean native-pixel PNGs agrees with the mixed scores:
bilinear badly damages the small letters; MMSE letters remain legible but have
coloured fringes, also present with AHD. Fabric shows coloured high-frequency
interference with both AHD and MMSE. These are not artifact-free global
defaults. There is no measured noise threshold that establishes a safe switch;
in particular, the clean stress test is not low-ISO sensor calibration.

## Crops to look at

The small local page is
`codebase/output/denoise-v1/demosaic-noise/decision/index.html`.
It has the inherited twelve rows and thirteen labelled columns, 288 native
pixels per crop, no enlarged/smoothed export or auto contrast. `_fix` means
the informative-calibration repair. Exactly identical PNGs share one file;
every displayed column remains present, and the manifest maps its image name.

1. **canon-dark-shadow:** current versus MMSE/bilinear versus both RAW steps,
   then RawNIND alone. The coloured rims remain; the RAW combinations add them.
2. **canon-flame-edge-lifted:** the repair helps AHD much more than changing
   demosaic alone. Do not confuse this with the separate dark-shadow failure.
3. **heldout-print-dots** and **sony-sign-lettering:** distinguish actual tiny
   marks from noise. Private Sony has no clean truth; use held-out clean too.
4. **synthetic-fine-text**, **synthetic-star-field**, **synthetic-fabric:** inspect
   coloured edges, tiny point lights and false/removed texture, not only PSNR.

`pre-denoise/` holds the three Canon rows before Denoise. `native-crops/`
retains crops from actual whole-frame/global-model runs; their results are
not substituted for crop-local estimates. `clean-crops/` holds the separate
no-noise slanted edge, text, star and fabric outputs. Private clean references
are deliberately absent, not approximated by the RawNIND answer.

## Native CPU costs

MacBook Neo A18 Pro, 8 GB, one CPU/native thread, November 17, 2026. Canon
visible sensor 5202×3464 (18.02 MP); Sony 7968×5320 (42.39 MP). All pixels
are processed; only review crops are retained. Native RAW open uses the
approved originals, no per-run full-photo copy. The AHD baseline uses the
same inherited research Lab/development assumptions as the quality trial,
not a claim of shipping camera-Lab/GPU equivalence.

| Development method | 18 MP development | 42 MP development | 18 MP full current / repair | 42 MP full current / repair |
| --- | ---: | ---: | ---: | ---: |
| Signed AHD | 1.177 s | 3.516 s | 6.837 / 6.831 s | 16.206 / 15.979 s |
| Bilinear | .690 s | 1.717 s | 5.843 / 5.986 s | 13.337 / 13.416 s |
| MMSE trial | 1.111 s | 2.786 s | 6.701 / 6.826 s | 15.485 / 15.178 s |
| RAW .65 + AHD | 1.609 s | 3.830 s | 7.535 / 7.656 s | 16.957 / 16.447 s |
| RAW .65 + MMSE | 1.404 s | 3.334 s | 7.150 / 7.484 s | 15.471 / 16.606 s |

Development is a separate bounded strip pass. Full cost includes RAW open,
global Denoise-model measurement, haloed sensor/development work and all
Denoise tiles. It **does not add that standalone development pass again**.
These are CPU research costs, not import-to-screen latency or live-slider
times. Signed strip/development overhead is present in every comparator.

Use the inherited ±10% descriptive timing allowance, not a single-number
speed claim. MMSE's small whole-cost changes lie inside it. Bilinear saves
about 15–18% of the measured whole CPU job, not 50%, and costs detail.
RAW+AHD adds a measured sensor-processing step rather than fixing the pit.
No new GPU route or speed investigation is justified by these costs.
Native evaluation tree peaks are .903 GB Canon / .959 GB Sony, below the
unchanged 2.5 GB research guard; they are not new application memory budgets.

Native global-model Canon luma tails remain .1666 current, .1363 bilinear,
.1512 MMSE, .1933 RAW+AHD and .1974 RAW+MMSE before the calibration repair.
The whole-frame context does not rescue the primary defect.

## How it would ship, if a later variant earns it

**No shipping winner is selected.** Do not add a global demosaic replacement,
an ISO threshold, cache allowance, hidden strength change or third denoiser
from this report. A noise-conditioned choice would need independent camera/
ISO qualification and a trustworthy noise estimate, not an arbitrary cutoff
learnt from this one Canon crop. Keep original low-noise development unless
its clean-detail/aliasing results have actually been qualified.

For a later qualifying demosaic variant, `frontend/library-gpu-raw.js` has
its own AHD green/directional RGB/Lab/homogeneity/combine sequence. Replacing
only the CPU demosaic would leave different Library/Grade pixels. Share the
signed sensor normalization, CFA phase, WB/matrix and upper-bound policy
first; replace GPU interpolation, not the downstream colour/geometry tail.

- Bilinear needs signed normalized same-colour gathering, with original
  sensor sites restored exactly. It must match CPU mirror boundaries and
  odd-size/even-origin handling, not reuse AHD's clipped integer transport.
- Directional MMSE needs horizontal/vertical difference and binomial-pilot
  passes, nine-sample moments and inverse-variance fusion, then shared
  colour-difference reconstruction. Use the same small variance floor and
  signed float arithmetic. Avoid integer homogeneity/Lab clamps. This is a
  replacement within the existing GPU RAW route, not a new neural route.
- The RAW prepass would need four phase-specific shot/read parameters and
  identical signed VST/inverse, binomial energy and .65 setting before the
  existing signed AHD. Noise fits must be frame-global and shared; GPU/CPU
  must not independently choose a different noise gate or profile. Reuse
  bounded transient work rather than propose a new persistent full-frame cache.
- The `dark_noise` repair additionally changes Denoise measurement/block
  eligibility, not just RAW processing; it needs its own matching GPU model
  measurement and a new compact-model cache revision, as its report states.

Required qualification before any integration: finished SDR ΔE2000 and HDR
ΔE ITP **mean <1, p99 <3**, with negative shadows, real Canon/Sony/public
camera matrices, all four Bayer phases, whole/tiled/zoom/reduced pictures,
±6-stop presentation and bright saturated boundaries. Check the actual
finished renderer/export/Proof ceiling, no pre-encoding allowance; do not use
the harness's display clamp as a substitute. One GPU attempt, then CPU
fallback, with only the already-approved temporary-device exceptions.
**No GPU prototype or measured CPU/GPU parity is delivered in this CPU trial.**

## Risks and recommendation

The provisional noise fits are not laboratory sensor calibration; signed
VST noise is only approximately white/unit variance. Inverse transformation
can bias low signals, and sensor-plane smoothing changes demosaic noise
correlation. Local Wiener energy can preserve the same rare high-energy
outliers we are trying to remove. Tiny coloured lights and fine Bayer-scale
detail remain underdetermined without stronger evidence. Real private
shadows have no clean truth. Public pairs have low-ISO noise, interpolation
and residual registration; seen-by-RawNIND scenes cannot be used as held-out
model validation. The analytic clean comparison avoids one AHD-reference
bias but is still a limited synthetic camera/optics model.

Recommendation: retain the signed input work; keep the flame calibration
repair separately described; **reject these four variants as the Canon pit
fix and do not silently change defaults**. The directional trial's held-out
gain is worth recording, not turning into a shipping claim. Further classical
work should either faithfully evaluate signed upstream LMMSE/IGV, or use
independent/robust RAW evidence instead of again treating a noisy local energy
peak as detail. RawNIND remains the visibly successful Canon comparator here.

## Validation, evidence and cleanup

`output/denoise-v1/demosaic-noise/` holds phase JSON receipts, fixed PNGs,
guard receipts and the two fast-suite logs. The signed-AHD/noise model source,
adapter, evaluator and frozen inventory hashes identify the exact inputs.
Some early receipts precede later review-only/dtype bookkeeping fixes; the
evaluated demosaic/filter source is unchanged. No output image, dataset,
model weight, RAW, `.npz` bundle or local link is committed.

Two harness faults were fixed, not waived: the first clean analytic-reference
conversion passed float64 to a float32-only bridge (no clean result was
retained), and the first decision-page finalizer exceeded the inherited
13 MB size ceiling after saving its measurements. The finalizer now reuses
byte-identical PNG files without changing any pixels or removing columns.
Its behavioural test verifies idempotence; the existing decision measurements
were reused, not re-run to obtain a different quality number. The failed
decision guard is retained with that explanation; the review rebuild passes.

- `node --test tests/*.test.js`: **1,091 pass, one skip, zero failures**.
- `.venv/bin/python -m pytest tests -q`: **4,053 pass, 150 skip, one xpass,
  zero failures**; one existing Starlette/httpx deprecation warning.
- Twenty new behavioural tests cover all Bayer phases and exact sampled
  sites, signed constants/headroom, VST inversion, no-noise-metadata refusal,
  zero-strength identity, flat-noise reduction, independent strip/tile
  interiors, unchanged controls, finite output and lossless page deduplication.
- Final focused rerun after the clean-crop helper: **20 pass**. The helper's
  own guarded execution also passes and its retained clean PNGs were inspected.
- The full fast-suite tree peaks at 2.175 GB under the same lock/guard.
  No tolerance, limit, test expectation or production file is relaxed.

No production change means no existing GPU driver exercises these new
adapters. No unrelated Library check is substituted for the absent RAW GPU
qualification. Timing numbers are confined to this report as requested;
the coordinator owns product/brief/performance-table updates.

The retained phase guards total about **22.5 minutes**, including both full
fast suites and the failed decision finalizer; no 90-minute budget extension
was needed. The largest research evaluation tree is 1.211 GB; the fast-suite
tree is the larger 2.175 GB already noted. Guard numbers exclude time waiting
for the shared lock and do not measure an interactive app wait.

Final `tools/output_size.py`: **13.0 GB**, below the 100 GB limit (12.9 GB is
the shared approved test-photo store). This trial retains **23.6 MB** of
receipts/logs and small review PNGs, including the **9.84 MB** twelve-row
decision page. The original output check was 12.9 GB. Own temporary upstream
source, dependency-install log and identified fast-suite pytest scratch were removed;
dataset/model links and other agents' output were not removed. Retained review
folders can be deleted after Steve reviews them; they contain no unique RAWs.
`shadow-tail-comparison.html` is a small local summary chart of the same Canon
decision-tail values; it does not replace the photographic review.

Reproduce each named phase through the README lock/guard command, using the
frozen prior inventory. `--phase review` rebuilds only the local page from
retained measured crops. Code implementation starts at local commit
`4e7d8a1d`; report/finalizer fixes are in the following local commit. No push.
