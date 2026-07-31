# HDR Finisher instrument UI design QA

## Evidence

- Source visual truth:
  - `C:\Users\Steve\AppData\Local\Temp\codex-clipboard-f41c5314-e83a-4f80-99a5-6c1efd322672.png` (slider anatomy, 1130 × 522 px)
  - `C:\Users\Steve\AppData\Local\Temp\codex-clipboard-334d1fcd-d7c1-454c-828c-221a758d4ef0.png` (group disclosure, 1141 × 540 px)
  - `C:\Users\Steve\AppData\Local\Temp\codex-clipboard-3abefe77-c671-42fb-b207-50419628d064.png` (resizable shell, 1133 × 758 px)
  - `C:\Users\Steve\AppData\Local\Temp\codex-clipboard-92f5e849-a1a5-494e-90a8-31621c45f5a6.png` (control gallery, 1141 × 589 px)
  - `C:\Users\Steve\AppData\Local\Temp\codex-clipboard-9dcc3d74-a416-434f-8842-5fa71fa741c8.png` (implementation/acceptance notes, 1078 × 856 px)
  - `C:\Users\Steve\AppData\Local\Temp\codex-clipboard-42e6cfaa-bd82-49b5-832e-563c590b2efe.png` (visual principles, 1141 × 457 px)
- Browser-rendered implementation: `codebase/output/design-qa/ui-redesign-1920x1080.png` (1920 × 1080 px; 1920 × 1080 CSS viewport; device scale factor 1)
- Responsive implementation: `codebase/output/design-qa/ui-redesign-1280x820.png` (1280 × 820 px; 1280 × 820 CSS viewport; device scale factor 1)
- Full-view comparison: `codebase/output/design-qa/source-and-implementation-comparison.png`
- Focused control comparison: `codebase/output/design-qa/focused-controls-comparison.png`
- Interaction result: `codebase/output/design-qa/ui-redesign-layout-qa.json`
- State: dark theme, HDR lane active, HDR TIFF test pattern loaded, fit-to-viewport, analysis dock open.

The source is a component-and-behavior design board rather than a literal full-app mock at a matching viewport. Comparison therefore treats its selected component anatomy, shell proportions, hierarchy, and interaction notes as authoritative while retaining the production app's real content and topology.

## Full-view comparison

The implementation preserves the supplied composition: four near-black chrome values surround the image, the image is the only visually bright region, the source/viewer/grade hierarchy is immediately legible, and the analysis dock reads as a subordinate horizontal instrument. The 48 px top bar has one filled Export action, compact outlined actions, and pill status chips. The source and grade rails retain the intended defaults while leaving the 1920 × 1080 image area dominant.

At 1280 × 820 there is no horizontal overflow. The center workspace remains 678 px wide at default rail sizes, and the grade controls retain 284 px of slider track—above the 180 px acceptance threshold.

## Focused comparison

The focused evidence confirms the selected component decisions:

- Sliders use a 3 px bar handle, nine continuous scale landmarks, rounded 3 px tracks, fixed right-aligned tabular values, hover/focus brightening, and a 20 px hit target. Scale marks do not snap.
- Group headers use a filled 32 px band, left disclosure caret, uppercase mono title, right-aligned default/modified state, modified dot, and contextual Reset action.
- The production grade rail is denser than the presentation board by design, but preserves the board's 38 px control rhythm and 8 px internal gaps without moving numeric readouts.

## Required fidelity surfaces

- Fonts and typography: passed. Existing IBM Plex/Segoe UI and IBM Plex Mono/Cascadia fallbacks reproduce the source's editorial sans/technical mono contrast. Labels, group titles, readouts, and status copy retain distinct weights, sizes, and tabular alignment without unwanted wrapping in the tested views.
- Spacing and layout rhythm: passed. The 48 px top bar, 32 px disclosure bands, 38 px control rows, 8 px row gaps, 24 px group separation, fixed gutters, and 208 px dock reproduce the selected rhythm. Panel radii remain 3 px or less and persistent chrome has no decorative elevation.
- Colors and visual tokens: passed. All hexadecimal colors are centralized in `:root`; canvas colors are read from those tokens. The chrome stays near-neutral and low saturation, with one cyan accent, one filled primary action, and semantic green/amber/red states.
- Image quality and asset fidelity: passed. The test image remains sharp, correctly fitted, uncropped, and unobscured. The references contain no required logos, illustrations, or photographic assets to recreate.
- Copy and content: passed. Existing HDR Finisher terminology remains intact, while group metadata, status chips, lane labels, tool units, and helper copy follow the supplied control language.

## Interaction and accessibility checks

- Source rail, grade rail, and dock resize via pointer and keyboard, clamp to their min/max values, reset on double-click, and persist per 1280/1600/2100+ viewport bucket.
- Separator roles expose orientation and current/min/max values. Arrow keys move 8 px; Home/End reach limits.
- The dock collapses to 28 px and restores to 208 px.
- Native range inputs retain keyboard semantics and visible focus rings.
- Shift and Alt provide 0.2× and 0.05× precision dragging. The tested Alt drag produced +0.10 EV and one preview request.
- Group resets remain visible to keyboard focus and appear contextually for modified groups.
- Loaded-image HDR/SDR switching, tone-equalizer adjustment/reset, scope tabs, overlay popover, viewer zoom, export sheet, and native-image drag suppression passed.
- Edge console errors: none. Page errors: none.

## Comparison history

1. Initial normalized full-view and focused-region comparison found no actionable P0/P1/P2 visual mismatch. The production density and app-specific content differ intentionally from the explanatory design-board canvas; selected anatomy, hierarchy, color discipline, rhythm, and shell behavior match.
2. No visual correction loop was required after the normalized comparison. Earlier implementation testing found an invisible Reset hit-target problem before this visual gate; it was corrected and the loaded-image browser workflow was rerun successfully.

## Findings

- No actionable P0, P1, or P2 findings remain.
- P3 follow-up: numeric readouts could become direct-entry fields in a later iteration if precise typed input proves useful; the selected references do not require this for the current pass.

## Implementation checklist

- [x] Tokenized dark visual system
- [x] Banded disclosure groups and modified state
- [x] Continuous bar-handle sliders with precision modifiers
- [x] Resizable, persistent, accessible shell
- [x] 1280 px responsive and overflow checks
- [x] Loaded-image interaction and console checks
- [x] Full-view and focused visual comparison

final result: passed
