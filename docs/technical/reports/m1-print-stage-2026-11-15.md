# M1d: Film Look print-stage investigation, November 15, 2026

## Finding for Steve

**Yes, print adjustments can make selected colours match much more closely.**
On the Portra 50% denim family at 0 stops, changing **only warmth and
preflash** reduces target error from 0.624 to 0.280 RMS Delta E00. At +1 stop,
all three print controls reduce it from 6.744 to 0.339. Ektar reproduces the
same pattern. These are three-saturation selections, not a whole-photo fix.

**The evidence does not show a wrong print reference in one lane.** Both
lanes use the same negative, paper, printer-filter, preflash and scanner
data. Match copies print settings but fits the earlier SDR exposure/tone
path, so the negative and therefore the printer receive different inputs.
There is also an existing *post-mix boundary* difference: clamping negative
channels in ACEScg versus sRGB is not the same operation. Neither a fixed
per-stock print offset nor a print-only solver repairs the whole range.
Velvia is a slide: its print controls do nothing by design.

**No renderer, shader, Match fitter, saved recipe, tolerance or gate changed.**
Preserving the captured Film input, changing the signed-colour boundary, or
automatically fitting print controls are design decisions for Steve.

## Method and limits

- MacBook Neo, Apple A18 Pro, 8 GB; November 15, 2026. CPU only.
- Reused the supplied all-colour scripts in a private scratch folder outside
  the checkout. Real `apply_adjustments` and `materialize_sdr_match`, not a
  substitute film model. Same seven hue families and grey, saturations
  45/75/100%, stops -4..+3: 176 patches. sRGB-only population, **not** the
  separate 224-patch population containing wide-gamut fit controls.
- HDR Exposure +0.2 EV, Contrast +0.12, Saturation +0.10 and the prior
  five-point luma curve; default paper, stock colour/tone 100%; Film strength
  50% and 100%; grain, halation, lens, resolution loss, sharpening and locals
  inactive. Independent fresh Match for each stock/strength and exposure
  variant; print settings initially 0/0/0. Reference convention 203 nits.
- `H`: finished HDR converted to linear sRGB and divided by 0.18, following
  the earlier research's relative-white convention. `T`: the real Match
  target, including its shoulder and gamut map. `D`: finished SDR before
  encoding. Inherent = H:T, residual = T:D, total = H:D. HDR Delta E00 here
  is descriptive, **not an HDR perceptual acceptance metric**; SDR residual
  is the useful colour-match measure. No display/EDR or encoded-export claim.
- Searches minimize mean **squared residual Delta E00**, equally weighted
  over the selected coloured patches. Tables report its square root (RMS).
  Warmth bounds -100..100, preflash 0..100, print exposure -3..+3 EV: existing
  UI/model bounds, not new acceptance limits. A 125-point joint grid plus
  bounded coordinate refinement, separate two-control/exposure-only starts,
  and finer steps down to 0.25/0.125/0.0025 find reproducible **best-found**
  settings; these are not certified global minima or production recipes.
- Per-stop/per-hue solutions deliberately sacrifice unselected pixels.
  Whole-chart fitting includes all 168 coloured patches, not grey; grey is
  measured separately in the CSV. RMS can improve while mean/P95 or existing
  body gates worsen. No fitted result is installed or reclassified as safe.
- All three 100% synthetic charts are **refused by unchanged Match gates**.
  Their rows inspect the final explored candidate, captured immediately before
  refusal, without bypassing the refusal or returning a usable match. A
  low whole-chart RMS does not override a bad body P95.

## CPU and GPU chain: where each control acts

All file references below are repository-relative, at the measured source.

| Operation | CPU | GPU / parameter packing | Lane behaviour |
| --- | --- | --- | --- |
| Outer order | `codebase/backend/hdr_finisher/adjustments.py:244`, `:750`, `:802`, `:1793` | `codebase/frontend/webgpu-shaders.js:1947`, `:2045` | HDR tone/colour/detail -> Film -> vignette -> output cap; generated SDR exposure -> early shoulder/gamut -> Bands/contrast/colour/detail -> Film -> vignette -> output cap |
| Common Film exposure scale | `adjustments.py:28`, `:1990` | `webgpu-shaders.js:1415` | HDR ACEScg -> linear sRGB times S=(100/203)/0.18=2.7367268; SDR already display-linear sRGB, scale 1 |
| Kernel white and middle grey | `adjustments.py:2004`, `:2017` | `webgpu-shaders.js:1433` | Kernel white 1 and middle grey .18 in common space: HDR lane white 1/S and grey .18/S; SDR white 1 and grey .18. Above white, hold colour evaluation at white and preserve highlight ratios |
| Negative exposure/development/separation | `codebase/backend/hdr_finisher/film_stock.py:331`, `:380`, `:393` | `webgpu-shaders.js:1352`, `:1440` | Same matrix, stock exposure gain, log characteristic curves, couplers and development gamma; colour separation expands density about the matching grey; density grain is before print |
| Paper and density response | `film_stock.py:154`, `:444`, `:457` | `codebase/frontend/film-stocks.js:84`; controlled stock payload supplies GPU tables | Same default/selected paper, density-to-print-exposure LUT, print-curve gamma/layer morph and scanner table; no HDR paper |
| Print warmth/tint | `film_stock.py:344` | `webgpu-shaders.js:1371`; `codebase/frontend/gpu-params.js:318` | Add warmth/100 times the stock's log10 shift vector, plus tint's vector, to main print log exposure **before** exponentiation. Does not filter preflash |
| Print exposure | `film_stock.py:355`; `:273` | `webgpu-shaders.js:1376`; `gpu-params.js:311` | Multiply main print light by 2^EV; identical both lanes |
| Preflash | `film_stock.py:356` | `webgpu-shaders.js:1376`; `gpu-params.js:320` | Add preflash/100 times .1 times the stock's `preflash_raw`, **after** main print exposure; identical both lanes |
| Print density -> scan | `film_stock.py:358`, `:362`, `:376` | `webgpu-shaders.js:1377`, `:1384` | log10(main light + preflash) -> paper curves -> print density -> scanner LUT -> linear sRGB |
| Grey/tone normalization | `adjustments.py:2006`, `:2029` | `webgpu-shaders.js:1435`, `:1442` | Tone gain measured from .18 grey with print exposure forced to gain 1, but current warmth/preflash/paper retained. Actual pixel and its grey use actual print exposure. Thus EV remains effective; warmth/preflash partly normalize out at middle grey but still change colour and toe/shoulder response. Same rule in both lanes |
| Whole-look mix and lower boundary | `adjustments.py:1848`, `:1852` | `webgpu-shaders.js:2064`, `:2068` | Mix completed scan with original once, then max(RGB,0) in **lane primaries**. No new early 0..1 clip. This lower boundary is not equivalent in ACEScg and sRGB |
| Slides | `film_stock.py:238`, `:346`, `:451` | `film-stocks.js:87`; `webgpu-shaders.js:1372` | Velvia scans negative-stage slide density directly; paper, print exposure/warmth/tint/preflash and print-curve controls bypassed |

Portra 400 and Ektar 100 default to Kodak Portra Endura; alternative Kodak
2383 and Fujifilm Crystal Archive Type II use the same selected data in
either lane. Lab levels modify the scan table, not a lane-specific print
reference. Luma is evaluated in the lane's primaries (`adjustments.py:1934`,
`webgpu-shaders.js:1303`), leaving small matrix/luma differences even at
nominally equal common-space input. S is the fixed working convention, not
the display's currently available EDR headroom.

## What Match copies and fits

`codebase/backend/hdr_finisher/sdr_match.py:643` deep-copies the entire
Film Look object. Paper, print exposure, warmth, tint, preflash, print/shadow/
highlight contrast, stock exposure, stock colour/tone, development and Look
Strength are **verbatim**, not translated or solved. A nonzero-control
probe (warmth +30, preflash 25, print +0.5 EV, tint -15, Kodak 2383, contrast
20/-15/+10) confirms exact equality of all eight print fields for all stocks.
The Film-specific translation at `:677` changes only halation amount.

The visible recipe is then fitted at `:388` onward: neutral tonal response,
image exposure, Bands, optional saturation/vignette and curves, followed by
finished highlight luminance refinement (`:214`). The semantic fitter
(`:985`) does not solve print parameters. Gates remain at `:530` onward.
The disposable target (`:98`) is built **after HDR Film**, whereas candidate
SDR Film receives a source already altered by the SDR shoulder/gamut and
fitted tone stages. Matching the final recipe is not matching its Film input.

## Reproducing Steve's adjustment: selected colours

Settings are **warmth / preflash / print EV** in ordinary UI units. These
rows optimize only the stated family and stop, averaging three saturations.
They are examples of a manual local visual correction, not recommendations
to apply across a photo. Film strength is 50% throughout this table.

| Stock | Selection | Search | Warmth/preflash/EV | Residual RMS Delta E00 |
| --- | --- | --- | --- | --- |
| Portra 400 | denim 0 | warmth + preflash | +20.25/22.12/+0 | 0.624 -> 0.280 |
| Portra 400 | denim 0 | all | +2/4.125/-0.0625 | 0.624 -> 0.126 |
| Portra 400 | denim 1 | warmth + preflash | -100/23.12/+0 | 6.744 -> 3.986 |
| Portra 400 | denim 1 | all | -30.25/21.88/-0.3675 | 6.744 -> 0.339 |
| Ektar 100 | denim 0 | warmth + preflash | -0.75/24.38/+0 | 0.649 -> 0.277 |
| Ektar 100 | denim 0 | all | -2/4.75/-0.065 | 0.649 -> 0.162 |
| Ektar 100 | denim 1 | warmth + preflash | -100/63.88/+0 | 7.027 -> 3.412 |
| Ektar 100 | denim 1 | all | -50.25/37.62/-0.31 | 7.027 -> 0.333 |

Warmth/preflash alone really help; print exposure supplies a different and
often stronger tonal correction. At +1 stop over **all seven hues**, Portra
RMS is 8.440 ->5.952 with warmth/preflash only, ->3.778 with print EV only,
and ->3.754 jointly. For Ektar it is 8.826 ->5.781 / 3.502 / 3.495.
The selected denim joint result is much better than the all-hue result:
fitting one visible colour cannot establish general colour accuracy.

## One whole-chart setting per stock/strength

One global ordinary print recipe cannot reproduce the selected-tone gains.
The same setting is applied to every pixel, including shadows and highlights.

| Stock | Strength | Original Match status | Best-found warmth/preflash/EV | Residual RMS before -> after | Mean before -> after |
| --- | --- | --- | --- | --- | --- |
| Portra 400 | 50% | needs_review | -11/20.25/-0.01 | 5.882 -> 5.657 | 3.615 -> 3.556 |
| Ektar 100 | 50% | needs_review | -30.75/36.88/-0.0025 | 6.050 -> 5.777 | 3.792 -> 3.719 |
| Velvia 100 | 50% | matched | +0/0/+0 | 5.394 -> 5.394 | 2.760 -> 2.760 |
| Portra 400 | 100% | REFUSED_DIAGNOSTIC_ONLY | +3/3.25/-0.04 | 4.504 -> 4.355 | 3.221 -> 2.843 |
| Ektar 100 | 100% | REFUSED_DIAGNOSTIC_ONLY | +4/8.5/+0.0025 | 4.491 -> 4.360 | 2.893 -> 2.826 |
| Velvia 100 | 100% | REFUSED_DIAGNOSTIC_ONLY | +0/0/+0 | 6.663 -> 6.663 | 5.651 -> 5.651 |

At 50%, joint RMS improves only 3.8% Portra and 4.5% Ektar over the full
colour/exposure chart. Both remain limited by bright colour and finishing;
50% Velvia is unchanged, including at extreme print settings. The negative
stocks' optimized body median OKLab errors are 0.01751 and 0.02094: worse
than the usual matched median 0.015 gate, despite improved overall RMS.
At 100%, all synthetic recipes remain refused; the optimized body luma
P95 is 0.106/0.107/0.095 for Portra/Ektar/Velvia, not an accepted match.

## Exposure dependence: not a stock calibration constant

At 50% strength the measured **pre-negative** SDR/HDR common-space Y ratio
crosses one around 0 stops: SDR exposure is higher in shadows and lower in
highlights. At 100% the refused candidates have different, nonmonotone fits.
The printer is downstream of those already-different negatives.

| Stock / strength | -3 stop input ratio | -1 | 0 | +1 | +2 |
| --- | --- | --- | --- | --- | --- |
| Portra 400 / 50% | 1.159 | 1.064 | 0.960 | 0.784 | 0.508 |
| Ektar 100 / 50% | 1.171 | 1.076 | 0.959 | 0.776 | 0.503 |
| Velvia 100 / 50% | 1.017 | 1.012 | 0.987 | 0.677 | 0.391 |
| Portra 400 / 100% | 0.855 | 0.940 | 1.105 | 0.843 | 0.411 |
| Ektar 100 / 100% | 1.018 | 0.931 | 1.048 | 0.829 | 0.410 |
| Velvia 100 / 100% | 0.735 | 0.969 | 1.044 | 0.696 | 0.331 |

Best-found independent per-stop print solutions (all seven hues; 50%):

| Stock | Stop | Warmth/preflash/EV | Residual RMS before -> after |
| --- | --- | --- | --- |
| Portra 400 | -3 | +1/0/+0.205 | 1.801 -> 0.645 |
| Portra 400 | -1 | +1.75/0/+0.1025 | 1.407 -> 0.417 |
| Portra 400 | +0 | +0.75/4.25/-0.0625 | 0.668 -> 0.207 |
| Portra 400 | +1 | +7.75/0/-0.715 | 8.440 -> 3.754 |
| Ektar 100 | -3 | -4.5/0/+0.245 | 2.040 -> 0.643 |
| Ektar 100 | -1 | +3.25/0/+0.1275 | 1.678 -> 0.500 |
| Ektar 100 | +0 | -2.25/4.75/-0.0675 | 0.706 -> 0.253 |
| Ektar 100 | +1 | +3.5/0.375/-0.7375 | 8.826 -> 3.495 |

For Portra the best-found print EV changes from +0.205 in shadows to -0.715
at +1 stop; Ektar likewise changes sign. An enlarger correction cannot undo
the hue-dependent, nonlinear negative response at every exposure at once.
Per-stock constant offsets would conceal, rather than repair, this placement
problem. Also, global print warmth/preflash compensates final clipping and
tone-fit residuals; it is not a pure instrument calibration estimate.

Freshly rematching the *same whole chart* with HDR exposure -1/0/+1 EV
relative to the original +0.2 EV gives:

| Stock / strength 50% | HDR exposure delta | Warmth/preflash/EV | Residual RMS before -> after |
| --- | --- | --- | --- |
| Portra 400 | +0 | -11/20.25/-0.01 | 5.882 -> 5.657 |
| Portra 400 | -1 | -9.5/18.5/+0.005 | 4.635 -> 4.411 |
| Portra 400 | +1 | -11.25/24.75/-0.0125 | 6.713 -> 6.519 |
| Ektar 100 | +0 | -30.75/36.88/-0.0025 | 6.050 -> 5.777 |
| Ektar 100 | -1 | -26/30.62/+0.005 | 4.812 -> 4.523 |
| Ektar 100 | +1 | -36.5/41.75/-0.01 | 6.885 -> 6.649 |

## Real photos: transfer and trade-offs

Used the earlier investigation's exact canonical <=512-pixel RAW source
arrays for IMG_0790.CR2 (people) and IMG_7723.CR3 (foliage), both from the
shared HDR Test Images set. Fit Match and print on every fourth pixel
(<=128-pixel long edge), then re-render the resulting recipe and compare
against the exact HDR-derived target at the original <=512-pixel size.
No new RAW development, monitor judgment or full-resolution export claim.
The compact photo search uses five seeds and four coarser pattern scales
(last step 1 warmth / .5 preflash / .01 EV); it is a best-found diagnostic,
not the exhaustive synthetic grid. Status refers to the original compact
Match, and refusal rows remain diagnostic only.

| Photo | Stock / strength | Match status | Warmth/preflash/EV | RMS before -> after | P95 before -> after |
| --- | --- | --- | --- | --- | --- |
| IMG_0790.CR2 | Portra 400 / 50% | matched | +6/0/-0.15 | 2.018 -> 1.911 | 2.906 -> 3.008 |
| IMG_0790.CR2 | Portra 400 / 100% | matched | +55/10/+0.12 | 3.091 -> 2.812 | 2.959 -> 2.977 |
| IMG_0790.CR2 | Ektar 100 / 50% | matched | +45/3.5/-0.02 | 1.951 -> 1.917 | 2.888 -> 2.968 |
| IMG_0790.CR2 | Ektar 100 / 100% | matched | +15/12/+0.04 | 2.561 -> 2.401 | 4.107 -> 4.041 |
| IMG_0790.CR2 | Velvia 100 / 50% | matched | +0/0/+0 | 2.313 -> 2.313 | 4.117 -> 4.117 |
| IMG_0790.CR2 | Velvia 100 / 100% | needs_review | +0/0/+0 | 3.420 -> 3.420 | 7.534 -> 7.534 |
| IMG_7723.CR3 | Portra 400 / 50% | REFUSED_DIAGNOSTIC_ONLY | -3/13.5/+0.14 | 2.471 -> 1.794 | 3.559 -> 3.822 |
| IMG_7723.CR3 | Portra 400 / 100% | needs_review | +10/0/-0.01 | 2.495 -> 2.085 | 4.137 -> 3.175 |
| IMG_7723.CR3 | Ektar 100 / 50% | REFUSED_DIAGNOSTIC_ONLY | -9/17.5/+0.15 | 2.598 -> 1.878 | 3.739 -> 3.891 |
| IMG_7723.CR3 | Ektar 100 / 100% | REFUSED_DIAGNOSTIC_ONLY | -18/0/+0 | 4.683 -> 4.288 | 8.778 -> 7.651 |
| IMG_7723.CR3 | Velvia 100 / 50% | needs_review | +0/0/+0 | 0.733 -> 0.733 | 1.892 -> 1.892 |
| IMG_7723.CR3 | Velvia 100 / 100% | needs_review | +0/0/+0 | 0.963 -> 0.963 | 1.470 -> 1.470 |

Settings differ materially between photos, even for the same stock/strength.
For Portra 50%, the people photo prefers +6/0/-0.15 whereas the foliage
candidate prefers -3/13.5/+0.14: opposite print EV signs. Foliage Portra/Ektar
50% RMS improves about 27%, but its P95 **worsens**; the original compact
Match refused both. Portra 100% on people reduces RMS 3.091 ->2.812 but
increases mean 1.197 ->1.265. Improvement in one score is not a safety proof.

## Equal-input controls and the separate signed-colour boundary

For both strengths, all three stocks, default/2383/Crystal Archive papers,
and print triplets 0/0/0, +30/25/+0.5 and -40/70/-0.75, exposed the **same**
common-space RGB to the real CPU stock chain in both lanes. Max Delta E00
over the 176 patches and the expanded paper/settings set is:

| Stock | Signed stock + mix maximum, 50% | Signed stock + mix maximum, 100% | Completed module maximum, 100% |
| --- | --- | --- | --- |
| Portra 400 | 0.118 | 0.327 | 8.797 |
| Ektar 100 | 0.116 | 0.314 | 9.004 |
| Velvia 100 | 0.101 | 0.286 | 8.673 |

The expanded signed-kernel maximum is 0.327, consistent with the earlier
default-paper control's 0.321, **not a new tolerance**. Applying a common
sRGB nonnegative clamp to both signed mixes leaves that maximum unchanged.
But letting the complete modules clamp in their own primaries raises the
maximum to 9.004 (Ektar/2383/100%). Even Velvia shows this without any print.
The default-paper maxima at 100% are 6.241/6.933/8.673. This is a second
demonstrable stage difference, not evidence of separate printer constants.
These are high-chroma stage controls, not finished legal-SDR acceptance
scores. A shared signed-colour boundary would change ordinary HDR output,
so it is reported for design review, not silently patched here.

## Complete hue x stop measurements

[Committed 384-row hue/stop table](m1-print-stage-hue-stop-2026-11-15.csv)
contains each stock x strength x eight families x eight stops, aggregating
the three saturations (grey has one sample). It records mean/RMS/max Delta
E00 and mean Delta L for inherent HDR:target, target:SDR before/after the
single whole-chart print solution, total HDR:SDR before/after and the Film
input gap. Refused candidate rows are explicitly labelled. No near-neutral
hue angle is promoted to a colour-rotation claim.

The compact grids below show target residual **RMS before -> after the
whole-chart setting**, not the independently optimized per-stop settings.

[Committed 336-row independent fit table](m1-print-stage-fit-settings-2026-11-15.csv)
also records best-found warmth/preflash/print EV and before/after errors for
every stock x strength x seven coloured families x eight stops. Each row
optimizes just that hue/stop's three saturations. Those independent settings
cannot all be applied as one global recipe; Velvia's 0/0/0 is the canonical
representative of an unchanged response, not a uniquely identified optimum.

### Portra 400, 50% (needs_review)

| Hue | -4 | -3 | -2 | -1 | +0 | +1 | +2 | +3 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skin | 0.57->1.12 | 1.78->2.21 | 2.44->2.88 | 1.42->1.97 | 0.79->1.35 | 4.17->1.13 | 0.00->0.00 | 0.00->0.00 |
| red | 0.72->1.14 | 1.68->2.07 | 2.07->2.77 | 1.27->2.31 | 0.56->0.62 | 11.66->10.58 | 8.36->8.36 | 8.36->8.36 |
| green | 0.68->1.15 | 1.71->2.10 | 2.35->2.66 | 1.50->1.89 | 0.77->0.39 | 6.29->2.58 | 18.61->18.61 | 18.61->18.61 |
| cyan | 0.65->1.26 | 1.64->2.26 | 2.25->2.70 | 1.47->2.03 | 0.68->0.94 | 6.95->3.07 | 9.88->9.88 | 9.88->9.88 |
| denim | 0.63->1.38 | 1.96->2.62 | 2.49->2.90 | 1.41->1.93 | 0.62->0.58 | 6.74->4.71 | 3.67->3.67 | 3.67->3.67 |
| indigo | 0.64->1.40 | 1.94->2.66 | 2.65->3.09 | 1.43->1.97 | 0.51->0.74 | 10.76->9.01 | 5.55->5.55 | 5.55->5.55 |
| magenta | 0.69->1.24 | 1.87->2.37 | 2.38->3.02 | 1.33->2.12 | 0.70->0.50 | 9.81->7.94 | 10.95->10.95 | 10.95->10.95 |
| grey | 0.41->1.10 | 1.62->2.28 | 2.51->2.96 | 1.45->1.94 | 0.72->0.88 | 0.80->0.43 | 0.07->0.07 | 0.07->0.07 |

### Ektar 100, 50% (needs_review)

| Hue | -4 | -3 | -2 | -1 | +0 | +1 | +2 | +3 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skin | 0.51->1.24 | 1.90->2.29 | 2.75->3.24 | 1.73->2.63 | 0.81->1.94 | 4.95->1.39 | 0.00->0.00 | 0.00->0.00 |
| red | 0.75->1.25 | 1.84->2.31 | 2.10->3.07 | 1.51->2.92 | 0.60->0.75 | 11.60->10.51 | 8.39->8.39 | 8.39->8.39 |
| green | 0.64->1.25 | 1.98->2.35 | 2.62->2.86 | 1.75->2.20 | 0.79->0.51 | 7.32->3.29 | 18.89->18.89 | 18.89->18.89 |
| cyan | 0.57->1.37 | 2.06->2.77 | 2.58->2.93 | 1.76->2.15 | 0.78->0.93 | 7.46->3.44 | 10.40->10.40 | 10.40->10.40 |
| denim | 0.69->1.58 | 2.31->3.01 | 2.73->2.96 | 1.67->2.04 | 0.65->0.48 | 7.03->4.38 | 3.62->3.62 | 3.62->3.62 |
| indigo | 0.74->1.62 | 2.11->2.88 | 2.95->3.22 | 1.69->2.05 | 0.48->0.40 | 10.98->8.61 | 5.56->5.56 | 5.56->5.56 |
| magenta | 0.70->1.48 | 2.05->2.60 | 2.45->3.21 | 1.63->2.68 | 0.76->0.61 | 10.35->8.04 | 11.01->11.01 | 11.01->11.01 |
| grey | 0.39->1.27 | 1.65->2.50 | 2.88->3.38 | 1.74->2.39 | 0.72->1.42 | 1.03->0.47 | 0.02->0.02 | 0.02->0.02 |

### Velvia 100, 50% (matched)

| Hue | -4 | -3 | -2 | -1 | +0 | +1 | +2 | +3 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skin | 0.09->0.09 | 0.20->0.20 | 0.51->0.51 | 0.29->0.29 | 0.22->0.22 | 3.76->3.76 | 0.00->0.00 | 0.00->0.00 |
| red | 0.10->0.10 | 0.16->0.16 | 0.43->0.43 | 0.24->0.24 | 2.22->2.22 | 10.67->10.67 | 7.37->7.37 | 7.37->7.37 |
| green | 0.14->0.14 | 1.32->1.32 | 1.74->1.74 | 0.89->0.89 | 0.22->0.22 | 4.67->4.67 | 15.60->15.60 | 17.14->17.14 |
| cyan | 0.21->0.21 | 1.11->1.11 | 1.31->1.31 | 0.97->0.97 | 0.20->0.20 | 5.35->5.35 | 8.66->8.66 | 8.66->8.66 |
| denim | 0.06->0.06 | 0.25->0.25 | 0.50->0.50 | 0.35->0.35 | 0.17->0.17 | 9.58->9.58 | 2.56->2.56 | 2.56->2.56 |
| indigo | 0.06->0.06 | 0.22->0.22 | 0.57->0.57 | 0.38->0.38 | 0.41->0.41 | 11.89->11.89 | 5.39->5.39 | 5.39->5.39 |
| magenta | 0.07->0.07 | 0.19->0.19 | 0.49->0.49 | 0.31->0.31 | 1.62->1.62 | 10.59->10.59 | 10.46->10.46 | 10.46->10.46 |
| grey | 0.05->0.05 | 0.19->0.19 | 0.53->0.53 | 0.30->0.30 | 0.20->0.20 | 0.54->0.54 | 0.10->0.10 | 0.10->0.10 |

### Portra 400, 100% (REFUSED_DIAGNOSTIC_ONLY)

| Hue | -4 | -3 | -2 | -1 | +0 | +1 | +2 | +3 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skin | 1.54->0.98 | 2.36->1.49 | 3.05->1.92 | 1.61->0.52 | 2.24->2.88 | 2.73->3.26 | 0.00->0.00 | 0.00->0.00 |
| red | 1.89->1.12 | 1.96->1.13 | 2.24->1.38 | 1.14->0.62 | 7.82->8.62 | 16.80->16.87 | 4.26->4.20 | 3.84->3.83 |
| green | 2.00->1.35 | 2.00->1.25 | 3.30->2.43 | 1.74->0.66 | 1.98->2.86 | 6.12->5.93 | 5.45->5.34 | 5.31->5.20 |
| cyan | 1.91->1.30 | 3.79->3.08 | 5.24->4.27 | 2.74->1.96 | 1.65->2.50 | 5.24->5.38 | 2.49->3.78 | 3.08->5.27 |
| denim | 1.45->1.19 | 4.97->4.23 | 5.69->4.66 | 1.89->1.18 | 2.43->2.85 | 6.35->5.92 | 1.76->1.19 | 1.40->1.26 |
| indigo | 1.38->1.11 | 2.93->2.27 | 3.27->2.14 | 1.42->0.37 | 5.06->4.64 | 8.30->7.66 | 2.63->2.08 | 2.48->1.94 |
| magenta | 1.91->1.42 | 2.23->1.65 | 2.70->1.90 | 1.26->0.38 | 4.93->5.50 | 13.50->13.41 | 3.59->2.79 | 3.41->2.57 |
| grey | 0.50->0.23 | 1.60->0.96 | 3.13->2.06 | 1.53->0.98 | 1.72->2.52 | 0.34->0.49 | 0.18->0.18 | 0.18->0.18 |

### Ektar 100, 100% (REFUSED_DIAGNOSTIC_ONLY)

| Hue | -4 | -3 | -2 | -1 | +0 | +1 | +2 | +3 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skin | 0.93->1.26 | 0.28->0.66 | 1.24->0.90 | 1.97->2.17 | 1.00->1.64 | 3.79->2.60 | 0.00->0.00 | 0.00->0.00 |
| red | 1.44->1.70 | 0.20->0.57 | 0.76->0.46 | 1.30->1.31 | 7.60->7.77 | 16.51->15.82 | 4.50->4.18 | 3.66->3.43 |
| green | 1.41->1.73 | 0.28->0.48 | 2.25->2.09 | 2.51->2.47 | 0.84->1.57 | 6.82->5.98 | 5.84->5.51 | 5.87->5.44 |
| cyan | 1.22->1.50 | 1.35->1.19 | 4.21->3.91 | 3.56->3.01 | 1.57->1.89 | 5.82->5.71 | 4.06->5.28 | 5.24->6.86 |
| denim | 1.31->1.01 | 2.94->2.55 | 5.18->4.93 | 2.74->2.79 | 2.35->2.66 | 6.38->5.99 | 2.32->1.45 | 1.71->1.36 |
| indigo | 1.32->0.90 | 0.94->0.81 | 1.49->1.42 | 1.77->1.74 | 5.61->5.82 | 9.28->9.03 | 3.21->2.41 | 3.07->2.26 |
| magenta | 1.53->1.48 | 0.30->1.12 | 0.94->1.46 | 1.56->1.41 | 4.73->4.66 | 13.90->13.45 | 3.98->3.41 | 3.85->3.18 |
| grey | 0.36->0.67 | 0.19->0.84 | 1.31->1.90 | 1.86->3.08 | 0.65->2.09 | 0.68->1.42 | 0.04->0.04 | 0.04->0.04 |

### Velvia 100, 100% (REFUSED_DIAGNOSTIC_ONLY)

| Hue | -4 | -3 | -2 | -1 | +0 | +1 | +2 | +3 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skin | 8.12->8.12 | 5.40->5.40 | 4.22->4.22 | 0.92->0.92 | 1.79->1.79 | 7.16->7.16 | 2.89->2.89 | 2.79->2.79 |
| red | 10.39->10.39 | 3.45->3.45 | 3.77->3.77 | 0.96->0.96 | 5.59->5.59 | 12.06->12.06 | 6.54->6.54 | 6.40->6.40 |
| green | 9.42->9.42 | 7.77->7.77 | 7.02->7.02 | 3.28->3.28 | 1.50->1.50 | 9.27->9.27 | 7.70->7.70 | 7.61->7.61 |
| cyan | 6.42->6.42 | 9.57->9.57 | 7.02->7.02 | 3.22->3.22 | 1.39->1.39 | 9.85->9.85 | 4.59->4.59 | 4.45->4.45 |
| denim | 8.14->8.14 | 12.55->12.55 | 7.61->7.61 | 0.89->0.89 | 2.87->2.87 | 7.74->7.74 | 5.58->5.58 | 5.26->5.26 |
| indigo | 8.94->8.94 | 4.75->4.75 | 4.04->4.04 | 1.02->1.02 | 5.35->5.35 | 7.96->7.96 | 6.48->6.48 | 6.32->6.32 |
| magenta | 11.33->11.33 | 4.49->4.49 | 3.53->3.53 | 0.86->0.86 | 6.66->6.66 | 12.92->12.92 | 6.55->6.55 | 6.41->6.41 |
| grey | 0.49->0.49 | 4.05->4.05 | 4.17->4.17 | 0.92->0.92 | 0.94->0.94 | 4.86->4.86 | 3.02->3.02 | 2.72->2.72 |

## Options, not implemented

1. **Retain current placement; add a guarded ordinary print-control fit to
   Match.** Can help chosen tones dramatically (denim +1: 6.744 ->0.339),
   but the whole-chart reduction is only 3.8-4.5% at 50%, two negative-stock
   body medians worsen beyond the usual matched gate, and Velvia is not
   affected. Any design must keep the current gates, protect the rest of the
   photo, and decide how far it may alter Steve's chosen print character.
2. **Design exposure-preserving Film evaluation / Match placement.** Addresses
   the upstream mismatch shared by negative and slide stocks: +1 input is
   about 22% lower for Portra/Ektar and 32% for Velvia at 50%. A tone-preserving
   response transfer or different placement needs an explicit HDR/SDR
   processing policy and CPU/GPU/Proof/export validation. No new order or
   hidden renderer was implemented, and no unmeasured benefit is promised.
3. **Include the post-mix signed-colour boundary in that decision.** Same-input
   signed stock chains max 0.327, complete lane-local modules up to 9.004 in
   this expanded test. Common-space handling is a plausible separate lever,
   but changes ordinary HDR colours and still cannot undo differing inputs.

**Recommended next decision:** should Match preserve the chosen Film/Print
character by retaining its HDR input response, rather than automatically
changing print settings to disguise the difference? That is the broader
M1d policy choice; the present data rules out a universal stock print offset.

## Reproduction and validation

Local detailed evidence is retained in ignored
`codebase/output/review/m1-print-stage/`: source scripts, matched and refused
diagnostic recipes, per-patch metrics, fits, RAW summaries, equal-input
controls and a source-hash manifest. Working scratch is
`/private/tmp/hdr-m1-print-research/`. Copy scripts outside the repository,
then run with `codebase/.venv/bin/python`: `print_research.py`, `controls.py`,
`raw_print.py`. The scripts reuse `run_srgb50.py` definitions. Paths name
this Mac; no extra SciPy install, app launch or GPU is needed.

Measured source HEAD: `40c939b25da40f7a50d8cc96afb3277c4b55079e` on
`feat/watermark-and-library-polish`; per-file hashes are in the local manifest.
The report/two CSVs and Film Look/W5 documentation are the only tracked
changes made by this investigation. Other agents' edits remain separate.

- `node --test tests/*.test.js`: 1,033 passed, 1 skipped, 0 failed (12.8 s).
- `.venv/bin/python -m pytest tests -q`: 3,485 passed, 144 skipped,
  1 xpassed, 1 warning (235.4 s); `HDR_CPU_THREADS=2` for both suites.
- CPU research: 12 synthetic Match/print searches, 12 bounded-photo cases,
  and 54 equal-input stock/paper/settings/strength controls. Refusals are
  reported, not bypassed. All eight nonzero print-copy fields agree.
- No Electron/GPU, Proof or encoded-export run: no rendering code changed.
  This is not a fresh GPU parity or delivery certification. No acceptance
  gate, tolerance or protected fixture is changed.


## November 16 N3a follow-up: placement remains unresolved

Steve approved equal Film input and post-film fitting. The N3a bounded probe
holds global Exposure equal, fits the pre-Film prefix with ordinary controls,
then searches actual Film/HC/gamut renders over four HC modes and print
controls. It still has P95 input-luma gap .118722 and fails the unchanged
.050 body-colour ceiling at Portra .067320, Ektar .062441, Velvia .068645.
No probe recipe is installed; this is not exact input equivalence, nor proof
that a complete editable solver cannot work. The final safe code retains the
old global Film placement. M1d stays open. Full per-colour, all-stop and
five-RAW comparisons against all three requested baselines are in the new
N3a section of [M1 follow-up](m1-colour-follow-up-2026-11-15.md).
