# Next Sprint Minor-Bug Backlog

**Started:** August 17, 2026
**Updated:** August 22, 2026
**Status:** MINOR-01 through MINOR-07 and MINOR-09 resolved and user-verified; MINOR-08 investigated and shelved
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
| MINOR-09 | Resolved / user-verified | Constrained JPEG Ultra HDR's 8-bit content-boost range and added default SDR-guided spatial denoising of only the generated map. The matched Web Optimized export improved slightly in Chrome and massively in Safari while preserving identical SDR pixels and reducing size. AVIF spatial denoising remains an evidence-gated roadmap item; JPEG XL has no gain map. |

Validation also resolved defects discovered while testing this set: the Affinity portrait EXR no longer inherits a stale landscape fit ratio; the WebGPU HDR shader compiles after the narrow-gain change; native Electron clipboard copying is used for source and export paths; and imported EXR scope statistics remain tied to the correct HDR/SDR lane after manual Display P3 Linear interpretation. Focused Python, frontend-contract, desktop, browser-interaction, and live Windows HDR checks passed.

### MINOR-09 — JPEG Ultra HDR extreme gain range causes browser noise

**Priority:** Minor / delivery fidelity
**Status:** Resolved and user-verified August 22, 2026
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
HDR or SDR branches. Before final gain-map JPEG compression, HDR Finisher also
applies a conservative guided filter to the logarithmic map, using the untouched
SDR primary as its edge guide. Processing is striped for bounded full-resolution
memory. AVIF remains on libavif's existing per-channel 0.1% outlier trimming and
10-bit map; spatial AVIF map denoising is recorded in the PRD roadmap for separate
testing. JPEG XL remains direct PQ.

**Validation**

- Unit coverage verifies normal and greater-than-four-stop peak bounds.
- A real libultrahdr encode/probe/decode test verifies emitted range metadata
  and successful HDR reconstruction.
- The matched project export reports `GainMapMin=-4`, `GainMapMax=4`, and
  `HDRCapacityMax=2.3183`, with both Ultra HDR v1 and ISO 21496-1 metadata.
- Disabling authored grain did not change the Safari artifact. A full-resolution
  gain map made it finer, proving map sampling contributed but did not remove it.
- A matched half-resolution guided-filter candidate retained identical SDR base
  pixels, improved slightly in Chrome and massively in Safari, and measured about
  3.6 MB versus about 3.8 MB for the unfiltered Web Optimized export.
- Automated coverage verifies smooth-area noise suppression, edge retention,
  metadata preservation, native reconstruction, and bounded-memory processing.

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

**Resolved September 21, 2026**

`frontend/app-dialog.js` provides `window.HDRDialogs.confirm / alert / prompt
/ choose`, built on the same `<dialog>` + `showModal()` pattern as
`#settings-dialog`. Every native call site is converted: sixteen in
`frontend/app.js` and five in `frontend/application-shell.js`. The count in
"Still open" above was seven because it counted only `window.confirm`; the
acceptance criterion names `alert` and `prompt` too, and there were nine more.

Two things the conversion had to get right and nearly did not:

- **The three-way transition is one question, not two.** Asking "save?" and
  then "discard?" makes Cancel the answer to a question the user was never
  shown, and it put two native modals in a row on exactly the path that broke
  the renderer. `choose()` returns save / discard / cancel from one dialog,
  matching what `desktop.confirmUnsavedTransition` already returns.
- **The shortcut recording handler cancels itself.** It registers a `blur`
  listener that ends the recording, and a modal takes focus off the recording
  button -- so the reserved-shortcut and conflict questions tore down the
  capture while they were still on screen. The listener is detached before
  either question is asked.

A third was found only by testing. `dialog.close()` dispatches its `close`
event as a queued task, so the close that ends one dialog arrives after the
next has opened and attached its listeners to the same element, and was read
as the user cancelling a dialog they had not answered. Measured: asking
save / discard / cancel in sequence returned save, **cancel**, cancel.
Neither removing the listeners before closing nor tagging the presentation
fixes it, because the stale event is delivered to whatever is attached when it
runs. `app-dialog.js` counts the closes it caused instead.

**Acceptance criteria**

- ~~No `window.confirm`, `window.alert` or `window.prompt` remains in
  `frontend/app.js`.~~ None remains in any frontend source. Asserted
  structurally against the served files, so a new one cannot be added
  quietly.
- ~~Each converted flow keeps its current outcome for both answers, including
  the three-way unsaved-changes transition.~~ Asserted, the three-way against
  all three answers.
- **Still owed.** *After any confirmation is dismissed, the preview resolution
  selector opens on the first click without a focus round trip — asserted in
  the Electron integration suite.* The suite exists, at
  `codebase/desktop/tests/` (`electron-smoke.js` and friends, driving Electron
  through Playwright), and `codebase/desktop/tests/confirmation-focus.js` now
  runs the export-overwrite confirmation there and asserts that no native
  modal is raised and that the preview resolution selector is operable
  immediately afterwards.

  What that assertion cannot cover is the popup itself. A `<select>` popup in
  Chromium is a native window with no in-page observable: the renderer cannot
  tell whether it opened, and Playwright's `selectOption` sets the value
  without opening it, so the broken path is not the one a scripted click takes.
  The test therefore asserts the cause is gone and that the control still
  responds, not the popup itself. The reported symptom remains verified by
  hand only.

  One thing the negative control corrected. In a browser a surviving
  `window.confirm` surfaces as Playwright's `dialog` event, and the browser
  test relies on that. In Electron it does not: restoring one `window.confirm`
  put a real native window on screen and the run blocked with nothing
  delivered to the listener. What fails the Electron run is the in-app
  `<dialog>` never opening, which is what the negative control was seen to do.
- ~~The dialog is keyboard-operable: Escape cancels, Enter confirms, and focus
  returns to the control that opened it.~~ Asserted. Note that the focus
  return is the platform's own `<dialog>` behaviour: an explicit
  `opener.focus()` was written, found to make no difference to the test, and
  deleted rather than kept as decoration.

Covered by `tests/in-app-confirmations.js`
(`npm run test:in-app-confirmations`), which also fails the run on any native
dialog reaching Playwright's `dialog` event — without that listener a
surviving `window.confirm` would answer itself and the run would look clean.
Negative controls: restoring one native `window.confirm` at a real call site
fails both the structural check and, with that check disabled, the
behavioural one; reverting the stale-close fix fails the three-way.

---

### MINOR-11 — In-app Help shows "Documentation unavailable" for every topic

**Priority:** Major / feature entirely non-functional
**Status:** Fixed 2026-09-21. `backend/hdr_finisher/config.py` `_is_bundled()`; covered by `tests/test_docs_root.py`
**Area:** `backend/hdr_finisher/config.py` `DOCS_DIR`

**Reported behavior**

Help → HDR Finisher Help renders `Documentation unavailable` instead of the
topic. Every topic, not one. `tests/electron-smoke.js` has been failing on it:

    actual:   'Documentation unavailable'
    expected: 'Five-Minute Quick Start'

**Cause**

`DOCS_DIR = RESOURCE_ROOT / "docs" if (RESOURCE_ROOT / "docs").is_dir() else PROJECT_ROOT.parent / "docs"`

The fallback is the right directory — `ai/docs`, which holds
`getting-started/quick-start.md` and everything else the Help navigation
lists. The first branch wins anyway, because `codebase/docs` exists. It
contains two geometry/preview audit notes from 2026-09-04 and none of the
help content, so `/docs/getting-started/quick-start.md` is a 404 and
`documentText()` throws.

`codebase/docs` was added in `4d32eb2` on 2026-09-04, which is when Help
would have broken. The condition is a packaging test — in a packaged build
the resources really do carry `docs` — so it is asking "am I packaged?" by a
proxy that stopped being true.

**Acceptance criteria**

- Every topic in the Help navigation loads in both a development run and a
  packaged build, asserted for at least one topic in each.
- The packaged and development roots are distinguished by something that says
  so, rather than by whether some directory happens to exist beside the
  backend.
- `tests/electron-smoke.js` passes its Help assertions without modification —
  it has been correct about this the whole time.

---

### MINOR-12 — Applying a straighten strands the geometry handoff with no GPU

**Priority:** Major / the edit never completes
**Status:** Open — found 2026-09-21, pre-existing, cause not yet established
**Area:** `frontend/app.js` geometry handoff, `backend/hdr_finisher/cpu_strips.py`

**Reported behavior**

With WebGPU unavailable, applying a straighten leaves
`state.geometryTransformHandoffSignature` set forever.
`tests/electron-smoke.js` has been failing on it at line 563, thirty seconds
after `straighten slider cancellation`.

Nobody had seen it, because the suite was already failing eighty lines
earlier on MINOR-11 and never reached this point. Fixing Help revealed it.

**Not caused by this session.** Verified twice: the failure is identical with
the PERF-03 settle guard neutralised, and identical again on baseline
`d909b7a` carrying only the MINOR-11 fix, which is the smallest change that
lets the suite reach line 563 at all.

**What is known**

The bounded CPU strip path refuses roll geometry by design — `Image.rotate(expand=True)`
materialises the whole rotated frame, so a windowed roll is exact but not
bounded, which is the property that path sells. With no GPU and Full
selected, that refusal surfaces as **"Full unavailable — Bounded strip
execution refused this graph. roll geometry."** and, it appears, an accepted
presentation that never arrives, so the handoff has nothing to clear it.

That is a hypothesis about the connection. The refusal is confirmed and the
stranded handoff is confirmed; the link between them is not.

**Why it matters more than its rarity suggests**

This is a CPU-only configuration, which is one of the three Phase 9 was meant
to validate and which has now been descoped to project PRD 11c. On such a
machine, Full plus any rotation is not merely slow — it is unavailable, and
the geometry edit does not complete. The same refusal list also covers
spatial film effects, denoise, matched SDR and post-geometry downsample, so
the exposure is wider than straighten alone.

**Acceptance criteria**

- Applying a straighten clears the geometry handoff with no GPU available.
- A refusal from the bounded strip path leaves the viewer in a state the user
  can act on, rather than an edit that never completes.
- `tests/electron-smoke.js` passes line 563 without modification.
