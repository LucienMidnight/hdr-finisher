# Denoise accuracy and performance — plan for independent review

Status: **Reviewed and narrowed on 2026-10-04; see the outcome below.** The original proposal follows unchanged.
Date: 2026-10-04.

## Outcome of the review (2026-10-04)

Recorded in the viewport preview PRD, section 14.25 and section 15.

- Step 1 (new comparator and coordinate contract): not done. The below-100% miss is at the 2% limit and is listed as P3-ZOOM-02 for Steve to decide.
- Step 2 (isolate locals): done. The cause is the brush local's Clarity leaving the preview without a bounded editing Peak, so the highlight roll-off differs on specular pixels. That is the deferred P3-PEAK-01; no Detail or mask change was made.
- Step 3 (Denoise-only outliers): not done. Seven pixels of 5.8 million; Steve decided no action.
- Step 4 (cache of denoised regions): done as kept denoised tiles, measured before and after.
- Step 5 (model reuse across geometry): removed; smaller levels are measured per size and geometry again.

## Purpose and decisions requested

Resolve the measured accuracy gaps and remaining Denoise latency while following the existing viewport preview PRD and current sprint. Review the evidence, measurement method, scope and sequence below. Do not implement this plan during review. Return findings and recommended amendments to Steve.

The recommendation is to retain the current processing-resolution policy and investigate specific geometry, local-effect and Denoise differences. The earlier suggestion to force native resolution at intermediate zooms is superseded.

## Read first

- [Viewport preview PRD](../product/Viewport_Bounded_GPU_Preview_PRD_2026-10-01.md): sections 2, 3, 4.1, 4.4, 4.6, 5.2, 5.4, 6, 14.10, 14.13 and 15.
- [Current sprint continuation](archive/viewport-phase3-post-testing-next-thread-prompt-2026-10-03.md): stepped source sizes, bounded Denoise model sampling, geometry/zoom placement, shader pins and deferred work.
- [Investigation record](denoise-followups-2026-10-04.md): especially “PRD reconciliation” and “PRD-based investigation and proposed solutions.” Later sections preserve earlier experiments and proposals; their scene-linear thresholds are not PRD acceptance gates.

Workspace: `D:/AI/AI Projects/HDR Finisher Tool`; Git root: `ai`; executable/test directory: `ai/codebase`; branch: `viewport-bounded-preview-phase-2-wip`. The working tree contains substantial earlier changes. Inspect current HEAD/status; preserve them. This plan does not approve a commit, push, installer rebuild or behavior change.

## Existing contract

Native means original source pixel resolution, independently of CPU/GPU or whole-frame/region execution. Interactive work uses the GPU; CPU export and full-size Proof are the exact reference.

Keep Auto Fit approximation, stable reduced-source steps below 100%, native visible-region-plus-margin processing at/above 100%, and the existing Full override. A reduced-source step can reach native before 100%. Custom views below 100% already use regional rendering when partly offscreen; regional does not mean native.

At 100%, compare display-linear luminance with the fixed reference-white black floor: p99 at most 2%, maximum at most 5%; OKLab p99 at most 0.01, maximum at most 0.03. Preserve the PRD's target-format exemptions and mask limits. Below 100%, compare corresponding 8x8 screen-pixel block averages with the typical limits, not individual pixels against export. Read section 6 for performance gates rather than substituting the follow-up driver's one-second/ten-frame checks. Preserve export/Proof determinism, shader byte pins, and Peak/automatic-anchor decisions and deferrals.

## Evidence and limits of the conclusions

Read-only fixture: `D:/Photos/HDR Test Images/Denoise-stuck-DSC04761.hdrfinisher`, source 7968x5320. Project SHA-256: `2dd3ef64d3b4127d5e793c6664b12075d4e203e19a746d55b92e317bf23daf86`. All edits in diagnostic runs were in disposable memory. GPU window size was 2560x1440.

Three native regions, each 1,947,690 pixels, were compared through the actual CPU export branch:

| In-memory state | Largest regional luminance p99 | Largest luminance maximum | Largest OKLab maximum |
| --- | ---: | ---: | ---: |
| Denoise on, saved locals | 1.026% | 8.244% | 0.03255 |
| Denoise off, saved locals | 0.496% | 6.265% | 0.03243 |
| Denoise on, locals disabled | 0.689% | 6.897% | 0.01194 |
| Denoise off, locals disabled | 0.210% | 0.286% | 0.00112 |

All native typical limits pass. Maximum failures are attributable to more than one path: Denoise alone leaves luminance outliers, and locals cause additional luminance/colour failures with Denoise off. This does not identify the responsible local control or prove a particular Denoise cause.

Below 100%, initial normalized-frame comparison was misleading: geometry/crop rounding shifts corresponding content about one native pixel between sizes. Source-aligned reanalysis reduces 50% luminance p99 from approximately 8.92% to 2.549% with Denoise on, and 2.534% off. Removing locals gives 1.892%. At 63.3%, saved locals/Denoise on gives 1.715%; 75% selects native and gives zero continuity difference. Corrected OKLab p99 values pass.

These corrected block values remain diagnostic: the helper integrates near-axis rectangles mapped through backend geometry homographies. Maximum within-block cross-axis deviation is 0.000143 native pixel here; mappings over 0.01 pixel are rejected. An exact acceptance comparator and mapping validation are still needed. Geometry rounding is observed; a visible placement defect or a need to redesign geometry is not established by that observation alone.

Source-order isolation supports investigating Denoise before geometry: native export filters the original source, while preview filters geometry-resampled pixels. It does not prove that order explains the worst outliers. Moving reduced-source filtering before geometry was worse at some tested sizes, so do not apply that change indiscriminately below 100%.

## Proposed sequence, with decision gates

### 1. Establish trustworthy acceptance and placement measurements

Validate the geometry homography fit and source pixel-centre conventions, including source-size rounding, crop origin, perspective safe crop and CSS scale. Capture geometry/source dimensions alongside each frame so future comparisons do not reconstruct them from assumed settings.

Compare exactly corresponding scene footprints using exact polygon area integration or another independently validated method. Validate translations, perspective, odd dimensions and high-contrast synthetic scenes against a known reference. Measure viewport/zoom-anchor placement separately; do not use content registration to conceal placement shifts.

Decision gate: determine whether the existing differences are acceptable rounding, an incorrect comparison, or a product coordinate defect. Change geometry only if a defect is demonstrated. If needed, derive reduced grids, masks and viewport anchors from a shared source/output coordinate contract without changing exact export/Proof. Reproduce the sprint's 63% zoom case and test processing-tier boundaries.

### 2. Isolate and fix local effects

At both 100% and reduced steps, test Denoise off/on with individual locals and then individual controls. First disable local Detail alone; also isolate the brush, luminance-range and linear-gradient locals. Keep the rest of the saved grade constant. Check mask alignment, feathering, Detail radius/halo scaling, thresholds, opacity and tile boundaries.

Decision gate: identify the responsible control/stage before editing it. Apply the smallest fix, preserving authored effects. Require native maximum limits and below-100% block limits afterward. Disabling locals is a diagnostic, not a proposed product solution.

### 3. Resolve Denoise-only native outliers

With locals disabled, inspect exact failing pixels/regions and compare CPU/GPU source order, model, boundary handling and tile halo support. Start with the existing pinned shader arithmetic.

If source order is confirmed as a contributor, prototype GPU Denoise in source space on only the source window needed by the output region plus the filter/warp margin, then apply geometry. Derive sufficient margins from the actual filter graph; test neighbouring-tile seams and image edges. Do not introduce full-image native CPU editing or a full-image native GPU allocation to fix a bounded-region problem.

Decision gate: accept this graph change only if it fixes the measured outliers within the written limits and passes latency/memory checks. Otherwise retain the existing graph and investigate the next demonstrated contributor. Treat reduced-source ordering and SDR separately.

### 4. Improve performance without changing resolution policy

After the correct processing graph is established, consider a byte-bounded cache of resolved ungraded Denoise regions. Grade-only edits such as Exposure can reuse the result. The cache identity/invalidation must cover source epoch/base/lane, processing tier, model/version, geometry, region/margins and all noise controls. Budget GPU resources and release them on eviction, session changes and device loss.

Test cold visits, warmed drags, pans, zoom/tier changes, geometry edits, noise-control edits, eviction and stale asynchronous completions. Report source fetch, model setup, reconstruction and grade costs separately. Avoid duplicating existing caches without a measured benefit. Retain the sprint's bounded model sampling and shared analysis.

Decision gate: keep the cache only if measured benefit meets applicable PRD performance goals without stale output or exceeding memory budgets.

### 5. Decide the existing model-reuse experiment

Geometry-independent intermediate HDR model reuse is already present as an uncommitted experiment; it is not accuracy-approved. Compare it against fresh measurement after geometry changes using the validated block comparator. Include native checks and source/tier invalidation. If it fails, restore geometry-dependent intermediate model identity and recover speed through bounded sampling/caching. Preserve unrelated earlier fixes.

SDR authored/matched bases have a separate preview/export source-consistency concern. Do not apply HDR models or claim SDR parity from this plan's HDR results. The deferred SDR continuity item is not a waiver for new HDR failures.

## Validation and evidence delivery

Run GPU checks serially through `tests/run-in-electron.js`, with `HDR_FINISHER_ELECTRON_WINDOW_SIZE=2560x1440`, in disposable application sessions. Keep Steve's own application untouched and verify fixture hashes afterward.

Use the saved photo plus existing sprint fixtures and targeted synthetic geometry/tile-boundary cases. Include 50%, 63.3%, 75%, 100%, above 100%, tier boundaries and pans. Fit has a different framing/route and needs its own check. Cover Denoise on/off, locals on/off, strong geometry and native edge cases. Re-run affected model/cache/coordinator/mask/geometry checks, then the required sprint checks once justified by the final changes.

Publish before/after metrics, actual processing tiers, code state, comparator version, control settings, failures and resource measurements. Preserve existing thresholds. No pass claim based solely on p99 when native maximum limits fail. Keep Peak findings separate.

Current diagnostic validation: 24 focused Python tests pass; changed Python/JavaScript drivers pass syntax checks. These results validate diagnostic helpers, not the proposed product fixes. Previous product-test results are recorded in the investigation document and have not been rerun for this plan.

Evidence under `ai/codebase/output/performance`:

- `prd-denoise-native-{saved,off-saved,no-locals,off-no-locals}.json` and each `-files/comparison.json`.
- `prd-denoise-continuity-*.json`: original captures and bounded readbacks. Their normalized-frame statistics need the alignment caveat above.
- `prd-denoise-source-aligned-continuity.json`: corrected diagnostic reanalysis.
- `denoise-accuracy-stages.json`, `denoise-accuracy-native-stages.json`: source-order isolation, not PRD gates.
- `denoise-native-intermediate-probe.json`, `denoise-proxy-intermediate-probe.json`: resolution-policy performance comparison.

Relevant drivers are in `ai/codebase/tests/performance`: `preview-export-compare.js`, `zoom-block-continuity.js`, `zoom_block_compare.py`, `denoise-source-aligned-continuity.py`, and the Denoise stage/probe drivers.

## Requested reviewer feedback

1. Is this interpretation of the PRD and sprint correct, including earlier completed work and current deferrals?
2. Are the source mappings, display-linear comparisons and ablations trustworthy? What additional evidence is necessary before accepting a failure or changing geometry?
3. Is the proposed order of work proportionate? Which hypothesis should be tested first, and which proposed changes should be rejected or narrowed?
4. Can source-space regional Denoise preserve exact filter support and interactive budgets? Identify source-order, halo, shader-pin or export risks.
5. Are cache invalidation, memory and experimental model-reuse gates complete?

Return a review with severity, evidence/file references, suggested amendments and an execute/hold recommendation. Review alone is not execution authorization. Steve will provide feedback before implementation begins.
