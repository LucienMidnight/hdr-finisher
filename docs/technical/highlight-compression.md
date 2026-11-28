# Highlight Compression Technical Reference

Highlight compression is the shared bright-end shaping design used by both rendering lanes. HDR applies it as the final output operation after global and local adjustments, Detail, Film Look, Vignette, output finishing, and grain. Generated SDR first uses fixed middle-gray placement and converts to display-linear sRGB; authored SDR applies it directly to its retained display-linear base.

This document is the implementation contract for the CPU renderer, WebGPU preview, controls, scopes, tests, and future changes.

DNG clipped-highlight color recovery is a separate import-stage operation. It repairs unsupported camera-channel ratios before ACEScg grading and is documented in the [Import guide](../user-guide/import.md). Its spatial support or feathering must not be exposed as a Highlight Compression control: Peak Fit shapes valid scene-linear output after import and cannot reconstruct ratios already lost at the DNG encoding limit.

## User intent and modes

The section bypass is the sole on/off control. When enabled, it supports four compression modes:

- **Peak Fit** measures or accepts the final-grade peak, builds a monotonic shoulder in log2 stops, and anchors that measured peak at Target Peak.
- **Fixed cap** uses Start and Target only. It never measures the image peak; its common RGB gain preserves colour ratios.
- **Soft Ceiling** is an asymptotic compressor controlled by Softness. It has no measured endpoint anchor.
- **Clip** applies a strict per-channel ceiling in the HDR delivery primaries. It is intentionally hard and does not use Start, Softness, source-peak measurement, Highlight Detail, Bias, or Highlight Color.

Peak Fit is the normal mastering control when the user needs a defined endpoint. Soft Ceiling is a creative shoulder and must not be described as an exact maximum.

The HDR Highlight Compression section starts bypassed for a new grade, with **Peak Fit** and **Smooth color rolloff** already selected. Generated SDR starts enabled with the same defaults, replacing the former Base Rendition tone-mapper choice and Highlight Recovery slider. An imported authored SDR base starts bypassed so its existing rendition is unchanged. The serialized mode `off` remains readable only for API and v4-project compatibility; saved projects using it migrate to a bypassed Peak Fit section.

## Units and reference white

### Minimum deliverable Peak (November 16, 2026)

Peak is clamped on input, recipe validation and control synchronization to
`ceil(max(project reference white, 203) × 1.02 / 25) × 25` nits. This is
**225 nits for both supported project whites** (100 and 203 nits). The 203-nit
floor is the AVIF PQ/gain-map route's format white, not a replacement for the
project's configurable scene-linear conversion. A 125-nit peak with a
100-nit project white still produces indistinct AVIF headroom; `1.02 × project
white` alone is therefore insufficient. Typed values, presets and pasted/saved
recipes use the same floor; a clamped recipe's Start is lowered only when
needed to remain below Peak. Valid recipes and all encoder settings remain
unchanged. No migration is performed.

Real encodes of all three formats and all four HC modes first pass together
at a tested 205-nit candidate, but AVIF Clip refuses 206 nits after quantization
at 203-nit project white. This is not a monotonic epsilon boundary. The
25-nit slider step above the tested stable 207–210-nit region is 225 nits.
The guard prevents choosing an intrinsically undeliverable cap; it cannot
create HDR content in an actually dark picture. Measurements and limitations:
`reports/encoding-drift-avif-jxl-2026-11-16.md`.

The app defines scene-linear ACEScg `0.18` as the selected project HDR Reference White (`R`, 203 nits by default or 100 nits in the controlled workflow). Conversion is:

```text
linear = nits * 0.18 / R
nits   = linear * R / 0.18
```

Start, Target Peak, and measured/manual source peaks use this convention. Peak Fit curve construction happens in `log2(linear)` space; Fixed cap operates in linear light.

SDR uses percentages of display white instead of nits. Its generated placement is fixed: scene-linear `0.18` maps to display-linear `100/203`, independent of the HDR reference-white selection. Its Peak Fit target is always normalized SDR white (`1.0` / `100%`).

Global Tone uses the selected HC target as P even when this section is
bypassed; Whites never edits that target. Its +100 overdrive is pre-Film-Look
light, not permission to exceed the enabled final HDR delivery cap. Broad zones
and wheels use photographic grey: scene .0324 HDR; display-linear
.18×100/203 SDR. See the [built Tone design](briefs/tone-endpoints-design-2026-11-15.md).

## Processing order

The HDR global order relevant to this module is:

1. Exposure, Contrast and Pivot
2. Color / B&W and Exposure Bands
3. Frozen-guide global Tone: Blacks, Shadows, Midtones, Highlights, Whites
4. HSL, Curves, Color Grading, Detail, local adjustments, Film Look (including density grain developed in the negative before paper/scan), and Vignette
5. Delivery resize and output sharpening (when delivering)
6. Output Highlight Compression

Peak Fit measures the finished post-Film-Look pixels, after delivery resize/sharpening when delivering, so exposure, creative, finishing, or texture changes cannot invalidate the target. Grain is part of Film Look, not a separate final display-space pass.

The generated SDR order is Exposure and scene Color/B&W, fixed placement
and linear-sRGB conversion, then tone/creative controls, locals, Film Look,
structure/vignette and output finishing. Authored SDR starts with its retained
linear-sRGB base. Both apply Highlight Compression **last**, before the
unconditional hue-preserving sRGB gamut mapper. No early shoulder or early
gamut boundary remains. Neutral Curves retain signed/above-white headroom;
active curves continue their endpoint slopes outside their editable range.
SDR Peak Fit now measures the finished pre-cap picture (after resize/sharpening
for delivery); manual source-peak settings and curve parameters are retained.
N1 intentionally changed SDR grades with HC enabled. N2 adds the frozen-guide
global Tone block in all three paths before the creative tail.


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

SDR adds a hue-keeping form on top of the per-channel mapping. Mapping each linear-sRGB channel alone leaves a small secondary channel untouched while its primary shrinks, so a saturated red whose red channel is compressed many-fold turns magenta, and a below-zero (outside-sRGB) channel grows relative to it; the later gamut step preserves that wrong hue. The hue-keeping form maps the brightest and weakest channel through the curve, holds the middle channel at its relative position between them, and scales a below-zero channel by the same factor as the brightest. The two forms blend by how many stops the pixel's brightest channel is compressed: purely per-channel up to `0.5` stops, fully hue-keeping from `2.0` stops (`SDR_ROLLOFF_HUE_KEEP_START_STOPS` / `SDR_ROLLOFF_HUE_KEEP_FULL_STOPS`, mirrored as literals in `sdrPeakFit`). Mild compression stays per-channel on purpose: there, channels under the shoulder are untouched, which is what lets HDR and SDR develop the same film grain. HDR Smooth color rolloff is unchanged (October 8, 2026, DSC00099).

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

### Attenuate (AgX-style, prototype)

Added October 22, 2026 after the sunset feedback (IMG_3129): Smooth color rolloff squeezes the dominant channel first, so an orange glow swings yellow near the sun and shows hue rings.

- Signal and measurement: the same as Smooth color rolloff (brightest BT.2020 channel for HDR, brightest linear-sRGB channel for SDR). Peak analysis, sync and the GPU anchor treat the two modes alike.
- Concave shoulder (`_concave_shoulder`, WGSL `concaveEndSlope`, mirrored in the graph): each channel takes the shoulder alone, so wherever the curve's slope rises again toward the peak (high Highlight Detail) a channel on the steep top gains on one in the flat middle and the hue turns back: orange–magenta–orange bands around a sun at Detail 100% (Steve, October 22, 2026). Attenuate therefore keeps the cubic shoulder concave: with start slope `m0`, the end slope stays within `3 − 2·m0 ≤ m1 ≤ 0.9·(3 − m0)/2`, and Highlight Detail picks the point in that range (0% flattest top, 100% the most top contrast that keeps hue moving one way). Smooth color rolloff had the same flaw; since October 22 its brightest BT.2020 channel (sRGB channel for SDR) still follows the shoulder as set, so brightness, Highlight Detail and greys are unchanged, while the other channels take their ratio to it from the concave shoulder, so hue moves one way.
- Mapping (`_agx_attenuate`, WGSL `agxAttenuate`): mix each channel toward the pixel's luminance by Attenuation (0–90%, the "inset"; above that the restore's division by `1 − inset` becomes unstable), re-gain so the brightest channel is unchanged, apply the Peak Fit shoulder to each channel, then undo the mix ("outset") in proportion to how little the pixel was compressed (fully restored at no compression, not at all at the measured peak's compression).
- Consequences: uncompressed pixels are returned exactly; the measured peak still lands on Target Peak; bright colours fade gradually toward white rather than stepping through hue bands. Attenuation 0% is per-channel rolloff (HDR equals Smooth color rolloff; SDR omits Smooth's hue-keeping blend).
- GPU parameter: position 60, `HIGHLIGHT_ATTENUATION` (fraction 0–0.9); Highlight Color code `3`.
- HDR note (sunset IMG_3129, October 22): with Start 400 and Target 1000 most of a bright sunset sky sits in the shoulder, so Attenuation above about 50% pales the whole sky while melting the sun disk smoothly. Fading only near the top of the shoulder (an "onset") was tried and rejected: the sky stayed pale and a ring appeared.
- Coverage: `tests/test_highlight_attenuate.py` (identity, endpoint, monotonic, gradual whitening, SDR), `tests/highlight-attenuate-parity.js` (GPU against CPU, HDR and SDR).

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

The encoded-delivery rule (Steve, 2026-11-14, superseding October 18–19)
checks the decoded brightest BT.2020 channel after every HDR encode with
Highlight Compression enabled: CPU/GPU export and reduced/full-size Proof.
Lossy encoding can overshoot even when pre-encode samples have headroom.
`ENCODING_ALLOWANCE = 0.01` in `hdr_ceiling.py` accepts an initial decoded
peak up to target + 1% unchanged and without a note. Larger overshoots get
bounded local correction, aiming at or just below the target (about 97–100%),
without changing SDR pixels or dimming the whole picture. Every corrected
encode is checked again; a final peak above target + 1% refuses delivery and
preserves any existing destination. Refusal is a last resort, not a substitute
for accurate files. Full-size Proof uses the export pipeline; reduced Proof
checks its own encoded pixels. Library pictures are not decoded/checked by
this rule. Disabling the optional codec-limit checkbox never disables an
active Highlight Compression target. With Highlights off, the optional strict
10,000-nit codec-limit check is unchanged.

The finished float itself is exact (Steve, 2026-11-16): before encoding, no
finished pixel exceeds the authored target, so only encoding may use the
allowance above.

The CPU final boundary remeasures after the incumbent primary conversions,
then reduces only pixels whose finished float32 nits exceed the exact authored
target. It deliberately follows both incumbent Clip calls, so the correction
cannot change their branch choice or any already-compliant output bytes.
The WebGPU boundary similarly rechecks after its primary round trip. Parameter
147 carries the authored target in nits (rounded downward only when float32
cannot represent it); the existing scene-unit curve parameters are unchanged.
SDR retains its final gamut boundary with an exact maximum of 1.0.

## Clip

Clip converts the finished HDR grade to linear BT.2020, clamps every channel to Target Peak, and converts back to ACEScg. It is the deterministic pre-encode clamp; the encoded file still follows the shared 1% encoding-allowance rule. Unlike Peak Fit and Soft Ceiling, it intentionally creates a flat clipped endpoint and can alter hue in saturated clipped colors.

The default Highlight Detail is `35%`. This is intentional: it retains visible shape and local contrast in bright fixtures and reflections. `0%` is available when a flatter, fuller shoulder is preferred, but it is not the neutral technical default and can make peak regions feel plateaued.

If the measured source peak is at or below Target Peak, Peak Fit is identity. This decision uses luminance in Preserve color, maximum BT.2020 channel in Smooth color rolloff, and maximum ACEScg channel in Neutralize peak.

## Fixed cap (November 15 N1)

Serialized mode: `fixed_cap`; GPU mode code: `4` (existing parameter layout is
unchanged). Start is a fixed knee `k`; Target is `P` (SDR always `1.0`).
For brightest positive delivery-space channel `x`, with `h = P-k`:

```text
C(x) = x                              x <= k
C(x) = k + h * (1-exp(-(x-k)/h))        x > k
RGB_out = RGB_in * C(x)/x
```

CPU uses `expm1` for accuracy near the knee. HDR measures `x` in linear BT.2020;
SDR uses linear sRGB. The multiplier applies to every channel, including signed
components. The join has slope 1; above it the derivative is positive and at
most 1, approaching zero. Since `1-exp(-u) <= u`, the curve never expands its
input and approaches Target from below. It needs no source-peak measurement,
Softness, Detail, Bias, Attenuation or Highlight Color. These settings remain
saved and become available again when switching back to an existing mode.

The common gain preserves ratios; HDR's existing delivery-primary ceiling
and encoded-output checks still follow it. SDR always finishes through the
existing gamut mapper, including when compression is bypassed. Defaults remain
Peak Fit, Start 400 nits / 50% and Detail 35%; choosing Fixed cap does not
replace any mode or reset its settings.

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
- SDR Smooth color rolloff never raises a positive linear-sRGB channel, never grows a below-zero one, and anchors the measured source channel at display white;
- SDR Smooth color rolloff keeps channel ratios for a pixel whose brightest channel is compressed by two stops or more;
- the Neutralize peak endpoint is white at Target Peak.

## WebGPU implementation and parameter map

The WebGPU implementation retains `hdrPeakFit` / `hdrSoftCeiling` / `fixedCap` for direct parity tests. Final-stage HDR compression runs on WebGPU: a `finishFragmentMain` pass resolves Film Look, Vignette and grain into `finishTexture`, and the composite pass applies the shoulder and ceiling to it. The preview anchors Peak Fit on a source-domain estimate carried through Tone and Color, measured before any pass is encoded; the CPU export anchors on the finished image. Closing that remaining difference requires the scheduler to request a refinement once a reduction over `finishTexture` lands, because a settled draft that awaits inside the render loses its race and the scheduler answers a failed draft with a full CPU preview. Relevant packed parameters are:

| Index | Meaning |
|---:|---|
| `p[3]` | Softness percentage |
| `p[53]` | Start in scene-linear units |
| `p[73]` | Target Peak in scene-linear units |
| `p[74]` | Shader mode: `0` bypass, `1` Peak Fit, `2` Soft Ceiling, `3` Clip, `4` Fixed cap |
| `p[75]` | Tone-adjusted source peak in scene-linear units |
| `p[76]` | Highlight Detail normalized to 0–1 |
| `p[77]` | Compression Bias normalized and scaled to ±0.6 |
| `p[110]` | Highlight Color: `0` Preserve color, `1` Neutralize peak, `2` Smooth color rolloff |
| `p[147]` | Exact authored HDR target in nits, separate from the unchanged curve target |
| `p[159]` | SDR renderer contract: `1` Highlight Compression v2, `0` legacy Base Rendition compatibility |

The authoring preview keeps active HDR and SDR output compression on WebGPU. Peak Fit, Fixed cap, Soft Ceiling, and Clip are applied in the final composite after Film Look, spatial effects, vignette, and grain; Clip therefore remains a true output-boundary clamp without forcing a backend preview. Proof and export use the shared GPU delivery renderer with CPU fallback. Their Peak Fit reduction reads finished pixels after resize/sharpening. Settled direct SDR preview and Library reduce the finished texture too; interactive/tiled editing carries a bounded whole-picture estimate. Fixed cap requests no reduction. Extreme neutral-paper SDR uses the existing scaled half-float storage and float reduction, as HDR already did.

The bounded native Peak Fit measurement keeps the same ranked patches and
maximum. Small source patches queue the original bytes without a staging wait.
On neutral paper the patch maxima keep their individual float32 slots and
are read together. On HDR, changing only Start or Highlight Detail can reuse
the last matching native measurement. Target remains part of its identity
because global Tone Whites uses it before compression.

## UI, graph, and scopes

The compact graph plots scalar input nits against scalar output nits. Its scalar is luminance for Preserve color, maximum ACEScg channel for Neutralize peak, and maximum BT.2020 channel for Smooth color rolloff. The summary must identify the active color trajectory.

HDR histogram and waveform scopes can show composite RGB or Luma; SDR scopes use normalized display values. A composite channel peak above the target after final HDR output compression is a failure in every mode, including Preserve color. A preview-proxy peak below the target is expected when downsampling removes the exact source-peak sample. UI wording must distinguish these cases.

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
- Keep Peak Fit and Soft Ceiling distinct from Clip as *shoulder shapes*: Clip is the mode with no shoulder at all. All four end at the same unconditional Target Peak ceiling.
- Do not use display-referred gamut clipping as a substitute for scene-linear highlight compression.
- Update this document whenever measurement, curve construction, stage order, GPU parameters, or endpoint guarantees change.
