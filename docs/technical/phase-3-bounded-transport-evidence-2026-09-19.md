# Phase 3 exit-gate evidence — geometry-aware bounded transport

**Recorded:** 2026-09-19
**Sprint:** [Stable Exact Preview Tiers and Full-Resolution Processing](../product/Stable_Exact_Full_Preview_Sprint_PRD_2026-09-19.md)
**Source state:** worktree based on `493a318` (`main`)
**Application:** HDR Finisher 0.8.12
**Host:** Windows 10.0.26200; Node v24.14.0
**Python:** `codebase/.venv` — **Python 3.12.10** (see the correction below)

## Correction: the environment defect recorded in Phases 0–2 was wrong

Phases 0, 1, and 2 each recorded an "environment defect": 23 JPEG XL / AVIF /
Lensfun cases failing because `requirements.txt` pins `imagecodecs>=2026.6.26`,
which needs Python ≥ 3.12, against an active interpreter of 3.10.10.

That diagnosis was correct about the interpreter but wrong about the project.
**`codebase/.venv` already exists and contains Python 3.12.10 with every
declared dependency installed**, including `imagecodecs`, `rawpy`, and
`lensfunpy`. `desktop/lib/runtime.js` resolves exactly that interpreter for the
dev Electron shell. Earlier phases ran the global `python` on PATH and never
checked for the venv.

Re-running the full suite in the correct interpreter, at the Phase 2 commit,
before any Phase 3 change:

```
.venv/Scripts/python.exe -m pytest -q
1017 passed, 3 skipped, 2 warnings in 44.72s
```

**There are no prerequisite failures and there is no environment defect.** The
consequences for the earlier evidence:

- The "byte-identical failure list" regression argument in Phases 0–2 remains a
  valid before/after comparison, but it was measured in the wrong interpreter
  and never exercised the JPEG XL, AVIF gain-map, or Lensfun routes at all.
- Those routes are now covered, and they pass.
- The "no GPU trace" limitation was unaffected by this correction, and was closed separately the same day by [exact-tier-gpu-latency-2026-09-19.md](exact-tier-gpu-latency-2026-09-19.md).

The environment-defect paragraphs in the Phase 0, 1, and 2 evidence documents
and in the PRD ledger are superseded by this section. From this phase onward the
suite is run with `codebase/.venv/Scripts/python.exe`.

## What changed

### Post-geometry region extraction

`apply_geometry_region(image, geometry, rect)` in `finishing.py` extracts one
output rectangle from the geometry stage. `geometry_resample_stage(geometry)`
names the route it has to take:

| Stage | Geometry | Behavior |
|---|---|---|
| `index` | quarter turns, flips, crop | `np.rot90` and `np.flip` are **views**, so the window is pure slicing with one copy of the window itself. No full-frame allocation. |
| `perspective` | any keystone, with or without roll | The projective matrix is composed with a translation so Pillow renders **only the requested window**. No full transformed frame. |
| `roll` | straighten or `perspective_rotate` with no keystone | `Image.rotate(expand=True)` owns its own expansion and safe-inset geometry, which this module does not yet reproduce for a window. Still materializes and slices. |

The windowed warp clips against the **whole channel's** min/max, matching what
the full-frame path does, rather than against the window's local extremes. A
window anchored at the warped origin skips the translation compose entirely so
it stays bit-identical.

### The source-tile contract

`GET /api/session/{id}/source-tile/{kind}` carries every field PRD 5.4 asks for:
source epoch, lane, tier (`long_edge`), geometry signature, core output
rectangle (`x`, `y`, `width`, `height`), `halo`, and pixel format. It answers
with the pixels plus the identity they belong to:

```
X-Tile-X / X-Tile-Y / X-Tile-Width / X-Tile-Height     delivered rect (core + halo, clamped)
X-Core-X / X-Core-Y / X-Core-Width / X-Core-Height     core rect after clamping
X-Halo  X-Output-Width  X-Output-Height  X-Resample-Stage
X-Source-Epoch  X-Geometry-Signature  X-Edit-Revision
X-Bytes-Per-Row  X-Working-Space  X-Pixel-Format
```

It has **no `long_edge` ceiling**, because the response size no longer follows
the tier. A mismatched `source_epoch`, `geometry_signature`, or `edit_revision`
is answered with 409 rather than with pixels from a different state.
`RenderCache.geometry_source_tile` refuses with `TileUnavailableError` in the one
case a per-tile result would not reproduce the whole-frame one — a geometry
whose output still needs a post-geometry downsample — so the caller can fall
back instead of receiving a tile that fails parity.

### Chunked Direct source upload

`loadProxyStreamed()` allocates one destination texture and fills it from
full-width row strips, each bounded by `maxSourceChunkBytes` (16 MiB).
Full-width strips keep every chunk's row pitch identical to the whole-frame
case, so the assembled texture is what the whole-frame path would have written.
`loadProxy()` takes this route whenever the whole frame would exceed the chunk
budget, and the streamed loader returns `null` when the backend declines, so the
whole-frame request remains the fallback rather than a failure.

`sourceTransportMetrics` records the route, chunk count, transferred bytes,
largest response buffer, and time-to-first-tile, and `diagnosticsSnapshot()`
exposes it. The planner's `upload-staging` entry — a placeholder since Phase 2 —
is now populated with the chunk budget.

## Gate 1 — A 42 MP source begins Full preparation without an image-sized response buffer

**Status: met.**

`codebase/tests/source-transport.test.js` drives the streamed loader against a
recording backend at 7000 × 6000:

```
whole frame as one response   336,000,000 bytes
largest chunk response         <= 16,777,216 bytes  (< 1/20 of the frame)
chunkCount                     > 1
textures allocated             1, filled incrementally
writeTexture calls             == chunkCount
timeToFirstTileMs              recorded
```

Live confirmation against the running server, reassembling the real 1024 × 576
output from strips and comparing byte-for-byte with the whole-frame proxy:

```
output              1024 x 576        chunks 6
wholeFrameBytes     9,437,184         peakChunkBytes 1,572,864   (16.7%)
totalTransferred    9,437,184         row pitch identical to whole frame
mismatchedBytes     0                 byteIdentical true
timeToFirstTileMs   9.8               totalMs 59.5
```

Time-to-first-tile is 9.8 ms against 59.5 ms for the complete transfer, which is
the responsiveness the bounded contract is for.

## Gate 2 — Tile assembly matches the full-frame proxy within approved tolerance

**Status: met.**

`codebase/tests/test_geometry_region.py`, 40 cases, compares
`apply_geometry_region` against `apply_geometry` itself rather than against a
remembered constant. It covers a full grid of deliberately uneven tiles, every
boundary edge, single-row and single-column tiles, clamped out-of-range rects,
and odd/prime source dimensions.

**Approved tolerance.** Every route is exact except a windowed projective
resample that is not anchored at the warped origin, where composing the matrix
with a translation and renormalizing perturbs the float32 result in its last
bits. Measured worst case across the corpus: **6e-08 absolute, 9e-08 relative,
on 2 of 1680 samples**. RGBA16F transport carries roughly 1e-03 relative
precision, so this sits about four orders of magnitude below anything the
preview can represent. The test constants are `WARP_ATOL = WARP_RTOL = 1e-6`.

`codebase/tests/test_source_tile_api.py`, 16 cases, drives the real endpoint and
reassembles its tiles into the whole-frame proxy, with a 37-pixel step chosen so
the last row and column are partial. Coverage is asserted to be exactly one per
output pixel — no seam gap, no double coverage.

## Gate 3 — Geometry seams and edge padding pass for crop, rotation, perspective, and source boundaries

**Status: met.**

`test_tiles_follow_geometry_and_match_the_whole_frame` runs the full
tile-and-reassemble comparison through the live endpoint for six geometries:

| Case | Result |
|---|---|
| rotate 90 | assembled == whole frame |
| flips (H+V) | assembled == whole frame |
| crop | assembled == whole frame |
| rotate 270 + crop | assembled == whole frame |
| perspective (vertical 14°) | assembled == whole frame |
| roll (straighten 3.5°) | assembled == whole frame |

Halo behavior is asserted separately:

- a halo extends the delivered rect and reports core and delivered rects independently;
- a halo at the output edge is **clamped, not padded** — no invented pixels;
- the halo ring contains the real neighbouring output, checked by comparing a haloed tile's interior against the same tile requested without a halo (`assert_array_equal`, exact).

## Gate 4 — Cancellation, single-flight reuse, and stale-source rejection

**Status: met.**

| Behavior | Evidence |
|---|---|
| Stale source epoch | endpoint answers 409; every chunk after the probe pins the epoch the probe reported |
| Stale geometry signature | endpoint answers 409; the loader rejects before allocating anything |
| Stale edit revision | endpoint answers 409 |
| Mid-stream staleness | the partial texture is destroyed, nothing is published (`proxies.size == 0`), and the error is marked `recoverable` so Phase 1 retention keeps the previous presentation |
| Single flight | two concurrent `loadProxy` calls resolve to the same object; a third issues no requests at all |
| Backend declines | the loader returns `null` and allocates nothing, so the whole-frame route is a fallback rather than a failure |

## Regression evidence

| Suite | Result |
|---|---|
| Full Python suite (`.venv`, Python 3.12.10) | **`1073 passed, 3 skipped, 0 failed`** |
| Same suite before Phase 3 | `1017 passed, 3 skipped, 0 failed` — the +56 are this phase's new cases |
| `node --test` over five deterministic suites | `tests 41 / pass 41 / fail 0` |
| Playwright browser suites | see the list in the ledger; all pass |

## Carried-forward items

1. **The `roll` route still materializes.** A straighten or `perspective_rotate`
   with no keystone goes through `Image.rotate(expand=True)` and is sliced.
   Parity is exact and the browser response is still bounded, but the backend
   allocation is not. Reproducing Pillow's expansion and safe-inset geometry for
   a window would close it.
2. **Mask tiles are not yet bounded.** `GET /local-mask/{id}` still returns a
   full-frame byte payload, and the PRD's bounded-mask model (brush and gradient
   by region, luminance derived from the source tile on the GPU, Boolean
   intermediates in global coordinates, declared feather halos) is Phase 5 work.
   The source half of the transport contract is what Phase 3 owed.
3. **The 16,384-pixel bound still exists on the older endpoints.** The new
   source-tile route has no such ceiling, but `PreviewRequest`,
   `GeometryMapRequest`, `LocalMaskPreviewRequest`, `LocalLuminanceSampleRequest`,
   and the `/proxy` and `/local-mask` query parameters still carry it. They are
   retired as their consumers move to tiles.
4. **`TileUnavailableError` for downsample-needing geometries.** In practice the
   proxy for a tier is already at that tier's scale, so the post-geometry
   downsample is a no-op and this does not trigger; the guard exists so a
   parity-breaking tile can never be served silently.
5. ~~**No GPU trace.**~~ **Closed 2026-09-19** by [exact-tier-gpu-latency-2026-09-19.md](exact-tier-gpu-latency-2026-09-19.md), where the streamed loader ran on a real adapter: 6 chunks at 4K with a 16.8 MB peak response against a 90 MB total. The original note follows. The streamed loader was
   driven through a recording device stub and the live endpoint, not against a
   real WebGPU adapter.

## Verdict

All four Phase 3 exit-gate conditions are met, the full Python suite is green in
the correct interpreter for the first time in this sprint, and the environment
defect recorded in Phases 0–2 is retracted. **Phase 3 is closed.**
