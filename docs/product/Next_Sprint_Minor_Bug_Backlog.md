# Next Sprint Minor-Bug Backlog

**Started:** August 17, 2026
**Status:** MINOR-01 implemented in 0.3.5; open for additional reports
**Target:** Next implementation sprint

## Bugs

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

The UI says: `Auto detection found a consistent source interpretation.`

This is inaccurate because the active source interpretation came from an explicit manual choice, not automatic detection.

**Expected behavior**

The status must reflect the persisted interpretation mode. When a manual interpretation has been applied, show a message such as:

`Manual source interpretation applied: Display P3 primaries + Linear transfer.`

The message should substitute the actual selected primaries and transfer function. It must not claim that automatic detection succeeded while `session.source.interpretation_mode` is `manual`.

**Likely implementation site**

`syncInterpretationControls(session)` currently chooses its note only from `session.analysis.needs_color_override`; it should first branch on the persisted interpretation mode. `overrideMessage(session)` should follow the same rule so the two source-interpretation messages cannot disagree.

**Acceptance criteria**

- Applying a manual primaries/transfer selection immediately produces a clearly labelled manual status.
- The status includes the active primaries and transfer function.
- Reopening the project or source settings preserves the same truthful manual status.
- Returning to Auto restores the appropriate ambiguous or consistent auto-detection message.
- Add frontend contract coverage for manual, ambiguous-auto, and consistent-auto states.

### MINOR-02 — JPEG Ultra HDR Chromium proof shows visible banding

**Priority:** Minor / proof fidelity
**Status:** Open
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
