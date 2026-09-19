# Phase 5 — masks, locals and the packed Detail band cache

**Recorded:** 2026-09-19
**Sprint:** [Stable Exact Preview Tiers and Full-Resolution Processing](../product/Stable_Exact_Full_Preview_Sprint_PRD_2026-09-19.md)
**Adapter:** NVIDIA `lovelace` (RTX 4070 Ti), not a fallback, headless Edge with
`--enable-unsafe-webgpu --enable-features=Vulkan,UseSkiaRenderer`
**Status:** **all four exit gates met.**
**Reference-hardware note:** this adapter reports `maxTextureDimension2D` of
**8192**, which is the case tiled execution exists for.

Phase 4 left tiled execution able to run only the pointwise graph: masks,
locals, Detail and the mask overlay were all named refusals. Phase 5 removes
those four refusals. `spatial film effects`, `vignette` and seeded `grain` remain
refusals and belong to Phase 7.

## What changed, and why each piece was necessary

### Full-frame dimensions became explicit shader inputs

Detail derives its radii from the image diagonal. When those radii were read
from `textureDimensions(sourceTexture)`, a tile-sized bound texture made every
tile compute its radii from the *tile* diagonal, which guarantees a mismatch
against Direct at any tier and is worst at Full. The parameter block grew from
162 to **166** slots:

| Slot | Meaning |
|---:|---|
| 160, 161 | tile origin in global output coordinates (Phase 4) |
| 162, 163 | valid tile extent |
| 164, 165 | full output extent |

`detailFrameDimensions()` reads 164/165 for radius derivation, and
`validTileDimensions()` reads 162/163 so sampling clamps to the part of the
bound texture that actually holds this tile rather than to the whole allocation.
Direct leaves all six at zero and falls back to the bound texture's dimensions,
so its arithmetic is unchanged — which is what makes the parity below a real
comparison rather than two paths agreeing because they share one code path.

### The band shaders stopped branching on amount

`detailHorizontalFragmentMain` and its three siblings previously skipped a blur
whose amount was zero. A cached band must not depend on the amounts that consume
it, or the cache key would be lying, so all four bands are now always computed.
This costs analysis on a frame where an amount is zero and buys a true cache hit
on every subsequent amount drag.

### Mask transport became bounded

`GET /api/session/{id}/local-mask-tile/{local_id}` serves one globally anchored,
haloed mask rectangle. **Mask compilation stays whole-image and authoritative**:
feather peak normalization and Boolean mask graphs cannot be made to agree at a
tile edge if each tile compiles its own mask, so only the *transport* is
bounded, never the semantics. This retires the 16,384-pixel ceiling on the mask
path (sprint carried-forward item 3).

`test_local_mask_tiles_reassemble_the_authoritative_global_mask` reassembles a
two-leaf intersect graph (linear gradient ∩ feathered brush) from deliberately
uneven 19 × 17 tiles with a 7-pixel halo and asserts the result is
**byte-identical** to the whole-frame mask the old endpoint returns.

### Detail band identity

`detailBandIdentity(params, inputIdentity, scope)` zeroes the slots that consume
a band without creating one — `149, 150, 152, 154` globally and `14, 15, 17, 19`
per local, i.e. texture amount, clarity amount, sharpen amount and sharpen
threshold. Every radius and every upstream input stays in the identity. A local
band's `inputIdentity` accumulates the global parameters and then each preceding
local's mask, grade and opacity, so an earlier local's change invalidates the
bands of every local below it.

## Exit gate 1 — mask and local results are seam-free

**Status: met, byte-exact.**

`codebase/tests/tiled-direct-parity.js` now renders a full local stack rather
than the pointwise graph alone: global Detail, plus a **Brush** local and a
**Path** local that each carry their own Detail, mask feathering and grade. Both
locals' masks reach the GPU only through bounded mask tiles.

| Radii | Capture | Tile size | Tiles | Halo | Submissions | Max channel delta | Differing pixels |
|---|---|---:|---:|---:|---:|---:|---|
| standard | 1058 × 597 | 256 | 12 | 33 | 1 | **0** | **0 / 631,626** |
| standard | 1058 × 597 | 512 | 4 | 33 | 1 | **0** | **0 / 631,626** |
| maximum | 1058 × 597 | 256 | 12 | 73 | 1 | **0** | **0 / 631,626** |
| maximum | 1058 × 597 | 512 | 4 | 73 | 1 | **0** | **0 / 631,626** |

The test's tolerance is `maxDelta <= 1`; the measured value is 0 in all four.

### Maximum-radius seam evidence

The `maximum` rows put every Detail radius at the top of its documented range —
clarity 3.0 %, sharpen 3.0 px — on the global grade *and* on both locals at
once, which is the largest halo the scheduler can be asked for. At a 256-pixel
tile the resulting **halo of 73** is a large fraction of the tile, so a halo even
one pixel short would show as a seam at every one of the 12 tile boundaries
rather than as a single edge case. It is byte-exact.

## Exit gate 2 — amount and threshold drags perform no band analysis

**Status: met.**

The trace runs five steps against 4 tiles × 3 band stacks = 12 cached bands, and
each step changes exactly one thing:

| Step | Global bands | Local bands | Analysis passes |
|---|---|---|---:|
| warm-up | 0 hit / 4 miss | 0 hit / 8 miss | 24 |
| identical repeat | 4 hit / 0 miss | 8 hit / 0 miss | **0** |
| last local's amount + threshold | 4 hit / 0 miss | 8 hit / 0 miss | **0** |
| global amount + threshold | **4 hit / 0 miss** | **0 hit / 8 miss** | 16 |
| global clarity radius | 0 hit / 4 miss | 0 hit / 8 miss | 24 |

The third row is the gate in its pure form: dragging the **last** local's amount
and threshold changes nothing upstream of any band and nothing downstream reads
its bands, so the whole stack is reused and no analysis runs at all.

## Local-stack invalidation trace

The fourth row is the discriminating one, and it is why the counters are split
by scope. A global amount drag **must** reuse the global bands and **must**
rebuild the local ones, because the global Detail composite is the locals'
input. A single combined counter would report `4 hits / 8 misses` for both a
correct renderer and one whose global cache simply did not work. Counting the
scopes apart is what makes the distinction visible, and the measured split is
exactly the intended one.

## Exit gate 3 — Detail peak residency bounded at 24 MP, 42 MP and 8K

**Status: met, and measured rather than modelled.**

`codebase/tests/performance/detail-cache-residency.js` renders each source at
its native resolution through the engineering Full gate, with global Detail and
a local carrying its own Detail so both band scopes and the mask tile path are
live. The GPU budget is set to **1 GiB through the stored preference before the
source loads**, so the planner refuses Direct for the very first Full
presentation and the session is tiled throughout. Setting it afterwards would
leave Direct's whole-frame intermediates resident underneath the tiled caches
and measure a state production never reaches.

| Source | MP | Tiles | Halo | Band stacks | Band cache | Mask cache | Working set | Proxy | **Peak** | Budget |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 6000 × 4000 | 24.0 | 96 | 204 | 2 | 557.1 MB | 135.7 MB | 47.4 MB | 192.0 MB | **964.7 MB** | 1073.7 MB |
| 7968 × 5320 | 42.4 | 176 | 271 | 2 | 678.2 MB | 171.7 MB | 62.2 MB | 339.1 MB | **965.1 MB** | 1073.7 MB |
| 7680 × 4320 (8K) | 33.2 | 135 | 249 | 2 | 530.8 MB | 121.3 MB | 57.1 MB | 265.4 MB | **964.9 MB** | 1073.7 MB |

**Peak residency spans 964.7 MB to 965.1 MB — a spread of 0.4 MB across a
24 MP to 42 MP range.** Peak does not follow the image; it follows the budget,
which is the property the gate asks for. An earlier run of the same harness gave
961.8 to 965.1 MB; the low-hundreds-of-kilobytes movement between runs is cache
occupancy at the moment of sampling, not a difference in what is bounded.

### The working set is no longer constant, and that is correct

Phase 4 could assert a *constant* 8.4 MB tiled working set, because a tile was
exactly a tile. Phase 5's halo comes from the image diagonal, because that is
where Detail's radii come from, so the work tile is `tileSize + 2 * halo` and
grows with the square root of the pixel count: halos of 204, 249 and 271 pixels
at these sizes. The working set therefore moves between 47.4 MB and 62.2 MB.

What survives is the invariant that matters. Against the whole-frame grading set
Direct would need, that is **6.17%, 5.38% and 4.59%** — the share falls as the
image grows, because the halo grows with the diagonal while Direct grows with
the area.

### Two defects this measurement found

**The diagnostics did not count the Phase 5 caches.** `detailBandTile()` and
`loadLocalMaskTile()` create real device textures, but neither the band cache
nor the mask tile cache was in `resourceMemorySnapshot()`, and nor was the tiled
working graph. A tiled render therefore reported a *smaller* peak than a Direct
one while actually holding more, and the contradiction was visible in the first
measurement: 42 MP reported the largest band cache and the lowest peak. This
broke the Phase 0 contract that the diagnostics equal the renderer's own
allocations. All three are now categories in the resident and cached ledgers.

**The cache bounds ignored everything that was not a cache.** The trims took a
flat 60% of the configured budget for bands and 15% for masks. That leaves 25%
for the proxy, the presentation surface and the working graph, which at 24 MP
and above need more than that — so a measured peak could exceed the budget the
planner had just admitted the render against. With the corrected diagnostics
this was reproducible: 1172.7 MB against a 1073.7 MB budget at 24 MP.

`cacheBudgetBytes(share, floor)` now sizes both caches from what is actually
free — the budget, less a 10% contingency matching the planner's own, less the
non-cache resident set — and splits that 80/20 between bands and masks. The
three rows above are the result.

**A third, smaller issue:** the post-submission trim cannot evict the current
generation's tiles while submitted work still references them, so it runs again
once the queue drains. That second trim was fire-and-forget, which made any
measurement taken straight after `onSubmittedWorkDone()` a race — the same
configuration produced 980.7 MB and 1172.7 MB on consecutive runs. It is now
retained as `pendingCacheTrim` so a measurement can await the steady state.

## Exit gate 4 — global and local Detail match the CPU reference

**Status: met, measured differentially.**

`codebase/tests/tiled-cpu-detail-parity.js` compares both GPU routes against the
CPU `preview-raw` render of the same committed document — global Detail plus a
Brush local and a Path local that each carry their own Detail.

The naive form of this test, "tiled output is within *N* of CPU output", mostly
measures how far the two implementations differ in general, which is not what
the gate asks and which other suites already cover. What matters is whether
*tiling* adds error at a tile edge that is not there mid-tile. So the
measurement is differential: the mean absolute difference from the CPU reference
is computed per column and per row, split into lines on a tile boundary and
lines that are not, and Direct is the control. Any seam introduced by tiling is

    elevation(tiled) − elevation(direct)

and because it is a difference of differences it stays valid however far the CPU
and GPU are from each other.

| Tile size | Direct column / row elevation | Tiled column / row elevation | **Seam introduced by tiling** |
|---:|---:|---:|---:|
| 256 | −0.1563 / −3.8974 | −0.1565 / −3.8974 | **−0.0002 / 0.0000** |
| 512 | −1.3238 / −4.0257 | −1.3238 / −4.0257 | **0.0000 / 0.0000** |

The control's own elevation of −0.16 to −4.03 levels is the image's structure at
those line positions, and it is exactly what the differential cancels. Tiling
contributes nothing.

### What the absolute GPU/CPU difference actually is

The same comparison reports a mean difference of 4.06 levels and a maximum of
254, distributed p50 **0**, p99 170, p99.9 247, with **3.529%** of pixels above
16 levels. That is bimodal rather than rounding, so it needs stating precisely
rather than being left to look like a Detail defect.

It is not Detail's. Re-running with global Detail neutral and nothing else
changed gives mean 3.7938 and 3.337% above 16, so **global Detail's marginal
contribution is 0.2686 levels of mean difference and 0.192 percentage points**.
The rest is a pre-existing GPU-versus-CPU difference on a neutral grade,
concentrated on the hard synthetic edges of the test pattern — the signature of
a sub-pixel difference between the two proxies, where flat patches agree exactly
and edges disagree by a lot. The test asserts Detail's marginal contribution
stays under one level, and records the attribution on every run.

Characterising that baseline is worth a separate look. It is not a Phase 5
regression and not a tiling artefact, and it is out of this phase's scope.

## Regression found and fixed: the resize-to-submit invariant

Deferring the whole-frame mask load past the tiled branch — correct in itself,
since tiled must not fetch whole-frame masks — placed an `await` between the
canvas resize and the submission. The code comment immediately above that resize
already explains why that is unsafe: changing a visible canvas's backing size
clears its presented frame, so the resize and the submission have to be one
synchronous step or the compositor can expose a cleared canvas.

With a crop applied and locals present, the mask fetch could then be superseded,
the render would refuse, and the canvas was left resized, cleared and with no
accepted presentation — which never clears `state.geometryPresentationPending`.
`local-adjustments-interaction.js` caught it as *"Crop preview handoff remained
pending after the cropped frame was presented."*

It was confirmed as a Phase 5 regression rather than a pre-existing failure by
stashing the working tree and re-running the same suite at `24dc9dc`, where it
passes.

**The fix:** activity, admission and the Direct mask load are all hoisted above
the resize. `graphActivity()` reads only grade-derived slots, so the
surface-format rebuild inside the resize block cannot change the decision, and
the duplicate computation that used to follow it is gone. Tiled still never
fetches a whole-frame mask.

## Harness correction

Two defects in the parity harness itself were fixed, both of which would have
produced misleading evidence:

1. **The global grade was being discarded.** `state.adjustments` is uncommitted
   client state, and the document each `create_local` returns replaces it. A
   grade applied *before* those commands vanished, leaving global Detail
   inactive so the run tested the locals alone. The grade is now applied after
   the locals are committed. Parity improved from `maxDelta 1` to `maxDelta 0`
   once global Detail was genuinely in the graph.
2. **The render was racing the edit queue.** Each `create_local` starts its own
   render, so calling `renderGpuTier` immediately afterwards was superseded
   mid-mask-load and refused — correctly, but it read as a parity failure. The
   harness now waits for the viewer to settle first.

## Regression evidence

| Suite | Result |
|---|---|
| Python, full suite in `codebase/.venv` | **1210 passed, 3 skipped, 0 failed** |
| `node --test` over the seven deterministic suites | **tests 72 / pass 72 / fail 0** |
| `tiled-direct-parity` | all four parity rows, seam check, refusal check, atomicity and the five-step cache trace pass |
| `tiled-cpu-detail-parity` | seam differential 0.0000 at both tile sizes; Detail attribution recorded |
| `detail-cache-residency` | 24 MP, 42 MP and 8K all inside budget, peak spread 3.2 MB |
| 19 browser suites | **19 / 19 pass** |

The 19 are `webgpu-shader`, `brush-mask`, `gradient-mask`, `path-mask`,
`luma-mask`, `mask-graph`, `local-adjustments`, `local-crop-anchor`,
`crop-handoff`, `gpu-local-adjustments`, `many-local-layers`,
`local-mask-performance`, `gpu-highlights`, `gpu-scopes`,
`tiled-admission-scopes`, `engineering-full`, `preview-resolution`,
`device-loss` and `performance` — the mask, local-authoring and GPU-parity
surface this phase touches, plus the Phase 4 gates it must not regress.
`path-mask` was additionally run 8 consecutive times.

The Python total is 1210 against the Phase 4 close of 1208; the two added cases
are the bounded mask-tile reassembly test and its companion. The Node total is
72 against Phase 4's 69, the three added cases being band identity, downstream
local invalidation and the Detail halo bound.

## Fixed: the intermittent `path-mask-interaction` failure

Sprint carried-forward item 9 recorded this as a pre-existing local-adjustments
defect. It was a test defect, and it is fixed.

Line 460's `waitForResponse` for the `/edit-commands` commit of an out-of-image
Path handle drag timed out after thirty seconds. The cause is that a Path
node or handle drag **only commits when the gesture actually registered
movement**: pointerup returns without posting when `gesture.changed` is false.
So a drag that never took hold produced no request at all, and the test waited
the full timeout for something that was never going to be sent — reporting a
commit failure when the real failure was the press missing the handle.

The press missed because of the step before it. The drag is set up by
letterboxing the preview to 72% and then reading the handle's screen position,
with a fixed 50 ms wait in between. When layout had not settled within that
window the box read back at the old size, so the computed coordinates pointed
somewhere the handle was not. Faster or slower machines flipped the outcome,
which is why it passed on one run and failed on another on the same build.

Two changes, both in the test:

- the letterbox wait is now a condition on the preview's own rectangle having
  actually shrunk, not an interval;
- each Path node and handle drag waits for `localPointerGesture.changed` before
  releasing, so the drag is deterministic and a drag that never takes hold fails
  immediately, naming the gesture, instead of timing out on the commit.

**8 consecutive passes** after the fix, against 1 pass / 2 fail at the
pre-sprint release commit.

## What is deliberately still refused

`tiledExecutionRefusals()` continues to name, and return rather than silently
work around:

- `spatial film effects` — multiscale, Phase 7;
- `vignette` — normalizes to the whole image;
- seeded `grain` — seeds on absolute coordinates.

## Next

1. Characterise the baseline GPU-versus-CPU difference described under gate 4:
   3.3% of pixels differ by more than 16 levels on a *neutral* grade, with flat
   areas agreeing exactly and hard edges disagreeing, which points at a
   sub-pixel difference between the CPU and GPU proxies. It is pre-existing and
   unrelated to tiling or Detail, and it deserves its own investigation.
2. The grade the Direct/Tiled parity harness applies is client-only and uses
   values the document model would reject (`contrast: 18` against a `-2..2`
   field). That is harmless there, because nothing posts it, but it means the
   parity corpus and the CPU corpus are not grading the same numbers. Worth
   reconciling when the export corpus lands in Phase 8.
3. Selecting a preview resolution, or any later preference sync, re-applies
   `preferences.maximumGpuMemoryGiB` and silently discards a GPU budget set
   through `applyGpuMemoryBudget()`. The residency harness works around it by
   seeding the stored preference before load. It is worth deciding whether a
   transiently-set budget should survive a preference sync.
