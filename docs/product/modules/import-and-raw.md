# Module PRD: Import and RAW

- **Owner:** Steve
- **Master PRD:** [PRD](../PRD.md)
- **Last status check:** October 18, 2026, against the code.
- **Code:** `loader.py`, `raw_import.py`, `linear_dng.py`, `dng_color.py`,
  `dng_opcodes.py`, `gainmap_decoders.py`, `jpegxl.py`, `avif_info.py`,
  `metadata.py`, `import_jobs.py`, `media_browser.py`, `resource_preflight.py`,
  `sessions.py` (starting adjustments), `analysis.py`.

## 1. Purpose

Open any supported photo correctly. Bring it into the ACEScg scene-linear
working space with its colour, brightness and HDR headroom intact, and give
Grade a sensible starting point that roughly agrees with what the camera
showed.

## 2. Scope

- Input formats and their interpretation, including gain-map files.
- Camera RAW and DNG development: demosaic, white balance, camera colour,
  highlight reconstruction, lens corrections (Lensfun).
- The starting look of a newly opened photo, shared by Grade and the
  Library.
- The media browser and its Locations list.

## 3. Supported inputs

| Kind | Formats |
| --- | --- |
| Scene-linear HDR | OpenEXR, 32-bit TIFF, Radiance HDR, PFM |
| Encoded HDR | 16-bit PQ/HLG TIFF, HEIC/HEIF with gain map, AVIF (plain, PQ/HLG, gain map), JPEG Ultra HDR, JPEG XL |
| Camera RAW | `.arw .cr2 .cr3 .nef .nrw .raf .rw2 .orf .ori .pef .srw`, mosaiced DNG |
| Linear DNG | Rendered linear DNG (for example DxO PhotoLab, Adobe) |
| SDR | Plain JPEG, PNG, TIFF |

Rules in force:

- Gain-map files are never reduced to their SDR base, decoded twice, or
  tone-mapped twice. The SDR base is kept as an authored rendition.
- Malformed or unsupported HDR metadata is rejected, not silently shown as
  SDR.
- A 16-bit TIFF without a PQ/HLG transfer is treated as SDR, with a note.
- Files HDR Finisher exports are priority import cases; round trips are
  accepted within explicit tolerances, not pixel identity.

## 4. Decisions

| Decision | Date |
| --- | --- |
| Camera RAW uses a camera-linear bridge: LibRaw unpack and AHD demosaic, unity white balance through 16-bit, then float32 white balance and camera RGB to ACEScg. Opposed-colour highlight reconstruction removes magenta clipping. | 2026-09-03 |
| **Exposure starts at zero.** RAW development is tuned so that the camera JPEG, the RAW as first shown, and Grade's starting point roughly agree. The Library's starting look must match Grade's. Every RAW grade saved before the change will look brighter or darker; no migration. The strict testing rule applies (RAW import). | Steve, 2026-10-11 |
| Generic, not tuned to one camera. | 2026-10-09 |
| **Edge colour reconstruction prototype** beside Opposed color (which stays): clipped areas keep their brightness but take their colour from nearby unclipped, similarly bright pixels; Expand feathers the blend past the clip line. Replaces the reverted Smooth rebuild attempt, which reshaped brightness and caused artifacts. Expand is presets plus a typed field, because each change re-develops the RAW. | Steve, 2026-10-22 |
| **A plain SDR file starts as the file.** JPEG, PNG, BMP, TIFF and HEIC encoded for display (sRGB or BT.709 transfer, no gain map) keep the file as their SDR rendition, as gain-map files keep their base; HDR shows the same picture with its white at reference white (scene 0.18). No generated SDR and no Library lift. Matching HDR colours into SDR then asks before replacing that rendition, as for gain-map files. | Steve, 2026-10-19 |
| A RAW's starting brightness follows how it was shot, like the camera JPEG. No per-photo automatic meter, visible or hidden. Brief: [codex-brief-raw-starting-exposure-zero](../../technical/briefs/codex-brief-raw-starting-exposure-zero-2026-10-18.md). | Steve, 2026-10-18 |
| **Nothing that shapes the look is baked into import.** No starting tone curve, hidden or pre-set in Curves: Film Look applies its own curves, and renders and passes must start neutral too. RAW gets one fixed brightness calibration for all cameras plus brightness information the file records (such as DNG `BaselineExposure`). Contrast comes from visible tools; the start may look flatter than the camera JPEG. Brightness against the camera JPEG is judged by eye, replacing the ±1/3 EV target. A camera-like start may come later as a visible Look. | Steve, 2026-10-18 |

## 5. Current state (October 18, 2026)

**Built:** all inputs above, the camera-linear RAW bridge with highlight
reconstruction, linear DNG import, Lensfun corrections, HEIC/AVIF/Ultra HDR
gain-map decoding, metadata panel, import progress and cancel.

**RAW zero-start implementation (October 18):** Steve approved a fixed
−0.8 EV linear calibration for every camera RAW. No scene meter, starting
curve, contrast preset or camera-style rendering is added. HDR and SDR
Exposure start at 0; source peak measurements follow calibrated pixels.
Grade and Library thumbnails use one starting-adjustment implementation. Non-camera
starts, including linear DNG and authored SDR, retain their existing behavior.

Fuji correction uses the actual maker-note DR selection, read without image
decoding from the RAF's embedded JPEG: DR100/Auto-at-100 adds 0 EV, DR200
adds 1 EV, DR400 adds 2 EV. `DynamicRangeSetting` (0x1402) selects the valid
manual `DevelopmentDynamicRange` (0x1403) or `AutoDynamicRange` (0x140b).
Missing, malformed, unsupported or unclear settings receive only the fixed
calibration. `RawExposureBias` is ignored: its built-in camera base offset
made the earlier whole-bias compensation overshoot. DSCF6495 records Auto
DR100 and DSCF4011 Manual DR400. Source/thumbnail/saved-picture versions
were invalidated again. DNG BaselineExposure still applies once on mosaiced
routes; linear DNG keeps its existing route.

Regenerated comparison gaps after the DR-only correction: DSCF4011 +0.55 EV
(DR400, +2 EV) and DSCF6495 −0.68 EV (Auto DR100, no correction). These
are descriptive brightness gaps, not pass/fail targets. The known saved
Fuji project affected by this policy correction is DSCF4011.hdrfinisher;
the existing saved-work inventory found no DSCF6495 project/graded sidecar.
No source photo or saved grade was written.

DR-only correction validation: 534 JavaScript checks passed; Python 2297
passed, 3 skipped. The 16-photo sheet was regenerated. Fast checks only,
as Steve requested; no new GPU or export sweep.

Source mip, unedited Library and saved-grade picture versions have changed
so pictures from the old start regenerate. Exposure pastes as a plain number.
The finished-code 16-photo comparison, including DSCF4011, is at
`output/raw-start-measure/comparison.html`; camera-JPEG brightness is for
Steve's visual judgment, not an EV pass/fail threshold.

**Thumbnail decoder decision (October 18):** Steve approved Grade's decoder
and full-source measurements for unedited RAW grid/filmstrip thumbnails and
their kept pictures. These explicitly request a separate thumbnail route;
camera JPEG preview still appears first, then Grade-decoded pixels render
on the GPU and are kept. Single/fullscreen browsing retains its separate
quick RAW/GPU decoder, including its existing differences, for the speed
exploration. Saved-grade pictures already use Grade's decoder.

Cold sequential thumbnails on five badminton photos, with empty application
caches and Windows' file cache left alone: visible median 4.64 s / p90 4.78 s,
versus quick-route 0.55 s / 2.54 s; added 4.09 s / 2.25 s. Camera preview
median 34 ms; finished thumbnail kept by median 4.86 s / p90 4.93 s. No speed
optimization was attempted. The agreed perceptual limits remain SDR ΔE 2000
and HDR ΔE ITP mean <1, p99.9 ≤3; Steve's final sheet review remains open.

Finished-source validation: all 16 comparison photos pass both SDR and HDR
limits after scene-cache storage, using Grade's exact starting state. The
unchanged kept gain-map JPEG transport passes 7/16 SDR and 14/16 HDR; nine
SDR and two HDR photos exceed the limits after compression. Worst SDR
p99.9 is 3.60; worst HDR mean is 1.79 and p99.9 is 21.34. This remaining
encoding limitation is recorded; the thumbnail codec was not changed in
the decoder task. Source decoding and the kept JPEG must not be described
as equivalent validation results.

Follow-up checks: 534 Node and 2291 Python passed (3 skipped); the Electron
five-photo thumbnail routing/render/keep measurement passed. The separate
16-photo comparison passed every scene-cache result but failed the kept
JPEG results listed above. No export/Proof code or tolerances changed.

Validation at `a2263fe`: 534 Node checks passed. Full Python: 2285 passed,
3 skipped, one old RAW-gain expectation subsequently updated; all 53 focused
checks then passed. Ten slow drivers passed, including RAW import, real-RAW
preview/export agreement, GPU delivery and full-size Proof/export identity
in Ultra HDR JPEG, gain-map AVIF and HDR JPEG XL. Four UI drivers failed
(file-browser state, Proof-size browser closure, thumbnail settings timeout,
saved-picture refresh response field); thumbnail colour measurements passed.
No unrelated UI repairs were made and protected photo/project hashes stayed
unchanged. The Library agreement failure above remains open.

**Affected saved work:** 28 RAW `.hdrfinisher` projects and 56 graded RAW
`.hdrf` files were identified read-only in HDR Test Images, Play_Raw,
20261017 badminton, test-photos-delete-later and the two viewport fixtures.
The exact paths are in `output/raw-start-measure/affected-projects.json`.
They retain their saved control values and change brightness; no migration.
The Alkeria linear-DNG test project's old source path is missing; it is
outside this camera-RAW change. No source/project/sidecar was rewritten.

**GPU development (October 18–19, prototype plus Library grid thumbnails on
branch `gpu-raw-library`, not merged):** Grade's camera RAW development for
Bayer sensors runs on the GPU with the same maths (opposed-colour highlight
repair, LibRaw 0.22.1 AHD, camera RGB to ACEScg, automatic Lensfun
correction, import gamut projection, calibration, measurements). Results and
limits: Photo Library module, speed plan phase P. Grade's decoding and demosaic
still run on the CPU; Edge colour reconstruction now uses the shared GPU worker.

**Edge colour prototype (October 22, built):** RAW Highlight Reconstruction
has a second method, "Edge colour (prototype)" (`edge_colour_v1`,
`highlight_edge_colour.py`). After opposed colour and camera-to-ACEScg
conversion it recolours clipped areas from the nearest unclipped, similarly
bright pixels, feathers that past the clip line by Expand (Small 0.25%,
Medium 0.5%, Large 1.5% of the long edge, or typed 0–3%), and smooths
brightness only in a band along the clip line, bright pixels with bright
pixels, so dark objects in front of a light stay sharp. Tried on the sunset
IMG_3129 and the clipped window bokeh in DSC00264: the pink/green blob blends
in and the jagged clip edge goes. Limits: camera RAW on the camera-linear
bridge only; not yet reviewed by Steve in the app.

**Edge colour GPU (October 22, built):** the same spatial reconstruction runs
on WebGPU in both Library RAW development and Grade RAW opening. The Grade
path is import job → session preparation → loader → RAW corrections, so it
sends the ACEScg picture and pre-white-balance camera clipping ratio to the
existing delivery worker. Library runs it after its opposed-colour/AHD/camera
conversion and before lens gain/geometry. Expand and the clipping mask keep
their CPU meanings. Scalar median selection and temporary plane staging use
host memory; all spatial and colour reconstruction uses GPU passes. Scratch
stays inside the existing 44 bytes/pixel + 64 MiB RAW reservation. Row bands
yield through the existing broker; cancellation, Grade priority and export
queue ageing remain in force. Batch source preparation uses export priority;
Library fallback uses Library priority. Source identity, measurements and
saved recipes retain their existing contracts. GPU unavailability, force-CPU,
allocation or execution failures keep the unchanged CPU implementation, with
renderer and fallback reason in diagnostics.

Project reopening, RAW setting changes/source reloads and batch export source
opening all reach the same RAW correction hook. Export and Proof reuse that
selected reconstructed source; no extra reconstruction is applied at delivery.

**Edge colour GPU validation contract (October 22; recorded before measurement):**
Use the existing finished-pixel limits, SDR ΔE 2000 and HDR ΔE ITP mean <1,
p99.9 ≤3, for GPU/CPU and Library/Grade/export/Proof agreement. Include the
clipped regions in separate measurements so the rest of a photo cannot hide
a highlight regression. Preserve the exact HDR output ceiling. Allow 10%
timing variation (decode, transfer and queue contention vary); target at least
2× faster reconstruction than CPU and report Grade click-to-first-frame and
Library completion, including queue/handoff time. Use DSC00264.ARW and
IMG_3129.CR2 when available, reading originals only. Run the new focused
Edge colour driver serially with any other GPU validation; no broad sweep.

**October 22 validation outcome:** serial 2560 × 1440 Electron checks used
disposable copies of both originals, fresh application scenes and uncontrolled
OS disk caches. DSC00264 Grade request-to-first-frame improved from 36.5 s CPU
to 18.1 s GPU; Library completed its GPU source and handoff in 9.0 s. IMG_3129
improved from 15.1 s to 8.4 s; Library completed in 6.3 s. Sony reconstruction
including queue/upload/readback was 10.4 s versus the approximately 28 s CPU
baseline. Both Grade and Library diagnostics assert GPU execution rather than
silently accepting a CPU fallback. Sony peak reconstruction scratch was
1,865,149,440 bytes, within the unchanged reservation.

Both photos pass finished SDR/HDR CPU/GPU comparisons for each route, whole
picture and brightest 5%; worst mean 0.342 and p99.9 2.637. Library's CPU
reference uses its existing bilinear reducer; Grade uses its existing Lanczos
proxy. Direct cross-filter preview comparisons still exceed the limits on
these photos, so the existing Library-to-Grade agreement item remains open.
GPU export and full-size Proof produced identical encoded UHDR JPEGs at the
focused 1024-pixel delivery size; decoded peaks were 996.76 and 948.31 nits
with Highlights enabled and a 1000-nit target. The first ceiling check used
Highlights disabled and was corrected to exercise the intended target.
The initial Library check caught and fixed a post-white-balance clipping mask;
the comparison fixture was then corrected to use the matching resize filter,
without relaxing any tolerance. Synthetic clipped highlights at Expand 0,
0.5 and 3% agree with CPU (scene p99.9 error 0.0000048). No broad GPU sweep.

Regression coverage: `gpu-edge-colour.js` executes the shared hardware stage
at all three Expand values and checks scratch residency; `edge-colour-raw.js`
opens both disposable RAWs through Grade import, checks the accepted first
frame, develops saved settings through Library and verifies GPU export/Proof.
The CPU photo reference is independently decoded with the saved recipe and
the matching reducer. Both drivers are registered for focused release checks.
Backend tests cover unavailable-GPU fallback without input mutation, shared
plane handoff, lane validation and cancellation cleanup. Final fast checks:
571 Node passed; 2,401 Python passed, 3 skipped. The corrected photograph
comparison was rerun on the captured GPU artifacts without another GPU run.

**October 23: DNG CPU fallback interpolation (built).** The bicubic sampler
caches its four horizontal weight arrays once per row strip rather than
recalculating each for every vertical tap. Coordinates, float64 intermediate
precision, cubic coefficient, clamped-border normalization and accumulation
order are unchanged. A scalar reference checks nontrivial per-channel geometry
and borders; existing cancellation and opcode-order checks remain.

On real 8000 x 6000 DJI camera-linear pixels with GainMap already applied,
three-run median WarpRectilinear time improved from 85.66 s to 53.53 s. The
optimized run's median sampler time was 47.93 s, with 5.60 s in coordinates and
allocation: interpolation remains the main CPU cost. Timing tolerance is 10%;
shared-machine CPU runs varied (51.73-68.61 s), so these are descriptive medians.

A benchmark-only OpenCV 5.0.0 comparison used the same full DNG coordinates,
a=-0.75 cubic sampling, continuous coordinate clipping and replicated tap
borders, with source planes packed once. Its three-run median was 17.07 s
(including packing/maps); sampler median 2.80 s. Real normalized camera-sample
absolute difference from the precise sampler was mean 0.000000854, p99.9
0.00001064, maximum 0.000174. The independent fractional high-frequency probe
also agreed within 0.0000021. The locally installed OpenCV 5 is not a packaged
application dependency and was not added for this focused GPU change. These
measurements are from version 5, not an assertion of identical fractional
interpolation in the older OpenCV 4.13 documentation linked in the brief.

Library GPU DNG preparation is now bounded and much faster (see Photo Library).
This CPU optimization preceded the Grade GPU integration below.
Unsupported mandatory operations, GainMap-before-warp,
colour conversion, crop/orientation and the duplicate-Lensfun guard are unchanged.
Validation: 590 Node passed; 2,468 Python passed, 3 skipped. No export/Proof shader or output
contract changed; the CPU optimization preserves the existing numerical result.

**October 24, 2026: Grade GPU DNG correction (built)**

Grade's actual source import now submits supported mosaiced DNG corrections to
the existing delivery worker. The shared Library planner routes by operations,
including the Leica X2 three-plane WarpRectilinear; it never checks camera brand.
Mandatory unsupported instructions still reach the strict CPU route and cannot
be silently skipped. Ordered GainMaps precede warp, DNG colour conversion and
BaselineExposure. Crop/orientation and the duplicate-Lensfun guard are retained.
A signed-colour kernel variant leaves gamut projection and RAW calibration to
the existing Grade loader, so calibration is applied once.

Delivery uses the existing source-job cancellation, priority context (Grade 0,
Library 15, batch 20), preemption/retry, shared reservation and tile permits.
The native output returns through request-owned shared memory; cancellation,
missing renderer, insufficient memory and renderer failure release owned data.
Cancellation exits the job; failures preserve original samples for CPU fallback. GPU allocations are bounded;
full decoded input, transfer copies and corrected output still use host memory.
Decode/demosaic remain on the CPU. The decoder cache version invalidates prior
source mip levels. No perspective controls or DNG export were added.

Three-run medians (seconds; tracked GPU buffers, not whole-process memory):

| Photo | CPU first/exact frame | GPU first/exact frame | GPU correction total | GPU peak / reservation |
| --- | --- | --- | --- | --- |
| Leica X2, 16 MP | 19.99 / 20.01 | 3.75 / 3.76 | 1.99 | 14.78 / 32 MiB |
| DJI_0071-2, 48 MP | 61.24 / 61.26 | 8.79 / 8.80 | 5.65 | 20.35 / 32 MiB |

CPU decode medians were 0.593 / 1.203 s (Leica / DJI); GainMap 0 / 4.782 s,
warp 18.234 / 53.235 s and colour 0.125 / 0.296 s. GPU-route CPU decode was
0.640 / 1.171 s. GPU preparation/handoff before queueing was 0.056 / 0.154 s;
upload 0.123 / 0.494 s, GainMap 0 / 0.494 s, warp/colour 0.183 / 0.324 s,
and readback 0.704 / 1.889 s. Input handoff/initialization was 0.229 / 0.656 s,
output handoff 0.315 / 0.863 s, host result copy 0.124 / 0.407 s and queue
estimate 0.098 / 0.040 s. Stage medians need not sum to the median total.
The first Leica GPU run waited 2.287 s in the queue/initialization boundary;
its 6.39 s first frame remains included in the median rather than discarded.

Validation uses `tests/grade-dng.js --measure`: hidden Playwright hardware
WebGPU at 2560 x 1440, disposable photo copies, isolated application data, and
persistent source mip caching disabled so each route supplies its own pixels.
The initial comparison reused cached CPU proxies and was discarded; the final
run also provides fresh, comparable first-frame timings. Timing tolerance is
10%, with three paired runs and alternating CPU/GPU order on the shared machine.
Library timing is not a Grade baseline. The external CC0 Leica acquisition,
source URL, SHA256 and dimensions are recorded in
`codebase/tests/fixtures/dng-real-samples.json`; the large photo is not committed.

Finished comparisons use independently generated 2560-long-edge float32
Grade source proxies and each import's actual starting adjustments, through
the existing CPU finishing and perceptual comparator. Whole picture and outer
eight-pixel borders pass in all three pairs for each photo. Worst mean / p99.9
across repeats and regions: Leica SDR Delta E 2000 0.000318 / 0.002141,
HDR Delta E ITP 0.001481 / 0.011505; DJI SDR 0.000640 / 0.003357,
HDR 0.000829 / 0.004944. Limits stay mean <1 and p99.9 <=3; no hard real-image
pixel maximum was introduced. The shared native synthetic geometry check stays
<0.0001 (57 cases, worst 0.00000859). This tests import geometry/colour and
finished proxy pictures, not a new DNG export or full-native encoded delivery.

Fast checks: 590 Node passed; 2,480 Python passed, 3 skipped.
Focused checks: headless `grade-dng.js --measure` and `library-dng-warp.js`
(real Leica plus final geometry), run serially. Twelve bridge tests cover
priority, cleanup, cancellation before/after reply, preemption, signed samples,
CPU selection, renderer failure and invalid/incomplete output. Independent
source-contract review found the early gamut-projection issue; the signed
Grade variant and geometry probes cover its correction. Ignored evidence:
`codebase/output/grade-dng/1792774906653/{results,summary,comparison}.json`,
`codebase/output/library-dng-warp/1792774852959/results.json` and
`codebase/output/dng-grade/`. No visible window, broad sweep, push or installer.

**Not built**

- GPU decode/demosaic for Grade's import, X-Trans sensors and DNG.
- Complete Library-to-Grade RAW picture agreement and Steve's final
  brightness review (implementation and limitation above).
- Linux: mounted drives (`/media`, `/run/media`, `/mnt`) are not listed
  under Locations (`media_browser.py`).
- A TIFF with an unrecognised colour profile falls back to a default that
  can mislead.
- The DNG information note still says "experimental".

**AVIF preparation (October 24, 2026).** Built: the bundled libavif helper
returns reconstructed PQ samples directly instead of compressing an intermediate
PNG. The ordinary rendition decoder remains the fallback for unsupported
layouts. CPU import preserves the existing samples; Library converts PQ and
the SDR reference on the GPU. Native/ordinary decoder sample agreement passes.

**GPU highlight path accepted (Steve, October 24, 2026).** Steve reports that
the GPU fixture passed on the Mac without triggering the range guard. Together
with the non-repeatable corruption on the faulty-VRAM machine, this supports
hardware as the cause of the earlier highlight-reconstruction failures. The
GPU path is no longer provisional. Grade import and Library already use the
optimized shared edge-colour method described below; no opt-in is required.
Keep the range guard and CPU fallback for GPU failure/unavailability. The
approximately one-second target remains open; the recorded 42 MP result is
about 3.2 seconds, and Mac timing has not been recorded.

**Faster shared edge colour with a range guard (October 24, 2026).** The shared
GPU edge-colour reconstruction (`frontend/highlight-edge-colour.js`, used by
Grade import and Library) now keeps reduced blur grids on the GPU, reuses the
source weights across channels and combines all scales in one full-size pass.
On the test machine a 42 MP DSC00264.ARW took about 3.2 s instead of about
7.8 s; the test fixture matches the CPU within the existing tolerances and
stays inside the RAW memory reservation. A replay of identical inputs on the
faulty-VRAM machine gave different results on each run (the previous code also
produced NaNs), so the earlier invalid pixels were hardware. A GPU range check
now rejects any result that is non-finite or above 32 times the largest input
magnitude (a correct result is at most about 18 times), sending Grade and
Library to their existing CPU fallback. It cannot catch small plausible-looking
corruption. The subsequent Mac fixture pass is reported by Steve above;
Mac timing and a separate visual review have not been recorded.

## 6. Open work, in order

1. **Finish validation of the zero RAW start:** obtain Steve's visual review
   of the final sheet. Kept thumbnail JPEG compression still exceeds the
   agreed perceptual limits on some photos. The unchanged quick
   Single/fullscreen decoder is deferred to the speed exploration.
2. Linux mounted drives in Locations.
3. Unrecognised TIFF colour profiles: ask, or say clearly what was assumed.
4. Source workflow checks (Photoshop EXR, GIMP, Adobe and DxO linear DNG)
   as documentation and test work.

## 7. Detail and history

- RAW bridge: [Camera_Linear_RAW_Import_Bridge_Sprint_PRD](../archive/Camera_Linear_RAW_Import_Bridge_Sprint_PRD_2026-09-03.md)
- Linear DNG: [Linear_DNG_Import_Sprint_PRD](../archive/Linear_DNG_Import_Sprint_PRD.md)
- Original input scope and round-trip principle:
  [HDR_Finisher_PRD_v1.2 sections 4 and 13](../archive/HDR_Finisher_PRD_v1.2.md)
- Starting exposure decision: [Photo_Library_PRD section 4, October 11](../archive/Photo_Library_PRD_2026-10-09.md)
- User guide: [import](../../user-guide/import.md); workflows:
  [source preparation](../../workflows/source-preparation.md)
