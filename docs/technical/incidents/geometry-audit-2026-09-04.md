# Crop & Rotate / Perspective audit — 4 September 2026

The source fixes the reproduced renderer OOM and additional geometry defects found while tracing the frontend transactions through the backend rendering pipeline. This is a source change; the installed application has not been updated, and the crashed instance was not closed or reloaded.

## Confirmed crash cause

The debug renderer's Crashpad annotations report approximately 4,053.5 MB of live V8 heap against a 4,082.4 MB heap capacity. Its stack includes `syncGlobalEditState` and `refreshScopes`. Crop & Rotate Reset can leave global edits dirty while an open Perspective draft deliberately defers synchronization. Scope refresh then repeatedly retried the immediately resolved synchronization promise, starving input and retaining a growing promise chain. The edit-command preflush had the same retry hazard, including on rejected synchronization.

Retries now stop when synchronization fails or remains deferred. This explains the captured debug-instance crash despite the computer having 64 GB of RAM. The earlier installed-instance failure during OBS recording had no renderer dump, so the evidence does not establish that it had the identical cause.

## Corrections

- Geometry drafts own their preview until Apply or Cancel. Ordinary CPU/GPU rendering, refinements, cache restoration, and late asynchronous completions cannot replace a draft or label committed pixels with a draft signature.
- Rotate synchronization is deferred like Perspective. Lane changes resolve the Rotate draft before saving global edits. Cancel schedules any unrelated dirty grading work that still needs rendering.
- Crop & Rotate Reset refreshes an open Perspective draft and preserves its separate reset if Perspective is subsequently cancelled. The reset confirmation no longer incorrectly claims the operation cannot be undone.
- Guide solves reject responses after Cancel, Reset, new geometry/guide input, reopening a draft, or replacing the source. Failed solves leave Apply pending instead of silently closing and committing the draft.
- Successful solves return a coordinate transform for the guide overlay, preventing repeated correction when another pair is applied. Guides crossing the corrected image boundary are clipped without changing their slope; unusable guides are retired with an explanatory status message.
- Guide handles remain mounted during movement, preserving keyboard focus and pointer capture. Pointer cancellation ends crop and guide drags.
- Edit-command and edit-state responses preserve open geometry drafts. Responses and queued work belonging to a replaced session are rejected. Source replacement/ejection retires old tool snapshots before installing the next document.
- Encoded previews without dimension headers use their decoded dimensions, allowing the geometry handoff to finish and restoring zoom input.
- The backend supplies full-resolution geometry output dimensions without allocating a full-resolution image. Crop aspect and 100% zoom use those dimensions, including perspective, combined roll, and existing crops.
- Perspective roll compensates for unequal normalized X/Y pixel scales. It now performs a rigid rotation on portrait and landscape images instead of distorting the image. Existing edits combining keystone correction and nonzero roll can consequently render differently with the corrected math.

## Validation

- **163 Python tests passed:** geometry audit, advanced finishing, render cache, and API suites. New coverage includes 80 dimension/render parity combinations, 12 rigid-rotation cases, and repeated-guide stability in both portrait and landscape orientations. Existing coverage checks coordinate-map round trips, clockwise quarter turns, invalid requests, stale revisions, transient solves, and geometry-fixed GPU proxies.
- **10 Node tests passed:** bounded synchronization retries and native renderer-failure diagnostics. Six retry cases previously exposed the original unbounded loop.
- **Five browser regression suites passed:** geometry transactions, Perspective preview ownership, Perspective interaction, crop preview handoff, and source-anchored local adjustments. These cover delayed/failed solves, draft preservation, source replacement, module-specific Reset, crop ratios with combined geometry, encoded-preview zoom, Apply/Cancel, lane switching, and Undo/Redo.
- JavaScript syntax and `git diff --check` passed. The Python run reported one existing Starlette/httpx deprecation warning.

The browser regression reproduces the reported cross-module reset state and verifies that an event-loop timer still runs. This is not a claim that every possible defect has been eliminated. A fresh instrumented desktop run with the user's RAW image and OBS workflow remains the end-to-end confirmation for the installed application's original incident.
