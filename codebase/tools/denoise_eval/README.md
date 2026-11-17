# Offline CPU Denoise evaluation

Research tooling only: no app changes, Electron, GPU, automatic downloads, or source writes.
Run setup first, then from `codebase` (Windows: `.venv/Scripts/python.exe`):

```sh
.venv/bin/python -m tools.denoise_eval.run --adapters off,denoise_v2 --set quick
.venv/bin/python -m tools.denoise_eval.run --adapters off,denoise_v2 --set full
.venv/bin/python -m tools.denoise_eval.run --adapters off,denoise_v2_custom --controls '{"amount":0.7,"detail_recovery":0.3}' --set quick
```

`--banding .001` adds row/column offsets (normalised sensor sigma). No new
packages are needed beyond setup. A cross-worktree `denoise-eval-cpu.lock`
beside the main checkout records its PID; verify that PID has exited before
removing a stale lock. It coordinates this harness, not unrelated tools.
One process, one native thread, bounded crops; CLI fails on adapter errors,
peak process RSS >2.5 GB, or review >20 MB. Quality failures are reported, so
an inadequate baseline remains measurable. Quick budget: 120 s including
inventory. Timing noise allowance: ±10%, no whole-app speed claim.

Outputs: `output/denoise-v1/results-{quick,full}.json`, and the latest run's
`review/index.html`, `review/results.json`, 256 px PNGs. Only this harness's
files in that fixed review folder are overwritten. No RAW copies or full-size
intermediates. Infinite PSNR is JSON `null`; other nulls mean unavailable or
undefined, never a pass. All measurements, controls, crop coordinates, mask
recipe, ISO, noise fits, clipping fractions and RNG seeds are recorded.

## Inputs

### Pixel cleanup: independently mapped sensor defects (research only)

`candidates/pixel_cleanup.py:alone` and `:with_denoise` repair only
`metadata.pixel_cleanup_defects`, a list of visible unrotated sensor
`{y, x, evidence}` records. Bayer normalisation is `(DN-black)/(white-black)`
before WB. Keep green phases separate, and supply even `tile_origin=[y,x]`
for windows. No map means exactly unchanged sensor samples; the second
adapter then runs shipping `.75/.5/.75/.5` Denoise. Single-frame
`candidate_samples` output is diagnostic, **never** a runtime defect map.
`confirm_calibration` requires five or more independent dark/flat captures,
unique acquisition IDs, matching camera/regime/geometry, and a valid
four-position Poisson–Gaussian profile. The caller must verify calibration
provenance/uniformity; a label alone is not a shipping trust policy.

From `codebase`, with the existing unchanged baseline receipts available:

```sh
.venv/bin/python tools/gpu-run-lock.py --label pixel-cleanup-quick -- .venv/bin/python -m tools.denoise_eval.candidates.guard --receipt output/denoise-v1/raw-pixel-cleanup/quick-guard.json -- .venv/bin/python -m tools.denoise_eval.candidates.pixel_cleanup_measure quick --baseline-root output/denoise-v1/speck-cleanup
```

Use `heldout`, `full`, `seen`, `injected`, `audit`, `traces`, or
`native --photo IMG_0790.CR2` / `native --photo 2025_0730_1331_3.arw` in the
same locked/guarded command. `traces` requires the preceding `audit` output.
The baseline root's phase receipts must be the original speck trial
`quick/results-quick.json`, `full/results-full.json`, and
`heldout|seen/results-pairs.json`. Existing scores are retained with their
source hashes; new adapters and exact identity controls are freshly run.
No model/download or photo copying is performed. Native timing grid maps
are probes only, not real detected defects. Regenerate decision columns
with the locked/guarded `tools.denoise_eval.decision_crops --inventory
output/denoise-v1/raw-pixel-cleanup/full.json` command. Outputs are overwritten
in place, not multiplied per run. See the RAW Pixel cleanup research report
for interpretation and the absence of real calibration ground truth.

### Corpus and baseline generation

The approved manifest and `tools.lib.test_photos.photo_root()` resolve
`<photosRoot>/HDR Test Images`, including machine/env overrides. Inventory all
18 RAWs with the app's bundled ExifTool helper and rawpy; read originals only.
Missing photos/profiles fail visibly. No search in personal folders.

* Quick: seven 192 px charts × ISO 1600/6400/25600 + two 512 px real crops.
  Full: charts at 512 px, two low-ISO binned RAW scenes × three ISOs, eight
  640 px real crops. Camera-linear bridge support is required; unsupported
  camera matrices, linear DNG and X-Trans are named in the inventory.
* Charts: 5° slanted edge (.9 px optical blur), Siemens star, fine text,
  colour patches, gradient, sparse stars, fabric. Convert through the camera
  response, re-mosaic, develop; truth is **AHD-developed clean mosaic**, not
  the mathematical chart. Select the best worst-channel R² among high-ISO
  (≥1600) fits, preferring positive shot/read terms; ISO breaks ties.
* Low-ISO truth: lowest ISO supported Bayer files (filename breaks ties),
  central crop; average 2×2 **same-CFA** samples (4×4 sensor footprint), then
  remosaic at half dimensions. Noise sigma halves; some source noise remains.
* Noise fit: nine deterministic raw windows, four Bayer positions including
  independent greens. Plane-detrend 16×16 sub-channel blocks; per signal bin
  retain quieter spatial correlations, use lower-quartile residual variance;
  nonnegative fit `variance = a*signal+b`. R², signal range and sample counts
  are recorded. Accessible optical-black samples are diagnostics, not trusted
  dark frames. Texture/in-camera processing can bias these provisional fits.
* Simulated ISO: highest-ISO fit of the same camera model; a scales with ISO,
  b with ISO². Record extrapolation; dual-gain changes are unknown. Add seeded
  Poisson shot/Gaussian read noise, optional banding. Both Bayer and RGB see
  the same 0–1 clipped, 16-bit quantised synthetic sensor readout; record the
  clipped fraction. This is not laboratory calibration of ISO 25600.
* Development: small in-memory DNG, app `_develop_libraw_camera_rgb` (LibRaw
  AHD, unity WB, linear uint16, no auto scaling/brightness), then app
  `_camera_rgb_to_acescg_float32` with original camera matrix/as-shot WB.
  Geometry, lens correction, highlight reconstruction and artistic grade are
  consistently excluded. This reuses core development, not full import.
* Real: highest ISO supported Bayer file + darkest remaining file (fraction
  of nine median windows <.025; ISO/name break ties). Distinct flat/shadow/
  texture/edge crops from a 3×3 grid, scored with smoothed Laplacian/Sobel.
  Quick uses first file's flat and second file's shadow. Lift median ACEScg
  toward .18, bounded 0–6 stops; exact lift/coordinates are recorded.
* Optional approved aligned pairs: `--pairs /local/folder`, with `pairs.json`:
  `[{"name":"scene","noisy":"noisy.npy","clean":"clean.npy","metadata":{"iso":6400}}]`.
  Finite floating ACEScg RGB(A), matching shapes, 32–1024 px. No alignment,
  download or dataset approval is performed by the hook.

### Public RAW pairs (Q2 approved November 16, 2026)

`datasets/rawnind-manifest.json` pins a bounded subset, exact file hashes,
capture metadata, per-scene CC0 permission and the authors' documented held-out
split. The RawNIND dataset-wide CC-BY-SA label is **not** sufficient on its own:
its `permissions.txt` includes research-only artwork, which this subset excludes.
Training scenes are marked **seen by RawNIND**. These are experimental inputs,
not additions to the frozen photographic test corpus, app assets or shipped data.

`datasets/summarize.py RESULTS --output SUMMARY` computes equal scene-weighted
ISO-band and held-out/seen summaries: crop mean within capture, capture mean
within scene/band, then scene mean. Every metric includes its available scene,
capture and crop counts; means of colour p99s are not pooled pixel percentiles.

Run the opt-in downloader explicitly with isolated Python; it verifies every
size/SHA-256 and refuses to overwrite differing files. It never executes an
archive, shell command or downloaded script. On Windows use the venv Python
under `Scripts`; all paths below otherwise work unchanged.

```sh
.venv/bin/python tools/gpu-run-lock.py --label denoise-dataset-download -- .venv/bin/python -I tools/denoise_eval/datasets/download.py
.venv/bin/python tools/gpu-run-lock.py --label denoise-dataset-prepare -- .venv/bin/python tools/denoise_eval/candidates/guard.py --receipt output/denoise-v1/datasets/prepare-guard.json --seconds 900 --bytes 2300000000 -- .venv/bin/python -I tools/denoise_eval/datasets/prepare.py
.venv/bin/python tools/gpu-run-lock.py --label denoise-dataset-baseline -- .venv/bin/python tools/denoise_eval/candidates/guard.py --receipt output/denoise-v1/public-pairs/baseline-guard.json --seconds 1200 --bytes 2300000000 -- .venv/bin/python -I tools/denoise_eval/datasets/evaluate.py --set pairs --pairs output/denoise-v1/datasets/rawnind/pairs --output-dir output/denoise-v1/public-pairs --review-size 128 --adapters off,denoise_v2,tools.denoise_eval.candidates.denoise_v2_tuned:factory,tools.denoise_eval.candidates.denoise_v2_tuned:sharp
.venv/bin/python -I tools/denoise_eval/datasets/summarize.py output/denoise-v1/public-pairs/results-pairs.json --output output/denoise-v1/public-pairs/summary.json
```

The evaluator entry point only establishes the trusted repository import path
under `-I`, then calls the normal harness. `--set pairs` skips private-corpus
inventory and synthetic/real single-image sets completely. No data or model
download occurs in tests or in evaluation. It works with the same RGB/Bayer
candidate factories used by other sets; raw candidates see the original noisy
Bayer window and its camera bridge/noise estimate, never the clean reference.

`python -I tools/denoise_eval/datasets/smoke.py --pairs PAIR_FOLDER --output RECEIPT`
checks one 96px pair crop once with each available candidate. It skips absent
RawNIND weights/GALOSH binaries without installing or building them. This is
an interface/finite-output check only, not a candidate quality evaluation.

Preparation reads one noisy/clean camera pair at a time and emits up to four
deterministic 512px crops per accepted pair (flat/shadow/texture/edge from a
3×3 grid). It estimates one sensor translation from independent green-plane
anchors, resamples **clean only** within each CFA plane, fits one zero-offset
global gain per RGB channel on unclipped raw samples, and holds that gain
across all crops. Two greens share the green gain. Unstable/non-rigid pairs
and locally inconsistent crops are rejected, with reasons in `preparation.json`.
The recorded `POLICY` is set before measurement: 16px translation bound,
1px anchor-consistency bound, ECC ≥.90, local structure correlation ≥.97,
relative smoothed residual ≤.12, at least 20% usable crop. These screen
registration/illumination failures, not denoiser quality; no output threshold
is changed or tuned to win this comparison.

Prepared NPZ bundles contain floating ACEScg and pre-WB Bayer noisy/clean
windows plus Boolean valid/flat/texture/edge masks. Black/white clipping in
either source (including gain-induced clipping) is excluded with a 40px
filter-support halo. This deliberately loses near-black/highly saturated
coverage; rejection is not a pass. All truth metrics use valid pixels only;
SSIM and band filters use clean support. Pair edge sharpness is local gradient
energy relative to clean, **not** slanted-edge MTF50 and not an MTF-budget pass.
Low-ISO truth still contains sensor noise; clean-only interpolation can bias
fine bands. See `public-pairs.md` for accepted coverage and stratified results.

## Adapters

`Sample` exposes `rgb`/`bayer`, plus `clean`/`clean_bayer` for synthetic truth;
RGB pairs and real photos explicitly lack the truth/domain that is unavailable.

`off`: untouched developed RGB. `denoise_v2`: app `AdaptiveControls()` defaults.
`denoise_v2_custom`: `--controls` dictionary, exact Python field names.
For another method, pass `importable.module:factory` returning this interface:

```python
class Candidate:
    input_kind = 'rgb'  # or 'bayer' (normalised HxW sensor mosaic)
    margin = 66        # even sensor-pixel halo required by the method
    supports_alpha = True
    supports_bypass = True
    def description(self):
        return {'algorithm': 'candidate-version', 'input_kind': self.input_kind}
    def prepare(self, image, metadata):
        return None  # optional full-input measured state, shared across tiles
    def process(self, image, metadata, state, *, bypass=False):
        return image.copy()  # full-size scene-linear ACEScg RGB(A)
def factory():
    return Candidate()
```

Metadata: `cfa` (2×2 RGB indices), original CFA, WB, camera matrix, black/white
levels, ISO, per-position `{a,b}` synthetic noise parameters; real images carry
native-ISO `noise_fit_positions`. `inputs.develop(mosaic, metadata)` supplies
plain AHD for Bayer methods. Tiles receive `tile_origin`/`frame_shape`; the
harness retains inner pixels. RGB adapters must preserve headroom/negatives
and declared alpha/bypass behavior. Bayer on RGB pairs is explicitly skipped.
Adapters must stay offline/CPU-only and must not start parallel heavy jobs.

## Metric definitions (brief §3.2)

Shared fixed transforms: SDR = app CAT02 ACEScg→sRGB, clip 0–1, sRGB OETF;
HDR = app CAT02 ACEScg→BT.2020, 203-nit white, hard 1000-nit channel cap, PQ.
These simple test transforms have no adaptive tone mapping. They never excuse
scene-linear clamping by an adapter. Headline metrics average per-scene values.

* PSNR: encoded RGB MSE, unit range. SSIM: Wang 11×11 Gaussian, sigma 1.5,
  K1 .01/K2 .03; valid inner pixels, averaged over RGB. Both SDR and HDR.
  Every truth-bearing adapter also reports `half_resolution`: non-overlapping
  2×2 **scene-linear** area averages of output and truth, then the same SDR/PQ
  PSNR and colour transforms. An odd trailing row/column is omitted. A masked
  pair block is scored only when all four source pixels are valid;
  excluded registration/clipping support cannot leak into half-scale scores.
  This reduces fine demosaic disagreement; it does not make different demosaicers
  equivalent, replace native-resolution scoring, or establish clean detail.
* Colour: finished SDR CIEDE2000 (D65 Lab), mean/p99; HDR BT.2100-2 PQ ICtCp,
  BT.2124 ΔE ITP = `720 sqrt(dI²+(.5*dCt)²+dCp²)`, mean/p99.
* Flats: SDR Y (.2126/.7152/.0722), R−Y/B−Y chroma residual std vs truth;
  without truth independently detrend a plane. Report std and output/noisy
  ratios. Flat mask: bottom quartile of sigma-2 clean Laplacian magnitude
  (noisy for real); texture: top 40%; exclude 12 px border. Slanted chart
  uses its left-quarter flat. Masks are automatic, not hand-verified regions.
* Texture: SDR luma DoG power at sigma .5–1 / 1–2 / 2–4 / 4–8, output/clean;
  also residual-band/clean power. Finest output/clean ratio is the invented-
  detail proxy; residual noise also raises it. Visually inspect stars/text/fabric.
* MTF50: chart's known 5° angle, 4× ESF, derivative LSF, Hamming window,
  derivative sinc correction, first 0.5 crossing up to Nyquist. Null if no
  sub-Nyquist crossing. Report cycles/pixel and output/clean. Halo: extra ESF
  overshoot/undershoot relative to clean, divided by clean edge height.
* Bleed: mean/p99 SDR opponent-chroma error within 3 px of strong clean
  chroma Sobel edges; no suitable edge → null. Method noise: correlation of
  absolute removed SDR luma with sigma-2-smoothed input Sobel edges; identity
  removal is defined as zero, not evidence of good denoising.
* Tile/exposure probes: one ISO-6400 fabric crop per adapter/run, ≤256 px;
  shared preparation, 128 px grid shifted by 64, declared halo; ΔE2000/ITP
  mean/p99 and whole-frame comparison. Exposure: every integer stop −6…+6,
  **re-prepare** scaled input, undo scaling before comparison. Bayer metadata
  scales a×gain/b×gain². Full-photo and additional seam coverage come later.
* Safety: finite output on every case; separate negative/above-white sentinel,
  exact declared alpha/bypass, fixed display cap. Record constant RGB drift
  separately. Production ceiling/encoder validation and CPU/GPU agreement are
  explicitly outside this CPU harness. Current Denoise need not meet the
  brief's proposed improvement targets; those limits remain Steve's decision.

Tests: `.venv/bin/python -m pytest tests/test_denoise_eval.py -q`, also included
in normal pytest. Known-answer PSNR/SSIM, Gaussian edge MTF, published ΔE2000,
PQ, Bayer noise/binning, a/b recovery within 5%, halo/bleed, alpha/bypass and pairs.

## Optional RawNIND prototype (not installed by setup)

`candidates.rawnind` supplies `linear`, `linear_half`, `linear_three_quarters`,
`bayer`, `bayer_half`, and `bayer_three_quarters` factories (strengths 1/.5/.75).
Use the full module prefix `tools.denoise_eval.candidates.rawnind:<factory>`.
Verified local weights live in `output/denoise-v1/candidates/rawnind/rawdenoise-nind/`;
weights are never downloaded by these tools or committed. Research-only
`onnxruntime==1.32.0` and `psutil==7.2.2` belong in this worktree's venv, not
app requirements. Models are hash-checked before loading; CPU only by default,
and Bayer rejects non-CPU providers. No app path or control changes.

Run from `codebase`, one command at a time, through the shared machine lock:

```sh
.venv/bin/python tools/gpu-run-lock.py --label denoise-rawnind-quality -- .venv/bin/python -m tools.denoise_eval.candidates.measure_rawnind quality
.venv/bin/python tools/gpu-run-lock.py --label denoise-rawnind-probes -- .venv/bin/python -m tools.denoise_eval.candidates.measure_rawnind probes
.venv/bin/python tools/gpu-run-lock.py --label denoise-rawnind-full -- .venv/bin/python -m tools.denoise_eval.candidates.measure_rawnind full-frame --file IMG_0790.CR2 --kind linear
.venv/bin/python -m tools.denoise_eval.candidates.measure_rawnind review
```

For Bayer full-frame research use `--kind bayer`. As in the pinned upstream
demo, finite normalised sensor samples are clipped to [0,1] before inference;
this does not clip developed scene-linear colour or exposure. Unsupported CFA
still uses an explicit AHD fallback. All four
ordinary Bayer orientations are canonicalised through phase-preserving plane
gathering, with output cropped back to original sensor coordinates. No
whole-frame `np.pad`, resampling, second WB, or AHD after the model. One global
gain is anchored to the unity-WB AHD **camera-RGB mean**, not the four-plane
sensor mean (which counts green twice and shifts exposure). This research
anchor requires an additional AHD pass; former Bayer native timings do not
qualify the revised adapter's speed. Linear's gain/colour path is unchanged.

`quality --bayer-only` runs off, current Denoise and Bayer .5/.75/1;
`probes --bayer-only` skips unchanged linear probes. `verify` loads the pinned
`demo.py` saved read-only under `output/denoise-v1/verify/upstream/darktable-ai/`
and compares its actual packing, inference, gain, matrix and TIFF save against
AHD through the same path on clean mosaics and two low-ISO RAW crops. A separate
even crop with red at (0,0) disambiguates the demo's non-RGGB packing from host
phase alignment. It records host-tail agreement, eight real shadow-bias rows
and post-development exposure −6…+6 separately from sensor saturation.

The runner samples child RSS every 20 ms and terminates above 2.5 GB; full-frame
float source/result files are temporary disk-backed arrays and removed after
success/failure, including guard termination. It records standalone decode/prep,
model-session, inference, stitch/colour and total times, **not action-to-screen**.
There is no timing repeat or GPU gain claim; ±10% descriptive timing allowance
is inherited from this harness. `probes` runs the Bayer model on nine clean
mosaics and prepares genuinely shifted internal model grids. The normal harness
grid probe only slices an already-prepared frame for these adapters; that zero
difference is not independent evidence about inference seams.

Outputs are isolated under `output/denoise-v1/rawnind/`. `quality` calls the
unchanged full input/metric set with all eight variants; generic harness options
`--output-dir` and `--review-size 128` keep its many-column review bounded.
`review` appends native 256 px full-photo crops and clean-mosaic comparisons in
the same page format, checking the complete folder against 20 MB. Optional
model-dependent unit checks skip when weights/runtime are absent; synthetic
phase-gather checks require no weights. See the Phase 2 report for
quality failures and the learned-scale gain guard; no candidate is approved.

## Classical Phase 2 prototypes (not app integration)

`candidates/darktable_profiled.py` is the pinned GPL generalised-Anscombe RGB
wavelet reference, after AHD and before camera→ACEScg. The harness's reversible
colour bridge recovers WB-camera RGB; WB scales shot gain by g and read variance
by g². Missing camera profiles use the existing measured-noise Denoise, not an
unrelated camera. The sampled frame-global Bayes thresholds and uncorrected
AHD correlations make this an adapted reference, not pixel-identical darktable.
Active scales set the cumulative `2*(2**scales-1)` halo. `half`, `three_quarters`,
and `factory` blend 50%, 75%, 100% of the native correction, respectively.

`candidates/galosh.py` wraps the Apache-2.0 FP32 RAW reference. Build **offline**
with `.venv/bin/python -m tools.denoise_eval.candidates.build_galosh`; clang and
the checked-in source suffice. OpenMP is serial; two unused SSE helper bodies
are omitted only from the build copy. No system package is installed. The native
blind alpha/read-variance fit and dark-anchor IRLS run once per photo; calibrated
mode averages the four CFA models. Every tile holds that fit and unity GAT sigma.
Calibrated factories: `half`, `three_quarters`, `factory`; blind: `blind_half`,
`blind_three_quarters`, `blind`. Their native luma/chroma controls are scaled
together; the upstream positional strength alone is ignored. Halo 160 includes
the coarsest chroma pyramid and development; origins align to eight sensor pixels.
RAW bypass is exactly the same AHD development as Off, not a mosaic-shaped RGB
return; RGB alpha/HDR sentinel is not applicable to this Bayer interface.

`denoise_v2_tuned.py:factory` and `:sharp` use the committed per-ISO selections
(nearest measured ISO for real photographs). `candidates/tune.py` evaluates the
recorded full synthetic set and writes `classical-tuning.json`; tuning is
in-sample and is not proof of generalisation. The sharp selection requires the
slanted edge's MTF50 ratio ≥0.90. No truth is consulted at adapter runtime.

Run heavy tools **under the shared lock**, for example:

The thirteen-variant `candidates.measure` wrapper uses 128px comparison
thumbnails (metrics keep their original resolution). Native full-frame
review crops remain 256px. This is an opt-in wrapper, not a harness default.

```sh
.venv/bin/python tools/gpu-run-lock.py --label denoise-classical-quality --minutes 25 -- .venv/bin/python tools/denoise_eval/candidates/guard.py --receipt output/denoise-v1/quality-guard.json --seconds 1200 -- .venv/bin/python -m tools.denoise_eval.candidates.measure
.venv/bin/python tools/gpu-run-lock.py --label denoise-classical-frame --minutes 25 -- .venv/bin/python tools/denoise_eval/candidates/guard.py --receipt output/denoise-v1/frame-guard.json --seconds 1200 -- .venv/bin/python -m tools.denoise_eval.candidates.full_frame --method darktable --photo IMG_0790.CR2
```

Use `--method galosh` or `--photo 2025_0730_1331_3.arw` for the other trials.
After quality and native-frame runs, `python -m tools.denoise_eval.candidates.report`
appends the strength curves and native crops to the same review page.
On Windows use `.venv/Scripts/python.exe`; the builder selects `.exe` and
the native math library automatically. A clang compiler is required; this
trial validates the Mac build only, not a Windows or Linux binary.
The guard samples total process-tree RSS every 0.2s and aborts above 2.5 GB;
the full-frame clocks distinguish sensor prep, filtering and AHD/colour
development. Its full-size intermediates are temporary and removed on failure.
Measured times allow ±10% noise; compiled-C/WGSL figures in the report are
explicit estimates, never benchmarks. No Electron/WebGPU is used or qualified.

## Pilot-guided empirical Wiener trial

`candidates.pilot_wiener:{self,tuned,bayer}_{both,luma}` are offline adapters.
`both` attenuates only the AHD image's own five opponent/B3 detail bands using
pilot energy and the existing measured adaptive noise model. `luma` uses that
stage on luma and substitutes cached pilot chroma at normal strength; it is
deliberately **not** covered by the own-coefficient no-invention guarantee.
The tuned pilot uses the existing nearest-ISO PSNR controls, not clean truth.
Bayer uses the separately verified full-strength RawNIND model/colour bridge.
No production imports, model requirements, default or budget changes occur.

Prepare builds coefficients/gains once. Resolve changes Amount, Luminance,
Color Noise, Detail Recovery and four sizes by algebra on that evidence; zero
strength and bypass are exact. `luma`'s direct chroma blend saturates at the
pilot (normal strength); its upper Color Noise range cannot clean further.
The numerical reconstruction/grid allowance is 2e-7 linear units, chosen for
float32 accumulation order only; finished-pixel seam/exposure limits remain
mean <1 / p99 <3, unchanged. Timing noise allowance stays ±10%.

Small adapters refuse inputs above one million pixels rather than allocating
a multi-GB cache. Use `candidates.pilot_wiener_measure native --photo
IMG_0790.CR2 --pilot bayer` (or `tuned`/`self`, optional `--direct-chroma`) for
the bounded native experiment. It develops AHD in haloed sensor tiles, holds
one global model and pilot, spools 512px cache cores to temporary disk, resolves
every pixel, retains four crops only, and removes all full-frame/cache scratch.
`RawNIND.prepare(camera_anchor_mean=...)` optionally accepts the accumulated
unity-WB AHD camera mean to avoid an extra full-frame development allocation;
the default calculation is unchanged and equality is regression-tested.
Native time includes disk I/O, not UI or an approved production cache design.

Under `tools/gpu-run-lock.py` and `candidates/guard.py`, run
`python -m tools.denoise_eval.candidates.pilot_wiener_measure controls` and
`probes` for the three-value Amount/Color Noise sweeps and **independent**
decomposition/network grid checks (not merely cached-frame slicing).
`python -m tools.denoise_eval.candidates.pilot_wiener_report` rebuilds tables
and the compact review from retained JSON/PNG evidence under
`output/denoise-v1/pilot-wiener/`. The model/runtime remain venv/output-only.

`tests/test_denoise_classical.py` checks finite output, bypass/alpha, native
internal tile boundaries, CFA orientation, algebraic VST inversion (2e-6),
and Monte Carlo inverse-of-mean bias within max(1%, 0.0002 sensor units) for
four constant signals with 100,000 draws each. GALOSH checks skip if unbuilt.
`source-provenance.json` records source hashes; the vendored LICENSE/NOTICE
and repository GPL text preserve the licence obligations.

## Residual speck / chroma cleanup trial (November 17)

`candidates.speck_cleanup:{median,guarded,center_shadow,factory}` are own GPL-3 CPU research
adapters, never imported by the app. `factory` is the conservative **shadow**
variant. It caches the current adaptive bands/noise-energy ratios and two
correction maps. `median` tests an unprotected 5×5 outlier clamp; `guarded`
protects bright points/lines and uses joint luma/chroma range weights at 16px
reach; `shadow` additionally gates by measured signal/noise and preserves
ACEScg luminance during chroma repair. It reads the surrounding 5×5 median
brightness; `center_shadow` retains the failed centre-brightness version,
which mistakes dark printed strokes on bright material for shadows. Neither truth nor camera/ISO-specific
choices enter the runtime. Existing controls resolve from fixed evidence;
zero Amount, bypass and alpha remain exact. Correction strength saturates
at the default; stronger sliders still increase the underlying adaptive stage.
This limitation and the substantial reference-cache size require a shipping
redesign and approval, not an implicit app-memory allowance.

`shadow_tails_sdr_lift4` adds a descriptive tail metric: fixed total +4-stop SDR,
flat pixels with original scene-linear Y ≤ min(.02, flat-median Y), eroded
2px support, absolute luma residual p99.9 and pixels >.05, and connected islands
of 1–25 pixels. Truth uses clean residual; no-truth uses 5×5 local-median
contrast and **can count real detail**. Island count can decrease as bad pixels
merge into larger blotches, so always read it alongside tail fraction/p99.9.
No threshold here is an agreed quality tolerance. Existing contract limits
and ±10% descriptive timing allowance remain unchanged.

Run each separately under `tools/gpu-run-lock.py` and `candidates/guard.py`:

```sh
.venv/bin/python -m tools.denoise_eval.candidates.speck_measure quick
.venv/bin/python -m tools.denoise_eval.candidates.speck_measure heldout
.venv/bin/python -m tools.denoise_eval.candidates.speck_measure full
.venv/bin/python -m tools.denoise_eval.candidates.speck_measure seen
.venv/bin/python -m tools.denoise_eval.candidates.speck_measure controls
.venv/bin/python -m tools.denoise_eval.candidates.speck_measure native --photo IMG_0790.CR2
.venv/bin/python -m tools.denoise_eval.candidates.speck_measure native --photo 2025_0730_1331_3.arw
```

On Windows use the venv's `Scripts/python.exe`. Outputs go to the fixed
`output/denoise-v1/speck-cleanup/` folder. Pair `--pair-split heldout|seen`
is also available in the general runner. Native runs read actual 18/42 MP
RAWs from the approved corpus, use bounded AHD windows and one global model,
prepare/spool/resolve each 768px cache core, retain JSON only and remove all
scratch on exit. Stage times include research overhead and are **not UI or
GPU timings**. Independent haloed preparation is tested (86px margin), rather
than treating cached-frame slicing as evidence of preparation-grid equality.
`speck_report` aggregates the receipts (equal capture then scene weighting
for public pairs). `decision_crops` adds `speck_cleanup.png` and a fixed +4-stop flame-edge row;
its existing current/RawNIND/clean columns and fixed display rules are retained.

## Noise-model trial (November 17)

`candidates.noise_model_specks` is own GPL-3 CPU research, never imported by
the app. `factory` drops uninformative zero-variance brightness bins and
normalises the existing nonnegative quadratic fit before solving; existing
band and clumping calibration is remeasured unchanged. `poisson_gaussian`
also removes the quadratic term. These are brightness-shape repairs, not
laboratory camera calibration. ISO plus black/white metadata does not establish
conversion gain/read variance. RAW adapters (`raw`, `raw_corrected`) and their
already-completed receipts are preserved for the separate RAW development agent;
they are no longer decision-crop columns or part of this task's recommendation.

Run each command serially through `tools/gpu-run-lock.py` and
`candidates.guard` (2.5 GB tree RSS guard), using the venv Python:

```sh
.venv/bin/python -m tools.denoise_eval.candidates.noise_specks_measure audit
.venv/bin/python -m tools.denoise_eval.candidates.noise_specks_measure quick
.venv/bin/python -m tools.denoise_eval.candidates.noise_specks_measure heldout
.venv/bin/python -m tools.denoise_eval.candidates.noise_specks_measure full
.venv/bin/python -m tools.denoise_eval.candidates.noise_specks_measure seen
.venv/bin/python -m tools.denoise_eval.candidates.noise_specks_measure native --photo IMG_0790.CR2 --method corrected
.venv/bin/python -m tools.denoise_eval.candidates.noise_specks_report
```

For noise-model comparisons use `native --method current|corrected`; repeat for
`2025_0730_1331_3.arw`. It processes every 18/42 MP pixel in bounded sensor/AHD
tiles, and removes arrays instead of retaining full-frame scratch. Its clocks
include RAW open, development, model measurement and adaptive filtering; model
analysis overlaps the development/repair subclocks. It does **not** simulate a
live-control cache, disk persistence, GPU or action-to-screen timing. Keep the
existing ±10% descriptive allowance; no quality/timing limit changes.

Outputs are fixed under `output/denoise-v1/noise-model-raw-specks/`.
`decision_crops` adds corrected-model and two native-model columns.
Run `audit` first: the last two deliberately reuse that same source's measured
native-frame model (scaled for the fixed display lift), isolating the real
global-fit defect from a crop-local estimate. Synthetic/public cases retain
their crop-local baseline in those two columns; no native profile is borrowed.
Historical RAW adapter diagnostics are not independent RAW+AHD tiling
qualification. Bayer exposure probes keep the inherited clipped-DNG bridge
and can fail; do not present them as HDR exposure qualification.
