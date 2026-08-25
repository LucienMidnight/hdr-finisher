# Physical Film Grain Sprint

## Outcome

Replace the current image-diagonal-scaled hash noise with deterministic, physically scaled film grain. Users choose a familiar film format; the renderer maps an emulsion-scale grain field into that physical frame and samples the same field in interactive proxies and final-resolution exports.

This sprint preserves the existing grain-last pipeline, shared HDR/SDR seed, density-domain application, chroma guard, and independent shadow/midtone/highlight response controls. The work is an honest generic film model, not a claim of matching a named stock.

## Problem

The current renderer calculates a nominal pitch from image diagonal:

```text
max(1 px, image diagonal / 2400 * size-and-softness factor)
```

It then evaluates a sine/fract hash at every output pixel. Adjacent samples remain effectively uncorrelated, so increasing nominal pitch mostly changes the deterministic pattern instead of producing larger grain clusters. Resolution participates in the formula, but the visible result remains close to single-pixel noise.

Resolution alone also says nothing about capture geometry. A 64k × 4k continuous linescan must not be interpreted as one extremely wide film gate.

## Product model

### Film format

Add a Film Format choice with these initial generic gates:

| Format | Physical gate |
| --- | --- |
| 65mm | 52.63 × 23.01mm |
| 35mm | 36 × 24mm |
| Super 35 | 24.89 × 18.66mm |
| Super 16 | 12.52 × 7.41mm |
| 16mm | 10.26 × 7.49mm |
| Super 8 | 5.79 × 4.01mm |
| Custom | User-entered width and height |

Film format controls enlargement. Grain Size continues to describe the emulsion/grain character and maps to a physical correlation diameter from 6–30µm.

### Capture geometry

Add a compact Capture Geometry choice:

- **Frame:** fit the image as a crop within one physical gate. Pixel density is the larger of width/gate-width and height/gate-height.
- **Horizontal strip:** map image height to gate height and extend the physical field horizontally. This supports horizontal linescans and very wide stitched images.
- **Vertical strip:** map image width to gate width and extend the physical field vertically.

Custom format exposes only two additional controls: Physical Width and Physical Height. These controls, combined with Capture Geometry, are the escape hatch for unusual cameras, scans, stitches, and scientific images. More specialized UI can follow later without changing the stored model.

## Rendering model

For a frame:

```text
pixels_per_mm = max(image_width / gate_width_mm,
                    image_height / gate_height_mm)
```

For a horizontal or vertical strip:

```text
horizontal strip: pixels_per_mm = image_height / gate_height_mm
vertical strip:   pixels_per_mm = image_width  / gate_width_mm
```

Grain Size maps linearly to a physical diameter:

```text
grain_diameter_um = 6 + 24 * grain_size / 100
grain_pitch_px = pixels_per_mm * grain_diameter_um / 1000
```

The renderer evaluates seeded value noise in physical grain coordinates. Bilinear interpolation creates an actual spatially correlated grain structure rather than using the nominal pitch only to perturb a pixel hash. A lower-frequency octave remains controlled by Grain Softness.

When the physical pitch is below one pixel, pixel-footprint attenuation reduces its amplitude to approximate unresolved grains averaging within a pixel. Grain is still applied multiplicatively in the existing density/exposure-like domain:

```text
output = input * 2 ** (grain * tonal_response * amount)
```

The tonal response remains:

```text
shadow    = (1 - signal)²
highlight = signal²
midtone   = 1 - shadow - highlight
```

Optional chroma grain continues to use separately salted fields and converges toward monochrome near clipping.

## Proxy and export contract

- Grain coordinates derive from the selected physical gate and capture geometry, so proxy and final export address the same seeded field.
- Proxy sampling uses its own pixel footprint. Unresolved grain naturally attenuates when fit to screen and resolves as the user zooms or requests a larger proxy.
- Export continues to synthesize grain after resize and sharpening at final output resolution.
- Procedural global coordinates allow tiled rendering without seams and avoid allocating a full-resolution grain map.

## Defaults and preset migration

- Neutral defaults to 35mm, Frame, 36 × 24mm custom fallback, Size 50, Softness 25, and Amount 0.
- Large Format Fine selects 65mm.
- Existing 35mm presets select 35mm.
- 16mm Fine selects 16mm.
- Existing projects that lack the new fields receive neutral defaults through schema defaults.

## Acceptance criteria

1. CPU/export and WebGPU use the same gate dimensions, capture-geometry rules, physical size mapping, value-noise structure, and subpixel attenuation.
2. At a fixed output resolution and Grain Size, smaller film formats produce larger spatial grain than larger formats.
3. A 64k × 4k horizontal strip derives scale from the 4k cross-scan dimension, not its 64k diagonal or width.
4. The same seed and settings are deterministic; changing the seed changes the field.
5. Grain remains last and continues to respond independently in shadows, midtones, and highlights.
6. Custom width and height validate to finite values from 1–500mm.
7. Existing neutral Film Look remains pixel-identical because Amount defaults to zero.
8. Focused backend and frontend contract tests pass, followed by the broader adjustment and model test suites.

## Deferred work

- Named stock measurements and calibrated development/scan profiles.
- More sophisticated silver-halide clumping, dye-cloud coupling, and exposure-dependent grain morphology.
- Automatic capture-geometry inference from metadata.
- UI refinement beyond the initial format, geometry, and conditional custom-dimension controls.
- Explicit grain-map mip chains for very large tiled GPU exports if profiling requires them.
