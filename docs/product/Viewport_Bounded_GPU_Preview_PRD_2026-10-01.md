# Viewport-Bounded GPU Preview

**Date:** October 1, 2026
**Status:** Phases 0 and 1 closed on October 1, 2026. On October 2 Steve accepted the phase 2 report, requested commit and push, and directed the next thread to move on in the PRD. Phase 2's implementation, measurements and remaining limitations are recorded in section 13. Phase 3 started on October 2 with a measured Sharpen correction (section 14). The four-mask near-black blocker is subsequently repaired (section 14.1); Steve authorized committing these fixes and continuing the sprint. Phase 3 remains open; phase 4 has not started. Phase 1 met its mask-accuracy exit and part of its speed exit; its accepted gap to the section 6 targets remains carried to phase 3. Steve approved the section 4 limits and accepted the section 6 targets as goals on October 1. Phase 0 is recorded in section 11.
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
(no push). The complete phase 3 exit is still open.

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

- **Peak accuracy.** Relaxing the editing-time measurement touches the feature Steve invested in most. Phase 2 starts with a read of that design and a proposal, not a change.
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
[durable Detail evidence record](../technical/viewport-phase3-detail-evidence-2026-10-02.md)
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
[mask evidence](../technical/viewport-phase3-mask-evidence-2026-10-02.md).

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
[local-control evidence](../technical/viewport-phase3-local-control-evidence-2026-10-02.md).

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
[auxiliary evidence](../technical/viewport-phase3-auxiliary-evidence-2026-10-02.md).

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
[zoom transfer evidence](../technical/viewport-phase3-zoom-transfer-evidence-2026-10-02.md).

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
[Match evidence](../technical/viewport-phase3-match-evidence-2026-10-02.md).

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
