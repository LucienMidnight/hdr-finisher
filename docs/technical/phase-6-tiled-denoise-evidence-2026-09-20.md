# Phase 6 — tiled Denoise evidence and reconstruction

**Recorded:** 2026-09-20
**Sprint:** [Stable Exact Preview Tiers and Full-Resolution Processing](../product/Stable_Exact_Full_Preview_Sprint_PRD_2026-09-19.md)
**Status:** **all five exit gates met.**
**Adapter:** NVIDIA `lovelace` (RTX 4070 Ti), not a fallback, headless Edge with
`--enable-unsafe-webgpu --enable-features=Vulkan,UseSkiaRenderer`

## The thing that made this phase easy, and why it is worth stating

Detail needed a halo, and Phase 5 spent most of its effort getting that halo
right. Denoise needs none at all, and recognising that early is what turned this
phase from an approximation exercise into an equality one.

`compact-haar-residual-v1` is a Haar transform over **non-overlapping 2x2
blocks**. Level 0 reads source `[2q, 2q+1]`. Level 1 reads the level-0 low band
at `[2r, 2r+1]`, which is source `[4r .. 4r+3]`. No stage reads outside its own
block. So a tile does not need neighbouring pixels; it needs to sit on the same
block grid the whole image uses. That is one rule:

> a denoise tile origin must be a multiple of `2 ** levels`

with tiles contiguous so the last tile in each row and column runs to the image
edge, and a trailing span shorter than two pixels absorbed into its neighbour.
Edge padding matches for the same reason: the reference pads only when a
dimension is odd, and the only tile with an odd dimension is the one that ends
at the image edge — exactly where the whole image pads.

The consequence is stronger than "no visible seam". Tiled analysis and tiled
reconstruction are **bit-identical** to the whole-image routines, so the tests
assert equality rather than a tolerance, and any difference at all is a defect.

## Exit gate 1 — tile seams, wavelet alignment, odd dimensions, image edges

**Status: met, bit-identical on both the CPU reference and the GPU.**

### CPU reference

`backend/hdr_finisher/denoise_tiles.py` adds `analyze_denoise_tiled()` and
`resolve_denoise_tiled()`. Each tile runs the **unmodified** reference rather
than a second copy of the maths — deliberately, because a tiled path carrying
its own arithmetic could drift, and the equality test would then be comparing a
function against itself.

`tests/test_denoise_tiles.py` (44 cases) asserts array equality for:

- levels 1-4 against tile sizes 16, 32, 48 and 64;
- dimensions 33x27, 64x31, 17x64, 7x5 and 129x97, which cover odd in one axis,
  odd in both, smaller than a tile, and a partial last block in each direction;
- analysis, reconstruction, and the two composed as the renderer runs them;
- a region reconstruction touching only its region;
- the tile grid covering every pixel exactly once, on the `2 ** levels` grid.

One of those tests exists to keep the others honest: a deliberately misaligned
sub-rectangle **must** produce different coefficients. Without it, a tiling that
quietly fell back to whole-image analysis would pass everything above.

### GPU

`tests/denoise-tiled-parity.js` compares the renderer against *itself* with a
denoise tile larger than the image — one tile, and therefore exactly the
whole-image decomposition Phase 5 shipped. Same device, same shaders, same
proxy, same settings, so tiling is the only variable.

| Proxy | Levels | Tile sizes | Tiles | Differing samples | Max delta |
|---|---:|---|---:|---:|---:|
| 1024 x 576 | 1, 2, 3, 4 | 64, 192, 256, 320 | 8 to 144 | **0 / 2,359,296** | **0** |
| 1023 x 575 | 1, 2, 3, 4 | 64, 192, 256, 320 | 8 to 144 | **0 / 2,352,900** | **0** |

32 configurations, every one exact. The 1023 x 575 rows are an odd proxy
requested on purpose: both source dimensions and every band extent below them
are odd, which is where edge padding, partial trailing tiles and the absorbed
short span all meet at once. Tile sizes 192 and 320 do not divide the proxy, so
the last tile in each row and column is partial.

## Exit gate 2 — live-control changes issue no analysis dispatch

**Status: met.**

`denoiseCounters.analysisDispatches` exists to make this checkable rather than
assertable-by-inspection. Four drags of Amount, Luminance, Color Noise and
Detail Recovery across their range:

```
live controls: 4 drags -> 0 analysis dispatches, 128 reconstruction dispatches  PASS
```

The contract is also enforced statically. `test_denoise_phase_two_keeps_analysis_structural_and_resolve_reconstruction_only`
now slices out the body of `resolveDenoiseProxy` and asserts that
`pipelines.analysis` does not appear in it at all, which is the property rather
than a proxy for it: reconstruction cannot dispatch analysis if it never names
the analysis pipeline.

## Exit gate 3 — an analysis cannot replace a valid result until complete

**Status: met.**

The selector swap is the last statement on the success path and happens only
there. The test starts an analysis with different settings, supersedes it
mid-flight by bumping the selector generation — exactly what a newer request
does — and asserts that the previous selector object, its selected source, its
cache identity and its resolved texture are all still in place, and that the
superseded call returned false rather than installing anything.

## Exit gate 4 — two- and four-level 24 MP, 42 MP and 8K memory traces

**Status: met, measured, at the shipped `auto` 2 GiB budget.**

`tests/performance/denoise-memory-trace.js`, native resolution through the
engineering Full gate, reading the renderer's own categorized diagnostics:

| Source | Levels | Tiles | Evidence | Resolved | Analysis scratch | Reconstruction scratch | Peak | Budget |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 6000 x 4000 (24.0 MP) | 2 | 24 | 180.0 MB | 192.0 MB | **2.6 MB** | 2.1 MB | 1341.3 MB | 2147.5 MB |
| 6000 x 4000 (24.0 MP) | 4 | 24 | 191.3 MB | 192.0 MB | **2.8 MB** | 2.8 MB | 1353.2 MB | 2147.5 MB |
| 5320 x 7968 (42.4 MP) | 2 | 48 | 317.9 MB | 339.1 MB | **2.6 MB** | 2.1 MB | 1042.5 MB | 2147.5 MB |
| 5320 x 7968 (42.4 MP) | 4 | 48 | 337.8 MB | 339.1 MB | **2.8 MB** | 2.8 MB | 1063.1 MB | 2147.5 MB |
| 7680 x 4320 (33.2 MP) | 2 | 40 | 248.8 MB | 265.4 MB | **2.6 MB** | 2.1 MB | 1850.6 MB | 2147.5 MB |
| 7680 x 4320 (33.2 MP) | 4 | 40 | 264.4 MB | 265.4 MB | **2.8 MB** | 2.8 MB | 1866.0 MB | 2147.5 MB |

**Analysis scratch is 2.6 to 2.8 MB at every size**, against about 106 MB for a
whole-image two-level chain at 42.4 MP held all at once. That is the measured
result of tiling the analysis, and it is the number to watch if the 1024-pixel
denoise tile ever changes. The test asserts it stays under 16 MB and that it
does not vary with the source.

### What is still whole-frame, stated plainly

The resolved proxy is one full-size `rgba16float` texture and is the largest
single denoise allocation at every size above. Region reconstruction writes into
it rather than replacing it, so zoom and pan are cheap in **work** but not yet
in **residency**. Making the resolved image per-tile as well needs the grading
path to source from resolved tiles, which is a render-path change rather than a
denoise one. It is recorded as remaining work rather than claimed, and the gate
is met without it because the measured peaks fit the budget.

## Exit gate 5 — existing preview-tier gates do not regress

**Status: met, with no documented exception needed.**

`denoise-selector-seam` passes, as do the other 19 browser suites, the full
Python suite and the deterministic Node suites. See the regression table below.

## Zoom and pan from cached evidence

`resolveDenoiseProxy(controls, { region })` rebuilds only the tiles a region
touches, from evidence that is already resident:

```
zoom/pan: 341x191 request rebuilt as 640x320 (34.8% of the frame) from cached
evidence using 2/8 tiles, 0 analysis dispatches  PASS
```

(The rounded rectangle depends on the tile size in force, so this figure moves
between configurations; what is asserted is that it covers the request, that
nothing outside it changed, and that no analysis ran.)

A request is honoured at **tile granularity** — a tile is the smallest unit
whose evidence indexing lines up — so the rectangle actually rewritten is the
union of the tiles touched, not the exact request. The renderer reports that
rounded rectangle as `selector.resolvedRegion`, because a caller that could not
tell what had been rewritten would have to assume the worst and redo the frame.
The test asserts the rounded rectangle covers the request, that everything
outside it is untouched, and that no analysis ran.

## A defect this phase found in the CPU reference

The first run of the bit-identical tests failed at levels 3 and 4 by about one
ULP. The Haar chain was exact; the drift was in `_rgb_to_components`, which used
`np.tensordot`. That dispatches to BLAS, which blocks and accumulates
differently depending on how many rows it is handed, so the same pixel came out
up to one ULP apart depending on whether it was analysed as part of the whole
image or as part of a tile:

```
tensordot: whole vs 4-row chunks identical: False  maxdiff: 1.1920929e-07
explicit : whole vs 4-row chunks identical: True   maxdiff: 0.0
```

A reference whose result depends on how the work is chunked cannot be the
reference a tiled implementation is checked against. It is now written out in a
fixed evaluation order that is identical at every chunk size. This is a change
to shipped numerics of at most one ULP, and the full Python suite passes
unchanged around it.

## Cache identity, pinned across both languages

`denoise_cache_identity()` in Python and `denoiseCacheIdentity()` in JavaScript
build the same string, and both are asserted against the shared literals in
`tests/fixtures/denoise-cache-identity.json`. Either drifting fails on its own
side.

The identity excludes Amount, Luminance, Color Noise and Detail Recovery
entirely — they consume evidence and never create it, so including them would
make every slider drag a cache miss, which is the behaviour the wavelet cache
exists to avoid. It includes the source, the algorithm version and every locked
analysis setting, each of which is asserted to invalidate it.

## Regression evidence

| Suite | Result |
|---|---|
| Python, full suite in `codebase/.venv` | **1254 passed, 3 skipped, 0 failed** |
| `node --test` over the deterministic suites | **tests 77 / pass 77 / fail 0** |
| `denoise-tiled-parity` | 32 exact configurations, plus the live-control, zoom/pan and atomicity gates |
| `denoise-memory-trace` | six traces within budget |
| 20 browser suites | **20 / 20 pass** |

The Python total is 1254 against the Phase 5 close of 1210, the 44 added cases
all coming from `test_denoise_tiles.py`. The Node total is 77 against 72, the
five added cases being the cross-language identity fixture, the live-control
exclusion, the analysis-setting invalidation, the tile grid, and the absorbed
short span.

## Document corrections

[`denoising.md`](denoising.md) told implementers not to build source-resolution
tiling for v2, and listed the Phase 2 memory stop gate as open. Both are
corrected, with the previous instruction quoted rather than deleted:

- **Section 6** now records why the seam risk it named does not apply to a Haar
  decomposition, states the alignment rule, and documents region reconstruction.
- **Section 7** replaces the estimated guardrails with the measured table above
  and names the resolved proxy as the remaining whole-frame allocation.
- **Section 5.1** records that the cache identity is now one function written
  twice and pinned by a shared fixture.
- **The status header** closes the Phase 2 memory stop gate, and says plainly
  that the budget is a configured one rather than a driver heap reading, because
  the WebGPU API still does not expose heap usage.

## Next

1. Make the resolved proxy per-tile, which needs the grading path to source
   from resolved tiles. That is the last whole-frame denoise allocation.
2. Denoise corpus tuning remains Phase 4 of the denoise contract's own sequence
   and is untouched here; the presets are still provisional engineering
   defaults.
