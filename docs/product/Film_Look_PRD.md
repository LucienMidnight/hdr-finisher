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
| Vision3 50D, 200T, 250D, 500T (`kodak_vision3_*`) | Per-layer RMS curves across the tonal range | Confirmed curves, **not yet read off the charts** | Kodak sheets: 50D (March 2022), 200T brochure (revision code 1167.25), 250D (March 2022), 500T H-1-5219t (July 2015) |
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
- How a PGI number becomes our Grain Amount and Size is **our calibration, not yet
  done**. It will be fitted to the Kodak stocks and checked by eye.
- Spektrafilm itself has **no per-stock grain**: all stocks use the same settings
  (`runtime/params_schema.py` `GrainParams`; `model/grain.py` has a to-do note
  for per-stock RMS granularity).

Size follow-up, October 15, 2026: **unresolved Fit/export mismatch; Phase 3
controls have not been implemented.** A generated 2400 x 1600 four-patch image,
Portra 400, Grain Amount 100, Size 50, 35mm, Chroma 40 was rendered through the
GPU at native 100% and at a reduced 1200 x 800 Fit processing size, then compared
with the actual CPU export renderer at original and half-size delivery, with
output sharpening off. At native size the mean RGB difference was 0.0653 levels
out of 255 and p99.9 was 1 level. At half size it was 2.5180 levels and p99.9 was
14 levels. At the app's actual automatic Fit size (1520 x 1013, resolution
override off), the mean difference was 3.1402 levels and p99.9 was 18; grey-patch
grain variation was 3.3671 preview versus 2.5827 export, again about 30% stronger.
On the half-size flat mid-grey patch, mean per-channel grain standard deviation
was 2.6657 preview versus 2.0575 export: the reduced preview grain was about 30%
stronger, visibly so in side-by-side crops. Native variation was 4.4188 preview
versus 4.4142 export. Downsize export therefore correctly makes grain finer;
rebuilding the grain at the smaller preview size does not reproduce that scan.
Coarser Super 8 grain looked consistent overall, so it alone would have missed
the issue. This was the SDR lane with a standard-range canvas; HDR and other
Fit sizes remain unchecked. Full/native processing displayed at Fit was not
assessed; the failing case is reduced processing at Fit, not CSS scaling alone.

The brief explicitly says to stop and report a visible Fit/export disagreement
before changing the design. No grain, stage order, export or pinned tolerance
was changed. `tests/performance/film-grain-size-diagnostic.js`, run through the
Electron runner at 2560x1440, preserves this read-only comparison and writes
crops/results to ignored `output/phase3-grain/`. It reports results rather than
loosening or replacing the existing parity checks. The existing grain-parity
driver compares equal-sized CPU/GPU preview renders; it cannot catch this
full-render-then-downsize export difference.

### 5.4 Data still to get

| Item | Why it matters | Where it might come from |
|---|---|---|
| Ektachrome E100 sheet (E-4000) | Confirms the current slide film's grain | Kodak Alaris |
| Vision3 values off the charts | Per-stock grain for cinema stocks, and the shadow-to-highlight shape | The saved sheets |
| Pushed Portra 800 grain | Push/Pull grain change | Not published; keep as estimate |
| Verita 200D sheet | Grain for this stock | Kodak |

## 6. Acceptance

- Every control does something visible at its default range, alone (no control
  that only works when another is raised).
- No two controls do the same job.
- Switching stock inside a Look keeps the user's own settings and updates the rest.
- Every per-stock default in the shipped data traces to section 5.
- GPU and CPU export agree within the parity tolerances.
