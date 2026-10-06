# Phase 3 GPU brush feather and crop evidence — October 3, 2026

**Continuation:** [October 3 follow-up evidence](viewport-phase3-continuation-evidence-2026-10-03.md)
supersedes this document's original survey and timing counts. GPU outer-path
forms, cropped graphs and bounded Shift Edge have added coverage; 804 direct
bitmap cases pass. Actual R16 sampling finds three admitted rounded trials
above the approved two-level limit (2.338917 maximum), rather than the earlier
ideal-R8 survey's single case. Current CPU/GPU/detail panels are linked there.
The continuous-feather experiment is not retained. Native Shift Edge,
unqualified narrow Feather brushes and resampling geometry remain unfinished.
Binary classification transport and paired packing measurements are also
recorded there; the original observations below are historical evidence.

GPU brush feather now preserves export's whole-mask painted-peak normalization,
six box passes per axis, reduced fractional blur, pressure, erase-after-feather,
inversion and byte quantization. The maximum is reduced on the GPU, without
reading a scalar back between passes. One bounded bitmap readback goes to a
classification-only endpoint: it prepares no source pixels, compiles no CPU
mask and changes no edit history. The existing 3,200-source-pixel cap remains.

The CPU-derived soft estimator reserves one extra level for the measured GPU
raster error. Without that reserve the initial fuzz admitted two masks above
the three-level trial. The production reserve rejects those cases; neither
the approved two-level limit nor the owner's three-level trial was widened.
Larger qualified GPU bitmaps are tried before the established CPU fallback.

Index crops use export's rounded, clamped source-proxy coordinates. Brush
normalization precedes cropping. Analytic gradient, hard brush and path leaves
evaluate their cropped regions in the uncropped source frame. Quarter turns
and flips remain supported. Shift Edge, resampling geometry and unsupported
path feather forms retain their existing fallbacks. Those are open GPU
implementation gaps, not newly approved deferrals.

## Reference checks

- 756 GPU brush/CPU bitmap cases pass within one byte level, including 500
  deterministic random pressure/erase/frame-edge cases, 160 crop cases and six
  large cases at 1,024/1,600/3,200 source pixels.
- Qualification against CPU masks at three times the bitmap scale tests 750
  compact cases. 141 are admitted; none exceeds the existing three-level
  trial. One exceeds the approved two-level limit, at 2.333321 levels. This
  remains an owner visual-review item. The six large cases have direct bitmap
  reference coverage; they are not included in that native-scale fuzz.
- 960 gradient/shape geometry cases pass: the earlier 640 gradient/Fan cases
  plus 320 cropped gradient, hard brush and path cases. Maximum error is
  0.621582 levels. Fit and regional results agree within the existing guard.

## Native primary fixture as saved

The final cropped-mask run captures three regions of 1,947,690 pixels each in
both lanes. All paired-pixel, tone, mask and Peak verdicts pass unchanged limits.
HDR luminance p99 is at most 0.729%, maximum 1.774%; OKLab maximum is 0.00534.
SDR passes the existing eight-bit presentation rule; its largest judged
luminance error is 2.182%. No mask uses the three-level trial in this run.

The main brush uses a qualified 2,003 × 2,003 GPU bitmap derived from the
3,200-pixel source proxy; the other feathered brush uses 320 × 320. Their
largest native mask errors are 1.12 and 1.48 levels respectively. The cropped
gradient and hard brush use the GPU; the hard brush's largest mask error is
1.02 levels with zero edge displacement. These measurements close the
primary-as-saved picture blocker, not the broader phase 3 exit.

The four-mask fixture with brush feather 0.05 also passes native picture,
mask and Peak checks in both lanes across three regions. Its GPU brush mask
error is at most 1.23 levels.

A final centre rerun after the conservative admission changes also passes
all four verdicts in both lanes and asserts that the brush uses the GPU.
Its qualified 641 × 960 brush bitmap differs by at most 1.06 levels, with
zero pixels above two. The luminance leaf still reaches 2.126 levels on 39
pixels and remains listed under the existing owner trial.

## Performance and remaining fallback

The primary stroke/feather/100%/200% sequence still misses targets after
unsaved brush edits. Observed picture times are 314 ms for a stroke,
367–1,351 ms for feather releases, 2,115 ms for the first 100% zoom and 165 ms
at 200%. Scopes take 871–1,903 ms for feather releases and 2,461 ms at 100%.
The added marks make some masks fail qualification even at 3,200 pixels;
their CPU whole-mask fallback remains. GPU compilation, readback and
classification also have measurable cost. This run is not a performance win
for those primary edits and is not a median benchmark.

The fifty-local sequence observes feather pictures in 40–60 ms and 100%/200%
zoom in 599/163 ms, within its doubled picture targets. Scopes remain slower
(437–461 ms after feathers; 972 ms at 100%). GPU scopes/navigation, latest
request recovery and the 512-pixel thumbnail guard pass. These are individual
observations and do not establish every interaction target.

The final four-mask stroke/feather sequence stays entirely on GPU mask,
scope and navigation routes: zero CPU mask requests, a bounded thumbnail and
successful stale-scope refusal. Picture times are 110 ms for the stroke,
85–106 ms for feathers, 388 ms at 100% and 177 ms at 200%. Some exceed the
unchanged 100 ms / 300 ms targets. Scopes settle in 443–482 ms after feather
and 816 ms at 100%. No latency limit was widened.

## Provenance

Artifacts are under `codebase/output/performance/review/viewport-phase3-2026-10-03/`:
`brush-feather-reference-final.json`, `crop-analytic-reference.json`,
`brush-feather-native.json`, `primary-crop-native-final.json`,
`primary-final-routes-crop-gpu.json` and `fifty-local-final-routes.json`.
The final four-mask route report is `four-mask-final-stroke-feather.json`.
The final native centre rerun is `four-mask-native-final.json`.
Runs use the RTX 4070 Ti, 2560 × 1440, DPR 1, serialized Electron and disposable
sessions. The primary, four-mask and fifty-local fixture SHA-256 values match
their recorded originals. No fixture was saved. Peak and Denoise shader byte
pins pass; export and Proof implementations were not changed by this slice.

See [the exit audit](viewport-phase3-exit-audit-2026-10-03.md) for all remaining
issues and validation limits. Changes after the accepted Match checkpoint
remain uncommitted and unpushed.
