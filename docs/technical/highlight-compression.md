# Highlight Compression Technical Reference

Highlight compression is the shared bright-end shaping design used by both rendering lanes. HDR applies it as the final output operation after global and local adjustments, Detail, Film Look, Vignette, output finishing, and grain. Generated SDR first uses fixed middle-gray placement and converts to display-linear sRGB; authored SDR applies it directly to its retained display-linear base.

This document is the implementation contract for the CPU renderer, WebGPU preview, controls, scopes, tests, and future changes.

DNG clipped-highlight color recovery is a separate import-stage operation. It repairs unsupported camera-channel ratios before ACEScg grading and is documented in the [Import guide](../user-guide/import.md). Its spatial support or feathering must not be exposed as a Highlight Compression control: Peak Fit shapes valid scene-linear output after import and cannot reconstruct ratios already lost at the DNG encoding limit.

## User intent and modes

The section bypass is the sole on/off control. When enabled, it supports three compression modes:

- **Peak Fit** measures or accepts the final-grade peak, builds a monotonic shoulder in log2 stops, and anchors that measured peak at Target Peak.
- **Soft Ceiling** is an asymptotic compressor controlled by Softness. It has no measured endpoint anchor.
- **Clip** applies a strict per-channel ceiling in the HDR delivery primaries. It is intentionally hard and does not use Start, Softness, source-peak measurement, Highlight Detail, Bias, or Highlight Color.

Peak Fit is the normal mastering control when the user needs a defined endpoint. Soft Ceiling is a creative shoulder and must not be described as an exact maximum.

The HDR Highlight Compression section starts bypassed for a new grade, with **Peak Fit** and **Smooth color rolloff** already selected. Generated SDR starts enabled with the same defaults, replacing the former Base Rendition tone-mapper choice and Highlight Recovery slider. An imported authored SDR base starts bypassed so its existing rendition is unchanged. The serialized mode `off` remains readable only for API and v4-project compatibility; saved projects using it migrate to a bypassed Peak Fit section.

## Units and reference white

The app defines scene-linear ACEScg `0.18` as the selected project HDR Reference White (`R`, 203 nits by default or 100 nits in the controlled workflow). Conversion is:

```text
linear = nits * 0.18 / R
nits   = linear * R / 0.18
```

Start, Target Peak, and measured/manual source peaks use this convention. Curve construction happens in `log2(linear)` space.

SDR uses percentages of display white instead of nits. Its generated placement is fixed: scene-linear `0.18` maps to display-linear `100/203`, independent of the HDR reference-white selection. Its Peak Fit target is always normalized SDR white (`1.0` / `100%`).

## Processing order

The HDR global order relevant to this module is:

1. Exposure
2. Shadow / Black
3. Contrast and Pivot
4. Color, Exposure Bands, Primaries, Curves, Color Grading, Detail, local adjustments, Film Look, and Vignette
5. Final grain
6. Output Highlight Compression

Peak Fit measures the finished post-grain pixels, so later exposure, creative, finishing, or texture changes cannot invalidate the target.

The SDR order is Exposure/Shadow, generated placement and sRGB conversion when needed, Highlight Compression, gamut compression, then Exposure Bands and later display-referred controls. SDR Peak Fit likewise includes Tone Exposure when predicting a manual source peak.

[HDR-to-SDR Match](sdr-match.md) does not replace or bypass Peak Fit, Soft Ceiling, or Clip. The Match knee consumes the fully rendered, already-compressed HDR result.

The automatic Match percentile is measured from the fully rendered captured HDR recipe, including output Highlight Compression. Peak Fit can therefore lower that percentile, move the automatic Match knee upward, and produce a gentler SDR shoulder; users should expect the Peak Fit-shaped relationships to remain, with additional compression only where highlights still extend beyond the Match boundary.

## Measurement signals

Highlight Color selects both the compression signal and the color trajectory. This is essential: channel grouping must happen before shoulder qualification, not only after a luminance curve has already decided whether to run.

### Smooth color rolloff (default)

- Working space: linear BT.2020 for HDR and linear sRGB for SDR.
- Signal: the brightest non-negative BT.2020 channel at each pixel.
- Measured maximum: exact maximum BT.2020 channel value.
- Robust measurement: the 99.99th percentile of the per-pixel maximum-channel signal.
- Mapping: the Peak Fit curve is evaluated independently for each positive channel. Dominant channels enter the shoulder first while weaker channels are never lifted.
- Consequence: channel differences contract continuously through the shoulder, producing a gradual approach toward white without forcing the peak to become neutral.
- Guarantee inside the Highlights stage: for inputs at or below the measured source peak, no positive working-space output channel exceeds Target Peak.

Values below the effective shoulder remain unchanged. Negative wide-gamut components are retained rather than clipped; gamut handling remains the responsibility of the later output path.

### Preserve color

- Signal: non-negative ACEScg luminance using AP1 weights `[0.2722287, 0.6740818, 0.0536895]`.
- Measured maximum: exact maximum luminance.
- Robust measurement: the 99.99th percentile of a bounded luminance sample.
- Mapping: RGB channels are scaled by one ratio, preserving hue and channel ratios.
- Consequence: an individual saturated channel may exceed Target Peak even when luminance is correctly anchored.

### Neutralize peak

- Signal: the brightest non-negative ACEScg RGB channel at each pixel.
- Measured maximum: exact maximum channel value.
- Robust measurement: the 99.99th percentile of the per-pixel maximum-channel signal.
- Mapping: the grouped RGB channels are first scaled so their maximum follows the Peak Fit curve, then progressively converge toward a neutral value through the shoulder.
- Endpoint: the measured maximum channel maps to Target Peak and the endpoint is neutral white.
- Guarantee inside the Highlights stage: for inputs at or below the measured source peak, no grouped output channel exceeds Target Peak.

This mode intentionally handles saturated blue, red, or green highlights whose ACEScg luminance is below Start but whose individual channel exceeds the target. That case was the reason channel grouping could not remain a post-luminance correction.

## Source peak choices

- **Measured maximum** uses the exact signal maximum appropriate to Highlight Color.
- **Ignore isolated pixels** uses the corresponding robust 99.99th-percentile signal.
- **Manual** uses the entered estimate for the final pre-compression peak. Its meaning follows Highlight Color: luminance for Preserve color, the maximum output-working-space channel for Smooth color rolloff, and the maximum grouped channel for Neutralize peak.

Changing Highlight Color or Input Peak must resynchronize the derived source peak. Saved projects keep the internal enums `preserve_color` and `path_to_white`; the new default is serialized as `smooth_rolloff`.

## Peak Fit curve

Peak Fit uses Start, Target Peak, source peak, Highlight Detail, and Compression Bias.

1. Convert Start, Target Peak, and source peak to log2 stops.
2. Derive a required output/input span ratio from Highlight Detail and Bias.
3. If the requested Start cannot fit a monotonic curve with the requested endpoint slopes, move the effective start lower.
4. Normalize the active signal between effective start and source peak.
5. Apply bias to redistribute samples through the shoulder.
6. Evaluate the cubic Hermite curve with unit input slope at the start and the requested positive detail slope at the peak.
7. Convert the mapped stop back to linear and scale, group, or independently map RGB according to Highlight Color.

The curve must remain continuous and monotonic. Highlight Detail retains positive contrast at the endpoint; it must never introduce a reversal.

Target Peak is an exact transfer-curve endpoint for the measured final-grade signal, and every mode is followed by an unconditional ceiling at Target Peak in the delivery primaries. The shoulder shapes the picture; the ceiling makes the target a delivery guarantee. That separation matters because the shoulder anchors on a measured peak, and sharpening ringing, grain, and output finishing all leave individual samples above the picture the shoulder was fitted to. A Standard or otherwise downsampled preview can filter away the exact maximum sample, so its measured peak can land below Target Peak; it can never land above.

## Clip

Clip converts the finished HDR grade to linear BT.2020, clamps every channel to Target Peak, and converts back to ACEScg. It is the deterministic mastering option when no encoded channel may exceed the selected ceiling. Unlike Peak Fit and Soft Ceiling, it intentionally creates a flat clipped endpoint and can alter hue in saturated clipped colors.

The default Highlight Detail is `35%`. This is intentional: it retains visible shape and local contrast in bright fixtures and reflections. `0%` is available when a flatter, fuller shoulder is preferred, but it is not the neutral technical default and can make peak regions feel plateaued.

If the measured source peak is at or below Target Peak, Peak Fit is identity. This decision uses luminance in Preserve color, maximum BT.2020 channel in Smooth color rolloff, and maximum ACEScg channel in Neutralize peak.

## Soft Ceiling

Soft Ceiling qualifies on ACEScg luminance and preserves RGB ratios. Softness `0` is exact identity. Higher values engage the shoulder earlier; the curve approaches Target Peak asymptotically. Soft Ceiling does not use Highlight Color and does not guarantee a per-channel maximum.

## CPU implementation

The authoritative export implementations are `_compress_scene_highlights` and `_compress_sdr_highlights` in `codebase/backend/hdr_finisher/adjustments.py`. Source analysis lives in `analysis.py`; session-to-control peak synchronization lives in `sessions.py`.

Important invariants:

- float32 scene-linear input and output;
- exact identity when Off, when Soft Ceiling softness is zero, or when Peak Fit does not need compression;
- no NaN/Inf generation for finite inputs;
- values at or below the effective start remain unchanged;
- the authoritative CPU preview/export path measures Peak Fit after all creative stages;
- Smooth color rolloff never lifts a weak BT.2020 channel and anchors the brightest transport channel at Target Peak;
- SDR Smooth color rolloff never lifts a weak linear-sRGB channel and anchors the measured source channel at display white;
- the Neutralize peak endpoint is white at Target Peak.

## WebGPU implementation and parameter map

The WebGPU implementation retains `hdrPeakFit` / `hdrSoftCeiling` for direct parity tests. Final-stage HDR compression runs on WebGPU: a `finishFragmentMain` pass resolves Film Look, Vignette and grain into `finishTexture`, and the composite pass applies the shoulder and ceiling to it. The preview anchors Peak Fit on a source-domain estimate carried through Tone and Color, measured before any pass is encoded; the CPU export anchors on the finished image. Closing that remaining difference requires the scheduler to request a refinement once a reduction over `finishTexture` lands, because a settled draft that awaits inside the render loses its race and the scheduler answers a failed draft with a full CPU preview. Relevant packed parameters are:

| Index | Meaning |
|---:|---|
| `p[3]` | Softness percentage |
| `p[53]` | Start in scene-linear units |
| `p[73]` | Target Peak in scene-linear units |
| `p[74]` | Legacy shader mode: `0` off, `1` Peak Fit, `2` Soft Ceiling |
| `p[75]` | Tone-adjusted source peak in scene-linear units |
| `p[76]` | Highlight Detail normalized to 0–1 |
| `p[77]` | Compression Bias normalized and scaled to ±0.6 |
| `p[110]` | Highlight Color: `0` Preserve color, `1` Neutralize peak, `2` Smooth color rolloff |
| `p[159]` | SDR renderer contract: `1` Highlight Compression v2, `0` legacy Base Rendition compatibility |

The authoring preview keeps active HDR and SDR output compression on WebGPU. Peak Fit, Soft Ceiling, and Clip are applied in the final composite after Film Look, spatial effects, vignette, and grain; Clip therefore remains a true output-boundary clamp without forcing a backend preview. Proof and export continue through the authoritative CPU path.

## UI, graph, and scopes

The compact graph plots scalar input nits against scalar output nits. Its scalar is luminance for Preserve color, maximum ACEScg channel for Neutralize peak, and maximum BT.2020 channel for Smooth color rolloff. The summary must identify the active color trajectory.

HDR histogram and waveform scopes can show composite RGB or Luma; SDR scopes use normalized display values. A composite channel peak above the target is valid in Preserve color but is a failure of the grouped/channel-wise mode when measured at full resolution after output compression. A preview-proxy peak below the target is expected when downsampling removes the exact source-peak sample. UI wording must distinguish these cases.

## Required regression coverage

Tests must cover:

- Off and zero-softness identity;
- tones below Start remaining unchanged;
- monotonic Soft Ceiling behavior;
- exact Peak Fit endpoint and positive highlight slope;
- final-stage Peak Fit after Exposure Bands and other creative modules;
- strict BT.2020 channel ceiling in Clip mode;
- Highlights section bypass;
- saturated, low-luminance single-channel highlights entering grouped compression;
- grouped maximum-channel endpoint at Target Peak;
- smooth BT.2020 channel rolloff, weak-channel non-increase, and transport endpoint;
- robust maximum-channel measurement ignoring isolated pixels;
- CPU/WebGPU parity and frontend parameter/label contracts;
- a real DNG or equivalent deterministic fixture where maximum channel exceeds Target Peak while luminance does not.

Private photographs remain manual corpus material under `codebase/local-test-media/inputs/`; deterministic synthetic cases belong in `codebase/tests/`.

## Compatibility rules

- Do not rename the serialized `path_to_white` enum without a project migration.
- Do not change the `smooth_rolloff` working space away from linear BT.2020 without updating automatic peak analysis and the transport endpoint tests.
- Do not change the SDR `smooth_rolloff` working space away from linear sRGB without updating SDR measurement and CPU/WebGPU parity tests.
- Preserve `legacy_base_v1` on projects saved before the SDR rendering-version marker; compatibility fields remain serialized but are not exposed in the current UI.
- Do not introduce a local reference-white conversion; use the shared render color context.
- Keep Peak Fit and Soft Ceiling distinct from Clip as *shoulder shapes*: Clip is the mode with no shoulder at all. All three end at the same unconditional Target Peak ceiling.
- Do not use display-referred gamut clipping as a substitute for scene-linear highlight compression.
- Update this document whenever measurement, curve construction, stage order, GPU parameters, or endpoint guarantees change.
