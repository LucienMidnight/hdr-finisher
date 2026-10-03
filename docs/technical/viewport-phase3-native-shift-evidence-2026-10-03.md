# Phase 3 native Shift Edge evidence — October 3, 2026

This continues the regional eraser slice and exit audit. Phase 3 remains open.
The owner subsequently authorized a checkpoint commit and next-thread prompt.
No push, phase 4 work, tolerance change or fixture save is performed.

## Implementation boundary

`loadGpuBrushShiftRegion` and `HDRGpuBrushMask.generateShiftRegion` implement
native Shift Edge with **Feather zero**. Pixel centres, stroke geometry,
ordered erase/repaint attenuation and crop/flip/quarter-turn placement remain
native. A steep shifted edge is never stretched from a smaller bitmap.

The painted peak is reduced across the uncropped native frame in reusable
256-row GPU bands. This is whole-field GPU arithmetic for normalization,
not a whole-frame texture allocation, CPU mask compilation, CPU picture
render or editing-Peak measurement. It does not change the 4,194,304-pixel
editing-Peak budget. Every painted stroke contributes, including offscreen
strokes; a tile maximum cannot substitute for the full-field maximum.

The regional field includes the sum of all six box radii on both axes,
clipped only at the physical frame edges. Prefix sums and subtraction run
on the GPU in float32, normalizing paint before the twelve blur passes as
export does. The original paint operand preserves expansion/contraction,
then inversion and native ordered eraser attenuation precede byte rounding.
The output texture covers only the foreground tile halos, with explicit
frame placement. A resident whole-picture proxy still derives its mask
bounds from foreground halos. Larger catch-up batches split into bounded
per-tile masks; these currently repeat the full-field peak scan.

Scratch admits at most 16,777,216 regional pixels and respects the adapter's
texture and storage-buffer limits. Refusal keeps exact fallback. Concurrent
requests share one inflight result; stale, cancelled or device-replaced
outputs cannot enter the cache. Scratch waits for queue completion before
release; retained outputs use the existing local-mask allocator and pins.

Shift with nonzero Feather, resampling geometry and a region that cannot
meet these allocation guards retain exact CPU fallback. This does **not**
close native Shift coverage generally, narrow-paint admission, geometry
resampling or phase 3. No classifier limit was changed. Peak/Denoise shader
pins, rounded brush producer, exact CPU Proof/export, existing owner
acceptances/deferrals and zoom scheduling remain unchanged.

## Accuracy and validation

Final 52 deterministic CPU-reference regions pass at at most
1.1240234375 levels, including density, a stronger offscreen stroke,
expansion/contraction, erasers/repaint, inversion, disabled masks, physical
borders, quarter turns, flips and 4,000-pixel native frames with Shift
extremes ±0.05. Reference guard is 1.13 levels, stricter than the unchanged
general two-level approval. Artifact: `native-shift-reference.json`.

The added +0.05 stress case first exposed two pixels with up to 12.00824
levels error. Its preserved original paint operand differed from export,
not the whole-field peak or blur halo. Export builds a display metric from
float32 source coordinates, applies its affine conversion in float64, then
rounds native mask coordinates and segment deltas to float32. An ideal
normalized raster skips those roundings; the difference is visible at the
almost discontinuous hardness-one capsule boundary.

A separate native paint/erase raster now uses compensated origin/metric
scaling and deltas rounded before endpoint reconstruction. The failed
pixels (2198,1653 and 2201,1653) and both native Shift extremes pass the
original guard. The existing rounded bitmap producer is unchanged and
**804** existing brush/feather/Shift CPU-reference recipes pass in Electron.
No large error is accepted, case-specific owner review requested, or guard
widened. Earlier metric/timing artifacts remain historical; final reruns
use `native-shift-metric-*` names.

`native-shift-metric-expand-compare.json` sets the first primary brush to
Shift +0.005 / Feather zero. `native-shift-contract-edited-compare.json`
applies the same added stroke used by the existing native driver, then
sets Shift −0.005 / Feather zero. Neither saves the fixture. All four
verdicts pass for **both recipes**, HDR/SDR and all three native regions,
each with 1,947,690 paired pixels. Shift maxima are 1.015 levels for
expansion and 1.066 for the edited contraction, zero pixels over two and
zero measured edge displacement. HDR luminance maximum is 1.587% for both.
The reader's “whole frame” name describes frame placement of the bounded
regional texture; it is not a full native mask allocation.

Node validation passes 379 tests (eight new native routing/lifetime tests).
Peak/Denoise byte pins pass. No backend/export implementation changed; the
already-green backend suite is not repeated for this frontend slice.
Syntax/diff checks pass. All three fixture SHA-256 hashes match the handoff.

## Measurement record

Three fresh enabled and three fresh disabled sessions each use three
alternating-direction drags per lane (nine observations per lane/mode).
They run serialized in mode blocks, not randomized/interleaved. Manual
anchors isolate controls, preparation is outside the clock, and the third
drag can reuse a mask from the first. These are not nine independent cold
compiles. The explicit `--disable-native-shift` driver override affects only
the new native regional method in a disposable session.

Final enabled runs use the repaired native metric. The disabled baseline
never enters that producer, so the unchanged three baseline sessions are
retained. Medians of the three session medians, milliseconds:

| Lane | Disabled release picture | Native release picture | Disabled scopes | Native scopes |
| --- | ---: | ---: | ---: | ---: |
| HDR | 3321.5 | 186.9 | 3680.0 | 556.5 |
| SDR | 4265.8 | 158.2 | 4624.0 | 531.3 |

Enabled picture session medians: HDR 186.9/255.0/147.7 and SDR
158.2/150.7/176.9. Disabled: HDR 3321.5/3321.9/3238.0 and SDR
4265.8/4264.4/4421.7. Across nine observations, CPU mask-tile batch
requests fall from 12 to zero **per lane**; twelve requests do not mean
twelve cold compiles (follow-up requests can hit the CPU cache).

Input-to-first-frame medians remain HDR 837.7 and SDR 864.9 ms, including
the nominal 500 ms pointer drag. No live-feedback or overall 100 ms exit is
claimed; scope settlement also remains slow. Regional GPU preparation is
measured separately in the raw mask-event records. The new native route
has no qualification bitmap readback/classification round trip. Auxiliary
and overlay work remain distinct; these results do not remove every CPU
mask request for every purpose.

Artifacts under `codebase/output/performance/review/phase3-continuation/`:
`native-shift-metric-perf-1..3.json`,
`native-shift-baseline-final-1..3.json`, and
`native-shift-metric-paired-summary.json`. Older `native-shift-perf-*` and
diagnostic artifacts precede the routing/metric repairs and are not final
benchmark evidence. One test-only diagnostic wrapper stalled and was
removed; only that verified disposable process tree was terminated.

The isolation intentionally sets Feather zero, unlike the earlier saved
feathered Shift benchmark (3624.6/4719.9 ms). It must not be reported as a
speed improvement for that earlier recipe. All runs use 2560x1440 and the
actual primary fixture, and never save it. Both final native export comparisons pass.

## Short pressure replay

`native-shift-pressure-final.json` completes 96 operations in six fresh-work
cycles, 67.625 seconds active plus 30 seconds idle, at a disposable 0.5 GiB
allocator budget. The instrumented replay records 13 successful native
Shift batches (including recursive split calls, not 13 independent
allocations), 389 evictions and zero errors. At idle, registered and resident
local-mask bytes agree at 112,421,462; allocator use is 476,776,830 bytes,
with zero reservations, over-budget debt or pending-destruction bytes.
Scopes settle and anchors have zero pending/inflight work. This checks the
new route under eviction pressure, not physical VRAM containment or the
outstanding 30-minute endurance requirement. An earlier uninstrumented
replay also passed with 406 evictions; the final instrumented artifact is
the route-coverage evidence.

## Remaining implementation

Next: native Shift plus Feather needs an accurate globally normalized
shifted field and export-aligned reduced feather grid, preserving native
edge placement. A homography or a qualified small shifted bitmap cannot
establish that. Narrow feathered paint rejected through 3,200, resampled
leaves/graphs, remaining primary/four-mask zoom/scopes/pan and stroke/feather
misses, coverage audit and final 30-minute endurance remain open. No new
owner decision or deferral is requested by this slice.
