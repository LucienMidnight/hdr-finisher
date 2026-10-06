# Phase 4 cleanup validation comparison - October 6, 2026

Status: 160/160 baseline drivers complete; 147 pass, 13 fail. Three audits complete. The green phase 4 exit is not met. No behavior/timing equivalence claim is made while the named guards and target misses remain. Steve closed phase 4 on October 6 as done with known issues; every finding below stays open and carried forward (PRD 16.22).

## Scope and preserved behavior

Steve approved inventory Group A. Removed `roiPanCandidate` from app.js (14 nonblank lines / 597 UTF-8 bytes including its comment) and `admitDirect` from webgpu-preview.js (3 lines / 116 bytes). Total: 17 lines / 713 bytes, or 19 source lines including the two separators. Their live coordinator/planner implementations remain. These are the only application-source changes from `ccf2fb5`.

CPU export, Proof, GPU/device-loss fallback, shaders and byte pins, limits, budgets including the 4,194,304-pixel editing Peak budget, preferences and saved-project formats are unchanged. Group B source-staging wrappers and queued highlight measurement remain held for open route/Peak findings. Live cancellation, mask compilation, cache eviction and Denoise coalescing remain. No installer build or push.

## Check disposition

No check was retired. All old-design checks named in PRD 15.7 were rewritten to preserve their original protection under current viewport presentation and routing. The two named timing races were repaired in tests only. Five baseline-passing drivers needed additional setup synchronization during the sweep; their initial failures, unchanged repeats and diagnostics remain in `sweep-initial-attempts.json`, alongside final reruns. No app defect fix is mixed into these changes.

PRD sections 16.1-16.16 and 16.20 and the [inventory](viewport-phase4-cleanup-inventory-2026-10-05.md) record each test replacement, retained assertion and local commit. Four original visual reference assets for local-design QA are absent; the driver retains an explicit missing-reference guard and remains red for its switch geometry contract.

## Completed driver failures

| Driver | Finding and disposition |
|---|---|
| `tests/bw-parity.js` | CF-PIX-02 same baseline failure; All 16 reported mean/p99.9/spread measurements match the baseline rounded output; the same four SDR filtered cases fail unchanged limits. HDR and neutral cases pass. |
| `tests/export-file-browser-interaction.js` | CF-PIX-01 same baseline failure; All four exports return 200 and produce nonempty files; the same two preview HTTP 422 errors fail the retained browserErrors guard. Baseline names 70-edge preview below minimum 256. |
| `tests/gpu-scope-parity.js` | CF-PIX-03 same baseline failure; SDR Exposure Bands GPU Peak 0.91748046875 vs CPU 0.9628263711929321 differs 4.71%, same baseline, above retained 3% limit. |
| `tests/local-design-qa.js` | CF-DRIFT-02 named unresolved current UI contract; Reproduces the retained original 46x24/borderless guard failure; actual 46x20/2px. Assigned mask lock passes. Baseline failed earlier locked-tool workflow. Original visual references absent; no app fix or weakened visual check. |
| `tests/tiled-film-parity.js` | CF-PIX-06 existing pixel finding; affected tile size moved; Spatial-max differs at 20 pixels, maxDelta 4, against retained byte-exact zero. Current failing tileSize is 256 instead of baseline 512; other cases pass. Record the movement without attributing it to unused wrapper removal. |
| `tests/webgpu-shader-compilation.js` | CF-PIX-05 same baseline sensitivity failure; Threshold 0/10/100 still produce identical pixels (both threshold differences zero); finite/local-energy/radius/order/CPU parity/drag coverage remains. Original positive-change gates retained, synthetic-source sensitivity unresolved. |
| `tests/performance/budget-route.js` | CF-ROUTE-08 named current accepted-route readout defect; Expected accepted routes/new exact presentations pass; 1 GiB switch 156.7ms and Auto restore 10ms inside original 1000ms. Readout still says Direct for accepted Tiled at 100/200 and 1 GiB Full/Fit, same earlier phase4 repeats. Baseline native route expectation repaired; original truthful readout guard retained. |
| `tests/performance/drag-gpu-load.js` | CF-SPEED-01 existing speed failure; measurements moved; Current Fit56.7fps/worst53 and200%4fps/worst1 vs baseline49.6/2.4fps; native still below retained30/20floors. Whole render in-flight max1; submissions separately306/873. Earlier phase4/control differed too; improvement not attributed to cleanup. |
| `tests/performance/editing-peak-clarity-reference.js` | CF-PEAK-01 same baseline numeric failure; timings moved; Authoritative active42MPfour-mask Clarity100/radius1.5% scenario. All anchor/Peak patch numeric differences and overall3925.1953125/3209.320746527778nit maxima exactly match baseline. Worst anchor0.516351%>retained0.50%;Peak0.487329%inside. Surround times308/232ms vs235/201ms, +73/+31ms. No budget/shader/limit change. |
| `tests/performance/full-tier-tone-cost.js` | CF-ROUTE-06; CF-ROUTE-07 remains intermittent named guaranteed-tiled pre-dispatch defect; Real1GiBFull guaranteedTiled:1056.2msgesture85.1settle/4overlaps/0blanks/0CPUpictureHTTP/scopes;4K1719ms vs baseline1707.3 (+11.7). Within original4x ratio. 12rendererlate interactive refusals, no predispatchrefusal; same finding earlier25refusals. No CPU settle fallback this run; earlier CF07 not closed. Current Full forcedroute not comparable to originalAutoDirect timings. |
| `tests/performance/gpu-linear-gradient-parity.js` | CF-PIX-04 same baseline mask pixel failure; Max7.0634765625linear units vs unchanged1/255, same baseline roundedmax7.06348; actualanalyticGPUmask route and0CPUmaskrequests. Current827x465capture/1133656differingvalues of1538220 recorded. No tolerance change. |
| `tests/performance/luma-feather-latency.js` | CF-SPEED-02 existing warm Feather latency failure; measurements moved; Cold982.1ms vs1146.6; warmmedian954.2vs959.6; warmp951015.8vs1005.6 remains above unchanged1000ms. Gradep957.5vs6.4ms. ZeroCPUrequests,139maskuses,8base/featherrebuilds,zero untrusted samples/timeouts. No limit or app change. |
| `tests/performance/tier-film-consistency.js` | CF-PIX-07 same baseline pixel failure; identical statistics; All four bloom/diffusion/halation/combined statistics exactly match baseline at379x565. Diffusion mean0.1079801683 vs bloom0.086221309 =1.25236x exceeds unchanged1.25x; peakboth32.6667. No tolerance, geometry recipe or shader change. |

## Three coverage audits

| Fixture | Rows before/after | Flagged before/after | Routes and errors |
|---|---:|---:|---|
| coverage-primary-settled | 1250 / 1250 | 69 / 68 | Requests before `{"cpuPicture":0,"cpuScopes":0,"cpuOverlay":1,"cpuMask":121,"wholeNativeSource":13,"sourceLuminanceTiles":27,"failed":0,"aborted":120}`; after `{"cpuPicture":0,"cpuScopes":0,"cpuOverlay":1,"cpuMask":117,"wholeNativeSource":12,"sourceLuminanceTiles":27,"failed":0,"aborted":118}`. Errors 0/0; all exact WebGPU True/True; project hash same True. |
| coverage-four-mask-settled | 1166 / 1166 | 35 / 35 | Requests before `{"cpuPicture":3,"cpuScopes":0,"cpuOverlay":1,"cpuMask":36,"wholeNativeSource":14,"sourceLuminanceTiles":30,"failed":0,"aborted":47}`; after `{"cpuPicture":4,"cpuScopes":0,"cpuOverlay":1,"cpuMask":36,"wholeNativeSource":13,"sourceLuminanceTiles":31,"failed":0,"aborted":40}`. Errors 0/0; all exact WebGPU True/True; project hash same True. |
| coverage-fifty-local | 4202 / 4202 | 181 / 181 | Requests before `{"cpuPicture":5,"cpuScopes":9,"cpuOverlay":1,"cpuMask":402,"wholeNativeSource":14,"sourceLuminanceTiles":46,"failed":0,"aborted":370}`; after `{"cpuPicture":4,"cpuScopes":12,"cpuOverlay":1,"cpuMask":402,"wholeNativeSource":12,"sourceLuminanceTiles":47,"failed":0,"aborted":392}`. Errors 0/1; all exact WebGPU True/False; project hash same True. |

Every matched state/control timing and route difference is retained in `audit-comparison.json`; row coverage differences are explicit. Successful audit exits are measurement completion, not acceptance of CPU routes or speed.

## Evidence and measurements

Immutable baseline: `codebase/output/performance/review/phase3-baseline-2026-10-05/`. Current evidence: `codebase/output/performance/review/phase4-cleanup-2026-10-05/`. These are local gitignored artifacts; the named driver ledger below makes the disposition reviewable without those files.

- `full-sweep-plan.json` and `full-sweep-results.json`: exact commands, exits, durations and logs, including the primary audit in the 160 drivers and two additional fixture audits.
- `driver-comparison.json`, `numeric-report-deltas.json`, `log-metric-comparison.json` and `target-verdict-comparison.json`: every matched report numeric delta and log metric line, routes/schema differences and target changes. Metadata and session-relative values are not isolated latency measurements.
- `heavy-control-drag-comparison.json`: all 53 broad control and 69 drag case summaries before/after.
- `endurance-comparison.json`: all 17 first/last ten-cycle comparisons, memory and requests; PRD 16.18 gives the measured conclusions.
- `audit-comparison.json`: three fixture aggregates and per-control timings/routes.
- `final-fixture-hashes.json`, `headline-confirmation-comparison.json` and `coverage-outlier-confirmation-comparison.json`: final hash checks and unchanged-command timing confirmations.

## Full 160-driver disposition

| Driver | Baseline | Cleanup | Baseline/replacement context |
|---|---|---|---|
| `tests/brush-feather-reference.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/brush-mask-interaction.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/brush-native-feather-reference.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/brush-native-shift-reference.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/brush-regional-erase-reference.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/bw-parity.js` | fail | fail | Four SDR filtered-channel cases still exceed unchanged pixel limits after recipe synchronization; all HDR cases pass. |
| `tests/clarity-map-parity.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/crop-apply-handoff.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/css-app-shell-matrix.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/curve-editor-interaction.js` | pass after test repair | pass | Exact section-order assertion now includes the documented B&W section; all curve/GPU checks pass at real DPR 2. |
| `tests/denoise-adaptive-parity.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/denoise-noise-view.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/denoise-pan-enable-drag.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/denoise-progressive-disclosure.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/denoise-tile-cache.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/denoise-tiled-parity.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/denoise-zoomed-region.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/detail-control-reference.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/device-loss-fallback.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/editing-peak-bounded.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/electron-context-isolation.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/export-file-browser-interaction.js` | fail after setup repair | fail | Four valid exports, but the small fixture's preview requests long_edge=70 below backend minimum 256, producing two HTTP 422 errors. |
| `tests/export-presets-interaction.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/exposure-bands-interaction.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/fine-adjustment-interaction.js` | pass after test repair | pass | Settings command and focus outside form controls restore the intended setup; all precision/snapping/curve/band assertions pass. |
| `tests/full-tier-brush-feather.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/full-tier-denoise.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/full-tier-preview.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/geometry-transactions.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/gpu-highlight-compression-parity.js` | fail | pass | Four direct Peak shader comparisons pass, but old exactly-one foreground reduction expectation measures zero; scope call also superseded. |
| `tests/gpu-scope-parity.js` | fail | fail | Synchronized SDR Exposure Bands peak differs by 4.71%, above unchanged 3% limit. |
| `tests/gradient-mask-interaction.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/gradient-transform-reference.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/grading-value-entry.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/grain-parity.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/in-app-confirmations.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/lane-roundtrip-interaction.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/local-adjustment-usability.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/local-adjustments-interaction.js` | pass after test repair | pass | Trace proved a queued prior highlight-anchor task advanced SDR generation during straighten. Wait for queued/in-flight anchors; all exact draft/crop/local assertions pass. |
| `tests/local-crop-anchor-interaction.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/local-design-qa.js` | fail | fail | Attempts toolbar conversion of a locked brush leaf; original clipboard reference images are also absent. Driver ran, assertions retained. |
| `tests/local-grade-reference.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/local-stack-sizing.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/luma-feather-quality.js` | pass after test repair | pass | Recognize actual gpu-resampled-luminance_range textures; unchanged warped-mask pixel limits pass (max differences 0.039 and 0.008 versus 0.06). |
| `tests/luma-graph-region-reference.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/luma-mask-interaction.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/luma-region-reference.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/mask-graph-interaction.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/mask-raster-reference.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/mask-resample-reference.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/media-browser-preview-interaction.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/native-region-stall.js` | fail | pass | Viewer converges and pool responds, but zero of required four pre-reader abandonments: current source-tile bodies drain; counter targets old proxy-stream route. Coverage gate retained. |
| `tests/neutral-color-grading-reference.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/path-feather-geometry.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/path-feather-mask-cache.js` | fail | pass | Requires CPU draft-mask endpoint activity during drag; current path rasterization is GPU. Original coverage assertion retained pending equivalent GPU leaf-identity protection. |
| `tests/path-mask-interaction.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/perspective-interaction.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/perspective-preview-ownership.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/pixel-magnification.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/preview-resolution-interaction.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/proof-size-interaction.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/scope-exact-peak.js` | fail | pass | Direct/tiled agreement and render isolation pass; editing Peak truthfully reports exact=false,bounded=true, contradicting the old exact=true assertion. CPU export/Proof unchanged. |
| `tests/scope-region-interaction.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/sdr-gamut-gpu-parity.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/sdr-match-gpu-interaction.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/session-replacement-interaction.js` | pass after test repair | pass | Synchronize native dirty state and select Cancel; start B only after A begins byte upload. Exact cancellation, retirement, serialization and failed-preparation assertions pass. |
| `tests/sharpen-blur-reference.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/slider-fill-anchoring.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/source-disclosures-interaction.js` | pass after test repair | pass | Import now reveals metadata; explicitly collapse before testing collapsed control. All six widths and original disclosure/layout assertions pass. |
| `tests/startup-state.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/status-manager-interaction.js` | pass after test repair | pass | Standalone manager used hidden browser Open Project as focus target. A visible test-owned target preserves and passes all lifecycle, timing and focus-restoration assertions. |
| `tests/technical-panel-fit.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/tiled-admission-scope-fallback.js` | fail | pass | Automatic refreshes supersede the explicit scope generation; CPU scopes settle but its call returns false. Assertions retained. |
| `tests/tiled-cpu-detail-parity.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/tiled-direct-parity.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/tiled-film-parity.js` | fail | fail | Idle anchor wait removes intervening presentation; spatial-max tileSize 512 differs at 20 pixels, maxDelta 4 against unchanged byte-exact zero limit. Other cases pass. |
| `tests/transport-pool-exhaustion.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/ui-refinement-detail-qa.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/webgpu-shader-compilation.js` | fail | fail | Local Sharpen Threshold 0/10/100 produces identical pixels; radius, ordering and CPU parity checks pass. Original minimum-change assertions retained; synthetic source may constrain sensitivity. |
| `tests/workflow-stage-overlays.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/zebra-overlay-live.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/zoom-refinement-stall.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/brush-pack-benchmark.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/brush-rejection-diagnostic.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/budget-route.js` | fail | fail | Auto restored at 200% presents in 37.9 ms but retained assertion expects direct rather than viewport tiled route; plan/readout and accepted execution differ. No limit or route assertion relaxed. |
| `tests/performance/clarity-radius-load.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/denoise-drag-region.js` | fail | pass | liveDenoiseRegion returns null without denoiseSourceSelector.original on current tiled path; driver requires whole-frame release reconstruction. Original assertions retained; viewport Denoise checks run separately. |
| `tests/performance/denoise-input-coalescing.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/denoise-memory-trace.js` | pass after test repair | pass | Browser localStorage did not set Electron budget; use real desktop preference controls and verify original 2 GiB. All original residency gates pass on 24 MP, 42 MP and 8K sources. |
| `tests/performance/denoise-native-intermediate-probe.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/denoise-scale-identity.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/denoise-selector-seam.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/denoise-stale-source.js` | fail | pass | Fails no denoise selector under current tiled path; both off/on renders succeed. Selector-specific stale-source assertions retained; no replacement coverage claimed. |
| `tests/performance/detail-band-probe.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/detail-cache-residency.js` | pass after test repair | pass | Browser localStorage did not set Electron budget; use real desktop preference controls and verify original 1 GiB. All original residency gates pass on 24 MP, 42 MP and 8K sources. |
| `tests/performance/drag-gpu-load.js` | fail | fail | Exposure 200% presents 2.4 fps, worst second 1 vs unchanged 30/20 fps floors; Fit 49.6 fps. Flight counter counts queue submissions/batches rather than complete frames (max 3). |
| `tests/performance/editing-peak-clarity-reference.js` | fail | fail | Primary default does not activate reduced-surround path. Active 42 MP four-mask fixture, Clarity Amount 100/radius 1.5%: worst anchor patch 0.516% > unchanged 0.50%; worst Peak 0.487%, overall maxima exact. No budget, pin or tolerance changed. |
| `tests/performance/editing-peak-diagnostic.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/exact-tier-latency.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/export-parity.js` | pass after test repair (measurement only) | pass | Initial Denoise error intermittent; sibling filtering driver captured noise-model HTTP409. Await recipe synchronization before enable; full six scenarios complete. Numeric comparison report has no enforced overall agreement gate. |
| `tests/performance/failure-taxonomy.js` | pass after test repair | pass | Inject same transport/validation errors into active tiled path and request a new render per original attempt. Transport remains recoverable; original three-validation disable, fallback and painted-frame gates pass. |
| `tests/performance/film-look-interaction.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/fit-filtering-ab.js` | pass after test repair (measurement only) | pass | Noise-model HTTP409 followed unsynchronized batch of synthetic controls. Await syncGlobalEditState before enable; all six scenarios complete, numeric differences reported without a general quality gate. |
| `tests/performance/full-tier-instrumented-tiling.js` | fail | pass | All eight explicit Full renders superseded-before-proxy after manual generation mutation; overlap includes rendered work and no device validation errors. No-refusal assertion retained, source of supersession not fully isolated. |
| `tests/performance/full-tier-tone-cost.js` | fail | fail | Requires 42 MP Full to tile at Fit; current viewport path accepts exact Full via Direct. Both tiers ready, zero CPU preview/scopes and zero blank samples; original tiled/settle-race coverage gates retained. |
| `tests/performance/gpu-linear-gradient-parity.js` | fail | fail | Analytic versus CPU bitmap gradient differs max 7.06348 linear units vs unchanged 1/255 gate; same result after pending draft/anchor work drains. GPU analytic route recorded; no tolerance changed. |
| `tests/performance/gpu-local-adjustments.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/halation-map-zoom.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/hardware-matrix-capture.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/headline-latency.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/heavy-project-baseline.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/heavy-project-control-sweep.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/heavy-project-drag-review.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/heavy-project-dynamic-sweep.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/heavy-project-long-session.js` | completed separately | pass | See audit/endurance section. |
| `tests/performance/heavy-project-viewer-tasks.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/high-impact-review.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/highlight-anchor-stability.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/highlight-ceiling.js` | pass after test repair | pass | One manual render refused while background draft/anchor work remained. Wait for idle and cancel setup scheduler; all original compressed ceiling gates and uncompressed negative control pass. |
| `tests/performance/local-mask-performance.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/luma-feather-latency.js` | fail | fail | Warm Feather p95 1005.6 ms > unchanged 1000 ms; median 959.6, cold 1146.6. Zero CPU masks/timeouts/untrusted inputs; grade-only warm p95 6.4 ms. |
| `tests/performance/many-local-layers.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/match-candidate-review.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/native-inspection-dpr.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/packaged-baselines.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/peak-readout-review.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/phase3-coverage-audit.js` | completed separately | pass | See audit/endurance section. |
| `tests/performance/phase3-local-route-smoke.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/phase3-manual-baseline.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/phase4-preview.js` | fail | pass | Legacy 2K desktop profile verifies migration and preference round-trip. Then old timing-model manipulation fails to produce Coarse within unchanged 30 s; current viewport path does not satisfy old forced coarse scenario. |
| `tests/performance/phase4-regression-browser.js` | fail | pass | Runs legacy Responsive/Balanced/Precise scenarios then requires Responsive coarse zoom pixels; current opt-in Faster Dragging and viewport route do not satisfy old assertion. Original measurement and coarse gate retained. |
| `tests/performance/phase5-endurance.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/phase5-inactive-lane.js` | pass after test repair | pass | Background setup cancels scheduled idle callback; drain draft/anchor work before scheduling test. Original 900 ms window, gate consultation/deferral and complete explicit Compare hold/release assertions pass. |
| `tests/performance/phase5-peak-agreement.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/phase5-transport-ab.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/presentation-gate.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/preview-export-compare.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/preview-performance.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/raw-import-baseline.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/responsiveness-probe.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/roi-catch-up.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/roi-pan-cache.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/roi-parity.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/roi-refinement.js` | fail | pass | Snapshot expected region immediately before measured pass: original 2% region and retained-frame gates then pass. Remaining assertion forbids interactive ROI, contrary to current viewport-bounded rendering. Gate retained. |
| `tests/performance/roi-source-transport.js` | fail | pass | Requires sourceRoute region; current 4096px source remains streamed/resident. Viewport requested, four foreground tiles, 36 skipped; original region-texture coverage gate retained, route optimization equivalence not claimed. |
| `tests/performance/tier-change-blank-canvas.js` | fail | pass | 4K-to-Full 857 ms, all nine compositor samples painted, zero blank/nothing/CPU preview. Current viewport uses Direct; original tiled-route coverage assertion retained. |
| `tests/performance/tier-film-consistency.js` | fail | fail | Diffusion mean disagreement 0.107980 vs bloom 0.086221 = 1.25236x > unchanged 1.25x; peak equal 32.667. Test documents prior Electron geometry sensitivity; no threshold or shader change. |
| `tests/performance/tiled-mask-batch-transport.js` | fail | pass | Requires CPU mask-tile batch activity for active local; current GPU mask path issues none. Original batching/transport assertions retained; equivalent negative transport coverage not invented. |
| `tests/performance/tiled-stop-gate.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/zoom-after-edit-review.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/zoom-block-continuity.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `tests/performance/zoom-cycle-profile.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `desktop/tests/confirmation-focus.js` | pass after test repair | pass | Visible import button precedes shell event binding. Wait for initialized application preferences before original File/Settings click; all native/in-app confirmation, checkbox focus and operation assertions pass. |
| `desktop/tests/electron-smoke.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `desktop/tests/highlight-lane-4k.js` | fail | pass | processedLongEdge replacement verifies WebGPU eligibility and 4K processing; remaining full 4K backing-canvas assertion contradicts viewport-bounded presentation. Failure exit now closes inherited pipe; assertion retained. |
| `desktop/tests/preview-diagnostic.js` | pass after test repair | pass | Waits for current exact requestedTier 4096 and reads Faster Dragging instead of retired tier/menu fields; bounded 60-second native sample completes with snapshots. Measurement recorder, not a pixel/performance gate. |
| `desktop/tests/preview-menu.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `desktop/tests/preview-restore.js` | pass after test repair | pass | Current exact requestedTier 4096 replaces retired refinement label; original canvas >2000, exposure edit, compare exit and inactive-lane peek restoration assertions all pass. |
| `desktop/tests/proof-grade-diagnostic.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |
| `desktop/tests/renderer-crash.js` | pass | pass | Original assertions pass; measurement-only reports are assessed separately. |

## Final fast checks and protected files

427 main Node checks and 36 additional desktop/performance checks passed (463 total). Python: 1,692 passed, the same three skipped. Final suites followed the stop-gate setup repair; subsequent edits only record measurements and documentation. Every GPU driver ran serially through Electron with a 2560x1440 window.

| Protected saved project | Final SHA-256 (unchanged) |
|---|---|
| D:\Photos\Play_Raw\Fantastic light over village - AdamFromCanada\DSC00950.hdrfinisher | `246ba308dcba22c5483c32ed4c31f5c81a2804504cd01dec2482b6d5be307d56` |
| D:\AI\AI Projects\HDR Finisher Tool\ai\codebase\local-test-media\viewport\DSC00264-four-masks.hdrfinisher | `3004b621783d77d7fefee6a1997392e1599954ab845b833208841fab1f4d1825` |
| D:\AI\AI Projects\HDR Finisher Tool\ai\codebase\local-test-media\viewport\DSC00264-fifty-locals.hdrfinisher | `00913f3d8214a211ff74d0791b5393dddf06c861e57994517354aa1a88e6acee` |
| D:\Photos\HDR Test Images\Denoise-stuck-DSC04761.hdrfinisher | `2dd3ef64d3b4127d5e793c6664b12075d4e203e19a746d55b92e317bf23daf86` |

## Headline confirmation

All four new baseline-passing warm latency targets missed again. These are CF-DRIFT-03 and remain unattributed. Successful recorder exits do not assert target compliance. No app fix, limit or recipe change was used. The complete three-way summary, including processed-pixel verdicts, is in `headline-confirmation-comparison.json`.

| Metric / temperature / zoom | Baseline p95 ms | First p95 ms | Repeat p95 ms | Baseline / first / repeat verdict |
|---|---:|---:|---:|---|
| slider-current-fit / cold / fit | 27.7 | 13.4 | 19.0 | pass / pass / pass |
| slider-refined-fit / cold / fit | 27.7 | 13.4 | 19.0 | pass / pass / pass |
| slider-refined-100 / cold / 100 | 29.0 | 94.1 | 46.8 | pass / pass / pass |
| slider-current-200 / cold / 200 | 17.7 | 22.4 | 22.9 | pass / pass / pass |
| slider-refined-200 / cold / 200 | 53.5 | 133.1 | 95.2 | fail / fail / fail |
| slider-refined-400 / cold / 400 | 189.4 | 79.0 | 172.0 | fail / fail / fail |
| slider-refined-800 / cold / 800 | 53.4 | 22.4 | 117.4 | fail / fail / fail |
| pan / cold / 200 | 11.4 | 14.2 | 13.5 | pass / pass / pass |
| view-change-actual / cold / 100 | 850.2 | 906.8 | 900.0 | fail / fail / fail |
| view-change-fit / warm / fit | n/a | n/a | n/a | no-target / no-target / no-target |
| slider-current-fit / warm / fit | 33.4 | 245.2 | 258.7 | pass / fail / fail |
| slider-refined-fit / warm / fit | 33.4 | 245.2 | 258.7 | pass / fail / fail |
| slider-refined-100 / warm / 100 | 53.9 | 138.4 | 108.3 | pass / fail / fail |
| slider-current-200 / warm / 200 | 85.2 | 178.9 | 124.0 | fail / fail / fail |
| slider-refined-200 / warm / 200 | 70.8 | 175.6 | 157.3 | pass / pass / pass |
| slider-refined-400 / warm / 400 | 83.8 | 126.6 | 101.9 | fail / pass / pass |
| slider-refined-800 / warm / 800 | 79.0 | 124.6 | 123.8 | pass / pass / pass |
| pan / warm / 200 | 11.2 | 15.2 | 15.0 | pass / pass / pass |
| view-change-actual / warm / 100 | 9.1 | 893.6 | 891.9 | pass / fail / fail |
| input-handler / warm / 100 | 8.6 | 5.8 | 5.9 | pass / pass / pass |

Warm 200/400/800% refinement limits depend on Fit p95 + 50 ms, so a slower Fit loosens those recorded targets; their pass verdicts do not establish an improvement. Cold refinement targets at those zooms are null in all three reports; the recorder labels them fail without a numeric target. The warm processed-pixel guards still fail (42,389,760 maximum pixels versus visible ROI sizes 487,407 / 122,220 / 30,618).

## Audit errors and focused confirmation

The full audits completed 6,618 rows: primary 1,250, four-mask 1,166 and fifty-local 4,202. All original row keys match, with no coverage added or removed. Each includes 312 Denoise rows. Zero CPU picture/scope requests remain zero for primary; four-mask CPU picture requests rose 3 to 4; fifty-local CPU scopes rose 9 to 12. These routes remain live and Group B stays held.

CF-DRIFT-04: rotated SDR compact-Haar color_noise took 582 ms in baseline, 15,013 ms in the first full audit and 575 ms in the focused confirmation. The 90-row rotate/SDR repeat completed with zero page errors and every row exact WebGPU; all matched timings/routes are in `coverage-outlier-confirmation-comparison.json`. The first outlier remains recorded as intermittent and unattributed. Other full-audit long tails include primary perspective SDR levels 1,817 to 7,634 ms and flip SDR chroma 595 to 3,558 ms; four-mask saved HDR compact-Haar enable 1,121 to 5,001 ms.

CF-DRIFT-05: the completed fifty-local repeat has one page error: edit revision mismatch, expected 3804/current 3805, during flip/SDR compact-Haar amount. In both/SDR, compact-Haar enable has an apply-settle TimeoutError and amount has a restore-settle TimeoutError, each at the original 120,000 ms guard. Its exit is zero but all-exact-WebGPU aggregate is false because the failed enable row has no completed presentation metadata. This does not establish a pixel defect in the other completed rows. The baseline has zero page errors. Normal completed rows retain GPU presentation.

The first fifty-local attempt is retained separately. It recorded an earlier revision mismatch 1087/1088 and perspective/SDR compact-Haar amount/luminance settle timeouts. The agent stopped that owned test after incorrectly interpreting generation churn as livelock; the preserved 3,275-row snapshot shows it had recovered before interruption. This was a premature agent stop, not evidence of a continuing app livelock. The original full command was then repeated unchanged to completion; no app/audit code change or state reset forced a green result. `fifty-local-interruption.json` preserves the correction and both live diagnostics.

## Endurance and broad timing movement

The 30-minute run completed 83 cycles / 1,345 operations in 30.349 minutes, compared with 85 / 1,378 in 30.261 minutes. No app or sampler errors; final picture/scopes settled. Final memory 4,378.6 to 4,376.0 MiB, maximum 4,394.5 to 4,395.0 MiB, no samples exceeded the 6,141 MiB budget. First/last ten-cycle current medians: HDR exposure 1,264.5 to 1,631 ms (+29%); HDR Clarity 1,209.5 to 1,468 ms (+21.4%); HDR brush 877.5 to 850 ms (-3.1%); 100% zoom 470 to 536 ms (+14%); Fit 70 to 78 ms (+11.4%). Baseline drift was +18.6%, +32.8%, +22.9%, +27.4% and +28.2% respectively; the brush starting value is slower now. CPU HDR scope requests 6 to 2; HTTP 409 counts 35 to 26, with no response bodies to prove their cause. CF-DRIFT-01 and CF-ROUTE-04/05 remain open. All 17 operations are compared in `endurance-comparison.json`.

All 53 broad control cases and 69 drag cases completed without recorder errors. Control exact-and-scopes p95 increased in 52/53 cases; largest increase HDR bloom 411.9 to 505.2 ms (+93.3), while HDR structural overlay decreased 4,148.3 to 3,800.5 ms (-347.8). Drag first-feedback increased in 26 cases, largest HDR Denoise 19.5 to 45.7 ms (+26.2). Scope-release increased in 22, largest HDR gradient fan 620 to 699.1 ms (+79.1). Perspective 1,664.6 to 1,332.6 ms and Straighten 1,364.7 to 1,356.8 ms remain slow. `heavy-control-drag-comparison.json` retains all 122 case comparisons, in both directions.

No baseline-passing driver exit remains newly failing after the five documented test setup repairs. Baseline 132 passed / 28 failed becomes 147 / 13. New measured target misses and audit errors still prevent the phase 4 green exit and any blanket behavior/timing equivalence claim. Existing findings remain carried forward; further removals or defect fixes require a separate authorized batch.
