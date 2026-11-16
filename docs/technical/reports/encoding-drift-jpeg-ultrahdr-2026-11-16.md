# JPEG Ultra HDR encoding drift — November 16, 2026

Research complete on the minimum MacBook Neo / 8 GB. Shipping encoders,
defaults, Proof/export gates and tolerances are unchanged. The sprint status
row was committed separately. These measurements are not release qualification.

## Steve's answer

**Both things are true:** the codec can magnify harmless input differences,
and the resulting JPEG can genuinely differ too much from the finished photo.
Passing the renderers does not make those encoding losses acceptable.

- A single renderer's SDR input, changed by only one code in about 2% of
  channels, produces HDR P99.9 **8.615** after encoding. Its HDR input is
  identical. The original two-renderer failure is therefore not evidence
  that one renderer drew sharp highlights incorrectly.
- The two files' gain-map metadata are **not identical**. Content-dependent
  min/max bounds shift the map's quantization grid. But forcing a common
  range does **not** solve the problem: pair P99.9 remains **8.274**.
- Map JPEG compression first pushes the matched-renderer comparison over
  the existing limit. Base JPEG compression and the final map processing
  make it worse. The underlying 8-bit gain map alone passes on the fixture.
- There is also a real quality problem: the final fixture files differ from
  their **own** finished sources by HDR **4.004/29.187 CPU** and
  **4.035/29.415 GPU** (mean/P99.9). Four reduced real-photo exports also
  fail the same research screen; two native-resolution highlight crops
  confirm own-source failures for both renderers.
- Neither higher quality, shared bounds nor a smaller map qualifies as a
  fix. Removing smoothing and fitting gains to the decoded base helps
  substantially, but the best fixture result still misses P99.9, and real
  wide-gamut highlights retain a separate representability problem.

**Recommendation:** retain mean <1 / P99.9 ≤3 for renderer agreement **before
encoding**. Ask Steve to adopt separate, per-format **own-source encoding
fidelity** checks, initially with the same perceptual target rather than
inventing higher limits from these failures. Keep decoded GPU-file versus
CPU-file comparisons as diagnostics, not a substitute for either check.
Changing the existing acceptance gate still needs Steve's approval.

## Measurement contract, recorded before the new runs

- Retain the October 18 perceptual contract: HDR ΔE ITP (BT.2124), SDR ΔE00,
  whole-image mean <1.0 and P99.9 ≤3.0, separately for each image and lane.
  Use the same numbers as a **research screen** for own-source fidelity;
  this is not an approved replacement or relaxation of any existing check.
- Compare initial codec output and ceiling-corrected delivery separately.
  Do not equate better GPU/CPU agreement with faithful encoding.
- Test exactly reproducible inputs/seed and report exact encoded byte counts;
  no speed target or timing benchmark is introduced.
- Use captured matched CPU/GPU finished arrays for the sharp fixture. New
  one-renderer sensitivity cases change one half-float HDR code, one signed
  SDR 8-bit code, or both. These are defined perturbations, not new renders.
- Four real photos are from the SHA-256-approved November 14 manifest:
  sunset `IMG_3129.CR2`, fire dancers `IMG_0790.CR2`, urban HDR
  `5M071612_finished.avif`, and power-out HDR
  `-4_stops_exposure_PQ_Rec_2020_DSC08883_03.avif`. Process at 1024px long
  edge, even dimensions, default creative controls and a 1000-nit Fixed cap.
  This reduced-output experiment is not native-resolution qualification or
  a claim to reproduce the photos' saved grades.
- Reuse the sibling worker's completed, shared-renderer captures for
  `5M071612_finished.avif` and `DSC08883.avif`: native-resolution 256×256
  sharp-highlight crops, 1000-nit Fixed cap, SDR exposure −0.15. They add a
  fifth distinct approved input without another Electron/GPU launch. Crop
  coordinates, hashes and capture recipes are retained in the evidence.
- Baseline reproduces the sharp check: base Q95/4:4:4, full RGB gain map,
  final map Q95, dithering off. Compare isolated non-default alternatives;
  never install them as production settings.
- Build a private instrumented CLI from the app's pinned libultrahdr commit
  `ad4a92eea0d2f39f18b5ecae3165fdd56c6a478b`. Dump the computed float
  log gains and the quantized map **before JPEG**, and expose display boost
  for partial-headroom decoding. Verify baseline encoded bytes against the
  shipping CLI and full-headroom decoded pixels against the shipping loader.
  The installed `imagecodecs` Ultra HDR decoder is 2.0.2, not the pinned 1.4.0;
  do not silently substitute it for this experiment.

## Policy discrepancy to leave with the coordinator

The current `AGENTS.md` says no encoded allowance, whereas Steve's corrected
November 16 export PRD, the sprint brief and shipping `ENCODING_ALLOWANCE`
retain his November 14 1% allowance. This research changes neither rule nor
gate. Delivery measurements explicitly use the existing shipping allowance;
the coordinator must reconcile the contradictory prose with Steve, not treat
this report as permission to alter it.

## Where the amplification happens

The codec stores an ordinary SDR JPEG and an RGB gain map. A gain describes
how much to multiply a base channel to recover HDR. When the SDR denominator
is small, a one-code change is a large *relative* change. The app floors some
SDR channels to code 2 to avoid black-block failures, but that does not make
the ratio insensitive. The gain is stored logarithmically, quantized to 8
bits, JPEG-compressed, decoded, smoothed and JPEG-compressed again before it
is multiplied by the **decoded**, not original, base.

### The actual metadata, not a guess

Initial matched fixture, before ceiling correction:

| Field | CPU file | GPU file |
| --- | ---: | ---: |
| Minimum content boost | 0.0950296 | 0.0946357 |
| Maximum content boost | 10.0843 | 10.0862 |
| HDR capacity maximum | 4.92566 | 4.92611 |

Both have gamma 1, offsets 1e-7, minimum capacity 1, and reconstruction in
**sRGB/BT.709**, despite the HDR intent arriving in BT.2020. The CLI's
`-k 0.0625 -K 16` are *bounds*, not a request for fixed endpoints. Its
best-quality two-pass encoder measures the content extrema, then clamps them
to those bounds. The two files thus use slightly different measuring rulers.
The adaptive span is about 6.73 stops: one map code is about 0.0264 stop, or
1.85% multiplicative gain. A small endpoint movement can move many otherwise
similar gains across a code boundary. Initial map codes differ in 1,866 of
30,720 channels; after the first Q100 map JPEG, 5,490 differ.

The tiny capacity difference is **not** the full-headroom cause: both decodes
use weight 1 at their own full headroom. Gamma/offset differences are also
ruled out. Identical inputs produce identical complete JPEG bytes on repeat.

### Native decoder ablation: same fixture, same inputs

The private CLI can feed exact pre-JPEG base/map bytes into the *unchanged
native reconstruction*. Thus these are not estimates from a second decoder.
All HDR entries below are ΔE ITP mean/P99.9.

| Step retained | GPU file versus CPU file | CPU file versus its own finished source |
| --- | ---: | ---: |
| Finished floats, no codec | 0.031 / 0.113 | — |
| Quantized gain map, exact quantized base; no JPEG on either | 0.136 / 1.417 | 0.369 / 0.975 |
| Map JPEG Q100, exact quantized base | 0.423 / 4.032 | 0.727 / 3.158 |
| Both JPEGs, before final map processing | 0.645 / 5.957 | 1.387 / 10.484 |
| Shipping final map processing, initial encode | 0.911 / 7.882 | 2.962 / 27.596 |

These are this probe's newly measured **initial** encodes, not a transcription
of the earlier end-to-end sharp-check result (0.878/7.981). The original
failure remains unchanged; the delivered-versus-own-source measurements below
also include the separate ceiling-correction stage.

On its own, the Q95 base plus a raw quantized map gives own-source
**1.218/10.818**: base JPEG error is a major contributor, not just a map
problem. Recompressing the map to Q95 **without smoothing** gives
**1.730/18.252**; adding the shipping smoothing raises this to
**2.962/27.596**. This separates second JPEG loss from smoothing rather than
attributing the whole change to the filter. Percentiles are not additive.

Holding the already encoded base fixed while swapping the other file's final
map still gives **0.713/6.648**. Holding the map fixed while changing only the
base gives **0.327/4.985**. Both components matter.

Neither downsampling nor base chroma subsampling causes this particular
failure: its map is already full resolution and its base is 4:4:4. Deliberately
using half-resolution maps worsens own-source P99.9 to **63.741**; 4:2:0 base
chroma worsens it to **52.103**. Those are not repair options for this edge.

### A separate real-photo limitation: gamut and zero channels

The pinned XMP-compatible encoder generates the map in base sRGB space and
clips negative converted HDR components before computing gains. A positive
SDR base times a positive gain cannot reconstruct a negative sRGB component
needed to represent some BT.2020 highlight colours. The bounded minimum gain
also cannot drive a nonzero base all the way to zero.

This is measured, not inferred solely from code. Converting the finished HDR
through the encoder's nonnegative sRGB representation alone gives P99.9
**9.133 sunset, 33.850 fire, 12.262 urban and 27.222 power-out**. In the fire
photo, **11.58%** of pixels have a negative sRGB component before that clip;
**3.85%** of gain channels fall below the allowed minimum. Once the source is
projected into that same nonnegative gamut, the floating gain reconstruction
agrees with it at mean **0.135–0.216**, P99.9 **0.412–0.428** across the four
photos. Therefore quality 100 cannot restore those original highlight colours.
This is a limitation of this encoder/configuration, not a claim that the
Ultra HDR format universally requires clipping all HDR to sRGB.

## Same renderer, tiny perturbation

Seed 20261116; start with the CPU's prepared inputs. Sparse SDR noise changes
one code up or down in **about 2%** of channels, including zeros in the random
draw; HDR stays exactly unchanged. This has essentially the same input SDR
error scale as the real GPU/CPU quantization difference (0.040/1.022).

| Controlled change | Input HDR mean/P99.9 | Input SDR mean/P99.9 | Decoded HDR mean/P99.9 |
| --- | ---: | ---: | ---: |
| One adjacent half-float HDR code, SDR identical | 0.055 / 0.107 | 0 / 0 | 0.362 / 5.798 |
| Sparse ±1 SDR code, HDR identical | 0 / 0 | 0.037 / 1.034 | 1.278 / 8.615 |
| Both together | 0.055 / 0.107 | 0.037 / 1.034 | 1.283 / 8.380 |

These are direct codec perturbations, not extra GPU renders, and are initial
encodes without ceiling correction. They establish codec sensitivity, not a
new permitted renderer error. Perturbing every SDR channel is a less realistic
stress control and reaches HDR P99.9 17.506; it is not the central evidence.

## Own-source fidelity of actual delivered files

These use the shipping writer **including** existing local ceiling repair,
and compare with the original finished image, not a newly lowered source that
would conceal correction loss. All values are mean/P99.9; SDR is ΔE00.
No file was refused. Decoded peaks are 751.297–993.150 nits on the four
reduced photos; fixture CPU/GPU peaks are 979.405/961.165 nits. Passing a peak
check does not establish colour fidelity.

| Image / renderer | HDR ΔE ITP | SDR ΔE00 |
| --- | ---: | ---: |
| Sharp fixture CPU | 4.004 / 29.187 | 0.601 / 7.300 |
| Sharp fixture GPU | 4.035 / 29.415 | 0.611 / 7.313 |
| Sunset, CPU, 1024×682 | 4.830 / 36.750 | 1.619 / 8.315 |
| Fire dancers, CPU, 1024×680 | 16.278 / 59.012 | 2.466 / 10.837 |
| Urban HDR, CPU, 764×1024 | 3.926 / 62.427 | 0.979 / 6.146 |
| Power-out PQ, CPU, 1024×682 | 5.113 / 52.877 | 1.393 / 8.173 |

The shared native-resolution crop captures give independent renderer checks:

| Crop / renderer | Delivered versus own HDR | Delivered versus own SDR |
| --- | ---: | ---: |
| DSC08883 CPU | 12.530 / 67.818 | 1.468 / 7.891 |
| DSC08883 GPU | 12.611 / 68.803 | 1.488 / 8.066 |
| Urban CPU | 3.252 / 16.129 | 0.693 / 3.471 |
| Urban GPU | 3.245 / 16.279 | 0.691 / 3.472 |

Before encoding, both crops pass both lanes. Urban is HDR 0.016/0.055,
SDR 0.007/0.056; its delivered HDR pair becomes 0.636/9.178. DSC08883 is
HDR 0.018/0.154, SDR 0.280/2.508; its delivered HDR pair becomes
5.073/50.943. The latter's SDR discrepancy is larger already, although inside
the agreed limit: do not describe every bit of its final difference as coming
from the codec alone. Native crops preserve sharp edges but are not full-photo
native-resolution qualification.

## What a viewer receives, including partial headroom

The private CLI uses the **pinned 1.4.0 native decoder**, not the installed
2.0.2 Python decoder. At full headroom its output matches the shipping loader
with ΔE **0/0**. Partial headroom is set through the library's display-boost
API to `sqrt(hdrCapacityMax)`: halfway in log headroom, approximately 2× SDR
white here. Zero headroom is the decoded SDR base measured above.

For comparison, the partial reference geometrically interpolates the authored
SDR and nonnegative base-gamut HDR endpoints, with the file's offsets. This is
an explicit **endpoint-model reference**, not another rendered photo, an
approved partial-headroom acceptance gate, or a model of OS tone mapping.
Full-headroom fidelity still compares against the original unprojected HDR.

Final delivered files at half-log headroom, against that endpoint model:

| Input | Display boost | HDR mean/P99.9 |
| --- | ---: | ---: |
| Fixture CPU | sqrt(capacity) | 2.544 / 17.298 |
| Fixture GPU | sqrt(capacity) | 2.564 / 17.485 |
| Sunset | 1.939 | 4.260 / 25.162 |
| Fire dancers | 1.851 | 13.352 / 46.602 |
| Urban HDR | 1.868 | 3.230 / 59.292 |
| Power-out PQ | 2.068 | 4.446 / 46.374 |

Partial display therefore does not make the problem vanish. Exact fixture
boosts and endpoint metadata are in the JSON evidence.

There is an important endpoint trade-off independent of JPEG: on the fixture,
merely substituting the prepared/floored 8-bit SDR endpoint changes the ideal
half-headroom image by **0.481/16.332**. With JPEG disabled on both base and
map, native partial decode is **0.560/16.307** from the authored-endpoint model
but **0.181/0.489** from the prepared-endpoint model. Thus the persistent
partial tail is substantially an SDR endpoint/floor effect, not proof of a
broken viewer or something a higher JPEG quality can remove.

**Visibility:** these are not only different compressed bytes. They are
differences in the pixels a compliant decoder supplies. Magnified crops show
changes in highlight-edge colour, texture and blockiness, particularly fire
and fine reflections. It would be wrong to promise invisibility with tails
this far outside the agreed screen. However, no physical HDR display, macOS
viewer, browser presentation, viewing-distance study or human sign-off was
tested here. The review PNGs are explicitly tone-mapped SDR simulations,
not HDR screenshots. Steve's viewing judgement remains necessary.

## Encoder-side options and their costs — none shipped

Initial fixture encodes; all use the same source. Byte counts include the
whole file. A lower error is not a pass unless **both** limits and lanes pass.

| Experimental option | Bytes | Own HDR mean/P99.9 | Interpretation |
| --- | ---: | ---: | --- |
| Current Q95 / full / guided map | 9,924 | 2.962 / 27.596 | Reference, fails |
| Fixed −4…+4-stop map endpoints | 9,727 | 2.961 / 27.673 | No useful improvement; pair still 0.789/8.274 |
| Half-size map | 8,618 | 6.590 / 63.741 | Saves bytes, damages edge fidelity |
| Q100 base and final map, smoothing retained | 15,749 | 2.584 / 21.470 | 59% larger; not a fix |
| No smoothing; retain final Q95 map recompression | 10,135 | 1.730 / 18.252 | Only 2% larger, but still poor tails |
| Gentler guide: radius 1, epsilon 1e-5 | 10,034 | 1.789 / 19.251 | 1% larger; substantial but insufficient improvement |
| Omit final map processing, retain first Q100 map | 11,718 | 1.387 / 10.484 | 18% larger; still base-JPEG mismatch |
| Q100 base, omit final map processing | 14,776 | 0.992 / 4.126 | Mean passes, percentile does not |
| Fit map to decoded Q95 base; retain guided filter | 9,941 | 2.782 / 28.573 | Cheap in bytes, not sufficient alone |
| Fit map to decoded Q95 base; omit final processing | 12,131 | 0.713 / 3.397 | 22% larger; close HDR result, SDR still 0.601/7.300 |
| Fit decoded Q100 base; omit final processing | 15,626 | 0.742 / 3.303 | 57% larger; SDR 0.408/2.873, HDR still fails |

The final combination on real photos remains outside the HDR screen:

| Photo | HDR mean/P99.9 | SDR mean/P99.9 | Bytes versus initial baseline |
| --- | ---: | ---: | ---: |
| Sunset | 1.455 / 9.827 | 0.752 / 3.480 | 1,630,942 versus 313,967 (5.19×) |
| Fire dancers | 2.548 / 33.947 | 0.523 / 2.403 | 3,284,681 versus 1,034,494 (3.18×) |
| Urban HDR | 1.468 / 21.596 | 0.637 / 3.012 | 1,835,558 versus 533,761 (3.44×) |
| Power-out PQ | 1.417 / 27.508 | 0.517 / 2.664 | 2,132,493 versus 665,300 (3.21×) |

These option numbers isolate the **initial** codec; they do not qualify the
options after ceiling repair or prove frame, mat, noise, packaging and viewer
compatibility. No speed measurements were taken. Decoded-base fitting adds
a base decode; omitting the filter removes processing, but their end-to-end
time savings/costs are unmeasured.

Most promising next experiment: compensate against the actual decoded base
and avoid smoothing genuine gain edges, while addressing base-gamut clipping
and the partial-headroom floor trade-off. Reconstructing in a wider gamut
would require a separate pinned-encoder/metadata/viewer compatibility study;
it is not a proven cheap switch or a shipping recommendation. A common
renderer could make pair error zero but would leave every own-source failure
above untouched. That is not an image-quality repair.

## Limits to record, for Steve to approve

1. **Rendering agreement:** keep HDR ΔE ITP and SDR ΔE00, mean **<1.0**,
   P99.9 **≤3.0**, per image and lane, on the finished float pixels before
   quantization/encoding. Include locals, grain, resize, sharpening and the
   final limiter. CPU is a fallback implementation, not an exact oracle.
2. **Encoding fidelity:** compare each delivered file with **its own original
   finished float source**, using the same metrics and initially the same
   **<1.0 / ≤3.0** fidelity target. Measure HDR and the embedded SDR separately
   for Ultra HDR; record format, quality, chroma, map scale and reconstruction
   gamut. Count input quantization, base flooring, gamut loss and ceiling
   correction rather than changing the reference to hide them. The present
   JPEG route is **not qualified** to that target. These results cannot justify
   raising it to 30 or 60 simply because those are today's errors.
3. **Partial headroom:** always report/inspect SDR, half-log and full-headroom
   renditions. Keep the endpoint model explicitly stated. Do **not** silently
   make the new partial-model numbers an acceptance gate: Steve must first
   choose the intended transition and accept or reject the floor compromise.
4. **Decoded GPU-file versus CPU-file:** retain as a diagnostic and regression
   signal, but recommend removing it as the *primary renderer correctness*
   gate once Steve approves the split. It can fail on a one-renderer one-code
   control, and it can pass when both encodes are equally wrong. Until that
   decision, leave the existing gate and its failures unchanged.
5. **Separate guarantees stay separate:** full-size Proof/export identity,
   finite pixels, correct dimensions/colour metadata and the authored HDR
   ceiling are not replaced by average/percentile colour checks. There is no
   per-pixel colour maximum. Resolve the contradictory ceiling prose above
   with Steve; do not use this report to waive or change the delivery rule.

For AVIF and JPEG XL, merge the sibling report before recording any
format-specific capability or recommended policy. Do not copy JPEG's measured
errors into those formats' limits.

**One decision to put to Steve:** approve separating renderer agreement from
per-format encoding fidelity, using the existing 1/3 perceptual target for
each, rather than relaxing the decoded pair threshold. Trade-off: it identifies
the right failure, but also makes explicit that current JPEG settings need
quality work rather than declaring this issue solved.

## Evidence, reproduction and validation

Tool: `codebase/tools/jpeg_encoding_drift_probe.py`. Evidence retained under
`codebase/output/review/jpeg-encoding-drift/`: `fixture.json`, `photos.json`,
`paired-photos.json`, `fixture-crop.png`, the four named `*-crop.png` files,
four SDR photo overviews, probe/build logs and fast-suite logs. The crop is
selected by the largest source luminance edge, **not** by largest encoding
error. No source photos or full-size delivered/decoded copies are retained
per run. The existing matched fixture and sibling captures are reused in place.
`codec-stage-comparison.html` is a small summary of the measured native stage
P99.9 values and the separate single-renderer control.

From `codebase`, download the upstream tarball for the pinned commit into a
task-owned scratch directory, then:

```sh
.venv/bin/python tools/jpeg_encoding_drift_probe.py --instrument "$SOURCE"
.venv/bin/cmake -S "$SOURCE" -B "$BUILD" -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF -DUHDR_BUILD_DEPS=ON -DUHDR_BUILD_EXAMPLES=ON \
  -DUHDR_BUILD_TESTS=OFF -DUHDR_WRITE_XMP=ON -DUHDR_WRITE_ISO=ON
.venv/bin/cmake --build "$BUILD" --parallel 2
.venv/bin/python tools/jpeg_encoding_drift_probe.py --binary "$BUILD/ultrahdr_app"
.venv/bin/python tools/jpeg_encoding_drift_probe.py --binary "$BUILD/ultrahdr_app" \
  --photos-root "$PHOTOS_ROOT/HDR Test Images"
.venv/bin/python tools/jpeg_encoding_drift_probe.py --binary "$BUILD/ultrahdr_app" \
  --paired-root output/review/encoding-drift-avif-jxl
```

Use the platform's `.venv` Python/CMake/executable suffix on Windows. Never
overwrite `bin/ultrahdr_app`. Instrumentation is for the script's RGB/full-map
stage ablations, not a generally supported alternate encoder. Its input source
matching is exact and refuses an unexpected upstream tree. Instrument a fresh
source extraction, not one already modified. The paired command needs the
sibling's already captured arrays; it does not launch Electron.

Primary implementation evidence: pinned upstream `lib/src/jpegr.cpp`,
`generateGainMapTwoPass`, `compressGainMap`, `applyGainMap`; and
`lib/src/gainmapmath.cpp`, `computeGain`, `affineMapGain`, `applyGain`.
The app-side path is `exporters.py`'s `_write_jpeg_gainmap_once`,
`_ultrahdr_content_boost_bounds` and `_denoised_ultrahdr_gain_map_jpeg`.
The auxiliary Python reconstruction has measurable decoder rounding differences
and is retained only as a diagnostic; the native stage table above is the
causal evidence. No changes to those production functions were made.

Validation: baseline instrumented encode equals shipping **complete bytes**;
repeat bytes are identical; instrumented full-headroom decode equals the
shipping loader; native ablations, one-code controls, approved-photo hashes,
final ceiling-checked deliveries and partial headroom are measured.

- Python compilation of the research tool passes; focused whitespace checks
  pass.
- Fast Node suite: **1,090 passed, one failed, one skipped**. The unrelated
  `tooltip-catalogue.test.js` catalogue/source consistency failure occurred
  during concurrent frontend edits; no catalogue was regenerated.
- Fast Python suite: **3,833 passed, one failed, 144 skipped, one xpassed**.
  The unrelated direct-entry source-text contract in
  `test_frontend_controls_contract.py` still expects the old Peak minimum,
  while the concurrent safe-floor work changes it. It was not modified or
  rerun for this report.
- No GPU/Library smoke or release check was launched. Existing GPU captures
  were reused, so there was no Electron overlap and Steve's app was not
  touched. These tools/docs do not qualify shipping export or Proof changes.
- Output disk usage: **13.0 GB at start, 13.1 GB at finish**, below the
  100 GB limit. This report's retained evidence is **5.9 MB**. Task-owned
  temporary upstream source/build files were removed; no personal source,
  full exported photo or full decoded copy was retained by these runs.
