# Renderer checks and encoding fidelity options — November 16, 2026

## Outcome for Steve

The delivery tests now judge the **renderers before compression**, then report
what compression does to each renderer's own finished picture. The agreed
numbers have not moved: HDR ΔE ITP / SDR ΔE00, mean below 1 and P99.9 at most
3, separately for every image and lane. Decoded GPU/CPU files are diagnostic
only. Exact finished HDR ceilings, the 1% encoded allowance, Proof/export byte
identity, geometry and coverage still fail their tests when wrong.

The two reported regressions pass under that split. Local HSL's finished HDR
agreement is **0.0358 / 0.1793**, rather than its codec-amplified file
difference. Framed delivery passes for all six formats. The source-import
driver uses the intended shared image picker; Confirm enables, and all four
batch-export cases pass. The old disabled-Confirm failure does not reproduce
on this Mac.

JPEG XL's unexpectedly large HDR error is overwhelmingly **lossy compression**,
not a reference-white/PQ mismatch or its 12-bit input quantization. Lossless
12-bit JXL brings the three highlight crops under **0.10 / 0.19**, but makes
their HDR files **3.45–3.73 times larger**. JPEG/AVIF gain fitting and less
smoothing improve fidelity, but are not complete fixes. AVIF already computes
these gain maps in the wider BT.2020 alternate space; switching it to the
sRGB base is generally worse, not a new solution.

**No shipping encoder, renderer, codec default or application setting changes.**
All encoding alternatives live in the opt-in research tool. They are measured
options, not approved delivery-quality settings.

## What was built

- `tests/helpers/delivery_capture/` is a test-only Python startup hook enabled
  by the unpackaged Electron runner for named delivery drivers. It records
  the actual export inputs after local/global finishing, framing, watermark
  and the exact limiter; it does not re-render a similar recipe.
- `delivery_comparison.py` binds captures to output paths and SHA-256 digests,
  rejects missing/stale captures, checks exact finished HDR peaks, and compares
  finished GPU/CPU lanes with the unchanged limits. Copied Proof artifacts can
  resolve by digest. Decoded HDR is converted from decoder white 203 into the
  project's white before comparison.
- Separate report-only fields describe each file versus its own original
  finished input, including any subsequent ceiling correction, and decoded
  GPU/CPU file pairs. Readable driver summaries say **PASS/FAIL**, **REPORT
  ONLY**, or **DIAGNOSTIC ONLY**; the full JSON retains every number.
- Shared fixture/framing/repeat helpers, HSL global/local, HSL integration,
  Local Match headroom, colour desaturation, Tone Zones, Hue Mask and GPU
  delivery smoke/repeat now use this split. HSL's additional relative
  +0.15-mean/+0.5-P99 guard also stays, applied to finished pixels.
- `performance/export-parity.js` already reported presentation/decoded-file
  differences diagnostically; it now additionally reports own-source codec
  fidelity. Its file metadata, ceiling and coverage assertions remain strict.
  It is not mislabelled as a pre-encode GPU/CPU qualification.
- The source-picker driver retains destination, filename, four-format and
  JPEG 4:2:2 coverage, while deleting its temporary input/exports on success
  or failure. Native temporary paths are canonicalized on macOS.
- `tools/encoding-fidelity-fixes.py` provides opt-in stage ablations, decoded
  base fitting, map filtering/range/colour-space alternatives, JXL quality
  alternatives and a higher-precision AVIF **measurement** control. Private
  source patches fail on an unexpected upstream source. No bundled binary is
  overwritten, and JPEG monkeypatches are restored even after an exception.

The capture hook is deliberately **unpackaged-test-only**. This work does not
qualify the packaged runners or add production debug instrumentation.

## Validation

MacBook Neo, A18 Pro, 8 GB, 1408×794. Every Electron run used
`tools/gpu-run-lock.py`; no GPU runs overlapped. Existing protected projects
were never saved. There was no release sweep, installer build or push.

| Check | Result and scope |
| --- | --- |
| Node fast suite | 1,091 passed, one skipped, zero failures |
| Python fast suite | 3,850 passed, 144 skipped, one unexpected pass; existing Starlette deprecation warning |
| Focused capture/options tests | Eight pass: report-only codec failures, finished renderer failure despite identical decodes, stale capture, exact ceiling, unchanged limits, CLI path normalization, restoration after exceptions, quantization/input immutability and pinned-source refusal |
| `gpu-delivery-smoke.js` | Pass, including Denoise and strict finished P99.9; final HDR 0.0335/0.0765, SDR 0.0193/0.0588; decoded HDR pair 0.5296/3.3773 is correctly diagnostic |
| `photo-framing-delivery.js` | Pass: JPEG Ultra HDR, AVIF gain map, HDR JXL, SDR JPEG/PNG/JXL, framing geometry/mats, Library picture, Proof identity and decoded ceilings |
| `hsl-selection-delivery.js --local` | Pass: absolute and original relative finished guards; HDR 0.0358/0.1793, SDR 0.0153/0.0648 |
| `hsl-selection-delivery.js` | Pass: global HDR 0.0267/0.1022, SDR 0.0136/0.0522; ceiling and Proof bytes remain strict |
| HSL integration; Local Match `--headroom`; colour-desaturation; Tone Zones; Hue Mask | All pass through the shared finished-input comparison |
| `gpu-delivery-repeat.js --cpu` | Final pass: repeated GPU jobs and forced CPU, actual finished inputs even for byte-identical files; decoded ceilings checked independently |
| `performance/export-parity.js` | All six default JPEG scenarios pass; AVIF `--only highlights` passes |
| `export-file-browser-interaction.js` | Final pass through shared picker and four export cases; older disabled-Confirm issue not reproduced |
| Default 90-second plain-Electron Library check | Pass, nine of nine visited pictures, no errors; 24 unvisited eligible photos are not full-folder qualification |

Failures fixed during implementation: the temporary-path cleanup change
initially compared `/var/...` with the native picker's `/private/var/...`, and
the repeat comparator passed a string to a Path-only decoder. Both are fixed;
final runs pass, and the latter has a regression test. Neither changed app
behaviour or a numerical assertion.

One **unsupported optional invocation**, not a passing check:
`performance/export-parity.js --format jpegxl_hdr` immediately reports
`No declared settings for format jpegxl_hdr`. Its Electron process remained
open and was stopped; this driver's unsupported-format handling was not
expanded. JXL is qualified by the six-format framing driver instead. No claim
of Windows/Linux, packaged-app, physical HDR display or external-viewer
acceptance follows from these Mac checks.

## Reproducible research inputs and measurement

Reuse the previous reports' finished CPU arrays: 128×80 sharp fixture and the
same native-resolution 256×256 crops from DSC08883, Urban
(`5M071612_finished`) and LR (`LR-classic-hdr-source-test-1`). Crop origins,
source hashes and recipes remain in
`encoding-drift-avif-jxl-2026-11-16.md` and its capture evidence. Finished crop
peaks here are 779.012, 685.980 and 782.354 nits, respectively; the 1000-nit
cap is a ceiling, not a rescaling to 1000 nits. These are not full native-frame
tests. The fixture's finished peak is exactly 1000 nits.

Also repeat the JPEG report's four SHA-256-approved reduced whole photos:
sunset IMG_3129.CR2, fire dancers IMG_0790.CR2, urban
5M071612_finished.avif and power-out
-4_stops_exposure_PQ_Rec_2020_DSC08883_03.avif. They use the same 1024px long
edge, even dimensions, default creative settings and 1000-nit Fixed cap, not
their saved grades. Original photos are read in place and never copied per run.

Every HDR pair below is **mean / P99.9 ΔE ITP**, SDR is **ΔE00**. The 1/3
target is a screen for fidelity, **not a new delivery gate**. No peak
normalization or error-based pixel exclusion is added. The existing ITP
conversion clips negative BT.2020 components; it therefore cannot assess loss
of signed out-of-BT.2020 colour. In the DSC crop 1.559% of pixels have a
negative BT.2020 channel, and their projection into the metric's own domain
has effectively zero additional metric error. That does **not** prove signed
gamut loss is invisible. The metric and tolerances are unchanged.

JPEG research uses Q95, 4:4:4 base, full-resolution RGB map, map Q95 and no
dither. AVIF baseline uses its existing Q95, 10-bit 4:2:0 base and half-size
4:4:4 map. JXL baseline is 12-bit PQ, distance 0.2. Equal quality numbers
across codecs are not equal settings. All delivered numbers use the existing
1000-nit correction with `ENCODING_ALLOWANCE == 0.01`.
This Mac uses imagecodecs 2026.11.11 / libjxl 0.13.0; the private AVIF build
uses the app's libavif v1.4.1 source and preserves baseline byte identity.

## Where the loss occurs

### JPEG XL: compression dominates

DSC crop, with every stage measured against the same original finished image:

| Stage | HDR mean / P99.9 |
| --- | ---: |
| Projection into nonnegative BT.2020 (existing metric domain) | ~0 / 0.000004 |
| PQ float round trip | 0.0011 / 0.0056 |
| 12-bit PQ integer quantization, no compressor | 0.0808 / 0.1867 |
| Q95/distance 0.2 delivered | 7.5648 / 55.1817 |
| Q99 delivered | 3.8273 / 38.4127 |
| Lossless 12-bit delivered | 0.0808 / 0.1867 |

Lossless agrees with the quantized expected image, so the large Q95 gap is
not explained by ACEScg/BT.2020, PQ units or headroom interpretation. There is
no gain-map computation, smoothing or downsampling in direct JXL. Raising Q99
still misses this crop badly. A requested distance 0.01 produced the same
bytes/measurements as Q99 with this imagecodecs/libjxl build; do not market it
as an independently effective near-lossless mode. Disabling perceptual
heuristics was substantially worse (DSC 100.80/304.79), and is rejected.

### JPEG Ultra HDR: base/map coupling, gamut and two map JPEG passes

HDR half-float intent preparation is small on these inputs (mean
0.0158–0.0218, tail 0.0516–0.0734). SDR 8-bit quantization is
0.196–0.288 mean; the existing protective base floor raises DSC's SDR mean
from 0.196 to 0.392, before JPEG. It is not being removed.

The earlier private native decoder ablation isolates the fixture's stages:
quantized map and quantized base without either JPEG are 0.369/0.975; map
JPEG Q100 alone is 0.727/3.158; both JPEGs before final processing are
1.387/10.484; final shipping map processing gives 2.962/27.596, before ceiling
correction. Recompressing the map without smoothing gives 1.730/18.252,
separating second-JPEG loss from smoothing. Percentiles are not additive.

The encoder fits gains against its original uncompressed SDR intent, while
delivery contains the compressed base. Fitting against the decoded base and
retaining the first compressed map avoids that mismatch **and** the second
JPEG/filter pass. An ablation retaining smoothing does not solve the fixture
(delivered 4.653/29.762). Simply bypassing final processing without refitting
gives 2.026/10.206. The combination gives 1.388/6.196.

Its pinned XMP-compatible path also computes gains in base sRGB, which cannot
recover negative sRGB components with a nonnegative multiplicative base.
DSC's saturated highlights remain poor even at Q100. This is a limitation of
this encoder path, not a claim that every Ultra HDR representation must clip
to sRGB. See the sibling JPEG report's native stage and gamut controls.

### AVIF: sampling/compression matter; wider gain space is already used

The actual HDR writer first quantizes PQ RGB, then limited-range BT.2020 YUV.
An ideal inverse of those written 4:4:4 samples gives DSC 0.623/1.531 at
10 bits, 0.156/0.384 at 12 bits, before gain-map reconstruction/compression.
There is no JPEG-style guided smoothing pass. Half-map spatial downsampling,
base chroma subsampling, AV1 compression, and gain-map/YUV quantization remain.

On DSC, default AVIF is 12.058/129.376. Full-resolution map alone gives
3.591/38.860; changing only the base to 4:4:4 gives 10.900/127.696. Full map
plus 4:4:4 gives 4.318/45.724; decoded-base fitting gives 3.297/37.648. Thus
map downsampling dominates this edge, and base fit helps; their percentile
effects are not additive or monotonic.

The pinned libavif 1.4.1 `avifChooseColorSpaceForGainMapMath` selects BT.2020
alternate primaries for this SDR709/HDR2020 pair: metadata already says
`use_base_color_space=False`. A private forced-sRGB control makes DSC
15.113/69.916 after correction, rather than fixing saturated highlights.

`avifFindMinMaxWithoutOutliers` uses 0.01-stop buckets and trims 0.05% from
each end, then clamps gains to that range. Using full extrema changed DSC's
fitted Q95 result to 3.420/37.503: mixed, not a general fix. Full-range plus
lossless 12-bit map/base is 0.633/4.086, versus 0.629/4.225 without those
changes. The remaining DSC tail is **not isolated to one exact operation**;
it survives that compression/range ablation and needs further gain/reconstruction
work before a fidelity gate is appropriate.

The measurement itself adds loss: the bundled reconstruction route deliberately
uses a 10-bit YUV boundary even for a 12-bit file. Keeping the exact same
lossless-12/full/444 DSC file and asking the private utility for 12-bit
reconstruction changes 0.629/4.225 to 0.268/4.332. The mean improves, but the
tail still misses; it is not the complete explanation. Results are not
monotonic for every image (Urban mean rises while its tail falls). This is a
**decoder diagnostic**, not improved encoded bytes or a shipping decoder
change. Any future reader change also needs ceiling and viewer qualification.

### Ceiling correction is a separate, visible contribution

For the fixture, baseline JPEG initially peaks at 1052.365 nits and measures
2.962/27.596; correction delivers 979.405 nits at 4.004/29.187. Fitted,
unfiltered Q95 initially measures 0.713/3.397 at 1027.780 nits; its lawful
delivery is 1.388/6.196 at 989.714 nits. The safety policy is unchanged: these
initial encodes cannot be delivered just because they look better numerically.
The report's option tables use **delivered**, not cherry-picked initial, results.

## Crop and fixture trade-offs

Sizes below are exact bytes, including container/metadata. Gain-map files
include their SDR base. Direct HDR JXL sizes exclude its separate SDR file.

### JPEG Ultra HDR — decoded-base fit with no final map processing

| Input | Baseline bytes; HDR; SDR | Fit Q95 bytes; HDR | Fit Q100 bytes; HDR; SDR |
| --- | --- | --- | --- |
| Fixture | 9,928; 4.004/29.187; 0.601/7.300 | 12,191; 1.388/6.196 | 15,617; 1.394/5.166; 0.408/2.873 |
| DSC | 124,069; 12.530/67.818; 1.468/7.891 | 252,442; 5.606/66.897 | 318,184; 4.600/32.008; 0.622/2.616 |
| Urban | 29,001; 3.252/16.129; 0.693/3.471 | 95,550; 1.350/4.320 | 135,267; 1.305/3.957; 0.659/3.180 |
| LR | 37,984; 3.822/23.816; 0.964/4.649 | 109,908; 1.427/10.804 | 145,791; 1.332/5.429; 0.696/3.184 |

Q95 refitting does not change the delivered SDR base. The option costs up to
3.29× on these crops and still misses HDR everywhere. Q100 is larger again;
its fixture and DSC SDR bases pass, but not every SDR tail. No universal
quality claim follows.

### AVIF gain map — full-resolution map, 4:4:4 base

| Input | Baseline bytes; HDR; SDR | Fitted Q95 bytes; HDR; SDR | Lossless 12-bit bytes; HDR; SDR |
| --- | --- | --- | --- |
| Fixture | 3,387; 5.112/67.492; 0.759/17.896 | 4,791; 1.219/7.091; 0.185/2.238 | 18,323; 0.289/1.548; 0.029/0.109 |
| DSC | 65,643; 12.058/129.376; 1.551/13.760 | 131,650; 3.297/37.648; 0.714/4.256 | 489,333; 0.629/4.225; 0.024/0.087 |
| Urban | 24,566; 2.343/31.347; 0.386/3.617 | 53,968; 1.077/4.568; 0.354/2.407 | 266,788; 0.068/1.745; 0.033/0.115 |
| LR | 42,829; 2.413/19.425; 0.589/5.917 | 84,482; 1.144/5.371; 0.487/2.516 | 337,473; 0.078/1.676; 0.033/0.110 |

The Q95 fit/full/444 option is roughly 1.41–2.20× baseline size; lossless
12-bit/full/444 is 5.41–10.86× and still misses DSC's HDR tail. These are not
recommended new defaults. Private baseline encodes match the shipping utility
byte-for-byte for every measured input, before any private flag is enabled.

### JPEG XL — no gain map

| Input | Q95 HDR bytes; HDR | Q99 HDR bytes; HDR | Lossless12 HDR bytes; HDR |
| --- | --- | --- | --- |
| Fixture | 4,111; 0.271/4.158 | 5,807; 0.111/2.165 | 4,814; 0.058/0.188 |
| DSC | 55,657; 7.565/55.182 | 93,959; 3.827/38.413 | 193,168; 0.081/0.187 |
| Urban | 24,055; 1.265/6.414 | 45,421; 0.705/3.151 | 89,646; 0.090/0.178 |
| LR | 39,286; 1.547/10.798 | 68,204; 0.866/6.292 | 135,364; 0.087/0.185 |

| Input | Separate SDR Q95 bytes; SDR | Separate lossless8 SDR bytes; SDR |
| --- | --- | --- |
| Fixture | 3,326; 0.372/2.139 | 3,425; 0.201/0.864 |
| DSC | 50,670; 1.180/7.110 | 93,306; 0.196/0.708 |
| Urban | 21,051; 0.541/3.250 | 39,658; 0.288/0.940 |
| LR | 36,720; 0.673/3.918 | 69,981; 0.280/0.885 |

Lossless means lossless compression of the quantized representation, not
lossless preservation of the original floating finished image. Every tested
lossless HDR/SDR JXL meets the visual screen. External-viewer compatibility and
native-full-frame size/speed remain unqualified.

## The same four reduced whole photos

These repeat the sibling JPEG report's whole-photo recipe, not the highlight
crop recipe. Sizes are bytes; entries retain HDR and SDR separately. All four
private AVIF baseline files again match the shipping binary byte-for-byte.
They broaden the research sample, not the renderer qualification.

| Photo | JPEG baseline bytes; HDR; SDR | Fitted/unfiltered Q100 bytes; HDR; SDR |
| --- | --- | --- |
| Sunset | 316,057; 4.830/36.750; 1.619/8.315 | 1,630,942; 1.455/9.827; 0.752/3.480 |
| Fire dancers | 1,037,799; 16.278/59.012; 2.466/10.837 | 3,284,681; 2.548/33.947; 0.523/2.403 |
| Urban | 533,761; 3.926/62.427; 0.979/6.146 | 1,835,558; 1.468/21.596; 0.637/3.012 |
| Power-out | 665,300; 5.113/52.877; 1.393/8.173 | 2,132,493; 1.417/27.508; 0.517/2.664 |

| Photo | AVIF baseline bytes; HDR; SDR | Fitted Q95/full/444 bytes; HDR | Lossless12/full/444 bytes; HDR; SDR |
| --- | --- | --- | --- |
| Sunset | 308,016; 4.742/81.038; 1.581/17.044 | 811,199; 1.975/10.270 | 3,338,135; 0.697/1.856; 0.035/0.113 |
| Fire dancers | 594,243; 19.994/82.887; 3.527/18.432 | 1,531,271; 2.854/14.123 | 5,382,313; 0.704/1.918; 0.024/0.085 |
| Urban | 392,943; 3.214/110.509; 0.784/10.133 | 734,583; 1.524/33.296 | 3,486,776; 0.607/4.618; 0.032/0.114 |
| Power-out | 598,274; 5.401/130.775; 1.615/12.894 | 1,140,180; 1.792/21.757 | 4,307,997; 0.586/1.586; 0.025/0.096 |

The fitted Q95 SDR bases measure Sunset 1.102/4.745, Fire 0.989/4.162,
Urban 0.503/3.534 and Power-out 0.723/4.088: each still misses the tail target.
AVIF lossless12 passes three whole-photo HDR cases but **not Urban's tail**.
No JPEG option tested meets the HDR target on these whole photos.

| Photo | JXL Q95 HDR bytes; HDR | Lossless12 HDR bytes; HDR | Q95 SDR bytes; SDR | Lossless8 SDR bytes; SDR |
| --- | --- | --- | --- | --- |
| Sunset | 447,899; 2.371/18.517 | 1,630,782; 0.090/0.207 | 384,394; 1.094/5.266 | 799,821; 0.294/0.902 |
| Fire dancers | 707,348; 9.400/43.471 | 2,289,234; 0.092/0.215 | 580,718; 2.014/8.629 | 1,242,968; 0.193/0.683 |
| Urban | 450,366; 1.602/40.467 | 1,470,405; 0.088/0.199 | 415,153; 0.703/4.482 | 681,744; 0.264/0.921 |
| Power-out | 573,788; 3.538/37.906 | 1,801,525; 0.085/0.185 | 538,547; 1.168/6.454 | 1,039,977; 0.208/0.776 |

JXL's lossless alternatives pass both lanes on all four reduced whole photos.
HDR costs 3.14–3.64× its Q95 HDR file; SDR costs 1.64–2.14× its separate Q95
SDR file. This reinforces the crop result, without predicting native-size files.

## Decisions and limits

The first decision for Steve is whether to develop an **explicit high-fidelity
JXL option**, preserving today's default. The measured HDR crops become about
3.5× larger but meet the target; the risk is larger native-photo files and
different viewer support, neither measured here. Q100/lossless already exists
at the encoder API, so no new encoder is required for that experiment.

JPEG/AVIF work remains experimental: base fitting helps, but it is not honest
to promise the 1/3 fidelity target yet. Before asking for a new default, close
JPEG's gamut/base coupling and AVIF's residual DSC tail, then check full-size
photos, SDR fallback appearance, byte identity, ceilings and real viewers.
Changing a decoder's precision is a separate proposal, not permission to
quietly alter fidelity measurements. No tolerance increase is proposed.

## Evidence and reproduction

Task-owned compact evidence is under
`codebase/output/review/encoding-fidelity-fixes/`: `drivers.txt`, final fast
suite logs, `helper-tests.log`, individual driver logs, `jpeg-jxl-options.json`,
`avif-options.json`, `preparation-stages.json`, `reduced-photos.json`, and
`protected-before.json` / `protected-after.json`. All three protected project
hashes are unchanged. Raw renders, per-variant encoded files and decoded
copies are temporary. Library evidence is
`codebase/output/quick-library-check/renderer-split/report.json`.

The private native build/archive, unsupported-run disposable profile, and this
run's large performance readbacks/encoded files/review PNGs were removed after
measurement; compact logs/JSON remain. Output scratch is **13.6 GB at start
and finish**, below 100 GB (`disk-final.txt`). Existing photo copies and sibling
research captures/review crops are retained, not deleted or duplicated.

From `codebase`, reuse the previous capture evidence:

```sh
PYTHONPATH=backend .venv/bin/python tools/encoding-fidelity-fixes.py \
  --formats jpeg jxl --output output/review/encoding-fidelity-fixes/jpeg-jxl-options.json
```

For private AVIF options, unpack libavif **v1.4.1** outside the checkout, run
`--instrument-avif <source>`, and build its `avifgainmaputil` with local AOM,
libyuv, libsharpyuv, JPEG and zlib/PNG (Release, shared libraries off, build
apps on, tests off, parallelism two). Then:

```sh
PYTHONPATH=backend .venv/bin/python tools/encoding-fidelity-fixes.py \
  --formats avif --avif-binary <private-build>/avifgainmaputil \
  --output output/review/encoding-fidelity-fixes/avif-options.json
PYTHONPATH=backend .venv/bin/python tools/encoding-fidelity-fixes.py \
  --only-reduced --photos-root <approved-HDR-Test-Images-folder> \
  --avif-binary <private-build>/avifgainmaputil \
  --output output/review/encoding-fidelity-fixes/reduced-photos.json
```

All Electron reproduction uses
`HDR_FINISHER_ELECTRON_WINDOW_SIZE=1408x794 .venv/bin/python tools/gpu-run-lock.py --label <label> -- node tests/run-in-electron.js tests/<driver>`.
The real-app quick Library check uses that same lock around
`node tools/quick-library-check.cjs --label=renderer-split`.
