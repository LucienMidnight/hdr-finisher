# Brief: DNG distortion correction performance

Date: October 23, 2026
Status: Implemented and locally committed. October 24 follow-up closes Grade GPU DNG integration and validates the real Leica fixture; current results are in Import and RAW and Photo Library module PRDs.

## Task for the clean thread

Read `AGENTS.md`, then investigate and improve real-photo DNG distortion
correction. Carry this through implementation, focused validation and local
commits. Steve has authorized the improvement. Keep all browser work headless
with Playwright: his children are gaming on the main monitor. Do not launch
visible browser or Electron windows. Cheap subagents may handle independent
code/source review; serialize GPU benchmarks so they do not compete.

Prioritize GPU processing and reliable memory-bounded operation. Steve also
questions whether the 92-second CPU fallback reflects avoidable overhead.
Profile that fallback and compare it with a suitable native remapper; make a
small, justified improvement if useful, without turning this into a separate
CPU processing architecture. Preserve a correct CPU fallback.

## Verified evidence

The October 23 headless sweep ran on a Ryzen 5 7600, RTX 4070 Ti and 63.2 GB
RAM, with other household GPU activity. Its commit was
`b3af3a748c174f3c7fed1f4b4c825aa13691a4cb`; inspect current code before changing it.

Artifacts are under `codebase/output/performance/sweep-2026-10-23/` (ignored):
`REPORT.md`, `timings.csv`, `backend.log`, `results.json`, `environment.json`,
and reusable Playwright harnesses including `sweep.cjs` and `imports.cjs`.
Use isolated application data and output copies, as those harnesses do.
The previous test server on port 8817 was stopped.

For `photos/05-DJI_0071-2.DNG`, backend stage boundaries show:

| Stage | Observed wall time |
|---|---:|
| DNG GainMap | 4.82665 s |
| DNG WarpRectilinear | 92.50055 s |
| All 18 Library finished thumbnails, fresh thumbnail cache | 113.026 s |

The log explicitly reports GPU fallback because "GPU RAW development exceeds
the available shared memory budget." This is a reservation rejection, not
proof of physical GPU exhaustion or unsupported DJI metadata. Existing CPU
and OS caches were warm; this was not a certified process-cold benchmark.

Metadata inspection of the four real files `DJI_0071.DNG`, `DJI_0072.DNG`,
`DJI_0071-2.DNG`, `DJI_0072-2.DNG` in
`D:\Photos\HDR Test Images\DJI Samples` confirmed all are 8000x6000 DJI
FC3170 mosaiced DNGs, have mandatory GainMap then three-plane WarpRectilinear,
and pass `library_dng.plan()`. Their optical centers are (0.5, 0.5).
The current generic reservation formula is width * height * 44 + 64 MiB,
or 2078.16 MiB for each. Do not assume the actual DNG peak is this large.

The available Sony DxO linear DNGs have no embedded correction opcodes; neither
does `DJI_0071-2-HDR.dng`. These are useful negative controls, not examples of
non-DJI embedded warping. Routing should depend on supported DNG operations,
never camera brand. A real non-DJI DNG with warp instructions remains a fixture
gap; supplement with independent synthetic fixtures rather than claim coverage.

## Code and documentation starting points

- `backend/hdr_finisher/library_dng.py`: Library bridge, CPU AHD decode,
  GPU GainMap/warp metadata, eligibility and crop/orientation mapping.
- `frontend/library-rgb-gpu.js`: existing DNG GPU kernels and buffer lifecycle.
- `frontend/library-gpu-raw.js`: shared scheduler and `rawBudget` formula.
- `backend/hdr_finisher/gpu_delivery.py`: shared memory reservation gate.
- `backend/hdr_finisher/dng_opcodes.py`: CPU distortion and bicubic sampler.
  It sequences 64-row strips and channels, uses float64 intermediates, and
  repeatedly calculates weights and temporary arrays. NumPy operations are
  compiled individually; do not describe it as a Python loop over every pixel.
- `raw_import.py`, `linear_dng.py`, `library_dng_linear.py`, `gpu-delivery.js`:
  import routing and boundaries. The current GPU DNG bridge is Library-only;
  Grade import needs explicit integration, not an assumption of shared routing.
- Adobe specification and SDK downloads:
  https://www.adobe.com/support/downloads/dng/dng_sdk.html
- Adobe SDK source mirror (older implementation; verify relevant semantics):
  https://android.googlesource.com/platform/external/dng_sdk/+/refs/heads/android14-prebuilt-test/source/dng_lens_correction.cpp
  It uses compiled tiled processing and precomputed bicubic weights.
- OpenCV remapping reference:
  https://docs.opencv.org/4.13.0/da/d54/group__imgproc__transform.html

These sources establish algorithms and implementation choices, not a published
seconds-per-48MP requirement. The earlier five-second target is a proposed
engineering goal, not an Adobe benchmark.

## Implementation approach

1. Reproduce the fallback on one real DJI photo with isolated data. Capture
   requested, available and actual peak memory plus routing. Profile coordinate
   generation and interpolation separately; benchmark any native comparison
   using the same DNG coordinates, cubic interpolation and border behavior.
2. Calculate the DNG route's true peak working set. Use an accurate conservative
   reservation if the generic RAW estimate is inappropriate. Preserve shared
   accounting, Grade priority and all existing memory limits; do not solve this
   by increasing a budget or hiding GPU failures.
3. Exercise the existing GPU warp. If the working set or individual storage
   binding still exceeds limits, use bounded tiles/strips. Derive source
   footprints from the distortion for each channel, including interpolation
   support; a fixed halo around the same output position is insufficient.
   Preserve full-image coordinates and seam-free results. Avoid retaining
   whole-source GPU buffers that defeat the memory bound.
4. Complete the Library improvement first, then integrate reusable DNG correction
   into Grade import if feasible within this focused change. Explicitly report
   remaining Grade work if it needs a separate change. Preserve GainMap-before-
   warp order, colour conversion, crop/orientation and duplicate-Lensfun guards.
   Unsupported mandatory operations must never be silently skipped. Fisheye
   and WarpRectilinear2 support are outside this performance fix.

## Validation and deliverable

Before new measurements, use 10% timing tolerance for shared-machine noise;
report three-run medians for final before/after comparisons. Reuse the recorded
92.5-second baseline for orientation, but obtain comparable current baseline
and changed runs under the same conditions. Measure queue, decode, GainMap,
upload, warp, colour/reduction, readback and user-visible completion separately.
If warp and colour are fused, label that combined timing honestly. Initial goal:
GPU distortion preparation below five seconds on the 48MP sample, with a
substantial end-to-end improvement; report the actual result if unmet.

Preserve existing numerical checks. Before measuring any newly changed output,
record the existing applicable perceptual tolerances, or propose concrete mean
and high-percentile perceptual limits per AGENTS.md. Do not loosen existing
tolerances, budgets or pinned guarantees. Check borders, geometry, all eight
orientations, per-channel coefficients, GainMap order, tile seams, cancellation,
low available memory, GPU failure fallback and DNGs without warp instructions.

Relevant checks include `tests/test_dng_opcodes.py`, `tests/test_library_dng.py`,
`tests/test_dng_raw_routing.py`, and `tests/library-dng-warp.js`. Read existing
drivers before choosing the one or two relevant GPU checks. Adapt the launch to
headless Playwright where possible; do not silently substitute a visible window.
Run repository fast checks and obey its slow-test time limit. No broad sweep,
installer build or push. If export/Proof or pinned shader/budget work becomes
necessary, apply the stricter repository validation requirements.

Deliver a concise timing table showing what was tested, route, dimensions,
per-stage before/after medians, total user wait and peak memory. Explain which
DNG types benefit, measured quality results and remaining limitations. Update
the affected module PRDs (`photo-library`, `import-and-raw`, and others actually
changed), commit only task files locally, and archive this brief when completed.
Preserve unrelated edits and original photos/read-only projects.


## Outcome, October 23, 2026

Library now uses distortion-derived, adaptively split source footprints with
ordered GPU GainMaps, warp/colour/measurement and one-plane GPU reduction.
Shared memory limits are unchanged. Three-run 48 MP medians: finished Library
wait 101.25 -> 10.47 s; all GPU preparation 4.10 s; fused warp/colour/measurement
0.33 s. Reservation is 283.20 MiB and peak tracked allocation 260.45 MiB,
compared with the rejected 2078.16 MiB request against 2048 MiB available.
CPU weight reuse improves the fallback warp median 85.66 -> 53.53 s; a
benchmark-only OpenCV 5 comparison measured 17.07 s without adding a dependency.

Existing finished-pixel and numerical limits pass, including borders, eight
orientations, ordered GainMaps, adaptive seams, samples, cancellation and
allocation failure. Full measurement method, quality numbers, fast-check counts
and limitations are recorded in the Photo Library and Import and RAW module
PRDs. The real non-DJI warp fixture gap and Grade GPU DNG integration remain
open. Host full-image buffers remain; the quoted peak is GPU allocation, not RSS.
