# Phase 3 baseline before cleanup — October 5, 2026

**Complete.** The full 160-driver sweep, three extended audits, the repeated
30-minute endurance run, the additional fixture and packaged checks, the two
diagnostic helpers, the final fast reruns and the final fixture-hash check are
done. This is a record of measurements; whether phase 3 is closed is Steve's
decision. No phase 4 work is included.

## Baseline and method

- Branch: `viewport-bounded-preview-phase-2-wip`.
- HEAD: `66bad13a4c0f5cbf81ca62b8950c5ff784e7e893`; working tree initially clean.
- October 5 fixes at `c905bd8` are retained. No reset, commit or push.
- GPU checks run sequentially through `tests/run-in-electron.js`, with
  `HDR_FINISHER_ELECTRON_WINDOW_SIZE=2560x1440`. Steve authorized native
  Electron launchers for drivers that already launch the app themselves.
- A fresh Windows installer, portable executable and unpacked desktop app
  were built from this baseline. The stale installed app is not the reference.
- Changes during measurement are restricted to test setup and the audit.
  App code, shader pins, thresholds, memory limits, the 4,194,304-pixel
  editing-Peak budget, CPU export/Proof and owner decisions are unchanged.
- Raw logs, reports, inventory and resumable sweep results:
  `codebase/output/performance/review/phase3-baseline-2026-10-05/`.

## Automated checks

| Check group | Measured result |
|---|---|
| Node, `node --test tests/*.test.js` | 427 passed, zero failed; the same after every test repair |
| Python, `.venv/Scripts/python.exe -m pytest tests -q` | 1,692 passed, three skipped; the same after every test repair |
| Additional desktop/performance Node tests | 36 passed, zero failed; the same after every test repair |
| GPU/Electron sweep | All 160 recognized drivers ran; 28 current failures, classified below. Measurement-only completion does not mean every goal passes. Six additional variants and helpers are in "Additional runs and final checks". |

The three Python skips are the optional private camera-RAW corpus, the
optional 40+ MP AVIF fixture, and a POSIX process-liveness check on Windows.
Their skip reasons were confirmed separately; they are not test failures.

### Failure investigations and test repairs

| Driver | Current result | Classification and confidence | Reason |
|---|---|---|---|
| desktop/tests/confirmation-focus.js | pass after test repair | Test startup timing race; high confidence | Visible import button precedes shell event binding. Wait for initialized application preferences before original File/Settings click; all native/in-app confirmation, checkbox focus and operation assertions pass. |
| desktop/tests/highlight-lane-4k.js | fail | Out-of-date presentation field/backing-size expectation; high confidence | processedLongEdge replacement verifies WebGPU eligibility and 4K processing; remaining full 4K backing-canvas assertion contradicts viewport-bounded presentation. Failure exit now closes inherited pipe; assertion retained. |
| desktop/tests/preview-diagnostic.js | pass after test repair | Out-of-date diagnostic fields; high confidence | Waits for current exact requestedTier 4096 and reads Faster Dragging instead of retired tier/menu fields; bounded 60-second native sample completes with snapshots. Measurement recorder, not a pixel/performance gate. |
| desktop/tests/preview-restore.js | pass after test repair | Out-of-date accepted tier field; high confidence | Current exact requestedTier 4096 replaces retired refinement label; original canvas >2000, exposure edit, compare exit and inactive-lane peek restoration assertions all pass. |
| tests/bw-parity.js | fail | Real app defect suspected; moderate confidence | Four SDR filtered-channel cases still exceed unchanged pixel limits after recipe synchronization; all HDR cases pass. |
| tests/curve-editor-interaction.js | pass after test repair | Out-of-date test; high confidence | Exact section-order assertion now includes the documented B&W section; all curve/GPU checks pass at real DPR 2. |
| tests/export-file-browser-interaction.js | fail after setup repair | Real app defect; high confidence | Four valid exports, but the small fixture's preview requests long_edge=70 below backend minimum 256, producing two HTTP 422 errors. |
| tests/fine-adjustment-interaction.js | pass after test repair | Out-of-date desktop setup; high confidence | Settings command and focus outside form controls restore the intended setup; all precision/snapping/curve/band assertions pass. |
| tests/gpu-highlight-compression-parity.js | fail | Out-of-date test; high confidence | Four direct Peak shader comparisons pass, but old exactly-one foreground reduction expectation measures zero; scope call also superseded. |
| tests/gpu-scope-parity.js | fail | Real app defect suspected; moderate confidence | Synchronized SDR Exposure Bands peak differs by 4.71%, above unchanged 3% limit. |
| tests/local-adjustments-interaction.js | pass after test repair | Test timing race; high confidence | Trace proved a queued prior highlight-anchor task advanced SDR generation during straighten. Wait for queued/in-flight anchors; all exact draft/crop/local assertions pass. |
| tests/local-design-qa.js | fail | Out-of-date test; high confidence | Attempts toolbar conversion of a locked brush leaf; original clipboard reference images are also absent. Driver ran, assertions retained. |
| tests/luma-feather-quality.js | pass after test repair | Out-of-date test; high confidence | Recognize actual gpu-resampled-luminance_range textures; unchanged warped-mask pixel limits pass (max differences 0.039 and 0.008 versus 0.06). |
| tests/native-region-stall.js | fail | Out-of-date test; high confidence | Viewer converges and pool responds, but zero of required four pre-reader abandonments: current source-tile bodies drain; counter targets old proxy-stream route. Coverage gate retained. |
| tests/path-feather-mask-cache.js | fail | Out-of-date test; high confidence | Requires CPU draft-mask endpoint activity during drag; current path rasterization is GPU. Original coverage assertion retained pending equivalent GPU leaf-identity protection. |
| tests/performance/budget-route.js | fail | Out-of-date route expectation; moderate confidence | Auto restored at 200% presents in 37.9 ms but retained assertion expects direct rather than viewport tiled route; plan/readout and accepted execution differ. No limit or route assertion relaxed. |
| tests/performance/denoise-drag-region.js | fail | Out-of-date whole-frame selector test; high confidence | liveDenoiseRegion returns null without denoiseSourceSelector.original on current tiled path; driver requires whole-frame release reconstruction. Original assertions retained; viewport Denoise checks run separately. |
| tests/performance/denoise-memory-trace.js | pass after test repair | Out-of-date desktop preference setup; high confidence | Browser localStorage did not set Electron budget; use real desktop preference controls and verify original 2 GiB. All original residency gates pass on 24 MP, 42 MP and 8K sources. |
| tests/performance/denoise-stale-source.js | fail | Out-of-date whole-frame selector test; high confidence | Fails no denoise selector under current tiled path; both off/on renders succeed. Selector-specific stale-source assertions retained; no replacement coverage claimed. |
| tests/performance/detail-cache-residency.js | pass after test repair | Out-of-date desktop preference setup; high confidence | Browser localStorage did not set Electron budget; use real desktop preference controls and verify original 1 GiB. All original residency gates pass on 24 MP, 42 MP and 8K sources. |
| tests/performance/drag-gpu-load.js | fail | Real app performance miss, high confidence; out-of-date flight counter, high confidence | Exposure 200% presents 2.4 fps, worst second 1 vs unchanged 30/20 fps floors; Fit 49.6 fps. Flight counter counts queue submissions/batches rather than complete frames (max 3). |
| tests/performance/editing-peak-clarity-reference.js | fail | Real app numeric miss; moderate confidence from one run | Primary default does not activate reduced-surround path. Active 42 MP four-mask fixture, Clarity Amount 100/radius 1.5%: worst anchor patch 0.516% > unchanged 0.50%; worst Peak 0.487%, overall maxima exact. No budget, pin or tolerance changed. |
| tests/performance/export-parity.js | pass after test repair (measurement only) | Test recipe timing race; moderate confidence | Initial Denoise error intermittent; sibling filtering driver captured noise-model HTTP409. Await recipe synchronization before enable; full six scenarios complete. Numeric comparison report has no enforced overall agreement gate. |
| tests/performance/failure-taxonomy.js | pass after test repair | Out-of-date render injection and test setup; high confidence | Inject same transport/validation errors into active tiled path and request a new render per original attempt. Transport remains recoverable; original three-validation disable, fallback and painted-frame gates pass. |
| tests/performance/fit-filtering-ab.js | pass after test repair (measurement only) | Test recipe timing race; high confidence | Noise-model HTTP409 followed unsynchronized batch of synthetic controls. Await syncGlobalEditState before enable; all six scenarios complete, numeric differences reported without a general quality gate. |
| tests/performance/full-tier-instrumented-tiling.js | fail | Likely test timing/generation race; moderate confidence | All eight explicit Full renders superseded-before-proxy after manual generation mutation; overlap includes rendered work and no device validation errors. No-refusal assertion retained, source of supersession not fully isolated. |
| tests/performance/full-tier-tone-cost.js | fail | Out-of-date whole-frame Full route expectation; high confidence | Requires 42 MP Full to tile at Fit; current viewport path accepts exact Full via Direct. Both tiers ready, zero CPU preview/scopes and zero blank samples; original tiled/settle-race coverage gates retained. |
| tests/performance/gpu-linear-gradient-parity.js | fail | Suspected real app defect; moderate confidence | Analytic versus CPU bitmap gradient differs max 7.06348 linear units vs unchanged 1/255 gate; same result after pending draft/anchor work drains. GPU analytic route recorded; no tolerance changed. |
| tests/performance/highlight-ceiling.js | pass after test repair | Test timing race; high confidence | One manual render refused while background draft/anchor work remained. Wait for idle and cancel setup scheduler; all original compressed ceiling gates and uncompressed negative control pass. |
| tests/performance/luma-feather-latency.js | fail | Real app performance miss; high confidence in measured run | Warm Feather p95 1005.6 ms > unchanged 1000 ms; median 959.6, cold 1146.6. Zero CPU masks/timeouts/untrusted inputs; grade-only warm p95 6.4 ms. |
| tests/performance/phase4-preview.js | fail | Out-of-date desktop fixture and coarse-route expectation; high confidence | Legacy 2K desktop profile verifies migration and preference round-trip. Then old timing-model manipulation fails to produce Coarse within unchanged 30 s; current viewport path does not satisfy old forced coarse scenario. |
| tests/performance/phase4-regression-browser.js | fail | Out-of-date preview-mode/coarse expectation; high confidence | Runs legacy Responsive/Balanced/Precise scenarios then requires Responsive coarse zoom pixels; current opt-in Faster Dragging and viewport route do not satisfy old assertion. Original measurement and coarse gate retained. |
| tests/performance/phase5-inactive-lane.js | pass after test repair | Test timing race; high confidence | Background setup cancels scheduled idle callback; drain draft/anchor work before scheduling test. Original 900 ms window, gate consultation/deferral and complete explicit Compare hold/release assertions pass. |
| tests/performance/roi-refinement.js | fail | Stale test snapshot repaired; out-of-date interactive route gate, high confidence | Snapshot expected region immediately before measured pass: original 2% region and retained-frame gates then pass. Remaining assertion forbids interactive ROI, contrary to current viewport-bounded rendering. Gate retained. |
| tests/performance/roi-source-transport.js | fail | Out-of-date source-route expectation; moderate confidence | Requires sourceRoute region; current 4096px source remains streamed/resident. Viewport requested, four foreground tiles, 36 skipped; original region-texture coverage gate retained, route optimization equivalence not claimed. |
| tests/performance/tier-change-blank-canvas.js | fail | Out-of-date whole-frame Full route expectation; high confidence | 4K-to-Full 857 ms, all nine compositor samples painted, zero blank/nothing/CPU preview. Current viewport uses Direct; original tiled-route coverage assertion retained. |
| tests/performance/tier-film-consistency.js | fail | Suspected real app numeric miss; low confidence because of documented Electron harness sensitivity | Diffusion mean disagreement 0.107980 vs bloom 0.086221 = 1.25236x > unchanged 1.25x; peak equal 32.667. Test documents prior Electron geometry sensitivity; no threshold or shader change. |
| tests/performance/tiled-mask-batch-transport.js | fail | Out-of-date CPU mask transport expectation; high confidence | Requires CPU mask-tile batch activity for active local; current GPU mask path issues none. Original batching/transport assertions retained; equivalent negative transport coverage not invented. |
| tests/scope-exact-peak.js | fail | Out-of-date test; high confidence | Direct/tiled agreement and render isolation pass; editing Peak truthfully reports exact=false,bounded=true, contradicting the old exact=true assertion. CPU export/Proof unchanged. |
| tests/session-replacement-interaction.js | pass after test repair | Out-of-date desktop setup and test timing race; high confidence | Synchronize native dirty state and select Cancel; start B only after A begins byte upload. Exact cancellation, retirement, serialization and failed-preparation assertions pass. |
| tests/source-disclosures-interaction.js | pass after test repair | Out-of-date test setup; high confidence | Import now reveals metadata; explicitly collapse before testing collapsed control. All six widths and original disclosure/layout assertions pass. |
| tests/status-manager-interaction.js | pass after test repair | Out-of-date desktop test setup; high confidence | Standalone manager used hidden browser Open Project as focus target. A visible test-owned target preserves and passes all lifecycle, timing and focus-restoration assertions. |
| tests/tiled-admission-scope-fallback.js | fail | Test timing race; high confidence | Automatic refreshes supersede the explicit scope generation; CPU scopes settle but its call returns false. Assertions retained. |
| tests/tiled-film-parity.js | fail | Test timing race repaired; suspected real app defect, moderate confidence | Idle anchor wait removes intervening presentation; spatial-max tileSize 512 differs at 20 pixels, maxDelta 4 against unchanged byte-exact zero limit. Other cases pass. |
| tests/webgpu-shader-compilation.js | fail | Suspected real app defect; moderate confidence | Local Sharpen Threshold 0/10/100 produces identical pixels; radius, ordering and CPU parity checks pass. Original minimum-change assertions retained; synthetic source may constrain sensitivity. |

`tests/run-in-electron.js` now gives a driver sequential logical browser
contexts and real renderer device scaling. Its isolation check passes across 1x, 2x and
1x contexts, including init-script and storage isolation. The original native
inspection DPR check also passes at both 1x and 2x.

### Harness and coverage qualifications

The Electron wrapper uses one disposable app and browser contexts. Context
isolation was checked for storage, cookies, initialization scripts, listeners,
routes and device-pixel ratio; real DPR 1/2 native inspection passes. Native
launch adapters preserve each driver's app process and clean up only that
process. Exact unsaved-project dialogs select Discard on disposable sessions;
fixture Save is never selected. Export dialogs target new test-owned files.
These are test infrastructure changes, not app fixes.

`live-monitor` and `phase5-transport-probe` are exported helper APIs rather than
standalone launchers; their original functions are exercised through adapters.
The scheduler/control inventory, hardware summary and applicable endurance/
viewport summary helpers run separately. TIFF generation, comparison math and
shared review/context modules are dependencies exercised by their callers.
`summarize-phase4-regression` reads historical filenames and does not launch or
assert against the app; its historical output is not current-code evidence.
The phase 4/5 names on existing drivers are historical names only; no phase 4
cleanup is performed. Windows packaging is rebuilt; macOS/Linux packaging
scripts are distribution builds, not Windows GPU checks.

A successful measurement-only driver means it completed, not that every
reported number meets the PRD. Headline, drag, filtering/export and coverage
flags are reviewed below. Failed outdated assertions remain visible where a
replacement would require inventing or weakening coverage.

### Complete GPU/Electron driver inventory

Every driver below ran on this baseline. Package scripts are aliases for these
drivers or the fast tests; they do not create additional independent coverage.
Measurement-only drivers can exit successfully while reporting goal misses.
The failure-investigation table above carries confidence and test-repair detail.

| Driver | Current result | Evidence log |
|---|---|---|
| `tests/brush-feather-reference.js` | pass | `brush-feather-reference.log` |
| `tests/brush-mask-interaction.js` | pass | `brush-mask-interaction.log` |
| `tests/brush-native-feather-reference.js` | pass | `brush-native-feather-reference.log` |
| `tests/brush-native-shift-reference.js` | pass | `brush-native-shift-reference.log` |
| `tests/brush-regional-erase-reference.js` | pass | `brush-regional-erase-reference.log` |
| `tests/bw-parity.js` | fail | `bw-parity-repaired.log` |
| `tests/clarity-map-parity.js` | pass | `tests__clarity-map-parity.js.log` |
| `tests/crop-apply-handoff.js` | pass | `tests__crop-apply-handoff.js.log` |
| `tests/css-app-shell-matrix.js` | pass | `tests__css-app-shell-matrix.js.log` |
| `tests/curve-editor-interaction.js` | pass after test repair | `curve-editor-repaired-dpr2.log` |
| `tests/denoise-adaptive-parity.js` | pass | `tests__denoise-adaptive-parity.js.log` |
| `tests/denoise-noise-view.js` | pass | `tests__denoise-noise-view.js.log` |
| `tests/denoise-pan-enable-drag.js` | pass | `tests__denoise-pan-enable-drag.js.log` |
| `tests/denoise-progressive-disclosure.js` | pass | `tests__denoise-progressive-disclosure.js.log` |
| `tests/denoise-tile-cache.js` | pass | `tests__denoise-tile-cache.js.log` |
| `tests/denoise-tiled-parity.js` | pass | `tests__denoise-tiled-parity.js.log` |
| `tests/denoise-zoomed-region.js` | pass | `tests__denoise-zoomed-region.js.log` |
| `tests/detail-control-reference.js` | pass | `tests__detail-control-reference.js.log` |
| `tests/device-loss-fallback.js` | pass | `tests__device-loss-fallback.js.log` |
| `tests/editing-peak-bounded.js` | pass | `tests__editing-peak-bounded.js.log` |
| `tests/electron-context-isolation.js` | pass | `electron-context-isolation-final.log` |
| `tests/export-file-browser-interaction.js` | fail after setup repair | `export-diagnostic.log` |
| `tests/export-presets-interaction.js` | pass | `tests__export-presets-interaction.js.log` |
| `tests/exposure-bands-interaction.js` | pass | `tests__exposure-bands-interaction.js.log` |
| `tests/fine-adjustment-interaction.js` | pass after test repair | `fine-adjustment-repaired.log` |
| `tests/full-tier-brush-feather.js` | pass | `tests__full-tier-brush-feather.js.log` |
| `tests/full-tier-denoise.js` | pass | `tests__full-tier-denoise.js.log` |
| `tests/full-tier-preview.js` | pass | `tests__full-tier-preview.js.log` |
| `tests/geometry-transactions.js` | pass | `tests__geometry-transactions.js.log` |
| `tests/gpu-highlight-compression-parity.js` | fail | `tests__gpu-highlight-compression-parity.js.log` |
| `tests/gpu-scope-parity.js` | fail | `tests__gpu-scope-parity.js.log` |
| `tests/gradient-mask-interaction.js` | pass | `tests__gradient-mask-interaction.js.log` |
| `tests/gradient-transform-reference.js` | pass | `tests__gradient-transform-reference.js.log` |
| `tests/grading-value-entry.js` | pass | `tests__grading-value-entry.js.log` |
| `tests/grain-parity.js` | pass | `tests__grain-parity.js.log` |
| `tests/in-app-confirmations.js` | pass | `tests__in-app-confirmations.js.log` |
| `tests/lane-roundtrip-interaction.js` | pass | `tests__lane-roundtrip-interaction.js.log` |
| `tests/local-adjustment-usability.js` | pass | `tests__local-adjustment-usability.js.log` |
| `tests/local-adjustments-interaction.js` | pass after test repair | `local-adjustments-repaired.log` |
| `tests/local-crop-anchor-interaction.js` | pass | `tests__local-crop-anchor-interaction.js.log` |
| `tests/local-design-qa.js` | fail | `tests__local-design-qa.js.log` |
| `tests/local-grade-reference.js` | pass | `tests__local-grade-reference.js.log` |
| `tests/local-stack-sizing.js` | pass | `tests__local-stack-sizing.js.log` |
| `tests/luma-feather-quality.js` | pass after test repair | `luma-feather-quality-repaired.log` |
| `tests/luma-graph-region-reference.js` | pass | `tests__luma-graph-region-reference.js.log` |
| `tests/luma-mask-interaction.js` | pass | `tests__luma-mask-interaction.js.log` |
| `tests/luma-region-reference.js` | pass | `tests__luma-region-reference.js.log` |
| `tests/mask-graph-interaction.js` | pass | `tests__mask-graph-interaction.js.log` |
| `tests/mask-raster-reference.js` | pass | `tests__mask-raster-reference.js.log` |
| `tests/mask-resample-reference.js` | pass | `tests__mask-resample-reference.js.log` |
| `tests/media-browser-preview-interaction.js` | pass | `tests__media-browser-preview-interaction.js.log` |
| `tests/native-region-stall.js` | fail | `tests__native-region-stall.js.log` |
| `tests/neutral-color-grading-reference.js` | pass | `tests__neutral-color-grading-reference.js.log` |
| `tests/path-feather-geometry.js` | pass | `tests__path-feather-geometry.js.log` |
| `tests/path-feather-mask-cache.js` | fail | `tests__path-feather-mask-cache.js.log` |
| `tests/path-mask-interaction.js` | pass | `tests__path-mask-interaction.js.log` |
| `tests/perspective-interaction.js` | pass | `tests__perspective-interaction.js.log` |
| `tests/perspective-preview-ownership.js` | pass | `tests__perspective-preview-ownership.js.log` |
| `tests/pixel-magnification.js` | pass | `tests__pixel-magnification.js.log` |
| `tests/preview-resolution-interaction.js` | pass | `tests__preview-resolution-interaction.js.log` |
| `tests/proof-size-interaction.js` | pass | `tests__proof-size-interaction.js.log` |
| `tests/scope-exact-peak.js` | fail | `tests__scope-exact-peak.js.log` |
| `tests/scope-region-interaction.js` | pass | `tests__scope-region-interaction.js.log` |
| `tests/sdr-gamut-gpu-parity.js` | pass | `tests__sdr-gamut-gpu-parity.js.log` |
| `tests/sdr-match-gpu-interaction.js` | pass | `tests__sdr-match-gpu-interaction.js.log` |
| `tests/session-replacement-interaction.js` | pass after test repair | `session-replacement-repaired.log` |
| `tests/sharpen-blur-reference.js` | pass | `tests__sharpen-blur-reference.js.log` |
| `tests/slider-fill-anchoring.js` | pass | `tests__slider-fill-anchoring.js.log` |
| `tests/source-disclosures-interaction.js` | pass after test repair | `source-disclosures-repaired.log` |
| `tests/startup-state.js` | pass | `startup-state.log` |
| `tests/status-manager-interaction.js` | pass after test repair | `status-manager-repaired.log` |
| `tests/technical-panel-fit.js` | pass | `tests__technical-panel-fit.js.log` |
| `tests/tiled-admission-scope-fallback.js` | fail | `scope-diagnostic-after-render.log` |
| `tests/tiled-cpu-detail-parity.js` | pass | `tests__tiled-cpu-detail-parity.js.log` |
| `tests/tiled-direct-parity.js` | pass | `tests__tiled-direct-parity.js.log` |
| `tests/tiled-film-parity.js` | fail | `tiled-film-repaired.log` |
| `tests/transport-pool-exhaustion.js` | pass | `tests__transport-pool-exhaustion.js.log` |
| `tests/ui-refinement-detail-qa.js` | pass | `tests__ui-refinement-detail-qa.js.log` |
| `tests/webgpu-shader-compilation.js` | fail | `tests__webgpu-shader-compilation.js.log` |
| `tests/workflow-stage-overlays.js` | pass | `tests__workflow-stage-overlays.js.log` |
| `tests/zebra-overlay-live.js` | pass | `tests__zebra-overlay-live.js.log` |
| `tests/zoom-refinement-stall.js` | pass | `tests__zoom-refinement-stall.js.log` |
| `tests/performance/brush-pack-benchmark.js` | pass | `tests__performance__brush-pack-benchmark.js.log` |
| `tests/performance/brush-rejection-diagnostic.js` | pass | `tests__performance__brush-rejection-diagnostic.js.log` |
| `tests/performance/budget-route.js` | fail | `tests__performance__budget-route.js.log` |
| `tests/performance/clarity-radius-load.js` | pass | `tests__performance__clarity-radius-load.js.log` |
| `tests/performance/denoise-drag-region.js` | fail | `tests__performance__denoise-drag-region.js.log` |
| `tests/performance/denoise-input-coalescing.js` | pass | `tests__performance__denoise-input-coalescing.js.log` |
| `tests/performance/denoise-memory-trace.js` | pass after test repair | `denoise-memory-trace-repaired.log` |
| `tests/performance/denoise-native-intermediate-probe.js` | pass | `tests__performance__denoise-native-intermediate-probe.js.log` |
| `tests/performance/denoise-scale-identity.js` | pass | `tests__performance__denoise-scale-identity.js.log` |
| `tests/performance/denoise-selector-seam.js` | pass | `tests__performance__denoise-selector-seam.js.log` |
| `tests/performance/denoise-stale-source.js` | fail | `tests__performance__denoise-stale-source.js.log` |
| `tests/performance/detail-band-probe.js` | pass | `tests__performance__detail-band-probe.js.log` |
| `tests/performance/detail-cache-residency.js` | pass after test repair | `detail-cache-residency-repaired.log` |
| `tests/performance/drag-gpu-load.js` | fail | `tests__performance__drag-gpu-load.js.log` |
| `tests/performance/editing-peak-clarity-reference.js` | fail | `editing-peak-clarity-active.log` |
| `tests/performance/editing-peak-diagnostic.js` | pass | `tests__performance__editing-peak-diagnostic.js.log` |
| `tests/performance/exact-tier-latency.js` | pass | `tests__performance__exact-tier-latency.js.log` |
| `tests/performance/export-parity.js` | pass after test repair (measurement only) | `export-parity-repaired.log` |
| `tests/performance/failure-taxonomy.js` | pass after test repair | `failure-taxonomy-repaired.log` |
| `tests/performance/film-look-interaction.js` | pass | `tests__performance__film-look-interaction.js.log` |
| `tests/performance/fit-filtering-ab.js` | pass after test repair (measurement only) | `fit-filtering-repaired.log` |
| `tests/performance/full-tier-instrumented-tiling.js` | fail | `tests__performance__full-tier-instrumented-tiling.js.log` |
| `tests/performance/full-tier-tone-cost.js` | fail | `tests__performance__full-tier-tone-cost.js.log` |
| `tests/performance/gpu-linear-gradient-parity.js` | fail | `gpu-linear-gradient-settled.log` |
| `tests/performance/gpu-local-adjustments.js` | pass | `tests__performance__gpu-local-adjustments.js.log` |
| `tests/performance/halation-map-zoom.js` | pass | `tests__performance__halation-map-zoom.js.log` |
| `tests/performance/hardware-matrix-capture.js` | pass | `tests__performance__hardware-matrix-capture.js.log` |
| `tests/performance/headline-latency.js` | pass | `tests__performance__headline-latency.js.log` |
| `tests/performance/heavy-project-baseline.js` | pass | `tests__performance__heavy-project-baseline.js.log` |
| `tests/performance/heavy-project-control-sweep.js` | pass | `tests__performance__heavy-project-control-sweep.js.log` |
| `tests/performance/heavy-project-drag-review.js` | pass | `tests__performance__heavy-project-drag-review.js.log` |
| `tests/performance/heavy-project-dynamic-sweep.js` | pass | `tests__performance__heavy-project-dynamic-sweep.js.log` |
| `tests/performance/heavy-project-long-session.js` | completed separately | `endurance-30min.log` |
| `tests/performance/heavy-project-viewer-tasks.js` | pass | `tests__performance__heavy-project-viewer-tasks.js.log` |
| `tests/performance/high-impact-review.js` | pass | `tests__performance__high-impact-review.js.log` |
| `tests/performance/highlight-anchor-stability.js` | pass | `tests__performance__highlight-anchor-stability.js.log` |
| `tests/performance/highlight-ceiling.js` | pass after test repair | `highlight-ceiling-settled.log` |
| `tests/performance/local-mask-performance.js` | pass | `tests__performance__local-mask-performance.js.log` |
| `tests/performance/luma-feather-latency.js` | fail | `tests__performance__luma-feather-latency.js.log` |
| `tests/performance/many-local-layers.js` | pass | `tests__performance__many-local-layers.js.log` |
| `tests/performance/match-candidate-review.js` | pass | `tests__performance__match-candidate-review.js.log` |
| `tests/performance/native-inspection-dpr.js` | pass | `native-inspection-dpr.log` |
| `tests/performance/packaged-baselines.js` | pass | `tests__performance__packaged-baselines.js.log` |
| `tests/performance/peak-readout-review.js` | pass | `tests__performance__peak-readout-review.js.log` |
| `tests/performance/phase3-coverage-audit.js` | completed separately | `coverage-primary-settled.log` |
| `tests/performance/phase3-local-route-smoke.js` | pass | `tests__performance__phase3-local-route-smoke.js.log` |
| `tests/performance/phase3-manual-baseline.js` | pass | `tests__performance__phase3-manual-baseline.js.log` |
| `tests/performance/phase4-preview.js` | fail | `phase4-preview-desktop-migration.log` |
| `tests/performance/phase4-regression-browser.js` | fail | `tests__performance__phase4-regression-browser.js.log` |
| `tests/performance/phase5-endurance.js` | pass | `tests__performance__phase5-endurance.js.log` |
| `tests/performance/phase5-inactive-lane.js` | pass after test repair | `phase5-inactive-lane-settled.log` |
| `tests/performance/phase5-peak-agreement.js` | pass | `tests__performance__phase5-peak-agreement.js.log` |
| `tests/performance/phase5-transport-ab.js` | pass | `tests__performance__phase5-transport-ab.js.log` |
| `tests/performance/presentation-gate.js` | pass | `tests__performance__presentation-gate.js.log` |
| `tests/performance/preview-export-compare.js` | pass | `tests__performance__preview-export-compare.js.log` |
| `tests/performance/preview-performance.js` | pass | `tests__performance__preview-performance.js.log` |
| `tests/performance/raw-import-baseline.js` | pass | `tests__performance__raw-import-baseline.js.log` |
| `tests/performance/responsiveness-probe.js` | pass | `tests__performance__responsiveness-probe.js.log` |
| `tests/performance/roi-catch-up.js` | pass | `tests__performance__roi-catch-up.js.log` |
| `tests/performance/roi-pan-cache.js` | pass | `tests__performance__roi-pan-cache.js.log` |
| `tests/performance/roi-parity.js` | pass | `tests__performance__roi-parity.js.log` |
| `tests/performance/roi-refinement.js` | fail | `roi-refinement-repaired.log` |
| `tests/performance/roi-source-transport.js` | fail | `tests__performance__roi-source-transport.js.log` |
| `tests/performance/tier-change-blank-canvas.js` | fail | `tests__performance__tier-change-blank-canvas.js.log` |
| `tests/performance/tier-film-consistency.js` | fail | `tests__performance__tier-film-consistency.js.log` |
| `tests/performance/tiled-mask-batch-transport.js` | fail | `tests__performance__tiled-mask-batch-transport.js.log` |
| `tests/performance/tiled-stop-gate.js` | pass | `tests__performance__tiled-stop-gate.js.log` |
| `tests/performance/zoom-after-edit-review.js` | pass | `tests__performance__zoom-after-edit-review.js.log` |
| `tests/performance/zoom-block-continuity.js` | pass | `tests__performance__zoom-block-continuity.js.log` |
| `tests/performance/zoom-cycle-profile.js` | pass | `tests__performance__zoom-cycle-profile.js.log` |
| `desktop/tests/confirmation-focus.js` | pass after test repair | `confirmation-focus-initialized.log` |
| `desktop/tests/electron-smoke.js` | pass | `desktop__tests__electron-smoke.js.log` |
| `desktop/tests/highlight-lane-4k.js` | fail | `highlight-lane-4k-repaired.log` |
| `desktop/tests/preview-diagnostic.js` | pass after test repair | `preview-diagnostic-repaired.log` |
| `desktop/tests/preview-menu.js` | pass | `desktop__tests__preview-menu.js.log` |
| `desktop/tests/preview-restore.js` | pass after test repair | `preview-restore-repaired.log` |
| `desktop/tests/proof-grade-diagnostic.js` | pass | `desktop__tests__proof-grade-diagnostic.js.log` |
| `desktop/tests/renderer-crash.js` | pass | `desktop__tests__renderer-crash.js.log` |


## Additional measured goal misses

A driver can finish successfully while recording a miss. `headline-latency.js`
completed 100 rows with ten default samples. Its numeric failures are cold
100% zoom feedback 850.2 ms against 150 ms (one cold observation), warm
200% slider feedback p95 85.2 ms against 50 ms (nine observations), and warm
400% settlement p95 83.8 ms against Fit p95 + 50 ms = 83.4 ms (nine).
Three cold settlement rows say fail but have a null target; these are report
limitations, not established numeric goal misses. The 400% processed-pixel
counter also reports a failure; it reads legacy whole-frame execution metrics,
so attributing that count to actual viewport work needs separate validation.

`drag-gpu-load.js` records 49.6 fps at Fit, but only 2.4 fps at 200%
(worst second one frame), below its unchanged 30/20 fps floors. Its queue
submission counter cannot establish how many complete tiled frames are in
flight. The maximum three concurrent submissions is retained as measured.

The active 42 MP Clarity reference (four-mask fixture, global Amount 100 and
radius 1.5%) reports worst anchor patch disagreement 0.516% against 0.50%.
Worst finished Peak patch is 0.487%, and overall anchor/Peak maxima agree.
This is a gate miss from one run, not an automatic change to Steve's P3-PEAK-01
closure or a widened acceptance. The original primary default did not activate
the reduced-surround measurement and therefore was not a valid comparison.

Fit filtering and export parity are measurement drivers. Their successful
completion after recipe synchronization does not assert general pixel
agreement. Their numeric reports are retained, including fine-detail and
highlight differences; CPU export and Proof remain exact and unchanged.

### Real-pointer heavy-project drag review

The default run completed 69 control groups with ten observations each, zero page errors, in 16.8 minutes at Fit (2560x1440, DPR 1, 165 Hz). It measures input/preview presentation events and scope completion; it is not the headline driver's compositor-pixel observation. The following groups have first-feedback or release-to-exact p95 above 100 ms. This does not widen prior control-specific acceptances. Geometry rows include the Apply operation and are reported separately from an ordinary slider release.

| Group | First feedback p95 (ms) | Release to exact p95 (ms) | Scopes p95 (ms) |
|---|---:|---:|---:|
| hdr: color-wheel pad | 816.7 | 174.8 | 704.8 |
| hdr: brush input[data-local-mask-param="mask_feather"] | 991.6 | 257.9 | 843.3 |
| hdr: brush input[data-local-mask-param="mask_shift_edge"] | 838.6 | 116.0 | 666.0 |
| hdr: gradient fan | 10.5 | 241.5 | 620.0 |
| hdr: luma reference upper rail | 753.0 | 25.8 | 573.6 |
| hdr: luma refined upper rail | 799.8 | 56.0 | 590.8 |
| sdr: color-wheel pad | 826.8 | 105.7 | 701.8 |
| sdr: brush input[data-local-mask-param="mask_feather"] | 853.9 | 105.0 | 623.4 |
| sdr: brush input[data-local-mask-param="mask_shift_edge"] | 794.0 | 57.9 | 591.1 |
| sdr: gradient fan | 9.4 | 209.3 | 664.4 |
| sdr: luma reference upper rail | 765.5 | 25.4 | 603.8 |
| sdr: luma refined upper rail | 772.1 | 27.8 | 604.4 |
| shared: straighten drag and Apply | 1364.7 | 611.9 | 1499.0 |
| shared: perspective horizontal drag and Apply | 1664.6 | 930.7 | 2630.9 |

Raw report: `tests__performance__heavy-project-drag-review.js.json` in the baseline output directory.

## Coverage audit

The primary fixture is complete across saved, rotated, flipped, straightened,
perspective and combined geometry, in HDR and SDR. Both Denoise algorithms,
controls, enable/disable and grading while enabled add 312 rows to the prior
audit. All 12 pan rows moved the view by 400 horizontal and 300 vertical pixels.

| Fixture | Rows | Exact WebGPU | CPU picture/scopes | Flagged rows | Whole-source requests | Page errors |
|---|---:|---:|---:|---:|---:|---:|
| Primary | 1,250 | 1,250 | 0 / 0 requests | 69 | 13 requests | 0 |
| Four-mask | 1,166 | 1,166 | 3 / 0 requests | 35 | 14 requests | 0 |
| Fifty-local | 4,202 | 4,202 | 5 / 9 requests | 181 | 14 requests | 0 |

The primary has 59 rows with CPU-mask flags (121 requests), including 512-edge
masks and mask tiles as well as the documented 3,200-edge fallback. The whole
sources were fetched by all twelve legacy-Denoise enable rows and saved SDR
Tint Purity. The initial run instead recorded ten legacy enable rows, two
adaptive Amount rows and Red Purity; the same request total hides different
individual rows. These are measured
route misses, not additional owner acceptances. Their relationship to switching
Denoise algorithms still needs investigation; app code remains unchanged.
There were no failed requests under the audit's existing definition and 120
intentional aborted requests. The four-mask and fifty-local audits follow the
endurance repeat, using the same extended audit.

The fifty-local audit is complete with both Denoise algorithms and all fifty
local adjustments. It awaits each lane switch and checks that accepted geometry
matches current geometry before measuring. CPU-mask work appears in 159 rows,
CPU scopes in six, CPU pictures/fallbacks in five, and whole-source fetches in
14. The 181 flagged rows overlap these categories. The exact WebGPU label
describes the accepted picture tier; it does not prove that no CPU work occurred
or that pixels match CPU export. There are zero page errors. These routing
misses remain unaccepted; completed primary/four-mask rechecks use the same setup.

The fifty-local request totals are five CPU pictures, nine CPU scopes, 402 CPU
masks and 14 whole-native sources, with zero failed requests under the audit's
existing definition and 370 intentional aborts. Three CPU pictures have
`dirty-edit-with-stale-geometry` refusals and two legacy-Denoise Levels rows
have `superseded-before-proxy`. The initial geometry/lane setup race was repaired;
these remaining refusals therefore cannot all be dismissed as that setup issue.

The corrected four-mask run completed in 800.54 seconds: 1,166 rows, 312
Denoise rows, 12 real 400 x 300 pans, zero page errors and all accepted frames
exact WebGPU. Its 35 flagged rows overlap: 18 CPU-mask rows, 14 whole-source
rows and three CPU-picture/fallback rows. Request totals are 36 CPU masks,
14 whole sources, three CPU pictures, zero CPU scopes, zero failed requests
under the existing definition and 47 aborted requests. Exposure after rotation,
flip and straighten produces the three `dirty-edit-with-stale-geometry`
fallbacks despite settled setup. Classification: suspected real app routing
issue, moderate confidence; no app fix or broader acceptance. The initial
four-mask run had four picture fallbacks and 34 flagged rows; it remains in
`coverage-four-mask.json`, while the corrected result is authoritative here.

Across all three corrected audits, Denoise covers both algorithms, eight live
controls per algorithm, legacy analysis controls, enable/disable and grading
while enabled in both lanes and six geometries. Each fixture has 312 Denoise
rows and 12 verified pans. This covers routes and settlement, not pixel parity
or drag latency. The audit's failed-request count excludes HTTP 409 because
its existing classifier counts non-aborted HTTP 500+; zero failed requests is
not a claim that all HTTP responses were successful. Each audit also records
one CPU-overlay request, which its existing flags do not classify as a miss.
The code SHA fields and raw request rows remain available for review.

The export/file-browser driver now exercises desktop import and native Save
selection, retaining all four export and error assertions. All four files export
and validate, but the check fails on two HTTP 422 preview errors: the 70-pixel
fixture requests `source-tile/hdr?long_edge=70`, below the backend's minimum 256.
Classification: real app defect, high confidence. App code remains unchanged.

## Endurance

Complete: **30.26 active minutes, 85 cycles, 1,378 operations**, followed
by two idle minutes. The driver exited successfully: zero page errors,
zero sampler errors, no over-budget bytes, exact current picture accepted,
scopes settled, and no pending/in-flight anchors, picture or scope work.
This is a successful completion check, not a pass against every PRD goal.

- Registered GPU memory: 61.4 MiB after startup, peak 4,394.5 MiB
  (4.29 GiB), final 4,378.6 MiB (4.28 GiB), against the unchanged automatically
  calibrated 6,141 MiB budget. It plateaued near 4.3 GiB during the run.
- Whole-board NVIDIA memory: 1,823 to 6,878 MiB; this includes other desktop
  users of the board and is distinct from the app's registered allocator.
  App process-tree private memory: 1,241.6 to 8,027.6 MiB, peak 8,846.6 MiB.
- Zero CPU picture requests, **six CPU-scope requests** for HDR captured
  within switches to SDR (cycles 2, 6, 10, 16 and 54). The active lane at the
  instant each request began was not captured, so an inactive-lane start is
  not proved. This differs from the previous run's zero CPU scopes and needs
  routing classification; it is not accepted as an additional deferral.
  There were 450 CPU-mask requests; request bodies
  were not captured, so their processing edges cannot be classified here.
- 59,340 API requests: 35 HTTP 409 responses (29 source tiles, six masks),
  zero HTTP 5xx, zero non-abort transport failures, 2,347 intentional aborts.
  The backend uses 409 for superseded geometry/revision work; the response
  bodies were not captured, so that explanation is probable, not proved.
- Actual pointer-release measurements, from each operation's `drag` record:
  510 drags; picture exact median 55.3 ms, maximum 1,346.4 ms, **255 over
  100 ms**. Scopes median 525.2 ms, maximum 1,834.2 ms, all 510 over 100 ms.
  First feedback median 14.1 ms, maximum 1,002.6 ms, 170 over 100 ms.
  These misses remain reported; no target was widened.

First ten cycles versus last ten (1–10 and 76–85), full scripted operation
totals in milliseconds:

| Operation | First median | Last median | Change |
|---|---:|---:|---:|
| hdr switch | 14.5 | 16.0 | +10.3% |
| hdr fresh inputs | 30.0 | 31.0 | +3.3% |
| hdr exposure drag | 1,200.5 | 1,424.0 | +18.6% |
| hdr detail.clarity_amount drag | 1,160.5 | 1,541.5 | +32.8% |
| hdr fresh brush stroke | 718.5 | 883.0 | +22.9% |
| hdr brush feather drag | 1,685.0 | 1,611.5 | -4.4% |
| sdr switch | 383.0 | 399.0 | +4.2% |
| sdr fresh inputs | 27.0 | 27.0 | +0.0% |
| sdr exposure drag | 1,445.0 | 1,493.0 | +3.3% |
| sdr detail.clarity_amount drag | 1,157.5 | 1,216.0 | +5.1% |
| sdr fresh brush stroke | 784.0 | 786.5 | +0.3% |
| sdr brush feather drag | 1,357.5 | 1,518.5 | +11.9% |
| hdr pan lane | 351.5 | 403.5 | +14.8% |
| zoom 100 | 417.5 | 532.0 | +27.4% |
| native navigation pan | 1,138.5 | 1,101.0 | -3.3% |
| zoom Fit | 65.5 | 84.0 | +28.2% |
| Match entire HDR grade | 3,435.0 | 2,448.5 | -28.7% |

Most rows have ten observations per window; Match has three then two, with
18 Match runs overall. Fresh values and brush positions vary by cycle, so
this is observed drift, not a controlled causal comparison. Scripted drag
totals include the gesture and settlement; they are not release latency.
Match's first/last medians both miss the two-second goal. HDR Clarity,
fresh brush stroke and native zoom visibly slowed; "no drift" would be false.

## Fixture integrity

Initial hashes below matched after the initial check batch and again after the
completed primary audit, and again after the last run of this baseline. None
of these projects is saved by the drivers.

| Fixture | SHA-256 |
|---|---|
| Primary | `246ba308dcba22c5483c32ed4c31f5c81a2804504cd01dec2482b6d5be307d56` |
| Four-mask | `3004b621783d77d7fefee6a1997392e1599954ab845b833208841fab1f4d1825` |
| Fifty-local | `00913f3d8214a211ff74d0791b5393dddf06c861e57994517354aa1a88e6acee` |
| Saved Denoise photo | `2dd3ef64d3b4127d5e793c6664b12075d4e203e19a746d55b92e317bf23daf86` |

## Additional runs and final checks

Run after the sweep, one app at a time, on the same code.

| Run | Result |
|---|---|
| `denoise-pan-enable-drag`, generated 42 MP source | Pass: first drag frame 431 ms, 42 frames during 60 inputs; 29 ms and 59 frames with catch-up off; warmed 100% zoom 72 ms |
| `denoise-pan-enable-drag`, saved 42 MP photo | Fail, a real timing: no frame was shown during the one-second drag in the cold case. Earlier the same day it showed 5 and 7 frames against the driver's 10. The known limit in PRD 15.3, not accepted |
| Desktop smoke, fresh packaged build | Pass |
| `packaged-baselines`, fresh packaged build | Pass (measurement only), zero page errors |
| `phase5-transport-probe` through its adapter | Pass (measurement only): a whole 42 MP frame is 339 MB and takes about 0.84-0.95 s to fetch |
| `live-monitor` through its adapter | Pass: install and dump work on current code |

Final fast reruns after every test repair: Node 427 of 427, Python 1,692 with
three skips, additional desktop and performance Node tests 36 of 36. All four
fixture hashes match the table above. App source, shader pins, limits and
budgets are unchanged: the working tree differs from `66bad13` only in test
and harness files, this document and PRD section 15.

Raw logs and reports are in the gitignored directory
`codebase/output/performance/review/phase3-baseline-2026-10-05/`
(`extra-results.json`, `fast-final-results.json` and `logs/`).
