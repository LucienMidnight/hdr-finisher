# Code map

Where things live after the October 8 modularization sprint. Read this before
searching the code. The [sprint PRD](../product/Codebase_Modularization_Sprint_PRD_2026-10-06.md)
records the moves and validation.

**Keep it current.** A commit that moves code between files, or adds or
removes a source file, updates the matching row here in the same commit.

For how the application works (data flow, session lifecycle, preview
scheduling) see [architecture](architecture.md). For testing rules see
`AGENTS.md` at the repository root.

## The three parts

| Part | Folder | Job |
|---|---|---|
| Backend | `codebase/backend/hdr_finisher/` | Python. Opens files, does the exact colour maths, exports, proofs. |
| Frontend | `codebase/frontend/` | The interface and the GPU preview, in plain JavaScript. |
| Desktop shell | `codebase/desktop/` | Electron windows tracked by role in `main.js`, with per-window bounds and display state; starts one shared backend. |

The same image maths exists twice on purpose: once in Python (the exact
reference used by export and Proof) and once in GPU shaders (the fast
preview). A change to how an adjustment looks usually touches both, and the
parity checks compare them.

## Backend

Open the file named for the thing you are changing. Most files are focused.

| Area | Files |
|---|---|
| Web API and startup | `main.py` (74 routes; 34 are under `/api/session`), `launcher.py`, `config.py`, `desktop_security.py`, `folder_picker.py` |
| Data shapes (every adjustment, mask and project field) | `models.py` |
| Opening files | `loader.py`, `raw_import.py`, `linear_dng.py`, `dng_color.py`, `dng_opcodes.py`, `gainmap_decoders.py`, `jpegxl.py`, `avif_info.py`, `metadata.py`, `import_jobs.py`, `media_browser.py`, `resource_preflight.py` |
| Colour | `color.py`, `color_context.py`, `sdr_gamut.py`, `analysis.py`, `source_luminance.py` |
| Global adjustments (the exact reference) | `adjustments.py`, `detail.py`, `finishing.py` (geometry and output finishing), `film_grain.py`, `denoise_adaptive.py` |
| Local adjustments and masks | `local_adjustments.py`, `mask_softness.py`, `mask_work.py` |
| SDR Match | `sdr_match.py`, `sdr_match_inputs.py`, `sdr_match_remote.py` |
| CPU preview, caches | `render_cache.py`, `cpu_strips.py`, `preview.py` |
| Scopes, overlays, peak | `scopes.py`, `overlay.py`, `peak_accuracy.py`, `peak_candidates.py` |
| Session and projects | `sessions.py`, `projects.py` |
| Export and proof | `exporters.py`, `proofing.py`, `hosting_probe.py`, `test_pattern.py` |
| Machine and tools | `capabilities.py`, `binaries.py`, `subprocess_utils.py`, `display_probe.py` |

The largest are `adjustments.py` and `main.py`. Neither
is in the sprint; see its section 9.

## Frontend today

### How the files connect

There is no build step. `index.html` loads scripts in a fixed order with
plain `<script>` tags. Focused modules publish objects on `window` and export
for Node where applicable. The feature files split from `app.js` share the
existing page scope: they still call one another and read the same `state`
and `els` objects. They do not introduce boundaries between features.

Feature functions load before `app-state.js`, whose initialization calls
some of their factories. `app-boot.js` holds startup and event wiring, while
`app.js` contains only the original startup calls. Renderer helpers load
before the renderer class; `gpu-param-layout.js` loads before every consumer
of the global shader positions. A new file needs a `<script>` line after
everything it uses when it loads.

### Focused modules

These already have one job each and can be read whole.

| Area | Files |
|---|---|
| Deciding what to render and when | `preview-scheduler.js`, `render-coordinator.js`, `tile-scheduler.js`, `viewport-request.js`, `latest-work-queue.js`, `preview-latency-controller.js`, `presentation-gate.js`, `whole-image-preview-pipe.js`, `graph-scale.js` |
| GPU memory | `gpu-allocator.js`, `gpu-budget.js` |
| Getting pixels to the GPU | `source-transport.js` |
| Masks | `mask-expression.js`, `mask-loader.js`, `mask-raster.js`, `mask-request-coordinator.js`, `gpu-brush-mask.js`, `gpu-mask-resample.js` |
| Geometry | `geometry-math.js`, `geometry-resample.js` |
| Scopes | `scope-analysis.js`, `scope-readback.js`, `scope-ui.js` |
| Shader source text | `webgpu-shaders.js` (mostly WGSL) |
| Application frame | `application-shell.js`, `desktop-chrome.js`, `app-dialog.js`, `status-manager.js`, `render-failure.js` |
| Projects and proofing | `project-io.js`, `proofing-ui.js` |

### Feature files

All files below are in `codebase/frontend/`. Search for a named function in
its feature file. Function bodies and shared state behavior were preserved
by the move. `bindEvents` and `markRefining` remain whole in their files.

| File | Holds | Key declarations |
|---|---|---|
| `app-state.js` | Constants, latitude presets, `state`, `els` | top of file, `const state`, `const els` |
| `app-boot.js` | Start-up and the wiring of page events | `boot`, `initializeGpuPreview`, `initializePreviewScheduler`, `bindEvents` |
| `viewer-status.js` | Preview quality tiers and what the viewer reports | `gpuPreviewEligible`, `deriveViewerState`, `acceptPresentation`, `markRefining` |
| `preview-pipeline.js` | Asking for a preview and showing the result; unseen-lane preparation stays on demand at explicit Full | `debouncePreview`, `queueGpuDraft`, `settlePreview`, `renderPreviewForLane`, `renderGpuDraft`, `applyPreviewUrl`, `invalidatePreview`, `clearPreviewCache` |
| `preview-sizing.js` | Choosing working resolution; region-of-interest follow-ups | `displayedLongEdge`, `interactiveScaleDecision`, `applyRoiPreview` |
| `peak-measurement.js` | Editing peak and highlight anchor | `exactScopePeakKey`, `measureExactScopePeak`, `scheduleExactHighlightAnchor` |
| `scope-requests.js` | Asking for scope data, GPU and CPU | `refreshScopes`, `runGpuScopeRequest`, `runScopeRequest` |
| `scope-drawing.js` | Drawing histogram, waveform, vectorscope; scope region | `drawHistogram`, `drawWaveform`, `activeScopeRegion` |
| `overlay-ui.js` | False colour and zebra | `requestLiveOverlay`, `refreshOverlay`, `renderFalseColorKey` |
| `workspace-layout.js` | Rails, dock, splitters, popovers | `initializeInstrumentShell`, `initSplitter`, `toggleOverlayPopover`, `activateDockTab` |
| `range-controls.js` | Sliders, typed values, snapping, readouts | `enhanceRangeControls`, `bindEditableValue`, `rangeSnapProfile`, `updateControlReadouts` |
| `adjustment-controls.js` | Reading a control, committing a value, reset and match between lanes | `resolveAdjustmentPath`, `commitAdjustmentValue`, `syncControlsFromState`, `resetControlGroup` |
| `highlight-controls.js` | Highlight compression panels | `normalizeHighlightCompressionControls`, `renderHighlightCompressionControls` |
| `group-presets.js` | Saved presets per control group | `groupPresetPaths`, `initializeGroupPresetControls` |
| `curve-editor.js` | Curves | `bindCurveEditor`, `drawCurveEditor`, `normalizeCurvePoints` |
| `tone-equalizer.js` | Tone equalizer | `bindToneEqualizerEditor`, `drawToneEqualizerEditor` |
| `denoise-ui.js` | Denoise panel | `loadDenoiseDocument`, `renderDenoiseControls`, `runLiveDenoise` |
| `color-wheels.js` | Colour wheels and vignette centre | `bindColorWheels`, `bindVignetteCenter` |
| `geometry-tools.js` | Crop, perspective, straighten, rotate | `bindCropEditor`, `bindPerspectiveEditor`, `beginStraightenGesture`, `rotateGeometry` |
| `lanes-compare.js` | Switching HDR/SDR, compare views | `switchLane`, `bindCompareControl`, `renderComparisonPreview` |
| `zoom-navigation.js` | Zoom, pan, navigation thumbnail | `setZoomMode`, `applyZoomGeometry`, `refreshNavigationThumbnail` |
| `session-import.js` | Import, upload, eject, source interpretation, raw settings | `uploadFile`, `ejectCurrentSession`, `syncInterpretationControls`, `renderRawImportControls` |
| `project-documents.js` | Open, save, unsaved-changes prompts, desktop file open | `openDesktopSelection`, `openProjectFromPath`, `saveProjectToPath` |
| `media-browser.js` | The file browser | `openMediaBrowser`, `renderMediaBrowserEntries`, `loadMediaDirectory` |
| `export-ui.js` | Export sheet, presets, format cards | `seedExportFieldsFromSession`, `exportCurrentSession`, `renderCapabilities`, `applyExportPreset` |
| `info-panels.js` | Metadata, technical summary, capability readouts | `renderMetadata`, `technicalSummaryEntries`, `renderPresentationCapability` |
| `desktop-commands.js` | Menu commands, shortcuts, preferences from the shell | `initializeDesktopBridge`, `applicationCommands`, `applyGpuMemoryBudget` |
| `local-adjustments-ui.js` | The list of local adjustments and their grade controls | `defaultLocalGrade`, `bindLocalAdjustmentEvents`, `renderLocalAdjustments` |
| `mask-controls.js` | Mask tree editor and per-mask panels | `renderMaskTreeEditor`, `renderPathControls`, `createLuminanceRangeControl` |
| `mask-gestures.js` | Pointer work on the mask canvas | `bindLocalMaskCanvas`, `updateGradientGesture`, `pathTargetAtPointer`, `handlePathCanvasKeydown` |
| `path-geometry.js` | Path and feather maths (no page access) | `activePathNodes`, `uniformFeatherNodes`, `flattenPathNodes`, `validPathGeometry`, `splitPathSegment` |
| `mask-overlay.js` | Drawing masks and gizmos over the image | `renderLocalMaskOverlay`, `drawMaskExpression`, `drawBrushMaskOverlay`, `drawPathMaskGizmo` |
| `sdr-match-ui.js` | SDR Match | `setSdrMatch`, `serveSdrMatchCandidates`, `presentMatchedSdrPreview` |
| `edit-commands.js` | Sending edits to the backend in order | `queueEditCommand`, `syncGlobalEditState`, `refreshEditState` |

### Renderer and standalone helpers

| File | Holds | Key declarations |
|---|---|---|
| `gpu-render-plan.js` | Deciding direct or tiled rendering, memory estimates, tile halos. No GPU access. | `buildRenderPlan`, `buildTiledPlan`, `directPreviewMemoryModel`, `detailTileHalo` |
| `gpu-params.js` | Turning the project's adjustments into the numbers the shaders read. No GPU access. | `buildParams`, `buildCurves`, `buildLocalParams`, `rgbPrimariesAdjustmentMatrix` |
| `webgpu-preview.js` | The renderer itself | `class HDRWebGPUPreview` |

Inside the class, these groups are candidates for a later split and are worth
knowing when searching: memory budget and cache (`setMemoryBudget` to
`evictGpuCacheEntry`), editing peak and highlight anchor
(`rankEditingPeakCandidates` to `scheduleHighlightMeasurement`), tiled
rendering (`ensureTileGraph` to `encodeTiledGeneration`), GPU masks
(`resamplePlan` to `trimMaskTiles`, and `loadGpuAnalyticLeaf` to
`destroyLocalMaskEntry`), denoise (`selectedDenoiseSource` to
`destroyDenoiseSelector`), source loading (`sourceAbortSignal` to
`loadProxy`), Clarity maps (`clarityMapTextures` to
`measurementClaritySurround`).

### Settings sent to the shaders

`codebase/frontend/gpu-param-layout.js` is the single list of all 190
names and positions. `gpu-params.js`, `gpu-render-plan.js`, the renderer and
`graph-scale.js` take their positions from it. `webgpu-shaders.js` inserts
those same positions when constructing WGSL, so the generated shaders keep
their original text. `tests/gpu-param-layout.test.js` checks the original
positions, load order, bare global positions and writer/consumer agreement.
Four reserved entries keep their positions; `DETAIL_ENABLED` is consumed by
host-side graph routing rather than by a shader. Phase 4's validation is
recorded in the sprint PRD.

Local grades retain their separate 23-slot prefix and reuse the global
positions at the tail. `gpu-param-layout.js` now also defines those prefix
slots and every analytic, brush and resampling mask pass record, including
variable-length path/stroke/segment records and regional tails. Their writers
use named entries; WGSL takes numeric positions and strides from the same
frozen definitions. `tests/gpu-pass-layout.test.js` checks the unchanged
positions, actual writer/shader-reader agreement and missing-use controls.
The test source resolvers in `frontend-source.js` and `frontend_source.py`
resolve both global and pass names through the production definitions.

## Which checks cover what

All in `codebase/tests/`. Rules for how much to run are in `AGENTS.md`.
Desktop checks live in `codebase/desktop/tests/`; their smoke test reads the
scripts loaded by the page so feature moves keep its assertions intact.

| Kind | Files | Speed |
|---|---|---|
| Frontend unit tests | `*.test.js` | Seconds. Run on every change. |
| Backend tests | `test_*.py` | About a minute. Run on every change. |
| GPU checks in the real app | other `*.js`, run one at a time through `run-in-electron.js` | Slow. Run only the one or two that cover the change. |
| Timing and review drivers | `performance/` | Slow. Release points only. |

Finding the right GPU check: they are named for the feature, such as
`curve-editor-interaction.js`, `perspective-interaction.js`,
`brush-mask-interaction.js`, `gpu-scope-parity.js`, `tiled-direct-parity.js`,
`sdr-match-gpu-interaction.js`, `denoise-adaptive-parity.js`.

Two kinds of test read source code as text. Since the sprint's phase 1
(October 7, 2026) neither depends on which frontend file the code is in:

- `test_frontend_*_contract.py` and `test_preview_resolution_contract.py`
  check page structure and styles, and pin numbers, limits and shader maths
  as text. They read frontend scripts through `tests/frontend_source.py`,
  which searches every script `index.html` loads.
- Some `*.test.js` files lift a function out of the frontend and run it,
  because `app.js` cannot be loaded outside the page. They ask for it by name
  through `tests/frontend-source.js`.

A new frontend file is picked up by both once it has its `<script>` line in
`index.html`. The renderer helper files and position list are already in
`PARTS` in
`tests/frontend-source.js`. Existing source pins resolve named global
positions through the production list; the new layout guard audits raw
production sources and compiled shader readers.

### Photo Library foundation (F1)

`desktop/main.js` tracks windows in `windows`, keyed by role (`main`, `library`).
Main owns the document and app lifetime; closing a secondary closes only that
window. Photo/document/menu commands still target main. Window controls and
display IPC resolve the registered sender, and secondary windows cannot invoke
main-only photo commands. Bounds persist separately in `window-state.json`
and `window-state-library.json`. Display notifications use per-window timers.

For development only, set `HDR_FINISHER_DEV_LIBRARY_WINDOW=1` before starting
Electron. The second window loads `frontend/window-foundation.html` and
`window-foundation.js` from the same backend, without any editor scripts.
It has native window controls (including snap); F11 toggles full screen.
`desktop/tests/multi-window.js` checks the second page, IPC isolation, display
selection, window controls, both closing rules, persistence and relaunch, and
normal single-window startup. Moving between physical monitors and Windows
snap still need Steve's manual trial.

### Photo Library foundation (F2): leaving the current photo

`frontend/photo-transition.js` owns `leaveCurrentPhoto`, shared by the editor
and Electron (`desktop/main.js`). The desktop bundle includes this same file
under `shared/`, with no second policy implementation. The existing renderer
adapter `confirmUnsavedTransition` supplies the prompt and save callbacks.

Routes: desktop source picker and drag/drop/Explorer source opens via
`openDesktopSelection`; browser file input and byte drops via `importByteFile`
and `uploadFile` (including its ownership recheck); project picker, menu,
shortcut and Explorer/second-instance project opens via `openProjectFromPath`;
eject via `ejectCurrentSession`; test-pattern replacement via `app-boot.js`;
main-window close and app Quit via `requestClose`; Windows shutdown/restart/
sign-out via the synchronous `systemExit` mode. The existing post-save close
continuation stays in `desktop:set-document-state`. RAW re-development keeps
the photo and grade and continues without a leave-photo prompt. Secondary
window close does not leave a photo. Browser tab close/reload has no custom
prompt today and remains unchanged. Undo, redo and grade reset edit the current
photo instead of leaving it. Prompt wording and Save/Discard/Cancel remain as
before; cancelled or unsuccessful saves do not pass the gate.

### Photo Library foundation (F3): library helper

`backend/hdr_finisher/library_worker.py` owns a spawned, low-priority process
with one thumbnail decoder and a bounded priority queue. `main.py` starts and
stops it with the server lifespan and injects it into `MediaBrowserStore`.
The original cache keys, thumbnail pixels and file-browser API stay intact.
Import previews also use the helper; cancelling an import cancels its helper
job. The child uses the existing thumbnail decoder and cache, while the grading
process only checks the cache and submits jobs. `run_app.py` calls
`multiprocessing.freeze_support()` before app imports for PyInstaller.

`/api/library-worker/status` and `/api/library-worker/pause` are backend
commands. Separate pause reasons do not release one another. Session requests
hold a temporary pause around grading/import/export work without changing any
image processing implementation. Disconnecting a thumbnail request cancels
its job. Paused uncached HTTP requests return 202 and the browser retries;
holding them open would exhaust browser connections and prevent grading.
Cached thumbnails remain available. A running native decode is cooperative:
it may finish, but a cancelled result is discarded and no next decode starts
while paused. Helper failure fails pending jobs; grading does not fall back to
decoding those thumbnails in its own process. The child also watches its parent.

`tests/test_library_worker.py` covers separate-process decode, priorities,
pause ownership, cancellation, failure, shutdown and paused HTTP retries.
`tests/library-background-interaction.js` checks queued thumbnail requests,
grade rendering during a pause and concurrent thumbnail/grade work in Electron.
Packaged-app confirmation waits for the next requested installer build; Steve's
large-folder grading trial is still the perceptual performance check (M5).
