# Paste into the next thread

Continue post-testing fixes for Viewport-Bounded GPU Preview in HDR Finisher. Steve is testing the app by hand and reporting what feels slow or wrong; fix what he finds, measure before and after, and keep him informed in plain language (he is the owner, not a coder).

Workspace: `D:\AI\AI Projects\HDR Finisher Tool`. Git root: `ai`; executable/test cwd: `ai\codebase`. Branch: `viewport-bounded-preview-phase-2-wip`. Verify HEAD and status first; do not reset.

- Pushed: `e6dbae2` (source-space masks, Peak under straighten, windowed straighten source), `7c7c821` (index-geometry combinations on the GPU, coverage audit harness), `369ffe1` (PRD section 15 register).
- **Local, not pushed:** `58bf0de` (backend keeps in-use source levels in memory), `91e4a12` (stale tiles after zoom, stepped sub-100% processing sizes, wide Shift regions halved), and the commit that adds this file. Ask Steve before pushing.

Read first, relative to the git root:
- `docs/product/Viewport_Bounded_GPU_Preview_PRD_2026-10-01.md` sections 14.23, 14.24 and 15 (the deferred, accepted and known-limit register).
- `docs/technical/viewport-phase3-coverage-endurance-evidence-2026-10-03.md` and `viewport-phase3-source-space-mask-evidence-2026-10-03.md`.

## Next steps, in order

### 1. Denoise noise model from sample windows only

`GET /api/session/{id}/denoise-model/{kind}` (`backend/hdr_finisher/main.py`) calls `render_cache.geometry_source_proxy`, which runs `apply_geometry` on the whole frame, then `denoise_adaptive.estimate_adaptive_model`. The model only reads sample windows (`_sample_tiles`, `_measure_model`, `_energy_tails` in `denoise_adaptive.py`). Fetch just those windows with `apply_geometry_region` (now windowed for straighten and perspective) instead of correcting the whole image. The result must be the same model within float tolerance; add a fast Python test that proves it against the whole-frame path. Do not touch the Denoise shader (byte-pinned).

Measured in Steve's session (42 MP, strong perspective): 4.6 s at full size, 1.7 s at 2,817, 1.6 s at 1,003. It is requested at every size, not only when zoomed in, whenever Denoise first needs that size or the geometry changes.

Not in this step, and Steve has not decided on it: Denoise still uploads the whole full-resolution image to the GPU (`analyzeDenoiseProxy` in `webgpu-preview.js` calls `loadProxy` for the whole frame; 3.5 s, about 340 MB in his session). Making Denoise viewport-bounded is a separate, larger piece of work.

### 2. Perspective: slow zoom to 63% and the picture shifting by itself

Steve's report, Denoise off, strong perspective: zoom out, then zoom in to about 63%. It takes a couple of seconds, and at the end the picture shifts as if panning by itself.

Check first whether the shift is a regression from `91e4a12`. That commit made magnified views below 100% process at fixed sizes (`steppedProcessingLongEdge` in `frontend/app.js`), so at 63% the processed frame (source long edge divided by the square root of two) is larger than the displayed size, where before the two were equal. Anything that maps scroll position or zoom anchor to frame pixels and assumed they were equal below 100% is suspect: `visibleOutputRect`, `setCustomZoom`, `applyZoomGeometry`, the canvas CSS size, and the coordinator's viewport. Reproduce with and without that change. Note `preview-export-compare.js --zoom 79` passed, so the pixels are right once settled; this is about placement during the transition.

Also in the same session: `POST /geometry-map` took 2.5 s after a perspective change. It runs coordinate ramps through the real geometry operation (`geometry_coordinate_map` in `finishing.py`). Find out at what size it is called and why it is slow.

Then profile the zoom itself under strong perspective (see tools below) and split it into source fetch, masks, render and scopes before changing anything.

### 3. Housekeeping owed

- The PRD and evidence do not yet record the post-testing fixes (`58bf0de`, `91e4a12`) or the Denoise finding. Add a section 14.25 and update section 15: Denoise is not viewport-bounded and was not in the coverage audit (its controls have no `data-path`, which is how the audit finds controls).
- The installer in `codebase/dist-electron` was built at `58bf0de`; it lacks `91e4a12`. Rebuild with `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/build_desktop.ps1` run from Git Bash (redirecting output inside PowerShell 5.1 breaks it).
- The coverage audit and the 30-minute endurance run have not been repeated since `7c7c821`.
- `desktop` smoke test (`npm run test:packaged`, `npm run test:integration`) fails waiting for a "Project saved" badge; the save works but the message is not shown. It fails the same way at `05207b5`, so it predates this work. Not investigated.

## What Steve's testing found and what was fixed (context)

His file: `DSC00264.ARW`, 5320 x 7968 (42 MP), straighten about 1, perspective horizontal about -30, vertical about -17 to -22, perspective rotate about -1 to -3; locals at one point: luminance range (Feather 0.004), linear gradient, brush (Feather 0.006, Shift Edge 0.019), path.

| Symptom | Cause | Fix |
|---|---|---|
| Zoom and pan slow below 100% | Each sub-100% size is a resized copy of the whole source; one over 256 MiB was never kept in memory and was re-read from disk per request | `58bf0de`: the two most recent levels stay resident |
| Seconds per zoom at arbitrary wheel percentages | Every percentage built its own copy and its own masks (98.3% built a copy barely smaller than the source) | `91e4a12`: fixed processing sizes below 100% |
| A blurry tile that never resolved while the app said ready | The view moved while the zoom pass rendered and the pan follow-up was dropped | `91e4a12`: coordinator re-arms the pan pass |
| Multi-second waits with a large Shift Edge | Shift halo around a large view exceeded the scratch cap and the mask went to CPU tiles | `91e4a12`: the region is halved until accepted |
| About 11 s on zoom with Denoise on | Whole-image noise model plus whole-image upload | Open: step 1 above, and the undecided larger piece |

Measured on the primary fixture after the fixes (36 MP, straighten 2, perspective -20, Shift Edge 0.019, an edit before each zoom): zoom back in to 78.9% 0.8 s (was 5.5 s); pans 0.55-0.95 s; first zoom to a new size 1.5-1.9 s. Still open: pans under straighten/perspective are almost all backend resampling of the newly exposed strip; a zoom back in after any edit re-fetches source pixels (about 0.45 s against 0.08 s with no edit).

## Tools added

- **Live monitor.** Start a window Steve can use with `node_modules/.bin/electron . --remote-debugging-port=9333` from `codebase/desktop` (the app is single-instance, so his other window must be closed first). Then `node tests/performance/live-monitor.js install` to start recording and `node tests/performance/live-monitor.js dump 90` when he says "issue". It reports requests and their times, each zoom or pan and the time to the next exact frame, mask events, geometry, locals, Denoise state and memory. Dumps are saved under `codebase/output/performance/review/live-monitor/`. It only reads.
- **Zoom-cycle profile.** `node tests/run-in-electron.js tests/performance/zoom-cycle-profile.js --project <file> --geometry straighten_angle=2,perspective_vertical=-20 --shift-edge 0.019 --edit-between --zooms fit,78.878,fit,63.3,98.288 --pans 2 --output <json>`.
- **Coverage audit.** `tests/performance/phase3-coverage-audit.js` (see the coverage evidence). It does not cover Denoise.
- `preview-export-compare.js` gained `--luma-graph-operator`, `--luma-graph-operand`; `--zoom 79` works now that sub-100% views process at native.

## How Steve wants the work run

- Batch related changes; build on the fast checks, then run slow Electron/GPU checks once, serialized through `tests/run-in-electron.js` with `HDR_FINISHER_ELECTRON_WINDOW_SIZE=2560x1440`. Never overlap GPU tests. They can run while his own window is open.
- Fast checks: `node --test tests/*.test.js` (417 pass); Python with `codebase/.venv/Scripts/python.exe -m pytest tests -q` (1,659 pass, three skipped; the system Python fails one test spuriously).
- Explain decisions one at a time, in plain language, with trade-offs. Report what did not meet target rather than rounding it up.
- Never save over the read-only fixtures; verify SHA-256 after GPU tests:
  - Primary `D:\Photos\Play_Raw\Fantastic light over village - AdamFromCanada\DSC00950.hdrfinisher` `246ba308dcba22c5483c32ed4c31f5c81a2804504cd01dec2482b6d5be307d56`
  - Four-mask `ai\codebase\local-test-media\viewport\DSC00264-four-masks.hdrfinisher` `3004b621783d77d7fefee6a1997392e1599954ab845b833208841fab1f4d1825`
  - Fifty-local `ai\codebase\local-test-media\viewport\DSC00264-fifty-locals.hdrfinisher` `00913f3d8214a211ff74d0791b5393dddf06c861e57994517354aa1a88e6acee`
- Preserve: Peak and Denoise shader byte pins; the 4,194,304-pixel editing-Peak budget; exact CPU export and Proof; classifier limits and tolerances; the deferrals and acceptances in PRD section 15. Phase 3 is not declared closed; no phase 4 work. Commit locally when a fix is validated; ask before pushing.
- Patch scripts: write them with the Write tool, not shell heredocs containing apostrophes. Several source files have mixed line endings and some tests match `\n` literally; write edited files with LF.
