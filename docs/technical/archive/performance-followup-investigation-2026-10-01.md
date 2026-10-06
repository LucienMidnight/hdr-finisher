# Performance follow-up investigation — October 1, 2026

Read together with the September 30 fix ledger. Existing measurement changes are retained. No source project or RAW writes are authorized or performed.

## Findings before implementation

An isolated native 7,362 × 4,908 synthetic source with the project's actual 34-stroke brush took 7,906 ms. cProfile attributes 4,038 ms cumulatively to brush rasterization (414 segments), 3,407 ms to feathering and 145 ms to the coordinate grid. These nested timings are not additive. Geometry/quantization account for a much smaller part of this identity-geometry fixture. No RAW decoding or real luminance-mask evaluation was included. Prefix sums took 1,440 ms; vertical strip copies alone took 620 ms, with additional scatter-copy work. Peak process working set was 2.10 GB. Evidence: `codebase/output/performance/review/native-mask-investigation.json`.

Mask flights are keyed by source epoch, edge, geometry, local ID and spatial signature. Grade-only revisions may legitimately share the same spatial work. Cancelled owners signal their event in `finally`; waiters checkpoint every 50 ms without cancelling useful owners. The diagnostic single-flight counter currently increments every polling iteration, so it describes neither distinct waiters nor distinct flights. Frame and scope flights still use unbounded event waits. Taking ownership away from a valid background owner would duplicate expensive compilation; there is no measured evidence that this is preferable.

Tile cache budgets derive from free allocator budget (80% Detail / 20% masks) with protected current-render entries. Proxy levels are capped and centrally evicted; stale geometry/source/region entries are invalidated. Local whole-mask caches have 96/160 MiB targets but retain current-render masks. Backend compiled masks have 96/160 MiB limits. These are useful caches, not proof of stale accumulation. Each tiled exit schedules its own idle trim/fence callback even if another trim is already pending. This is a definite redundant lifetime obligation; residency alone does not establish a leak.

Denoise analysis guards selector generation/session after source acquisition; cache identities include source and settings. Existing parity captures check frame serial, dimensions, selector generation/selection and two identical screenshots. They omit selector source/resolved identity and application generation, including equality across Direct and Tiled captures. A stable capture of two different inputs can therefore masquerade as a rendering difference. The historical 9.2181% failure's cause remains unknown; later passing captures cannot explain it.

## Ranked candidates

Benefit/risk are qualitative; accepted candidates are supported by the tracing above, others remain experiments or are rejected. No algorithm/tolerance change is proposed to meet a candidate quota.

| Area / rank | Candidate | Expected benefit / risk / evidence | Decision |
|---|---|---|---|
| Native masks 1 | Keep vertical box passes in transposed contiguous storage across all six passes | Removes repeated full-image gathers/scatters; low arithmetic risk if float prefix order is exact; measured copy cost | Implement; require exact float/quantized equivalence and isolated A/B |
| Native masks 2 | Profile real stroke capsules versus feather separately at native edge | Finds remaining algorithm/allocation costs; low risk; 414 fixture segments | Implement experiment harness |
| Native masks 3 | Fuse capsule operations with reusable ROI scratch | Potential reduction of brush temporaries; medium arithmetic/rounding risk; rasterization is largest measured stage | Defer until per-operation scratch prototype proves byte identity |
| Native masks 4 | Cache pre-feather brush raster | Feather-only edits could reuse strokes; medium residency/invalidation risk; fresh strokes still miss | Defer pending controlled reuse/memory experiment |
| Native masks 5 | Crop feather to brush bounds | Potential large savings; high correctness risk because prefix-sum order/edge extension and normalization can change | Reject this batch |
| Sharing 1 | Count distinct joined flight events instead of 50 ms polls | Correct diagnosis of contention; low risk; direct code evidence | Implement |
| Sharing 2 | Poll stale frame waiters instead of waiting indefinitely | Releases obsolete foreground CPU request even if owner remains alive; low risk; direct unbounded wait | Implement with blocked-owner regression |
| Sharing 3 | Foreground takeover of identical background flight | Could reduce priority inversion but duplicates native work; medium/high risk; no evidence of net benefit | Reject this batch |
| Sharing 4 | Dedicated mask worker admission limits/priority queue | Might reduce simultaneous bandwidth pressure; medium risk to HTTP worker throughput; historical queue maxima small | Defer to concurrency 1/2/4 experiment |
| Sharing 5 | Move proxy preparation out of cache lock | Could reduce 205 ms tail; medium source epoch/publication risk; historical native tail has negligible lock wait | Defer until lock-owner attribution |
| Residency 1 | Coalesce pending tile trims per GPU device | Removes redundant callbacks/fences and retained closures; low risk if replacement device keeps own obligation | Implement with overlap/replacement tests |
| Residency 2 | Aggressive idle eviction of all caches | Lower idle bytes, but destroys legitimate warm reuse; medium latency risk; observed residency below budget | Reject absent pressure evidence |
| Residency 3 | Trace resident categories and background drain through fresh edits/idle | Separates caches from unfinished work; low risk; existing replay supports this | Retain consolidated endurance experiment |
| Residency 4 | Lower Detail/mask cache shares | Might reduce memory but increases native rebuilds; medium risk; no measured overshoot | Defer controlled warm-return experiment |
| Residency 5 | Audit selector/proxy disposal on source changes | Potential stale lifetime defect; medium risk; current generation/protected-proxy guards exist | No proven defect to change; test denoise/source contracts |
| Parity 1 | Record selector source/resolved identity and application currency | Detects different-input comparisons; low risk; existing guards omit these | Implement capture contract |
| Parity 2 | Preserve screenshots and capture metadata before a failing assertion | Makes concurrency failures diagnosable; low risk; existing dump occurs after stability checks | Implement |
| Parity 3 | Repeat denoised 256/512 Direct/Tiled comparisons sequentially | Tests reproducibility; low risk; original failure isolated | Consolidated GPU campaign |
| Parity 4 | Change denoise/grading output or relax tolerances | Conceals cause; high accuracy risk; no consistent rendering failure | Reject |
| Parity 5 | Stress capture during source/selector replacement | Can distinguish stale capture from genuine same-input difference; moderate harness complexity | Defer broader stress; new currency checks fail explicitly |

Implementation and measurements are recorded in the fix ledger. Candidate benefits remain hypotheses until validation.
