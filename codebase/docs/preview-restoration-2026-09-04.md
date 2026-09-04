# Preview resolution stall after comparison

The user reproduced a persistent low-resolution preview in the GPU-enabled diagnostic instance with `freeze-test-DSC04375.hdrfinisher`. The trace records exposure editing, then returning from comparison to Single frame. The selected target remained 4096, but the actual canvas and accepted presentation were 634 × 976. Geometry tools were inactive, edits were synchronized, and neither the scheduler nor the GPU had work in flight.

`showCachedPreview` used `renderGpuDraft` without an explicit resolution, defaulting to the display-bounded settled proxy. Returning from comparison, ending a comparison peek, or cancelling an unchanged Perspective draft could therefore replace a refined image with a low-resolution frame without scheduling refinement. Perspective reduced the final 4096 proxy to 2535 × 3904; comparing its actual dimension with the requested 4096 did not recognize it as a resident target-resolution frame.

Restoration now explicitly requests the selected refinement proxy and marks it as the refinement tier. A low-resolution CPU cache restored to the active lane schedules refinement. The geometry ownership guards remain in place.

Validation: `desktop/tests/preview-restore.js` opens the supplied project in an isolated packaged Electron profile with GPU enabled, selects 4K, edits exposure in comparison view, and returns to Single frame. The original 0.8.9 code failed the 15-second refinement assertion and remained at 634 × 976. Replacing only the restoration function with the corrected source passes both Single-frame restoration and comparison-peek restoration, with a 2535 × 3904 canvas. JavaScript syntax and diff whitespace checks pass.

The intermittent native dropdown-opening delay was not reproduced by this test and is not claimed fixed. This correction is in source and was applied through the debugger to the existing diagnostic window; the installed 0.8.9 executable is unchanged.

## Installer 0.8.10

Built `dist-electron/0.8.10-preview-fix/HDR-Finisher-Setup-0.8.10-x64.exe` and its SHA-256 sidecar. Packaged version and frontend/main source contents were verified. All 18 desktop tests pass. The packaged GPU regression, without debugger replacements, passes with an asserted exposure change through the actual keyboard control, then Single-frame and peek restoration at 2535 × 3904. The initial direct-function exposure test timed out before comparison restoration; the final test exercises the complete input gesture lifecycle rather than invoking the adjustment function alone.
