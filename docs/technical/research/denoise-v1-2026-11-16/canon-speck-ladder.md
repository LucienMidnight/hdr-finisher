# Canon speck strength ladders

18 November 2026 · IMG_0790.CR2 · MacBook Neo, A18 Pro, 8 GB · Research only

## Visual result

**The first setting that plainly removes isolated dark and coloured specks
across the Canon shadows is Whole-image smoothing, Colour and brightness,
step 3.** The 8-pixel blur removes the hard black points in the flat S1
shadow and the little blue, green and magenta spots around the D4 railing.
Broad, faint colour patches still show in S1. Step 2 visibly clears some
smaller spots beside the flame, but darker pits and coloured spots still
stand out in the shadows. Step 3 also smears the left dancer’s hair and face,
merges skirt strands, and softens the flame edge. It is a demonstration that
the spots can be removed, at a visible cost in detail.

**Fine/Medium-only cleanup is insufficient on this photo.** Even keep at
step 4 removes both bands and still leaves obvious spots in S1 and D4.
Raising the local noise strength to 8× has the same problem and creates
a hard red fringe around parts of the flame. Filling pits after Denoise at
step 3 lifts some of the black centres, including D4 mark 5, but leaves
coloured spots or visible outlines around several fills. Filling within the
two bands does less to the conspicuous shadow pits. These are the researcher’s
crop observations. Steve’s visual verdict and detail-cost decisions are pending.

**RawNIND shows the best detail trade-off in this comparison.** It clears
the hard shadow specks in S1 and the dark blue pits at D4 marks 1 and 2 while
keeping separate skirt strands in D3. It shifts the shadow colour towards
red-magenta, leaves a few small marks, and shows a grain transition around
the protected flame in S2.

## The pictures to review

Open `codebase/output/denoise-v1/canon-ladder/index.html`. Choose a method and
whether it changes colour, brightness or both. Noisy, Baseline and RawNIND
start each comparison. Choose a mark to put the same location at 6× in every column,
drag a picture to pan the row, or switch to Fit crop for the whole area. Toggle
Steve’s marks to see the specks without circles. Record the first step at which
the specks are gone and whether its loss of detail is acceptable. The page
exports the 38 original marks and your decisions as JSON.

| Area | Steve’s worst problem | Original marks |
| --- | --- | ---: |
| S1 · Flat dark background | Dark pits | 0 |
| S2 · Flame against dark background | Colour specks | 13 |
| D1 · Centre dancer’s face | Blotchy colour | 10 |
| D2 · Left dancer’s face and hair | Dark pits | 0 |
| D3 · Grass skirt strands | Dark pits | 0 |
| D4 · Railing in shadow | Dark pits | 15 |

All six original 512×512 areas stay in the review. The full crops use JPEG
with full colour resolution. The 48×48 close-ups at each of the 38 marks
are lossless, as are the centre close-ups in the three unmarked areas.
Images use nearest-neighbour enlargement at 6×. The three unmarked areas
can only contribute a visual judgment.

## Counts at roughly grain level

Each cell gives **brightness / colour / both (+ newly near grain in both)**,
out of 38 marks. Baseline is **12 / 8 / 4**. RawNIND is **35 / 32 / 31 (+27)**.

| Method | Apply to | Step 1 | Step 2 | Step 3 | Step 4 |
| --- | --- | ---: | ---: | ---: | ---: |
| Even keep | Colour only | 16 / 12 / 8 (+4) | 18 / 9 / 9 (+5) | 18 / 12 / 11 (+7) | 19 / 16 / 13 (+9) |
| Even keep | Brightness only | 19 / 10 / 8 (+4) | 24 / 10 / 8 (+4) | 25 / 10 / 8 (+4) | 18 / 12 / 10 (+6) |
| Even keep | Both | 18 / 12 / 7 (+3) | 23 / 14 / 7 (+3) | 23 / 18 / 9 (+5) | 20 / 18 / 15 (+11) |
| Stronger Denoise | Colour only | 15 / 10 / 8 (+4) | 19 / 12 / 9 (+6) | 18 / 13 / 10 (+6) | 18 / 15 / 12 (+8) |
| Stronger Denoise | Brightness only | 14 / 11 / 7 (+3) | 17 / 9 / 7 (+3) | 17 / 9 / 7 (+3) | 18 / 11 / 9 (+5) |
| Stronger Denoise | Both | 15 / 11 / 8 (+4) | 20 / 14 / 11 (+7) | 20 / 15 / 12 (+8) | 19 / 17 / 14 (+10) |
| Fill inside | Brightness only | 19 / 7 / 5 (+1) | 19 / 6 / 5 (+1) | 19 / 6 / 5 (+1) | — |
| Fill inside | Both | 19 / 13 / 11 (+7) | 25 / 14 / 12 (+9) | 24 / 18 / 16 (+12) | — |
| Fill after | Brightness only | 18 / 11 / 7 (+3) | 19 / 10 / 8 (+4) | 21 / 9 / 7 (+3) | — |
| Fill after | Both | 20 / 13 / 11 (+7) | 26 / 17 / 13 (+10) | 28 / 20 / 18 (+14) | — |
| Whole-image smoothing | Colour only | 16 / 11 / 8 (+5) | 20 / 17 / 14 (+10) | 21 / 26 / 21 (+17) | — |
| Whole-image smoothing | Brightness only | 17 / 13 / 10 (+6) | 23 / 12 / 11 (+7) | 26 / 13 / 11 (+7) | — |
| Whole-image smoothing | Both | 19 / 14 / 10 (+7) | 29 / 21 / 18 (+14) | **38 / 32 / 32 (+28)** | — |

At baseline, 22 marks were more than twice the grain darker than their
surroundings. Step 3 of Whole-image smoothing on both brought all 22
to grain level. RawNIND brought 20 down to that level. The strongest
combined pit fill after Denoise brought 14 down. Holding the grain
reference fixed at its baseline value leaves all three energy-matched
combined Even keep steps at 4/38 in both brightness and colour. Their
higher counts in the table reflect the grain they put back. The strongest
whole-image blur puts all 38 marks within twice the original grain. Six
still exceed twice the much quieter colour grain in the blurred crop itself.

A click is moved by at most two pixels in each direction to the strongest
local point on the production baseline. The same point is scored in every
version using the surrounding 6–12 pixel ring. The mark counts ask whether
the pixel differs from that ring by at most twice its typical grain, with
a one-display-level floor. Colour uses the whole colour distance, so a spot
that flips hue can still count as a speck. The separate scores check both
directions of brightness, so a pit that becomes an obvious bright dot still
fails. Blurring can flatten the surrounding grain as well as the spot, and
adding grain can bury a spot without removing it. The counts also have no
way to know which features belong to the subject. The crop comparison is the
decision. The per-mark readings and per-area counts are in
`codebase/output/denoise-v1/canon-ladder/metrics.json`.

## What changed in each ladder

- **Even keep.** Today's Denoise decides how much texture to keep at each
  pixel. Steps 1 and 2 average those decisions over 6 and 18 pixels. Step 3
  uses one keep factor for each of the Fine and Medium sizes across the whole
  photo. The first three steps retain the same total energy in each band and
  component as the baseline. Step 4 drops both bands in the chosen components
  to show what even total removal at those sizes can do.
- **Stronger Denoise.** Raise the amount of noise the Fine and Medium bands
  are assumed to contain by 1.5×, 2.5×, 4× and 8×. Denoise still decides
  how much to keep from point to point. The three other sizes stay at their
  shipping settings.
- **Fill pits, inside or after Denoise.** Estimate the background and grain
  from opposite points in a 6–12 pixel ring. A compact dark centre starts
  to lift at 3×, 2× or 1.5× the grain, with a gradual ramp over one extra
  grain unit. A low side or dark streak limits the lift. The inside version
  reads and corrects the retained Fine and Medium brightness signal. The
  after version reads and corrects the whole denoised brightness image.
  The pit correction itself only lifts brightness. The combined rows pair it
  with the separate colour ladder’s 1.5×, 2.5× and 8× steps.
- **Whole-image smoothing.** Blur the finished image with a Gaussian of
  2, 4 or 8 pixels (standard deviation). This deliberately tests how much
  blur clears a residual that survives the two target bands. The colour-only
  version holds scene brightness fixed, and the brightness-only version
  holds scene colour fixed.

Every version uses the same crop positions and display lift. Noisy is
signed AHD with Denoise and Even out both off. Baseline is production signed
AHD, Even out ×2.5, as-shot white balance, Opposed color reconstruction,
lens correction off and shipping Denoise on the CPU. The classical trials
share the baseline’s whole-photo noise measurement. The original Bayer AI has
its own reconstruction: the model sees the original sensor samples in its
trained range, and a 32-pixel blend keeps the normal Opposed reconstruction
around clipped parts of the flame. Differences in texture can show at that
blend, and the model clips negative sensor values at its input, so the AI
column is a useful visual reference with its own trade-offs. [AI highlight trial](ai-highlights.md)

## Native CPU cost on the 18 MP Canon

These are native CPU times on the 18.02 MP Canon, with one worker on the
MacBook Neo under the shared lock. The two sweeps used opposite orders.
They start with the developed frame and measured noise already available.
Development with Even out took 3.23 s and the noise measurement 1.65 s
once. The ranges describe the observations. Baseline variation exceeded
the previous round’s 10% descriptive allowance, so small differences
between methods do not establish a speedup.

| Method | Native filtering cost, seconds | What is included |
| --- | ---: | --- |
| Baseline | 4.86–5.80 | Shipping Denoise resolve |
| Even keep, steps 1–3 | 13.30–19.78 | 9.66–10.40 to match energy across the frame, plus the modified resolve |
| Even keep, step 4 | 3.74–4.30 | Modified resolve, with the two bands removed |
| Stronger Denoise | 3.92–5.84 | Modified resolve |
| Fill pits inside Denoise | 6.47–8.22 | Modified resolve and ring-based fill |
| Fill pits after Denoise | 7.14–8.58 | Resolve and ring-based fill. Brightness-only fill adds 2.26–2.55 s to the baseline |
| Whole-image smoothing | 4.90–6.00 | Resolve and blur. Combined step 3 adds 0.14 s |
| RawNIND Bayer | 14.40 | One cold run from original sensor read through protected blend. Model stage was 9.69 s |

The completed render and timing run held the shared lock for 7 min 33 s and
peaked at 1.76 GB sampled process-tree memory. The RawNIND child completed
within its limit, peaking at 1.53 GB.

Only this Canon’s original was opened to generate the review. The run
instructions include the optional hash-verified Bayer model. [Harness README](../../../../codebase/tools/denoise_eval/README.md#canon-speck-strength-ladders)

## Checks and retained output

The review contains 45 candidate settings and three references across six
areas. Its 577 image files, page and receipts total **17,933,463 bytes
(17.93 MB)** including the local score chart. Scratch output started at
13.2 GB and ended at 13.3 GB, below the 100 GB cap. The temporary renders
and test browser profile were removed.

The standalone page loaded all images and passed method switching, the
matched 6× view, fit and mark jumps, overlay toggling, answer retention and
a downloaded JSON check. A synthetic scene checked the unchanged CPU
baseline, band energy matching, channel isolation, compact pit lifting,
and tile boundaries for every candidate. Node reported 1,108 passes and
one skip. Python reported 4,256 passes, 155 skips, one previously recorded
unexpected pass and the existing Starlette warning. Existing GPU drivers
do not exercise these standalone CPU research methods.
