# Design QA

## Historical record — HDR Finisher UI redesign

This record predates the local-adjustments pass below and is retained for continuity.

### Comparison target

- Source visual truth: `docs/design/Codex Image Aug 8, 2026, 12_29_30 AM.png`
- Supporting specification: `docs/design/HDR finisher UI redesign/Redesign notes.md`
- Annotation evidence: browser comments 1-11 supplied on August 8, 2026
- Implementation: `codebase/frontend/index.html`, `styles.css`, and `app.js`
- Intended state: Grade workflow, HDR rendition, metadata expanded, histogram visible

### Evidence

- The browser annotation screenshots identify the exact regions requested for this refinement pass.
- Updated implementation screenshot: unavailable.
- The Codex in-app browser exposed the user's local HDR Finisher tab, but blocked agent capture because its admin security policy could not be verified.
- Full-view and focused-region visual comparison therefore remained blocked; no alternate browser or indirect capture path was used during that pass.

### Implemented annotation changes

- Preview preparation became a large centered status with a semantic indeterminate progress bar.
- Interpretation and metadata disclosures opened by default and used wrapping, narrow-column layouts.
- Left-rail tiles adopted a 14 px vertical padding rhythm.
- Preview metadata moved from the removed probe strip into a dedicated left-rail section.
- Viewer, metadata, control panel, and HDR/SDR control names matched the annotations.
- The histogram dock defaulted to 252 px and could not be resized below 240 px.
- The application layout adopted a 720 px minimum height and scrolling rather than clipping below that viewport.
- The existing bypass glyph remained because no icon library was bundled in the frontend.

### Historical validation

- Full automated suite: 246 passed, 1 skipped.
- Focused frontend contract suite: 7 passed.
- JavaScript syntax check: passed.
- Git whitespace check: passed.

Historical result: blocked pending visual capture.

## Current record — Local Adjustments

Source visual truth: `C:\Users\Steve\AppData\Local\Temp\codex-clipboard-21f95547-1970-4d69-bf9e-2cc1cc7c6471.png`

Implementation evidence:

- `docs/testing/local-adjustments-global-qa.png`
- `docs/testing/local-adjustments-local-qa.png`
- `docs/testing/local-adjustments-brush-overlay-qa.png`
- `docs/testing/local-adjustments-linear-gradient-overlay-qa.png`
- `docs/testing/local-adjustments-luminance-range-overlay-qa.png`
- `docs/testing/local-adjustments-path-overlay-qa.png`
- `docs/testing/local-adjustments-overlay-qa.png`
- `docs/testing/local-adjustments-waveform-qa.png`
- `docs/testing/local-adjustments-histogram-qa.png`
- `docs/testing/local-adjustments-design-comparison.png`

Viewport: 1440 × 1000 CSS pixels, device scale factor 1. The source annotation is 373 × 353 pixels. Each implementation rail capture is 320 × 1000 pixels. The comparison preserves native pixel density and aligns the rail tops; the source is intentionally narrower and shorter because it is an annotated crop rather than a full rail capture.

State: built-in HDR test pattern loaded. The global evidence has SDR Controls selected and every adjustment group collapsed. The local evidence has Local Adjustments expanded, four mask types created, Linear Gradient selected, and its local HDR folder active.

## Findings

No actionable P0, P1, or P2 differences remain.

- Typography: the new controls retain the product's existing sans/mono hierarchy, uppercase group labels, weights, and compact rail density.
- Spacing and layout: Local Adjustments and Crop & Rotate now share the same 38-pixel twirl-down row pattern. The Crop Edit action is right-aligned. HDR/SDR tabs connect visually to the content below instead of floating as a segmented control.
- Colors and tokens: folder tabs and active tools reuse the existing accent, hairline, raised, quiet, and text colors. Active/inactive contrast remains clear.
- Image and asset fidelity: no image assets are involved in this rail change; no placeholder or substitute asset was introduced.
- Copy and content: labels remain product-specific and concise. “HDR Controls” and “SDR Controls” are consistent between global and local grading.
- Accessibility and behavior: group disclosure exposes `aria-expanded`; folder tabs expose `role="tab"` and `aria-selected`; tools expose `aria-pressed`. Creation tools stay clickable while the edit document is recovered, Erase is disabled outside brush masks, and expanding Local Adjustments leaves Crop & Rotate and all global groups in the same scroll flow below it. Every core mask now exposes a high-contrast on-image editing gizmo; the four Luminance Range handles are directly draggable.
- Scope continuity: browser evidence switches from Histogram to Waveform and back after four local creations plus Brush, Gradient, Luma, and Path gestures. Both canvases return fresh successful scope responses and contain non-background trace pixels.

Focused-region evidence was required because the source is an annotated crop. `local-adjustments-design-comparison.png` places the source, global hierarchy, and expanded local hierarchy in one comparison image. The full rail screenshots establish overflow and vertical rhythm.

## Comparison history

- Earlier P1: mask rows were created but the preview gave no reliable visible editing affordance. Brush began as a zero-length stroke, Luminance Range had no preview representation, and Gradient/Path outlines were too subtle on some images. Fixed with high-contrast outlined gizmos: radius/hardness rings for Brush, boundary lines and handles for Gradient, an interactive four-handle EV bar for Luma, and enlarged Path nodes.
- Earlier P1: a scope request with a stale edit revision could be discarded silently, leaving an empty Histogram or Waveform dock. Scope requests now recover current edit state and retry once; the interaction harness requires visually nonblank Histogram and Waveform canvases after local edits.
- Earlier P1: the empty local stack was visually indistinguishable from unused panel space and every creation tool could become disabled before edit state was ready. Fixed with a persistent inset stack container, always-available creation buttons, source guidance, and lazy edit-state recovery.
- Earlier P1: expanding Local Adjustments behaved like an exclusive mode and hid the ordinary grading groups. Fixed by keeping Local Adjustments in document flow as a standard disclosure; Crop & Rotate, rendition folders, Tone, and later groups remain below the tall panel.
- Earlier P1: Brush, Gradient, Luma, and Path gave no immediate selected feedback and could silently no-op while Erase appeared functional. Fixed with immediate tool state, explicit unavailable feedback, command-failure recovery, and brush-only Erase eligibility. Post-fix browser evidence created all four adjustments and exercised Erase with no console or edit-command failures.
- Earlier P1: Path dragging copied a pressure field into a Bézier node, causing backend validation to reject the edit. Pointer coordinates are now geometry-only; pressure is added solely to brush samples.
- Earlier P2: the Global/Local segmented switch did not match the adjustment-group hierarchy. Replaced it with a Local Adjustments twirl-down using the same group header and disclosure behavior.
- Earlier P2: HDR/SDR controls appeared as an isolated segmented control. Reworked both global and local rendition selectors as folder tabs visually connected to their contained controls.
- Earlier P2: Crop & Rotate placed Edit before the disclosure/title. The action now occupies the right-side action position while the disclosure matches other groups.

## Implementation checklist

- [x] Local Adjustments uses the standard twirl-down group.
- [x] Crop & Rotate uses the standard disclosure ordering.
- [x] Global and local HDR/SDR controls use folder tabs.
- [x] All four creation tools visibly activate and create an adjustment.
- [x] Brush, Gradient, Luminance Range, and Path each render a visible on-image editing gizmo.
- [x] All four mask types accept and persist a preview-canvas gesture.
- [x] Histogram and Waveform remain populated after local edits.
- [x] The adjustment stack remains visibly present when it is empty.
- [x] Expanding Local Adjustments keeps the remaining grading groups below it.
- [x] Erase is available only for a selected brush mask.
- [x] Browser console, request, accessibility-state, and screenshot checks pass.

## Follow-up polish

No blocking polish items. A future icon pass could replace text tool labels if the broader rail adopts a consistent icon library.

final result: passed
