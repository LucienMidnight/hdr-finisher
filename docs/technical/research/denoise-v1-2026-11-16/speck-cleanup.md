# Residual speck and shadow colour cleanup — November 17, 2026

**Recommendation: do not ship this cleanup.** It provides modest colour
cleanup but does not reliably solve extreme specks while preserving tiny dark
detail. Current Denoise and its new shipping defaults are unchanged.
This is an independently written classical extension after `adaptive-atrous-v1`,
intended for a separate **Denoise (Experimental)** method if it qualifies.
The experiment does not authorize app integration or a tolerance change.

## Method in plain words

Prepare the existing five adaptive wavelet bands and measured brightness-dependent
noise model once. Reconstruct the current result at Steve's new defaults:
Amount .75, Luminance .5, Color Noise .75, Detail Recovery .5, sizes .5.
Then look for two different things in that result:

1. **Local specks:** compare each opponent-colour component with its 5×5
   median. A residual must exceed 2.5 times a provisional remaining-noise
   estimate (.35 times the measured input band-zero sigma), with a soft ramp
   to full correction at 5 sigma. This multiplier is a locked research
   assumption, not a camera calibration or a newly agreed quality limit.
2. **Colour clouds:** average compatible neighbouring colours at offsets
   −16, −8, 0, 8, 16 pixels in both directions. Spatial weights fall with
   distance; range weights reject differences in both luminance and colour,
   using the measured band-two noise. Move 65% toward that weighted colour.
   This is a finite-support joint range filter, not a neural pilot.

Four variants expose the protection trade-off rather than hiding failed ideas:

- `median`: both signs, every colour component, no structural protection.
- `guarded`: only dark extrema with a light rim, no similarly dark support
  on both sides along any of four directions; positive points are protected.
  Adds the joint colour-cloud filter.
- `center_shadow`: additionally restrict repairs to low signal/noise (full
  below 4, fading to zero at 12), protect positive luma points from colour
  repair, and preserve ACEScg luminance during colour repair. Its **centre**
  brightness incorrectly treats dark ink on bright material as a shadow.
- `shadow` (`factory`, final experimental column): uses the **surrounding
  5×5 median brightness** for that decision. It deliberately leaves an isolated
  dark dot on bright material alone. The other protections are unchanged.

A dark pit surrounded by a light ring is not mathematically guaranteed to be
noise: ink, demosaic/sharpening outlines and real point features can have that
shape. Likewise, a weak colour-only edge is not guaranteed to be a blotch.
The experiment tests these ambiguities; it does not resolve them by definition.
Positive-point protection also deliberately leaves some positive noise behind.

## Measurement rules and evidence

MacBook Neo, Apple A18 Pro, 8 GB; offline CPU, one native thread. All heavy
runs are serial through the shared machine lock and the unchanged 2.5 GB
process-tree research guard. App base `910914de`; prototype commits
`994152ca` and `f8f6e22b`; final tooling/control projection fix `7690bb0e`
keeps measured default outputs unchanged. Every receipt records its actual HEAD. No GPU,
Electron, production rendering, source-project write or external download.
The verified Bayer checkpoint and public pairs are reused through read-only
input symlinks into the coordinator's ignored output; review output is local.
No model, dataset image or private photograph is committed.

The quality contract remains brief §3: improve SDR **and** HDR fidelity,
colour no worse, flat residual Y≤.5 / C≤.3 of Off, every texture band
.85–1.15 of clean, MTF50≥.90, extra halo≤2%, bleed no worse. Perceptual
preview/export and seam limits remain mean<1 / p99<3; no limit is loosened.
Timing is descriptive, one run per native photo with the existing ±10%
allowance. Shipping time estimates below are estimates, not measured UI waits.

`off`, `denoise_v2_appdefault`, all four cleanup variants, `rawnind_bayer`
and clean where available see the same inputs/display transforms. Quick is
192px generated targets plus two real windows; full is 27 synthetic cases
(9 at each ISO equivalent 1600/6400/25600), plus eight real 640px windows.
Synthetic calibration remains the provisional single-frame Poisson–Gaussian
fit, including clipped sensor readout and residual noise in binned truth.
No added banding, clean skin/hair reference or real ISO25600 pair is claimed.

Public pairs retain the existing registration, gain and clipping exclusions:
52 crops / 11 scenes / four cameras / ISO1600–6400, split into four held-out
scenes (19 crops) and seven RawNIND-training-seen scenes (33 crops).
Tables weight crops within capture, captures within scene, then scenes equally.
Seen/held-out populations have different subjects; their score difference is
not itself a generalisation test. Held-out means absent from RawNIND training,
not an untouched development set: aggregate scores were inspected between
prototypes; the final surrounding-brightness revision was motivated by synthetic
text failure, with no per-scene public tuning. Low-ISO references retain noise and clean-only
interpolation changes fine bands. Native-resolution scores remain primary.

### Explicit lifted-shadow tails

The harness now reports `shadow_tails_sdr_lift4`: fixed **total +4 stops**
relative to the original scene, independent of an input crop's existing lift.
On shared support it reports absolute finished-luma error p99.9, fraction of
pixels above .05, and connected error islands of 1–25 pixels. Truth uses clean
residual; no-truth uses local 5×5 median contrast and can count real details.
The .05 threshold describes the tail; it is not a new acceptance tolerance.
A lower island count alone is misleading when islands merge into a large blotch.

General-set support is the inherited automatic-flat mask, original Y below
min(.02, flat median Y), with 2px support erosion. It can be extremely small
on real textured crops; the JSON records support and nulls, and those cases
must not be used as convincing speck statistics. Decision crops additionally
score their fixed ROI without the automatic-flat selection, using the same
brightness bound and valid support. These two populations are labelled and
must not be pooled. Public invalid support remains excluded.

## Results and recommendation

**Do not ship these variants.** Final Experimental gains only **0.062 dB** SDR on held-out scene-weighted pairs. It loses **0.100 / 0.143 dB** at synthetic ISO1600/6400 and gains only **0.021 dB** at ISO25600, nowhere near the proposed +1 dB improvement. Its shadow colour is a little cleaner, but genuine dark fine structure is still mistaken for noise. No complete quality-contract pass is claimed.

### Full synthetic fidelity

Arithmetic means across nine scenes per ISO; SDR ΔE is the mean finished CIEDE2000, not HDR colour. All seven adapters complete all 35 full cases without an adapter error. Clean truth is the reference, not another denoiser.

| ISO equivalent | Method | SDR PSNR dB | HDR PSNR dB | SDR SSIM | SDR ΔE mean / crop p99 |
| --- | --- | ---: | ---: | ---: | ---: |
| 1600 | Off | 29.036 | 32.828 | 0.6730 | 5.554 / 15.598 |
| 1600 | Current D1 | 37.117 | 41.030 | 0.8958 | 2.585 / 9.116 |
| 1600 | Median | 34.067 | 38.966 | 0.8746 | 2.919 / 14.521 |
| 1600 | Guarded | 36.222 | 40.282 | 0.8948 | 2.599 / 11.006 |
| 1600 | Centre-shadow | 36.418 | 40.315 | 0.8949 | 2.616 / 10.751 |
| 1600 | Experimental | 37.016 | 40.811 | 0.8960 | 2.579 / 9.558 |
| 1600 | RawNIND Bayer | 32.945 | 38.741 | 0.8688 | 3.555 / 18.461 |
| 6400 | Off | 23.126 | 26.636 | 0.4475 | 9.985 / 23.877 |
| 6400 | Current D1 | 31.428 | 35.908 | 0.8594 | 4.652 / 15.216 |
| 6400 | Median | 29.987 | 35.044 | 0.8422 | 4.873 / 18.587 |
| 6400 | Guarded | 31.074 | 35.618 | 0.8603 | 4.620 / 15.932 |
| 6400 | Centre-shadow | 31.046 | 35.585 | 0.8595 | 4.647 / 15.918 |
| 6400 | Experimental | 31.285 | 35.780 | 0.8600 | 4.635 / 15.576 |
| 6400 | RawNIND Bayer | 31.258 | 36.210 | 0.8415 | 4.266 / 19.059 |
| 25600 | Off | 17.293 | 20.281 | 0.2208 | 16.346 / 32.221 |
| 25600 | Current D1 | 25.079 | 30.525 | 0.7903 | 9.321 / 25.086 |
| 25600 | Median | 24.663 | 30.278 | 0.7793 | 9.377 / 25.303 |
| 25600 | Guarded | 25.085 | 30.530 | 0.7953 | 9.273 / 24.530 |
| 25600 | Centre-shadow | 25.073 | 30.505 | 0.7944 | 9.289 / 24.577 |
| 25600 | Experimental | 25.100 | 30.527 | 0.7945 | 9.288 / 24.560 |
| 25600 | RawNIND Bayer | 27.982 | 32.894 | 0.7963 | 5.794 / 20.769 |

### Flat residual, edge and colour protection

Flat columns are means of output/noisy standard-deviation ratios. MTF and halo come from the slanted-edge case only; these are unchanged proposed limits, including the .90 MTF50 target at every ISO.

| ISO | Method | Flat Y / C ratio | MTF50 / clean | Extra halo | Bleed mean / crop p99 |
| --- | --- | ---: | ---: | ---: | ---: |
| 1600 | Current D1 | 0.476 / 0.344 | 0.965 | 0.101% | 0.0387 / 0.2361 |
| 1600 | Experimental | 0.476 / 0.337 | 0.964 | 0.101% | 0.0396 / 0.2357 |
| 1600 | RawNIND Bayer | 0.758 / 0.563 | 0.867 | 7.320% | 0.0889 / 0.3940 |
| 6400 | Current D1 | 0.316 / 0.248 | 0.820 | 0.173% | 0.0635 / 0.2857 |
| 6400 | Experimental | 0.315 / 0.239 | 0.820 | 0.142% | 0.0642 / 0.2880 |
| 6400 | RawNIND Bayer | 0.437 / 0.323 | 0.847 | 7.578% | 0.0921 / 0.3936 |
| 25600 | Current D1 | 0.218 / 0.199 | 0.628 | 0.267% | 0.1096 / 0.3844 |
| 25600 | Experimental | 0.224 / 0.189 | 0.628 | 0.267% | 0.1075 / 0.3819 |
| 25600 | RawNIND Bayer | 0.248 / 0.187 | 0.843 | 8.964% | 0.0998 / 0.3916 |

Experimental keeps the existing slanted edge almost unchanged, including the existing high-ISO softness. Extra halo passes these three charts, but mean colour bleed is worse at ISO1600/6400. These edge results do not establish unchanged point detail. RawNIND is much cleaner in extreme-noise examples, but its chart halo and detail/colour failures remain visible; this experiment does not newly qualify it.

Texture energy is checked against clean in four Gaussian bands (.5–1 / 1–2 / 2–4 / 4–8 px). Here is the fabric target, avoiding meaningless averages over almost-zero clean texture power:

| ISO | Method | Fabric band-energy ratios, fine → coarse |
| --- | --- | --- |
| 1600 | Current D1 | 0.001 / 0.022 / 0.096 / 0.095 |
| 1600 | Experimental | 0.001 / 0.022 / 0.096 / 0.095 |
| 1600 | RawNIND Bayer | 0.006 / 0.180 / 1.059 / 1.076 |
| 6400 | Current D1 | 0.001 / 0.021 / 0.085 / 0.085 |
| 6400 | Experimental | 0.001 / 0.021 / 0.085 / 0.085 |
| 6400 | RawNIND Bayer | 0.006 / 0.193 / 1.125 / 1.144 |
| 25600 | Current D1 | 0.001 / 0.020 / 0.065 / 0.067 |
| 25600 | Experimental | 0.001 / 0.020 / 0.065 / 0.067 |
| 25600 | RawNIND Bayer | 0.007 / 0.213 / 1.211 / 1.237 |

The centre-shadow prototype loses **4.96 dB** on fine text at ISO1600. Reading surrounding brightness reduces that loss to **1.87 dB**, but ISO6400 fine text still loses **2.06 dB**. The final fine-text ISO6400 band ratios are **.881 / 1.196 / 1.650 / 1.648**, outside .85–1.15. Its Siemens-star ISO25600 ratios are **.619 / .647 / .723 / .778**: substantial detail loss remains. Protected artificial glint/line/dot unit checks pass, but they do not overrule the real test-target failures.

### Public pairs: held-out and seen remain separate

Equal scene weighting after capture/crop averaging. Edge is local gradient energy / clean, **not MTF50**. ΔE p99 and bleed p99 are means of crop percentiles, not pooled pixel percentiles.

| Split | Method | SDR / HDR PSNR dB | SDR ΔE mean / crop p99 | Edge energy / clean | Bleed mean |
| --- | --- | ---: | ---: | ---: | ---: |
| heldout | Off | 27.682 / 33.316 | 7.033 / 19.426 | 1.794 | 0.0588 |
| heldout | Current D1 | 34.830 / 41.493 | 3.043 / 10.429 | 0.715 | 0.0317 |
| heldout | Median | 34.718 / 41.411 | 3.015 / 10.626 | 0.628 | 0.0320 |
| heldout | Guarded | 34.975 / 41.616 | 2.960 / 10.206 | 0.716 | 0.0311 |
| heldout | Centre-shadow | 34.891 / 41.550 | 3.006 / 10.246 | 0.715 | 0.0314 |
| heldout | Experimental | 34.892 / 41.553 | 3.006 / 10.247 | 0.715 | 0.0314 |
| heldout | RawNIND Bayer | 35.066 / 42.005 | 2.983 / 12.104 | 0.799 | 0.0330 |
| seen | Off | 29.315 / 36.417 | 5.771 / 15.703 | 1.590 | 0.0448 |
| seen | Current D1 | 34.172 / 41.214 | 3.099 / 9.715 | 0.600 | 0.0268 |
| seen | Median | 33.717 / 40.757 | 3.149 / 10.062 | 0.536 | 0.0270 |
| seen | Guarded | 34.174 / 41.204 | 3.076 / 9.609 | 0.599 | 0.0266 |
| seen | Centre-shadow | 34.192 / 41.226 | 3.081 / 9.622 | 0.599 | 0.0266 |
| seen | Experimental | 34.193 / 41.231 | 3.081 / 9.623 | 0.599 | 0.0266 |
| seen | RawNIND Bayer | 33.925 / 41.182 | 3.545 / 14.045 | 0.757 | 0.0297 |

Broad guarded filtering has the best headline among these classical cleanup variants on held-out pairs, yet it damages synthetic text and colour boundaries. Selecting it from that headline would repeat the detail-loss problem. The final conservative method changes held-out edge energy .7152→.7147 while improving ΔE 3.043→3.006: a small trade, not the requested decisive cleanup.

### Lifted-shadow residual tails with truth

The star-field flat-shadow support is 182,335 identical pixels at each ISO. These scores include brightness bias from clipped synthetic readout; they are **not counts of physically confirmed defective pixels**. Islands must be read with the tail fraction.

| ISO | Method | Luma p99.9 | Luma error >.05 | Small islands | Chroma p99.9 |
| --- | --- | ---: | ---: | ---: | ---: |
| 6400 | Off | 0.4253 | 79.87% | 24 | 0.7993 |
| 6400 | Current D1 | 0.1149 | 86.06% | 56 | 0.4305 |
| 6400 | Experimental | 0.1153 | 85.86% | 49 | 0.3637 |
| 6400 | RawNIND Bayer | 0.1553 | 99.91% | 0 | 0.1535 |
| 25600 | Off | 0.7593 | 81.31% | 38 | 1.0118 |
| 25600 | Current D1 | 0.3267 | 98.73% | 2 | 0.7965 |
| 25600 | Experimental | 0.3289 | 98.80% | 1 | 0.7094 |
| 25600 | RawNIND Bayer | 0.4133 | 100.00% | 0 | 0.2740 |

At ISO25600 Experimental reduces the chroma tail about **11%**, but slightly worsens the luma tail (.3267→.3289). Reducing islands from two to one does **not** establish cleaner shadows: nearly all this heavily lifted background still exceeds the fixed residual threshold. This is why the residual-tail and clean-reference measures are retained alongside crop inspection.

### Decision crops: what to inspect

The complete twelve-case set is regenerated in place, **8.38 MB**, with the
new `speck_cleanup` column recorded in `decision/manifest.json`. Each PNG is
288×288, native 1:1 sRGB, with fixed shared exposure and no resize/sharpening.
The existing columns remain; two new rows add +4-stop flame edge and synthetic
star field. The first generation hit the obsolete ten-case assertion after
rendering; the assertion now follows the declared selection, and the full
rerun succeeds without changing the 13 MB review limit.

- [Canon flame edge, +4 stops](../../../../codebase/output/denoise-v1/decision/canon-flame-edge-lifted/speck_cleanup.png): the clearest **failure to fix** the requested extreme-noise problem. Current and Experimental are visually nearly identical; RawNIND is dramatically smoother. On 2,990 fixed-ROI shadow-support pixels, both classical results have **339** small contrast islands, **56.25%** above the .05 luma threshold and p99.9 **.2787**; RawNIND has **0** islands and p99.9 **.0024**. These are no-truth contrast proxies, not proof that every removed feature is noise.
- [Canon dark shadow, +4 stops](../../../../codebase/output/denoise-v1/decision/canon-dark-shadow/speck_cleanup.png): conspicuous dark pits/light rims and magenta blotches remain. Experimental changes the colour background only slightly. The metric's 21-pixel support here is inadequate for a headline claim; inspect the whole 288px crop instead.
- [Held-out printed digits/dots](../../../../codebase/output/denoise-v1/decision/heldout-print-dots/speck_cleanup.png): Experimental is close to current; the digits remain visible. The real low-ISO reference and RawNIND column expose different dot/edge treatment. This does not excuse the synthetic fine-text regression.
- [Synthetic fine text, ISO25600](../../../../codebase/output/denoise-v1/decision/synthetic-fine-text/speck_cleanup.png): compare current, Experimental, RawNIND and clean. Current/Experimental retain many small glyphs; RawNIND turns them into broad bands. The target is bright lettering on a dark background: losses can involve dark gaps and colour structure as well as lettering. The larger ISO1600/6400 fidelity losses are separately visible in the full-set review.
- [Synthetic stars, ISO25600](../../../../codebase/output/denoise-v1/decision/synthetic-star-field/speck_cleanup.png): bright points are deliberately protected, at the cost of residual positive noise. Background colour cleanup is incomplete; synthetic readout bias and coarse texture ratios still fail.

For any row, sibling `denoise_v2_app.png`, `rawnind_bayer.png` and (where truth
exists) `clean.png` are the comparison files. The coordinator can consume the
manifest directly for the blind page; no public review page was edited or
published. The listed Canon, print/dots, fine-text and star-field comparisons were
inspected at native 1:1; the other full-set measurements are retained for
inspection and are not claimed as an exhaustive visual sign-off.

The main failure is not a lack of filter strength. More aggressive median or
colour smoothing removes genuine small structure; conservative guards then
reject many of the actual specks. In correlated demosaic noise, a ringed pit
can occupy several neighbouring samples and resemble structure. The assumed
remaining-noise multiplier is not calibrated enough to solve that distinction.
A new GPU port of this candidate is not justified. If research continues, the
next bounded experiment should calibrate post-adaptive residual tails on
independent clean/noisy samples before changing more thresholds, and keep
real point/detail adversaries as rejection checks.


### Native CPU cost and shipping estimate

Final native receipts are **25.51 s / 18.02 MP** and **59.68 s / 42.39 MP** (the earlier progress update rounded the latter too high). Both process every native pixel. These are standalone preparation-through-resolved-linear-result waits, **not action-to-screen timings**, with AHD support, one frame-global measured model, disk cache roundtrips and cleanup.

| Native source | Analysis | AHD tiles | Bands / default resolve / cleanup | Cache I/O / live resolve | Whole wait | OS peak RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| IMG_0790.CR2 (18.02 MP) | 1.61 s | 1.33 s | 4.03 / 1.13 / 14.15 s | 1.33 / 1.14 s | 25.51 s | 1.174 GB |
| 2025_0730_1331_3.arw (42.39 MP) | 1.59 s | 3.27 s | 9.88 / 2.85 / 34.94 s | 3.00 / 2.75 s | 59.68 s | 1.221 GB |

Stage sums omit short open/GC/Python overhead; preparation contains the three bands/default/cleanup subclocks, which must not be added twice. The two photographs are separate native workloads, not a controlled before/after scaling experiment. No timing repeat or speedup claim is made.

The Canon frame-global fit is degenerate in brightness: a=c=0 and b=1e−20, compensated by large finite band-sigma factors (effective band-zero Y sigma ≈.00495). This preserves finite measured band noise but does **not** establish a calibrated brightness-dependent tail model for that frame. The Sony fit has a≈.0001677, b≈3.21e−8. Both are the current estimator, unchanged; crop-local quality fits differ from native-frame fits. This is an additional risk for a rule justified only as “outside the predicted noise”.

With the same kernels and an already developed source/model, shipping preparation would still add about **14–16 s at 18 MP** or **35–38 s at 42 MP** for cleanup plus a default baseline if it is not already available. This estimate is anchored to measured cleanup/default subclocks; it excludes source loading, wavelet work already required by current Denoise, transport, GPU uploads and presentation. Rough proportional **24 MP** cost is **19–22 s added CPU preparation**, not the whole UI wait. That is a material wait for a tiny/no quality gain. A faster own compiled kernel may reduce it, but no unmeasured SIMD/core multiplier is presented as a shipping benchmark.

Cached 512² CPU resolve over all eight controls at 0/.5/1: median **13.82 ms**, p95 **15.02 ms**, maximum **16.04 ms**; zero Amount fast path **0.12 ms**. All 24 results are finite and the prepare evidence is unchanged. This supports a cheap *additional* GPU algebra pass, not an instant native-resolution CPU slider or next-frame UI claim. Native CPU resolve itself takes 1.14/2.75 s across the whole frame.

GPU preparation could parallelise local median/directional/range work; live correction needs only cached loads and algebra. No GPU runtime or whole-app memory was measured, so a GPU millisecond estimate would be speculation. A prospective port must first pass quality, then measure the entire action-to-screen wait and the existing admission/presentation gates.

| Final serial research run | Guard wall | Peak process-tree RSS |
| --- | ---: | ---: |
| quick | 38.43 s | 1.111 GB |
| heldout | 91.14 s | 0.993 GB |
| full | 166.23 s | 1.259 GB |
| seen | 162.52 s | 1.050 GB |
| decision | 30.20 s | 1.103 GB |
| native-18 | 26.14 s | 1.135 GB |
| native-42 | 60.20 s | 1.187 GB |
| controls | 2.58 s | 0.630 GB |

All final commands exit zero. Including rejected explorations and the corrected decision rerun, heavy computation remained well below the authorized 90-minute threshold. No heavy runs overlap.



## How this could ship, if quality justified it

The adapter caches source coefficients, noise/energy ratios and separate fine
impulse/coarse colour corrections. All eight live controls recombine fixed
evidence; no median, neighbourhood search, model estimate or wavelet analysis
runs again. Bypass/zero Amount and alpha are exact. Cleanup saturates at its
default correction; stronger controls keep increasing the adaptive stage,
not the cleanup. Detail Recovery and the four sizes alter correction weights.
This upper-range limitation would need Steve's review before adoption.

**GPU preview:** extend preparation, after a default-strength adaptive result,
with a deterministic 25-value median, four paired-direction comparisons and
a 25-neighbour range filter; use float32 intermediate arithmetic. Cache only
admitted active-region/tile corrections, keyed by source/geometry/model/method,
never by live control weights. Add the two corrections to the existing adaptive
resolve. Current `encodeAdaptiveDenoise` itself recomputes tiled bands on
control changes; the research reference's entire coefficient cache must not
be mistaken for the current shipping GPU cache. No claim that simply copying
this NumPy cache into the renderer would fit or be instant is justified.

**CPU export/fallback:** the same finite-support equations, reflected only at
real frame edges, in bounded source tiles with an 86px halo and one global
model. Reuse a prepared matching tile where admitted; otherwise prepare once
for that tile and discard it after delivery. Use own compiled scalar/SIMD
median/range kernels or existing NumPy/OpenCV first; no neural runtime required.
Native measurement exercises every pixel through bounded prepare/cache-I/O/
resolve, and removes all temporary files, but does not implement the app broker.

FP32 arrays use **156 bytes per source pixel** in this reference: original3,
five bands15, five ratios15 and corrections6 float channels. A full 18.02/42.39
MP cache would be **2.81/6.61 GB**, before workspace: unacceptable on this Mac.
The native runner retains one 768px core at a time, not such a cache.
The added correction data alone are six FP32 components (24 bytes/pixel);
a practical GPU packing is two RGBA16F textures (16 bytes/pixel), still
288/678 MB at native 18/42 MP. It must be bounded to admitted active tiles
(e.g. 16 MiB per 1024² correction pair), with existing eviction and admission,
not a new whole-frame cache or a raised allowance. Read
[memory-and-caches](../../../product/modules/memory-and-caches.md) before any
implementation. FP16 storage accuracy and changing viewport latency are unmeasured.

The CPU and GPU can implement the same arithmetic and finite support; soft
ramps reduce threshold discontinuities. Agreement within the usual finished
pixel mean<1 / p99<3 is plausible, **unproved**. Median ties, exp approximations,
FP16 evidence and the dark/point masks need explicit parity and tile-grid
checks. The existing independently prepared CPU tile regression uses a 2e-7
linear arithmetic allowance; it does not substitute for perceptual GPU parity.
No extra GPU retry, new cache budget or downstream highlight change is proposed.

**Licence:** new code is own work under the repository GPL-3 licence. NumPy's
BSD and OpenCV's Apache-2.0 operations are compatible; no new third-party
algorithm source, non-commercial package or model is included. RawNIND is a
comparison only, with the existing pinned hash and licence records.

## Validation and hand-over

- `node --test tests/*.test.js`: **1,091 passed, one skipped, zero failures**.
- Final `.venv/bin/python -m pytest tests -q`: **3,958 passed, 150 skipped,
  one xpassed, zero failures**; guarded process-tree peak **1.935 GB**.
- Focused harness/cleanup tests: **23 passed**. Result checks cover cached
  baseline agreement, exact bypass/alpha, negative/HDR constants, exposure
  covariance, bright point/dark line/dot protection, a ringed impulse,
  isoluminant edge protection, independent haloed preparation and every live
  control. The added metric test counts a known residual impulse, excludes
  invalid pixels and cancels genuine clean-reference points.
- Final review fixed a live-control coupling: scale the complete projected
  chroma map by Color Noise, so Luminance cannot break its ACEScg-Y projection.
  The new check passes across nine live combinations; default outputs stay
  unchanged. The complete Python suite was rerun after this fix.
- All final quality/decision/native/control commands exit zero. RGB safety
  and re-prepared −6…+6 stop probes pass (zero reported SDR/HDR colour
  difference for final Experimental). Prepared-frame slice probes are
  distinguished from the independently prepared halo regression.
- All twelve decision rows have every declared PNG, all report links resolve,
  each retained review folder is below 20 MB, and `git diff --check` passes.
  No tolerance, limit, driver budget or failing check was relaxed.

Logs and receipts: `codebase/output/denoise-v1/speck-cleanup/`:
`{quick,full,heldout,seen}/results-*.json`, `summary.json`, all `*-guard.json`,
`native-*.json`, `controls.json`, `{node,python,focused}.log` and the
full/held-out/seen `review/index.html` pages. `fidelity-chart.html` is a small
chat comparison of paired SDR changes. The final decision manifest is
`codebase/output/denoise-v1/decision/manifest.json`; use its column order,
coordinates, source hashes/licences and fixed exposure for the blind page.

No GPU driver covers this CPU-only candidate. No Electron Library smoke,
production preview/export/Proof driver, installer, GPU parity, app-memory or
UI responsiveness sign-off was run or implied. Windows/Linux execution and
a production CPU/GPU port remain untested. No shipping defaults, protected
projects, source photos, package requirements or cache allowances changed.

Output size is **12.9 GB at start / 13.0 GB at completion**, below 100 GB;
shared dataset/model symlinks are input references, not duplicate downloads.
This trial retains **24.95 MB** of scores/logs/reviews, plus the **8.38 MB**
decision set. Native tile/cache scratch is removed on normal/handled-error
exit; no native scratch remains. Owned pytest/script temporary folders and
the superseded quick preview were removed; its score/guard receipts remain.
The `speck-cleanup/` and `decision/` review folders can be deleted after the
coordinator/Steve finishes reviewing them. Do not delete their shared dataset,
model or approved-corpus targets. No push or public-page publication.

