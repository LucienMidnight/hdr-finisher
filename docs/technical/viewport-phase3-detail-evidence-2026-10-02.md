# Viewport-Bounded GPU Preview: phase 3 Detail investigation

Date: October 2, 2026. Phase 3 started on `viewport-bounded-preview-phase-2-wip`,
from clean commit `5d5ae6d64739fddc993452d0969588618a78eb39`. This is a staged
working record, not phase 3 closure. Phase 4 has not started.

## Remaining paths and proposed order

1. **Detail agreement.** Measure individual stages first, retain export as the
   reference, then repair preview within PRD section 4. Native crop must retain
   the source-pixel pitch of authored Sharpen radii.
2. **Masks.** Move brush/path rasterization and feathering to the GPU;
   complete GPU region luminance masks in both lanes. Preserve painted-peak
   normalization, hard edges, the trial gradual-mask limit and larger-bitmap
   fallback. Measure the primary brush after added strokes and 50-local cost.
3. **Control gaps and Match.** `gpuLocalSupported` in `webgpu-preview.js`
   rejects non-neutral local curves and colour grading wheels/balance/blending.
   Match's `_render_candidate` in `sdr_match.py` still calls the CPU renderer;
   semantic trials and later refinements depend on preceding results. Move
   candidate rendering/evaluation to the GPU without changing accepted quality
   gates or discarding dependencies between trials.
4. **Navigation and scopes.** `refreshNavigationThumbnail` in `app.js` waits
   for a settled picture, then posts a whole-image CPU preview request.
   `gpuScopeEligible` excludes tiled presentations, which sends magnified
   scopes to CPU rendering. Complete the GPU analysis route or ensure allowed
   idle CPU work cannot compete with a new edit. Report picture and scope
   timings separately.

Region rendering already exists. In `roiRegionFor`, a luminance mask still
disables HDR region-source fetching; `loadLocalMaskTiles` uses a GPU luminance
mask only with the whole HDR source resident, otherwise it reaches CPU tiles.
Feathered brushes that do not qualify as soft still reach the native CPU
fallback. These are verified code paths, not fresh timing measurements.

No dependency on the known failing inventory, brush/path interaction or tiled
admission/scope-fallback checks has been established by this first stage.

## Before changing either pixel implementation

Raw local/ignored artifacts:
`codebase/output/performance/review/viewport-phase3-2026-10-02/`.
All captures use `tests/run-in-electron.js`, disposable profiles,
2560 x 1440, DPR 1, serial drivers and the app's selected tiled route. The
primary fixture was never saved. Each completed driver confirms its SHA-256
is unchanged: `246ba308dcba22c5483c32ed4c31f5c81a2804504cd01dec2482b6d5be307d56`.
The sandboxed launch crashed the GPU process before opening a window; the
measurements ran with approved execution outside that tool sandbox.

`detail-as-saved.json`: one capture of three regions per lane, each containing
1,947,690 pixels. HDR uses `rgba16float`; SDR uses `bgra8unorm` and the approved
one-level exemption. All paired pixels, masks and bounded peak checks pass;
tone fails. HDR peak is 0.2532% below exact export, within the unchanged 1%.

| As-saved region | HDR luminance p99 / max | SDR judged luminance p99 / max |
|---|---|---|
| Centre | 7.169% / 31.585% | 2.141% / 15.186% |
| Upper left | 4.548% / 13.961% | 0% / 7.901% |
| Lower right | 6.538% / 35.169% | 8.274% / 23.715% |

Each isolated run samples the same HDR centre region once, 1,947,690 pixels.
The fixture has Texture 0, Clarity 47 (radius 0.45%), Sharpen 93 (radius 1.7
source pixels, threshold 10) and Microcontrast 23. Isolation sets the other
two active global Detail amounts to zero in the session; locals, masks and
other modules remain as saved. The Detail section remains enabled.

| Isolated variant | Artifact | Luminance p99 / max | OKLab p99 / max | Tone |
|---|---|---|---|---|
| All three amounts zero | `detail-off.json` | 0.741% / 1.695% | 0.00226 / 0.00496 | Pass |
| Clarity only | `detail-clarity-only.json` | 0.789% / 1.634% | 0.00243 / 0.00551 | Pass |
| Sharpen only | `detail-sharpen-only.json` | 6.958% / 26.054% | 0.01407 / 0.06381 | Fail |
| Microcontrast only | `detail-microcontrast-only.json` | 0.783% / 1.764% | 0.00238 / 0.00586 | Pass |

This isolates Sharpen as a major divergent stage in the measured region. It
does not establish agreement for every Detail setting, every region, or local
Detail. Texture was inactive and has not yet been isolated.

## First repair and remaining cause

The original preview sampled a sparse Gaussian; `detail.py` uses three box
passes. The GPU Sharpen filter now follows those weights. Each axis is fused
in the interior, with per-pass clamping at boundaries. Two half-float channels
carry each Sharpen value and its remainder, reusing the unused Clarity band
channel. Global and local Sharpen share the filter. The declared tile reach
covers all three box passes. Export is unchanged.

`sharpen-blur-reference.js` compares that actual GPU function with the CPU
export kernel on 64 x 40 and 3 x 2 synthetic images, both lanes, sigma
0.3/0.349/0.35/0.8/1.2/1.7/3.0: 28 cases pass an absolute log-luminance error
of at most 0.00002, including every boundary pixel and below-0.35 neutrality.
Raw result: `sharpen-kernel.json`. This is a filter test, not a full-picture
section 4 verdict.

The kernel-only full comparison (`sharpen-fix-as-saved.json`, the same three
regions per lane once) improved but failed: HDR luminance p99 2.975–5.426%,
maximum 9.053–30.433%. Masks and peak still pass. This intermediate build is
not accepted as a completed repair.

Code inspection then found that `processingScaleFor` used cropped frame
dimensions divided by the original source edge. The native 4,608-square crop
of a 7,362-edge source therefore reduced a 1.7-pixel Sharpen radius to about
1.06 pixels; export uses source scale 1. This crosses the box-radius threshold:
the preview used a 3-wide box, export a 5-wide box.

The scale calculation now uses a proxy's requested source `longEdge`, before
geometry, retaining the dimension-only fallback where no such metadata is
available. The first-region frame and halo calculation retain this metadata.
This correction applies to global and local authored source-pixel radii.
Comparison reports now record the selected frame's processing scale.

## Combined repair: measured result

`sharpen-scale-fix-as-saved.json` passes `--enforce`: one comparison, three
regions of 1,947,690 pixels per lane, the app's chosen tiled route and scale 1.
Paired pixels, tone, masks and peak all pass the unchanged limits.

| Region | HDR luminance p99 / max | HDR OKLab p99 / max | SDR judged luminance p99 / max |
|---|---|---|---|
| Centre | 0.854% / 1.947% | 0.00258 / 0.00576 | 0% / 2.698% |
| Upper left | 0.495% / 1.781% | 0.00174 / 0.00555 | 0% / 1.854% |
| Lower right | 0.624% / 1.354% | 0.00063 / 0.00204 | 0% / 2.156% |

`detail-fourmask.json` repeats the same region/lane sampling once. SDR passes;
HDR's centre still has two pixels over both ceilings: maximum luminance
8.0335% against 5%, maximum OKLab 0.136093 against 0.03. At image coordinate
(2658, 4353), preview luminance is zero, export 0.00080335483849 of reference
white. Typical HDR error is only 0.347%, but the ceiling verdict remains failed.
Upper-left and lower-right HDR comparisons pass. These are the same outliers
recorded in phase 2; this Sharpen correction did not repair them. Masks pass
under the existing trial gradual-mask limit. No tolerance is widened.

## Relevant timing preservation

Three alternating before/after pairs, each a fresh disposable session at 100%
on the primary fixture, compare HEAD `5d5ae6d` with this implementation.
`detail-zoom-ab-provenance.json` records hashes for the three production files
swapped between runs; all files were restored and their hashes verified.
Raw files are `detail-{before,after}-zoom-primary-{1,2,3}.json`, reduced to
`detail-{before,after}-summary.json`. Each row below has three samples per
build from three sessions. These are focused driver operations, not the
five-minute session benchmark or a phase 3 speed exit.

| Operation | Picture median before / after, ms | Picture + scopes median before / after, ms |
|---|---|---|
| Zoom immediately after brush | 631 / 533 | 2603 / 2509 |
| Zoom six seconds after brush | 238 / 238 | 1664 / 1668 |
| Local Detail: zoom immediately after brush | 143 / 182 | 1629 / 1669 |
| Local Detail: zoom six seconds after brush | 2093 / 2053 | 3556 / 3502 |
| Local Detail: unchanged cached zoom | 168 / 163 | 181 / 177 |
| Zoom after creating local | 308 / 324 | 1721 / 1732 |

Small mixed changes do not establish a speed improvement or a clear regression.
The accepted native foreground brush fallback remains about two seconds with
local Detail; scope settlement remains materially slower than picture delivery.

## Preservation checks and pause

Maximum/robust bounded calls in both lanes retain the accepted frame and its
resources. The primary final check uses 2,096,704 native patch pixels; its HDR
peak is 636.57769 versus exact 638.1938 nit, 0.2532% low. Its HDR/SDR robust
anchors remain 0.5221368912 / 0.5632608093. The four-mask check uses 262,144
pixels, peak 3207.11806 versus 3208.967 nit, 0.0576% low, robust anchors
2.3784142300 / 10.8340443755. The robust values match phase 2's four paired
references and errors (0.1265–0.9104% high); exact CPU robust renders were not
repeated. All measured source/mask requests retain the budgets.

44 focused Python checks pass, including all five Proof identity checks,
peak accuracy, Detail processing and comparison accounting. 59 Node checks
pass for source scale/halo, shader pins, source/mask transport and caches,
bounded-peak single-flight/disclosure and zoom-scope recovery. The GPU filter
test adds 28 passing synthetic cases. The peak-reduction and both Denoise
shader byte pins remain unchanged. The known failing suites were not repaired.

Phase 3 remains open. The full local/global Detail matrix, GPU masks, control
gaps, Match, navigation/scopes and 50-local scaling remain. No phase 4 work,
commit, push or fixture save was made. Implementation pauses for Steve's
decision on the remaining four-mask ceiling failures, following the requested
rule to show evidence and stop when a limit remains unmet.

## Follow-up: two near-black pixels repaired

Steve directed investigation of the two pixels with few long tests. This
follow-up uses the saved capture, one CPU reference trace, a tiny synthetic
GPU regression and one fresh HDR-centre comparison; no timing sessions or
full fixture/lane matrix were repeated.

The failing pixels are (2599, 3988) and (2658, 4353). Their signed RAW colours
have negative ACEScg luminance but a positive blue channel. For the latter,
CPU base-stage RGB is (-0.00028979886, -0.00048077852, 0.00236804318).
Export's neutral colour-grading function returns its input unchanged. The
GPU function instead ran luminance normalization even with every wheel
neutral: source luminance became zero, so all channels became zero. The
synthetic probe reproduced this black output before changing the shader.
The GPU now returns its input for neutral wheel saturation/luminance, matching
export regardless of wheel hue, balance or blending. Active grading is unchanged.

`neutral-color-grading-reference.js` checks the actual shader against CPU
grading on signed near-black, zero, sub-floor, ordinary and bright samples:
neutral, neutral with hue/balance changes, disabled and active, HDR and SDR.
Eight cases (64 pixels) pass, maximum absolute channel error 2.98023e-8;
neutral and disabled cases are exactly identical. The SDR active probe
includes the upper display clamp that `renderSdrBase` applies immediately
after grading (CPU includes this clamp inside its grading function).
The first diagnostic exposed that probe-placement difference; it did not
require a production SDR change or relaxed test error bound.

`near-black-fourmask-after.json` passes `--enforce`: one fresh HDR centre
region, 1,947,690 pixels, as saved, app-selected tiled route, source scale 1.
Luminance p99 remains 0.347%; maximum falls from 8.0335% to 0.712%.
OKLab p99 is 0.00168; maximum falls from 0.136093 to 0.00390.
Zero pixels exceed either ceiling. Paired pixels, tone, masks and peak pass
the existing limits. The two formerly failing pixels now have luminance
errors 0.0204% and 0.0068%, respectively. Masks retain the existing trial
gradual-mask limit; the source project SHA-256 remains unchanged.

Raw provenance: `near-black-cpu-trace.json`, `near-black-grading-before.json`,
`near-black-grading-after.json`, `near-black-two-pixels-after.json` and the
fresh comparison above, all under the same ignored artifact directory.
The four shader-contract checks pass again with Peak/Denoise pins unchanged.
Export was not changed. Earlier primary/timing/Proof checks preceded this
neutral-only guard and were not rerun; no new full-phase verdict is inferred.

The four-mask ceiling blocker is resolved in the affected region. Phase 3
still needs GPU masks, the full Detail matrix, controls/Match,
navigation/scopes and 50-local scaling. No phase 4, commit or push was started.
