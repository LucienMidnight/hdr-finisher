# Grade the HDR Rendition

The HDR branch defines the brightest intended rendition. It remains scene-linear in ACEScg while you grade it, then becomes BT.2020/PQ for HDR preview and export.

## A practical grading order

1. Establish overall exposure and diffuse-white placement.
2. Shape highlights without flattening the scene.
3. Correct broad color.
4. Use brightness-selective tools for local tonal populations.
5. Finish with Lift/Gamma/Gain or Curves.
6. Check the waveform, lower-headroom proof targets, and SDR branch.

Section bypass buttons let you audition a group without destroying its settings. **Reset** returns only that group to defaults.

## Tone

### Exposure

Multiplies scene-linear RGB by `2^EV`. A +1 EV change doubles linear light; -1 EV halves it. Exposure moves everything, including diffuse white and specular highlights.

Use it for global placement, not to solve only one bright region.

### Highlight Rolloff

Applies a continuous logarithmic shoulder above **Rolloff Start**. It reduces the rate at which bright luminance rises while keeping the transition continuous.

Use it when highlights feel abrupt, exceed the useful delivery range, or need a gentler shoulder. Excessive rolloff makes HDR look flat and can compress separation between different bright materials.

### Rolloff Start

Defines the luminance, in the app’s reference nits, above which the shoulder begins. Start higher to protect more mid/high tones; start lower to shape a broader portion of the image.

### Contrast and Pivot

Contrast expands or compresses tonal separation around Pivot. The HDR pivot is a scene-linear value; its neutral default is near `0.18`, the app’s 100-nit diffuse-white anchor.

Changing contrast can also change apparent saturation and highlight placement. Recheck the scope after using it.

### Shadow / Black

Applies a luma-weighted change that is strongest in dark regions and fades toward brighter values. Use small adjustments to seat blacks or reveal low-level detail. It is not a local shadow-recovery algorithm and cannot restore clipped source data.

## Exposure Bands

The equalizer maps input scene brightness from -6 to +6 EV around diffuse white. `0 EV` equals 100 nits; +1 EV is 200 nits, +2 EV is 400 nits, and so on.

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

- Below 100 nits, the domain is linear relative to the `0.18` anchor.
- Above 100 nits, it is logarithmic through the 10,000-nit PQ range.

That makes the upper half useful for HDR stops rather than spending most of the graph on a small numerical interval. Curves use monotone cubic interpolation between 2–16 control points; endpoint x positions are fixed.

Use Luma first for tonal shape. RGB channel curves alter color balance and can cause channel-specific clipping or hue shifts.

## Processing order

The current HDR order is:

1. Exposure, highlight rolloff, shadow/black, and contrast
2. White balance, primary shaping, saturation, and vibrance
3. Exposure Bands
4. Lift/Gamma/Gain
5. Curves
6. Clamp final negative values to zero

Order matters. A curve sees the result of every preceding enabled section.

## What to watch for

- Treating every bright value as a specular highlight; large surfaces near 1,000 nits can be uncomfortable and trigger display limiting.
- Using rolloff and Exposure Bands to hide a fundamentally misinterpreted source.
- Chasing the monitor peak rather than a creative hierarchy of diffuse and luminous objects.
- Creating colors outside BT.2020 or the target display’s gamut.
- Assuming the 10,000-nit encoding ceiling is a desirable creative target.
- Forgetting that the gain-map result adapts to lower-headroom displays.

Finish by checking [the SDR rendition](grade-sdr.md) and [Chrome Proof](proof.md).
