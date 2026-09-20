# Phase 7 — film modules on the tiled path

**Date:** September 20, 2026
**Scope:** the first three of Phase 7's six work items — vignette, deterministic
grain, and the spatial film effects — on both the GPU tiled path and, for the
two placed stages, the CPU strip path.
**Commits:** `8708333`, `d4fa1dc`, `4c14b15` on `main`, base `582d5ec`.

Phase 7 is **not closed**. Three of its six work items are done and evidenced
here; the remaining three are listed under *Not done* with the decision each one
turns on.

## The defect class

All three modules were refused by the tile scheduler, and vignette and grain
were refused by the CPU strip path, for the same reason: each derived its
geometry from the array or texture it was handed rather than from the picture.

- A vignette is *placed against the frame*. A tile that read
  `textureDimensions(sourceTexture)` would have drawn a complete small vignette
  inside itself.
- Grain is a *fixed field over the frame*. A tile that indexed the noise from a
  tile-local coordinate would have restarted the field at every tile origin.
- Halation and bloom blur on a quarter-resolution intermediate whose grid was
  `sourceDimensions / ceil(sourceDimensions / 4)` — a proportional rescale of
  whatever texture it lived in, which a tile cannot reproduce at any halo.

Image structure and film resolution were a fourth case and a gap rather than a
refusal: they blur the film texture directly, allocate nothing, and so never
appeared in `spatialActive` and never earned a halo. A tiled render with image
softness and no halation would have seamed. The CPU strip path had always
counted them under "spatial film effects".

## What replaced it

**One vocabulary in the shader**, defined ahead of the film stage:
`frameDimensions()` for any radius expressed as a fraction of the frame or as a
distance on the film plane, `frameCoordinate()` for this pixel's place in the
picture, and `validTileDimensions()` moved up from the Detail section because it
was always the general rule. Direct leaves the tile origin at zero, which makes
`frameCoordinate()` the identity there.

`boundedCoordinate` now clamps to the valid tile rather than to the work
texture. The work texture is allocated once at the largest tile plus halo and
reused, so an edge tile's valid region is smaller than the texture it sits in,
and every film-stage neighbourhood read was free to sample what the previous
tile had left there. The finish pass had the same defect.

**A frame-anchored quarter grid.** The spatial intermediates are now anchored to
the frame at a strict factor of four. With a halo that is a multiple of four, a
tile's texel *j* is the frame's texel *j + haloRect.x / 4*, covering the same
four source pixels Direct covered. Sampling moved from normalized uv to texel
coordinates, because an edge tile's texture is larger than its valid region and
the clamp has to stop at the last valid texel rather than at the texture's edge.

This changes Direct's extract phase by a fraction of a quarter-resolution texel
— 4.0 where it was 3.9925 on a 1058-wide frame. It is a sub-pixel shift in a
downsampled intermediate that is then blurred by 4 to 256 pixels, and it is what
lets one grid serve both routes.

**A halo derived the same way twice.** `spatialTileHalo()` mirrors the shader's
radius derivation line for line, because a halo derived differently from the
radius it covers is a seam waiting for one particular setting.
`composedTileHalo()` sums it with Detail's — the extract needs a Detail-correct
film input across its own reach, so the two compose rather than compete — and
rounds up to a multiple of four.

**`FrameWindow` on the CPU side**, threaded from the strip renderer through
`apply_fixed_source_adjustments` into all three graders to `_apply_vignette` and
`apply_final_grain`. It is `None` on the whole-frame path, where the region is
the frame and the offsets are zero, so that path computes exactly what it always
did.

## Gate evidence

### Direct/Tiled parity, `tests/tiled-film-parity.js`

Test pattern, 1058x597, over a non-neutral grade (exposure +0.85, contrast 18,
saturation 12), at tile sizes 256 and 512. Byte-exact throughout: the threshold
is `maxDelta <= 0`, not a tolerance.

| Case | Halo | Work tile | maxDelta | Differing |
|---|---|---|---|---|
| vignette+grain | 0 | 256x256 / 512x512 | 0 | 0 / 631,626 |
| grain view map | 0 | 256x256 / 512x512 | 0 | 0 / 631,626 |
| spatial | 40 | 336x336 / 592x576 | 0 | 0 / 631,626 |
| spatial at maximum radii | 136 | 528x528 / 784x576 | 0 | 0 / 631,626 |
| halation view map | 22 | 300x300 / 556x556 | 0 | 0 / 631,626 |

The vignette is deliberately off-centre (amount -55, centre 0.33/0.61): a centred
one is symmetric about the frame and a tile-local placement could still average
out to something close. The two view maps replace the picture with a grey card
or the halo field alone, so drift has nothing to hide behind.

Every generation submitted exactly once, so replacement stayed atomic.

### Grain determinism

Tile sizes 256 and 512 divide the frame along different boundaries. The two
tiled renders agree with **each other** exactly — maxDelta 0 over 631,626
pixels, with and without the grain view map — which is what makes the field
deterministic rather than merely close to Direct.

### The tests are load-bearing

Two negative controls, each run against the same suite:

| Control | Result |
|---|---|
| Spatial halo forced to zero | 15,425–59,074 pixels differ, maxDelta 255 |
| Halo grown by two, breaking quarter-texel alignment while leaving more reach than needed | 1,199–24,188 differ, maxDelta 255 |

The second is the important one: it shows the *alignment* is doing the work, not
the halo's size. A misaligned grid fails however generous the halo.

### CPU strip parity, `tests/test_cpu_strips.py`

`test_placed_stages_are_exact`, parameterized over HDR and SDR: the same
off-centre vignette and grain over a 61-row frame on a 4,096-byte budget, so
there are many strip boundaries to disagree at. Strip output equals the
whole-frame reference exactly, by `assert_array_equal`.
`test_grain_view_map_is_exact_in_strips` does the same with the grey card.
`test_placed_stages_do_not_refuse` checks the refusal list agrees.

### A planner defect found on the way

`planRender` was called without a halo, so `buildTiledPlan` modelled a bare tile
while the encoder built a tile plus its halo. Admission was being decided
against a working set nobody allocates. Detail alone made this a 256-against-322
error; the spatial halo makes it 256 against 528 on a side. `composedTileHalo()`
is now the single definition both call.

## Suites

- `codebase/.venv/Scripts/python.exe -m pytest -q`, run from `codebase/`:
  **1255 passed, 3 skipped**. Up three tests from Phase 6's 1254, and down the
  two parametrize cases that became parity cases.
- `node --test tests/*.test.js`: **77 / 77**.
- `node tests/tiled-direct-parity.js`: byte-exact at both tile sizes and at
  maximum Detail radii; Detail cache behaviour unchanged.
- `node tests/tiled-cpu-detail-parity.js`: seam introduced by tiling 0.0000.
- `node tests/denoise-tiled-parity.js`: unchanged.
- 19 browser suites, all passing: `webgpu-shader`, `webgpu-memory`,
  `webgpu-allocation-agreement`, `gpu-scopes`, `gpu-highlights`,
  `sdr-match-gpu`, `sdr-gamut-gpu`, `gpu-local-adjustments`, `scope-region`,
  `denoise-selector`, `tiled-parity`, `tiled-admission-scopes`,
  `tile-scheduler`, `render-plan`, `viewer-state`, `performance`,
  `local-adjustments`, `many-local-layers`, `export-browser`,
  `preview-resolution`, `source-disclosures`, `exact-tier-latency`.

## Tests whose assertions moved

Three tests asserted refusals that are now lifted. Each was repointed at a
refusal that is still true rather than deleted:

- `tiled-direct-parity.js` — asserted vignette, then halation, now **denoise**,
  the one module the tile scheduler still refuses.
- `test_cpu_strips.py::test_refusal_carries_every_reason` and
  `test_cpu_strips_api.py::test_strip_execution_refuses_a_graph_it_cannot_reproduce`
  — asserted vignette, now **spatial film effects**, which the CPU strip path
  still refuses.

`test_frontend_contract.py` pinned three film radius expressions by exact text.
They assert the same properties — bloom output-relative, halation film-plane —
against the frame's quarter-resolution extent.

## Not done

Three of Phase 7's six work items remain, and Phase 7's exit gate is open.

**Spatial film effects on the CPU strip path.** The GPU tiled path takes them;
`strip_execution_refusals` still names them, so a CPU Full with halation falls
back to whole-frame CPU — exact, but not bounded. The refusal is conservative
rather than wrong. The work is the numpy equivalent of what this phase did in
WGSL and is well-specified by it.

**Scopes from accepted selected-tier generations, with tile-wise accumulation.**
This is blocked on a design decision rather than on effort, and it should be
taken deliberately:

The scope pass is not a histogram. It is a *downsample*: each cell of a
width x height grid carries the mean colour and the peak over its footprint of
the finished frame. Direct keeps the whole-resolution `finishTexture` resident
and reduces on demand at whatever resolution the UI asks for. Tiled cannot —
that texture is the thing tiling exists to avoid.

An exact tiled accumulation is available: each tile writes its cells' partial
sums divided by the *full* cell sample count, with additive blending on RGB and
max blending on alpha for the peak. Cell-to-tile assignment needs no extra
channel because the divisor is analytic. That part is clean.

The unresolved part is resolution. Accumulation has to happen at encode time, at
one fixed scope resolution, while `analyzeScope` is called later at a resolution
the UI chooses. Either the accumulation runs at the maximum the UI can request
and `analyzeScope` box-reduces from it — exact only when the requested grid
divides the accumulated one — or the scope resolution becomes a property of the
generation and the UI takes what it is given. The second is more honest and
changes the scope UI's contract; the first is invisible but has a correctness
caveat at some grid sizes. **This is a product decision about what a scope
promises, not an implementation detail**, which is why it is written down here
rather than guessed at.

Until it is taken, the Phase 4 behaviour stands and is truthful: a tiled
presentation drops the GPU scope source and settles through the CPU scope route,
which `tests/tiled-admission-scope-fallback.js` asserts.

**HDR/SDR comparison and A/B tier disclosure, and proofing.** Untouched. Phase 1
carried "Phase 7 scope/comparison tightening" forward and it is still forward.

**The Phase 6 loose end** — the resolved denoise proxy is still whole-frame, and
`denoise` is still the tile scheduler's only refusal. It is a render-path change
and remains available to take with the rest of Phase 7.
