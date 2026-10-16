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

Highlights is a separate, independently bypassable output section. It runs after the creative grade, output finishing, and grain, so changes in Tone, Exposure Bands, color, curves, local adjustments, and Film Look are all included in its measurement.

### Highlight Compression

Use **Peak Fit** for most HDR work. It measures the full-resolution finished highlight peak, constructs a smooth curve in stops, and anchors that peak exactly at **Target Peak**. Unlike a nearly flat ceiling, its **Highlight Detail** control can retain a positive slope at the brightest end, which helps rounded reflections and emissive objects keep visible shape.

- **Start** protects tones below the shoulder. When an extreme source peak, low target, and high detail cannot all fit above Start without reversing the curve, Peak Fit automatically widens the shoulder below the requested value. The transfer graph shows the actual curve and its caption reports the effective start.
- **Target Peak** is the brightest intended luminance after the Highlights section and the upper anchor of Peak Fit.
- **Highlight Detail** is the local stop contrast retained at the source peak. Its default is 35%, which keeps shape in bright fixtures and reflections. Lower it when the peak still feels too sharp or when you want more near-peak samples gathered close to Target Peak. At 0%, the endpoint tangent is flat and peak regions can look more plateaued.
- **Soft Ceiling** is the former asymptotic compressor. Its **Softness** control is useful when you do not want a measured peak anchor, but extreme inputs can bunch together near the ceiling.
- **Clip** applies a strict linear BT.2020 per-channel ceiling at Target Peak. It is useful as a final legalizer and deliberately produces a hard clipped endpoint.

The compact graph plots input nits horizontally and output nits vertically. The dashed diagonal means no compression; the cyan curve shows the active mapping. In **Advanced highlight controls**, choose the absolute maximum, a robust measurement that ignores isolated pixels, or a manual source peak. **Compression Bias** redistributes contrast through the shoulder without moving its endpoints.

**Highlight Color** controls both which peak enters the compressor and what happens to saturated highlights. **Smooth color rolloff** is the default when compression is enabled: it measures the brightest linear BT.2020 channel and applies the same smooth Peak Fit shoulder independently to each channel. Dominant channels compress first, reducing harsh magenta/green/blue transitions and gradually approaching white without brightening weak channels. **Preserve color** measures ACEScg luminance and scales RGB together, retaining exact hue and channel ratios but allowing a saturated channel to extend above Target Peak. **Neutralize peak** retains the older grouped behavior and forces extreme colored highlights to converge to white at the endpoint.

The Highlight Compression section starts bypassed, with Peak Fit and Smooth color rolloff preselected. Use the section bypass button as the single on/off control. Once enabled, automatic peak measurement follows the chosen color mode: BT.2020 maximum channel for Smooth color rolloff, ACEScg luminance for Preserve color, or ACEScg maximum channel for Neutralize peak. Manual Source Peak specifies the final pre-compression peak. Peak Fit runs after the whole grade and finishing path.

The implementation contract and CPU/GPU parameter mapping are documented in [Highlight Compression Technical Reference](../technical/highlight-compression.md).

Peak Fit's Target Peak is the endpoint for the measured final-grade signal. Preserve color can still leave an individual saturated channel above a luminance-based target; use Smooth color rolloff or Clip when the channel ceiling itself matters.

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

## Black & White

**Black & White** converts one rendition to monochrome. It is off by default; turn it on with its eye button. It is separate for HDR and SDR like the other modules: set it on each, or use **Match HDR black & white** in SDR to copy the HDR settings (sliders and on/off) once.

With every slider at 0 the conversion is the same as Saturation −100. The eight sliders (**Reds, Oranges, Yellows, Greens, Aquas, Blues, Purples, Magentas**) set how bright each colour becomes in grey, up to two stops brighter or darker at ±100. Greys, whites and blacks never move, so a slider only changes coloured areas, in proportion to how colourful they are. Colours in very deep shadow (roughly 4 to 7 stops under mid grey) respond less, so colour noise there is not turned into brightness noise; run Denoise first on noisy pictures.

The **presets** set the sliders the way classic filters and films do: Yellow, Orange, Red, Green and Blue filters, an Infrared look and Orthochromatic film. They only move the sliders; they never turn the module on or off. **Reset** puts every slider back to 0 and leaves the module on or off as it was.

Black & White runs straight after Color and before the highlight stage measures the picture, so Highlight Compression and the output ceiling always see the grey picture. With it on, Film Look adds no colour back: halation is neutral, grain has no colour, and the red/green/blue print response is off (your saved Film Look values are kept). Later controls can still add colour on purpose: Color Grading wheels for split toning, RGB Curves, and local adjustments.

## Film Look

Film Look follows local adjustments. Choose a stock, then develop, print and scan it. **Neutral** starts with a straight response. **Look Strength** mixes the completed look once; Detail's Softness and Microcontrast follow that mix independently.

- **Lens Filter** spreads light before the film: None, Black Pro-Mist, Pro-Mist, Glimmerglass or CineBloom. None bypasses the filter. **Strength** runs continuously from 1/8 to 2, with commercial grade marks. **Size** runs from 0.25 to 4 (1 is the filter's normal scale). Film Format changes its physical size. The filter moves light instead of adding it; bright cores soften and surrounding areas receive that light.
- **Development** provides whole-stop Push/Pull from -2 to +2. Portra 800 has measured +1/+2 variants; other choices use an approximation.
- **Print** provides the stock's default paper, Kodak 2383 or Fujifilm Crystal Archive Type II, exposure and paper contrast controls. Slides bypass Print.
- **Scan** provides sharpening (off by default) and optional Lab Levels.
- **Halation** adds coloured edge scatter with a fixed highlight threshold. Spread follows Film Format; Hue Offset and Saturation control its colour. Its map is a viewer diagnostic excluded from export.
- **Grain** is developed density before paper and scan. Its seeded field is shared between HDR and SDR. Fit preview approximates the full-resolution export downsized. Its map is also excluded from export.
- **Film Resolution** softens fine resolving character before the negative.

The filter's longest tails are shortened at the existing processing limit and redistributed inside it. Large Size on small formats can therefore look tighter than an uncapped physical model. Existing saved Film Look projects and presets containing retired Bloom fields must be recreated; there is no conversion. Built-in Looks are due for rebuilding in Phase 5.

## Processing order

The current HDR order is:

1. Tone: exposure, shadow/black, and contrast
2. White balance, primary shaping, saturation, and vibrance
3. Black & White (when on)
4. Exposure Bands
5. Lift/Gamma/Gain
6. Curves
7. Detail and local adjustments
8. Film Look: lens diffusion, resolution scatter, halation, negative/development, density grain, print, scan, then Look Strength
9. Detail Softness and Microcontrast
10. Output Highlights: Peak Fit, Soft Ceiling, or Clip
11. Clamp final negative values to zero

Order matters. A curve sees the result of every preceding enabled section.

## What to watch for

- Treating every bright value as a specular highlight; large surfaces near 1,000 nits can be uncomfortable and trigger display limiting.
- Using rolloff and Exposure Bands to hide a fundamentally misinterpreted source.
- Chasing the monitor peak rather than a creative hierarchy of diffuse and luminous objects.
- Creating colors outside BT.2020 or the target display’s gamut.
- Assuming the 10,000-nit encoding ceiling is a desirable creative target.
- Forgetting that the gain-map result adapts to lower-headroom displays.

Finish by checking [the SDR rendition](grade-sdr.md) and [Chrome Proof](proof.md).
