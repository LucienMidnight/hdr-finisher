# Viewport-Bounded GPU Preview

**Date:** October 1, 2026
**Status:** Phases 0 and 1 closed on October 1, 2026. On October 2 Steve accepted the phase 2 report, requested commit and push, and directed the next thread to move on in the PRD. Phase 2's implementation, measurements and remaining limitations are recorded in section 13. Phase 3 started on October 2 with a measured Sharpen correction (section 14). The four-mask near-black blocker is subsequently repaired (section 14.1); Steve authorized committing these fixes and continuing the sprint. **Steve closed phase 3 on October 5, 2026, with the findings in section 15.7 carried forward; Steve closed phase 4 on October 6, 2026 as done with known issues: the Group A cleanup and its validation are recorded in section 16, the green exit was not met, and the open findings stay carried forward (16.22).** Phase 1 met its mask-accuracy exit and part of its speed exit; its accepted gap to the section 6 targets remains carried to phase 3. Steve approved the section 4 limits and accepted the section 6 targets as goals on October 1. Phase 0 is recorded in section 11.
**Owner decisions recorded here:** move to the pattern other raw editors use (work bounded by the viewport, masks independent of resolution, export as the exact reference); accept small preview-versus-export differences; put the app's rigor into HDR handling; move interactive work to the GPU.
**Predecessor:** [GPU Performance Review Sprint](GPU_Performance_Review_Sprint_PRD_2026-09-29.md), section 14 (October 1 root-cause pass).
**Primary fixture:** `D:\Photos\Play_Raw\Fantastic light over village - AdamFromCanada\DSC00950.hdrfinisher` with `DSC00950.ARW` (read-only; never saved).
**Reference workstation:** Steve's Windows workstation, NVIDIA GeForce RTX 4070 Ti (12 GiB), 2560 x 1440 at DPR 1.

**Current phase 3 progress:** geometry-mask rasterization, HDR regional leaf
luminance, local curves/wheels and bounded GPU scopes/navigation are implemented
and recorded in 14.2–14.3; SDR regional luminance and a faster native-zoom
source transfer are in 14.2 and 14.4. Steve authorized committing this
continuation on October 2 (no push) and directed the work to Match on the
GPU next. Match candidates now render on the GPU (14.5); Steve approved that
on October 2, including that Match may choose a different recipe than
before, will judge the results by eye himself, and authorized the commit
(no push). On October 2 Steve also accepted the subsequent Match timings
of 3.05 s primary / 4.99 s fifty-local for now, authorized committing the
CPU input-reuse slice (14.6), and directed work to the next phase 3 task.
Further Match speed work is deferred.

Subsequent work records shared regional masks and expression graphs (14.8),
exact Texture repair (14.9), and Detail-control/subnative-zoom checks (14.10).
Steve clarified that Peak is deferred, covering both recorded issues, and
directed continuation of other phase 3 work. Independent SDR scene-mask regions
are recorded in 14.12. Steve also deferred the separate SDR cross-scale
continuity issue in 14.13 because it is close to the limit. Gradient Fan and
Fit gradient masks now use the GPU (14.14). GPU brush feather and index crops
are recorded in 14.15; the October 3 exit audit consolidates unmet targets,
fallback gaps and owner-review items. Native Shift Edge is recorded in 14.20,
native Feather, with and without Shift, in 14.21, and straighten/perspective
leaf masks, wide frames and Fit bitmaps in 14.22. Source-space
combined and luminance masks, Peak under straighten and the windowed straighten
source are in 14.23; the coverage audit and 30-minute endurance run in 14.24.
Post-testing fixes and Denoise are in 14.25, and the editing Peak with Clarity
(P3-PEAK-01, closed) in 14.26.
**Everything deferred, accepted or left as a known limit is listed in one place
in section 15. Phase 3 closed on October 5; what it carries forward is the
named list in 15.7.**

## 1. Problem

Thirty seconds of ordinary use can produce a multi-second stall. Steve built four masks (linear gradient, luminance range, path, brush) on a 42 MP Sony RAW, painted, zoomed to about 200%, and waited 7-8 seconds.

The cause is structural, not a bug. Several things still do whole-image, full-resolution work inside the edit loop:

| Area | What happens today | Measured |
|---|---|---|
| Masks | Each CPU-made mask is compiled for the whole image at processing resolution, then uploaded | 1-2 s and 21-42 MB per mask at native after the October 1 fixes; four fresh masks compiling together took 4.3 s on a cropped 21 MP frame |
| Peak measurement and automatic highlight anchors | Measured at native over the whole image after edits, which pulls every mask to native in the background | With local Detail active the background work did not run and a zoom 6 s after an edit still took 2.2 s |
| Native-zoom rendering | The GPU renders the whole frame when it fits the memory budget | 21 MP rendered for a 3.7 MP viewport; about 0.25 s of GPU time per frame |
| Match | 28 full CPU renders in sequence | About 9.4 s |
| CPU fallbacks | Some local settings force a full CPU render; the navigation thumbnail renders on the CPU beside foreground work | 5-7 s recorded for local curves in the September 30 ledger |

Cost also grows with every local adjustment. A healing brush and projects with 20-50 locals are expected; at 42 MP the backend mask cache holds about four native masks.

## 2. Principles

1. **While editing, work is bounded by what is on screen.** Whole-image, full-resolution work happens at export and in Proof.
2. **Export is the exact reference.** Preview may differ from it within the tolerance policy in section 4.
3. **Rigor goes where the product is differentiated: HDR.** Peak and highlight handling keep the tightest limits. Mask and tone agreement between preview and export only need to be perceptually identical.
4. **Interactive work runs on the GPU.** The CPU path remains for export and Proof.
5. **Cost per added local stays small and predictable.** More locals may mean less speed, but never a cliff.
6. **No visible seams.** Changing zoom, crossing a zoom threshold, or panning must not produce a visible jump in tone, colour or mask placement.

## 3. Proof is the accurate fallback

Proof is how a user checks the real result before exporting, so it must be the export pipeline, not a preview of it.

Current state after phase 0: Proof builds a copy of the session and calls the real export backend, carrying the grade, locals, SDR Match state and denoise. The Proof panel has a size choice. **Reduced** (the default, 1,200 px) runs the export pipeline on a downscaled source and is labelled as reduced in the status line, the viewer note and the watermark. **Full size** grades the session's own source and is byte-identical to an export with the same encoding settings (section 11.2). Before phase 0 the request was capped at 1,600 px and the panel always asked for at most 1,200 px, so a full-size Proof could not be made.

Decided by Steve on October 1: Proof does not need to carry export resize, output sharpening or metadata policy for now. A full-size Proof therefore equals the export when resize and output sharpening are off; when either is set the full-size label says they are not included.

Known and left as they are: Proof covers the three HDR formats only; Proof renders the adjustments the page sends while export renders the server session's.

Requirements:

- Proof at full size produces the same pixels the export of the same settings would produce. This is a bit-exact requirement, not a tolerance.
- Proof at a reduced size is labelled as reduced, and uses the export pipeline on a downscaled source, never the interactive preview path.
- Any future difference between preview and export must be visible in Proof. A test compares a full-size Proof against an export of the same project and settings.
- Proof stays available and correct for projects whose preview used approximate masks or approximate peak measurement.

## 4. Tolerance policy (approved October 1, 2026)

Every limit in this section was approved by Steve on October 1. A wider limit remains an owner decision.

Steve's direction: a few percent difference in hue, value or saturation on some pixels is perceptually identical; mask placement must be accurate for work such as architecture, but most masks are feathered and a shift of a pixel or two is fine.

All comparisons are between the interactive preview at 100% zoom and the export (or full-size Proof) of the same project, pixel for pixel, on the fixtures in section 8. Each limit has a typical bound (99% of pixels) and a ceiling (every pixel), so one outlier cannot hide behind an average.

### 4.1 Tone and colour

| Quantity | 99% of pixels | Every pixel |
|---|---|---|
| Luminance, SDR and HDR | within 2% | within 5% |
| Colour difference in OKLab | 0.01 | 0.03 |

For reference, the Match quality gates already use OKLab errors of 0.04-0.05 as "acceptable match".

The comparison is against the export pipeline's pixels before encoding; codec error is reported separately (Steve, October 1). Both sides are compared as display-linear light with reference white at 1.0.

Luminance near black: a percentage of nothing is undefined, so the relative error is measured against the larger of the export's luminance and a floor of 1% of reference white (about 2 nits at a 203-nit white). Below the floor the same percentages apply to the floor itself, and the OKLab limit carries the judgement of visible difference. Steve delegated this choice on October 1 with perceptual similarity as the aim; it is implemented in `tests/performance/preview_export_compare.py`.

8-bit presentation targets (decided October 1; Steve took the recommendation, "if it looks pretty much the same then I'm OK"): when the preview's target is 8-bit, a pixel whose largest channel difference from the export is at most one level in the preview's own display encoding does not count against the limits above. One level is the smallest difference such a target can show, and near black it is several percent of luminance, so the percentages alone would fail a preview that is as close as its surface allows. Differences larger than one level are judged by the limits as written. The rule does not apply to a float target, where the HDR lane is presented. Implemented in the comparison tool at the start of phase 1: an exempt pixel stays in the population as a pixel inside the limits, and the report keeps the measured figures beside the judged ones.

### 4.2 Masks

| Mask kind | Limit |
|---|---|
| Soft (feathered brush, gradient, feathered path) | mask value within 2 of 255 levels (adopted October 1 for the brush feather; measured at 1) |
| Hard-edged (unfeathered hard brush, hard path) | edge position within 1 pixel at 100% |
| Any mask | no difference in which regions are affected; a mask must never appear, vanish or move by more than 2 pixels |

A mask is treated as soft only when the app can show it meets the soft limit. Anything it cannot show takes the hard-edged path.

### 4.3 HDR: the strict part

| Quantity | While editing | Export and Proof |
|---|---|---|
| Reported peak luminance | within 1% of the exact value (Steve's phase 2 decision: keep the accurate measurement) | exact, measured at full resolution |
| Delivered peak | not applicable | never above the configured target; highlight compression enforces this from the exact measurement |
| Highlight compression curve | driven by the editing-time measurement | re-derived from the exact measurement |

If the editing-time and exact measurements differ by more than the editing limit, Proof and the export report it.

### 4.4 Views below 100%

A zoomed-out view is an approximation by nature: detail, sharpening and grain cannot be judged there. The requirement is continuity, not agreement with export: averaged over an 8 x 8 screen-pixel block, tone and colour at any zoom agree with the 100% view within the section 4.1 typical limits.

### 4.5 What stays bit-exact

- Exporting the same project with the same settings twice gives identical files.
- Full-size Proof equals export (section 3).
- Opening and saving a project without edits does not change it.
- Unfeathered and unedited content is not altered by any approximation meant for soft masks.

### 4.6 How tolerance is tested

- One comparison tool renders the preview at 100% and the export for the same region and reports the section 4.1-4.3 statistics. Tests assert against the limits above; they do not hash preview pixels.
- Mask approximations are fuzzed against the exact computation (the October 1 feather fuzz covered 500 randomized masks: soft, hard-edged, small, large, frame-edge, pressure-varying, erased, inverted and shifted).
- Local Detail controls are covered explicitly: texture, clarity, clarity radius, sharpen, radius, threshold and adjustment opacity, each at low, default and maximum values.
- A change inside the written limits needs no further sign-off. A change that needs a wider limit is an owner decision.

## 5. Architecture revisions

Each item states the outcome. How to reach it is for the implementer, who has the code.

### 5.1 Masks

- A soft mask is drawn from a small bitmap at every zoom level. Zooming in does not trigger a compile or an upload for it.
- A hard-edged mask is exact, and is produced only for the visible region plus a margin. Panning brings in new regions without a whole-image compile.
- Which path a mask takes is decided per mask by a measured test, with the conservative path as the default.
- Memory and time per additional mask are small enough that 50 locals on a 42 MP image stay interactive (targets in section 6).
- Background: the brush feather rescales to the painted peak across the whole image, which is why feathered masks could not be computed per region. Feathered masks are the soft case, so this no longer blocks anything; the behaviour itself ("a small mark feathered heavily stays as strong") is kept.

### 5.2 Rendering at and above 100%

- Only the visible region plus a margin is rendered. Frame time does not depend on image size.
- Panning and zooming show complete pixels at all times; a region catching up must not be visible as a seam.

### 5.3 Peak measurement and automatic highlight anchors

- While editing, the measurement is bounded in cost and never forces whole-image, full-resolution masks.
- The accuracy design is Steve's and is the product's differentiator. The implementer reads it first and proposes how far the editing-time measurement can relax within section 4.3 before changing anything.
- Export and Proof measure exactly.

### 5.4 Everything interactive on the GPU

- Mask rasterization and feathering for brush, path, gradient and luminance masks.
- Match candidate evaluation. Interim step, already measured: independent candidates rendered in parallel on the CPU (six candidates, 1.48 s to 0.50 s, identical pixels).
- Every local and global control. No setting should send an interactive edit to a whole-frame CPU render.
- The navigation thumbnail and scopes, or else strictly idle-time CPU work that never competes with an edit.
- The CPU pipeline remains the export and Proof implementation. Preview and export are two implementations held together by section 4, not by identical bytes.

### 5.5 Simplification

Much of the recent code exists to manage multi-second CPU jobs: request cancellation, shared compiles, cache eviction order, background prewarming, CPU request coalescing. Once jobs are viewport-sized, remove what no longer earns its place. Deleting code is a deliverable of this work.

### 5.6 Detail agrees between preview and export

Decided by Steve on October 1: the preview and the export should be very similar with Detail in use. Some tolerance is fine, but they must match perceptually. There is no separate, wider limit for Detail.

- With global or local Detail active (texture, clarity, clarity radius, sharpen, radius, threshold, microcontrast), the preview at 100% agrees with the export within section 4.1.
- Baseline to beat (section 11.3): on the primary fixture as saved, the HDR lane differs by 4.5-7.2% at the 99% bound and 14-35% at the worst pixel; with Detail off it is inside every limit.
- The cause is not established. The implementer measures which Detail stage diverges and reports it before changing either implementation. The export's result is the reference unless Steve decides otherwise.

## 6. Targets

Accepted by Steve on October 1 as the goals to aim for ("very happy if we hit those"). The October 1 baseline against them is in section 11.4.

On the reference workstation with the primary fixture and with Steve's four-mask 42 MP case:

| Interaction | Target |
|---|---|
| Zoom to 100% or 200%, any time, including right after a mask edit | exact-within-tolerance picture in 300 ms |
| Brush stroke or feather release | 100 ms |
| Slider drag, any module | first feedback within one frame; settled within 100 ms of release |
| Pan at 100% | complete pixels every frame |
| Match | 2 s |
| 50 locals on 42 MP | every target above within 2x |
| First 30 seconds on a fresh image | no single wait above 1 s after import completes |

## 7. Phases

| Phase | Content | Exit |
|---|---|---|
| 0 | Steve edits and approves section 4. Build the preview-versus-export comparison tool. Verify Proof against section 3 and fix any gap. Record a baseline of the section 6 interactions. | Limits approved; comparison tool and Proof test passing; baseline recorded |
| 1 | Masks (5.1) and region rendering (5.2). | Section 6 zoom and brush targets met on both fixtures; section 4.2 holds; 50-local case measured |
| 2 | Peak measurement (5.3). | Editing-time measurement bounded; section 4.3 holds; export and Proof exact |
| 3 | Remaining GPU work (5.4): mask rasterization, Match, control gaps, thumbnail and scopes. Detail agreement (5.6). | No interactive edit reaches a whole-frame CPU render; Match target met; primary fixture as saved inside section 4.1 |
| 4 | Simplification (5.5). | Removed code listed; suites green |

Until 5.6 is done, the primary fixture as saved cannot pass section 4.1 for a reason unrelated to masks. Phase 1 is therefore judged on tone with global Detail switched off in the session (the comparison tool's `--set` option) and on masks with the fixtures as saved. Detail agreement sits in phase 3 with the other control work; Steve may pull it forward.

Phases 1 and 2 are linked: a whole-image native peak measurement would force hard masks back to whole-image compiles, so phase 1 must not depend on that measurement.

## 8. Fixtures and evidence

- The primary fixture above (five locals, cropped, 34-stroke feathered brush). Its source decodes to 7,362 x 4,920 (36 MP) and the cropped output is 4,608 x 4,608.
- Steve's case: a 42 MP Sony RAW, uncropped, with a linear gradient, a luminance range, a path and a brush, each with an exposure adjustment. Built on October 1 from `D:\Photos\HDR Test Images\DSC00264.ARW` (5,320 x 7,968, 42.4 MP; read-only) as `codebase/local-test-media/viewport/DSC00264-four-masks.hdrfinisher` by `tests/performance/make_four_mask_fixture.py`. The path is unfeathered, so it also serves as a hard-edged case; the brush is feathered.
- A synthetic 50-local project for the scaling target: `DSC00264-fifty-locals.hdrfinisher` beside it, from the same script with `--locals 50`.
- An architecture image with hard-edged path masks for section 4.2.
- Diagnostic driver: `tests/performance/zoom-after-edit-review.js` (stroke, zoom immediately, zoom after a pause, with and without local Detail, with a new local).
- October 1 measurements: sprint doc section 14; artifacts under `codebase/output/performance/review/rootcause-2026-10-01/`.

## 9. State of the code on October 1

- The working tree holds uncommitted changes from the October 1 pass: abort cancellation, mask-identity cancellation and shared compiles, mask cache eviction, overlay edge sharing, threaded brush rasterizer, reduced-resolution brush feather, plus earlier uncommitted measurement instrumentation. They are described in the sprint doc, section 14.
- Three tests fail and predate that pass: the frontend contract count (`test_frontend_inventory_contract.py`), a shader byte-hash check (`webgpu-shaders.test.js`), and the live-Feather comparison in `brush-mask-interaction.js`.
- The shader byte-hash test will need a decision: this work changes shaders by design.

## 10. Risks and open questions

- **October 3 consolidated issues:** GPU Shift Edge/resampling/path gaps,
  unqualified brush fallback, primary stroke/feather/native-zoom latency,
  missing real authored-SDR native coverage, two-to-three-level trial masks
  and existing suite failures are recorded in the
  [phase 3 exit audit](../technical/archive/viewport-phase3-exit-audit-2026-10-03.md).
  These newly collected gaps have not been accepted or deferred by Steve.
  The earlier Match, Peak and SDR continuity decisions remain unchanged.
- **Open issue P3-ZOOM-01 — SDR cross-scale colour continuity.** The four-mask
  fixture at 50% versus 100%, averaged over 8-screen-pixel blocks, has luminance
  p99 3.3494% against the unchanged 2% typical limit. A settled manual anchor
  and disabled locals leave the failure; monochrome passes at 0.6327%. This
  is separate from the Peak issues. Steve deferred it on October 2 because it
  is close to the limit and authorized continuing other phase 3 work. The
  accuracy limit remains unchanged; see section 14.13.
- **Peak accuracy.** Relaxing the editing-time measurement touches the feature Steve invested in most. Phase 2 starts with a read of that design and a proposal, not a change.
- **Open issue P3-PEAK-01 — wide-Clarity editing Peak.** Amount 100 / radius 3%
  can exceed the 4,194,304-pixel measurement budget and leave the readout
  19.3% below export. Steve authorized deferring this redesign and continuing
  phase 3 on October 2. Close only when a bounded implementation meets the
  unchanged 1% requirement on this case; preserve the passing picture checks.
  Evidence and decision are in section 14.9.
- **Open issue P3-PEAK-02 — post-Sharpen candidate coverage.** With Sharpen
  200/radius 3/threshold 0, Texture/Clarity off and all locals disabled, Peak
  is 9.3745% below export. The measurement completes inside its budget but
  omits the export maximum's patch. Picture limits pass after the signed HDR
  repair. Steve authorized deferring both Peak issues and continuing other
  phase 3 work on October 2; see section 14.11.
- **Two implementations.** GPU preview and CPU export will drift unless the comparison tool runs in the regular suites.
- **Hard masks at very high zoom-out.** A hard mask shown at Fit is itself a small bitmap; confirm the visible-region path and the Fit path agree at the threshold between them.
- **Tiled and whole-frame render paths.** Both exist today and both read masks. Decide whether region rendering replaces the whole-frame path at 100% and above or sits beside it.
- **Soft-mask threshold.** Estimated, not measured: a Fit-size bitmap can carry an edge about 40 px wide at 100% on a 42 MP image; a 4K bitmap about 15 px. Whether a middle tier is worth having depends on how many real masks fall between.
- **Healing brush.** Not designed. It reads image content, so it will need its own region rule; this PRD only requires that the mask and render design not preclude it.
- **Phase 2 decision:** keep the editing-time peak limit at 1%; do not widen it for speed. Steve subsequently directed the work to the zoom delay while keeping that measurement.
- **Open:** should Proof default to full size? (Phase 0 left the default at Reduced: a full-size Proof measured 229 s on the primary fixture.)

## 11. Phase 0 record (October 1, 2026)

Reference workstation, Electron development build at 2560 x 1440 and DPR 1, disposable profile. Both fixture projects and both RAW files were only read; their hashes were unchanged after the runs. Artifacts: `codebase/output/performance/review/viewport-phase0-2026-10-01/`. Sample counts are given with every figure. No mask, renderer, peak-measurement, highlight-anchor or shader code was changed.

### 11.1 What was built

| Item | Where |
|---|---|
| Proof size choice (Reduced / Full size), reduced label in status line, viewer note and watermark | `backend/hdr_finisher/models.py`, `proofing.py`; `frontend/index.html`, `app.js`, `proofing-ui.js`; `docs/user-guide/proof.md` |
| Full-size Proof equals export, byte for byte (three HDR formats, four mask kinds, frame larger than the old cap) | `tests/test_proof_export_identity.py` |
| Proof size choice and labels in the running app | `tests/proof-size-interaction.js` |
| The comparison tool (section 4.6) and tests of its arithmetic | `tests/performance/preview-export-compare.js`, `preview_export_compare.py`, `tests/test_preview_export_compare.py` |
| Proof identity on a real project, fixture builder, baseline summary, Peak readout | `tests/performance/proof_export_identity.py`, `make_four_mask_fixture.py`, `summarize-viewport-baseline.js`, `peak-readout-review.js` |

Suites after the change: Python 1,561 pass, Node 332 pass. The only failures are the two that predate this work (`test_frontend_inventory_contract.py`, the shader byte-hash test). `brush-mask-interaction.js` was not run. Phase 0 did not depend on any of the three.

### 11.2 Proof against section 3

| Check | Result |
|---|---|
| Full-size Proof versus export, primary fixture (4,608 x 4,608 output, five locals) | identical files in 3 of 3 formats (JPEG Ultra HDR, AVIF gain map, JPEG XL HDR) |
| Full-size Proof versus export, synthetic 2,000 x 1,300 frame with gradient, luminance, path and brush | identical in 3 of 3 formats |
| Same export twice | identical in 3 of 3 formats |
| Time, JPEG Ultra HDR on the primary fixture, nothing else running (1 sample) | export 118 s, full-size Proof 229 s |

A full-size Proof costs about twice an export because the Proof store renders both branches again after the export has rendered them. That is unchanged existing behaviour and a candidate for later work.

### 11.3 Preview versus export at 100%

Three regions of 1,938 x 1,005 pixels per lane (1.95 million pixels each), one capture per region. The capture is taken on the tiled route, the only one that retains a readable frame; the app itself chose the Direct route at 100% on both fixtures. A screenshot check of the centre region found the two routes within 2 of 255 levels (four-mask fixture, both lanes) and within 1 level (primary, SDR lane).

Luminance error is the 99% bound / the worst pixel; OKLab likewise. Limits: 2% / 5% and 0.01 / 0.03.

| Fixture, lane, variant | Luminance | OKLab | Within limits |
|---|---|---|---|
| Primary, HDR, as saved | 4.5-7.2% / 14-35% | 0.006-0.014 / 0.033-0.086 | no |
| Primary, HDR, grain off | 4.5-7.2% / 14-36% | 0.006-0.014 / 0.033-0.088 | no |
| Primary, HDR, global Detail off | 0.37-0.45% / 0.61-0.68% | 0.0004-0.0017 / 0.0012-0.0026 | yes |
| Primary, HDR, Detail and Film Look off | 0.33-0.36% / 0.51-0.55% | 0.0004-0.0014 / 0.0010-0.0022 | yes |
| Primary, SDR, as saved | 1.4-8.3% / 7.9-24% | 0.002-0.008 / 0.012-0.027 | no |
| Primary, SDR, global Detail off | 1.3-3.0% / 1.9-3.4% | 0.002 / 0.003 | one region over the 2% bound |
| Four-mask, HDR | 0.25-0.28% / 0.37-8.0% | 0.001-0.002 / 0.002-0.136 | 2 pixels of 5.8 million over the ceiling |
| Four-mask, SDR | 73-77% / 80-81% | 0.15-0.17 / 0.16-0.18 | no |

What the measurements show:

1. **Global Detail is the difference on the primary fixture.** With clarity 47, sharpen 93 and microcontrast 23, the GPU preview and the CPU export differ pixel by pixel: about 1.5% standard deviation, noise-like, with no positional offset (a one-pixel shift raises the error to about 47%). The difference averages down with block size (8 x 8 block means: 0.8-1.8% at the 99% bound) and the export carries slightly more fine contrast. Turning Detail off brings the HDR lane inside every limit. Grain is not the cause: turning it off changed nothing.
2. **SDR highlights on the four-mask fixture differ visibly.** The SDR preview shows the window highlights near white; the SDR export renders them darker (0.93 against 0.52 of white at the worst pixel). The export fits its shoulder to the peak it measures at full resolution; the preview fits to its editing-time anchor. This is the section 4.3 case, and nothing reports it today. The cause was not investigated further because the peak and anchor code is out of scope for phase 0.
3. **The two over-ceiling HDR pixels on the four-mask fixture** are near-black pixels where the preview holds exactly 0 and the export 0.14-0.23 nits.
4. **Masks agree exactly.** Every mask the backend served the renderer matched the export's mask in every region and lane (0 levels, 0 pixels of edge displacement; 5 locals on the primary fixture, 4 on the four-mask fixture). This is expected today, since both come from the same CPU code, and is the baseline phase 1 must hold within section 4.2. The renderer's own mask textures cannot be read back; phase 1 needs that readback before a GPU-made mask can be measured.
5. **An 8-bit SDR target limits what the percentages can show.** One 8-bit level near the luminance floor is several percent. The tool records the difference in levels beside the percentages (primary SDR as saved: 0.7-1.9 levels at the 99% bound, 3.3-7.7 at the worst pixel). Steve has since decided that a one-level difference on an 8-bit target does not count (section 4.1); the figures in the table above predate that rule and were judged without it.

### 11.4 Reported peak (section 4.3)

| Reading | Primary | Four-mask |
|---|---|---|
| Export, exact, before encoding | 638.2 nit | 3,209.0 nit |
| Scope panel, Exact Peak on | 636.6 nit (0.25% low) | 3,209 nit (0.01% high) |
| Scope panel at Fit, as opened ("Peak (preview)") | 616.8 nit (3.4% low) | 2,460 nit (23% low) |
| Scope panel at 100%, tiled route forced (labelled "Peak") | 615.5 nit (3.6% low) | 2,460 nit (23% low) |

One reading each. The preview picture itself is right at the peak pixel (3,204 against 3,209 nits on the four-mask fixture); it is the reported figure that is low. On the four-mask fixture 189 export pixels exceed 2,500 nits. The exact measurement meets the 1% the current tests hold. The default editing-time figure does not meet 3% on either fixture. On the forced tiled route the panel uses the label it reserves for a measured peak while showing the lower value. These are inputs to the phase 2 proposal; nothing was changed.

### 11.5 Baseline against section 6

Median (maximum), milliseconds, from the action to the exact picture. "Stable" adds the scopes settling.

| Interaction | Target | Primary | Four-mask, 42 MP |
|---|---|---|---|
| Zoom to 100% right after a stroke, project as opened (n=3) | 300 | 3,593 (4,711) | 3,532 (3,580) |
| Zoom to 200% right after a stroke, project as opened (n=3) | 300 | 3,557 (4,350) | 3,094 (3,180) |
| Zoom to 100% 6 s after a stroke (n=3) | 300 | 166 (175) | 1,476 (1,511) |
| Zoom to 100% right after a stroke, local Detail on (n=3) | 300 | 1,881 (1,983) | 1,493 (1,549) |
| Zoom to 100% 6 s after a stroke, local Detail on (n=3) | 300 | 1,882 (1,883) | 1,508 (1,534) |
| Zoom to 100%, nothing changed (n=3) | 300 | 174 (180) | 216 (305) |
| Zoom to 100% right after creating a local (n=3) | 300 | 759 (836) | 1,054 (1,054) |
| Zoom to 100% inside a 5-minute editing session (n=25 / 29) | 300 | 2,114 (4,492) | 1,608 (3,653) |
| Fresh brush stroke, HDR (n=25 / 29) | 100 | 209 (495) | 135 (231) |
| Fresh brush stroke, SDR (n=25 / 29) | 100 | 207 (285) | 141 (245) |
| Feather release to exact, HDR (n=25 / 29) | 100 | 176 (279) | 56 (129) |
| Feather release to exact, SDR (n=25 / 29) | 100 | 179 (324) | 76 (111) |
| Slider first feedback, exposure and clarity, both lanes (n=100 / 116) | one frame | 10-14 (25) | 8-14 (27) |
| Slider release to exact (n=100 / 116) | 100 | 0 (0) | 0 (0) |
| Feather drag, first feedback after the first input (n=50 / 58) | one frame | 819-834 (1,050) | 698-716 (784) |
| Pan at 100%, to stable (n=25 / 29) | complete pixels every frame | 20 (59) | 6 (144) |
| Match (n=6) | 2,000 | 9,297 (9,781) | 4,847 (5,416) |
| Wait from import complete to the exact picture (n=3) | 1,000 | 556, 100, 101 | 345, 72, 47 |
| Wait from import complete to settled scopes (n=3) | 1,000 | 2,159, 163, 179 | 2,094, 152, 115 |

50 locals on 42 MP (one run, times to stable): every zoom to 100% took 23.6-24.8 s (n=6), including the zoom with nothing changed; return to Fit 826-997 ms (n=6); a brush stroke 108-253 ms to stable (n=4).

Notes on reading the table:

- The slider release figure is 0 because the exact frame is already on screen when the pointer is released.
- The feather drag gives no picture update during a 500 ms drag; the first frame arrives after release.
- Pan is measured as time to a stable state. At 100% the app rendered the whole frame on the Direct route, so a pan exposed no unrendered region; "complete pixels every frame" was not measured per frame.
- The import rows are three imports of the bare RAW (no project) in one app process; only the first is cold.
- The "first 30 seconds" target was not measured as a scripted 30-second session. The rows above are its components.

### 11.6 Decisions taken after phase 0 (Steve, October 1)

| Question | Decision | Recorded in |
|---|---|---|
| Should Proof carry export resize, output sharpening and metadata policy? | Not for now. | Section 3 |
| On an 8-bit target, does a one-level difference count against section 4.1? | No. Differences above one level are judged as written. To be implemented in the comparison tool. | Section 4.1 |
| Global Detail: converge the two implementations or accept a stated difference? | Converge. They should match perceptually, inside the section 4.1 limits; no wider limit for Detail. | Section 5.6, phase 3 |

Decisions at the start of phase 1 (Steve, October 1):

| Question | Decision |
|---|---|
| Shader byte-hash test | Keep the byte pins on the peak-measurement and Denoise shaders, which phase 1 must not touch. Remove the pins on the picture and mask shaders, which change by design; the comparison tool's limits hold what they draw. Done in `tests/webgpu-shaders.test.js`. |
| Mask readback | Approved. A diagnostic probe in the picture shader reports the mask each local pass sampled; the local passes and the probe share one sampling function. Done (`readLocalMaskRegion`). |
| Soft or hard, per mask | Decide from the mask's own settings (how steep its steepest edge is), with the threshold set by measurement against the exact mask. Replaces the proposed compile-at-two-sizes check. |
| A feathered mask slightly over the 2-level limit | Not decided; Steve wants to see it on screen first. Until then, judge by what a person can perceive at 100% on a 32-inch 4K display. Any mask over 2 levels is reported so it can be looked at. |
| CPU-side complexity | Keep it simple. Interactive work belongs on the GPU; the CPU is a fallback and the export and Proof reference. No new CPU machinery to chase a preview target. |

First readback results (one capture per region, three regions of 1.95 million pixels per lane, both fixtures; artifacts `codebase/output/performance/review/viewport-phase1-2026-10-01/readback-*.json`): every mask the backend serves reads back within 0.12 levels of the export's on both routes, and the GPU-made linear gradient within 0.11. On the Direct route, which the app chose at 100% on both fixtures, the GPU-made luminance mask differs from the export's by up to 1.54 levels on the primary fixture and up to 2.25 on the four-mask fixture (39 and 62 pixels over 2 levels in two of three regions), and an unfeathered path reads up to 1.99 levels off on its edge pixels with the edge itself in place. These predate phase 1's mask changes.

Still open:

- The SDR highlight difference (11.3, item 2) and the low default Peak figure (11.4). Both concern the editing-time measurement and belong to the phase 2 proposal; the numbers above are its baseline.
- The two near-black HDR pixels on the four-mask fixture (11.3, item 3) exceed the every-pixel ceiling. Not investigated.
- The shader byte-hash test (section 9) needs a decision before phase 1 changes a shader.
- Whether Proof should default to full size (section 10).

## 12. Phase 1 record (October 1, 2026)

Reference workstation, Electron development build at 2560 x 1440 and DPR 1, disposable profile, drivers run one at a time. Both fixture projects, the 50-local project and both RAW files were only read; their hashes were unchanged after the runs. Artifacts: `codebase/output/performance/review/viewport-phase1-2026-10-01/` (the figures below are from `record/`). Nothing is committed. No peak-measurement or highlight-anchor code was changed, and the peak-reduction and Denoise shaders are byte-identical (their pins in `tests/webgpu-shaders.test.js` pass).

### 12.1 What was built

| Item | Where |
|---|---|
| The 8-bit rule of section 4.1, and the two rulings of 12.5, in the comparison tool | `tests/performance/preview_export_compare.py`, `tests/test_preview_export_compare.py` |
| Mask readback: the value each local pass sampled, drawn through the same shader function the local passes use, on whichever route drew the frame | `frontend/webgpu-shaders.js` (`localMaskValue`, `localMaskProbeFragmentMain`), `frontend/webgpu-preview.js` (`readLocalMaskRegion`), `tests/performance/preview-export-compare.js` |
| Soft masks: the bitmap the Fit view compiled is stretched over a magnified frame, placed exactly inside a cropped frame; zooming in neither compiles nor uploads it | `frontend/webgpu-shaders.js` (`maskUv`), `frontend/webgpu-preview.js` (`softLeafMask`), `frontend/mask-loader.js` |
| The soft-mask rule: per bitmap, from how sharply the bitmap bends, how far it changes at the frame edge, and what the brush's settings say about small marks; anything not shown to be soft takes the exact path | `backend/hdr_finisher/mask_softness.py`, `tests/test_mask_softness.py`, `tests/performance/soft_mask_fuzz.py`, `soft_mask_survey.py` |
| Hard-edged masks for the visible region only: gradient, path, unfeathered brush and luminance masks are evaluated for the rectangle around the requested tiles | `backend/hdr_finisher/local_adjustments.py` (`compile_geometry_fixed_mask_region`), `render_cache.py`, `main.py`, `tests/test_mask_region.py` |
| Region rendering at and above 100%: a magnified view, including a drag frame, is drawn for the visible region plus a margin on the tiled route; the rest of the frame shows the last finished frame stretched until it is drawn; a pan draws what it exposes | `frontend/webgpu-preview.js`, `frontend/webgpu-shaders.js` (`placeholderFragmentMain`), `frontend/render-coordinator.js` (`regionRoute`), `frontend/app.js` |
| Mask tiles kept by position instead of by edit revision, so an edit to one local no longer refetches every other local's tiles | `frontend/mask-loader.js` |

Suites after the change: Python 1,610 pass and Node 335 pass. One Python test fails and predates this work (`test_frontend_inventory_contract.py`). The shader byte-hash test passes under the decision in 11.6. Twelve Electron drivers pass (`local-adjustments-interaction`, `gradient-mask-interaction`, `luma-mask-interaction`, `mask-graph-interaction`, `full-tier-brush-feather`, `tiled-direct-parity`, `full-tier-preview`, `roi-parity`, `roi-pan-cache`, `roi-catch-up`, `preview-resolution-interaction`, `lane-roundtrip-interaction`). Three Electron drivers fail, and fail identically on a clean copy of the last commit: `brush-mask-interaction` (known), `path-mask-interaction` (node insertion times out) and `tiled-admission-scope-fallback` (the low budget no longer forces Tiled).

### 12.2 Masks against the export (section 4.2)

Three regions of 1.95 million pixels per lane, one capture per region, captured on the route the app chose (tiled; nothing is forced any more). Largest difference in 255ths over the three regions.

| Fixture | Mask | Drawn from | Largest difference | Pixels over 2 |
|---|---|---|---|---|
| Primary | Main brush, 34 strokes, feathered | Fit bitmap, 1,006 px | 1.91 | 0 |
| Primary | Gradient | Fit bitmap, 1,006 px | 0.98 | 0 |
| Primary | Unfeathered brush | 3,200 px bitmap (2,003 px after crop) | 1.06 | 0 |
| Primary | Luminance | GPU, whole frame | 1.54 | 0 |
| Primary | Feathered brush, 3 strokes | Fit bitmap, 1,006 px | 1.05 | 0 |
| Four-mask | Gradient | GPU, per tile | 0.11 | 0 |
| Four-mask | Luminance | GPU, whole frame | 2.25 | 101 of 5.8 million |
| Four-mask | Path, unfeathered | Backend, visible region | 0.00 (edge 0 px) | 0 |
| Four-mask | Feathered brush | Fit bitmap, 671 px | 1.00 | 0 |

Every mask is inside the approved limits except the four-mask luminance mask, which is inside the working limit of 12.5 and is the same GPU-made mask the app drew before this work (11.6). Tone with global Detail off is inside section 4.1 on the primary fixture in both lanes (HDR 0.39-0.74% at the 99% bound, 1.0-1.7% at the worst pixel; SDR passes under the 8-bit rule). The four-mask HDR lane is unchanged (the same two near-black pixels); its SDR lane is the phase 2 highlight difference.

The soft-mask rule on 300 random masks at two bitmap sizes (600 cases, 7,200 x 4,800 frame): 187 judged soft, of which none differed from the exact mask by more than 3 levels (largest 2.75) and 10 by more than 2. A feathered brush with small hard marks or Shift Edge, and most masks with steep edges, are judged not soft.

### 12.3 Speed against section 6

Median (maximum) milliseconds from the action to the exact picture; baseline from 11.5.

| Interaction | Target | Primary: before | Primary: now | Four-mask: before | Four-mask: now |
|---|---|---|---|---|---|
| Zoom to 100% right after a stroke, project as opened (n=3) | 300 | 3,593 (4,711) | 991 (2,106) | 3,532 (3,580) | 939 (950) |
| Zoom to 200% right after a stroke, project as opened (n=3) | 300 | 3,557 (4,350) | 818 (981) | 3,094 (3,180) | 835 (952) |
| Zoom to 100% 6 s after a stroke (n=3) | 300 | 166 (175) | 305 (309) | 1,476 (1,511) | 218 (225) |
| Zoom to 100% right after a stroke, local Detail on (n=3) | 300 | 1,881 (1,983) | 205 (259) | 1,493 (1,549) | 573 (586) |
| Zoom to 100% 6 s after a stroke, local Detail on (n=3) | 300 | 1,882 (1,883) | 2,067 (2,267) | 1,508 (1,534) | 328 (351) |
| Zoom to 100%, nothing changed (n=3) | 300 | 174 (180) | 152 (240) | 216 (305) | 120 (121) |
| Zoom to 100% right after creating a local (n=3) | 300 | 759 (836) | 367 (433) | 1,054 (1,054) | 488 (749) |
| Zoom to 100% inside a 5-minute session (n=25 / 31) | 300 | 2,114 (4,492) | 617 (1,512) | 1,608 (3,653) | 136 (1,807) |
| Fresh brush stroke, HDR (n=25 / 31) | 100 | 209 (495) | 206 (333) | 135 (231) | 140 (229) |
| Fresh brush stroke, SDR (n=25 / 31) | 100 | 207 (285) | 199 (577) | 141 (245) | 146 (222) |
| Feather release to exact, HDR (n=25 / 31) | 100 | 176 (279) | 197 (262) | 56 (129) | 89 (200) |
| Feather release to exact, SDR (n=25 / 31) | 100 | 179 (324) | 200 (885) | 76 (111) | 80 (139) |
| Slider first feedback (n=100 / 124) | one frame | 10-14 (25) | 10-14 (18) | 8-14 (27) | 8-14 (16) |
| Return to Fit (n=25 / 31) | - | not recorded | 101 (118) | not recorded | 105 (129) |

50 locals on 42 MP (one run): zoom to 100% took 339 to 2,351 ms to the exact picture over six zooms (339, 432, 449, 949, 2,036, 2,351), against 23.6-24.8 s before; return to Fit 248-258 ms against 826-997 ms; a brush stroke 110-148 ms. The 2x target (600 ms) is met by three of the six zooms.

What the table shows:

1. **The zoom target is met when the masks in play are soft and the frame's source is on the GPU, and not otherwise.** The cases still over 300 ms are: the first zoom of a session (the source for the frame has to be fetched, 0.6-0.9 s at 42 MP, and every hard-edged mask evaluated for the region for the first time); a zoom right after a new hard-edged or steep mask (0.2-0.5 s of CPU for the region); and the primary fixture's main brush once more strokes have been added to it (item 2).
2. **The primary fixture's main brush is at the edge of the rule.** It has 33 erase strokes with fairly hard edges, and erase is applied after the feather. As saved it is soft (1.91 levels). After the driver's fourth added stroke the rule's estimate passes 3 at both bitmap sizes, so it takes the exact path: a whole-image compile, about 2 s, as before this work. That is the conservative default working as designed, and it is the one case no faster than the baseline.
3. **The brush and feather targets are not met, and are not faster.** Compiling the Fit bitmap on the CPU is the cost (about 60-135 ms a stroke on these fixtures) and the soft-mask verdict adds 10-30 ms to a feather release. Painting and feathering on the GPU (5.4, phase 3) is what moves these.
4. **Region rendering does not make a frame faster on these images on this card.** The visible region plus its margin, in whole tiles with their halos, is 10-13 MP, about half of the primary frame. Its gains here are the source and the hard-edged masks no longer being whole-image work; the frame-time gain is for larger images.

### 12.4 Not met, and open

- **Section 6 zoom target** in the cases of 12.3 item 1 and 2. **Brush and feather targets** (item 3).
- **Luminance masks.** On the tiled route they are made on the GPU only when the whole frame's HDR source is resident, so a frame with one fetches the whole source instead of a region; in the SDR lane, or before that source arrives, they are evaluated on the CPU for the region (about 1 s at 42 MP). Making them per region on the GPU belongs with 5.4.
- **Panning.** A pan inside the margin (15% of the viewport on each side) shows drawn pixels. Beyond it the newly exposed area shows the last finished frame stretched (soft, and from before the latest edit if edits were made while magnified) until the pan pass draws it, about 140 ms after the pan stops plus the pass. The rest of the frame is completed in the background only when that needs no mask from the backend; with a hard-edged mask in play it is not, because that would compile the mask for the whole image. "Complete pixels every frame" was not measured per frame.
- **The first zoom after a lane switch at 100%** has no finished frame of that lane to stretch and shows black outside the visible region until the pan pass or catch-up draws it.
- **Peak measurement (phase 2)** still runs whole-image passes after an edit and now shares the tiled route's mask tiles with the viewer; the tiles under the frame on screen are protected from it.
- Section 4.4 (views below 100%) was not measured.

### 12.5 Decisions taken during phase 1 (Steve, October 1)

| Question | Decision |
|---|---|
| Working limit for gradual masks | Up to 3 levels may be tried for feathered and luminance masks while he judges it on screen; the approved limit stays 2. The comparison tool passes such a mask and lists it (`masksOverApprovedSoftLimit`). Sharp-edged masks keep their limit. |
| The "moved by more than 2 pixels" check on gradual masks | It applies to edges. A gradual mask is judged by its values, because a difference too small to see moves its halfway line a long way where the mask is nearly flat. |

Changed along the way, for Steve's attention: the viewport handed to the tiled route was computed against the wrong frame size on cropped images and was corrected as part of the region route (`gpuFrameSizeAt` in `app.js`); the mask overlay now asks for the Fit-size bitmap at a magnified view instead of having a third size compiled.

### 12.6 Closure (Steve, October 1)

Steve tried the phase 1 build in the desktop app and closed the phase: "current performance is acceptable". The phase 1 exit in section 7 asked for the section 6 zoom and brush targets on both fixtures; they are not met in the cases listed in 12.3 and 12.4, and that gap is accepted for now and carried to phase 3 (5.4), where painting and feathering masks on the GPU addresses it. The section 6 targets themselves are unchanged.

Not decided at closure, and left as they are:

- The working limit of 3 levels for gradual masks (12.5) is still a trial; the approved limit is 2.
- The larger bitmap tried once for a mask the Fit bitmap cannot carry (12.2, the primary fixture's unfeathered brush) was added without being asked for, against the preference for no extra CPU-side machinery. It stays until Steve says otherwise.
- Panning per frame and views below 100% (section 4.4) were not measured.

## 13. Phase 2 working record — accuracy retained, zoom delay investigated (October 2)

Steve chose to keep the accurate editing measurement (1%) and then directed work to the zoom delay. The bounded measurement, SDR anchor correction and delivery warnings are implemented. Sections 13.2–13.3 record the earlier checkpoint and its unresolved slowdown; section 13.4 records the subsequent investigation and final checks. On Steve's instruction to follow the external review, a local checkpoint was made on `viewport-bounded-preview-phase-2-wip`, commit `4f4e72d`. Steve subsequently accepted the final report and authorized committing and pushing the later scheduling/disclosure fixes and this record on October 2. No tolerance was widened and no phase 3 or 4 work was started. Faster pictures do not imply faster scope settlement after every edit; both are reported below.

### 13.1 Measurement and delivery

- At import, the CPU keeps real RGB channel/luminance maxima and their positions from a 64-by-64 source grid, at most 16,384 candidates. Editing transforms this fixed list. The GPU ranks it and measures up to sixteen native 128-by-128 patches, including the graph's neighbourhood, with a total source-patch budget of 4,194,304 pixels.
- Editing masks are bounded bitmaps: 1,600 edge, or phase 1's existing qualified larger-bitmap fallback only where its bitmap fits that pixel budget. A refused measurement never falls back to a whole native source or mask. Robust anchors use a 1,600-edge proxy. These are estimates, labelled as such; unsupported evidence leaves a preview-only peak label.
- HDR's anchor remains the finished signal before output highlights. SDR's canonical background anchor now uses the prefix before display grading and locals, as the accuracy design requires. Phase 1's background native tiled anchor reduction instead read the finished SDR signal. The new maximum SDR reduction uses the unchanged pinned prefix shader on real source candidate RGB values. Source candidates also preserve isolated highlights lost by downsampling.
- Anchor keys are independent of zoom. Measurement does not replace the visible frame, its canvas dimensions, mask record or placeholder. A zoom immediately supersedes a pending measurement. Measurement has separate tile-graph and Clarity resources; measurement/magnified mask budgets cannot evict Fit bitmaps, and resident masks needed by the foreground frame are marked before trimming. A cancelled measurement's mask request cannot strand a zoom that joined it.
- Source transport now reuses a resident region containing the complete requested rectangle, with its original coordinates. This removes repeat loads when Clarity's required rectangle changes inside an already loaded one. The index-only geometry map selects the same 49 float32 coordinate samples without building whole coordinate images; its answers are bit-identical in the tested rotations/flips.
- Export and full-size Proof retain exact rendering and ceiling enforcement. They compare the current recipe's editing peak/anchor evidence with exact delivery measurements and display a warning above 1%. A cached full-size Proof compares each caller's estimates against its stored exact measurements; estimates do not change artifact identity. Reduced Proof does not make a native accuracy comparison.
- Peak-reduction and Denoise shader byte pins pass unchanged. The trial 3-level gradual-mask limit and larger-bitmap fallback qualification are unchanged. The known failing inventory/interaction drivers were not fixed and were not dependencies of this work.

### 13.2 Fresh accuracy checks

Artifacts: `codebase/output/performance/review/viewport-phase2-baseline-2026-10-01/`. Drivers ran serially in disposable Electron profiles, 2560 by 1440, DPR 1. The three fixture archives retain their original hashes and were never saved.

The fresh pre-change comparison measured the primary peak at 610.2 versus 629.7498 nit with global Detail off (3.1044% low), and the four-mask peak at 2,460 versus 3,208.967 nit (23.3398% low). The primary as-saved comparison was 615.5 versus 638.1938 nit (3.5559% low). These are one comparison run each; they replace assumptions based only on section 11's readings.

Final runs (`phase2-verified-*`):

| Measurement | Sample count | Result |
|---|---|---|
| Primary as saved, bounded HDR peak | 1 contract call; 5 panel conditions in 1 readout run | 636.5777 against 638.1938 nit: 0.2532% low; panel consistently says estimate |
| Primary with global Detail off, reported peak | 1 comparison run | 628.3176 against 629.7498 nit: 0.2274% low |
| Four-mask reported peak | 1 contract call; 5 panel conditions; 1 comparison run | 3,207.1181 against 3,208.967 nit: 0.0576% low |
| Bounded-work contract, maximum peaks and robust anchors in HDR/SDR | 4 calls per fixture, 8 total | All pass; native patch totals 2,096,704 pixels primary and 262,144 four-mask; no native whole-source/mask request; accepted picture/resources unchanged |
| Primary tone and masks, global Detail off | 3 captures of 1,947,690 pixels per lane | All verdicts pass |
| Four-mask SDR tone and all masks | 3 captures of 1,947,690 pixels per lane | Pass under the unchanged 8-bit rule; judged SDR luminance p99 0–0.2558%, maximum 1.4505% |
| Four-mask HDR tone | Same captures | Existing near-black ceiling outliers remain (maximum 8.0335%); not fixed in phase 2 |
| Former worst SDR window pixel, image coordinate (2247,4329) | 1 point in each capture | Preview 0.922914 before, 0.511093 now; exact export reference 0.509876 of white, same recipe |

The bounded-contract calls run after import and initial measurement settle; their warm maximum-measurement durations were 406/472 ms (HDR/SDR) on the primary and 246/310 ms on four-mask. Robust calls were 87/56 and 22/70 ms respectively. Robust percentile accuracy against a native reference was not measured by that contract; it verifies cost and frame isolation.

44 Node tests pass, covering source transport/cache reuse, mask cancellation/cache protection, peak single-flight, disclosure and shader pins. 27 Python tests pass, including bounded coordinate-map equivalence, exact export peak/ceiling measurement and full-size Proof/export file identity for the available encoders, with cached-warning and reduced-Proof checks. JavaScript syntax and diff whitespace checks pass.

### 13.3 Zoom checks and unresolved speed exit

Times below are action to the exact picture, separate from scope settlement. No speed tolerance was widened.

| Five-minute fresh-work session | Phase 1 section 12.3: median (max), samples | Phase 2 latest: median (max), samples |
|---|---|---|
| Primary zoom to 100% | 617 (1,512) ms, n=25 | 327 (1,483) ms, n=23 |
| Four-mask zoom to 100% | 136 (1,807) ms, n=31 | 229 (2,065) ms, n=27 |
| Primary return to Fit | 101 (118) ms, n=25 | 107 (116) ms, n=23 |
| Four-mask return to Fit | 105 (129) ms, n=31 | 108 (143) ms, n=27 |

The four-mask no-regression failure was checked against the untouched phase 1 HEAD in a separate checkout with the same current driver/runtime, serially: 148 ms median, 1,911 ms maximum, n=31 zooms (`phase1-today-session-fourmask.json`). The new build remains slower than that fresh reference. Before containing-region reuse, the new build took 721 ms median, n=26; the cache fix reduced that to 229 ms but did not close the gap. Both latest phase 2 sessions and the fresh reference finished without page errors.

The post-mask-cache zoom driver was also run three times at 100% on each fixture and three times at 200% (`phase2-pinned-zoom-*-100-*`, `phase2-final-zoom-*-200-*`). The primary's six-second wait with local Detail still reaches roughly 2.3 seconds: its trace requests foreground native brush-mask tiles, rather than an editing peak pass. This phase has not changed that phase 1 fallback. Current phase 1 replays of that case have a 2,215 ms median, n=3; the phase 1 record was 2,067 ms, n=3.

50-local case, one post-cache run (`phase2-pinned-zoom-fifty-100.json`): the six zooms were 1,810, 321, 2,139, 302, 286 and 577 ms, against 2,036, 449, 2,351, 432, 339 and 949 ms in matching phase 1 cases. Four of six are within its existing 600 ms target. Six returns to Fit were 99–111 ms, versus phase 1's 248–258 ms.

**Earlier open exit:** explain and remove the remaining four-mask session zoom regression while retaining the 1% measurement, bounded work, and phase 1 mask rules. Further implementation stopped at this failed speed check for owner direction. Steve subsequently directed the investigation recorded in 13.4.

### 13.4 Investigation and final verification (October 2)

Reference build: the unchanged phase 1 commit `7c4e318`, extracted into an isolated directory and run with the current driver/runtime. `phase1-reference-provenance.json` records the source checks; the enclosing repository's commit in raw driver manifests is not the reference build's commit. Drivers ran serially at 2560 by 1440, with disposable profiles and no other HDR Finisher instance. All three fixture archive hashes are unchanged after the last comparison.

**What the investigation established:**

- Three alternating normal five-minute sessions per build did not reproduce a uniform 55% zoom slowdown. Phase 1's four-mask medians were 139, 138 and 132 ms (31 zooms each); the checkpoint's were 145, 168 and 157 ms (28, 28 and 29 zooms). Matched-step median differences were −1.65, +19 and −2 ms. The earlier 229 ms session remains a measured result, not a repeatable estimate of the gap.
- Disabling editing measurement did not restore the checkpoint's zoom speed. Disabling it in phase 1 made four-mask zoom much slower: 678, 617 and 676 ms medians in three sessions (29, 29 and 28 zooms). Traces show phase 1 repeatedly fetching native regions without its background pass; that whole-image pass had incidentally warmed foreground data. Phase 2's containing-region reuse avoids those repeat fetches. The instrumented zoom starts checked did not wait behind an active measurement; instrumented on/off run totals are not directly comparable because logging volume differs.
- Discrete zoom actions still paid the same 80 ms debounce as wheel/slider gestures. Three alternating timer-only pairs, retaining measurement, reduced matched-step median picture times by 57.8, 72.6 and 58.1 ms. The delayed sessions had medians 168.7, 133.1 and 168.1 ms (29 zooms each); immediate sessions had 117.3, 89.5 and 110.9 ms (29, 30 and 29). This isolates a removable delay, rather than attributing the entire earlier 229 ms result to one cause.

**Change:** a discrete Fit, 100%, typed or stepped zoom schedules refinement immediately. Continuous wheel and slider gestures retain the 80 ms debounce. Cancellation, latest-state guards and exact-scope recovery remain in place. No pixel math, mask qualification or shader pins changed. The final disclosure fix also records a settled full-image fallback preview peak, in the proper HDR/SDR units, so exact delivery can warn about its disagreement; regional and interactive frames are not recorded as whole-image evidence.

Final ordinary five-minute sessions, action to exact picture, median (maximum) ms:

| Fixture and action | Fresh phase 1 | Final phase 2 |
|---|---|---|
| Primary zoom 100% | 624 (1,431), n=26, 1 session | 216 (1,375), n=24, 1 session |
| Four-mask zoom 100% | 134 (1,926), n=93, pooled 3 sessions | 113 (1,724), n=29, 1 session |
| Primary return to Fit | 100 (109), n=26 | 21 (29), n=24 |
| Four-mask return to Fit | 105 (152), n=93 | 22 (27), n=29 |

The three timer-only immediate sessions support the final four-mask session result; they are separate experimental runs, not additional ordinary-driver sessions. Raw artifacts are `repeat-phase1-fourmask-*`, `zoom-delay-{80,0}-fourmask-*`, `post-timer-*-session.json`; reductions are `zoom-delay-summary.json` and `final-speed-summary.json`. The per-zoom distribution is retained in `zoom-experiments.html`.

Matched zoom-after-edit cases at 100%, three runs per fixture/build, median (maximum) ms:

| Case | Primary phase 1 | Primary final | Four-mask phase 1 | Four-mask final |
|---|---|---|---|---|
| Immediately after stroke | 624 (628) | 457 (678) | 989 (994) | 847 (859) |
| Six seconds after stroke | 315 (360) | 281 (315) | 207 (217) | 131 (139) |
| Immediately after stroke, local Detail on | 254 (259) | 153 (183) | 606 (623) | 473 (482) |
| Six seconds after stroke, local Detail on | 2,215 (2,382) | 2,083 (2,304) | 359 (361) | 271 (277) |
| Local Detail on, unchanged/cached | 248 (284) | 169 (169) | 115 (116) | 44 (189) |
| Immediately after new local | 442 (493) | 294 (302) | 490 (793) | 400 (518) |

Every matched-case median improved; individual maxima still vary, including the primary cold zoom and four-mask cached case. The primary native brush fallback still takes roughly 2.1–2.3 seconds with local Detail and belongs to the accepted phase 1 gap. A final 200% run per fixture produced six picture times of 472/192/117/2,049/120/245 ms (primary) and 716/107/230/176/132/262 ms (four-mask); these are one sample per case, not repeated medians. Fifty locals at 100%, one sample per matching case: fresh phase 1 1,734/402/2,108/395/328/547 ms; final 1,694/218/2,029/256/221/387 ms. Four of six final cases meet its unchanged 600 ms target.

**Picture versus scopes:** fresh brush pictures stayed similar (HDR/SDR primary 189/188 → 181/186 ms; four-mask 140/144 → 138/139 ms). Fresh HDR brush scope settlement became slower: primary 231 → 430 ms and four-mask 174 → 328 ms; SDR was 229 → 237 and 184 → 274 ms. These use the session sample counts above. The driver waits for scopes too, so the final primary/four-mask sessions completed 24/29 cycles versus 26/31 per reference session. Zoom scope settlement improved (primary 1,957 → 1,677 ms; four-mask 644 → 519 ms). These waits are reported separately and are not a waiver of a speed requirement or proof that all background work became faster.

**Final accuracy:** `post-timer-peak-*`, `post-timer-bounded-*` and `post-timer-compare-*` repeat the fixture checks after the scheduling and disclosure changes. Primary as-saved peak is 636.5777 versus 638.1938 nit (0.2532% low); four-mask is 3,207.1181 versus 3,208.967 nit (0.0576% low): one readout run with five conditions and one bounded maximum call per fixture. Primary global-Detail-off peak is 0.2274% low in one comparison run. Eight bounded-contract calls (maximum and robust, HDR/SDR on both fixtures) retain the source/mask bounds and leave the accepted frame/resources unchanged. Primary tone/masks pass; four-mask SDR tone/masks pass. Each comparison samples three regions of 1,947,690 pixels per lane. The four-mask HDR near-black outliers remain (two pixels over the ceiling; maximum 8.0335%); the final comparison retains that failed HDR verdict. The earlier single-point window reading in 13.2 was not resampled separately; the final SDR regional comparisons pass with the same correction.

Robust anchors now have native-reference accuracy checks, separate from the bounded-work contract: one GPU call and one exact CPU export-branch render per lane/fixture, four paired comparisons. Exact reference renders are test work, not editing work.

| Robust anchor | GPU estimate | Exact native | Relative error |
|---|---|---|---|
| Primary HDR | 0.5221368912 | 0.5214771032 | 0.1265% high |
| Primary SDR | 0.5632608093 | 0.5581789613 | 0.9104% high |
| Four-mask HDR | 2.3784142300 | 2.3697741032 | 0.3646% high |
| Four-mask SDR | 10.8340443755 | 10.7701473236 | 0.5933% high |

All four are inside the unchanged 1% limit. Native references are `robust-native-{primary,fourmask}.json`; the fixture modes and bounded refusals described in 13.1 still delimit what this validates.

Final focused verification: 50 Node tests pass, including both zoom scheduling modes, fallback disclosure, source/mask caches, cancellation, single-flight and unchanged shader byte pins. The 27 Python checks pass, including exact ceiling enforcement and `test_proof_export_identity.py` for the available encoders. The final performance sessions preceded the disclosure-only evidence recording change; the final accuracy comparisons and Node suite include it. No new benchmark was run after the promised last comparison. The known phase 1 failures and Detail agreement issues remain outside this phase.

## 14. Phase 3 first working stage — October 2, 2026

Work starts from clean `5d5ae6d64739fddc993452d0969588618a78eb39` on
`viewport-bounded-preview-phase-2-wip`. The inspected order is Detail diagnosis,
GPU masks/region luminance, controls/Match, then navigation/scopes. The
[durable Detail evidence record](../technical/archive/viewport-phase3-detail-evidence-2026-10-02.md)
contains the path inventory, baseline isolation, implementation and provenance.

Before either renderer changed, isolated primary HDR centre comparisons
identified Sharpen: p99 luminance 6.958% and maximum 26.054%, while inactive
Detail, Clarity alone and Microcontrast alone passed. GPU Sharpen now matches
export's three-box kernel and cropped source-pixel scale. Export is unchanged.
The combined primary as-saved comparison passes the existing limits: three
1,947,690-pixel regions per lane, one run, HDR luminance p99 0.495–0.854%,
maximum 1.354–1.947%; SDR judged maximum 1.854–2.698%. Masks and peak pass.

Four-mask SDR passes in the same fresh sampling, but HDR still has the two
near-black outliers recorded in phase 2: luminance maximum 8.0335% against 5%,
OKLab maximum 0.136093 against 0.03. No tolerance is widened. Implementation
pauses for Steve's decision under the next-thread instruction to show evidence
and stop when a limit remains unmet.

Three alternating before/after fresh-session timing pairs show mixed small
changes, without a clear regression. Local-Detail delayed brush zoom remains
2093 → 2053 ms to the picture and 3556 → 3502 ms through scope settlement
(three samples per build). This accepted speed gap remains open. Eight
bounded-contract calls across both fixtures retain the budgets and frame
resources; peak and robust estimates match phase 2. Focused verification adds
44 passing Python checks including Proof identity, 59 Node checks including
unchanged shader pins, and 28 synthetic GPU Sharpen cases. Full Detail matrix,
GPU masks, controls/Match, navigation/scopes and 50-local scaling remain.
Phase 3 is not closed; phase 4 has not started. The first fixes were later
committed as `fe43970` on Steve's authorization; no push was requested.

### 14.1 Near-black follow-up and continuation

Steve requested investigation of the two outliers with few long tests. CPU
tracing and a tiny actual-shader probe identify neutral colour grading: export
skips it, but GPU luminance normalization erased signed RAW colours with
nonpositive luminance. GPU neutral wheels now return the input unchanged.
Active grading and export remain unchanged.

One fresh as-saved HDR-centre comparison, 1,947,690 pixels, passes all existing
verdicts. Luminance maximum falls 8.0335% → 0.712%, OKLab maximum
0.136093 → 0.00390; no ceiling failures remain in that region. The individual
pixels (2599, 3988) and (2658, 4353) now have luminance errors 0.0204% and
0.0068%. Eight synthetic CPU/GPU grading cases (64 pixels) pass, including
neutral identity, hue/balance, disabled and active grading in both lanes.
Peak/Denoise pins pass unchanged; no tolerance or fixture was changed.
The earlier full comparisons, timing pairs and Proof checks were not repeated
after this neutral-only guard. Full Detail matrix and the remaining phase 3
work stay open. Steve then authorized commit and continuing the sprint;
push and phase 4 remain unauthorized.

### 14.2 GPU masks and local controls

Neutral-geometry paths and brushes without whole-mask feather/shift now
rasterize from compact geometry on the GPU, including native tiles. A new
hard-path pixel mismatch was traced to one ULP in division and repaired.
Forty-five CPU/GPU raster cases cover 271,360 pixels; the passing four-mask
HDR-centre capture covers 1,947,690 pixels with zero path mask error/edge
displacement. Qualified feather bitmaps and their trial limit are unchanged.

HDR leaf luma masks can use aligned source regions and feather halos. Eight
regional/whole GPU checks (8,192 pixels) are exact; the fresh fixture picture
and masks pass. A measurement-halo regression initially refused the bounded
budget; separating display/analysis contracts repairs it. Four post-fix peak/
robust calls pass, with unchanged HDR maximum error 0.0576% low. See
[mask evidence](../technical/archive/viewport-phase3-mask-evidence-2026-10-02.md).

The SDR lane now uses the same regional leaf luma masks when its source is
the ACEScg scene picture (no Match, no authored SDR base); those two cases
keep the fallback. One fresh four-mask SDR-centre capture (1,947,690 pixels)
passes picture, masks and peak, and the bounded-peak values are unchanged.
The SDR luminance mask now measures 2.13 levels (39 pixels above the approved
2), the HDR lane's existing figure, against 1.10 for the CPU-made regional
mask it replaces. It is inside the unchanged trial limit of 3 only. Steve
accepted this on October 2 and asked for a reminder to check it by eye, which
is section 11e of `HDR_Finisher_PRD_v1.2.md`. A short
SDR fifty-local session made no backend mask-tile request; its native zoom
took 772.4 ms to the picture, one observation, 487.5 ms of it source transfer.

Local curves, colour wheels, balance and blending run on the GPU before
Detail. A tiny local-pass probe also corrected pre-existing SDR matrix/stage
clamp differences against export. Twenty-four cases / 192 pixels pass,
including independent local LUTs. A fresh as-saved four-mask SDR-centre
capture (1,947,690 pixels) passes picture, masks and peak. See
[local-control evidence](../technical/archive/viewport-phase3-local-control-evidence-2026-10-02.md).

### 14.3 GPU scopes and navigation

Settled tiled scopes now grade a separate GPU proxy capped at 1,600; navigation
grades a 512-edge GPU canvas after foreground/scopes settle. Direct scopes
keep their existing route. Latest-state guards, accepted-picture resources
and bounded peak measurement are preserved. In short fifty-local sessions,
one sample per action, native picture/scopes were 674.6/3,971.7 ms before and
820.8/1,767.8 ms in the final GPU auxiliary run. These are observations, not
controlled medians; picture speed still misses its goal. The final check sees
no CPU scope/navigation-preview requests and rejects stale auxiliary work.
Proof/peak checks pass (10 tests). See
[auxiliary evidence](../technical/archive/viewport-phase3-auxiliary-evidence-2026-10-02.md).

### 14.4 Native-zoom source transfer

A fifty-local native zoom spent 487.5 of 772.4 ms fetching its source region
in six sequential chunks, while the backend encodes that region in 153 ms
serially. The region's chunks are now requested side by side through the
existing four-slot staging ring, and the region is exactly the union of the
tiles' halo rectangles instead of the viewport padded by a whole tile (10.8
to 8.6 MP for that view). Pixels, placement and every limit are unchanged:
one enforced centre comparison each for primary HDR and four-mask HDR/SDR
(1,947,690 pixels each) reproduces the earlier figures and passes picture,
masks and peak.

Fifty-local single observations, native picture/scopes: 820.8/1,767.8 ms at
the handoff (HDR); 467.8/1,400.0 ms HDR and 543.8/1,442.4 ms SDR now. These
are one operation each, not medians, and the 300 ms goal on the two smaller
fixtures was not remeasured. The remaining tiled-render time at fifty locals
(180–250 ms) is GPU mask creation, not local passes or encoding. See
[zoom transfer evidence](../technical/archive/viewport-phase3-zoom-transfer-evidence-2026-10-02.md).

One Node test, `highlight-anchor.test.js` (denoised-source anchor key), fails
on committed `fe43970` as well as here. It is not in the earlier list of
known failures and was not changed.

Steve authorized committing this continuation on October 2 (`bb38137`); the
evidence records' "uncommitted" describes them when written. No push was
requested.

### 14.5 Match candidates on the GPU

Match explores SDR recipes by rendering each at a 768-pixel analysis size
and measuring it against the settled HDR target. Those renders were on the
CPU: 11 per Match on the three fixtures, 210-1,450 ms each. The page's GPU
now renders them while the Match request waits, through a small bridge; the
fitting logic, its order and its quality gates are unchanged. The recipe the
fit reaches is rendered once by the export pipeline, and that render gives
the reported quality, the matched/needs-review status and the rejection
gate. If the page cannot answer, or that CPU check rejects the recipe, the
whole fit reruns on the CPU as before.

One Match per fixture, action to page return: four-mask 4.59 s to 1.81 s,
primary 6.20 s to 3.17 s, fifty-local 23.98 s to 5.94 s, against goals of 2,
2 and 4 s. These are single runs. What remains is CPU work outside the
candidates: the HDR target, local translation, the neutral tonal fit and the
final CPU check.

GPU and CPU candidates agree to 0.002-0.010 of display white at the worst
pixel on the three fixtures (one verify run each). Status is unchanged on
all three and the chosen recipes agree on two. On the primary the GPU fit
lands just the other side of the 0.04 OKLab gate that the CPU fit ends just
inside (0.0395), so it runs the curve corrections and returns a different
recipe with slightly lower CPU-measured error.

Getting there exposed a preview-versus-export difference that is not
specific to Match: the GPU's SDR base stage clipped to display white before
Detail and the locals, and export does not unless contrast, primaries,
curves or colour grading are active. A recipe that lifts highlights above
white under a darkening local, which Match's own recipes do, previewed up
to 0.15 darker there than it exported. The preview now follows export. As-
saved comparisons on both fixtures pass unchanged; the fix itself was
checked at the analysis size, not at 100% against an export. See
[Match evidence](../technical/archive/viewport-phase3-match-evidence-2026-10-02.md).

Steve approved this on October 2: a different recipe from Match is
acceptable, and he will check matched results on screen and fine-tune from
there. Not yet done by anyone: that on-screen check, and a 100% comparison
of the clipping fix against an export.

Also found: `test_model_declaration_contracts.py` fails on committed code
since phase 2 added `editing_measurements` to the Proof request; left alone.

Phase 3 stays open: Match on primary and fifty-local over goal, brush feather/
shift, transformed masks, SDR regional luma under Match or an authored SDR
base, luminance leaves in expression graphs, complete Detail coverage and
broader 50-local/continuity checks. No tolerance was widened or fixture saved;
phase 4 has not started.

### 14.6 Match CPU input reuse

The CPU HDR target now shares its geometry-fixed source and immutable spatial
masks with local translation and final CPU certification inside one fit.
The neutral tonal search also reuses private trial states rather than copying
the full adjustment tree for every trial. The CPU target, certification,
quality gates, fallback and pixel operations are unchanged.

One new Match per over-goal fixture, action to page return: primary 3.05 s
(prior 3.17 s), fifty-local 4.99 s (prior 5.94 s). Local translation fell from
186 to 17 ms and 1,048 to 124 ms respectively. Both recipes agree at the prior
reports' precision; CPU-certified quality is exactly unchanged. These are single observations,
not controlled medians; both remain over goal. Six direct tonal-fit checks
against the committed implementation and 46 focused Match tests pass. See
[Match CPU evidence](../technical/archive/viewport-phase3-match-cpu-evidence-2026-10-02.md).

Steve accepted these speeds for now on October 2 and authorized committing
this slice and moving to the next phase 3 task. The original 2 s / 4 s goals
remain recorded; further Match speed work is deferred. Phase 3 remains open,
with the other work in 14.5 still outstanding. Phase 4 has not started and
no push was requested.

### 14.7 Matched SDR highlights at native zoom

After the accepted Match slice was committed as `e3a5a7f`, two short four-mask
SDR-centre comparisons at 100% verify the clipping correction with global
Sharpen 35 / radius 1.7 / threshold 10. Both use the app-selected tiled route
and pass the unchanged picture/mask limits. The first keeps the matched
locals; the second isolates a session-only full-coverage local at -1 EV.

In the second capture, CPU stage evidence establishes 130,061 above-white
inputs to Detail: 128,337 stay unchanged, 1,724 change and clip. All 128,337
above-white samples reaching the darkening local are recovered below 0.98.
The native preview agrees with export: judged luminance maximum 4.445%,
OKLab maximum 0.01838. This verifies the previously open clipping and global
SDR Detail questions for this Sharpen case; it does not close the full Detail
matrix. See [native SDR evidence](../technical/archive/viewport-phase3-matched-sdr-native-evidence-2026-10-02.md).

Only comparison tools/tests and documentation changed in this verification
slice; it remains uncommitted. Phase 3 stays open and phase 4 has not started.

### 14.8 Shared regional masks and luminance expression graphs

Eligible analytic locals now share one GPU bitmap over the union of their
foreground tile halos. Regional scene-source expression graphs compose
luminance, analytic path/brush and gradient leaves on the GPU, with feather
halo/grid alignment and current-region cache protection. Unsupported forms
retain their existing fallbacks.

45 compact CPU-reference shape cases and 12 CPU/whole-GPU graph cases pass.
A visibly active four-mask union at native zoom passes the unchanged picture,
mask and peak limits in both lanes; its 2.13-level luminance difference stays
inside the existing trial policy. 34 focused cache/routing/lifetime/shader
checks pass. The fifty-local native route uses 25 analytic textures rather
than 600, with picture/scopes at HDR 560.6/1429.6 ms and SDR 540.3/1442.1 ms.
These are single observations and establish no speed improvement or full
zoom-continuity exit. See [regional mask evidence](../technical/archive/viewport-phase3-regional-mask-evidence-2026-10-02.md).

Brush whole-mask feather/shift, transformed masks, authored/legacy-match SDR
regional luminance, the full Detail matrix and broader scaling/continuity
remain. These changes are uncommitted. Phase 3 remains open.

Quarter turns and flips are now supported for analytic path/brush masks.
The 300-case shared-shape reference and one transformed HDR native picture
comparison pass existing limits. Crop/straighten/perspective, gradient
transforms and painted whole-mask feather/shift remain on their prior paths.
### 14.9 Upper-range Texture repair and wide-Clarity measurement gap

Autonomous continuation found and repaired Texture's sparse-filter mismatch
with export. Global and local Texture now use the exact three-box kernel;
tile margins include its full support and the edge guide. The upper-range
four-mask HDR native centre changed from luminance p99/max 4.3531%/25.7087%
to 0.4251%/4.1098%. The final export-peak vicinity also passes picture and
mask limits. Both kernel modes pass 36 synthetic CPU/GPU cases; Peak and
Denoise byte pins remain unchanged.

The same state (Clarity 100, radius 3%) still fails the separate 1% Peak
readout requirement: 2,989 versus 3,703.3081 nit, 19.2884% low. Its bounded
native-patch measurement refuses 89,870,400 pixels against the unchanged
4,194,304-pixel budget. Raising this guard would exceed the entire 42 MP
frame's work. No accuracy limit or measurement budget was changed. This
unmet accuracy requirement is brought to Steve under the supplied stop-for-
decision instruction; phase 3 stays open. The full Detail matrix is not
complete. See [Texture and peak evidence](../technical/archive/viewport-phase3-texture-peak-evidence-2026-10-02.md).

Steve subsequently directed that this wide-Clarity Peak gap be marked as an
open issue and the remaining phase 3 work continue. The 1% requirement and
measurement budget remain unchanged; redesign is deferred. This known gap
does not require another stop during the remaining control checks.

### 14.10 Detail control coverage and subnative viewport routing

All 80 compact global/local HDR/SDR Detail-control reference cases pass the
existing luminance limits using production half-float pipelines. A native
four-mask comparison with maximum local Detail and opacity 0.35 passes
picture/mask limits in both lanes; its wide-Clarity Peak verdict remains the
deferred issue in 14.9. This closes that compact control sweep, not every
native combination or the complete Detail exit.

Custom zooms below 100% now request a region when part of the image is off
screen. Fit and fully visible views keep the whole-frame path. The fifty-local
100/150/50/200/100 sequence passes in both lanes; observed 50% picture times
fall from about 2.6 seconds to 0.83–0.84 seconds. An independent whole-GPU/
region-GPU 50% A/B passes the existing picture metrics across 1,947,690
visible pixels per lane. These are single observations and same-scale route
checks, not the full performance or cross-scale continuity exit. See
[Detail/zoom evidence](../technical/archive/viewport-phase3-detail-zoom-evidence-2026-10-02.md).

Eligible gradients also stay on the shared GPU route through quarter turns
and flips. All 128 compact CPU-reference combinations pass, and one native
90-degree/horizontal-flip centre comparison passes picture/mask/Peak checks
in both lanes. Crop, straighten and perspective remain open; see the
[regional mask follow-up](../technical/archive/viewport-phase3-regional-mask-evidence-2026-10-02.md).

### 14.11 Signed HDR Detail input and Peak candidate coverage

The GPU HDR base now retains signed channels until Detail and locals finish,
as export does. Early clipping changed Sharpen's neighbour extrema and caused
two native luminance outliers at maximum global Sharpen. Combined maximum
Detail improves from 5.3085% to 1.007% maximum luminance error; both lanes
pass picture/mask limits. The signed-base CPU/GPU reference passes 12 cases /
96 pixels. Peak and Denoise byte pins remain unchanged.

Isolated maximum Sharpen with all locals disabled still reports 3,638.8455
versus 4,015.2542 nit, 9.3745% low. Its 16 native patches process 952,576
pixels within budget but omit the export maximum's location. P3-PEAK-02 is
distinct from the deferred wide-Clarity budget issue. The picture passes;
Peak fails the unchanged 1% requirement. Steve subsequently clarified that
Peak is deferred and directed continuation of other phase 3 work. Both Peak
issues remain open under that decision; no limit or budget is changed. See
[Detail/zoom evidence](../technical/archive/viewport-phase3-detail-zoom-evidence-2026-10-02.md).

### 14.12 Independent HDR scene regions for SDR masks

Authored or legacy matched SDR bases now use one separate bounded HDR scene
region per foreground pass for eligible luminance leaves and expression
graphs. Feather support and common-grid alignment cover the actual tile halo
union. The existing caches, source transport and allocator account for that
source; it is pinned during mask creation. A refused region retains the mask
fallback and cannot trigger whole-source preparation.

All 12 compact independent-source graph cases pass CPU/whole-GPU comparison,
with a deliberately different SDR picture; 71 focused Node checks pass. A
native legacy SDR comparison with a common manual highlight anchor passes
picture/mask limits across 1,947,690 pixels. Its union mask matches exactly;
all picture channels stay within one encoded level. The automatic legacy
anchor still fails picture accuracy even without locals, because bounded
candidate evidence is unavailable for that base. This remains with deferred
Peak/anchor work, not a complete legacy-picture sign-off. Real authored-base
native coverage and the other phase 3 exits remain open. See
[SDR scene-mask evidence](../technical/archive/viewport-phase3-sdr-scene-mask-evidence-2026-10-02.md).

### 14.13 Cross-scale zoom continuity

A bounded 50%/100% GPU readback checks 2,961 aligned blocks on the four-mask
fixture: 8x8 screen pixels at 50% against 16x16 native pixels covering the
same area. HDR passes with luminance p99 0.6838%; SDR fails at 3.3494%
against section 4.4's unchanged 2% typical limit. Manual-anchor and
no-locals isolation retain 3.3619%; monochrome passes at 0.6327%.

P3-ZOOM-01 is a picture-continuity issue separate from deferred Peak work.
The result narrows the investigation to the colour path across source scales,
without establishing a specific shader fault or a validated fix. Processing
colour before downsampling on bounded GPU regions is a possible direction,
with increased pixel work and unmeasured latency/memory costs. Steve deferred
this issue on October 2 because it is close to the limit and directed
continuation of other phase 3 work. The requirement remains open. No tolerance was
widened, fixture saved, or phase 4 started. See
[cross-scale evidence](../technical/archive/viewport-phase3-zoom-continuity-evidence-2026-10-02.md).

### 14.14 GPU gradient Fan and Fit masks

Fan gradients now run on the GPU at Fit and on the shared regional path,
including quarter turns and flips. One source-coordinate parameter builder
serves both routes. Nonzero Fan keeps float coverage to avoid premature byte
rounding; Fan zero retains its established mask values. Stale leaf requests
return before allocation or fallback. Other unsupported geometry and
luminance-qualified gradients keep the existing fallback.

All 640 CPU-reference cases pass the unchanged mask guard (maximum 0.622
levels); Fit/regional results are identical. Twelve regional expression-graph
cases with Fan also pass, and 29 focused Node checks pass. A native four-mask
Fan +1 comparison passes HDR/SDR picture, mask and Peak verdicts across
1,947,690 pixels per lane; the Fan mask differs by at most 0.51 levels.
No fixture was saved or shader measurement pin changed. These results cover
this control slice, not the remaining brush feather/shift or complete sprint
exit. See [gradient Fan evidence](../technical/archive/viewport-phase3-gradient-fan-evidence-2026-10-02.md).

### 14.15 GPU brush feather, index crops and final primary comparison

Brush feather now rasterizes, blurs and normalizes its painted peak on the
GPU. One bounded byte readback is classified without CPU mask compilation or
source preparation. The classifier reserves one extra level for GPU raster
error; failed qualification tries larger GPU bitmaps up to the unchanged
3,200-pixel source cap, then keeps the existing exact fallback. Index crops
preserve export's integer placement after whole-mask normalization. Cropped
gradient, hard brush and path leaves also use uncropped source coordinates.

All 756 brush bitmap-reference and 960 analytic geometry cases pass. Of 750
compact native-scale qualification cases, 141 are admitted; none exceeds the
existing three-level trial and one reaches 2.333321 levels, still an owner
visual-review item. No approved limit is widened.

The final primary fixture as saved passes native picture, mask and Peak
checks across three regions in both lanes. Both feathered brushes use GPU
bitmaps; their largest mask errors are 1.12 and 1.48 levels. No mask in that
run needs the trial. HDR luminance p99/max are at most 0.729%/1.774%; SDR
passes the existing eight-bit rule. This closes the as-saved picture blocker.

Unsaved added strokes/narrow feathers still fail qualification and fall back.
The primary edited sequence observes 314 ms stroke, 367–1,351 ms feather and
2,115 ms first native zoom, above the 100/100/300 ms targets. Shift Edge,
resampling geometry and unsupported path/graph forms still have CPU paths.
These are open gaps, not approved deferrals. The final Node suite has 357
passes and its known anchor-identity failure; Python has 1,641 passes, two
known failures and three skips, with 29 final focused checks passing.

See [brush/crop evidence](../technical/archive/viewport-phase3-brush-crop-evidence-2026-10-03.md)
and the [exit audit](../technical/archive/viewport-phase3-exit-audit-2026-10-03.md) for
all issues, limitations and fixture hashes. Later changes remain uncommitted
and unpushed. Phase 3 is not closed and phase 4 has not started.

### 14.16 Phase 3 continuation: discrete feathering, GPU forms and measurements

The continuation adds GPU outer-boundary paths and bounded Shift Edge bitmaps,
and admits cropped regional graphs with verified integer placement. Native
Shift Edge, unqualified narrow feathered brushes and resampling shape/gradient
geometry remain unfinished implementation work. None is silently deferred.

Luminance feathering now follows export's six discrete boxes, including exact
repeated physical-boundary clamping and full finite halos. Separate immutable
refinement keys prevent fifty-local masks from rebuilding one another. The
four-mask native luminance error falls below two levels; a real encoded/
decoded, photo-derived authored-SDR fixture passes native picture/mask/Peak
checks in three regions. The primary as saved again passes both lanes.

Repeated packing A/B preserves identical bytes and reduces 1,600-edge median
packing from 25.6 to 4.0 ms and 3,200-edge packing from 100.0 to 11.8 ms. Binary
GPU classification transport removes base64 conversion. Picture, scope and
fallback costs are reported separately; primary and four-mask timing misses
remain. Actual R16 texture sampling replaces the ideal-byte compact survey:
the rounded implementation reaches 2.338917 levels in three admitted cases.
A continuous-feather trial reduced the maximum to 2.213013 but was not retained
after inconclusive timing controls and late extra generations. Concrete
visual evidence exists for the current cases and the trial. No limit is widened. Eligible gradient
controls now request live GPU feedback while held; the final drag measurements
are recorded in the continuation evidence.

See [continuation evidence](../technical/archive/viewport-phase3-continuation-evidence-2026-10-03.md)
for exact boundaries, repeated timings, test repairs and coverage limitations.
The existing owner decisions and all phase 3 preservation constraints remain.

Three retained four-mask runs measure stroke median 70.2 ms and Feather
47.5–75.1 ms, versus the preceding three-run 107.5 and 83.9–108.7 ms.
First native remains 389.9 ms; scopes remain 403.6–789.7 ms. Live Fan first
feedback is 6.8/6.9 ms HDR/SDR across three drags per lane. Primary measurements
now drain current automatic-anchor/coordinator work and separate early
feedback from replacement generations: stroke median 1,868.5 ms, Feather
1,247.6–1,584.2 ms, first native 2,310.6 ms. These are unmet targets, not a
change to the deferred anchor algorithm or evidence of a general speedup.

Full Python 1,644 pass/three skips and full Node 362 pass; serialized Electron
brush, path, GPU admission/CPU scope recovery and device-loss checks pass.
Real authored-SDR native coverage, remaining controls and HDR/SDR fresh
sessions with native pans are recorded. Pan/geometry/scope misses and native
mask GPU gaps remain open. Phase 3 is not closed; phase 4 has not started.

### 14.17 October 3 owner review and completion order

Steve accepts the three displayed rounded compact mask cases 228, 249 and 421
as visually close enough. This closes their specific visual-review request;
it does not grant a permanent three-level soft-mask limit or accept new cases.
Their measured maxima (2.338917, 2.088867, 2.123535 levels) remain in evidence.
The general two-level limit, fixture native checks and shader pins stay intact.

Steve directs completion of the remaining predefined phase 3 work with
validation batched where practical, then surgical attention to known issues
at the end. Existing deferrals and the ban on phase 4, reset, commit and push
remain. Green suites and unchanged native states need not be repeatedly
retested without a relevant change or unresolved coverage concern.

### 14.18 Integrated validation and pressure recovery

The primary fresh-work replay completes 400 operations / 25 cycles in
307.759 s plus 30 s idle with original automatic anchors and no page errors.
A disposable 0.75 GiB fifty-local replay exposes two actual cache faults:
mask/detail textures destroyed during an active encoder lifetime and
luminance refinement allocations omitted from registered bytes. Cache
release now respects active render/scope lifetimes; mutable refinement
registrations resize as resources grow/release. Focused allocation/lifetime
tests and full Node **366 pass**. The final pressure replay completes
75 operations / five cycles, 62.59 s active plus 30 s idle, no page errors,
no pending current work or registered budget debt, and equal local-mask
resident/registered totals. Physical GPU/process memory is not equated to
the selected cache budget.

Repeated Shift Edge slider coverage now completes in both lanes at Fit and
native zoom. Three-sample exact release medians are 54.4/55.3 ms HDR/SDR at
Fit and 3,624.6/4,719.9 ms native. Native uncached requests spend seconds in
CPU mask compilation; this remains a GPU coverage and performance fault,
not a speed waiver. Native Shift, unqualified narrow brushes, resampling
geometry masks and primary/zoom/scope/pan targets remain surgical work.
The broader coverage pass and owner image acceptance do not close phase 3.
Full artifacts and before/after fault evidence are in the
[continuation evidence](../technical/archive/viewport-phase3-continuation-evidence-2026-10-03.md).

After the cache repairs, `primary-cache-final-native.json` again passes
paired-pixel, picture/tone, mask and Peak limits in both lanes and all three
native regions, with the source project unchanged. Original primary,
four-mask and fifty-local hashes are rechecked unchanged afterward. No
fixture save, commit, push or phase 4 work occurs.

### 14.19 Native brush erase separation and paired measurements

The [regional eraser evidence](../technical/archive/viewport-phase3-regional-erase-evidence-2026-10-03.md)
records classifier-term diagnostics and a bounded native GPU route that
qualifies the painted field, then applies ordered erase/repaint attenuation
at native output coordinates. Already-qualified complete masks keep their
existing route; Shift, resampling and unqualified paint retain exact fallback.
Recreation after eviction preserves the qualified soft bitmap's resolution.
Admission, general two-level approval and the three case-specific owner
acceptances are unchanged, as are exact Proof/export and Peak/Denoise pins.

Saved and added-stroke primary recipes pass all four native verdicts in both
lanes and all three regions, with regional mask errors approximately 1.12
levels. Three fresh sessions per mode give first-native picture medians of
2347.5 ms with the new route disabled and 657.6 ms enabled; scope medians
are 2681.3 and 990.5 ms. Native CPU mask-tile batches fall from one to zero.
Stroke/feather timings show no general gain, and the 300 ms zoom target
remains missed. Node validation passes 371 tests and focused Python
validation passes ten. Short capped-cache replays are evidence for this
slice, not the outstanding 30-minute endurance requirement.

Native Shift, intrinsically narrow painted masks, geometry/graph resampling,
primary stroke/feather, zoom/scopes/pan and full endurance remain open.
Existing deferrals remain unchanged; phase 3 is open and phase 4 has not begun.


### 14.20 Bounded native Shift Edge with zero Feather

The [native Shift evidence](../technical/archive/viewport-phase3-native-shift-evidence-2026-10-03.md)
records a native-coordinate Shift route with Feather zero. Full-field painted
peak reduction uses bounded GPU bands; the viewport field carries the entire
finite box-filter halo. Float32 prefix filtering, inversion and ordered
native erase/repaint attenuation preserve export's operation order. Whole
resident picture proxies also use bounded foreground mask regions, and
large catch-up batches split masks by tile. Mask allocations, cancellation,
inflight ownership and device replacement retain the existing cache contract.
A native display-metric/segment rounding
repair resolves two hardness-one stress pixels that initially differed by
12.00824 levels. All 52 native reference regions, including ±0.05 Shift,
now pass at at most 1.12403 levels; 804 existing rounded producer cases pass.
No large-error trial or tolerance change is retained.

The primary +0.005 expansion and added-stroke −0.005 contraction, both with
Feather zero, pass all four native verdicts in HDR/SDR and three regions.
Their Shift masks reach 1.015/1.066 levels with zero pixels over two. Full Node passes 379 tests. Repeated
paired release-picture medians (three fresh sessions per mode) improve from
3321.5 to 186.9 ms HDR and 4265.8 to 158.2 ms SDR; scopes improve from
3680.0/4624.0 to 556.5/531.3 ms. Native CPU mask-tile requests fall to zero.
First-feedback and scope goals remain unmet. These zero-Feather isolation
measurements cannot replace the earlier feathered native Shift benchmark.
The short 0.5 GiB replay completes 96 operations, records 13 successful
native batches and 389 evictions, and drains through 30 seconds of idle
without errors, allocator debt or mask-registration mismatch. Full recipes
and pressure coverage are recorded in the linked evidence.

This advances P3-GPU-01 but does not close it: native Shift plus Feather,
intrinsically rejected narrow paint and resampled masks/graphs remain open.
The earlier feathered native Shift benchmark is a different recipe. No
classifier, general two-level approval, exact CPU Proof/export, Peak/Denoise
pin, editing-Peak budget, zoom scheduler or existing owner deferral changes.
Phase 3 remains open; final 30-minute endurance still requires stabilized
remaining implementation. The owner subsequently authorized a checkpoint
commit and next-thread prompt. No phase 4 or push is performed.

### 14.21 Bounded native Feather field, with and without Shift Edge

The [native Feather evidence](../technical/archive/viewport-phase3-native-feather-evidence-2026-10-03.md)
records the route that removes the CPU mask compile for native Shift Edge
plus Feather. Export's reduced feather grid depends on the mask and frame,
not the viewport, so it is built once as a small GPU field: native paint,
full-field painted peak, export's float32 Shift boxes in bounded bands
carrying the complete halo, block means joined across bands, twelve
fractional passes and the blurred peak over every interpolated native
pixel. Each viewport then interpolates that field at native centres,
restores the painted peak and applies inversion and ordered erase. Narrow
feathers keep export's full-resolution boxes over the finite halo. No
native-frame texture, stretched shifted bitmap or homography is used, and
the existing 16,777,216-pixel scratch cap, cache registration, cancellation
and device-replacement contracts apply.

The same field now serves feathered paint that no bitmap qualifies for,
after qualification refuses and before any CPU compile, and precedes the
paint-bitmap qualification for erased feathered brushes at native zoom. The
latter is a change of order from 14.19, made on evidence: an added-stroke
Feather 0.0005 recipe measured 2.124 levels with 150 pixels over two through
the qualified paint bitmap, and 1.12 levels with none over two through the
field. Already-qualified complete masks keep their small-bitmap route. The
classifier, its limits, the general two-level approval and the three
case-specific acceptances are unchanged; admission is not widened.

All 108 native Feather reference regions pass at at most 1.12403 levels,
including 24-megapixel frames that need up to 16 bands; the 52 native Shift
and 804 rounded references still pass. Saved-Feather Shift expansion, an
added-stroke contraction, two narrow feathers and the saved state pass all
four native verdicts in both lanes and three regions.

Three fresh sessions per mode on the saved feathered recipe measure release
picture medians of 3607.8→151.2 ms HDR and 4649.2→141.2 ms SDR, scopes
3983.8→551.8 and 5013.5→524.2 ms, and CPU mask-tile requests 12→0 per lane.
The first version of the new order made first native zoom slower (890
versus 673 ms) through cold pipelines and queue waits; preparing the field
during the zoom's source transfer and removing the waits measures 619.8 ms
over three sessions, which is reported as no regression rather than a gain.
The 300 ms zoom goal, the 100 ms slider goal, scope settlement and Fit
stroke/Feather timings remain unmet; Fit never enters this route. Full Node
passes 398 tests. A 0.5 GiB replay with varying Feather completes 96
operations and 394 evictions without errors, allocator debt or
registration mismatch.

This closes the native Shift-plus-Feather gap of P3-GPU-01 and the native
part of the narrow-paint gap on supported geometry. Resampling geometry and
graphs, frames wider than the adapter texture limit, Fit-scale auxiliary CPU
masks, timing exits, the coverage audit and 30-minute endurance remain
open. Phase 3 remains open; no push or phase 4 work is performed.

**Owner decisions (Steve, October 3).** The saved feathered Shift release
timings of 151.2 ms HDR / 141.2 ms SDR are accepted for now against the
100 ms slider goal, given the improvement from 3.6–4.6 s; this acceptance
covers this control only and may be reopened on regression. The redundant
3,200-pixel CPU mask compile in the larger-bitmap fallback (after every GPU
bitmap size has been refused) is noted as P3-FALLBACK-01 and deferred for
later exploration; the fallback is unchanged. Steve authorized a checkpoint
commit of this slice (no push).

### 14.22 Straighten/perspective leaf masks, wide frames and Fit bitmaps

At Steve's request three changes were built together and validated in one
combined pass; the [evidence](../technical/archive/viewport-phase3-resampled-mask-evidence-2026-10-03.md)
records them.

**Straighten and perspective.** Export finishes a mask in source space,
rounds it to bytes and warps it with the picture. The preview now does the
same on the GPU for brush, path and linear-gradient leaves: the warp is
computed as export's own arithmetic (Pillow coefficients, safe inset, crop
rounding; not a fitted homography), the source mask comes from the existing
native producers, and Pillow's bicubic kernel and range clip are applied per
output rectangle. A CPU-only test reproduces the export geometry stage pixel
for pixel within 0.002 levels over 33 recipes. Of 70 GPU reference regions,
68 are within 1.124 levels; two feathered regions reach two byte levels
(2.06 as stored) on six pixels in total, because export's kernel amplifies a
byte that rounds the other way. That is at the general two-level approval,
not inside it, and is put to Steve rather than accepted. On the primary with
a 2 degree straighten and with perspective 15, brush and gradient masks pass
at 1.12 levels with none over two. First straightened 100% zoom falls from
8253 to about 3500–3700 ms and CPU mask requests from eight to zero (single
sessions); what remains is the straightened picture source, not masks.

Luminance leaves and combined masks under straighten/perspective are not
covered. Two faults were found that this work neither caused nor fixes:
P3-PEAK-03 (no bounded editing Peak under straighten; preview 3.7% low, the
same with the new route disabled) and P3-LUMA-RESAMPLE-01 (a luminance leaf
at 3.153 levels with 943 pixels over two under perspective).

**Wide frames.** Native Shift and the feather field tile columns as well as
rows, so a frame wider than the adapter texture limit no longer falls back.
Six regions of a 9000-pixel frame pass at 1.124 levels. The device limit and
picture pipeline are unchanged; no real fixture this wide exists.

**Fit bitmaps.** A GPU brush bitmap made at exactly the requested scale now
serves scopes and measurements whether or not it qualifies as stretchable,
removing the 1,600-edge CPU mask requests in the stroke/Feather sequence.
The deferred P3-FALLBACK-01 compiles remain.

Full Node passes 408 tests; 114 native Feather, 52 native Shift and 804
rounded references still pass; fixture hashes are unchanged. No classifier,
tolerance, shader pin, export or zoom-scheduler change. Phase 3 remains open;
no push or phase 4 work is performed.

**Owner decision (Steve, October 3).** The two warped feathered reference
regions at two byte levels (2.06 as stored, six pixels in total) are accepted
for now as close enough to the two-level limit (P3-MASK-REVIEW-02). This
covers warped feathered brush masks at up to two byte levels only; it is not
a general three-level approval and the general limit stays two. Steve
authorized a checkpoint commit of this slice (no push).

### 14.23 Source-space combined and luminance masks, Peak and windowed straighten

Built together on the fast checks and validated in serialized GPU passes; the
[evidence](../technical/archive/viewport-phase3-source-space-mask-evidence-2026-10-03.md)
records them. Not committed.

**Combined and luminance masks under straighten/perspective.** Export
composes the whole expression in source space, rounds it and warps it once.
The preview now does the same. The backend serves un-resampled scene
luminance for a rectangle (one half float per pixel, quarter turn and flips
only); the renderer keeps it as bounded tiles, qualifies and feathers a
luminance leaf in source space, composes combinations there from the existing
leaf producers, and warps the result with the existing resampler. This fixes
P3-LUMA-RESAMPLE-01, which the paired baseline shows predates the previous
slice: 3.15 levels with 943 pixels over two becomes two byte levels on 565
pixels (0.03% of the region), and the masks verdict passes. Of 112 reference
regions no byte differs by more than two levels and 77 are within 1.13; the
rest reach two byte levels (up to 2.124 as stored) on at most 0.07% of their
pixels. That is at the general two-level limit, not inside it, and outside
the brush-only exception of 14.22, so it is put to Steve.

**Peak under straighten (P3-PEAK-03).** The bounded editing Peak is now
produced: 627.2 nit against export 628.4 (0.19% low; was 3.7%). Budget and
shader pins are unchanged. The automatic anchor is therefore measured under
straighten as it is elsewhere, so a Fit edit's exact settlement there is the
anchor replacement at about 1.4–1.6 s; first feedback stays at 39–60 ms.

**Straightened picture source.** The backend resamples only the requested
window for straighten (Pillow's rotate matrix and safe inset as arithmetic),
within the 1e-6 tolerance already approved for windowed perspective; export
and Proof keep the full-frame path. First straightened 100% zoom falls from
about 3,500–3,700 ms to a median of 827 ms over three sessions (8,253 ms
before the previous slice), scopes from about 4,000 to 1,234 ms, with zero
CPU mask requests. The 300 ms goal is still unmet; the luminance mask's
whole-frame range scan is now the largest term.

**Fit stroke and Feather.** Measurement only: first feedback is 104–250 ms;
the 1.1–1.6 s "exact" figures are the automatic-anchor replacement, plus the
deferred P3-FALLBACK-01 compile on two steps. Fetching anchor patches side by
side shortened settlement but delayed first feedback under straighten and
was not kept.

A 0.5 GiB replay under straighten completes 96 operations and 4,025 warped
masks with no errors or over-budget bytes. Node passes 413 tests and the full
Python suite 1,651 with three skips, plus seven new. Fixture hashes are
unchanged. No classifier, tolerance, shader pin, export or zoom-scheduler
change. Phase 3 remains open; no commit, push or phase 4 work.

**Owner decision (Steve, October 3).** Warped luminance masks and combinations at up to two byte
levels (up to 2.124 as stored; at most 0.03% of a real region, 0.07% of a reference region) are
accepted as a case-specific exception (P3-MASK-REVIEW-03), like the warped feathered brush case.
It is not a general three-level approval; the general limit stays two. Do not request review of
unchanged cases again.

**Owner decision (Steve, October 3), speed.** The current timings are accepted as they stand against
their goals: first 100% zoom 636 ms (827 ms straightened) against 300 ms; scopes after first zoom
about 0.9-1.2 s; first feedback after a Fit Feather step 104-250 ms against 100 ms; Fit exact
settlement about 1.0-1.6 s (the deferred automatic-anchor replacement). A regression from these
figures reopens the item. Steve authorized a checkpoint commit (no push), then the coverage audit
and the 30-minute endurance run.

### 14.24 Coverage audit and 30-minute endurance

The [evidence](../technical/archive/viewport-phase3-coverage-endurance-evidence-2026-10-03.md)
records both exit runs.

**Coverage audit.** A new harness makes one edit at a time at 100% zoom and
records the route: all 143 static controls outside the geometry panel on the
saved geometry, one control per module and family on rotate, flip,
straighten, perspective and both combined, and every mask edit and
luminance combination, in both lanes. Final run: 938 rows on the primary and
690 on the four-mask project, every one an exact WebGPU tiled picture, with
no CPU picture, CPU scope or whole native source request and no page error.
The first run found three gaps under index geometry, now fixed: a
combination containing a feathered or shifted brush compiled CPU mask tiles
(about 4.7 s) and is now composed in source space on the GPU (0.81-1.12
levels against export, all verdicts passing); cropped gradient and hard-brush
edits requested small CPU bitmaps they never used; and a measurement of a
combination compiled a CPU mask for its brush leaf. The only CPU mask
requests left are the deferred P3-FALLBACK-01 compiles.

**Endurance.** Thirty active minutes on the primary (1,815 operations, 112
cycles, Match included, no memory cap) complete with zero page errors and no
CPU picture or scope request. Medians of the first and last ten cycles agree
(for example zoom to 100% 418 and 476 ms, Feather drag 1,016 and 1,037 ms).
Registered GPU memory levels off at 4.4 GiB of a 6.1 GiB budget by mid-run
with nothing over budget. The run predates the audit fixes and used the
saved geometry.

Node passes 414 tests; fixture hashes are unchanged. With the speed table
accepted on October 3 and the deferrals already recorded, no phase 3 exit
requirement remains open in the evidence. Closing the phase is Steve's
decision after his own testing; it is not declared here.

### 14.25 Post-testing fixes and Denoise (October 3-4)

Steve tested by hand after 14.24. The fixes, in order: source levels in use
stay in memory (`58bf0de`); stale tiles after a zoom, fixed processing sizes
below 100% and bounded wide Shift regions (`91e4a12`); the Denoise noise model
measured from its sample windows only (`1ee6351`); the picture shifting by
itself and a CPU fallback on zoom under straighten and perspective
(`1eec092`). Causes and timings are in the
[post-testing prompt](../technical/archive/viewport-phase3-post-testing-next-thread-prompt-2026-10-03.md).

**Denoise is now bounded by the view** (`cf15236`). Adaptive Denoise loads no
source of its own; a zoomed-in render reconstructs from the region it already
fetched, so the whole 42 MP frame is no longer uploaded (it was about 3.5 s and
340 MB). The full-size noise model is one measurement per source, the one
export makes, started when a session opens. To read a region source the
adaptive Denoise shader takes the region's origin; its arithmetic is unchanged
and **its byte pin was updated for that one offset**. The Peak and wavelet
Denoise pins are unchanged. An experiment that reused the first geometry's
noise model below 100% was removed: the picture then depended on which
geometry had been seen first.

**Denoised tiles are kept across grade edits.** Denoise reads only ungraded
source pixels, so an Exposure edit used to reconstruct every tile on screen
for nothing. Tiles are now kept for one Denoise state (source, geometry, size,
noise model and controls), from the second pass that draws it, inside a
quarter of the free GPU budget, and dropped on any change of that state, on a
session reset and for a pass that never reached the queue. A kept tile is
pixel-identical to a fresh reconstruction (`tests/denoise-tile-cache.js`).
On the saved 42 MP photo below, frames shown during a 60-input Exposure drag,
before and after, same session conditions, one run each:

| View | Processed long edge | Before | After |
|---|---|---|---|
| 50% | 3,984 | 21 | 37 |
| 75% | 7,968 (native) | 8 | 10 |
| 25% | 1,992 | 44 | 54 |
| 50%, return visit | 3,984 | 21 | 40 |

The first frame of a drag is one reconstruction plus a copy slower (78 to
128 ms at 50%). With the Full override (native at every zoom) the gain is
smaller and noisier (6, 11, 3 frames to 6, 14, 6). These are single runs.

**Accuracy on `Denoise-stuck-DSC04761.hdrfinisher`** (42 MP, strong
perspective, three locals; read-only, hash unchanged). Not a section 8
fixture. Native preview against export, HDR, regions of 1,947,690 pixels:

| State | Luminance p99 / worst | Pixels over 5% | OKLab worst | Within 4.1 |
|---|---|---|---|---|
| Denoise off, no locals | 0.21% / 0.29% | 0 | 0.0011 | yes |
| Denoise on, no locals | 0.69% / 6.90% | 7 of 5.8 million | 0.0119 | no (ceiling) |
| Denoise off, saved locals | 0.50% / 6.27% | 3,276 in one region | 0.0324 | no (ceiling) |
| Same, brush local off | 0.24% / 3.51% | 0 | 0.0180 | yes |
| Same, brush Clarity 0 | 0.31% / 4.20% | 0 | 0.0217 | yes |
| Same, brush Sharpen 0 | 0.43% / 6.89% | 3,738 | 0.0359 | no (ceiling) |
| Saved locals, highlight compression off | 0.29% / 2.71% | 0 | 0.0049 | yes |

1. **The seven Denoise-only pixels need no action** (Steve, October 4).
2. **The larger gap is not Denoise and not Detail arithmetic. It is Peak.**
   The over-limit pixels are specular glints on wet sand. They appear only
   when the brush local's Clarity is on, and then the preview has no bounded
   editing Peak: it shows 796 nits against export's 905 (12% low), where with
   that Clarity off it reads 931 and with the brush off 903. The highlight
   roll-off is fitted to that reading, so the brightest pixels differ. With
   highlight compression switched off the same project is inside every limit.
   This is the deferred P3-PEAK-01 case reached through a local's Clarity
   (radius 0.75% on 42 MP). No Detail, mask or Denoise code was changed for
   it; it closes with the automatic-anchor redesign.
3. **Below 100% the HDR picture is at the 2% continuity limit, with or without
   Denoise.** Saved photo at 50%: 2.55% (2.53% with Denoise off; 0.57% with
   neutral geometry and no locals). Primary fixture: 1.96% at 50%, 2.10% at
   63.3%. Steve deferred this on October 4 as P3-ZOOM-02 (section 15); the
   2% limit is unchanged.

Evidence: `codebase/output/performance/review/local-isolation-2026-10-04/`,
`codebase/output/performance/review/denoise-tile-cache-2026-10-04/`, and the
notes in `docs/technical/denoise-followups-2026-10-04.md`. Node 427
and Python 1,692 pass. Nine Denoise and tiled GPU drivers pass. Three do not,
none because of this work: `roi-pan-cache` fails the same way at `1eec092`;
`denoise-pan-enable-drag` passes on its generated source but on the saved
photo's cold case shows 6-7 frames or a 1.1 s first frame against its own
10-frame / 1 s gate, with and without the kept tiles; and
`local-adjustments-interaction` failed once on an aborted request and passed
on the rerun.

### 14.26 Editing Peak with Clarity, and luminance masks in the measurement (P3-PEAK-01, October 4-5)

Brief: `docs/technical/archive/codex-brief-p3-peak-01-2026-10-04.md`. Findings were
put to Steve first with no product code changed; he approved the Clarity
approach and the luminance-mask fix on October 4. Committed and pushed on
October 5 at Steve's direction.

**What was wrong (three causes, each confirmed by a run).**

1. *Clarity's reach refuses the measurement.* A patch built Clarity's
   brightness map from its own halo, so the halo carried the map's whole
   reach: 250 pixels for a local at 0.75% on the saved photo, 6,291,304 pixels
   against the 4,194,304 budget; 1,121 pixels and 89,870,400 at 3% on the
   four-mask fixture. On a 42 MP frame every radius from 0.6% up refuses, which
   includes the default 0.75%. The roll-off then ran on a carried or estimated
   anchor.
2. *The measurement's luminance masks were the 1,600-pixel bitmaps.* At that
   size a specular is averaged into its surroundings and lands inside a range
   it lies above, so a luminance-range local graded the very pixels the anchor
   is read from. On the saved photo the editing anchor was 12-15% above
   export's exact anchor with no Clarity anywhere (4,740 against 4,226 nit with
   the brush off; 4,974 against 4,332 with the brush's Clarity at 0). The Peak
   readout hid it, being measured through the same masks. The picture's
   highlights came out about 4% dark: around the brightest area, with the
   brush's Clarity at 0, luminance p99 was 4.01% against the 2% typical limit.
   The "inside every limit" rows of 14.25 held only for the two regions tested.
3. *Each patch was read over its halo as well.* The halo's outer pixels lack
   the neighbours Detail reads, and one of them could outshine the patch (a
   Peak readout of 931-945 nit on a picture whose brightest pixel is 905).

**What changed (preview measurement only).**

- When the patches' own halos would exceed the budget, Clarity's maps come
  from one reduced render of the whole frame (long edge 1,600, the level the
  robust anchor already uses), resampled onto the blocks the full-size map
  would use. The patch then needs no halo for Clarity. The reduced frame's
  pixels are counted against the budget: the saved photo measures 2,235,436
  pixels. While the halos fit, a patch still builds its own map as before.
- A plain luminance-range leaf is qualified from the patch's own pixels.
  Combinations containing one, and a feather wide enough to be blurred on a
  reduced grid, keep the bitmap.
- The reduction reads the patch alone, not its halo.

No limit, budget or pinned shader changed. The picture shader gains one
fragment entry (`claritySurroundFragmentMain`); the Peak-reduction and Denoise
pins hold. Export, Proof, Detail, mask and Denoise arithmetic are untouched.

**Peak, editing against export (HDR, native).**

| Case | Before | After |
|---|---|---|
| Four-mask, Texture 100, Clarity 100 / 3%, Sharpen 100 (14.9) | 2,989 / 3,703 nit, 19.3% low | 3,696 / 3,703, 0.19% low |
| Four-mask, Clarity 100 / 3% alone | not measured | 3,209.3 / 3,209.0, 0.01% |
| Saved photo as saved (brush Clarity 29, 0.75%) | 796 / 905, 12% low | 907.5 / 904.7, 0.31% high |
| Saved photo, brush Clarity 0 | 931 / 905, 2.9% high | 907.5 / 904.7, 0.31% high |
| Saved photo, brush off | 903 / 905, 0.19% low | 907.5 / 904.8, 0.30% high |
| Saved photo, highlight compression off | no bounded figure | 4,323.9 / 4,317.6, 0.15% high |
| Primary as saved | within 1% | 636.6 / 638.2, 0.25% low |
| Four-mask as saved | within 1% | 3,209.3 / 3,209.0, 0.01% |

Highlight anchor on the saved photo, editing against export's exact value:
4,323.9 / 4,332.0 nit as saved and with the brush's Clarity at 0 (0.19% low;
was 14.8% high or unmeasured), 4,218.2 / 4,226.3 with the brush off (0.19% low;
was 12.2% high), 4,341.5 / 4,348.6 with the luminance local off.

**Picture at 100% against export (section 4.1), saved photo, three regions
including the brightest area.** As saved: worst luminance 2.71%, OKLab 0.0049,
no pixel over the ceiling (was 6.27%, 0.0324, 3,276 pixels). Brush Clarity 0:
the same figures; the brightest area is p99 0.28%, worst 1.36% (was 4.01% /
4.21%). Brush off: worst 0.47%. Compression off: unchanged. Both four-mask
Clarity cases, the primary and the four-mask as saved pass every verdict.

**The reduced map against the patch's own.** With the reduced render switched
off and the same patches measured with their full halos in budget-sized groups,
all sixteen patches agree within 0.074% (one half-float step) at global Clarity
+100 and -100 with radii 0.75%, 1% and 1.5% on the saved photo, with the
brush's Clarity at 29 and at 100, and within 0.053% at Clarity 100 / 2% on the
four-mask fixture. `tests/performance/editing-peak-clarity-reference.js`
repeats this. Above about 2% no patch fits the budget with its full halo, so
the 3% radius is checked against the export only (the two four-mask rows).
Clarity fades out on a pixel far above its surroundings, so it rarely moves an
isolated peak; the per-patch check is the more sensitive of the two.

**Speed.** Primary (no Clarity), Fit Feather steps to the anchor replacement:
1.06-1.63 s after, 1.06-1.65 s before, four sessions each, alternating; first
100% zoom 431-545 ms both ways. Saved photo: the picture after a Fit local edit
is first exact at 26-27 ms (22-23 before); its scopes settle at 0.48 s against
0.18 s, because the Peak is now measured where it was refused. An edit that
moves the anchor is now followed by the anchor-replacement frame, as in every
project without Clarity. First 100% zoom 1.00 s against 0.96-0.98 s. One
measurement pass takes 0.30-0.40 s with the reduced render (shared by the Peak
and anchor passes of one edit) and 0.20-0.38 s without.

**Found on the way.** The Peak readout and the anchor measurement start side
by side; two reduced renders on one canvas superseded each other's source load
and both failed at Fit. They now share one render.

**Not met, and open.**

- P3-PEAK-02 is unchanged: maximum Sharpen with no locals reads 3,639 against
  4,015 nit (9.37% low). An ordinary measurement now uses 0.26-0.9 million of
  the 4.19 million pixels, so more patches would fit; that is not done.
- The automatic-anchor settle (about 1.0-1.6 s) is unchanged.
- The candidate ranking still uses the reduced masks; only the patches use
  the patch's own luminance mask.
- `highlight-anchor-stability.js` fails, identically before and after this
  work: with Denoise off its own reference measurement returns nothing for
  three strokes and differs by 8.6% on the fourth. Not investigated.

Evidence: `codebase/output/performance/review/peak-01/` (`final/` holds the
last serial pass). Node 427 and Python 1,692 pass with three skips.
`editing-peak-bounded.js` passes on the primary, four-mask and saved projects:
no source or mask above a 1,600 edge (on the saved photo no region above
55,696 pixels).
Fixture hashes are unchanged.

**Owner decision (Steve, October 5).** On October 4 Steve found the Clarity
Radius slider's upper range poorly tuned and was open to limiting Radius, and
Amount a little. The measurement no longer needs a limit: it holds at 3%. Told
that, Steve decided to leave the Clarity controls as they are for now. He
authorized the commit and the push.

## 15. Deferred, accepted and known limits at the end of phase 3 (October 3, 2026)

One register of what phase 3 leaves behind. Each row links to where it was
measured. "Reopen" says what would bring the item back.

### 15.1 Deferred by Steve (work not done, on purpose)

| ID | What is deferred | Current state | Reopen when | Detail |
|---|---|---|---|---|
| P3-MATCH-01 | Further Match speed work | 3.05 s primary, 4.99 s fifty-local against 2 s / 4 s goals | It gets slower, or Match speed becomes a priority | 14.5, 14.6 |
| P3-PEAK-02 | Peak with maximum Sharpen | Reported Peak about 9% low (3,639 against 4,015 nit, measured again October 5); candidate patches miss export's maximum. P3-PEAK-01 closed without it | It is taken up on its own; the measurement has spare budget for more patches | 14.11, 14.26 |
| Automatic anchor | Redesign of the automatic highlight-anchor measurement | Correct within 1% in ordinary states, and now with Clarity (14.26), but its re-measure is why a Fit edit takes about 1.0-1.6 s to settle fully | With P3-PEAK-02. Parallel patch fetching was tried and not kept (14.23) | 14.17, 14.23 |
| P3-ZOOM-01 | SDR cross-scale continuity | Block luminance p99 3.35% against a 2% typical limit; HDR passes at 0.68% | It is visible in use | 14.13 |
| P3-ZOOM-02 | HDR cross-scale continuity below 100% (deferred October 4) | At the 2% typical limit: 2.55% on a strongly corrected 42 MP photo at 50%, 1.96% / 2.10% on the primary at 50% / 63.3%. Denoise is not the cause | It is visible in use | 14.25 |
| P3-FALLBACK-01 | The larger-bitmap fallback for a feathered brush no bitmap size qualifies for | Compiles a 3,200-pixel CPU mask in the background (about 0.04-1.2 s); October 5 broader coverage also records other CPU mask work (15.6) | It is explored on its own; do not change without Steve | 14.21, 14.24 |

### 15.2 Accepted by Steve (measured outside a limit or goal, accepted as is)

| ID | What was accepted | Scope of the acceptance | Detail |
|---|---|---|---|
| P3-MASK-REVIEW-01 | Three rounded brush panels (228, 249, 421) above two levels | Those exact images only | 14.17 |
| P3-MASK-REVIEW-02 | Warped feathered brush masks at up to two byte levels (2.06 as stored, six reference pixels) | That kind of mask only | 14.22 |
| P3-MASK-REVIEW-03 | Warped luminance masks and combinations at up to two byte levels (2.124 as stored; at most 0.03% of a real region) | That kind of mask only | 14.23 |
| Shift release | Saved feathered Shift release 151 / 141 ms HDR / SDR against 100 ms | That control only | 14.21 |
| P3-DENOISE-PIX-01 | Seven pixels of 5.8 million over the 5% luminance ceiling with Denoise on and no locals (worst 6.9%) | That photo and measurement (Steve, October 4: no action) | 14.25 |
| Speed table | First 100% zoom 636 ms (827 ms straightened) against 300 ms; scopes after first zoom about 0.9-1.2 s; first feedback after a Fit Feather step 104-250 ms against 100 ms; Fit exact settlement about 1.0-1.6 s | These figures; a regression reopens the item | 14.23 |

None of these is a general approval. The general soft-mask limit stays two
levels.

### 15.3 Known limits (not deferred by decision, not blocking)

| Area | Limit | Detail |
|---|---|---|
| Masks under straighten/perspective | A mask containing a gradient with its luminance option on, a sampled leaf, or a degenerate or disabled combination keeps the previous route. So does a feathered luminance region above 24 megapixels or one whose feather reach exceeds the texture limit | 14.23 |
| Straightened first zoom | The luminance mask's whole-frame range scan is the largest remaining cost (about 770 ms on a 36-megapixel file) | 14.23 |
| Native Shift | A full-frame mask with Shift at 24 megapixels takes 0.4-0.5 s to prepare; unfeathered native Shift waits on the queue per region and rescans the painted peak | 14.20, 14.21 |
| Wide frames | Frames wider than the GPU texture limit have reference coverage only; no real fixture exists | 14.22 |
| Coverage audit | October 5 current-code audit includes Denoise and the fifty-local project, with real 400 x 300 pans. Still one committed edit per control, not a drag; representative controls on non-saved geometries | 14.24 |
| Endurance | Repeated October 5 on current code: 30.261 active minutes, 85 cycles, 1,378 operations and two idle minutes. Saved geometry only; no long warped-geometry endurance. See 15.6 for errors, CPU work, memory and drift | 14.24 |
| Timing evidence | Perspective and un-straightened first-zoom timings are single sessions | 14.23 |
| Not designed | Healing brush | 10 |
| Denoise coverage | October 5 audit includes Denoise across both lanes and six geometry states. Cold pan-enable-drag gate on the saved 42 MP photo remains a measured limitation: 5 and 7 frames, then none, during 60 inputs on October 5 | 14.25 |
| `tiled-admission-scope-fallback` driver | Fails at `de48a40` and after the October 5 fixes alike: the CPU scope is presented, but the driver's own scope request resolves false. October 5 investigation: automatic scope generations supersede the driver's explicit refresh; likely test timing race, high confidence. Assertion retained; current failure remains recorded | 15.5 |
| Editing Peak masks | The measurement makes a plain luminance-range leaf from its patch. A combination containing one, and a luminance feather wide enough to be blurred on a reduced grid, keep the 1,600-pixel bitmap, as does the candidate ranking | 14.26 |
| Editing Peak with Clarity | Above about 2% radius on a 42 MP frame the reduced Clarity map is checked against the export only (four-mask fixture, 3%), not patch by patch | 14.26 |

### 15.4 Not changed in phase 3

Peak and Denoise shader byte pins; the 4,194,304-pixel editing-Peak budget;
exact CPU export and Proof; the rounded brush shader; classifier limits;
immediate discrete zoom and the 80 ms continuous-zoom debounce.

Since then (14.25): the adaptive Denoise shader's pin was updated for a
region-origin offset, with its arithmetic unchanged. Everything else in this
list still holds, including after 14.26.

### 15.5 Closed since this register was written

| ID | What it was | Closed | Detail |
|---|---|---|---|
| P3-PEAK-01 | Peak with wide Clarity, and with a local's Clarity on a 42 MP frame (about 19% and 12% low; roll-off up to 6.3% from export) | October 5: within 0.31% on every measured case, picture inside section 4.1, budget and limits unchanged | 14.26 |
| `roi-pan-cache` driver | Failed three runs of three: a scope, navigation or Match render sent to the tiled route drew into the viewer's retained target and replaced its accepted frame, so the next pan pass had nothing to keep | October 5: such a render is refused before it is encoded (its callers only ever used a Direct result). Four runs of four pass | 15.3 |
| `highlight-anchor-stability` driver | Its reference was measured on whichever resident source rendered last, which at 200% is the 512-pixel navigation proxy (8.6% low) | October 5: the reference is the app's bounded measurement for the recipe, and the driver waits for it. That exposed a product gap, also fixed: an anchor request queued during a drag carried an earlier input's key, so its measurement was cached by the renderer but never recorded as delivery evidence. Two runs of two pass | 15.3 |
| Desktop smoke test | Waited for "Project saved" in the project badge; the September 28 status bar moved that message | October 5: reads the status bar entry. Passes | 14.25 |

Committed locally as `c905bd8`, not pushed. Node 427 and Python 1,692 pass with three
skips. The cold Denoise pan-enable-drag miss on the saved photo (15.3) is a
real timing and was measured again: 5 and 7 frames.

### 15.6 Current-code baseline before cleanup — October 5

The [baseline evidence](../technical/archive/viewport-phase3-baseline-before-cleanup-2026-10-05.md)
records the complete automated sweep, failure classifications, broader coverage
and repeated endurance. This adds measurements, not owner acceptances or
phase 3 closure. Every deferral and acceptance above keeps its original scope.
No phase 4 work, app code, pinned shader, budget or tolerance changes are included.

Current findings require Steve's closure decision: suspected pixel defects in
SDR B&W, Exposure Bands scopes, gradient parity, tiled spatial filtering and
Sharpen Threshold; performance misses in heavy native-zoom dragging and
luminance feather; and a 0.516% Clarity anchor-patch result against the 0.50%
reference gate on the active 42 MP fixture. The October 5 P3-PEAK-01 closure
above remains the historical owner record; this new gate miss is recorded
for assessment without silently reopening or broadening it.

The fifty-local audit completes 4,202 rows, including 312 Denoise rows and 12
real pans, with zero audit errors and exact WebGPU accepted presentations.
It also flags 181 rows: CPU mask work, CPU scopes, whole-source requests and
five CPU picture fallbacks. Exact GPU presentation does not imply zero CPU
work. Known warped-mask limits and the deferred brush fallback do not grant
a general acceptance of these findings.

Endurance completes without page/sampler errors or allocation over budget.
Registered GPU memory rises from 61.4 MiB to 4,378.6 MiB (4,394.5 MiB peak),
then plateaus below the unchanged 6 GiB setting. It records six CPU scope
requests, 450 CPU mask requests and 35 HTTP 409 responses; response bodies
were not captured, so benign cancellation is not proved for every 409.
First-to-last cycle windows show HDR Clarity +32.8%, fresh brush +22.9% and
native zoom +27.4% in operation totals. Values and positions vary by cycle:
this is observed drift, not a controlled regression attribution. Drag release
and scope goals are missed; the evidence retains all measured misses.

The corrected primary and four-mask audits are also complete: 1,250 / 1,166
rows, 69 / 35 flagged rows, zero page errors, 312 Denoise rows and 12 real pans
each. Primary records no CPU picture/scopes, 121 CPU masks and 13 whole-source
requests. Four-mask records three CPU picture fallbacks, no CPU scopes,
36 CPU masks and 14 whole-source requests. Its Exposure edits after rotation,
flip and straighten still refuse GPU work with dirty-edit-with-stale-geometry;
these remain suspected app-routing issues, not accepted exceptions.

The remaining variants, packaged checks, diagnostic helpers, final fast reruns
and fixture hashes were completed the same day. The fresh packaged smoke test
and packaged baselines pass, the fast suites are unchanged (Node 427, Python
1,692 with three skips, 36 additional), and all four fixture hashes match. The
cold Denoise pan-enable-drag case on the saved 42 MP photo showed no frame
during its one-second drag. The baseline is complete and committed locally as
`1858790`.

### 15.7 Phase 3 closure and carry-forward list (Steve, October 5, 2026)

Steve closed phase 3 on October 5 after the baseline in 15.6. Closing it is
not an acceptance of anything below: at that closure every item was open,
kept its limit, and was carried forward by name. Later dated fixes, closures
and owner acceptances in the rows below supersede that original status.
The deferrals and acceptances in 15.1 and 15.2 stand with their original scope. Detail and logs for every row are in the
[baseline evidence](../technical/archive/viewport-phase3-baseline-before-cleanup-2026-10-05.md).
Steve chose to start phase 4 before these are confirmed; phase 4 must not
delete or rewrite the code an unconfirmed item points at (see the last
column) without confirming the item first.

**Suspected defects in the picture. None is confirmed.**

| ID | What was measured | Confidence | Check that shows it |
|---|---|---|---|
| CF-PIX-01 | A very small image (70 pixels) asks for a preview size below the backend minimum of 256 and gets two HTTP 422 errors after export **Fixed October 7:** source transport now requests at least the API minimum of 256, while the backend retains the tiny image's native dimensions. The 70-pixel region probe was the rejected request; CPU export is unchanged. Export/file-browser check passes with all four formats and no browser error | High | `tests/export-file-browser-interaction.js` |
| CF-PIX-02 | SDR Black & White: four filtered-channel cases differ between preview and export beyond the pixel limit; HDR passes **October 7 quick pass:** Still open; needs more than a quick look to isolate app versus check. One fresh `bw-parity` run repeats the same four SDR filtered-channel failures (red filter with/without Film: added mean 0.295/0.289 levels; alternating: 1.475/1.462 levels, p99.9 5). All HDR, SDR neutral, and SDR all +100 cases pass. The check synchronizes the recipe, settles the automatic anchor, verifies equal 1200x800 frames and compares against CPU preview-raw. Source inspection shows both implementations use a source-neighbourhood hue guide before SDR highlight mapping; no small clear cause was established. CPU reference and assertions unchanged. | Moderate | `tests/bw-parity.js` |
| CF-PIX-03 | SDR scopes with Exposure Bands: Peak differs by 4.71% against 3% **October 7 quick pass:** Still open; needs more than a quick look to isolate scope sampling versus grading. One fresh `gpu-scope-parity` run repeats 4.71% (GPU 0.91748046875, CPU 0.96282637119) against 3%. The test compares the presented GPU scope and backend scope at the same requested recipe and source; GPU scopes use a bounded analysis readback while the CPU peak is evaluated by the backend. That difference in measurement path needs an isolated pixel/readback comparison before changing either the app or check. CPU reference and limits unchanged. | Moderate | `tests/gpu-scope-parity.js` |
| CF-PIX-04 | Linear gradient: the GPU mask differs from the CPU bitmap by far more than the 1/255 gate **October 7: the check was wrong, not the app.** Forcing the Tiled route schedules an ordinary Fit redraw that landed after the check's first render, so it compared an 827 x 465 frame with a 1024 x 576 one, value by value; the 7.06 was that mismatch. The check now reads back the frame it asked for and refuses frames of different sizes; its gate is unchanged. Compared like for like the pictures differ by at most 0.0059 linear (about 0.2% of that pixel's brightness), still over this check's 1/255 (0.0039), so it stays red by that small honest amount. Against the export's own mask (`compile_geometry_fixed_mask`) at Fit (827), 1024 and 100% (1280), on Direct and Tiled: the CPU bitmap is within 0.13 of 255 levels everywhere; the GPU mask is within 1.11 levels, off by one level in 8 to 20 pixels per frame and equal elsewhere. Section 4.2 allows 2 levels. Nothing visible in use. **Closed October 7 (Steve):** the check now gates on the section 4.2 limit, the two masks within 2 of 255 levels, in place of a picture gate of 1/255; it measures 1.01 and passes. The picture difference is still reported. A one-level drift in gradient masks would no longer fail this check | Closed (check fault; gate set to 4.2 by Steve) | `tests/performance/gpu-linear-gradient-parity.js` |
| CF-PIX-05 | Local Sharpen Threshold 0, 10 and 100 give identical pixels; the synthetic source may be insensitive **Closed October 7: check stimulus was insensitive.** The 70-pixel fixture at radius 0.3 repeats identical results. At the ordinary radius 0.8, mean differences are 0.0000001645 (0 vs 10) and 0.00019949 (10 vs 100); all original assertions pass in `webgpu-shader-compilation`. Only the check radius changed; app, CPU reference, and limits are unchanged. | Moderate | `tests/webgpu-shader-compilation.js` |
| CF-PIX-06 | Spatial film effects at tile size 512: 20 pixels differ, largest 4 levels, against byte-exact **October 7 quick pass:** Closed as out of date for the current check: `tiled-film-parity` passes all retained cases at tile sizes 256 and 512, including spatial, maximum spatial, and B&W plus spatial; zero differing pixels and max delta 0. No shader or guard changed. | Moderate | `tests/tiled-film-parity.js` |
| CF-PIX-07 | **Closed: accepted October 8, 2026 (Steve), close enough.** Two October 7 `tier-film-consistency` runs both measured diffusion/bloom disagreement **1.25236**, against the original 1.25 guard. This is the accepted result for that scenario, not an open defect or a request to decide the limit. Future comparable results at or below **1.25236 (ratio, rounded to five decimal places)** are accepted known deviations: do not rerun tests, investigate, or reopen this item merely because the original 1.25 guard reports failure. Revisit only for a materially worse comparable result, a visible problem, a change that invalidates this comparison, or Steve's explicit request. App and numerical test guard unchanged; classify a matching raw guard failure as accepted, not newly unresolved. | Closed (owner accepted) | `tests/performance/tier-film-consistency.js` |
| CF-PIX-08 | Found October 6. On the Direct route, turning Show noise off sometimes does not restore the graded picture exactly: 2 of 5 runs at `359d329` (before that day's fixes), 1 of 3 after them. Not investigated **Closed October 7: the check was wrong, not Show noise.** Still failing at `e13dd5b` (4 of 14 runs). In every failure the two screenshots were different sizes (387 against 339 pixels wide): the passing "Source imported." notice widens the status row, and in the check's 1280-pixel window the viewer with it (1,106 pixels, then 969 when the notice expires a few seconds after import), so the patch being compared moved. The check now waits for the notice to go, captures the same rectangle both times and reports a moved viewer as such; the exact-match gate is unchanged. 20 of 20 runs pass on Direct and Tiled. Seen in passing and fixed the same day: in a window that narrow the viewer was wider than its panel (969 in 889), so the picture area was clipped on the right and shifted when a notice came or went. The panel column can no longer outgrow the panel; a long notice is shortened with an ellipsis instead | Closed (check fault) | `tests/denoise-noise-view.js` |
| CF-PEAK-01 | **Closed: accepted October 8, 2026 (Steve), close enough.** On the original 42 MP four-mask fixture with global Clarity 100 / 1.5%, all three October 7 `editing-peak-clarity-reference` runs measured worst anchor-patch error **0.516351%** (unrounded **0.5163511187607495%**), against the original 0.50% guard. Finished-peak patch error was **0.487329%** each time; overall anchor and peak agreed exactly. These are accepted results and do not reopen P3-PEAK-01. Future comparable anchor-patch errors at or below **0.516351% (rounded to six decimal places in percent)** are accepted known deviations: do not rerun tests, investigate, or reopen this item merely because the original 0.50% guard reports failure. Revisit only for a materially worse comparable result, a visible problem, a change that invalidates this comparison, or Steve's explicit request. Pinned shader, CPU reference and numerical test guard unchanged; classify a matching raw guard failure as accepted, not newly unresolved. Read-only project hash remains unchanged. | Closed (owner accepted) | `tests/performance/editing-peak-clarity-reference.js` |

**Speed.**

| ID | What was measured | Check |
|---|---|---|
| CF-SPEED-01 | Exposure drag at 200% on the heavy project: baseline 2.4 frames a second (49.6 at Fit) against 30 / 20 floors. Phase 4 counter follow-up: 0.2 at 200%, 50.0 Fit; original-probe control 1.4 at 200%. Open, unattributed; see 16.5 | `tests/performance/drag-gpu-load.js` **October 6:** cause found, not fixed. At 200% each drag frame is drawn in about 8 ms, but 139 of 155 were discarded on completion because the slider had moved again. Adaptive Denoise drags already let a frame finish; applying that to every drag gave 49.7 fps at 200% (Fit unchanged at 49.3) in an uncommitted two-line experiment. Steve, October 6: saved for later; the 200% drag is fine for him as it is |
| CF-SPEED-02 | Warm luminance Feather p95 1,005.6 ms against 1,000 ms **October 7 quick pass:** Needs more than a quick look: the one fresh `luma-feather-latency` run stops before timing with a null selected local while reading its mask. No new latency verdict is possible from that run; the prior 1,005.6 ms result remains. No tuning or check changes. | `tests/performance/luma-feather-latency.js` |
| CF-SPEED-03 | First feedback of about 0.75-1.0 s on the colour-wheel pad, brush Feather and Shift Edge, and the luminance rails; straighten and perspective drag-and-Apply 1.4-1.7 s | `heavy-project-drag-review.js` |
| CF-SPEED-04 | Headline latency: cold 100% zoom feedback 850 ms against 150 ms; warm 200% slider feedback p95 85 ms against 50 ms | `headline-latency.js` |
| CF-SPEED-05 | Cold Denoise pan-enable-drag on the saved 42 MP photo: none to seven frames during 60 inputs | `tests/denoise-pan-enable-drag.js --project` |
| CF-DRIFT-01 | 30-minute endurance: HDR Clarity drag +32.8%, fresh brush stroke +22.9%, zoom to 100% +27.4% between the first and last ten cycles. Observed, not attributed | `heavy-project-long-session.js` |
| CF-DRIFT-03 | New warm headline target misses repeated: Fit current/refined p95 258.7ms vs baseline 33.4 (50/100ms targets), warm 100% refined 108.3 vs 53.9 (100ms), warm native zoom 891.9 vs 9.1 (150ms). All four first-run misses reproduced, observed/unattributed; no app fix or limit change. See16.21 |
| CF-DRIFT-04 | Primary rotated SDR compact-Haar color_noise: baseline 582 ms, first 15,013 ms, focused repeat 575 ms. Outlier not reproduced in 90-row zero-error exact-WebGPU repeat; first measurement and other long tails retained, intermittent/unattributed. See16.21 **Closed October 7:** the outlier row was a legacy wavelet (compact-Haar) Denoise row; that method is deleted (`4fb9fbd`, `464d978`), so the row no longer exists. In the October 7 narrow repeat (see CF-DRIFT-05) no Denoise row took longer than 0.9 s. The other long tails named in 16.19 were not re-measured |
| CF-DRIFT-05 | Completed fifty-local audit: edit-revision mismatch 3804/3805 at flip/SDR compact-Haar amount; both/SDR compact-Haar enable apply-settle and amount restore-settle hit original 120s guards. Initial interrupted audit recovered before agent stop; no confirmed livelock. Repeat completes 4,202 rows but is not green. See16.21 **Closed October 7:** every failing row was a legacy wavelet (compact-Haar) Denoise row, and that method is deleted (`4fb9fbd`, `464d978`). Narrow repeat at `2861a95` on the fifty-local project, SDR lane only, in saved, flip, perspective and both, Denoise rows included (adaptive method, 11 rows per state): 1,363 rows in 11.7 minutes, no page error, no settle timeout, no flagged row, every row exact WebGPU; project hash unchanged. Not covered: the HDR lane, rotate and straighten, and whether the cause was the wavelet method itself or the idle redraw fixed in `cc94373` |
| CF-DRIFT-02 | local-design-qa reaches retained visual checks after pending/assigned-mask setup repair: shared switch is 46x20 with 2px border, original contract requires 46x24/borderless. Diagnostic also observes scrollbar/control-section mismatches and keyboard-lane timeout. Four original clipboard reference images are absent, so intended appearance remains unconfirmed. No app fix or weakened assertion. See 16.12 |

**CPU work behind an exact GPU frame.**

| ID | What was measured |
|---|---|
| CF-ROUTE-01 | An Exposure edit after rotation, flip or straighten falls back to a CPU picture (`dirty-edit-with-stale-geometry`): three on the four-mask audit, five on fifty-local **October 6:** fixed in `b245000`. The refusal was a stale note: a draft dropped for an edit-revision mismatch recorded no reason, so the settle pass read the geometry commit's earlier refusal as its own |
| CF-ROUTE-02 | CPU mask requests beyond the deferred P3-FALLBACK-01: 121 primary, 36 four-mask, 402 fifty-local, including 512-edge masks and mask tiles **October 6:** explained, no fix. With legacy Denoise never used in the session, the only CPU mask request found is the deferred P3-FALLBACK-01 (primary and fifty-local, both lanes, edits and pan). Once legacy Denoise has been enabled, even if turned off again, gradient, luminance and combination masks and pans go to the CPU for the rest of the session; that reproduces the audit counts and goes with the legacy removal below Legacy Denoise was removed the same day, so that cause is gone; no audit re-run. |
| CF-ROUTE-03 | Whole native source fetched by enabling legacy Denoise and by a few colour rows: 13-14 requests an audit **October 6:** the legacy Denoise part is gone with the method; the colour rows are not looked at. |
| CF-ROUTE-04 | CPU scope requests: nine on fifty-local, six for HDR during switches to SDR in the endurance run **October 6:** fixed in `3397578`: a scope scheduled for the lane just left ran as a discarded CPU scope, and a 100% scope pass interrupted by a pan or catch-up pass was read as a GPU refusal. The other five fifty-local rows are legacy Denoise rows |
| CF-ROUTE-05 | 35 HTTP 409 responses in the endurance run; probably superseded work, bodies not captured |
| CF-ROUTE-06 | Phase 4 explicit 1 GiB Full test: minimum graph requires Tiled, but 25 interactive drafts reach renderer refusal (`tiled-refused:interactive render`) rather than the preserved pre-dispatch guard; source/parameter preparation precedes refusal. No app fix; see 16.8 **October 6:** fixed in `a0168a8`: the pre-dispatch refusal dropped in `9c8315e` is restored for whole-frame tiled drag frames. `full-tier-tone-cost` passes |
| CF-ROUTE-07 | Same settled-render overlap enters CPU settle branch once for `coalesced-by-newer-render` in two repeats. Zero CPU picture HTTP requests in these warm runs; original branch-level guard remains red. See 16.8 **October 6:** fixed in `a0168a8`: `coalesced-by-newer-render` is now treated as the supersession it is |
| CF-ROUTE-08 | Execution readout reports Direct while accepted viewer execution is Tiled at 100%, 200% and Full/Fit under 1 GiB. Both repeats agree; the readout reads the last renderer plan, which can belong to auxiliary work. See 16.9 **Fixed October 7:** execution labels and Technical Processing use accepted viewer transport/execution. The original budget-route check reproduced all three mismatches before the fix and passes afterward (100%, 200%, and 1 GiB Full/Fit), with no page errors. |

| CF-ROUTE-09 | Found October 6 on Steve's DSC00264 project (42 MP, Denoise and Highlight Compression on). After the first sharp frame at 100%, the app streams the whole native source (`proxy-stream`, long edge 7968, about 330 MB, 0.8 s) and presents the view a second time, about 2.2 s after the click on a first visit and 1-1.5 s later. The first sharp frame is at 0.1-0.3 s. Why the whole source is fetched is not yet established; removing it would make a pan at 100% fetch each newly exposed strip instead. One instrumented run each; not fixed **October 6:** cause established, not changed. It is the catch-up pass: with no hard-edged mask in the project it draws the whole frame about a second after the view pass so later pans need no fetch. Projects with a hard-edged mask already skip it and fetch strips on pan. Explained to Steve October 6; left as it is unless he asks for the change |
| CF-SPEED-06 | Same trace: on a first 100% visit the 16-patch highlight anchor measurement runs twice in a row (about 0.3 s each). One run; not fixed **October 6:** not reproduced. The 16-patch measurement ran once, at open. After the 100% click there are two small whole-picture fetches of about 0.3 s each, for the scopes (960) and the navigation thumbnail (512) |

**Closed October 6.** With adaptive Denoise and Highlight Compression both on,
the picture and scopes never settled while idle (found by Steve by hand; no
driver checks that the app goes quiet). Fixed in `cc94373`. It may bear on
CF-DRIFT-03 and CF-DRIFT-05; that is not measured.

**Removed October 6 (Steve).** The legacy wavelet Denoise method is deleted
(`4fb9fbd`, `464d978`); the adaptive method is the only one, and the five
wavelet analysis fields are gone from the saved-project schema. Checks removed
with it: the wavelet reference and tile tests, `denoise-tiled-parity`,
`denoise-cache-identity`, `denoise-memory-trace`, the wavelet shader pin, and
the `--wavelet` and `--ui` modes of `denoise-selector-seam`. The renderer still
carries the general Denoise branches and budget accounting the adaptive method
uses.

**Opening older projects (Steve, October 6).** Opening a project now drops any
field the app no longer has, and any field holding a choice the app no longer
offers, which then takes its default; the names are logged and the next save
writes the file without them. A running session stays strict. This replaces
per-feature conversion code: the three open-time conversions (RAW highlight
bypass, the HDR highlight Off mode, the legacy SDR rendering default) are
removed. Effect on the 22 saved projects found on this machine: 18 open (4 are
schema v1-v3, refused as before). Eleven were saved with the wavelet method and
now use the adaptive one; in seven of those Denoise was on, so their picture
changes. Four predate the RAW highlight and SDR rendering fields: on opening
they now get RAW highlight reconstruction and the current SDR rendering, so
their picture can change too. The four protected test projects are current and
unaffected. The rest of the old-project code went the same day: the legacy SDR
renderer (`legacy_base_v1`) and its settings, the highlight `off` mode, the Film
Look image-structure move into Detail and the Denoise Fine-to-Finest carry-over.
Older projects that used them open with the current rendering and defaults.

**Old-preferences code removed (Steve, October 6; `6255b81`).** The preview-tier
migration and its notice, the Responsive-to-Faster-dragging carry-over, and the
reading of `rendering-preferences.json` and `favorite-folders.json` are gone.

**Legacy SDR Match and legacy shader inputs removed (Steve, October 6;
`dfd2505`, `421294e`, `134eb7d`).** The v1 SDR Match (the hidden renderer
behind "Convert legacy match" and "Revert") is gone from the CPU render and
export, the render cache, the session commands, the saved-project state and
the SDR panel. There is one kind of Match; the project stores only its status
and quality numbers. A project saved with a legacy match active opens as a
plain SDR grade, so its SDR picture changes: one of the 22 saved projects
(`IMG_0790`), none of the test projects. The File menu has Revert HDR and
Revert SDR instead of a panel button: each returns one rendition (its grade,
its Denoise, its side of every local grade, and for SDR the Match status) to
the state of a newly imported file, as one undo step, and leaves the other
rendition, the geometry, the masks and the source settings alone. The render
shader no longer contains the legacy SDR base rendition or its inputs
(parameters 12 to 14 and 60). That shader has carried no byte pin since
October 1; the two pinned shaders (peak measurement, Denoise) are unchanged.
Match results, preview screenshots at Fit and at 100%, and full-size HDR and
SDR exports of the four-mask project are byte-identical before and after.

**Legacy code still present.** Parameter 159 (the old "current SDR rendering"
flag) is still sent because the pinned peak-measurement shader reads it to
tell the SDR lane. The GPU renderer and the source transport still accept a
source identity, now always `"source"`; it is threaded through much of both
files and was left at the entry point. The shader's separate grain switch and
strength (parameters 156 and 157) existed for grain inherited from a legacy
match and now always equal Film Look's own (78 and 79).

**Checks that fail because they still describe the old design (phase 4
input).** Each is rewritten for the viewport-bounded design or retired with
the reason recorded; none is deleted only to make a run green.

`desktop/tests/highlight-lane-4k.js`, `tests/gpu-highlight-compression-parity.js`,
`tests/local-design-qa.js`, `tests/native-region-stall.js`,
`tests/path-feather-mask-cache.js`, `tests/scope-exact-peak.js`, and under
`tests/performance/`: `budget-route.js`, `denoise-drag-region.js`,
`denoise-stale-source.js`, `full-tier-tone-cost.js`, `phase4-preview.js`,
`phase4-regression-browser.js`, `roi-refinement.js`, `roi-source-transport.js`,
`tier-change-blank-canvas.js`, `tiled-mask-batch-transport.js`, and the flight
counter in `drag-gpu-load.js`. Test timing races, not app faults:
`tests/tiled-admission-scope-fallback.js` and
`tests/performance/full-tier-instrumented-tiling.js`.

## 16. Phase 4 cleanup record (October 5-6, 2026; closed October 6 with known issues, green exit unmet)

Steve approved inventory Group A: remove only the unused `roiPanCandidate`
app wrapper and `admitDirect` renderer wrapper. Their active implementations
remain in the render coordinator and render planner. Repository-wide caller
searches found no executable caller for either wrapper.

Removed: app.js 14 lines including its obsolete comment, webgpu-preview.js
3 lines; 17 lines / 713 UTF-8 bytes before their two separator blank lines
(19 source lines including separators). No shader, limit, budget, CPU export,
Proof, fallback or saved-project format changes.

The Python pan-delegation source check now verifies the live app pan intent,
the coordinator eligibility conditions and both scheduling/refinement callers.
Existing behavioral pan tests remain. No check is retired.

Group A validation: Node 427 pass; Python 1,692 pass with the same three skips. Additional desktop/performance Node checks: 36 pass. Electron device-loss and real-scroll pan-cache
checks pass, serialized at 2560x1440. All four fixture hashes match the baseline.
Pan work is identical to October 5: new strip 262,144 pixels / two submissions;
return pan zero processed pixels, 262,144 reused / one submission; retained
exact tiled frame and zero page errors. Stage timestamps changed from
4,283/4,438 ms to 4,979/5,139 ms; these are session-relative timestamps,
not isolated pan latency. No speed improvement or regression is inferred.

This is one batch, not phase 4 completion. The 160-driver sweep, three coverage
audits and old-design driver rewrites remain pending. The baseline's 28 failed
drivers and every 15.7 finding retain their classifications and limits.
Source-upload wrappers and the old queued highlight measurement are deliberately
held because of the open route/Peak findings. Live CPU work, cancellation,
shared compiles, GPU cache eviction and Denoise input coalescing stay.

Inventory and test-replacement work list:
[cleanup inventory](../technical/archive/viewport-phase4-cleanup-inventory-2026-10-05.md).
Logs and reports: `codebase/output/performance/review/phase4-cleanup-2026-10-05/`.

### 16.1 Test synchronization batch

The two timing races named in 15.7 are repaired in the tests only; no app code
or original acceptance assertion changes. `tiled-admission-scope-fallback`
waits for an exact current frame, requests the current refinement size rather
than the bootstrap target, drains automatic picture/anchor/scope work, and
cancels deferred setup tasks before its explicit request. It records scope
refresh call origins so later supersession has inspectable evidence. The
original CPU fallback, real budget admission, atomic tiled presentation,
missing GPU scope texture and truthful freshness gates pass. The first repair
passed once but failed its repeat because it still requested a bootstrap size;
that attempt is retained in `scope-race-repeat.log`, not counted as a pass.
The corrected version passes two consecutive runs.

`full-tier-instrumented-tiling` drains automatic setup work and uses the app's
existing `invalidatePreview` rather than advancing only the app generation
mirror. Its eight explicit Full tiled renders all complete; three overlap
rounds each include a completed tiled render and a Peak value. Other competing
renders report `superseded-before-presentation`, as expected for the shared
presentation target. The original overlap gate is retained; this is not a claim
that every competing presentation succeeds. No mapped-buffer or other device
errors. Both serialized runs pass with timestamp-query available.

Fast suites: 463 Node checks (427 primary + 36 additional) and 1,692 Python
checks pass, with the same three skips. No test retired, limit relaxed or app
fix mixed in. The remaining old-design checks, full sweep and coverage audits
are still pending; the original baseline is not overwritten.

### 16.2 Viewport presentation checks

Three old-design drivers are rewritten without app changes or retired tests.
`roi-refinement` now requires a successful interactive native-scale viewport
pass, a retained frame and complete foreground/reused tile coverage. Its
refinement-region tolerance, cache no-work gate and preference checks remain.
It passes: two cached viewport tiles reused, zero processed pixels, no page
errors; custom-zoom interactive work correctly carries a viewport.

`highlight-lane-4k` preserves the 4K processing and HDR/SDR lane checks. It
requires exact 4K GPU acceptance, canvas dimensions matching the accepted output,
nonzero dimensions and a painted compositor screenshot after returning to HDR.
The old whole-4K backing allocation is replaced by the output-size contract.
The native driver passes and its Desktop project SHA-256 is unchanged.

`tier-change-blank-canvas` preserves the original tiled-presentation regression
by setting tiled execution through real preferences in its disposable profile.
A direct function-only override was reset by resolution preference changes;
that setup attempt correctly failed its retained tiled assertion. The corrected
forced-tiled transition completes in 1,236 ms, with ten painted samples, zero
blank/nothing samples and zero CPU picture requests. An additional Auto run
uses Direct: 849 ms, nine painted samples, zero blank/nothing samples and zero
CPU picture requests. Both require exact Full processing at 7,968 pixels.
The same compositor sampler, blank threshold and transition timeout remain.
Baseline Auto was 857 ms / nine painted samples: this run is 8 ms lower,
without a controlled latency attribution. Forced-tiled is a distinct added
scenario rather than a like-for-like speed comparison.

Fast suites: 463 Node and 1,692 Python checks pass, same three skips. Logs are
in the phase4-cleanup evidence directory. Phase 4 remains in progress.

### 16.3 Faster Dragging checks

Two old-design drivers are rewritten without changing app behavior.
`phase4-preview` drains automatic setup work, then injects a learned slow-graph
sample in the same browser task that starts its active gesture. Faster Dragging
uses Balanced timing now: the old Responsive cold-start assumption no longer
provides reliable positive coarse coverage. The test still requires actual
coarse presentation within 30 seconds and exact refinement within its existing
120-second limit. Both repeated runs pass: Display exact 698 pixels, coarse
512, exact refinement 698; the no-coarse control is byte-identical. Rapid
reversals present only current generation 7, and native processing reaches
2,400 pixels with no page errors. Preference migration and round-trip remain.
The Electron harness seeds schema-2/2K preferences before launch only in its
new disposable profile, matching the browser test's localStorage fixture.
An initial unseeded desktop attempt failed the migration assertion and is
not counted as a pass; the corrected run log replaces that initial attempt.

`phase4-regression-browser` defaults to Faster Dragging on/off and preserves
Responsive/Balanced/Precise CLI aliases. It drains setup before each zoom and
seeds a slow graph only for the positive coarse zoom case. Actual coarse
pixels, unchanged warm coarse level if present, zero warm source-mip builds,
exact target processing and no coarse pixels with Faster Dragging off remain
gates. Both the current-mode run and the legacy-alias run pass. Current on:
cold 50% exact 515 ms / first changed current frame 266 ms; warm 50% exact
197 ms / first 105 ms. Off: cold 50% exact 103 ms, warm 115 ms. These are
single-session measurements with deliberate slow timing injection; they are
not like-for-like speed comparisons with the baseline's failed old-mode gate.
Pan and edit timing evidence remains in both reports.

No test retired, pixel tolerance relaxed, shader changed or app fix mixed in.
Full driver sweep, coverage audits and the other old-design checks remain
pending; Phase 4 is not complete.
Fast suites for this batch: 463 Node checks and 1,692 Python checks pass,
with the same three skips.

### 16.4 Mask cache and fallback batching checks

`path-feather-mask-cache` no longer requires CPU draft requests from normal
GPU rasterization. It records actual GPU leaf loads during the real Feather
drag, requires an intermediate leaf newer than the backend acknowledgement,
requires that leaf to equal the current live controls, and rejects reuse of
one GPU cache entry for different Feather values. The final Feather must be
rasterized and committed. The normal run passes: final Feather 0.1, no CPU
draft mask requests, 28 distinct GPU mask entries across Display/auxiliary
sizes, and one committed mask request. `--mask-route cpu` disables analytic
rasterization in the disposable session and retains the original positive CPU
draft, no-unacknowledged-committed-fetch and final-commit guards. It passes:
23 draft requests, three committed requests, final Feather 0.1. No page errors.

`tiled-mask-batch-transport` tests the still-reachable CPU mask fallback by
explicitly disabling analytic rasterization in its disposable renderer. The
original assertions all remain: zero per-tile requests, successful bounded
batches, multi-tile batching, foreground-only ROI work, retained offscreen
pixels, active mask node and small GPU submission batches. It passes with two
HTTP batches of 2 and 6 tiles, zero per-tile requests; the six-tile whole-frame
pass submits three batches and the ROI pass submits two, processing four
foreground tiles and skipping two. ROI mask requests reuse cached masks, so
there are no additional ROI HTTP batches. Offscreen brightness is 135.20
before and 125.04 after, a 10.16 change within the original 12-unit limit;
this measured movement is retained, not described as pixel equality.

These tests preserve the reachable CPU route; they do not establish that CPU
mask compilation is unnecessary. CF-ROUTE remains open. No tests retired,
app code changed or original limits relaxed. The full sweep and audits remain
pending.
Fast suites: 463 Node and 1,692 Python checks pass, same three skips.

### 16.5 Drag frame lifetime counter

`drag-gpu-load` counts each outer viewer-render request once from entry until
its original promise settles. Nested tiled work, scope work and individual
GPU queue submissions are no longer called additional whole viewer frames.
The observer returns the renderer's original promise unchanged; it adds no
GPU wait or replacement promise. Queue submissions and their maximum pending
count remain separately reported. A positive observed-frame assertion prevents
a disconnected probe passing vacuously. All original frame-rate and coarse
gates remain unchanged. This measures logical viewer request lifetimes, not
physical GPU occupancy; the queue and timestamp metrics still report GPU work.

The final observer run has Fit 50.0 fps / worst second 47, 264 submits,
one viewer request in flight and 2 ms release settle. Baseline: 49.6 fps /
47, 264 submits, one, 7 ms. Changes: +0.4 fps, unchanged worst second and
submits, -5 ms settle. At 200% the final run has 0.2 fps / worst second zero,
12 submits, one viewer request and 1,435 ms release settle. Baseline was
2.4 fps / worst second one, 762 submits and 32 ms release settle; the old
counter's three 'frames' were submissions. The final run is 2.2 fps lower,
750 fewer submissions and 1,403 ms slower to settle. No causal attribution.
An original committed-probe control run also fails: Fit 50.0 fps / 47, native
1.4 fps / one, three queue submissions in flight and 19 ms release settle.
Earlier observer attempts measured native 0.2 and 0.3 fps, still red; an initial
async observer was replaced to preserve promise identity. All reports remain
in the phase4-cleanup evidence directory. No speed improvement is claimed.

CF-SPEED-01 remains open with its original 30 fps average / 20 fps worst-second
floors. The driver now fails for that named performance reason rather than
mislabeling tiled submissions as multiple viewer frames. No app change, shader
change, check retirement or lowered limit. Fast suites: 463 Node and 1,692
Python checks pass, same three skips. Full sweep and audits remain pending.

### 16.6 Source ownership and cold ROI transport

`native-region-stall` replaces the old proxy-stream-only pre-reader coverage
counter with delivered source-response ownership coverage. Source-tile bodies
now drain through arrayBuffer before currency checks, so a clean run need not
abandon them before creating a reader. The probe records the viewer key at
fetch and delivery, requires at least four responses spanning a view change
to be consumed/cancelled/aborted, and rejects unread delivered responses.
The original no-undrained-body, no-wedged-pool, responsive final pool request,
exact convergence and page-error assertions remain. Pre-reader cancellation
is still separately recorded, now including source-tile URLs.

The test starts fresh picture generations, releases cached region sources,
waits for actual source headers during the existing 500 ms injected delay,
and holds the superseding view until delivery. Earlier attempts with a fixed
150 ms dispatch assumption or returning to the initial zoom before headers
were handed to the app did not meet the unchanged four-response coverage
gate; their logs remain. A probe attribution attempt also incorrectly included
responses still held inside its own delay, and is retained as a failed setup
attempt. The final version excludes those from app ownership.
Two final serialized runs pass: 16 responses spanning viewer changes cleaned,
zero unread delivered bodies, zero wedge, no page errors. Pre-reader counts
are one cancelled response in the first run and zero in the repeat; cleanup
coverage includes the source-tile drain route and old proxy routes. The repeat
converges in 1,536 ms and the pool probe answers in 2 ms; baseline was 1,535 ms
and 3 ms. Differences +1/-1 ms are recorded, but the deliberate synchronization
and cold-source setup make these distinct scenarios, not isolated speed claims.
An already exact current frame can coexist with a pending pan follow-up;
final pan ages were 314/287 ms, with no coordinator pending request. The test
retains its original current-view convergence contract, not a claim that every
background task has stopped.

`roi-source-transport` persists tiled execution and Full/1K test tiers through
real preferences. Its whole-frame reference necessarily leaves a whole source
resident, which a warm ROI correctly reuses. A test-only render hook releases
that whole source immediately before the ROI pass so the cold-upload claim
actually runs. One whole-source eviction is observed. Pixel tolerance remains
zero: 103,685 compared pixels, maximum difference zero. The ROI source is
1,024 x 1,024 / 8,388,608 bytes versus native 75,497,472 bytes (11.1%), with
four foreground tiles and a retained frame, within the original 50% byte and
area bounds. This is an explicit cold cache scenario, not a production upload
improvement over the baseline's valid warm whole-source reuse.
Warm Fit uses 4,718,592 bytes for the exact 1K mip, with zero new cold builds
and zero bytes generated. Both existing whole-frame and streamed display-mip
transports are accepted, under the same exact byte-size and 10% native-byte
bound. No test retired or tolerance relaxed; source transport implementations
and the held wrappers remain untouched.

Fast suites: 463 Node and 1,692 Python checks pass, same three skips. All four
protected project SHA-256 hashes remain unchanged. Full sweep, three audits
and remaining old-design checks are pending. No app fix or shader change.


### 16.7 Bounded editing Peak disclosure

`scope-exact-peak` preserves exact Direct-versus-tiled maxima at both tile
sizes, half-float saturation protection, native sampling, canvas/scope-source/
diagnostic isolation and the optional real-photograph positive under-report
check. It now observes `measureEditingPeak`'s actual conservative processed
bound and requires positive analysis within the unchanged 4,194,304 pixels.
The renderer's original promise is returned unchanged by the observation hook.
Current required processing scale replaces the bootstrap proxy target; the
latter allowed a deferred current-scale render to resize the canvas during
an isolation probe. The failed setup log is retained.

The GPU scope measures automatically even with the legacy flag off. Both
flag states must disclose `Peak (estimate)` and `peak_exact=false`. An injected
bounded-measurement refusal positively exercises `Peak (preview)`, with the
legacy default-off guard retained. This replaces the old flag-off assumption
with current refusal disclosure coverage. No delivery certification is made:
CPU export and full-size Proof remain exact. No shader or measurement code
changed, and CF-PEAK remains open.

The pattern run passes: Direct and both tile sizes return exactly 7.5234375,
12/4 tiles, unchanged 1004 x 565 canvas, scope source and diagnostics. Native
1280-edge analysis processes 16 patches, conservative bound 243,712 pixels;
210 ms versus baseline 198.2 ms (+11.8 ms). These are single-run measurements,
not a speed attribution. The optional photograph assertion is not exercised
by the baseline's pattern scenario. No checks retired. Fast suites pass: 463 Node and 1,692 Python, same three
skips. An additional read-only DSC00950.ARW run passes: exact Direct/tile
peak 0.452392578125, unchanged 845 x 565 canvas, native 7,362-edge analysis
with 16 patches / 262,144 bounded pixels / 230 ms. The preview reads 510.2
nits versus the estimate 528.4 nits (3.44% lower), positively exercising the
original optional photograph under-report gate. This is an unmodified source
import, not the saved project grade or a closure of CF-PEAK.


### 16.8 Explicit Full tiled settle coverage and additional findings

`full-tier-tone-cost` uses the real disposable-profile 1 GiB preference so
subsequent resolution changes cannot restore Auto. It requires the accepted
requested tier before each measurement and records the minimum admission
decision and actual budget. Native Full differs from 4K; under the chosen
budget the minimum native graph predicts 2,256,634,266 bytes, above the
1,073,741,824-byte limit. These are existing user settings, not changed app
budgets. All original 4x timing, exact Full, positive tiled/settle-overlap,
no-CPU-branch/request, no-empty-canvas and pre-dispatch refusal guards remain.

The unchanged Auto control retains the baseline's old failure: Full uses
Direct and cannot exercise tiled overlap. Baseline 4K/Full gesture times were
1,707.3/1,699.7 ms; the unmodified control reads 1,748.7/1,728.5 ms (+41.4/
+28.8 ms), zero CPU picture requests, zero blanks, zero overlap. No speed
attribution is made from single runs.

Three explicit 1 GiB runs exercise exact Full Tiled and reproduce 4/3/3
settled-render overlaps. Full gesture/release times: 1,020.7/37.8,
1,185.1/39.6 and 1,189.9/38.9 ms, against 4K gestures 1,700.8, 1,666.3 and
1,743.3 ms. All ratios are inside the unchanged 4x ceiling; all runs have
zero CPU preview/scopes requests and zero blank samples. These distinct
forced-budget scenarios cannot be compared as performance changes from the
Auto baseline.

The driver stays red for newly exposed findings. CF-ROUTE-06: all three runs
record 25 `interactive:tiled-refused:interactive render`, not the required
pre-dispatch refusal. Source/parameter preparation occurs before the current
renderer guard; source inspection finds no app pre-dispatch guard at the
active dispatch. CF-ROUTE-07: two repeats also enter the CPU settle branch
once for `coalesced-by-newer-render`, although cached warm state prevents a
CPU picture network request. The original branch-level guard catches this.
Neither finding proves cleanup introduced it; the baseline never exercised
this path. No app fix, removal or gate retirement follows these findings.

Fast suites pass: 463 Node and 1,692 Python, same three skips. Four protected
project hashes remain unchanged. Phase 4 remains in progress; full sweep,
three audits and remaining old-design checks still need completion.


### 16.9 Memory-budget route and accepted-frame readout

`budget-route` checks current accepted execution: Display Fit Direct and native
100%/200% viewport Tiled. Full/Fit separately retains the original Auto Direct
-> 1 GiB Tiled -> Auto Direct admission-switch coverage, using real settings
in its disposable profile. Every change still requires a new presentation
within 1,000 ms without an edit; accepted exact Full and current generation
are now required. Idle timeouts fail explicitly. The presentation listener
ignores an unchanged serial and removes itself on its original 3 s timeout.
Readout agreement now means the viewer's accepted route, rather than an
auxiliary pass's most recent plan. No app route or budget implementation changes.

The original test's unmodified control still fails its old Auto-restored-Direct
assumption at 200%, with Tiled correct for that view. Baseline lower/restore
latencies: 31.3/37.9 ms; control: 35.9/56.5 ms (+4.6/+18.6 ms). Current explicit
Full/Fit switch: 143.2/14.1 ms, repeat 198.5/12.1 ms, all within the unchanged
1 s limit. These are different processing scenarios, not isolated performance
comparisons. Both new runs accept the required native viewport routes and
Full/Fit admission switch, with zero page errors.

The driver remains red for CF-ROUTE-08: the readout says Direct while the
accepted frame is Tiled at both native zooms and after lowering Full/Fit to
1 GiB. Both repeats reproduce it. Source inspection confirms the readout uses
`lastRenderPlan`, which can describe auxiliary Direct work, rather than the
accepted viewer execution. This was not cleanup of dead code or an app fix;
the failing agreement guard remains. No check retired. Fast suites pass: 463 Node and 1,692 Python, same three
skips. Remaining old-design checks and the full sweep/
audits still need completion.


### 16.10 Denoise regional drag and freed-source coverage

`denoise-stale-source` explicitly prepares the reachable native Direct
selector before evicting its source. It requires the held original to be the
resident cache entry, actual eviction with the selector still holding the old
copy, and adoption of a different live reloaded entry. The original off/on
GPU-validation-scoped redraws remain and must use Direct. Additional off/on
viewport redraws must use Tiled, and the on case must select the reconstruction.
Automatic draft/scope/anchor/queue work drains before diagnostic renders so
setup cannot supersede the protected draw; the failed first setup log remains.
Two final runs pass every redraw with zero validation errors, actual native
4,200-edge source eviction and live-copy adoption. Source/cache implementations
remain live and untouched, including the code held for CF-ROUTE-03/05.

`denoise-drag-region` checks the actual accepted Tiled viewport; the historical
live-region helper expects a whole-frame selector texture which adaptive Tiled
need not allocate. Standalone ready-stage reconstruction checks remain. A
promise-preserving observer also records successful shared-encoder adaptive
reconstruction, which emits no standalone ready stage. Queue completion is
awaited before reading counts. Positive reconstruction, no whole frame during
drag, positive region dimensions/area, stale-whole marking and released final
0.9 controls are required. The released frame must be exact Tiled and clear
the stale marker.

A subsequent real Full/Fit change exercises the first whole-frame view after
release. Adaptive Tiled keeps no whole reconstruction, so the old immediate
selector readback was invalid. This retains the original protection against
stale offscreen pixels on a later whole-frame view. The original exhaustive
released-versus-fresh reconstruction equality, final amount and cleared stale
flag checks remain, with zero tolerance. Both runs pass: 57/69 region encodes,
no whole-frame reconstruction during drag, correct released controls, and
15,360,000 values identical to a fresh whole-frame reconstruction at Full/Fit.
The old helper/telemetry setup attempts remain in the evidence directory.
These are current-route coverage results, not isolated performance measurements;
the baseline drivers stopped at the old selector expectation. No shader,
reconstruction math, CPU fallback or fixture changes. No checks retired.
Fast suites pass: 463 Node / 1,692 Python, same three skips. Four protected
project hashes remain unchanged.


### 16.11 Deferred bounded highlight anchor and retained Peak arithmetic

`gpu-highlight-compression-parity` preserves all four saturated HDR/BT.2020/
generated-SDR/authored-SDR reduction comparisons with their original 0.00002
relative limit. Its foreground lifecycle check now exercises actual interaction
and the deferred canonical anchor: zero old foreground reductions, zero anchor
jobs while interacting, positive pending anchor coverage, then exactly one
completed job after release with finite value and positive conservative work
within the unchanged 4,194,304-pixel budget. The observation hook returns the
original bounded-measurement promise. No old pendingHighlightMeasurement wait
is mistaken for live production work, and the held wrapper is not removed.

The grade is synchronized and setup draft/scope/anchor work drains before the
probe. Current required processing edge replaces the bootstrap 512-edge
partial view, which cannot satisfy exact-current scheduling prerequisites.
The original scope analysis-resolution limit 0.0001, accepted source serial/
generation equality, stale-source rejection/updating indication and matching
replacement recovery remain; a positive current-scope application is required.
No shader, anchor implementation, pixel limit or app behavior changed.

Two runs pass, including all four shader comparisons and exactly one deferred
bounded anchor. Scope maxima agree exactly at 0.88623046875 at both resolutions;
current replacement recovers with no refusal. Baseline's four shader guards
passed but its obsolete exactly-one foreground reduction guard failed (zero
reductions). The rewritten test still protects positive measurement work,
sharing/deferral and scope identity under the current design. No check retired;
Both runs use native 1,280-edge analysis, 16 patches, conservative bound
243,712 pixels and anchor 113.3125. CF-PEAK and the deferred automatic-anchor
redesign remain open. Fast suites pass: 463 Node and 1,692 Python, same three
skips.


### 16.12 Local design workflow setup and unresolved visual contract

`local-design-qa` creates a pending adjustment before choosing its mask tool,
matching the existing assigned-mask lock. It waits for completed brush assignment
and positively requires brush/gradient tools locked. Path setup now commits an
actual closed path before leaving the pending adjustment. Original visual,
material, layout, keyboard and contrast checks are retained unchanged. Missing
original comparison assets are reported explicitly when that stage is reached.

The synchronized driver confirms the lock then fails CF-DRIFT-02: the current
shared switch is 46x20 with 2px border against the original 46x24/borderless
contract. A separate non-gating diagnostic proceeds through path creation and
observes scrollbar, Brush/Mask Controls section mismatches and a keyboard-lane
activation timeout. It is not a passing driver or substitute coverage. Four
original temporary clipboard references are absent, preventing confirmation of
intended appearance. Their absence was checked without modifying fixtures.
Baseline stopped at locked-mask selection; these later checks had not run.
No app change, limit change, test retirement or visual reference replacement.
The driver remains red for a named unresolved contract. Evidence is in
`phase4-cleanup-2026-10-05/logs/local-design-qa*.log`.

Local design batch fast suites: 463 Node / 1,692 Python pass, three skips.


### 16.13 Full-sweep path-node coordinate timing repair

`local-adjustment-usability` passed in the baseline but failed twice in the
cleanup sweep: the old Smooth node remained selected after clicking its
neighbour. A diagnostic preserves the original real click and records the
computed node hit, then a null hit at actual pointerdown; the current geometry
map is unavailable as preceding edit work changes processing size. Only the
unused-wrapper removals affect app source; no event or geometry app fix is made.

The test waits for the preceding Smooth edit's viewer/mask work, ensures the
current coordinate map, then calculates the pointer coordinate. A new positive
check requires the tangent still overlaps the neighbouring node, preventing a
lost fixture from satisfying the test. Two diagnostic repeats pass every
original node selection/profile state, rename, layout and scrolling guard.
Original failures and pointer-event evidence remain in the phase 4 logs; the
initial sweep row is preserved in `sweep-initial-attempts.json`. The full sweep
reruns the actual repaired driver. No original assertion removed or loosened.

Path-node batch: actual sweep driver passes; fast suites 463 Node / 1,692
Python pass with the same three skips. No app changes or fixture writes.


### 16.14 Full-sweep path pointer and letterbox setup repair

`path-mask-interaction` passed in the baseline. Initial cleanup sweep timed out
at the test's artificial letterbox-size wait; an unchanged repeat failed earlier
because Smooth controls had not affected the expected selected node. Completed
path clicks and the two manually letterboxed layouts now wait for preceding
viewer/mask/anchor/scope work and ensure the current geometry map before taking
coordinates or overriding layout. Draft drawing remains continuous; no app
scheduling, event handler or geometry implementation changes.

Two separate diagnostic runs pass every original creation-guide/projective,
profile, Feather, rendered compare-without, insertion/removal, drag, letterbox,
outside-handle movement/hover and submask round-trip assertion. Original limits
and five-second gesture/layout waits remain. This is setup synchronization, not
retrying a failed gesture. Initial sweep and repeat failures remain in logs and
`sweep-initial-attempts.json`. The actual repaired driver is rerun in the sweep.

Path-layout batch: actual sweep driver passes; fast suites 463 Node / 1,692
Python pass with the same three skips. No app or fixture changes.


### 16.15 Full-sweep manual Detail capture setup repair

`tiled-cpu-detail-parity` initially fails its retained capture alignment check:
the final tiled canvas is viewport 1004x565, while its CPU reference/manual
render is 1024x576. An unchanged repeat passes with exactly the baseline's
rounded differences and seams. Existing setup cancelled queued preview work but
only waited for gpuDraftInFlight. It now drains picture/scope/anchor work, then
cancels deferred refresh, catch-up and pan before each explicit diagnostic render.
The backing store is still read in the original renderer task chain, after GPU
completion. No app work, CPU reference, renderer or Detail shader is changed.

The synchronized diagnostic passes: tile 256 seams 0.0015/-0.0001 and tile 512
-0.0005/-0.0009 against the unchanged 0.5 limit, identical to baseline rounded
values. Original alignment and distribution reporting remains, including the
large common GPU/CPU difference (70.082% above 16 levels); this check protects
extra tile seams, not whole-image CPU parity. Initial failure/repeat/diagnostic
logs and the initial ledger row are preserved. Actual driver reruns in sweep.

Detail capture batch: actual sweep driver passes; fast suites 463 Node /
1,692 Python pass with the same three skips. No app or fixture changes.


### 16.16 Full-sweep Detail residency setup supersession

`detail-cache-residency` initially refuses the first 42 MP render because a mask
tile is unavailable or superseded. An unchanged repeat passes at the baseline's
rounded 875.3-929.0 MB residency and 72.8-106.6 MB working set. Existing settle
only awaited gpuDraftInFlight. It now drains picture/scope/anchor/mask work and
cancels deferred refresh/pan/catch-up before its manual measurement. The first
and second ordinary planned renders, positive Tiled route, cache-trim wait and
all original residency/working-set/spread gates remain. No app/cache/budget fix.

Synchronized diagnostic passes: same 72.8-106.6 MB working set, residency
894.2-967.8 MB (+18.9/+38.8 MB endpoints versus baseline), spread 73.6 MB versus
53.7 MB. All remain inside the original 1 GiB (1073.7 MB decimal) budget and
spread gate. This setup-sensitive movement is reported, not attributed to the
unused-wrapper removals. Initial failure and unchanged repeat are retained;
actual driver reruns in the sweep. Saved projects are not used or modified.

Residency batch: actual sweep driver passes with diagnostic-identical
894.2-967.8 MB range; fast suites 463 Node / 1,692 Python pass, three skips.


### 16.17 Full-sweep timing comparison in progress (October 6)

Headline latency recorder exits successfully, but four previously passing
summary targets miss in this run: warm Fit current/settled p95 245.2 ms versus
33.4 ms (original 50/100 ms targets); warm 100% refined 138.4 versus 53.9 ms
(100 ms); warm native zoom 893.6 versus 9.1 ms (150 ms). These are CF-DRIFT-03,
observed and unattributed; a confirmation run remains pending. No app fix or
acceptance change is made. Measurement-only successful exit does not imply
speed gates pass, and behavior/timing equivalence cannot be claimed from this
run. All per-case numbers and verdicts remain in target-verdict-comparison.json.

Other movements include cold Fit feedback 27.7 to 13.4 ms, cold native zoom
850.2 to 906.8 ms (still misses), warm 200% feedback 85.2 to 178.9 ms (still
misses), warm pan 11.2 to 15.2 ms (still inside 33), and input handler p95 8.6
to 5.8 ms (inside 16.7). The derived warm refinement limit remains Fit p95+50;
its increase makes some refinement verdicts pass despite increased timings.
The original formula/targets are retained and raw timings are reported.
Full sweep, endurance, three audits and final comparison are not yet complete.


### 16.18 Cleanup endurance comparison (October 6)

The serialized 30-minute active / two-minute idle repeat completes: 83 cycles,
1,345 operations, zero test or sampler errors, and final picture/scopes settled.
Baseline: 85 cycles / 1,378 operations. Registered GPU memory ends at 4,376.0 MiB
versus 4,378.6; maximum 4,395.0 versus 4,394.5, within the unchanged 6,141 MiB
budget, zero over-budget bytes. This is saved-geometry endurance; warped geometry
is covered by the shorter audits, not a new long endurance acceptance.

First/last ten-cycle medians still drift (CF-DRIFT-01): HDR exposure
1,264.5 to 1,631.0 ms (+29.0%), HDR Clarity 1,209.5 to 1,468.0 (+21.4%),
100% zoom 470 to 536 (+14.0%), Fit zoom 70 to 78 (+11.4%). Baseline respective
drift: +18.6%, +32.8%, +27.4%, +28.2%. Fresh HDR brush now 877.5 to 850.0
(-3.1%), versus baseline 718.5 to 883 (+22.9%); the higher starting value is
also reported. All 17 operation comparisons are retained in endurance-comparison.json.

Live CPU routes remain: two HDR scope requests versus six baseline (CF-ROUTE-04),
and 26 HTTP 409 responses versus 35 (CF-ROUTE-05). Response bodies are still not
captured, so the supersession explanation remains tentative. These findings
are not closed or attributed to the two unused-wrapper deletions. No app fix,
limit, CPU path or shader change. Full driver sweep and three audits continue.


### 16.19 Cleanup coverage audits (October 6; in progress)

Primary audit complete: all 1,250 original rows matched, including 312 Denoise
rows, zero errors and every row exact WebGPU. Saved-project hash unchanged.
Flagged rows 69 to 68; CPU mask requests121 to117, whole-native requests13 to12,
CPU picture/scopes remain0/0, source-luminance requests27 unchanged. These
CPU mask/source routes remain live (CF-ROUTE-01/03); no removal is justified.

Median row duration800 to811.5ms. Largest increases: rotated SDR compact-Haar
color_noise582 to15,013ms; perspective SDR levels1,817 to7,634; flipped SDR
chroma_sigma595 to3,558. Largest decrease: rotated HDR luminance-intersect-gradient
3,761 to1,521ms. Per-state/control timing and route differences are retained
in audit-comparison.json. CF-DRIFT-04 records the new long-tail observation;
a focused rotate/SDR repeat is pending, with no app fix or attribution.
Four-mask and fifty-local audits are still pending.


Four-mask audit completes all 1,166 rows with zero page errors. Fifty-local initial
attempt is preserved separately after 3,275 rows: one edit-revision mismatch page
error at saved/SDR compact-Haar levels; perspective/SDR amount and luminance each
have 120-second apply/restore settle timeouts. Live snapshots show ongoing picture
work, but ordinary audit edits were subsequently progressing, so their generation
churn does not prove an application livelock. The agent interrupted after recovery;
the original full command is repeated to obtain a complete comparison. CF-DRIFT-05
records the observed revision/settle failures, without app fix or attribution.
Initial raw report, diagnostics and interruption correction are preserved.

### 16.20 Stop-gate setup synchronization (October 6)

Baseline-passing tiled-stop-gate fails its full-sweep attempt and unchanged
repeat: longest logged encode span161.4/162.4ms versus the unchanged50ms gate;
actual stop latency24.3/25.1ms and no stale submission after the newer render.
Original logs/reports and the initial ledger entry are preserved.

A separate origin diagnostic proves pending read-only Peak reductions from
setup use the tiled submission log alongside explicit picture renders. Their
serials can appear to belong to another generation even though the read-only
pass does not supersede the visible canvas. The diagnostic logs scope origins
and pending scope state; the original test intended to measure two picture calls.

Test-only repair drains automatic picture/scope/anchor work and cancels deferred
scheduler/refresh/pan/catch-up before warm-up and after its original200ms wait.
All original50ms gates, delay, newer-picture presentation and stale-submission
assertions remain. An added positive guard requires exactly the two measured
serials. Two synchronized diagnostics pass: longest span4.1ms, matching baseline;
no stale submissions after the newer render. The first measured pass completes
before the200ms supersession in baseline and these repeats; this driver does not
provide positive mid-encode interruption coverage. Existing Full overlap tests
retain their positive overlap coverage. No app fix or limit change.

Fast suites463 Node /1,692 Python pass, same three skips. The actual sweep
driver passes: two measured serials, span4ms inside50ms, no stale submissions
after the newer render, both picture calls present via WebGPU.



### 16.21 Final cleanup validation disposition (October 6)

Authorized Group A cleanup and its validation are complete. The phase 4
green exit is not met. Earlier section 16 batch notes describe their status
at the time; the final disposition supersedes their pending-work statements.
The [complete comparison](../technical/archive/viewport-phase4-cleanup-after-validation-2026-10-06.md)
records all 160 named drivers, retained failed guards, all three audits,
headline confirmations, endurance, broad control/drag movement and protected
SHA-256 values. Only the approved unused wrappers changed application source
(17 nonblank lines / 713 UTF-8 bytes, 19 source lines with separators).
Group B and all live cancellation, CPU fallback, source staging, mask/cache
and Denoise coalescing remain held or retained. No check retired or tolerance,
shader pin, budget, saved-project format, preference or CPU export/Proof change.

Final checks: 463 Node passed; 1,692 Python passed, same three skips. Full
serialized Electron sweep: 160 drivers complete, 147 pass / 13 fail versus
132 / 28 baseline. No new baseline-passing driver exit failure remains after
five documented test setup repairs; first failures and diagnostics are kept.
All three coverage audits completed 6,618 matched rows, including 312 Denoise
rows per fixture. All four protected saved projects retain their baseline hashes.

CF-DRIFT-03 reproduces all four new warm target misses (repeat Fit 258.7 ms,
100% refinement 108.3 ms, native zoom 891.9 ms). CF-DRIFT-04's rotated SDR
compact-Haar color_noise outlier (15,013ms vs 582) is not reproduced (575ms)
in the unchanged focused 90-row repeat; zero errors, every row exact WebGPU.
The first observation remains intermittent and unattributed.

The four-mask audit completes 1,166 rows, 35 flagged unchanged; CPU pictures
3 to 4, scopes 0. The fifty-local audit completes 4,202 rows, 181 flagged unchanged;
CPU pictures 5 to 4, scopes 9 to 12. CF-DRIFT-05 records one page error
(expected revision 3804 / current 3805) at flip/SDR compact-Haar amount; both/SDR
compact-Haar enable apply-settle and amount restore-settle each hit the 120s
guard. Exit 0 measures completion, not a green audit. Its all-exact aggregate
is false due to the uncompleted enable row; other sampled rows retain GPU
presentation. The original interrupted attempt and agent's premature-stop
correction remain preserved; generation churn did not prove continuing livelock.

The 30-minute endurance has zero errors and no memory-budget overshoot, but
HDR exposure median grows 29% within the run. All 17 operation comparisons
and 122 broad control/drag comparisons are retained, including regressions
and improvements. These movements are not attributed to unused wrappers.
Known route, pixel, Peak, speed and drift findings remain open. No defect fix,
installer build or push was performed; further cleanup stays separate.

### 16.22 Phase 4 closure (Steve, October 6, 2026)

Steve closed phase 4 on October 6 as done with known issues. The section 7
exit ("Removed code listed; suites green") is met in its first half only.

- **Done:** the two unused wrappers are removed and listed (19 source lines).
  Every old-design check named in 15.7 is rewritten for the current design and
  both timing races are repaired in the tests. No check was retired or
  loosened. Failed drivers went from 28 to 13; fast suites pass; the four
  protected projects are unchanged.
- **Not green, and why:** the 13 remaining failures are open findings, not
  cleanup damage. Phase 4 did not allow defect fixes, so it could not turn
  them green. Further cleanup or testing would not change that.
- **Closing is not an acceptance.** At the October 6 closure, every item
  in 15.7 stayed open with its limit. Later dated row-level fixes, closures
  and owner acceptances supersede that historical status, including for
  those added during phase 4: CF-ROUTE-06, 07 and 08 and
  CF-DRIFT-02, 03, 04 and 05. The deferrals and acceptances in 15.1 and 15.2
  keep their original scope.
- **Unexplained and new since the baseline:** the warm latency misses
  (CF-DRIFT-03) and the fifty-local revision and settle errors (CF-DRIFT-05).
  The only application change is the removal of two wrappers nothing called,
  so the cleanup is an unlikely cause; this is not verified. Steve tries the
  app by hand before any test run is spent on them.
  **Done October 6:** Steve tried a heavy project with locals and Denoise. He
  found the idle redraw loop (fixed, `cc94373`) and otherwise reports it
  working well, with the 100% switch under about two seconds. No test run is
  owed for CF-DRIFT-03; it stays listed and is reopened only if it is felt in
  use.
- **Left in place:** Group B (`copySourceChunkStaged`, `releaseSourceStaging`,
  `scheduleHighlightMeasurement`) and the unused `scopeHdrCeiling` wrapper.
  They are a few lines and are not worth another validation pass. Remove them
  only alongside a fix in the same area.
- **No further cleanup is planned.** PRD 5.5's larger candidates
  (cancellation, shared compiles, cache eviction, prewarming, coalescing) were
  found to be live and stay.

Nothing is pushed and no installer is built. From here the work is fixing
carried-forward findings, with testing scaled to each change under the
repository's `AGENTS.md` rather than a full sweep per batch.

### October 8 release follow-up: CF-SPEED-02

The luma-feather driver waited for the create response but could read the
local before the edit queue published it. It now waits for the selected local
and its luminance leaf. One serial Electron run at 2560 by 1440 completed:
Feather cold 1,072.5 ms, warm p95 962.2 ms against the unchanged 1,000 ms limit
(worst sample 1,021.9 ms); grade warm p95 5.3 ms against 200 ms. Zero backend
mask requests, grade mask rebuilds, untrusted releases or timeouts. The driver
passes. This closes the broken-driver item; the occasional slow sample is
recorded without changing the p95 criterion or application behavior.

### October 8 release follow-up: CF-PIX-06 remains open

The current original tiled-film driver reproduces the maximum-spatial case
at tile size 512: 20 differing pixels, maximum four byte levels. Other retained
cases and size 256 pass. Thus the October 7 green run did not establish a
lasting closure; the October 8 sweep's failure is reproducible. One attempt
to separate GPU backing pixels from screenshots was inconclusive: a WebGPU
canvas cannot safely be read after presentation with a plain canvas draw.
No check, shader or zero-difference criterion was changed. A further focused
diagnostic beyond the brief's two runs is awaiting Steve's decision.
