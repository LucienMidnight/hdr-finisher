# Highlight Compression Technical Reference

Highlight compression is the HDR branch's bounded, scene-linear highlight-shaping subsystem. It runs after Tone and before Color, Exposure Bands, Lift/Gamma/Gain, Curves, local adjustments, and Film Look. It is therefore an anchor for the Highlights section, not a permanent clamp on every later creative stage.

This document is the implementation contract for the CPU renderer, WebGPU preview, controls, scopes, tests, and future changes.

DNG clipped-highlight color recovery is a separate import-stage operation. It repairs unsupported camera-channel ratios before ACEScg grading and is documented in the [Import guide](../user-guide/import.md). Its spatial support or feathering must not be exposed as a Highlight Compression control: Peak Fit shapes valid scene-linear output after import and cannot reconstruct ratios already lost at the DNG encoding limit.

## User intent and modes

The section supports three modes:

- **Off** is an exact identity operation.
- **Peak Fit** measures or accepts a source peak, builds a monotonic shoulder in log2 stops, and anchors that measured peak at Target Peak inside the Highlights stage.
- **Soft Ceiling** is an asymptotic compressor controlled by Softness. It has no measured endpoint anchor.

Peak Fit is the normal mastering control when the user needs a defined endpoint. Soft Ceiling is a creative shoulder and must not be described as an exact maximum.

## Units and reference white

The app defines scene-linear ACEScg `0.18` as the selected project HDR Reference White (`R`, 203 nits by default or 100 nits in the controlled workflow). Conversion is:

```text
linear = nits * 0.18 / R
nits   = linear * R / 0.18
```

Start, Target Peak, and measured/manual source peaks use this convention. Curve construction happens in `log2(linear)` space.

## Processing order

The HDR global order relevant to this module is:

1. Exposure
2. Shadow / Black
3. Contrast and Pivot
4. Highlight Compression
5. Color, Exposure Bands, Primaries, Curves, local adjustments, and Film Look

Peak Fit predicts the measured source peak after the preceding Tone controls. Later stages can raise the finished waveform above Target Peak; users must recheck the final scope after changing them.

## Measurement signals

Highlight Color selects both the compression signal and the color trajectory. This is essential: channel grouping must happen before shoulder qualification, not only after a luminance curve has already decided whether to run.

### Preserve color

- Signal: non-negative ACEScg luminance using AP1 weights `[0.2722287, 0.6740818, 0.0536895]`.
- Measured maximum: exact maximum luminance.
- Robust measurement: the 99.99th percentile of a bounded luminance sample.
- Mapping: RGB channels are scaled by one ratio, preserving hue and channel ratios.
- Consequence: an individual saturated channel may exceed Target Peak even when luminance is correctly anchored.

### Compress channels toward white

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
- **Manual** uses the entered Source Peak before Tone controls. Its meaning follows Highlight Color: luminance for Preserve color, maximum channel for Compress channels toward white.

Changing Highlight Color or Input Peak must resynchronize the derived source peak. Saved projects keep the internal enum `path_to_white`; only its user-facing label changed.

## Peak Fit curve

Peak Fit uses Start, Target Peak, source peak, Highlight Detail, and Compression Bias.

1. Convert Start, Target Peak, and source peak to log2 stops.
2. Derive a required output/input span ratio from Highlight Detail and Bias.
3. If the requested Start cannot fit a monotonic curve with the requested endpoint slopes, move the effective start lower.
4. Normalize the active signal between effective start and source peak.
5. Apply bias to redistribute samples through the shoulder.
6. Evaluate the cubic Hermite curve with unit input slope at the start and the requested positive detail slope at the peak.
7. Convert the mapped stop back to linear and scale/group RGB according to Highlight Color.

The curve must remain continuous and monotonic. Highlight Detail retains positive contrast at the endpoint; it must never introduce a reversal.

Target Peak is an exact transfer-curve endpoint for the measured source signal, not a hard clip and not a requirement that the displayed preview scope read the same number. Source-peak analysis is performed on the full-resolution import. A Standard or otherwise downsampled preview can filter away the exact maximum sample, so its measured peak can land below Target Peak. This difference is normally larger at higher Highlight Detail because the positive endpoint slope leaves near-peak samples farther below the anchor. At `0%`, the endpoint tangent is flat, so a wider neighborhood maps close to Target Peak and a downsampled scope commonly reads higher. Full-resolution export remains the authoritative endpoint check, subject to later creative stages.

The default Highlight Detail is `35%`. This is intentional: it retains visible shape and local contrast in bright fixtures and reflections. `0%` is available when a flatter, fuller shoulder is preferred, but it is not the neutral technical default and can make peak regions feel plateaued.

If the measured source peak is at or below Target Peak, Peak Fit is identity. This decision uses luminance in Preserve color and maximum channel in Compress channels toward white.

## Soft Ceiling

Soft Ceiling qualifies on ACEScg luminance and preserves RGB ratios. Softness `0` is exact identity. Higher values engage the shoulder earlier; the curve approaches Target Peak asymptotically. Soft Ceiling does not use Highlight Color and does not guarantee a per-channel maximum.

## CPU implementation

The authoritative export implementation is `_compress_scene_highlights` in `codebase/backend/hdr_finisher/adjustments.py`. Source analysis lives in `analysis.py`; session-to-control peak synchronization lives in `sessions.py`.

Important invariants:

- float32 scene-linear input and output;
- exact identity when Off, when Soft Ceiling softness is zero, or when Peak Fit does not need compression;
- no NaN/Inf generation for finite inputs;
- values at or below the effective start remain unchanged;
- CPU and WebGPU choose the same signal and evaluate the same curve;
- the grouped-channel endpoint is white at Target Peak.

## WebGPU implementation and parameter map

The live preview implementation is `hdrPeakFit` / `hdrSoftCeiling` in `codebase/frontend/webgpu-preview.js`. Relevant packed parameters are:

| Index | Meaning |
|---:|---|
| `p[3]` | Softness percentage |
| `p[53]` | Start in scene-linear units |
| `p[73]` | Target Peak in scene-linear units |
| `p[74]` | Mode: `0` off, `1` Peak Fit, `2` Soft Ceiling |
| `p[75]` | Tone-adjusted source peak in scene-linear units |
| `p[76]` | Highlight Detail normalized to 0–1 |
| `p[77]` | Compression Bias normalized and scaled to ±0.6 |
| `p[110]` | `1` for grouped channels toward white, otherwise `0` |

Any CPU curve change must be mirrored in WGSL and covered by parity tests in the same change.

## UI, graph, and scopes

The compact graph plots scalar input nits against scalar output nits. Its scalar is luminance for Preserve color and maximum channel for Compress channels toward white. The summary must state when channels are grouped.

HDR histogram and waveform scopes can show composite RGB or Luma. A composite channel peak above Target Peak is valid in Preserve color but is a failure of the grouped-channel mode when measured at full resolution before later creative stages. A preview-proxy peak below Target Peak is expected when downsampling removes the exact source-peak sample. UI wording must distinguish these cases.

## Required regression coverage

Tests must cover:

- Off and zero-softness identity;
- tones below Start remaining unchanged;
- monotonic Soft Ceiling behavior;
- exact Peak Fit endpoint and positive highlight slope;
- Tone-before-Highlights peak prediction;
- Highlights section bypass;
- saturated, low-luminance single-channel highlights entering grouped compression;
- grouped maximum-channel endpoint at Target Peak;
- robust maximum-channel measurement ignoring isolated pixels;
- CPU/WebGPU parity and frontend parameter/label contracts;
- a real DNG or equivalent deterministic fixture where maximum channel exceeds Target Peak while luminance does not.

Private photographs remain manual corpus material under `codebase/local-test-media/inputs/`; deterministic synthetic cases belong in `codebase/tests/`.

## Compatibility rules

- Do not rename the serialized `path_to_white` enum without a project migration.
- Do not introduce a local reference-white conversion; use the shared render color context.
- Do not turn Target Peak into a final-pipeline hard clamp; later creative stages remain independent.
- Do not use display-referred gamut clipping as a substitute for scene-linear highlight compression.
- Update this document whenever measurement, curve construction, stage order, GPU parameters, or endpoint guarantees change.
