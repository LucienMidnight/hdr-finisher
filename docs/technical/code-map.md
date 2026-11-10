# Code map

Where things live after the October 8 modularization sprint. Read this before
searching the code. The [sprint PRD](../product/archive/Codebase_Modularization_Sprint_PRD_2026-10-06.md)
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
| Library reduced sources (phase 3c) | `library_reduced.py` (JPEG DCT, sequential PNG/TIFF, direct Pillow orientation/ICC handoff without PNG re-encoding, bounded uncompressed row reads); `library_rgb.py`, `library_dng_linear.py`, `library_live.py` select reduced Library routes; full Grade/Proof/export loaders remain default |
| Grade-to-Library saved-picture hand-off (Batch 4b checkpoint) | `grade-library-pictures.js` captures the current presented full frame after saving, including a bounded Grade scope picture for tiled Fit; `library_grade_pictures.py` publishes thumbnails before deferred screen compression (the original upload slot remains held until completion), and loans the already developed Grade source. `photo-library.js` replaces tiles atomically and keeps completed tiles across Grade navigation. `desktop/library-grade-picture-check.cjs` compares actual Electron grid, filmstrip and stored-screen screenshots in HDR/SDR for two photos; popped-out checks run separately. Capture latency remains open; Windows memory acceptance passed November 5. |
| Finished Library thumbnail redisplay | `library_finished_thumbnails.py` (local indexed identity, exact surface storage and batched transfer); `library-finished-thumbnails.js` (GPU capture/restore), wired through `library_screen_previews.py`, `library-gpu.js`, `photo-library.js` |
| Live app memory setting (phase 3c) | `app_memory.py` (options/configure), `library_api.py` memory-setting endpoints, `library_scheduler.py` live ceiling/giant waits, `application-shell.js` and desktop application preferences |
| Library RAM scheduling (phase 3a) | `library_scheduler.py` (priority, floor, reserve, owner cleanup), `library_estimates.py` (header dimensions and approved rates), `library_grants.py` (WebSocket channel, Grade accounting, backend waits); frontend `library-grants.js` (one channel per window, cancellation, reconnect) |
| Machine and tools | `capabilities.py`, `binaries.py`, `subprocess_utils.py`, `display_probe.py`; `tools/jpegxl-info/` builds the structured libjxl DATA/ORIGINAL metadata helper used by `jpegxl.py` (Windows executable, DLLs and licences in `bin/`) |

The largest are `adjustments.py` and `main.py`. Neither
is in the sprint; see its section 9.

## Frontend today

The v1 appearance layer lives in `visual-tokens.css` (four neutral theme palettes, material faces, geometry and local font faces), `visual-controls.css` (skins on existing structures), and `appearance.js` (accent normalization, derived ramp and theme redraw). `theme-startup.js` applies it before first paint; `application-shell.js`, desktop application preferences and Library window messages persist/synchronize the accent. `range-controls.js` draws fine/snap hover markings without changing the interaction profiles. `tools/v1-visual-review.cjs` takes the focused real-Electron review captures.

Library browsing uses camera pictures for unedited RAWs and develops only visible
photos that need it, zoom detail, or explicit Develop/Build previews selections.
The former `library-read-ahead.js` module and scene idle warmer were removed
in Batch 4a; finished neighbour surfaces may still be retained.

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
| Application frame | `application-shell.js`, `desktop-chrome.js`, `app-dialog.js`, `status-manager.js`, `key-hints.js` (status bar tool key hints), `render-failure.js` |
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

### Native AVIF rendition helper

`codebase/tools/avif-rendition-decode/decode.cpp` preserves libavif's exact
10-bit YUV/16-bit RGB gain-map reconstruction boundary. `parallel_gainmap.py`
patches independent reconstruction rows; `low_memory_decode.py` opts only
the helper process into AOM tile-only threading. It copies decoded base/map
planes before releasing the decoder. Rebuild/copy the matching `avif.dll`
and helper together; the tool README pins versions and build flags.

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

### Photo Library foundation (F4): independent browser

`frontend/media-browser.js` exposes `HDRMediaBrowser.create` with a DOM root,
backend address and callbacks. Each instance owns its selection, requests,
sorting and resize state. It queries elements only inside its root and binds
its own events. Closing cancels its preview and invalidates pending listings.
The editor adapter, `media-browser-editor.js`, supplies source/project grants,
open/save callbacks, export destination updates and editor status reporting.
It is loaded after `app-state.js`; `app-boot.js` only calls `bindEvents()`.
The old browser fields and element bindings are removed from editor state.

`media-browser-standalone.html` reuses the existing browser markup/styles and
loads only the browser and its standalone boot script. In development, set
`HDR_FINISHER_DEV_LIBRARY_BROWSER=1` to show it in the F1 secondary window.
The earlier `HDR_FINISHER_DEV_LIBRARY_WINDOW=1` still opens the empty F1 page.
Normal startup still opens only Grade. This is a foundation prototype, not
the library wireframe or a new product layout.

The library's `desktop:open-source-in-main` IPC validates its registered
sender, grants the path through the backend and sends an open request to
Grade. Grade owns the single F2 unsaved-changes gate. The library cannot
change Grade's document state or call its editor-only IPC. The existing
backend commands still own browsing, pinned folders and recent imports.

`desktop/tests/standalone-browser.js` covers the actual standalone thumbnail,
absence of editor scripts/globals, source handoff with Cancel/Discard, main
export/project destination selection and independent secondary close.

### Photo Library slice 3 Stage A: grades beside photos

`backend/hdr_finisher/library_grades.py` owns per-photo baseline comparison,
queued grades, paused conflicts, unsaved recovery and the retained unchosen
grade. `library_grade_api.py` provides attach/save/check/resolve/load/recovery
commands. `photo_grades` is added to the existing Library database without
replacing marks or album rows. Session edit observers retain acknowledged
unsaved work locally. `library_settings_writer.py` merges the grade at the
actual whole-file write and rechecks external changes; marks continue saving
through a grade conflict. Existing writer failure handling and Activity apply.

`projects.open_document` is the shared existing project/session construction
path, also used by sidecar opening; exporters, Proof and shaders are unchanged.
`frontend/grade-saving.js` owns the visible state, idle autosave, conflict and
recovery choices and the existing leave-photo gate. `project-documents.js`
attaches imported source sessions and keeps Save As project creation available.
The desktop close handshake waits for this gate; Windows session ending keeps
acknowledged edits in recovery without blocking shutdown. `application-shell.js`
and desktop preferences persist app-wide autosave. `library-activity.js` names
paused grade conflicts without implying that retries choose a winner.

`tests/test_library_grades.py` checks document round trips, preservation,
conflict choices, queue races, offline/failure recovery and identical project
versus sidecar Export/Proof output. `tests/library-grade-saving.js` is the
focused Electron check for controls, transitions, close cancellation, external
changes and offered restart recovery, using disposable photos only.

`codebase/tools/library-memory-monitor.cjs` records whole-app peak, planning
ceiling excursions, active grants/types, duration and hard reserve violations;
`measure-library-cold-mixed.cjs` consumes it for acceptance runs.

### Photo Library measurements

`tests/performance/photo-library-measurements.py` is a read-only corpus probe
for M1/M4/R1, not an application decoder. It hashes/deduplicates originals,
records size exclusions, extracts embedded JPEG dimensions, compares current
EXIF/LibRaw output with maker-note-enabled ExifRead and optional ExifTool, and
times representative half/full LibRaw camera-RGB decodes in fresh processes.
It writes only outside the source directory and caps file/pixel size and each
child's runtime. ExifTool is a temporary measurement dependency, not bundled.
The PRD records the method, results and limits; raw JSON is ignored local output.
`tests/library-background-interaction.js --corpus <json> --grade-source <raw>`
uses several actual camera formats without copying/writing the originals.

### Library kept-picture production (slice 3 Stage B)

`library_kept.py` validates a saved EditDocument, opens its corrected source in
an independent SessionStore, reduces it and calls the existing export branches
and gain-map writer. `library_worker.py` hosts one low-priority kept lane with
cooperative foreground gates. `LibraryGrades.save` queues production after its
normal durable grade save. `KeptPictures` publishes only the latest matching
grade/source, retaining older identity-keyed files for future history. The
Library API provides settings, unopened-photo requests and pixel transport.
`library-gpu.js` displays finished pixels with the existing composite shader;
Grade's renderer is unchanged. `library_kept.jpeg_renditions` reconstructs only
our writer's scalar gain-map files for fast Library display. Source, export and
Proof readers remain unchanged. Slice 7 adds durable bulk scheduling, not another
picture producer. Tests: `test_library_kept.py`, `library-kept-pictures.js` and
the read-only `performance/library-kept-backend-trial.py`.

Slice 3 Stage C: `library_history.py` owns target availability, all-file preflight,
previous/session retention and one bulk Undo. `library_grade_api.py` exposes
`/grade-reverts`; `grade-saving.js` activates open results, serializes polling and
manual save, and keeps revert controls disabled through activation. Library menus
use the same backend command. Existing settings writer merges `grade_history`.


Slice 3 D saving flow: `library_copies.py` separates physical sources from virtual
item keys. `library_grade_api.py` attaches Grade to the selected item, while
`project-documents.js` uses the same leave gate even for copies of one source.
`library_marks.py` translates copy rows into physical writer transactions;
`library_grades.py` merges each item's grade/history into `virtual_copies`.
`library_api.py` expands physical listings and independently indexes copy albums.
`library_kept.py` keys pictures by item and saved grade but opens the shared source.
`library-query.js` filters copies separately and sorts them beside their original.
`grade-saving.js` offers Keep both and waits for session activation before polling.

Library slice 4 compare: `backend/hdr_finisher/library_review.py` (read-only
commands and viewing preferences), `frontend/library-compare.js` (two Library
surfaces, normalized locked zoom/pan and layouts), `tests/test_library_review.py`
and `tests/library-compare.js` (fast command checks and focused Electron check).

Library slice 4 overlays: `backend/hdr_finisher/library_overlays.py` owns
source-data exposure masks, source-versioned compressed map files and PNG
transport. `library_focus.py` owns the Library-only, noise-subtracted peaking
measurement; its noise and fine-detail stages share identical fine smoothing.
`library_worker.py` uses the main lane for camera Focus and selected Exposure;
native Focus and background Exposure use the existing kept lane;
`library_api.py` owns transient switches and on-demand map/pixels routes.
`library_review.py` stores options with other Library viewing preferences.
`frontend/library-overlays.js` owns option panels, legend and separate canvases,
with no Grade transition or settings-file action. Pending metadata jobs join
with independently cancelled subscribers; results are not retained there.
`photo-library.js` attaches
only visible grid/film/single/compare surfaces and cancels work on exit.
`test_library_overlays.py` checks source regions, focus/noise, freshness,
cancellation, eviction, exact scalar-slice RAW masks and camera-preview registration;
`library-overlays.test.js` checks independent toggles, Focus continuation,
cancellation/errors and grouped slider redraws; `library-exposure.js`
and `library-focus.js` are the focused disposable Electron checks, and
`library-raw-overlays.js` checks overlays on undeveloped RAW camera previews.
RAW maps carry `camera_frame` (where the embedded preview sits, found by ECC
registration in `register_preview`) and every map carries `frame`; the
frontend crops the map to the picture shown. `performance/library-focus-trial.py` is a
bounded read-only half/full/controlled-softness trial, not a folder sweep.

Library slices 5/6 commands:

| Area | Code and scope |
| --- | --- |
| Independent Library folder controls | `codebase/backend/hdr_finisher/library_folder_commands.py`: new empty folder, pin label and Explorer; `frontend/photo-library.js`: menus. Original photo rename/move use `library_file_commands.py`, `library_file_io.py` and `library_file_state.py`: durable intent, forward recovery, verified no-replace publication, index/cache retargeting. `frontend/library-file-commands.js` owns previews and confirmations. |
| Smart albums | `codebase/backend/hdr_finisher/library_smart_albums.py`: durable rules, undo and indexed candidates; `frontend/library-smart-albums.js`: editor/navigation/live count; `frontend/library-query.js`: shared matching/fields. |

Whole-folder original Rename/Move: `library_file_folders.py`, using the durable `library_file_commands.py` record, `library_file_io.py` exclusive renames and `library_file_state.py` path retargeting. User controls are in `library-file-commands.js`; the focused driver is `library-folder-file-commands.js`.


Original Delete and Delete all rejected: `library_file_delete.py` owns counted
preview, route confirmation, pending settings, restored-photo and interruption
handling. `library_recycle.py` owns explicit native Windows RecycleItem and
checked receipt discovery, with no permanent fallback. `library_file_io.py`
checks stable NTFS identities or recorded FAT/exFAT contents, guards verified
source removal and refuses extra named streams on copies/settings rewrites.
`library_api.py`, `library_index.py` and `library_folder_checks.py` discard late
helper answers at locked acceptance; `library_file_state.py` restores indexed
album membership/names. Frontend Delete controls and all-rejected scoping live
in `library-file-commands.js` and `photo-library.js`; Activity gives progress and
Needs attention locations. Data checks: `test_library_file_commands.py`,
`test_library_file_folders.py`, `test_library_file_delete.py`,
`test_library_file_exfat.py`. Focused Electron: `library-photo-file-commands.js`,
`library-folder-file-commands.js`, `library-delete-file-commands.js`.

October 31 scheduler follow-up: `library_scheduler.py` also owns the global
two-development/FIFO admission, hidden-owner class restoration and startup-upkeep
grants. `library_index.py` releases startup grants at safe points and on close.
`library_worker.py` tracks active decoder deadlines and identified crash recovery;
`library_picture_errors.py` separates device-offline errors from broken photos.
`library-grants.js` sends document/native visibility over the existing channel; `desktop/main.js` includes native visibility in the existing window-state event. Header-only JPEG
XL refusal lives in `library_rgb.py`. Header-confirmed X-Trans RAF CPU routing lives in `library_gpu_raw.py`, `library_api.py`, `library_live.py` and `library-scenes.js`; its measured exception is in `library_estimates.py`.

| Library diagnostics | Files |
| --- | --- |
| Library quick check | `codebase/tools/quick-library-check.cjs`: plain Electron child, isolated profile, deadline and external memory census; `--virtual-copy` measures confirmation to selected/pictured RAW copy with sidecar restoration; `desktop/quick-library-test.cjs`: explicit-switch-only startup and file result; `tools/quick-library-scenario.js`: in-page inputs, presentation timing, grid progress and responsiveness probes; `tools/library-quick-metrics.cjs`: page-clock picture totals; `desktop/library-wait-check.cjs`: opt-in `--batch5c` screen-pixel sampling, Compare, rapid Fit arrows and detail-refusal acceptance; `--grade-native-memory --retention` adds paired Grade opening and native-owner/idle telemetry (refused native admission is not a qualified pair) |
| Library uploads | `codebase/frontend/library-upload.js` and `library-upload-worker.js`: transferable upload/download buffers, HTTP status, cancellation, worker/network failure and bounded completion |
| Library fixture comparison | `codebase/tools/capture-library-fixtures-native.cjs`, `desktop/library-pixel-test.cjs` and `tools/library-pixel-scenario.js`: plain-Electron finished SDR/HDR GPU readback at grid/Single sizes; `tools/capture-library-fixtures.cjs`: earlier CDP diagnostic; `tools/compare-library-fixtures.py`: exact hashes, finite-pixel checks, perceptual RAF exception and small difference review images |

Batch 5a focused diagnostic: `codebase/tests/library-edited-sharp.js` runs real
copy ARW/NEF/TIFF load/present, capture and stored/restart checks. Use before /
after / restart via `HDR_BATCH5A_PHASE`, with a disposable `test-` profile for
isolated cache storage. `HDR_BATCH5A_PHOTO` restricts it to one filename. It
restores temporary RAW sidecars in finally; registered as a Library diagnostic.

`tools/v1-control-panel-review.cjs` checks real-Electron menu hover, icon containment, Control Panel ordering, SDR-only Match, neutral Tab focus versus pointer focus, sentence-case headings, zoom geometry, adjacent status actions and Export preview/grid transitions in all three themes; captures go to `output/v1-control-panel-fixes/`.

November 4 thumbnail stall: `library_estimates.embedded_jpeg_header` inspects
rendered TIFF RAW/SubIFD JPEG headers and DCT sizing; preview grants forward
the actual edge. Desktop's existing collect/reclaim and pressure paths include
delivery, whose narrow `delivery-memory-preload.cjs` reports job idle/busy.
`desktop/library-thumbnail-memory-check.cjs` is an opt-in helper through
`quick-library-check.cjs --thumbnail-memory`, exercising Grade on test copies
and browsing original DxO DNGs read-only. It measures pre-job/peak/two-second
private bytes and takes a post-job heap snapshot. November 5: `gpu-delivery.js`
runs every job in a separate async frame before signaling idle; the polling
frame no longer retains photo buffers. `tests/gpu-delivery-lifetime.test.js`
checks reachability across all five routes on success, failure and cancellation.

### Selected native Library GPU owner (November 5)

`library-gpu-raw.js` transfers the selected development's GPU grant and owns
its native planes/background publication. `gpu_delivery.py` counts and
preempts that retained owner. `library-gpu.js` packs visible rectangles with
a transport-only compute shader and reuses Grade finishing; `library-scenes.js`
reserves the remaining GPU room and saves after presentation. `photo-library.js`
reloads released owners and starts background publication after canvas swap.
`tests/library-native-direct.js` covers pixels, crop, reuse, CPU fallback and
Grade/memory hand-over; the broker unit check covers waiting delivery preemption.

November 6: `library_scheduler.py` serializes heavy TIFF/EXR/PFM/HDR decodes
across Library windows using existing grants and safe points. `photo-library.js`
uses the existing embedded-only media-browser thumbnail route for TIFF stand-ins
in grid/filmstrip and Single quick pictures; no full TIFF decode is requested.

`tools/ui-polish-round3-review.cjs` captures small three-theme tab, workflow
bar, Library and Export title crops and checks rendered tab sizes, menu
open/Escape and stable title hover geometry at 2560 and 1440 px widths. Run
through `tests/run-in-electron.js`; output is `output/review/ui-polish/round-3/`.

`tools/ui-polish-round4-review.cjs` checks title/tab fonts, unchanged workflow
number size, Export empty-state geometry, switch/disabled-button materials,
menu casing, Resize fit and Library toolbar containment at 2560 x 1440 and
1100 x 720 in all three themes. Run through `tests/run-in-electron.js`;
registered as a UI diagnostic. Crops: `output/review/ui-polish/round-4/`.

`tools/ui-polish-round5-review.cjs` captures each selected workflow page in
three themes at 2560 and 1100 px, checks badge geometry, title font, containment,
click/keyboard/ARIA navigation and simulated macOS inset spacing. Registered
as a UI diagnostic through `tests/run-in-electron.js`; crops are in
`output/review/ui-polish/round-5/`.

`tools/ui-polish-round6b-review.cjs` captures toolbar fit in three themes at
1100/1200/1201/1300/1500 px with supported panels open/closed. It checks
control containment and overlap, includes an icon tooltip crop, and cleans up
its disposable Electron profile (reporting OS/policy blocks). Registered as a UI diagnostic; run through
`tests/run-in-electron.js`. Output overwrites `output/review/ui-polish/round-6/`.


November 10 deletion/navigation checks: `tests/library-collection-removal.test.js`
executes current album/pin controllers and navigation functions with controlled
request order/failures, empty fallback and neighbour selection.
`tests/library-membership.js` covers real unpin failure recovery and active
manual/smart deletion without pins; `tests/library-delete-file-commands.js`
covers mixed source/copy deletion and Single middle/last/all removal.
File-command source reservations in `library_file_commands.py` and
`sessions.py` serialize activation against destructive work; mixed-copy
recovery waits for normal sidecar writer durability before clearing records.


Focus source-only loading and cache reuse (November 10):
`library_overlays.full_focus_source` uses the default normalized RAW loader
with `loader.load_image(analyze_hdr=False)` to avoid unused Grade setup and
HDR classification; linear DNG retains its established decoder.
`library_api.OverlayRequest.cache_only` probes stored maps without starting
work; `library-overlays.js` prefers valid full maps for Single/Compare and
matching filmstrip sources, preserving half-first on a cold miss.
`tests/test_focus_source_loading.py` checks source equality/defaults,
classification/cancellation and unchanged route boundaries;
`tests/test_focus_cached_map.py` checks no-build lookup, stale source and
graded refusal. `library-overlays.test.js` covers retained validation, optional
lookup failure, priority and subscriber lifetime. Native filter experiments
were rejected; `library_focus.py` is unchanged in this round.


Camera-first cold Focus (November 10): `library_overlays.camera_focus_source`
extracts a bounded oriented camera JPEG without unpacking the RAW sensor;
`OverlayMaps.build(..., quality="camera")` publishes provisional maps with a
direct camera frame. `library_api.OverlayRequest` separates camera Focus
priority/admission from native background work. `library_worker.helper_lane`
uses the existing foreground lane; `library_estimates` uses the existing
bounded quick rate. `library-overlays.js` chooses camera/full refinement,
orders large surfaces first and cancels its dwell timer on navigation/off.
`test_focus_camera_source.py`, `test_focus_camera_api.py` and
`test_focus_camera_quality.py` cover decoding/admission, source identity,
placement, cancellation and synthetic sharpness limitations. The focused
Electron driver `tests/library-focus-camera.js` uses the shared badminton
RAW fixture folder (or `LIBRARY_FOCUS_CAMERA_FOLDER`, at least ten RAWs), no
photo copies, a fresh profile, filmstrip/fullscreen navigation and native
refinement after dwelling. It is registered in the release inventory.


Exposure mask simplification/priority (November 10): raw_exposure_regions
combines channel-dark comparisons directly in CFA cells, marking incomplete
cells false before expanding once; highlights, verification and fallback
retain exact behavior. Selected Single/Compare Exposure requests use 30/main,
filmstrip/grid use 85/kept, native Focus remains 82/85. Tiny/partial-group
cases extend test_library_overlays.py; library-overlays.test.js and
test_focus_camera_source.py check selected/background routing.
The release-registered library-exposure-culling.js reuses shared RAWs in a
fresh profile, optionally --focus, records navigation/request traces and
never writes source photos. tools/exposure-memory-diagnostic.py is a
Windows-only, standalone RSS experiment for one specified RAW per process;
its memory measurements are not shipped scheduler estimates. A pending-job
backend sharing prototype was rejected and is not part of the code.


Exposure admission (November 10): library_exposure_admission.py proves flat
ARW/CR2 eligibility from TIFF/JPEG headers and owns the approved rate 12.
library_estimates.exposure_reservation resolves (kind, bytes, reason), with
conservative CPU fallback; backend_grant uses that resolution for reservation
and scheduling. The API selects this path only for Exposure, preserving
Focus/picture/Grade behavior. test_exposure_admission.py covers header-only
parsing, Canon colour/subsampling rejection, malformed/unknown fallbacks,
rate/minimum, slot classification and memory gating. The culling driver now
samples grants/whole-app memory and offers --paced and --canon modes, with
sampler cleanup on both success and failure.

November 10 component-sheet pass: `tools/component-pass-review.cjs` is the
release-registered UI diagnostic through `tests/run-in-electron.js`. It checks
four-theme segment depth, equal curve tabs, icon-only Crop naming/geometry,
empty and populated Local list geometry and permanent list rails; captures
Default Dark and Default Light in `output/review/component-pass/`. Shared
materials live in `visual-tokens.css`, application rules in `visual-controls.css`,
list wells in `control-panel.css`, and Library sections in `photo-library.css`.
Graph-only paint is in the existing curve/equalizer/highlight/scope drawing files.

