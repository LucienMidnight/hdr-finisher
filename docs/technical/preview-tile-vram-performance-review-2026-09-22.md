# Preview, Tile and VRAM Performance Review — Findings and Remediation Plan

**Date:** 2026-09-22
**Status:** Static review. No code changed. No new measurements taken — numbers are
quoted from repository evidence with the source named, or derived arithmetic from
code constants (labelled as such).
**Reviewed at:** `35996e5` ("Fix preview rendering races and performance"), working tree
**Question asked:** after moving preview from low-res proxies during gestures to the
selected tier (Full = tiled), why are there extreme performance problems — Full→4K
switching hangs, local adjustments take seconds to land, and is the GPU silently
falling back to CPU?

**Related documents:** `docs/product/Stable_Exact_Full_Preview_Sprint_PRD_2026-09-19.md`
(phases 4–8, global gates), `docs/product/HDR_Finisher_PRD_v1.2.md` (§11b PERF-03…07),
`docs/technical/phase-5-masks-locals-detail-evidence-2026-09-19.md` (halo and cache
measurements), `docs/technical/sprint-wrap-evidence-2026-09-21.md`.

---

## 0. Plain-language summary (no code)

**What changed and why it now hurts.** The app used to show you a small stand-in
picture while you dragged a slider, then render the real thing when you let go.
That is gone: every render now happens at the resolution you picked in the Preview
drop-down, and big files go through the tiled path. The goal was right. The problem
is that several heavy jobs are now queued behind each other on every edit, and at
least one of them ignores the tier you selected entirely.

**Five things are combining to make it feel stuck:**

1. **A hidden full-resolution render runs after every settled edit.** The scope
   panel's "exact peak" figure is obtained by re-rendering your whole image at
   *native* size — 42 megapixels, even when you are viewing 4K. It is submitted as
   one enormous, uninterruptible job. Everything you actually asked for has to wait
   behind it. This is why switching *down* from Full to 4K does not help: the 4K
   view pays for a Full-resolution render on every edit that settles.

2. **The tile path asks the server for one small mask per tile, one HTTP request
   each, before it draws anything.** A 42 MP frame is 176 tiles; three local
   adjustments make that 528 requests, and the browser only allows about six
   connections at a time.

3. **The tile size does not grow with the blur radius.** Detail and Halation need a
   border around every tile, and that border is 146 px at default settings on a
   42 MP frame (271 px at maximum radii, more with film effects) against a 512 px
   tile. So the tiled path does roughly 3–11× more pixel work than the direct path
   would for the identical result, and it pays per-tile overhead ~2000 times.

4. **The picture is thrown away before the wait begins.** For the tiled route the
   viewer canvas is resized — which clears it — *before* the mask requests finish.
   Any delay or failure in that window leaves a black frame. That is a concrete
   mechanism for the PERF-07 black-canvas report, and it will bite hardest on a cold
   Full proxy.

5. **One hiccup is permanent.** Any single out-of-memory or transport error during a
   GPU render silently switches the entire session to the slow CPU preview, with no
   way back except restarting. That matches "GPU isn't being used correctly with
   fallback to CPU" exactly.

**What I would do about it:** make the peak measurement idle-only and free at Full;
feed the tile encoder a viewport and submit visible tiles first in slices so it can
be interrupted; size tiles from the halo; fetch masks in one request (or lazily, in
bounded concurrency); never resize a visible canvas before a submission is ready;
and make GPU errors recoverable instead of fatal.

---

## 1. Scope, method and confidence

**Read in full or in part:** the project PRD v1.2 (§§4.1–4.4, 5.1–5.5, 11a–11c),
the sprint PRD (phases 0–9, global gates, handoff checkpoint, QA findings), the
Codex handoff brief, `Next_Sprint_Minor_Bug_Backlog.md`, the sprint-wrap and phase
evidence documents, `frontend/app.js`, `frontend/webgpu-preview.js`,
`frontend/tile-scheduler.js`, `frontend/preview-scheduler.js`,
`backend/hdr_finisher/main.py`, `render_cache.py`, `resource_preflight.py`,
`cpu_strips.py`, and the performance harnesses under `tests/performance/`.

**Method.** This is a static review: I did not attach to a running instance, so I
report no new measurements of my own. Numbers are either (a) quoted from evidence
already in the repository with the source named, or (b) **derived arithmetic** from
constants and code paths, labelled as such. Per the project's own rule ("measure
before diagnosing"), every finding below carries the experiment that would confirm
or kill it, and the remediation tasks carry negative controls. Section 4 is ordered
so the cheapest decisive experiments come first.

**Confidence levels used:** *high* = a direct code path or a repository measurement
proves it; *medium* = arithmetic from code constants, mechanism clear, magnitude
unmeasured; *hypothesis* = plausible and testable, not yet proven.

**What I did not do:** I did not run the app, the pytest suite, or any browser
suite, and I did not modify any source file.

---

## 2. Current architecture (as built)

### 2.1 Preview pipeline and tiers

- Tiers are `full | 4096 | 2048 | 1024`, `previewTargetLongEdge()` in
  `app.js:868`. `full` resolves to the source's long edge; other tiers are
  `min(source, requested)`.
- Gestures are scheduled by `preview-scheduler.js`: `onFrame` (interactive draft,
  coalesced while a frame is in flight), `onSettle` (after `settleMs`, default 110),
  `onRefine` (after `refineMs`, default 520). `armSettle` and `armRefinement` are
  re-armed on every input.
- `interactiveProxyLongEdge()` (`app.js:4334`) returns the *selected tier* once
  `selectedTierReady()`, otherwise a 512–1024 bootstrap proxy. This is the change
  the sprint made: during a gesture at 4K the app now renders at 4096, not 1024.
- At Full, `interactiveDraftGuaranteedTiled()` (`app.js:2124`) declines interactive
  drafts *before dispatch* when `minimumExecutionDecision()` says even the smallest
  Direct graph cannot fit. So Full has no interactive feedback by design; the viewer
  holds the last settled frame for the whole gesture.
- `settlePreview()` (`app.js:4222`) awaits the serialized edit-command queue, then
  renders at `settledProxyLongEdge()`, and on a refusal that is not classified
  transient falls back to a whole-frame CPU render (`renderPreviewForLane`).
- Scope refresh runs from the scheduler's `onScope` per tier. `gpuScopeEligible`
  excludes `execution === "tiled"`, so **a tiled (Full) presentation always uses the
  CPU `/scopes` route**; a Direct presentation uses the GPU route.

### 2.2 The tile system

- `tile-scheduler.js` is the pure planner: `plan({width, height, identity,
  generation, tileSize, nodes, viewport})` produces core rects, halo rects, a
  visible-first ordering, and a memory model. It is well covered by unit tests.
- `DEFAULT_TILE_SIZE = 512` (`webgpu-preview.js:502`) and it is never derived from
  the halo.
- `composedTileHalo()` (`:1565`) = `detailTileHalo` (`:504`, from the image
  diagonal and the Detail radii) plus `spatialTileHalo` (`:543`, from the film
  blur radii on the quarter grid), rounded up to a multiple of four.
- `buildTiledPlan()` (`:612`) sizes the working graph to `tileSize + 2 × halo`;
  `encodeTiledGeneration()` (`:2047`) is the encoder: one command encoder
  (`:2130`), a per-tile loop of ~a dozen render passes, one `queue.submit` at
  `:2445`, then trims and a peak readback.
- Two entry points reach that encoder: `renderTo()`'s tiled branch (the presentation
  path, with admission planning) and `renderTiledTo()` (`:1840`, used by the
  exact-peak measurement and by the diagnostic `renderTiledTier` hook, **with no
  admission planning at all** — it always tiles).
- Local masks arrive as per-tile fetches: `loadLocalMaskTile()` (`:1988`) is called
  for every tile × every active local, all at once, *before* the loop starts
  (`:2134`).
- Detail uses a per-tile band cache (`detailBandTile` `:1928`) keyed on an identity
  that deliberately ignores the amount/threshold slots so live drags hit;
  `assemblePackedHalo()` (`:2228`) rebuilds a tile's halo by copying from
  neighbouring tiles' bands.

### 2.3 VRAM management

- `admitDirect()` decides Direct vs Tiled from a plan built by `buildTiledPlan` /
  the Direct estimator, against `memoryBudgetBytes()` (Auto = 2 GiB per the PRD;
  also 1 GiB / 512 MiB options). A Direct render allocates whole-frame textures; a
  tiled render allocates one working graph.
- Caches: proxy levels (`loadProxy`/`loadProxyStreamed` `:4281`, `trimProxyLevels`
  `:4162`, 2 levels per session+lane), whole-frame masks and luma-mask textures
  (`localMasks`, `sceneLuminance` — 2 entries per session), detail band tiles, mask
  tiles, denoise evidence/resolved, scope pools.
- Cache budgets are computed from the *measured* resident set:
  `cacheBudgetBytes(share, floor)` (`:1962`) = `max(floor, share × (0.9 × budget −
  non-cache resident))`, split 80/20 between bands and masks.
- `resourceMemorySnapshot()` (`:1347`) and `diagnosticsSnapshot()` (`:1469`) are the
  honest ledger (Phase 5 fixed them to count the tile caches). The *decisions* —
  tile size, cache split, whether to run the measurement — do not consume it.
- Sticky state: `allocationBackoff` is cleared only by touching the execution
  override or the memory budget (`app.js:3878`, `:3899`); a thrown render error sets
  `state.gpuPreview.available = false` (`app.js:10338`) with no recovery path.

### 2.4 The settle/scope tail

Order of work after a gesture ends at 4K (Direct) on a 42 MP source:

1. `settlePreview` awaits the edit-command POST queue, then renders at 4096.
2. `runScope(tier: "settled")` → GPU scope (canvas readback) → **`measureExactScopePeak()`
   renders the whole frame again at 7968 through the tiled encoder** (`app.js:4442`,
   `:4451`).
3. `prepareInactivePreview()` → `preloadInactiveLane` loads the *other* lane's proxy
   at the selected tier (Full = 339 MB, ~21 streamed chunks).
4. `debounceOverlayAndScopes()` → `refreshOverlay` + `refreshScopes` (120 ms later).
5. `schedulePerspectiveDraftPreview` / `recalculateDenoise` (300 ms after a tier
   change) if applicable.

At Full (tiled) the same tail replaces step 2 with a CPU `/scopes` POST (2–3
requests, the PRD measured 1726 ms for 3) and adds the mask-fetch burst inside step 1.

### 2.5 Backend services involved

`GET /source-tile/{kind}` (`main.py:850`) — one post-geometry source tile, produced
by `geometry_source_tile()` (`render_cache.py:191`) using `apply_geometry_region`
with a roll-frame cache so the rolled frame is not rebuilt per tile.
`GET /local-mask-tile/{local_id}` (`main.py:996`) — one mask tile; the whole-frame
mask is memoised in `_compiled_masks`, so repeat requests are slice-and-return.
`POST /scopes` (`main.py:749`) — `scope_result()` (`render_cache.py:593`) runs the
**whole adjustment pipeline** on the proxy at `long_edge ≤ 1200`, single-flighted
and cached by adjustment signature.

---

## 3. Findings

### P0-1. The speculative "exact peak" render is a native-resolution tiled render on every settled edit, and it blocks the frames the user asked for — *confidence: high*

**Symptom.** Every edit that settles triggers seconds of GPU work that paints
nothing, on top of the render the user is waiting for. Because it runs at *native*
resolution regardless of tier, dropping from Full to 4K does not remove it — the
4K view does Full-resolution work. This is the best explanation in the code for
"switching from Full to 4K seems to hang" and for "local adjustments take multiple
seconds to land".

**This finding is conditional on 4K taking the Direct route**, because the
measurement only runs when `gpuScopeEligible` is true, which excludes tiled
presentations. On the Auto (2 GiB) budget my derived 4K plan is ~1.0–1.25 GB, so 4K
should be Direct and the measurement should run — but if 4K is actually tiling (see
P1-3, and experiment 4), then the cost profile is different: the 4K view pays the
mask burst, the band cache and the CPU scope route instead, and the measurement is
skipped. **Establish which branch you are on before acting on this finding.**

**Evidence.**
- `app.js:4948` — on every settled GPU scope: `if (state.scopeExactPeak && tier ===
  "settled" && !scopeRegion) exactPeak = await measureExactScopePeak({ lane })`.
  `scopeExactPeak` defaults on (Phase 8 progressive disclosure).
- `app.js:4442` — `const nativeEdge = previewTargetLongEdge("full")`, i.e. always the
  source's long edge, never the selected tier.
- `app.js:4398-4409` — the cache key includes `state.editRevision`,
  `previewGeneration`, the full `adjustments` JSON and the full `locals` JSON, so it
  misses on every settled edit; `app.js:4490` caps the cache at 8 entries.
- `app.js:4451` — the measurement goes through `renderTiledTo`, which (a) skips
  admission entirely (`webgpu-preview.js:1840-1921`) and (b) calls the same
  `encodeTiledGeneration` that submits ~2000 render passes in **one** command buffer
  (`webgpu-preview.js:2130`, `:2445`).
- Cancellation is cooperative only at coarse points (`:2139` after the mask matrix,
  `:2433` after the loop), so a superseded measurement still executes fully on the
  GPU. Meanwhile `app.js:4249-4268` shows the settle path retrying a render after a
  transient refusal, i.e. two heavy renders can be queued back to back.
- `app.js:4444`'s own comment states "a native render takes seconds on a large
  frame" and "It must therefore never be in the way of something the user did ask
  for" — the intent is right; the implementation awaits it on the settle tail.
- The measurement also competes for the tile caches: `renderTiledTo` ends with
  `trimDetailBandTiles(pinnedDetail)` / `trimMaskTiles(pinnedMasks)` and sets the
  single `pendingCacheTrim` field (`:2442-2450`), so the native grid (176 tiles) and
  the presentation grid (48 tiles at 4K) evict each other.

**Decisive experiment (do this first).** Run the reported gesture twice with the
scope panel's "Exact peak" toggle off and on, and log
`HDRFinisherPerformance.gpuSnapshot().stages` plus a timestamp of each
`renderTiledTo` return. Prediction: time-to-land and GPU-queue occupancy drop by the
whole native render when the toggle is off. Second confirmation: `renderTiledTo`
takes ~the same wall time at tier 4K whether the measurement ran or not, because its
`longEdge` is native either way.

**Proposed fix (in preference order).**
1. **Free at Full.** When the presentation *is* native (Full tier), the presentation
   render already reduces the peak per tile; take `metrics.exactPeak` from the
   accepted tiled generation instead of rendering again. No second render, exact by
   construction, no cache-key problem.
2. **Idle-gated elsewhere.** Only start the measurement when: the scopes dock is
   visible, no pointer gesture is active, `state.gpuDraftInFlight` is null, the edit
   queue is drained, and the state has been unchanged for ≥ 500 ms. Never start it
   from the settle callback.
3. **Interruptible.** Have `renderTiledTo` submit in slices (see P0-2) so a
   supersession stops it between slices rather than after the whole image.
4. **Admission-checked.** Give the measurement the same plan/admission path as a
   presentation render so it cannot try to allocate a graph the budget refuses.
5. Only if the Director wants to drop the always-on guarantee: expose it as an
   explicit "Measure peak" action plus an on-export measurement, and keep the honest
   "proxy peak" label. **This contradicts a Phase 7 decision, so it is a question
   for the Director, not a unilateral change.**

**Verification.** Negative control: with the fix reverted, assert that a settled
edit at 4K issues a `renderTiledTo` at native edge (fail the test on it). Acceptance:
a settled edit at 4K performs zero native-edge renders and the reported peak is
unchanged; the Full-tier peak still matches the existing Phase 7 measurement.

---

### P0-2. One submission per generation: no viewport, no visible-first presentation, no cancellation, no progress — *confidence: high*

**Symptom.** At magnified zoom the whole image is tiled before anything is
presented. The PRD's own tile contract (§5.3) promises the opposite: "At magnified
zoom, visible tiles complete first and offscreen tiles can follow or be generated
on demand."

**Evidence.**
- `tile-scheduler.js` supports `viewport` and sorts visible tiles first, and
  `tile-scheduler.test.js` covers the ordering — but `webgpu-preview.js:2113-2120`
  calls `plan({width, height, identity, generation, tileSize, nodes})` with **no
  viewport**, so `viewport` defaults to the whole image, every tile is "visible", and
  the ordering does nothing.
- The entire generation is one `GPURenderPassEncoder` sequence in one command
  buffer, submitted once (`:2130`, `:2445`). Nothing is presented until all 176 tiles
  are encoded *and* the GPU has executed them all.
- The tile loop is a JS `for` with `await`s inside it (mask matrix, per-tile denoise
  resolve), so the main thread is also occupied for the whole encode.

**Proposed fix.**
- Pass the real viewport (canvas transform → image-space rect) into `plan()`.
- Submit in slices: encode visible tiles into the first command buffer(s) and submit
  them, then continue with offscreen tiles. The PRD's atomicity rule ("all currently
  *visible* tiles are current") is satisfied by the first slice, so partial
  presentation is contract-compliant.
- Give the encoder a `stopAfterTileIndex` / `tilesForSlice` parameter so
  cancellation and supersession have boundaries.
- Keep the `loadOp: "clear"` on the first tile of a generation — it protects against
  stale pixels when geometry changes — and extend that protection to the first tile
  of each slice only if the parity gates allow (measure, do not assume).

**Verification.** Extend `test:tiled-parity` and `test:tiled-film-parity` to run the
sliced encoder and assert byte-exactness against Direct at both tile sizes.
Acceptance for latency: at a 4× zoom on a 42 MP source, first-pixel-presented time
is bounded by the visible-tile count, not the image. Negative control: with the
viewport removed, the visible-tile count must equal the total (the current
behaviour) and the test must fail.

---

### P0-3. The canvas is resized (cleared) and then awaited before submission — *confidence: high (mechanism); the visible blank is unconfirmed, matching PERF-07's status*

**Symptom.** A black viewer for the duration of the tiled render, worst on a cold
Full proxy — the reported PERF-07.

**Evidence.**
- `webgpu-preview.js:2612-2615` (in `renderTo`, before the tiled branch at `:2642`)
  resizes the visible canvas whenever the proxy size differs, which clears the
  presented frame.
- The tiled branch then awaits the mask matrix at `:2134` (up to `tiles × locals`
  HTTP requests) and, with denoise, an awaited resolve per tile, *before*
  `queue.submit` at `:2445`.
- The Direct path's own comment above that resize says the resize and the submission
  "have to be one synchronous step or the compositor can expose a cleared canvas".
  The tiled path breaks that invariant.
- On any refusal or throw in that window there is no accepted presentation, so the
  canvas stays cleared — and `app.js:10338` then disables GPU preview entirely.
- The sprint-wrap evidence correctly says the *compositor-level harness did not
  reproduce* a blank on this host, and the PRD forbids shipping a canvas-lifecycle
  change without a reproducing negative control. This finding does not contradict
  that: it identifies the window and the condition (cold proxy, slow mask transport,
  or a refusal) under which a blank is structurally possible.

**Proposed fix.** Do not resize a visible canvas until the submission is ready:
- Option A (smallest): move the resize to immediately before `queue.submit`, after
  the proxy and all masks are in hand.
- Option B (robust): render into an offscreen texture at the target size and do one
  final blit pass to the canvas in the same synchronous step as the submit.
- Option C: keep the canvas at the last accepted size and present the new size
  atomically on the first accepted frame.

**Verification.** Negative control: add a test hook that delays
`/local-mask-tile` by ~2 s, sample the compositor (as `tier-change-blank-canvas.js`
now does), and assert zero blank samples. Prediction: it fails today and passes after
Option A or B. Then re-run `test:tier-change-blank` and the parity suites.

---

### P0-4. Mask transport: `tiles × locals` HTTP requests before any pixel is drawn — *confidence: high*

**Symptom.** A cold Full render with locals spends seconds in the browser's
six-connection limit before the encoder starts; the same cost returns whenever the
tile cache was trimmed.

**Evidence.**
- `webgpu-preview.js:2134-2138` — `Promise.all(plan.tiles.map(tile =>
  Promise.all(activeLocals.map(local => loadLocalMaskTile(...)))))`.
  At 42 MP / tile 512 that is 176 tiles; three locals → 528 requests.
- `loadLocalMaskTile` (`:1988`) returns `null` on any non-OK response and the caller
  then refuses the **entire** render (`:2139-2141`) — after the canvas was resized
  (P0-3).
- Each request is a separate FastAPI round trip; uvicorn here is HTTP/1.1, and
  Chromium caps ~6 connections per origin, so 176 requests are processed in ~30
  serialised batches. The server side is cheap (`_compiled_masks` memoises the
  whole-frame mask), so this is transport and per-request overhead, not compute.
- `trimMaskTiles` (`:2032`) budget is `0.20 × (0.9 × budget − non-cache resident)`,
  floor 32 MB. At Full the mask tiles are ~176 MB (1 byte/px over the haloed rects,
  matching the measured 135–171 MB in the Phase 5 evidence), so a large resident set
  forces eviction and the burst repeats on the next render.

**Proposed fix (any of, in preference order).**
1. Fetch the whole-frame spatial mask **once** per (mask identity, tier, geometry)
   and slice it into per-tile textures in JS. One request instead of 176 (11 MB at
   4K, 42 MB at Full as R8).
2. Keep per-tile fetches but make them **lazy inside the tile loop** with a bounded
   prefetch window (e.g. 4 in flight), so the first tiles can be encoded while later
   masks arrive, and a slice boundary (P0-2) becomes a natural retry point.
3. Do not fail the whole render for one missing tile: retry once, then fall back to a
   CPU-sliced mask or skip the local for that tile with a recorded diagnostic.

**Verification.** Count `/local-mask-tile` requests per tiled render (the
`full-tier-tone-cost` harness already counts `source-tile`; extend it). Acceptance:
a cold Full render with one local issues ≤ 4 mask requests (option 1) or ≤ 4 in
flight at any time (option 2). Negative control: with the fix reverted, the count
must be ≥ the tile count.

---

### P0-5. GPU failures are sticky and silent, and the fallback is the slowest path — *confidence: high*

**Symptom.** "GPU isn't being utilized correctly with fallback to CPU." Once it
happens, the whole session is 8-bit CPU previews until restart.

**Evidence.**
- `app.js:10338` — `state.gpuPreview.available = false` in the `catch` of
  `renderGpuDraftInner`, for **any** thrown error. `initializeGpuPreview()` is only
  called at boot (`app.js:1900`), so there is no recovery short of a restart or a new
  import.
- `webgpu-preview.js` allocation failures set a sticky `allocationBackoff` cleared
  only by the execution-override or GPU-budget settings (`app.js:3878`, `:3899`).
- Plausible triggers that are *not* device loss: a mask-tile texture allocation
  inside `encodeTiledGeneration`, a bind-group/validation error, a `loadProxy`
  fetch failure, or a `TileUnavailableError` from the backend. Several of these are
  transient and would succeed on a retry with a smaller plan.
- After `available = false`, `renderPreviewForLane` takes the raw CPU path; at Full
  the strip executor refuses graphs with locals/spatial film by design, so the user
  gets "Full unavailable" or a whole-frame CPU render (7 s per the PRD's own
  measurement).

**Proposed fix.**
- Classify: *fatal* (no adapter, device lost, context creation failure) vs
  *transient* (allocation, transport, validation, supersession). Only fatal sets
  `available = false`.
- On transient: retry once at a reduced plan (next tier down, or a smaller tile
  size) and record the downgrade; clear `allocationBackoff` after a successful
  render at a reduced plan rather than never.
- Surface it: a visible status ("GPU preview paused after a memory error — Retry")
  with a one-click recovery, instead of a silent 8-bit fallback.

**Verification.** Test hook that forces one allocation failure and asserts the next
render still uses WebGPU and the tier stays selected. Negative control: with the
classification removed, `available` must go false and stay false.

---

### P1-1. The tile size is fixed at 512 while the halo grows with the image diagonal — *confidence: high for the arithmetic, medium for the resulting magnitude on this hardware*

**Evidence.**
- Halo at 42.4 MP: **146 px** at default Detail settings (derived: `2 × max(0.50,
  diagonal × 0.75 / 100) + 2` with `diagonal = 9580`); **204 / 249 / 271 px** measured
  at 24 MP / 8K / 42.4 MP in `phase-5-masks-locals-detail-evidence-2026-09-19.md`.
- Worst case with a film neighbourhood stage: `ceil((271 + 288) / 4) × 4 = 560 px`
  (derived from `spatialTileHalo`'s clamps: 64 quarter-res texels × 4 = 256, plus up
  to 32 direct).
- Work tile = `512 + 2 × halo`: **804²** at default (646 kpx, 2.5× the core area),
  **1054²** at the measured maximum (1.11 Mpx, 4.2×), **1632²** in the worst case
  (2.66 Mpx, 10.1×).
- The Phase 5 evidence confirms the model exactly: the reported 62.2 MB working set
  at 42.4 MP equals `1054² × 56 bytes`.
- Whole-generation fragment work at 42.4 MP with the measured halo:
  `176 × 1054² = 195 Mpx` per pass against a 42.4 Mpx image = **4.6×**; at default
  settings `176 × 804² = 114 Mpx` = **2.7×**; worst case `176 × 1632² = 469 Mpx` =
  **11×**. The same graph rendered Direct at 4K is 11.2 Mpx per pass, so Full+tiled
  does **10–17×** the per-pass work of 4K+Direct — on top of ~2000 draw calls, ~2500
  bind-group creations and the per-tile cache machinery.
- Every stage, including pointwise ones, is evaluated over the full haloed rect
  (`encodeTiledGeneration` passes the whole work texture through the same pass
  sequence); only the composite is clipped to the core.

**Proposed fix.**
- Derive the tile size from the halo: `tileSize = clamp(4 × halo, 512, 1024)` (or up
  to 2048 where the budget allows). At the measured 271 px halo this gives 1024 → 44
  tiles of `1566²` = 108 Mpx total, a 45 % reduction in fragment work and a 4×
  reduction in per-tile overhead; at default settings 512 stays correct.
- Add the halo overhead ratio (`workPixels × tiles / imagePixels`) to the plan and
  to `tiledExecutionMetrics` so the regression is visible, and let admission refuse
  or downgrade a plan whose ratio exceeds ~2.5×.
- Extend the plan's `tileGraphBytes` term for the larger working set
  (`(1024 + 542)² × ~56 B ≈ 137 MB`, still ~4 % of a 1 GiB Direct graph).
- Do **not** shrink the halo: it is derived from the shader radii and the parity
  gates depend on it.

**Verification.** Time `renderTiledTier(7968, {tileSize: 512 | 1024 | 2048})` with
the existing residency harness (`tests/performance/detail-cache-residency.js`
already parameterises `--tile-size`) and re-run `test:tiled-parity`,
`test:tiled-film-parity`, `test:full-tier-denoise` and `tiled-cpu-detail-parity.js`
at the new sizes. Negative control: assert the overhead ratio reported by the plan
matches `tiles × workArea / imageArea` computed independently.

---

### P1-2. The Detail band cache is large and its "hit" path copies nearly as much as the miss path computes; below a certain budget it silently degrades — *confidence: high for the sizes, medium for the cliff's frequency*

**Evidence.**
- Measured band cache: **557.1 / 530.8 / 678.2 MB** at 24 / 33.2 / 42.4 MP, against
  a ~1 GiB budget (`phase-5` evidence). That is `tiles × 2 stacks × (core + halo)² ×
  8 B`.
- `assemblePackedHalo` (`:2228`) rebuilds a tile's halo by `copyTextureToTexture`
  from up to ~16 neighbours per band stack. Derived: `176 × 1054² = 195 Mpx` copied
  per stack, ~4.6× the image area, on **every** render — the "hit" path is not cheap.
- `trimDetailBandTiles` (`:1973`) budget is `0.80 × (0.9 × budget − non-cache
  resident)`, floor 64 MB. With a 1 GiB budget and a ~400–750 MB resident set
  (proxy + tile graph + denoise), free ≈ 150–500 MB, so the bands **cannot** be held;
  `packed.hit` is true but `assemblePackedHalo` returns false and the tile silently
  re-runs the full two-pass analysis. There is no counter for this cliff, and the
  `detailCacheCounters` record hits/evictions but not assemble failures.
- `cacheBudgetBytes` subtracts only the two cache categories from `totalBytes`, so it
  is self-consistent, but it cannot express "the bands need 678 MB and the budget
  cannot hold them" as anything other than eviction churn.

**Proposed fix.**
- Store band tiles at the **core** rect and assemble halos only for the ring the
  neighbourhood stages actually read. This should be parity-neutral (the halo content
  is already assembled from neighbours' cores) and cuts the cache ~4× and the copied
  area to the ring only. **Must be proven against the byte-exact parity gates.**
- Count `bandAssembleMisses` and expose it in `tiledExecutionMetrics` and the
  diagnostics panel so the cliff is observable.
- Make the band budget part of admission: if the bands cannot be held at the chosen
  tile size, choose a larger tile size (fewer, bigger bands) or refuse the cache and
  report it, rather than thrashing.

**Verification.** `tests/performance/detail-cache-residency.js` extended to assert
`bandAssembleMisses === 0` in steady state and to print the cache bytes at 512 vs the
new tile size; `tiled-cpu-detail-parity.js` for the seam differential at the new
storage layout.

---

### P1-3. Admission models cached proxy levels with a multiplier, not the real resident set — *confidence: medium-high (code is explicit; magnitude depends on the resident set)*

**Evidence.** The Direct plan's source-proxy term is
`pixels × sourceBytesPerPixel × cachedProxyLevels`, with
`cachedProxyLevels: Math.max(1, this.proxies.size)` — the count of *all* resident
proxy textures across lanes and sessions. With a Full proxy (339 MB), a 4K proxy
(89 MB) and a bootstrap 1K proxy (8 MB) resident, a 4K plan charges
`11.2 Mpx × 8 B × 3 = 269 MB` instead of 89 MB. On a 1 GiB budget that inflation can
tip 4K from Direct into **Tiled** — which is where the mask burst (P0-4), the band
cache (P1-2) and the CPU scope route all live. That is a plausible second mechanism
for "switching to 4K seems to hang": the 4K tier silently becomes a tiled tier.

**Proposed fix.** Model the actual resident proxy bytes (the snapshot already
exposes `sourceProxyBytes`), and evict non-selected levels *before* planning rather
than after (`trimProxyLevels` runs at the end of `loadProxy`).

**Verification.** Extend `tests/render-plan-admission.test.js` with a case where
three levels are resident and the selected tier must still be Direct; print the
chosen mode in the tier-change harness.

---

### P1-4. Full-tier scopes always take the CPU route, and the measurement path is the only reason the GPU route is excluded — *confidence: high*

**Evidence.** `gpuScopeEligible` requires `execution !== "tiled"`, so a Full
presentation always falls to `POST /scopes`, which runs the whole pipeline at ≤1200 px
(`render_cache.py:641`); the PRD measured 1726 ms for 3 requests per settled edit,
against a 192 MB frame cache that holds at most one 4K frame. The tiled encoder
deletes its `scopeSources` entry (`webgpu-preview.js:2202`) precisely because there is
no whole-frame finish texture to read — but it *does* already compute a per-tile peak
reduction for the presentation (`metrics.exactPeak`).

**Proposed fix.** Once P0-2 slices the generation, retain a bounded, downsampled
finish surface per generation (or accumulate the scope statistics per tile on the
GPU) so the GPU scope route can serve a tiled presentation. That removes the CPU
scope cost at Full *and* makes P0-1's "free at Full" exact peak real.

**Verification.** Compare the accepted Full scope payload against the CPU payload for
the same document (the CPU path is the reference), and assert no `/scopes` request is
issued for a settled Full edit while the GPU is available.

---

### P2-1. The inactive lane is preloaded at the selected tier — *confidence: high*

`preloadInactiveLane` → `loadProxy(..., settledProxyLongEdge())` loads the other
lane's proxy at Full (339 MB, ~21 chunks) after every settled edit — the PRD's own
PERF-04 measurement: 24 `/source-tile/sdr` requests, 1945 ms. It also doubles the
resident proxy set (two 339 MB textures), which feeds P1-3 and the band-cache
eviction pressure.

**Fix.** Cap the inactive-lane preload at `min(selectedTier, 2048)` and load the
exact tier on switch, covered by the existing Preparing state. Keep the comparison
honest: the lane switch must still land on an exact frame at the selected tier (the
existing cross-lane gates must stay green).

**Verification.** Count `/source-tile/sdr` requests per settled Full edit (expect
≤ 4) and assert `test:tier-film-consistency` and the comparison gates still pass.

---

### P2-2. `loadProxyStreamed` awaits full GPU idleness once per 16 MB chunk — *confidence: high*

`webgpu-preview.js:4368` — `await this.device.queue.onSubmittedWorkDone()` inside the
chunk loop. A Full proxy is ~21 chunks, so ~21 GPU syncs per load; each sync waits for
*everything* already queued, including a tiled render or a measurement. During a
gesture this serialises the proxy behind unrelated GPU work.

**Fix.** Use a bounded ring of staging buffers (e.g. 4) with `mapAsync` and let the
copies queue; await only the last. The staging memory bound is unchanged.

**Verification.** Instrument chunk-loop wall time with and without a concurrent
tiled render; assert the proxy load is not serialised behind it. Negative control:
with the sync restored, the chunk loop must take ≥ the render's remaining duration.

---

### P2-3. Denoise controls render per input event with a GPU sync each — *confidence: high*

`app.js:2993` binds every denoise slider to `updateLiveDenoiseControl` on `input`;
`app.js:9515` calls `resolveDenoiseProxy` (which submits and awaits
`onSubmittedWorkDone`, `webgpu-preview.js:3452`) and then a full `renderGpuDraft` at
the settled tier, with no interaction/settle gating and no coalescing
(`renderGpuDraft` starts a new render immediately, `app.js:10198`). A 60 Hz drag
queues 60 whole-frame resolves and 60 full renders, each superseding the last. The
"analysis is not re-run" contract holds, but the picture still lags by a full render
after release.

**Fix.** Route these through `beginInteraction`/`endInteraction` + a debounce, and
skip the whole-frame resolve when the resolved selector is not actually used by the
current graph.

**Verification.** Extend `full-tier-tone-cost` to a denoise-amount drag: assert the
resolve count is bounded by the settle count, not the event count.

---

### P2-4. `renderTiledTo` bypasses `activeRenderCount`, so cache destruction can race a submitted measurement — *confidence: medium-high*

`renderTo` increments `activeRenderCount` (`:2501`) so `destroyAfterActiveRenders`
defers destruction; `renderTiledTo` does not, yet it calls the same encoder and the
same trims. A presentation render finishing while the measurement's command buffer is
in flight can destroy textures the submitted work still references. This is the same
class of defect that the Phase 7 two-target readback pool was built to fix for
buffers.

**Fix.** Have `renderTiledTo` participate in the same active-render accounting, or
move the trims to a single queue-drain owner that all entry points share.

**Verification.** Force an overlap (the `test:full-tier-instrumented-tiling` harness
already forces three) and assert zero device errors and zero destroyed-while-
referenced warnings.

---

### P3-1. Interaction plumbing that reads as "hang"

- `settlePreview` awaits the serialized edit-command queue (`app.js:4222-4234`), and
  each local slider `change` posts the whole document (`app.js:14436`). A drag that
  ends with a POST in flight waits for it, then renders at the full tier. The retry
  added in `35996e5` (`:4249-4268`) can render **twice** in the worst case. *Fix:*
  batch the POST to one per gesture, or let the settle path render immediately and
  re-render on the revision bump.
- `state.localMaskDraftDirty` blocks all interactive GPU drafts while a mask draft is
  dirty, so a brush stroke holds the last frame for the whole authoritative
  `/local-mask` round trip at `settledProxyLongEdge()` (Full = a whole-frame mask
  compile). *Fix:* draft the mask at a bounded edge (≤1600) and promote to the tier
  on commit; the draft is only a guide.
- A tier change with denoise enabled queues: `evictDenoiseCache` → the tier render →
  the exact-peak measurement → `recalculateDenoise` (300 ms later: analysis at ≤4096,
  whole-frame resolve with a sync, another render) → the inactive-lane preload → the
  CPU scope. Five heavy jobs from one selector change. *Fix:* sequence them behind a
  single idle gate and cancel the ones the newest state has already invalidated.

---

## 4. Experiments to run before changing anything (cheapest first)

1. **Exact peak off/on** — the reported gesture twice, logging time-to-land and
   `gpuSnapshot().stages`. Confirms or kills P0-1 (the largest single item).
2. **Request census** — extend `full-tier-tone-cost` to count
   `/local-mask-tile` alongside `/source-tile` and `/scopes` per gesture, per tier.
   Confirms P0-4 and P1-4 and quantifies the settle tail.
3. **Tile size sweep** — `renderTiledTier(7968, {tileSize: 512 | 1024 | 2048})`
   timed with `detail-cache-residency.js`, plus the same at 4K. Quantifies P1-1 and
   shows the working-set cost of the larger tiles.
4. **Which route 4K actually takes** — print `lastRenderPlan.mode` and
   `accepted.execution` across a Full→4K→2K switch. Confirms or kills P1-3 (is 4K
   silently tiling?).
5. **GPU availability trace** — log every path that sets `available = false` or the
   allocation backoff, with the error text. Tells you whether the reported slowness
   is partly a session already degraded to CPU (P0-5).
6. **Compositor blank sampling with an artificially slow mask endpoint** — the
   negative control for P0-3 that PERF-07 currently lacks.

Report each result with the raw numbers, and record the ones that *disconfirm* a
finding rather than tidying them away — the project's evidence culture is explicit
about that.

---

## 5. Ordered remediation plan

Ordered by expected benefit per unit of risk. Every task needs its negative control
observed to fail before the fix, per the project's rule.

| # | Task | Addresses | Risk |
|---|---|---|---|
| 1 | Stop the settled scope path from starting a native measurement: take `exactPeak` from the accepted Full tiled generation, and idle-gate the rest (scopes visible, no gesture, no render in flight, queue drained) | P0-1 | Medium — touches the settle tail, which the handoff brief warns about; do not change `settlePreview` semantics beyond removing the measurement |
| 2 | Move the canvas resize to immediately before submission (or render offscreen and blit) | P0-3 | Medium — canvas lifecycle; requires the new negative control first |
| 3 | Pass the real viewport to `plan()` and submit visible tiles in slices with a cancellation boundary | P0-2, enables 1(c) | Medium-high — touches the encoder; the parity gates are the safety net |
| 4 | Fetch the mask once per identity (or lazily with bounded concurrency) and stop failing a whole render for one tile | P0-4 | Low-medium |
| 5 | Error classification + bounded retry + visible recovery for GPU failures; clear the allocation backoff on a successful reduced-plan render | P0-5 | Low |
| 6 | Tile size derived from the halo, with the overhead ratio in the plan and in `tiledExecutionMetrics`; parity at the new sizes | P1-1 | Medium — parity suites must pass at 1024/2048 |
| 7 | Model the real resident proxy bytes in admission; evict stale levels before planning | P1-3 | Low |
| 8 | Cap the inactive-lane preload; remove the per-chunk queue sync | P2-1, P2-2 | Low |
| 9 | Band cache: core-only storage, `bandAssembleMisses` counter, budget-aware tile size | P1-2 | Medium-high — parity-critical, measure first |
| 10 | GPU scope route for tiled presentations (per-tile accumulation or a retained finish surface) | P1-4, and makes 1 free | High — new transport; do it after 1 and 3 land |
| 11 | Denoise and mask-draft interaction gating; batch local edit POSTs; single idle gate for the tier-change tail | P2-3, P3-1 | Low-medium |
| 12 | `renderTiledTo` participates in active-render accounting | P2-4 | Low |

**Suggested milestone order:** 1–5 (a "no more hangs" milestone, each independently
verifiable), then 6–9 (the cost model), then 10–12.

---

## 6. Constraints and risks to respect

- **Do not change `settlePreview` semantics casually.** An earlier attempt there hung
  the viewer (confirmed by a 900-second timeout). Task 1 should remove work from the
  scope callback, not restructure the settle path.
- **The tiled encoder carries byte-exact Direct/Tiled parity gates from Phases 4–7.**
  Run `test:tiled-parity`, `test:tiled-film-parity`, `test:full-tier-denoise` and
  `tiled-cpu-detail-parity.js` before and after any encoder change. The `loadOp:
  clear` on the first tile protects against stale pixels on a geometry change — do
  not simply remove it.
- **Exactness is a fact about the resolution a frame was *processed* at, and the test
  is equality.** Slicing a generation (task 3) must not present a frame whose visible
  tiles are at a different processing resolution, and must not let a stale tile
  survive a geometry change.
- **PERF-07 and MINOR-12 carry explicit "unconfirmed" language** that must not be
  softened without a confirmed cause. P0-3 supplies a mechanism and a negative
  control; it does not, by itself, confirm the reported blank.
- **The exact-peak guarantee is a Phase 7 Director decision.** Tasks 1 and 10 preserve
  it (exact at Full for free, exact-but-deferred below Full). Turning it into an
  explicit user action is a product question, not an engineering one.
- **Measure on the target configuration.** This host has no discrete GPU, and the
  director's machine reports `maxTextureDimension2D = 8192` with an RTX 4070 Ti.
  A 42 MP Full render is Direct-admissible by dimension there but over the 2 GiB Auto
  budget, hence tiled — verify that assumption on the real machine before trusting the
  tier→route mapping in the analysis above.

---

## 7. Open questions (for the Director / next agent)

1. **Is the always-on exact peak still required at every settled edit**, or may it
   become an explicit action (plus on-export) with the proxy peak labelled honestly
   in between? Tasks 1 and 10 preserve the guarantee either way, but option 5 in
   P0-1 would remove the last of the latency with the least code.
2. **Is a partial (visible-tiles-only) presentation acceptable** as a settled frame at
   magnified zoom? The PRD's §5.3 wording allows it; the current implementation and
   the exactness gate assume a whole-generation replacement. Task 3 depends on the
   answer.
3. **Should Full gain interactive feedback** once visible-first slicing exists? The
   same mechanism would let a gesture present the visible region at the selected tier
   progressively — same resolution, fewer tiles — which is contract-compliant and
   would remove the "laggy but consistent" feel at Full entirely.
4. **What is the supported memory budget floor?** The band cache (678 MB at 42 MP) and
   the tiled path's value proposition diverge below ~1.5 GiB; the 1 GiB and 512 MiB
   options should either be given an honest "slower at Full" disclosure or be
   re-derived from the band-cache requirement.
