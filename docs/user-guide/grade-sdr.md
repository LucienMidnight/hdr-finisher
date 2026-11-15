# Author the SDR Fallback

The SDR branch is a full creative rendition, not a preview convenience. It becomes the primary/base image in gain-map exports and is what ordinary JPEG readers, unsupported browsers, many social services, and standalone SDR JPEG/PNG exports display.

Every numeric readout can also be typed directly, including controlled values beyond normal slider travel. See [Grading Controls Reference](grading-controls-reference.md) for keyboard behavior, plain-language control descriptions, and all slider and direct-entry limits.

## The basic goal

Preserve the subject, color relationships, and important highlight detail in a conventional SDR image without trying to imitate HDR brightness. A strong fallback should look intentional on its own.

Start with:

1. Exposure for overall placement.
2. Set tone and colour, then Film Look; finish with Highlight Compression for the bright-end shoulder and color rolloff.
3. Contrast/Pivot and Exposure Bands for tonal refinement.
4. Match HDR colors, then refine the SDR color controls if needed.
5. Five-control Tone or Curves only when needed.
6. Use **Match HDR film look** as a starting point, then refine for the SDR rendition.

## Tone

### Exposure

Moves the SDR rendition before/around its display mapping, depending on whether the source supplies an authored SDR reference. Use it to place the overall fallback, not to force all highlights under white.

### Contrast and Pivot

Operate in the display-linear SDR domain. Pivot identifies the normalized value around which contrast expands or compresses.

### Blacks, Shadows, Midtones, Highlights and Whites

These five controls form one operation after Exposure Bands/foundation, before
HSL, curves, wheels, Local adjustments and Film Look. They all select from the
same frozen input: changing one control cannot move another's selected range.
All five at zero leaves pixels unchanged.

- **Blacks** lifts a narrow neutral floor, or clips the deepest blacks with a
  negative value. It stops affecting tones at 2.25% of reference white.
- **Shadows / Midtones / Highlights** brighten or darken broad, smoothly fading
  ranges. **Center** is stops from photographic mid-grey (18% of the lane's
  reference white); **Width** is their full width in stops. Endpoint gates keep
  these controls away from black and the brightest whites. Extreme overlapping
  settings are reduced together to prevent tonal reversal; strength is not a
  fixed exposure-stop amount.
- **Whites** acts on the top stop below the HDR Target Peak, or SDR display
  white. Alone, −100 makes a target-level input 77.5% of target, +100 gives one
  stop of overdrive before Film Look. Final Highlight Compression still owns the
  delivered peak; enable it to guarantee HDR Target Peak. Whites does not change
  the target. Peak Fit can also reshape other highlights when the measured peak
  rises; choose Fixed cap when you want a photo-independent cap.

Defaults (Center / Width): Shadows −1.5 / 5 EV; Midtones 0 / 4 EV;
Highlights HDR +2.25 / 4.5 EV, SDR +1.75 / 3.5 EV. Blacks/broad overlap is
one stop; broad/Whites overlap is half a stop. The new curves intentionally
change saved non-zero global Tone grades. Local Tone uses its existing curves
until the next step; clipping/range preview is not yet part of this block.

Generated SDR places scene .18 at display-linear 100/203. Center 0 is
.18×100/203 = .08866995074 display-linear, not 18% of display white. An authored
SDR base uses the same coordinates without another placement conversion.
HDR and SDR color-wheel Balance/Blending now cover the same ranges relative to
the lane's reference white, including local wheels.

## Highlight Compression

Generated SDR uses fixed placement: scene-linear `0.18` maps to approximately `0.493` (`100/203`) in display-linear SDR. This preserves the established fallback placement and does not change with the project's HDR Reference White. Highlight Compression shapes the bright end after Film Look, grain and output finishing, just before the final sRGB gamut boundary. Film Look receives uncompressed placed SDR. This order intentionally changes existing SDR grades with compression enabled.

**Peak Fit** measures the highlight signal and builds a monotonic shoulder whose measured endpoint lands at SDR white. The default **Smooth color rolloff** maps positive linear-sRGB channels through the same curve independently, so dominant highlight colors compress first and colored fringes fade continuously toward white. **Preserve color** retains RGB ratios; **Neutralize peak** deliberately converges the brightest endpoint to neutral white.

**Start** chooses the requested shoulder onset. **Highlight Detail** retains more or less endpoint contrast. **Compression Bias** redistributes separation within the shoulder. The effective start may move lower when necessary to fit a smooth, monotonic curve between the requested start and a very high measured peak.

**Fixed cap** leaves values below Start unchanged, then smoothly compresses brighter colours toward Target using one hue-preserving RGB multiplier. It does not measure the photo's peak and uses only Start and Target (SDR Target is fixed at display white). Peak Fit, Soft Ceiling and Clip keep their controls and defaults.

**Soft Ceiling** is an optional luma-preserving asymptotic shoulder controlled by Softness. It does not anchor a measured endpoint.

For generated SDR, Highlight Compression is enabled by default with Peak Fit and Smooth color rolloff. For an imported authored SDR base, it starts bypassed so the existing rendition is unchanged; enable it when that base needs a new shoulder. It cannot reconstruct detail or channel ratios already clipped in the source.

## Exposure Bands

SDR Exposure Bands reshape the uncompressed, placed display-linear fallback by brightness while preserving RGB ratios. The graph is centered on 18% display-linear gray and marks the 100% SDR boundary. Positive adjustments above that boundary can clip at final SDR output, so confirm the result in the SDR histogram or waveform.

**Match HDR bands** is a one-shot starting point. It copies the HDR nodes, adjustments, influence, and smoothing into SDR, then leaves the two renditions independent. Because the SDR bands operate after fixed placement while HDR bands operate on scene-linear HDR, copied values preserve the authored curve shape but are not expected to produce pixel-identical tonal placement.

## Match HDR colors

**Match HDR colors** is a one-shot starting point. It copies the current HDR Temperature, Tint, Saturation, Vibrance, and RGB Primaries slider positions into the SDR Color panel. It does not link the branches, and it does not copy Exposure or any other tone control.

After matching, every SDR color slider remains independently editable. Later HDR color changes do not affect SDR unless you press **Match HDR colors** again. Use **Reset** to return only the SDR color sliders to their neutral defaults; SDR Exposure and the other tone controls are preserved.

The SDR color controls operate through ACEScg for primary shaping, then convert back to display-linear sRGB.

## SDR gamut compression

After fixed SDR placement, HDR Finisher retains linear-sRGB headroom through tone, colour, Film Look and finishing. Highlight Compression then shapes highlights, and the final hue-preserving adaptive OKLCh mapper brings colours into normalized sRGB. This final boundary also runs when Highlight Compression is bypassed.

This is a simple global compression, not a perceptual appearance model. Strong wide-gamut colors can lose chroma. Inspect the SDR branch rather than assuming the HDR color grade will survive unchanged.

## Tone and Curves

The five-control Tone block uses the placed display rendition and the
photographic-grey Center/Width anchor described above.

SDR Curves work from 0 to 1 rather than the HDR logarithmic upper range. Luma changes brightness; RGB curves change channel balance. Curves are stored independently per branch.

## Match HDR film look

When SDR is active, **Match HDR film look** makes a one-time copy of the HDR Film Look preset identity, all continuous Film Look values, and the lens filter choice and the Halation and Grain enabled states. It deliberately preserves the SDR Film Look section's top-level bypass state. After the copy, every SDR value remains independent; later HDR changes are not linked. SDR also has its own Film Look preset browser; built-in models cannot be deleted, while user-created presets can be removed there.

Lens filters copy their physical family, commercial strength and size. Halation uses its fixed branch-relative threshold; no Sensitivity control remains. Both branches sample the same seeded grain field to keep gain-map reconstruction from mixing unrelated noise patterns.

## Processing order

For a scene-linear source without an authored SDR reference:

1. SDR exposure
2. Independent scene Color, then Black & White when on
3. Fixed `.18 → 100/203` placement and conversion to display-linear sRGB
4. Exposure Bands and Contrast/Pivot
5. Five-control Tone
6. HSL, Curves, color wheels, Detail and ordered locals
7. Film Look: lens diffusion, resolution scatter, halation, negative/development, density grain, print, scan, then Look Strength
8. Detail structure and Vignette

For an authored SDR reference such as supported Apple HDR HEIC:

1. Begin with the authored display-linear sRGB rendition (no placement conversion)
2. Exposure and Black & White when on
3. Exposure Bands and Contrast/Pivot
4. Color through ACEScg and back to sRGB
5. Five-control Tone
6. HSL, Curves, color wheels, Detail and ordered locals
7. Film Look and spatial finishing
8. Detail structure and Vignette

Both paths finish with output resize/sharpening, Highlight Compression (bypassed by default for authored SDR), then unconditional hue-preserving sRGB gamut mapping to [0,1].

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
