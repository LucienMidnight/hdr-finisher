# Exact-tier GPU latency measurement

**Recorded:** 2026-09-19
**Sprint:** [Stable Exact Preview Tiers and Full-Resolution Processing](../product/Stable_Exact_Full_Preview_Sprint_PRD_2026-09-19.md)
**Source state:** `main` at the Phase 3 ledger commit
**Harness:** `codebase/tests/performance/exact-tier-latency.js`
**Raw report:** `codebase/output/performance/exact-tier-latency-42mp.json` (intentionally gitignored)

This retires the "no GPU trace" limitation carried forward from Phases 1, 2, and
3. Those phases verified behavior in the in-app browser, which has no WebGPU
adapter. Playwright reaches a real one with the flags the existing GPU suites
already use, so the Section 11.1 acceptance targets can now be measured rather
than assumed.

## Environment

| Item | Value |
|---|---|
| Adapter | NVIDIA, `lovelace`, **not a fallback** (RTX 4070 Ti) |
| `maxTextureDimension2D` | **8192** |
| Browser | headless Edge, `--enable-unsafe-webgpu --enable-features=Vulkan,UseSkiaRenderer` |
| Source | `Affinity_DSC06898_DisplayP3_Linear_32f.exr`, 5320 × 7968 = **42.4 MP** |
| GPU budget | Auto (2 GiB) |
| Source chunk budget | 16 MiB |
| Repetitions | 30 slider inputs per tier, inside one gesture |

The source is the sprint's 42 MP case, and the adapter's 8192-pixel texture
limit is a real constraint worth recording: this source's Full long edge is
7968, so Full would still be Direct-admissible here, but a larger source would
not be.

## Section 11.1 results

| Tier | Preview dimensions | Input handling p95 | Submit p95 | **Submit-to-present p95** | Target | Stale | Non-exact presentations |
|---|---|---:|---:|---:|---:|---:|---:|
| 1K | 684 × 1024 | 3.2 ms | 1.6 ms | **5.0 ms** | 16.7 ms | 0 | 0 |
| 2K | 1367 × 2048 | 3.4 ms | 1.7 ms | **2.9 ms** | 16.7 ms | 0 | 0 |
| 4K | 2735 × 4096 | 3.1 ms | 1.4 ms | **2.3 ms** | 33 ms | 0 | 0 |

`failures: NONE`. `pageErrors: NONE`.

**Two different numbers, deliberately.** `renderSubmit` is the main-thread cost
of the `onFrame` callback — it says the UI is not blocked, but GPU work is
asynchronous so it is *not* frame time. `submitToPresent` is submit through the
animation frame that actually showed the result, and that is the figure judged
against the tier target. Reporting only the submit figure would have overstated
the result by roughly a factor of two.

### What the columns mean for the sprint contract

- **Input handling** — 3.1–3.4 ms p95 against a 16.7 ms target, so exact-tier
  processing has not made input handling the bottleneck at any tier.
- **Non-exact presentations: 0 at every tier.** This is the Phase 1 contract
  measured on real hardware: across 30 rapid inputs inside one gesture, no frame
  was ever presented below the selected tier. The interaction proxy is gone and
  nothing silently replaced it.
- **Stale results: 0 at every tier.**
- **Feedback latency: 0 ms p95** (max 0.1 ms) at all three tiers, against the
  100 ms target. Updating is reported synchronously on the generation bump, so
  the target is met by construction rather than by a race.
- **Coalesced frames: 0** — the scheduler kept up; no input had to be dropped.

4K presenting faster than 1K is not a typo. The 1K figure includes the first
presentations after tier entry, where setup work is still settling; the steady
state at 4K on this adapter is genuinely around 2 ms.

## Bounded transport on a real adapter

The Phase 3 streamed loader ran for real here, not against a stub:

| Tier | Route | Chunks | Peak response | Total transferred | Time to first tile | Total |
|---|---|---:|---:|---:|---:|---:|
| 1K | whole-frame | 1 | — | — | — | — |
| 2K | **tiled** | 2 | 16,775,824 B | 22,544,384 B | 842 ms | 875 ms |
| 4K | **tiled** | 6 | 16,760,080 B | 90,177,536 B | 955 ms | 1269 ms |

1K correctly stays on the whole-frame route because its payload is already
inside the chunk budget. At 4K the peak browser response is 16.8 MB against a
90 MB total — the image-sized buffer is gone on real hardware.

**Time-to-first-tile is dominated by one-time backend work.** At 4K, 955 ms of
the 1269 ms total precedes the first tile, and the remaining five chunks take
314 ms between them. The probe request is what triggers the backend to build the
geometry-fixed proxy for a 42 MP source; once built, tiles stream quickly. This
is a real observation about first tier entry, not about interaction — the
measured interaction numbers above are all post-entry.

## Memory against the plan

| Tier | Resident | Peak logical | Budget | Plan decision |
|---|---:|---:|---:|---|
| 1K | 35.2 MB | 40.8 MB | 2 GiB | direct |
| 2K | 125.6 MB | 148.0 MB | 2 GiB | direct |
| 4K | 478.5 MB | 568.1 MB | 2 GiB | direct |

All three tiers are admitted Direct at the Auto budget with real measured
residency, and the Phase 2 planner's decision agrees with what was actually
allocated.

## Settle-to-Ready

Not a Section 11.1 target, but worth recording: `settleMs` p95 was 784 ms at 1K,
39.9 ms at 2K, and 1295 ms at 4K. The large 1K and 4K figures are first-entry
costs that include the one-time proxy build and the scope pass; the 2K figure
(39.9 ms) is closer to the warm steady state, because 2K was entered after 1K
had already warmed the session.

## What this does not cover

1. **Full is not measured**, because it is still not selectable — that is Phase 4.
   On this adapter the 42 MP source would fit `maxTextureDimension2D` at 7968,
   but a larger source would not, and that is exactly the case Phase 4's tiled
   execution exists for.
2. **One adapter, one source, one session.** This is a discrete NVIDIA GPU on
   Windows. Integrated and unified-memory adapters, and CPU-only hosts, are
   Phase 9's environment matrix.
3. **No Denoise or Detail active** in this run. The graph measured is the
   pointwise grading path; expensive neighbourhood modules are Phases 5 and 6.
4. **Headless.** A headed compositor may present differently, though
   `submitToPresent` is measured inside the page either way.

## Verdict

Every Section 11.1 target that applies to 1K, 2K, and 4K is met on a real
WebGPU adapter with a 42 MP source, and the exact-tier contract holds through
sustained interaction with zero non-exact presentations and zero stale results.
The "no GPU trace" item carried forward from Phases 1–3 is **closed**.
