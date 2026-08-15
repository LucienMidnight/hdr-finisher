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

## Current record — Out-of-image Path Handle Acquisition

Source visual truth: `C:\Users\Steve\AppData\Local\Temp\codex-clipboard-a5106662-c9d3-458a-a8b0-c73a0f116852.png` (1068 × 948), showing a visible Path handle in the viewer letterbox that could not be selected.

Implementation evidence:

- `codebase/output/path-mask/out-of-image-handle.png` (967 × 649), showing a selected Path node with its out-of-image handle under the new warm hover ring.
- `codebase/output/path-mask/out-of-image-handle-comparison.png` (1440 × 701), the combined source/implementation comparison input.

Viewport: 1440 × 1000 CSS pixels, device scale factor 1, reduced motion enabled for deterministic evidence. The source and implementation use different test images and crops; comparison is limited to the reported interaction state rather than image-content fidelity.

State: Path mode active; a smooth node next to the image edge is selected; its incoming handle is outside the image but inside the overlay pane; the pointer is centered on that handle after a successful drag.

## Findings

No actionable P0, P1, or P2 differences remain.

- Fonts and typography: unchanged; this correction adds no copy or text styling.
- Spacing and layout rhythm: unchanged; the handle retains its existing six-pixel visible control and 28-pixel hit target.
- Colors and tokens: the new hover ring uses the existing warm selected-node token, preserving the dark halo and neutral handle center.
- Image quality and asset fidelity: no image or icon assets changed. The browser evidence is native-density and the handle/line remain crisp against the black letterbox.
- Copy and content: unchanged. The visible state communicates acquisition without adding labels over the image.
- Interaction: closed Path hit-testing now accepts normalized coordinates outside the image wherever the larger overlay canvas receives the event. Path anchors remain clamped to the source; only legal handles/curve targets can be acquired there. The browser suite creates, hovers, selects, drags, commits, and verifies an out-of-image handle.
- Grade preview: the browser suite commits +2 EV through the Path mask and confirms the rendered preview differs from Compare without. Moving a local grade control now dismisses the colored mask fill so the adjustment can be judged without losing the editable boundary lines.

Full-view and focused-region evidence are the same for this narrowly scoped defect: the combined comparison clearly shows the reported outside-handle position and the fixed hovered/selected state at readable scale.

## Comparison history

- Earlier P1: a handle could be rendered outside the image, but `localPointerPoint` rejected the pointer before `pathTargetAtPointer` could acquire it. Fixed by allowing closed Path editing across the overlay coordinate range while retaining downstream anchor bounds. Post-fix browser evidence successfully drags the handle and shows the hover ring.
- Earlier P2: the colored mask fill could visually obscure local exposure feedback. Fixed by dismissing the fill on local-grade input; rendered Compare-without evidence confirms the Path exposure is applied.

## Implementation checklist

- [x] Out-of-image handles are hoverable, selectable, and draggable.
- [x] Path anchors remain constrained to the image.
- [x] Hover state is visible without relying on pointer shape alone.
- [x] Path exposure produces a rendered local difference.
- [x] Local grade input dismisses the obscuring mask fill.
- [x] Browser run completes without page errors.

## Follow-up polish

No remaining polish item is specific to this defect.

final result: passed

## Current record — Editable Bezier Path and Feather Boundaries

Source visual truth:

- `C:\Users\Steve\AppData\Local\Temp\codex-clipboard-c70e8e8a-8a1e-46dd-ab12-9ab4844e7279.png` — 894 × 678 Affinity-style sharp/smooth Bezier reference.
- `C:\Users\Steve\AppData\Local\Temp\codex-clipboard-96cc7107-5cff-49ec-91b9-e6d33144d9e5.png` — 73 × 35 Sharp/Smooth icon reference.
- The supplied Darktable captures establish the independent inner/outer boundary behavior but are not treated as a pixel-identical chrome target.

Implementation evidence:

- `codebase/output/path-mask/path-and-feather-overlay.png` — 967 × 649 preview-pane capture.
- `codebase/output/path-mask/path-controls.png` — 320 × 946 focused control-rail capture.
- `codebase/output/path-mask/path-design-comparison.png` — 1400 × 1787 combined source/implementation comparison input.

Viewport: 1440 × 1000 CSS pixels, device scale factor 1. Evidence is at native browser density. The conceptual source references have different crops and dimensions, so the comparison preserves each reference's geometry rather than claiming pixel-for-pixel layout equivalence.

State: built-in HDR test pattern loaded; a four-node path is closed; Feather mode is active; the independent feather boundary is customized; one smooth feather node and its handles are selected; Feather reads 10%.

## Findings

No actionable P0, P1, or P2 differences remain.

- Fonts and typography: Path Controls retains the existing HDR Finisher sans/mono hierarchy, compact uppercase group labels, 11 px control labels, and legible selected-node status. It does not copy Affinity or Darktable chrome.
- Spacing and layout rhythm: the Path/Feather mode switch, node-mode controls, shared instrument slider, and reset action follow the rail's existing inset, hairline, three-pixel radius, and 32-pixel control rhythm. No controls overflow the 320-pixel rail.
- Colors and tokens: both boundaries use a dark halo. The inner path uses the application accent; the feather path uses high-contrast marching ants. Selection uses the warm selected token and a contrasting ring. Node type is also distinguished by square versus circular geometry.
- Image quality and asset fidelity: the Sharp and Smooth buttons use transparent assets derived from the supplied icon reference, not CSS drawings or unrelated glyph substitutions. Their small source size is acceptable at the 18-pixel UI slot and remains visibly subordinate to the label.
- Copy and content: Path, Feather, Sharp, Smooth, Feather, and Reset feather shape are concise, product-specific labels. The status names the active boundary, selected node index/count, and node type.
- Interaction and accessibility: the browser suite exercises click and click-drag creation, all closure/cancel routes, segment insertion, right-click and keyboard removal, node conversion, independent feather editing, slider delta preservation, reset, and keyboard commands. The overlay is keyboard-focusable with an accessible command summary. The run reported no page errors.

Full-view comparison evidence: `path-design-comparison.png` places the Affinity curve/icon references and the rendered HDR Finisher overlay/control state in one image. The implementation preserves the intended mixed sharp/smooth path grammar and improves boundary visibility without importing the reference application's neutral-gray chrome.

Focused-region evidence: `path-controls.png` is required because labels, icon silhouettes, focusable mode controls, status text, and slider alignment are too small to judge in the full preview capture. `path-and-feather-overlay.png` separately establishes selected handle size, independent boundary targeting, dual strokes, and marching ants.

## Comparison history

- Earlier P2: the provisional Sharp/Smooth buttons used two Segoe glyph code points; the rendered Smooth glyph read as a face rather than a Bezier profile. Fixed by deriving transparent, native-size button assets from the supplied Affinity icon reference. Post-fix evidence is `path-controls.png` and the updated combined comparison.
- No P0/P1 findings were observed in the first rendered comparison.

## Implementation checklist

- [x] Sharp-by-click and smooth-by-drag creation are visually distinct.
- [x] Path and Feather edit modes expose only their active boundary controls.
- [x] Selected handles are large, high-contrast, and isolated to one node.
- [x] Sharp/Smooth controls use the supplied visual metaphor and visible labels.
- [x] Feather uses the shared slider and an explicit reset action.
- [x] The canvas exposes focus and equivalent keyboard editing.
- [x] Reduced motion receives static feather dashes.
- [x] Browser visual and interaction evidence passes without page errors.

## Follow-up polish

No blocking polish remains. A future vector icon source could improve sharpness above the current 18-pixel control slot, but the current assets are crisp at their intended size.

final result: passed

## Latest QA disposition — Out-of-image Path Handle Acquisition

- Source visual truth: `C:\Users\Steve\AppData\Local\Temp\codex-clipboard-a5106662-c9d3-458a-a8b0-c73a0f116852.png` (1068 × 948).
- Browser implementation: `codebase/output/path-mask/out-of-image-handle.png` (967 × 649).
- Combined comparison: `codebase/output/path-mask/out-of-image-handle-comparison.png` (1440 × 701).
- Viewport: 1440 × 1000 CSS pixels at device scale factor 1; reduced motion enabled. Source and implementation use different image content, so only the interaction state is compared.
- State: Path mode, selected smooth edge node, out-of-image handle hovered after a successful drag.
- Full/focused evidence: the combined comparison is both the full-state and focused control comparison because the defect is confined to one handle and its letterbox hit area.
- Typography/copy: unchanged.
- Spacing/layout: unchanged; visible six-pixel handle with a 28-pixel hit target.
- Colors/tokens: existing warm selected token now provides the handle hover ring.
- Image/asset quality: no assets changed; native-density canvas evidence remains crisp.
- Interaction result: out-of-image hover, selection, drag, commit, Path exposure rendering, Compare-without difference, and automatic mask-fill dismissal all pass without browser errors.
- Comparison history: the P1 pointer rejection and P2 obscured-grade feedback recorded above were fixed and verified in the cited post-fix evidence.
- Remaining findings: no actionable P0/P1/P2 issues and no defect-specific P3 polish.

final result: passed
