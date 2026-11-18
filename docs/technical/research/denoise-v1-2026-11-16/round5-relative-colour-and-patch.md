# Denoise round 5 · Relative colour and patch repair

18 November 2026 · MacBook Neo, A18 Pro, 8 GB · Research

The same two-pass cleanup made a visible difference on both photos. The Canon
combination brought 22 of 28 standout colour marks and all 12 marked pits to
about grain level. On the daylight Sony portrait it brought all 24 standout
colour marks and all five pits to grain level. The clearest colour-only result
was row 8. Row 11 removed more pits but softened lashes and hair and changed the
Canon flame edge. Row 10 left most pits on the Canon and barely moved the
Sony marks.

For a first look, compare rows 4, 8, 9 and 11 in the Canon railing (D4) and the
Sony background (S1). The Sony eye (D1) shows the trade-off on fine detail.
The AI row is a useful comparison for detail on both photos.

## What the methods do

Each new method starts from **Even keep brightness 18 px**. It uses the original
grain match, fitted independently from each whole photo. Both photos use the
same cleanup settings and the same scene-to-display conversion as their earlier
marking pages. The views are lifted by +3.22 stops for the Canon and +1.71 stops
for the Sony. [Round 4 grain match](even-keep-round4.md)

- **Round 4 channel balance** is the comparison. It looks for a compact,
  isolated green or magenta colour. On the Canon, an olive-orange or pink-red
  patch can be far from its neighbours in colour while failing that absolute
  hue requirement. The earlier check found that the first hue test rejected
  32 of the 38 Canon marks.
- **Relative colour cleanup, gentle and strong** compare the colour of a small
  group of pixels with samples roughly 12 pixels away, across both red–blue and
  green–magenta directions. The larger the difference compared with the fine
  colour grain that survived Denoise, the larger the pull toward the surrounding
  colour. The two settings use the same comparison with different amounts.
- **Relative colour cleanup, large splotches** adds a second comparison about
  28 pixels away. It reaches beyond a wider patch, in addition to the small
  roughly 7 px marks. All three colour versions express colour relative to
  local light so that a single colour can follow a brightness gradient. They
  preserve linear scene brightness to floating-point rounding. The displayed
  brightness can still shift where the changed colour alters the display
  mapping, especially along the flame.
- **Nearby patch healing** finds dark clumps by comparing them with the
  surrounding brightness and grain. It looks in 32 nearby directions and
  distances for a patch with similar surroundings, borrows brightness and fine
  grain from its centre and blends them into the pit, carrying the recipient's
  colour with the brightness change.
- **Whole-area patch averaging** compares each 5×5 patch with 48 shifted patches
  up to 9 pixels away in each direction. It averages actual pixels with more
  weight on similar patches. Colour and brightness both take part in the
  comparison and the average. A wide blotch can resemble the patches inside
  itself more closely than the cleaner patches around it, leaving the blotch
  visible after averaging.
- **Combination** applies the large-splotch colour pass followed by nearby
  healing. The passes use the same settings as their standalone rows.

The new colour search uses local contrast in any colour direction. The
healing search uses patch similarity to choose the donor. The filters run
without scene-detail vetoes or spot-isolation votes. All patch code here uses
the existing research framework and an original implementation. The separate
AI reference uses the existing pinned Bayer model with its normal highlight
blend. [Research filters](../../../../codebase/tools/denoise_eval/candidates/speck_round5.py)

## How the marks were counted

Every mark uses the round 4 reading. The marked pixel is snapped once within
two pixels of the click on Today, then held fixed. The score compares the mark
with a 6–12 px ring, using both colour directions and both signs of brightness.
The tables track two groups selected on the 18 px base, colour outliers above
twice their surrounding grain and dark pits deeper than twice their surrounding
grain. In each group **near** means within twice the original local grain,
**weaker** means at least 25% lower contrast, and **worse** means more than 25%
stronger and at least half a display point stronger. A pit that turns into a
bright dot still has brightness contrast. A spot that changes hue can still
count as a colour mark. The groups can overlap.

The last column checks **all** marks against Today's fixed local grain and
gives the colour and brightness counts, in that order. The row of Noisy
readings is useful as a reference because noisy surroundings affect the ring
and the centre together. The marks represent Steve's selections on the two
photos. The other areas help judge grain and real detail by eye.

## Canon fire dancers · IMG_0790.CR2

The combined pass brought **22 of 28** standout colour marks and **all 12**
dark pits down to about the 18 px reference grain. All 28 standout colour marks
were at least a quarter weaker, across 18 green–magenta and ten red–blue marks
classified on Today. The round 4 channel balance helped two. The colour-only
large-splotch pass brought 17 to grain level and weakened 20. It visibly fades
much of the coloured mottling in the flat shadow while leaving fine texture.
The combined pass retains a grainier shadow than the AI reference, and makes
the dancers' faces and parts of the skirt softer.

| Row and method | Colour near / weaker / worse, of 28 | Pits near / weaker / worse, of 12 | All 38 near Today's grain, colour / brightness |
| --- | ---: | ---: | ---: |
| 1 · Noisy | 7 / 12 / 13 | 6 / 4 / 2 | 6 / 9 |
| 2 · Today | 2 / 4 / 5 | 7 / 6 / 0 | 8 / 12 |
| 3 · AI Denoise | 25 / 26 / 1 | 11 / 11 / 1 | 34 / 35 |
| 4 · Even keep brightness 18 px | 0 / 0 / 0 | 0 / 0 / 0 | 8 / 12 |
| 5 · Round 4 channel balance | 2 / 2 / 0 | 0 / 0 / 0 | 9 / 13 |
| 6 · Relative colour cleanup (gentle) | 5 / 18 / 0 | 3 / 1 / 0 | 12 / 18 |
| 7 · Relative colour cleanup (strong) | 15 / 20 / 0 | 4 / 3 / 0 | 20 / 20 |
| 8 · Relative colour cleanup (large splotches) | 17 / 20 / 1 | 4 / 3 / 0 | 20 / 20 |
| 9 · Nearby patch healing | 3 / 4 / 4 | 11 / 11 / 0 | 7 / 21 |
| 10 · Whole-area patch averaging | 6 / 7 / 0 | 4 / 3 / 0 | 12 / 12 |
| 11 · Large-splotch colour cleanup + nearby healing | **22 / 28 / 0** | **12 / 12 / 0** | **25 / 29** |

- **S2, flame and shadow.** The magenta spot at mark 1 falls from 20.4 to
  3.1 display colour points with the large-splotch pass. Round 4 balance
  leaves it at 20.4. With the combined pass, mark 5 goes from 12.3 points
  darker than its ring to 2.3. A wider pink-orange rim appears along part of
  the flame in the large-splotch and combined rows.
- **D1, centre dancer.** Healing alone lifts the pit at mark 5 from 17.5 to
  3.6 brightness points down. The remaining cyan is more visible, rising
  from 17.9 to 34.7 colour points. In the combined row the same spot measures
  2.3 colour points and 4.9 brightness points down. Faces look smoother,
  especially around the eyes and nose in D1 and D2.
- **D4, railing.** At mark 2 the combined repair reduces the pit from 13.4
  points down to 0.2 up, and reduces the colour from 10.9 to 4.0 points.
  Whole-area averaging quiets the immediate grain while leaving the dark
  blue pit quite obvious. In S1 it similarly leaves small isolated holes
  against a smoother, mottled background. Median brightness grain around
  the Canon marks falls from 4.45 points to 1.88 with whole-area averaging
  and to 3.23 with the combined pass.

## Boy portrait · _DSC7970.ARW

The Sony A7R III portrait is a daylight-colour check at ISO 6400. The same
large-splotch colour pass weakened all 24 standout colour marks and brought
23 to grain level. The combined pass brought all 24 to grain level. Those
improvements include 12 green–magenta marks, 11 red–blue marks and one whose
colour was weak on Today. Healing alone brought all five pits to grain level
and left the colour blotches visible. The shirt and eye areas have no marks
and are included for visual comparison.

| Row and method | Colour near / weaker / worse, of 24 | Pits near / weaker / worse, of 5 | All 25 near Today's grain, colour / brightness |
| --- | ---: | ---: | ---: |
| 1 · Noisy | 1 / 1 / 23 | 0 / 0 / 5 | 1 / 7 |
| 2 · Today | 1 / 0 / 0 | 1 / 0 / 0 | 2 / 18 |
| 3 · AI Denoise | 17 / 22 / 1 | 4 / 4 / 1 | 18 / 23 |
| 4 · Even keep brightness 18 px | 0 / 0 / 0 | 0 / 0 / 0 | 1 / 18 |
| 5 · Round 4 channel balance | 0 / 1 / 0 | 0 / 0 / 0 | 1 / 18 |
| 6 · Relative colour cleanup (gentle) | 2 / 24 / 0 | 1 / 0 / 0 | 3 / 18 |
| 7 · Relative colour cleanup (strong) | 18 / 24 / 0 | 2 / 1 / 0 | 20 / 19 |
| 8 · Relative colour cleanup (large splotches) | 23 / 24 / 0 | 2 / 1 / 0 | 23 / 19 |
| 9 · Nearby patch healing | 0 / 0 / 0 | 5 / 5 / 0 | 1 / 24 |
| 10 · Whole-area patch averaging | 0 / 0 / 0 | 0 / 0 / 0 | 1 / 18 |
| 11 · Large-splotch colour cleanup + nearby healing | **24 / 24 / 0** | **5 / 5 / 0** | **24 / 22** |

- **S1, grey background, and S2, dark shirt.** The magenta-blue patch at S1
  mark 1 drops from 6.1 to 0.4 colour points in row 8. The larger coloured
  patches on the grey and shirt areas are fainter, with some wide variation
  still visible on the shirt. Whole-area averaging leaves the mark at 6.1.
- **D1, eye and lashes.** Row 8 strips much of the blue-green colour around
  the eye and catches bright reflections on the lashes, leaving a few
  yellow-green edges. Row 11 also makes individual lashes less distinct.
  The AI picture keeps finer lash separation and more of the coloured
  fringe. A single exposure cannot distinguish all of that fringe from
  real colour.
- **D2, hair, and D3, ear.** The blue patch at hair mark 1 falls from 8.0 to
  0.6 in row 8. At hair mark 7 the combined row cuts the pit from 3.5
  brightness points down to 1.2 and colour contrast from 5.6 to 0.8.
  Healing also blends some real dark strands into the hair around them.
  At ear mark 4 the warm patch drops from 9.0 to 1.1 colour points in
  row 8, with a flatter transition between pink skin and the adjacent
  shadow.

## New splotches and rims

The main new distractions are on the Canon. The colour passes change the
fire's edge and add small colour rims in the hair and skirt. Healing alone
reveals blue and green inside several former dark holes, including the
S1 background, D1 mark 5 and D4 mark 2. In the combined row many of those
shadow colours fade, while a pale pink-orange band remains next to the
flame and a few orange colour edges stand out on the face and hair. The
whole-area average leaves fewer fine points in the background, which
makes several surviving holes more obvious.

A screen across the full crops counts possible *new or newly more visible*
excursions. It compares a 3×3 core to the 7–12 px surround, searches for a
local peak above three times the 18 px base's grain, and requires at least
50% and four 8-bit display levels more contrast than any peak within four
pixels in the base. Existing scene edges, changed rims and exposed colour
can all count. The table is a screen for inspection, with exact positions
in each photo's JSON. The Sony screen stayed below threshold on these
methods, although the lash colour changes are visible in the close-ups.

| Method | Canon possible new colour / dark spots | Sony possible new colour / dark spots |
| --- | ---: | ---: |
| Round 4 channel balance | 0 / 0 | 0 / 0 |
| Relative colour cleanup (gentle) | 23 / 0 | 0 / 0 |
| Relative colour cleanup (strong) | 185 / 30 | 0 / 0 |
| Relative colour cleanup (large splotches) | 223 / 15 | 0 / 0 |
| Nearby patch healing | 166 / 7 | 0 / 0 |
| Whole-area patch averaging | 7 / 0 | 0 / 0 |
| Large-splotch colour cleanup + nearby healing | 117 / 12 | 0 / 0 |

At Steve's marked sites, one previously weak Canon colour mark crossed
above twice the base grain in the combined row, by at least half a
display point. No previously weak Sony mark crossed that threshold.
The worse counts in the main tables cover marks already conspicuous on
the base. The full receipts hold both kinds of increase for every row.

## What a tiled GPU version would need

- **Even keep brightness 18 px** would need the existing whole-photo
  noise model and the full-photo grain fit shared by all tiles. Each tile
  would apply those same fitted amounts to its local keep maps.
- **Relative colour cleanup** could run as local box filters and a few
  surrounding reads. The gentle and strong runs read up to 36 px beyond
  a tile. The large-splotch version needs a second pass on the first pass's
  output, or a combined 68 px halo. The ring and fine-grain samples must
  agree at the tile boundary.
- **Nearby patch healing** needs the input on a 28 px halo for the search,
  context ring and blend. Each output pixel picks and blends its donor
  using the immutable input, so the results can be assembled by tile.
- **Whole-area patch averaging** can accumulate the weight and weighted
  pixels one offset at a time. Its 18 px halo supplies both the patch
  samples and the grain estimates. The 48 comparisons per pixel are the
  expensive part.
- **Combination** needs the colour result under the healing halo. A
  stage-by-stage dispatch can reuse the same tile reads, or a fused tile
  can use up to 96 px of combined reach. All variants need verification
  of their results at varying tile boundaries before app integration.

These are implementation sketches for the offline filters. The timings
below are CPU work after the noise model is ready, and do not measure
the wait from moving an app control to seeing the result.

## Native CPU speed

On the MacBook Neo, the large-splotch pass adds **1.07 s at 18 MP** and
**2.50 s at 42 MP** after Even keep. Targeted healing adds **3.19 s**
and **5.83 s**. Whole-area averaging adds **6.68 s** and **15.97 s**.
The selected combination adds **3.63 s** and **8.32 s**, and the total
including the grain-matched Even keep step is **9.76 s** and **22.75 s**.
All new passes completed on both whole frames. The timing table has three
runs per case, their ranges and the times for the other rows. The Canon
AI image and single 11.16 s timing come from round 4. The Sony AI reference
took 29.88 s on the same machine in a separate guarded run with disk-backed
buffers, including Bayer development and highlight blending. [Full timing table](../../performance-table.md)

## Review and verification

Open `codebase/output/denoise-v1/round5/index.html` for **Canon fire dancers**
or **Boy portrait**. Both pages have the same 11 rows in the same order.
Each area scrolls across its full crop and the marked 6× close-ups. Canon
uses the round 4 close-up positions. The Sony page uses three of Steve's
marks in each marked area and two fixed comparison spots in the shirt and
eye areas. The two pages and their images total about 5.2 MB. The complete
folder, including both mark receipts and the timing receipt, is about 5.5 MB
and can be removed after review. [How to rerun](../../../../codebase/tools/denoise_eval/README.md#round-5-relative-colour-and-patch-repair)

The page check decoded all 429 images and confirmed matching row labels and
image dimensions, the 63 complete mark readings and three timing samples per
photo. A synthetic frame confirmed that all five new post-passes agree when
the tile boundaries move, the colour passes preserve scene brightness, and
both patch methods respond to the intended features. Both fast suites passed.
Node had 1,108 passes and one skip. Python had 4,263 passes, 155 skips, one
existing unexpected pass and the existing Starlette warning. This offline
work has no applicable app GPU driver. The visual review covered the 11
agreed areas. Total scratch output was 13.2 GB at the start and finish,
including the shared photo folder.
