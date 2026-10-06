# Preview performance harness

Run the app, install the browser-test dependency with `npm install`, then run:

```powershell
npm run test:performance -- --url http://127.0.0.1:8000
```

The default matrix covers deterministic EXR and TIFF fixtures in fast, high-quality, and forced no-WebGPU modes with 30 timed adjustment repetitions followed by 100 settled changes for memory/cache stability. Add a local Apple HDR HEIC without committing it:

```powershell
npm run test:performance -- --inputs tests/fixtures/blender_linear_rec2020.exr,tests/fixtures/hdr_headroom.tiff,local-test-media/inputs/IMG_4109.HEIC
```

Reports are written to `output/performance/preview-performance.json`. Use `--enforce` only on the named benchmark workstation; other machines should retain the report for relative comparison.

## GPU local-adjustment sprint

The Luma opacity/feather and live-scope benchmark records isolated changes,
30-event rapid drags (including opacity direction reversals), presentation-order
guards, mask request counts, CPU mask time, transport, scheduler
queue delay, GPU submission/presentation, optional GPU timestamp queries, scope
freshness/content fingerprints, draft-local scope payloads, stale cancellation,
browser, adapter, fixture, and active resolutions:

```powershell
npm run test:gpu-local-adjustments -- --url http://127.0.0.1:8000 --phase phase0
npm run test:gpu-local-adjustments -- --url http://127.0.0.1:8000 --phase phase1
npm run test:gpu-local-adjustments -- --url http://127.0.0.1:8000 --phase phase2-final
node tools/playwright_gpu_parity.js test-pattern output/performance/gpu-local-phase2-parity --local-luma-only
```

Generated JSON is written below `output/performance/`. Durable conclusions and
the exact percentile method belong in local maintainer QA notes.

## Viewport-Bounded GPU Preview

Plan and limits: `docs/product/Viewport_Bounded_GPU_Preview_PRD_2026-10-01.md`.
Every driver opens projects in a disposable session and never saves them. Run
Electron drivers one at a time with `HDR_FINISHER_ELECTRON_WINDOW_SIZE=2560x1440`.

Preview versus export (PRD 4.6). Captures the preview at 100% for three regions
per lane, renders the same edit document through the export pipeline before
encoding, and reports the section 4.1-4.3 statistics. `--enforce` exits
non-zero when an approved limit is exceeded; `--set path=value,...` applies
in-session edits to isolate a module:

`--match` runs GPU Match before `--set` edits. `--sdr-darkening-check` with
`--match --lanes sdr` disables the existing locals' SDR grades and adds a
neutral full-coverage -1 EV local in the disposable session. The reference
records above-white Detail/local stage counts in the captured regions, and
the driver requires actual highlight recovery. This is a controlled clipping
regression case, not the project's saved local configuration. See
[native matched-SDR evidence](../../../docs/technical/archive/viewport-phase3-matched-sdr-native-evidence-2026-10-02.md).

```powershell
node tests/run-in-electron.js tests/performance/preview-export-compare.js `
  --project <file.hdrfinisher> --output output/performance/review/<run>/compare.json
```

Limitations to keep in mind when reading its report:

- The fixtures choose the tiled route at native zoom and are captured on that
  route. If another project chooses Direct, picture readback requires a tiled
  capture; the app's choice and the capture route are both recorded.
- The preview side of a mask is a readback from the renderer
  (`readLocalMaskRegion`): the value each local pass sampled for the frame on
  screen, before opacity, drawn through the same shader function the local
  passes use. It covers masks from the backend and masks made on the GPU, and
  is taken on the route the app chose (`chosenRouteMasks`) as well as on the
  tiled route. The value is unrounded and the export's mask is 8-bit, so the
  reported difference can include up to half a level of the export's rounding.
  A mask that could not be read back fails the mask verdict.
- An 8-bit presentation target cannot represent less than one level, which
  near black is several percent of luminance. On such a target (the format
  names itself `8unorm`) a pixel whose largest channel difference from the
  export is at most one level of the preview's display encoding does not count
  against the tone limits (PRD 4.1). It stays in the population as a pixel
  inside the limits. `median`, `p99` and `max` remain what was measured;
  `judged` and the verdicts are what counts, and `eightBitRule` says how many
  pixels the rule covered. A float target is judged as written.

Full-size Proof versus export on a real project (PRD section 3), by file hash:

```powershell
.venv\Scripts\python.exe tests\performance\proof_export_identity.py `
  --project <file.hdrfinisher> --out output/performance/review/<run>/proof-identity.json
```

Section 6 baseline. `zoom-after-edit-review.js` covers zoom after a mask edit,
`heavy-project-long-session.js --fresh-work --minutes 5 --idle-minutes 0`
covers strokes, feather release, slider drags, pan and Match,
`raw-import-baseline.js` covers the wait after import, and
`summarize-viewport-baseline.js --out <summary.json> <reports...>` reduces them
to counts, medians, p95 and maxima.

Soft masks (PRD 5.1). `soft_mask_fuzz.py` compiles random brush, gradient and
path masks exactly and as the small bitmap the renderer stretches, and records
the true difference beside the backend's verdict; the rule in
`backend/hdr_finisher/mask_softness.py` was calibrated on it and
`tests/test_mask_softness.py` runs a small version. `soft_mask_survey.py` does
the same for the masks of a real project:

```powershell
.venv\Scripts\python.exe tests\performance\soft_mask_fuzz.py `
  --out output/performance/review/<run>/soft-mask-fuzz.json --count 60 --seed 11
```

Fixtures. `make_four_mask_fixture.py` builds the owner's four-mask case from a
RAW (and `--locals 50` the scaling case) under the git-ignored
`local-test-media/viewport/`. `peak-readout-review.js` records what the scope
panel reports as Peak at Fit and 100% with the peak option off and on.

Phase 2 keeps the owner's 1% peak limit. The panel reports a bounded estimate
in both checkbox states; the historical driver/API names remain for baseline
comparison. `tests/editing-peak-bounded.js` checks maximum peaks and robust
anchors for both lanes: no whole source above a 1,600 edge, no source-patch
budget above four million pixels, and no mask bitmap above that pixel budget.
It also checks that measurement leaves the accepted picture and its resources
alone. An optional `--reference-nits` enforces the 1% HDR peak limit against an
independently measured CPU reference:

```powershell
node tests/run-in-electron.js tests/editing-peak-bounded.js `
  --project <file.hdrfinisher> --reference-nits <exact-peak> --output <report.json>
```

When Clarity's reach puts the measurement patches over that budget, the
measurement reads Clarity's maps from one reduced render of the frame instead
of each patch's own halo (P3-PEAK-01). `editing-peak-clarity-reference.js`
checks that against the patches' own full-size maps, measured in groups that
each fit the budget, patch by patch (limit 0.5%). The reference needs one patch
to fit with its full halo, so above about 2% radius on a 42 MP frame the check
is `preview-export-compare.js` against the export:

```powershell
node tests/run-in-electron.js tests/performance/editing-peak-clarity-reference.js `
  --project <file.hdrfinisher> --set hdr.detail.clarity_amount=100,hdr.detail.clarity_radius_percent=1.5 `
  --output <report.json>
```

Export/Proof warnings are checked by `tests/test_peak_accuracy.py` and
`tests/test_proof_export_identity.py`, including cached Proof requests with
different estimates. Full-size Proof keeps encoded export identity; reduced
Proof does not compare its smaller rendition against a native editing estimate.

Phase 3's Sharpen filter regression compares the actual GPU kernel against
export's CPU three-box blur, including small-image boundaries and radius
transitions, in both lanes:

```powershell
node tests/run-in-electron.js tests/sharpen-blur-reference.js `
  --output <report.json>
```

This synthetic filter check does not replace `preview-export-compare.js` or
its unchanged picture tolerances. The primary as-saved repair, remaining
four-mask outliers and three alternating timing pairs are recorded in
[phase 3 Detail evidence](../../../docs/technical/archive/viewport-phase3-detail-evidence-2026-10-02.md).

`tests/neutral-color-grading-reference.js`, through the same Electron wrapper,
is a tiny CPU/GPU regression for signed near-black colours, neutral wheel
identity and active grading. It opens no project. The follow-up evidence
records a single HDR-centre fixture comparison resolving the two outliers.

`tests/mask-raster-reference.js`, through the Electron wrapper, checks GPU
path/brush tiles against CPU masks, including a native-coordinate hard-edge
regression and exact Bezier vertices. It opens no project. The first tile
implementation and one enforced fixture capture are recorded in
[phase 3 mask evidence](../../../docs/technical/archive/viewport-phase3-mask-evidence-2026-10-02.md).

`tests/luma-region-reference.js` checks aligned source regions against the
existing whole-source GPU luminance mask for narrow/reduced feather and
inversion. It opens no project. Follow it with a chosen-route picture capture
and the bounded-peak check when changing the source/measurement contracts.
`tests/luma-region-routing.test.js` (Node) checks which lane/working-space
regions may supply that mask: HDR, and SDR only when its source is the ACEScg
scene picture.

`tests/local-grade-reference.js` checks production local parameters and the
actual local shader against CPU export for curves, wheels and opacity in both
lanes. `tests/performance/phase3-local-route-smoke.js` makes one local curves/
wheels edit and one native zoom in a disposable fixture session; it is a route
and timing observation, not an export comparison or long-session test.
`--lane sdr` runs it in the SDR lane; each action records analytic region/tile
texture counts and bytes, alongside how many backend
mask-tile requests it made. The `tiled-render` stage in its report carries
`encodeMs` beside `durationMs`; the difference is the wait for the GPU. See
[zoom transfer evidence](../../../docs/technical/archive/viewport-phase3-zoom-transfer-evidence-2026-10-02.md).

`tests/performance/match-candidate-review.js` presses Match once in a
disposable session and records the backend's stage timing, the recipe and
the CPU-measured quality. `--renderer gpu` (the app's default), `cpu`, or
`verify`, which renders every GPU candidate on the CPU as well and reports
the largest luminance difference; verify timings are not Match timings.
`tests/test_sdr_match_remote.py` covers the bridge and its CPU fallback with
a stand-in page. See [Match evidence](../../../docs/technical/archive/viewport-phase3-match-evidence-2026-10-02.md).

The local-route smoke also waits for an actual new settled GPU scope, checks
the loaded 512-edge GPU navigation overview, rejects a stale auxiliary render,
and asserts no CPU scope/navigation-preview requests during the two actions.
See [auxiliary-view evidence](../../../docs/technical/archive/viewport-phase3-auxiliary-evidence-2026-10-02.md)
for one-operation timings and their limits; these are not session medians.

`tests/mask-raster-reference.js --shared` checks one brush/path texture shared
across tiles through the local sampling shader against CPU masks, including
a native hard edge. `tests/luma-graph-region-reference.js` checks regional
union/intersect/subtract/nested masks against both CPU export and whole-source
GPU results with unequal leaf opacity and feathering. Both use the Electron
wrapper and compact synthetic sources, without opening a project.
`preview-export-compare.js --luma-graph` makes a disposable union of an existing
luminance local and path mask so native picture/mask comparison exercises the
regional graph route. It requires those two leaf types in the source project.
See [regional mask evidence](../../../docs/technical/archive/viewport-phase3-regional-mask-evidence-2026-10-02.md).

Adding `--orthogonal` to the shared shape reference expands it to 300 cases,
including all quarter-turn/flip combinations and their native hard-boundary
permutations, against CPU masks rasterized in source space then transformed.
`tests/sharpen-blur-reference.js --texture` compares the shared three-box
Texture kernel against CPU export using float32 intermediates; its default
mode checks Sharpen's half-float high/remainder packing. Native picture
comparisons separately cover Texture's production half-float channels.

`tests/performance/editing-peak-diagnostic.js --project <fixture> --set
hdr.detail.clarity_amount=100,hdr.detail.clarity_radius_percent=3 --output
<report>` forces the bounded Peak measurement on a disposable edit state and
records candidate patches, source halo, processing bound and refusal. It also
accepts `--without-locals` to isolate a global grade; `--set` paths must name
the actual document fields, such as `hdr.detail.sharpen_amount=200`. It does
not render a CPU export or save the fixture. See
[Texture/peak evidence](../../../docs/technical/archive/viewport-phase3-texture-peak-evidence-2026-10-02.md).

`tests/detail-control-reference.js` checks 80 compact global/local Detail
control cases in HDR/SDR with production half-float intermediates against CPU
`apply_detail`, before output colour conversion. `preview-export-compare.js
--local-set detail.texture_amount=100,opacity=0.35` modifies the existing path
local in the disposable session, in all requested lanes; `--local-type`
selects a different leaf type. Neither tool saves the fixture.

`phase3-local-route-smoke.js --zoom-sequence 100,150,50,200,100` records each
zoom after its queued pan/refinement work settles. Optional `--roi-parity`
at a 50% step captures whole-GPU and region-GPU outputs and evaluates the
approved picture metrics through the existing Python reference helper.
This same-scale A/B is not a CPU-export or cross-scale continuity sign-off.
See [Detail/zoom evidence](../../../docs/technical/archive/viewport-phase3-detail-zoom-evidence-2026-10-02.md).

`tests/gradient-transform-reference.js` checks shared GPU linear-gradient masks
under all quarter-turn/flip permutations, both source aspects, inversion and
two midpoint pairs against export's geometry-fixed masks. It opens no project.

`tests/luma-graph-region-reference.js --sdr-base` exercises the independent
HDR scene-region loader with deliberately different SDR picture pixels, then
compares its graph masks to CPU and whole-source GPU results. In the native
comparison, `--require-scene-region` asserts that a bounded native HDR region
and GPU scene-qualified masks were actually used, and `--match` fits SDR to
the HDR grade first. See
[SDR scene-mask evidence](../../../docs/technical/archive/viewport-phase3-sdr-scene-mask-evidence-2026-10-02.md).

`tests/neutral-color-grading-reference.js` includes signed HDR input through
the actual base pipeline as well as isolated grading. Run with the Electron
wrapper. `detail-precision-diagnostic.py --project <disposable capture> --x
<native x> --y <native y> --output <report>` stops the reference pipeline
before full-frame Detail and compares full precision, half rounding and early
clipping on a 129x129 native patch; it requires isolated Sharpen. It never
saves its input. `detail-band-probe.js` reads an already cached GPU Detail
texel at `--x/--y` after native zoom in a disposable session. These diagnostic
tools explain the signed HDR repair recorded in the Detail/zoom evidence.

`zoom-block-continuity.js --project <fixture> --output <report>` selects the
app's 100% and 50% tiled routes, reads bounded visible rectangles and compares
aligned blocks in display-linear light: 16x16 native pixels against 8x8
screen pixels at 50%. It requires DPR 1, one presentation pixel per screen
pixel and exact 2:1 dimensions, and waits for queued zoom/pan work, scopes and
highlight anchors. `--lanes hdr,sdr`, `--set <path=value,...>` and
`--without-locals` support unsaved isolation. The unchanged typical limits
apply to averaged blocks, without a pixel-wise eight-bit exemption. Raw
float readbacks and frame metadata stay beside the report; fixture hashes
are persisted even on failure. Run through the serialized Electron wrapper.
This is GPU cross-scale continuity, not CPU-export sign-off. See
[cross-scale evidence](../../../docs/technical/archive/viewport-phase3-zoom-continuity-evidence-2026-10-02.md).

`gradient-transform-reference.js` now covers 640 cases including Fan extremes,
rotations/flips, inversion and both source aspects. It compares CPU export's
masks to the shared regional GPU route and asserts identical Fit GPU coverage.
The native driver supports `--local-type linear_gradient --local-set
mask.gradient_fan=1 --require-gpu-gradient` for an unsaved picture/mask export
comparison that refuses CPU fallback. The nested regional graph fixture also
uses maximum negative Fan. See
[gradient Fan evidence](../../../docs/technical/archive/viewport-phase3-gradient-fan-evidence-2026-10-02.md).

`tests/brush-feather-reference.js` checks GPU painted-peak feathering against
CPU masks in 804 cases, including Shift Edge, random pressure/erase, orthogonal geometry,
index crops and large 1,024/1,600/3,200-pixel bitmaps. Run through the Electron
wrapper with `--output <report>`, then run
`.venv/Scripts/python.exe tests/performance/brush_feather_qualification.py <report>`
to add native three-times-scale qualification results. The fixtures are retained
for repeated inspection; `--qualification` runs this step automatically. The
actual GPU R16 texture is sampled where captured, rather than an ideal R8
bitmap. The six large cases have direct reference coverage
and are excluded from the native-scale fuzz. The production classifier's GPU
rounding allowance is used, with the existing three-level trial unchanged.

`gradient-transform-reference.js` now includes 320 index-crop gradient/hard
brush/path cases, for 960 total. `phase3-local-route-smoke.js --brush-stroke
--brush-feather --zoom-sequence 100,200` records picture/scope latency, CPU mask
requests, GPU bitmap admission and navigation/latest-scope guards. The stroke
is an unsaved scripted edit; it is not a trusted-pointer drag benchmark.
Final settlement now waits for pending/exact automatic-anchor work and the
render coordinator to drain. Each row also retains `firstSettlement` and
first-feedback events so a provisional current-generation picture cannot
silently stand in for the later replacement. This is observation only;
automatic-anchor routing and the accepted owner deferral remain unchanged.
`preview-export-compare.js --require-gpu-brush` additionally refuses a capture
whose first brush uses CPU fallback; unsupported/narrow masks can legitimately
fail that route assertion. Use the ordinary comparison to judge their pixels.

The October 3 [brush/crop evidence](../../../docs/technical/archive/viewport-phase3-brush-crop-evidence-2026-10-03.md)
and [exit audit](../../../docs/technical/archive/viewport-phase3-exit-audit-2026-10-03.md)
distinguish passing reference/native checks from unmet performance and GPU
coverage. Phase 3 remains open.

The [continuation evidence](../../../docs/technical/archive/viewport-phase3-continuation-evidence-2026-10-03.md)
records the six-box luminance repair, actual authored-SDR fixture, outer-path
forms, live Fan feedback and repeated costs. `preview-export-compare.js
--local-type path --local-set 'mask.feather_mode="outer_boundary",mask.feather=0.05'
--require-gpu-path --enforce` checks native GPU outer-path use and the existing
picture/mask/Peak limits. `brush-pack-benchmark.js --output <report>` isolates
byte packing in alternated repeated A/B runs. `heavy-project-long-session.js
--fresh-work --skip-match --minutes 0.5 --idle-minutes 0.5 --pan-lane hdr`
replays unique inputs with trusted native navigation clicks in a fresh session;
the default pan lane is SDR. It never saves the fixture. `--skip-match` only
omits the owner's accepted Match from that ordinary-edit replay; it changes
neither the product nor the driver's default Match coverage.

`heavy-project-long-session.js --budget-gb 0.75` applies a reduced GPU budget
only to that disposable session, after opening the fixture. It exercises
cache eviction and recovery without changing the owner's saved settings.
The driver now requires its final idle checkpoint to have a current ready
picture, no pending GPU/scope/anchor work, no page errors and no allocator
over-budget debt. Use a positive idle interval when testing eventual drain.

`heavy-project-drag-review.js --only mask_shift_edge --samples 3` covers Shift
Edge in both lanes; add `--native` for 100% rather than Fit. Zoom preparation
is excluded. These are trusted slider drags with current picture/scope
settlement, not a pixel-agreement or GPU-route assertion.
