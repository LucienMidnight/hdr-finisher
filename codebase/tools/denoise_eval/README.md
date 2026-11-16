# Offline CPU Denoise evaluation

Research tooling only: no app changes, Electron, GPU, downloads, or source writes.
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

For Bayer full-frame **research extrapolation only**, use `--kind bayer
--extrapolate-bayer`; the default adapter instead uses the existing AHD path
when sensor values leave [0,1]. Neither mode clips model inputs. All four
ordinary Bayer orientations are canonicalised through phase-preserving plane
gathering, with output cropped back to original sensor coordinates. No
whole-frame `np.pad`, resampling, second WB, or AHD after the model.

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
phase-gather/fallback checks require no weights. See the Phase 2 report for
quality failures and the learned-scale gain guard; no candidate is approved.
