# Phase 4 follow-up 2 — tiled admission and truthful scopes

**Recorded:** 2026-09-19  
**Sprint:** [Stable Exact Preview Tiers and Full-Resolution Processing](../product/Stable_Exact_Full_Preview_Sprint_PRD_2026-09-19.md)  
**Commit:** `a552aed` on `main`  
**Status:** complete

## Result

The live GPU render path now acts on `plan.decision.mode === "tiled"` before it
allocates the Direct graph. A graph that does not fit the configured logical
budget therefore uses the already-proved tiled encoder at the selected tier;
admission no longer stops at a diagnostic decision or depends on a Direct
allocation failing first.

`renderTiledTo()` and normal admission call one
`encodeTiledGeneration(canvas, context, proxy, surface, pipelines, params,
options)` implementation. The accepted presentation records `execution` as
`"direct"` or `"tiled"`.

## Scope dependency

A tiled generation deliberately has no whole-frame finish texture. On entering
the tiled encoder the renderer deletes the canvas's previous `scopeSources`
entry. `gpuScopeEligible()` rejects a tiled accepted presentation, and the
second GPU-wait guard in `refreshScopes()` also exempts it. A current tiled
presentation therefore takes the existing CPU scope route. A late GPU readback
cannot make an older Direct scope look settled for the tiled generation.

This is deliberately a correctness-first fallback. It is slower than analyzing
a resident Direct finish texture, but it preserves the section 11 requirement
of zero stale scope presentations until Phase 7 provides a tiled GPU scope
source.

## Discriminating browser evidence

`codebase/tests/tiled-admission-scope-fallback.js` lowers the renderer to the
minimum custom budget (0.25 GiB) and supplies a warm-cache planning fixture so
the small built-in source exceeds that budget. This exercises the real planner
and normal `renderGpuDraft()` path without allocating hundreds of megabytes
solely for a routing test.

Measured on headless Edge with WebGPU enabled:

| Assertion | Result |
|---|---:|
| Planner decision | `tiled` |
| Violated Direct rule | `budget` |
| Accepted execution | `tiled` |
| Tiles / submissions | 4 / **1** |
| Tiled working set | 8,388,608 bytes |
| Previous whole-frame scope source retained | **no** |
| Scope route after acceptance | **CPU** |
| GPU scope calls during refresh | **0** |
| Scope freshness after refresh | **Settled**, not Updating |

The first version of the test raced an automatic scheduled render and correctly
failed: the manual result was superseded even though the tiled encoder itself
completed. The final test waits for outstanding render and scope work before
forcing admission, so it proves this branch rather than scheduler timing.

## Regression evidence

| Suite | Result |
|---|---|
| Seven deterministic Node suites | **69 / 69 passed** |
| `tiled-admission-scope-fallback` | **PASS** |
| `tiled-direct-parity` | **maxDelta 0**, 0 differing pixels at 256 and 512 tiles |
| `gpu-scope-parity` | **PASS** for histogram, waveform, vectorscope and SDR modes |
| `gpu-highlight-compression-parity` | **PASS** |
| `webgpu-shader-compilation` | **PASS** |
| `sdr-match-gpu-interaction` | **PASS** |
| `sdr-gamut-gpu-parity` | **PASS**, maximum absolute error 0.00001210 |

The Python suite was not rerun because this follow-up changes only frontend
JavaScript and its browser harness. The existing Phase 4 baseline remains
`1208 passed, 3 skipped`.

The isolated server ran at `http://127.0.0.1:8765` and was stopped after the
browser runs. No application or server process is intentionally left running.

## Remaining ordered follow-ups

1. Engineering-only Full selection.
2. Native-resolution Direct/Tiled parity at 42 MP.

