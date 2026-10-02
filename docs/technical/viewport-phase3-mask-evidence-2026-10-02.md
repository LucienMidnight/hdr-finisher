# Phase 3 GPU mask rasterization evidence — October 2, 2026

Steve authorized committing the Detail/near-black fixes and continuing the
sprint. Those fixes are commit `fe43970`; this next stage is still uncommitted.
Phase 3 remains open and phase 4 has not started.

The tiled route now rasterizes neutral-geometry paths (straight or Bezier,
hard or symmetric feather) and brushes without whole-mask feather/shift on
the GPU. Tiles receive compact geometry, never a CPU-generated native mask.
Brush geometry is culled by tile while retaining pressure, low-flow buildup,
opacity, erase/repaint order and inversion. Oversized geometry and unsupported
forms retain the established fallback. Painted-peak feather normalization,
trial gradual-mask limits, source/measurement budgets and shader pins are
unchanged. Eligible paths/brushes also rasterize on GPU at Fit/Direct scales
up to the existing small-mask edge, using the source frame already resident.
Transformed geometry, brush whole-mask feather/shift,
outer-boundary paths and expression graphs still need subsequent work.

The first fixture capture exposed one hard-path mismatch at source pixel
(3154, 4155). Despite the permitted mask edge displacement, its luminance
error was 51.3423%, so it failed the unchanged picture ceiling. A 32×32
native-coordinate probe reproduced exactly one mismatched pixel. At that
pixel the GPU reciprocal approximation gave y=0.521523654460907; CPU rounded
division gave y=0.5215235948562622. This crossed the path boundary. Residual
correction of GPU division restores the CPU coordinate and intersection.
Bezier flattening also follows CPU float32 terms and partial sums.

`tests/mask-raster-reference.js` compares actual GPU r16float tile output to
CPU export masks: 45 cases, 271,360 pixels, including the native-coordinate
regression. Hard coverage classification has zero mismatches; level error
is at most 1.1 (the test bound, not the product tolerance). Path vertices
are exactly checked against CPU float32 flattening. Seven Node packing and
shader-contract checks pass. These short tests open no project.

One fresh as-saved four-mask HDR-centre capture uses the app-selected tiled
route, processing scale 1, 1,947,690 paired pixels. `--enforce` passes picture,
masks and peak. Luminance p99/max are 0.347%/0.712%; OKLab p99/max are
0.00168/0.00390. The GPU path has zero mask-level error and zero edge offset.
The gradient remains exact. Existing whole-source GPU luma has maximum
2.13 levels (39 pixels above 2, none above the trial 3); CPU soft brush has
maximum 1.00 levels. This does not establish a brush speed or feathering
improvement. No long-session or timing suite was repeated for this slice.

Raw artifacts remain ignored in
`codebase/output/performance/review/viewport-phase3-2026-10-02/`:
`mask-raster-fourmask.json` (initial failure), `mask-native-edge.json`,
`mask-native-edge-fixed.json`, `mask-raster-final-kernel.json`, and
`mask-raster-fourmask-fixed.json` with capture/comparison companions.
Fixtures were opened read-only and never saved. Export was unchanged.

Next: per-region luma and brush feather without losing normalization;
control/Match gaps; navigation/scopes; remaining Detail and 50-local checks.

## Regional luminance follow-up

HDR ungraded source regions now supply leaf luminance masks directly. The
source request includes the feather halo and starts on the whole-frame
downsample grid (common alignment across luma leaves). The region cache key
and mask placement include its frame rectangle; feather distance still uses
the full frame dimensions. SDR, transformed source identities and expression
graphs retain their existing contracts. Very large common alignment falls
back to the established source route. The blur algorithm is unchanged.

Eight small GPU regional/whole-source comparisons, 8,192 paired pixels,
cover zero, narrow and reduced-resolution feather, with and without inversion.
All eight have zero mask-level difference. `luma-region-kernel.json` records
the tested regions; this check does not prove export agreement by itself.

One fresh four-mask HDR-centre fixture capture, 1,947,690 paired pixels,
uses `gpu-luma-region`. Picture and mask metrics are identical to the preceding
passing capture. Its peak verdict initially failed: the new display feather
halo accidentally reached the bounded measurement planner and exceeded the
four-million-pixel budget, correctly refusing the estimate. The panel then
reported preview-only 2,460 nit against export 3,208.967 nit (23.3398% low).
No tolerance was changed. The display and analysis halo contracts are now
separate: analysis continues using its established qualified bounded masks.

A separate post-fix `editing-peak-bounded.js` check passes all four HDR/SDR
maximum/robust calls, preserves the picture/resources, and enforces the 1%
HDR maximum limit against the already measured export reference. HDR maximum
is unchanged at 3,207.1180556 nit, 0.0576% low, with 262,144 processed patch
pixels. SDR maximum is 0.53466796875; robust values are unchanged at
2.3784142300 HDR and 10.8340443755 SDR. These are fixture results, not a
universal accuracy guarantee. A full CPU comparison was not repeated after
this planner separation. Raw reports: `luma-region-fourmask.json` and
`luma-region-bounded-peak.json`. The fixture SHA-256 remains unchanged.

## SDR regional luminance follow-up

Export qualifies a luminance mask on the ACEScg scene picture in both lanes.
The SDR lane's source is that same picture unless Match or an authored SDR
base replaces it; the backend states which through the working space. An SDR
source region reported as ACEScg under the plain `source` identity now makes
its leaf luma masks exactly as an HDR region does, with the same aligned
feather halo. A Match or authored-base region is not scene luminance and
keeps the established fallback (soft bitmap, else backend tiles). A resident
region may stand in for a new request only when its origin lies on the
requested downsample cells; otherwise the aligned region is fetched.

Three Node routing cases (`tests/luma-region-routing.test.js`) and the
containing-region reuse test cover the lane/working-space rule and the cell
alignment. The eight regional/whole GPU kernel cases still have zero
difference (`luma-region-kernel-sdr-slice.json`).

One fresh as-saved four-mask SDR-centre capture, 1,947,690 paired pixels, on
the app-selected tiled route passes `--enforce` for picture, masks and peak
(`luma-region-fourmask-sdr.json`). Measured luminance p99/max are
2.015%/3.170% and OKLab 0.00207/0.00595, as in the preceding SDR capture;
every pixel is within one display level (maximum 0.94). The luminance mask is
now `gpu-luma-region`: maximum 2.13 levels, 39 pixels above the approved 2,
none above the trial 3. **This is the HDR lane's existing figure, and it is
larger than the 1.10 levels the SDR lane's CPU-made regional mask measured.**
It passes only under the unchanged trial gradual-mask limit and is listed in
`masksOverApprovedSoftLimit`; no limit was changed. Path and gradient remain
exact; the soft brush is 1.06 levels.

The bounded-peak check after the change passes all four calls with unchanged
values: HDR maximum 3,207.1181 nit (0.0576% low), SDR maximum 0.53466796875,
robust 2.3784142300 / 10.8340443755 (`luma-region-sdr-bounded-peak.json`).

One short SDR fifty-local session (`fifty-sdr-luma-region-smoke.json`, one
sample per action): Fit picture/scopes 42.1/519.3 ms; native zoom
772.4/1,741.1 ms, with zero backend mask-tile requests in either action.
There is no controlled before/after pair for this lane. In that zoom the
source region transfer alone took 487.5 ms (3,948 x 2,744 pixels, 87 MB, six
sequential chunks); native zoom still misses its goal. Both fixture hashes
are unchanged.

Not covered: SDR with Match active or an authored SDR base (fallback
retained), and luminance leaves inside expression graphs.
