# Faithful RawTherapee LMMSE on signed Bayer — November 17, 2026

## Plain-language summary

**Keep signed AHD as the default. Do not add an automatic LMMSE noise switch
from this trial.** Faithful RawTherapee LMMSE is a useful comparison, but the
tested gamma/median option is not a dependable improvement with our current
Denoise. It improves held-out public-pair SDR fidelity by **0.25 dB**, less than
the previous own MMSE-style trial's **0.55 dB**. It also reconstructs clean fine
text, stars and fabric substantially better than AHD before Denoise. Those
benefits do not survive consistently across noisy pictures and default Denoise.

Most importantly, it **does not remove Canon's dark pits**. With crop-local
calibration the fixed shadow dark-tail fraction rises from **0.700% to 4.921%**.
Whole-photo calibration changes that particular result substantially: dark-shadow
tails become similar, but flame-edge dark tails rise from **0.129% to 0.513%**.
Sony lettering also acquires more dark/bright tails. This is an interaction
between reconstruction and estimated Denoise strength, not evidence that every
LMMSE picture has seven times as many defects.

On the minimum 8 GB Mac, the bounded scalar research implementation takes about
**twice as long for development plus Denoise**: 16.15 versus 7.97 seconds at
18 MP, and 36.23 versus 16.88 seconds at 42 MP. These are CPU research-pipeline
costs, not the wait measured in the app. No GPU port or speed-up is claimed.

This work changes only research tools, tests and notices. No production path,
saved project, memory budget or agreed quality limit changes. IGV and upstream
optional edge-reinforcement settings have **not** been quality-qualified.

## Pre-measurement contract

Use the frozen preceding signed-full inventory, seeds, capture gains, masks and
12 decision rows. Primary Off and AHD use the installed production signed AHD
core on the harness's common normalized sensor/identity temporary-DNG Lab bridge.
Both noisy and clean Bayer develop signed. Keep the earlier research signed-AHD
support for lifted-shadow tails so the dark-pit comparison cannot move its mask.

Every classical candidate uses the `dark_noise` informative-calibration repair
and current shipping controls: Amount .75, Luminance .5, Color Noise .75,
Detail Recovery .5 and all frequency sizes .5. RawNIND Bayer runs alone; its
existing negative-input clipping and model-training splits remain explicit.
No fitting to clean ground truth or new camera calibration is allowed.

Fix upstream `iterations=3`: gamma 2.4/slope 17 and two differential-colour
median passes. This is a declared upstream option, not a claim about a current
RawTherapee application preference. The prior own MMSE-style adapter remains a
separate reference. Include upstream linear iterations=0 as clean-input
sensitivity only. IGV is optional; do not delay the priority measurements for it.

Use inherited ±10% descriptive CPU timing allowance on the same minimum Mac,
because these are single-run bounded research costs with run-to-run variation,
not live action-to-screen targets. Keep all existing quality guards; diagnostic
PSNR/artifact/tail numbers do not establish new acceptance thresholds. A shipping
CPU/GPU implementation must agree on finished pixels: SDR ΔE2000 and HDR ΔE ITP
mean <1, p99 <3. Finished HDR must never exceed the chosen cap before encoding;
the encoder's 1% rounding allowance does not apply to these floats.

Prioritize quick synthetic, pristine clean charts/low-noise inputs, Canon crops
and held-out pairs; then full/seen/safety/native if the actual heavy work remains
well below approximately 90 minutes. Every heavy process uses the shared machine
lock and the existing 2.5 GB process-tree guard. Retain small PNGs/receipts only.

## Upstream and signed adaptation

RawTherapee GPL-3.0-or-later, commit
`64c2d90a3248c7ad41842d9162368858b61aac6a`, file
`rtengine/lmmse_demosaic.cc`; vendored SHA-256
`d1064f21cbae0c4a97580698f577b5d63fe919e907d77483b30f1be3ac4a11ba`.
The complete source is byte-for-byte upstream. It attributes Zhang and Wu's
2005 directional LMMSE paper, Jacques Desmis's 2013 RawTherapee adaptation and
Ingo Weyrich's 2015 speed/memory work. `vendor/rawtherapee/NOTICE` and root
`THIRD_PARTY_NOTICES.md` record the licence and the same-commit gamma/LUT helpers.

The build substitutes a small scalar host interface, not a rewritten MMSE
formula. It retains the original directional estimates, 9-tap Gaussian-like
low-pass, nine-observation variance/error estimators with `1e-7` stabilizers,
variance-weighted fusion, colour-difference interpolation and median passes.
The stock control preserves the upstream range gates and final positivity floor;
a separately compiled unmodified upstream body checks that adaptation.

Literal upstream LMMSE is unsigned: its gamma input, candidate estimates,
colour differences and final output clip ranges. Signed mode explicitly removes
those gates/floors, continues the gamma toe linearly below zero, and uses the
same analytic gamma pair above white. A first LUT-end extrapolation attempt
introduced a neutral above-white round-trip error; a new constant-field test
caught it and the implementation was fixed, not the tolerance. This signed
domain extension is not an assertion that stock RawTherapee accepts negative
samples. SIMD/OpenMP/GUI integration is not copied or qualified.

Optional upstream edge reinforcement (iterations 5–8) is retained and stock-
oracle tested, but requires whole-image mode because its updates are in-place.
The measured candidate uses iterations 3 and exact tested 32px-context strips.
No non-commercial code, dataset image, photograph or model weight enters Git.

The stock comparison compiles the original upstream body independently of the
signed source substitutions, **with the same small host shim**. It proves that
the substitutions leave stock-mode results unchanged; it is not an independent
full RawTherapee application oracle. The final shim corrects its unsigned-only
gamma endpoint to upstream's `index > 65534` behavior. That correction cannot
alter the signed measurements. Gamma helper provenance is `rtengine/color.h`,
`rtengine/color.cc` and `rtengine/LUT.h` at the same commit. Upstream source:
<https://github.com/RawTherapee/RawTherapee/blob/64c2d90a3248c7ad41842d9162368858b61aac6a/rtengine/lmmse_demosaic.cc>.

IGV is in `rtengine/demosaic_algos.cc` at that commit, not a separate
`igv_demosaic.cc`. It needs a separate implementation/host adaptation and signed
qualification; it was not cheap enough to add incidentally. Nothing here judges
its quality.

## What was compared

| Label | Development and filtering |
| --- | --- |
| Off | Production signed AHD core, no Denoise |
| AHD + Denoise | Same signed AHD; calibration repair; shipping controls |
| RT LMMSE + Denoise | Faithful signed-domain port, iterations 3; same repair/controls |
| Previous MMSE + Denoise | Prior own directional MMSE-style code; **not upstream LMMSE**; same repair/controls |
| RawNIND Bayer | Existing Bayer model alone, no extra current Denoise |
| Clean | Matched low-noise capture when available; analytic truth for separate clean charts |

All primary samples share sensor normalization, white balance and ACEScg
conversion. The AHD bridge calls the installed production signed helper using
normalized samples scaled by 65535 and an identity temporary-DNG Lab matrix.
This isolates the algorithm; it is **not full real-camera import qualification**
of the production camera-specific Lab setup, highlights, lens correction,
orientation or preview preparation. The clean reference for the main noisy
synthetic/public comparison also uses this AHD bridge. The earlier own-MMSE
report used the old research signed AHD, explaining its slightly different
34.91 dB baseline; this run's AHD is 34.93 dB. Do not merge those runs as identical.

The frozen inventory SHA-256 is
`ffcb7ee7afbea2b0a533b30806b3a0f8de059a66cc93e9fec26da6bf79ed554c`.
Existing deterministic seeds, clean/noisy gains, masks, public-pair split and
decision rows were reused. Public pairs and model weights were reused locally,
not downloaded into Git. Private photographs came only from the approved
`<photosRoot>/HDR Test Images`. RawNIND retains its existing negative-input
clipping: it is **not a signed-domain-preserving control**. Public held-out and
training-seen scenes are reported separately; no model was fitted here.

Completed under the shared machine lock and 2.5 GB process-tree guard:

- Quick: 21 synthetic/reference cases plus two private cases.
- Full: 27 synthetic/binned-RAW cases plus eight private cases.
- Held-out: 19 crops, six captures, four scenes.
- Seen by RawNIND: 33 crops, 13 captures, seven scenes.
- Clean-input study: seven pristine analytic charts, two binned low-ISO RAW
  surrogates and one clean-reference input from each held-out scene: 13 subjects.
- Fixed 12 decision rows, native 18/42 MP runs and the exposure/HDR safety grid.

Public aggregates give equal weight to crops within a capture, captures within
a scene, then scenes. No confidence interval or statistical significance claim
is made from this small scene count. The private pictures have no clean truth.

## Public-pair results

Higher PSNR/SSIM is better; lower finished-presentation colour difference is
better. HDR metrics here use the harness HDR presentation, not an encoded export.

### Held-out scenes: primary evidence

| Method | SDR PSNR dB | SDR SSIM | HDR PSNR dB | HDR SSIM | Mean ΔE2000 | Mean ΔE ITP |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Off | 27.68 | .5904 | 33.33 | .7851 | 7.064 | 17.819 |
| AHD + Denoise | 34.93 | .8890 | 41.68 | .9647 | 2.926 | 6.947 |
| RT LMMSE + Denoise | **35.18** | .8933 | **41.88** | .9645 | 2.909 | 6.713 |
| Previous MMSE + Denoise | 35.48 | .9018 | 42.17 | .9686 | 2.809 | 6.498 |
| RawNIND alone | 35.06 | .8958 | 42.00 | .9672 | 2.983 | 6.523 |

The faithful port gains **0.250 dB SDR / 0.200 dB HDR** over repaired signed
AHD. It narrowly beats RawNIND's SDR PSNR, but not its HDR PSNR or SDR SSIM.
The own-MMSE trial remains ahead on these aggregates, without solving its
previously documented clean-input/dark-pit problems. No method earns a shipping
decision on average PSNR alone.

### Training-seen scenes: separate diagnostic

| Method | SDR PSNR dB | SDR SSIM | HDR PSNR dB | HDR SSIM |
| --- | ---: | ---: | ---: | ---: |
| Off | 29.31 | .6998 | 36.42 | .8802 |
| AHD + Denoise | 34.17 | .8671 | 41.23 | .9539 |
| RT LMMSE + Denoise | 34.26 | .8677 | 41.10 | .9536 |
| Previous MMSE + Denoise | 34.53 | .8721 | 41.49 | .9557 |
| RawNIND alone | 33.92 | .8670 | 41.18 | .9530 |

LMMSE gains only 0.091 dB SDR here and **loses 0.129 dB HDR** to AHD. These
scenes cannot provide an independent estimate of RawNIND generalization.

## Synthetic, structure and clean-input checks

### Noisy synthetic/reference averages

| Method | Quick SDR / HDR dB | Full SDR / HDR dB |
| --- | ---: | ---: |
| Off | 23.63 / 26.80 | 23.16 / 26.49 |
| AHD + Denoise | 28.65 / 31.99 | 33.15 / 37.16 |
| RT LMMSE + Denoise | 25.58 / 29.66 | 30.77 / 34.91 |
| Previous MMSE + Denoise | 28.33 / 31.74 | 33.80 / 37.80 |
| RawNIND alone | 24.37 / 29.22 | 30.74 / 35.93 |

These numbers favor AHD structurally because the reference is AHD development of
the clean mosaic. They are useful pipeline regression diagnostics, **not proof
that AHD is the best demosaic**. Quick and full are different case/noise mixes,
not repeated measurements of the same mean. The analytic clean chart study
below deliberately removes this reference bias.

### Clean, noise-free analytic input

SDR PSNR against the original camera-gamut chart, **without Denoise**:

| Subject | Signed AHD | RT LMMSE | RT linear (0) | Previous MMSE |
| --- | ---: | ---: | ---: | ---: |
| Slanted edge | 41.84 | 43.35 | 39.65 | 41.95 |
| Siemens star | 32.02 | 36.34 | 30.67 | 32.23 |
| Fine text | 23.31 | 29.33 | 25.18 | 25.08 |
| Colour patches | 28.15 | 29.42 | 27.49 | 28.10 |
| Smooth gradient | 79.16 | 44.18 | 43.74 | 79.94 |
| Star field | 38.39 | 44.26 | 42.07 | 42.00 |
| Fabric | 22.44 | 32.49 | 21.60 | 21.89 |

The faithful gamma/median option is **much better than the earlier own-MMSE
trial on several clean high-frequency charts**. Inspected PNGs show less false
colour on fine text/fabric; the Siemens center still has coloured aliasing, not
an artifact-free reconstruction. Descriptive clean fabric chroma-error RMS
falls from .0811 AHD to .0252 LMMSE (previous .0852). Luma second-difference and
Laplacian residual RMS also fall: .0427/.0809 to .0199/.0358. These are residual
bands, **not independently validated zipper/maze detectors**, and cannot prove
that natural images are artifact-free.

The gradient's lower PSNR is not by itself a visible regression: LMMSE mean
ΔE2000 is **.095**, p99 **.240**, versus AHD .017/.124. Conversely, higher edge
PSNR does not guarantee every edge improves: clean slanted-edge p99 ΔE2000 rises
from 3.22 to 6.28 even though its mean remains .151. No new gate is set from
either diagnostic.

With the requested **default Denoise still enabled on clean inputs**, fine-text
LMMSE falls from 29.33 to **26.33 dB**, and fabric from 32.49 to **25.26 dB**;
AHD fabric after Denoise is 25.31 dB. The shared single-frame estimator can treat
reconstructed fine texture as noise. Thus LMMSE's clean reconstruction advantage
does not establish a global default for the complete current chain.

The two binned low-ISO RAWs are surrogates, not noise-free laboratory captures.
Against their AHD-developed reference, LMMSE mean/p99 ΔE2000 is .634/2.598 and
.491/2.354. Four held-out clean-reference inputs also change (means .648–2.077).
Those comparisons measure **difference from AHD**, not accuracy or fine-detail
loss against independent real-photo truth. Full-resolution low-noise natural
photo qualification is still missing; the synthetic charts provide the stronger
clean-detail evidence in this trial.

### Noisy edges, halos, bleed and texture bands

On the full-set slanted edge, MTF50 (cycles/pixel) at ISO 1600/6400/25600 is
AHD **.210/.169/.140**, LMMSE **.193/.162/.127**, previous **.217/.172/.139**;
RawNIND **.184/.180/.179**. Clean AHD reference is .211. Maximum additional
halo across those levels is .00264 AHD, .00755 LMMSE, .00469 previous and
.08965 RawNIND in this metric. LMMSE is not a uniformly sharper noisy chain.

At ISO 25600, fine-text SDR/HDR PSNR is 22.81/26.51 AHD versus 21.95/25.40
LMMSE; star-field is 29.50/24.78 versus 24.87/22.42. Mean/p99 colour-bleed proxy
on text is .174/.661 AHD versus .183/.682 LMMSE, and on stars .056/.363 versus
.089/.418. Colour-patch bleed improves (.175/.691 to .132/.586) while its
HDR PSNR gets worse (30.85 to 22.18). These trade-offs forbid a one-metric win.

At fabric ISO 25600, energy ratios in bands σ=.5/1/2/4 are
AHD **.0011/.0208/.0667/.0681**, LMMSE **.0012/.0232/.0813/.0860**,
previous **.0010/.0178/.0536/.0541**, RawNIND **.0074/.2128/1.2112/1.2366**.
LMMSE retains a little more coarse energy than AHD but still removes nearly all
finest-band energy. Corresponding error-energy ratios are
AHD .989/.899/.664/.666 and LMMSE .988/.883/.614/.618. Energy alone cannot
separate recovered texture from invented structure; compare the crops.

## Canon lifted shadows and real crops

Fixed supports are inherited **unchanged** from the earlier research signed-AHD
Off picture: Gaussian-σ2 luma <.02 before lift, two-pixel erosion, four-pixel
border excluded. Evaluate the same 288px areas at +4 stops. Tail fractions use
the preceding local-median contrast proxy, not a clean reference: genuine fine
detail can count. No new threshold, mask or calibration was chosen per method.

Crop-local calibration, dark fraction / bright fraction (%), absolute luma p99.9:

| Method | Flame edge | Dark shadow |
| --- | ---: | ---: |
| Off | 28.141 / 25.559 / .3820 | 29.224 / 29.391 / .3602 |
| AHD + Denoise | .126 / .102 / .0758 | .700 / .483 / .1643 |
| RT LMMSE + Denoise | .312 / .334 / .1489 | **4.921 / 3.766 / .2611** |
| Previous MMSE + Denoise | .896 / .804 / .2294 | .519 / .298 / .1434 |
| RawNIND alone | 0 / 0 / .0094 | 0 / .017 / .0137 |

Visual inspection agrees that the primary LMMSE Canon shadow column has denser
black/coloured fine speckles and rims. AHD still has pits. RawNIND's cleaner
tail proxy does not erase its clipping and detail trade-offs.

**Whole-photo preparation is materially different.** Native 18 MP calibration
gives dark-shadow dark/bright fractions .760/.500% AHD and .702/.549% LMMSE;
luma p99.9 .1695/.1741. The sevenfold crop-local dark-tail increase is **not**
reproduced there. But native flame-edge dark/bright fractions worsen from
.129/.110% to .513/.495%, p99.9 .0769 to .1898. On native 42 MP Sony lettering,
dark/bright fractions rise from .915/.862% to 1.901/1.513%; on the flat wall
from 0/0% to .008/.006%, p99.9 .0095 to .0295. LMMSE changes the calibration
estimate as well as pixels; replacing demosaic alone does not reliably fix
the dark-pit complaint.

### Linear-option sensitivity, not a second full trial

After the primary results, the predeclared clean-input iterations 0 option was
extended to the **same 12 noisy decision rows**, with no parameter fitting.
This post-hoc diagnostic is labeled in `linear-sensitivity.json` and in the
review column. Its Canon dark-shadow dark/bright fractions are .536/.330%,
luma p99.9 .1467, and flame edge .064/.094%, p99.9 .0596. This is promising
relative to primary gamma LMMSE, **but it does not qualify the option**:
no complete held-out/seen/full/native/safety run was done for it; clean fabric
and Siemens results are worse than gamma LMMSE. Do not transfer the primary
port's safety/performance claims to that option or select it on these rows.

## Exposure and HDR safety

Three ISO 6400 subjects (patches, stars, fabric), 13 one-stop settings from
−6 through +6 and four classical columns give **156 combinations**. All output
is finite; exposure-normalized SDR/HDR differences are exactly zero for the
power-of-two exposure change. Exposure is applied **after** reconstruction;
this is not an ISO/noise sweep or a different demosaic operating point.

Each combination also passed the **actual production CPU finished-renderer**
check at 1000 nits, with maximum finished output **1000.0 nits** and no
pre-encoding allowance. No GPU demosaic, encoded export, camera highlight
reconstruction or full import integration was validated by that grid. RawNIND
was not included in this classical safety grid; its existing study remains
separate. CPU/GPU perceptual parity has not been measured because no GPU port
was built.

## Native CPU cost on the minimum Mac

November 17; MacBook Neo, Apple A18 Pro, 8 GB; one CPU/native thread; shared
lock; scalar upstream body, no SIMD/OpenMP; 256-row development strips with
32px context, bounded Denoise windows. One run per method, not a statistical
benchmark. The predeclared ±10% descriptive allowance applies on this machine
only. Do not compare these costs with PC results or RawTherapee's optimized app.

| Input / method | Development alone s | Calibration s | Denoise filter kernels s | Complete research development + Denoise s |
| --- | ---: | ---: | ---: | ---: |
| Canon 18.0 MP signed AHD | 1.38 | 1.99 | 3.95 | 7.97 |
| Canon 18.0 MP RT LMMSE | 7.11 | 3.26 | 3.92 | 16.15 |
| Canon 18.0 MP previous MMSE | 1.16 | 1.51 | 4.19 | 7.24 |
| Sony 42.4 MP signed AHD | 3.72 | 2.13 | 9.75 | 16.88 |
| Sony 42.4 MP RT LMMSE | 17.13 | 3.43 | 10.08 | 36.23 |
| Sony 42.4 MP previous MMSE | 3.07 | 1.61 | 12.55 | 18.40 |

Development-alone is a **separate checksum-consuming strip traversal**. Complete
time starts anew and includes calibration, repeated demosaic reads/context,
window overhead and Denoise; do not add development-alone to it or expect its
columns to sum. File opening is included, no disk-image export. The research
reader does not retain a full RGB frame/cache. Maximum process-tree RSS during
all experiments was 1.213 GB; native runs peaked at .750/.872 GB. These are
process-tree RSS guards, not macOS physical-footprint or whole-app residency
measurements. The test-suite guard is reported separately below.

The complete LMMSE research wait is **2.03× / 2.15× AHD**, not an improvement
that would justify a new GPU route by itself. No action-to-screen app timing
was measured, and no production performance claim or budget change is made.
All ten experiment guards exited successfully, with no memory/time abort;
their combined command wall time was about 9.6 minutes, excluding lock waits,
setup and fast suites. The approximately 90-minute stop condition was not reached.

## Crops to look at

Local output is deliberately not committed. Open
`codebase/output/denoise-v1/lmmse-demosaic/decision/index.html`: **12 rows**,
288px PNGs, same display lift within a row. Columns are Off, AHD + repair,
faithful LMMSE + repair, previous MMSE + repair, RawNIND alone, post-hoc linear
LMMSE + repair and clean where available. No-clean-reference cells are explicit.

1. Canon dark shadow: the primary gamma LMMSE speckles; then compare the
   whole-photo crops in `native-crops/canon-dark-shadow/`, not just local crops.
2. Canon flame edge/lifted flame: pits, bright rims and their native counterparts.
3. Sony lettering and flat wall: preserved characters versus newly visible tails.
4. Held-out print dots, foliage, smooth and shadow: modest average gains versus
   individual texture/color changes.
5. Noisy fine text, stars and fabric: the reconstruction/denoising trade-off.

The separate `clean-crops/index.html` shows 13 subjects **without Denoise**.
Look first at fine text, Siemens star, fabric, star field and smooth gradient;
then the real low-noise surrogates. Quantitative after-Denoise clean scores are
in `clean.json`. Native PNGs are small decision crops, not full-size retained
renders. Review folders can be deleted after Steve has reviewed them; no
original photos or model/dataset directories should be deleted with them.

## How this would ship, if later evidence justified it

**No shipping implementation is proposed from these results.** An eventual
CPU implementation would reuse the signed, pinned algorithm with independent
camera integration tests, native compiler packaging and GPL notices. A noise
decision would use measured, normalized per-CFA shot/read noise, not camera ISO
alone. No numeric noise threshold is earned by these data: cameras, negative
sensor fraction, scene texture and crop/full-frame calibration interact, and
there is no validated crossover that protects both clean detail and tails.
The only supported selection rule today is **AHD at every noise level**.

For `codebase/frontend/library-gpu-raw.js`, a future port would replace only
its AHD reconstruction stage, keeping the signed black subtraction, sensor
normalization, white balance, highlight, lens and orientation contracts in
their existing places. Implement separate float32 compute passes for
directional estimates/differences, 9-tap low-pass, local variance/error fusion,
green reconstruction, missing colour differences and the two median passes.
Concretely, replace `GREEN`/`HOMOGENEITY` and the AHD selection part of
`COMBINE`, not the finishing/lens tail. Its current `ints` buffer holds signed
black-subtracted sensor counts; normalize by the CFA channel range before
LMMSE and apply white balance/camera conversion once afterwards. Do not feed
the already-white-balanced `norm` buffer into this unbalanced CPU algorithm,
or apply `COMBINE`'s inverse-range scaling a second time.
Use the same gamma table/constants, signed negative toe and analytic above-white
extension. Preserve each pass's dependencies with separate dispatches/buffers;
do not assume invocation order, half-float precision or reassociation is safe.
Median passes need ping-pong storage. The unqualified optional in-place
refinement needs a separate deterministic design, not a literal parallel copy.

Five full-frame float32 working planes alone cost about **848 MB at this
42.4 MP size**, before input, RGB output and other app ownership. Use bounded
tiles and the tested 32px context, checking seams again for the GPU sequence;
the CPU strip result is not a GPU memory/parity proof. Fit existing reservations
and admission in the memory PRD, without a new cache or enlarged budget. The
research 2.5 GB process cap is not the app's approved 4 GB minimum/default.

Before adoption, check CPU/GPU **finished** SDR ΔE2000 and HDR ΔE ITP
**mean <1, p99 <3**, separately per picture/case, all four Bayer layouts,
odd dimensions/borders, clean/noisy charts and photos, negative/above-white
samples, zoom/tile seams and −6…+6 exposure. These are the requested agreement
limits, **not measured outcomes**. Keep the exact HDR cap before encoding and
the established encoded rounding rule. Proof/export agreement and all affected
delivery guards remain required. GPU failure gets one attempt then CPU fallback,
unless it is a qualifying external transient; existing GPU routes stay intact.
Measure the whole visible wait before deciding a new GPU route is worthwhile.

## Risks and recommendation

- Small public scene count and an AHD-developed reference limit fidelity claims.
- Gamma/median reconstruction changes both texture and the single-frame noise
  estimate; equal slider values do not imply equal effective smoothing.
- The signed extension intentionally differs from unsigned upstream behavior.
  A same-shim stock oracle is useful but not a full RawTherapee-app comparison.
- Natural clean photos lack independent truth; chart improvement does not prove
  no zipper/maze/detail loss on all clean photographs.
- CPU is scalar and Windows/GPU execution is untested; no shipping latency or
  app-memory result is inferred.
- Iterations 0 merits a separate preregistered investigation only if desired;
  iterations 5–8 and IGV remain unmeasured, not rejected algorithms.

**Recommendation: retain signed AHD, keep this port research-only, and do not
spend time on a GPU implementation or a noise-level switch now.** It answers
the prior report's explicit missing upstream comparison: faithful LMMSE really
does improve several clean structures and modestly improves the held-out
average, but the current complete chain still has scene-dependent tails,
texture loss and higher CPU cost. A negative adoption decision is useful here.

## Reproduction, receipts and validation

Adapter: `codebase/tools/denoise_eval/candidates/lmmse_demosaic.py`;
runner: `lmmse_measure.py` beside it; fast behavioral tests:
`codebase/tests/test_denoise_lmmse.py`. See the harness README's faithful-LMMSE
section. Every heavy command uses the shared lock then the existing process-tree
guard. `--phase` accepts quick/full/heldout/seen/clean/decision/sensitivity/safety/
native/review; native also takes `--photo`. The sensitivity phase must run after
decision and updates that same page in place.

Receipts under `codebase/output/denoise-v1/lmmse-demosaic/`:
`quick.json`, `full.json`, `heldout.json`, `seen.json`, `clean.json`,
`decision/manifest.json`, `linear-sensitivity.json`, `safety.json`,
`native-IMG_0790.json`, `native-2025_0730_1331_3.json`, the ten `*-guard.json`
files and linked PNG pages. JSON includes code hashes, upstream commit,
controls, inventory hash and machine. Primary receipts identify research
commit `b28b705267536924437ec89e8014f73c8c7ce38f`; supplemental sensitivity/native
receipts also record the later working-code hashes. That supplement adds a
phase and an unsigned-only shim fix, not a new signed primary algorithm.
The final adapter also explicitly exports its entry point for Windows DLL
loading; that declaration does not change Mac arithmetic. Windows execution
still needs confirmation with `clang++` available, not per-machine source edits.

Fast validation, serially under the same shared lock and process-tree guard:

- `node --test tests/*.test.js`: **1,091 passed, one skipped, zero failed**.
- `.venv/bin/python -m pytest tests -q`: **4,144 passed, 150 skipped,
  one xpassed**, zero failed. Existing Starlette/httpx deprecation warning.
- Includes **45 new behavioral tests**: all four Bayer patterns, signed neutral
  fields including above-white, exact strip equality for iterations 0–4,
  unfiltered measured-site retention, stock/signed domain differences,
  separately compiled stock body for options 0–8, installed production AHD
  bridge, unchanged controls, single exposure application and invalid inputs.
- Both suite guards exited 0 without abort; final peak tree RSS .739 / 1.988 GB.
- No broad GPU/Library smoke substitutes for this CPU-only research adapter:
  no existing app GPU driver covers it. GPU agreement is future work, not a pass.

Output census: **12.9 GB initially, 13.0 GB finally**, below the 100 GB limit;
12.9 GB is the existing shared test-photo store. Dataset/model symlinks reuse
existing inputs, and no images, models or test photos are staged. No production
code, module PRD, brief log or performance table is edited, as requested.
The final decision page has exactly 12 rows and 79 checked 288×288 PNGs,
6.85 MB of PNG data, within its unchanged 13 MB folder allowance.
