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

The table below records the initial work inventory; completed replacements are recorded by batch below. Replacement goals below require
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

## Test synchronization batch

Both named timing-race drivers are rewritten and pass their original gates.
No test retired. Detail and first-attempt failure are recorded in PRD 16.1.
Fast suites: 463 Node pass, Python 1,692 pass with three skips.

## Viewport presentation batch

roi-refinement, highlight-lane-4k and tier-change-blank-canvas are rewritten
and pass. Original tiled blank-frame coverage is retained; Auto is also tested.
PRD 16.2 records all replacements and measurements. No tests retired.

## Faster Dragging batch

phase4-preview and phase4-regression-browser now exercise the current on/off
control and pass. Coarse presentation remains positively tested with a learned
slow-graph sample; Balanced cold-start exactness is no longer mistaken for a
regression of the old Responsive mode. Legacy CLI aliases remain supported.
Migration, preference round-trip, exact pixel equality, latest-generation
reversal, native processing, warm source-mip reuse and off-mode exactness gates
remain. The Electron runner seeds the migration fixture only in the fresh
profile it creates; existing externally supplied profiles are not written.
PRD 16.3 records the measurements. No checks retired or app code changed.

## Mask cache and fallback batching batch

path-feather-mask-cache now runs the normal GPU route by default and also
supports an explicit CPU fallback scenario. The GPU guard requires current
live Feather values and prevents one cached mask entry being reused for two
Feather identities. The original CPU draft and acknowledgement checks remain
in the fallback run. tiled-mask-batch-transport disables analytic rasterization
only in its test session to exercise reachable CPU batching, preserving every
original transport, ROI, submission and offscreen-pixel gate. Both routes and
the batching driver pass. No CPU mask code deleted; PRD 16.4 has measurements.
Fast suites: 463 Node and 1,692 Python checks pass, same three skips.

## Drag frame counter replacement

The old drag probe counted each GPU queue submission as a whole frame. The
replacement observes the original outer viewer-render promise without changing
it, and reports queue submissions separately. It observes one viewer request
at a time at Fit and 200%, with positive observed-frame coverage. All 60 fps
cap, one-frame, 30/20 fps floors and default no-coarse guards remain. The driver
still fails CF-SPEED-01 at 200%; no red gate hidden or app fix introduced.
PRD 16.5 records the original-counter control and every measured movement.

## Source ownership and cold ROI transport batch

native-region-stall now observes delivered source responses spanning a viewer
change, including the current source-tile drain path. It requires at least
four cleaned responses, rejects any unread delivered superseded response, and
keeps the pool/no-wedge/exact-convergence gates. Actual header synchronization
and fresh picture generations ensure the warm viewport cache cannot make the
coverage vacuous. Two final runs clean 16 responses and pass.
roi-source-transport explicitly evicts the whole source after its reference
pass to test cold ROI uploads, while retaining zero-tolerance pixel parity and
all original byte bounds. Real settings prevent later preference callbacks
resetting its processing tier. Whole and streamed display mip routes are
accepted with the same exact-size and zero-cold-build/zero-generated-byte gates.
Both drivers pass, fast suites pass (463 Node; 1,692 Python, same three skips),
and all four protected fixture hashes remain unchanged. PRD 16.6 has details.


## Bounded editing Peak check

scope-exact-peak retains exhaustive Direct/tile arithmetic and measurement
isolation. It requires positive native-patch analysis inside the original
4,194,304-pixel budget and truthful estimate labels. A deliberate measurement
refusal replaces the obsolete legacy-flag-off proxy-label scenario, retaining
positive preview fallback disclosure. Pattern run passes; optional real-photo
under-report coverage remains available. PRD 16.7 records measurements and
failed setup attempts. No Peak implementation or shader changed.

The additional DSC00950.ARW run also passes, including positive proxy
under-report coverage (3.44%). Fast suites: 463 Node / 1,692 Python pass,
same three skips.


## Full tiled settle check

full-tier-tone-cost now guarantees its original tiled scenario using the real
1 GiB preference and waits for the requested tier. Three runs reproduce the
settle overlap, inside the original 4x timing limit, with zero blank frames
and no CPU picture HTTP requests. The driver stays red: interactive refusal
happens after dispatch (CF-ROUTE-06); two repeats enter the CPU settle branch
for coalesced-by-newer-render (CF-ROUTE-07). Original guards remain, no app fix
or retirement. PRD 16.8 records Auto baseline/control and forced-budget data.
Fast suites pass (463 Node; 1,692 Python, three skips); fixtures unchanged.


## Memory-budget route and readout check

budget-route checks accepted native viewport execution and retains the original
Auto/1 GiB admission switch at Full/Fit, with unchanged one-second limit and
positive new/exact presentation requirements. Both repeats accept all expected
routes and timings, but fail CF-ROUTE-08: the UI says Direct while the viewer
accepts Tiled. The last auxiliary plan can overwrite the readout. No app fix
or check retirement; PRD 16.9 records baseline/control/current measurements.

Budget batch fast suites: 463 Node / 1,692 Python pass, three skips.


## Denoise region and freed-source batch

Both Denoise drivers pass with current-route coverage. stale-source retains
Direct off/on validation after actual cache eviction and requires live-copy
adoption; added viewport Tiled off/on redraws pass too. drag-region observes
actual shared-encoder regional reconstruction, keeping positive work/no-whole
checks and stale/final-control guards. The subsequent Full/Fit view equals a
fresh reconstruction over all 15,360,000 values with zero tolerance. Failed
setup attempts are retained. No source/cache/Denoise implementation deleted;
PRD 16.10 records route differences from the baseline and final results.

Denoise batch fast suites: 463 Node / 1,692 Python pass, three skips; all
four protected project hashes unchanged.


## Deferred highlight anchor check

gpu-highlight-compression-parity passes twice. Four original shader numeric
comparisons, scope resolution/identity and stale/current recovery guards remain.
The obsolete foreground-one-reduction assumption is replaced by positive
pending work during interaction and exactly one bounded canonical measurement
after release, inside the unchanged pixel budget. The old unused measurement
wrapper stays held; no Peak implementation or shader changed. PRD 16.11 has
the baseline/current route comparison.

Highlight batch fast suites: 463 Node / 1,692 Python pass, three skips.


## Local design workflow batch

Pending-adjustment selection and committed path setup now match the live UI;
assigned tool locking is positively checked after assignment completes. All
original visual guards remain. The driver stays red for CF-DRIFT-02; original
switch geometry differs, and four original reference images are absent. A
non-gating diagnostic records further UI contract mismatches and a timeout.
No app fixes or test retirement. PRD 16.12 records the evidence.

Local design batch fast suites: 463 Node / 1,692 Python pass, three skips.


## Full-sweep path-node timing repair

local-adjustment-usability waits for preceding viewer/mask work and current
geometry mapping before calculating the real node click. Added positive tangent
overlap guard; all original assertions retained. Two repeats pass. Original
sweep failure/repeat and pointer diagnostic retained. See PRD 16.13.

Path-node batch: actual sweep driver passes; fast suites 463 Node / 1,692
Python pass with the same three skips. No app changes or fixture writes.


## Full-sweep path layout setup repair

Completed-path pointer coordinates and manual letterbox fixtures wait for
preceding viewer/mask/anchor/scope work and current geometry mapping. All
original gesture/pixel/hover/submask guards remain; two diagnostics pass.
Initial sweep/repeat failures retained. See PRD 16.14.

Path-layout batch: actual sweep driver passes; fast suites 463 Node / 1,692
Python pass with the same three skips. No app or fixture changes.


## Full-sweep manual Detail capture setup

Drain all automatic picture/scope/anchor work before cancelling deferred
refresh/pan/catch-up and manually capturing Direct/Tiled. Original alignment,
distribution and 0.5 seam limits retained; synchronized diagnostic matches
baseline rounded seams. Original failed capture/repeat evidence kept. PRD 16.15.

Detail capture batch: actual sweep driver passes; fast suites 463 Node /
1,692 Python pass with the same three skips. No app or fixture changes.


## Full-sweep Detail residency setup

Drain automatic picture/scope/anchor/mask work before manual residency renders.
Original Tiled/cache-trim/memory/spread guards retained. Diagnostic stays within
all original limits; peak residency endpoints increase 18.9/38.8 MB while
working-set endpoints are unchanged. Initial failure/repeat retained. PRD 16.16.

Residency batch: actual sweep driver passes with diagnostic-identical
894.2-967.8 MB range; fast suites 463 Node / 1,692 Python pass, three skips.
