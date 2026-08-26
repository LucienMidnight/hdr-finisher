# Film Look Improvement Sprint

## Status and handoff

- **Status:** Sprints A, B, and C complete and validated.
- **Branch at planning time:** `feature/denoising`
- **Physical grain implementation:** `367f350 feat: add physically scaled film grain`
- **Imported red-hot-pixel investigation note:** `9c173a1 docs: note imported red hot pixel investigation`
- **Related completed sprint:** [Physical Film Grain Sprint](Physical_Film_Grain_Sprint_PRD.md)

This document records the agreed direction for a later implementation thread. The next thread should verify the branch and working tree before changing code, then execute the work in the order below.

### Implementation progress

- **A1-A3:** Completed in `9eb3f60`, including the cached 4K interaction fix discovered during validation.
- **A4:** Completed in `bcb087a`. Grain, halation, and Film Resolution now share Film Format and capture-geometry scaling; bloom remains explicitly output-relative.
- **A5:** Completed in `e3d046d`. CPU/export and WebGPU now share spatial kernel weights, radius caps, clamped-edge behavior, and an explicit response-frame source for ordered Film Look compositing. Parity fixtures cover ordinary, panoramic, and 64k-class horizontal-strip geometry.
- **A6:** Completed in `fe023e3`. Film Response is explicitly defined in each branch's scene-linear working RGB, while halation tint is authored once in canonical linear sRGB and converted to ACEScg for HDR in both CPU/export and WebGPU preview.
- **Sprint B:** Completed on the working branch. Film Response now uses smooth monotonic toe and shoulder knees; adds bounded, exposure-dependent Red, Green, and Blue Response; adds smooth highlight and shadow desaturation; protects saturated colors and HDR peaks; and retains Color Density's subtractive luminance behavior rather than duplicating ordinary saturation. CPU/export and WebGPU use the same equations and updated descriptive presets include the new controls.
- **Tonal Character decision:** No additional macro was added. The existing Tone Contrast plus explicit Print Contrast, Toe, Shoulder, Density, channel-response, and desaturation controls cover the intended jobs without introducing a second ambiguous global contrast control.
- **Sprint C:** Completed on the working branch. Halation now extracts relative bright-side exposed boundaries before its physically scaled scatter, preventing uniform highlight interiors from becoming a generic warm glow. Amount, Film Format-aware Physical Extent, and tint remain independent controls with clearer units. Bloom uses a squared soft-knee highlight qualification while retaining an explicitly output-relative Optical Spread and independent core diffusion. Film Resolution now attenuates low-contrast fine detail with strong-edge protection instead of blending toward an ordinary blur. CPU/export and WebGPU share the new equations and zero-radius spatial stages are inactive.
- **Sprint C grain decision:** The existing physically scaled, deterministic grain and its independent shadow, midtone, and highlight responses already satisfy the current reference behavior. No speculative tonal change was made without contrary reference-test evidence.
- **Sprint C validation:** 237 focused adjustment/frontend-contract tests passed; the full bundled backend suite passed with 734 tests and 1 skip; all 11 Electron shell tests passed; and real WebGPU rendering/interaction passed on `P2150622.ORF` at a 1024-pixel long edge without new cached-interaction allocations.
- **Next stage:** Sprint D, presets and reference matching.

## Outcome

Evolve Film Look into an approachable, film-informed rendering system that helps users move a clinically digital image toward a convincing cinematic or scanned-film reference. The target is perceptual matching and high-quality preview/export agreement, not laboratory emulation of a named stock.

Users should be able to start from a preset, make a few meaningful adjustments, and obtain a coherent result without understanding sensitometry, scanning lenses, print stocks, or color science. Advanced controls should provide enough freedom to match movie stills and high-quality film scans without duplicating the application's general color-grading tools.

## Product principles

1. **Generic and rights-safe:** Do not claim to reproduce, measure, or name commercial film stocks. Presets describe visible character, such as `Clean Cinema`, `Soft Color Negative`, or `High-Speed Texture`.
2. **Film-informed rather than arbitrary:** Controls represent recognizable linked film behavior instead of unrelated LUT-style color changes.
3. **Not another grading panel:** Existing exposure, Tone/Curve Contrast, color wheels, curves, and other grading tools remain responsible for general correction and grading.
4. **Reference-matchable:** A user should be able to compare against a still or scan and identify which Film Look control changes the relevant characteristic.
5. **Safe adjustment ranges:** Controls should be bounded and coupled where appropriate so ordinary settings remain plausible and do not easily produce harsh halos, broken colors, clipped shoulders, or synthetic texture.
6. **Preview is trustworthy:** Interactive WebGPU preview and CPU/export should agree closely enough that a user can make final decisions from the preview.

## Agreed control hierarchy

### Primary ordering

1. **Film Format** at the top of the module. This is the existing physical format selector: 65mm, 35mm, Super 35, Super 16, 16mm, Super 8, or Custom.
2. **Film Look Preset** as an aesthetic starting point.
3. **Look Strength** as one blend between the unmodified input and the completed Film Look.
4. **Main character controls** for the small set of properties users commonly recognize in a reference.
5. **Advanced controls** for precise matching and unusual sources.

Film Format is not a creative preset. It establishes enlargement and physical scale. Custom dimensions plus Frame, Horizontal Strip, or Vertical Strip remain the escape hatch for stitched, line-scanned, and unusual images.

### Proposed main controls

- Color Character
- Highlight Roll-off
- Color Intensity or Density
- Halation
- Bloom
- Grain

Do **not** add another main control simply named `Contrast`. The existing Tone/Curve Contrast control remains the primary global contrast adjustment. Film Look's existing Print Contrast has a distinct late-stage role alongside Toe and Shoulder, but it belongs in Advanced controls and may be set internally by presets.

A future `Tonal Character` or `Film Response` macro may be evaluated as a main control. If added, it must change a constrained combination of toe, shoulder, highlight compression, density, and possibly Print Contrast rather than acting as another global contrast slope.

### Proposed advanced controls

- Print Contrast
- Toe / Shadow Depth
- Shoulder / Highlight Softness
- Color Density
- Red Response
- Green Response
- Blue Response
- Highlight Desaturation
- Shadow Desaturation
- Halation Size and Color
- Bloom Threshold and Spread
- Grain Size, Softness, Color, and tonal response
- Fine Detail / Film Resolution
- Custom film dimensions and capture geometry

Channel response controls should change exposure-dependent sensitivity and reproduction, affecting luminance and color together. They must not behave like three unrestricted grading curves or simple RGB gains.

## Internal rendering model

The UI may remain simple, but the renderer should keep these responsibilities distinct:

1. **Color and exposure response:** bounded channel response, exposure-dependent saturation, toe, shoulder, and density behavior.
2. **Film-plane character:** halation, physical film-detail response, and grain, scaled by Film Format and capture geometry.
3. **Optical finish:** bloom or diffusion describing the visible finished reference. These may use output-relative units when they are not properties of the film plane.
4. **Final master blend:** evaluate the complete Film Look once, then blend it with the untouched stage input once using Look Strength.

This separation is an internal implementation boundary, not terminology the user must learn. It is intentionally lighter than a measured negative/print/scanner simulation.

## Sprint A — Correctness and preview foundation

This is the recommended next implementation sprint.

### A1. Correct Look Strength

Evaluate Film Look parameters at their requested values and apply Look Strength once to the completed Film Look. Remove the current double-scaling behavior in Film Response, where Print Contrast, Toe, and Shoulder are scaled by master strength before the mapped response is blended by a strength-scaled Print Strength.

Verify that 0% is an exact bypass, 100% is the authored result, and intermediate values interpolate predictably across all enabled Film Look stages.

### A2. Decouple Film Resolution from Grain

Film Resolution and image-detail response must operate independently of the Grain enabled switch. Turning off grain must not restore digital sharpness or silently disable resolution processing.

### A3. Skip inactive spatial processing

Do not allocate, extract, or blur spatial buffers when an effect cannot change the image. Apply equivalent gating in WebGPU preview and CPU/export.

Examples:

```text
halation = enabled AND amount > 0 AND Look Strength > 0
bloom = enabled AND amount > 0 AND Look Strength > 0
image structure = enabled AND softness or microcontrast is non-neutral
film resolution = resolution setting is non-neutral
```

This is a performance and consistency change, not a visual change. An enabled module with a zero contribution must be as cheap and visually neutral as a disabled module.

### A4. Define spatial units by effect

- Grain, halation, and film-detail/MTF behavior use the shared physical Film Format and capture-geometry scale.
- Bloom and non-film optical diffusion may remain output-relative, with the choice documented in code.
- Extreme aspect ratios must not use the full image diagonal as a proxy for a single film frame.
- Custom and strip geometries must behave consistently in preview and final export.

### A5. Improve CPU/WebGPU parity

Align the effective blur kernels, radius behavior, caps, edge handling, and stage ordering used for halation, bloom, image structure, and Film Resolution. Exact implementation techniques may differ, but matched settings should not produce materially different visible size or strength.

Add targeted parity fixtures at ordinary, panoramic, and extreme line-scan aspect ratios.

### A6. Establish canonical color semantics

Define the working-space meaning of Film Response and halation tint. Do not calculate a Rec.709-neutralized tint and inject the same numeric RGB vector directly into both linear sRGB and ACEScg.

The implementation may use a canonical scene-linear RGB or XYZ representation, but HDR and SDR must reproduce a consistent intended chromaticity.

## Follow-on sprints

### Sprint B — Perceptual tone and color response

- Introduce smooth, bounded toe and shoulder behavior.
- Improve highlight roll-off and exposure-dependent highlight desaturation.
- Add constrained Red, Green, and Blue Response controls.
- Ensure Color Density differs meaningfully from conventional saturation.
- Protect saturated colors, skin tones, and HDR highlights from discontinuities.
- Decide whether a Tonal Character/Film Response macro adds value without duplicating Tone Contrast.

### Sprint C — Spatial character

- [x] Refine halation extraction so it follows strong exposed boundaries rather than producing a generic warm glow.
- [x] Separate halation amount, physical extent, and tint.
- [x] Refine bloom threshold and spread as an optical finishing effect.
- [x] Make Film Resolution reduce digital microcontrast without reading as an ordinary blur.
- [x] Preserve the physically scaled grain model and refine its tonal interaction only where reference testing demonstrates a need.

### Sprint D — Presets and reference matching

- Store presets as versioned, complete parameter recipes.
- Use descriptive, non-stock names that communicate visible character.
- Build a small deliberately distinct preset set rather than a large LUT-pack-style catalog.
- Add fast before/after, bypass, split-view, or reference-side-by-side workflows.
- Consider preset thumbnails or a contact-sheet preview.
- Ensure presets are editable through understandable controls and return cleanly to neutral.

Automatic reference matching is not required for the initial version. Trustworthy comparison tools and predictable controls take priority.

## Sprint A acceptance criteria

1. Look Strength at 0% is pixel-identical to bypass for both preview branches and export.
2. Look Strength is applied once; response strength does not behave approximately strength-squared.
3. Film Resolution remains active when Grain is disabled.
4. Zero-amount and disabled spatial stages do not dispatch or calculate unnecessary extraction and blur work.
5. Neutral Film Look does not invoke expensive spatial processing.
6. Halation and Film Resolution scale consistently from Film Format and handle Frame, Horizontal Strip, Vertical Strip, and Custom geometry.
7. Bloom's coordinate system is explicit and consistent across preview and export.
8. HDR and SDR halation tint represent the same intended color in their respective working spaces.
9. CPU/export and WebGPU preview agree visually on spatial extent, strength, and stage ordering at normal and extreme aspect ratios.
10. Existing projects load with compatible defaults and existing presets migrate without unintended visible changes except for documented bug corrections.
11. Focused model, adjustment, frontend-contract, and preview tests pass, followed by the full relevant test suites.

## Reference-match evaluation set

Before finalizing new controls or presets, assemble a small rights-safe internal evaluation set representing characteristics rather than named stocks:

- Fine-grain clean daylight image
- High-speed coarse-grain low-light image
- Soft portrait with gentle highlight roll-off
- Saturated daylight colors
- Strong practical lights for halation and bloom
- Deep shadows with colored objects
- HDR highlights
- Wide panorama or stitch
- 64k-class horizontal line scan

The evaluation is perceptual; no measured stock data is required. Record which controls were necessary to approach each reference and remove or redesign controls that consistently duplicate existing grading tools.

## Explicit non-goals

- Measuring, collecting, licensing, or claiming exact reproduction of commercial film stocks
- Using commercial stock names
- Modeling every negative, print paper, process, scanner, or scanning lens as a user-facing component
- Replacing the application's existing general color-grading controls
- Shipping a large collection of heavily stylized LUT-like presets
- Automatic reference matching in the first implementation

## Separate import defect follow-up

Occasional isolated red hot pixels in imported files are not part of Film Look rendering and should be investigated separately as an import-pipeline defect. The initial regression fixture is:

```text
D:\Photos\2018\Craig and Tracy TW Visit 2018\P2150593.ORF
```

The visible example is one isolated red spot on the shirt near the bottom-left of the frame. The detailed investigation note remains in the related Physical Film Grain Sprint PRD.

## Relevant implementation areas

- `codebase/backend/hdr_finisher/models.py` — Film Look schema and defaults
- `codebase/backend/hdr_finisher/adjustments.py` — CPU Film Look order and effects
- `codebase/backend/hdr_finisher/exporters.py` — resize, sharpen, and final-grain ordering
- `codebase/frontend/index.html` — Film Look controls
- `codebase/frontend/app.js` — presets, state, and conditional controls
- `codebase/frontend/webgpu-preview.js` — WebGPU activation, parameters, and shader implementation
