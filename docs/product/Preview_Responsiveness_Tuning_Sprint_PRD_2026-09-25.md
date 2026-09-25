# Preview Responsiveness Tuning Sprint

**Date:** September 25, 2026
**Status:** Draft for owner review. Owner decisions are recorded in Section 7. No work starts until the owner approves this document.
**Amends:** [Viewport-Driven ROI Preview Performance Sprint](Viewport_ROI_Preview_Performance_Sprint_PRD_2026-09-22.md) (tuning only; no new architecture)
**Source:** Owner field testing of the development Electron build on 2026-09-25 (RTX 4070 Ti), checked against the code and the live app's diagnostics.

## 1. Summary

The last sprint built the right pieces (display-scale rendering, region-of-interest rendering, a retained frame, a coordinator) but the shipped defaults don't combine them into a fast experience. The owner's findings reduce to five causes, all confirmed in code or measured:

1. **The app picks the slow Tiled path far more often than it needs to.** The memory estimate counts every cached copy of the image at full size (7 copies measured live, so 2.37 GB is charged for one 339 MB image). Zoomed-in views are forced to Tiled even when Direct fits. Auto never looks at the graphics card and stays at 2 GiB.
2. **Zooming in re-processes the whole 42 MP image.** Rendering only the visible region exists but ships switched off.
3. **Feathered luma masks are computed on the CPU for the whole image.** At native resolution the feather blur alone takes about 4 seconds.
4. **Nothing caps the frame rate while dragging**, so the GPU runs as fast as it can.
5. **Three preview modes that barely differ**, and none of them optimizes the wait that matters: from releasing a slider to the settled image.

It also covers two small visual bugs: the exposure-band slider fill, and zoomed-in pixels being blurred instead of shown as sharp squares.

**The principle for this sprint:** smooth, real-time preview at full detail is the default. Every drag frame is exact at display scale (owner decision Q1), and the work is made cheap enough for that instead of being hidden behind soft frames. A single opt-in setting lets users on slower hardware trade detail during a drag for frame rate. Numbers that drive delivery decisions (peak nits, ceilings, export parity) stay exact, unchanged from current policy.

## 2. Reference setup for every test in this document

- **Hardware:** the owner's workstation (RTX 4070 Ti, 2560×1440 display, DPR 1, AC power).
- **Build:** packaged Electron, plus development Electron for iteration.
- **Fixture:** the 7968×5320 42.4 MP TIFF used by `tests/performance/packaged-baselines.js`.
- **Views:** Fit, 100%, 200%, 400%, 800%.
- **States:** warm (second and later repeats) and cold (first after import or zoom change). Report median and p95 over ≥8 warm samples, as `tests/performance/headline-latency.js` already does.
- **Local-mask variant:** the same fixture with one luminance-range local, feather at 50%.

Every item below states a **before** number (captured on this setup before the fix, as the negative control) and an **after** target.

## 3. Issues, desired outcomes, and acceptance tests

### P1. The exposure-band slider fill runs the wrong way

- **User sees:** in Exposure Bands, the purple fill under "Selected band" doesn't follow the thumb. Moving the thumb left makes the fill grow on the far left of the rail.
- **Cause (confirmed):** the fill is sized correctly but always drawn from the left edge. The CSS rule that starts a two-sided fill at the slider's centre only applies to sliders inside `.control-row` or `.instrument-slider-control` (`frontend/styles.css:8051`). The band slider sits in `.tone-equalizer-selected`, so it falls back to the generic left-anchored rule (`styles.css:5691`). The same affects the SDR band slider. A live DOM check found no other slider with this problem (the zoom slider is one-sided and correct).
- **Desired (user):** the fill always runs between the 0 EV point and the thumb, on the thumb's side, for HDR and SDR bands.
- **Desired (technical):** every `.range-shell` honours `--fill-start` regardless of its parent container.
- **Tests:**
  - *Automated:* a DOM test that, for every rendered `input[type=range]` in HDR and SDR panels, sets values below, at and above home and asserts that the fill's left and right edges bracket exactly the home position and the thumb position (±1 px).
  - *Manual:* drag the selected band across its range for bands at -6, 0 and +6 EV. The fill stays attached to the thumb.

### P2. Direct GPU is not chosen when it should be

- **User sees:** the technical readout shows "Tiled GPU" on a 12 GB card, even after choosing 8 GiB. It later switches to "Direct GPU" at some unrelated moment, and only then does the preview become fast.
- **Causes (all confirmed):**
  1. **Auto never reads video memory.** By design (sprint ledger 15.43), Auto is a fixed 2 GiB ceiling until failure recovery was proven. That recovery work has since landed (ledger 15.44), so the reason for the cap no longer holds.
  2. **The memory estimate over-counts cached copies of the image.** `planRender` charges `pixels × bytes × number of all resident proxies` (`frontend/webgpu-preview.js:691`, `:1267`). Live, 7 proxies were resident, so a native render was charged 2.37 GB for its source instead of 339 MB. On Auto that pushes nearly every zoomed-in render to Tiled. This was flagged as P1-3 in the 2026-09-22 review and is still open.
  3. **Zoomed-in region requests are always forced to Tiled.** `executionOverride: sourceOptions?.viewport ? "tiled"` (`webgpu-preview.js:3414`). Live at 8 GiB, the plan read `admitted: true, violations: []` and was still forced to Tiled.
  4. **Changing the budget doesn't re-render.** `applyGpuMemoryBudget` (`frontend/app.js:4389`) updates the setting and the readout but schedules no render, so the route shown is stale until the next edit or zoom. That is the "silent switch" the owner saw.
- **Desired (user):** on a card with plenty of memory, Direct GPU is used everywhere by default without touching settings. Changing the memory setting takes effect, and shows in the readout, within one second.
- **Desired (technical):**
  - Auto uses **up to half of detected dedicated video memory** (owner decision Q2). If detection fails, the current 2 GiB fallback applies. The readout says which of the two applies ("Auto · 6 GiB (detected 12 GiB)" or "Auto · 2 GiB (not detected)").
  - The manual limits (1–12 GiB and Custom) stay in Settings as a first-class control, not diagnostics: users who multitask with other GPU-heavy apps must be able to cap the app. A manual limit always overrides Auto, including when it's lower.
  - The admission estimate charges resident proxies at their real byte size (already available as `sourceProxyBytes`). Stale proxy levels are evicted before planning, not after.
  - Region requests go through normal admission: Direct when admitted, Tiled only when refused.
  - A budget or execution-setting change re-plans and re-renders the current view.
- **Tests:**
  - *Automated (unit):* `tests/render-plan-admission.test.js`: three resident proxy levels of different sizes; assert the source charge equals their summed real bytes, and that a 42.4 MP native render on an 8 GiB budget is Direct. A region request on an admitting plan must be Direct. *Negative control:* reverting the change produces Tiled.
  - *Automated (browser):* change the budget and assert a new render with the new route is presented within 1 s and the readout matches `lastRenderPlan.decision.mode`.
  - *Manual:* fresh launch on the 4070 Ti, Auto, open the fixture, zoom Fit → 200%. The readout shows Direct at every step.

### P3. Zooming past 100% is laggy

- **User sees:** at Fit and up to 100%, edits are smooth. Above 100% they lag badly, in every preview mode.
- **Causes:**
  - *Confirmed:* region-of-interest rendering ("Settings → Region of interest") ships set to **Whole frame** (`state.roiPreviewMode = "fit"`). Every settled edit at 100% or more therefore processes all 42.4 MP. The packaged baseline (ledger 15.20) recorded 42,389,760 processed pixels at both 100% and 200%. With P2's forced Tiled path on top, this is the slowest route in the app.
  - *To confirm by measurement:* the presentation canvas at native zoom is the whole 7968×5320 image in half-float (339 MB). Scaling it by CSS every frame above 100% may add compositor cost. The fix below removes this either way, but the before/after numbers must say which cause dominated.
- **Desired (user):** zoomed-in editing feels at least as responsive as Fit. Areas off screen catch up when panned to, and never show blank or wrong pixels (the behaviour the owner already accepted in ledger 15.15 and 15.17).
- **Desired (technical):** region rendering is on by default and becomes the only user path; the "Whole frame" option moves to diagnostics. Processed pixels per settled edit at 200% and above are bounded by the visible region plus padding and halo, not the image. Region passes use Direct when admitted (P2).
- **Tests:**
  - *Automated:* extend `headline-latency.js` with 200%, 400% and 800% rows. Assert processed pixels per settled edit ≤ 2× the visible source pixels plus halo, and slider → settled p95 ≤ the Fit p95 + 50 ms. *Negative control:* with Whole frame selected, the processed-pixel assertion must fail.
  - *Automated:* the existing ROI parity, pan-cache and catch-up drivers (`roi-refinement.js`, `roi-pan-cache.js`, `roi-catch-up.js`) and the tiled/film/denoise parity suites stay green.
  - *Manual:* at 200% and 400%, drag Exposure and then pan. There's no perceptible lag compared with Fit, and no blank or one-edit-behind region after the pan settles.

### P4. Zooming in never shows individual pixels

- **User sees:** at high zoom, pixels are smeared together instead of resolving into sharp squares as in darktable and similar tools. This is long-standing.
- **Cause (confirmed):** magnification beyond 100% is done by CSS on the preview canvas with `image-rendering: auto` (`styles.css:1483`), which the browser draws with bilinear smoothing. It isn't a browser limitation. Chromium supports `image-rendering: pixelated` on canvases, and WebGPU supports nearest-neighbour samplers.
- **Desired (user):** above 100%, each source pixel is a sharp, flat-coloured square. At and below 100%, the view stays smoothly filtered (no aliasing at Fit).
- **Desired (technical):** the preview and comparison canvases switch to nearest-neighbour magnification when the effective scale is above 1 device pixel per source pixel. HDR output (`dynamic-range-limit`) is unaffected. No docs change is needed unless testing finds a platform where this fails, and then that platform is documented in `docs/known-limitations.md`.
- **Tests:**
  - *Automated:* load a 1-pixel checkerboard test pattern, zoom to 800%, capture the canvas region, and assert every 8×8 block is uniform (no intermediate values). At 50% zoom, assert the result is filtered (mid-grey). *Negative control:* with `image-rendering: auto`, the 800% assertion fails.
  - *Manual:* zoom to 800% or more on a detailed area; individual pixels are visible as squares, in both HDR and SDR lanes and in comparison view.

### P5. Preview modes are unclear and don't optimize the wait that matters

- **User sees:** Responsive, Balanced and Precise feel the same and all lag. Precise feels best because it never shows a soft intermediate frame. The labels (33/66/150 ms targets) describe the drag, but the user judges an edit by the settled image.
- **Causes (confirmed):**
  - The zoom path ignores the preference entirely (ledger 15.38). The preference only changes coarse frames during a drag.
  - The settled wait is a 110 ms settle timer plus a full exact render. Packaged measurement (ledger 15.50): slider → refined 284 ms median at Fit and 296 ms at 100%, against the sprint's own 100 ms target, which is marked failed.
  - Most of the difference the owner felt between Tiled and Direct (P2) is larger than any difference between the modes.
- **Desired (user):**
  - No preview-mode decision. The default always shows full detail while dragging (owner decision Q1). With P2 and P3 fixed, that should also be smooth on the reference machine, as Precise in Direct already was in the owner's testing.
  - One opt-in escape hatch for slower hardware: **"Faster dragging on slower hardware — show a softer image while dragging, sharpening when you let go"**, off by default. It replaces the three-way menu. Export and exact measurements are unaffected either way.
  - The technical readout keeps saying truthfully what is on screen (Coarse only when the escape hatch is on, Updating, Ready).
- **Desired (technical):**
  - The default is today's Precise behaviour: every drag frame is exact at display scale, with no coarse pass. It is made fast by P2 (Direct), P3 (visible region only), and P6 (paced, one frame in flight), not by lowering resolution.
  - With the escape hatch on, the existing latency controller chooses coarse scales as Balanced does today, and never shows a coarse frame after release.
  - **Release → settled** is the primary metric. When the last drag frame was already exact at the current generation, it counts as the settled frame: no settle timer wait and no duplicate render. The settled pass then only does work the drag frames skipped (such as the scopes).
  - The zoom path honours the setting.
  - Preferences migrate without a prompt: Precise and Balanced become the default, and Responsive turns the escape hatch on.
- **Tests (reference setup, warm p95 unless stated):**

  | Metric | Before (record) | Target |
  |---|---|---|
  | Drag, default: full-detail frames per second, Fit and 200% | measure | ≥ 30 fps, never below 20 |
  | Drag, default: coarse frames shown | measure | 0 |
  | Release → settled exact, Fit | 284 ms median (15.50) | ≤ 150 ms |
  | Release → settled exact, 100–400% | 296 ms median at 100% (15.50) | ≤ 200 ms |
  | Release → settled exact, cold first edit after zoom change | measure | ≤ 400 ms |
  | Zoom change → sharp at new zoom, warm | measure | ≤ 300 ms |
  | Escape hatch on: coarse frame shown after release | measure | 0 |

  - *Automated:* extend `headline-latency.js` with a "release → settled" instrument (the trusted pointer-up timestamp to the first presented frame the renderer reports exact at the current generation) and add all rows above. Run with the escape hatch off (default) and on.
  - *Manual:* the owner compares the default against the old "4K" build (commit `55455e6`) and against Lightroom or darktable on the same file. The pass criterion is "at least as smooth as the old 4K setting, full detail throughout".
  - *Escalation rule:* if the default misses the drag frame-rate floor on the reference machine after P2, P3 and P6 land, stop and report the measured numbers to the owner. Do not silently turn on coarse frames.

### P6. The GPU is pushed flat out while dragging

- **User sees:** once Direct is active, the fans spin up hard during drags, then spin down at idle (so idle behaviour is correct). Other apps don't push the card this hard, even while exporting.
- **Causes (likely, to confirm by measurement):**
  - Drag frames are paced by `requestAnimationFrame` (`frontend/preview-scheduler.js:149`) with no frame-rate cap, so the rate follows the display's refresh rate.
  - A frame counts as finished when its commands are *submitted*, not when the GPU completes them (measured JS render time ~2 ms per frame live), so the GPU can be handed a new full frame at every refresh before the previous one finishes.
  - Interactive scopes add a readback every 60 ms (`interactiveScopeMs`).
- **Desired (user):** drags look just as smooth, and the card runs noticeably quieter.
- **Desired (technical):** a **60 fps** cap during interaction (owner decision Q3), applied regardless of display refresh rate. At most one drag frame in flight on the GPU (the next frame waits for the previous frame's completion, not its submission). Interactive scopes run at most every 100 ms and never delay a preview frame. The idle behaviour is unchanged.
- **Tests:**
  - *Automated:* a scripted 5-second continuous drag at Fit and 200%. Assert presented frames per second ≤ cap + 5%, GPU frames in flight ≤ 1 at every sample, and the P5 frame-rate floor still holds. Report GPU busy time per second from timestamp queries (the adapter supports them) before and after.
  - *Manual:* the owner repeats the drag that spun the fans up and records GPU utilization from Task Manager or `nvidia-smi` before and after. Target: roughly halved, with no visible loss of smoothness.

### P7. Feathered luma masks cause a long hang when zoomed in

- **User sees:** after adding a luma local adjustment with feather and zooming in, the settled high-resolution result takes much longer than normal zoom or edit waits.
- **Cause (confirmed and measured):** a feathered luminance-range or brush mask can't be computed per tile. The backend compiles it for the **whole image at the requested resolution on the CPU** (`backend/hdr_finisher/local_adjustments.py:92`, `:566`) using a 12-pass NumPy box blur. Measured on this machine, the blur alone takes **4.0 s at 7968×5320**, 1.6 s at 4096 and 0.14 s at 1600, before luminance, transport and upload. The compiled mask is cached per requested resolution, so every new zoom level that needs a new resolution pays again.
- **Desired (user):** adding or adjusting a feathered luma mask while zoomed in settles about as quickly as any other edit. Changing that local's grade (exposure, colour and so on) never recomputes the mask.
- **Desired (technical):** move the feather blur for luminance-range and brush masks to the GPU (a separable blur over the scene-luminance texture the renderer already holds), keeping the peak normalisation and the existing parity with the export reference within the approved tolerance. Until that lands, the fallback is to compile the mask once at native resolution and derive the lower zoom levels from it, never recompiling per zoom level. Grade-only edits on a masked local must hit the mask cache.
- **Tests:**
  - *Automated (Python):* existing mask parity tests plus a timing guard: compiling the feathered luminance mask for the fixture at native size stays within the new budget. Grade-only edits issue zero mask compilations (counted).
  - *Automated (browser):* luma local with feather 50%. Measure release → settled at 200% for (a) a feather change and (b) a grade change on that local. Targets: (a) ≤ 1 s warm, ≤ 2 s cold; (b) same as P5's zoomed target. Parity against the export reference within the Phase 0 tolerance table. *Negative control:* the current CPU path fails (a).
  - *Manual:* the owner's sequence (add luma local, feather, zoom in, wait) settles in about a second.

## 4. Settings: before and after

| Setting | Today | After this sprint |
|---|---|---|
| Preview response | Responsive / Balanced / Precise | Removed. Full detail always; one opt-in **Faster dragging on slower hardware** checkbox (P5) |
| Maximum GPU memory | Auto = fixed 2 GiB, plus manual sizes | Auto = up to half of detected video memory; manual limits stay in Settings (P2) |
| Execution (Auto/Direct/Tiled) | Settings | Diagnostics only |
| Region of interest | Settings, off by default | Always on; the Whole frame option moves to diagnostics (P3) |
| Frame-rate cap | None | Fixed 60 fps while dragging, not a user setting (P6) |

Settings help text is rewritten in user terms (what you'll see and when), not in milliseconds. `docs/user-guide/viewer-and-analysis.md` and the settings help are updated in the same change.

## 5. Constraints

- **Tuning, not redesign.** Every change reuses the coordinator, region pipe, retained frame, pan cache and admission model from the last sprint. No new transport, no new render architecture.
- **Don't restructure `settlePreview`.** The P5 settle changes remove waiting and duplicate work. They don't change how the settle pass is structured (the earlier hang is recorded in the 2026-09-22 review, Section 6).
- **Parity gates stay green:** tiled/direct parity, film parity, denoise parity, ROI parity, and export/reference parity at the approved tolerances.
- **Exact numbers stay exact.** Peak readouts and delivery checks are unaffected by any preview setting.
- **Negative control first.** Each fix's automated test must be shown failing on the current build before the fix lands.

## 6. Suggested order

1. P1, P4 (small, independent, quick wins the owner can verify immediately).
2. P2 (unlocks Direct; the largest single performance gain).
3. P3 (region rendering on by default, now running on Direct).
4. P6 (frame cap and one-in-flight), then re-measure. P5's numbers depend on it.
5. P5 (settle tuning and the settings simplification).
6. P7 (GPU feather).

After step 3, the owner does a hands-on check before steps 4–7, since P2 and P3 may change how the rest feels.

## 7. Owner decisions (recorded 2026-09-25)

- **Q1. While dragging a slider:** always full detail. No soft frames by default; the softer-while-dragging behaviour is available only as an opt-in for slower hardware (P5).
- **Q2. How much of the graphics card Auto may use:** up to half of the card's video memory (6 GB on the 4070 Ti). Users must keep the ability to set their own limit for multitasking workflows (P2).
- **Q3. Frame-rate cap while dragging:** 60 fps (P6).
- **Q4. When zoomed in and you pan to a new area after an edit:** newly revealed areas update a moment after panning stops. They're never blank; this matches the behaviour approved in ledger 15.15 and 15.17 (P3).

## 8. Definition of done

- All P1–P7 automated tests pass on the reference setup in the packaged build, with their negative controls recorded as failing before the fix.
- The before/after table for P5 and P6 is filled in with measured numbers in a ledger section appended to this document.
- The owner completes every manual check in Section 3 and signs off.
- Settings, help text and the user guide match the new behaviour; the old preference migrates without a prompt.
