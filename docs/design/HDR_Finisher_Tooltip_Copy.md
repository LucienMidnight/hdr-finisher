# HDR Finisher Tooltip Copy

This file is the reviewable copy registry for explanatory tooltips. Copy strings from here into application markup or script without rewriting them in place. Interaction rules live in `../product/HDR_Finisher_PRD_v1.2.md`.

## Scope title tooltips

Trigger delay: 2 seconds on title hover. The same tooltip appears when its title receives keyboard focus.

| ID | Title / state | Copy-ready tooltip text |
|---|---|---|
| `scope.reference_nits_histogram.hdr` | Reference Nit Histogram | HDR histogram plots reference luminance from left to right on a logarithmic nit scale. Density is log-scaled to retain fine tonal detail. |
| `scope.histogram.sdr` | SDR Histogram | SDR histogram plots display-safe values from black to white. Density is log-scaled so small tonal populations remain visible. |
| `scope.reference_waveform.hdr` | HDR Reference Waveform | HDR waveform plots horizontal image position against reference nits. Reference nits use the app's internal model: 0.18 scene-linear equals 100 nits. |
| `scope.waveform.sdr` | SDR Waveform | SDR waveform plots horizontal image position against normalized tone-mapped output. |
| `scope.vectorscope` | HDR / SDR Vectorscope | Vectorscope plots chroma direction and saturation from the same current authored preview. Density is log-scaled. |

## Existing authored tooltips

These strings predate the title-tooltip policy. They are recorded here for centralized copy review; their current triggers remain unchanged until those controls are revisited.

| ID | Trigger | Copy-ready tooltip text |
|---|---|---|
| `controls.hdr_rendition` | HDR Controls | Graded HDR rendition. Exported as the PQ HDR image. Double-click any value to type it. |
| `controls.sdr_rendition` | SDR Controls | Independent fallback baked into the gain map. This is what viewers without HDR gain-map support will see. Double-click any value to type it. |
| `preview.high_resolution` | High-res Preview | Uses more GPU memory for a larger preview. Export quality is unchanged. |
| `sdr.tone_mapper` | Tone Mapper help | Chooses how the photograph's full brightness range is shaped for SDR. Filmic is the neutral starting point. |
| `sdr.curve_contrast` | Curve Contrast help | Sets how strongly tones separate around the midtones. Lower is softer and holds more range; higher gives deeper shadows and brighter highlights. |
| `sdr.contrast_skew` | Contrast Skew help | Moves tonal separation toward one end of the photograph. Left emphasizes darker tones and keeps highlights gentler; right opens shadows and gives brighter areas more snap. |

## Source identity tooltip

Trigger delay: 2 seconds on hover, and available on keyboard focus, only when the file name exceeds its two-line display limit.

| ID | Trigger | Copy-ready tooltip text |
|---|---|---|
| `source.file_name.full` | File Name value | Dynamic: the complete source file name, copied exactly from the active session. |

## Preview title tooltip

Trigger delay: 2 seconds on the PREVIEW WINDOW title hover. The same tooltip appears when the title receives keyboard focus. Copy changes with the active rendition.

| ID | Title / state | Copy-ready tooltip text |
|---|---|---|
| `preview.window.shared` | Preview Window · HDR or SDR | Displays the active HDR grade or SDR fallback with current adjustments applied. Switch renditions in the Control Panel or use the layout buttons to view them side-by-side. |
