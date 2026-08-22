# Grade the HDR Rendition

The HDR branch defines the brightest intended rendition. It remains scene-linear in ACEScg while you grade it, then becomes BT.2020/PQ for HDR preview and export.

## A practical grading order

1. Establish overall exposure and diffuse-white placement.
2. Shape highlights without flattening the scene.
3. Correct broad color.
4. Use brightness-selective tools for local tonal populations.
5. Finish with Lift/Gamma/Gain or Curves.
6. Add the Film Look after the grade is stable.
7. Check the waveform, lower-headroom proof targets, and SDR branch.

Section bypass buttons let you audition a group without destroying its settings. **Reset** returns only that group to defaults.

Every numeric readout can also be typed directly, including controlled values beyond normal slider travel. See [Grading Controls Reference](grading-controls-reference.md) for keyboard behavior, plain-language control descriptions, and all slider and direct-entry limits.

## Tone

### Exposure

Multiplies scene-linear RGB by `2^EV`. A +1 EV change doubles linear light; -1 EV halves it. Exposure moves everything, including diffuse white and specular highlights.

Use it for global placement, not to solve only one bright region.

### Contrast and Pivot

Contrast expands or compresses tonal separation around Pivot. The HDR pivot is a scene-linear value; its neutral default is near `0.18`, which maps to the active project HDR Reference White. New projects use 203 nits. See [HDR Reference White](hdr-reference-white.md).

Changing contrast can also change apparent saturation and highlight placement. Recheck the scope after using it.

### Shadow / Black

Applies a luma-weighted change that is strongest in dark regions and fades toward brighter values. Use small adjustments to seat blacks or reveal low-level detail. It is not a local shadow-recovery algorithm and cannot restore clipped source data.

## Highlights

Highlights is a separate, independently bypassable section after Tone. Both compression modes therefore see the result of Exposure, Contrast, Pivot, and Shadow / Black.

### Highlight Compression

Use **Peak Fit** for most HDR work. It measures the full-resolution source highlight peak, constructs a smooth curve in stops, and anchors that peak exactly at **Target Peak** inside the Highlights section. Unlike a nearly flat ceiling, its **Highlight Detail** control can retain a positive slope at the brightest end, which helps rounded reflections and emissive objects keep visible shape.

- **Start** protects tones below the shoulder. When an extreme source peak, low target, and high detail cannot all fit above Start without reversing the curve, Peak Fit automatically widens the shoulder below the requested value. The transfer graph shows the actual curve and its caption reports the effective start.
- **Target Peak** is the brightest intended luminance after the Highlights section and the upper anchor of Peak Fit.
- **Highlight Detail** is the local stop contrast retained at the source peak. Its default is 35%, which keeps shape in bright fixtures and reflections. Lower it when the peak still feels too sharp or when you want more near-peak samples gathered close to Target Peak. At 0%, the endpoint tangent is flat and peak regions can look more plateaued.
- **Soft Ceiling** is the former asymptotic compressor. Its **Softness** control is useful when you do not want a measured peak anchor, but extreme inputs can bunch together near the ceiling.

The compact graph plots input nits horizontally and output nits vertically. The dashed diagonal means no compression; the cyan curve shows the active mapping. In **Advanced highlight controls**, choose the absolute maximum, a robust measurement that ignores isolated pixels, or a manual source peak. **Compression Bias** redistributes contrast through the shoulder without moving its endpoints.

**Highlight Color** controls both which peak enters the compressor and what happens to saturated highlights. **Preserve color** is the default: it measures ACEScg luminance and scales RGB together, preserving hue and channel ratios. A saturated red, green, or blue channel can therefore extend above Target Peak. **Compress channels toward white** instead measures the brightest RGB channel, groups all three channels into Peak Fit, and gradually makes extreme colored lights approach neutral white. This catches saturated highlights whose luminance is below Start but whose brightest channel exceeds Target Peak.

Peak measurement uses ACEScg luminance for Preserve color and the brightest individual RGB channel for Compress channels toward white. Manual Source Peak is specified before Tone controls and follows the same meaning. Peak Fit runs after Exposure, Shadow / Black, and Contrast, so its graph and endpoint account for all three.

The implementation contract and CPU/GPU parameter mapping are documented in [Highlight Compression Technical Reference](../technical/highlight-compression.md).

Target Peak is local to the Highlights section, not a permanent clamp on the finished image. Exposure Bands, Color, Lift/Gamma/Gain, Curves, and Film Look remain creative stages after it and can move the final waveform peak. Recheck the scope after using those sections.

The source peak is measured at full resolution, but Standard preview scopes analyze a downsampled rendition. If the exact brightest sample is filtered away, the preview can read below Target Peak even though Peak Fit's full-resolution endpoint is correct. This is especially visible with nonzero Highlight Detail because nearby samples deliberately retain contrast below the endpoint. Use High-res Preview or a full-resolution export for the authoritative peak check.

## Exposure Bands

The equalizer maps input scene brightness from -6 to +6 EV around project reference white. `0 EV` equals the selected 203- or 100-nit reference; each positive EV doubles that value.

- Add or remove interior bands.
- Move a band horizontally to target a different input brightness.
- Move it vertically to add or remove up to 2 EV at that brightness.
- **Influence** changes the effective width around a band.
- **Curve smoothing** blends between a piecewise-linear and smooth monotonic mapping.

The endpoints remain at the ends of the editable range. The processor prevents the mapping from reversing tonal order, even if an API client submits invalid crossings.

Use Exposure Bands to lower a bright sky population, lift a dim subject, or reshape highlight groups without a hard mask. It is luminance-selective, not spatially selective: two objects at the same scene brightness are affected together.

## Color

### Temperature and Green/Magenta Tint

Apply a global white-balance adaptation relative to the neutral 6500 K setting. This is a finishing correction, not RAW white balance; the source has already been rendered into RGB.

Large corrections can stress saturated colors and cannot recover a channel clipped during capture or upstream processing.

### Saturation

Scales chroma relative to ACEScg luma. It affects already-saturated colors and muted colors more uniformly.

### Vibrance

Weights the change toward lower-chroma colors and protects colors already near high relative chroma. It is useful for enriching a quiet image without pushing the strongest colors as hard.

Neither control automatically guarantees output-gamut safety. Review channel scopes and real exports.

### RGB Primaries

Red, green, and blue **Hue** rotate each working primary in the ACEScg chromaticity plane. **Purity** moves the primary toward, away from, or beyond the working-gamut boundary. **Tint Hue/Purity** moves the achromatic point, allowing a global colored bias.

These are matrix-style global primary-shaping controls inspired by darktable-like primaries work. They are not HSL selections and do not isolate objects named “red,” “green,” or “blue.” Extreme purity can create negative or highly out-of-gamut intermediate values that later stages sanitize or compress.

## Lift, Gamma, Gain

The three controls use overlapping luminance-zone masks defined in stops around diffuse white:

- **Lift:** shadows, with a smooth falloff around its Pivot and Range.
- **Gamma:** a bell-shaped midtone region centered on its Pivot.
- **Gain:** highlights, with a smooth rise around its Pivot and Range.

Range controls zone width; Pivot moves it through the scene. The scope influence preview helps reveal which brightness values are targeted.

This is not the same formula as every video grading application. Judge the actual zone overlay and waveform rather than transferring numeric recipes from another tool.

## Curves

Curves are independent for HDR and SDR. Enable them and select Luma, Red, Green, or Blue.

The HDR curve domain places diffuse white at the midpoint:

- Below the active project reference white, the domain is linear relative to the `0.18` anchor.
- Above the active project reference white, it is logarithmic through the 10,000-nit PQ range.

That makes the upper half useful for HDR stops rather than spending most of the graph on a small numerical interval. Curves use monotone cubic interpolation between 2–16 control points; endpoint x positions are fixed.

Use Luma first for tonal shape. RGB channel curves alter color balance and can cause channel-specific clipping or hue shifts.

## Film Look

Film Look is the final creative layer after Curves. Its reference models—Large Format Fine, 35mm Fine, 35mm Balanced, 35mm Fast, and 16mm Fine—populate every control, but remain editable. They are generic cinema-finishing models informed by published motion-picture film behavior, not claims of exact stock matching.

- **Cinema Print** shapes contrast, toe, shoulder, and subtractive color density in a perceptual scene-aware domain. It preserves HDR headroom rather than imposing a literal print-film white level.
- **Halation** adds warm edge scatter around branch-relative highlights. Sensitivity selects analogous highlight populations in HDR and SDR; **View qualification map** is a preview diagnostic and is never baked into an export.
- **Bloom & Diffusion** creates a broader, mostly neutral highlight glow using a smooth linear-light diffusion filter. Highlight Detail separates optical bloom from core diffusion: at 100% the source edge stays intact beneath the added glow; lower values progressively move highlight energy outward and soften the bright core.
- **Image Structure** softens brittle digital edges or adjusts microcontrast before grain.
- **Grain** varies through shadows, midtones, and highlights. Film Resolution controls the pre-grain resolving character; grain is always the last operation.

Radius values are percentages of image diagonal, so their apparent scale remains consistent between proxy preview and full-resolution export. The HDR and SDR branches share a deterministic grain field while retaining independent grain strength and response.

## Processing order

The current HDR order is:

1. Tone: exposure, shadow/black, and contrast
2. Highlights: Soft Ceiling or Peak Fit, including optional highlight path to white
3. White balance, primary shaping, saturation, and vibrance
4. Exposure Bands
5. Lift/Gamma/Gain
6. Curves
7. Film Response and Color Density
8. Halation
9. Bloom/Diffusion
10. Image Softness and Microcontrast
11. Grain
12. Clamp final negative values to zero

Order matters. A curve sees the result of every preceding enabled section.

## What to watch for

- Treating every bright value as a specular highlight; large surfaces near 1,000 nits can be uncomfortable and trigger display limiting.
- Using rolloff and Exposure Bands to hide a fundamentally misinterpreted source.
- Chasing the monitor peak rather than a creative hierarchy of diffuse and luminous objects.
- Creating colors outside BT.2020 or the target display’s gamut.
- Assuming the 10,000-nit encoding ceiling is a desirable creative target.
- Forgetting that the gain-map result adapts to lower-headroom displays.

Finish by checking [the SDR rendition](grade-sdr.md) and [Chrome Proof](proof.md).
