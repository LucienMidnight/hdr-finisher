# Phase 4 cleanup inventory - October 5, 2026

Status: Steve approved Group A and it is implemented and validated. Group B
remains held. This is the first bounded batch, not a claim that the entire
preview has been audited.

Repository: branch `viewport-bounded-preview-phase-2-wip`, HEAD `ccf2fb5`,
clean before inventory, four commits ahead of origin. No reset, push or build.
Baseline: October 5 phase 3 evidence and PRD 15.7. The baseline has 28 failed
GPU/Electron drivers; cleanup cannot claim they were green before it began.

## Group A - first approval requested: unused preview wrappers

| Candidate | Why it is unnecessary / evidence | Size | Risk if the evidence is wrong |
|---|---|---|---|
| `frontend/app.js:4479`, `roiPanCandidate`, including its preceding comment | App no longer calls this wrapper. Coordinator `panCandidate` is called directly by its own pan scheduling/refinement paths (`render-coordinator.js:535,564`). Repository-wide name search finds only the definition. | 14 lines / 597 UTF-8 bytes, excluding separator blank line | An unrecorded external diagnostic calling the global wrapper would fail. Removing the coordinator implementation would break pan refinement; that implementation stays. |
| `frontend/webgpu-preview.js:1315`, `admitDirect` | Unused forwarding method to `planRender(...).decision`. The active renderer calls `planRender` at line 5340; admission tests exercise that implementation. Repository-wide search finds the definition and historical documentation, no executable caller. | 3 lines / 116 UTF-8 bytes, excluding separator blank line | An external console tool calling this method would fail. Actual render admission would break if the planner were removed; it stays. |

Total executable/comment removal proposed: 17 lines / 713 bytes, plus optional
adjacent separator blank lines. This is a modest first batch, justified by
static caller evidence rather than by assuming all CPU-era machinery is dead.

One Python source assertion in `test_frontend_source_workflow_contract.py:429`
currently checks a delegation string inside the unused pan wrapper. Replace it
with assertions on the actual coordinator pan predicate and its scheduling /
refinement callers, while preserving the app pan-intent delegation checks.
Existing behavioral `render-coordinator.test.js` pan checks remain. No test is
retired, no gate or tolerance is loosened. The historical admission documents
remain historical records, not evidence of a current caller.

After approval: one local commit for this batch after the Node and .venv Python
fast suites. Serialized slow checks run once per approved group. The final
full driver sweep and all three coverage audits must still be compared against
the baseline; no behavior comparison has yet been performed.

## Group B - found, held for investigation; not proposed for deletion

- `copySourceChunkStaged` and `releaseSourceStaging` in `webgpu-preview.js` have
  no source/test callers. The real `source-transport.js` functions are called
  directly from stream/strip/region loaders. Hold these wrappers because the
  source transport area intersects CF-ROUTE-03 and CF-ROUTE-05. Do not change
  either implementation before the relevant finding is confirmed or Steve
  explicitly resolves that restriction. A wrong deletion could break a hidden
  transport caller; deleting the live implementations would break uploads.
- `scheduleHighlightMeasurement` has no production caller, but a Python test
  requires its declaration and a GPU test awaits `pendingHighlightMeasurement`.
  It concerns the carried Peak/anchor findings and the deferred automatic anchor
  work. Hold the method, fields and tests. Current bounded anchor measurement
  must be traced and its equivalent coverage demonstrated first.

## Keep: live paths and useful test access

- CPU preview/device-loss fallback, masks, scopes and whole-source transport:
  the baseline records actual calls (CF-ROUTE-01 through 05). They are not dead.
- Cancellation and shared backend mask compiles: the baseline records CPU mask
  requests, intentional aborts and superseded work. Smaller GPU work does not
  establish that these fallback protections are unnecessary.
- Cache eviction: source/detail/Denoise/mask caches still register, pin and
  evict real GPU allocations. Keep budget and ownership protections.
- `HDRLatestWorkQueue`: instantiated by `denoiseInputQueue` in app.js:10636.
  Current Denoise inputs still coalesce; keep it and its behavior tests.
- Background mask coordination: active render dispatch cancels it at
  app.js:11422. No dead-prewarming claim established.
- `readLocalMaskRegion`: used by preview/export comparison and mask-reference
  drivers. `newMaskLeaf`: used by session replacement interaction. Neither is
  dead just because production callers are absent.
- `scopeHdrCeiling`: unused wrapper, but general UI housekeeping rather than
  a demonstrated consequence of viewport rendering; outside this first batch.

## Old-design checks: replacement work inventory, no retirement proposed

Every entry from PRD 15.7 remains pending. Replacement goals below require
inspection of each driver's original assertions before implementation.

| Checks | Coverage to preserve in the current design |
|---|---|
| `desktop/tests/highlight-lane-4k.js` | Actual 4K processing and highlight lane availability, with viewport-sized presentation. |
| `gpu-highlight-compression-parity.js`, `scope-exact-peak.js` | Unchanged Peak pixel gates, isolation and truthful bounded/exact measurement evidence. Hold changes overlapping open Peak/scope findings. |
| `local-design-qa.js` | Supported leaf editing and clipboard/reference checks; missing reference assets must remain an explicit limitation until restored. |
| `native-region-stall.js`, `performance/roi-source-transport.js` | Active source-tile cancellation/transport behavior and responsive backend pool, with real route evidence. |
| `path-feather-mask-cache.js`, `performance/tiled-mask-batch-transport.js` | Leaf identity/cache invalidation and actual GPU versus CPU mask transport; retain coverage of reachable CPU batching. |
| `performance/budget-route.js` | Budget admission and accepted execution agree; viewport tiling replaces old whole-frame Direct assumption. |
| `performance/denoise-drag-region.js`, `performance/denoise-stale-source.js` | Region release reconstruction and stale-source rejection under tiled Denoise, not selector existence. |
| `performance/full-tier-tone-cost.js`, `performance/tier-change-blank-canvas.js` | Correct Full processing, no blank frames, original timing limits and absence of unexpected CPU work. |
| `performance/phase4-preview.js`, `performance/phase4-regression-browser.js` | Preserve preference migration/round-trip and pixel/timing protections; exercise current Faster Dragging behavior. |
| `performance/roi-refinement.js` | Visible-region correctness and retained-frame protection on interactive viewport passes. |
| Flight counter in `performance/drag-gpu-load.js` | Count complete frame lifetimes rather than queue submissions; retain 30/20 fps floors and CF-SPEED-01. |
| `tiled-admission-scope-fallback.js`, `performance/full-tier-instrumented-tiling.js` | Repair test synchronization, preserving fallback/presentation/admission assertions; no app fix. |

Keep all CF-PIX, CF-PEAK, CF-SPEED, CF-ROUTE and CF-DRIFT items open, with
unchanged limits. No shader, budget, project/preference format, CPU export or
Proof change is proposed. Known-limitations refresh and PRD section 16 are
owed after validated cleanup; neither should claim completion now.

## Group A completed validation

Removed both wrappers and their separator blank lines (19 source lines total).
Updated the pan contract check as proposed; no test retired. Node: 427 pass.
Python: 1,692 pass, same three skips. Additional desktop/performance Node checks: 36 pass. Electron device-loss and roi-pan-cache:
pass, serialized at 2560x1440. All four fixture hashes match the baseline.
Pan1/pan2 counters and accepted frame facts match exactly; session-relative
stage timestamps moved from 4,283/4,438 ms to 4,979/5,139 ms. These are not
isolated latency measurements. No controlled timing comparison claimed.
Full sweep and three audits are pending; phase 4 is not complete.
Evidence: codebase/output/performance/review/phase4-cleanup-2026-10-05/.
