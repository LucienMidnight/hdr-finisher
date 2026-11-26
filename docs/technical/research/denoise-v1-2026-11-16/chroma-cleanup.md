# Green–magenta colour cleanup — November 17, 2026

## Result in plain language

**Colour-only cleanup can fade the remaining green/magenta blobs, but none of
these trials removes them convincingly while keeping real small colours safe.
Do not add a new automatic cleanup from this research.** Brightness detail
surviving is not enough: a star or a fine letter can keep its outline and lose
its correct colour.

The strongest colour-only control, a 9×9 green–magenta median **after** Denoise,
reduces the separate green/magenta island count from **38 to 15** across the
eleven flatter gallery windows, about 61%. The total speck count falls only
from **141 to 115**. It keeps linear luminance, so it cannot repair the remaining
brightness pits. On clean simulated coloured lights it retains only **41%** of
the green–magenta colour signal; fine coloured lettering retains **45%**, small
coloured petals **77%**. These are colour-strength measurements, not star
brightness or total light lost.

The protected pre-Denoise repair is much less destructive, but also much less
useful: its best 5×5 setting changes **38 to 35** colour islands. Local green
balancing changes 38 to 40. The requested camera-G-holding colour medians make
the final gallery worse with current Denoise. Keeping luminance explicitly does
not make that median/Denoise combination succeed.

**Best at suppressing colour:** the unguarded 9×9 post-Denoise control, with an
unacceptable small-colour trade-off. **Best conservative targeted setting:**
2σ, 5×5 statistics, area≤9 or 25; its small gain does not justify adding another
stage. Keep the approved 2.5σ sensor taming and current defaults as the baseline.
No candidate earns a general shipping recommendation.

## Scope and reproducibility

Research adapters, tests and documentation only; no app code, saved fields,
shipping defaults, caches, memory budgets or quality tolerances change. Nothing
is pushed. Adapter implementation: `cc48b535`; each receipt records Git HEAD,
the exact source hashes and frozen inventory hash. The initial double-colour-
conversion mistake was caught during inspection, fixed with a constant-field
regression test, and **all affected measurements were discarded and rerun**.
Only the corrected receipts below support this report.

MacBook Neo, Apple A18 Pro, 8 GB, one CPU/native thread. Every heavy phase uses
the shared cross-worktree `tools/gpu-run-lock.py` and the existing 2.5 GB
process-tree guard. The lock is released between phases for the other agent.
Timing retains the inherited ±10% descriptive allowance; a single small timing
difference is not a speed improvement. The requested two-hour heavy-work stop
condition applies. No new quality acceptance threshold is inferred from these
diagnostic counts or colour-strength ratios.

Inputs are the unchanged preceding `dark-noise/signed-full/results-full.json`
inventory, approved private photos only from `<photosRoot>/HDR Test Images`,
and existing CC0 RawNIND RAW/pair files linked read-only from the shared research
store. No photo, public pair, checkpoint or generated image is committed; no
model/runtime download is required. Commands and factories are documented in
`codebase/tools/denoise_eval/README.md`, “Green/magenta colour cleanup”.

The signed AHD is the **same frozen research bridge as early-outlier-taming**
(identity temporary-DNG Lab matrix), not a claim to qualify every production
RAW setting. Both noisy and clean Bayer develop signed. Baseline Denoise uses
the earlier `dark_noise.factory()` informative-calibration repair and shipping
controls: Amount .75, Color Noise .75, Detail Recovery .5, Luminance .5, all
sizes .5. This reproduces the earlier **547 → 141** flat-window control exactly.
All candidates add to the approved per-CFA 2.5σ / envelope1.5 / strength.75 /
area≤5 / neighbour-supported taming. Current-without-taming and signed noisy
Off are separate controls. White balance and camera conversion run once.

## What was implemented

All implementations are our own GPL-3 research code in
`codebase/tools/denoise_eval/candidates/chroma_cleanup.py`. No upstream code is
ported and no new third-party source is bundled. These are tests of the named
techniques, **not pixel-identical RawTherapee or darktable implementations**.

1. **Green equilibration before AHD.** Estimate each green phase's local mean
   in 5×5 CFA-cell windows. Where both local variances are at most twice the
   provisional sensor-noise variance, shift the two green samples in opposite
   directions by .375 times the difference. Each cell's green sum stays fixed;
   red/blue, saturated neighbourhoods and borders stay untouched. This tests
   local green mismatch, not whether all green-looking defects originate in
   the two green filters.
2. **False-colour medians after AHD, before Denoise.** Apply one or three
   3×3 median passes to R−G and B−G in signed camera RGB, holding camera G.
   `median1_y` additionally restores original ACEScg luminance before Denoise.
   Holding G alone is **not** holding luminance. Re-estimate Denoise normally
   on each candidate; a separate frozen-model diagnostic isolates that effect.
3. **Targeted green–magenta repair before Denoise.** Use ACEScg
   `q=G−(R+B)/2` and `t=R−B`. Compare q with its 5×5 median, with noise equal
   to the larger of local residual MAD×1.4826 and 50% of the un-interpolated
   sensor sigma propagated through WB/matrix. The latter is a provisional
   interpolation approximation, not calibrated post-AHD noise. Sweep k=2/3/4
   and same-sign connected area≤1/9/25. Two similar outer-ring neighbours
   within one local sigma veto repair; count component size before the veto.
   A smooth ramp from k to 2k moves up to 75% toward the median. Change only q,
   preserve t and linear luminance. Test green+q and optional t repair too.
4. **Explicit placement/scale follow-ups.** After the first narrow-scale trial,
   test the same protected operation after Denoise, first with a 10% propagated
   sensor-noise floor, then local residual MAD with a numerical 1e−7 linear
   floor scaled by exposure. Extend to full 9×9 statistics, support ring4–6px,
   k=2/3 and areas25/81. These are labelled follow-ups, not an untouched holdout
   search. The **unguarded 9×9** control simply moves q 75% toward its median
   after Denoise without a noise threshold, size limit or support veto. It is
   the stronger cleanup/detail-risk control, not a proposed safe default.

For a q correction d, RGB changes by `d×(−Yg,1−Yg,−Yg)`, where
`Yg=.6740818`; this preserves ACEScg Y and R−B, to float rounding. The optional
orange–blue direction also preserves Y. Preservation belongs to that operation:
**a later Denoise pass or nonlinear/clipped display can change displayed
brightness**. Post-Denoise corrections preserve the actual Denoise output's
linear Y; this is separately regression-tested.

Technique references, checked November 17:
[RawPedia Demosaicing](https://rawpedia.pixls.us/demosaicing/) describes median
false-colour suppression and its colour-resolution trade-off;
[darktable demosaic manual](https://docs.darktable.org/usermanual/4.6/en/module-reference/processing-modules/demosaic/)
describes local/full green matching for differing green-filter responses.
RawTherapee and darktable are GPL projects; no source or licence text from them
is needed for these independent implementations. Earlier faithful LMMSE remains
separate and retains its own upstream notices.

## Measurements and clean-detail safeguards

- **Gallery:** all fourteen original 512px sensor windows; score the inset
  288px ROI. The forced Canon windows remain (x,y)=(4064,2164) and (600,1500).
  Original 48×48 worst spots stay fixed and are enlarged exactly 6×. Flat11
  excludes only `IMG_0790-2`, `MuseeL-Saint-Pierre-C500D_ISO3200-2` and
  `Blombukett_ISO6400-2`, as before; all three remain in the review.
- **Specks:** retain the preceding union RGB residual/island counter. The
  separate green/magenta mask uses finished SDR `G−(R+B)/2` minus its 5×5
  median, absolute residual>.08 and >.75×the absolute R−B median residual;
  eight-connected islands1–25, six-pixel border excluded. Positive/negative
  signs, pixel totals and p99.9 are retained separately. These masks overlap
  and group pixels differently: **do not add counts or treat their ratio as
  the percentage of proven noise that is green/magenta**. Real detail can count.
- **Lifted shadows:** inherited total +4-stop presentation, fixed signed-Off
  Gaussian-σ2 luminance<.02 before exposure, two-pixel erosion, border excluded;
  local-median luma/chroma p99.9 and dark/bright tails>.05. Here support is
  calculated within the scored 288px ROI; older full-context tail rows are not
  numerically interchangeable. The support is unchanged between candidates.
- **Pristine colour:** four noiseless subjects: coloured Gaussian optical
  lights (FWHM1.88/2.83/4.24 sensor pixels), thin coloured lettering, fine
  multicolour weave and small coloured petals. All include real green/magenta
  in the generated scene, plus orange/blue. These are sampled optical-profile
  simulations, not real astronomical captures or an exhaustive spectral test.
  Camera-gamut clipping and signed clean AHD are shared by every method.
- **Low-ISO photos:** the first accepted texture crop, by existing order, from
  ISO100 Pen-pile (thin printed/coloured edges), Vaxt (bark/fungi) and Blombukett
  (flowers). Exact source/crop/valid masks are in `review/clean/manifest.json`.
  The earlier fixed `heldout-foliage` leaf crop is added separately after
  visual inspection showed that the automatic texture selection was bark.
  It is selected by required subject, not a candidate score; the supplementary
  provenance and results are in `foliage.json`.
  Prepared clean RAW retains alignment, gain and reference noise. No clean
  sensor fit is stored, so its own ISO scales the inherited noisy fit's a/b;
  that is explicit provisional metadata, not a laboratory calibration.
- **Detail metrics:** finished SDR ΔE2000 / HDR ΔE ITP against signed clean;
  additionally score the fixed clean coloured-feature mask (display RGB range
  >.1, intersected with public valid support). Measure absolute displayed q
  signal on that mask relative to the taming baseline. This is **not total
  saturation, luminance flux or a universal detail score**. It exposes small
  real colours that a whole-image mean/p99 can hide.
- **Fidelity:** unchanged full synthetic/real harness and all public pairs;
  no truth is consulted at adapter runtime. Pair means average crops within
  capture, captures within scene, then scenes equally. RawNIND-held-out and
  RawNIND-seen populations remain separate; this trial does not run RawNIND.
  Held-out denotes the earlier network split, not an untouched set for this
  sequence of classical research experiments.

## Gallery results

Numbers below are **after the same default Denoise**, including the taming
baseline. “Total” counts local-contrast islands, not proven image defects.
Green/magenta signs may split/merge islands, so their separate counts need not
add to the combined count.

| Added method | Total, all14 | Total, flat11 | Green/magenta, flat11 | Green / magenta separately |
| --- | ---: | ---: | ---: | ---: |
| Signed noisy Off | 6675 | 5994 | 26941 | 43363 / 43730 |
| Current Denoise, no taming | 1658 | 547 | 231 | 79 / 188 |
| Approved taming alone | 1162 | 141 | 38 | 14 / 24 |
| Green balancing | 1171 | 138 | 40 | 15 / 25 |
| Camera-G median, one pass | 1340 | 330 | 72 | 15 / 57 |
| Camera-G median, three passes | 1576 | 576 | 64 | 12 / 52 |
| One median, preserve Y before Denoise | 1361 | 328 | 73 | 15 / 58 |
| Targeted GM 2σ, area25 | 1156 | 136 | 35 | 12 / 23 |
| Green + targeted GM | 1156 | 134 | 38 | 13 / 25 |
| Targeted GM + orange–blue | 1157 | 146 | 40 | 13 / 27 |
| Local-MAD 5×5 after Denoise | 1165 | 141 | 38 | 14 / 24 |
| Guarded 9×9 before Denoise, 2σ/area25 | 1154 | 139 | 36 | 12 / 24 |
| Guarded 9×9 after Denoise, 2σ/area25 | 1162 | 139 | 37 | 15 / 22 |
| Guarded 9×9 after Denoise, 2σ/area81 | 1164 | 138 | 33 | 11 / 22 |
| **Unguarded 9×9 after Denoise** | **1143** | **115** | **15** | **3 / 12** |

The requested pre-Denoise threshold/size sweep gives combined green/magenta
counts **38/35/35** for k2 and areas1/9/25; **37/37/37** for k3; **37/37/37**
for k4. Total flat specks are respectively 140/136/136, 143/141/141,
142/142/142. Larger area is not a general solution. The 9×9 pre-stage has
36/36 colour islands at k2, area25/81, and 37/37 at k3. The wider post-stage's
area81 gains a few more, but does not approach the unguarded control. The
5×5 post-stage with either sensor-floor or local-MAD noise leaves the flat
colour-island count unchanged throughout its sweep.

**The forced Canon spots remain difficult.** In window1, taming leaves 20 total
and 12 green/magenta islands; the strong 9×9 control leaves 16 and 8. In the
flame-edge window2, 393/136 becomes 405/140. Some counted marks there are real
structure; cleaning flatter shadows does not establish safe behaviour at edges.
The original zoom coordinates were not moved to make a method look better.

### Lifted-shadow tails

The first forced Canon window uses 76,176 fixed dark-support pixels; the second
31,871. Values are absolute finished-SDR local-median residual p99.9, with the
same total +4-stop lift. No clean truth exists for these private windows.

| Canon window | Method | Luma p99.9 | Chroma p99.9 | Dark-tail pixels, % |
| --- | --- | ---: | ---: | ---: |
| 1, shadow | Current, no taming | .15779 | .18149 | .6301 |
| 1, shadow | Taming | .04280 | .06629 | .0341 |
| 1, shadow | Targeted GM2/area25 | .04278 | .06500 | .0354 |
| 1, shadow | Guarded post9×9 | .04218 | .06562 | .0341 |
| 1, shadow | Unguarded post9×9 | .04275 | .05836 | .0407 |
| 2, flame edge | Current, no taming | .19232 | .18131 | .3797 |
| 2, flame edge | Taming | .04103 | .08527 | .0314 |
| 2, flame edge | Targeted GM2/area25 | .04061 | .08423 | .0345 |
| 2, flame edge | Guarded post9×9 | .04158 | .08623 | .0314 |
| 2, flame edge | Unguarded post9×9 | .03938 | .07934 | .0220 |

Colour-only repair leaves most of the luma-tail problem intact. Its small
finished-luma changes are compatible with preserving **linear** Y: the SDR
transform mixes channels, clips negatives/out-of-gamut values and is nonlinear.
The union count, colour count, tail pixels and p99.9 must be read together;
islands can disappear by joining larger patches rather than being corrected.

### Why the requested median can get worse

On three fixed windows, re-run median inputs with **the taming baseline's
Denoise model held fixed**, rather than recalibrating after the median. Canon
window1's one-pass median improves from 50 total / 27 GM islands to 26/15,
versus taming's 20/12. The first ISO12800 7D window improves from 69/18 to
19/1, versus taming's 13/4. Canon flame-edge remains worse (423/142 → 409/139,
versus 393/136). Thus calibration contributes, but freezing it is not a general
cure. This is an attribution diagnostic only: no full public/native qualification
or shipping recommendation for frozen-model medians is claimed.

## Real-colour detail: the decisive failure

Displayed green–magenta signal kept relative to **the same approved taming +
Denoise output**, on the fixed clean coloured-feature mask:

| Added method | Coloured lights | Fine coloured text | Fine coloured weave | Small coloured petals |
| --- | ---: | ---: | ---: | ---: |
| Green balancing | 100.0% | 100.0% | 100.0% | 100.0% |
| One camera-G median | 91.0% | 89.7% | 100.8% | 94.5% |
| One median, preserve Y | 90.5% | 89.6% | 100.7% | 94.1% |
| Targeted GM2/area25 | 95.4% | 93.4% | 100.1% | 95.0% |
| Guarded post9×9 | 97.5% | 93.4% | 100.0% | 90.8% |
| **Unguarded post9×9** | **40.6%** | **45.4%** | **99.6%** | **77.5%** |

Values above 100% can reflect reconstruction/noise changes, not better detail.
The strong median removes almost as much **real star colour** as it removes
counted false colour. Its clean-star feature ΔE2000 mean/p99 is **9.35/27.37**,
versus **1.02/15.76** for taming alone. On coloured text it is **15.07/42.14**,
versus **3.85/46.19**. The text p99 alone would misleadingly look better while
mean error grows and colour signal more than halves. The point/letter contours
still exist; that does not mean their colour detail survived.

Whole-image statistics can hide this: the clean star field's strong-median
incremental ΔE mean is only .086 because its coloured-feature mask contains
625 pixels. That is why the feature score and 6×/clean review matter more than
a diluted full-frame average. The weave is comparatively unaffected by this
strong post-stage; that single subject cannot certify small lights or lettering.

Real ISO100 references show additional colour/edge error too. Finished SDR
ΔE2000 mean / p99 against the signed clean reference, on valid support:

| ISO100 reference | Taming | Green balancing | One camera-G median | Unguarded post9×9 |
| --- | ---: | ---: | ---: | ---: |
| Pen-pile | 1.601 / 5.582 | 1.549 / 5.436 | 1.585 / 5.695 | 1.704 / 6.339 |
| Vaxt bark/fungi | 1.157 / 4.152 | 1.158 / 4.155 | 1.301 / 7.403 | 1.396 / 6.840 |
| Blombukett flowers | 1.389 / 5.554 | 1.387 / 5.550 | 1.534 / 8.200 | 1.873 / 9.099 |
| Added actual green foliage | 1.055 / 3.507 | 1.049 / 3.486 | 1.062 / 4.365 | 1.295 / 5.737 |

The added green-leaf crop retains 99.85% of its total GM signal under the
strong median, yet its p99 colour error rises from 3.51 to 5.74: a broad green
area surviving is not proof that its small coloured edges survive.

These photos retain reference noise and resampling; the comparison measures
incremental processing damage, not an independent perfectly noise-free natural
scene. Foliage's genuine green is not evidence of a defect to remove. No real
star-field, skin/hair or broader camera/spectral qualification is claimed.

## Full fidelity and public pairs

PSNR in dB, higher is better; SDR / HDR shown together. Full synthetic means
are arithmetic case means over 27 generated/binned-RAW cases; eight private
real crops have no truth and are excluded from those means. Quick has 21
synthetic + two private cases. Public held-out has 19 crops, six captures,
four scenes; seen has 33 crops, thirteen captures, seven scenes. Pair weighting
is crop→capture→scene as above, not pooled image error.

| Method | Full synthetic SDR / HDR | Held-out SDR / HDR | Seen SDR / HDR |
| --- | ---: | ---: | ---: |
| Current Denoise, no taming | 33.161 / 37.162 | 34.922 / 41.656 | 34.167 / 41.227 |
| Approved taming | 32.668 / 36.873 | 34.915 / 41.646 | 34.138 / 41.200 |
| Green balancing | 33.047 / 37.193 | 35.016 / 41.722 | 34.155 / 41.210 |
| Camera-G median1 | 32.279 / 36.323 | 34.887 / 41.569 | 34.357 / 41.357 |
| Camera-G median3 | 31.977 / 35.898 | 34.734 / 41.375 | 34.363 / 41.396 |
| Median1, keep Y before Denoise | 32.237 / 36.304 | 34.890 / 41.550 | 34.339 / 41.345 |
| Targeted GM2/area25 | 32.622 / 36.878 | 34.913 / 41.644 | 34.134 / 41.197 |
| Green + targeted GM | 33.000 / 37.194 | 35.015 / 41.720 | 34.152 / 41.207 |
| Targeted GM + orange–blue | 32.605 / 36.850 | 34.905 / 41.618 | 34.134 / 41.195 |
| Local-MAD post5×5 | 32.641 / 36.872 | 34.918 / 41.648 | 34.137 / 41.199 |
| Guarded pre9×9 | 32.609 / 36.863 | 34.921 / 41.651 | 34.132 / 41.194 |
| Guarded post9×9 | 32.639 / 36.866 | 34.924 / 41.651 | 34.136 / 41.197 |
| Unguarded post9×9 | 32.531 / 36.822 | 34.902 / 41.645 | 34.037 / 41.117 |

Green balancing supplies a small held-out gain, about .10 dB against taming,
without solving the gallery blobs. Medians improve the seen population but
lose on held-out and synthetic cases; these are different subjects, not a
controlled seen/held-out gap experiment. Strong post cleanup has essentially
unchanged held-out fidelity and worse seen fidelity while visibly harming
clean small colours. An aggregate score cannot excuse that specific failure.

Full receipts retain SDR/HDR ΔE mean/p99, SSIM, half-resolution scores,
flat residuals, texture bands, edge/halo and colour bleed. No all-contract pass
is claimed, and no inherited guard is weakened. Current Denoise's existing
fine-texture/edge limitations are not repaired by keeping Y in this extra stage.
The original Canon 6× zoom also retains its centre/rim structure: fading colour
is not a repair of the brightness structure.

## Native CPU cost and shipping requirements

Complete 5202×3464 Canon (18.02 MP) and 7968×5320 Sony (42.39 MP) frames,
MacBook Neo A18 Pro / 8 GB / one CPU-native thread. Consume every output pixel
into a checksum, using bounded sensor/AHD windows, one global Denoise model
per method and 768px filtering cores. No full-frame RGB/cache file is retained.
Times include RAW open, normalization, repeated development/model sampling,
filtering and the added cleanup; **not** EXIF, lens/highlight reconstruction,
finished delivery, live controls or action-to-screen latency. These are CPU
research costs, not a benchmark of optimized RawTherapee/darktable code.

All methods share 64px sensor-development context and 66px Denoise context.
The larger sensor context supports the wider experiment, so these timings are
not directly comparable with previous reports' 32px reader. Subclocks overlap
(reader development occurs during model preparation); do not add every JSON
column. Single runs retain the inherited ±10% descriptive allowance.

| Method | 18.02 MP, seconds | 42.39 MP, seconds |
| --- | ---: | ---: |
| Current, no taming | 9.56 | 19.11 |
| Approved taming | 12.01 | 25.37 |
| Green balancing | 12.06 | 25.48 |
| Camera-G median1 | 14.03 | 27.15 |
| Camera-G median3 | 13.57 | 28.40 |
| Median1, preserve Y | 12.99 | 27.65 |
| Targeted GM2/area25 | 16.21 | 33.38 |
| Green + targeted GM | 15.41 | 33.13 |
| Targeted GM + orange–blue | 18.73 | 40.20 |
| Local-MAD post5×5 | 13.77 | 30.67 |
| Guarded pre9×9 | 89.80 | 193.82 |
| Guarded post9×9 | 47.71 | 115.04 |
| Unguarded post9×9 | 25.01 | 61.39 |

The strongest colour-only cleanup adds **13.0s at 18 MP / 36.0s at 42 MP**
over taming in this protocol, for a complete **25.0s / 61.4s**. The protected
5×5 targeted repair costs **16.2s / 33.4s** to remove only three additional
counted GM islands. Protected pre9×9 costs **89.8s / 193.8s** for still less
colour cleanup than the unguarded control.

All retained measurement guards exit successfully: **37.8 minutes** of execution
excluding lock waits, setup, withdrawn preliminaries and the standard suites.
Maximum sampled tree RSS is **2.244 GB**, below the unchanged 2.5 GB research
cap; native 18/42 MP guards peak at 2.244/1.834 GB. These are process-tree RSS,
not whole-app physical footprint, and give no permission for an app cache or
budget change. The two-hour heavy-work stop condition was not approached.

The 9×9 implementation forms bounded NumPy median windows; it is a correctness
reference with substantial sorting and temporary-array cost. No speedup claim,
CPU production optimization or GPU timing is inferred. Green matching's small
cost difference is normal timing variation, not an improvement in app speed.

**Do not ship these wider CPU references as-is.** Before any integration:

- First solve or accept the real-colour-detail trade-off; speeding up the wrong
  result does not qualify it. No new GPU route is recommended from this trial.
- An accepted stage would need a bounded native CPU implementation and an
  implementation in the app's **existing** GPU RAW/Denoise route, preserving
  signed values, original highlight evidence, cancellation, correct CFA/tile
  support and existing memory ownership. Avoid a full-frame CPU readback merely
  to add this cleanup. New caches or budget changes need their own approval.
- Before claiming a GPU benefit, measure the whole action-to-visible-image wait.
  CPU/GPU finished agreement remains SDR ΔE2000 / HDR ΔE ITP mean<1, p99<3;
  qualify seams, exposure, import/highlight reconstruction, preview/Proof/export
  and exact finished HDR ceiling on both machines. This CPU study does none of
  that GPU/production delivery qualification. Keep one GPU attempt, then CPU
  fallback under the existing failure rule.

The protected versions' modest artifact gain does not justify that work now.
Green equilibration may still be appropriate for a separately established
sensor-phase mismatch; this trial does not establish one or reject the
upstream tools' camera-specific uses.

## Review and validation

Open `codebase/output/denoise-v1/chroma-cleanup/review/index.html`:

- Fourteen frozen gallery rows: noisy, current Denoise without taming, approved
  2.5σ taming, green balance, ordinary/Y-preserving median, targeted GM and
  wider pre/post comparisons. Tops are downscaled 288px ROIs; below each is
  the exact original 48px spot enlarged 6× with nearest-neighbour.
- Eight clean/detail rows: four noiseless coloured targets, three low-ISO
  texture references and the separately added actual green-leaf reference.
  Clean is always visible alongside processed versions.
- Start with `IMG_0790-1`, both ISO12800 7D windows, coloured lights/text and
  the actual green foliage. Look for colour lost from real objects as well as
  colour removed from noise. The private RAW rows have no clean truth.

The optional `cleanup-colour-tradeoff.html` chart contrasts the flatter-gallery
colour-island count with coloured-star GM signal retention; its two payloads
are mechanically checked. The main photo review is local and needs no network.
The optional inline chart uses the pinned Visualize chart runtime.

All 368 image references and the local stylesheet exist; selected real/noisy
and clean PNGs were visually inspected, including the actual leaf subject.
Research receipts, native costs, fixed-coordinate manifests and phase logs stay
under `codebase/output/denoise-v1/chroma-cleanup/`; generated pictures and public
data stay outside Git. The source adapters are not imported by backend/frontend
app code. No existing GPU driver directly covers these CPU research adapters;
no broad GPU sweep is substituted for that missing qualification.

Final checks on the same minimum Mac:

- **12 focused behaviour checks pass**, including exact approved-taming
  equivalence, four CFA green phases, finite output, constant-colour conversion,
  chroma-only Y/other-axis invariants, support/size and bounded-context behaviour.
- Complete JavaScript suite: **1,107 passed, one skipped**. Complete Python:
  **4,227 passed, 155 skipped, one existing xpass**, existing deprecation warning.
- The standard plain-Electron Library check completes its 90-second observation
  with no picture errors, 9/33 eligible photos pictured, five stored pictures
  with no zero channel/unreadable plane, and two GPU developments. This is the
  **viewport smoke scope**, not full collection coverage or candidate-GPU
  qualification. It records first-picture observation .4s and a longest gap of
  7s; no new response-time or full-coverage pass is inferred.

Earlier standard-check attempts used an unsuitable temporary root: `test-` in
its name confused one JavaScript safety fixture, and placing Python fixtures
inside the app's ignored output tree caused twelve Library/file-list failures.
Corrected system-temp invocations pass without changing tests or app code.
The first Library invocation was stopped by the **CPU-research-only** 2.5 GB
supervisor; the successful rerun uses the standard app monitor and unchanged
app limits. These invocation failures are retained in their original logs,
not represented as app regressions or waived candidate failures.

Corrected receipts/logs are `node-neutral-checks.log`, `python-system-checks.log`,
`library-standard.log`, their guard/launch receipts and
`library-standard-report.json`. All own temporary test/profile folders and
unneeded compiled research-test helpers were removed. Keep the current small
review until Steve has inspected it. No RAW copies or native-frame intermediate
images were made. Output starts at **13.2 GB** and ends at **13.3 GB**, below
100 GB; the review itself is **16.215 MB**. `git diff --check` passes.

