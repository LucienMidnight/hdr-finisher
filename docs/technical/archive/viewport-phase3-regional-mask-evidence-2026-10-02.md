# Phase 3: shared analytic masks and regional expression graphs

October 2, 2026, working tree after `e3a5a7f`. No fixture saves or push.
Phase 3 remains open; phase 4 has not started.

## Implementation

Analytic gradients, neutral-geometry paths and unfeathered/unshifted brushes
now share one GPU texture over the union of a batch's tile halos. The scene
source can carry a larger luminance-feather halo; analytic textures exclude
that extra padding. Placement uses the existing local-mask sampling contract.
Each shared texture has one cache key, memory charge and owner; every tile
pins that owner. An uncovered/oversized region or oversized geometry retains
the established per-tile fallback.

Proper expression graphs of eligible analytic leaves and luminance leaves
now compose on the GPU from the scene region in HDR and scene-source SDR.
Their luma leaves contribute to the source halo and common downsample-grid
alignment. Region identity separates graph caches from whole-frame caches;
current regional outputs are marked before another local can trim them.
Leaf opacity, graph operators/inversion and the existing combine shader are
preserved. Degenerate/disabled graphs and unsupported geometry retain the
established path. Authored/legacy-match SDR source regions still use fallback.

No export/Proof, Peak or Denoise pixel code changed; shader pins and all
tolerances are unchanged. Brush whole-mask feather/shift and transformed
analytic masks remain outstanding.

### Follow-up: quarter turns and flips

Path/brush rasterization now inverts quarter turns and flips before evaluating
source-space coverage. Brush radius/aspect and stroke culling remain in source
pixels. Crop, straighten and perspective still retain fallback. Gradient
rotation/flip remains on its prior soft-mask path.

`orthogonal-mask-reference.json` expands the shared-mask CPU reference to 300
cases: 285 compact portrait/landscape and original cases, plus 15 additional
native hard-boundary permutations. All existing level bounds and exact hard
threshold checks pass. Peak/Denoise pins remain unchanged.

`orthogonal-mask-native.json` makes a session-only 90-degree turn plus horizontal
flip on the four-mask project. The app-selected HDR native tiled capture pairs
1,947,690 pixels with export and passes all verdicts. Luminance p99/max
0.381%/0.759%; OKLab 0.00201/0.00438. The GPU path mask is exact; luma remains
within the 2.13-level trial result. Gradient/feathered brush use existing soft
fallbacks (0.91/1.02 levels). This is one native transformed HDR region, not
a full transformed fixture/lane matrix. Four focused shape packing checks pass.

## Focused evidence

All Electron drivers ran serially at 2560 x 1440 with disposable profiles.
Artifacts are ignored under
`codebase/output/performance/review/viewport-phase3-2026-10-02/`.

`shared-mask-native.json`: as-saved four-mask native centre, 1,947,690 pixels
per lane, app-selected tiled route. Picture/mask/peak verdicts pass. HDR
luminance p99/max 0.347%/0.712%, OKLab 0.00168/0.00390. SDR has all pixels
within one encoded level. Gradient/path masks are exact; the existing luma
2.13-level trial result and brush soft fallback remain. This capture preceded
the reduction from scene bounds to the actual analytic tile-halo union.

`shared-mask-raster-reference.json` checks the final bounds through the actual
local-mask sampling shader: 45 CPU-reference cases, 271,360 pixels, brush
pressure/hardness/erase/repaint, paths/curves, inversion, portrait/landscape
and a native hard boundary. All pass; no hard-threshold pixel moves. It opens
no project and verifies every case shares one texture across multiple tiles.

`luma-graph-region-reference.json`: 12 synthetic cases, 12,288 pixels, union,
intersect, subtract and nested graphs, unequal leaf opacity, inversion and
feather 0 / 0.004 / 0.03. Maximum CPU-export difference 1.16993 of 255 mask
levels; regional versus whole-source GPU difference is exactly zero.

`regional-graph-native.json` initially checked an intersect of the project's
luma and path masks. Its centre coverage was zero in both lanes, so its
passing picture verdict is not evidence of visible combined influence.
`regional-graph-union-native.json` replaces it with a visibly active union.
Both lanes pass the unchanged picture/mask/peak verdicts over 1,947,690 pixels
each, app-selected native tiled route. Its combined GPU mask carries the
same 2.13-level luma difference (39 pixels over two levels) as the accepted
leaf mask. HDR luminance p99/max is 0.347%/0.712%, OKLab 0.00168/0.00390;
all SDR pixels fall within one encoded level. Gradient/path masks remain
exact. This capture also verifies the final analytic tile-halo bounds.

34 focused Node checks pass for mask ownership/placement, current-region
protection, routing, source coverage, cancellation, render lifetime and shader
pins. No broad suite or long interaction session was repeated.

## Fifty-local timing observations

The final `shared-mask-halos-fifty-{hdr,sdr}.json` drivers make one curves/wheels
edit at Fit, then native zoom and wait for settled GPU scopes/navigation.
Both make zero CPU mask-tile or auxiliary scope/navigation requests; stale
scope output is refused. At native the 25 analytic gradients own 25 textures,
instead of one per 24 foreground tiles (600 textures). Luminance leaves retain
their existing regional textures. Analytic bytes are 314,572,800; the first
overpadded implementation used 429,475,200 and was corrected.

| Native zoom | Picture, ms | Scopes, ms | Tiled stage, ms | Local-pass encode, ms |
|---|---:|---:|---:|---:|
| HDR | 560.6 | 1429.6 | 280.8 | 6.4 |
| SDR | 540.3 | 1442.1 | 284.4 | 6.9 |

Prior single observations were HDR 467.8/1400.0 ms and SDR 543.8/1442.4 ms.
These fresh runs establish reduced allocation multiplicity, not a speed
improvement or a complete fifty-local scaling/zoom-continuity exit.

## Follow-up: gradient quarter turns and flips

Eligible linear gradients now retain their original source-space axis under
quarter turns and flips. The GPU inverts the exact pixel permutation before
evaluating that axis, including the swapped frame dimensions. Each analytic
local still owns one shared regional texture. Fan/luminance-qualified gradients
and crop/straighten/perspective retain their existing fallback.

`tests/gradient-transform-reference.js` checks 128 combinations of both
portrait/landscape sources, four rotations, four flip states, inversion and
two midpoint pairs against CPU geometry-fixed masks. All pass: maximum
**0.1241 levels**, one shared GPU texture per case.

The four-mask native centre, rotated 90 degrees and flipped horizontally,
passes picture, mask and Peak checks in both lanes. Each lane compares
**1,947,690 pixels** on the app-selected tiled route. HDR luminance p99/max
is **0.375% / 0.759%**, OKLab **0.00201 / 0.00438**. All SDR samples are
within one encoded level. The gradient is explicitly recorded as a shared
`gpu-linear-gradient`, with maximum mask difference **0.03 levels**.
Luminance's accepted trial difference and the painted feather fallback remain
visible in the report. This verifies one native transformed view, not the
full resampling-transform or expression-graph matrix.

Artifacts: `gradient-transform-reference.json`, `gradient-transform-native.json`
and its captures under the existing ignored review directory. The fixture
hash remains unchanged. Focused checks now total **71 Node / 31 Python**, all
passing; Peak and both Denoise byte pins are unchanged.
