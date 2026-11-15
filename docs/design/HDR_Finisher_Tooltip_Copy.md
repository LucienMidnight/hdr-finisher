# HDR Finisher Tooltip Copy

This file is the reviewable copy registry for explanatory tooltips. Copy strings from here into application markup or script without rewriting them in place. Interaction rules live in `../product/archive/HDR_Finisher_PRD_v1.2.md` (archived; current requirements are in the module PRDs under `../product/modules/`).

Timing validation allows 2.4–2.9 seconds on the MacBook Neo (timer and frame
scheduling); no early tooltip at 2.2 seconds.

Every tooltip waits 2.5 seconds on hover or keyboard focus, in every window.
Click, Escape, leave and blur dismiss immediately. Native title bubbles and CSS
tooltips are replaced by one accessible, viewport-bounded top-layer controller.
Every neighbour also waits; `NEIGHBOUR_WINDOW_MS = 0` is the single switch for
the pending neighbour decision.

## Scope title tooltips

Trigger delay: 2.5 seconds on title hover. The same tooltip appears when its title receives keyboard focus.

| ID | Title / state | Copy-ready tooltip text |
|---|---|---|
| `scope.reference_nits_histogram.hdr` | Reference Nit Histogram | HDR histogram plots reference luminance from left to right on a logarithmic nit scale. Density is log-scaled to retain fine tonal detail. |
| `scope.histogram.sdr` | SDR Histogram | SDR histogram plots display-safe values from black to white. Density is log-scaled so small tonal populations remain visible. |
| `scope.reference_waveform.hdr` | HDR Reference Waveform | HDR waveform plots horizontal image position against reference nits. Scene-linear 0.18 maps to the project's selected 203- or 100-nit HDR Reference White. |
| `scope.waveform.sdr` | SDR Waveform | SDR waveform plots horizontal image position against normalized tone-mapped output. |
| `scope.vectorscope` | HDR / SDR Vectorscope | Vectorscope plots chroma direction and saturation from the same current authored preview. Density is log-scaled. |

## Existing authored tooltips

These strings predate the title-tooltip policy. They are recorded here for centralized copy review; all use the shared 2.5-second controller.

| ID | Trigger | Copy-ready tooltip text |
|---|---|---|
| `controls.hdr_rendition` | HDR grade | Edit the HDR version, shown on HDR screens. |
| `controls.sdr_rendition` | SDR grade | Edit the SDR version, shown on screens without HDR. |
| `preview.high_resolution` | High-res Preview | Uses more GPU memory for a larger preview. Export quality is unchanged. |
| `export.guarantee_peak` | Guarantee HDR peak | Highlight Compression checks every HDR export and Proof after encoding. Up to 1% above target is accepted unchanged; larger overshoots are corrected locally toward the target. Files still above the allowance are not delivered. This option also checks the codec ceiling when Highlight Compression is bypassed. |
| `sdr.highlight_compression.mode` | Mode help | Peak Fit anchors the measured source peak at display white while preserving a smooth highlight gradient. |
| `sdr.highlight_compression.color` | Highlight Color help | Smooth color rolloff gently compresses each sRGB channel toward white. Preserve color keeps channel ratios intact. Neutralize peak groups channels so the brightest highlights converge to neutral white. |

## Shared control interaction copy

| ID | Trigger | Copy-ready tooltip text |
|---|---|---|
| `controls.instrument_slider` | Any grading range slider | Ctrl makes adjustment 10× finer. Shift snaps to the authored semantic positions. Double-click the value to enter an exact number. |
| `controls.curve_editor` | Curves editor | Ctrl makes pointer and arrow-key movement 10× finer. Shift keeps ordinary graph movement. |
| `controls.exposure_bands` | Exposure Bands editor | Ctrl makes drag and Up/Down adjustment 10× finer. Ctrl/Command+Left/Right moves the selected band across input brightness. |

## Source identity tooltip

Trigger delay: 2.5 seconds on hover, and available on keyboard focus, only when the file name exceeds its two-line display limit.

| ID | Trigger | Copy-ready tooltip text |
|---|---|---|
| `source.file_name.full` | File Name value | Dynamic: the complete source file name, copied exactly from the active session. |

## Preview title tooltip

Trigger delay: 2.5 seconds on the PREVIEW WINDOW title hover. The same tooltip appears when the title receives keyboard focus. Copy changes with the active rendition.

| ID | Title / state | Copy-ready tooltip text |
|---|---|---|
| `preview.window.shared` | Preview Window · HDR or SDR | Displays the active HDR grade or SDR fallback with current adjustments applied. Switch renditions in the Control Panel or use the layout buttons to view them side-by-side. |

## Control Panel modes (October 23, 2026)

| ID | Trigger | Copy-ready tooltip text |
|---|---|---|
| `local.new_brush` | Brush tool | New brush adjustment |
| `local.new_gradient` | Linear gradient tool | New linear gradient adjustment |
| `local.new_luma` | Luma range tool | New luma range adjustment |
| `local.new_path` | Path tool | New path adjustment |
| `retouch.heal_soon` | Heal · Soon | Not built yet |
| `retouch.clone_soon` | Clone · Soon | Not built yet |
| `retouch.retry` | Selected repair Retry | Retry with next seed |


## November 6: Library toolbar explanations

| ID | Trigger | Copy-ready tooltip text |
|---|---|---|
| `library.exposure` | Exposure | Show clipped highlights and near-black shadows from the source photo · E |
| `library.hdr` | HDR | Show HDR pictures on an HDR display; switch off for SDR previews · H |
| `library.detail` | 100% | 100% detail is available in Single photo view · Z |


Shared export status buttons: "Pause the current export", "Resume the current export" (while paused), and "Cancel the current export". Accessible labels match these tooltips.

## November 15: conditional control names (L2)

Overlays, Frame, Export list actions, Compare/Focus, Settings/Help and Activity
omit redundant naming while their labels are visible. Responsive icon forms
keep their names. Labelled controls with only shortcut information show the
shortcut alone (`KEEP_SHORTCUT_ONLY`, pending Steve). Explanations, warnings
and disabled reasons remain. Filename/metadata values and resize choices show
full text only when actually clipped; accessible names stay available.

## November 15 N1: Fixed cap

| ID | Trigger | Copy-ready tooltip text |
|---|---|---|
| `hdr.highlight_compression.fixed_cap` | Mode: Fixed cap | Fixed cap leaves values below Start unchanged and smoothly compresses brighter colours toward Target Peak, preserving colour ratios without measuring the image peak. |
| `sdr.highlight_compression.fixed_cap` | Mode: Fixed cap | Fixed cap leaves values below Start unchanged and smoothly compresses brighter colours toward display white, preserving colour ratios without measuring the image peak. |

## Five-control Tone (November 15, 2026)

| ID | Trigger | Copy-ready tooltip text |
|---|---|---|
| `tone.blacks` | Blacks | Lifts or clips the narrow black floor. Tones above the floor are unchanged. Tone ranges are selected before any of the five controls. |
| `tone.whites` | Whites | Adjusts the top stop below Target Peak (display white in SDR). Positive values overdrive Film Look; final Highlight Compression still owns the delivery ceiling. |
| `tone.center` | Center | Where the zone sits, in stops from photographic mid-grey: 18% of reference white. Exposure runs first. |
| `tone.width` | Width | How many stops the zone covers. Its effect fades smoothly at both ends and is gated away from the black floor and white peak. |
| `tone.range-preview` | All five Tone labels, Center and Width (global/local) | Hover or drag to see the effective, endpoint-protected range and limiter. |
| `tone.clipping-preview` | Blacks and Whites labels (global/local), appended to range copy | Alt/Option-drag to inspect finished clipping. Pale dots mean endpoint only; RGB marks lost channels; dashed RGB marks channels newly reaching an endpoint. |

The range key says **Pre-look neutral-ray range**, with **before spatial mask**
and opacity for locals. The clipping key says **Finished, post-cap**. HDR adds
100-nit SDR-white, primary-display overrange (or unknown), and HC-target-guide
keys. Those two states must not be presented as the same measurement.
