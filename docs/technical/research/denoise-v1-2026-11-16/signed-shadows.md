# Signed RAW shadows — research and shipping map

November 17, 2026. Research only; no production or module-PRD changes.
Algorithm measurements: `e44d75b3`; complete decision comparison: `0fcca1b1`.
MacBook Neo, Apple A18 Pro, 8 GB, one CPU/native thread.

## Steve's summary

**Preserving the noisy readings below black is a sound development direction,
but it is not a demonstrated cure for the Canon specks.** It greatly reduces
the artificial shadow brightness and colour bias in the synthetic neutral
test. With today's Denoise unchanged, however, the Canon dark-shadow crop
still has pits and bright rims, and its measured extreme residuals get worse.
The lifted flame crop gives mixed results, not a clean win. Public held-out
pairs improve a little; scenes seen by RawNIND are essentially unchanged.

Steve's direction, relayed by the coordinator on November 17: preserve noisy
shadow data as darktable does, and let the user crush shadows in editing.
I recommend pursuing that as **signed RAW development**, a correctness and
editing-latitude change, separately from the calibration-backed **Pixel
cleanup** feature. Negative noisy readings are not themselves dead pixels.
Do not describe this prototype as a successful speck fix or silently ship it.

The shipping job is bigger than removing one `max(..., 0)`: import currently
projects negative ACEScg channels to zero, and several later creative stages
also clip them. Keep signed data through development, Denoise and ordinary
creative maths; retain intentional boundaries for authored black crushing,
physical Film exposure, finished display gamuts and file encoding. The
stage-by-stage minimum changes are below. None is implemented here.

**Previously saved RAW grades will look different when regenerated:** deep
shadows can become darker, with less of the previous magenta/purple lift,
and local shadow colour/noise can change substantially. Merely multiplying
Exposure is not an exact way to recover the former picture. This is not an
invisible bug fix. Original RAWs and saved slider values need not change.

## What was built, and how faithfully it isolates clipping

- `codebase/tools/denoise_eval/candidates/signed_ahd.c`: native, unpacked
  signed AHD following the repository's existing GPL AHD stages. It retains
  DN-scale interpolation/rounding and extends Lab's linear toe below zero.
  It removes the lower bound, **not the existing upper 65535 transport bound**.
- `signed_shadows.py`: signed-alone and signed-plus-current-Denoise adapters,
  a clipped AHD control, and an explicitly experimental pedestal alternative.
  `signed_measure.py`: serial quality, decision, neutral/safety and native
  cost runs. The shipping Denoise controls remain `.75 / .5 / .75 / .5`;
  all four noise-frequency controls remain `.5`.
- Eighteen focused behavioural tests cover four Bayer patterns, observed
  signed samples, constant fields, black/colour preservation, exact strip
  seams, clipped-control agreement, upper-bound preservation, exposure once,
  invalid inputs, pedestal reversal on constant fields, and unchanged Denoise.
  There is no source-wording test.

Native AHD uses 256-row strips with eight-pixel context, not a full-frame
multi-buffer demosaic. The Python adapter compiles the small C source with
`clang -O3`; no copied external implementation or new shipping dependency is
added. macOS is measured. Windows compilation/portability is not qualified;
it needs a supported C compiler, not per-machine source edits.

Quality inputs retain the harness's normalised 16-bit DN grid and its
identity temporary-DNG Lab matrix. Native cost uses real sensor DN scale and
the actual camera Lab matrix. Synthetic signed noise is recreated from the
same clean Bayer, noise fit and seed; re-clipping it must exactly reproduce
the frozen original noisy mosaic. Public prepared pairs already contain
signed Bayer samples. No denoiser is tuned against clean truth.

The clipped native implementation is a useful causal control: on the entire
quick/full/held-out/seen sets, its worst case mean finished-pixel difference
from the harness's LibRaw AHD is **0.000205 SDR ΔE2000 / 0.000402 HDR ΔE ITP**;
every case's p99 is zero. That is comfortably inside mean <1, p99 <3. Small
differences can still alter an estimated Denoise model. This validates the
CPU control, **not an unbuilt GPU signed implementation**.

### Why not use a simple black pedestal?

The trial moves the negative interval into unsigned transport with a `.125`
pedestal, compresses the scale to retain white, develops it with normal AHD,
then reverses the scale and pedestal. It also tries `.25`. Constant fields
reverse correctly, but real AHD decisions are not translation-invariant:
Lab conversion, homogeneity choices and rounding change. Between those two
offsets, the worst quick-case differences reach SDR mean **1.839**, p99
**36.718**, and HDR mean **6.769**, p99 **146.011**. Reject this as a faithful
shipping shortcut. Its apparent improvements cannot be attributed solely to
preserving below-black samples. The signed unpacked AHD is the cheaper
faithful research choice; it is not a new denoiser.

## Quality results

Off means today's clipped Bayer development without Denoise. Current means
the existing AppDefault Denoise on that development. RawNIND is Bayer alone,
not followed by current Denoise. Signed alone and signed + Denoise differ
only in whether AppDefault runs after signed development. Clean is the
existing reference; there is no clean truth for the private Canon/Sony crops.

Frozen Off/current/RawNIND quality scores are reused with the baseline
receipt's SHA-256 and matching inventory/metadata. Signed outputs, the
clipped control and current adaptive models are freshly computed. Decision
RawNIND is freshly computed too; both Canon RawNIND PNGs match the inherited
ones byte-for-byte. The model is the existing verified local Bayer ONNX,
ORT 1.32.0 CPUExecutionProvider. No dataset or model was downloaded for this
trial; ORT was installed from the local package cache for that fresh run.

### Synthetic quick, then full, plus real crops

Quick: 23 cases. Full: 27 synthetic/clean cases plus eight private real
crops. These are bounded crop contexts, not full-frame model qualification.
Equal-case full synthetic averages follow; higher PSNR/lower ΔE is better.
SDR uses ΔE2000, HDR uses ΔE ITP. The HDR display transform is the existing
harness one, not encoded delivery validation.

| Method | SDR PSNR dB | SDR mean ΔE | HDR PSNR dB | HDR mean ΔE |
| --- | ---: | ---: | ---: | ---: |
| Off | 23.152 | 10.628 | 26.582 | 37.411 |
| Current Denoise, clipped development | 31.208 | 5.519 | 35.821 | 15.937 |
| Signed development, no Denoise | 23.019 | 10.703 | 26.336 | 37.218 |
| Signed development + unchanged Denoise | 32.889 | 3.847 | 36.948 | 11.066 |
| RawNIND Bayer alone | 30.729 | 4.538 | 35.949 | 13.124 |
| Clipped AHD control + unchanged Denoise | 31.208 | 5.519 | 35.821 | 15.936 |

The synthetic gain is real in this harness, but does not make the complete
quality contract pass. Signed + Denoise fails the luma residual ratio on
3/27 cases and chroma on 5/27 (current: 3/27 and 4/27). It fails texture
energy on 17/18 measured texture cases (current: 16/18), and MTF retention
on 2/3 slanted-edge cases (same as current). Both pass the three halo-extra
checks. Colour-bleed mean is worse than Off on 8/24 measured cases (current:
11/24). These are inherited thresholds, not relaxed checks. Synthetic
ISO25600 uses an extrapolated provisional noise fit, not calibrated capture.

The eight real crops show conspicuous shadow colour/brightness changes, not
uniform improvement. For example, signed + Denoise versus current is SDR
mean ΔE **29.60** on the Canon flat crop, **25.78** on its shadow crop,
and **10.73** on the Sony shadow crop. Those differences measure change,
not accuracy: none has clean truth. A signed pipeline must be approved as an
intentional output change, not required to reproduce clipped pixels.

### Public pairs: held-out and seen remain separate

52 prepared crops, four cameras, 11 scenes: 19 held-out crops/four scenes,
33 seen-by-RawNIND crops/seven scenes. Arithmetic mean within capture,
capture mean within scene, equal scene mean. References retain low-ISO noise,
registration/gain limitations and **their existing clipped development**;
this can penalise legitimate signed shadow changes. Seen and held-out are
different subjects, not a controlled train/test gap experiment.

| Population / method | SDR PSNR dB | SDR mean ΔE | HDR PSNR dB | HDR mean ΔE |
| --- | ---: | ---: | ---: | ---: |
| Held-out Off | 27.682 | 7.033 | 33.316 | 17.888 |
| Held-out current | 34.830 | 3.043 | 41.493 | 7.096 |
| Held-out signed alone | 27.685 | 7.063 | 33.335 | 17.816 |
| Held-out signed + Denoise | 34.906 | 2.934 | 41.634 | 6.967 |
| Held-out RawNIND alone | 35.066 | 2.983 | 42.005 | 6.522 |
| Seen Off | 29.315 | 5.771 | 36.417 | 11.722 |
| Seen current | 34.172 | 3.099 | 41.214 | 6.927 |
| Seen signed alone | 29.315 | 5.772 | 36.425 | 11.722 |
| Seen signed + Denoise | 34.167 | 3.099 | 41.226 | 6.931 |
| Seen RawNIND alone | 33.925 | 3.545 | 41.182 | 6.861 |

Thus the held-out gain is small, and the seen set is essentially unchanged.
Neither supports claiming the synthetic-sized gain on real photographs.

## Canon decision crops and lifted-shadow tails

Regenerated the existing 12 decision rows in place with seven added columns:
`signed`, `signed_denoise`, `pedestal_denoise`,
`signed_ahd_clipped_denoise`, `current_import_gamut_denoise`,
`signed_import_gamut_denoise`, `signed_denoise_then_gamut`. Existing Off,
current, RawNIND and available clean PNGs remain. Images are 288px native
crops, fixed exposure, sRGB PNGs, no sharpening or per-method exposure fit.

The inherited automatic shadow support has only **21 pixels** on Canon dark
shadow; a zero island count there is not credible evidence of cleanliness.
Keep that old metric for continuity, but use the additional fixed support:
Off Gaussian-sigma-2 luma <.02 before exposure, eroded two pixels, four-pixel
border excluded, same support for every method. It covers 76,176 dark-shadow
pixels and 63,017 flame pixels. Residual is against a local 5×5 median after
the fixed +4-stop SDR presentation. It is a **contrast proxy, not truth**;
real detail can count. No new quality gate is inferred from it.

| Canon dark shadow +4 | Luma abs p99.9 | Chroma abs p99.9 | Dark tail >.05 | Small dark islands |
| --- | ---: | ---: | ---: | ---: |
| Off | .40665 | .59525 | 29.479% | 2,953 |
| Current Denoise | .13198 | .16090 | .400% | 86 |
| Signed alone | .36003 | .63314 | 29.213% | 2,979 |
| Signed + Denoise | .16275 | .18805 | .700% | 144 |
| Pedestal + Denoise | .16656 | .19821 | .739% | 156 |
| RawNIND Bayer alone | .01373 | .01628 | 0% | 0 |
| Current import projection, then Denoise | .13386 | .10479 | .301% | 70 |
| Signed import projection, then Denoise | .14138 | .10382 | .231% | 53 |

Signed + unchanged Denoise worsens the main dark-shadow luma/chroma tails.
Applying today's import projection first improves one island measure but
again destroys signed shadow statistics, and luma p99.9 still worsens.
It is not the proposed signed-through-Denoise pipeline.

| Canon flame edge +4 | Luma abs p99.9 | Chroma abs p99.9 | Small dark islands |
| --- | ---: | ---: | ---: |
| Off | .39562 | .67566 | 2,418 |
| Current Denoise | .38991 | .66868 | 2,397 |
| Signed alone | .38222 | .69527 | 2,576 |
| Signed + Denoise | .38284 | .69060 | 2,594 |
| RawNIND Bayer alone | .00943 | .02302 | 0 |

RawNIND is much smoother on these proxies; the earlier detail/structure
failures are not thereby waived. It is not established clean truth.
The signed dark crop loses much of the old purple cast but retains obvious
pits/rims and coloured blotches. Signed + current versus current differs by
SDR mean/p99 **18.27/27.99** in dark shadow and **5.64/38.08** at the flame.
These large changes are not CPU/GPU parity results.

### Crops to look at first

All links below point to ignored local review output, not committed photos:

- [Compact Canon comparison](../../../../codebase/output/denoise-v1/signed-shadows/signed-shadow-summary.html): current, signed + unchanged Denoise, and RawNIND crops with the fixed-support contrast proxy.
- [Canon dark: current](../../../../codebase/output/denoise-v1/decision/canon-dark-shadow/denoise_v2_app.png),
  [signed + Denoise](../../../../codebase/output/denoise-v1/decision/canon-dark-shadow/signed_denoise.png),
  [signed alone](../../../../codebase/output/denoise-v1/decision/canon-dark-shadow/signed.png),
  [RawNIND](../../../../codebase/output/denoise-v1/decision/canon-dark-shadow/rawnind_bayer.png).
- [Flame +4: current](../../../../codebase/output/denoise-v1/decision/canon-flame-edge-lifted/denoise_v2_app.png),
  [signed + Denoise](../../../../codebase/output/denoise-v1/decision/canon-flame-edge-lifted/signed_denoise.png),
  [RawNIND](../../../../codebase/output/denoise-v1/decision/canon-flame-edge-lifted/rawnind_bayer.png).
- [Held-out print/dots: current](../../../../codebase/output/denoise-v1/decision/heldout-print-dots/denoise_v2_app.png),
  [signed + Denoise](../../../../codebase/output/denoise-v1/decision/heldout-print-dots/signed_denoise.png),
  [clean](../../../../codebase/output/denoise-v1/decision/heldout-print-dots/clean.png).
- [Manifest: every row, support, scores and source provenance](../../../../codebase/output/denoise-v1/decision/manifest.json).

## Neutral black, exposure safety and HDR

Four known neutral ACEScg levels, Canon's inherited provisional noise fit,
256² pixels, 16px border trimmed, eight independent seeds 17000–17007.
Compare the ensemble mean patch at +4 stops to the true neutral, not to
the biased clipped clean. This tests both brightness and colour together.

| True linear level | Current luminance bias | Signed + Denoise bias | Current SDR mean-patch ΔE | Signed SDR mean-patch ΔE |
| --- | ---: | ---: | ---: | ---: |
| 0 | +.00140890 | −.00001143 | 24.524 | 0 |
| .0001 | +.00137585 | −.00000386 | 24.174 | 1.749 |
| .001 | +.00108001 | +.00000804 | 21.639 | 1.519 |
| .01 | +.00025466 | +.00001443 | 6.188 | .502 |

The bias reduction is strong, but **neutrality is not a blanket pass**:
the two darkest nonzero levels still exceed mean ΔE <1. Their HDR mean-patch
ΔE ITP is 11.276 and 3.208. A noiseless signed development at .0001 itself
has HDR ΔE ITP 2.297 at +4; the normalised 16-bit harness grid is a material
resolution limit here (noiseless SDR ΔE .273). Real sensor-DN precision,
camera matrices and full-frame denoising need qualification; do not promise
perfect neutral shadows from this experiment. Black's zero displayed error
does not mean signed black fluctuations disappeared: display floors them.

The signed 64² safety fixture includes negative noise and a white patch.
Unchanged Denoise followed by the **actual CPU highlight compressor** stays
finite at −6/0/+6 stops in all four modes: Peak Fit, Soft Ceiling, Clip,
Fixed Cap. All 12 cases stay at or below **exactly 1000.0 nits** before
encoding, without a 1% allowance. This is not a test of all creative controls,
all real photos, GPU delivery, or encoded files. Those remain shipping gates.

## Where the negatives are lost now

`raw_import.py:542` requests rawpy AHD, unity white balance, raw camera
output, no auto scaling and unsigned 16-bit transport. LibRaw's black
subtraction clips into unsigned storage **before AHD**, not just at the
final Python conversion. The research environment is rawpy 0.27.1 / LibRaw
0.22.1. The prior Pixel cleanup scan found 3,836,435 below-black Canon
samples; that count is inherited evidence, not a repeated scan here.

GPU `library-gpu-raw.js:68–71` separately applies `max(raw-black,0)` to
normalised floats and integer AHD input. The repair write at `175–176`
also rectifies, but only for rewritten clipped-highlight samples. Merely
removing the first max is insufficient: green candidates pack unsigned
16-bit values, RGB interpolation uses `clip16`, and Lab uses a clamped
unsigned table index. The `finish` helper at `317` then projects negative
ACEScg channels away before publishing the developed scene.

CPU's later `map_negative_acescg` in `color.py:199` performs the analogous
maximum-preserving neutral-axis projection; all-negative pixels become
black. `loader.py:250` applies it after source conversion/lens, **before
Denoise/source analysis**, with other Library entry points below. These
are statistical clipping boundaries even though they are not plain per-
channel zero clamps.

Primary-source checks, accessed November 17: LibRaw's tagged
[black subtraction](https://github.com/LibRaw/LibRaw/blob/0.22.0/src/preprocessing/subtract_black.cpp)
uses `CLIP(val)` into its integer image, and its
[AHD](https://github.com/LibRaw/LibRaw/blob/0.22.0/src/demosaic/ahd_demosaic.cpp)
uses unsigned RGB and nonlinear Lab/homogeneity decisions. darktable's
[rawprepare](https://github.com/darktable-org/darktable/blob/master/src/iop/rawprepare.c)
subtracts black and divides into float output without the equivalent
sensor zero clamp. The darktable link is mutable `master`; this checks
that stage, not a claim that every darktable module preserves every negative.

## Shipping map: every downstream boundary

This is a static code audit plus the bounded measurements above, **not a
claim that these stages were all executed with signed sources**. Line
locations refer to this branch. Proposed changes are not approvals to alter
Film, tolerances, cache sizes or existing codec-specific source semantics.

### 1. RAW unpack, reconstruction and source development

| Stage / current evidence | What happens now | Smallest safe shipping change |
| --- | --- | --- |
| LibRaw decode and CPU AHD: `raw_import.py:542,994` | Black subtraction/AHD integer transport loses negatives; Python normaliser requires uint16. Decoder-specific defect handling may already have happened at unpack. | Read the existing unpacked Bayer, subtract per-phase black into signed storage, use a bounded signed AHD; make its normaliser explicitly accept that transport. Keep decoder-specific unpack policy, CFA, white level, orientation and upper limits unchanged. Do not reinterpret negative noise as a defect. |
| GPU AHD: `library-gpu-raw.js:68,175,190,205,235` | Zero clamps, unsigned green packing, RGB clamps and Lab-table bounds discard signed range. | Use signed/unpacked candidate storage and the shared signed Lab toe/rounding; clamp only the existing upper transport limit. Account for larger scratch in the existing owner and tile if needed, without raising any budget. Never feed a negative value into an unsigned pack/index. |
| Opposed color: `raw_import.py:825,936`; GPU sensor repair | CPU mosaic helper floors at zero; neighbour references use nonnegative cube-root inputs; repaired sensor values return through uint16. | Keep signed original mosaic and a separate positive highlight-reference view. Only replace explicitly reconstructed saturated sites; never re-encode the whole signed mosaic as uint16. Keep thresholds and valid highlight-domain maths unchanged. Test both reconstructed and untouched regions. |
| Edge colour: `highlight_edge_colour.py:334`; `highlight-edge-colour.js:50` | Runs after AHD and camera→ACEScg. Derived luma/denominators are positive; negative original BT.2020 channels are protected in reconstruction. GPU `bad` flags NaN/Inf, not finite negatives. | Preserve original signed RGB and the existing negative-channel protection; positive statistical guides may stay positive. Do not widen validity rules or call ordinary negative noise invalid. Explicitly test halos across black/highlight boundaries. |
| Camera WB, normalisation and ACEScg: `raw_import.py:1018`; `import_defaults.py:63` | Float WB/matrix already preserve signed RGB; fixed source gain is not an adaptive re-meter. | Reuse this linear tail, retaining signed pixels. Keep normalisation/reference-white/exposure application identical and once only; no fitted exposure compensation. Matrix-generated out-of-gamut negatives and noisy below-black negatives share storage but have different causes. |
| Lens corrections: `raw_import.py:1322,1422` | Float gain and bilinear remapping preserve sign; bounds clamp coordinates, not pixel colour. Gain magnifies noise and interpolation correlates it. | No new pixel clamp. Keep gain/remap linear on signed RGB and preserve existing geometry order. Qualify black neutrality after vignette gain and at remap borders; do not mistake coordinate/mask bounds for image bounds. |
| Source gamut projection: `color.py:199`, `loader.py:250`, GPU `finish:317` | Projects negative ACEScg away before source analysis/Denoise. | Bypass/defer this RAW source projection consistently on CPU/GPU; use `sanitize_finite_array`, not `sanitize_array`, for valid signed scene data. Do not simply move this AP1 neutral-axis projection to every later stage: the existing final output-gamut boundary owns display legality. Leave authored/codec-specific contracts outside RAW unchanged unless separately approved. |

### 2. Denoise and creative editing

| Stage / current evidence | What happens now | Smallest safe shipping change |
| --- | --- | --- |
| Denoise: `denoise_adaptive.py:210,342,354` | Filtering/opponent output can be signed. Variance uses max(luma,0) as a statistical guide; fitting excludes nonpositive means and falls back if fewer than 1000 survive. | Initially keep controls/filter unchanged, as measured here. Feed signed source to both model setup and resolve on CPU/GPU. Retain nonnegative variance/read-noise constraints; do not take sqrt of signed light. Qualify fit support and fallback explicitly on dark/all-negative images. Any improved estimator is a separate follow-up, not an invisible prerequisite claimed solved here. |
| Exposure/foundation: `adjustments.py:675,908,918`; WGSL `sceneExposure`, `sdrScenePrefix`, `sdrReferencePrefix`, peak-analysis prefixes | HDR exposure is multiplication and signed-compatible. Generated SDR and authored-reference prefixes zero-clamp; the peak helpers also clamp their input. | Preserve signed RGB through RAW-generated SDR/HDR exposure and matching peak/Match analysis; clamp only the derived positive peak/luma statistic. Do not change independently authored SDR decoding as collateral work. Test 0 EV identity and ±6 EV on both renderers. |
| Tone / Blacks: `tone.py:119`; WGSL `toneZonesWgsl` | Zero Tone is exact bypass. Log/range guides use positive luma; gain/additive floor operate on original RGB. Negative Blacks intentionally floors affected output to zero. | Keep positive log guides and preserve signed signal for neutral/broad-zone controls. Keep the **explicit negative-Blacks black crush**: that is Steve's authored choice, not silent import clipping. Test positive Blacks raising a signed neutral patch and negative Blacks crushing it without colour surprises. No endpoint/tolerance changes. |
| HSL, curves, wheels: `hsl.py:48,197`, `adjustments.py:1820,2456`; WGSL curve helpers | HSL uses signed cube roots; curves have an extended negative toe and extended endpoint sampling; wheels use positive range guides but operate on original colour. | Retain signed maths, neutral identity and endpoint extensions; do not clamp RGB simply to make log/LUT access legal. Verify luma≈0 ratio branches, no NaNs, neutral/purple patches and CPU/GPU agreement. Existing active RGB-curve hue changes remain intentional. |
| Local adjustments/masks: `local_adjustments.py:102,519,1502,1549`; WGSL `applyLocalGrade:2129` | Masks/opacity are bounded 0..1 (correct). Local EV guides floor luma. Both local grade and final local stack zero-clamp RGB, including unmodified regions when any local is active. | Remove transport clamps on grade/stack/mask-blend output, retaining mask bounds. Define consistent negative-luma gain behaviour (neutral local exact identity, exposure multiplies signed RGB, contrast uses safe guides). Test zero-effect local, partial/zero opacity and completely unselected pixels. |
| Retouch, geometry, Detail: `retouch.py`, `finishing.py` geometry; `detail.py:35,100` | Retouch interpolation/patch arithmetic and geometry float transport are largely sign-compatible. Detail uses floored log-luma guides and zero-clips RGB where its correction is active. | Preserve signed signal through linear sampling/retouch and active Detail; keep log-guide floors and existing halo limits. Add signed no-change and changed-region tests, including bounded/whole-frame seams. This audit does not requalify every retouch mode. |
| Film optical blur/scatter/halation, stock and grain: `adjustments.py:1759,1817,2298`; `film_stock.py:331,380`; WGSL Film/structure | Physical stock exposure explicitly maxes at zero before log density. Grain/stock lookup domains are bounded. Final Film strength mix and structure also zero-clamp RGB even though they run before final delivery. | Keep signed scene through optical linear mixing and into the module; preserve signed bypass/strength-zero and the original residual in strength mixing. Keep nonnegative **physical exposure/density-model inputs**, separately from the signed source. Remove incidental final mix/structure clamps; do not evaluate stock log/density tables on negative exposure. A truly signed Film response beyond that physical boundary needs its own reviewed model, not blind clamp removal. |
| Vignette: `adjustments.py:1893`; WGSL `2112` | Positive exposure gain is followed by a pixel zero clamp. | Keep the gain on signed pixels; remove only the premature colour clamp. Retain positive highlight-protection guides. |

### 3. Analysis, retained pictures, fallback and delivery

| Stage / current evidence | What happens now | Smallest safe shipping change |
| --- | --- | --- |
| Scopes/histograms: `scopes.py:38,92,141,187`; `scope-analysis.js:43,166` | Scopes use processed/finished pixels and floor/limit their own presentation samples; HDR histogram gathers <1 nit in its bottom bin. They do not write these bins back into source RGB. | Keep display-scope boundaries and honest bottom-bin semantics. Ensure CPU/GPU scopes analyse the same final rendition. If an unbounded scene-source histogram is added later, count negative underflow explicitly rather than silently discard it; not required for this implementation. No new scope UI is assumed. |
| Library development/source caches: `library_cpu_bands.py:143`, `library_raw_decode.py:49`, `library_pictures.py:780`, GPU `finish` | Several Library entry points repeat the import projection. Float32 scenes and float16 raw thumbnails can carry signed values, but current published pictures have already been projected. | Remove RAW scene projection at every source entry, retaining signed scene/Denoise intermediates. Never use a rendered 8-bit/PQ screen picture as a signed working source. Advance shared RAW/source-colour/development and Denoise identities so old clipped sources/models cannot be reused. |
| Finished Library thumbnails/screen previews: `library_grade_pictures.py:102–116`, `library_screen_previews.py:18,136–143` | Finished pictures correctly encode bounded SDR/PQ; stored screen JXL is a finished view. | Keep final clamps and codecs. Bump `PICTURE_VERSION`, dependent screen identities and any affected scene-thumbnail identity together; lazily regenerate from RAW. Do not change budgets, add a second pixel cache, or treat old finished pixels as new signed source. |
| Half/float GPU transport | Float32 and signed half can carry negatives; unsigned/unorm storage cannot. Extreme values below −65504 can overflow half just as large positive ones can. | Preserve the existing scaling/residency planning and inspect both absolute ends before half conversion. Use bounded/signed float intermediates under the existing budget. Do not solve overflow by silently clipping noisy shadows. Normal sensor negatives are nowhere near the half limit. GPU performance/memory are unmeasured here. |
| GPU validity and CPU fallback: `library_gpu_raw.py:341`, `library_grade_pictures.py:60`, `gpu_delivery.py:199,513`; GPU Edge colour `bad` | These tests reject NaN/Inf, **not finite negative scene channels**. RAW empty-channel detection (`library-gpu-raw.js:629,669,872`) counts exact +zero bits ≥99%, not negatives. Preview control [0,1] checks validate controls, not RGB. | Keep the finite, shape, memory and output-legality checks. Do not relax an invalid-pixel guard. Remove earlier unsigned conversion, not the safety guard it trips. Test true black/empty vs noisy below-black sources separately. CPU fallback must use the same signed development, with the existing one-try policy; never fall back merely because a source channel is negative. |
| Peak/robust statistics and auto/Match preparation: GPU `finish:327`; `adjustments.py` peak helpers | Positive `atomicMax` bit-casts are valid because the **statistic** is maxed at zero first. Some SDR peak prefixes currently rectify the image. Auto/Match were built from nonnegative imported sources. | Keep nonnegative peak reductions and safe log guides, but derive them without overwriting signed source buffers. Recompute source analysis/Match targets after identity invalidation and qualify any chosen recipe. No automatic compensation of saved grades. |
| Proof / output finishing: `exporters.py:210–230`, `finishing.py:869`, `proofing.py:127,143,719` | Finished creative pixels are resized/sharpened, then compressed/gamut-mapped; finishing currently maxes RGB early. Proof/gain-map math intentionally requires legal endpoints and positive logarithm inputs. | Keep signed working pixels through shared resampling/sharpening and defer incidental finishing clamp to the common final rendition boundary. Proof and export must consume the same finished legal endpoints, never unsigned-wrap signed source. Preserve gain-map guards. Test GPU Proof with CPU export fallback within mean <1 / p99 <3. |
| SDR/PQ/gain-map encoding: `exporters.py:980,989,1081`; proof endpoint encoders | Integer SDR/PQ and gain maps cannot encode arbitrary negative scene channels; OETF/log/quantisation inputs are bounded. | **Keep the final display-gamut map/lower bound and encoder input bounds.** Signed is an internal scene contract, not a promise to write negative PQ or integer RGB. Do not change independent codec import semantics as part of RAW work. |
| Exact HDR cap: `adjustments.py:392,416,439`; `hdr_ceiling.py` | Final BT.2020 target limiter and encoded re-decode verification enforce delivered maximum, separately from working scene signs. | Keep the exact pre-encode ceiling on every final path, after all operations that can add energy. No pre-encode allowance. Keep the agreed 1% **encoder-rounding-only** allowance after encoding. Verify SDR/HDR, framed output, Library, Proof, CPU/GPU and actual encoders before shipping; this trial's CPU fixture is not that qualification. |

Important distinction: **a valid signed working pixel is not an invalid
finished delivery pixel**. Storage, geometric bounds, masks, positive
variance, physical exposure, display gamut and codec bounds serve different
purposes. Removing every occurrence of `max`/`clip` would introduce bugs.

## Native CPU cost and GPU feasibility

Read only the approved originals in `<photosRoot>/HDR Test Images`. Same
Mac, same source, one thread, one measurement per method. Existing ±10%
descriptive timing allowance; no repeat to chase normal noise. These are
summed unpack/AHD/ACEScg subclocks, **not action-to-screen waits**, and omit
Denoise, highlight reconstruction, lens corrections and final rendering.
The signed native path stays sensor-oriented; current rawpy also applies
orientation, so the small difference is not an orientation-controlled speed
claim. Shared unpack time is measured once and used in both sums.

| Source / method | Unpack | Sensor subtract | AHD | Normalise + ACEScg tail | Development sum |
| --- | ---: | ---: | ---: | ---: | ---: |
| Canon 18.02 MP, current | .015 s | In LibRaw | .537 s | .288 s | .840 s |
| Canon 18.02 MP, signed | Same .015 s | .029 s | .651 s | .393 s | 1.088 s |
| Sony 42.39 MP, current | .016 s | In LibRaw | 1.299 s | .661 s | 1.976 s |
| Sony 42.39 MP, signed | Same .016 s | .044 s | 1.539 s | .919 s | 2.518 s |

Observed added development cost is **.248 s on 18 MP / .542 s on 42 MP**
(about 30% / 27% of these development sums). This is not a new measured
whole-app wait. Sampled process-tree peaks for the combined current/signed
commands are .819 GB / 1.332 GB; they are not a per-method memory delta.
The 2.5 GB research guard never aborts. This does not prove the shipping
whole-app owner/residency budgets, which must remain unchanged.

GPU should do the same black subtraction and signed AHD/Lab extension in
the existing RAW route, then preserve signed values through its shared
development/creative graph. Replacing unsigned candidate packing increases
scratch: tile or reuse within the approved planner, do not add an unbudgeted
native-frame cache. Shared arithmetic, upper bound and clipped controls make
agreement plausible, **not demonstrated**. The required measured finished
CPU/GPU tolerance stays SDR ΔE2000 / HDR ΔE ITP mean <1, p99 <3. CPU signed
versus old clipped output is deliberately not required to match that way.
No GPU speed benefit is claimed or used to justify the work.

Standalone runs: quick 14.04 s, full 80.34 s, held-out 47.60 s, seen
93.84 s; final decision command 31.03 s including fresh RawNIND; neutral/
safety command 4.14 s. Quality guard peaks are .467–1.092 GB. Corresponding
receipts are in `codebase/output/denoise-v1/signed-shadows/`; baseline paths,
SHA-256, controls, machine and algorithm hash are embedded. Final C SHA-256:
`3240e598615113d761cf37185ca0bdd345ca463c067bab2b3d2d5e1971b229c5`.
Full/quick/pair/safety/native receipts use `e44d75b3`; the extra RawNIND
decision-only refresh uses `0fcca1b1` with the same signed implementation.

## Smallest safe shipping sequence and reopened grades

1. **Agree the signed internal source contract and visible change.** RAW
   scene values may be negative; statistics may use nonnegative guides;
   finished pixels must be legal. Treat this as signed RAW development,
   not a Pixel cleanup checkbox. No compatibility renderer is proposed.
2. Implement CPU and GPU signed AHD plus unchanged linear WB/lens tail,
   remove the shared RAW import projection, and feed signed Denoise/model
   setup. Qualify untouched positives/highlights, all four CFA phases,
   camera colour, per-phase black, borders and orientation. The research
   adapter is the starting experiment, not drop-in production code.
3. In the **same integrated change**, remove incidental clamps in generated
   SDR prefixes, local stacks, Detail, Film final mixes/structure, vignette
   and finishing; preserve intentional Blacks/physical-film/output clamps.
   Update peak-analysis/Match inputs, identity versions and Library entry
   points together. Leaving any one of these old paths active makes Library,
   Grade, Proof and export disagree or loses the statistical benefit again.
4. Bump source/developed/model/finished-picture identities. Existing grades
   keep their controls but rerender their RAWs; old clipped cached pixels
   cannot be relabelled as signed. Non-RAW files, independently authored SDR
   and their decoder contracts are not a blanket part of this change.
5. Run targeted end-to-end signed-stage/zero-control, neutral, ±6 EV,
   same-source CPU/GPU/Library/Proof/export comparisons and **all applicable
   delivery/ceiling checks** under existing budgets. Full-frame adaptive
   noise estimates may differ from these crops. Review the changed Canon,
   Sony, already-crushed and film/local grades with Steve before release.

Every existing RAW-based saved photo/project, including read-only RAW test
projects, is potentially affected when re-developed. Strongly lifted
high-ISO shadows show the largest measured changes; lower-noise scenes may
change little. Blacks/local masks, Film toe and Match fits can respond
differently because their input distribution changes. A final output floor
is still necessary: underexposed negative *light estimates* are retained for
processing, not shown as negative emitted screen light. Never overwrite the
protected projects to update expectations. No pre-1.0 legacy/migration path
is requested or added.

## Verdict, checks and remaining limits

**Recommend shipping work in principle, not shipping this prototype.** Steve's
data-preservation direction is supported by the bias experiment and current
clipping audit. The task's narrower hypothesis—much of the real Canon speck/
blotch problem disappears with unchanged Denoise—is **not supported**.
Keep that quality problem open. Neutral HDR precision, positive-domain Film
behaviour, full-frame adaptive fitting, native GPU storage/budget, signed
end-to-end parity and encoded delivery remain explicit qualification work.

Fast Node suite: **1,091 passed, one skipped, zero failed**, 12.04 s.
Final ORT-enabled Python suite: **4,010 passed, 150 skipped, one xpassed,
zero failed**, 254.20 s; guarded command 255.73 s / 2.005 GB sampled tree
RSS. The sole warning is an existing Starlette/httpx deprecation. The initial
Python run before optional ORT had 4,005 passed / 155 skipped / one xpassed
in 275.88 s; no failures. The initial extra RawNIND decision refresh
failed because this fresh worktree lacked ORT; installing the cached pinned
runtime fixed it, and final decision regeneration passes. No guard was
loosened. No relevant GPU driver executes this research-only signed CPU
adapter; no broad UI/GPU check is run as a substitute. No release build,
production code, module PRD, original photo, saved grade or dataset is changed.

Output starts at 12.9 GB and ends at **13.0 GB**, below the 100 GB limit;
12.9 GB is shared test-photo storage. Decision PNGs total **16.25 MB**.
Obsolete native build, temporary source-reference downloads/setup log and
redundant per-phase console logs are removed. Retain report-linked decision PNGs,
manifests, final receipts/logs and the small hash-keyed native build required
to reproduce them. Linked public datasets/model inputs are reused, never
copied into Git or removed by cleanup.
