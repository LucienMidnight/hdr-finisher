# Phase 3 Detail controls and subnative zoom — October 2, 2026

Steve directed that the wide-Clarity Peak discrepancy be recorded as an open
issue and that remaining phase 3 work continue. Section 14.9 of the PRD and
the [Texture/Peak record](viewport-phase3-texture-peak-evidence-2026-10-02.md)
retain the 1% requirement, the 4 MP processing budget and the deferred redesign.
The observations below do not close that issue or phase 3.

## Detail controls

`tests/detail-control-reference.js` checks the actual global/local Detail
pipelines, production half-float intermediates and Clarity high/remainder
maps against CPU `apply_detail`. Its structured 192x128 coloured source
includes narrow bright and near-black bands and a spatially varying local mask.
It covers low/default/maximum values of Texture, Clarity amount/radius,
Sharpen amount/radius/threshold in both lanes, plus local opacity 0, 1 and
0.35 with combined maximum Detail. Sharpen's default equals its lower bound;
opacity's default equals its upper bound. These duplicates are explicit.

All **80 cases pass** the existing 2% p99 / 5% maximum luminance limits.
Maximum error across the cases in each group:

| Group | Cases | Luminance p99 | Luminance maximum |
|---|---:|---:|---:|
| Global HDR | 18 | 0.1972% | 0.3443% |
| Global SDR | 18 | 0.1988% | 0.3436% |
| Local HDR | 22 | 0.1606% | 0.3585% |
| Local SDR | 22 | 0.1624% | 0.3288% |

This isolates Detail and local influence before output colour conversion;
it does not establish every native full-pipeline combination. An initial
test setup used an incompatible filterable float32 binding and produced black
output; the final test uses the production half-float source and checks GPU
validation errors.

A separate four-mask **native centre** comparison applies maximum Detail to
the existing path local, in both lanes: Texture 100, Clarity 100/radius 3%,
Sharpen 200/radius 3/threshold 0, opacity 0.35. Both picture and mask verdicts
pass. HDR luminance p99/max is **0.348% / 0.712%**, OKLab **0.00168 / 0.00390**;
SDR channel differences stay below one encoded level (p99 0.59, maximum 0.94).
The captured document confirms that local and both grades are enabled, and
161,994 of 1,947,690 mask samples are nonzero. Comparison with the saved-state
baseline shows hundreds of thousands of changed components, so this is an
active adjustment check. Its wide-Clarity Peak verdict remains a failure
under the same deferred bounded-measurement issue.

## Signed HDR stage order at maximum global Detail

A further native check uses Texture 100, Clarity 100/radius 3%, Sharpen
**200**/radius 3/threshold 0 in both lanes. The HDR centre initially fails
the unchanged 5% maximum luminance limit at two pixels (5.3085%). Isolated
Sharpen reproduces the outlier, including with every local disabled.

The GPU base stage clipped negative HDR channels before Detail; export keeps
them until Detail and locals finish. Clipping neighbours changes Sharpen's
luminance extrema fence even where the affected pixel itself is positive.
A 129x129 CPU diagnostic centred at (2535,4027) reproduces the export pixel
exactly: half rounding alone causes 0.00355% luminance error, whereas early
clipping causes 5.4284%. The base shader now preserves signed HDR colours,
retaining the final output clamp. CPU export is unchanged.

The final combined-maximum native comparison passes picture/mask limits in
both lanes across 1,947,690 paired pixels per lane. HDR luminance p99/max is
**0.427% / 1.007%**, OKLab **0.00191 / 0.00409**. SDR remains within one
encoded level. Its wide-Clarity Peak failure remains P3-PEAK-01. The isolated
Sharpen/no-locals final picture also passes: luminance **0.282% / 0.455%**,
OKLab **0.00038 / 0.00104**.

The signed-colour reference exercises the actual HDR base pipeline for neutral,
active and disabled grading as well as isolated grading: all **12 cases / 96
pixels** pass the existing 2e-6 channel limit. After the repair, 43 focused
Node checks (including Peak/Denoise byte pins) and 19 Python comparison-tool
checks pass. Fixture SHA-256 values remain unchanged.

## Separate Peak candidate coverage gap: P3-PEAK-02

With Sharpen 200/radius 3/threshold 0, Texture/Clarity off and all locals
disabled, Peak remains **3,638.8455 nit versus 4,015.2542 nit** over the full
CPU export, **9.3745% low**, outside the unchanged 1% limit. Highlight
compression is inactive; this failure concerns the Peak readout.

The forced bounded diagnostic renders 16 patches with a 58-pixel halo,
processing 952,576 pixels against the 4,194,304-pixel budget. It does not
refuse for budget. The export maximum lies at (4564,2939), and its containing
128-pixel patch (4480,2816) is absent from the selected patches. Ranking runs
before spatial Detail, so selection does not necessarily include the brightest
pixel after Sharpen. Only two export pixels are within 1% of the maximum.
The picture repair does not correct this coverage gap. Increasing an arbitrary
patch count is not established as a general fix.

P3-PEAK-02 remains open. Steve subsequently clarified that Peak was already
deferred and directed continuation of other phase 3 work. This decision
covers both recorded Peak issues; no accuracy limit or processing budget is
changed. Neither known readout failure requires another stop while that
deferral remains in force.

Artifacts: `detail-global-max-native{,-final}.json`,
`detail-sharpen-200-isolated-native.json`,
`detail-sharpen-200-no-locals-native{,-final}.json`,
`detail-sharpen-precision.json`, `detail-band-probe.json`,
`signed-hdr-base-reference.json`, and `sharpen-peak-diagnostic-final.json`.
Reports include disposable project captures, exact CPU export statistics and
preview readbacks. No fixture is saved.

## Fifty-local zoom routing

At custom **50%** zoom the viewer still shows only part of this large frame.
The previous application gate requested a region only at 100% or above,
so this transition rendered all 2660x3984 intermediate pixels. The gate now
allows any custom zoom to request a viewport region. The existing viewport
calculation returns no region when the complete image fits, preserving the
whole-frame Fit route. Discrete/continuous timing and pixel formulas are unchanged.

Serial Electron observations at 2560x1440, sequence Fit edit then
100%, 150%, 50%, 200%, 100%:

| Lane | Previous 50% picture/scopes | Regional 50% picture/scopes |
|---|---:|---:|
| HDR | 2639.6 / 2874.4 ms | 829.3 / 893.4 ms |
| SDR | 2586.2 / 2729.3 ms | 840.0 / 901.8 ms |

These are single observations, not medians or a long-session speed exit.
Both final sequences pass GPU picture/scope/navigation checks with no backend
mask-tile or CPU auxiliary requests and reject a superseded scope result.
On same-resolution pans, cached whole-picture scopes can settle before the
new foreground picture; these times describe separate events.

The driver now waits for pending zoom/pan coordination before accepting a
settled observation. Previously a same-edge zoom could appear settled before
its queued pan render, omitting picture timing and falsely reporting that the
later source serial advance came from navigation. This was a harness race.

An independent 50% whole-GPU/region-GPU comparison checks **1,947,690 visible
pixels per lane**, including the active local edit. HDR luminance p99/max is
**0.1364% / 0.4394%**, OKLab **0.000593 / 0.003381**. SDR differences are at
most one encoded level; even the non-exempt samples pass the unchanged
judged tone limits. Both routes pass the existing picture metrics. A raw HDR
encoded-channel epsilon of 1/255 initially failed (0.005859375 maximum);
that epsilon is not the approved extended-HDR picture policy. The final
comparison uses the existing reference tool's luminance/OKLab metrics and
SDR one-level policy, without widening any limit.

This A/B uses the whole-frame GPU output as its reference, not CPU export.
It verifies the new route at the same scale; it does not close cross-scale
8-screen-pixel continuity or every Detail/geometry combination.

## Artifacts and remaining work

Ignored artifacts under `codebase/output/performance/review/viewport-phase3-2026-10-02/`:
`detail-controls-reference.json`, `detail-local-max-native.json` and its
captures, `fifty-zoom-sequence-{hdr,sdr}-bounded.json`, and
`fifty-subnative-parity-{hdr,sdr}.json` with whole/region float readbacks.
All runs use disposable sessions and never save the fixtures.

Phase 3 remains open for painted whole-mask feather/shift, resampling mask
transforms, authored/Match SDR regional scene masks, broader native control
and zoom-continuity coverage, and the deferred wide-Clarity Peak redesign.
Phase 4 has not started. These changes remain uncommitted.
