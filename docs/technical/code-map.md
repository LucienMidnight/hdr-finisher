# Code map

Where things live, and where they are going. Read this before searching the
code. Written October 6, 2026 at commit `39d3735`; line counts and function
names are from that commit.

This page does two jobs:

1. **Today's map.** Which file to open for a given kind of change, and which
   checks cover it.
2. **Target layout.** How the two oversized frontend files will be divided.
   The plan is in the
   [Codebase Modularization Sprint](../product/Codebase_Modularization_Sprint_PRD_2026-10-06.md).

**Keep it current.** A commit that moves code between files, or adds or
removes a source file, updates the matching row here in the same commit.

For how the application works (data flow, session lifecycle, preview
scheduling) see [architecture](architecture.md). For testing rules see
`AGENTS.md` at the repository root.

## The three parts

| Part | Folder | Size | Job |
|---|---|---|---|
| Backend | `codebase/backend/hdr_finisher/` | 52 files, about 27,700 lines | Python. Opens files, does the exact colour maths, exports, proofs. |
| Frontend | `codebase/frontend/` | 34 files, about 51,000 lines | The interface and the GPU preview, in plain JavaScript. |
| Desktop shell | `codebase/desktop/` | 10 files, about 1,600 lines | Electron window that hosts the frontend and starts the backend. |

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

The largest are `adjustments.py` (2,681 lines) and `main.py` (2,361). Neither
is in the sprint; see its section 9.

## Frontend today

### How the files connect

There is no build step. `index.html` loads every script in a fixed order with
plain `<script>` tags (the list is at the bottom of the file). Each small
module wraps itself in a function, publishes one object on `window`
(`window.HDRViewportRequest`, for example) and also exports it for Node so a
unit test can load it directly. `app.js` loads near the end and picks those
objects up.

A new frontend file therefore needs a `<script>` line in `index.html`, placed
after everything it uses when it loads.

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
| Shader source text | `webgpu-shaders.js` (2,856 lines, almost all shader code) |
| Application frame | `application-shell.js`, `desktop-chrome.js`, `app-dialog.js`, `status-manager.js`, `render-failure.js` |
| Projects and proofing | `project-io.js`, `proofing-ui.js` |

### The two oversized files

**`app.js`, 19,176 lines.** 744 functions in one shared space. They all read
and write one `state` object (about 220 fields) and one `els` object (the
page's elements), and call each other freely. Two functions are about 600
lines each: `bindEvents` and `markRefining`.

**`webgpu-preview.js`, 9,521 lines.** About 1,400 lines of standalone helper
functions at the top and bottom, and between them one class,
`HDRWebGPUPreview`, of about 8,000 lines and 180 methods. Its two largest
methods are `encodeTiledGeneration` (1,065 lines) and `renderTo` (789).

`styles.css` (9,111 lines) and `index.html` (1,825) are also large. They are
not in the sprint.

## Target layout

The names below are the agreed boundaries. A thread doing part of the split
uses these, or changes this table first and says why.

### `app.js`

"Find it today" names the first function of each cluster; search for it.
Clusters are mostly contiguous, but some areas sit in two or three places.

| Target file | Holds | Find it today (first functions) |
|---|---|---|
| `app-state.js` | Constants, latitude presets, `state`, `els` | top of file, `const state`, `const els` |
| `app-boot.js` | Start-up and the wiring of page events | `boot`, `initializeGpuPreview`, `initializePreviewScheduler`, `bindEvents` |
| `viewer-status.js` | Preview quality tiers and what the viewer reports | `gpuPreviewEligible`, `deriveViewerState`, `acceptPresentation`, `markRefining` |
| `preview-pipeline.js` | Asking for a preview and showing the result | `debouncePreview`, `queueGpuDraft`, `settlePreview`, `renderPreviewForLane`, `renderGpuDraft`, `applyPreviewUrl`, `invalidatePreview`, `clearPreviewCache` |
| `preview-sizing.js` | Choosing working resolution; region-of-interest follow-ups | `displayedLongEdge`, `interactiveScaleDecision`, `applyRoiPreview` |
| `peak-measurement.js` | Editing peak and highlight anchor | `exactScopePeakKey`, `measureExactScopePeak`, `scheduleExactHighlightAnchor` |
| `scope-requests.js` | Asking for scope data, GPU and CPU | `refreshScopes`, `runGpuScopeRequest`, `runScopeRequest` |
| `scope-drawing.js` | Drawing histogram, waveform, vectorscope; scope region | `drawHistogram`, `drawWaveform`, `activeScopeRegion` |
| `overlay-ui.js` | False colour and zebra | `requestLiveOverlay`, `refreshOverlay`, `renderFalseColorKey` |
| `workspace-layout.js` | Rails, dock, splitters, popovers | `initializeInstrumentShell`, `initSplitter`, `toggleOverlayPopover`, `activateDockTab` |
| `range-controls.js` | Sliders, typed values, snapping, readouts | `enhanceRangeControls`, `bindEditableValue`, `rangeSnapProfile`, `updateControlReadouts` |
| `adjustment-controls.js` | Reading a control, committing a value, reset and match between lanes | `resolveAdjustmentPath`, `commitAdjustmentValue`, `syncControlsFromState`, `resetControlGroup` |
| `highlight-controls.js` | Highlight compression panels | `codebase/frontend/highlight-controls.js` (moved October 8); `normalizeHighlightCompressionControls`, `renderHighlightCompressionControls` |
| `group-presets.js` | Saved presets per control group | `codebase/frontend/group-presets.js` (moved October 8); `groupPresetPaths`, `initializeGroupPresetControls` |
| `curve-editor.js` | Curves; moved October 8 | `codebase/frontend/curve-editor.js`: `bindCurveEditor`, `drawCurveEditor`, `normalizeCurvePoints` |
| `tone-equalizer.js` | Tone equalizer | `codebase/frontend/tone-equalizer.js` (moved October 8); `bindToneEqualizerEditor`, `drawToneEqualizerEditor` |
| `denoise-ui.js` | Denoise panel | `codebase/frontend/denoise-ui.js` (moved October 8); `loadDenoiseDocument`, `renderDenoiseControls`, `runLiveDenoise` |
| `color-wheels.js` | Colour wheels and vignette centre | `codebase/frontend/color-wheels.js` (moved October 8); `bindColorWheels`, `bindVignetteCenter` |
| `geometry-tools.js` | Crop, perspective, straighten, rotate | `codebase/frontend/geometry-tools.js` (moved October 8); `bindCropEditor`, `bindPerspectiveEditor`, `beginStraightenGesture`, `rotateGeometry` |
| `lanes-compare.js` | Switching HDR/SDR, compare views | `codebase/frontend/lanes-compare.js` (moved October 8); `switchLane`, `bindCompareControl`, `renderComparisonPreview` |
| `zoom-navigation.js` | Zoom, pan, navigation thumbnail | `codebase/frontend/zoom-navigation.js` (moved October 8); `setZoomMode`, `applyZoomGeometry`, `refreshNavigationThumbnail` |
| `session-import.js` | Import, upload, eject, source interpretation, raw settings | `codebase/frontend/session-import.js` (moved October 8); `uploadFile`, `ejectCurrentSession`, `syncInterpretationControls`, `renderRawImportControls` |
| `project-documents.js` | Open, save, unsaved-changes prompts, desktop file open | `codebase/frontend/project-documents.js` (moved October 8); `openDesktopSelection`, `openProjectFromPath`, `saveProjectToPath` |
| `media-browser.js` | The file browser | `codebase/frontend/media-browser.js` (moved October 8); `openMediaBrowser`, `renderMediaBrowserEntries`, `loadMediaDirectory` |
| `export-ui.js` | Export sheet, presets, format cards | `codebase/frontend/export-ui.js` (moved October 8); `seedExportFieldsFromSession`, `exportCurrentSession`, `renderCapabilities`, `applyExportPreset` |
| `info-panels.js` | Metadata, technical summary, capability readouts | `codebase/frontend/info-panels.js` (moved October 8); `renderMetadata`, `technicalSummaryEntries`, `renderPresentationCapability` |
| `desktop-commands.js` | Menu commands, shortcuts, preferences from the shell | `codebase/frontend/desktop-commands.js` (moved October 8); `initializeDesktopBridge`, `applicationCommands`, `applyGpuMemoryBudget` |
| `local-adjustments-ui.js` | The list of local adjustments and their grade controls | `codebase/frontend/local-adjustments-ui.js` (moved October 8); `defaultLocalGrade`, `bindLocalAdjustmentEvents`, `renderLocalAdjustments` |
| `mask-controls.js` | Mask tree editor and per-mask panels | `codebase/frontend/mask-controls.js` (moved October 8); `renderMaskTreeEditor`, `renderPathControls`, `createLuminanceRangeControl` |
| `mask-gestures.js` | Pointer work on the mask canvas | `codebase/frontend/mask-gestures.js` (moved October 8); `bindLocalMaskCanvas`, `updateGradientGesture`, `pathTargetAtPointer`, `handlePathCanvasKeydown` |
| `path-geometry.js` | Path and feather maths (no page access); moved October 8 | `codebase/frontend/path-geometry.js`: `activePathNodes`, `uniformFeatherNodes`, `flattenPathNodes`, `validPathGeometry`, `splitPathSegment` |
| `mask-overlay.js` | Drawing masks and gizmos over the image | `codebase/frontend/mask-overlay.js` (moved October 8); `renderLocalMaskOverlay`, `drawMaskExpression`, `drawBrushMaskOverlay`, `drawPathMaskGizmo` |
| `sdr-match-ui.js` | SDR Match | `codebase/frontend/sdr-match-ui.js` (moved October 8); `setSdrMatch`, `serveSdrMatchCandidates`, `presentMatchedSdrPreview` |
| `edit-commands.js` | Sending edits to the backend in order | `codebase/frontend/edit-commands.js` (moved October 8); `queueEditCommand`, `syncGlobalEditState`, `refreshEditState` |

### `webgpu-preview.js`

| Target file | Holds | Find it today |
|---|---|---|
| `gpu-render-plan.js` | Deciding direct or tiled rendering, memory estimates, tile halos. No GPU access. | functions above `class HDRWebGPUPreview`: `buildRenderPlan`, `buildTiledPlan`, `directPreviewMemoryModel`, `detailTileHalo` |
| `gpu-params.js` | Turning the project's adjustments into the numbers the shaders read. No GPU access. | functions below the class: `buildParams`, `buildCurves`, `buildLocalParams`, `rgbPrimariesAdjustmentMatrix` |
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

The renderer hands the shaders one list of 190 numbers. Slot 2 is exposure,
slot 10 is white balance, and so on. `buildParams` writes them by number and
the shaders read them by number (`p[10]`), about 450 times; 14 slots have
names. Adding or moving a slot means changing both sides by hand, and a
mismatch gives a wrong image with no error. Until the sprint's phase 4 lands,
treat any change here as strict-testing work.

## Which checks cover what

All in `codebase/tests/`. Rules for how much to run are in `AGENTS.md`.

| Kind | Files | Speed |
|---|---|---|
| Frontend unit tests | `*.test.js` (57) | Seconds. Run on every change. |
| Backend tests | `test_*.py` (83) | About a minute. Run on every change. |
| GPU checks in the real app | other `*.js` (84), run one at a time through `run-in-electron.js` | Slow. Run only the one or two that cover the change. |
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
`index.html`. When `webgpu-preview.js` is divided, add the new files to
`PARTS` in `tests/frontend-source.js`.
