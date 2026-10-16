# Film Look PRD

- **Status:** Living document for the Film Look module. Created October 15, 2026.
- **Owner:** Steve
- **Build plan:** [Film Look Rebuild Plan](Film_Look_Rebuild_Plan_2026-10-15.md)
  (phases, slider-by-slider review, risks)
- **History:** [Physical Film Grain Sprint](Physical_Film_Grain_Sprint_PRD.md),
  [Film Look Improvement Sprint](Film_Look_Improvement_Sprint_PRD.md)
- **Data sheets:** kept outside the repo in `HDR Finisher Tool/film-datasheets`
  (its README lists every extracted number)

This document says what Film Look is for, how it should behave, and where every
piece of film data comes from. The rebuild plan says how and in what order it
gets built. Update this document when a requirement or a data source changes.

## 1. Purpose

Film Look makes a finished digital picture look as if it was shot and printed
on real film, in both the HDR and the SDR versions. It is the last creative
stage before export.

## 2. Who uses it and how

- Most people start from a **Look** (a complete recipe) and change two or three
  things.
- Some pick a **stock** and build from there.
- Few work through every stage, but the panel is ordered the way light travels
  through film, so each control has an obvious place.

## 3. Requirements

### 3.1 Process and order

R1. The panel and the processing follow the physical order:
Lens -> Negative -> Development -> Print -> Scan -> Output.

R2. Each effect happens at its physical point: lens diffusion, film softness
and halation act on the light before the negative's curve; grain is added in
the negative's density before printing; printer filters, preflash and the
paper act at the print stage.

R3. Look Strength mixes the whole module with the unprocessed picture.

Phase 2 implements this processing order in CPU preview/export/Proof and both
WebGPU routes: existing lens diffusion -> resolution scatter -> halation ->
negative curves/couplers -> density grain -> print -> scan. Slides skip print
and scan the grained film density directly. Look Strength mixes the completed
module once, before independent Detail structure, vignette and output handling.
Signed stock colour survives until that mix; clipping earlier changes partial
mixes. Neutral/off Film Look remains a true bypass.

Delivery resizing and sharpening now resample the completed scan, including
grain, before the output limiter. The grain field, controls and calibration are
unchanged; grain's placement changes its appearance. The existing creative
Film Response controls remain temporarily after scan until Phase 3 removes them.

R4. HDR: highlights above paper white keep their ratios, as the film stock
stage does today. The SDR version can copy the HDR settings once
("Match HDR film look") and stays independently editable.

### 3.2 Stocks and papers

R5. Stocks come from spektrafilm's profiles (Andrea Volpato, CC BY-SA 4.0),
baked into HDR Finisher tables. The credit is shown under the Stock menu and in
`THIRD_PARTY_NOTICES.md`.

R6. "Neutral" is a stock: a straight response, so every control works without a
real stock. There is no separate hand-built tone curve.

R7. Each stock prints on its own matching paper by default. A short list of
alternative papers is offered (proposed: Kodak 2383 cinema print, Fujifilm
Crystal Archive, one punchier Kodak paper). The full Endura family is not.

R8. Slide films are scanned directly, not printed.

### 3.3 Presets

R9. Three layers:

1. **Stock character:** a stock sets its colour, tone, halation, grain and paper.
2. **Stage presets:** change one stage only.
3. **Looks:** stock, paper and every stage.

R10. Each control is either "from the stock" or "set" (by hand or by a stage
preset). Changing the stock updates only controls that are still from the
stock. A set control shows a dot; clicking it returns the stock's value.

R11. A Look stores only its stock, its paper and what it deliberately changes.

### 3.4 Quality bars

R12. The GPU preview matches CPU export within the existing film-stock and grain
parity tolerances.

R13. Grain is resolution-independent and identical whether a frame is rendered
whole or in strips.

R14. Every per-stock default traces to a source listed in section 5, or is
marked as an estimate there.

### 3.5 Out of scope

Spectral and colour-space settings of spektrafilm (baked in), print glare
texture, gate weave and flicker, Negative-only / Print-only modes, bleach bypass
(possible later), migration of old projects (Steve, October 15, 2026: old
projects do not matter for this rebuild).

## 4. Controls

The full old-to-new mapping is in section 6 of the rebuild plan. Summary of the
target panel:

| Stage | Controls |
|---|---|
| Top | Looks, Look Strength |
| Lens | Film Format, Diffusion Filter type, Strength, Size |
| Negative | Stock, Stock Color, Stock Tone, Film Exposure, Color Separation, Halation (Amount, Spread, map), Resolution, Grain (Amount, Size, Softness, Chroma, Film Type, Response trims, map) |
| Development | Push/Pull |
| Print | Paper, Print Exposure, Print Warmth, Print Tint, Preflash, Print Contrast, Shadow Contrast, Highlight Contrast |
| Scan | Scan sharpening, Lab levels |
| Output | HDR highlight handling, Match HDR film look (SDR) |

## 5. Film data: sources and confidence

Labels used below:

- **Confirmed:** read directly from a named source.
- **Spektrafilm estimate:** spektrafilm's own value, which spektrafilm itself
  describes as approximate (for example, "eyeballed" or a midpoint of a range).
- **Proxy:** confirmed for a closely related film, used for this one.
- **Estimate:** our own placement, with the reasoning given. To be checked by eye.
- **Missing:** no value yet.

### 5.1 Colour and tone curves

| Data | Status | Source |
|---|---|---|
| Characteristic curves, spectral sensitivities, dye densities, for every stock and paper | Confirmed (as spektrafilm's profiles) | spektrafilm `data/profiles/*.json`, built by its author from Kodak and Fujifilm data sheets and published papers. Read at commit `3bb2c2d` (June 7, 2026) |
| Default paper for each negative stock; none for slides | Confirmed | spektrafilm profile `target_print` field; positive films use `scan_film` |
| DIR coupler strengths (Color Separation baseline) | Spektrafilm estimate | `runtime/params_builder.py`: negative-film values are noted there as "just eyeballed, optimize!" |
| Neutral printer filter values per stock and paper | Confirmed (as spektrafilm's) | spektrafilm `data/filters/neutral_print_filters.json` |

Phase 1 implemented October 15, 2026, from the same pinned revision
`3bb2c2d2801ff68b92019cf1dbcbb133d60832bc`: all 20 camera profiles
(16 negatives and 4 slides), 44 stock/paper manifests. Every negative has its
own default paper plus Kodak 2383 and Fujifilm Crystal Archive Type II,
omitting duplicate combinations. There are three distinct print media in the
data, including Kodak Portra Endura. No other papers were baked.

Shipped format: `hdr-finisher-film-stock/2`, JSON manifests tagged
`hdr-finisher-film-arrays/1`, referring to shared compressed little-endian
float32 `arrays/<sha256>.npz` files. Total film-data folder: approximately
18.69 MB, previously 14.00 MB (decimal MB, including license and changelog).
All rendering numbers of the six original stocks are identical as float32.
Both packaging specifications already include the whole film-data directory.
The backend expands the arrays for the GPU, and can load an alternative paper
with `load_film_stock(id, paper)` or `GET /api/film-stocks/{id}?paper={paper}`.
The existing Stock menu uses only each stock's default; no Paper picker yet.

Names, still/cine use, anti-halation and default papers are copied from the
profiles without estimation. Upstream `positive` is stored as `slide`.
Slide film uses the positive-film silver-density coupler calculation and scans
film density directly, with no print curve, print glare or paper. Print Warmth,
Print Tint and Preflash consequently have no effect on slides. The upstream
parameter object requires a dummy print profile to be constructed; that paper
is bypassed and is not stored as a slide's paper.

The existing 33-cubed sampling approximates the full spectral simulation.
A deterministic probe of 1,000 random colours plus a 256-step grey ramp found
maximum differences of about 6.5 display levels (out of 255) for C200, 2.8 for
Vision3 500T, and 1.3 or less for each slide. These are interpolation differences
from spektrafilm, not preview/export disagreement; GPU/CPU parity passes its
unchanged tolerance. No table resolution or pinned tolerance was changed.

Phase 3 follow-up probe, October 15, 2026: a fresh reproducible sample of 1,000
uniform linear-sRGB colours in [0, 1] (NumPy seed 0) plus a 256-step grey ramp,
compared with the full spectral pipeline at the same pinned revision. Error is
absolute channel difference after clipping to [0, 1] and sRGB display encoding,
in levels out of 255; the mean includes every RGB channel of all 1,256 samples.
C200: mean 0.1388, maximum 1.2232; worst is the red channel of saturated green
input RGB (0.06004, 0.91791, 0.27951). Vision3 500T: mean 0.3151, maximum 1.2530;
worst is the red channel of green input (0.02168, 0.99097, 0.29621); other large
errors are green/cyan colours. These are a new, specified sample set, not a
reconstruction of the earlier probe (whose exact samples/seed were not specified in the earlier PRD).
They do not replace the earlier reported maxima. Scanner sharpening, spatial
and random effects are disabled; print glare uses the baked constant mean.
Reproduce with `codebase/tools/probe_film_stock_tables.py`, using the existing
bake Python environment and pinned checkout under `output/`. No table size,
data or tolerance changed.

Open paper recommendation (not a shipping decision): provisionally Supra
Endura rather than Ultra Endura. Compared with Portra Endura, Supra's fitted
curves have higher peak slopes in all three layers; Ultra's increase is more
concentrated in blue. This is a curve comparison, not a visual paper trial.
Either additional paper is estimated to add about 6.7 MB across all 16
negatives, using measured current compressed-table sizes. Keep the current
20-stock set and three distinct print media pending Steve's choice; no extra
paper was baked for this recommendation.

### 5.2 Halation

| Data | Status | Source |
|---|---|---|
| Still or cine base (sets spread: 65 µm still, 50 µm cine) | Confirmed classification; spread is a spektrafilm estimate | Profile `use` field; spreads from `params_builder.py`, derived from base thickness ranges |
| Anti-halation layer: strong, weak or none | Confirmed classification | Profile `antihalation` field. Kodak confirms rem-jet backing on Vision3 (500T sheet H-1-5219t) |
| Halation strength per colour | Spektrafilm estimate | `params_builder.py`: "a1 midpoints" of ranges from the author's private notes |

### 5.3 Grain

Kodak's Print Grain Index (PGI): 25 is the visibility threshold; 4 points is one
just-noticeable step; 35mm negative, diffuse enlarger, 14-inch viewing.
Diffuse RMS granularity: standard deviation of density at a 48 µm aperture,
times 1000. **PGI and RMS are different scales and cannot be converted into each
other.** Fujifilm also states that its negative and reversal RMS values cannot be
compared.

| Stock (spektrafilm id) | Value | Status | Source |
|---|---|---|---|
| Ektar 100 (`kodak_ektar_100`) | PGI under 25 / 38 / 66 at 4x6 / 8x10 / 16x20 | Confirmed | Kodak E-4046, January 2025 |
| Portra 160 (`kodak_portra_160`) | PGI 28 / 50 at 4x6 / 8x10 | Confirmed | Kodak E-4051, January 2025 |
| Portra 400 (`kodak_portra_400`) | PGI 37 / 59 / 89 | Confirmed | Kodak E-4050, January 2025 |
| Gold 200 (`kodak_gold_200`) | PGI 44 / 64 | Confirmed | Kodak E-7022, June 2023 |
| Ultramax 400 (`kodak_ultramax_400`) | PGI 46 at 4x6 | Confirmed | Kodak E-7023, February 2016 |
| Portra 800 (`kodak_portra_800`) | PGI 48 / 70 | Confirmed | Kodak E-4040, January 2025 |
| Portra 800 pushed 1 and 2 stops (`kodak_portra_800_push1`, `_push2`) | None | **Missing.** Estimate: coarser than Portra 800 | Kodak gives no pushed PGI |
| Vision3 50D, 200T, 250D, 500T (`kodak_vision3_*`) | Per-layer RMS curves across the tonal range | Confirmed curves; visual readings are **Estimate**, section 5.5 | Kodak sheets: 50D (March 2022), 200T brochure (revision code 1167.25), 250D (March 2022), 500T H-1-5219t (July 2015) |
| Verita 200D (`kodak_verita_200d`) | None | **Missing** | No sheet found |
| Fujifilm C200 (`fujifilm_c200`) | RMS 4 | Confirmed, but cannot rank | Fujifilm data sheet (published September 2019) |
| Fujifilm Superia X-tra 400 (`fujifilm_xtra_400`) | RMS 4 | Confirmed, but cannot rank | Fujifilm data sheet (September 2019) |
| Fujifilm Pro 400H (`fujifilm_pro_400h`) | RMS 4 | Confirmed, but cannot rank | Fujifilm data sheet (September 2019) |
| Velvia 100 (`fujifilm_velvia_100`) | RMS 8 | Confirmed | Fujifilm data sheet (September 2019) |
| Provia 100F (`fujifilm_provia_100f`) | RMS 8 | Confirmed | Fujifilm data sheet (September 2019) |
| Ektachrome 100 (`kodak_ektachrome_100`) | RMS 8 | **Proxy:** figure is for Ektachrome E100G/E100GX, an older emulsion. Not confirmed which Ektachrome spektrafilm's profile models | Kodak E-4024, September 2009. Current E100 sheet (E-4000) **missing** |
| Kodachrome 64 (`kodak_kodachrome_64`) | Described only as "extremely fine grain" | **Missing.** Estimate: close to the RMS 8 slide films | Kodak E-55, August 2003 |

Notes on using these numbers:

- The three Fujifilm negatives all read RMS 4, so they cannot be told apart from
  their sheets. **Estimate:** place each next to the Kodak stock of the same speed
  (C200 near Gold 200, X-tra 400 and Pro 400H near Ultramax and Portra 400).
- Doubling the enlargement (4x6 to 8x10) adds about 21 to 22 PGI points for every
  Kodak stock that lists both. **Confirmed** from the sheets; it can calibrate how
  grain grows with Film Format.
- How a PGI number becomes our Grain Amount and Size is **our calibration (initial Phase 4 placement in section 5.5), not manufacturer data**. It will be fitted to the Kodak stocks and checked by eye.
- Spektrafilm itself has **no per-stock grain**: all stocks use the same settings
  (`runtime/params_schema.py` `GrainParams`; `model/grain.py` has a to-do note
  for per-stock RMS granularity).

Size follow-up, October 15, 2026: **preview grain fix implemented; the rest
of Phase 3 and Phase 3b are still pending.** Steve chose the full-resolution
export, downsized, as the reference. Reduced GPU Direct/Tiled and CPU fallback
now average samples of the native grain field in film density, before print.
Native 100%, export and Proof keep the original single-sample field. This is
bounded box quadrature, not an exact full-resolution render followed by Lanczos;
individual noise pixels therefore need not coincide with the downsized scan.

`tests/performance/film-grain-size-diagnostic.js` is now pass/fail. It generates
a 2400 x 1600 four-patch image and a separate flat-grey image, compares the real
native export with actual automatic Fit (1520 x 1013 here), half size and native
size, and covers 35mm/Super 8, SDR/HDR, Direct/Tiled and CPU fallback. All four
patch interiors are checked. Reduced grain must stay within 15% in mean channel
RMS and within one 8-bit level in RMS and channel mean. This fixed visual
allowance rejects the previous visibly stronger ~30% grain while allowing the
bounded integration approximation; inspected side-by-side crops have similar
fine texture. Existing native whole-frame limits remain mean <= 0.1 and p99.9
<= 2 levels, rather than applying them separately to difficult stock colours.
The diagnostic writes generated media and comparisons to ignored output only.

Validation: 180 patch/route/size comparisons pass; worst grain-strength error
13.9%, worst channel mean bias 0.356 levels. Native whole-frame mean is at most
0.0654 levels and p99.9 is 1. Direct/Tiled images are byte-identical. A fresh end-to-end rerun of the complete 180-case matrix also passes,
including regenerated native exports and CPU fallback images. Existing grain parity passes all ten cases without changed
limits. Fast checks: 483 JavaScript and 2094 Python passed, three Python skipped.

Cost: reduced grain evaluates 4 samples at these Fit sizes, up to 16 at smaller
scales, instead of one. The grain portion of GPU work increases accordingly;
CPU fallback also visits more native-scale grain cells and can be substantially
slower. No controlled before/after whole-preview timing was taken. Steve should
try Fit and zoom/pan responsiveness with grain enabled. Scales smaller than the
tested Fit/half sizes use the same bounded approximation but are not covered by
this acceptance matrix. See the Phase 3 continuation below for control work.

Phase 3 work in progress, October 16, 2026: shared paper morph/scanner preparation
is committed in `efec862`; panel/model/CPU/GPU wiring and Neutral are committed
as work in progress in `7db66fc` and are being validated. Phase 3 is NOT complete and Phase 3b has NOT started. Push/Pull uses
whole stops from -2 to +2; Portra 800 +1/+2 select the measured profiles, all
other positions use approximate film gamma `2**(0.2*stops)`. Paper contrast
factors span 0.5..2. Negative-paper fast layers are assigned to image highlights,
mid/slow layers to shadows (the enlarger reverses exposure); negative Highlight
Contrast also blends toward upstream developer exhaustion. All three shipped
paper profiles are negative in the pinned data, including Kodak 2383.

Scan Sharpening defaults to 0 to keep Neutral unprocessed; 70 matches upstream's
0.7 amount, with its 0.7-pixel RGB Gaussian unsharp mask. This differs from
Detail's edge-qualified structure. It runs before the single Look Strength mix.
The GPU reuses its existing textures, adding scan/copy passes and at most three
source pixels of neighborhood reach; no existing blur cap or comparison limit
is raised. Lab Levels calibrates the scanner only; it does not also re-expose
the camera or enlarger as upstream's linked exposure corrections can do. No controlled before/after latency measurement is available.

Neutral uses an analytic log-density negative and a synthetic three-layer
paper whose scanner inverts the same sampled baseline. Its default is straight;
the alternative paper selections use the measured paper/scanner data, without
borrowing any measured negative's colour matrix or couplers. Stock Color/Tone
only mix existing character; a straight Neutral baseline has none to invent. Its Lab Levels
uses the upstream 1%/98% encoded-sRGB endpoint convention. This is an explicit
synthetic stock choice, not measured manufacturer data. Default Neutral bypasses
the stock allocation entirely. The two measured push entries leave the menu;
slide Print controls show "Slides have no print". Existing projects/presets
using removed response, desaturation or halation sensitivity fields are affected;
no compatibility path is kept. Four Looks await rebuilding in Phase 5.

Validation in progress: all 32 expanded HDR stock/control cases pass, as do
all 31 previously expanded SDR cases. Four initial HDR failures exposed a
stock-only return matrix that differed from the exact CPU CAT02 conversion;
that conversion is corrected without altering the general shader conversion.
The remaining strong Neutral HDR case exposed independent ACES half-float
rounding near an sRGB gamut boundary. Neutral HDR now chooses among nine nearby
representable triplets by weighted sRGB error, at the raw-film and scanner
writes. The case improves from p99.9 10 levels to 1, below the unchanged limit
of 2; mean is 0.052 levels. Texture formats, allocations and GPU limits stay
fixed. This adds arithmetic only to Neutral HDR; its time cost is not measured.
The focused Proof/export group passed 94 checks; three additional real-encoder
checks using the physical controls match Proof and export byte for byte.

Steve explicitly approved the limited retired-control test replacement on
October 16. Physical paper/scanner and removed-field rejection checks replace
the old artistic response/desaturation and compatibility checks; all 198 GPU
positions, numeric tolerances and budgets remain fixed. Schema snapshots and
fixtures now use the current model. Existing matching fixtures simply drop the
retired artistic settings: they have no physical equivalent, and inventing a
translation made their calibrated fits unstable. The original match-quality,
CPU-certification and monochrome assertions remain, and all 11 match checks
pass. Physical-control effects are independently tested. JavaScript: 483 pass.
The complete Python run and final Fit-grain check are still in progress.

The strict end-to-end paper tone monotonicity checks use the straight Neutral
negative (as the retired default-response checks did), retaining the 2e-6 bound.
All three measured papers also have direct curve monotonicity checks with that
same bound and independent agreement with the pinned upstream equations. The
complete measured negative/coupler chain has a tiny pre-existing toe reversal
which extreme paper controls amplify to about 0.0014 of one 8-bit level; the
manufacturer data has not been altered to conceal it. Phase 3 acceptance and
Phase 3b remain pending until required checks finish.

A further extreme-value probe found that valid Neutral settings (Push +2,
Print Exposure -3, all three paper contrasts +100) can exceed half-float's
65,504 limit. On this GPU the existing preview clips there: readback found no
infinities or NaNs. Steve requested a simple cap comparison first, and
conditionally authorized the final-film alpha scale only if that cap failed.
With a generated 128-to-shadow HDR hue ramp, after the ordinary 400/1000-nit
Peak Fit output stage, explicit capping fails the unchanged limits: added mean
61.517 and p99.9 182 levels (limits 0.1 and 2). The limited scale representation
is therefore selected. CPU export is unchanged. Final film/scanner/Detail
writes store a power-of-two scale in spare alpha; reads decode it, including
retained-picture interpolation. Earlier film-plane passes keep alpha=1.

The Neutral pre-compression brightness measurement also clipped at 65,504.
It now uses the existing bounded float32 maximum algorithm through a separate
final-film entry point, including scale decoding; the audited peak shader and
its existing entry points retain their original byte pins. Image texture sizes,
blur caps, tile budgets and comparison tolerances remain fixed. A small bounded
reduction buffer replaces the half-float measurement grid for Neutral HDR
anchors. There is no controlled latency measurement.

The unchanged CPU's final HDR blend loses float32 precision on these enormous
values; the extreme Neutral preview explicitly reproduces that rounding. The
focused extreme acceptance case then passes: added mean 0.040 levels, p99.9 2
(absolute mean 0.0411). Rare boundary pixels still differ by as much as 196
levels; the percentile check allows those isolated outliers, which must not be
mistaken for byte-exact preview/export identity. Direct/Tiled validation and
final regression checks are still pending; Phase 3 is not yet accepted.

### 5.4 Data still to get

| Item | Why it matters | Where it might come from |
|---|---|---|
| Ektachrome E100 sheet (E-4000) | Confirms the current slide film's grain | Kodak Alaris |
| Digitized Vision3 curves | Visual estimates now read (5.5); precise per-layer fitting would need digitization and a later renderer phase | The saved sheets |
| Pushed Portra 800 grain | Push/Pull grain change | Not published; keep as estimate |
| Verita 200D sheet | Grain for this stock | Kodak |


### 5.5 Phase 4 shipping character calibration (October 16, 2026)

`film_stocks/character.json` stores all 20 stocks and Neutral, every shipped
control's confidence/source, and the upstream tag/halation inputs separately.
`tools/build_film_character.py` regenerates it and its static frontend bootstrap.
No baked colour/tone table or rendering equation changes in this phase.

**Estimate:** Portra 400 anchor Amount **24**, diameter **13.2 micrometres**
(Size **30**). Judge a 35mm 3:2 scan displayed at 6x4 inches, viewed from 14 inches,
with default paper, neutral exposure/print/scan, default grain trims and no lens
filter. This is a first visual calibration for Steve, not a manufacturer slider
value. Change the single `anchor=24.0` in the generator and regenerate to tune
strength for all stocks; the physical diameter stays fixed.

**Estimate:** scale factor `2**((placement-37)/21.5)`, split equally in log space
between grain diameter and Amount (each gets its square root). Size is recovered
from the existing `diameter_um = 6 + .24*Size`. Four PGI points is one noticeable
step, but there is no published percentage increase per step. Choosing a doubling
per 21.5 points is our calibration, not an RMS-to-PGI conversion. Ektar's chosen
24 is an estimate under its confirmed <25 bound. Every derived slider number in
the following table is **Estimate**, even when its input PGI is Confirmed.

**Spektrafilm estimate:** strong/weak/no anti-halation R:G:B strengths are
(.015,.005,0), (.08,.02,0), (.30,.10,.015); still/cine sigma is 65/50 um.
**Confirmed:** the stock tags and default papers come from its pinned profiles.
**Estimate:** Amount = red strength/.42*100 in our additive renderer; Spread is
three sigma converted to percent of a 36x24mm diagonal (our kernel radius is
three sigma). These are projections into our existing edge-qualified glow,
not reproduction of spektrafilm's different scatter kernel. Strong/weak colours
fit the existing tint equation by hue; no-backing uses hue 30, saturation 90
as an approximation to its small blue component. These projection values are
**Estimate**, not confirmed physical halation measurements.

Amount, Spread and Saturation read **100% stock** at the stock's setting;
Hue Offset reads **0** there. Saved values remain ordinary renderer units.
A set control keeps that absolute value when changing stocks, so its relative
readout can change. This avoids changing export/GPU equations. Neutral has no
own grain/halation and uses the existing absolute sliders for deliberate effects.
Amount's slider spans 0-200% stock, Spread 0-400%; typed values can reach the
existing absolute model bounds. Hue/Saturation retain their absolute bounds,
expressed relative to the stock. Enabled/bypass switches remain independent,
not stock-owned: a deliberate bypass stays off when changing stocks.

Only Amount/Size, the four halation controls and Paper are stock-owned.
Paper's saved `default` means the current stock's confirmed matching paper;
slides skip print. Explicit alternative papers survive stock changes, including
through a slide. Portra 800 Push +1/+2 refreshes inherited grain from the two
pushed placements; all other Push/Pull grain remains unchanged (no data).
Stage presets and sparse Looks remain Phase 5; no compatibility path is added.

Before new measurements: physical format pitch must double within 1e-6 relative
when the gate dimensions halve, since it is geometry; this corresponds to our
calibrated 21.5-PGI step, within the documented roughly 20-22 point sheet spread.
This is a scale sanity check, not proof of perceived grain matching PGI.
New numerical mapping round trips allow 1e-6 absolute for decimal metadata;
existing GPU/export tolerances and exact Proof guarantees remain unchanged.
Visual chart readings below have about +/-25% reading uncertainty; this is a
confidence statement, not a relaxed test tolerance.

| Stock | Placement input and status | Amount / Size (Estimate) | Halation Amount / Spread / Hue / Saturation (Estimate) | Paper (Confirmed from profile) |
|---|---|---|---|---|
| `kodak_portra_400` | 37 (Confirmed) | 24.000 / 30.000 | 3.571 / 0.450694 / 21.320 / 100 | kodak_portra_endura |
| `kodak_portra_160` | 28 (Confirmed) | 20.759 / 22.573 | 3.571 / 0.450694 / 21.320 / 100 | kodak_portra_endura |
| `kodak_portra_800` | 48 (Confirmed) | 28.656 / 40.671 | 3.571 / 0.450694 / 21.320 / 100 | kodak_portra_endura |
| `kodak_ektar_100` | 24 (Estimate) | 19.463 / 19.602 | 3.571 / 0.450694 / 21.320 / 100 | kodak_portra_endura |
| `kodak_gold_200` | 44 (Confirmed) | 26.867 / 36.570 | 19.048 / 0.450694 / -32.172 / 100 | kodak_portra_endura |
| `kodak_ultramax_400` | 46 (Confirmed) | 27.747 / 38.587 | 19.048 / 0.450694 / -32.172 / 100 | kodak_portra_endura |
| `fujifilm_c200` | 44 (Estimate) | 26.867 / 36.570 | 19.048 / 0.450694 / -32.172 / 100 | fujifilm_crystal_archive_typeii |
| `fujifilm_xtra_400` | 46 (Estimate) | 27.747 / 38.587 | 19.048 / 0.450694 / -32.172 / 100 | fujifilm_crystal_archive_typeii |
| `fujifilm_pro_400h` | 37 (Estimate) | 24.000 / 30.000 | 3.571 / 0.450694 / 21.320 / 100 | fujifilm_crystal_archive_typeii |
| `kodak_portra_800_push1` | 52 (Estimate) | 30.565 / 45.044 | 3.571 / 0.450694 / 21.320 / 100 | kodak_portra_endura |
| `kodak_portra_800_push2` | 56 (Estimate) | 32.601 / 49.710 | 3.571 / 0.450694 / 21.320 / 100 | kodak_portra_endura |
| `fujifilm_velvia_100` | 24 (Estimate) | 19.463 / 19.602 | 3.571 / 0.450694 / 21.320 / 100 | none (slide) |
| `fujifilm_provia_100f` | 24 (Estimate) | 19.463 / 19.602 | 3.571 / 0.450694 / 21.320 / 100 | none (slide) |
| `kodak_ektachrome_100` | 24 (Estimate) | 19.463 / 19.602 | 3.571 / 0.450694 / 21.320 / 100 | none (slide) |
| `kodak_kodachrome_64` | 24 (Estimate) | 19.463 / 19.602 | 19.048 / 0.450694 / -32.172 / 100 | none (slide) |
| `kodak_verita_200d` | 34 (Estimate) | 22.867 / 27.404 | 3.571 / 0.346688 / 21.320 / 100 | kodak_2383 |
| `kodak_vision3_50d` | 24 (Estimate) | 19.463 / 19.602 | 3.571 / 0.346688 / 21.320 / 100 | kodak_2383 |
| `kodak_vision3_200t` | 34 (Estimate) | 22.867 / 27.404 | 3.571 / 0.346688 / 21.320 / 100 | kodak_2383 |
| `kodak_vision3_250d` | 36 (Estimate) | 23.616 / 29.121 | 3.571 / 0.346688 / 21.320 / 100 | kodak_2383 |
| `kodak_vision3_500t` | 44 (Estimate) | 26.867 / 36.570 | 3.571 / 0.346688 / 21.320 / 100 | kodak_2383 |

All placement sources/reasons are recorded with each stock in character.json.
Neutral's seven defaults (Amount 0, Size 50; halation 0/.2/0/75; Paper default)
are **Estimate**, synthetic design values, with zero own grain/halation.
Ektachrome's historical RMS 8 remains **Proxy**; its current E100 source is
**Missing**. Verita and pushed Portra manufacturer grain figures remain
**Missing**. No estimate above fills those evidence gaps as Confirmed.

Vision3 chart reading method: rendered the saved full chart pages, followed the
right-hand **logarithmic** sigma-D axis and multiplied by 1000. Samples below
are R/G/B at common log-relative-exposure 1.5, 3.0 and 4.5, not at equal density
or equal scene stops between stocks. They support broad within-Vision3 ranking,
not a direct comparison with still PGI. **Confirmed:** the sheets contain the
curves; **Estimate:** all numbers visually read from them and all placements.

| Stock / sheet page | RMS RGB at 1.5 (Estimate) | At 3.0 (Estimate) | At 4.5 (Estimate) |
|---|---|---|---|
| 50D 5203 p3 | 6 / 6 / 9 | 4 / 4.5 / 7.5 | 2.5 / 3.5 / 5 |
| 200T 5213 p2 | 9 / 9 / 17 | 6 / 7 / 15 | 5 / 6 / 12 |
| 250D 5207 p3 | 10 / 10 / 16 | 5 / 7 / 13 | 4.5 / 5.5 / 9 |
| 500T H-1-5219t p4 | 11 / 13 / 31 | 6 / 8 / 19 | 5 / 6 / 12 |

The toe hump then declining density granularity is broadly compatible with
sparse developed grains giving way to a dense merged field, but the unchanged
renderer is statistically normalized and its default response trims are flat.
It does not reproduce these per-layer curves or make size exposure-dependent.
This phase checks and records that limitation; changing the grain model would
violate its scope. Slide films share the finest-negative estimate; reversal RMS
is not treated as comparable with negative RMS.

## 6. Acceptance

- Every control does something visible at its default range, alone (no control
  that only works when another is raised).
- No two controls do the same job.
- Switching stock inside a Look keeps the user's own settings and updates the rest.
- Every per-stock default in the shipped data traces to section 5.
- GPU and CPU export agree within the parity tolerances.


Phase 3 range validation, October 16, 2026 (acceptance still blocked): the
retained production patch changes only final ideal-Neutral HDR film/scanner/
Detail storage and readers, plus its float32 highlight-anchor reduction. The
original pinned peak-reduction source, CPU export, all tolerances, texture
sizes and blur/memory ceilings are unchanged. Steve's cap-first test found
clipping at 65,504, no infinity or NaNs; the explicit safe cap fails after HDR
compression at added mean 61.517 levels, p99.9 182. The selected alpha scale
passes the compressed extreme fixture at about 0.040 added mean and p99.9 2,
although rare boundary pixels can differ by 196 levels. Fast checks pass:
483 Node; 2,132 Python, three skips. The expanded stock/control matrix passes
65 of 66 comparisons. Its new maximum-gain Neutral HDR case WITHOUT output
compression fails at mean 3.201, p99.9 250. This is not accepted or waived.
A temporary linear-sRGB storage experiment failed and was removed. An isolated
full-precision-final-pass diagnostic still fails at mean 0.128, p99.9 22, showing
that changing only final storage precision is insufficient. A further base-pass
probe was invalid due to a temporary format mismatch and supplies no evidence;
all probe code was removed. Broader changes before the final film passes exceed
the expressly limited range-fix scope and need Steve's decision before proceeding.
New Neutral Scan/Detail range Direct/Tiled cases are byte-identical at 256/512;
two Black & White-only cases on that extreme input fail separately, recorded
without investigation. Fresh Fit-grain acceptance passes all 180 comparisons;
previous ten-case grain parity and 94+3 Proof/export checks pass. No push or
installer. Phase 3 remains unfinished; Phase 3b has not started.


Phase 3 documentation follow-up, October 16, 2026: the colour-pipeline and
four control/usage references describe Development, physical paper contrast,
Print Exposure, Scan Sharpening and Lab Levels, remove retired Film Response
settings, and identify the existing Looks as awaiting Phase 5. Documentation
only; uses the preceding 483 Node / 2,132 Python results and the recorded focused
checks. The uncompressed extreme Neutral HDR failure above remains unresolved;
these references document the controls, not Phase 3 acceptance.


Phase 3 completion, October 16, 2026: Steve's conditional range decision was
resolved by a direct pre-rebuild main e4274ae run. Exposure +8 with compression
off reproduces half-float clipping and wrong colours (mean 2.936, p99.9 255);
the full settings and new Neutral stacked trigger are in known-limitations.md.
No earlier precision extension or control-range narrowing is required under
his decision. The retained final Neutral fix passes the compressed extreme
case; CPU export and numerical/budget pins remain unchanged. Phase 3 is now
complete: Fit grain acceptance 180/180; physical Development/Print/Scan and
Halation committed; Node 483 and Python 2,132 pass (three skips); ordinary
control matrix passes with the documented extreme uncompressed exception.
Two separate Black & White-only Direct/Tiled failures on the extreme fixture
remain recorded and uninvestigated. No new code changed in this documentation
commit; the preceding production fast and focused checks remain applicable.
Phase 3b may now begin. No push or installer.


Phase 3b complete, October 16, 2026: None / Black Pro-Mist / Pro-Mist /
Glimmerglass / CineBloom replace all five retired Bloom fields across the model,
CPU, GPU, UI, presets and current guides. Strength spans continuous 1/8-2;
Size spans 0.25-4, default 1. The energy-normalized pinned-upstream mixture has
27 Gaussian components, with per-component bounded renormalization, film-plane
format sizing and the unchanged stage order. Full-resolution CPU export and
Proof use the same new lens model; their identity checks pass. Existing stock
data, grain, halation and resolution are unchanged by Phase 3b. GPL credit is
in THIRD_PARTY_NOTICES.md. The cap/tail table and decisions are in the rebuild
plan; extreme Super 8 shapes are substantially tighter than uncapped upstream.

Final checks: 486 Node and 2,158 Python pass, three Python skips. Corrected
preview/export matrix: 128/128 pass, worst added mean 0.070 levels, p99.9 2,
inside unchanged 0.1/2 limits. Direct/Tiled: 128/128 byte-exact pixel comparisons;
focused startup/worst-lens smoke passes after fixing the Library import. The
initial native tile differences were corrected with integer pixel interpolation
and its edge support, without raising individual/composed blur caps, GPU image
allocations, memory ceilings or tolerances. Match can safely reject the recorded
coloured lens target; retired calibration Bloom has no invented replacement.
Existing extreme uncompressed HDR and two separate Black & White-only tile
failures remain as previously recorded. The unrelated Library pause HTTP 422
warning remains uninvestigated. No broad release sweep, push or installer.

Warmed timing: five measured repeats after one warm-up, real Darktable highlight
reconstruction DSC06451 EXR, HDR lane, 1520x1013, grain off, standard-range canvas
capture. Median forced GPU render: None 3.3 ms (2.8-6.3), Black Pro-Mist 1/2,
Size 1, 35mm 49.8 ms (48.7-53.1), CineBloom 2, Size 4, Super 8 86.8 ms
(85.1-94.9). Added cost is about 47 / 84 ms, well beyond the pre-recorded 5%
allowance and explained by the 27-component, 55-pass quarter-grid filter.
These are warmed forced-render timings, not whole-app interaction or native-size
latency guarantees. None bypasses the filter; active filters reuse existing
scratch images. No further timing sweep is needed; Steve should try dragging,
zooming and panning. Reduced grain separately costs 4-16 native samples instead
of one, and Phase 3 Scan adds passes; no controlled Phase 3 whole-preview timing
was taken.

Visual inspection: Black Pro-Mist 1/2 gives a restrained soft glow around shop
signs/lamps while retaining the dominant bright shop, dark street and reflections.
The maximum CineBloom/Super 8 recipe makes a much larger coloured veil and softens
signs, while the lit shop/signs remain brightest. This was an HDR-source picture
viewed through a standard-range diagnostic capture, not a physical HDR display
certification. Constant-field/channel energy checks pass; no additive brightness
term is used. Consider halo warmth as one later optional control; separate
core/halo/bloom controls are deferred. Phase 4 stock character and from-stock/set
tracking are next; Phase 5 Looks and Phase 6 panel polish remain unfinished.


## Phase 4 implementation completion (October 16, 2026)

Picking a stock now fills its grain, halation and matching paper. Seven owned
controls track inherited/set state independently in HDR and SDR; manual edits
show a reset dot, and double-click also restores inherited slider values.
Undo/redo, project save/reopen and Match HDR preserve ownership. Deliberate
bypasses remain independent. Existing projects have no ownership flags and
therefore treat these controls as inherited on their next stock change; there
is no migration. Existing full Look recipes await Phase 5.

Character metadata and its browser bootstrap share a generator. PRD section 5.5
records every shipped stock value, source and confidence. Portra 400 starts at
Amount 24, Size 30, for a 35mm scan displayed 6x4 inches at 14 inches viewing
distance. Change anchor=24.0 in codebase/tools/build_film_character.py and rerun
with the repository Python to tune Amount across the scale. Steve has not yet
judged this starting estimate. Vision3 charts were read visually as estimates;
precise layer fitting is unfinished and would require a later renderer phase.
The geometric format check passes, but does not certify perceived graininess.

Final checks: 493 Node tests pass; 2,181 Python tests pass, three skip. Stock
preview/export comparisons pass 10/10 (still, cine, slide, Neutral, set controls,
both lanes); grain comparisons pass 12/12. Existing mean 0.1 / p99.9 2 display
level limits are unchanged. Live UI checks pass selection, equal-value set,
dot/paper/double-click reset, relative slider/typed input, undo/redo and Match
HDR with independent SDR. No final failure remains. Initial failures exposed
an intended saved-schema signature change, a Hue step-grid issue (fixed), and
a harness assumption that Neutral must allocate a stock table (corrected to
require bypass). No tolerance was relaxed. Existing HDR precision, Black &
White tile and Library pause-warning limitations remain as previously recorded;
no broad release sweep was run.

Commit records: f560e7b adds sourced calibration (Node 493 pass; initial Python
2,157 pass with only the intended new saved-schema signature failing, three
skip; focused metadata checks pass). d68c215 adds ownership and reset controls
(focused Python 25 pass, including the updated intended signature; Node 493
pass). The final validation/docs commit adds behavior-driven UI and stock/grain
cases and records the final passing checks above. Export/Proof equations,
renderers, stage order, baked stock arrays, shader layouts and limits are
unchanged. No push or installer. Two unrelated untracked Library briefs remain
untouched. No Steve lens feedback arrived during Phase 4.

Next: Phase 5 stage presets and sparse Looks (PRD R11), rebuilding Clean Cinema,
Soft Color Negative, Dense Print and High-Speed Texture on real stocks/papers,
plus Looks for new stocks. Reuse HDRFilmCharacter and stock_overrides; apply
only deliberate preset changes as set. Phase 6 panel polish remains separate.
The exhaustive Phase 4 chosen-versus-alternative record is in the Phase 4 brief.


## Phase 5 completion (October 16, 2026)

Five simple stage menus (Lens, Format, Development, Print, Scan) and all eleven
approved Looks now work in the existing panel. The Film Look header's Looks
button opens the existing preset dialog, which also saves users' Looks. All 38
saved creative controls track deliberate edits, including equal-value edits;
set dots and slider double-click restore inheritance. Stock identity and preview
maps are excluded. Seven stock-varying defaults keep their Phase 4 behavior;
other controls use the unchanged common baseline. Sparse recipes retain stock,
paper and deliberate controls, replacing previous Film Look settings on apply.
Both retired Portra built-ins and the old four recipes are removed, without
migration. Existing old project/preset intent is not upgraded; re-save current
Looks for sparse behavior. HDR/SDR independence and one-time Match HDR remain.

Exact values, every chosen-versus-alternative decision and the complete Claude
Phase 6 mock-up handoff are in
[the Phase 5 brief](../technical/codex-brief-film-look-phase-5-presets-2026-10-16.md#phase-5-implementation-record-october-16-2026).
The recipes are creative starting estimates; Steve's visual judgment is pending.
The menus are plain selects, Format is still physically near Grain, and the
existing modal/dots await Phase 6 design. No rendering, calibration, stage order,
stock data, shader layouts, bounds, parity tolerances or export/Proof code changed.

Validation: 497 Node pass; 2,181 Python pass, three skip. Focused Electron UI
at 2560x1440 passes every stage and Look in HDR and SDR, sparse user-Look
save/reapply, switching stock inside a Look, new reset dots, undo/redo and
independent Match HDR. Existing stock-character UI checks also pass. Project
save/reopen uses temporary generated media in the Python check; preset UI uses
an in-memory store to protect Steve's folder. No pixel/render matrix is needed
for these control-only changes, per the brief. No final failure remains. Initial
syntax and ownership-order errors were fixed; a JSON-property-order-only UI
assertion was changed to compare each actual field. Existing HDR precision,
Black & White tile and Library-warning limitations are unchanged.

Commit 0b8be08 implements recipes/ownership/menus with the passing fast and
focused checks above. The following validation/docs commit adds the repeatable
UI helper and these records, using the same passing runs; no production code
changes after them. No broad release sweep, push or installer. Two unrelated
untracked Library briefs remain untouched. No Steve lens/grain feedback arrived.
Phase 6 starts with Claude's panel mock-up, then implementation.
