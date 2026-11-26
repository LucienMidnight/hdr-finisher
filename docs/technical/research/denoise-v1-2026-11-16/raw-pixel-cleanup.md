# Pixel cleanup — sensor defects, research only

November 17, 2026; prototype `78f93157`. Steve chose **Pixel cleanup**.
No production integration, Denoise change, default change or module PRD edit.

**November 17 update:** Steve has ruled out camera-specific defect maps and
calibration captures for now. The map-based conclusion immediately below is
historical, not the current proposal. The later **Single-photo hot pixel
filter (November 17)** section records the requested map-free experiment.

## Plain-language conclusion

**Repairing a known broken sensor pixel before demosaicing works, and is
cheap. It has not solved the specks in Steve's Canon photograph.** The
supplied photographs do not include the separate dark/flat captures needed
to establish which sensor positions are actually defective. The safe
prototype therefore changes none of those photographs. All new real-photo
results match Off or current Denoise exactly; this is preservation, not a
quality win.

There are **1,011 suspicious Canon sensor samples**, mostly unusually low
readings, but **zero independently confirmed defects**. This does **not**
mean the camera has no defects, or that all 1,011 samples are ordinary random
noise. The genuine-defect/random-noise split remains unknown. The fixed lifted
flame crop contains one such suspect among hundreds of contrast islands;
these are not interchangeable counts. Claiming a defect-only fix for all the
specks would go beyond the evidence.

Recommendation: keep Pixel cleanup as a separate RAW-development concept,
allow authoritative defect maps to run automatically, but **do not enable
single-photo guessing by default**. Before shipping automatic discovery,
obtain matched Canon dark/flat captures or a trustworthy camera defect map.
No new GPU algorithm is justified by the measured cost of sparse repair.

## Prior art: names and responsibilities

Checked November 17, 2026 against vendor manuals and public implementation
sources. A manufacturer's Noise Reduction panel location does not establish
its internal processing order. None of these proprietary products was run
on Steve's files in this trial.

| Developer | Published name and behaviour | Stage and control | Implementation licence / reuse |
| --- | --- | --- | --- |
| darktable | **hot pixels**: abnormal bright samples compared with four surrounding sites, replaced with the highest support value; optional three-neighbour detection. | Linear RAW, before demosaic; enable module, threshold/strength and mark-fixed controls. Not a general dead-pixel classifier. | [Manual][dt-manual], [source][dt-code]: GPL-3.0-or-later. Compatible; no code copied. |
| RawTherapee | **Hot/Dead Pixel Filter**, neighbour-average repair; separate hot/dead selection and sensitivity threshold. Also dark frames and `.badpixels` maps. Manual explicitly warns that one photo cannot establish defects with certainty. | RAW Preprocessing, before demosaic; automatic detection when selected, user-controlled sensitivity/maps. | [RawPedia][rt-manual], [licence][rt-license]: GPL-3.0. Compatible; no code copied. |
| ART | **Hot/Dead Pixel Filter**; hot/dead toggles and threshold; source also loads camera bad-pixel maps and dark-frame hot pixels before interpolation. | RAW preprocessing; optional detection, then bad-site Bayer/X-Trans interpolation before demosaic. | [UI][art-ui], [engine][art-engine], [licence][art-license]: GPL-3.0-or-later. Compatible; no code copied. |
| Capture One | **Single Pixel** in Noise Reduction compares isolated pixels with their surroundings to suppress hot pixels; warns of affecting other detail and of reduced-resolution pipeline limitations. | User slider. Checked support page does not disclose the exact pre/post-demosaic stage, so do not claim one. | [Official support][c1]. Proprietary; descriptive research only. |
| Lightroom / Camera Raw | Checked Adobe help documents **Luminance/Color Noise Reduction**, Denoise/Raw Details, not a separate user hot/dead-pixel control. | No verified public defect-detection algorithm or exact stage in the checked documentation. Forum claims about automatic hot-pixel removal are not implementation evidence. | [Camera Raw help][adobe], [Lightroom Classic help][lightroom]. Proprietary; no implementation reuse. |
| DxO PhotoLab | Current PhotoLab 10 guide calls it **Dead pixels**, RAW-only, available in all denoising modes, adjustable default 24. Standard denoising is enabled through the default preset. | RAW processing; DeepPRIME combines denoise/demosaic, but exact defect-pass ordering is not published. Do not assume a separate universal pre-demosaic box. | [Current official guide][dxo] (updated November 9, 2026). Proprietary; no implementation reuse. |
| LibRaw / dcraw | **bad pixels / dead pixel list**, optional dark-frame subtraction; LibRaw has camera-dependent zero-value repair. dcraw `-P` selects a map instead of `.badpixels`, `-K` supplies a dark frame. | Mapped/zero repair before interpolation. A supplied map is not a general automatic detector. In our rawpy route the bad-pixel path is unset. | [LibRaw processing source][libraw-code], [licence][libraw-license]; choose LGPL-2.1, not the alternative CDDL route. [dcraw manual][dcraw-manual] and [author's code header, mirrored][dcraw-code] offer GPL-2.0-or-later redistribution; GPL-3 is available under that option. No dcraw code copied. |

**Naming is settled, not proposed:** Pixel cleanup is Steve's chosen umbrella
for sensor defects and possible future RAW corrections. No random-outlier
mode is included in this experiment.

## What is already done by our RAW development

`backend/hdr_finisher/raw_import.py:_develop_libraw_camera_rgb` requests
LibRaw AHD, unity white balance, raw camera RGB, linear 16-bit transport,
no auto scaling/brightness, and highlight Clip. It does not pass a bad-pixel
file, dark frame, FBDD setting, wavelet threshold or median passes. Installed
rawpy defaults are `bad_pixels_path=None`, FBDD Off, noise threshold disabled,
and zero median passes. `rawpy.enhance` is not called by this pipeline.

LibRaw's `dcraw_process` conditionally repairs zero samples for cameras marked
`zero_is_bad`, applies an explicitly supplied defect list/dark frame, then
interpolates. Camera-specific decoder corrections may already have occurred
while unpacking. Therefore these are **unpacked RAW samples**, not a promise
of untouched physical sensor output; neither “LibRaw fixes everything” nor
“LibRaw never fixes defects” is accurate. DNG mandatory-opcode handling is a
separate existing import policy, not replaced by this prototype.

`frontend/library-gpu-raw.js` normalises sensor samples, performs optional
Opposed color work, AHD and camera-to-ACEScg development. No generic
hot/dead-pixel detector was found on that route. Edge colour is **after AHD
and camera-to-ACEScg**, unlike Opposed color's sensor-stage operation.

## Sensor evidence and the classification limit

Native scan reads the original approved RAW, subtracts each CFA channel's
black level and divides by its white-minus-black span. Both green phase
positions stay separate. It does not discard negative black-subtracted
readings before inspecting them.

| Native source (MacBook Neo, one CPU thread) | Four visible sensor-phase suspect counts | Interpretation |
| --- | --- | --- |
| Canon EOS 60D, IMG_0790.CR2, ISO 3200, 18,019,728 samples | 275 / 448 / 145 / 143; 1 hot, 1,010 cold | All cold suspects are below black; no calibration evidence of persistence. |
| Sony ILCE-7RM3, 2025_0730_1331_3.arw, ISO 4000, 42,389,760 samples | 0 / 0 / 0 / 0 | No candidates at this conservative threshold; not proof of a defect-free sensor. |

Canon's suspect raw values range 1,020–8,169 DN; **none is an absolute zero**.
Black levels are 2,046/2,047 DN, white 15,094 DN. Thus the cold suspects are
not simply a list of raw zero/dead sites. Many ordinary noisy shadow samples
also fall below black: Canon per-phase counts are 819,475 / 1,533,545 /
703,890 / 779,525. Once the harness's normal AHD transport clips below-black
values to zero, an extreme negative sample and a slightly negative sample
have the same transported value. Outlier severity alone does not identify
the cause of a final blob.

Fixed decision ROIs (native, unrotated sensor coordinates):

| ROI at +4 stops | Diagnostic sensor suspects | Current Denoise small contrast islands | Islands within 4 sensor pixels of a suspect |
| --- | --- | --- | --- |
| `canon-flame-edge-lifted`, x3072 y66 288² | 1 cold | 339 | 2 |
| `canon-dark-shadow`, x4176 y2276 288² | 7 cold | 0 on the metric's **21 supported pixels** | 0 on that support |

The flame support is 2,990 pixels. Proximity is not causation: one AHD sensor
error can spread, and a median-contrast island can be legitimate detail.
The dark-shadow proxy has vanishingly small support after its fixed eroded
shadow selection (21/82,944 pixels), so its zero is **not** evidence that the
visible dark-shadow crop is clean. Review the PNGs too. Of the 339 counted
flame islands, zero can be independently assigned to defects and zero to
random noise: **all 339 remain unclassified**, not 339 proved random.

No matched repeated scene/dark/flat files or camera serial-specific defect
map were supplied. A fixed sensor coordinate across independent captures
could establish persistence; one narrow-band star, specular point or fine
letter stroke can otherwise imitate a broken photosite exactly. Sensor
clipping, row/column defects, compression/in-camera processing and model
mismatch are not separately identified by this single-frame test.

The other research agent's corrected scene-linear noise-fit finding
(`3cdabe6d`, receipts `8b818d38`, on `feat/denoise-v1`) is complementary: its
clipped bright fit bin does not establish a defective photosite. This trial
uses the inherited **per-CFA** fits, with positive read/shot terms for Canon;
no scene-linear correction was silently substituted or retuned.

## Protocol fixed before measurement

Single-exposure anomaly scores are not evidence that a sensor is defective:
a spectrally narrow subpixel light can produce exactly the same mosaic.
The prototype therefore reports candidates but repairs only an independently
calibrated sensor-coordinate map. Five separate matched dark exposures can
establish persistent offset errors; five evenly illuminated moved flat
exposures are needed for dead/gain-defective sites. No test clean reference
is used to construct a runtime map. None is assumed for the private corpus.

Diagnostic candidate settings: four separate CFA phase planes, eight
same-phase neighbours, >12 noise standard deviations and >.02 full-well
excursion; reject broad local edges and clipped support. These are conservative
research settings, not approved quality tolerances or shipping controls.
Variance is `a * max(sample, prediction, 0) + b + quantisation_variance`.
The existing harness's provisional fits are reused without retuning.

Mapped repair uses the most consistent opposite same-plane pair, from the
unchanged input, with four-pixel support. Borders, nonisolated maps and
clipped neighbourhoods are left alone. Independently mapped saturated hot
sites are distinguished from genuine scene clipping; only their isolated
centre may be replaced, never surrounding clipped scene samples.

Existing finished-pixel CPU/GPU agreement target stays mean <1 and p99 <3
(SDR ΔE2000 / HDR ΔE ITP). GPU parity remains unmeasured until a port exists.
No-map sensor input must remain **exactly unchanged**. Timings use the existing
±10% descriptive allowance on this Mac only; no shipping speed promise.

Calibration requires distinct acquisition IDs and matching camera/visible
geometry, ISO, exposure and temperature regime. IDs and an evidence label
are a caller contract, **not** authentication of a capture. Flat uniformity,
scene independence and matching camera serial are not automatically verified
by this research API. Discovery allows a saturated centre only in calibration
mode, never from an ordinary scene. Saturated known-map sites are exercised
in tests; clipped scene neighbourhoods are left intact.

## Quality results

All CPU runs used the shared machine lock and 2.5 GB process-tree guard,
serially, on the MacBook Neo A18 Pro / 8 GB. Quality work took minutes, not
the 90-minute contingency budget. Existing Off, shipping-default Denoise
and RawNIND Bayer measurements were reused from the unchanged prior speck
trial with source path and SHA-256 in each new receipt. Both new adapters
were freshly run. Current Denoise pixels were independently recomputed for
an exact comparison, not merely inferred from reused statistics.

Shipping controls throughout: Amount **.75**, Luminance **.5**, Color Noise
**.75**, Detail Recovery **.5**. `AppDefault` provides these; the generic
harness `denoise_v2` default is not substituted.

| Set | Cases | Off = Pixel cleanup alone: median SDR PSNR / mean ΔE2000 | Denoise = Pixel cleanup + Denoise | RawNIND Bayer alone |
| --- | --- | --- | --- | --- |
| Quick (192px charts + real) | 21 synthetic + 2 real | 24.03 dB / 9.713 | 26.31 dB / 7.031 | 20.57 dB / 8.052 |
| Full (512px synthetic + real) | 27 synthetic/binned + 8 real | 23.58 dB / 10.628 | 31.74 dB / 5.519 | 27.89 dB / 4.538 |
| Public **held-out** | 19 | 28.56 dB / 6.355 | 35.74 dB / 2.671 | 35.90 dB / 2.662 |
| Public **seen during RawNIND training** | 33 | 30.08 dB / 5.273 | 33.49 dB / 3.082 | 32.88 dB / 3.518 |

These are summaries of truth-bearing cases only, with the existing masks;
private real photos have no clean truth. PSNR is median of image PSNRs;
ΔE is mean of image-mean errors, not a global pixel-weighted average. Clean
against itself has ΔE 0 / infinite PSNR; clean PNGs are present where available.
Public clean references retain the prior registration, gain and ISO100-noise
limitations. The synthetic camera/noise extrapolation is not a lab result.
No pooled held-out/seen headline is used.

**Exact identity holds on all 110 evaluated cases** (quick and full repeat
some scenes): no-map Pixel cleanup equals Off; no-map Pixel cleanup plus
Denoise equals current Denoise. Both SDR and HDR differences against those
respective controls are consequently zero. The existing full-/half-resolution,
texture, edges, colour-bleed, SDR ΔE2000, HDR ΔE ITP and lifted-tail metrics
are retained in each JSON; none improves solely from an empty map.

Lifted-shadow diagnostics (total +4 stops, existing eroded support):

| Set; cases with support | Median luma absolute p99.9, Off / Denoise / RawNIND | Total small islands, Off / Denoise / RawNIND |
| --- | --- | --- |
| Full; 9 | .19739 / .01850 / .00256 | 1,042 / 71 / 66 |
| Held-out; 6 | .34756 / .07620 / .06586 | 292 / 85 / 90 |
| Seen; 14 | .14944 / .05844 / .05673 | 1,971 / 798 / 592 |

Pixel cleanup alone repeats Off; Pixel cleanup + Denoise repeats Denoise in
every cell. These are descriptive tails, not new quality tolerances or
defect counts. Private images use a local-median proxy, truth-bearing images
use clean residuals. Do not rank unlike supports by pooled island counts.

In the fixed Canon lifted flame decision crop, Off's luma p99.9 is **.29782**,
current Denoise **.27873**, Pixel cleanup + Denoise **.27873**, RawNIND
**.00238**. The relevant conclusion is no incremental benefit from this
defect-only step; RawNIND's lower tail is not a detail-preservation approval.

### Positive control: independently calibrated, genuine generated defects

The standard harness does not inject defects, so identity there cannot test
repair efficacy. A separate seven-chart trial therefore places **12 fixed
persistent sensor faults** (saturated hot, dead, stuck; all four CFA phases)
on an independently seeded noisy sensor. Five separately seeded, uniform
flat exposures discover exactly those 12 coordinates. Scene clean truth is
used only for scoring, never for constructing the runtime map. Poisson–Gaussian
fixture noise is `a=.00003`, `b=.0000003`, not a claimed calibration of the Canon.

All 12 sites are repaired in every chart, with **no changes to any unmapped
sensor sample**. Sensor error relative to the same noisy scene without
faults falls **87.69%–99.9996%**, depending on detail under the defect.
Interpolation cannot recreate a letter stroke or a star that fell precisely
on a broken site; that lost measurement is irrecoverable. Fine text has the
largest remaining sensor error, as expected.

Example finished-pixel ΔE2000 to AHD-developed clean truth:

| Generated chart | Current Denoise on defective input | Pixel cleanup + Denoise | Pixel cleanup alone / same noise without defects |
| --- | --- | --- | --- |
| Slanted edge | .386 | .205 | 1.603 / 1.603 |
| Fine text | 1.436 | 1.371 | 1.983 / 1.965 |
| Sparse stars | 1.718 | 1.607 | 2.843 / 2.845 |

This confirms the stage is useful for actual mapped defects, not a universal
denoiser. The fabric/Siemens tests also retain existing Denoise detail loss;
fixing 12 samples does not repair that unrelated behaviour. No claim of
exact recovery at damaged sites or universal improvement in star photometry.

## Review crops and retained evidence

Start at `codebase/output/denoise-v1/decision/`:

- `canon-flame-edge-lifted/`: the main remaining ring/speck failure at +4.
- `canon-dark-shadow/`: visual check essential; the tail proxy undercovers it.
- `heldout-print-dots/`, `sony-sign-lettering/`, `synthetic-fine-text/`,
  `synthetic-star-field/`: point detail and text must not be silently erased.
- Each row now has `pixel_cleanup.png` (**Pixel cleanup**) and
  `pixel_cleanup_denoise.png` (**Pixel cleanup + Denoise**), alongside Off,
  current Denoise, RawNIND and the existing research columns. Compare the
  names/settings in `manifest.json`; no map is supplied for these photos.
- Clean PNGs remain available for public/generated truth-bearing rows.
  All 12 rows' new PNGs are byte-identical to their respective Off/current
  controls. The 12-row set is **11.69 MB**, native 288px crops, regenerated in
  place without copying original photos.

`codebase/output/denoise-v1/raw-pixel-cleanup/injected-crops/` contains
192px generated positive controls, including Off, current Denoise, Pixel
cleanup, both, clean, and the same noise without sensor faults. It is not
additional private photo material.

Receipts in `codebase/output/denoise-v1/raw-pixel-cleanup/`:
`quick.json`, `full.json`, `heldout.json`, `seen.json`, `injected.json`,
`native-*.json`, `pipeline-*.json`, `sensor-traces.json`, matching guard
receipts and logs. Baseline quality fields are copied into the new receipts,
not dependent on following another worktree's JSON link to read a result.
Shared dataset/model directories are read-only symlinks; no dataset images,
test photos, model weights or PNGs enter Git. Only report-linked small
receipts/crops are retained; these folders are disposable after review.

## Native CPU cost and memory

MacBook Neo A18 Pro / 8 GB, one CPU thread, November 17; prototype `78f93157`.
Single runs, ±10% descriptive timing allowance. No screen/UI speedup claim.
The bounded native sweep reads one RAW, estimates one global adaptive model,
then runs normal AHD and shipping Denoise over 768px cores with 86px Denoise
plus 16px AHD context. It does not allocate a whole-frame float cache or spool
intermediate photographs. Camera/scene clipping is kept; no real defects
are deliberately inserted into these native photos.

| Action, same Mac | 18.02 MP Canon | 42.39 MP Sony |
| --- | --- | --- |
| Whole bounded RAW → AHD → current Denoise sweep, including separately timed map probes | 7.186 s; .675 GB process peak | 16.026 s; .718 GB process peak |
| AHD subclock, including global-model input reads | 1.456 s | 3.569 s |
| Denoise filtering subclock | 3.856 s | 10.172 s |
| Empty-map validation + sensor copies, accumulated over all reads | .0054 s | .0138 s |
| Hypothetical sparse-map repair probe, same reads | .0207 s, 260 mapped coordinates | .0752 s, 651 mapped coordinates |
| Optional full native diagnostic scan, not required for mapped repair | 1.925 s | 4.349 s |

Sparse-map coordinates here are a regular timing grid, explicitly **not**
claimed defects, and their repaired values are discarded. The normal
development sweep uses the unchanged sensor. This measures repair cost and
normal native processing without disguising timing coordinates as science.
Global-model analysis is 1.661/1.843 s and includes AHD reads already counted
in the subclock; do not add it again to all subclocks. Whole waits also
include normalisation, Python/window overhead and both map probes. No
separate controlled whole-app before/after benchmark was performed.

The separate diagnostic scan's process peak was .326 GB on Sony and .364 GB
after Canon in the **same process** (cumulative high-water, not independent
Canon peak). Its raw-open-to-sensor-audit waits were 4.537/2.237 s. Strip
boundaries intentionally leave four-pixel classification gaps; totals are
conservative diagnostic counts, not an exhaustive defect inventory.

The sparse repair itself is easily cheap enough to accompany RAW development
by default **when a valid map exists**. A mandatory full-image discovery pass
adds seconds and still cannot establish sensor damage from one image; it is
not warranted. Existing app memory/cache allowances are unchanged.

## How it could ship, without integrating it in this trial

1. Unpack once. Resolve a camera-serial/geometry/calibration-regime defect
   map in original sensor coordinates, before crop/rotation. Normalise using
   per-channel black and white. An absent/invalid/unsupported map is a no-op;
   do not convert an uncalibrated scene candidate list into a map.
2. Repair eligible isolated mapped samples from the unchanged same-CFA
   source **before Opposed color builds clipping evidence**, before white
   balance and AHD. Preserve true scene clipping and skip clipped support.
   The existing normalisation/highlight order may need splitting to preserve
   below-black diagnostic information; do not run discovery after clipping.
3. CPU: update the working sensor copy with the repaired normalised values
   converted back to its native black/white convention, then call the existing
   highlight reconstruction and LibRaw AHD route. Never modify the RAW file.
4. GPU RAW: the cheapest common route is the **same sparse CPU corrections
   before sensor upload**, not a new full-frame GPU detector. Alternatively,
   a small sparse WGSL pass reads an immutable source and writes corrected
   sites before Opposed color/AHD. Use identical CFA phase/origin, four-pixel
   halo, clipping exclusions and directional tie order. Do not race read/write
   updates between nearby mapped sites.
5. Edge colour and its Expand rerun development from the original source:
   reapply the same map first on every rerender, then Opposed color/AHD,
   camera-to-ACEScg, Edge colour. Do not apply Pixel cleanup to the already
   demosaiced Edge colour output or connect it to the later Denoise controls.

No GPU port was built. **Finished-pixel CPU/GPU parity has not been measured**.
Before integration, compare calibrated synthetic defects, true point detail,
clipped RAW highlights and native tiles in both lanes with the unchanged
mean <1 / p99 <3 ΔE2000 (SDR) or ΔE ITP (HDR) targets. No hard maximum and
no relaxed delivery ceiling. CPU-supplied identical sensor corrections avoid
a new classifier disagreement but do not prove AHD/highlight parity. Use the
existing one-attempt GPU → CPU fallback policy; no extra retry layer.

## Remaining risks and recommendation

- No real defect map/calibration set: genuine-defect counts and the fraction
  of Steve's visible specks caused by defects **cannot be completed from
  these inputs**. Supply at least five matched Canon dark captures for hot
  offsets and five uniform moved flats for dead/gain faults, with capture
  identities and camera serial/geometry. These are new test inputs, not an
  instruction to use unapproved personal folders.
- Scene point detail is protected by requiring independent evidence, not by
  pretending a spatial threshold can distinguish every star from a hot site.
  Single-frame thresholds/models remain provisional and can miss defects.
- Defect clusters, borders, line/column faults, intermittent errors, X-Trans,
  linear DNG and other non-Bayer cases are not qualified; the prototype skips
  non-isolated maps rather than expanding repair into nearby good detail.
- In-camera corrections, compression and a mismatched calibration regime can
  invalidate a map. An evidence string is not enough for a shipping trust
  policy. This prototype is not a database/cache design.
- Harness AHD via bounded DNG excludes production highlight reconstruction,
  lens/geometry and artistic grade. Clipped-support unit tests and correct
  planned placement are not a real Opposed color / Edge colour integration
  test. GPU, app, export/Proof and native whole-frame-versus-tile parity are
  not claimed.

**Verdict:** retain this research and name, do not ship it as the fix for the
Canon shadow specks. Map-backed Pixel cleanup is a useful inexpensive RAW
correction with a successful genuine-defect positive control. Automatic
scene outlier suppression would be a different, separately reviewed feature.
No extra random-noise mode or additional neural trial was run here.

## Validation

Focused sensor/adapter checks: **22 passed** (1.37 s). Includes all CFA phases,
hot/dead/saturated mapped sites, calibration persistence, no-map point
detail preservation, edges, clipped support, clusters, evidence/geometry,
tile origins, shipping controls, +4 exposure applied once and bypass.
Quick/full/held-out/seen, seven injected charts, two native sweeps and all
12 decision rows complete without guard abort. An early harness-only double
exposure application was caught by exact equality on the two real quick
crops and fixed before all final quality runs; it never entered app code.

Required fast checks from `codebase`, each under the lock and guard:
`node --test tests/*.test.js`: **1,091 passed, one skipped**, 11.86 s;
`.venv/bin/python -m pytest tests -q`: **3,980 passed, 150 skipped,
one xpassed**, 265.20 s. No failures or guard aborts. The existing Starlette
deprecation warning remains unrelated. No GPU check directly covers this CPU-only
research adapter; no broad GPU or Library UI run is substituted.

`output_size.py`: 12.9 GB at start, **13.0 GB at end**, below the 100 GB
limit. Owned downloaded-source scratch was removed. No decoded native-frame
scratch or RAW copies remain; report-linked small crops/receipts remain local.

## Single-photo hot pixel filter (November 17)

### Plain-language summary

**An optional bright-dot filter is cheap and useful for genuinely isolated
faults, but this trial supports leaving it off by default.** Looking for light
on neighbouring sensor colours helps protect real sparks. It cannot guarantee
that a very sharp star, coloured light or reflection is safe: the lens spreads
light, but that spread can fall below the sensor's noise or another colour's
response. A single photograph cannot prove which sensor positions are broken.

The filter changes **three hot-like sites in IMG_0790.CR2**, while two clearly
visible airborne sparks remain unchanged. The three sites are **unconfirmed
candidates**, not three established defects. Across 15 supported corpus RAWs,
it changes 41 sites; the number of true defects among them remains unknown.
Two inspected sunset glints and one tree/sky-hole site are concerning
scene-located changes. Controlled near-diffraction-limited real-light models
also demonstrate false positives. There is no meaningful overall Denoise gain
on public pairs, and the widespread lifted Canon shadow specks remain.

Research adapters and measurement tools are committed; **no shipping code,
default, requirement, memory allowance or module PRD changes**. This experiment
uses no camera defect map, dark frame or calibration capture. Earlier map-based
prototype `78f93157` / `82083011` remains separate historical work.

### Detection, repair and placement

`codebase/tools/denoise_eval/candidates/hot_pixel.py` implements the following
fixed policy, without tuning after seeing these results:

- Work on signed black-subtracted, white-normalised Bayer samples, before
  white balance or demosaicing. Treat all four CFA positions separately,
  including the two green phases. Use each phase's sensor noise model
  `variance = a × max(signal, 0) + b` and actual DN quantisation from its
  black/white span. The inherited single-frame noise estimate is provisional,
  not a measured laboratory sensor calibration.
- A centre must exceed **every one of its eight same-phase neighbours** by
  both **8 standard deviations and 0.02** of the black-to-white range.
- Veto repair if any immediately adjacent other-colour site exceeds its own
  phase's local background by both **2.5 standard deviations and two DN**.
  Local background is the median of that site's same-phase neighbours.
- Preserve the centre if any sample in its 5×5 context reaches **0.98**;
  clipped centres and nearby clipped scene highlights stay untouched. Preserve
  the four-pixel frame border. Unsupported CFA/noise/colour bridges do nothing.
- Replace a surviving candidate with the mean of the most consistent opposite
  same-phase pair, choosing horizontal, vertical or either diagonal. Always
  read the original mosaic, never a previously repaired neighbour. Process in
  256-row strips; a bounded tile needs a four-pixel halo and even sensor origin.

Proposed shipping order: unpack → signed per-phase black/white normalisation
→ optional hot-pixel filter → **Opposed color clipping evidence and highlight
reconstruction** → WB/AHD → camera/ACEScg → Edge colour → Denoise. Running
before reconstruction avoids feeding a repairable isolated outlier into its
evidence. The clipping veto deliberately leaves saturated faults and faults
next to clipped light for another solution. This harness does not run the
production Opposed color reconstruction; that interaction still needs shipping
qualification, not an assertion that this trial tested it.

**Cold/dead mode stays separate and off.** Negative black-subtracted values are
normal in deep shadows; an isolated dark measurement is not sufficient proof
of a dead site. This adapter preserves negative samples and refuses a request
for cold discovery. No symmetric low-outlier heuristic was enabled.

### Known-light preservation and injected defects

The point experiment integrates the PSF over each pixel aperture at 32×
sampling before applying CFA responses. It includes a Gaussian lens blur and
FFT circular-pupil Airy PSFs, without an anti-aliasing filter. Each table cell
contains **216 trials**: three peaks (0.06/0.2/0.6), nine subpixel offsets,
four CFA phases, clean/noisy. Each changed trial changes one known-light site.
These are stress-case counts, **not estimates of real-world frequency**.

| Optical spread in sensor pixels | White light changed | Warm spark changed | Narrow red changed | Narrow blue changed |
| --- | ---: | ---: | ---: | ---: |
| Gaussian sigma 0.8 | 0 / 216 | 0 / 216 | 43 / 216 | 25 / 216 |
| Airy first-zero radius 1.2 | 0 / 216 | 0 / 216 | 53 / 216 | 35 / 216 |
| Airy first-zero radius 0.65 | 1 / 216 | 7 / 216 | 47 / 216 | 45 / 216 |
| Airy first-zero radius 0.35 | 23 / 216 | 13 / 216 | 50 / 216 | 46 / 216 |

Total: **388 / 3,456** known-light trials changed. A 0.35-pixel first-zero
radius approximates a near-diffraction-limited f/2-class lens at 550 nm and
4–4.3 µm pitch: a realistic sharp/no-AA stress case, not a measured lens.
The red/blue and warm channel ratios are declared sensor-response stress
vectors, not claims of measured lamp spectra or camera spectral sensitivity.
Four fine-text cases rendered at 8× through those PSFs cause **zero repairs**.
The table demonstrates why “light is never exactly one photosite” is helpful
evidence but not a reliable single-frame classification theorem.

Positive controls inject four known isolated hot sites in each of three noisy
backgrounds: **2/4** found at 0.002, **4/4** at 0.05, **4/4** at 0.3;
**10/12 true injected defects found, zero other sites changed**. Incidental
other-colour noise vetoes the two missed dark-background defects. Sparse
defect repair is useful when its assumption is true; it is not general noise
removal, and no threshold was relaxed to find the missing two.

### Real-photo counts and decision crops

The approved corpus has 18 RAW entries; 15 have a supported Bayer/colour
bridge. DJI DNG, linear DxO DNG and Fuji X-Trans are excluded, not passes.
Counts below are changed sensor sites; **confirmed true defects and confirmed
real-point false positives cannot be counted from these single exposures**.
No verified star-field RAW is present in the approved corpus.

| Photo | Changed candidates |
| --- | ---: |
| 2025_0730_1331_3.arw | 0 |
| A7R00619.ARW | 9 |
| DSC00264.ARW | 0 |
| DSC00950.ARW | 0 |
| DSC01212.ARW | 1 |
| DSC04375.ARW | 0 |
| DSC06615.ARW | 0 |
| DSC_3931.NEF | 5 |
| IMG_0114.CR2 | 0 |
| IMG_0790.CR2 | 3 |
| IMG_3129.CR2 | 13 |
| IMG_7723.CR3 | 0 |
| Leica X2 DNG | 0 |
| P1010004.ORF | 10 |
| P1150601.RW2 | 0 |

Canon candidate coordinates `(x,y)`: **(1583,1083), (4648,1493),
(4325,2395)**. None is independently confirmed as persistent. The original
fixed flame/shadow crops contain no repaired sites. Additional inspected
192-pixel crops: two airborne sparks centred at (3219,1317)/(4026,1398),
**zero changed sites**; Sony night bulb/sign, **zero**; sunset glints centred
at (3205,2580), **two** at (3208,2610)/(3203,2552); Sony tree/sky-hole crop
centred at (2066,1123), **one**. The last three are suspicious alterations in
fine scene detail, not established physical faults. Do not relabel all 41
changed candidates as defects or all as real light.

Local review: `codebase/output/denoise-v1/hot-pixel/index.html`. Four columns
show **Off / shipping-default Denoise / filter / filter + Denoise** for
injected known faults, Canon hot-like sites, real sparks/glints/night lights,
and preserved/damaged synthetic point sources. Corpus candidate crops are
96 pixels, supplementary real-point crops 192; candidate display exposure is
recorded per crop. `point-decisions.json` retains exact locations, sensor
decisions and finished SDR/HDR differences. Crops are PNGs, not RAW copies.
The existing twelve-row decision page was regenerated in place with the same
four columns at 288 pixels, retaining its unchanged 13 MB image budget.

### Effect on shipping Denoise and public pairs

Fresh runs use Amount/Color Noise **0.75**, Detail Recovery **0.5**. The quick
23-case and full 35-case sets produce zero repairs: filter equals Off, and
filter + Denoise equals current Denoise exactly. Public pairs are evaluated
separately by held-out/seen split; the filter never sees clean truth at runtime.
Means below are arithmetic means of per-case SDR PSNR / per-case mean ΔE2000,
not a mixture of median PSNR and mean colour difference.

| Split | Off | Current Denoise | Filter | Filter + Denoise |
| --- | --- | --- | --- | --- |
| Held-out, 19 crops | 28.72696 dB / 6.355187 | 36.20669 / 2.671286 | 28.72579 / 6.355434 | 36.20335 / 2.671372 |
| Seen, 33 crops | 30.26496 dB / 5.273104 | 34.45526 / 3.081596 | 30.26496 / 5.273104 | 34.45527 / 3.081595 |

Held-out: 12 repairs in eight cases. Only four changed sensor positions have
valid registered clean scoring support: one moves closer to clean, three
farther. Seen: two repairs in two cases, neither within valid support. Clean
pair consistency is not persistent-defect truth; registration, clean-frame
noise and gain remain limitations. These small score changes do **not** show
a meaningful denoising improvement or justify treating inside-tolerance drift
as a regression. HDR metrics, masks and half-resolution results are retained
in the receipts; no quality contract or HDR ceiling is relaxed.

### Native cost and GPU agreement

MacBook Neo A18 Pro / 8 GB, one CPU thread, shared lock; bounded 768-pixel
AHD/Denoise cores, 86-pixel Denoise plus 16-pixel AHD halos. Native clocks
cover unpack → normalise → optional filter → all developed/Denoised pixels;
not UI/action-to-screen, lens/geometry or Opposed color. One observation per
condition; inherited ±10% descriptive timing allowance. No speedup claim.

| Input | Filter alone | Whole pipeline, disabled → enabled | Process peak RSS, disabled → enabled |
| --- | ---: | ---: | ---: |
| 18.02 MP IMG_0790.CR2 | 0.190 s | 8.361 → 8.144 s | 0.720 → 0.811 GB |
| 42.39 MP Sony ARW | 0.471 s | 17.045 → 16.933 s | 0.892 → 1.098 GB |

The whole-pipeline differences are normal timing noise. The additional step
is about 2–3% of that wait; creating a new GPU route for this CPU cost is not
justified. The **already-GPU** RAW path should keep the step on the GPU to
avoid a readback. `frontend/library-gpu-raw.js` currently combines
normalisation, zero-clamping, WB and clip bits: gather original packed DN
neighbours and normalise by CFA inside that stage **before** WB and clipping
evidence, writing a separate output. Do not read/write in place or add a
full-frame float cache. Dispatch bounded tiles with four-pixel sensor halos;
retain existing one-attempt/CPU-fallback policy and memory admissions.

`hot_pixel_gpu.cjs` is an actual standalone WebGPU kernel, not a CPU mock.
**35 fixtures pass** with identical changed masks and sensor values; finished
SDR ΔE2000 and HDR ΔE ITP, before/after shipping Denoise, have **mean 0 / p99 0**,
inside mean <1 / p99 <3. Both kernels feed the **same CPU** AHD/colour/display
pipeline to isolate the new step. This is **not** full production GPU-RAW
parity, native GPU speed, reconstructed-highlight, export or encoding
qualification. Those remain prerequisites for shipping, not research passes.

### Recommendation, validation and reproduction

Recommend **default off**, one checkbox **Remove hot pixels** inside RAW
development **Pixel cleanup**. Tooltip: **“Removes isolated bright sensor dots
before the photo is developed. Turn off if it removes tiny stars, sparks or
bright reflections. Very bright dots and dots near clipped highlights may
remain.”** Start without a strength slider: more sensitivity trades missing
faults against deleting genuine scene light, and this trial establishes no
safe extra range. Cold/dead discovery remains a separate unqualified mode,
off. No request for camera maps or calibration captures is made.

Twelve focused behavioural tests cover Bayer phases/patterns, light/clipping
vetoes, cold/negative values, borders, unsupported/disabled paths, direction
repair, strip/tile seams, noise confidence and the genuine-point ambiguity.
Fast suites under shared lock and unchanged 2.5 GB guard: Node **1,091 passed /
one skipped**; Python **3,999 passed / 155 skipped / one xpassed**, no failures.
The existing Starlette deprecation warning is unrelated. The focused WebGPU
probe passes; no broad Library check substitutes for missing shipping
integration. No read-only project or original photo is modified.

From `codebase`, set `PYTHONPATH=backend`. Run each heavy command serially
through `.venv/bin/python tools/gpu-run-lock.py --label hot-pixel-<job> --`
and the existing `candidates.guard`. The inventory is the prior cleanup
`full.json`, with its full path supplied explicitly, containing photo/model
provenance; measurements record its SHA-256 and the source revision.

```sh
.venv/bin/python -m tools.denoise_eval.candidates.hot_pixel_measure generated --inventory "$inventory"
.venv/bin/python -m tools.denoise_eval.candidates.hot_pixel_measure corpus --inventory "$inventory"
.venv/bin/python -m tools.denoise_eval.candidates.hot_pixel_measure full --inventory "$inventory"
.venv/bin/python -m tools.denoise_eval.candidates.hot_pixel_measure heldout --inventory "$inventory"
.venv/bin/python -m tools.denoise_eval.candidates.hot_pixel_measure seen --inventory "$inventory"
.venv/bin/python -m tools.denoise_eval.candidates.hot_pixel_measure native --photo IMG_0790.CR2 --inventory "$inventory"
.venv/bin/python -m tools.denoise_eval.candidates.hot_pixel_measure native --photo 2025_0730_1331_3.arw --inventory "$inventory"
.venv/bin/python -m tools.denoise_eval.candidates.hot_pixel_measure point-decisions --inventory "$inventory"
.venv/bin/python -m tools.denoise_eval.candidates.hot_pixel_report
```

GPU reproduction: `gpu-fixtures --inventory "$inventory"`, then run
`node tests/run-in-electron.js tools/denoise_eval/candidates/hot_pixel_gpu.cjs
output/denoise-v1/hot-pixel/gpu-input.json output/denoise-v1/hot-pixel/gpu-output.json`
under the same lock with window **1408x794**, then `gpu-compare --inventory
"$inventory"`. Remove those two bulk JSON inputs/outputs afterwards; retain
`gpu-fixtures.json`, `gpu-compare.json`, small PNGs and guard receipts. Public
pairs reuse the existing read-only local dataset link; no datasets, photos,
models or generated crops are committed. Start output was **12.9 GB**, final
output **13.0 GB**, below the 100 GB limit. Owned bulk GPU JSON scratch was
removed; retained hot-pixel receipts, logs and report-linked small crops total
**27.27 MB**. Existing shared test-photo/dataset targets were not changed.

[dt-manual]: https://docs.darktable.org/usermanual/development/en/module-reference/processing-modules/hot-pixels/
[dt-code]: https://github.com/darktable-org/darktable/blob/master/src/iop/hotpixels.c
[rt-manual]: https://rawpedia.pixls.us/preprocessing/
[rt-license]: https://github.com/RawTherapee/RawTherapee/blob/dev/LICENSE
[art-ui]: https://github.com/artraweditor/ART/blob/master/src/gui/preprocess.cc
[art-engine]: https://github.com/artraweditor/ART/blob/master/src/engine/rawimagesource.cc
[art-license]: https://github.com/artraweditor/ART/blob/master/LICENSE.txt
[c1]: https://support.captureone.com/hc/en-us/articles/360002615758-The-Noise-Reduction-tool
[adobe]: https://helpx.adobe.com/au/camera-raw/desktop/using/sharpening-noise-reduction-camera-raw.html
[lightroom]: https://helpx.adobe.com/ie/lightroom-classic/desktop/process-and-develop-photos/retouch-photos.html
[dxo]: https://userguides.dxo.com/en/photolab/the-customize-tab
[libraw-code]: https://github.com/LibRaw/LibRaw/blob/master/src/postprocessing/dcraw_process.cpp
[libraw-license]: https://www.libraw.org/news/libraw-0-18-released
[dcraw-manual]: https://manpages.debian.org/unstable/dcraw/dcraw.1.en.html
[dcraw-code]: https://github.com/ncruces/dcraw/blob/master/dcraw.c
