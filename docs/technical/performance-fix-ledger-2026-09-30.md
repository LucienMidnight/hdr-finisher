# Prioritized performance fix ledger — September 30, 2026

Steve requested investigation of all prioritized areas, targeted repairs, and a separate commit after each fix. This ledger extends the [first targeted pass](high-impact-performance-changes-2026-09-30.md). Measurements from different implementations remain separate.

| Area | Current evidence / action | Status |
|---|---|---|
| CPU masks / automatic anchors | Stroke-bound accumulation `2f12520`; bounded feather prefix sums `ce07ab9` | In progress |
| Drag input backpressure | Tiled local parameters and brush/grade cache identities built once per generation; broader event-loop correlation pending | In progress |
| CPU routing / request churn | Transient post-Match GPU recovery `6b0d83f`; identical CPU preview requests now share one computation | In progress |
| GPU mask cache growth | Identity/lifetime/eviction investigation pending | Open |
| Match / cold Exact Peak | Candidate reuse and peak-stage investigation pending | Open |
| Active-edit endurance | 30–45-minute replay after fixes, preserving automatic anchors | Pending |

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
