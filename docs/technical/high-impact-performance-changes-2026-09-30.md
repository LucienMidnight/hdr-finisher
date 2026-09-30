# First targeted performance changes — September 30, 2026

Steve authorized targeted optimization before completing the wider measurement gates, followed by focused verification and a later active-edit endurance replay. The original stall occurred during active editing, probably around 30 minutes and definitely within one hour; a multi-hour reproduction is not the primary target.

## Changes

Brush rasterization now allocates and accumulates each stroke within the union of its existing conservative capsule bounds. Previously, segment evaluation was bounded but stroke allocation, paint accumulation and erase attenuation traversed the whole image for every stroke. Stroke order, pressure, flow, opacity, erase restoration, feathering and geometry remain the same.

Post-Match presentation now treats transient GPU supersession as cancellation: it waits for pending edits/render work, reuses an already accepted exact frame or retries GPU once. If cancellation repeats, it arms replacement work and reports preview updating. Genuine unsupported/failure routes retain CPU fallback. It does not claim an exact frame is ready when work is deferred.

## Focused verification

The isolated brush A/B used the saved fixture's three brush leaves, totaling 51 strokes. Each function was timed once per leaf/edge, and both returned float arrays were compared with exact array equality, including erase attenuation. These are microbenchmark observations, not tail estimates or full feather timings.

| Raster benchmark | Before ms | After ms | Speedup |
|---|---:|---:|---:|
| 1,606 × 1,071; 34 strokes | 239.1 | 85.5 | 2.80× |
| 1,606 × 1,071; 14 strokes | 112.4 | 25.5 | 4.41× |
| 1,606 × 1,071; 3 strokes | 66.9 | 35.4 | 1.89× |
| 7,362 × 4,908; 34 strokes | 8,127.8 | 4,820.9 | 1.69× |
| 7,362 × 4,908; 14 strokes | 2,458.5 | 630.8 | 3.90× |
| 7,362 × 4,908; 3 strokes | 1,993.5 | 1,533.8 | 1.30× |

All six comparisons were exactly equal. The native-sized benchmark uses an approximate 3:2 coordinate grid; it does not decode or render the RAW.

The focused Electron driver opens the heavy project in a disposable profile, keeps automatic highlight anchors, performs three alternating native brush-feather gestures in each lane, then Match. It never saves. The before run temporarily restored only the original brush rasterizer, then restored the optimized file in `finally`; both live runs used the new Match recovery. No other processing policy was changed for this comparison.

| Release → observed exact/ready/settled state | Original rasterizer ms | Optimized rasterizer ms |
|---|---:|---:|
| HDR feather, first edit | 951.5 | 645.9 |
| HDR feather, reverse edit | 979.9 | 640.9 |
| HDR feather, repeated value/cache reuse | 191.2 | 192.0 |
| SDR feather, first edit | 1,003.6 | 683.9 |
| SDR feather, reverse edit | 1,033.0 | 582.0 |
| SDR feather, repeated value/cache reuse | 166.8 | 178.7 |

The first two edits improved by approximately 32–44%. The repeated value is already warm and shows no material improvement; do not pool these cache classes into one percentile. This is three observations per lane in each fresh process, not an endurance distribution.

The final optimized run completed Match through observed settled state in 16,663 ms with **zero CPU `/preview/sdr` requests** and no recorded page errors. The original-rasterizer comparison also had zero CPU preview requests with the new recovery. Its Match took 20,007 ms; candidate work varies, so this is not an isolated estimate of the Match-recovery speedup. Earlier sprint traces recorded an additional 5–6-second CPU preview after Match; the focused run verifies its absence here rather than proving it can never recur.

The first optimized live attempt retained useful observations but failed only in summary formatting (`new URL` on a network record that uses `path`). It remains separately retained; the corrected final run completed. The Match integration test also exposed a redundant render's `peak:newer-render-started` race. It now waits for a current exact/ready presentation and uses the production recovery helper for the extra presentation check.

Passed: 154 Python local-mask/render-cache tests; 18 Node tests covering Match recovery, mask coordination and edit-sync behavior; Electron SDR Match integration, including GPU edits, materialization, undo/redo and reset. `git diff --check` passed.

## Artifacts and commands

Raw artifacts are ignored under `ai/codebase/output/performance/review/`:

- `brush-raster-before.py`, `brush-raster-after-module.py`, `brush-raster-ab.py`, `brush-raster-ab.json` retain the isolated comparison.
- `high-impact-brush-before.json` is the original-rasterizer live run.
- `high-impact-after-verified.json` is the completed optimized live run.
- `high-impact-after.json` preserves the earlier summary-formatting failure and must not be labeled a completed run.

From `ai/codebase`:

```powershell
.venv/Scripts/python.exe -m pytest tests/test_local_adjustments.py tests/test_render_cache.py -q
node --test tests/match-preview-recovery.test.js tests/direct-mask-coordination.test.js tests/edit-sync-retry.test.js
node tests/run-in-electron.js tests/sdr-match-gpu-interaction.js
$env:HDR_FINISHER_ELECTRON_WINDOW_SIZE='2560x1440'
node tests/run-in-electron.js tests/performance/high-impact-review.js --project 'D:/Photos/Play_Raw/Fantastic light over village - AdamFromCanada/DSC00950.hdrfinisher' --output output/performance/review/high-impact-after-verified.json
```

## Remaining work

The **22-second feather outlier is not yet declared fixed**. This pass reduces a demonstrated component and verifies the fresh-session workflow. Native mask compilation, large-radius blur, automatic-anchor overlap, request cancellation and cache churn can still produce long tails. The original minutes-long stall is still unreproduced.

Next, run a 30–45-minute active-edit endurance replay with these changes, matching the original workflow where known. Do not combine its observations with the earlier unoptimized endurance distribution. Wider sprint measurement gates remain open.
