# Denoise follow-ups — 2026-10-04

All changes remain uncommitted on viewport-bounded-preview-phase-2-wip. Previous working-tree changes were preserved. Owner application windows and the saved test project were not changed.

## PRD reconciliation after owner review

Steve asked whether native processing had already been addressed. Read the current `ai/docs/product/Viewport_Bounded_GPU_Preview_PRD_2026-10-01.md`, sections 2, 3, 4.1, 4.4, 5.2, 5.4, 14.10 and 14.13, and the October 3 post-testing continuation prompt. The earlier proposed native-every-zoom change is held pending this reconciliation; the owner's question does not authorize building it.

Native means source pixel resolution, independent of CPU/GPU execution and independent of whether the entire image or only a region is processed. Current interactive preview is GPU; exact CPU full-size Proof/export is a separate reference contract. Section 5.2 calls for visible-region-plus-margin rendering at/above 100%; 14.10 already extends region routing to custom views below 100% whenever the image is partly offscreen. Region routing does not itself imply native source resolution. The later October 3 `91e4a12` decision explicitly uses stepped reduced source sizes below 100%; current `requiredProcessingLongEdge`/`steppedProcessingLongEdge` implement that, and a step can reach native before 100%. Explicit Full override also selects native processing. Stable selected-tier interaction remains in force.

The PRD's pixelwise 100% comparison uses display-linear light, a fixed 1%-of-reference-white denominator floor, luminance p99 2%/maximum 5%, and separate OKLab limits. Below 100%, section 4.4 requires 8x8-screen-pixel block continuity against the corresponding 100% region, with the section 4.1 typical limits, rather than pixelwise export identity. Section 14.13 previously measured HDR block p99 0.68% passing and SDR 3.35% failing/deferred; that fixture does not establish Denoise continuity on this saved photo.

Therefore the 2.5% scene-linear pixelwise thresholds in the new diagnostic are investigation thresholds chosen from the denoise follow-up brief, not the sprint's specified acceptance test. Its variable near-black floor and lack of maximum/OKLab statistics also differ from the PRD tool. The numerical stage findings remain useful to isolate denoise order, but neither the smaller-size failure nor the native 0.78% result establishes a complete PRD verdict. Before changing source policy, test Denoise using the existing display-linear block-continuity test at actual UI zooms, plus the normal 100% preview/export limits. A native-rendering redesign is not yet justified by a measured failure of that acceptance contract.

## PRD-based investigation and proposed solutions

This supersedes the earlier proposal to force native processing at intermediate zooms. No product code was changed during this investigation. The sprint's stepped reduced-source policy is retained. Native means source pixel resolution; interactive native regions still run on the GPU. CPU export and full-size Proof remain the exact reference.

### Measured 100% accuracy

The existing preview/export comparator now supports `--denoise`, capturing the enabled settings in its in-memory export document. On the read-only saved 42 MP project, three regions of 1,947,690 pixels each were compared in display-linear light using the PRD's fixed black floor and luminance/OKLab limits.

| Saved project state | Largest regional luminance p99 | Largest luminance maximum | Largest OKLab p99 | Largest OKLab maximum |
| --- | ---: | ---: | ---: | ---: |
| Denoise on, saved locals | 1.026% | 8.244% | 0.00322 | 0.03255 |
| Denoise off, saved locals | 0.496% | 6.265% | 0.00188 | 0.03243 |
| Denoise on, locals disabled | 0.689% | 6.897% | 0.00230 | 0.01194 |
| Denoise off, locals disabled | 0.210% | 0.286% | 0.00068 | 0.00112 |

Typical limits (2% luminance and 0.01 OKLab) pass. Maximum limits (5% and 0.03) do not pass with the saved locals, including with Denoise off. Removing locals clears the colour ceilings but leaves luminance outliers. With both Denoise and locals disabled all native tone/colour regions pass comfortably. Denoise alone introduces a separate luminance ceiling failure. Saved locals introduce additional luminance/colour outliers even with Denoise off. Therefore native source selection alone cannot establish PRD compliance. Masks pass in the native saved-project comparisons. Peak has separate PRD deferrals; no changes to Peak or automatic highlight anchors are proposed here.

Reports are `output/performance/prd-denoise-native-{saved,off-saved,no-locals,off-no-locals}.json`, with exact comparator output in their `-files/comparison.json` directories.

### Below-100% continuity and alignment correction

The capture driver now supports arbitrary custom zooms and records actual canvas CSS scale. An area-integral helper evaluates 8x8 screen-pixel blocks in decoded display-linear light. It reproduces the historic HDR block statistic when supplied the historic screen scale, and has independent fractional-pixel overlap, brightness-error and translation tests.

Initial comparisons normalized the complete frame bounds. This is insufficient for the saved perspective/crop: exact backend geometry maps show about one native pixel of translation between processing sizes. Comparing different scene positions inflated the 50% luminance p99 to 8.92%. Those original numbers must NOT be reported as processing-tone error.

`denoise-source-aligned-continuity.py` rechecks existing bounded GPU readbacks through `geometry_coordinate_map`, pairing the same source coordinates. Each transformed 8x8-screen block is integrated as a near-axis rectangle; maximum departure from axis alignment is 0.000143 native pixel on this photo. The helper refuses mappings above 0.01 pixel. These corrected values are diagnostic evidence, not a replacement formal acceptance gate: use exact polygon integration or a shared canonical output grid for final acceptance. Do not conceal actual geometry placement changes with image-content registration.

| In-memory diagnostic state | 50% luminance p99 | 63.3% luminance p99 |
| --- | ---: | ---: |
| Saved grade/locals, Denoise on | 2.549% | 1.715% |
| Saved grade/locals, Denoise off | 2.534% | 1.660% |
| Denoise on, locals disabled | 1.892% | 1.561% |
| Also Tone Equalizer disabled | 1.691% | 1.448% |
| Locals disabled, neutral geometry | 0.572% | 0.522% |
| Locals disabled, Denoise off, linear monochrome grade | 1.601% | 1.358% |

All corrected OKLab p99 values are below 0.01. At 75%, the existing source policy selects native resolution on this photo and continuity is zero. Actual source long edges at 50/63.3/75% are 3984/5634/7968. Removing locals affects more than local Detail, so these results do not yet identify a particular local control. Perspective increases the reduced-source residual; tone equalizer also contributes. Denoise changes the saved 50% result by only about 0.015 percentage point. The main measured continuity problem is shared with Denoise off.

Reproduction: `.venv/Scripts/python.exe tests/performance/denoise-source-aligned-continuity.py --source-size 7968 5320 --reports <capture-report.json ...> --output <result.json>`. The reports preserve original capture/frame metadata and raw readbacks. Consolidated corrected results: `output/performance/prd-denoise-source-aligned-continuity.json`. The helper verifies the saved project digest and exact output dimensions.

### Recommended order of work

1. **Keep the current source-size policy.** Fit remains an approximation; custom zooms below 100% use stable processing steps; native visible regions plus margin apply at/above 100% and whenever an earlier step reaches native. CPU remains the Proof/export reference. Full override remains available. Forcing native everywhere was slower in the existing probe and does not fix the native maximum failures.
2. **Fix and pin cross-size geometry coordinates before tuning accuracy.** Use the native source/output coordinate system to derive reduced output grids, crop origins, masks, viewport and zoom anchors. Keep sampling bounded to the visible region. Test the same scene through strong perspective, straighten, crop and odd dimensions at 50%, 63.3% and tier boundaries, including the existing 8x8-block limits. A measurement correction is not itself a product fix.
3. **Isolate the remaining local-effect continuity gap.** Disable local Detail alone, then individual brush/luminance/gradient locals and controls. Check mask positions and Detail radius/halo scaling against the canonical grid. Fix the demonstrated contributor, without disabling authored effects or widening the written limits. Then investigate the native local-effect luminance/colour ceilings against exact CPU regions; the saved-project controls must pass with Denoise both on and off. Separately, test the Denoise-only native luminance outliers: export filters the original source before geometry, whereas the current GPU preview filters geometry-resampled pixels. Stage isolation already showed a residual from this order difference at native size. Prototype source-space GPU denoise on just the required source window plus denoise/warp halo, followed by geometry, and compare against exact CPU regions. This is an evidence-supported hypothesis, not a proven explanation of every maximum outlier. Preserve the pinned Denoise shader arithmetic initially; test graph ordering, tile halos and boundaries before proposing a shader change.
4. **Improve Denoise speed without changing resolution policy.** Cache resolved ungraded denoise regions at the selected tier with a strict byte budget, keyed by source epoch, model, geometry, ROI and noise controls. Exposure-only edits can reuse them; changing noise controls, geometry, source, region or model must invalidate them. Retain bounded sample-window model measurement and shared analysis. Validate cold visits, pan, eviction and control drags against the existing latency goals; this cache is a code-supported proposal, not an implemented or proven speed fix.
5. **Hold geometry-independent intermediate model reuse as experimental.** Its existing scene-linear diagnostics are useful but do not establish PRD acceptance. Compare reused versus fresh models after geometry changes using the corrected screen-block method and native preview/export checks. If it fails, retain geometry-dependent models and recover latency through bounded sampling and caching. Keep native per-photo models separate. SDR authored/matched base consistency needs its own preview/export investigation before changing SDR model policy.

The main PRD's deferred SDR continuity item does not waive an HDR failure on a different photo. This investigation did not change the PRD, shaders, thresholds, saved project, commit history or installed app. Diagnostic validation: 24 focused Python tests pass and the modified Python/JavaScript drivers pass syntax checks. Product tests were not rerun for diagnostic-only changes; the previous product checks are recorded above.

## First drag after pan and enable

The pending pan refinement was not the main cause. Traces showed repeated denoise setup, source loads restarted by grade edits, and completed GPU renders discarded because the next input arrived before the frame finished. On the 42 MP project a roughly 40 ms render could never finish while slider inputs arrived every 16 ms.

Changes share matching analysis work, preserve reusable ungraded source loads while the photo/geometry/base remain current, and allow a paced adaptive denoise drag snapshot to finish before drawing the latest edit. Photo changes, geometry changes, new foreground submissions and release still invalidate obsolete work. This deliberately allows a recent drag snapshot to appear while a newer input is pending; settled output still uses the final edit.

Native measurement now starts when a saved session loads, with presentation as another deduplicated warm-up hook. Matching backend requests share a Future, including foreground requests overlapping the warm-up. Different source epochs and sizes have separate keys. Shared white-noise calibration is also initialized under a lock: concurrent native/scaled requests previously could read limits before tails existed and fail with HTTP 500.

On Denoise-stuck-DSC04761.hdrfinisher, the diagnostic before these fixes showed about 1.46 s to first drag frame, with warmed drags still starved until input stopped. Subsequent runs showed about 0.40–0.76 s for the first pan/enable drag frame and about 0.06–0.07 s with the model ready. The final regression showed 12 frames during 60 inputs for the first case, and 29 for the ready case. A synthetic 42 MP run showed about 0.41 s and 55 total frames in its ready case.

The regression requires the first frame under one second, at least ten frames during sixty inputs, no repeated setup, and no page errors. It also waits for the background native model, zooms from Fit to 100%, and requires native accepted output under one second. The saved-project final run took about 0.50 s for that zoom; the synthetic run took about 0.09 s. These are local measurements, not a guarantee for every device or an immediate zoom before background work finishes.

## Intermediate zoom experiment — implemented, accuracy gate failed

The owner authorized building the proposal. HDR now reuses its first measured model at each source size after geometry edits. Cache keys include the source epoch, and obsolete revision/geometry requests still fail their guards. SDR keeps its geometry-specific behavior; native HDR stays on its original per-photo model. Reconstruction continues to use current geometry.

The new GPU regression tests 50% zoom, a 5-degree straighten, perspective, and a subsequent different intermediate scale. It confirms that geometry edits retain the exact model, while changing scale gets a different model. Initial measured redraws were 239 and 302 ms. Backend coverage verifies geometry reuse, size/source isolation, stale request guards and checking the source epoch from resize workers while the owner holds the cache lock. An initial locking error in that epoch accessor caused a deadlock in the final GPU run; the accessor is now a lock-free integer snapshot and the regression catches that error.

The performance proposal works, but **it is not approved as accuracy-complete**. A separate numerical comparison reads the saved 42 MP project without modifying it, enables Adaptive in memory, denoises the native source through the export helper and compares twelve cases at source sizes 1992, 3984 and 5976. Cases cover the saved geometry, additional straighten, strong perspective, and quarter-turn/crop. Grain, output compression, local adjustments and output finishing are excluded to isolate source denoising and global grading.

| Geometry | Reused vs fresh model, worst p99 | Reused vs aligned export source, worst p99 | Fresh vs aligned export source, worst p99 |
| --- | ---: | ---: | ---: |
| initial | 0.00% | 3.44% | 3.44% |
| straighten | 0.78% | 3.89% | 3.63% |
| strong perspective | 0.96% | 3.50% | 3.68% |
| quarter turn and crop | 1.96% | 3.49% | 4.05% |

The aligned export-source comparison passes the actual denoised export source through the preview's scale and geometry before applying the same global grade. This removes resolution-dependent geometry/grade placement differences, but still exceeds the 2.5% gate. Direct comparison with the fully graded export resized afterward has much larger errors in both existing and proposed preview behavior (up to about 31% p99 here); that comparison cannot establish denoise parity because the intermediate processing graphs also differ in sampling and grade order. Neither comparison supports claiming full intermediate preview/export parity.

A diagnostic alternative measures each resized source before geometry, avoiding dependence on which geometry was first. Completed saved-photo results were worse (up to 5.03% aligned-source p99 and 2.62% versus a fresh model), so that alternative has not been applied to product code.

For the intermediate change, 168 relevant backend tests and 427 Node tests pass. The synthetic aligned comparison also passes: worst p99 is 1.51% against the export source and 1.45% against fresh measurement. The saved-photo quality gate fails as shown above.

The script tests/performance/denoise-intermediate-parity.py preserves its report before enforcing the 2.5% gate; the saved-photo run intentionally exits nonzero when that gate fails. Evidence is in output/performance/denoise-intermediate-real.json and its log. tests/denoise-intermediate-reuse.js is the passing GPU reuse contract test. The owner has been asked whether to hold reuse for accuracy work or retain it with the disclosed limitation. Nothing is committed.

## Accuracy investigation — stage isolation and native proposal

The owner requested investigation of the failed gate. No product behavior was changed in this investigation. Two read-only diagnostic drivers were added: `tests/performance/denoise-accuracy-stages.py` isolates source cache, denoise order and grading; `tests/performance/denoise-native-intermediate-probe.js` measures the existing Full override in a disposable application at intermediate zooms. Neither saves the project. The Python driver also checks the project file digest before/after on subsequent runs.

On the saved geometry and controls, source cache versus fresh resizing is pixel-identical at every tested size. The aligned-source comparison measures the native denoised export source through identical preview geometry/sampling, excluding grain, output compression, local adjustments and output finishing. It isolates denoise but is not a full finished-file parity claim.

| Source long edge | Source fraction | Raw denoise p99 difference | After saved global grade | Denoise resized source before geometry, raw |
| --- | ---: | ---: | ---: | ---: |
| 1992 | 25% | 2.54% | 3.44% | 3.27% |
| 3984 | 50% | 2.22% | 2.71% | 2.35% |
| 5976 | 75% | 2.09% | 2.49% | 1.37% |
| 7968 | native model/source | 0.65% | 0.78% | 0.00% |

Reduced sources use a fresh model in this isolation test. The native test uses the model measured on the original image, matching the current native endpoint/export contract. In particular, the 0.78% result is a numerical saved-photo test of that native route, not a repeat of an earlier reported figure. Resolution fractions here describe source arrays, not the UI zoom: stepped source selection may choose a larger array for a given displayed zoom.

The dominant smaller-preview gap exists before model reuse: export removes noise at native resolution before scaling/geometry, while the preview filters already resampled pixels. Denoise is nonlinear, and its pixel-sized bands see different structures after shrinking. The saved white balance, tone equalizer and color edits amplify the remaining differences. Moving reduced-source denoise before geometry is worse at 25% and still does not solve the full gate. Model reuse adds its previously measured geometry dependence, but is not the sole cause. Skipping denoise is also worse (raw differences 2.78%, 4.76%, 5.80%, 6.37% respectively).

A settled disposable GPU trial used the existing Full override, with native model warmed, no catch-up, the saved project and sixty Exposure inputs separated by 16 ms. All native cases processed at 7968 and used tiled rendering. No page errors occurred.

| UI zoom | First accepted native frame | First drag frame | Frames during 60 inputs | Drag duration |
| --- | ---: | ---: | ---: | ---: |
| 50%, first visit | 1071 ms | 123 ms | 11 | 1476 ms |
| 75% | 158 ms | 73 ms | 14 | 1269 ms |
| 25% | 1708 ms | 323 ms | 7 | 2402 ms |
| 50%, return visit | 201 ms | 85 ms | 11 | 1367 ms |

The first un-settled probe gave 1.89 s/no drag frames at 25%; the driver was corrected to allow zoom/layout work to start before checking settlement. The settled trial above is authoritative. It still fails the under-one-second/at-least-ten-frame checks at 25%, and the first 50% visit narrowly exceeds one second.

For comparison, the same driver with `--proxy` retained the current automatic source policy. It processed UI 50% at 3984, UI 25% at 1992, and UI 75% at native 7968. First Exposure drag frames were 47/46/94 ms, and frame counts were 37/53/13 respectively. Returning to 50% gave 34 ms and 41 frames. These drags show the native cost clearly. The first visits to new intermediate sizes also paid setup: about 2.36 s at 50% and 2.07 s at 25%, versus 0.32 s returning to 50%. Those cold transitions are distinct from the earlier warmed-model native zoom regression.

Code inspection found avoidable native work: the tiled graph reconstructs denoise for every foreground tile when Exposure alone changes (`renderTiled` calls `resolveDenoiseProxy` into temporary graph textures). Denoised output could instead be cached by source/model/geometry/region/denoise controls, excluding grade edits. Proposed next work: a byte-bounded cache of denoised native regions, native processing for zoomed-in HDR, fast approximate Fit, and cancellable preparation for cold regions. This is a proposal, not a proven speed fix. Denoise-control edits, new pans, geometry edits, source changes, cache eviction and SDR need explicit coverage; cached grades must never make stale noise controls appear current. Lower zoom and cold first visits must pass the existing latency gate before acceptance.

The owner has been asked to authorize that preview behavior change, as required by the original brief. Intermediate reuse remains experimental. Reports: `output/performance/denoise-accuracy-stages.json`, `denoise-accuracy-native-stages.json`, `denoise-native-intermediate-probe.json`, and `denoise-proxy-intermediate-probe.json`. Diagnostic syntax checks pass, all new files remain LF, and no commit/merge/push was performed. Existing product-test results above were not rerun because this investigation changed only diagnostic drivers and documentation.

## SDR decision

SDR with an authored or matched base needs separate preview/export parity work. The preview currently measures its selected SDR base; exporters._denoised_export_source always denoises session.image. _render_export_branch then passes the authored reference unchanged to apply_adjustments, which can choose that reference as the SDR base. On that branch denoising the main source does not establish that the authored base was denoised. Matched SDR also needs its processing order checked. Swapping in the HDR model would not fix this source mismatch.

Keep the present SDR measurements until a dedicated change makes preview and export denoise the same base at the same stage, then compare both SDR branches numerically. No SDR behavior change or SDR parity claim is included here. The prior session's reported HDR 100% p99 luminance difference of 0.4–1.0% was not remeasured on the saved photo in this follow-up; denoise arithmetic was unchanged.

## The two pre-existing GPU failures

full-tier-preview expected an exact CPU peak. Current product behavior explicitly discloses CPU scope peaks as preview measurements, and scope-peak-disclosure tests pin that contract. The GPU test now checks that disclosure and passes.

The selector seam test sampled a bootstrap/intermediate layout and pinned absolute canvas coordinates across responsive pane changes. Captured evidence showed the pane width change from 1105.53 to 1049 px while the 140×80 px image stayed centered at 200% with scroll zero. The test now waits for layout settlement outside its latency measurement and compares placement relative to the pane center, retaining dimensions, zoom, scroll and source checks. Subpixel centering tolerance is 0.5 px; other numeric checks remain 0.01. Product layout behavior was not changed.

A stale scope request also surfaced during the saved-project drag regression: backend revision 1 had replaced requested revision 0. The auxiliary scope now discards failures when its generation or edit revision is obsolete, while current failures still propagate.

## Validation

- 427 Node unit tests passed.
- 166 relevant backend tests passed, including model sharing, source epochs, adaptive/legacy math, export parity and geometry. The final calibration publication cleanup also passed all ten native model tests.
- Adaptive GPU/Python parity: worst 0.44 times the half-float allowance, zero samples beyond it.
- Zoomed region test: 99.7% view coverage, bypass exact, regional reconstruction equals whole-frame reconstruction to zero pixel levels, region used again after straighten.
- Legacy tiled GPU parity covers seams, controls, cached zoom/pan and superseded analysis.
- Full-tier and selector GPU checks, plus the saved-project and synthetic drag regressions, have dedicated logs in output/performance.

No commit, merge or push was performed. Accepting the experimental intermediate reuse despite its failed accuracy gate, SDR behavior changes, committing, merging and pushing remain separate owner decisions.
