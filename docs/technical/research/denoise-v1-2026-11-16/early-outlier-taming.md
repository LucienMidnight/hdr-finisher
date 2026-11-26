# Early outlier taming — November 17, 2026

## Plain-language result

**Steve's diagnosis is useful: taming unusual sensor readings before Denoise
removes many of the dark pits and coloured rims. It is not safe to turn on for
every photo.** The same test also treats small real stars and thin lettering as
unusual readings. A size limit and a neighbour-similarity check reduce that
damage, but do not eliminate it. Clean, noise-free lettering changes visibly.

On the eleven relatively flat gallery windows, today's signed Denoise leaves
547 counted islands. The 2.5σ sensor clamp with neighbour protection leaves
141. The more cautious 4σ version, limited to one same-colour sample, leaves
240; allowing two leaves 218, but harms small stars more. These are counts of
conspicuous local contrast, **not a count of proven defective pixels**.

**Recommendation: keep this as an optional, default-off research direction,
not an approved replacement or an automatic ISO-based fix.** For a further
manual trial, use 4σ, one same-colour sample and neighbour protection. Inspect
stars and fine lettering before accepting it. The more effective 2.5σ result
is the main shadow-review column, not a proposed shipping default.

The threshold-only sweep also exposes a control problem: raising the threshold
can split a real star into smaller eligible fragments, so a higher threshold
does not always protect it better. The tested “less luma, more colour” preset
looks less plastic in one public shadow but leaves too much coarse grain and
jagged lettering in the difficult Canon examples. It is not a default solution.

No production code, module PRD, brief log, performance-table entry or default
changes. Dataset images, Steve's photos, checkpoints and review PNGs stay out
of Git. No push.

## What to open

From the Git root, the small local evidence is in:

- `codebase/output/denoise-v1/early-outlier/index.html`: signed Off,
  calibration-repaired current Denoise, 2.5σ protected RAW clamp + Denoise,
  RawNIND Bayer alone; all fourteen windows and the existing decision rows.
- `codebase/output/denoise-v1/early-outlier/ablations.html`: stage, neighbour
  protection, stronger clamp and one/two-sample alternatives.
- `codebase/output/denoise-v1/early-outlier/threshold-grain/index.html`:
  threshold-only 2/2.5/3/4σ sweep, less-luminance/more-colour alternatives,
  unchanged crop positions, clean references and held-out grain comparisons.

Every gallery cell has its 288px native crop and **the original 48×48px spot
enlarged exactly 6×**, nearest-neighbour. The spot is not reselected to favour
a method. The fourteen `cases*.json` windows, sensor coordinates, display
lifts and zoom positions are copied into manifests with coordinate-file hashes.
All original rows remain, including detail-bearing rows where counting points
as noise would be particularly misleading. Decision PNGs are regenerated in
place in this experiment's `decision/` folders, not in another agent's output.

First inspect `IMG_0790-1` (white-centred coloured island), `IMG_0790-2`
(flame-edge adversary), both `7D-1_ISO12800` windows, the fine-text and fabric decision
rows, public print dots and foliage, and the three widths of glowing stars.
`P1010004` and Sony shadows show why there is little to gain on already-clean
windows. Private gallery windows have no clean truth.

## Conditions and reproducibility

- Minimum Mac: MacBook Neo, Apple A18 Pro, 8 GB unified memory; one CPU/native
  thread. Every heavy job uses the shared cross-worktree GPU lock; measurement
  phases use the existing 2.5 GB process-tree RSS guard. Other agents wait/run
  serially on that same lock. No overlapping heavy CPU/GPU evaluation.
- Baseline: signed AHD development plus current Denoise at Amount .75,
  Luminance .5, Color Noise .75, Detail Recovery .5, all sizes .5, with the
  `dark_noise.factory()` informative-calibration repair. Off is signed too.
  RawNIND Bayer is run alone, never followed by current Denoise.
- Frozen signed-full inventory, inherited noise seed/masks/capture alignment,
  same public split, signed development of both noisy and clean Bayer.
  Quick: 21 synthetic cases and two real crops. Full: 27 synthetic/binned-photo
  cases and eight real crops. Public held-out: 19 crops / six captures / four
  scenes. Public seen: 33 crops / thirteen captures / seven scenes. Keep seen
  separate: it is not independent RawNIND generalisation evidence.
- Pair summaries average crops within capture, captures within scene, then
  weight scenes equally. Synthetic summary PSNR below is an arithmetic case
  mean, not a pooled image PSNR. A mean of crop p99s is not a pooled p99.
- Private sources come only from `<photosRoot>/HDR Test Images`. Approved
  CC0 RawNIND RAWs and inherited prepared pairs are linked from the shared
  `output/denoise-v1/datasets/rawnind` store. They are research-only inputs.
  Existing hash-verified weights are linked, not copied. CPU ONNX runtime is
  pinned to 1.32.0. Setup reused the Mac native tools; the research signed-AHD
  helper is built under the lock when needed.
- Research receipts record Git head and source/inventory hashes. The base
  measurements use adapter commit `c5f9e7a01e219aea0d8c5b0c3be09c83c25283f9`;
  additions record their own exact source hashes. No outcome is inferred from
  the coordinator's temporary scripts or receipts.
- Gallery metadata contains the frozen display lift; RAW taming itself still
  works in unlifted signed sensor units. Decision filtering retains its inherited
  fixed exposure policy. There is no new auto-exposure or sharpening.
- Finished-pixel CPU/GPU tolerance is the requested SDR ΔE2000 / HDR ΔE ITP
  mean <1, p99 <3. Timing is descriptive, with the preceding research's ±10%
  allowance for same-machine variation; single runs do not establish a small
  speed difference. No numerical guard is relaxed.

Reproduction commands and phase names are in
`codebase/tools/denoise_eval/README.md`, “Early outlier taming”. Run from
`codebase`, with `PYTHONPATH=backend`, the venv Python, shared lock and existing
`candidates.guard`. The frozen inventory must be supplied with `--inventory`;
the original gallery directory with `--gallery`. Outputs overwrite the same
small folders. `analysis-summary.json` is a convenience extraction; the
phase JSONs and manifests are the primary receipts.

## Method

### Soft clamp, not pixel replacement

Process each of the four Bayer phases independently, including the two green
phases. In a 5×5 same-phase neighbourhood, estimate centre `m` by the median.
Use `sigma = max(sqrt(a*max(m,0)+b), 1.4826*median(abs(x-m)))`: the sensor model
is a floor, and the local residual MAD raises it in textured regions. The
model is the inherited provisional single-frame camera fit, not laboratory
calibration. Local MAD uses neighbouring samples' own local medians.

Let `d=abs(x-m)/sigma`, threshold `t`, envelope `e`, strength `s`. Above `t`,
use `r=smoothstep(0,1,(d-t)/(t-e))` and subtract
`s*r*sign(x-m)*max(abs(x-m)-e*sigma,0)`. At full ramp with strength .75,
one quarter of the original excess remains. Both positive and negative tails
are treated. Values inside the threshold are untouched. No sample is replaced
by its median; signed negative values are retained.

The principal trial uses `t=2.5`, `e=1.5`, strength .75, maximum same-sign
connected component area five. Conservative size trials use `t=4`, `e=2.5`,
area one or two. Thus **the size trial is not the threshold-only sweep**:
that sweep keeps envelope 1.5 and area five throughout. An additional stronger
trial uses 1.75σ/envelope1, no support. A connected component uses eight-way
adjacency on a single CFA phase. “Two samples” is not two adjacent full-RGB
pixels, nor a two-pixel diameter: same-phase samples are two sensor pixels
apart. Count component size before support rejection; otherwise the support
test could split a real large feature into smaller repairable fragments.

The optional protection counts neighbours within ±one local sigma of the
centre sample; two similar neighbours veto taming. RAW uses a radius of two
same-phase pixels. Post-AHD camera-RGB uses a radius-two-to-three ring, excluding
immediate members of the correlated clump. This is a simple similarity veto,
not a learned semantic detector or nonlocal patch matcher. It cannot reliably
distinguish an undersampled star from a noise spike.

Preserve the outer four pixels of each plane and all samples at/above
saturation, including their 5×5 same-plane neighbourhood. Refuse missing
four-phase noise metadata, invalid CFA, nonfinite inputs and odd crop origin.
Do not infer new noise sigmas from clipped display RGB.

### Where it operates

RAW trials tame signed normalised sensor data before signed AHD, white balance
and the camera-to-ACEScg matrix. RGB trials tame the three signed camera-RGB
planes immediately after AHD, still before WB/matrix and Denoise. The RGB model
uses the mean sensor fit for its CFA colour plus local MAD; it is a provisional
correlated-noise approximation. Combined trials do both. The experiment does
not alter demosaic interpolation or use a denoised image as replacement truth.

The grain trial adds no artificial grain. After RAW taming, it changes Denoise
to Amount .75, Luminance .25, Color Noise 1, Detail .5 and sizes .5. Component
strengths change from Y1.5/chroma2.25 to Y.75/chroma3. A no-clamp `grain_only`
control separates the Denoise-setting effect from sensor taming. Both 2.5σ
and 4σ versions are rendered at the same original pixel zooms.

## Results

### Sensor origins independently reproduced

The eleven flat-window subset reproduces **547 = 200 with exactly one |z|>4
sample + 114 with at least two + 233 with none**, exactly the coordinator's
counts. This diagnostic uses a crop-global per-phase MAD sigma and the speck
footprint dilated one sensor pixel; it is deliberately independent of the
candidate's local/model sigma. Both signs occur. The independent deterministic
random-3×3 hit rates span 1.2–11.75%; they need not match the coordinator's
finite random draw. Association is strong, but is not proof of causation for
every island or an upper bound on what a differently defined filter can change.

### Specks and placement

Union islands use absolute SDR RGB residual against a 5×5 median: luminance
of absolute residual >.05 or any channel >.10; eight-connected area1–25,
six-pixel border excluded. Dark/bright/chroma counts are also retained but
must not be added together: one island can meet several conditions. The flat
subset excludes `IMG_0790-2`, `MuseeL-Saint-Pierre-C500D_ISO3200-2` and
`Blombukett_ISO6400-2`; all fourteen are still reviewed.

| Method, followed by current repaired Denoise unless Off/AI | All 14 | Flat 11 |
| --- | ---: | ---: |
| Signed Off | 6675 | 5994 |
| Today's Denoise | 1658 | 547 |
| RAW 2.5σ, support | 1162 | 141 |
| RAW 2.5σ, no support | 1134 | 143 |
| Post-AHD RGB, support | 1346 | 285 |
| Post-AHD RGB, no support | 1285 | 259 |
| Stronger RAW 1.75σ, no support | 1044 | 107 |
| RAW 4σ, area1, support | 1315 | 240 |
| RAW 4σ, area2, support | 1290 | 218 |
| RAW then RGB, support | 1161 | 138 |
| RawNIND Bayer alone | 1307 | 22 |

RAW placement is materially more useful on these shadows than RGB-only. Doing
both adds little over RAW alone. Support helps protect repeated detail with
little shadow penalty, but the island total is not monotone in protection:
changing one sample can split or merge a residual component. AI's all-window
count includes real detail; do not interpret 1307 as 1307 AI noise defects.

The fixed support is exactly the earlier dark-noise diagnostic: signed Off
sigma2-Gaussian luminance <.02 in pre-exposure units, eroded two pixels, border
excluded, common +4-stop presentation. It is never reselected per candidate.
In `IMG_0790-1`, luma/chroma residual p99.9 changes from .1465/.1796 to
.0447/.0676 with protected RAW; 4σ area1 gives .0589/.0784, area2 .0562/.0745.
For `7D-1_ISO12800-1`, .2510/.2654 becomes .0847/.1472; the size1/2 versions
give .1274/.1888 and .1171/.1810. On `P1010004-1`, today's .0062/.0158 barely
changes (.0061/.0161); colour tails are slightly worse. This is not a universal
tail improvement.

### Full fidelity and fine detail

| Method | Quick synthetic SDR PSNR | Full synthetic SDR PSNR | Held-out SDR PSNR | Seen SDR PSNR |
| --- | ---: | ---: | ---: | ---: |
| Signed Off | 23.631 | 23.163 | 27.685 | 29.315 |
| Today's Denoise | 28.658 | 33.161 | 34.922 | 34.167 |
| RAW 2.5σ, support | 28.048 | 32.668 | 34.915 | 34.138 |
| RAW 2.5σ, no support | 27.927 | 32.537 | 34.878 | 34.085 |
| Post-AHD RGB, support | 28.674 | 33.159 | 34.941 | 34.174 |
| RAW 4σ, area1 | 28.444 | 32.976 | 34.936 | 34.164 |
| RAW 4σ, area2 | 28.246 | 32.816 | 34.926 | 34.156 |
| RAW then RGB | 28.052 | 32.684 | 34.931 | 34.145 |
| RawNIND Bayer alone | 24.370 | 30.741 | 35.066 | 33.925 |

The useful shadow cleanup does **not** translate into a general fidelity win.
Tiny public differences are not evidence of a meaningful gain. RawNIND's
synthetic fixtures are not its training distribution; this table is not a
general AI-quality ranking. Full per-case SDR/HDR PSNR, SSIM, perceptual errors,
half-resolution scores, MTF, halo, colour bleed and texture bands are in
`{quick,full,heldout,seen}.json`.

At the most difficult slanted-edge case, current MTF50/clean is .662, protected
RAW .660, RGB .666, size1 .661: all fail the .90 guard, substantially before
this experiment. Maximum measured extra halo is .003 for current, .002 for
protected RAW (below .02). All candidates, including current, have texture-band
ratios outside .85–1.15 somewhere; no classical variant earns an all-contract
pass. Do not repair these failures by loosening the guards. Print dots, foliage,
fabric and lettering remain explicit review rows, not dismissed as noise.
Across the 24 full synthetic cases with a supported colour-bleed metric, mean
bleed is .06133 for current, .06613 protected RAW, .06179 RGB, .06247 size1 and
.06338 size2. Protected RAW is worse than current on nine of those cases;
it does not meet a blanket “no worse bleed” requirement.

### One versus two samples, realistic small stars, and clean input

The optical-star safeguard uses Gaussian PSFs with glow, FWHM 1.88, 2.83 and
4.24 sensor pixels, twelve amplitude/subpixel-phase combinations per width,
both clean and noisy. These are optical profiles, not single-pixel delta
impulses, but are still simulations with fixed camera/WB, not astronomical RAWs
or a complete PSF/spectral/seeing survey.

Minimum integrated star flux relative to current Denoise on the same clean
star field:

| FWHM | RAW 2.5σ support | RAW 4σ area1 | RAW 4σ area2 | Post-AHD RGB support |
| --- | ---: | ---: | ---: | ---: |
| 1.88px | .332 | .761 | .645 | .866 |
| 2.83px | .526 | 1.000 | .928 | .978 |
| 4.24px | 1.000 | 1.000 | 1.000 | .998 |

Allowing two same-colour samples removes only 22 more flat-window islands
than allowing one, but its worst narrow-star flux loss grows from 24% to 35%.
Even with glow, a faint narrow star can look isolated on a CFA phase. Larger
stars are much better protected. Size is helpful, not a guarantee; whether a
star crosses the threshold depends on brightness, noise model and subpixel
phase. Do not promise a “stars safe” checkbox from this statistic.

All nine noiseless/low-noise targets were processed separately. Protected RAW's
worst incremental difference versus current Denoise is fine text: SDR ΔE2000
mean 1.050, p99 34.330. Size1 gives .345/10.909, size2 .826/31.105; RGB support
gives .296/10.713. The clean slanted edge is exactly unchanged by RAW clamping,
but that does not excuse the lettering failure. **The requirement to do nothing
visible on clean photos fails**, even for the cautious one-sample trial.

### Threshold-only and uniform-grain addition

The threshold sweep keeps strength .75, envelope1.5, area5 and support on.
These are counts **after Denoise**, not threshold hits on the sensor:

| Threshold | Gallery all14 / flat11 | Full synthetic SDR PSNR | Clean fine-text incremental ΔE mean / p99 | Minimum clean-star flux, FWHM1.88 / 2.83 / 4.24px |
| --- | ---: | ---: | ---: | ---: |
| 2σ | 1145 / 135 | 32.735 | .952 / 32.165 | .332 / .752 / 1.000 |
| 2.5σ | 1162 / 141 | 32.668 | 1.050 / 34.330 | .332 / .526 / 1.000 |
| 3σ | 1203 / 165 | 32.639 | 1.052 / 34.650 | .278 / .535 / 1.000 |
| 4σ | 1293 / 210 | 32.615 | 1.262 / 37.242 | .278 / .551 / .921 |

Moving 2.5→2σ gains just six counted flat-window islands, not a new level of
cleanup. Text remains worse than current in the ISO25600 decision crop:
SDR mean ΔE versus clean is 7.688 / 7.764 / 7.836 / 7.893 for 2 / 2.5 / 3 / 4σ,
versus current 7.494. Fabric mean ΔE is 12.321 / 12.334 / 12.362 / 12.370,
versus current 12.370: small improvements, not restoration of the clean weave.
Held-out SDR PSNR is 34.931 / 34.915 / 34.910 / 34.908, versus current 34.922.
Seen SDR PSNR is 34.148 / 34.138 / 34.132 / 34.132, versus current 34.167;
these seen scenes remain separate from the held-out result. The complete HDR,
texture and per-case receipts remain separate.

**Higher threshold is not automatically safer with this size detector.** At
low threshold a star's broad connected support can exceed area5 and veto the
whole feature. Raising the threshold can split that feature into eligible
small tips. Support does not undo this. That explains the non-monotone star
and clean-text damage; it is not numerical run noise. The conservative 4σ
area1 result must not be confused with 4σ area5. Before shipping a continuous
“uniformity” control, separate the feature-extent decision from the moving
threshold or otherwise resolve this interaction, then remeasure; no such
redesigned detector is claimed here.

For ideal Gaussian noise around a known mean, two-tailed rates are 4.550%,
1.242%, .2700% and .006334% at 2 / 2.5 / 3 / 4σ. A deterministic 768² Gaussian
plane confirms those rates within finite-sample variation. Actual changed
fractions with the local/model sigma, borders, size and support vetoes are
1.414%, .6822%, .1811% and .005595%; without support, 3.279%, .8650%, .1890%
and .005595%. Thus the Gaussian tail probability is **not** the fraction this
algorithm necessarily changes. At 2σ with support, sensor standard deviation
falls .009999→.009771 (2.3%); without support it falls to .009664 (3.3%).
It is a mild, nonlinear pre-demosaic tail reduction, not a Wiener blur of
every sample. Unlike the earlier Wiener trial, the gallery pits do improve,
but clean strokes/stars and full fidelity still fail.

#### Does even luminance grain hide the remaining marks?

By eye, the grain trial can make the public held-out shadow look less plastic
than the very smooth default. Fabric has more visible fine-looking variation.
However, it does **not** restore the clean fabric's regular weave. On the Canon
6× spot it leaves coarse, maze-like luminance variation and a conspicuous
bright centre; lettering surroundings are visibly scratchier/jaggier, not
cleaner. More colour strength does not guarantee low displayed colour error
after signed RGB mixing and the display transform. It is not the fine, even
grain Steve requested on the difficult examples.

Use fixed clean-reference dark support for a grain proxy: high-pass residual
against Gaussian sigma1, luma standard deviation, chroma RMS, and coefficient
of variation (CV) of 16×16-block luma RMS. Lower CV means more even amplitude,
not better detail. Support is the clean sigma2-luma<.02 mask intersected with
the inherited valid mask; residuals still
include some real structure and reference noise. This is not pure sensor
noise ground truth. In the existing `heldout-shadow` row, only 260 pixels
survive that intersection; no complete eligible blocks remain for CV:

| Output | Fine luma std | Chroma RMS | Block RMS CV |
| --- | ---: | ---: | ---: |
| Clean reference | .00380 | .00609 | unavailable |
| Today's Denoise | .00034 | .00034 | unavailable |
| 2.5σ + default Denoise | .00034 | .00035 | unavailable |
| No clamp + grain settings | .01520 | .00176 | unavailable |
| 2.5σ + grain settings | .01559 | .00180 | unavailable |

The grain setting has **4.1× the clean reference's luma amplitude** on this
small valid support. In `heldout-print-dots`, 4625 valid pixels and five
eligible blocks give clean luma .00393 / CV .047, current .00076 / .415,
protected RAW .00065 / .287, and protected RAW+grain .01620 / .272. Grain
amplitude is relatively more even than current, but still much less even
than clean and 4.1× its luma amplitude. Five blocks and structured print are
weak evidence for general grain evenness. All three additional paired rows
have no eligible valid dark support; their numeric grain values are correctly
absent, while their crops are shown. An earlier exploratory calculation that
did not intersect the inherited valid mask is superseded, not clean-reference
evidence. No flat-field grain-match success is claimed.

The union island counter rises to 23100 / 17989 (all14 / flat11) for 2.5σ+grain,
versus 21175 / 16279 for grain settings without a clamp. It is now counting
the deliberately retained grain, so these are **not comparable defect counts**
to the smooth-output 547. Judge these columns by the same pictures and clean
reference grain, not by optimising that counter.

Full synthetic SDR PSNR falls to 29.266 with 2.5σ+grain, versus 33.161 current;
held-out falls to 33.499 versus 34.922. On the noisy decision crops, fabric
mean ΔE improves slightly (12.011 versus 12.370) but fine text worsens (9.276
versus 7.494). On clean fabric the altered Denoise settings alone change mean
ΔE by 2.607, p99 9.287. Seen SDR PSNR is 33.689 for 2.5σ+grain, 33.690
for 4σ+grain and 33.722 for grain settings alone; current is 34.167.
Grain 2.5σ raises the minimum full-case MTF ratio to .905, but extra halo
reaches .0522, failing the .02 guard (4σ: .904 / .0527). Better edge MTF is
not an all-quality pass. Grain 2.5σ texture-band ratios range .364–839.96;
the enormous upper ratio includes nearly zero clean-reference bands, not
evidence of literally invented objects. A grain setting cannot recover a star already attenuated
at the sensor stage. **Reject this tested preset as a default.** This does not
disprove a more selective finest-band-only luminance strategy; that is not
implemented or qualified in this experiment.

## CPU cost and resource bounds

Native whole-pipeline CPU timings include RAW open, signed development,
calibration, tiled Denoise and checksum consumption of every output pixel.
They are **not action-to-visible-image UI measurements**. The camera frames
are 5202×3464 (18.0MP) and 7968×5320 (42.4MP). Single descriptive runs on this
Mac, one CPU/native thread:

| Native frame | Today's Denoise | RAW 2.5σ support + Denoise | RAW 4σ area1 | RAW 4σ area2 |
| --- | ---: | ---: | ---: | ---: |
| 18MP Canon | 8.48s | 10.70s | 10.85s | 10.69s |
| 42MP Sony | 17.45s | 22.63s | 22.42s | 22.56s |

Added whole wait in this harness is about 2.2–2.4s / 5.0–5.2s. Development
subclock includes clamp and AHD; preparation overlaps reader/development
subclocks, so do not sum all reported subclocks. No result is a measured live
slider cost or GPU speedup. Native process-tree peaks are .719GB / .780GB;
the base crop/quality phases peak at 1.192GB, below their 2.5GB guard. Base
measurement phases total 16.2 minutes of guarded execution, excluding lock
waits/setup/earlier exploration and later scope additions.
The threshold/grain additions total another 12.9 minutes, with peak 1.200GB.
The separate GPU comparison peaks at 1.854GB. Lock waiting is not included in
these execution times; no individual measurement exceeds its memory guard.

## How this could ship, and what is not qualified

### CPU and existing GPU routes

CPU integration would be a signed normalised-CFA operation in `raw_import.py`
before signed AHD, with the same four noise fits, finite support and even CFA
phase origin. The bounded research adapter is not imported into the app.
Keep the signed intermediate separate: do not write negative clamped floats
back into LibRaw's unsigned sensor array.
Implement the fixed small-neighbour kernel in native code rather than Python
pixel loops; retain strip/tile cancellation and existing memory ownership.
No full-frame duplicate or new cache budget is proposed here.

The research GPU prototype uses three compute passes: local centre, local
sigma/candidate fields, then bounded same-sign component/support/soft clamp.
A queue bounded by maximum area+1 rejects oversized components without a
full-image label pass. It is intended for the existing `library-gpu-raw.js`
sensor preparation, not a new GPU processing route. RGB-only experimentation
could instead sit before Denoise preparation. The current GPU sensor floats
must not be rounded or clipped before taming. A live-control design must
invalidate downstream development/calibration rather than reuse stale AHD
or Denoise models. Repeated controls are not timed here.

**Measured clamp-kernel agreement:** one Electron/WebGPU attempt passed,
28 fixtures × −6/0/+6 stops = 84 comparisons, generated four-CFA scenes plus
four fixed real windows, protected 2.5σ/area5, 4σ/area1 and area2, plus generated
2σ/no-support. Raw float difference is at most 1.49e−8. With common CPU signed
AHD and common repaired Denoise downstream, every finished SDR/HDR mean and
p99 is reported as zero, inside mean<1/p99<3. This is not raw float identity:
the integer-scale AHD downstream absorbs these differences. Receipt:
`gpu-compare.json`; shader/source hashes and guard logs are retained. Large
transport JSONs are disposable after comparison.

This **does not qualify the production GPU AHD, RAW import, highlight repair,
preview/export/proof agreement or native GPU performance**. Test those end to
end before integration with the same finished-pixel tolerances, on both
machines. One GPU attempt, then CPU fallback; no retry for invalid pixels,
shader errors or insufficient GPU capacity. No GPU speed claim is made, and
no new route is justified without measuring the whole user wait and a large
enough benefit under the existing project rule.

### Highlight reconstruction and the hot-pixel checkbox

Preserve original sensor clipping evidence before any repair. Proposed order:
signed normalisation → optional hot-pixel repair → optional early stochastic
tail clamp → Opposed-colour highlight reconstruction → signed AHD/WB/matrix
→ optional RGB taming → Denoise. Preserve the existing Edge-colour stage's
contract; do not casually move it with this filter. Clipping masks, clipped
counts and reconstruction support must remain based on original readings,
not a changed mask that taming makes look unclipped. Keep saturation and
near-saturation support out of the clamp; the research's exact saturation
guard is not a complete production highlight-support policy.

The hot-pixel checkbox and this control solve different problems. Hot-pixel
repair targets conservative positive sensor faults; early taming handles
stochastic high/low tails symmetrically and **does not identify a defective
sensor**. Turning hot-pixel repair off must not secretly disable signed shadow
handling or turn on early taming; turning it on must not silently add a
moderate-threshold noise filter. Their combined output/support interaction
has not been qualified here.

All integer exposures −6…+6 are finite and exactly invariant after dividing
out the exposure on the bounded adversary, across 130 base method/exposure
cases. The harness's fixed HDR display cap passes, but this is largely a
property of that display transform: **it is not production HDR safety proof**.
The prototype does not exercise Opposed/Edge-colour highlight reconstruction.
Actual finished output must still never exceed its target before encoding;
only the existing 1% encoder rounding allowance applies after encoding.
The threshold/grain extension adds 117 finite, exposure-invariant cases
across the same integer −6…+6 range, with the same qualification limits.

## Controls and recommendation

The smallest sensible eventual manual interface is:

1. **Uniformity / tame unusual readings:** Off by default; higher uniformity
   lowers the threshold from 4σ toward 2σ. In plain words, “bring more unusually
   bright or dark readings back towards the surrounding grain.” Mark 4, 3,
   2.5 and 2 explicitly in research; do not disguise a nonlinear threshold as
   a promise of the same strength on every camera. Fix the soft-clamp amount
   and envelope internally rather than adding several nearly overlapping
   sliders. These experiments do not establish a safe automatic default.
2. **Largest speck:** one same-colour sensor sample initially; two optional.
   “Allow slightly larger marks to be tamed; may remove small stars and thin
   detail.” Larger area5 is useful for showing the shadow benefit, not a
   conservative universal setting. Keep neighbour protection always on rather
   than expose another checkbox.

Use the existing Luminance and Color Noise controls for the grain trade-off,
not a third new “grain” slider. A preset could be evaluated later, but the
tested less-luma/more-colour setting is not established as a safe default.
No extra synthetic grain is required to evaluate Steve's idea.

Risks still open: provisional camera noise fits; the wrong threshold on clean
real detail; single/two-site stars and thin strokes; correlated post-AHD noise;
faces/eyelashes/teeth/pores not specifically covered by the supplied crop set;
highlight support and optional hot-pixel interactions; complete app GPU/CPU
agreement; live-control cost. Do not call this finished Denoise, a clean-input
pass, or a general alternative to AI. The best next decision is whether Steve
prefers the **manual default-off 4σ/one-sample trade-off**, after reviewing the
same small-star and lettering rows. No product change is implied by this report.

## Validation and retained evidence

Fast checks run from `codebase`, under the shared lock:

- `node --test tests/*.test.js`: 1091 passed, one skipped, no failures.
- The requested `.venv/bin/python -m pytest tests -q` was attempted unchanged,
  but the research process-tree guard stopped it at about 74% for exceeding
  2.5GB RSS (2.521GB observed). This is not a passing monolithic run, and no
  test failure was reported before the guard stopped it.
- Reran the complete Python file inventory in fifteen fresh-process shards
  of at most sixteen files under the same guard: 4118 passed, 150 skipped,
  one existing non-strict XPASS, no failures. The guard commands cover all
  226 discovered test files exactly once, with none omitted. Sharding bounds
  accumulated process memory; it does not relax assertions or the guard.
- Latest focused adapter checks: 20 passed, including signed tails, support,
  connected size, saturation, clean/no-op cases, grain controls and inherited
  valid-mask handling. One bounded GPU kernel run passed all 84 comparisons.

Receipts: `node-fast.log`, `node-fast-guard.json`, `python-fast-guard.json`,
`python-shards/{1..15}.log` and `{1..15}-guard.json`,
`threshold-grain/unit.log`, and `gpu-compare.json` under the output folder.
No production path changed; no broad Library or release sweep was run.
Final output census: 13.0GB total, below 100GB; 12.9GB is the shared approved
test-photo store. This experiment's retained review/receipts folder is 82MB.
Large GPU transport JSONs were removed after successful comparison; the
reproducible fixture generator and small comparison receipt remain.

PNGs and local HTML are intentionally ignored
output. Keep only folders linked above and JSON/log/guard receipts; delete
this experiment's review folders once Steve has reviewed them. Do not delete
the shared datasets, checkpoint symlinks or shared test-photo originals.
