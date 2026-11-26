# Pre-demosaic Denoise, round 4 — November 20, 2026

**Keep Clean Grain in the app. Carry the round 4 brightness filter forward in research.** It leaves the Canon dark background and floor at **28% and 40% of Off's brightness noise** with **3.0 px** grain. The Sony portrait's hair is easier to follow and the atrium lights match round 3. The ISO 10000 crop is quieter but its individual strands still do not read. Some Canon marks become more visible and the main dark patch still dims by 0.87%. I would resolve those quality issues before a WebGPU prototype. [Native crop review][review]

## What we tried

Same fixed native windows and display lifts as [round 3](predemosaic-round3.md), from `IMG_0790.CR2` (ISO 3200), `_DSC7970.ARW` (ISO 6400), `DSC05622.ARW` (ISO 10000), and the `DSC01212.ARW` atrium (ISO 800). The prepared mosaics include the same harsh-speck and highlight reconstruction settings. Off uses the same signed AHD demosaic with Denoise off. The Canon DxO TIFFs use the [previous alignment](dxo-comparison.md). The Canon selected the settings and the other three photos used them unchanged. All remaining grain comes from the source photo.

1. **Extra brightness cleanup before AHD.** Used the camera's measured shot and read noise to gate a three-band correction on packed Bayer brightness. It kept the grain fine but barely changed background loudness (72% of Off), and hair fell to .804 with the background 2.07% darker. A smaller early dose with a later tensor gate still left the Canon floor at 62%. Changing a brightness value for a Bayer group leaves within-group differences that AHD can still turn into brightness noise.
2. **Different removal for fine and middle bands after AHD.** Kept round 3's early and late colour work. The ungated brightness filter reached 28%/29% of Off on dark/floor at 3.06/3.11 px, but hair fell to .677 and both face and skirt fell to about .70. A gate driven by a finer guide mistook grain for structure and let 62%/69% through. A local guided fit and the short directional filter preserved more detail, but they left clumps or short curved streaks. The short directional filter left 4.01/4.33 px grain. A wider tensor lowered false positives. The wider directional and patch searches made quieter flats, but gave up more Canon hair, with scores of .797 and .832. Combining direction estimates at two scales still returned .802 and showed no convincing strands in the holdout.
3. **Protect structure while limiting the largest shadow specks.** The chosen variant, `tail` at 100%, uses a wider roughness and direction check and a separate fine edge check. Both judge gradient energy against each photo's fitted noise at the local brightness. Away from protected structure it removes 40% of the difference between the signal and its first smooth, and 88% of the difference between the first and a broader smooth (Gaussian σ 1.05 and 5 native px). In deeper noise-limited shadows it also trims the upper and lower tails of the remaining brightness departures. Without that step, 11 colour marks and 8 pits stand out on the Canon. With it, 8 and 3 do. It recentres the correction over 65 pixels and uses a limited local mean from the original signed Bayer samples to reduce shadow drift. Widening the allowable mean correction did not improve the main shadow. Trimming the remaining colour tails saved one newly worsened mark in the test of the wider mean correction, without improving its number of visible marks. That extra colour step was dropped.

The added filter changes developed brightness while keeping its two signed colour axes. It reuses the guard around protected Bayer highlights. The neighbourhoods are fixed and the strength sweep leaves round 3's early stages and its colour settings at the same values. [Trial receipts][output]

## Grain, mottling and tone

Grain size is the median-power wavelength in native pixels. Adjacent correlation measures how much the grain shares a pattern with the next pixel. Loudness is the RMS after removing broad shading. Colour mottling is 8–32 px colour RMS, divided by Clean Grain's. Mean brightness is measured on signed scene pixels.

| Fixed Canon patch | Measure | Off | Clean Grain | Round 3 | Round 4 | DxO Standard |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Dark background | Brightness RMS, % of own Off | 100 | 32.0 | 71.8 | **28.2** | 3.6 |
| | Grain, px | 3.51 | 7.95 | 3.30 | **2.98** | 2.91 |
| | Adjacent correlation | .31 | .80 | .23 | **.12** | .04 |
| | Colour RMS vs Clean Grain | 25.99× | 1.00× | .28× | **.28×** | .04× |
| | Mean brightness vs HDR Finisher Off | 0% | −2.13% | −0.99% | **−0.87%** | −94.51% |
| Floor | Brightness RMS, % of own Off | 100 | 34.8 | 74.2 | **39.9** | 47.8 |
| | Grain, px | 3.62 | 8.43 | 3.39 | **3.04** | 3.04 |
| | Adjacent correlation | .33 | .82 | .25 | **.16** | .10 |
| | Colour RMS vs Clean Grain | 6.69× | 1.00× | .27× | **.27×** | 1.41× |
| | Mean brightness vs HDR Finisher Off | 0% | +0.17% | −0.04% | **−0.01%** | +0.14% |
| Second dark patch | Brightness RMS, % of own Off | 100 | 32.1 | 72.1 | **28.4** | 4.4 |
| | Grain, px | 3.56 | 7.94 | 3.30 | **2.99** | 3.01 |
| | Adjacent correlation | .31 | .80 | .23 | **.13** | .06 |
| | Colour RMS vs Clean Grain | 20.53× | 1.00× | .23× | **.23×** | .05× |
| | Mean brightness vs HDR Finisher Off | 0% | +0.05% | −0.74% | **−0.38%** | −95.50% |

DxO Standard measures against DxO Off for brightness RMS. Its two dark readings come with a large change in black level. The gallery uses the earlier two-Off brightness alignment for DxO views only. The table uses the untouched measurements. The candidate meets the ±1% test. Both Canon dark samples remain slightly darker than Off. [Canon receipt][canon] · [DxO reference](dxo-comparison.md#spectral-fingerprint-of-dxo-standard)

| Sony fixed flats | Measure | Clean Grain | Round 3 | Round 4 |
| --- | --- | ---: | ---: | ---: |
| Portrait, four flats | Brightness RMS, % of Off | 5.8–6.2 | 71.3–73.8 | **36.6–38.0** |
| | Grain, px | 14.83–17.88 | 3.36–3.41 | **3.00–3.02** |
| | Adjacent correlation | .92–.94 | .25–.26 | **.12–.14** |
| | Colour RMS vs Clean Grain | 1.00× | .21–.68× | **.21–.68×** |
| | Mean brightness vs Off | −.34% to −.02% | −.08% to +.08% | **−.08% to +.08%** |
| ISO 10000, three flats | Brightness RMS, % of Off | 6.1–6.4 | 71.2–71.5 | **36.2–36.4** |
| | Grain, px | 13.49–15.47 | 3.50–3.59 | **3.08–3.15** |
| | Adjacent correlation | .91–.92 | .29–.30 | **.16–.18** |
| | Colour RMS vs Clean Grain | 1.00× | .69–.90× | **.69–.90×** |
| | Mean brightness vs Off | −.08% to −.03% | +.03% to +.08% | **+.04% to +.07%** |

### Where the remaining brightness power sits

Percent of the input power left in each band, using the same 14 px trend subtraction and Hann window for every method. DxO Standard uses its own Off. The share of the original power at 8–16 px falls farther than the share at 2–4 px. On the floor, for example, those are **3% and 21%**. The broadest band also contains shading and floor texture. Those numbers should not all be read as grain.

| Wavelength | Dark Clean | Dark R3 | Dark R4 | Dark DxO | Floor Clean | Floor R3 | Floor R4 | Floor DxO |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2–4 px | 0.9% | 58.9% | **10.4%** | 0.1% | 1.0% | 62.5% | **20.5%** | 31.3% |
| 4–8 px | 17.1% | 48.5% | **4.5%** | 0.1% | 18.4% | 53.0% | **9.8%** | 11.2% |
| 8–16 px | 47.0% | 20.6% | **1.0%** | 0.1% | 48.0% | 24.9% | **2.7%** | 6.3% |
| 16–32 px | 34.8% | 14.5% | **3.0%** | 0.1% | 46.5% | 16.9% | **4.9%** | 6.4% |
| 32–48 px | 14.2% | 18.4% | **12.7%** | 0.1% | 38.4% | 34.9% | **22.4%** | 17.5% |

## Colour and recognizable detail

Rendition follows round 3. Smooth signed scene RGB at σ 6 px, apply the matching SDR view, then compare the mean Lab colours. The forehead uses the same fixed sample within the face. The largest mean hue change is 0.26° and the largest absolute Lab chroma change is 0.29. A second calculation averages the display-mapped noisy pixels and gives ΔE 1.34 on the face and 2.40 on the skirt. Differences in the near-black pixel distribution after the SDR view affect that measurement. The fixed crops show both effects.

| Mean ΔE 2000 vs HDR Finisher Off | Face | Skin | Skirt | Flame |
| --- | ---: | ---: | ---: | ---: |
| Clean Grain | .054 | .035 | .049 | .258 |
| Round 3 | .023 | .251 | .109 | .063 |
| **Round 4** | **.024** | **.257** | **.109** | **.063** |
| DxO Standard | 6.885 | 6.948 | 5.736 | 12.271 |

Shared Canon edges are the same edges visible in both Off developments after smoothing at 3 and 6 px. The values project each candidate onto those edges. Higher scores here describe retained edge signal.

| Canon | Clean Grain, 3 / 6 px | Round 3, 3 / 6 px | Round 4, 3 / 6 px | DxO Standard, 3 / 6 px | R4 / Clean, 3 / 6 px | R4 / DxO, 3 / 6 px |
| --- | --- | --- | --- | --- | --- | --- |
| Face | .965 / .987 | .976 / .985 | **.974 / .982** | .881 / .948 | 1.01× / .99× | 1.11× / 1.04× |
| Hair | .901 / .940 | .894 / .918 | **.847 / .878** | .734 / .769 | .94× / .93× | 1.15× / 1.14× |
| Skirt | .907 / .950 | .978 / .984 | **.976 / .981** | .861 / .946 | 1.08× / 1.03× | 1.13× / 1.04× |

Face is ahead of Clean Grain at 3 px and .005 lower at 6 px. Skirt beats Clean Grain at both scales. Canon hair is around the .85 target with some softening relative to round 3. In the Sony portrait the fine specks compete less with diagonal locks, so the hair reads more clearly at 1:1. The ISO 10000 hair stays indistinct at the same lift. Its old noisy texture score drops from .597 to .186 and the Sony portrait drops from .763 to .528 as noise is removed. Those scores cannot tell which individual strands survived. [Canon hair][canon-hair] · [Sony hair][sony-hair] · [ISO 10000 hair][holdout]

## Marks and lights

The visibility counts use round 3's fixed centres and twice the grain in each method's own surrounding ring. Unique sites can count in both categories. A separate material-change screen compares absolute eight-bit display contrast against round 3 and flags changes above both 25% and two levels.

| Fixed marks | Method | Visible colour / pits | Unique visible | Unique materially worse vs R3 |
| --- | --- | --- | ---: | ---: |
| Canon, 38 | Clean Grain | 14 / 10 | 14 | 16 |
| | Round 3 | 9 / 4 | 10 | — |
| | **Round 4** | **8 / 3** | **9** | **4** |
| | DxO Standard | 8 / 2 | 8 | — |
| Sony, 25 | Clean Grain | 2 / 3 | 5 | 3 |
| | Round 3 | 0 / 2 | 2 | — |
| | **Round 4** | **0 / 0** | **0** | **0** |

The Canon aggregate improves. Two colour sites, `(4384,2476)` and `(4300,2508)`, and one pit, `(2360,1099)`, cross the visibility threshold as their surrounding grain drops. Four sites worsen in absolute contrast. On average the Canon marks' colour contrast and pit depth fall to 80% and 75% of round 3's. The fixed flame-area pit `(938,1740)` is shallower after brightness filtering. [Marked shadow][marked] · [Canon per-site results][canon] · [Sony per-site results][sony]

The three atrium lights have identical checked peak positions, centres, peak contrast, core values and total excess with round 3. The blue light still loses 3.92% of its wider glow against Off. Its largest individual RGB channel change at the core remains 24.75%, versus 23.43% for Clean Grain.

| Atrium light | Centre movement, Clean / R3 / R4 | Peak contrast change, Clean / R3 / R4 | Total excess change, Clean / R3 / R4 |
| --- | --- | --- | --- |
| Blue light on pole | .042 / .015 / **.015 px** | +2.33% / −1.49% / **−1.49%** | −10.55% / −3.92% / **−3.92%** |
| Railing lamp | .009 / <.001 / **<.001 px** | −0.43% / −0.01% / **−0.01%** | −0.77% / <0.01% / **<0.01%** |
| Light beside pole | .017 / .005 / **.005 px** | +0.11% / −0.13% / **−0.13%** | −1.93% / −0.63% / **−0.63%** |

[Light crop][atrium-crop] · [Atrium receipt][atrium]

## Luminance strength sweep

The numbers are relative to the trial's chosen recipe. Zero applies no round 4 correction. A slider could blend the two band gains from zero, with the shadow tail limit reaching its nominal value at 100%. The detail columns use the shared 3 px structure measurement. The 80% setting keeps hair at .857 but leaves 46.5% of the floor noise. At 115%, the floor drops to 35.5% and hair falls to .842. [Six strengths and three native crop comparisons][sweep-view] · [Sweep receipt][sweep]

| Added strength | Dark RMS, % Off | Floor RMS, % Off | Hair, 3 px | Face, 3 px | Skirt, 3 px |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0% (round 3) | 71.8% | 74.2% | .894 | .976 | .978 |
| 40% | 47.6% | 60.1% | .875 | .975 | .978 |
| 60% | 39.2% | 53.3% | .866 | .975 | .977 |
| 80% | 32.9% | 46.5% | .857 | .974 | .977 |
| **100%** | **28.2%** | **39.9%** | **.847** | **.974** | **.976** |
| 115% | 26.3% | 35.5% | .842 | .974 | .976 |
| 130% | 24.7% | 32.3% | .841 | .974 | .976 |

## WebGPU feasibility

The lead needs a tile with **64 native px of additional brightness-filter padding**. It can hold a tile's signed luminance, its two smooths, two sets of tensor terms, a compact highlight mask and the correction in reused 32-bit surfaces. Separable filters and a fixed local sum for the 65 px recentring give about 16–20 dispatches, with pointwise work combined into adjacent passes. A direct separable implementation with the measured Gaussian widths and naïve box sums would use roughly 600 tap contributions per padded native pixel. A 1024 px core with 64 px padding on each side takes about 5 MiB per float32 plane, or roughly 40–60 MiB across eight to twelve reused planes, in addition to round 3's tiles. Shared tile loads and a rolling box sum can reduce traffic. The lead uses no search loop or whole-frame solve.

The tested earlier-only candidate would add three separable smooths, a gradient/tensor gate and two centring passes on the quarter-resolution packed grid. The wider directional variant would add two sampled line kernels per native pixel after the guide, and the patch variant would compare sixteen 3×3 pairs in a 13×13 search. Their detail results give no reason to incur those extra costs. These are estimates of work and scratch, with no timed GPU implementation of this round. Any later prototype needs CPU/GPU tile and signed range agreement, then whole-wait measurements on the minimum Mac.

## Verification and memory

The heavy steps ran one photo at a time under `tools/gpu-run-lock.py` on the 8 GB MacBook Neo. They read the hash-checked round 3 staging windows and matched the prior Off, Clean and round 3 flat measurements. Round 4 read bounded windows only and kept its derivatives under `codebase/output`. The app code stayed untouched.

The highest measured process peak was **641.9 MiB** during the Canon finalist comparison. The final Canon, Sony portrait, ISO 10000 and atrium runs peaked at 521.9, 485.8, 253.4 and 238.5 MiB. The sweep peaked at 257.6 MiB. The verifier checked 106 linked native crops, exact round 3 output at zero added strength and overlapping tile cores on all four photos (maximum channel difference `2.2e-08`). The focused evaluation and model-window tests passed all **18 checks**, with two optional-dependency warnings and a 554.7 MiB peak. Workspace output went from 15.7 to 15.9 GB, including the parallel delivery work. [Reproduction and memory log][repro-log] · [Focused tests][test-log] · [Workspace output][output-log]

## Native crops and reproduction

The [review gallery][review] shows Off, Clean Grain, round 3, round 4 and the Canon-only DxO Standard at native dimensions. It includes the dark patches, floor, face, forehead, skirt, flame, hair, marks and atrium lights. The two Sony sections show hair, face detail and dark flats. Run [reproduce.sh][runner] from `codebase` with the round 3 staged crop cache in place. It writes the final JSON, six-strength sweep and gallery, then checks continuity and crop dimensions. [Initial method screen][screen] · [Finalist ablations][finalists]

[output]: ../../../../codebase/output/predemosaic-round4-2026-11-20/
[review]: ../../../../codebase/output/predemosaic-round4-2026-11-20/review.html
[canon]: ../../../../codebase/output/predemosaic-round4-2026-11-20/canon-final.json
[sony]: ../../../../codebase/output/predemosaic-round4-2026-11-20/sony-final.json
[holdout]: ../../../../codebase/output/predemosaic-round4-2026-11-20/review.html#ordinary
[atrium]: ../../../../codebase/output/predemosaic-round4-2026-11-20/atrium-final.json
[canon-hair]: ../../../../codebase/output/predemosaic-round4-2026-11-20/review.html#canon-hair
[sony-hair]: ../../../../codebase/output/predemosaic-round4-2026-11-20/review.html#sony-hair
[marked]: ../../../../codebase/output/predemosaic-round4-2026-11-20/review.html#canon-marked-shadow
[atrium-crop]: ../../../../codebase/output/predemosaic-round4-2026-11-20/review.html#atrium
[sweep-view]: ../../../../codebase/output/predemosaic-round4-2026-11-20/review.html#sweep
[sweep]: ../../../../codebase/output/predemosaic-round4-2026-11-20/canon-sweep.json
[runner]: ../../../../codebase/output/predemosaic-round4-2026-11-20/reproduce.sh
[screen]: ../../../../codebase/output/predemosaic-round4-2026-11-20/canon-screen.json
[finalists]: ../../../../codebase/output/predemosaic-round4-2026-11-20/canon-candidates.json
[repro-log]: ../../../../codebase/output/predemosaic-round4-2026-11-20/reproduction.log
[test-log]: ../../../../codebase/output/predemosaic-round4-2026-11-20/focused-python.log
[output-log]: ../../../../codebase/output/predemosaic-round4-2026-11-20/output-size.log
