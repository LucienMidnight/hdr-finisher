# Phase 2 exit-gate evidence — frontend GPU planner and configurable budget

**Recorded:** 2026-09-19
**Sprint:** [Stable Exact Preview Tiers and Full-Resolution Processing](../product/Stable_Exact_Full_Preview_Sprint_PRD_2026-09-19.md)
**Source state:** worktree based on `309461d` (`main`)
**Application:** HDR Finisher 0.8.12
**Host:** Windows 10.0.26200; Node v24.14.0; Python 3.10.10
**Browser used for traces:** the in-app Chromium pane, **WebGPU unavailable**

## What changed

### A render plan replaces a bytes-per-pixel estimate

`buildRenderPlan()` enumerates every resource a Direct render of a given graph
would hold, one entry at a time, each with an `id`, a `category`, a `lifetime`,
and a byte count:

```
source-proxy · grading-core · grading-detail · spatial-film
denoise-evidence · denoise-resolved · denoise-reconstruction-scratch
cpu-mask-leaves · boolean-mask-nodes · scene-luminance
scope-pool · parameter-buffers · upload-staging · comparison-lanes
retained-presentation-overlap · contingency-margin
```

Lifetimes are `resident`, `cached`, `transient`, `overlap`, and `margin`, so
retained-frame overlap and transient scratch are admitted explicitly rather than
folded into one number. The function is pure, which is what makes the "planner
decisions are deterministic for recorded resource graphs" gate testable.

`planRender()` merges live renderer state into that plan — cached proxy levels,
CPU mask leaves versus Boolean mask graphs, scene-luminance entries, scope pool
bytes, parameter buffers, Denoise level count — so the plan describes this
session rather than a generic graph. The result is stored as `lastRenderPlan`
and exposed through `diagnosticsSnapshot().resources.plan`.

### The budget is a user preference that reaches the renderer

`maximumGpuMemoryGiB` already existed in the schema and settings UI from Phase 0
but was never delivered anywhere. `applyGpuMemoryBudget()` now plumbs it into
the renderer on every preferences change, and `initializeGpuPreview()` applies
the stored value when the renderer is constructed, so load order does not matter.

Auto is a stated 2 GiB application budget. Out-of-range values fall back to Auto
rather than to an arbitrary number. PRD 4.2's statement that WebGPU cannot report
physical VRAM is carried in the code comment at the constant.

### Admission chooses execution, never resolution

`decision.mode` is `direct` or `tiled`. There is no third value, so no plan can
express refusing a resolution. Violations are reported by rule name:
`maxTextureDimension2D`, `budget`, `formats`, `allocation-backoff`. The selected
tier rides along in `decision.tier` purely so traces can show that admission left
it alone.

### Allocation failure backs off and is recoverable

Every grading, Detail, and spatial texture creation in `ensureIntermediate` runs
through a `guard()` that records an allocation failure and abandons the graph by
returning `null`. `renderTo` treats a null intermediate as "not rendered", which
leaves the previous accepted presentation on screen through the Phase 1
retention path. The recorded backoff then forces subsequent admission to Tiled
until `clearAllocationBackoff()` is called — which raising the budget does.

### The backend stops deciding GPU viability

`estimate_preview_resources()` previously refused a preview on three grounds: a
16,384-pixel dimension bound, a 26 MP cap, and an 80-byte-per-pixel estimate
against measured host RAM. The 26 MP cap and the 80 B/px figure both model a
monolithic GPU graph the backend cannot observe, which is exactly what PRD 5.1
removes.

`allowed` now reflects only constraints the backend owns:

- the hard request-dimension bound, which is a property of the current request
  models rather than a resource heuristic (Phase 3 removes the need for it);
- **measured** host working memory.

The megapixel guideline and the unmeasurable-memory case moved to an
`advisories` list that never gates, and the payload carries an explicit
`decides_gpu_viability: false` so the boundary is visible to every reader.

## Gate 1 — Planner decisions are deterministic for recorded resource graphs

**Status: met.**

`codebase/tests/render-plan-admission.test.js`, 12 cases, all passing. It pins a
recorded 24 MP graph (RGBA16F source, Detail and spatial active, two-level
Denoise, one CPU mask, one Boolean mask pass, a scope pool, parameter buffers)
and asserts:

- two plans of the same graph are byte-identical;
- the entry list is exactly the fourteen ids above, in order;
- each entry carries the expected lifetime and byte count;
- `peakLogicalBytes` equals the sum of every entry;
- the 42 MP and 8K recorded graphs are likewise reproducible.

## Gate 2 — No heuristic memory estimate disables Full

**Status: met.**

Three independent checks:

1. `decision.mode` has only two values. The test
   `no heuristic disables a tier: an oversized graph is Tiled, never refused`
   drives a 42 MP four-level graph at the Auto budget and confirms the result is
   Tiled with `tier: "full"` preserved.
2. `test_render_plan_admission_never_expresses_an_unavailable_tier` asserts the
   string `"unavailable"` does not appear anywhere in `buildRenderPlan`.
3. Backend: `test_pixel_count_guideline_advises_but_does_not_disable_full` drives
   a 48 MP request with 48 GiB available and asserts `allowed is True`,
   `reason == ""`, `decides_gpu_viability is False`, and a megapixel advisory.
   `test_unmeasurable_host_memory_advises_but_does_not_disable_full` does the
   same for an unmeasurable-RAM host. `test_hard_request_dimension_bound_still_rejects`
   keeps the one genuine bound, and
   `test_full_preview_rejects_measured_host_memory_shortfall` keeps the one
   genuine measured constraint.

Browser trace confirming that admission moved execution and left the tier alone:

```
budget Auto (2147483648 bytes)
plan 7000x6000  mode tiled  peak 3003000000  violations ["budget"]
tier after admission  "4096"     selector value  "4096"
selector options ["1024","2048","4096"]   selector disabled  false
```

Raising the budget re-admits Direct without touching the tier:

```
applyGpuMemoryBudget(4) -> 4294967296
plan 4096x4096  mode direct  peak 1199570944  violations []
plan 7000x6000  mode direct  peak 3003000000  violations []
```

## Gate 3 — Allocation failure is recoverable and retains the current presentation

**Status: met.**

`an allocation failure is recorded, forces Tiled, and is recoverable` drives a
device stub whose `createTexture` throws:

```
ensureIntermediate(4096x4096) -> null           (render abandoned, not retried smaller)
allocationBackoff.kind        "grading-base"
allocationBackoff.reason      /Out of memory/
planRender(4096x4096).mode    "tiled"  violations ["allocation-backoff"]
clearAllocationBackoff()
planRender(1024x1024, 8 GiB)  "direct"
```

Retention itself is the Phase 1 path: a falsy render result leaves the accepted
presentation in place, which the Phase 1 evidence demonstrates in the browser
with a forced HTTP 500.

## Gate 4 — Denoise Phase 2 has an explicit enforceable logical byte budget

**Status: met.**

Denoise resources are three separate plan entries with distinct lifetimes:
`denoise-evidence` (cached), `denoise-resolved` (resident), and
`denoise-reconstruction-scratch` (transient). Their cost scales with the level
count, and the budget can refuse Direct execution on Denoise cost alone —
`Denoise levels carry an explicit, enforceable byte cost in the plan` shows a
1.5 GiB budget with four-level Denoise producing a `budget` violation. That is
what makes the budget enforceable rather than advisory.

This closes the Denoise Phase 2 memory stop gate's *budget* requirement. The
measured tiled-evidence traces the Denoise contract also asks for belong to
Phase 6 and are not claimed here.

## Regression evidence

| Suite | Result |
|---|---|
| `node --test` over four deterministic suites | `tests 31 / pass 31 / fail 0` |
| `tests/test_frontend_contract.py` + `tests/test_preview_resolution_contract.py` | all passing (6 cases in the resolution contract file, up from 2) |
| `tests/test_dng_resource_preflight.py` + `tests/test_api.py` | `44 passed` |
| Full Python suite | `989 passed, 4 skipped, 23 failed` |
| Failure list vs clean `83bca70` | **identical** — same 23 node ids |
| Playwright browser suites (14 non-GPU) | all PASS |

## Carried-forward items

1. **Tiled execution does not exist yet.** A `tiled` decision currently means
   "Direct was not admitted". Phase 4 builds the scheduler that acts on it. Until
   then a graph that fails admission still attempts Direct and relies on the
   allocation backoff, which is why the backoff path is tested directly.
2. **No GPU trace.** The in-app browser has no WebGPU adapter, so the planner was
   exercised through `planRender()` and a device stub rather than against a real
   adapter's limits and a real out-of-memory condition. The plan reads
   `adapterInfo.limits`, which Phase 0 captures from a live device.
3. **`upload-staging` and `comparison-lanes` are plan inputs with no live
   source yet.** `planRender` does not populate them, so they contribute zero
   until Phase 3 (staging) and Phase 7 (comparison) supply real figures. They
   are in the entry vocabulary so adding them later does not change the shape of
   the plan.
4. **The 16,384-pixel request bound still exists** in the backend request models
   and is still a genuine refusal. Phase 3's bounded tile transport removes the
   need for a single image-sized request.
5. The Phase 0/1 carried-forward items are otherwise unchanged.

## Verdict

All four Phase 2 exit-gate conditions are met, with no regression in the Python
suite or in fourteen browser suites. **Phase 2 is closed.**
