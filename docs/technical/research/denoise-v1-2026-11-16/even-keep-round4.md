# Even keep brightness and targeted speck cleanup

18 November 2026 · MacBook Neo, A18 Pro, 8 GB · Denoise research

## Result

**Keep the original 18 px Even keep brightness as the reference for Steve’s
grain.** The 12, 24 and 32 px settings made little difference to the decision.
Neither of the two faster local averages reproduced the earlier texture.
The best combination I found on the Canon was **Even keep brightness 18 px
+ Green/magenta channel balance (strong) + Dark clump breakup (strong)**.
The two extra passes helped selected specks around the railing and lifted
some dark centres. The full combination changed real stars, lettering and
fabric in the 54-area check and is unsuitable as a general preset. The
magenta spot beside the flame and several dark or blue-rimmed clumps remain.
AI Denoise is still the clearest reference for a smoother result.

## Canon marks

All 38 marks use the positions and surrounding grain rings from the
previous ladder. Only S2, D1 and D4 have marks. S1, D2 and D3 are visual
checks. A spot is at about grain level when it is within twice the
surrounding grain. The same Today grain reference also follows every mark
across the rows, so an increase in grain cannot count as removal of the
spot. The grain reference has a one-display-level floor.

| Brightness version | Marks near its own brightness grain | Marks near Today’s brightness grain | Typical surrounding brightness grain, display points |
| --- | ---: | ---: | ---: |
| Today | 12 / 38 | 12 / 38 | 1.22 |
| Even keep brightness 12 px | 24 / 38 | 12 / 38 | 4.10 |
| Even keep brightness 18 px | 24 / 38 | 12 / 38 | 4.45 |
| Even keep brightness 24 px | 25 / 38 | 12 / 38 | 4.53 |
| Even keep brightness 32 px | 25 / 38 | 12 / 38 | 4.64 |
| 18 px local average only | 18 / 38 | 18 / 38 | 1.20 |
| 18 px local grain-weighted average | 14 / 38 | 13 / 38 | 1.31 |

The grain-matched 18 px version reproduces the previous ladder to display
rounding. The plain local average makes some pits shallower, especially
in the flat shadow, and leaves a quieter texture. The grain-weighted
average uses only nearby band energy and puts back little of the previous
grain. Against the old 18 px result, the plain version’s six Canon crops
have mean ΔE 2000 of 1.38–5.81 and 99th percentile of 7.26–20.09. The weighted
version has mean 1.11–5.28 and 99th percentile 6.03–19.48. Both miss the
pre-declared equivalence screen of mean at most 1 and 99th percentile at most
3 per crop. The lower-grain result is also visible in the 6× views. The
18 px grain match is therefore the base for all the colour and dark-clump
rows and for Part 2.

- **Hue unify.** Both strengths brought the colour distance down by at
  least a quarter at two green/magenta marks, D4 marks 3 and 11. Strong
  reduced them from 16.4 to 6.2 and 11.9 to 4.4 display points respectively.
  The prominent magenta spot at S2 mark 1 and the marked face blotches
  were largely unchanged.
- **Green/magenta cleanup and channel balance.** The strong local-colour
  and strong balance versions brought the same two specks down to about
  the surrounding colour grain. Strong balance lowered them to 4.7 and 1.7
  display points, leaving the least colour across the pair. It keeps the
  independent red–blue balance intact. I kept the correction in the
  green/magenta range. The 11 red/blue marks on the Canon had no comparable
  colour response, and the wider trial has real blue stars and blue/red
  lettering in that range.
- **Dark clump breakup.** At 18 px, 12 marked pits still stood out against the
  surrounding brightness grain. Gentle centre lift made two at least a quarter
  shallower and brought one to about grain level. Strong made four at least
  a quarter shallower and brought all four to about grain level. S2 mark 5
  went from 12.3 to 2.5 display points darker than its ring. The Medium-only
  version changed fewer pits, with zero at grain level at either strength.
  On D1 mark 5 the lift made a blue rim more visible even though the pass
  leaves the underlying linear colour differences alone.

The full combination cut colour distance by a quarter at three marks
relative to 18 px alone. Three other marks had at least a quarter more
visible colour and were at least half a display point stronger. D1 mark 5
shows the trade-off most clearly. The pit lifted by 13.3 display points
while its colour distance rose from 17.9 to 32.8. The colour-only rows
hold scene brightness to floating-point rounding, and the dark-only
rows hold scene colour differences to the same precision. RawNIND was near both
brightness and colour grain at 31 of 38 marks by its own grain, and 34 of 38
by Today’s grain. Its quieter background and shadow colour shift are visible
in the same rows. [Previous Canon comparison](canon-speck-ladder.md)

### Why Even keep colour made more specks visible

The old colour version spread each pixel’s keep decision to its
neighbours, then adjusted the average to restore the same overall amount
of retained colour detail. That can give back colour noise in a spot whose
own keep value was close to zero. On this Canon the median colour distance
at the marks rose from 10.6 to 19.3 display points, and 21 of the 38 marks
got at least a quarter stronger and at least half a point stronger. In
selected areas where Today had removed most of the 2–8 px colour variation,
the old version restored about 44–47% of that variation from the developed
photo. That supports Steve’s reading of newly visible colour specks.
[Earlier colour measurements](colour-speck-trials.md)

## How the prototypes work

- **Even keep brightness** averages the Fine and Medium brightness keep
  maps in a square reaching 12, 18, 24 or 32 pixels from each centre pixel.
  The grain-matched version measures the total brightness detail kept in
  each band and uses that amount to correct the average. The two local
  versions skip that measurement and work inside the existing CPU Denoise
  resolve.
- **Hue unify** examines chroma-weighted hue sectors in a 49×49 neighbourhood,
  excluding the centre 25×25. Weak or exceptional colour readings get
  less weight. For green/magenta blobs no more than 12 px across, it moves
  the hue toward the nearest supported part of the range. A hue already
  inside a supported range stays put. Just outside, the movement starts
  gently, and farther out it grows. Extra chroma can also move toward the
  typical surrounding level. The other targeted version uses opposite
  samples around the spot to estimate a single local colour. Its simpler
  channel-balance variant moves only green versus the average of red and
  blue. The detector uses the photo’s noise measurement to judge how large
  the colour excursion is. Brightness edges and texture do not veto colour
  correction.
- **Dark clump breakup** compares the dark area with the local brightness
  slope, expected noise at that brightness and the actual nearby run length
  and depth of fine grain. It lifts mainly the interior of a compact clump
  while leaving the fine brightness variation in place. The alternative
  subtracts only the negative part of the resolved Medium band inside the
  same mask, leaving its Fine-band input intact.

All classical comparisons start with signed AHD, Even out harsh specks
×2.5, as-shot white balance and Opposed color recovery. Today is the
production CPU reconstruction at shipping defaults. The crops use the
same display lift across rows. AI uses the previous protected Bayer route
from the original sensor data. [Instructions and inputs](../../../../codebase/tools/denoise_eval/README.md#even-keep-brightness-and-targeted-specks)

## All 54 areas

**The full combination fails the edge-case check.** The Canon improvement
comes with visible changes at some real point lights, lettering and fabric.
Each row uses the same camera development and display lift. The percentages
below compare the strength of a feature’s colour or brightness edge with
Today’s. The 18 px row shows how much of a change came from the grain
adjustment itself.

| Feature | What to look for |
| --- | --- |
| Coloured stars and Pleiades · DSC08360 D1/D2 | The middle isolated star’s purple rim turns cyan and loses shape. Its colour edge measures 99% after Even keep and 33% after both extra passes. Pleiades keeps about 91% of its colour edge and individual star rims change. Without a matched clean exposure, the exact original star-rim colour is uncertain. The change to these real point lights is plainly visible. |
| Red “T*” and blue “S” · DSC00786 D1/D3 | The red lettering gets softer and the blue letter changes less. Their full colour edges measure 79% and 86% of Today’s, compared with 95% and 90% in the 18 px rows. |
| Red logo · DSC00512 D1 | The logo stays red, with 99% of its colour edge. There is a softer brightness edge around the logo, at 76% of Today’s strength, already present in the 18 px row. |
| Green and magenta foliage · PA310516 D1–D3 | Both leaf colours and the stripes remain recognisable. The strongest edges in the green and magenta leaf boxes retain about 96% and 95% of Today’s colour edge. There are small local changes along the red/magenta leaf. |
| Eyelashes · _DSC7970 D1 and DSC05622 D1 | The lash shapes remain. The two brightness edges are about 87–89% of Today’s, mostly from Even keep. The full combination also softens colour near the iris and lashes, down to 90–93% of their original colour-edge strength. |
| Jacket fabric and knit collar · PC131157 D4 and DSC05622 D3 | The jacket’s dark folds lose contrast and small colour accents. Its brightness and colour edges fall to 81% and 82% of Today’s. The collar’s knit shape remains while its subtle colour edges fall to 89%. |
| Skin · Canon D1, DSC05293 D4, _DSC7970 D3 | Brightness grain is more visible on the Canon face and across the café scene. The ear and skin crop is closely preserved. The blue rim exposed at Canon D1 mark 5 is a local failure even though the face as a whole changes little with the extra passes. |

The separate pass measurements point to channel balance as the source of
the star-rim and lettering colour changes. It explains most of the jacket’s
colour-edge loss and some of the dark-fold change. A small genuine colour
feature can look like an isolated speck to the detector. The dark-clump pass
left the isolated stars alone. It can change visible colour in shadows when
it lifts a dark centre, as on the Canon face mark above. The 54-area
comparison uses the selected channel-balance version. The Hue unify
comparison is limited to the Canon.

## Native CPU speed

Three paired runs on the MacBook Neo use the 18.02 MP Canon IMG_0790.CR2 and
the 42.39 MP Sony DSC04375.ARW. Each run starts with the developed photo
and the existing noise model ready. The shared lock gives each run its
own turn. The goal from the earlier colour trial is about one second
added at 18 MP. The spread of the baseline runs exceeded the previous
±10% descriptive allowance. Small paired differences describe this
run and do not establish an exact cost.

| Method | 18.02 MP | 42.39 MP |
| --- | ---: | ---: |
| Today, total Denoise resolve | 3.59 s | 9.46 s |
| Even keep 18 px, local average only | +0.09 s | +0.08 s |
| Even keep 18 px, local grain-weighted | +0.16 s | +0.60 s |
| Even keep 18 px, grain-matched | +2.92 s | +6.31 s |
| Hue unify, strong | +3.66 s | +8.75 s |
| Green/magenta cleanup, strong | +0.88 s | +2.14 s |
| Green/magenta channel balance, strong | +0.88 s | +2.16 s |
| Dark clump breakup, strong | +0.43 s | +1.29 s |
| Dark clump breakup, Medium only, strong | +0.62 s | +1.48 s |
| Reviewed combination | **+4.13 s** | **+9.78 s** |

The faster whole-photo grain fit works on brightness only and takes
2.57 s at 18 MP and 6.08 s at 42 MP. The previous 13–20 s measurements
combined an all-channel calibration with a modified resolve. The local
average meets the CPU timing goal and changes the grain. Channel balance
comes in near one second at 18 MP. Hue unify’s neighbourhood hue calculation
is the most expensive new pass. [Ranges and conditions](../../performance-table.md)

A GPU version of the local brightness average could use separable box
filters on the Fine and Medium keep maps in the existing reconstruction
tiles. Steve’s grain-matched result also needs a whole-photo reduction
of retained brightness detail, with the resulting gain adjustment applied
consistently across tile and preview boundaries. The colour and dark passes
need bounded neighbourhood reads and a way to agree on a small blob at
tile boundaries. Hue unify also needs a chroma-weighted local hue
distribution. GPU work would need to retain the signed values and verify
the edge cases, tile seams, CPU fallback agreement, memory and response
from changing a control to seeing the picture.

## Review pages

Open `codebase/output/denoise-v1/round4/index.html`. Part 1 has six Canon
blocks with 20 numbered rows each. Start with Canon D4, rows 5, 11, 15 and 20
for the two colour approaches and the full combination. On Canon S2,
compare rows 5, 8, 9 and 17 for the grain change and dark-clump lift.
Part 2 has all 54 fixed areas, each with three numbered rows. The 512 px
crops are shown at 1:1. The matched close-ups are pre-rendered at 6×.
Three unmarked Canon areas use fixed comparison spots.

The comparison has 633 images. The pages, images and score receipts total
**19,081,627 bytes (19.08 MB)** under ignored output. The folder can be
deleted after review.

The page check decoded every image, verified its dimensions and checked
the exact 6× pixel blocks and the numbered static rows. The seven new
research tests cover production agreement, grain matching, hue range
and channel checks, compact clumps and tile boundaries. Node recorded
1,108 passes and one skip. Python recorded 4,263 passes, 155 skips, the
previous unexpected pass and the existing Starlette warning. The
standalone research filters run on the CPU and have no matching GPU
driver. Scratch output started at 13.2 GB and ended at 13.3 GB. The
temporary review and test files were removed.
