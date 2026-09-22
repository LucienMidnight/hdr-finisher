# Feedback on the Preview Performance Architecture Review

**Date:** 2026-09-22
**Subject document:** [`preview-performance-architecture-review-2026-09-22.md`](preview-performance-architecture-review-2026-09-22.md)
**Reviewed revision:** `35996e5`
**Purpose:** Second-opinion review of the architecture report, intended as input to a remediation sprint PRD
**Competitive target stated by the reporter:** HDRF should perform as well as or better than DxO PhotoLab, Adobe Lightroom, and darktable

**Revision note:** Updated 2026-09-22 after discussion of the resolution-selector question. Added the verified 1:1 upsample defect (§3.4a), the zoom cost curve and the export-exactness argument (§3.5), the control-surface replacement and PRD amendment (§4), and the consequent resequencing — the persistent multi-resolution cache moves from Phase 3 to Phase 2, and a display-scale pan cache and minimum-ROI floor are added to Phase 2.

**Scope note.** This is a code-verified architectural critique, not a performance profile. Source claims below were checked against `35996e5` and are marked as verified. The waste and cost ratios are arithmetic over pixel counts, not measured wall-clock speedups. No profiling was performed for this feedback.

---

## 1. Summary

The subject report is a strong defect audit. Its twelve findings are real, its confidence calibration is unusually honest, and its corrections to the independent static audit are correct. As a bug list, all twelve are worth acting on.

It has one blind spot, and it is the one that decides whether the competitive target is reachable:

> **The report optimizes within the "exact selected tier" doctrine rather than questioning it. That doctrine is the root architectural cause, and most of the twelve findings are its downstream symptoms.**

Preview render resolution is currently chosen by a user-facing dropdown and is completely independent of what is on screen. Every competitor named in the target instead processes *the visible region at display scale*. On a 42 MP image fit to a 2560x1440 display, the current design processes about **14x more pixels than it displays**, structurally, before any of the twelve defects applies — and at 200% zoom, about **46x**.

That ratio is approximately the gap between the measured 1,421 ms Full gesture and the sub-100 ms interaction the target products deliver. Fixing the twelve findings inside the present contract will make Full faster; it will not close a structural gap of that size.

The change also *increases* fidelity rather than trading it away. Two findings below are the load-bearing ones:

- **The current design is not exact at 1:1.** At 100% zoom with the 4K tier, a 4096-wide render is CSS-stretched to 7968 px — a 1.94x upsample — so the one view a finisher uses to judge grain and micro-detail is showing interpolated pixels at every tier below Full (§3.4a, verified in code).
- **Region-of-interest processing is export-exact wherever it matters.** At any zoom at or above 100%, processing scale is 1.0, so grain, Detail and Denoise run at their export radii. That view is byte-exact against export for the visible region, at roughly 1/11th the current cost (§3.5).

Four consequences for the sprint:

1. The pipeline contract should change first, and will delete or trivialise most of the twelve findings.
2. The resolution selector should be replaced by a latency target, not merely retuned (§4).
3. The 2 GiB cap is wrong as a number *and* wrong as a knob, but it largely stops being load-bearing once the contract changes (§5).
4. Three subsystems missing from the report — a persistent multi-resolution image cache, pixel transport topology, and the dual-implementation tax — belong in the same sprint, and the first of them is a Phase 2 prerequisite rather than a later nicety (§6.1, §7).

---

## 2. Verification of the subject report

Claims checked against `35996e5`:

| Report claim | Status |
|---|---|
| Auto budget is a fixed 2 GiB | **Verified.** `GPU_BUDGET_AUTO_BYTES = 2 * 1024 * 1024 * 1024`, `frontend/webgpu-preview.js:482` |
| `encodeTiledGeneration()` does not pass a viewport to `scheduler.plan()` | **Verified, and stronger than stated.** `plan()` accepts and honours `viewport` (`frontend/tile-scheduler.js:104` onward), but the identifier `viewport` does not occur anywhere in `frontend/webgpu-preview.js`. The visible-first priority machinery is entirely unreachable, not merely under-used. |
| Exact-peak path runs a native-resolution render that paints nothing | **Corroborated.** `measureOnly` explicitly suppresses the canvas resize, with a comment stating that skipping the presentation surface is what makes a native measurement affordable (`frontend/webgpu-preview.js:1857-1866`). |
| Canvas backing store is sized to tier dimensions | **Verified.** `canvas.width = proxy.width` at `frontend/webgpu-preview.js:1864` and `:2613`. |
| Frontend monoliths | **Verified.** `frontend/app.js` 17,318 lines; `frontend/webgpu-preview.js` 7,115 lines. |

Assessment of the report's own judgements:

- Its rejection of `tileSize ~= 4 x halo` as a prescription rather than an experiment is correct, though for a deeper reason than it gives (see §3.7).
- Its identification of the compile-outside-lock cache stampede in `backend/hdr_finisher/render_cache.py` is the most valuable finding in the document and was genuinely missed by the other audit.
- Its refusal to generalise single-machine results to integrated and unified-memory GPUs is right and should be preserved in the sprint's exit gates.

No claim examined was found to be overstated. The report's separation of "measured", "high-confidence mechanism", and "needs a trace" should be carried into the sprint document verbatim as a discipline.

---

## 3. The root cause: render resolution is decoupled from the display

### 3.1 What the code does

`applyZoomGeometry()` (`frontend/app.js:11592`) implements zoom as **pure CSS**. It computes a display size and assigns it to the element style:

```js
els.previewCanvas.style.width  = `${displayWidth}px`;
els.previewCanvas.style.height = `${displayHeight}px`;
```

The canvas *backing store*, meanwhile, is sized to the selected tier's pixel dimensions (`frontend/webgpu-preview.js:1864`). The tier itself comes from a user setting — `"1024" | "2048" | "4096" | "full"` (`frontend/app.js:205-206`) — and has no relationship to zoom level, window size, device pixel ratio, or which part of the image is visible.

### 3.2 The resulting waste

For the 7968x5320 fixture (42.4 MP) on a 2560x1440 viewport:

| View | Pixels displayed | Pixels processed at Full | Ratio |
|---|---|---|---|
| Fit to window (27.1%) | ~3.1 MP | 42.4 MP | **~14x** |
| 100% zoom | ~3.7 MP visible | 42.4 MP | **~11x** |
| 200% zoom | ~0.9 MP visible | 42.4 MP | **~46x** |

This is a floor on wasted work, independent of the twelve defects. Every one of those defects then multiplies against the inflated baseline: halo amplification, mask fan-out across 176 tiles, whole-image source residency, whole-image presentation surfaces, and the per-frame peak readback are all proportional to a pixel count that should not have been 42 MP in the first place.

### 3.3 What the competitors do instead

All three target products use a **scale-aware region-of-interest pull pipeline**. The pipeline is asked for *this rectangle at this scale*; every module executes at that scale, with spatial radii scaled to match.

- **darktable** is the cleanest reference: two pixelpipes. A small whole-image **preview pipe** feeds the histogram, scopes, and mask preview. A **full pipe** processes only the visible ROI at display scale. Neither pipe processes the full sensor resolution for ordinary screen viewing.
- **Lightroom's** Develop module likewise never processes 42 MP to fill a window; it maintains cached proxies and renders the view.
- **DxO PhotoLab** behaves the same way, which is why its slider response is roughly scale-invariant with respect to source megapixels.

HDRF is the outlier. The tier ladder is a design the target products deliberately do not have.

### 3.4 The doctrine does not deliver the accuracy it promises

This matters more than the speed argument, because accuracy is the reason the doctrine exists.

**(a) The current design is not exact at 1:1 — verified.**
`applyZoomGeometry()` computes `displayWidth = sourceWidth * percent / 100` in **source** pixels, while the canvas backing store is the **tier's** width. At 100% zoom on the 42 MP fixture with the 4K tier selected: CSS width 7968 px, backing store 4096 px. The viewer is inspecting a **1.94x upsampled render**.

Every tier below Full therefore breaks 1:1 inspection — the exact view a finisher uses to judge grain, Detail, Denoise and halation. The sprint PRD promises "a 4K user receives exact 4K processing throughout interaction" (line 16); what the 4K user actually receives at 100% zoom is interpolation. This is a correctness defect, not a performance one, and it is not in the subject report.

**(b) At Fit, "Full" is plausibly *less* accurate than a correctly downsampled render.**
A 7968 px canvas is handed to the browser and CSS-scaled to roughly 2157 px. That is a single-level filter, not a mip chain. Grain, Detail halos and halation ringing alias into moire rather than resolving correctly. A scale-aware render downsamples properly and is closer to the truth on screen. *Measure before asserting this in the PRD* — screenshot-compare Full-at-Fit against correctly-downsampled-at-Fit on a grainy, high-Detail frame — but the mechanism is sound, and Chromium's canvas downscale filtering is not a mip chain.

**(c) The tier ladder is exactness theater at 1K/2K/4K.**
Grain, Denoise and Detail are scale-dependent, so a 4K-exact preview is a different picture from the delivered file even when it is not also upsampled per (a). **Only Full matches export.** The ladder markets four fidelity levels while delivering one, at up to 46x the cost of the honest alternative.

**(d) The legitimate requirement is satisfiable far more cheaply — see §3.5.**

### 3.5 Region-of-interest processing across the zoom range

The reframe that answers the obvious objection ("at 200% I still need full resolution"):

> **Full resolution is not the same thing as the full image.** At 200% you need native 1:1 pixels — full resolution — over a small window. Those are separable properties, and the current architecture conflates them.

In an ROI pipeline there is no proxy resolution to choose. Processing scale is an **output** of viewport x zoom x devicePixelRatio, clamped at 1.0. "What resolution do we process at" stops being a policy question and becomes a measurement.

**Cost curve.** Viewport 2560x1440, 42.4 MP fixture. "Visible source region" is how much of the image the viewport can actually show:

| Zoom | Visible source region | Processing scale | Pixels processed | vs. current |
|---|---|---|---|---|
| Fit (27.1%) | 42.4 MP (all) | 0.27 | ~3.1 MP | 13.7x less |
| 100% | 3.7 MP | 1.00 | ~3.7 MP | 11.5x less |
| 200% | 0.92 MP | 1.00 | ~0.92 MP | 46x less |
| 400% | 0.23 MP | 1.00 | ~0.23 MP | 184x less |

Cost is roughly flat at approximately viewport area, **peaks at 100%**, and falls away under further magnification. At 200% the viewport can only show 1280x720 source pixels, so that is all that is computed.

The scale column clamps at 1.00 deliberately. Above 100% the pipeline processes at native 1:1 and display magnification is a resample of already-exact pixels. Processing at 2x would add no information and would render grain and Detail at the wrong radii.

**Small screens get cheaper, not more expensive.** A 1366x768 laptop can only show 683x384 source pixels at 200% — **0.26 MP**. At Fit it shows the whole image at 0.144 scale — 0.88 MP. A small panel means a small window means less work at every zoom level. Screen size never forces whole-image processing.

**This is the strongest available answer to the exactness requirement.** At any zoom at or above 100%, processing scale is 1.0, so every scale-dependent module runs at its export radii. **That view is export-exact, byte-for-byte, over the visible region.**

| | Export-exact view available | Cost of it |
|---|---|---|
| Today | Full tier only | 42.4 MP |
| ROI pipeline | any zoom >= 100% | <= 3.7 MP |

So the contract change delivers the guarantee the sprint PRD was reaching for, at roughly 1/11th the cost, while repairing the 1.94x upsample that currently makes 1:1 inspection untruthful at every tier below Full.

### 3.6 What the contract change dissolves for free

| Report finding | Effect of ROI-at-display-scale |
|---|---|
| 4 — halo amplification | **Mostly evaporates at low zoom** (radii scale with resolution, so at Fit the radius in pixels is small). **Inverts at high zoom** — see §7 Phase 2 item 7 for the minimum-ROI floor this requires. |
| 6 — whole-image surfaces | **Non-issue.** Presentation surface becomes viewport-sized; source becomes a tile ring. The predicted ~1.15 GB plan drops by roughly an order of magnitude. |
| 7 — no live slider frames | **Stops being a tradeoff.** At ~3.1 MP the exact result can be produced *during* the drag. The 110 ms settle delay becomes unnecessary — and the target products render continuously during drag, so that delay is itself a competitive deficit, not merely an optimisation. |
| 1, 8, 12 — exact-peak render, peak readback, inactive-lane prep | **Collapse into the preview pipe**, which is small enough that their cost stops mattering. |
| 3 — non-preemptible monolithic submission | Still needs fixing, but on a ~3 MP frame the cost of a late cancellation is bounded rather than catastrophic. |
| 2 — mask fan-out and stampede | Still needs fixing on its own merits. Tile count at display scale is ~12 rather than 176, which removes the fan-out but not the backend stampede. |

This is the central recommendation: **do not sprint the twelve findings as written.** Sprint the pipeline contract, and let it delete most of them.

### 3.7 Why the report's halo remedy is the wrong lever

The report proposes adaptive tile sizing around `max(512, 4 x halo)` and correctly flags it as an experiment rather than a prescription. The deeper objection: bigger tiles trade overlap for larger transient textures, larger cache entries, and coarser admission granularity — it treats the symptom. Radii scale with resolution, so processing at the right scale removes the overlap at its source. Adaptive tile sizing is still worth having as telemetry-driven tuning for the *export* and proof paths, where full resolution genuinely is required. It should not be the answer for interactive preview.

---

## 4. The resolution selector, and the control surface that replaces it

### 4.1 What the dropdown is doing today

It serves two jobs at once, and both are real needs:

1. **A latency valve** — fewer pixels, faster frames.
2. **A memory valve** — at the 1024/2048 tiers the whole-image source texture is small, so the plan fits where Full's 339 MB source plus 339 MB presentation would not.

The objection is not that these needs disappear. It is that **"long edge in pixels" is the wrong unit for either of them**, and that the ROI architecture controls both directly and better.

### 4.2 Why resolution is the wrong unit

**It cannot be set correctly, because the correct value is not knowable by the user.** "2048 long edge" means different things on a 1366x768 laptop and a 5K display, and changes whenever the window resizes or the zoom changes. On the laptop at Fit, 2048 already oversamples a ~1151 px view — the user pays for pixels they cannot see. On a 5K display at Fit, 4096 undersamples; they selected "4K" and got a soft image. Add `devicePixelRatio`, which is invisible to them, and the setting is unsettable in principle.

**It silently corrupts the one view where fidelity matters most.** Per §3.4a, verified: every tier below Full presents interpolated pixels at 100% zoom. The dropdown is not a clean speed/quality trade; it is a speed/quality trade that destroys the truthful view while the PRD claims exactness throughout.

**It is orthogonal to cost.** Processing cost tracks *ROI pixels x graph complexity*. The dropdown controls a whole-image dimension. At 100% zoom only the visible ~3.7 MP is needed to be exact at any tier — Full computes 42 MP of it, and 4K computes 8 MP of the wrong thing.

### 4.3 How low-end and high-end both work without a resolution ceiling

**The hardware spread is smaller than it looks, and it correlates favourably.** Once cost tracks screen area rather than image megapixels:

| Machine | Viewport | ROI cost at Fit | Current cost at Full |
|---|---|---|---|
| 1366x768 laptop, integrated GPU | 1.05 MP | ~0.88 MP | 42.4 MP |
| 2560x1440, RTX 4070 Ti | 3.69 MP | ~3.1 MP | 42.4 MP |
| 4K workstation | 8.29 MP | ~7.0 MP | 42.4 MP |

Screen area spans about 8x, and it spans it *in the same direction as the hardware* — weak GPUs are attached to small panels, strong GPUs to large ones. The effective spread after that cancellation is small.

Contrast the right-hand column: today both extremes do 42.4 MP. The integrated GPU performs roughly 40x more work than its panel can display, on the slowest silicon in the lineup. **That is what makes the dropdown feel mandatory** — the architecture hands low-end machines an impossible job and the dropdown is the escape hatch. Remove the impossible job and the hatch is largely unnecessary.

**For the residual spread, use progressive refinement rather than a ceiling.** Render the ROI at reduced scale, present it, then refine to display scale — same graph, same contract, self-adapting:

- Fast machine: the coarse pass completes in a few milliseconds and refinement lands inside the frame budget. Invisible.
- Slow machine: a slightly soft frame during the drag, exact on settle.

No user setting, and it degrades continuously instead of in four jumps.

### 4.4 The PRD amendment this requires

§4.3 is the interaction-time proxy substitution the sprint PRD bans (lines 14-16, 46). That prohibition was written against a real bug — substituting a low-resolution proxy and then *jumping* to a different-looking result on settle, so the user could not trust what they were judging. Correct diagnosis, wrong remedy. The fix is not "never show anything approximate"; it is **"never let approximate be mistaken for final."**

Note what the PRD chose instead: **stale-but-exact over current-but-approximate.** For 1.4 seconds the viewer is looking at a frame that is exact for *the wrong slider value*. That is worse for judgement than a labelled soft frame that refines in 80 ms. A frozen frame conveys nothing about the edit in progress; an approximate current frame conveys direction and rough magnitude, and the exact answer arrives before the hand leaves the control. The PRD traded a real deficiency for a worse one and called it truthfulness.

Three conditions make approximate-during-drag honest, all cheap in an ROI world:

1. Refinement is unconditional and fast enough that settle is not a surprise.
2. The approximate frame is visibly labelled as such.
3. The coarse and exact passes run **the same graph at different scales**, so refinement changes resolution only — never the character of the result.

**Proposed replacement clause for the PRD:** *Processing scale is derived from viewport x zoom x devicePixelRatio, clamped at 1.0. A labelled coarse-first pass is permitted during interaction and must refine unconditionally to exact-at-display-scale. At any zoom at or above 100%, the refined result is export-exact over the visible region.*

That final sentence is a stronger guarantee than the current PRD makes, and it is checkable by a parity test (§8).

### 4.5 The replacement control surface

If a user-facing dial is wanted for the low end — and it should be — express it in what the user actually wants:

- **Responsive / Balanced / Precise**, mapping to a latency budget of roughly 33 / 66 / 150 ms.
- The app measures achieved latency and adapts the coarse-pass scale to hit the budget. A closed loop; the dropdown is open-loop guessing.
- "Precise" means *no coarse pass* — exact at display scale from the first frame. On a 4070 Ti at Fit that is the default behaviour anyway.
- An automatic, non-user-facing clamp: never supersample beyond device pixels.

Resolution survives in three internal places, none of them user policy: the persistent proxy/mip cache (whose levels are a resolution ladder), export, and the proof/render-check pass. A resolution override should remain available in diagnostics for parity testing.

### 4.6 Memory on low-end hardware

ROI does more here than the dropdown, not less. Today the 1024 tier keeps memory down by shrinking a *whole-image* allocation. ROI needs a viewport-sized presentation surface plus a tile ring: roughly 19 MB of presentation for a 2.4 MP view, against the current plan's ~1.15 GB predicted peak. The dropdown bought low-end headroom by degrading fidelity everywhere including 1:1; ROI buys more headroom without degrading anything.

---

## 5. The 2 GiB cap

**Verdict: wrong as a number, and wrong as a knob.**

### 5.1 Wrong as a number, in both directions

- **Too low on capable hardware.** On the 12 GB RTX 4070 Ti test machine, 2 GiB forces the 42 MP graph into Tiled even though the reported Direct plan is ~2.84 GiB. The cap is *causing* the slower path on a GPU with six times the headroom required.
- **Unsafe on modest hardware.** 2 GiB of *logical* accounting that hardcodes transients to zero (`frontend/webgpu-preview.js:1423-1452`) and omits swapchain, staging, in-flight and deferred-destroy bytes will overcommit a 4 GB laptop GPU or an integrated / unified-memory system. The observed ~2.1 GB rise in system-reported dedicated GPU memory during a nominally 2 GiB-capped run is direct evidence of this.

A single fixed number cannot be right for both, and the current one is right for neither.

### 5.2 Wrong as a knob

One scalar conflating working set, caches and presentation cannot be tuned: raising it to help Direct admission also inflates cache floors, and the planner has no way to express "plenty of room for the working graph, little for proxy retention."

### 5.3 Recommended policy

1. **Calibrate; do not hardcode.** The app ships in Electron, so probe `app.getGPUInfo('complete')` for device memory. *Treat this as a hint and verify what Chromium actually populates on Windows* — do not build admission on an unconfirmed field. Back it with a startup **allocation probe**: allocate increasing buffers until failure, release, record the ceiling. That is cross-platform and reliable, and it is the mechanism to trust.
2. **Budget as a fraction of measured VRAM** — on the order of 50-60%, floored around 1 GiB, capped so the compositor and other applications are never starved. On the test machine that is 6-7 GiB, not 2.
3. **Split the budget** into working set / cache / presentation, each with its own reservation and eviction path, under one global LRU across lanes and tiers.
4. **Central allocator with mandatory reservation** before every texture and buffer allocation. This is the subject report's single best structural recommendation (Finding 9) and a hard prerequisite for raising the cap.
5. **Do not raise Auto before the accounting is trustworthy.** The report's ordering is correct on this point.

### 5.4 Sequencing note

Once the pipeline is ROI-based, the budget question largely stops being load-bearing — a viewport-sized working set fits comfortably in any plausible budget. Calibrate the budget *alongside* the pipeline work rather than ahead of it, so the calibration targets the architecture that will actually ship.

---

## 6. Three subsystems missing from the subject report

### 6.1 There is no persistent multi-resolution image cache — and it is a Phase 2 prerequisite

Every target product maintains a mip pyramid / cached proxy chain per image, on disk and in memory, so that pan, zoom, and revisiting an image are cheap and cold-open is fast. HDRF has per-session GPU proxies retained two tiers per lane (`frontend/webgpu-preview.js:4162-4170`) and nothing durable.

**This is load-bearing specifically for the Fit-to-window case.** At Fit the pipeline produces ~3.1 MP of output, but a correct result requires correctly *downsampled source*. Without a mip pyramid, producing those 3.1 MP still means reading all 42.4 MP — the compute shrinks and the read does not, so Fit stays slow and the headline latency gate fails. At zoom >= 100% the pipeline reads source 1:1 over a small region and needs no pyramid.

Consequently this moves from Phase 3 to **Phase 2**. It is a missing subsystem rather than a defect, which is presumably why a defect-oriented audit did not surface it.

### 6.2 HTTP is doing pixel transport

339 MB of source data moves through `fetch` plus staging buffers with a `queue.onSubmittedWorkDone()` drain per strip (`frontend/webgpu-preview.js:4329-4371`), and masks move through a per-tile REST endpoint that internally compiles the whole mask (`backend/hdr_finisher/main.py:1009-1041`). The target products are in-process with zero copies.

The report treats transport as a *scheduling* problem — bounded concurrency, abort signals, pipelining. It is partly a **topology** problem. Electron affords real alternatives: file-backed shared memory, a local socket with binary framing, or moving decode to the frontend. The scheduling fixes are still worth doing; they should not be mistaken for the ceiling.

### 6.3 Two authoritative implementations of every module is a permanent velocity tax

Python/NumPy CPU plus WGSL, gated on byte-exact parity. darktable pays a comparable cost (C plus OpenCL), so this is not unprecedented — but it should be a **named and accepted** cost with an explicit policy:

- which path is canonical;
- what tolerance parity actually requires, per module class;
- whether new modules may ship GPU-only, and under what label.

Left implicit, it doubles the cost of every remediation item in the subject report.

---

## 7. Recommended sprint sequencing

### Phase 0 — Product decision (gates everything else)

Replace "exact selected tier" with **"exact for what is displayed."** Adopt the replacement clause drafted in §4.4. Replace the resolution dropdown with the latency dial of §4.5, retaining a resolution override in diagnostics.

This is a PRD amendment, not an engineering task, and it must land before Phase 2 is designed. Note that the main product PRD (v1.2, line 261) already anticipated bounded preview resolution; the exactness doctrine is a sprint-level addition, not a founding requirement.

Deliverables: amended PRD sections; the §3.4b measurement (Full-at-Fit vs correctly-downsampled-at-Fit) as supporting evidence; a decision on how the tier setting is migrated for existing users.

### Phase 1 — Stabilisation that survives the redesign

From the subject report's immediate list, these are worth doing now because the new pipeline still needs them:

1. Idle-gate or disable the separate native exact-peak scope render (report #1).
2. Per-mask single-flight compilation and bounded fetch concurrency (report #2) — the stampede at `backend/hdr_finisher/render_cache.py:754-771` is a genuine backend defect independent of resolution.
3. Preserve the accepted canvas until a replacement is complete; make GPU failure recovery non-sticky for transient errors (report #3).
4. Coalesce Denoise input to one in-flight plus one latest-pending (report #5).
5. Generation-aware abort signals on source and mask fetches (report #6).
6. Close the `renderTiledTo()` / `activeRenderCount` race (report §10).

**Defer** the report's items #4 and #7 (inactive-lane deferral, global obsolete-tier eviction). The preview pipe and the retirement of the tier ladder make both largely moot; implementing them now is throwaway work.

### Phase 2 — The pipeline

1. ROI pull pipeline at display scale, with scale-propagating radii and processing scale clamped at 1.0.
2. Two pipes: a small whole-image preview pipe (scopes, histogram, mask preview) and an ROI full pipe.
3. Pass the real viewport to `scheduler.plan()` — the machinery already exists and is unreachable.
4. **Persistent multi-resolution source cache** (promoted from Phase 3 per §6.1). Without it the Fit case reads whole-image source and the headline gate fails.
5. **Display-scale pan cache.** Once ROI is the unit, panning becomes the hot path. Cache processed tiles keyed by *(scale, tile rect, generation)* so a pan reuses what exists and fills only the newly exposed edge. `frontend/tile-scheduler.js` was built for exactly this — its own docstring states that tile identity is anchored to global output coordinates "so the same output region keeps the same identity across pans, zooms and grid changes that leave the region itself alone." That property is currently unreachable because no viewport is ever supplied.
6. Cancellable small-batch submission with generation recheck between batches.
7. **Minimum-ROI floor.** Halo overhead inverts at high zoom: a 640x360 region at 400% padded by a 136 px Detail halo becomes 912x632, a 2.5x amplification. Trivial in absolute terms (0.58 MP) but worth bounding — pad generously and never process less than roughly 1024x1024, then rely on item 5 so small pans are free.
8. Labelled coarse-first pass with unconditional refinement, per §4.4.
9. Retained previous presentation in a separate target; generation-checked final composite.
10. Viewport-sized canvas; never resize the visible canvas before a replacement is ready. This also removes the CSS-upsample defect of §3.4a by construction.

### Phase 3 — Resources and transport

1. Central GPU allocator with mandatory reservation.
2. Calibrated budget per §5.3.
3. Binary / shared-memory pixel transport (§6.2).
4. GPU-side analytic mask rasterisation in WGSL; tiled authoritative store for brush masks.
5. Latency-dial closed loop (§4.5) tuned against the Phase 2 telemetry.

### Phase 4 — Decomposition

The subject report's eight-component split is the right target: render coordinator, source tile provider, mask provider, GPU allocator, Direct executor, Tiled executor, presentation manager, scope worker.

**Do this concurrently with Phase 2, not after it.** A 7,115-line `webgpu-preview.js` will not survive a pipeline rewrite intact, and the split costs a fraction as much taken while the code is already open. Deferring it guarantees the rewrite lands as new shared mutable state in the same two monoliths.

---

## 8. Exit gates and benchmark targets

The subject report is right that the existing suite measures correctness and fallback prevention rather than perceived latency. Recommended numeric targets, all on the 42.4 MP fixture at a 2560x1440 viewport:

| Metric | Target | Current |
|---|---|---|
| Slider-to-pixel latency, Fit | < 50 ms | ~1,422 ms (no live frames at all) |
| Slider-to-pixel latency, 100% zoom | < 100 ms | not applicable today |
| Slider-to-pixel latency, 200% zoom | < 50 ms | not applicable today |
| Pan latency, warm display-scale cache | < 33 ms | not applicable today |
| First visible tile after zoom or view change | < 150 ms | not measured |
| Cancellation latency after submission begins | < 50 ms | effectively unbounded |
| Local-adjustment edit, warm mask | < 200 ms | seconds; 36-40 s scenario end-to-end |
| Real application VRAM peak vs logical plan | within 15% | ~2.1 GB observed against a 2 GiB nominal cap |

The current Full gesture is roughly 30x off the first target. That is the size of the gap to the stated competitive goal, and it is why the contract change rather than the defect list is the load-bearing work.

**Two new correctness gates**, both consequences of §3.4a and §3.5:

- **1:1 fidelity.** At 100% zoom, presented pixels must be 1:1 with processed pixels — no CSS resample. A negative control should fail this gate on `35996e5`, where the 4K tier upsamples 1.94x.
- **Export exactness at magnification.** At any zoom >= 100%, the refined ROI result must be byte-exact against the export pipeline over the visible region, for a graph including grain, Detail and Denoise. This replaces the tier-parity gates and is a stronger guarantee than the current PRD makes.

Adopt the subject report's performance-test gap list in full — particularly Full-to-4K with work already submitted, cold vs warm local masks, halo amplification telemetry (`processedPixels / outputPixels`), time-to-first-visible-tile, and transient-failure recovery. Add:

- slider-to-pixel latency at Fit, 100% and 200%, as the headline gates;
- pan latency against the display-scale cache;
- the §3.4b screenshot comparison, to settle the Fit-aliasing question with evidence;
- coarse-to-refined convergence: the refined frame must match a no-coarse-pass control byte-for-byte.

Preserve the report's caveat: none of these results generalise to integrated or unified-memory GPUs without measurement on that hardware. The favourable screen-size/hardware correlation argued in §4.3 is a plausibility argument, not a measurement, and the low-end row of that table should be verified on real integrated hardware before the sprint closes.

---

## 9. Caveats on this feedback

- The source claims in §2, and the 1.94x upsample in §3.4a, were verified by reading `35996e5`. Nothing else here was.
- No profiling was performed. The causal ordering in §3 is architectural reasoning, of the same evidential class as the subject report's static findings.
- The cost ratios in §3.2, §3.5 and §4.3 are arithmetic over pixel counts, not predicted wall-clock speedups. Real gains will be lower — fixed per-frame costs, pipeline setup, shader compilation and transport do not scale with pixel count.
- §3.4b is a mechanism, not a measurement. Treat it as a hypothesis with a cheap decisive test attached.
- The §4.3 claim that screen size and GPU capability correlate favourably is an observation about typical hardware, not a guarantee. A 4K panel driven by integrated graphics is the adverse case and is the one to test.
- Competitor behaviour is described from published architecture (darktable is open source; Lightroom and PhotoLab are inferred from observed scale-invariance). No competitor was benchmarked for this document.
