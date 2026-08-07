# Design QA — Linear HDR Finisher Workflow

## Visual source

- Existing HDR Finisher desktop editor and `codebase/output/proofing-qa-chrome/chrome-proof.png` before this restructuring.
- User-directed structure: top-level Grade, Proof, Export stages; stable left information rail; stable center viewer and technical dock; stage-specific right settings rail.

## Target criteria

- Preserve the existing dark instrument-panel visual system, spacing, typography, rail widths, viewer behavior, and scope dock.
- Make Grade, Proof, and Export visibly sequential and keyboard accessible.
- Keep proof generation explicit and retain the last valid proof when the grade becomes stale.
- Present proof controls and export controls in the right rail without popovers or modal dialogs.
- Show stage, status, format, and display ID context in the left information rail.
- Avoid horizontal overflow at 1800×1050 and 1280×800.

## Verified states

- Grade stage: existing HDR/SDR controls remain in the right rail.
- Proof stage: current proof, stale proof, manual refresh, SDR suspension, and proof-off authored preview.
- Export stage: vertical format selection, production quality controls, filename/folder, proof-aware preflight, and export action.
- Export-to-Proof review handoff selects the export format and focuses Proof settings.
- Arrow-key navigation moves between enabled workflow tabs.

## Visual comparison

- Reference and implementation were compared at 1800×1050 using the same HDR headroom fixture and Chrome 151.
- Final screenshots: `codebase/output/proofing-qa-chrome/chrome-proof.png`, `codebase/output/proofing-qa-chrome/export-rail.png`, and `codebase/output/proofing-qa-chrome/chrome-proof-1280.png`.
- No clipped rails, toolbar collisions, modal overlays, or page-level horizontal overflow were observed.

## Validation

- Chrome UI QA: passed at 1800×1050 and 1280×800.
- Console errors: 0.
- Page errors: 0.
- Page-level horizontal overflow: 0 px.
- Automated suite: 245 passed, 1 skipped.

final result: passed
