# DxO Standard on the Canon fire-dancer

November 20, 2026 · Canon 7D at ISO 3200 · MacBook Neo, 8 GB · research only.

**DxO Standard leaves much finer brightness grain.** On two dark patches and the floor, its grain measures **2.9–3.0 native pixels** versus **7.9–8.4** for Clean Grain and **3.9–4.2** for the best early Bayer trial. With denoise off, both RAW developments start much closer, at 3.5–4.7 px. Standard also changes the black level substantially in the deepest patches. At equal mean brightness, its dark-patch brightness noise is within the range of Clean Grain and the early trials. Its biggest repeatable difference is the size and correlation of what remains.

## Inputs and alignment

Steve supplied four full-resolution PhotoLab TIFFs with corrections disabled. The SHA-256 prefixes for Off, Standard, DeepPRIME and DeepPRIME XD3 were `ec946a34`, `9f1e5d61`, `6f59a039` and `1afd8bf5`. All were 5184 × 3456, orientation 1, 16-bit RGB, with the same embedded ROMM RGB profile. The analysis decoded the actual ICC transfer curve, converted its D50 RGB matrix to linear ACEScg with CAT02 white-point adaptation, and worked without 8-bit conversion until the established display-based detail and mark tests. The PhotoLab version and slider values are unspecified. [Hashes and measurements][receipt]

HDR Finisher's signed AHD view is 5202 × 3464, with no orientation change on this RAW. Normalised template correlation on the face, flame, skirt and torso found that TIFF pixel `(x, y)` corresponds to sensor-view pixel `(x+10, y+4)`. The four estimates were within 0.17 px of that integer shift and the DxO modes agreed within 0.13 px. The prespecified allowance was 0.25 px, a small fraction of the finest reported wavelength. Integer crop addressing preserved the original pixels. HDR Finisher's main Off baseline keeps Even out harsh specks at ×2.5 with hot pixels and lens correction off, as in both prior trials. A separate Off control disables the speck step. [Round one](predemosaic-denoise.md) · [Round two](predemosaic-round2-wavelet-colour.md)

## What was already different with denoise off

The same two 256 × 256 dark windows and the same floor window were measured in all versions. The earlier torso texture control is in the receipt. RMS is the root-mean-square amplitude of the fluctuations. The method subtracts a 14 px Gaussian trend and uses a Hann window. Grain size is the median brightness power wavelength over 2–48 px. Adjacent-pixel correlation averages the horizontal and vertical one-pixel steps. The colour measure combines both opponent axes in the 8–32 px band. [Original measurement method](grain-size-and-colour.md#how-the-comparison-was-made)

| Off development | Brightness grain in px, dark / second dark / floor | Adjacent brightness correlation | 8–32 px colour RMS ×1,000 | Adjacent colour correlation |
| --- | --- | --- | --- | --- |
| DxO | 3.63 / 3.62 / 4.68 | .29 / .29 / .50 | .822 / .915 / 7.279 | .43 / .44 / .60 |
| HDR Finisher | 3.51 / 3.56 / 3.62 | .31 / .31 / .33 | 3.233 / 3.360 / 5.025 | .55 / .56 / .56 |
| HDR Finisher, speck cleanup off | 3.51 / 3.53 / 3.63 | .31 / .30 / .33 | 3.546 / 3.675 / 5.286 | .55 / .56 / .56 |

With denoise off, DxO's dark grain is about the same size and slightly less correlated. Its floor grain is **about 1 px larger and more correlated**. Matching the local low-passed brightness of the Off views with one multiplier per patch changes DxO's colour RMS ×1,000 to **1.67 / 2.48 / 7.77**, still lower in the two shadows and higher on the floor. These are differences in the Off developments, which include each product's demosaic, camera rendering, black mapping and highlight handling. The TIFFs cannot isolate those operations. The Off comparisons rule out starting with much finer DxO brightness grain as the explanation for the Standard result.

## How much each mode changes

Percentages are **RMS left relative to the same product's Off** at the original linear levels. Grain cells give the absolute wavelength and its ratio to Off. Values are dark / second dark / floor. Round one is the guided separate-colour Bayer trial at brightness strength .5957. Round two is simple opponent plus local BayesShrink at Luminance 43.36%, Color 100%. Both use their previous Clean Grain brightness fits.

| Method | Brightness RMS left | Grain wavelength in px (× Off) | Adjacent brightness correlation | 8–32 px colour RMS left |
| --- | --- | --- | --- | --- |
| DxO Standard | 3.6% / 4.4% / 47.8% | 2.91 (.80) / 3.01 (.83) / 3.04 (.65) | .04 / .05 / .10 | 0.53% / 0.94% / 14.6% |
| DeepPRIME | 3.7% / 3.0% / 16.1% | 2.82 (.78) / 2.87 (.79) / 4.77 (1.02) | .00 / .01 / .55 | 0.53% / 0.77% / 9.9% |
| DeepPRIME XD3 | 2.4% / 2.4% / 12.6% | 2.84 (.78) / 2.83 (.78) / 31.04 (6.63) | .00 / .00 / .87 | 0.17% / 0.73% / 9.4% |
| Our Standard | 4.9% / 5.1% / 9.7% | 17.75 (5.05) / 16.77 (4.72) / 20.70 (5.72) | .94 / .94 / .96 | 6.4% / 8.3% / 8.8% |
| Fine Grain | 32.0% / 32.1% / 34.8% | 7.95 (2.26) / 7.94 (2.23) / 8.43 (2.33) | .80 / .80 / .82 | 6.4% / 8.3% / 8.8% |
| Clean Grain | 32.0% / 32.1% / 34.8% | 7.95 (2.26) / 7.94 (2.23) / 8.43 (2.33) | .80 / .80 / .82 | 3.8% / 4.9% / 15.0% |
| RAW round 1 | 32.8% / 33.0% / 33.8% | 4.40 (1.25) / 4.34 (1.22) / 4.43 (1.23) | .48 / .48 / .50 | 9.3% / 9.4% / 9.0% |
| RAW round 2 | 29.9% / 30.1% / 37.0% | 4.01 (1.14) / 3.94 (1.11) / 4.21 (1.16) | .42 / .42 / .47 | 6.8% / 6.6% / 7.7% |

DxO Standard leaves the floor's mean Y at **98%** of DxO Off, but the two dark means fall to **10–12%**. On the darker flat, the share at or below zero scene Y rises from 5.8% to 23.4%. Our Clean Grain keeps the dark means at 98–100%. Dividing each RMS by its own patch mean before taking the Off ratio gives a brightness-normalised sensitivity check. DxO Standard then leaves **35% / 38% / 49%** brightness RMS and **5.1% / 8.2% / 14.9%** colour RMS. Clean Grain leaves **33% / 32% / 35%** and **3.9% / 4.9% / 14.9%**, respectively. The late colour stage is already competitive on these patches at comparable relative brightness. The early trials achieve much finer grain with more correlated neighbours and worse main-shadow colour. The comparison at equal mean uses a gain and cannot restore clipped samples. The near-black result shows how the output behaves when lifted. It supplies no measure of how much signed shadow detail survived.

DeepPRIME removes more floor brightness noise than Standard. XD3 pushes the floor residual to about 31 px because fine variation is nearly gone and the remaining broad floor structure outweighs the residual grain. That wavelength does not imply visible 31 px specks. All three DxO modes render those deepest patches very dark. Fixed effects of TIFF quantisation, black mapping and any residual processing are included in what remains.

## Face, skirt, hair and flame

These are signed projections onto the strongest 20% of local features of each product's own Off image. A projection of 1.00 preserves the reference contrast. The texture probe uses a 0.9–2.6 px difference of Gaussians in display brightness. Flame edge values use Gaussian-smoothed display gradients, with separate brightness and two-axis colour checks. Noise itself contributes strongly to the high-frequency Off templates. A texture score measures surviving original variation, including noise. A clean reference would be needed to measure how much true fine texture survives.

| Method | Face texture | Skirt texture | Hair texture | Flame texture / brightness edge / colour edge |
| --- | ---: | ---: | ---: | --- |
| DxO Standard | .10 | .30 | .21 | .30 / .54 / .31 |
| DeepPRIME | .04 | .21 | .06 | .18 / .43 / .24 |
| DeepPRIME XD3 | .03 | .17 | .05 | .18 / .44 / .27 |
| Our Standard | .06 | .13 | .03 | .22 / .55 / .36 |
| Fine Grain | .17 | .35 | .24 | .38 / .63 / .36 |
| Clean Grain | .16 | .33 | .22 | .37 / .63 / .37 |
| RAW round 1 | .18 | .30 | .23 | .48 / .72 / .46 |
| RAW round 2 | .10 | .30 | .13 | .38 / .67 / .45 |

A second probe selects only strong brightness boundaries whose directions agree in both Off developments. It measures projected contrast after smoothing with 3 px or 6 px Gaussian sigma. This reduces the influence of the fine noisy template. At 3 px / 6 px, DxO Standard retains **.88 / .95 on the face, .86 / .95 on the skirt and .73 / .77 on the hair**. Clean Grain scores **.96 / .99, .91 / .95 and .90 / .94**, and RAW round 2 scores **.86 / .90, .83 / .87 and .77 / .84**, respectively. DeepPRIME and XD3 preserve more of this broader hair contrast, **.89–.90 / .96–.97**, consistent with the visible hair waves in the DeepPRIME crop. This probe measures shared structure and provides a separate target from noisy fine detail.

The original **.90 texture screen against Clean Grain** gives DxO Standard **.35 face, .91 skirt and .74 hair**. It fails on the face and hair. DeepPRIME and XD3 render some larger hair and skirt lines clearly in the PNGs while discarding most of the noisy Off texture. At the flame, DxO Standard projects to **1.40 brightness and 1.04 colour** against Clean Grain in the matched view. Extra contrast and the different white core count toward those scores. They are not evidence of extra recovered detail. The results include the same-EV sensitivity and all other edge projections. [Texture and edge receipt][receipt]

## Small lights and 38 marked sites

The small-light checks use compact features visible in both Off views at fixed sensor centres. They are torch features present in the Canon reference. The separate atrium fixture provides an additional test for our Bayer candidates. Each cell is **peak scene Y / integrated excess Y in the 5 px core above the 10–13 px ring**, as a ratio to local Off.

| Method | (3049, 534) | (3502, 2096) | (3013, 561) |
| --- | --- | --- | --- |
| DxO Standard | 1.000 / 1.010 | 1.000 / 1.021 | 1.001 / .987 |
| DeepPRIME | 1.000 / 1.002 | 1.000 / .986 | .974 / .985 |
| DeepPRIME XD3 | 1.000 / .977 | .991 / .943 | 1.005 / .994 |
| Our Standard | .988 / .991 | .989 / .973 | .900 / .973 |
| Fine Grain | .986 / .988 | .987 / .972 | .874 / .958 |
| Clean Grain | .986 / .988 | .987 / .972 | .874 / .958 |
| RAW round 1 | 1.000 / 1.000 | 1.000 / 1.000 | 1.000 / .994 |
| RAW round 2 | 1.000 / 1.000 | 1.000 / 1.000 | 1.000 / .999 |

DxO Standard holds the peak to about 0.1%, each core colour channel to within 1%, and the centroid to .036 px. The core's contrast against its ring moves up to 2.1%. XD3 moves two centroids by about .11 px and changes a core channel by up to 7.8%. The two Bayer trials preserve these Canon cores. Earlier atrium runs show why both tests matter. They preserved the three atrium peaks and core colours against source Off, but changed the blue-pole light's surrounding contrast by 7.5% and 10.6% respectively. There is no DxO export for that atrium test. [Prior lights](predemosaic-round2-wavelet-colour.md#the-leading-early-only-result) · [Per-light channels and centroids][receipt]

The existing ring test reused all 38 coordinates, recentered once on our Standard as in the earlier trials. It measured local colour distance and dark pit depth after the same +3.23 EV display lift. The same one-number brightness gain was used for all DxO versions of each marked area, derived from the two Off developments. A marked site materially worsens when its contrast rises by both >25% and >2 eight-bit display levels. The old new-crossing test separately asks if a site newly clears twice the reference's ring grain. Marks with zero pit depth in the reference are included in the ratio of means.

| Method | Mean colour / mean pit depth vs own Off | Unique sites materially worse vs own Off | Sites above twice their own ring grain, colour / pits | Unique sites materially worse vs Clean Grain |
| --- | --- | ---: | --- | ---: |
| DxO Standard | .39 / .83 | 10 | 8 / 2 | 17 |
| DeepPRIME | .23 / .31 | 4 | 7 / 1 | 13 |
| DeepPRIME XD3 | .17 / .16 | 4 | 8 / 1 | 7 |
| Our Standard | .75 / .57 | 15 | 32 / 20 | 25 |
| Fine Grain | .72 / .71 | 18 | 29 / 11 | 20 |
| Clean Grain | .47 / .65 | 16 | 14 / 10 | 0 |
| RAW round 1 | .44 / .60 | 10 | 10 / 6 | 18 |
| RAW round 2 | .47 / .58 | 12 | 13 / 13 | 16 |

**DxO Standard fails the existing zero-worse screen.** Against Clean Grain it worsens 16 colour marks and 5 pits, with overlap, and adds 10 colour and 1 pit crossings. At identical EV without the per-area gain there are still 14 unique regressions. Some comparisons reflect product colour and tone differences near the flame. The within-DxO comparison also shows local damage. At sensor `(938,1740)` a pit deepens from about 21 to 41 display levels. Yet Standard leaves fewer marks standing out against the final grain than Clean Grain, **8 vs 14 colour and 2 vs 10 pits**. Looking at both the absolute change and the final ring contrast catches effects hidden by either number alone. [All fixed peaks, thresholds and gain sensitivity][receipt]

## Spectral fingerprint of DxO Standard

For each fixed flat, the FFT measured three fields with the same detrend and window: Off, Standard, and the difference Off minus Standard. The table divides the power of Standard and of the difference by Off's power in each band. The two percentages need not add to 100 because the difference can correlate with what remains. The full receipt contains the unnormalised band powers. All wavelengths are native pixels. [Spectrum and comparison chart][chart] · [Numerical receipt][receipt]

| Wavelength | Floor brightness, left / difference | Floor colour, left / difference | Two dark patches, brightness left | Two dark patches, colour left |
| --- | --- | --- | --- | --- |
| 2–4 px | 31.3% / 50.7% | 14.7% / 71.9% | 0.14–0.21% | 0.012–0.027% |
| 4–8 px | 11.2% / 64.4% | 3.6% / 86.6% | 0.073–0.112% | 0.003–0.006% |
| 8–16 px | 6.3% / 73.1% | 2.0% / 90.3% | 0.056–0.103% | 0.003–0.008% |
| 16–32 px | 6.4% / 70.9% | 2.6% / 85.4% | 0.076–0.14% | 0.003–0.012% |
| 32–48 px | 17.5% / 46.7% | 9.6% / 66.8% | 0.12–0.26% | 0.003–0.009% |

On the floor, DxO Standard leaves around **five times the relative brightness power at 2–4 px as at 8–32 px**. It also cleans colour much more strongly in the 8–32 px range than at 2–4 px. It leaves about 2–3% of the coarse colour power, versus 15% of the fine colour power and 6% of the matching coarse brightness power. Even the fine colour band gets substantial cleanup. Clean Grain goes the other way in brightness, leaving **1%** at 2–4 px and **46–48%** at 8–32 px. RAW round 2 leaves **11%** at 2–4 px and **14–15%** at 8–32 px. It gets closer to the fine size, but still leaves a greater share of coarse brightness than fine. At 32–48 px the numbers rise again, where the floor has real shading and the 14 px detrend is less informative. In the two deep shadows the removed signal contains approximately 97–100% of the input brightness power and about 100% of the input colour power in every band. The very low output levels and changed black mapping there make the floor the better example for shaping a denoiser.

**The colour cleanup behaves like an edge-preserving filter on this image.** Fit a uniform Gaussian only to equal Standard's flat 8–32 px colour RMS. On the floor it took a blur with a 5.7 px standard deviation, and on the dark flats 11.9–13.4 px. Applying those filters to the Off flame preserves just **5–21%** of the linear opponent-colour gradient along the strongest 5% of brightness boundaries. Standard preserves **97.5%** there. This comparison uses a structural edge mask, unlike the display probe above which also selects noisy colour gradients. The surviving flame contrasts and strongly reduced flats establish selective cleanup. The TIFFs leave open whether brightness-adaptive strength, direction guidance, or another mechanism produced it.

## Proposed targets for the next early Bayer trial

Use these as **Canon research targets**. Keep the earlier Clean Grain comparisons alongside them and repeat the Sony portrait, ISO 10000 holdout and atrium checks before making an app decision. The DxO measurements come from one camera and one export recipe.

1. **Shape brightness grain before trying to remove more of it.** Aim for 3–4 native px and adjacent brightness correlation ≤.20 on the Canon flats. The best early pass is already at 3.9–4.2 px but still .42–.47 correlated. On the floor use about 45–55% of our Off brightness RMS as a first fit, with visibly more 2–4 px energy than 8–32 px energy. In the dark patches aim for about 30–40% brightness RMS while holding signed mean Y within 5% of Off on those same fixed windows. This keeps a meaningful noise comparison at Steve's shadow lifts. The ≤5% mean tolerance is a proposed guard on a dark offset, and Clean Grain is already inside it.
2. **Set separate colour targets for the shadows and floor.** With mean brightness held, aim for about **≤5% and ≤8%** of Off 8–32 px colour RMS for the primary and second dark patches, and **≤15%** on the floor. Also check whether the floor residual approaches the measured spectral shape, around 2–3% of original colour power at 8–32 px and up to about 15% at 2–4 px. Colour-only filtering in confidently quiet areas, with luminance and both colour directions as edge evidence, is a reasonable next experiment. Keep the flame's strongest colour-gradient projection at least .95 on its own Off. The existing limited late shadow colour pass belongs in the comparison. [Earlier half-strength guided pass](grain-size-and-colour.md#why-colour-mottling-survives)
3. **Judge recognizable detail separately from noise left behind.** Retain the old .90 texture score as a diagnostic relative to Clean Grain. A single .90 threshold on its noisy fine bands would reject Steve's reference on face and hair. On the shared-structure probe, start with at least .88 on the face and .86 on the skirt at 3 px, and .94 on both at 6 px. Keep the higher Clean Grain hair targets of .90 and .94. Check eyes, hair and skirt weave in a blind 1:1 review. Keep the separate Sony hair and holdout crops, where earlier smoothing removed detail visibly. Any minimum for the old fine-texture score needs a clean reference or Steve's review to anchor it.
4. **Track mark visibility and new damage together.** On the same 38 Canon marks, target a mean colour contrast ≤.40 of our Off (DxO Standard .39) and ≤8 colour marks and ≤2 pits above twice the result's own ring grain. Keep mean pit depth at or below .65 of Off, which Clean Grain already achieves. Continue listing every >25% and >2-level regression at fixed positions, plus all newly conspicuous marks. Review the flame-area failures individually, including `(938,1740)`. A better aggregate score alone cannot excuse a new prominent pit or colour spot.
5. **Protect light cores and their surroundings.** Keep the core and peak to within 1% of signed Off on these Canon checks, the centroid within .10 px and the local excess within about 2% (DxO Standard's maximum here is 2.1%). Apply the separate atrium checks too. A protected sensor centre can still sit inside a ring that changed visibly.

## Verification and memory

The final serial run used the shared lock for the full-frame RAW development and TIFF hash/read stages. HDR Finisher developed the RAW once, cached only required float32 crops as temporary .npy files, and freed the developed frame. The no-speck control used bounded native RAW windows. The TIFF stage opened one read-only memory map at a time, decoded only required regions and released the map between modes. The comparison used the temporary crops one region at a time. The runner removed the temporary arrays.

| Final stage | MacBook Neo peak process RSS |
| --- | ---: |
| RAW development and crop preparation, shared lock held | 991 MiB |
| Four TIFFs in sequence, shared lock held | 184 MiB |
| Crops, detail, marks and spectra | 271 MiB |
| Focused Python checks | 533 MiB |
| Focused Node checks | 50 MiB |

The rerun reproduced the initial noise readings and mark counts. It also matched the previous round receipts for the existing modes and candidates. Native dimensions and all report links checked out. Workspace scratch was 15.5 GB at the start and 16.0 GB at the end, below the 100 GB limit. The first measurement and the broad Node run predated the memory instruction and were uninstrumented. The in-progress broad Python suite was stopped. The focused evaluation and Grain tests passed all 16 Python checks with two dependency warnings. The focused measurement fit passed all 10 Node checks. [Memory log][run-log] · [Python checks][py-log] · [Node checks][node-log]

## Native crops and reproduction

Each column is one source pixel per image pixel. The five columns are DxO Off, DxO Standard, DeepPRIME, Clean Grain and RAW round 2. All use the harness's SDR display transform and the labelled exposure lift. The only brightness adjustment between product families is one common gain per crop, derived from the central 80% of low-passed brightness in the two Off images. It is fixed across the three DxO columns. The view preserves denoise-related black-level changes. Each crop keeps its original hue differences. [Viewer][chart]

- [Dark background][shadow] · [Floor][floor] · [Face][face] · [Flame edge][flame] · [Skirt][skirt] · [Hair][hair]
- [Reproduction script][runner] · [Measurements and per-site tables][receipt] · [Memory log][run-log]

[receipt]: ../../../../codebase/output/dxo-comparison-2026-11-20/measurements.json
[chart]: ../../../../codebase/output/dxo-comparison-2026-11-20/review.html
[runner]: ../../../../codebase/output/dxo-comparison-2026-11-20/reproduce.sh
[run-log]: ../../../../codebase/output/dxo-comparison-2026-11-20/reproduction.log
[py-log]: ../../../../codebase/output/dxo-comparison-2026-11-20/python-focused.log
[node-log]: ../../../../codebase/output/dxo-comparison-2026-11-20/node-focused.log
[shadow]: ../../../../codebase/output/dxo-comparison-2026-11-20/crops/background.png
[floor]: ../../../../codebase/output/dxo-comparison-2026-11-20/crops/floor.png
[face]: ../../../../codebase/output/dxo-comparison-2026-11-20/crops/face.png
[flame]: ../../../../codebase/output/dxo-comparison-2026-11-20/crops/flame.png
[skirt]: ../../../../codebase/output/dxo-comparison-2026-11-20/crops/skirt.png
[hair]: ../../../../codebase/output/dxo-comparison-2026-11-20/crops/hair.png
