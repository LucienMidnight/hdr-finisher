# Film Look Rebuild Plan

- **Date:** October 15, 2026
- **Branch at planning time:** `film-stocks-phase-1` (after `597e5ac`)
- **Status:** Phases 1-6 (including 3b) implemented October 16, 2026; release check of the whole rebuild remains before merge. Phase 6 follows the approved mock-up and its implementation record in the Phase 6 brief. See section 8 and the completion notes below for current results; earlier WIP notes are historical. Decisions marked **Steve** are open.
- **Reference read:** spektrafilm at `3bb2c2d` (June 7, 2026), Filmbox's published workflow.
- **Requirements and data sources:** [Film Look PRD](../modules/film-look.md). Its
  section 5 is the record of which film data is confirmed, estimated or missing;
  keep it current rather than this plan's grain table.

## 1. Why

The Film Stock stage (spektrafilm data) now does the job the older Film Response
section did, using real measured curves. The two stack on top of each other, and
three Film Response sliders (Print Contrast, Toe, Shoulder) do nothing unless
Print Strength is above 0. Halation, Bloom and Grain are also applied after the
film is finished, while on real film (and in spektrafilm) they happen before or
inside the negative. This plan rebuilds Film Look around the physical process,
with presets in layers.

## 2. Goals

1. One panel, ordered the way light travels through real film:
   **Lens -> Negative -> Development -> Print -> Scan -> Output.**
2. Each effect happens at its physical point, so the film curve shapes it as
   real film would (for example, halation glow is compressed by the negative's
   shoulder, and grain passes through the print paper's contrast).
3. Presets in three layers: the stock's own character, presets for a single
   stage, and complete Looks.
4. No two controls doing the same job.
5. HDR keeps working: highlights above paper white keep their ratios, as now.

## 3. How spektrafilm works (what matters for us)

Its order of steps (`runtime/pipeline.py`, `runtime/stages/*.py`):

1. **Camera:** exposure, then the lens diffusion filter (Black Pro-Mist,
   Pro-Mist, Glimmerglass, CineBloom), then lens blur, then **halation and
   in-emulsion scatter**, all applied to the light before the film records it.
2. **Develop the negative:** density curves, then DIR couplers (colour
   separation), then **grain, added to the negative's density**.
3. **Print:** enlarger filters (Y/M), print exposure, preflash, optional
   enlarger diffusion, then the paper's density curves (which can be "morphed":
   contrast, contrast of fast/slow layers, per-channel contrast, developer
   exhaustion).
4. **Scan:** the print (or, for slide film, the film itself) to RGB, then
   scanner blur and unsharp mask, with optional auto black/white levels.

Per-stock data it has: measured curves and dyes; a default print paper; whether
the stock is **still or cine** (base thickness, so halation spread: 65 µm still,
50 µm cine); and the **anti-halation layer: strong, weak or none** (halation
strength). It ships 28 profiles: 20 camera films (including Vision3 cine stocks,
slide films, and Portra 800 pushed one and two stops) and 8 print papers or print
films.

## 4. Grain: theirs versus ours

| | spektrafilm | HDR Finisher today |
|---|---|---|
| What is drawn | A random count of developed grains per pixel (statistics only), then a blur and a "clumping" texture | Real grains with sizes and positions, overlapping as on film |
| Where it happens | In the negative's density, before printing | At the very end, on the finished picture |
| Layers | 3 colour layers, each split into fast/mid/slow sub-layers with coarse, medium and fine grains | 3 colour layers (or 1 for black and white), one size each |
| Tone behaviour | Comes from the physics: thin negative = few grains, and the print curve then shapes what is visible | Shaped by hand with the Shadow, Midtone and Highlight Response sliders |
| Per-stock grain | **None.** Every stock uses the same grain settings (the code has a to-do note for per-stock granularity) | None |
| Resolution | Scales with film format and image size | Scales with film format and image size |
| GPU and export match | Not a goal (CPU, random) | Exact; strips match whole frames |

**Verdict:** our grain renderer is better and should stay: it draws real grain
shapes, runs on the GPU, and matches export exactly. Spektrafilm is better on
**where** the grain goes and **which grains respond to which tones**. We take
these two ideas from it:

1. **Add grain to the negative's density, before the print.** Then the print
   paper's contrast decides how visible it is in each tone, as on real film,
   and the Response sliders become small trims (default 100%) rather than the
   main shaping tool.
2. **Fast/slow sub-layers:** coarse grains carry the shadows of the scene and
   fine grains the highlights. This is why real film looks grainier in the
   shadows. We can approximate it with one grain size that changes with
   exposure (cheap) or with true sub-layers (about 3x the grain cost on the GPU).
   Start with the cheap version.

**Grain per stock** cannot come from spektrafilm's code. It has to come from
the manufacturers' data sheets (Kodak publishes a Print Grain Index, Fujifilm
an RMS granularity). Phase 4 turns them into default Grain Size and Amount for
each stock. The Phase 4 brief authorizes explicit, sourced estimates where
manufacturer data cannot establish a value; label each as PRD section 5 requires.

Collected October 15, 2026 (sheets kept outside the repo in
`HDR Finisher Tool/film-datasheets`). Kodak Print Grain Index, 35mm at
4x6 / 8x10 / 16x20; 25 is the visibility threshold, and 4 points is one
just-noticeable step:

| Stock | 4x6 | 8x10 | 16x20 |
|---|---|---|---|
| Ektar 100 | under 25 | 38 | 66 |
| Portra 160 | 28 | 50 | |
| Portra 400 | 37 | 59 | 89 |
| Gold 200 | 44 | 64 | |
| Ultramax 400 | 46 | | |
| Portra 800 | 48 | 70 | |

The 4x6 to 8x10 step (twice the enlargement) adds about 21 to 22 points for
every stock, which also calibrates how grain should grow with Film Format.
Fujifilm's negatives (C200, Superia X-tra 400, Pro 400H) all read RMS 4, so they
cannot be ranked from their sheets; place them by ISO next to their Kodak
counterparts. Vision3 sheets have per-layer granularity curves across the
tonal range, which can also check the shadow-to-highlight grain behaviour.

## 5. The new panel

The approved Phase 6 panel supersedes this plan's original placement proposal:
Looks use the shared Preset button and Adjustment Presets dialog. Look Strength
and the Film stock card sit above five folding stages: Camera, Negative,
Development, Print and Scan. Camera includes Format, Capture, custom dimensions,
Film Exposure and Lens. Negative starts open; the others start folded. Output
is a final note, and SDR Match HDR sits at the top. Fixed Format/Lens/Print/Scan
shortcuts stay inside their stages. See the Phase 6 brief for current behavior.

The following table preserves the original planning proposal for context:

| Stage | Controls |
|---|---|
| **Lens** | Film Format (moves here: it sets the scale of everything below), Diffusion Filter type, Filter Strength, Filter Size |
| **Negative** | Stock, Stock Color, Stock Tone, Film Exposure, Color Separation, Halation (Amount, Spread, map), Resolution, Grain (Amount, Size, Softness, Chroma, Film Type, Response trims, map) |
| **Development** | Push/Pull |
| **Print** | Paper, Print Exposure, Print Warmth, Print Tint, Preflash, Print Contrast, Shadow Contrast, Highlight Contrast |
| **Scan** | Scan sharpening, Lab levels (auto black and white) |
| **Output** | HDR highlight handling (today's behaviour, made visible), the "Match HDR film look" action for SDR |

"None" in the Stock menu becomes **Neutral**: a plain stock with a straight
response, so every control still works without a real stock. This replaces the
old hand-built Film Response curve.

## 6. Every control, old and new

| Today | Verdict | Why / where it goes |
|---|---|---|
| Look Strength | Keep | Master mix, top of the panel |
| Stock | Keep, moves to Negative | Adds more stocks (see Phase 1); "None" becomes Neutral |
| Stock Color, Stock Tone | Keep | Our own idea: borrow only a stock's colour or only its tone. Spektrafilm has no equivalent |
| Film Exposure | Keep | Same as spektrafilm's camera exposure |
| Color Separation | Keep | Spektrafilm's DIR coupler amount |
| Preflash | Keep, moves to Print | Same as spektrafilm |
| Print Warmth, Print Tint | Keep, moves to Print | Spektrafilm's enlarger Y/M filters |
| Print Strength | **Remove** | Its curve is replaced by the paper's own curve |
| Print Contrast | **Replace** | Becomes paper contrast (spektrafilm's print gamma), and works on its own |
| Toe, Shoulder | **Replace** | Become Shadow Contrast and Highlight Contrast (spektrafilm's fast/slow layer gamma, plus developer exhaustion for a softer shoulder) |
| Color Density | **Remove** | Same job as Color Separation |
| Red, Green, Blue Response | **Remove** | Covered by Print Warmth/Tint. Per-channel paper contrast could come back as an advanced option later |
| Highlight, Shadow Desaturation | **Remove from Film Look** (Steve, D1, October 15, 2026) | Real stocks lose colour in their shoulder and toe already. Steve wants them back later as general controls in the main Color section, not Film Look; recorded in `Open_Items.md` (COLOR-DESAT-01) |
| Halation Amount | Keep | Scales the stock's own halation strength |
| Halation Physical Extent | Keep, renamed Spread | Scales the stock's own spread (still 65 µm, cine 50 µm) |
| Halation Sensitivity | **Remove** | It was needed because the glow was added after the curve. Before the curve, only bright light halates visibly |
| Halation Hue Offset, Saturation | **Keep** (Steve, D2, October 15, 2026; Filmbox offers both) | The stock sets the glow's own colour (red nearest the base); Hue Offset and Saturation adjust around it. At 0 offset the glow keeps the stock's colour |
| Show halation map | Keep | |
| Bloom Amount, Sensitivity, Optical Spread, Highlight Detail | **Replace** | Becomes a real lens filter: type (Black Pro-Mist, Pro-Mist, Glimmerglass, CineBloom), Strength in filter grades (1/8 to 2), Size. Applied before the film, so the curve shapes the glow |
| Film Resolution | Keep, moves earlier | Becomes in-emulsion scatter, before the negative curve, as in spektrafilm. Then it softens the image but not the grain |
| Grain Amount, Size | Keep | Defaults come from the stock |
| Grain Softness, Chroma, Film Type | Keep | Spektrafilm has no B&W stocks; our B&W grain stays our own |
| Grain Film Format, Capture Geometry, custom size | Keep, moves to Lens | Already shared by grain, halation and resolution |
| Grain Shadow, Midtone, Highlight Response | Keep as trims | Default 100%; physics does the main shaping (section 4) |
| Show grain map | Keep | |
| `reference_model` (hidden field) | **Remove** | Saved with every project but read by nothing |
| — | **New:** Paper | Each stock's default paper, plus the others (Portra Endura, Endura Premier, Supra, Ultra, Ektacolor Edge, Crystal Archive II, and cine print films 2383 and 2393) |
| — | **New:** Print Exposure | Brighter or darker print, separate from Film Exposure; they look different |
| — | **New:** Push/Pull | Development contrast and grain. Real data exists only for Portra 800 (+1, +2); for other stocks it is a contrast change, labelled as approximate |
| — | **New:** Scan sharpening, Lab levels | Spektrafilm's scanner unsharp mask and auto black/white |

### What spektrafilm does not have and we should

- **HDR output.** Spektrafilm ends at paper white. Our highlight handling above
  paper white stays, and gets its own place in Output.
- **Per-stock grain** (from data sheets, section 4).
- **Black and white.** It has the code but no B&W stocks. We keep our B&W grain,
  and B&W stocks can be added later if good data turns up.
- **Partial stock mixes** (Stock Color / Stock Tone).
- **Exact GPU preview matching the export.**

### Left out on purpose

- Spektrafilm's spectral and colour-space settings: these are baked into our tables.
- Print glare texture: its average is already baked in, and the texture is not visible.
- Gate weave, flicker (Filmbox): video only.
- Negative-only and Print-only modes (Filmbox): Print Warmth, Tint and Exposure
  already do the "grade between negative and print" job.
- Bleach bypass: not in spektrafilm. Possible later.

## 7. Presets in three layers

1. **Stock character.** Choosing a stock sets its colour and tone, plus its
   defaults for: halation (from still/cine and the anti-halation layer), grain
   Amount and Size (from data sheets), and its default paper.
2. **Stage presets.** A small menu on each stage that changes only that stage
   (Lens: "Light diffusion"; Grain: "16mm"; Print: "Warm print").
3. **Looks.** A complete recipe: stock, paper, and every stage.

**The rule:** each control remembers whether it is still "from the stock" or was
**set** by the user (by hand or by a stage preset). Changing the stock updates
only controls still "from the stock". A set control shows a small dot, and
clicking the dot returns it to the stock's value.

**Looks store only what differs from the stock.** A Look saves its stock, paper
and the controls it deliberately sets. Everything else stays "from the stock",
so swapping the stock inside a Look still behaves sensibly.

The four current Looks (Clean Cinema, Soft Color Negative, Dense Print,
High-Speed Texture) are rebuilt on real stocks and papers.

## 8. Phases

Each phase is its own small set of commits. Heavy coding goes to Codex with a
brief; the panel mock-up is done here first.

Old projects: Steve has said (October 15, 2026) they do not matter for this
rebuild. No migration and no affected-project check.

**Phase 1: Data.** Re-bake every stock spektrafilm has (Vision3 50D, 250D, 200T,
500T; Ultramax 400; Fujifilm C200 and Superia X-tra 400; Portra 800 pushed one
and two stops; slide films Velvia, Provia, Ektachrome, Kodachrome), with each
stock's tags (still/cine, anti-halation, type, default paper). Bake film x paper
print tables. Today's files are 2.3 MB of JSON each; switch to a compact binary
format, or the paper choice grows the app by tens of MB. Slide films need the
"scan the film directly" path instead of print plus scan.

**Phase 2: Reorder the chain** (CPU export and GPU together). New order: lens
diffusion -> resolution scatter -> halation -> negative (curves, couplers) ->
grain in density -> print -> scan -> output. This is the biggest and riskiest
phase, and it is in the "still strict" area (CPU export is the reference).

Phase 2 implementation, October 15, 2026:

- CPU and Direct/Tiled WebGPU follow this order together. Print and scan have
  separate runtime functions; slides bypass print even with density grain.
- Existing bloom/diffusion and resolution filters are reused before exposure
  curves. Filter redesign and controls remain for later phases.
- The deterministic grain field becomes a base-10 density delta before print,
  using its existing development, response, size and amount rules. Neutral
  uses the equivalent straight transmission response. No grain calibration or
  new sub-layer model is introduced.
- A clean grey reference anchors Stock Tone; its grained counterpart carries
  density variation through partial Stock Tone/Color settings without cancelling
  the grain. Above reference white the existing fixed stock gain preserves HDR
  highlight ratios.
- Look Strength mixes the completed module once. Signed stock colour is retained
  until this mix, then the existing lane boundary clips it. Detail structure is
  independent, after the mix; vignette and output follow. Diagnostic maps bypass
  the film and Detail structure. Neutral/off Film Look remains a true bypass.
- Export resizing and sharpening operate on the completed scan, including grain,
  before the output limiter; Proof shares that export renderer. Existing recipes
  can change appearance. No old-order compatibility path is retained.
- WebGPU reuses its existing textures and parameter layout. Sequential spatial
  filters need summed tile support rather than the old maximum. Individual blur
  caps, stock table limits and parity tolerances are unchanged; the composed halo
  grows to cover the actual reads. Steve should judge responsiveness in the app.
- Paper selection, shipping stock/paper combinations, legacy response controls
  and the six original stock data files remain unchanged. Phase 3 owns the new
  development/print/scan controls and removal of the legacy response controls.

Validation: Node 483 passed; full Python suite 2091 passed / 3 skipped; final
focused CPU/contract checks 433 passed; Proof/export group 85 passed. WebGPU
stock parity passed all 32 cases and grain parity all 10 cases at their existing
tolerances. Direct/Tiled parity was byte-exact at 256/512 tile sizes, including
maximum spatial effects and negative/slide grain. The tiled driver's default
fixture path still expects the removed "Load test pattern" button; validation
used its supported `--input` path with a generated HDR test image. No installer,
push, broad driver sweep or performance claim is part of this phase.

During development, assertions pinning the previous order were updated to the
new order. An SDR partial-strength GPU mismatch exposed clipping of signed
stock colour before the mix; retaining it until the CPU's final boundary fixed
the mismatch without changing tables or tolerances. No final rendering check
failed.

**Phase 3: Development, print, scan and halation controls.** Paper picker,
Print Exposure, paper contrast controls (on the paper curve, which is already
applied at run time and so is cheap), Push/Pull, scan sharpening and levels.
Remove Film Response, Color Density, Channel Response and the desaturation
sliders. Halation: remove Sensitivity; keep Hue Offset and Saturation. Brief: `docs/technical/archive/briefs/codex-brief-film-look-phase-3-controls-2026-10-15.md`.

Phase 3 continuation, October 15, 2026: the Fit grain decision is implemented.
Reduced GPU Direct/Tiled and CPU fallback integrate the native density grain;
export, Proof and native 100% retain their original field. The fixed pass/fail
check covers flat grey and all four patch interiors, actual automatic Fit,
half size, native, 35mm/Super 8 and SDR/HDR. All 180 comparisons pass; see PRD
section 5.3 for scope, tolerance, approximation and performance limits. Existing
ten-case grain parity and both fast suites pass. Development/Print/Scan controls
and Halation cleanup are still missing, so Phase 3 is not finished; Phase 3b
has not begun. Continue those before stock character (Phase 4).

Spatial reach follow-up (calculated workload, not a timing benchmark): at a
6000 x 4000 frame, 35mm, maximum Bloom radius 10 and Halation radius 5, Resolution
0, with Detail neutral, the current planner requires a 544-pixel halo per side
(128 quarter-resolution blur texels plus extraction/direct reads). Compared
with the previous maximum-of-reaches rule's 284-pixel halo, an interior 512 x
512 tile processes 1600 x 1600 instead of 1080 x 1080 pixels, about 2.19 times
the padded area. A single 1600 x 900 viewport rectangle similarly needs 2688 x
1988 instead of 2168 x 1468, about 1.68 times the padded area; actual viewport
tiling, clipping at image edges and caching affect the real cost. The whole
frame path does not acquire padding. No latency was measured or claimed;
Steve should try maximum effects while zooming and panning in the app.

Validation of these diagnostic/record changes: Node 483 passed; Python 2094
passed / 3 skipped; diagnostic JavaScript/Python syntax checks passed. Sequential
Electron grain-size comparisons ran at 2560x1440 in disposable profiles, on
generated media only. The normal/reduced Fit versus downsized-export diagnostic
reports the mismatch above; native comparison passed its observational parity
check. The spectral probe completed against the verified pinned revision. An
initial probe setup imported the app's Pydantic model in the bake environment,
which does not include Pydantic; using a simple neutral parameter object removed
that unnecessary dependency. No rendering test or pinned tolerance was altered.
Film-stock/grain parity drivers and the additional Proof/export group were not
rerun: implementation stopped before any renderer changes. No installer or push.

Phase 3 continuation, October 16, 2026: shared paper/scanner preparation
is in `efec862`, control wiring and Neutral in `7db66fc`, Steve-approved physical
replacement checks in `059d3e9`, and Neutral HDR colour precision in `4bd62b5`.
The fresh Fit-grain acceptance run passes all 180 comparisons. Final expanded
stock checks and full Python checks are running. Steve conditionally authorised
the limited final-film alpha scale only if a safe cap failed. Readback proved
that the old preview clips at 65,504 (no infinity or NaNs). The simple cap fails
after HDR compression: added mean error 61.517 levels and p99.9 182, against
unchanged limits 0.1 and 2. The selected scale plus float32 highlight-anchor
reduction passes the extreme fixture at added mean about 0.040 and p99.9 2;
rare boundary pixels still differ by up to 196 levels. CPU export is unchanged.
The original pinned reduction source remains byte-identical; the scaled film
uses a separate compute entry point. New Neutral range Direct/Tiled cases,
with Scan and Detail, are byte-identical at tile sizes 256 and 512. The same
driver reports two Black & White-only failures on the extreme fixture; these
inactive-final-storage cases are recorded without investigation. PRD section
5.3 records choices and checks. Phase 3 acceptance remains pending the running
checks; do not start Phase 3b or Phase 4 from a work-in-progress commit.

**Phase 3b: Lens filter.** Replace Bloom & Diffusion with the lens diffusion
filter (type, Strength in filter grades, Size), as in section 6. Separate thread
after Phase 3.

**Phase 4: Stock character.** Collect grain data from data sheets; set grain,
halation and paper defaults per stock; add the "from the stock / set" tracking
and the dot.

**Phase 5: Presets.** Stage preset menus; rebuild the four Looks; add Looks for
the new stocks (for example, Vision3 500T on 2383).

**Phase 6: Panel.** Mock-up first (Looks strip, the six stages folding open,
the dots), then build. Update the controls reference and the spektrafilm credit.

## 9. Risks

- **Speed.** Grain and the spatial effects move inside the film chain. Grain
  must then run between the negative and print lookups in the GPU pass, or the
  negative density must be stored in an extra buffer. Both cost something; to
  be measured in Phase 2, and judged by Steve using the app.
- **Look changes.** Moving halation, diffusion and resolution before the curve
  changes how every existing setting looks, not just the removed ones.
- **HDR.** Effects applied before the stock must keep the current behaviour above
  reference white. The film-stock parity check must cover HDR highlights.
- **App size.** Film x paper tables (Phase 1).
- **Push/Pull honesty.** Only Portra 800 has measured pushed data.

## 10. Testing

As `ai/AGENTS.md` sets out. Fast checks for every change. Phase 2 touches CPU
export and pinned shaders, so it gets every check that covers Film Look:
`film-stock-parity.js`, the grain parity checks, and the Film Look
halation/bloom/resolution parity checks, run once per group of commits. A full
sweep happens only before merging to `main`. If a phase's checks look like more
than about 30 minutes, stop and ask Steve first.

## 11. Open decisions for Steve (one at a time, when we reach them)

- **D1** Decided October 15, 2026: remove Highlight/Shadow Desaturation from
  Film Look; later, add them to the main Color section (`Open_Items.md`,
  COLOR-DESAT-01).
- **D2** Decided October 15, 2026: keep halation Hue Offset and Saturation
  (Filmbox has both).
- **D3** How many stocks and papers to ship (sets app size; Phase 1).
- **D4** Grain sub-layers: the cheap approximation, or true sub-layers at about
  3x the grain cost?


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


Phase 3b implementation choices (before measurement): Size spans 0.25 to 4,
default 1, because upstream supplies no UI bounds. Alternative: an unbounded
scale; the finite range is reversible. Use upstream's actual three-Gaussian
approximation of each radial exponential, retaining all 27 components and the
family's per-channel halo redistribution. Keep existing spatial textures and
blur/reach ceilings; truncate and renormalize the combined PSF inside them,
identically for CPU export/Proof and GPU. Record omitted energy against the
uncapped upstream mixture. This changes the new lens model only.
Source agreement tolerance: 2e-9 for mixture coefficients; CPU constant-field
energy within 1e-6 (float32 rounding); existing preview/export pixel and exact
Direct/Tiled requirements stay unchanged. Timing comparison uses 5% allowance
for run variation; above that report the cost, without changing a budget.

Implementation refinement: normalize each capped Gaussian component separately,
rather than normalize the cropped combined PSF. This retains each family's
core/halo/bloom energy shares and per-channel warmth. The alternative would
reduce the relative weight of broad components as the cap cuts off their tails.
Rounded upstream Gaussian amplitudes sum to 0.9999; divide by that sum so the
new filter is exactly energy-conserving. Upstream uses a fast recursive Gaussian
for large sigmas; use the bounded explicit Gaussian kernel as the CPU/Proof
reference here, with clamped picture edges matching the existing preview.


Phase 3b cap measurement (model preparation): for a 6000x4000 source and
1520x1013 Fit, the table gives the percentage of scattered PSF energy outside
the existing capped square, BEFORE per-component renormalization. Ranges are
across RGB channels. These are continuous Gaussian-surrogate tail integrals
relative to upstream's three-sigma support, not an exact exponential integral.
The filter redistributes this clipped component energy inside the cap, so it
does not darken a flat field. The widest small-format filters are substantially
shorter than upstream's uncapped filters; no blur cap is raised.

| Filter / format | Native Size .25 | Native Size 4 | Fit Size .25 | Fit Size 4 |
|---|---:|---:|---:|---:|
| glimmerglass / 35mm | 0.00% | 3.39% | 0.00% | 3.47% |
| glimmerglass / super8 | 0.59% | 27.31% | 0.60% | 27.58% |
| black_pro_mist / 35mm | 0.00% | 6.27-16.03% | 0.00% | 6.40-16.36% |
| black_pro_mist / super8 | 1.18-1.77% | 48.15-58.51% | 1.22-1.84% | 48.56-58.78% |
| pro_mist / 35mm | 0.21% | 27.63-36.26% | 0.22% | 27.92-36.63% |
| pro_mist / super8 | 9.87-11.60% | 66.99-70.43% | 10.04-11.85% | 67.21-70.60% |
| cinebloom / 35mm | 2.08% | 45.39-58.36% | 2.15% | 45.66-58.67% |
| cinebloom / super8 | 26.25-31.13% | 77.94-81.04% | 26.52-31.53% | 78.13-81.16% |


Phase 3b model preparation commit: added the independent CPU kernel/FFT model,
matching preview coefficient table, pinned-upstream goldens and GPL credit.
Fast checks pass: all 483 existing Node checks plus two new lens checks; all
2,150 Python checks plus the added upstream-golden check (19 lens checks total),
three skips. No renderer uses this model yet, so GPU coverage belongs to the
integration commit. No removed behavior or tests in this preparation commit.


Phase 3b focused driver preparation: added physical lens preview/export and
exact Direct/Tiled drivers, covering 128 cases each (four families, two Strengths,
two Sizes, two formats, SDR/HDR, Fit/native). The first preview/export matrix
passed all 128. Tile pixels now pass all 128 after correcting the integration's
normalized-coordinate lens interpolation and its one-texel read support; the
blur caps remain 64 individual / 128 composed quarter texels. A missing lens
script in the Library iframe produced startup errors despite valid main-view
pixels; adding that import passes the focused startup/worst-CineBloom smoke.
The final preview/export matrix is checking the corrected interpolation.
No tolerance or budget change. Fast checks on the integration: 486 Node and
2,158 Python pass, three Python skips; final library-import run is in progress.
The warmed timing/photo option uses the same lens driver, not a broad sweep.


Phase 3b integration decisions: None is a true bypass; commercial Strength is
continuous 1/8-2, default 1/2; Size is 0.25-4, default 1. Lens channel weights
operate in each lane's existing linear working RGB (ACEScg HDR, sRGB SDR),
matching the port's pipeline context; a common extra colour-space conversion
is the alternative, not added here. No Phase 4 stock defaults or Phase 5 Looks
are invented. Preset schema becomes 5 and simply drops retired Bloom fields.
Recommend considering halo warmth later: it would let Steve adjust coloured
fringes without changing overall diffusion, after judging these fixed family
shapes in the app. Separate group sizes/strengths would add substantially more
controls and are deferred.

Intentionally replaced checks: removed the retired Bloom Sensitivity/Spread,
Highlight Detail and hard-edge dark-echo tests; physical film-plane format,
monotonic edge, energy, source coefficients, pipeline ordering and five removed
field rejections replace them. The former output-relative format-invariance
check now requires physical format dependence. Shader positions still total
198 with removed slots reserved; numeric caps, budgets, all export/Proof and
preview agreement tolerances stay pinned. Preset-version and cache-schema
snapshots reflect the requested schema. Match's calibrated 6% Bloom setting is
removed, with no invented conversion to a filter grade. All its original
quality/editability/GPU-certification assertions stay; new tests check exact
lens recipe copying and safe rejection of the Black Pro-Mist 1/2 coloured target
that exceeds the existing Match colour gate. See known-limitations.md.

The existing Library worker pause request can log HTTP 422 for reason
"grade-control" (accepted reasons are grading/export/manual). This is outside
Film Look and is recorded without investigation. The missing Library lens
script import was part of this change and has been fixed.


Phase 3b renderer integration validation: final corrected lens preview/export
matrix passes 128/128 at the unchanged added mean 0.1 / p99.9 2 level limits
(worst added mean 0.070, p99.9 2). Direct/Tiled pixels pass 128/128 byte-exact;
the Library import correction also passes the focused startup/native worst-lens
smoke. Final fast checks pass: 486 Node, 2,158 Python, three Python skips,
including CPU export/Proof identity. The first matrix's native tile differences
were fixed, not waived. No new renderer failure remains; the separate recorded
HDR range, Black & White tile and worker-warning limitations remain. CPU FFT
blocks bound temporary memory independently of export dimensions. GPU scratch
reuse adds no image allocation; lens uses 55 quarter-grid passes when active,
None bypasses them. Photo inspection and warmed timing follow in the final
completion note. No push or installer.


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

Documentation completion commit: current user guides, pipeline notes and known
limitations updated. No renderer change after the final checks above; those
checks remain applicable. Two unrelated untracked Library briefs are untouched.


## Phase 4 completion (October 16, 2026)

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
[the Phase 5 brief](../../technical/archive/briefs/codex-brief-film-look-phase-5-presets-2026-10-16.md#phase-5-implementation-record-october-16-2026).
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
