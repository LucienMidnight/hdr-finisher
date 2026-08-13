# Local Adjustments Design and Interaction QA — 2026-08-13

Status: passed

## Scope

This pass covered the local-adjustment stack, mask-tool toolbar, brush and mask controls, HDR/SDR local-grade tabs, Light and Color sections, brush painting and erasing, overlay rendering, applied-grade rendering, and live-versus-settled preview parity.

Curated browser captures from the final run are stored beside this report. Disposable diagnostic captures remain under ignored `codebase/output/` directories.

## Mask behavior

- Brush Controls remain independent from Mask Controls. Brush Size, Feather, Flow, and Density affect new strokes; Mask Opacity, Shift Edge, and Feather affect all composed strokes.
- Mask operations run in a single order: Shift Edge, Gaussian Feather, then Opacity.
- Shift Edge is normalized against the mask peak, allowing negative values to contract low-density masks without making them disappear prematurely.
- Feather uses float32 intermediate masks, aspect-ratio-aware horizontal and vertical radii, and the same backend compiler for live draft and settled renders.
- The red overlay and real local adjustment consume the same processed mask. Feather no longer creates a dark fringe or a harder applied-grade boundary.
- Eraser input uses the optimized brush path and remains responsive during a stroke.

## Slider matrix

The browser interaction test exercised the full cross-product below with both live input and committed change events:

| Control | Values |
|---|---|
| Shift Edge | -66%, 0%, +66% |
| Feather | 0%, 50%, 100% |

All nine configurations completed without page errors, stuck update state, block quantization, black overlay fringes, or a live/settled state discontinuity. Max Feather produced a visibly continuous transition on both square and wide preview geometry.

## UI checks

- The adjustment-row ellipsis is a real button and exposes the sub-mask stub action.
- HDR and SDR local-grade tabs follow the global tab treatment while retaining the compact “Local grade” labels.
- Light and Color are vertically stacked sections matching the Brush Controls and Mask Controls hierarchy.
- Local adjustment rows remain compact, the adjustment list scrolls independently, and its action toolbar stays fixed.
- Gradient uses the Fluent graduated-bar glyph. Luma uses the documented temporary Equalizer glyph pending the final supplied asset.

## Automated verification

- Python suite: 401 passed.
- Local-adjustment browser interaction suite: passed.
- Brush-mask browser interaction and Shift Edge/Feather matrix: passed.
- Local design QA browser capture: passed.
- No browser page errors were reported during focused checks.

The component rules are recorded in `docs/design/HDR_Finisher_Design_Guidelines.md`.
