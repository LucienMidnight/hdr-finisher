# Colour specks marked by Steve

18 November 2026 · MacBook Neo, A18 Pro, 8 GB · Research only

**Keep today’s settings.** The wide-area colour reference (A) barely changes the marked spots, whether it runs before or after Denoise. The brightness-guided method (B) fades many spots. The median colour excursion falls by 29%, and 121 of 238 marks lose at least a quarter of their colour excursion. The same method visibly bleeds colour around the red logo, isolated stars and the lighthouse light, and softens the edges of the coloured letters. That fails the detail requirement.

## What the marks showed

Steve marked 238 spots that remain with **Today + Even out harsh specks ×2.5**. The marks cover eight of the 11 photos. All 54 fixed areas went into the trial, including 39 detail areas and three photos with no points marked. In the 45 areas with a “worst problem” answer, 30 pointed to colour specks, 11 to dark pits and four to blotchy colour. Of the 16 recorded Today vs Even out comparisons, nine say **Today** looked worse and seven say they looked the same. Steve described Even out as an improvement in almost all cases in his notes. [Steve’s areas](../../../../codebase/tools/denoise_eval/steve-areas-2026-11-18.json) · [Steve’s marks and notes](../../../../codebase/tools/denoise_eval/steve-marks-2026-11-18.json)

Green or magenta was the strongest colour direction at **144 spots** (49 green, 95 magenta). Another **77** leaned mainly blue or red (73 blueward, four redward), and 17 had weak colour relative to their surrounding grain. At 186 marks, colour stood out more strongly than brightness when each was compared with its own surrounding grain. In display brightness, 129 spots were at least two points darker than their surroundings on a 0–100 scale. Both trials therefore treat the green–magenta and red–blue colour directions and preserve scene luminance. The brightness pits remain a separate problem.

Across the 224 measurable footprints, the middle spot covered **38.5 pixels** of area, equivalent to a circle about seven pixels across. The middle half covered about 28–55 pixels. The footprint followed the dominant colour or brightness excursion. Four footprints reached the measurement boundary and ten were below the measurement threshold.

| Photo and subject | Marks | Green / magenta | Blue / red | Weak colour | Median footprint, pixels | Darker by ≥2 display points | Sensor outlier original → tamed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| IMG_0790.CR2, fire dancers | 38 | 6 / 13 | 11 / 0 | 8 | 33 | 26 | 5 → 0 |
| DSC05293.ARW, café | 0 | — | — | — | — | — | — |
| _DSC7970.ARW, eyelashes | 25 | 6 / 6 | 10 / 1 | 2 | 52 | 5 | 0 → 0 |
| DSC08360.ARW, stars | 21 | 4 / 7 | 9 / 1 | 0 | 47 | 16 | 2 → 2 |
| P7310446.ORF, ISO 25600 beach | 36 | 4 / 15 | 16 / 0 | 1 | 41 | 21 | 0 → 0 |
| P7310465.ORF, lighthouse | 34 | 9 / 18 | 2 / 1 | 4 | 37 | 11 | 0 → 0 |
| DSC00512.ARW, red logo and skull | 32 | 6 / 14 | 9 / 1 | 2 | 37 | 16 | 9 → 4 |
| DSC00786.ARW, camera lettering | 0 | — | — | — | — | — | — |
| DSC05622.ARW, eyelashes | 18 | 2 / 11 | 5 / 0 | 0 | 42 | 13 | 1 → 0 |
| PA310516.ORF, leaves | 0 | — | — | — | — | — | — |
| PC131157.ORF, dog and fur | 34 | 12 / 11 | 11 / 0 | 0 | 33.5 | 21 | 1 → 1 |

### Where the spots became visible

Only **seven** marks had a nearby sensor reading at least four times the expected spread after Even out, down from 18 in the original readings. That association is possible sensor evidence. The same signature can occur at real details. Joint errors from several ordinary readings processed together by the demosaicer remain plausible.

Denoise reduced the median colour excursion and quieted the surrounding colour much more. From the tamed demosaic to the baseline, the median absolute colour excursion at these selected positions fell from 9.3 to 6.7 points of normalized display colour. Typical colour grain in the ring fell from 9.4 to 0.9. The median projected score rose from about 1 to 6.9 times the local grain. When a diagnostic applied one gain per wavelet band throughout an area and matched the energy retained by today’s method, that score fell to 2.2. There were 117 sites matching the same-sign survivor test and 24 with a meaningful reversal of the local colour direction. These tests can overlap. A spot can already exist in the developed data and become conspicuous only after Denoise.

| Photo | Keep-map survivor | Colour reversal | Emerged after Denoise | Present before, sensor / no sensor witness | Weak or ambiguous |
| --- | ---: | ---: | ---: | ---: | ---: |
| IMG_0790.CR2 | 12 | 2 | 18 | 0 / 2 | 4 |
| _DSC7970.ARW | 16 | 0 | 7 | 0 / 1 | 1 |
| DSC08360.ARW | 9 | 5 | 7 | 0 / 0 | 0 |
| P7310446.ORF | 12 | 8 | 15 | 0 / 1 | 0 |
| P7310465.ORF | 14 | 4 | 14 | 0 / 1 | 1 |
| DSC00512.ARW | 20 | 3 | 7 | 0 / 0 | 2 |
| DSC05622.ARW | 13 | 0 | 5 | 0 / 0 | 0 |
| PC131157.ORF | 13 | 2 | 18 | 1 / 0 | 0 |
| **Total** | **109** | **24** | **91** | **1 / 5** | **8** |

Each mark appears once in this table, assigning reversals first, then survivors and the remaining signatures. “Emerged” means the measured excursion stood out at least twice the grain after Denoise and less than once the grain before it. This can include an already present colour peak buried in dense input grain. All marks were chosen on the finished baseline, which favours its most visible peaks. The equal-energy control is a causal check on the local keep decisions at those sites. These frequencies apply to Steve’s marks and are unsuitable as estimates for arbitrary photos. The set has no clean matching exposure with which to assign every spot a cause.

### How the locations were traced

For each click, the trace takes the most conspicuous pixel at most two sensor pixels away in each direction on the baseline. That position, the baseline colour direction and the bright/dark sign are then held fixed. The 6–12 pixel surrounding ring gives a median for the local ground colour and a robust spread for grain, with a floor of one 8-bit level. The footprint is the connected region above half the peak and twice the grain, within a 25-pixel square. The sensor witness is the 5×5 raw neighbourhood around the measured point, before and after the shipped sensor clamp, compared within each same-filter Bayer phase. It includes the taps nearest the demosaiced position and is a bounded test for an association.

The survivor test requires a same-sign pre-Denoise peak above typical grain, at least 25% more conspicuous with the baseline keep decisions, and at least 25% less conspicuous when those decisions are replaced by constant energy-matched gains. A reversal requires a strong baseline colour excursion and an opposite projection before Denoise of at least one display level and a quarter of the final excursion. Attributions start with the same production RAW development as the baseline marking page. The bounded same-site baseline was verified against full-frame production Denoise at every scored position during the review run. [Trace script](../../../../codebase/tools/denoise_eval/colour_speck_marks.py) · [Earlier equal-energy diagnostic](speck-rnd-proposal.md)

## What the trials changed

The comparison uses Steve’s frozen areas and hash-verified originals, signed AHD, as-shot white balance and camera colour, Opposed color highlight recovery, lens correction off, Even out ×2.5 and shipping Denoise controls. Each photo uses its baseline whole-photo noise model in all three trials. The display uses the original marking-page lift for that photo. All trials leave linear ACEScg brightness fixed to floating-point rounding. A shift in colour can still change the apparent brightness under the display’s gamut mapping and highlight roll-off.

- **A · Wide colour reference.** Samples two rings roughly 20–40 pixels away on a quarter-resolution guide, avoiding the footprint. The path to a sample has to stay on the same brightness surface. A ring with mixed colour or too few trustworthy samples gets little or no weight. The filter only shrinks colour excess with a matching compact excursion. An aligned brightness feature at two scales weakens the correction. Test the same method before and after Denoise. The before version restores the baseline’s linear brightness after filtering so placement can be compared on colour alone.
- **B · Brightness-guided colour.** During the existing fine and medium wavelet steps (about 2–4 and 8 pixels), reduces the colour that Denoise would otherwise keep by up to 65%. The correction eases off where a brightness feature is strong and aligned across the band and its next finer neighbour. This reuses the wavelet pass. It leaves the underlying brightness, the finest colour band and both coarse colour bands alone.

Both prototypes use brightness structure for detail protection. The common baseline includes the shipped sensor clamp. The individual trials reached their decision before testing the optional sensor-veto or grain combination. [Candidate implementation](../../../../codebase/tools/denoise_eval/candidates/colour_speck.py) · [Previous colour-only trials](chroma-cleanup.md)

## What faded and what was lost

The marked colour distance and brightness distance below are medians in 0–100 display units, from the point to the surrounding ring. Grain is the typical spread in that ring. Conspicuousness compares colour along the original baseline direction with that grain. The 25% count uses total colour distance on both chroma axes and excludes baseline colour distances below 1.5 display points, where small changes can look large as percentages.

| Method | Marked colour | Colour grain | Colour vs grain | Marks with ≥25% less colour | Marked brightness | Brightness grain |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Today + Even out ×2.5 | 6.70 | 0.89 | 6.86× | — | 3.20 | 0.99 |
| A after Denoise | 6.70 | 0.89 | 6.86× | 0 / 238 | 3.20 | 0.99 |
| A before Denoise | 6.70 | 0.87 | 6.86× | 1 / 238 | 3.20 | 0.98 |
| B, brightness-guided | **4.74** | 0.84 | **5.48×** | **121 / 238** | 2.74 | 0.98 |

B’s largest median colour drops were on the dog (20.85 → 13.62), the close eye and lashes (12.70 → 8.13), the star field (10.54 → 7.35) and the Canon (10.57 → 7.45). The very noisy beach changed little (3.05 → 2.88). One B mark increased by at least 25% and half a display point. The strongest marked brightness deficits remain. The largest difference in actual linear luminance in any of the 54 areas was about 0.0000007, at the level of floating-point rounding. The smaller displayed brightness number reflects the colour-dependent display conversion.

All 39 detail areas were screened with side-by-side crops and colour and edge measurements. I then inspected the named features more closely. The table gives B’s retained share of local colour and its edge, relative to the baseline. The masks are selected on the baseline within fixed feature boxes. A’s named feature scores stayed within about half a percentage point of the baseline. Weakening visible real colour is enough to fail. The photos lack clean matching exposures, so some of the coloured fringe on the stars and lashes could itself be noise. The known red logo and blue letter are sufficient controls to make the decision.

| Detail | B local colour retained | B colour edge retained |
| --- | ---: | ---: |
| Red logo | 67% | 63% |
| Red “T*” | 85% | 75% |
| Blue “S” | 84% | 79% |
| Red / green leaves | 81% / 84% | 77% / 80% |
| Pleiades | 79% | 76% |
| Three isolated stars | 88–92% | 75–79% |
| Orange lighthouse light | 87% | 76% |
| Canon lips / eyes | 67% / 62% | 60% / 54% |
| Two eyelash and iris crops | 82% / 82% | 74% / 71% |
| Dog eye and fur | 92% | 87% |

At close range B rounds off the red logo’s colour edge and spreads it outside the lit shape. It changes the coloured rims of point lights, particularly the isolated star at the left of DSC08360 D2 and the orange light in P7310465 D1. Lash and letter silhouettes are still visible. The measured colour edges soften, and the eye and lip colours look flatter. A’s caution buys little visible cleanup. [Feature measurement](../../../../codebase/tools/denoise_eval/colour_speck_features.py)

## Native CPU speed

Paired full-resolution runs use the same developed input and noise model,
under the shared lock on the six-core MacBook Neo. Each method ran three
times in alternating order on the Canon IMG_0790.CR2 and Sony DSC04375.ARW.
The table reports wall time from the start of Denoise through its colour
result, excluding the common RAW development and noise-model preparation.
The added times are medians of the paired differences. The target was
about one second added at 18 MP, with the existing ±10% descriptive allowance
for timing variation.

| Method | 18.02 MP total / added | 42.39 MP total / added |
| --- | ---: | ---: |
| Today + Even out source, Denoise resolve | 3.51 s / — | 8.66 s / — |
| A after Denoise | 4.67 s / **+1.16 s** | 11.64 s / **+3.05 s** |
| A before Denoise | 8.42 s / **+4.86 s** | 20.88 s / **+12.21 s** |
| B, brightness-guided | 3.74 s / **+0.58 s** | 9.32 s / **+0.67 s** |

The directly timed A-after pass takes 1.09 s at 18 MP and 2.51 s at 42 MP.
It is borderline at 18 MP, with the paired result above the target. The
tested A-before comparison requires an extra Denoise resolve to supply the
unchanged baseline brightness. At this cost it would require opt-in use.
B meets the native CPU target at 18 MP and uses the same five-band resolve
with a little more math in two bands.

Slider response is unverified for both methods. A-after would repeat work
on the changed Denoise output. B adds no separate CPU pass. In the app’s
GPU path, a slider change can dispatch the wavelet passes for the area on
screen. A fused B implementation would still need to demonstrate equal
action-to-screen slider response. The CPU cost here measures a native
resolve and gives no slider or GPU timing. [Paired timing ranges](../../performance-table.md)

## Recommendation and review

Keep the current controls. If another colour experiment is worthwhile,
start from B’s clear improvement at the marked points. Test a narrower
correction that also protects a common edge or point shape in multiple
colour channels, and require the logo, coloured lettering and point lights
to pass before spending time on speed. On the Canon and beach, assess the
dark cores separately from the coloured rims.

Open `codebase/output/denoise-v1/colour-trials/index.html`. It shows Noisy,
Today + Even out ×2.5, A and B with linked scrolling and zoom. A has a
before/after placement switch. You can toggle the original marks, jump to
one at 6× and score “A better”, “Looks the same” or “Baseline better” for
each area, with the same choices for B. The best places to see the
trade-off are DSC00512 D1 (logo), DSC00786 D1/D3 (lettering), DSC08360 D2
(stars), P7310465 D1 (orange light) and PC131157 D1 (dog’s eye).

The review contains all 54 fixed areas, 238 original marks, 270 crops and
11 thumbnails. Total size is 18,955,899 bytes. The review, per-mark and per-
area readings, and named feature scores are local in `colour-trials/`. The
attribution and timing receipts are `colour-speck-attribution.json` and
`colour-speck-timing.json` in its parent directory. The scripts and report
are the reproducible record. [Run instructions](../../../../codebase/tools/denoise_eval/README.md)

The standalone page check covered every image path, the 6× mark jump,
linked scroll, original mark visibility, placement changes and stored
answers. The spot and tile checks passed. JavaScript recorded 1,108 passes
and one skip. Python recorded 4,256 passes, 155 skips, one unexpected pass
already seen in earlier research, and the existing Starlette warning.
The new kernels run only in CPU research tooling, so existing GPU
drivers provide no coverage for them. Scratch output started at 13.2 GB
and ended at 13.3 GB under the 100 GB cap. Temporary test and visual
inspection files were removed.
