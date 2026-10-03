# Phase 3 exit audit — October 3, 2026

**Continuation update:** [new evidence](viewport-phase3-continuation-evidence-2026-10-03.md)
supersedes the earlier test counts and the path/crop/authored-SDR gaps below
where explicitly verified. GPU outer paths, cropped graphs, bounded Shift
Edge and discrete luminance feathering have advanced. Native Shift Edge,
narrow unqualified brushes, resampling geometry and timing misses remain
open. The original tables are retained as the before record, not a claim
that phase 3 has closed.

## Current continuation status

The latest [regional eraser evidence](viewport-phase3-regional-erase-evidence-2026-10-03.md)
records a bounded native GPU route for qualified painted fields with exact ordered
erase/repaint attenuation. Three fresh sessions per mode reduce first-native
picture median from 2347.5 to 657.6 ms, and scopes from 2681.3 to 990.5 ms;
CPU mask-tile batches fall from one to zero. Saved and added-stroke recipes
pass all four native verdicts in both lanes and all three regions. Qualified
soft-leaf resolution also survives recreation after eviction. The 300 ms
zoom goal, native Shift, intrinsically narrow paint, resampling, primary
stroke/feather/scopes/pan and full endurance remain open. Phase 3 is not closed.

The following status supersedes the historical tables below. Full recipes,
three-run measurements and artifact links are in the continuation evidence.

| ID / area | Current result | Remaining work |
|---|---|---|
| P3-GPU-01 | Outer-boundary path forms, cropped index-geometry expression graphs and bounded Shift Edge are implemented and checked. Auxiliary analytic/Shift masks no longer unnecessarily request CPU drafts. | Native Shift Edge; narrow Feather brushes rejected through 3,200; straighten/perspective and graphs under resampling geometry still use exact CPU masks. No unsafe homography or stretched Shift Edge was enabled. |
| P3-PERF-01 | Packing-only paired A/B: 1,600-edge 25.6→4.0 ms and 3,200-edge 100.0→11.8 ms, 15 observations per mode, identical bytes. Binary classification avoids base64 conversion. | Complete-generation primary medians (three sessions): stroke 1,868.5 ms, Feather 1,247.6–1,584.2 ms, first native 2,310.6 ms. First-feedback and eventual anchor replacement are separated. CPU mask computation remains the major fallback cost. Deferred anchor algorithm is unchanged. |
| P3-PERF-02 | Retained rounded four-mask: stroke 70.2 ms; Feather 47.5–75.1 ms; 200% 167.6 ms, three sessions each and zero CPU mask-tile requests. Live Fan first feedback 6.8/6.9 ms HDR/SDR versus prior SDR 675.9 ms. | First four-mask native median 389.9 ms; scopes 403.6–789.7 ms. Primary/scope/geometry/pan goals remain unmet. No overall latency exit. |
| P3-COVERAGE-01 | Real photo-derived Ultra HDR with independently authored SDR is exported and actually decoded in a disposable fixture; native SDR picture/mask/Peak pass three regions. Remaining luma rails, Denoise, geometry, SDR control drags and fresh sessions/native pans exercised in both lanes. | The short fresh sessions establish >30 s active plus 30 s idle coverage, not 30-minute endurance or every possible native control combination. Measured geometry, brush and pan misses remain open. |
| P3-MASK-REVIEW-01 | Discrete six-box luminance feather and repeated boundary clamping fix native luma/graph failures: four-mask max 2.25→about 1.20; authored lower-right graph 4.36→0.82. Saved primary requires no wider tolerance. Steve accepted the exact rounded panels 228, 249 and 421. | Recorded exceedances remain case-specific; the general approved limit remains two. No further judgement is needed on these unchanged panels. Continuous-feather experiment was not retained. |
| P3-TEST-01 | Full Python 1,644 pass/three skips; full Node 362 pass. Serialized brush/path/admission/device-loss Electron checks pass. Stale assertions/fixtures are corrected and actual path-progress, auxiliary-mask and CPU-scope fallback faults repaired. | No recorded suite failure remains in these checks. These passes do not establish the missing GPU/performance exits. |
| Preserved decisions | Accepted Match and deferred Peak/automatic-anchor/SDR continuity work remain unchanged. Shader byte pins, 4,194,304-pixel editing Peak budget, exact export/Proof and zoom scheduling remain. | No new deferral, commit, push or phase 4 work. |

Steve accepted the three concrete rounded panels (228, 249, 421) on October 3
as visually close enough. P3-MASK-REVIEW-01's owner-review request is resolved
for those exact images; their recorded exceedances remain. The general
approved soft-mask limit stays two levels. This does not accept CPU coverage
gaps or waive performance targets. Steve directed a complete predefined
phase 3 pass with batched validation, followed by surgical attention to the
known residual issues; no phase 4 or commit/push authorization was given.

The subsequent integrated pass adds a five-minute primary fresh-work session
(400 operations, 30 s idle) and fifty-local pressure coverage. The latter
exposed an actual destroyed-texture submit and undercounted luminance
refinement allocations. Both faults are repaired and allocation/lifetime
tests pass. The final 0.75 GiB replay completes 75 operations, five cycles,
62.59 s active and 30 s idle, with zero page errors, no pending work or
registered budget debt. Local-mask registry bytes and reported residency
agree at idle. This is a cache-budget test, not a physical-VRAM cap claim.
Full Node now passes 366 tests. Three Shift Edge drags per lane at each of
Fit/native complete: Fit release medians 54.4/55.3 ms HDR/SDR; native
3,624.6/4,719.9 ms. Native Shift remains unfinished GPU work, dominated by
exact CPU mask compilation. No speed waiver or new deferral is implied.

## Historical audit before the continuation

The primary fixture as saved now meets the picture, mask and Peak checks in
three native regions in both lanes. The remaining GPU work has been advanced
and checked, with the gaps below collected for Steve. Phase 3 cannot be marked
closed: unsupported masks still reach CPU compilation, several interaction
targets are unmet and some coverage is missing. Phase 4 has not started.

## Delivered and verified

| Area | Result and evidence |
|---|---|
| Match | GPU candidates and exact CPU input reuse; 3.05 s primary / 4.99 s fifty-local accepted by Steve and committed earlier. Further speed work deferred. |
| Native SDR clipping | Matched SDR supports local -1 EV recovery of approximately 128,000 above-white pixels; both lanes pass native comparison. [Evidence](viewport-phase3-matched-sdr-native-evidence-2026-10-02.md). |
| Regional masks and graphs | Shared analytic tile-halo textures and scene-qualified expression graphs; fifty-local route uses 25 analytic textures instead of 600. [Evidence](viewport-phase3-regional-mask-evidence-2026-10-02.md). |
| Geometry and Fan | Quarter turns, flips and index-crop leaves; GPU Fan at Fit/regional; 960 reference cases pass. [Fan evidence](viewport-phase3-gradient-fan-evidence-2026-10-02.md), [crop evidence](viewport-phase3-brush-crop-evidence-2026-10-03.md). |
| Brush feather | GPU raster/blur/peak normalization, bounded qualification endpoint and larger GPU retry; 756 bitmap-reference cases pass. Final primary brushes stay within two levels at native. [Evidence](viewport-phase3-brush-crop-evidence-2026-10-03.md). |
| Detail | Exact three-box Texture, Sharpen remainder packing and signed HDR input; 80 compact global/local HDR/SDR control cases pass. Native local/global extremes and primary as saved pass picture limits. [Evidence](viewport-phase3-detail-zoom-evidence-2026-10-02.md). This is a control sweep and selected native states, not every native combination. |
| Independent SDR scene masks | Bounded HDR scene regions support different authored/legacy SDR bases and graphs. Compact cases and native legacy SDR with a common manual anchor pass. [Evidence](viewport-phase3-sdr-scene-mask-evidence-2026-10-02.md). |
| Viewport and auxiliary work | Subnative off-screen views use regions; fifty-local zoom sequences and same-scale ROI parity pass. GPU scopes/navigation and stale-scope recovery pass route checks. [Evidence](viewport-phase3-detail-zoom-evidence-2026-10-02.md). |

## Open issues and unmet targets

| ID | Issue | Status / evidence |
|---|---|---|
| P3-GPU-01 | Shift Edge, resampling geometry (straighten/perspective), unsupported path feather forms and cropped expression-graph eligibility retain CPU mask paths. Unqualified narrow feathered brushes still compile whole masks on the CPU. | Open implementation work; Steve has not specifically deferred it. The no-whole-frame-CPU-render exit is not established for every control/geometry combination. A mask compile is distinct from a whole-frame picture render, but still misses the GPU architecture requirement. |
| P3-PERF-01 | Primary brush/feather and first native zoom miss targets. | Final edited sequence: stroke 314 ms versus 100; feathers 367–1,351 ms versus 100; 100% zoom 2,115 ms versus 300. CPU fallback follows failed soft admission; GPU preparation/classification is also costly. 200% zoom passes at 165 ms. Single observations, not medians. |
| P3-PERF-02 | Four-mask stroke/feather/native zoom and scope settlement exceed goals in some runs; no complete timing exit. | Final four-mask stroke 110 ms, feathers 85–106 ms, 100% picture 388 ms and 200% picture 177 ms versus 100/100/300/300 ms goals. No CPU mask/scopes/navigation requests in that sequence. Fifty-local feathers 40–60 ms and native zoom 599 ms pass doubled picture goals, but scopes take approximately 437–972 ms. No complete all-module drag/pan/fresh-30-second benchmark is claimed. |
| P3-COVERAGE-01 | Real authored-SDR native coverage is incomplete. | Synthetic independent-source and derived legacy/manual-anchor checks pass. No separate real authored-SDR native fixture was supplied; the result is not a full authored-base sign-off. |
| P3-MASK-REVIEW-01 | One admitted compact fuzz mask differs by 2.333321 levels. The four-mask native luminance leaf reaches 2.126 levels in the centre (39 pixels over two) and 2.25 in the upper-left (62 pixels over two), in both lanes. Regional graph trials also exceeded two levels. | Existing three-level trial only; approved limit remains two. Final primary as-saved and the brush leaves in native GPU runs need no wider mask limit. The listed trial cases remain for Steve's visual judgement. |
| P3-PEAK-01 | Wide Clarity 100 / radius 3% reports Peak 19.2884% low; native neighbourhoods need 89.9M pixels versus the 4.19M budget. | Already deferred by Steve. Keep the 1% requirement and processing budget unchanged. |
| P3-PEAK-02 | Maximum isolated Sharpen reports Peak 9.3745% low despite being within budget; candidate patches omit export's maximum. | Already deferred by Steve. Legacy automatic-anchor disagreement also remains with the deferred Peak/anchor work. |
| P3-ZOOM-01 | SDR cross-scale block luminance p99 3.3494% versus the 2% typical limit. | Already deferred by Steve because it is close to the limit. HDR passes at 0.6838%. No eight-bit exemption is applied to averaged blocks. |
| P3-MATCH-01 | Match exceeds the original 2 s / 4 s goals. | 3.05 s / 4.99 s explicitly accepted and committed. No new decision needed. |
| P3-TEST-01 | Existing suite failures remain. | Python inventory count and Proof model field order; Node denoised-source highlight-anchor identity. Earlier clean-checkpoint Electron brush/path/admission failures remain recorded, not newly retested or fixed here. |

## Checks and limits of the result

Full Python suite: 1,641 passed, two failed, three skipped. This run preceded
the last crop/retry changes; the final focused backend/mask/comparison suite
passes 29 tests. Full final Node suite: 357 passed, one failed. The known
highlight-anchor identity failure remains; Peak/Denoise shader byte pins pass.
The final cropped primary native comparison passes all four verdicts and
lists no mask above the approved two-level limit. GPU bitmap, cropped analytic
and native brush comparisons pass as recorded in the evidence document.
The existing SDR-byte presentation structure check also passes three Clarity
radii and ten Softness/Microcontrast states, now including 0/100 Softness,
−100/0/100 Microcontrast and mixed extremes. Its added GPU/CPU disagreement
is at most 0.020 levels mean and one level at p99.9 for those structure states.
This complements the Detail matrix; it is not a native float-HDR sign-off.

No tolerance, native measurement budget or CPU export/Proof algorithm was
relaxed. Immediate discrete zoom and the 80 ms continuous debounce remain.
Fixture hashes are unchanged:

| Fixture | SHA-256 |
|---|---|
| Primary | `246ba308dcba22c5483c32ed4c31f5c81a2804504cd01dec2482b6d5be307d56` |
| Four-mask | `3004b621783d77d7fefee6a1997392e1599954ab845b833208841fab1f4d1825` |
| Fifty-local | `00913f3d8214a211ff74d0791b5393dddf06c861e57994517354aa1a88e6acee` |

The accepted Match checkpoint remains the last commit. Subsequent changes
are in the working tree, with diagnostic artifacts in the ignored performance
output directory. No new commit, push or phase 4 work was performed.

The only owner judgement still requested by the existing policy is visual
review of the listed two-to-three-level trial masks. The implementation and
performance gaps above have not been silently accepted or marked complete.
