# Phase 3 straighten/perspective, wide-frame and Fit mask evidence — October 3, 2026

This continues the [native Feather slice](viewport-phase3-native-feather-evidence-2026-10-03.md)
from commit `fa2fdbc`. Three changes were built together and validated in
one combined GPU pass. Phase 3 remains open. No push, phase 4 work,
classifier change or fixture save is performed.

## 1. Leaf masks under straighten and perspective

Export finishes a mask in source space, rounds it to bytes, then warps it
with the picture: Pillow bicubic through `Image.rotate(expand=True)` or a
projective transform, a safe inset, the crop, and a clip to the whole
source mask's range. The GPU now does the same, for one output rectangle:

- `frontend/geometry-resample.js` computes that warp as arithmetic: Pillow's
  output-to-input coefficients, the largest-rotated-rectangle inset, the
  512-pixel perspective safe rectangle and the crop rounding. It is not a
  fitted homography.
- The source-space mask rectangle comes from the existing native producers
  under quarter-turn/flip geometry: shape and brush raster, linear gradient,
  native Shift, and the native feather field.
- `frontend/gpu-mask-resample.js` applies Pillow's four-by-four kernel to
  byte levels, clips to the mask's global range and rounds.
- The global range is scanned once per mask in bounded tiles and kept as two
  numbers. It matters for hard edges of masks that never reach 0 or 255.

`loadGpuResampledRegion` serves tiled native pictures (with per-tile
splitting for whole-picture catch-up) and `loadGpuResampledLeaf` serves Fit,
scopes and measurements. Brush (plain, Feather, Shift, both), path and linear
gradient leaves are covered. A picture whose size differs from the plan, an
unsupported leaf or a refused producer keeps the exact CPU fallback.

**Not covered:** luminance-range leaves (unchanged route), and combined
masks, whose leaves are warped individually as they already were on the CPU
path rather than composed before the warp as export does.

### Accuracy

- `tests/geometry-resample.test.js` (CPU only, about two seconds): 33
  roll/perspective/crop/quarter-turn/flip recipes reproduce
  `apply_geometry` pixel for pixel within 0.002 levels, and native output
  dimensions match for 44 recipe/size pairs including 9504x6336.
- `tests/mask-resample-reference.js` (GPU): 70 regions against exact export
  masks, whole frames at three compact sizes and viewports of a 4000-pixel
  frame. **68 are within 1.124 levels.** Two feathered-brush regions reach
  **two byte levels (2.06 as stored in half float) on six pixels in total**
  (five of 537,272 and one of 58,170). No pixel differs by more than two
  byte levels. Cause: where the GPU and CPU source masks round a byte
  opposite ways, export's bicubic kernel amplifies the one-level difference.
  This sits at, not inside, the general two-level approval. Steve accepted
  it for now on October 3 as close enough (P3-MASK-REVIEW-02): warped
  feathered brush masks at up to two byte levels only, not a wider limit.
- Primary fixture, native, 2 degree straighten: pixels, tone and masks pass
  in both lanes and three regions; brush and gradient masks at most 1.12
  levels with none over two (`resample-straighten-compare.json`). The paired
  baseline (`--disable-resampled-masks`) shows the same masks served as CPU
  mask tiles.
- Primary fixture, native, perspective vertical 15: brush and gradient masks
  at most 1.12 levels with none over two (`resample-perspective-compare.json`).

### Two faults found that this slice did not cause and does not fix

- **Peak under straighten:** the Peak verdict fails identically with and
  without the new route (preview 605.2 nit versus export 628.4, 3.7%). The
  scope panel shows its uncorrected "Peak (preview)" figure; the bounded
  editing Peak is not produced under straighten. Recorded as P3-PEAK-03.
- **Luminance mask under perspective:** the `clouds` luminance leaf reaches
  3.153 levels with 943 pixels over two in the upper-left region, both lanes,
  which fails the masks verdict for that run. That route was not touched; no
  paired baseline was run for perspective. Recorded as P3-LUMA-RESAMPLE-01.

### Measurements (single sessions, not medians)

`phase3-local-route-smoke.js --geometry straighten_angle=2`, primary, HDR:

| Step | CPU masks (baseline) | GPU resampled |
|---|---:|---:|
| First 100% zoom picture | 8253 ms | 3710, 3497 ms |
| First 100% zoom scopes | 8838 ms | 4108, 3916 ms |
| CPU mask-tile requests at 100% | 4 (3.1–4.6 s each) | 0 |
| Other CPU mask requests at 100% | 4 | 4, then 0 after the prefetch change |
| Fit brush stroke picture | 321 ms | 139, 145 ms |
| 200% scopes | 442 ms | 52, 53 ms |

Each warped mask takes 15–17 ms including its range scan. The remaining
3.5 s at first straightened zoom is the picture itself (the backend builds
the rotated frame), not masks. Artifacts: `resample-straighten-perf-1..2.json`,
`resample-straighten-baseline-1.json`.

## 2. Frames wider than one GPU texture

Native Shift and the feather field no longer refuse a frame wider than the
adapter texture limit (8,192 here). The painted-peak and interpolated-peak
scans tile columns, and a painted field whose bounds plus halo exceed one
texture is filtered in column tiles that carry the same complete halo as the
row bands, with coarse columns scissored like coarse rows. The device limit
is not raised and the picture pipeline is untouched.

Six regions of a 9000x3000 frame with a stroke spanning 96% of its width
pass at at most 1.124 levels (Shift plus Feather over three tiles, a narrow
reduced feather, and unfeathered Shift). No wider real fixture exists, so
this is reference coverage only, not an application run.

## 3. Fit-scale feathered brushes for scopes and measurements

A GPU bitmap made at exactly the requested scale is the mask at that scale
whether or not it qualifies as stretchable. `loadMaskLeaf` now returns it
for measurement and scope requests instead of compiling a CPU mask. In the
unstraightened stroke/Feather sequence the 1,600-edge CPU mask requests fall
from 3/1/1/3/1 per step to 1/0/0/1/0. The requests that remain are the
3,200-edge compiles of the deferred P3-FALLBACK-01, unchanged. Feather steps
measure 1119–1148 ms against 1213–1363 in the previous session (single
sessions); the 100 ms goal remains far off. Artifact: `fit-bitmap-perf-1.json`.

## Validation

- Node: **408** tests pass (ten new).
- GPU references in one pass: 70 resampled (above), 114 native Feather
  including the wide frame, 52 native Shift, 804 rounded brush.
- Python: 117 frontend-contract, verdict and softness tests pass. No backend
  code changed; the full backend suite is not repeated.
- All three fixture hashes match after the GPU runs.
- Not run for this slice: a capped-memory pressure replay and repeated
  sessions. Timings above are single observations.

## Remaining

Combined masks and luminance leaves under straighten/perspective; the two
recorded faults; straightened first zoom (3.5 s, picture source); the
two-byte-level decision; Fit stroke/Feather, first native zoom, scopes and
pan targets; coverage audit; 30-minute endurance. Existing deferrals are
unchanged.
