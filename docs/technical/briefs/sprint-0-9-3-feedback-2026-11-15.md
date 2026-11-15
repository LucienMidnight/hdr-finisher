# Sprint brief: 0.9.3 feedback (November 15, 2026)

**Owner:** Steve. **Coordinator:** Claude (Opus 5.5): keeps this brief
current, checks every report, takes decisions to Steve one at a time.
**Workers:** Codex `gpt-6.1-sol`, one per work package, each in its own
worktree made from `feat/watermark-and-library-polish`.
**Source:** Steve's "HDRF - 0.9.3 notes", six Codex review reports and one
code review of the PC changes made on November 15 (`f7c02993..55e8bb5f`).

`AGENTS.md` applies to every package, especially "How much to test", the
GPU-route rules, "Stop and ask", and asking Steve before any commit or push.
Where this brief and `AGENTS.md` disagree, `AGENTS.md` wins.

## How to use this brief

- Each item has an ID, a status and a definition of done. Workers update
  only the status column of their own items, plus a one-line result.
- "What we know" lists what the reviewers found. It is a starting point,
  not an order: confirm the cause in the code before fixing it, and if the
  code disagrees, say so in your report.
- An item marked **output change** changes rendered pixels on purpose. Say
  so in the commit and run the matching preview/export agreement checks.
  Never loosen a tolerance to get a pass.
- When an item is finished, record the outcome in its module PRD
  (`docs/product/modules/`). When the whole brief is finished it moves to
  `docs/technical/archive/briefs/`.

## Status board

| ID | Item | Package | Status |
| --- | --- | --- | --- |
| R1 | SDR local Detail: CPU clips, GPU keeps headroom | W1 | to do |
| R2 | Startup reconciliation brings back invalidated scenes | W1 | to do |
| R3 | Grade import overlaps a running paste import | W1 | to do |
| R4 | Built previews keep the pre-fix Detail rendering | W1 | to do |
| R5 | Refresh invalidates unrelated photos' work | W1 | to do |
| R6 | Deferred delete can remove a fresh replacement | W1 | to do |
| R7 | Failed clean-up request hides a successful paste | W1 | to do |
| R8 | Exact grain test fails on the Mac | W1 | to do |
| P1 | Paste Grade shows it has started immediately | W2 | to do |
| P2 | Edited thumbnail appears fast after leaving Grade | W2 | to do |
| P3 | Opening Grade during background work is fast | W2 | to do |
| P4 | Library Denoise setup reused when nothing changed | W2 | to do |
| P5 | Lensfun: measure, then decide | W2 | to do |
| C1 | Colour wheels: tiny move changes highlights | W3 | to do |
| C2 | Colour wheels: Balance direction | W3 | to do |
| C3 | Colour wheels: clicking a puck changes it | W3 | to do |
| T1 | Blacks/Whites and Shadows/Midtones/Highlights redesign | W4 | research |
| M1 | HDR to SDR Match colour shifts (blue jeans) | W5 | research |
| U1 | Export panel padding and single divider | W6 | to do |
| U2 | No selection borders after mouse use | W6 | to do |
| U3 | Module header: dot + Reset left, Presets right | W6 | to do |
| U4 | Full screen shows rating/pick/colour | W6 | to do |
| U5 | Maximize button shows Restore when maximized | W6 | to do |
| U6 | Right-click menu text size | W6 | to do |
| U7 | Right-click menu opens without lag | W6 | to do |
| U8 | Frame menu fits the MacBook Neo | W6 | to do |
| U9 | Hover backgrounds as tokens in every theme | W6 | to do |
| U10 | Pinned drag shows an insertion line | W6 | to do |
| U11 | Unpin control looks odd | W6 | waiting on Steve |
| U12 | Mac Dock/Command-Tab icon | W6 | to do |
| U13 | Less rounding on the logo background | W6 | to do |
| L1 | Tooltips appear after about 2.5 s | W7 | built — shared 2.5 s controller in every renderer; neighbour grace disabled; grouped app validation pending |
| L2 | Tooltip pass: no redundant labels | W7 | to do |
| L3 | "Choose what to paste" organised | W7 | to do |
| L4 | Open image uses the Library grid browser | W7 | to do |
| L5 | Purple default accent, orange still offered | W7 | built — purple before first paint; saved accents retained; ten focused checks pass; grouped app review pending |

## Decisions

**Made**

| Date | Decision |
| --- | --- |
| Nov 15 | Purple `#9b7bff` is the default accent. Orange stays a choice in Settings. Saved choices are kept. |
| Nov 15 | Add a Whites slider beside Blacks. Blacks and Whites are simple endpoint controls that feel the same in HDR and SDR and overlap little with Shadows/Highlights. Shadows/Midtones/Highlights cover broader, customisable ranges, closer to lift/gamma/gain. Exact design waits for the T1 research. |
| Nov 15 | Steve opened the slow RAW (over 30 s) in **Grade**, while a paste was running. |

**Recommended defaults, adopted unless Steve overrides**

- Open image gains the grid chooser only; opening a photo keeps today's behaviour (L4).
- Frame and Border both stay expanded in the compact Frame menu (U8).
- The full-screen marks overlay is display-only (U4).
- Right-click menu commands use the design guide's 14.5 px menu size (U6).
- The right-click menu appears at once; Revert items fill in a moment later (U7).
- Linked HDR/SDR paste choices show one checklist; two columns only when choosing separately (L3).
- Development launches on the Mac show the HDR Finisher icon (U12).
- The logo background keeps gentle, but smaller, rounded corners (U13).
- Pinned rows use the shared neutral hover background (U9).
- The insertion line also replaces whole-row highlights when reordering sidebar sections (U10).
- Reset stays hidden when a module has no changes (U3).

**Open, to ask Steve one at a time**

1. U11: which control looked odd: "Unpin folder" in the menu, the confirmation button, or "Remove" beside a saved location?
2. L1: after one tooltip has shown, should neighbouring controls in the same toolbar show theirs instantly for about 0.8 s, or should every tooltip wait 2.5 s?
3. L2: labelled controls: keep a tooltip for the keyboard shortcut alone, or no tooltip at all?
4. C4: should HDR and SDR colour wheels cover the same tonal ranges? This changes existing SDR looks. Ask after C1–C3 land.
5. T1 and M1: decisions from those research reports.

## Packages

Packages that touch the same files run one after the other, not in
parallel: W1 before W2 (shared paste, import and cache code); W1 R1 before
W3, W4 and W5 (shared processing code); W6 and W7 share stylesheets and
should be one worker or run in sequence. Only one GPU or Electron run at a
time on the machine, through `tools/gpu-run-lock.py`.

### W1: Fix problems in the November 15 PC changes (first)

Found by the code review of `f7c02993..55e8bb5f`. The rest of that range
looked sound: the stored-only paste picker, POST callers, cancellation
while waiting, reservation retention, whole-paste Undo, virtual copies and
saved SDR Denoise.

| ID | What's wrong (what we know) | Done when |
| --- | --- | --- |
| R1 | **Output change.** GPU keeps above-white SDR values through local Detail (`webgpu-shaders.js` ~2574); CPU clips local results to 1.0 (`local_adjustments.py` ~1545), and `apply_local_stack` clips the whole SDR frame before Film Look. Bright SDR + local Clarity/Sharpen + Film Look differs between preview and CPU export. | CPU and GPU follow the same headroom rule; an end-to-end local Detail then Film Look comparison passes within existing limits. |
| R2 | `library_cache.py` ~196: reconciliation records an obsolete-generation file against the current generation without checking its epoch, so a scene Refresh invalidated (but Windows could not delete) becomes valid again. | An invalidated or pending-delete file is never promoted; a test covers it. |
| R3 | Grade publishes a priority job and starts its import immediately (`import_jobs.py` ~96); paste notices only at its next checkpoint (`library_paste.py` ~130, `library_scheduler.py` ~514), so two full RAW imports can overlap on 8 GB. | Grade waits for paste to acknowledge release before its large allocation; a test uses a real `ImportJobManager` start while preparation is blocked. Fold into P3. |
| R4 | **Output change (stored pictures).** Detail changed finished pixels but finished-render versions did not advance (`library_screen_previews.py` ~18, ~78), so old built previews keep old highlights. | Stored thumbnails and screen previews built before the Detail fix are rebuilt; source developments are reused, no full RAW rebuild. |
| R5 | `library_refresh.py` ~18: Refresh bumps the global file-command epoch, so unrelated photos' source work is rejected. | Refresh of photo A only invalidates A's family; a test shows B completing. |
| R6 | `library_cache.py` ~410: `cleanup_pending` compares the old file's stamp outside the publication lock, then deletes whatever is at the path. | Compare and delete happen together under the lock; the interleaving test passes. |
| R7 | `grade-paste.js` ~114: awaited `/grade-preparation-end` in `finally` overrides a successful paste, so thumbnails, success message and Undo do not update. | Clean-up is best-effort and time-bounded; a successful paste always reports success. |
| R8 | `tests/test_grain_work.py` ~29 compares a committed reference bit-for-bit; on the Mac 217 of 6,783 values differ by about 1.2e-7. | The test is correct on both machines without loosening what it is meant to prove (for example, compare old and new implementations in the same run). |

### W2: Speed

Measure before and after on the MacBook Neo; record timings in
`docs/technical/performance-table.md` with the machine named.

| ID | Outcome wanted | What we know | Done when |
| --- | --- | --- | --- |
| P1 | The moment Steve confirms a paste, affected thumbnails hide and show "Preparing adjustments"; then "Updating preview"; visible ones redraw first. | The Library is only told after preparation and the transaction finish (`grade-paste.js` ~61/98, `photo-library.js` ~1024). | Old pixels hidden and progress visible within about 100 ms of confirming; cancel, failure, no-change targets, virtual copies and Undo all restore correctly (extend `tests/library-grade-paste.js`). |
| P2 | Leaving Grade shows the edited thumbnail almost at once when the Library was hidden. | A ready 640 px thumbnail waits behind the other rendition and 2560 px screen work (`photo-library.js` ~2237/2275, `library-gpu.js` ~461); a 30 s pending grace hides failures. | Ready thumbnails install without waiting for extra work; extra work deferred; `desktop/library-grade-picture-check.cjs` extended to cover an immediate return. Target the existing 500 ms clean-handoff goal. |
| P3 | Opening a RAW in Grade is not slowed by background work. | Steve's 30+ s open was in Grade during a paste. Paste preparation yields to Grade only at safe points; native RAW decode cannot be interrupted; post-paste Library redraws and Denoise warm-up keep running and compete for memory and GPU. Grade's own full RAW development is already slow (separate open work in the RAW PRD). | While Grade is opening, paste preparation, Library redraws and warm-up pause, and resume once Grade shows a picture. Includes R3. New check: the same cold RAW opened in Grade idle versus during a paste; contention adds no more than 250 ms or 10%, whichever is larger, apart from one reported native-decode segment. Memory gates unchanged. |
| P4 | Denoise does not slow repeat Library draws of an unchanged photo. | Library calls Denoise setup on every draw, replacing scratch and selector (`library-gpu.js` ~426, `webgpu-preview.js` ~5886). | Setup is reused for an identical source/lane/scale/geometry/model; control-only changes update correctly. Checks: `tests/denoise-tile-cache.js`, `tests/denoise-adaptive-parity.js`, a focused Library redraw. |
| P5 | Know where lens-correction time goes before rewriting anything. | Grade Lensfun is CPU, full resolution, after RAW development; remap is already parallel; a lens-only change re-develops the RAW (`raw_import.py` ~1304/1412/1638). Rejected already: another pre-lens cache, the sampled-grid GPU handoff. | Stage timings for decode, coordinates, vignette, remap and presentation (extend `tests/performance/raw-import-baseline.js`). Report to Steve with a go/no-go on exact strip-fused remapping. No rewrite without his yes. |

### W3: Colour wheel bugs

**Output change** for edits that use the wheels. Fix the CPU and GPU
together (`adjustments.py` ~1855, `webgpu-shaders.js` ~837, `gpu-params.js`
~377, `color-wheels.js`), including local wheels and HDR-to-SDR Match
translation (`sdr_match.py` ~513).

| ID | What's wrong | Done when |
| --- | --- | --- |
| C1 | Once any wheel is non-zero, the stage clips the whole frame (SDR to 0–1, HDR negatives to 0), even where that wheel has no weight. A 1% Shadows nudge flattened an above-white SDR highlight. | Moving a wheel from zero changes only the pixels its range weights; the output is continuous at zero strength; limiting is left to the later stages built for it. New checks: continuity at zero, unaffected-range pixels unchanged. |
| C2 | Positive Balance favours shadows; Lightroom's favours highlights. | Balance direction matches Lightroom in global and local wheels, CPU and GPU. |
| C3 | Puck drawn at 0.45 × width but input reads 0.5 × width; clicking a puck at 40 writes 36. | Clicking a puck without dragging leaves it unchanged. |

### W4: Tone controls (T1), research first

Steve's direction is in Decisions. A research report is in progress; it
will propose the Blacks/Whites endpoint behaviour, broad customisable
Shadows/Midtones/Highlights ranges, how Whites and Highlight Compression
share the bright end, overlap tables, processing order, and Local Tone. No
build until Steve approves a design. Current state: Blacks is a deep-shadow
gain (`adjustments.py` ~985), not a black point; Blacks and default Shadows
overlap over two stops and compound because Blacks runs first; there is no
Whites slider.

### W5: HDR to SDR Match colour (M1), research first

Steve sees denim come out a very different blue in SDR after Match. A data
investigation is in progress: synthetic patches across luminance through
the real CPU pipeline, stage by stage (Match, placement, highlight
compression, gamut mapping, Film Look), measured in a perceptual space, plus
an objective display check so the conclusion does not depend on Steve's
monitor. No fix until the cause is shown with numbers.

### W6: Small interface fixes

Design rules: `docs/design/HDR_Finisher_Design_Guidelines.md`. Check at the
MacBook window (1408x794) and the 1100x720 minimum. New tokens need Steve's
approval; propose names in the report.

| ID | Outcome wanted | What we know |
| --- | --- | --- |
| U1 | Export progress message, finished-count message and result list line up with the panel's left padding; at most one divider below. | `.batch-run-strip` has no horizontal padding; strip and Destination footer each draw a border; last result row adds another (`styles.css` ~9002/9107, `batch-export.js` ~310). |
| U2 | Clicking a field (including Export fields) and typing never shows a focus ring; Tab navigation still does. | Export ID rules outrank the mouse-focus rule (`styles.css` ~9055/9081); any keypress flips to keyboard mode (`appearance.js` ~41). |
| U3 | Header order: name, dot + Reset, Presets, eye. Presets always visible, close to the eye. Keyboard order follows. | `styles.css` ~6393, `visual-controls.css` ~63/291/378, `group-presets.js` ~36. |
| U4 | Full-screen review shows rating, pick and colour bottom-right, updating as photos change. | Full screen hides the caption and filmstrip (`photo-library.css` ~111); reuse the marks renderer (`library-culling.js` ~69). |
| U5 | The Windows custom maximize button shows a Restore icon when maximized, from any route (button, double-click, OS gesture). | State already arrives (`desktop-chrome.js` ~190); the image never changes (`index.html` ~95). Mac uses native buttons. |
| U6 | Right-click menu text is readable (14.5 px commands, smaller shortcut hints) and long menus stay on screen. | Library menus use 11 px (`styles.css` ~8389, `photo-library.css` ~197) and miss the desktop menu styling. |
| U7 | Right-click menus appear immediately and respond instantly to hover and click. | Photo menus wait for `/api/library/grade-reverts` (`photo-library.js` ~1100); Details rebuild runs first. Measure right-click to visible menu on the Neo, before and after. |
| U8 | The Frame menu fits on the MacBook Neo without scrolling in normal use. | Tall stacked layout, 85vh limit, no edge adjustment (`index.html` ~327, `photo-framing-ui.js` ~33). |
| U9 | Hovering pinned items, menu buttons and menu rows raises contrast with a background change, never a border, in every theme. | `--plate-up-hover` exists in all themes (`visual-tokens.css` ~275) but pinned rows do not use it (`photo-library.css` ~34). |
| U10 | Dragging a pinned item shows a line exactly where it will land. | Whole-row `.drag-target` highlight; before/after decided only on drop (`library-navigation.js` ~19/24). Keep photo-onto-folder moves separate. |
| U11 | Waiting on Steve to say which control. | Candidates: "Unpin folder" menu item and its confirmation (`photo-library.js` ~1871, `library-dialogs.js` ~22), or saved-location "Remove" (`media-browser.js` ~474). |
| U12 | Dock and Command-Tab show the current logo. | Installed `/Applications/HDR Finisher.app` icon already matches the repo; likely stale macOS icon cache or a development launch showing Electron's icon. Set the Dock icon in development; ship the PNG as a runtime resource. |
| U13 | Logo background corners less rounded; all copies agree. | Rounding is drawn in `desktop/assets/icon.svg` and `frontend/assets/brand/hdr-finisher-app-icon.svg`; `tools/regenerate-app-icon.cjs` needs Edge, so make it work on both machines. |

### W7: Larger interface work

| ID | Outcome wanted | What we know |
| --- | --- | --- |
| L1 | Every tooltip in every window appears after about 2.5 s of hover or focus, dismisses at once on click, Escape or leaving, and never doubles up. | Six mechanisms: shared JS tooltip at 600 ms (`workspace-layout.js` ~252), instant CSS toolbar tooltips plus native `title` (`visual-controls.css` ~519), 2 s CSS rules, native titles across Library/Export. The Library page does not load the shared controller. Update `docs/design/HDR_Finisher_Tooltip_Copy.md` timing. |
| L2 | A tooltip names a control only when its label is hidden; explanations and warnings stay; full text only when clipped. | Item list in the tooltip review: Overlays, Frame, Export list buttons, Compare/Focus, Settings/Help, Activity, resize selection, names and metadata. |
| L3 | "Choose what to paste" reads in clear sections in the edit panel's order, with section checkboxes and authored names. | Dialog is in `grade-paste.js` ~138, schema in `library_paste.py` ~57/171; label generator exposes technical names (`library_paste.py` ~36). Keep safe defaults (no crop, lens or masks) and do not widen what is pasteable. |
| L4 | Open image uses the same thumbnail grid/list browser as Open folder, in a single-image mode. | Open image uses the older list browser (`media-browser.js` ~344); Open folder uses `library-folder-picker.js`. |
| L5 | Purple is the default accent everywhere from first paint; orange remains in Settings. | Orange default in `appearance.js` ~3, `application-preferences.js` ~4, `application-shell.js` ~28; old purple `#9b7bff` (commit `bf220721`). Derive strong/low shades with the current formulas. |

## Reporting

Each worker ends with: what changed, what was tested and the result,
any output change, anything left open, and the status lines to update
above. Plain language first, for Steve.
