# Typed values reference

Every number shown beside a slider can be typed: double-click it, or focus it
and press Enter, type the value, and press Enter again. Escape cancels.

This page lists every such number, the range its slider covers and the range a
typed value is held to. It was produced from a run of
`codebase/tools/value_entry_audit.js`, which types above, below and inside the
range of every readout in the running app. Run it again after adding or
changing a control:

```
node tests/run-in-electron.js tools/value_entry_audit.js audit-folder/audit.json
python tools/value_entry_reference.py audit-folder ../docs/user-guide/typed-values-reference.md
```

## How typed values behave

- **Bold ranges go beyond the slider.** 55 controls accept typed
  values past the ends of their slider. The slider then sits at its end and is
  marked, and the typed value is what is saved, previewed and exported.
  Dragging the slider afterwards brings the value back inside the slider's
  range.
- **A value outside the typed range is not refused.** It is set to the nearest
  allowed value and the number flashes once. This limit is the most the saved
  project and the renderer accept for that control, so it is the same in the
  preview and in export.
- **"Same as slider"** means a typed value is passed to the slider itself, so
  it cannot leave the slider's range. These controls have no wider saved limit
  to type into.
- **Percentages are typed as percentages.** Saturation and Vibrance are typed
  as -100 to 300, Denoise and opacity values as 0 to 100.
- **A control that is switched off cannot be typed into**, exactly as its
  slider cannot be dragged: Denoise sliders while Denoise is off, RAW clipping
  threshold on a file that is not RAW, Vignette Highlight Protection unless
  Amount is negative.
- Text that is not a number is ignored and the previous value stays.

## Not typed

- Rows with several handles on one track: the Local Adjustments luminance
  range, its refine range and the gradient luminance ramp. Drag the handles.
- Curves, the Color Grading wheels (their Hue and Saturation have ordinary
  number boxes beside the wheel), crop and perspective handles on the picture.
- Number boxes (zoom, Vignette Center X and Y, custom crop ratio, export size,
  custom proof peak, lens data, film gate size) are ordinary fields with their
  own limits and are not listed here.

## The list

### Tone (HDR)

| Control | Slider | Typed value | Notes |
| --- | --- | --- | --- |
| Exposure | -2 to 2 EV | **-8 to 8 EV** |  |
| Contrast | -0.5 to 0.5 | **-2 to 2** |  |
| Pivot | 0.02 to 0.5 | **0.0001 to 18** |  |
| Shadow / Black | -0.2 to 0.2 | **-1 to 1** |  |

### Highlight Compression (HDR)

| Control | Slider | Typed value | Notes |
| --- | --- | --- | --- |
| Start | 100 to 4,000 nit | **1 to 9,999 nit** |  |
| Output target | 200 to 10,000 nit | **2 to 10,000 nit** |  |
| Softness | 0 to 100 | 0 to 100 |  |
| Highlight Detail | 0 to 100 % | 0 to 100 % |  |
| Manual Source Peak | 100 to 100,000 nit | **1 to 1,000,000 nit** |  |
| Compression Bias | -100 to 100 | -100 to 100 |  |

### Exposure Bands (HDR)

| Control | Slider | Typed value | Notes |
| --- | --- | --- | --- |
| Influence | no slider | 0.25 to 12 EV |  |
| Selected band | drag the band | -2 to +2 EV | Each band is also held so it cannot cross its neighbours. |
| Curve smoothing | 0 to 1 | 0 to 1 |  |

### Color and Lift, Gamma, Gain (HDR)

| Control | Slider | Typed value | Notes |
| --- | --- | --- | --- |
| Temperature | 2,000 to 12,000 K | **1,000 to 25,000 K** |  |
| Green / Magenta Tint | -1 to 1 | **-2 to 2** |  |
| Saturation | -100 to 100 % | **-100 to 300 %** |  |
| Vibrance | -100 to 100 % | **-100 to 300 %** |  |
| Red Hue | -30 to 30 ° | **-180 to 180 °** |  |
| Red Purity | -95 to 95 % | **-99 to 400 %** |  |
| Green Hue | -30 to 30 ° | **-180 to 180 °** |  |
| Green Purity | -95 to 95 % | **-99 to 400 %** |  |
| Blue Hue | -30 to 30 ° | **-180 to 180 °** |  |
| Blue Purity | -95 to 95 % | **-99 to 400 %** |  |
| Tint Hue | -180 to 180 ° | -180 to 180 ° |  |
| Tint Purity | 0 to 20 % | **0 to 99 %** |  |

### Lift, Gamma, Gain (HDR)

| Control | Slider | Typed value | Notes |
| --- | --- | --- | --- |
| Lift | -0.25 to 0.25 | **-1 to 1** |  |
| Lift Range | 0.5 to 12 EV | **0.5 to 24 EV** |  |
| Lift Pivot | -8 to 8 EV | **-12 to 12 EV** |  |
| Gamma | -0.5 to 0.5 | **-2 to 2** |  |
| Gamma Range | 0.5 to 12 EV | **0.5 to 24 EV** |  |
| Gamma Pivot | -8 to 8 EV | **-12 to 12 EV** |  |
| Gain | -0.25 to 0.25 | **-1 to 1** |  |
| Gain Range | 0.5 to 12 EV | **0.5 to 24 EV** |  |
| Gain Pivot | -8 to 8 EV | **-12 to 12 EV** |  |

### Tone (SDR)

| Control | Slider | Typed value | Notes |
| --- | --- | --- | --- |
| Exposure | -2 to 2 EV | **-8 to 8 EV** |  |
| Contrast | -0.5 to 0.5 | **-2 to 2** |  |
| Pivot | 0.05 to 0.95 | **0.001 to 0.999** |  |
| Shadow | -0.3 to 0.3 | **-2 to 2** |  |

### Highlight Compression (SDR)

| Control | Slider | Typed value | Notes |
| --- | --- | --- | --- |
| Start | 1 to 99 % | 1 to 99 % |  |
| Softness | 0 to 100 | 0 to 100 |  |
| Highlight Detail | 0 to 100 % | 0 to 100 % |  |
| Manual Source Peak | 100 to 10,000 % | **1 to 1,000,000 %** |  |
| Compression Bias | -100 to 100 | -100 to 100 |  |

### Exposure Bands (SDR)

| Control | Slider | Typed value | Notes |
| --- | --- | --- | --- |
| Influence | no slider | 0.25 to 12 EV |  |
| Selected band | drag the band | -2 to +2 EV | Each band is also held so it cannot cross its neighbours. |

### Color and Lift, Gamma, Gain (SDR)

| Control | Slider | Typed value | Notes |
| --- | --- | --- | --- |
| Temperature | 2,000 to 12,000 K | **1,000 to 25,000 K** |  |
| Green / Magenta Tint | -1 to 1 | **-2 to 2** |  |
| Saturation | -100 to 100 % | **-100 to 300 %** |  |
| Vibrance | -100 to 100 % | **-100 to 300 %** |  |
| Red Hue | -30 to 30 ° | **-180 to 180 °** |  |
| Red Purity | -95 to 95 % | **-99 to 400 %** |  |
| Green Hue | -30 to 30 ° | **-180 to 180 °** |  |
| Green Purity | -95 to 95 % | **-99 to 400 %** |  |
| Blue Hue | -30 to 30 ° | **-180 to 180 °** |  |
| Blue Purity | -95 to 95 % | **-99 to 400 %** |  |
| Tint Hue | -180 to 180 ° | -180 to 180 ° |  |
| Tint Purity | 0 to 20 % | **0 to 99 %** |  |

### Lift, Gamma, Gain (SDR)

| Control | Slider | Typed value | Notes |
| --- | --- | --- | --- |
| Lift | -0.25 to 0.25 | **-1 to 1** |  |
| Lift Range | 0.5 to 12 EV | **0.5 to 24 EV** |  |
| Lift Pivot | -8 to 8 EV | **-12 to 12 EV** |  |
| Gamma | -0.5 to 0.5 | **-2 to 2** |  |
| Gamma Range | 0.5 to 12 EV | **0.5 to 24 EV** |  |
| Gamma Pivot | -8 to 8 EV | **-12 to 12 EV** |  |
| Gain | -0.25 to 0.25 | **-1 to 1** |  |
| Gain Range | 0.5 to 12 EV | **0.5 to 24 EV** |  |
| Gain Pivot | -8 to 8 EV | **-12 to 12 EV** |  |

### Color Grading

| Control | Slider | Typed value | Notes |
| --- | --- | --- | --- |
| Shadows Luminance | -1 to 1 EV | -1 to 1 EV |  |
| Midtones Luminance | -1 to 1 EV | -1 to 1 EV |  |
| Highlights Luminance | -1 to 1 EV | -1 to 1 EV |  |
| Blending | 0 to 100 % | 0 to 100 % |  |
| Balance | -100 to 100 | -100 to 100 |  |

### Black & White

| Control | Slider | Typed value | Notes |
| --- | --- | --- | --- |
| Reds | -100 to 100 | -100 to 100 |  |
| Oranges | -100 to 100 | -100 to 100 |  |
| Yellows | -100 to 100 | -100 to 100 |  |
| Greens | -100 to 100 | -100 to 100 |  |
| Aquas | -100 to 100 | -100 to 100 |  |
| Blues | -100 to 100 | -100 to 100 |  |
| Purples | -100 to 100 | -100 to 100 |  |
| Magentas | -100 to 100 | -100 to 100 |  |

### Detail

| Control | Slider | Typed value | Notes |
| --- | --- | --- | --- |
| Texture | -100 to 100 | -100 to 100 |  |
| Clarity | -100 to 100 | -100 to 100 |  |
| Clarity Radius | 0.2 to 3 % | 0.2 to 3 % |  |
| Softness | 0 to 100 | 0 to 100 |  |
| Microcontrast | -100 to 100 | -100 to 100 |  |
| Sharpen | 0 to 200 | 0 to 200 |  |
| Radius | 0.3 to 3 px | 0.3 to 3 px |  |
| Threshold | 0 to 100 | 0 to 100 |  |

### Film Look

| Control | Slider | Typed value | Notes |
| --- | --- | --- | --- |
| Look Strength | 0 to 100 % | 0 to 100 % |  |
| Print Strength | 0 to 100 % | 0 to 100 % |  |
| Print Contrast | -100 to 100 % | -100 to 100 % |  |
| Color Density | -100 to 100 % | -100 to 100 % |  |
| Toe | -100 to 100 % | -100 to 100 % |  |
| Shoulder | -100 to 100 % | -100 to 100 % |  |
| Red Response | -100 to 100 % | -100 to 100 % |  |
| Green Response | -100 to 100 % | -100 to 100 % |  |
| Blue Response | -100 to 100 % | -100 to 100 % |  |
| Highlight Desaturation | 0 to 100 % | 0 to 100 % |  |
| Shadow Desaturation | 0 to 100 % | 0 to 100 % |  |
| Amount | 0 to 100 % | 0 to 100 % |  |
| Sensitivity | 0 to 100 % | 0 to 100 % |  |
| Physical Extent | 0 to 2 % of 35mm gate | **0 to 5 % of 35mm gate** |  |
| Hue Offset | -100 to 100 % | -100 to 100 % |  |
| Saturation | 0 to 100 % | 0 to 100 % |  |
| Amount | 0 to 100 % | 0 to 100 % |  |
| Sensitivity | 0 to 100 % | 0 to 100 % |  |
| Optical Spread | 0 to 4 % of output diagonal | **0 to 10 % of output diagonal** |  |
| Highlight Detail | 0 to 100 % | 0 to 100 % |  |
| Film Resolution | 0 to 100 % | 0 to 100 % |  |
| Amount | 0 to 100 % | 0 to 100 % |  |
| Size | 0 to 100 % | 0 to 100 % |  |
| Grain Softness | 0 to 100 % | 0 to 100 % |  |
| Chroma | 0 to 100 % | 0 to 100 % |  |
| Shadow Response | 0 to 150 % | 0 to 150 % |  |
| Midtone Response | 0 to 150 % | 0 to 150 % |  |
| Highlight Response | 0 to 150 % | 0 to 150 % |  |

### Vignette

| Control | Slider | Typed value | Notes |
| --- | --- | --- | --- |
| Amount | -100 to 100 % | **-200 to 200 %** | 100 is 2 EV; 200 is 4 EV. |
| Midpoint | 0 to 100 % | 0 to 100 % |  |
| Roundness | -100 to 100 % | -100 to 100 % |  |
| Feather | 0 to 100 % | 0 to 100 % |  |
| Highlight Protection | 0 to 100 % | 0 to 100 % | Only when Amount is negative (darkening); otherwise the control is off. |
| Horizontal Scale | 25 to 300 % | 25 to 300 % |  |
| Vertical Scale | 25 to 300 % | 25 to 300 % |  |

### Crop & Rotate

| Control | Slider | Typed value | Notes |
| --- | --- | --- | --- |
| Grid density | 2 to 16 | Same as slider |  |
| Straighten | -45 to 45 ° | -45 to 45 ° |  |

### Perspective

| Control | Slider | Typed value | Notes |
| --- | --- | --- | --- |
| Horizontal | -100 to 100 | Same as slider |  |
| Vertical | -100 to 100 | Same as slider |  |
| Rotate | -45 to 45 ° | Same as slider |  |

### Denoise

| Control | Slider | Typed value | Notes |
| --- | --- | --- | --- |
| Amount | 0 to 100 % | Same as slider |  |
| Detail Recovery | 0 to 100 % | Same as slider |  |
| Luminance | 0 to 100 % | Same as slider |  |
| Color Noise | 0 to 100 % | Same as slider |  |
| Finest | 0 to 100 % | Same as slider |  |
| Fine | 0 to 100 % | Same as slider |  |
| Medium | 0 to 100 % | Same as slider |  |
| Coarse | 0 to 100 % | Same as slider |  |

### RAW highlight reconstruction

| Control | Slider | Typed value | Notes |
| --- | --- | --- | --- |
| Clipping threshold | 0.5 to 1.5 | Same as slider |  |

### Local Adjustments

| Control | Slider | Typed value | Notes |
| --- | --- | --- | --- |
| Adjustment opacity | 0 to 100 % | Same as slider |  |

### Local Adjustments: grade

| Control | Slider | Typed value | Notes |
| --- | --- | --- | --- |
| Exposure | -8 to 8 EV | Same as slider |  |
| Highlights | -2 to 2 | Same as slider |  |
| Midtones | -2 to 2 | Same as slider |  |
| Shadows | -2 to 2 | Same as slider |  |
| Blacks | -2 to 2 | Same as slider |  |
| Contrast | -2 to 2 | Same as slider |  |
| Temperature | 1,000 to 25,000 K | Same as slider |  |
| Tint | -2 to 2 | Same as slider |  |
| Saturation | -1 to 3 | Same as slider |  |
| Vibrance | -1 to 3 | Same as slider |  |
| Texture | -100 to 100 | Same as slider |  |
| Clarity | -100 to 100 | Same as slider |  |
| Clarity Radius | 0.2 to 3 % | Same as slider |  |
| Sharpen | 0 to 200 | Same as slider |  |
| Radius | 0.3 to 3 px | Same as slider |  |
| Threshold | 0 to 100 | Same as slider |  |

### Local Adjustments: mask

| Control | Slider | Typed value | Notes |
| --- | --- | --- | --- |
| Opacity | 0 to 100 % | Same as slider |  |
| Fan | -100 to 100 % | Same as slider |  |

### Local Adjustments: gradient luminance ramp

| Control | Slider | Typed value | Notes |
| --- | --- | --- | --- |
| (handles) | -24 to 24 | Not typed | Several handles share one row; drag them. |

### Overlays

| Control | Slider | Typed value | Notes |
| --- | --- | --- | --- |
| Opacity | 10 to 100 % | Same as slider |  |
| Zebra threshold | 10 to 4,000 nit | Same as slider |  |

### Export

| Control | Slider | Typed value | Notes |
| --- | --- | --- | --- |
| Quality | 1 to 100 | Same as slider |  |
| Gain-map Quality | 1 to 100 | Same as slider |  |
| Gain-map Quality | 1 to 100 | Same as slider |  |
