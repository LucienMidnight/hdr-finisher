# Phase 3 Match CPU input reuse — October 2, 2026

Continuation from clean `b5b0a08` on `viewport-bounded-preview-phase-2-wip`.
Steve accepted these Match speeds for now on October 2 and authorized
committing this slice, then continuing to the next phase 3 task. The original
2 s / 4 s goals remain recorded; further Match speed work is deferred.
Phase 3 remains open; phase 4 has not started. No push was requested.

## Change and exactness

Match's 768-edge CPU HDR target now renders inside the fit's request-local
input scope. Its geometry-fixed source and immutable spatial masks are reused
by local translation and the final CPU SDR certification. The target still
uses the CPU export implementation with the same reference white, source
scale, locals and grain setting. Spatial masks are independent of lane and
grade; cache identity still includes geometry and spatial expression. The
scope releases all retained inputs on completion or failure. A supplied HDR
target remains supported. GPU failure reuses the CPU target while restarting
the complete fit on the CPU, with no recipe decision retained.

The neutral tonal search now owns one private adjustment copy for its 324
shoulder trials and another for its seven contrast trials. Every changing
scalar is assigned before each render; the search order, loss function and
CPU pixel operations are unchanged. Export/Proof, quality gates, source
budgets, mask qualification and all shaders are unchanged.

A short profile using the fifty-local project's settings on a synthetic
768 x 513 source found 876 ms in spatial-mask compilation and 322 ms in
tonal-analysis copies (profile overhead included). This established the
duplicate work; it is not a fixture latency baseline.

## Short observations

One disposable Electron session per project at 2560 x 1440, serial drivers,
app-selected GPU candidates. No other HDR Finisher work ran concurrently.
The prior column is the existing committed slice's single observation, not
a new controlled baseline or paired median.

| Match action to page return | Prior | This slice | Goal |
|---|---|---|---|
| Primary | 3.17 s | 3.05 s | 2 s |
| Fifty-local | 5.94 s | 4.99 s | 4 s |

Both fits return the same recorded recipe at the prior reports' precision
(those reports rounded Exposure Band values to four decimals), and exactly
the same CPU-certified quality, with `needs_review`, 28 / 11 GPU candidates, no CPU
fallback and zero CPU scope/navigation-preview requests. Candidate rendering
was not changed. These timings stop at Match's page return; picture delivery
and scope settlement were not separately measured in this slice.

| CPU stage | Primary prior / now | Fifty-local prior / now |
|---|---|---|
| Source proxy | 270 / 287 ms | 295 / 275 ms |
| CPU HDR target | 532 / 491 ms | 1,807 / 1,800 ms |
| Semantic/local translation | 186 / 17 ms | 1,048 / 124 ms |
| Neutral tonal fit | 455 / 329 ms | 219 / 135 ms |
| Final CPU certification | 289 / 280 ms | 1,430 / 1,454 ms |

The shared masks remove most translation time, but HDR target and
certification still cost about 3.25 s together with fifty locals. Both
projects remain above goal. Candidate/metric stage variation partly offsets
the primary's removed CPU work; two observations do not establish a general
speedup percentage.

`materialize_total_ms` now includes HDR-target rendering when no target was
supplied, because that render moved inside materialization. `settled_hdr_ms`
still reports it separately. Do not add those two figures together or compare
old/new materialization totals as if their timing boundaries were identical.

## Checks and artifacts

- 46 focused Python Match tests pass, including GPU certification/fallback,
  complete generated-recipe equivalence, stale geometry/mask identities,
  request isolation and cleanup. Two added tests compare the reused CPU HDR
  target and SDR render byte for byte with ordinary CPU rendering through
  straighten/flip geometry at both 100- and 203-nit reference white.
- A direct differential against HEAD's original tonal-fit function passes
  for all three projects' settings at both reference whites: six exact full
  adjustment-tree comparisons, unchanged caller input. It reads project
  settings only and does not decode native photos. Each before/after fit is
  one sample: primary approximately 365 to 284–287 ms; the two uncropped
  projects approximately 211–216 to 134–136 ms.
- All three fixture SHA-256 hashes are unchanged. No fixture was saved.
- All 10 focused Proof/export identity and peak-accuracy tests pass; all four
  shader-contract tests pass, including unchanged Peak/Denoise byte pins.
- No preview pixel, mask, Detail or native-zoom implementation changed, so
  those completed comparisons and long sessions were not repeated. The
  matched-recipe 100% clipping/Detail comparisons remain unverified.

Raw, local ignored artifacts under
`codebase/output/performance/review/viewport-phase3-2026-10-02/`:
`match-cpu-input-reuse-primary.json`, `match-cpu-input-reuse-fifty.json`,
`match-tonal-reuse-exact.json` and its diagnostic script
`check-match-tonal-reuse.py`.

The sandboxed Electron launch closed before its first window. The two actual
measurements ran through `tests/run-in-electron.js` outside that sandbox,
with disposable app profiles. No committed code was swapped for timing.

Steve's acceptance supersedes the recommendation to optimize the remaining
CPU Match stages next. Continue with the outstanding matched-SDR native-zoom
clipping/Detail verification, mask, Detail and scaling work in PRD 14.5.
