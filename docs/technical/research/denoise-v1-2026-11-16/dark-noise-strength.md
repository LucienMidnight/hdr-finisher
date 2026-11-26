# Dark-noise strength — November 17, 2026

## Plain-language result

**There are two problems, not one.** Beside the flame, Denoise can learn that
the picture has almost no noise by measuring a clipped, featureless bright
area. It then leaves nearly all the dark-area noise alone. Keeping below-black
RAW samples does not stop bright areas clipping, so signed development alone
does not fix this estimation failure.

A small classical repair makes Denoise ignore those uninformative calibration
blocks. It substantially cleans the flame's neighbouring shadow, including on
signed input. It keeps the existing controls and reconstruction method.
However, **it does not fix the scattered dark pits and coloured rims** in the
other Canon shadow. On the native signed frame that crop's tail gets slightly
worse. Turning up strength or reducing Detail Recovery hides more specks, but
also removes genuine fine structure elsewhere. The small gain-estimation
alternative tested here is not a convincing solution either.

**Recommendation:** retain this as a diagnosed calibration bug and a useful
isolated prototype, not a completed dark-speck fix or a replacement for RawNIND.
Do not secretly strengthen the shipping defaults or turn signed samples back
into clipped samples to conceal the problem. Signed RAW development remains
the coordinator's approved primary baseline. No production code, product PRD,
brief log or performance-table entry changes in this research branch.

## Conditions, inputs and interpretation

- Minimum Mac: MacBook Neo, Apple A18 Pro, 8 GB unified memory; one CPU/native
  thread. All heavy work, including native CPU work and fast suites, uses the
  shared `tools/gpu-run-lock.py`; research jobs additionally use the existing
  2.5 GB process-tree guard. No overlapping CPU/GPU evaluations.
- Reused frozen inventory from the preceding signed-shadow research, seed
  `16112026`, prepared public pairs, crop positions, exposure settings and
  inherited masks. No new dataset/checkpoint downloads or hand-picked winning coordinates.
  Private RAWs come only from `<photosRoot>/HDR Test Images`.
- Primary runs develop **both noisy and clean Bayer references signed**.
  Synthetic below-black noise is regenerated from the frozen clean mosaic,
  parameters and seed; clipping it must exactly reproduce the frozen noisy
  Bayer. Public clean Bayer already includes the inherited alignment and
  capture-global gain. Frozen masks are retained, not retuned for the fix.
- This differs from the earlier signed report's clipped clean references:
  do not treat a cross-report PSNR change as a denoiser improvement. Low-ISO
  RAW/pair references retain noise and registration/demosaic limitations.
- Synthetic quick: 21 clean-reference cases plus two private crops; full:
  27 clean-reference cases plus eight private crops. Public pairs are kept
  separate: held-out 19 crops / six captures / four scenes; seen by RawNIND
  33 crops / 13 captures / seven scenes. Pair summaries average crops within
  capture, captures within scene, then weight scenes equally.
- The prototype is RGB classical adaptive-à-trous, not AI. RawNIND Bayer is
  a separate existing comparator, alone, never followed by current Denoise.
  Its existing hash-verified checkpoint is linked, not copied or committed.
- Signed development uses the preceding research's signed AHD adapter, not
  the other agent's unfinished production integration. It continues the
  temporary-DNG Lab toe below zero. No claim of production RAW/GPU parity.
- General harness finished transforms are its fixed SDR/sRGB and HDR/PQ
  presentations. Private decision rows use unlifted filtering followed by
  their fixed presentation exposure. No auto-exposure or sharpening.

Evidence is under `codebase/output/denoise-v1/dark-noise/`. `probe.json` holds
all four development/projection modes, per-component/per-band sigma/RMS/gain
percentiles, controls and calibration-block counts. `native-*.json` holds
whole-frame models, native CPU timings and actual retained crop outputs;
`native-probe.json` evaluates those models over the same retained regions.
`signed-{quick,full,heldout,seen}/results-*.json` contains the primary quality
measurements, and pair `summary.json` files use the harness's scene weighting.
The unprefixed folders hold the secondary clipped comparisons. Guard receipts
record time, process-tree memory and exit status. Source/inventory hashes are
recorded in the research receipts; early clipped receipts predate the added
provenance field, not a different calibration/filter implementation.

## Diagnosis

### 1. The flame failure is a calibration failure, not a weak slider

On the 640×640 signed flame context, the current fitted variance is
`a=0, b=1e-20, c=0`. The bright bin at signal 1.253 has zero measured variance
and 100% zero high-pass responses. Relative-error fitting gives that bin
enormous leverage. The tiny `b` alone is not sufficient evidence of failure:
the subsequent per-band multipliers often compensate for it.

Here they do not. The finest-band quiet-block quantile includes artificially
quiet clipped blocks. With the repaired model shape but **unchanged** band
calibration, 162 of 400 selected blocks are uninformative; the median selected
signal is .439, not deep shadow. Excluding those blocks selects 359 informative
blocks, median signal .0147. Of 1,600 blocks, 1,434 are informative. Fixing the
variance fit alone leaves the flame tail at .38229, effectively Off .38228.
Both the shape and its calibration must be treated together.

The following are **median control-weighted predicted sigma / observed local
band RMS / median retained gain**, Y only, over fixed dark support. RMS is
measured signal-plus-noise, **not clean noise truth**. Sigma includes Amount,
component, size and fine-band weights; it is not the raw `sqrt(b)`. Full C1/C2,
p10/p90/p99.9 and model data are in `probe.json`.

| Signed flame band | Current sigma | Local RMS | Current gain | Repaired sigma | Repaired gain |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0, finest | .000209 | .007081 | .9991 | .013368 | 0 |
| 1, fine | .000125 | .002197 | .9967 | .003257 | 0 |
| 2, medium | .0000752 | .000969 | .9940 | .001396 | 0 |
| 3, coarse | .0000451 | .000451 | .9900 | .000628 | 0 |
| 4, coarsest | .0000271 | .000329 | .9932 | .000283 | .2654 |

At band 0 the current C1/C2 sigmas are .000557/.000515 versus measured RMS
.004093/.003151; median gains .9815/.9733. Repaired values are .012160/.008469
with median gains zero. This is not merely a luminance-control problem.

The local brightness used by `_noise_variance` is B3-smoothed at levels 0
and 1, clamped nonnegative, then evaluated as `c*y*y+a*y+b`. Flame shadow
signal p10/median/p90 is .00506/.00837/.01499. Current base sigma is **the same
1e-10 everywhere** because `a=c=0`: a bright immediate neighbour cannot raise
that model's sigma. The bright area causes trouble **through frame/context
statistics and selection**, not because a bright signal is substituted for
each dark pixel. A real shot-noise term would increase sigma near a bright
edge; that is not the observed cause of the near-unity gains here.

### 2. Signed dark-shadow pits are a different failure

All 1,600 blocks in the signed dark-shadow context are informative. The repair
therefore gives essentially the same model and pixels as signed current.
Its model has `a=0, b=2.37979e-6, c=.01790695`; median base sigma .001588.
Median smoothed signal .002829 is lower than median finest-band RMS .006029.
This is a noisy, poorly resolved shadow; that ratio is not a calibrated
sensor SNR, but it demonstrates why isolated high-energy coefficients are
not reliable evidence of texture.

| Signed dark-shadow band | Weighted Y sigma | Local Y RMS | Median gain | Gain p99.9 |
| --- | ---: | ---: | ---: | ---: |
| 0 | .011655 | .006029 | 0 | .718 |
| 1 | .002721 | .001846 | 0 | .757 |
| 2 | .001055 | .000817 | 0 | .866 |
| 3 | .000475 | .000458 | 0 | .926 |
| 4 | .000214 | .000491 | .811 | .983 |

The median grain is suppressed already, but rare demosaic clumps have large
7×7 second moments and survive `max(1 - sigma² / local_energy, 0)`. Mixed
kept/suppressed signed bands create conspicuous dark centres with light or
coloured rims after lifting. The existing tail correction already tries to
account for clumps, is bounded, and affects only the first two bands. It is
not enough for these tails. Signed input exposes more below-black structure;
clipping it is not a principled speck remedy.

Detail Recovery .5 has **no explicit retained-detail floor**. Below .5 it
raises the first two bands' sigma, reaching 1.5× at zero. Above .5 it begins
raising a retained-gain floor. So the default problem is not a hidden .5
texture floor; it is noisy local energy driving the Wiener decision.

### 3. Strength, sizes, development and gamut ablations

Fixed-support lifted-shadow **luma local-median residual p99.9** below is a
visibility proxy, not an acceptance threshold. Real detail can count. Smaller
is not automatically better. Colour tails and dark/bright island counts are
in the receipts. Every row keeps the app defaults unless explicitly changed.

| Context-local signed input | Flame +4 | Dark shadow +4 |
| --- | ---: | ---: |
| Off | .38228 | .36003 |
| Current | .38288 | .16275 |
| Current, Amount 1 | .38393 | .10427 |
| Current, Amount/Luminance 1, other defaults | .38327 | .03143 |
| Current, Detail Recovery 0 | .38387 | .07206 |
| Current, Amount/Luma/Color 1, Detail 0, sizes .5 | .38839 | .01466 |
| Shape repair alone | .38229 | .16275 |
| Joint shape + informative calibration | .07564 | .16275 |
| Joint repair, Detail Recovery 0 | .01451 | .07206 |
| Joint repair, centre-excluded local energy | .06151 | .14591 |
| Directly measure all five band sigmas | .07894 | .15993 |
| RawNIND Bayer alone | .00939 | .01373 |

At the broken flame estimate even maximum strength barely changes the result.
On dark-shadow, strength can clean more, but the clean-reference tests below
show its cost. It is not safe to make these settings a hidden default.

The four existing size controls were independently set to 1, with all others
unchanged. Signed flame luma tails remain .38493/.38307/.38189/.38311 for
finest/fine/medium/coarse. Signed dark-shadow gives
.10750/.15609/.16560/.16443. Coarser residual energy exists, but increasing
only coarse strength does not solve the sharp pits. Direct five-band
calibration likewise provides no useful overall cure.

Both negative-removing stages were tested separately. In the flame row,
signed current with import gamut projection still has .38664 tail, versus
.38288 without projection; repaired projected signed gives .06640. In dark
shadow projection changes signed current .16275 to .14138, still leaving
specks; repaired projected input is unchanged there. Clipped development
without projection gives flame .38991 → .06951 and dark .13198 → .13198.
Thus neither preserving negatives alone nor applying import gamut projection
fixes this estimator/energy issue. Projection also changes fixed dark support;
cross-mode tail differences are descriptive, not equal-mask clean comparisons.

### 4. A decision crop is not the whole-frame app model

The famous .396 → .390 result is reproduced on the **context-local clipped
decision row**. It must not be advertised as a measurement of the app's
whole-frame model. Whole-frame estimates sample different light/dark regions
and calibrate differently. Full native filtering gives:

| Native model / input | Flame Y/C tail | Dark-shadow Y/C tail |
| --- | ---: | ---: |
| Signed current | .14576 / .15403 | .16656 / .18349 |
| Signed calibration-only repair | .14217 / .15209 | .16511 / .18309 |
| Signed joint repair | .07599 / .10108 | .16820 / .19552 |
| Signed joint + centre-excluded energy | .06325 / .08741 | .15911 / .17861 |
| Clipped current, secondary | .25377 / .22270 | .20023 / .20456 |
| Clipped joint repair, secondary | .06952 / .07638 | .15000 / .16261 |

The signed joint repair improves the flame but **does not improve the native
dark-shadow crop**, unlike the secondary clipped result. This is the main
reason not to call the requested signed dark-noise fix successful.

The saved native model explains that distinction: signed current's effective
finest Y sigma is .011877 in both ROIs. The joint model gives .013343 at the
flame, but .011513 in dark-shadow. The respective finest gain p99.9 changes
.469→.264 and .691→.744. Thus the repaired frame-global model suppresses more
of the flame's tails while retaining more of the other shadow's strongest
fine coefficients. `native-probe.json` records every component and band,
including the coarsest median Y gain .512→.292 at the flame and .781→.767
in dark-shadow. These are measured whole-frame-model diagnostics, not a claim
that the contextual model is what the app necessarily uses.

## Prototype and quality results

`candidates/dark_noise.py:factory` reuses the previous constrained, scaled
variance fit, removes brightness bins with a censored lower quartile, then
excludes calibration blocks where at least 25% of the high-pass responses
are numerically zero. The numerical-zero threshold is `32*float32_epsilon*
abs(luminance)`, not a new absolute signal floor. It selects the existing
quietest 25% **among informative blocks**, retains the existing lower-decile
calibration and tail correction, and returns the same compact model. Fewer
than eight informative blocks, or no informative brightness bins, falls back
to current estimation. No new user control or source modification.

The primary candidate uses **unchanged production reconstruction**. Ablations
keep the old variance shape (`calibration_only`), measure all five bands
(`perband`), or exclude the centre coefficient from local energy
(`independent`: `(49*box(band²)-band²)/48`, floored at zero). The last one is
still correlated with neighbouring demosaic noise, not an independent pilot.
`detail_zero` and `strong` are explicit control-setting experiments, not
proposed hidden algorithm changes. `signed` is a Bayer decision-column
wrapper. None is imported by the app.

### Signed synthetic quick, then full

Quick mean SDR PSNR by ISO 1600/6400/25600 is
32.817/28.821/24.335 dB for current and the joint repair. Detail Recovery 0
gives 32.138/27.908/23.652 dB. The repair does not repair an already-correct
model; extra suppression is not a free detail improvement.

With the joint repair and Amount/Luminance both 1 (Detail .5, Color .75,
sizes .5), quick PSNR drops to 31.053/26.952/22.689 dB. Slanted-edge MTF50
falls from current 1.017/.830/.635 to .686/.609/.417. Even without lowering
Detail Recovery, maximum luminance strength is not a safe default elsewhere.

Full equal-case means, 27 clean-reference cases (not a scene-weighted public
pair score):

| Signed noisy + signed clean reference | SDR PSNR dB | HDR PSNR dB | SDR ΔE2000 mean |
| --- | ---: | ---: | ---: |
| Off | 23.163 | 26.492 | 10.658 |
| Current | 33.161 | 37.162 | 3.818 |
| Joint repair | 33.161 | 37.162 | 3.818 |
| Calibration only | 33.161 | 37.162 | 3.818 |
| Joint + centre-excluded energy | 33.139 | 37.163 | 3.817 |
| Joint, Detail Recovery 0 | 32.640 | 36.873 | 3.870 |
| RawNIND Bayer alone | 30.741 | 35.943 | 4.533 |

The inherited quality targets are **not all passed**. Current and the joint
repair each miss the flat Y≤.5 ratio in three of 27 cases, C≤.3 in four, and
at least one .85–1.15 texture band in 16 of 18 texture-supported cases.
Slanted-edge MTF50 retention at the three ISOs is
.996/.801/.662: two cases miss ≥.90. Extra halo is .00104/.00266/.00247,
inside .02. Mean colour bleed over 24 supported cases is .06133 for both.

Detail Recovery 0 lowers full-chart MTF50 to .892/.669/.589 and mean bleed
increases to .06754. Held-out fine texture also loses more energy, below.
That setting cleans shadow tails by spending real detail; it is not the fix.
RawNIND also fails this full synthetic contract: all 18 texture cases and
all three edge/halo cases miss their respective targets. Neural shadow
cleanliness is not evidence of a universal quality pass.

### Public pairs: held-out and seen are separate

| Population / signed reference | Off SDR/HDR PSNR | Current | Joint repair | Centre-excluded | Detail 0 | RawNIND alone |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Held-out, 4 scenes | 27.685 / 33.336 | 34.907 / 41.636 | 34.922 / 41.656 | 34.932 / 41.669 | 34.869 / 41.621 | 35.066 / 42.006 |
| Seen, 7 scenes | 29.315 / 36.425 | 34.167 / 41.227 | 34.167 / 41.227 | 34.148 / 41.206 | 33.628 / 40.594 | 33.925 / 41.184 |

Held-out equal-scene flat Y/C ratios: current .361/.333, joint .358/.332,
RawNIND .299/.307. Joint repair's four texture energy ratios are
.559/.615/.721/.843 versus current .563/.616/.722/.844. Detail 0 drops them
further to .396/.511/.654/.811. They are not inside .85–1.15. Seen joint flat
Y/C is .471/.449. Those averages describe the trade-off, not case-level passes.
SDR colour error on held-out current/joint/RawNIND is 2.933/2.930/2.983;
RawNIND's small PSNR lead does not mean it wins every metric.

Case-level targets are still missed: joint held-out Y/C failures are 3/12
of 19, with 18/19 texture cases outside at least one band; seen has 16/27
Y/C failures of 33 and 31/33 texture failures. The joint repair also increases
one held-out crop's mean bleed from .02310377 to .02314035
(`TEST_MuseeL-Saint-Pierre-C500D-c47c1343-3`); it therefore does not establish
the literal no-worse-bleed criterion. No tolerance is invented to waive it.

The tiny held-out gain and unchanged seen/full means do not establish a
general new denoiser. They do show that the calibration repair is narrowly
targeted rather than a broad strength increase. The clipped full secondary
comparison is also essentially unchanged: 31.20791 → 31.20790 dB SDR.

### Exposure, range and tiling safety

For RGB current/repair/ablations, the harness checks every integer stop
from −6 to +6 with model re-preparation, returning exposure afterwards.
The signed quick comparisons are zero at the reported finished-pixel SDR
ΔE2000/HDR ΔE ITP precision. Shifted retained-core tiles and whole resolution
are also within **mean <1, p99 <3**. Focused tests additionally cover a dark
signed Gaussian region beside a bright plateau, ±6-stop plateau scaling,
unchanged input, alpha, exact bypass, zero strengths and negative/HDR constants.

Finite output, below-zero/above-white retention, exact alpha/bypass and the
harness fixed-transform 1000-nit ceiling pass. This is **not** validation of
production export/Proof encoding or the other agent's signed-development
implementation. No clipping is added to the candidate. RawNIND Bayer's RGB
HDR/alpha sentinel is not applicable; its existing sensor-domain limitations
remain. No tolerance or production highlight limit is changed.

## Crops to look at

Open the [local decision comparison](../../../../codebase/output/denoise-v1/dark-noise/decision/index.html).
It has 12
fixed decision rows with 288×288 native-pixel PNGs, regenerated in the same
folder. Primary columns: **signed Off, signed current, signed fix, RawNIND
Bayer alone, signed clean where available**; independent-energy, Detail 0
and clipped secondary columns follow. No private crop has clean truth.

1. `canon-flame-edge-lifted`: repair finally acts, but RawNIND is cleaner.
2. `canon-dark-shadow`: signed fix and signed current have the same visible
   pits; independent energy only helps modestly. Detail 0 hides more.
3. `heldout-print-dots` and `heldout-foliage`: inspect actual small digits,
   dots and leaves before rewarding a quieter shadow or a larger PSNR.
4. `synthetic-fine-text`, `synthetic-fabric`, `synthetic-star-field`: inspect
   missing/reconstructed fine structure. Cleaner is not always correct.
5. `sony-sign-lettering` and `sony-flat-wall`: the joint repair does not
   improve the already-functional signed estimates there.

`review/<case>/native_signed_current.png` and
`review/<case>/native_signed_informative.png` show **native-model** outputs,
not the decision page's context model. `signed_current.png`,
`signed_informative.png` and the projected/size-control PNGs in that folder
belong to the diagnostic context, not a screenshot of the app.

## Native CPU cost on this Mac

Single serial passes; **descriptive ±10% timing allowance**, inherited from
the research harness. Small differences inside it are ordinary noise, not
a speed improvement. Streaming native retained-core tiles are 768px with
66px halo; sample-window preparation and repeated bounded RAW development
are included. No full-frame RGB copy is retained just for timing. This is
CPU processing cost, not button-to-screen time, GPU speed or app RSS.

| Signed input | Current analysis/filter/whole s | Joint repair analysis/filter/whole s | Whole difference |
| --- | ---: | ---: | ---: |
| Canon 5202×3464, 18.02 MP | 2.000 / 3.976 / 7.991 | 1.601 / 4.055 / 7.732 | −.259 s, −3.2% |
| Sony visible sensor 7968×5320, 42.39 MP | 2.052 / 9.711 / 16.766 | 1.600 / 9.673 / 16.390 | −.376 s, −2.2% |

No material cost increase or meaningful whole-wait speed claim for the joint
repair. Process high-water RSS is about .66–.72 GB for the streaming native
runs, below the 2.5 GB research guard; this is not a new app memory budget.
Centre-excluded energy totals 8.050 s / 19.180 s. Its one-pass Sony cost is
14.4% above current, and its weak quality result does not justify it; no
repeat speed investigation is warranted. Clipped secondary current→joint
whole cost is 7.362→7.269 s and 15.154→15.023 s.

## How it could ship, and what is not proved

1. Keep the approved signed RAW samples, and qualify import projection's
   ordering separately. This research must not reintroduce clipping.
2. CPU estimation: integrate the informative-brightness fit and block
   eligibility together. Merely flooring `b` or changing the fit fails the
   flame reproduction. Keep estimation bounded and fallback explicit.
3. GPU preview: `frontend/denoise-measurement.js` currently reduces 16×16
   block spreads, selects global flat25%, then quantile10% band calibration
   (lines around 175–203). Extend the existing high-pass reduction with a
   numerical-zero count per block, use the same eligibility rule, and fit
   the same scaled informative brightness observations on the host. The
   compact model layout and existing reconstruction shaders need not change.
   No RAW re-decode or new persistent image cache is needed for live sliders.
4. Give changed model measurements a distinct cache revision so old compact
   models are not reused. Share CPU/GPU thresholds and selection semantics;
   do not simply reuse the current GPU histogram fit and assume agreement.
5. Qualify GPU-vs-CPU at finished SDR ΔE2000 and HDR ΔE ITP **mean <1, p99 <3**,
   on flame/dark-shadow, real native/reduced views, bright-clipped and
   near-black plateaus, and the existing exposure/tile/HDR cases. Keep the
   exact finished HDR ceiling and one-try/fallback policy. Those are the
   acceptance limits, **not measured GPU results from this CPU research**.

No GPU prototype or CPU/GPU parity run is delivered here. Unchanged
reconstruction alone does not prove parity when estimation changes. Likewise,
the small centre-excluded-energy formula would be straightforward to express
in the resolve shader but has not earned integration or a parity claim.

Risks include genuinely quantized/noiseless rendered flats being discarded
as uninformative, no eligible data causing the old-estimator fallback, the
positive-brightness fit's remaining selection bias in near-zero signed data,
tail/flat masks confusing low-contrast detail with noise, camera/demosaic
dependence, and a frame-global repaired shape slightly worsening another
shadow region. No clean private RAW truth exists to settle the last point.

## Validation and recommendation

The requested adapter-only investigation is complete, with a **partial
positive and an important negative result**: repair the clipped-bright
calibration failure; do not claim it solves signed dark-shadow pits. Keep
the original controls. Reject default-wide Detail 0/max-strength and the
centre-excluded-energy variant as the finished solution. Further work should
separate genuine low-SNR texture from correlated demosaic clumps using
independent evidence; it must earn its detail/edge result on signed input.

Final fast checks, run serially under the shared lock and guard:

- `node --test tests/*.test.js`: 1,091 pass, one skipped, zero failures
  (1,092 tests).
- `.venv/bin/python -m pytest tests -q`: 4,033 pass, 150 skipped, one xpass,
  zero failures. One existing Starlette/httpx deprecation warning. The eleven
  new behavioural research test cases are included in this run.
- Combined fast-check process-tree peak 1.965 GB; all completed quality/native
  guard receipts exit zero. No test, limit or tolerance is loosened.

No production change means no relevant GPU driver covers these research-only
adapters; an unrelated Library/GPU sweep is not substituted for the missing
estimation parity qualification. The existing shared Library smoke does not
exercise these unimported adapters and was not run as substitute coverage.

`output_size.py`: 12.9 GB at start; **13.0 GB after final cleanup**, below
100 GB. The dominant 12.9 GB is the existing shared test-photo folder, not new
photo copies. This research retains 55 MB: decision/probe/native crops, linked
receipts and `checks-node.log` / `checks-pytest.log`. Redundant quality-run
HTML/crop copies and temporary logs were removed; the fixed decision page and
diagnostic/native PNGs remain. After Steve reviews them, this task's entire
`output/denoise-v1/dark-noise/` folder is disposable, but do not delete the
shared test photos or other agents' dataset/model stores. All RAWs, public
pair bundles, model weights, generated PNGs and run receipts remain outside Git.

For reproduction use the README command with the retained
`output/denoise-v1/dark-noise/signed-full/results-full.json` as frozen inventory,
then each named phase. The evaluated production baseline is
`8915f78fbf2f128c49004e520bdf2a2cc80e2054`; implementation and tooling commits
are `1572a325` and `383a313c`. All commits are local, with no push.
