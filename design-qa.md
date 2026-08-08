# Design QA - HDR Finisher UI redesign

## Comparison target

- Source visual truth: `docs/design/Codex Image Aug 8, 2026, 12_29_30 AM.png`
- Supporting specification: `docs/design/HDR finisher UI redesign/Redesign notes.md`
- Annotation evidence: browser comments 1-11 supplied on August 8, 2026
- Implementation: `codebase/frontend/index.html`, `styles.css`, and `app.js`
- Intended state: Grade workflow, HDR rendition, metadata expanded, histogram visible

## Evidence

- The browser annotation screenshots identify the exact regions requested for this refinement pass.
- Updated implementation screenshot: unavailable.
- The Codex in-app browser exposed the user's local HDR Finisher tab, but blocked agent capture because its admin security policy could not be verified.
- Full-view and focused-region visual comparison therefore remain blocked; no alternate browser or indirect capture path was used.

## Implemented annotation changes

- Preview preparation is now a large centered status with a semantic indeterminate progress bar.
- Interpretation and metadata disclosures open by default and use wrapping, narrow-column layouts.
- Left-rail tiles share a 14 px vertical padding rhythm.
- Preview metadata moved from the removed probe strip into a dedicated left-rail section.
- Viewer, metadata, control panel, and HDR/SDR control names match the annotations.
- The histogram dock defaults to 252 px and cannot be resized below 240 px.
- The application layout has a 720 px minimum height and scrolls rather than clipping below that viewport.
- The existing bypass glyph remains because no icon library is bundled in the frontend.

## Static and behavioral validation

- Full automated suite: 246 passed, 1 skipped.
- Focused frontend contract suite: 7 passed.
- JavaScript syntax check: passed.
- Git whitespace check: passed.
- Contract coverage includes the progress state, open metadata sections, preview metadata placement, naming, removed probe copy, and protected scope height.

## Remaining visual check

- Reload the open local preview and inspect the Grade state at the annotated viewport.
- Confirm the loading overlay during an image import, metadata wrapping at the narrowest rail width, and the complete histogram at the minimum supported height.

final result: blocked
