# Phase 3 coverage audit and 30-minute endurance evidence — October 3, 2026

This follows the [source-space slice](viewport-phase3-source-space-mask-evidence-2026-10-03.md)
(checkpoint commit `e6dbae2`). It records the two exit runs Steve asked for
and two gaps the audit found and this work closed. No tolerance, classifier,
shader pin, export or zoom-scheduler change; no push or phase 4 work.

## 1. Coverage audit

`tests/performance/phase3-coverage-audit.js` (new) opens a project in a
disposable session, sets a geometry state at Fit, zooms to 100%, and then
makes one edit at a time, waits for the picture, scopes and automatic-anchor
work to settle, records the route, and restores the edit. A row is flagged
for a CPU picture request, a CPU scope request, a CPU mask request, a whole
native source transfer, a failed request, a CPU fallback, a page error, or a
picture that is not exact WebGPU.

- **Geometry states:** as saved (cropped), 90 degree rotation, horizontal
  flip, 2 degree straighten, perspective 15, and straighten with perspective;
  HDR and SDR lanes each.
- **Controls:** all 143 static controls outside the geometry panel on the
  saved geometry; one control per module and processing family (25) on the
  other states.
- **Masks:** for every saved local, opacity, invert, grade and the edits of
  its type (brush Feather, Shift Edge, stroke, erase stroke; gradient
  midpoint, Fan, end point; luminance Feather and range; path Feather), plus
  luminance combined with each other leaf type by union, intersect and
  subtract.

### Result (final run, after the fixes below)

| Fixture | Rows | Exact WebGPU tiled | CPU picture | CPU scopes | Whole native source | Page errors | CPU mask rows |
|---|---:|---:|---:|---:|---:|---:|---:|
| Primary (36 MP, five locals) | 938 | 938 | 0 | 0 | 0 | 0 | 8 of the deferred fallback, 3 fixed afterwards |
| Four-mask | 690 | 690 | 0 | 0 | 0 | 0 | 3 fixed afterwards |

Every straighten and perspective state has zero flags on both fixtures. The
only CPU mask requests left are the 3,200-edge compiles of the deferred
P3-FALLBACK-01 (a feathered brush whose bitmap no size qualifies for, 39–1,079
ms in the background), on index geometry. A targeted recheck after the last
fix shows six such rows on the primary and none on the four-mask project
(`coverage-audit-*-recheck.json`).

### Gaps the first audit run found, and their fixes

The first run flagged 98 rows on the primary and 60 on the four-mask project,
all under index geometry (as saved, rotate, flip):

1. **A combination containing a feathered or shifted brush compiled CPU mask
   tiles at 100% (about 4.7 s; 0.6 s with a gradient), and one requested the
   whole native source.** The regional graph route only holds leaves the shape
   rasterizer can make. Such a combination is now composed in source space on
   the GPU from the native producers and un-resampled luminance
   (`composedFrame`, `loadGpuComposedRegion`), the same composer the
   straighten route uses, without a warp. Native comparisons, all four
   verdicts passing: luminance ∩ brush 0.81 levels, luminance ∪ brush 1.11,
   four-mask luminance − brush 1.12, none over two.
2. **Gradient and hard-brush edits on a cropped image requested small CPU
   bitmaps (512 and 3,200 edge) they never used.** Zoom preparation judged
   eligibility with the crop in place; a crop only changes placement. It now
   uses the uncropped geometry, as the region rasterizer does.
3. **A measurement of a combination compiled a 1,600-edge CPU mask for its
   feathered brush leaf** (127 ms, once). The GPU bitmap made at the requested
   scale now serves it.
4. Superseded requests (aborted by design) were being counted as failures by
   the harness; only real failures count now.

## 2. Endurance

`heavy-project-long-session.js --fresh-work --pan-lane hdr --minutes 30
--idle-minutes 2`, primary, no memory cap, Match included, run at commit
`e6dbae2` before the audit fixes:

- **Complete: 29.96 active minutes, 112 cycles, 1,815 operations, zero page
  errors**, then two idle minutes with no pending anchors or mask work.
- No CPU picture or CPU scope request in the whole run.
- **No drift.** Median of the first ten against the last ten cycles:

| Operation | Median | First 10 | Last 10 | Maximum |
|---|---:|---:|---:|---:|
| Exposure drag, HDR / SDR | 870 / 855 ms | 880 / 842 | 880 / 881 | 1,721 / 2,052 |
| Clarity drag, HDR / SDR | 862 / 864 ms | 872 / 869 | 873 / 892 | 1,807 / 1,270 |
| Fresh brush stroke, HDR / SDR | 439 / 320 ms | 435 / 294 | 377 / 343 | 1,596 / 1,496 |
| Brush Feather drag, HDR / SDR | 1,065 / 966 ms | 1,016 / 952 | 1,037 / 1,026 | 2,665 / 2,131 |
| Zoom to 100% | 461 ms | 418 | 476 | 1,249 |
| Native pan | 1,136 ms | 1,137 | 1,138 | 1,485 |
| Zoom to Fit | 75 ms | 66 | 81 | 134 |
| Match (23 runs) | 2,868 ms | 3,012 | 2,397 | 3,451 |

  These totals are a whole scripted drag through settlement, not first
  feedback.
- **Memory.** Registered GPU memory rose to 4.4 GiB by the middle of the run
  and stayed there (4,408, 4,433, 4,418 MiB at cycles 63, 94 and 112) against
  a 6.1 GiB budget, with zero over-budget bytes. It is almost all the Detail
  band cache, which is sized from what is free.
- 589 CPU mask requests in 1,815 operations: 448 at the Fit edge, 127 at
  3,200, 8 at 512 and 6 overlay previews. The 3,200 requests are
  P3-FALLBACK-01. The audit fixes above address the Fit-edge and 512 ones on
  cropped analytic leaves; the endurance run predates them and was not
  repeated.

## Validation

- Node: 414 tests pass (one new).
- GPU: 12 regional graph references; three native comparisons of composed
  combinations; `editing-peak-bounded.js`; the audits above.
- All three fixture hashes match after every run.
- Artifacts: `codebase/output/performance/review/phase3-continuation/`
  `coverage-audit-*`, `composed-*`, `endurance-30min.*`.

## Limits of this evidence

- The audit makes one committed edit per control, not a pointer drag, and
  covers one control per family on the non-saved geometries.
- Its pan row did not move the view; pan is exercised by the endurance run's
  pointer pans instead.
- The endurance run used the saved (cropped) geometry only; straighten has
  the one-minute 0.5 GiB replay.
- The fifty-local fixture was not audited.
- The endurance run was not repeated after the audit fixes.
