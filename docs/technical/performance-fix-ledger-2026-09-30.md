# Prioritized performance fix ledger — September 30, 2026

Steve requested investigation of all prioritized areas, targeted repairs, and a separate commit after each fix. This ledger extends the [first targeted pass](high-impact-performance-changes-2026-09-30.md). Measurements from different implementations remain separate.

| Area | Current evidence / action | Status |
|---|---|---|
| CPU masks / automatic anchors | Stroke-bound accumulation `2f12520`; bounded feather prefix sums `ce07ab9`; native scheduling remains a priority | Targeted pass complete; residual tails |
| Drag input backpressure | Tiled parameters/identities prepared once per generation `50e1116`; broader event-loop correlation remains open | Targeted pass complete |
| CPU routing / request churn | Post-Match recovery `6b0d83f`; CPU request coalescing/watchdog guard `9f9098d` | Targeted pass complete; native zoom fallback remains |
| GPU mask cache growth | Cancellation cleanup `8367099`; overlapping submission fence `fe35b3c` | Targeted pass complete; residency plateau observed |
| Match / cold Exact Peak | Candidate input reuse `05ee0b3`; peak sharing/currency `db8a4d0`; cropped peak reuse `6083326` | Targeted pass complete |
| Active-edit endurance | 30-minute replay plus 2-minute idle, 941 operations, automatic anchors retained | Complete; original stall not proven resolved |

## Bounded feather prefix sums

Each axis now runs independent row/column strips through the same edge-extended float32 prefix-sum filter. Vertical strips are transposed to contiguous rows. Summation order per pixel is unchanged. Scratch work stays bounded instead of allocating padding, cumulative, concatenation and result arrays at native frame size for every one of the twelve blur passes.

An isolated seeded 7,362 × 4,908 float32 mask, sigma 400, six horizontal and six vertical box passes measured:

| Implementation | Time ms | Process peak working set bytes | Float SHA-256 |
|---|---:|---:|---|
| Original whole-frame | 3,476.6 | 977,539,072 | `cdbbc69a929684e478d2d40453d6351496002af64bea6e67574f2834103cf463` |
| Bounded strips | 3,401.0 | 553,406,464 | Same |

This is one isolated observation per implementation, not a stable latency estimate. It demonstrates about 43% lower process peak working set with identical output. Early smaller-strip prototypes were 5–11% slower; the retained implementation uses larger bounded strips and avoids an extra division-result allocation. No full-workflow memory or endurance-tail improvement is claimed from this microbenchmark alone.

Verification covers axes, radii larger than image dimensions, non-divisible strip dimensions, low-alpha twelve-pass feather and quantization. Commands from `ai/codebase`:

```powershell
.venv/Scripts/python.exe tests/performance/mask-blur-benchmark.py whole
.venv/Scripts/python.exe tests/performance/mask-blur-benchmark.py strips
.venv/Scripts/python.exe -m pytest tests/test_mask_blur_strips.py tests/test_local_adjustments.py tests/test_render_cache.py -q
```

## CPU request churn

`renderPreviewForLane` previously aborted the lane's existing controller for every call, even when session, revision, generation, geometry, locals, resolution and execution inputs were identical. The recovery watchdog did not count CPU preview work as in flight and rearmed once per second. Together these could keep replacing a healthy long-running CPU request; earlier non-neutral local-curve samples started 21 requests.

Identical CPU requests now share the lane's in-flight promise. A changed render identity still starts fresh work; an older completion cannot remove the replacement record. The watchdog stands down only for a matching current-session/current-generation CPU flight, preserving recovery for obsolete work.

Before adding the watchdog guard, a heavy-project local-luma edit with request coalescing already produced **one completed CPU request and zero failed CPU preview requests per lane**: HDR request 5,364 ms / settled 7,248.1 ms; SDR request 5,534 ms / settled 7,553.5 ms. Each lane has one sample. The earlier 25–32-second samples had different cache and request-churn conditions; do not treat this as a homogeneous percentage-speedup estimate. The saved recipe still takes the supported CPU path for non-neutral local curves; no GPU eligibility or grading algorithm changed.

Raw evidence: `output/performance/review/cpu-singleflight-local-luma.json`. Regression tests verify same-input coalescing, generation/revision changes, failure retry, old-flight completion and watchdog recovery versus legitimate current CPU work. Subsequent regression covers the normal GPU Match path.

## Repeated tile preparation

The tiled path rebuilt each local's grade parameters for every tile's uniform slot and again for each local Detail pass. It also serialized the complete preceding brush-mask and grade history for every tile, even when no local Detail needed an identity. Those values depend on the render generation, not tile position.

They are now computed once per generation. Tile-specific positions and Clarity plans still populate their own slots. Local Detail prefixes remain exactly the same strings, including preceding masks, grades, opacity, lane and source scale. A render without local Detail avoids that serialization entirely. This removes repeated synchronous work; it does not establish how much of the previously observed slow mouse gesture was browser main-thread work.

Four dependency tests cover exact identity preservation, downstream invalidation, absence of unnecessary serialization, and lane/scale changes. Electron Direct/Tiled pixel parity checks use 256- and 512-pixel tiles with standard, maximum-radius and denoised grades; the completed optimized run has zero channel differences and passes Detail cache reuse and atomic presentation checks. The first optimized run failed the denoised 512-pixel capture (9.2181% differing pixels, max delta 255); a baseline comparison passed (one pixel differing by one), and the optimized repeat passed. The isolated failure remains a capture/render concurrency concern for follow-up, rather than evidence of consistently passing runs.

## Cancelled tiled generation cleanup

The mid-encode cancellation return skipped `popErrorScope`, peak-target release and post-submission cache trimming. Mask-load supersession also returned before cache trimming. Encoder exceptions skipped temporary-buffer cleanup. These are definite lifetime gaps, though the original endurance cache growth cannot be attributed to them alone.

Every tiled exit now schedules trimming after submitted work drains and overlapping render/scope lifetimes end. Device replacement prevents an old callback from trimming a new device's caches. The encoder's `finally` balances its validation scope and releases local/denoise parameter buffers on success, cancellation and exceptions; cancelled/failed encodes release their peak reservation. A pre-presentation refusal also releases its already-created local buffers and peak reservation.

Five regression tests cover cancellation, exceptions, successful peak-readback ownership, queue/lifetime ordering and device replacement. Direct/Tiled parity and cache reuse are checked again after this change. A broader frontend contract check passes 16 of 17 tests; its remaining source-string assertion still expects CPU fallback directly inside `setSdrMatch`, which moved into the previously committed recovery helper. That assertion needs updating; the behavioral Match recovery tests already cover the helper.

The outdated Match source assertion was subsequently updated to follow the recovery helper and its selected-edge CPU fallback. All 17 frontend contracts and 32 focused Node regression tests then passed.

A follow-up lifetime check tightened trim ordering: wait for active encoders to end, then drain their submissions, and repeat if a new render started during the drain. Waiting for an earlier queue fence before a later encoder ends would not cover that encoder's later submissions. A sixth cleanup test explicitly simulates that overlap and verifies no eviction occurs before the second drain.

## Match input reuse

Match candidates use the same source, geometry and spatial masks while varying editable SDR controls. Previously every candidate reapplied source geometry and compiled every active mask. A context local to one Match now retains the geometry-fixed source and read-only spatial masks; mask/geometry signatures distinguish changed inputs, and independent/nested calls have separate contexts. The context is released on success or failure. Candidate grading, search order, quality checks and the output recipe remain unchanged.

Heavy-project automatic-anchor comparison, one fresh-profile observation each, with the rest of the implementation held constant:

| Observation | Match settled ms | Backend materialization ms | Exposure candidate ms (9) | Semantic candidate ms (11) | RGB candidate ms (6) |
|---|---:|---:|---:|---:|---:|
| Input reuse disabled | 15,528 | 14,380.821 | 4,369.479 | 4,852.976 | 2,723.057 |
| Input reuse enabled | 10,429 | 9,308.504 | 2,721.770 | 2,884.107 | 1,650.774 |

Both runs evaluated the same 28 candidates, had zero CPU preview fallback requests and zero page errors. End-to-end Match was about 33% shorter in this pair; this is not a stable percentile estimate. Raw evidence: `output/performance/review/match-input-reuse-disabled-review.json` and `match-input-reuse-review.json`. Feather release samples in those runs stayed around 0.58–0.69 seconds for the first two edits and 0.17–0.19 seconds for the warm repeat.

All 39 Match input/materialization/state tests passed, including exact candidate pixels, exact complete calibrated recipe/quality/status equivalence against the unwrapped original path, stale geometry/mask prevention, translation-to-candidate reuse, failure cleanup and concurrent-call isolation.

## Exact Peak request ownership

Concurrent requests for the same Exact Peak key now share one native measurement. A session/import/revision/generation change makes its renderer currency callback false so obsolete mask loading/encoding can stop. Stale answers and refused/failed measurements do not populate the completed peak cache; later requests can retry. This does not reduce the intrinsic work for the first valid native measurement or change peak accuracy.

Seven regression tests cover concurrent/forced sharing, generation/revision/session/import invalidation, transient retry and replacement-flight ownership. All 17 frontend contract tests pass. Electron verification reports the same exact peak (7.5234375) for Direct and 256-/512-pixel tiled paths, preserves canvas/scope/diagnostic isolation, and verifies peak labels; its built-in small test pattern does not establish heavy-project cold latency or specular under-reporting.

A subsequent cache edge-case fix retains any valid finite peak, including a native geometry-cropped result whose shorter edge carries the existing `exact: false` disclosure. Failed/refused results remain retryable. An eighth regression verifies this reuse without changing its disclosure. This follow-up was made after the endurance replay; the replay did not exercise Exact Peak.

## Active-edit endurance after the targeted pass

The replay completed 30.08 minutes of active editing (84 cycles, 941 operations, including 17 Match operations), followed by two minutes idle. It retained automatic anchors and used the existing heavy project, without saving it. There were zero page errors, zero sampler errors, and no recorded GPU allocation backoff. The original approximately 30-minute interactive stall has not been proven resolved.

The frozen implementation was `fe35b3c76aa9b4bb0e7fcb2afb1349eee8126f4c`, with the existing uncommitted measurement instrumentation. Source hashes were checked unchanged during the replay. Evidence under `ai/codebase/output/performance/review/`: `long-session-after-targeted-fixes.json`, `long-session-after-targeted-fixes-summary.json`, and `long-session-after-targeted-fixes-code-manifest.json`. The raw artifacts are local ignored files; this ledger is the committed record. The photo project SHA-256 is `246ba308dcba22c5483c32ed4c31f5c81a2804504cd01dec2482b6d5be307d56`.

| Observation | After targeted fixes | Earlier endurance context |
|---|---:|---:|
| End GPU mask residency, decimal GB | 1.05 | 5.71 |
| End allocator registered bytes, decimal GB | 3.09 | 6.40 |
| Main backend peak working set, GiB | 17.06 | 23.53 |
| Main backend working set after idle, GiB | 0.81 | 0.81 |
| Worst SDR feather release, seconds | 16.00 | 22.13 |
| Worst zoom to 100%, seconds | 42.57 | 56.11 |

GPU mask residency plateaued around 1.03–1.17 GB by cycle 4; registered bytes settled around 3.05–3.09 GB by cycle 16. Allocator eviction counters do not count manual mask trimming. Electron GPU-process private memory is not a VRAM measurement.

These are directional comparisons, not matched latency A/B results: the earlier run completed 404 operations versus 941 now, repeated inputs have different cache histories, and its viewport/display metadata was not recorded. The current run used a 2560 × 1440 viewport at DPR 1 on the primary display. Repeated edits becoming warm also mean the aggregate medians do not establish performance for continually new strokes or inputs.

| Current operation | Samples | Median ms | p95 ms | Maximum ms |
|---|---:|---:|---:|---:|
| HDR feather release | 84 | 166.7 | 726.4 | 13,497.0 |
| SDR feather release | 84 | 162.6 | 9,980.2 | 16,001.8 |
| Zoom to 100%, total | 84 | 223 | 29,418 | 42,572 |
| Match, total | 17 | 9,048 | 9,737 | 10,723 |

The remaining tails coincide with costly native masks and CPU fallback. The worst zoom included a selected brush-mask request of 42.40 seconds (42.27 seconds reported backend CPU work), another mask request of 26.38 seconds, and a CPU SDR preview of 22.94 seconds. These overlap and must not be summed. Early small-edge SDR feather masks also took roughly 13.5–15 seconds while native background masks ran concurrently. Browser cancellation does not stop already-running server computation.

The next investigation should prioritize native automatic-anchor/mask scheduling, cancellation and contention, then the remaining native-zoom CPU fallback. Measure queue/lock wait separately from compilation before attributing the tails to a specific lock. A subsequent endurance run should vary strokes and inputs more aggressively to avoid measuring mostly cache reuse. The isolated denoised parity failure recorded above also remains open for focused capture/render concurrency investigation.

Final regression verification: **246 Python tests and 41 Node tests passed** across local masks, render cache, blur strips, Match inputs/materialization/state, frontend contracts, Match recovery, CPU sharing, tiled preparation/cancellation/lifetime, allocator behavior and Exact Peak ownership. Electron checks additionally covered Match GPU interaction, Direct/Tiled parity, cache reuse, atomic presentation and Exact Peak isolation. Each implementation fix has its own commit; preexisting measurement work remains separate.
