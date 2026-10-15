# Film Look Rebuild Plan

- **Date:** October 15, 2026
- **Branch at planning time:** `film-stocks-phase-1` (after `597e5ac`)
- **Status:** Phase 1 data implemented October 15, 2026. Phases 2 to 6 remain planned. Decisions marked **Steve** are open. See Film Look PRD section 5.1 for shipped data and open paper choices.
- **Reference read:** spektrafilm at `3bb2c2d` (June 7, 2026), Filmbox's published workflow.
- **Requirements and data sources:** [Film Look PRD](Film_Look_PRD.md). Its
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
each stock. No values will be guessed.

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

Look Strength stays at the top, with the Looks browser. Then:

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
sliders. Halation: remove Sensitivity; keep Hue Offset and Saturation. Brief: `docs/technical/codex-brief-film-look-phase-3-controls-2026-10-15.md`.

Phase 3 pre-implementation checks, October 15, 2026: stopped at the brief's
explicit grain follow-up condition. At reduced Fit processing, normal 35mm
grain was visibly stronger than the downsized CPU export; native 100% agreed.
See PRD section 5.3 for recipe, measurements, limits and the reproducible
diagnostic. No Phase 3 controls, model fields, presets or renderer paths have
changed. Resolve the Fit grain decision, then finish Phase 3 before Phase 3b.

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
