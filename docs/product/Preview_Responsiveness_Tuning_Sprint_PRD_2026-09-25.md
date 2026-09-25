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

## 9. Implementation ledger

### 9.1 Steps 1–3 (P1, P4, P2, P3) — 2026-09-25

Branch `sprint/preview-responsiveness-tuning` (not pushed). Commits: `90677c7` (this PRD), `4f605a4` P1, `d9dd7be` P4, `6ac27d8` probe driver, `0e6de86` P2, `666f07d` P3 instrument. Every run here used the **development Electron build** through `tests/run-in-electron.js` at 2560×1440, DPR 1, AC power, RTX 4070 Ti (driver 32.0.16.1692), on the 7968×5320 fixture unless stated. **The packaged build was not rebuilt or measured in this step.** Those numbers are still owed for Section 8.

**P1: slider fill (done).** The generic `.slider-fill` rule now places the fill at `--fill-start` for every range shell. New test `tests/slider-fill-anchoring.js` checks all 64 rendered range inputs in the HDR and SDR panels (170 samples below, at and above home). Negative control: 3 failing samples, all on the HDR Selected band rail (home edge off by 44–146 px). After: 0. *Differs from the PRD:* the SDR band slider sits inside `.control-row` and was already correct on the current build.

**P4: sharp pixels above 100% (done).** Above 100%, the zoom layout tags the preview/comparison canvas and image with `.pixel-magnified`, which switches `image-rendering` to `pixelated`. New test `tests/pixel-magnification.js` (1-px checkerboard, screenshot of the composited viewer): before, the worst spread inside one source pixel's 8×8 block was 21 levels (HDR) and 16 (SDR), a fail; after, 0 in both lanes. At 50% both lanes stay a uniform mid-grey, so smooth filtering is unchanged. The comparison view uses the same class but has no automated check.

**Route and work diagnosis, measured before P2** (`tests/performance/responsiveness-probe.js`, `output/performance/sprint-0925-probe-before-auto.json`, Auto, Balanced):

- The Auto budget was 2048 MiB. A native plan's source charge was 1617–2264 MiB (5–7 cached levels × native size), so native plans read a peak of 3578–4289 MiB and were refused, falling back to Tiled. P2 causes 1 and 2 confirmed.
- At custom zoom ≥ 100% every render carried a viewport and was forced to Tiled (`overridden: true` even when `admitted: true`). P2 cause 3 confirmed. **A consequence the PRD did not list:** Tiled refuses interactive renders, so at 200/400/800% **every drag frame was refused** (17–19 per stroke), and the picture didn't change until release.
- At 200–800% the settled pass processed **all 42,389,760 pixels** (176/176 tiles, `retainedFrame: false`) even though it requested a viewport. A coarse 2048 px drag frame had replaced the native presentation, which left no retained native frame to limit the pass to.

**P2: Direct when it fits (done).**

- Auto is half of the detected dedicated video memory (Q2). The desktop shell reads it from the display driver (`desktop/lib/video-memory.js`: Windows `HardwareInformation.qwMemorySize` matched to the active adapter's PCI id; amdgpu sysfs on Linux; otherwise not detected). Measured here: 12,878,610,432 bytes, so **Auto is 6 GiB**. *Judgment call for the owner:* a "dedicated" figure under 4 GiB is treated as an integrated-graphics carve-out (this machine's AMD iGPU reports 512 MiB) and keeps the 2 GiB fallback, so laptops don't end up with a smaller budget than today.
- **Defect found and fixed:** the planner received the bare `"auto"` setting and turned it back into 2 GiB, so a calibrated Auto never reached admission.
- Source levels are charged at their real bytes, and stale levels (other session, older geometry or source, earlier region fetches) are evicted before planning. Region requests use ordinary admission. A budget change re-plans and re-renders. The readout shows "Auto · 6 GiB (detected 12 GiB)" or "Auto · 2 GiB (not detected)", and the Settings Auto option and help text say the same in user terms.
- Tests: 7 new unit cases fail before and pass after (`gpu-budget`, `render-plan-admission`, `webgpu-allocation-agreement`), and 4 new desktop `video-memory` cases pass. `tests/performance/budget-route.js`: before, Fit ran Direct but 100% and 200% ran Tiled, and a budget change produced **no new frame within 3 s**. After, Fit, 100% and 200% run Direct on Auto. Switching to 1 GiB presented a Tiled frame in 13 ms, and switching back to Auto presented a Direct frame in 6 ms (viewer Ready at 164 and 140 ms). The readout matched the plan each time.
- GPU cost of the new route (timestamp queries): a full native 42 MP Direct frame takes **~8.1 ms of GPU time median** (max 15–35 ms), with queue-complete at ~11 ms. Fit takes ~0.2–2.7 ms.

**P3: zoomed editing (measured; planned fix not applied, see 9.2).** `headline-latency.js` gains 200/400/800% rows, route and processed-pixel fields, and a fix for frames sampled before the input (once presentation became fast, those produced negative latencies). Same driver, same machine, 8 samples, Balanced, warm p95 (median in brackets), in ms:

| Row | Before P2 | After P2 | Target |
|---|---|---|---|
| slider → exact, Fit | 277.7 (277.4) | 5.3 (5.2) | ≤ 100 |
| slider → exact, 100% | 277.7 (271.7) | 11.4 (11.2) | ≤ 100 |
| slider → exact, 200% | 234.7 (223.5), Tiled | 11.4 (10.6), Direct | ≤ Fit p95 + 50 |
| slider → exact, 400% | 247.4 (217.4), Tiled | 47.3 (5.6), Direct | ≤ Fit p95 + 50 |
| slider → exact, 800% | 235.3 (223.4), Tiled | 11.5 (5.2), Direct | ≤ Fit p95 + 50 |
| first visible after view change (Fit → 100%) | 206.2 | 87.5 | ≤ 150 |
| warm pan | 11.2 | 11.2 | ≤ 33 |
| cold first stroke, Fit exact | 271.4 | 167.5 | — |
| cold first stroke, 100% exact | 441.1 | 199.2 | — |

Artifacts: `output/performance/sprint-0925-headline-before-p2.json`, `sprint-0925-headline-after-p2.json`, `sprint-0925-probe-after-p2-auto.json`, and `sprint-0925-budget-route-{before,after}.json`. Timings carry up to one display interval of observation quantisation.

Processed pixels per settled edit at 200–800% after P2: 42,389,760 (Direct, whole frame), against 31,833–505,818 visible source pixels. The P3 processed-pixel bound is therefore **not met on this machine**. That's inherent to Direct; see 9.2.

**Suites after these steps.** Node: 227 passed, 0 failed. Python: 1370 passed, 3 skipped (same as baseline). Desktop: 22 passed. Electron drivers after P2 that pass: `denoise-tiled-parity`, `roi-parity`, `roi-pan-cache`, `roi-catch-up`, `export-parity`, `presentation-gate`, `slider-fill-anchoring`, `pixel-magnification` and `budget-route`. **Three fail: `tiled-direct-parity`, `tiled-film-parity` and `roi-refinement`. They fail the same way on the pre-P2 build, and `tiled-film-parity` also fails with `main`'s frontend (`a114e90`).** The failing configuration changes between runs (one tile size passes and the other fails, with maxDelta 255). That points to a race between the drivers' diagnostic passes and the app's own render cycle under the Electron runner, not to a pixel defect. This sprint didn't cause them, but the PRD requires these gates to be green, so they're an open item.

### 9.2 P3: the measurement contradicts the PRD's diagnosis (stopped, not forced)

- The PRD blames the 42.4 MP settled passes on "Region of interest" shipping as *Whole frame*. Measured: at custom zoom ≥ 100% the app already requests the visible region on every pass, whatever that setting says (`renderGpuDraft`: `zoomMode === "custom" && zoomPercent >= 100`). The whole-frame passes came from coarse drag frames breaking the retained native frame, and from drag frames being refused on the forced Tiled route. Turning the setting on by default would have changed nothing at ≥ 100%.
- P2 as specified ("region requests… Direct when admitted") conflicts with P3's processed-pixel test, because Direct processes the whole frame. On the reference machine a whole-frame Direct pass is ~8 ms of GPU work, and zoomed editing is now faster than Fit was before, which meets P3's user outcome. The visible-region limit still applies automatically whenever Direct is refused (smaller memory limits, larger images), because those passes run on the Tiled route.
- Held until the owner decides: making *Visible region* the default, moving *Whole frame* to diagnostics, and the processed-pixel assertion. Recommendation: accept whole-image Direct as the zoomed path when memory allows, and keep the visible-region limit for the Tiled route. If P6 shows the card still working too hard while dragging at zoom, reconsider visible-area-only drawing then. That needs region support in the Direct path, which is larger than this sprint's tuning scope.

### 9.3 Open items carried forward

- Packaged-build numbers (Section 8) haven't been recorded yet. Everything above is development Electron.
- The three Electron parity driver failures from 9.1, which predate this sprint.
- The Section 4 settings changes (Execution moves to diagnostics, preview modes are removed, help text and user guide rewritten) belong with P5 and haven't started.
- Balanced still issues coarse 2048 px drag frames on a cold stroke at 100% (seen in the probe after P2). P5 removes coarse frames by default.

### 9.4 Regression found in the owner's check: zoomed preview turned SDR-looking (fixed, `f3aa69d`)

**Owner report.** Zoomed past 100% on a Sony A7R III ARW with Denoise and Highlight compression (Peak fit, maximum, 1000 nit target), the preview dropped to a dim, SDR-looking picture after the full-resolution image loaded, stayed that way at every higher zoom, and recovered only when zooming far out.

**Diagnosis (read-only, through the owner's debug port).** The canvas stayed a true HDR surface, and the image data was clean: no pixel above 32 in either the original or the denoised 42 MP copy. The highlight shoulder anchor cached for the native size read **36,922**, against 3.6–3.8 at every other size, with identical grade settings. With that anchor the Peak fit shoulder squeezes the frame; the same condition, forced in a test, puts the brightest pixel at ~73 nit. Zooming within the native range reuses the frame, so it stayed; changing exposure produced sane fresh measurements (4.5, 4.8) and recovered. **P2 exposed this:** native zoom now runs Direct, where drag frames are accepted as final and the settle pass that measured the anchor no longer always follows. The single 36,922 reading was **not reproduced on demand** (12 forced denoise rebuild/exposure rounds on the same camera's RAW all measured sane).

**Fix.** The anchor cache key now names the pixels measured (original vs a specific denoise reconstruction; they had shared a key, so Denoise-off measurements were reused with it on). A reading over 8× the estimate or carried value is measured once more, and the second result is used as measured. Drag frames carry the last real measurement through the exposure/lift/contrast change, using the reduction shader's own maths, instead of falling back to the rough estimate. The skipped measurement then runs, and the app redraws when it differs. A settled frame reuses an in-flight deferred measurement.

**Ceiling (owner requirement: never exceed the target).** The ceiling never depended on the anchor: the shader clips every BT.2020 channel at the target after the shoulder, on both routes (shared fragment function). `tests/performance/highlight-ceiling.js` forces the anchor to 10,000× too high, correct, and 1,000× too low, in Smooth rolloff, Neutralize peak and luminance handling. Result: **0 of 5,126,400 channels above 1000 nit**, max 1000.00 nit, before and after the fix. The compression-off control reaches 5,164.88 nit. The readback is Tiled; Direct shares the function but was not read back.

**Stability.** `tests/performance/highlight-anchor-stability.js` (real drags at 200%, Precise, Denoise off/on). Before: resting frame 1.03% off its own measurement with Denoise on (fixture), 0.35% (ARW). After: 0 error, no frame-to-frame anchor jumps, on both the fixture and the ARW.

**Suites.** Node 234, Python 1370 passed / 3 skipped, frontend contract 101. Also passing: `gpu-highlight-compression-parity` (its reduction-count rule updated: the drag frame no longer waits, and drag + settle cost one reduction), `scope-exact-peak`, `export-parity`, `denoise-tiled-parity`, `roi-parity`, `budget-route`, `presentation-gate`.

### 9.5 Black preview while "Ready" (fixed, `dfa98e9`)

**Owner report.** The preview went black at 183% zoom, with Denoise previously used and now off. The navigator kept working and the app reported Ready.

**Diagnosis (read-only, through the debug port).** The GPU device was healthy (not lost, probe OK), and video memory was 4.8 of 12 GB used. The canvas was correctly configured (HDR, 5320×7968, on screen), and the sharp-pixel style was ruled out by an A/B test. A validation scope around one redraw returned: "Destroyed texture [5320x7968 RGBA16Float] used in a submit". The denoise selector's `original` was an older proxy object than the live cache entry, and its texture had been freed; the allocator recorded 0 evictions, so it was a cache replacement, not LRU. With Denoise off, `selectedDenoiseSource` returned that freed copy, so every Direct submit was rejected and presented black. The app has no signal for a rejected submit, so it stayed Ready.

**Fix.** The selector adopts the live copy whenever the renderer hands it one (same identity, same pixels), and reconstruction adopts the live cached copy before reading the original. Which exact path replaced the entry in the owner's session was not determined; the fix covers every path.

**Tests.** A unit case in `highlight-anchor.test.js` fails before and passes after. `tests/performance/denoise-stale-source.js` reproduces the owner's exact validation error before and passes after, with Denoise off and on. `full-tier-denoise` now pins its Full row to Tiled (with the P2 budget, Full fits Direct and skipped the path it checks). **Pre-existing, not fixed:** `full-tier-denoise`'s "bypass does nothing" (0.22% of pixels differ, identical on `main`) and `denoise-selector-seam`'s telemetry timeout (identical without this change).

**Open, suggested:** a rejected Direct submit should not leave the viewer claiming Ready. Detecting it (a validation scope on the presentation submit, as the Tiled route already does) would turn any future case like this into a visible retry instead of a silent black frame.

### 9.6 Owner hands-on check after P3 — 2026-09-25 (passed) and decisions

Results of the owner's check on the development build (after the 9.4 and 9.5 fixes):

- Auto memory: the Settings option reads "Auto · 6 GiB (detected 12 GiB)". Passed.
- Exposure drag at 200%/400%: smooth, full detail, final on release. Panning and scrolling: no blank or stale regions. Passed.
- Memory limit 1 GiB: Tiled at 100%+ and Direct at 12% (the small frame fits), then back to Direct on Auto. Passed.
- Sharp pixels past 100% (checked up to 3200%): passed. Exposure Bands fill follows the thumb: passed.
- Highlight shoulder / HDR-SDR flip (9.4) and black preview (9.5): fixed, and confirmed working by the owner after a restart.

**Decisions recorded.**

- **P3 (resolves 9.2):** when the card has room, zoomed views draw the whole image Direct (the owner accepted the recommendation). The visible-region limit stays automatic on the Tiled route, which applies when memory is tight. *Visible region* is not made the default. The processed-pixel bound applies to the Tiled route only; `headline-latency.js` already reports it that way. Revisit visible-area-only Direct drawing only if P6 shows the card still working too hard at zoom.
- **Technical scope panel (added to P5 scope):** today it lists 45 rows across three columns, which don't fit at any panel height. Technical keeps about 13 plain-language rows: Preview (View, Status, Detail, Processing), Display (HDR on this display, Monitor), and Source (File, Interpretation, Encoding, Signal, Source peak, Reference white, Bit depth). The full list moves to a new **Diagnostics** entry in the scope-type dropdown (the owner's suggestion).
- **Zoom maximum:** stays at 3200% (unchanged since July; it is only newly noticeable because pixels are now sharp).

### 9.7 P6: frame cap and one frame in flight (done, `e70b913`)

**Diagnosis confirmed by measurement** (`tests/performance/drag-gpu-load.js`: a 5-second continuous Exposure drag on the 42.4 MP fixture, Precise, pointer moves at 1 kHz from inside the page). A Playwright-driven mouse only reaches ~50 input events per second, which would hide the missing cap. Display 163.9 Hz. Before: frames followed the display refresh (Fit 139.6 fps, 200% 100.4 fps), and up to 7 frames were in flight on the GPU. A frame counted as done at submission, not at completion.

**Change.** The scheduler paces drag frames at 60 fps from the vsync timestamp (2.5 ms tolerance, so a 60 Hz display keeps every frame). Every drag frame waits for GPU completion before the next is drawn. Interactive scopes run every 100 ms and never while a preview frame is in flight. Idle behaviour is unchanged.

| Drag, reference machine | Fit before | Fit after | 200% before | 200% after | Target |
|---|---|---|---|---|---|
| Presented fps (worst 1 s) | 139.6 (132) | 51.2 (49) | 100.4 (87) | 49.2 (40) | ≤ 63; ≥ 30, never < 20 |
| GPU frames in flight (max) | 7 | 1 | 7 | 1 | ≤ 1 |
| Card utilisation (nvidia-smi) | 8.4% | 11.4% | **44.2%** | **25.6%** | roughly halved |
| Card power | 25.2 W | 21.0 W | **86.6 W** | **57.4 W** | — |
| Coarse frames shown | 0 | 0 | 0 | 0 | 0 |

At 200%, active power above idle fell from about 70 W to about 40 W. On a 164 Hz display the cap lands at ~50 fps, not 60, because frames align to vsync (every third refresh, 18.3 ms). The renderer's timestamp-query "GPU busy" read ~366 ms/s both before and after; it counts queue waiting when frames overlap, so it is **not** used as the load metric. Utilisation and power are.

**Unchanged responsiveness** (`headline-latency.js`, 8 samples, warm, median / p95 ms): Fit 5.2 / 11.1, 100% 10.9 / 11.3, 200% 5.5 / 11.4, 400% 12.3 / 33.9, 800% 5.4 / 17.5, pan 11.1 / 11.2. All rows pass.

**Tests.** `tests/preview-scheduler-pacing.test.js`: 3 of 4 fail before (164.5 fps, a scope during a frame, 60 ms scopes) and pass after. `drag-gpu-load.js` fails before and passes after. Also passing: Node 239, frontend contract 101, `highlight-anchor-stability`, `presentation-gate`, `roi-catch-up`, `budget-route`. The owner's manual fan check is still to do.

**Owner check (P6), 2026-09-25:** passed. Drags stay smooth and the GPU load and fans are noticeably lower. The Technical / Diagnostics scope-panel change (9.6) is bundled into P5 at the owner's request.
