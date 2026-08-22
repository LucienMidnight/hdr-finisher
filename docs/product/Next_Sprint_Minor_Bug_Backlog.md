# Next Sprint Minor-Bug Backlog

**Started:** August 17, 2026
**Updated:** August 22, 2026
**Status:** MINOR-01 through MINOR-07 and MINOR-09 resolved in code; MINOR-08 investigated and shelved; MINOR-09 physical browser acceptance pending
**Target:** Next implementation sprint

## Bugs

### August 19 implementation summary

| ID | Status | Resolution summary |
|---|---|---|
| MINOR-01 | Implemented in 0.3.5 | Manual source interpretations are reported as manual and retain the selected primaries and transfer function. |
| MINOR-02 | Resolved / user-verified | Added deterministic one-LSB sRGB dither before the JPEG Ultra HDR RGBA8888 endpoint is quantized, breaking long gradient plateaus without materially changing authored color. |
| MINOR-03 | Resolved / user-verified | Made EXR drag-and-drop preserve the real file path by resolving each Electron `File` individually; retained a byte-stream fallback for genuinely pathless shell/catalog drops. |
| MINOR-04 | Resolved / user-verified | Carried native Save As overwrite approval into export with a target identity check. Windows now compares the cross-runtime-stable file ID, size, and timestamp, avoiding a second frontend prompt while retaining replacement safety. |
| MINOR-05 | Resolved / user-verified | Committed pending global edits before lane changes, made scopes wait for the selected lane's presented preview, and prevented GPU scope readback from sampling a canvas belonging to the other lane. |
| MINOR-06 | Resolved / user-verified | Strengthened narrow Gain Range response with a smooth width-dependent mask exponent in matching CPU and WebGPU paths, preserving a useful peak effect without hard transitions. |
| MINOR-07 | Resolved / user-verified | Newly inserted curve points now enter the existing pointer-captured drag lifecycle immediately, so creation and positioning work as one gesture. |
| MINOR-08 | Shelved / no reproducible defect | Matched JPEG Ultra HDR and AVIF exports from the reported Display P3 Linear EXR were functionally equivalent in independent reconstruction and user-observed browser rendering. Slight dark-region variation remained within expected codec/adaptive-rendering differences; no encoding or test change was justified. |
| MINOR-09 | Implemented / visual acceptance pending | Constrained JPEG Ultra HDR's 8-bit content-boost range to four stops around unity, expanding for higher authored peaks, after a real export used a pathological 21.6-stop map and showed Safari patching. AVIF already trims range outliers; JPEG XL has no gain map. |

Validation also resolved defects discovered while testing this set: the Affinity portrait EXR no longer inherits a stale landscape fit ratio; the WebGPU HDR shader compiles after the narrow-gain change; native Electron clipboard copying is used for source and export paths; and imported EXR scope statistics remain tied to the correct HDR/SDR lane after manual Display P3 Linear interpretation. Focused Python, frontend-contract, desktop, browser-interaction, and live Windows HDR checks passed.

### MINOR-09 — JPEG Ultra HDR extreme gain range causes browser noise

**Priority:** Minor / delivery fidelity
**Status:** Implemented August 22, 2026; physical Safari/Chrome acceptance pending
**Area:** JPEG Ultra HDR export
**Reported fixture:** `DSC01286.hdrfinisher` / Sony `DSC01286.ARW`

**Finding**

The original `4571 x 5714` export was a valid Ultra HDR JPEG, but its 8-bit map
covered `-14.3` to `+7.29454` stops while its authored HDR capacity was only
`+2.3183` stops. Safari 26.5.2 showed patchy noise and Chrome showed milder
noise. The full gain range allowed near-zero per-channel ratios to reduce
precision across the useful map.

**Resolution**

JPEG Ultra HDR now sends libultrahdr a minimum content boost of `0.0625x` and a
maximum of `16x`, increasing the maximum when required to contain the measured
HDR peak. This preserves four stops of intentional darker/brighter per-channel
separation and retains a three-channel gain map. It does not modify the rendered
HDR or SDR branches. AVIF remains on libavif's existing per-channel 0.1% outlier
trimming and 10-bit map; JPEG XL remains direct PQ.

**Validation**

- Unit coverage verifies normal and greater-than-four-stop peak bounds.
- A real libultrahdr encode/probe/decode test verifies emitted range metadata
  and successful HDR reconstruction.
- The matched project export reports `GainMapMin=-4`, `GainMapMax=4`, and
  `HDRCapacityMax=2.3183`, with both Ultra HDR v1 and ISO 21496-1 metadata.
- The full-resolution quality-100 candidate is 31 MB versus 9.3 MB before the
  range constraint; Web Default/Optimized preset size and physical Safari and
  Chrome appearance remain explicit acceptance checks.

### MINOR-01 — Manual source primaries are reported as auto-detected

**Priority:** Minor / user-trust
**Status:** Implemented in 0.3.5
**Area:** Import and source interpretation
**Reported fixture:** Affinity test file without clearly identified source primaries

**Reproduction**

1. Import the Affinity test file whose primaries cannot be determined confidently.
2. Set the source color primaries manually.
3. Apply the source-interpretation settings.
4. Reopen or inspect the source-settings message.

**Current behavior**

The UI said: `Auto detection found a consistent source interpretation.`

This was inaccurate because the active source interpretation came from an explicit manual choice, not automatic detection.

**Expected behavior**

The status must reflect the persisted interpretation mode. When a manual interpretation has been applied, show a message such as:

`Manual source interpretation applied: Display P3 primaries + Linear transfer.`

The message should substitute the actual selected primaries and transfer function. It must not claim that automatic detection succeeded while `session.source.interpretation_mode` is `manual`.

**Likely implementation site**

`syncInterpretationControls(session)` chooses its note from the persisted interpretation mode before considering `session.analysis.needs_color_override`. `overrideMessage(session)` follows the same rule so the two source-interpretation messages cannot disagree.

**Acceptance criteria**

- Applying a manual primaries/transfer selection immediately produces a clearly labelled manual status.
- The status includes the active primaries and transfer function.
- Reopening the project or source settings preserves the same truthful manual status.
- Returning to Auto restores the appropriate ambiguous or consistent auto-detection message.
- Frontend contract coverage distinguishes manual, ambiguous-auto, and consistent-auto states.

### MINOR-02 — JPEG Ultra HDR Chromium proof shows visible banding

**Priority:** Minor / proof fidelity
**Status:** Resolved / user-verified August 19, 2026
**Area:** Chromium proof and JPEG Ultra HDR delivery
**Working comparison:** AVIF proof appears correct without visible banding

**Reproduction**

1. Open Chromium Proof.
2. Select `JPEG Ultra HDR` as the delivery format.
3. Refresh the proof and open it in Chrome.
4. Inspect smooth gradients and tonal transitions.

**Current behavior**

The JPEG Ultra HDR proof displays visible tonal banding in Chrome. Rendering the same proof as AVIF appears smooth and correct.

**Expected behavior**

JPEG Ultra HDR proofs should preserve smooth gradients and tonal transitions closely enough to serve as a trustworthy browser-delivery proof, without format-specific banding that is absent from the AVIF version.

**Investigation notes**

Compare the JPEG Ultra HDR encoder settings, SDR base precision, gain-map precision, color conversion, metadata, and Chrome decode path against the working AVIF proof. Determine whether the banding is introduced during encoding, gain-map reconstruction, or browser presentation.

**Acceptance criteria**

- The same proof scene can be compared in JPEG Ultra HDR and AVIF without obvious additional JPEG Ultra HDR banding.
- Smooth sky, shadow, and highlight gradients remain visually continuous in Chrome.
- The delivered JPEG retains valid Ultra HDR metadata and gain-map behavior.
- Add a gradient-heavy proof fixture or equivalent regression check for the JPEG Ultra HDR path.

### MINOR-03 — OpenEXR cannot be drag-and-dropped on Windows

**Priority:** Minor / import reliability
**Status:** Resolved / user-verified August 19, 2026
**Area:** Windows desktop drag-and-drop ingestion
**Affected format:** OpenEXR (`.exr`)

**Reproduction**

1. Launch the packaged Windows application.
2. Drag an `.exr` file from Windows Explorer.
3. Drop it anywhere on the application surface.

**Current behavior**

The dropped OpenEXR file is not imported.

**Expected behavior**

OpenEXR should follow the same Windows drag-and-drop ingestion path as every other supported source format and begin importing when dropped anywhere on the application surface.

**Investigation notes**

Check both Electron path-backed drops and the pathless streamed-file fallback. Compare the failing EXR path with the packaged TIFF and AVIF drop cases already covered by the Windows desktop smoke test. Confirm that the original filename and `.exr` suffix survive resolution or streaming so backend format detection selects the OpenEXR loader.

**Acceptance criteria**

- A supported `.exr` dragged from Windows Explorer imports successfully in the packaged Windows application.
- Dropping over the viewport, either rail, or another application-surface element produces the same result.
- Both path-backed and pathless-file drop handling preserve the filename and OpenEXR extension.
- Native Import and drag-and-drop produce the same source interpretation and image metadata for the same EXR.
- Add packaged desktop regression coverage using a small deterministic EXR fixture.

### MINOR-04 — Windows export asks twice before overwriting a file

**Priority:** Minor / export UX
**Status:** Resolved / user-verified August 19, 2026
**Area:** Windows desktop export and overwrite confirmation

**Reproduction**

1. Launch the packaged Windows application and open an image.
2. Start an export.
3. In the native Save dialog, select an existing file as the destination.
4. Approve the Windows overwrite warning.
5. Continue the export.

**Current behavior**

The user is asked to approve the overwrite twice: first by the native Windows/Electron Save dialog and again by the frontend `window.confirm` prompt after the backend returns `overwrite_required`.

**Expected behavior**

An export initiated through the desktop Save dialog should ask for overwrite approval exactly once. Approval in the native dialog should be carried through the desktop export request without immediately prompting again. Browser and direct-path exports that did not receive native overwrite approval must retain an explicit confirmation before replacing an existing file.

**Likely implementation sites**

`desktop:choose-export-path` returns the path selected by Electron's `dialog.showSaveDialog`. `exportCurrentSession()` then sends its first backend request with `overwrite: false`, receives an `overwrite_required` conflict for an existing destination, and displays `window.confirm`. Coordinate these layers so the desktop path records or conveys the user's native approval while the backend remains authoritative about replacement safety.

**Acceptance criteria**

- Selecting an existing destination in the packaged Windows Save dialog produces only the native overwrite confirmation.
- Approving that confirmation completes the export without a second frontend modal.
- Rejecting or cancelling the native confirmation leaves the existing file unchanged and does not start encoding.
- Browser/direct-path export still requires one explicit confirmation before overwriting an existing file.
- A destination that appears or changes after path selection is handled safely without silently overwriting an unapproved file.
- Add packaged Electron coverage for approve, cancel, and non-existing-destination export paths, plus frontend/backend coverage for the non-native overwrite flow.

### MINOR-05 — HDR result and scopes change after an HDR/SDR tab round trip

**Priority:** Minor / preview and scope trust
**Status:** Resolved / user-verified August 19, 2026
**Area:** HDR/SDR lane switching, preview synchronization, and live scopes
**Reported evidence:** Rainy street image; both conflicting scope states were labelled `HDR Settled`

**Reproduction**

1. Open the reported image in the HDR lane.
2. Interact with Compression Bias or another HDR control and allow the preview and histogram to report `Settled`.
3. Record the HDR image appearance and histogram peak.
4. Switch to the SDR Controls tab.
5. Switch back to the HDR Controls tab without changing any HDR setting.

**Current behavior**

The HDR image and its histogram change after the tab round trip even though the displayed HDR settings have not changed. In the reported capture, the first settled histogram showed a `1434 nit` peak; after switching to SDR and back, the settled peak became `549.9 nit`. Compression Bias remained at `-3`.

The same lane-switch change occurs when Highlight Compression is turned off, so the problem is not limited to the Peak Fit curve or Compression Bias calculation.

**Expected behavior**

Switching between HDR and SDR controls must not alter either rendition. Returning to HDR without an edit should restore the exact same HDR preview and scope data that were visible before the switch. A result labelled `Settled` must agree with the authoritative persisted adjustment state and must not be replaced by a materially different result solely because the active lane changed.

**Investigation notes**

Compare the interactive/settled WebGPU preview and GPU-scope path with the lane-switch path in `switchLane()`, including `syncGlobalEditState()`, cached preview selection, `renderGpuDraft()`, and `refreshScopes()`. Determine whether the pre-switch result is based on an optimistic adjustment snapshot, a stale GPU surface, or a different processing path from the post-switch authoritative render. Verify generation and lane checks across queued edit, preview, and scope work. Highlight Compression is a reliable trigger but not a necessary condition.

**Acceptance criteria**

- With no intervening edit, HDR → SDR → HDR preserves the HDR preview appearance and numerical scope statistics within deterministic sampling tolerance.
- The same invariant holds with Highlight Compression enabled and bypassed/off.
- A scope labelled `Settled` corresponds to the same adjustment revision and processing result as the settled preview.
- Switching lanes while an HDR edit is still committing either waits for or safely carries forward the newest edit; it never restores an older rendition.
- Repeated rapid HDR/SDR switching cannot apply a stale preview or scope generation from either lane.
- Add a browser regression that records the HDR peak and representative pixels before and after a lane round trip, covering both GPU and CPU/backend fallback paths.

### MINOR-06 — Gain is too weak on small selected tonal ranges

**Priority:** Minor / grading control response
**Status:** Resolved / user-verified August 19, 2026
**Area:** HDR and SDR Lift/Gamma/Gain tonal-range curves
**Affected control:** Gain with a narrow Gain Range

**Reproduction**

1. Open an image with detail in the highlight region.
2. Narrow Gain Range so that Gain targets a small tonal interval.
3. Move Gain through a substantial portion of its available range.
4. Compare the selected tonal interval before and after the adjustment, using the preview and scopes.

**Current behavior**

When Gain Range is narrowed to a small selected tonal interval, changing Gain produces too little visible difference. The adjustment feels disproportionately weak relative to the Gain value and can appear ineffective.

**Expected behavior**

Narrowing the selected tonal range should localize the Gain adjustment without unintentionally reducing its useful peak strength. A meaningful Gain move should remain visibly and measurably effective inside the selected interval while retaining smooth transitions outside it.

**Investigation notes**

Review how Gain strength is combined with the highlight-zone mask in both the CPU adjustment path and the WebGPU preview. The curve or mask amplitude may effectively weaken as Gain Range becomes narrow. Consider decoupling adjustment strength from selection width, or otherwise compensating the curve response, while avoiding hard boundaries, halos, luminance reversals, and discontinuities as Range or Pivot changes. Confirm that interactive, settled, CPU, and GPU results agree before changing the frontend slider scale alone.

**Acceptance criteria**

- At the minimum and other narrow Gain Range settings, a representative non-zero Gain adjustment creates a clearly visible and measurable luminance change within the targeted tonal interval.
- Narrowing Gain Range changes the width and transition of the affected region without collapsing the adjustment's useful peak strength.
- Gain remains gradual and controllable across the full Gain, Range, and Pivot limits, without hard edges, halos, clipping, or luminance-order reversals.
- HDR and SDR branches behave consistently with their respective output constraints.
- Interactive WebGPU preview, settled scopes, and CPU/backend rendering agree within established tolerances.
- Add regression coverage comparing affected-pixel response at narrow, default, and wide Gain Range values.

### MINOR-07 — Newly created curve points cannot be dragged in the same gesture

**Priority:** Minor / grading interaction
**Status:** Resolved / user-verified August 19, 2026
**Area:** RGB curve editor pointer interaction

**Reproduction**

1. Open the Curves controls.
2. Press on an empty position along the curve to create a new control point.
3. Without releasing the pointer, move it to reposition the new point.

**Current behavior**

Pressing the curve creates and selects a new point, but the point does not follow the pointer during that gesture. The user must release, press the new point again, and then drag it.

**Expected behavior**

Creating and positioning a curve point should be one continuous gesture. As soon as pointer-down creates the point, that point should enter the existing drag state, capture the pointer, and follow pointer movement until release or cancellation.

**Likely implementation site**

In the curve editor `pointerdown` handler, the existing-point path calls `beginDrag(...)`, while the curve-hit path only calls `addCurvePoint(curveHit.x)`. After insertion, begin dragging the returned or selected point using the original pointer position. Preserve the existing edit-scheduler lifecycle and correctly handle pointer-up, pointer-cancel, lost capture, and click-without-movement behavior.

**Acceptance criteria**

- Pressing an empty location on the curve creates a point that immediately follows the still-held pointer.
- The create-and-drag gesture produces the same point constraints and curve result as dragging an existing point.
- Releasing immediately after creation leaves a valid selected point at the initial curve location.
- Pointer cancellation or lost capture ends the interaction cleanly without leaving a stuck drag or preview state.
- The behavior works with mouse, pen, and touch pointer events supported by the editor.
- Add frontend interaction coverage for create-and-drag, create-without-movement, cancellation, and ordinary existing-point dragging.

### MINOR-08 — JPEG Ultra HDR appears much brighter than matched AVIF

**Priority:** Minor / proof and delivery trust
**Status:** Shelved August 19, 2026 / no reproducible defect
**Area:** JPEG Ultra HDR and AVIF gain-map export parity, Chromium proofing
**Reported observation:** A JPEG Ultra HDR export looks substantially brighter than an AVIF exported from the same HDR Finisher settings

**Reproduction**

1. Open and grade one source image without changing settings between exports.
2. Export both JPEG Ultra HDR and AVIF gain-map versions using matched applicable quality and HDR/SDR settings.
3. View both files in the same Chromium browser, on the same HDR display and OS HDR state, at matched size and proof mode.
4. Compare diffuse-white placement, midtones, highlights, peak brightness, and overall perceived brightness.

**Originally reported behavior**

The JPEG Ultra HDR result appears dramatically brighter than the matched AVIF result. It is not yet known whether the discrepancy originates in encoding, gain-map metadata or reconstruction, proof generation, browser format handling, or display-adaptive tone mapping.

**Investigation outcome — August 19, 2026**

The reported large brightness difference could not be reproduced. Matched quality-100 JPEG Ultra HDR and AVIF gain-map files were exported from `Affinity_DSC06898_DisplayP3_Linear_32f.exr`, interpreted as Display P3 primaries with a Linear transfer function. Their SDR bases, gain metadata, reference-white conversions, full HDR reconstructions, and display-adaptive reconstructions were compared from the encoded files. Midtones, diffuse white, distribution percentiles, and practical peaks remained closely aligned; neither path applied gain twice or selected an incompatible rendition or capacity convention.

The user then viewed the matched files in the same browser and found them functionally identical, confirming the reconstruction result. A follow-up export from the unedited EXR showed AVIF lifting the darkest values slightly relative to JPEG, but the images remained close overall. This is treated as normal format/adaptive-rendering variance rather than a product defect. The original observation may have resulted from unmatched save or viewing settings. MINOR-08 is shelved without an encoder change and without new regression tests; reopen only if a future repeatable case includes the exact files and matched browser, HDR-display, size, and proof-state evidence.

**Expected behavior**

The two delivery formats need not be pixel-identical, but exports made from the same authored HDR and SDR renditions should preserve closely comparable luminance intent. A large format-dependent brightness shift must either be corrected or clearly explained and bounded by verified decoder/browser behavior.

**Investigation notes**

Compare the exact exported files rather than screenshots alone. Inspect the SDR bases, gain maps, gain-map min/max and gamma, offsets, base/alternate headroom, reference white, color metadata, and independently reconstructed linear HDR pixels. Then compare HDR Finisher's fixed-headroom proof with live Chromium rendering at recorded Windows HDR headroom. Verify that neither path applies gain twice, chooses a different base rendition, interprets capacity metadata differently, or introduces a reference-white scaling mismatch. Keep this investigation distinct from `MINOR-02` JPEG banding, although both may share encoder or reconstruction evidence.

**Acceptance criteria**

- A deterministic source exported to both formats has its SDR bases, gain metadata, reconstructed HDR luminance distribution, and peak values recorded side by side.
- Independent fixed-headroom reconstruction establishes whether the brightness difference exists in the encoded artifacts or only in live browser/display presentation.
- At matched reconstruction headroom, diffuse white, representative midtones, and highlight placement remain within an explicitly documented cross-format tolerance; discrepancies clearly above the existing proofing tolerance are investigated.
- Browser comparison records browser version, OS HDR state, display headroom, `dynamic-range-limit`, and proof mode so the result is reproducible.
- Any intentional or unavoidable format-specific presentation difference is documented in the proof UI without implying false authoring parity.
- Add export/proof regression coverage that compares matched JPEG Ultra HDR and AVIF luminance statistics and guards against large format-dependent brightness drift.

These criteria remain available if the report is reopened. No new automated coverage is being added while the issue is shelved.

## UX Improvements

### UX-01 — Make active export encoding prominent and remove the pre-flight checklist

**Priority:** Minor / export clarity
**Status:** Open
**Area:** Export sheet status hierarchy

**Current behavior**

The export sheet places a five-item Pre-flight panel immediately above the export status. During a long encode, progress is shown as small muted text in the same subdued panel treatment used for idle status, making it easy to miss beneath the checklist.

The Pre-flight panel also presents optional Chromium proof review alongside actual requirements, which gives proofing more authority than intended. Users may export without proofing and accept responsibility for that choice.

**Desired behavior**

Remove the visible Pre-flight checklist from the export sheet. Keep Proof as an optional workflow users can choose separately; do not warn, nag, or imply that proof review is required before export.

Make active encoding and validation status visually prominent with a clear accent color and an unmistakable working state. The changing phase/elapsed-time copy should remain readable throughout long exports.

**Implementation notes**

Removing the checklist must not remove real safeguards. Continue to disable or reject export when there is no source, required source interpretation is unresolved, or the selected encoder is unavailable. Present those conditions near the Export button or in the main export status as concise, actionable messages. Success, cancellation, warning, and failure should have distinct semantic treatments from the active encoding state.

**Acceptance criteria**

- The Pre-flight panel and its Source, HDR, SDR, Encoder, and Chromium Proof rows are removed from the export sheet.
- Chromium Proof remains available from the Proof workflow but is not shown as an export requirement or warning.
- Starting an export immediately changes the status area to a visually prominent in-progress treatment using an accessible accent color.
- Rendering, encoding, and validation phase text plus elapsed time remain visible and readable until completion.
- Successful completion, cancellation, and failure each replace the working treatment with an appropriate final state.
- Missing source interpretation or encoder capability still prevents export and produces a concise actionable message without restoring the checklist.
- Add frontend coverage for idle, blocked, encoding, validating, success, cancellation, and error states, including contrast/accessibility checks for the chosen colors.
