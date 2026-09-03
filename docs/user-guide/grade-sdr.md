# Author the SDR Fallback

The SDR branch is a full creative rendition, not a preview convenience. It becomes the primary/base image in gain-map exports and is what ordinary JPEG readers, unsupported browsers, many social services, and standalone SDR JPEG/PNG exports display.

Every numeric readout can also be typed directly, including controlled values beyond normal slider travel. See [Grading Controls Reference](grading-controls-reference.md) for keyboard behavior, plain-language control descriptions, and all slider and direct-entry limits.

## The basic goal

Preserve the subject, color relationships, and important highlight detail in a conventional SDR image without trying to imitate HDR brightness. A strong fallback should look intentional on its own.

Start with:

1. Exposure and Shadow for overall placement.
2. Highlight Compression for the bright-end shoulder and color rolloff.
3. Contrast/Pivot and Exposure Bands for tonal refinement.
4. Match HDR colors, then refine the SDR color controls if needed.
5. Lift/Gamma/Gain or Curves only when needed.
6. Use **Match HDR film look** as a starting point, then refine for the SDR rendition.

## Tone

### Exposure

Moves the SDR rendition before/around its display mapping, depending on whether the source supplies an authored SDR reference. Use it to place the overall fallback, not to force all highlights under white.

### Contrast and Pivot

Operate in the display-linear SDR domain. Pivot identifies the normalized value around which contrast expands or compresses.

### Shadow

Adds or removes low-end brightness with a mask that fades toward midtones. Small values are normally sufficient.

## Highlight Compression

Generated SDR uses fixed placement: scene-linear `0.18` maps to approximately `0.493` (`100/203`) in display-linear SDR. This preserves the established fallback placement and does not change with the project's HDR Reference White. Highlight Compression then shapes only the bright end.

**Peak Fit** measures the highlight signal and builds a monotonic shoulder whose measured endpoint lands at SDR white. The default **Smooth color rolloff** maps positive linear-sRGB channels through the same curve independently, so dominant highlight colors compress first and colored fringes fade continuously toward white. **Preserve color** retains RGB ratios; **Neutralize peak** deliberately converges the brightest endpoint to neutral white.

**Start** chooses the requested shoulder onset. **Highlight Detail** retains more or less endpoint contrast. **Compression Bias** redistributes separation within the shoulder. The effective start may move lower when necessary to fit a smooth, monotonic curve between the requested start and a very high measured peak.

**Soft Ceiling** is an optional luma-preserving asymptotic shoulder controlled by Softness. It does not anchor a measured endpoint.

For generated SDR, Highlight Compression is enabled by default with Peak Fit and Smooth color rolloff. For an imported authored SDR base, it starts bypassed so the existing rendition is unchanged; enable it when that base needs a new shoulder. It cannot reconstruct detail or channel ratios already clipped in the source.

## Exposure Bands

SDR Exposure Bands reshape the compressed, display-linear fallback by brightness while preserving RGB ratios. The graph is centered on 18% display-linear gray and marks the 100% SDR boundary. Positive adjustments above that boundary can clip at final SDR output, so confirm the result in the SDR histogram or waveform.

**Match HDR bands** is a one-shot starting point. It copies the HDR nodes, adjustments, influence, and smoothing into SDR, then leaves the two renditions independent. Because the SDR bands operate after tone mapping while HDR bands operate on scene-linear HDR, copied values preserve the authored curve shape but are not expected to produce pixel-identical tonal placement.

## Match HDR colors

**Match HDR colors** is a one-shot starting point. It copies the current HDR Temperature, Tint, Saturation, Vibrance, and RGB Primaries slider positions into the SDR Color panel. It does not link the branches, and it does not copy Exposure or any other tone control.

After matching, every SDR color slider remains independently editable. Later HDR color changes do not affect SDR unless you press **Match HDR colors** again. Use **Reset** to return only the SDR color sliders to their neutral defaults; SDR Exposure and the other tone controls are preserved.

The SDR color controls operate through ACEScg for primary shaping, then convert back to display-linear sRGB.

## SDR gamut compression

After fixed SDR placement, HDR Finisher converts ACEScg to linear sRGB and applies Highlight Compression. Colors still outside the normalized sRGB cube are then moved toward luma until all channels fit, preserving the luma anchor and broadly preserving hue direction.

This is a simple global compression, not a perceptual appearance model. Strong wide-gamut colors can lose chroma. Inspect the SDR branch rather than assuming the HDR color grade will survive unchanged.

## Lift, Gamma, Gain and Curves

SDR Lift/Gamma/Gain uses the same stop-relative zone concept as the HDR branch, but acts on the bounded display rendition. Range and Pivot still define where each zone operates.

SDR Curves work from 0 to 1 rather than the HDR logarithmic upper range. Luma changes brightness; RGB curves change channel balance. Curves are stored independently per branch.

## Match HDR film look

When SDR is active, **Match HDR film look** makes a one-time copy of the HDR Film Look preset identity, all continuous Film Look values, and the Halation, Bloom, Image Structure, and Grain enabled states. It deliberately preserves the SDR Film Look section's top-level bypass state. After the copy, every SDR value remains independent; later HDR changes are not linked. SDR also has its own Film Look preset browser; built-in models cannot be deleted, while user-created presets can be removed there.

Sensitivity is branch-relative, so a copied Halation or Bloom value qualifies an analogous bright population rather than reusing an HDR nit threshold. Both branches sample the same seeded grain field to keep gain-map reconstruction from mixing unrelated noise patterns.

## Processing order

For a scene-linear source without an authored SDR reference:

1. SDR exposure and shadow
2. Independent SDR color grade (optionally initialized from HDR with Match HDR colors)
3. Fixed `0.18` to `100/203` placement and conversion to display-linear sRGB
4. Highlight Compression and sRGB gamut compression
5. Exposure Bands
6. Contrast and Lift/Gamma/Gain
7. Curves
8. Film Response/Color Density, Halation, Bloom, Image Structure, then Grain

For an authored SDR reference such as supported Apple HDR HEIC:

1. Begin with the authored display-linear sRGB rendition
2. Exposure and shadow
3. Optional Highlight Compression (bypassed on import)
4. Exposure Bands
5. Contrast, then SDR color grade through ACEScg and back to sRGB
6. Lift/Gamma/Gain and Curves
7. Film Response/Color Density, Halation, Bloom, Image Structure, then Grain

The final result is clipped to the normalized SDR range.

## Review checklist

- Does the subject read without relying on HDR brightness?
- Are important highlights detailed rather than gray or clipped?
- Are blacks intentional on an ordinary SDR display?
- Did gamut compression alter saturated colors?
- Does the SDR version remain recognizably the same creative work as HDR?
- Does a standalone SDR JPEG or PNG match the fallback decoded from the gain-map file closely enough for delivery?

## Watch out for

- Treating the fallback as an automatic tone-map by-product
- Setting Start too low or Highlight Detail too flat until the image loses its intended highlight contrast
- Expecting Match HDR colors to remain linked after the one-shot copy
- Expecting Match HDR bands to produce identical HDR and SDR tonal placement
- Expecting exact color identity between wide-gamut HDR and sRGB SDR
- Correcting a wrong source interpretation independently in each branch
