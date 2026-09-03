# Grading Controls Reference

Every numeric readout in the HDR and SDR Control Panels can be edited directly. Double-click the value, type a number, and press **Enter**. You can also focus a value with the keyboard and press **Enter** or **F2**. Press **Escape** to cancel; clicking elsewhere commits the value.

For on-screen sliders, hold **Ctrl** for approximately 10× finer pointer or arrow-key movement. Hold **Shift** to use the authored landing positions; the rails intentionally show no tick marks. Shift takes precedence when both modifiers are held. Curves and Exposure Bands use Ctrl for fine graph movement without Shift snapping. Exposure Bands keeps **Ctrl/Command+Left/Right** for moving the selected band horizontally. See [Application settings and shortcuts](application-settings-and-shortcuts.md#slider-and-graph-modifiers) for the full modifier contract.

Units are optional. For example, `100`, `100 nit`, and `100 nits` all set a nit control to 100. Saturation and Vibrance are entered as the percentage shown in the interface, so typing `125` means +125%. If an entry exceeds its safety limit, HDR Finisher uses the nearest allowed value. When a typed value lies beyond normal slider travel, the value remains exact while the slider rests at its nearest end and uses the warning color.

The sliders intentionally cover the useful everyday range. Some slider ranges become narrower for sources classified as Medium or Narrow latitude, which makes fine adjustments easier. Direct entry provides controlled extra room without making the slider less precise.

## HDR Tone and Highlights

| Control | Purpose in plain English | How it works | Normal slider range | Direct-entry range |
|---|---|---|---|---|
| Exposure | Makes the whole HDR rendition brighter or darker. | Multiplies scene-linear light by `2^EV`; +1 EV doubles light. | Narrow -2 to +2 EV; Medium -3 to +3 EV; Wide -4 to +4 EV | **-8 to +8 EV** |
| Compression Mode | Chooses the kind of highlight shoulder. Peak Fit is the default; the section bypass is the single on/off control. | Peak Fit uses a monotonic stop-domain curve anchored to the measured input peak. Soft Ceiling asymptotically approaches Target Peak. | Peak Fit, Soft Ceiling | Same choices |
| Compression Start | Protects tones below the shoulder and says where highlight bending should begin. | Converts the entered reference-nit level to scene-linear ACEScg. Peak Fit can move the effective start lower when necessary to keep an extreme compression ratio smooth and monotonic; the graph and caption show this. | 100 to 4,000 nit | **1 to 9,999 nit**; it must remain below Target Peak |
| Target Peak | Sets the brightest intended output highlight for the Highlights section. | Peak Fit maps the selected luminance peak exactly to this value after Exposure, Shadow / Black, and Contrast. Soft Ceiling treats it as an asymptote. Later creative sections can intentionally move the final waveform peak. HDR transport still has a 10,000-nit PQ ceiling. | 200 to 10,000 nit | **2 to 10,000 nit**; it must remain above Start |
| Highlight Detail | Keeps or flattens local contrast at the very brightest end in Peak Fit. | Sets the output stop-slope at the input peak: 0% is flat there, while 100% retains the source's local stop separation. The curve remains monotonic. | 0 to 100% | **0 to 100%** |
| Softness | Changes Soft Ceiling from firm and late to broad and gentle. | Changes the generalized soft-ceiling exponent and blends the effect in from 0%. The slider moves in fine 0.5-percentage-point steps. It only applies in Soft Ceiling mode. | 0 to 100% | **0 to 100%**; 0% makes Soft Ceiling neutral |
| Manual Source Peak | Overrides the measured source peak when automatic measurement does not describe the highlight you care about. | Supplies Peak Fit's input anchor before the Exposure adjustment. Automatic choices use the active Highlight Color signal or its 99.99th percentile to ignore isolated pixels. | 100 to 100,000 nit | **1 to 1,000,000 nit** |
| Compression Bias | Moves compression pressure earlier or later without moving the endpoints. | Re-parameterizes the monotonic shoulder while preserving its endpoint anchors and requested peak slope. Negative and positive settings redistribute contrast in opposite directions. | -100 to +100 | **-100 to +100** |
| Highlight Color | Chooses the Peak Fit signal and color trajectory. | Smooth color rolloff (default) independently compresses linear BT.2020 channels for a gradual approach to white without lifting weak channels. Preserve color retains ACEScg ratios. Neutralize peak groups ACEScg channels and forces the endpoint to white. | Smooth color rolloff; Preserve color; Neutralize peak | Same choices |
| Contrast | Separates or compresses tones around Pivot. | Scales scene-referred stop distance from Pivot; positive values spread stops apart. | Narrow -0.5 to +0.5; Medium -0.75 to +0.75; Wide -1 to +1 | **-2 to +2** |
| Pivot | Chooses the brightness that Contrast works around. | Uses a scene-linear ACEScg value; `0.18` is the active project reference-white anchor. | 0.02 to 0.5, 0.75, or 1 depending on latitude | **0.0001 to 18**; the displayed nit value depends on project reference white |
| Shadow / Black | Seats blacks or reveals dark detail without moving highlights as much. | Applies a luma-weighted multiplier strongest near black and fading toward brighter values. | Narrow -0.2 to +0.2; Medium -0.3 to +0.3; Wide -0.5 to +0.5 | **-1 to +1** |

Start and Target Peak are kept at least 1 nit apart. If a typed edit would cross them, HDR Finisher moves the other value just enough to retain a valid shoulder.

## Exposure Bands

| Control | Purpose in plain English | How it works | Normal slider range | Direct-entry range |
|---|---|---|---|---|
| Selected Band | Brightens or darkens the scene-brightness population selected in the graph. | Adds an EV offset at that input brightness while a monotonic constraint prevents tonal order from reversing. | Up to -2 to +2 EV; neighboring nodes can narrow it | **The same dynamically safe range, never beyond -2 to +2 EV** |
| Influence | Changes how much neighboring bands move during an edit. | Sets the smooth proportional editing radius around the selected node; it does not blur the rendered image. | `-` and `+` buttons, 0.25-EV steps | **0.25 to 12 EV** |
| Curve Smoothing | Makes transitions between bands straighter or rounder. | Blends piecewise-linear interpolation with a monotonic cubic curve. | 0 to 1 | **0 to 1** |

The graph covers -6 to +6 EV around the active project reference white. Its vertical ±2 EV limit is intentionally firm because a wider range would make the graph harder to read and greatly increase the chance of flattening adjacent tone populations.

## Color controls in HDR and SDR

These limits apply independently to the HDR and SDR color panels.

| Control | Purpose in plain English | How it works | Normal slider range | Direct-entry range |
|---|---|---|---|---|
| Temperature | Makes the image warmer or cooler. | Applies a finishing white-balance gain relative to neutral 6,500 K after source interpretation. | 2,000 to 12,000 K | **1,000 to 25,000 K** |
| Green / Magenta Tint | Corrects or adds a green-to-magenta cast. | Adjusts the green-channel gain in the global white-balance stage. | -1 to +1 | **-2 to +2** |
| Saturation | Changes color strength evenly. | Scales chroma around ACEScg luma; -100% removes chroma. | -100% to +100% | **-100% to +300%** |
| Vibrance | Strengthens quiet colors while protecting colors already strong. | Weights chroma gain by inverse relative chroma, so muted colors receive more of the adjustment. | -100% to +100% | **-100% to +300%** |
| Red Hue | Rotates the red working primary. | Rotates the ACEScg red primary in the chromaticity plane. | -30° to +30° | **-180° to +180°** |
| Red Purity | Pulls the red primary inward or pushes it beyond the working gamut edge. | Radially scales the red primary relative to the achromatic point. | -95% to +100% | **-99% to +400%** |
| Green Hue | Rotates the green working primary. | Rotates the ACEScg green primary in the chromaticity plane. | -30° to +30° | **-180° to +180°** |
| Green Purity | Pulls the green primary inward or pushes it beyond the working gamut edge. | Radially scales the green primary relative to the achromatic point. | -95% to +100% | **-99% to +400%** |
| Blue Hue | Rotates the blue working primary. | Rotates the ACEScg blue primary in the chromaticity plane. | -30° to +30° | **-180° to +180°** |
| Blue Purity | Pulls the blue primary inward or pushes it beyond the working gamut edge. | Radially scales the blue primary relative to the achromatic point. | -95% to +100% | **-99% to +400%** |
| Tint Hue | Chooses the hue of an overall color bias. | Rotates the achromatic-point tint through a full hue cycle. | -180° to +180° | **-180° to +180°** |
| Tint Purity | Controls the strength of the overall color bias. | Moves the achromatic point toward the Tint Hue direction. | 0% to 20% | **0% to 99%** |

Values above the slider range are for deliberate effects and difficult corrections. Extreme Saturation, Vibrance, or Purity can create negative or far-out-of-gamut intermediate colors. The final HDR and SDR output stages sanitize or compress them, but that does not guarantee a pleasing result.

## Film Look in HDR and SDR

Film Look uses the same structure in each branch. Amount and sensitivity controls are normalized; Radius is a percentage of the current image diagonal.

| Control | Purpose | Range |
|---|---|---|
| Reference Model | Populates an editable set of tonal, grain, glow, and resolving-character values. Custom/Neutral applies no preset. | Custom/Neutral; Large Format Fine; 35mm Fine; 35mm Balanced; 35mm Fast; 16mm Fine |
| Look Strength | Blends the complete Film Look toward neutral without changing its component values. | 0–100% |
| Print Strength | Blends the HDR-safe Cinema Print response. | 0–100% |
| Contrast, Toe, Shoulder | Shape print-like separation, black transition, and highlight restraint in the branch's perceptual domain. | -100 to +100% |
| Color Density | Changes subtractive dye-like chroma separation with a small density-dependent luminance change. | -100 to +100% |
| Halation Amount / Sensitivity | Control warm highlight-edge scatter and the branch-relative highlight population that qualifies. | 0–100% |
| Halation Radius | Sets edge-scatter scale as a percentage of image diagonal. | Slider 0–2%; direct entry 0–5% |
| Halation Hue Offset / Saturation | Tune the warm scatter color without changing the source grade. | Hue -100 to +100%; Saturation 0–100% |
| View qualification map | Replaces the viewer with the Halation qualification diagnostic. It is suppressed during export. | Off/On |
| Bloom Amount / Sensitivity | Control broad neutral highlight diffusion and branch-relative qualification. | 0–100% |
| Bloom Radius | Sets diffusion scale as a percentage of image diagonal. | Slider 0–4%; direct entry 0–10% |
| Highlight Detail | Retains local bright-source detail inside Bloom. Technically, it crossfades the energy-moving diffusion component while leaving the additive optical bloom available: 100% preserves the source edge and 0% applies maximum core softening. | 0–100% |
| Image Softness | Removes digital edge hardness before grain. | 0–100% |
| Microcontrast | Reduces or increases fine local contrast before grain. | -100 to +100% |
| Grain Amount / Size / Softness / Chroma | Set density-grain strength, scale, clumping, and colored component. | 0–100% |
| Shadow / Midtone / Highlight Response | Weight grain by local density instead of overlaying uniform noise. | 0–150% |
| Film Resolution | Reduces pre-grain resolving character as the value moves below 100%. | 0–100% |
| View grain map | Replaces the viewer with the grain field alone, painted on a neutral mid-grey card that still carries the tonal response the picture drives. It is suppressed during export, and the Halation map takes precedence if both are on. | Off/On |

The deterministic grain seed lives in shared adjustment state. HDR and SDR can use different response values but sample the same spatial field.

## Lift, Gamma, Gain in HDR and SDR

These controls use the same ranges in each branch, but HDR works in the scene-referred rendition while SDR works on its bounded display rendition.

| Control | Purpose in plain English | How it works | Normal slider range | Direct-entry range |
|---|---|---|---|---|
| Lift | Raises or lowers the shadow zone. | Adds a smooth, luma-targeted shadow adjustment. | Narrow -0.25 to +0.25; Medium -0.35 to +0.35; Wide -0.5 to +0.5 | **-1 to +1** |
| Lift Range | Makes the shadow zone narrower or wider. | Sets the smooth transition width in stops around Lift Pivot. | 0.5 to 12 EV | **0.5 to 24 EV** |
| Lift Pivot | Moves the shadow zone darker or brighter. | Positions the shadow mask in stops relative to the branch reference. | -8 to +8 EV | **-12 to +12 EV** |
| Gamma | Raises or lowers the midtone zone. | Applies an overlapping bell-shaped midtone adjustment. | Narrow -0.5 to +0.5; Medium -0.75 to +0.75; Wide -1 to +1 | **-2 to +2** |
| Gamma Range | Makes the midtone zone narrower or wider. | Sets the width of the Gaussian-like midtone mask in stops. | 0.5 to 12 EV | **0.5 to 24 EV** |
| Gamma Pivot | Moves the midtone zone darker or brighter. | Positions the center of the midtone mask in stops. | -8 to +8 EV | **-12 to +12 EV** |
| Gain | Raises or lowers the highlight zone. | Adds a smooth, luma-targeted highlight adjustment. | Narrow -0.25 to +0.25; Medium -0.35 to +0.35; Wide -0.5 to +0.5 | **-1 to +1** |
| Gain Range | Makes the highlight zone narrower or wider. | Sets the smooth transition width in stops around Gain Pivot. | 0.5 to 12 EV | **0.5 to 24 EV** |
| Gain Pivot | Moves the highlight zone darker or brighter. | Positions the highlight mask in stops relative to the branch reference. | -8 to +8 EV | **-12 to +12 EV** |

## SDR Tone and Highlight Compression

| Control | Purpose in plain English | How it works | Normal slider range | Direct-entry range |
|---|---|---|---|---|
| Exposure | Makes the whole SDR fallback brighter or darker. | Multiplies light by `2^EV` before highlight compression. | Narrow -2 to +2 EV; Medium -3 to +3 EV; Wide -4 to +4 EV | **-8 to +8 EV** |
| Contrast | Separates or compresses SDR tones around Pivot. | Changes the display-domain contrast slope while preserving the selected pivot. | Narrow -0.5 to +0.5; Medium -0.75 to +0.75; Wide -1 to +1 | **-2 to +2** |
| Pivot | Chooses the normalized SDR brightness that Contrast works around. | Sets the fixed point of the display-domain contrast operation. | Narrow/Medium 0.05 to 0.95; Wide 0.02 to 0.98 | **0.001 to 0.999** |
| Shadow | Seats SDR blacks or opens dark detail. | Adds a masked low-end offset that fades toward the midtones. | Narrow -0.3 to +0.3; Medium -0.5 to +0.5; Wide -1 to +1 | **-2 to +2** |
| Mode | Chooses endpoint-aware or asymptotic compression. | Peak Fit anchors the measured source peak at SDR white; Soft Ceiling approaches it without an endpoint promise. | Peak Fit or Soft Ceiling | Same choices |
| Start | Chooses the requested shoulder onset. | Sets an SDR input percentage; Peak Fit can move the effective start lower to preserve a monotonic curve. | 1% to 99% | **1% to 99%** |
| Softness | Controls how strongly Soft Ceiling bends highlights. | Zero is identity; higher values engage the luma-preserving asymptote earlier. | 0% to 100% | **0% to 100%** |
| Highlight Color | Chooses the highlight color trajectory. | Smooth color rolloff maps linear-sRGB channels independently; Preserve color retains ratios; Neutralize peak converges the endpoint to white. | Three named choices | Same choices |
| Highlight Detail | Retains contrast near the Peak Fit endpoint. | Sets the positive endpoint slope of the monotonic stop-domain curve. | 0% to 100% | **0% to 100%** |
| Input Peak | Chooses the Peak Fit measurement. | Uses the exact maximum, a robust percentile, or a manual source percentage. | Three named choices | Same choices |
| Manual Source Peak | Supplies the pre-exposure source peak for manual measurement. | Expressed relative to SDR white; Tone Exposure is included when the curve is built. | 100% to 10,000% | **1% to 1,000,000%** |
| Compression Bias | Redistributes separation through the Peak Fit shoulder. | Warps the shoulder parameter without changing its endpoints. | -100 to +100 | **-100 to +100** |

## Why some controls do not get extra room

Highlight Detail, Softness, Compression Bias, Curve Smoothing, and Exposure Band adjustment already occupy a complete normalized or shape-safe domain. Extending them would either duplicate an existing endpoint, be silently clipped by the processing formula, or make monotonic tone mapping harder to guarantee. Their direct-entry range therefore matches their slider range.
