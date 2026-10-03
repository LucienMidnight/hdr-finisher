# Phase 3: GPU gradient Fan, October 2, 2026

Steve deferred P3-ZOOM-01 because its SDR continuity result is close to the
limit and directed continuation of other phase 3 work. Both Peak issues also
remain deferred. No requirement is closed or tolerance widened by that decision.

## Change

Linear-gradient Fan now runs on the GPU at Fit and on the bounded shared
regional/tile path, including quarter turns and flips. The shader implements
export's perpendicular-axis tanh and bounded fan scale, using the same
midpoint interpolation and source-coordinate placement as neutral gradients.
One parameter builder supplies both Fit and regional masks. Eligible Fit
gradients use the already loaded source's dimensions without a CPU mask
request or a new source fetch; cache identity includes Fan and geometry.
Cancelled/stale leaf requests return before allocating or starting fallback.

Nonzero Fan keeps continuous coverage in the half-float mask texture. Rounding
to a byte before storing that texture caused one-level disagreements at byte
ties plus half-storage error (maximum 1.115 levels). Removing that preliminary
quantization reduces the CPU-reference difference to 0.622 levels under the
unchanged 1.1-level reference-test guard. Fan zero keeps its existing byte
coverage. This changes neither export nor the painted-peak brush normalization.

Luminance-qualified gradients, crop, straighten and perspective retain the
existing fallback. Brush whole-mask feather/shift and other phase 3 exits
remain open. Peak-reduction and both Denoise shader byte pins are unchanged.

## Verification

- 640 CPU-reference cases: both source aspects; all quarter-turn/flip
  permutations; inversion; two midpoint pairs; Fan -1, -0.4, 0, 0.4 and 1.
  Maximum error is 0.621582 levels. Fit and shared-region mask readbacks agree
  exactly across every case. Each route must actually report GPU generation.
- 12 regional expression-graph cases, with maximum negative Fan in the
  nested graph: CPU maximum 1.169922 levels within the unchanged 3-level
  graph trial, and regional/whole-GPU difference zero. The deliberately
  different SDR base must request exactly one independent HDR scene region.
- 29 focused Node checks pass, covering route/cache reuse, stale-request
  rejection, scene-source routing, cache protection, resource cleanup and
  the audited shader byte identities.
- One native four-mask comparison with Fan +1: both lanes use the app's
  tiled route at 100%, covering 1,947,690 pixels per lane. Picture, mask and
  Peak verdicts pass the unchanged comparison tool. Fan-mask maximum is
  0.51 levels. HDR luminance p99/max is 0.352%/0.712%, OKLab
  0.00168/0.00390. SDR channels all stay within one encoded level (maximum
  0.94); raw luminance p99/max is 2.017%/3.170%, judged inside the limits
  under the already approved eight-bit presentation rule.

The native comparison was captured before the later Fit routing extension;
the final 640-case suite verifies that extension separately. This is focused
mask/control coverage, not a new speed baseline, CPU-export sign-off for Fit,
or phase 3 closure. No fixture was saved. The four-mask SHA-256 remains
`3004b621783d77d7fefee6a1997392e1599954ab845b833208841fab1f4d1825`.

## Artifacts and tools

Ignored reports under
`codebase/output/performance/review/viewport-phase3-2026-10-02/`:

- `gradient-fan-fit-region-reference.json`: final Fit/regional CPU comparison.
- `luma-graph-fan-sdr-reference.json`: independent-scene expression graphs.
- `gradient-fan-native.json` and its `-files/comparison.json`: native pictures
  and mask readbacks against CPU export.
- `gradient-fan-transform-reference.json` and
  `gradient-fan-transform-diagnostic.json`: initial quantization guard failure;
  `gradient-fan-transform-final.json`: precision repair before Fit extension.

Run all Electron drivers through the serialized disposable-profile wrapper,
at `HDR_FINISHER_ELECTRON_WINDOW_SIZE=2560x1440`. The native driver accepts
`--local-type linear_gradient --local-set mask.gradient_fan=1
--require-gpu-gradient`, modifying only the disposable document. The required
GPU assertion prevents a fallback from being mistaken for GPU validation.
