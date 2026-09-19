# Phase 4 checkpoint — tile scheduler and tiled memory model

**Recorded:** 2026-09-19
**Sprint:** [Stable Exact Preview Tiers and Full-Resolution Processing](../product/Stable_Exact_Full_Preview_Sprint_PRD_2026-09-19.md)
**Status:** **Phase 4 is in progress.** Two of four exit-gate conditions are met.
**Source state:** `main` after the Phase 3 ledger commit
**Python:** `codebase/.venv` — Python 3.12.10

This is a reviewable checkpoint, not a phase closure. It lands the scheduling
and admission half of Phase 4, which is deterministic and carries no risk to the
working GPU path, and records exactly what the execution half still needs.

## What landed

### `frontend/tile-scheduler.js`

A standalone module owning identity, ordering, residency and admission. It
performs no GPU work and holds no GPU resources, so every rule in it is
deterministic and testable without an adapter.

**Globally anchored identity.** A tile key is built from the output rectangle in
global coordinates, never from a grid index:

```
<identity>|<x>,<y>,<width>,<height>|h<halo>
```

The same output region therefore keeps the same identity when the grid around it
changes — growing a 1024 × 512 output to 2048 × 1024 leaves the tile at
(512, 256) with the identical key, so a resize or pan does not orphan work that
is still valid.

**Declared halos, including the zero ones.** `NODE_HALOS` names every node
family. Pointwise nodes (`exposure`, `curves`, `color`, `grading`, `vignette`,
`grain`, `geometry`, `white-balance`) declare `0` rather than being absent, and
neighbourhood families (`detail`, `denoise`, `halation`, `bloom`, `softness`,
`mask-feather`) declare `null`, meaning the node supplies its radius. An
undeclared node throws. PRD 5.3 asks for halo metadata even where it is zero,
and this is what makes it impossible for a node to acquire a neighbourhood
dependency without saying so.

**Visible-region priority.** Every visible tile is ordered before every
offscreen tile, and visible tiles are ordered by distance from the viewport
centre. At Fit the whole image is visible, which matches PRD 5.3's requirement
that all image tiles complete before replacement.

**Bounded residency.** LRU eviction with a byte budget, returning the exact keys
evicted so the caller destroys those GPU resources and nothing else. Pinned keys
are never evicted — PRD 11.3 requires that eviction cannot destroy resources
referenced by submitted GPU work, so the budget is knowingly exceeded instead. A
freshly admitted tile is implicitly pinned against its own admission.

**Bounded scratch**, reserved and released separately so transient bytes never
accumulate.

**No mixed generation.** `presentableGeneration(plan)` returns a generation only
when every visible tile is accepted at exactly that generation, and `null`
otherwise. A set that mixes generations, or that lost a tile to eviction, is not
presentable, so the caller keeps the previous accepted presentation rather than
showing a torn frame.

### Tiled memory model in `buildRenderPlan`

`buildTiledPlan()` models the same graph under tiled execution and is attached to
**every** render plan as `plan.tiled`, so a Direct refusal always arrives with
the execution that replaces it rather than with a question about the resolution.

Tiling keeps the source proxy and the presentation surface whole, and sizes the
working set to one tile plus its halo:

| Resource | Direct | Tiled |
|---|---|---|
| source-proxy | whole | whole (unchanged) |
| presentation-surface | — | whole |
| grading core | `W×H×8×4` | `tile×tile×8×4` |
| grading detail | `W×H×8×2` | `tile×tile×8×2` |
| Denoise evidence/resolved/scratch | whole | per working tile |

## Gate 3 — 24 MP, 42 MP and 8K remain within configured budgets

**Status: met (modelled).**

`24MP, 42MP and 8K all fit the Auto budget under Tiled execution` asserts all
three sizes with two-level Denoise, Detail and spatial film active stay inside
the 2 GiB Auto budget under the tiled model.

`Tiled is what rescues a graph Direct cannot fit` drives 8K with four-level
Denoise: Direct exceeds the budget and the decision is `tiled`, the tiled
alternative fits, and `decision.tier` stays `"full"` throughout. That is the
sprint's core promise — admission changes execution, never resolution.

This is a **logical model**, consistent with how Section 4.1 defines the
baseline. Measured tiled residency requires the execution half.

## Gate 2 — Fit and zoomed views never show a mixed generation

**Status: met at the scheduler; not yet integrated.**

Seventeen deterministic cases in `codebase/tests/tile-scheduler.test.js` cover
grid coverage (every output pixel produced exactly once, including partial edge
tiles), halo clamping at output edges, Fit versus zoomed visibility, priority
ordering, LRU eviction, pinning, scratch bounds, generation-safe acceptance,
mixed-generation rejection, eviction making a set unpresentable again, and
identity invalidation.

Live in the running app with a 42.4 MP output: 176 tiles, all 176 visible at
Fit, 12 visible at a 1200 × 900 viewport, the first ordered tile visible,
visible set complete at one generation, and `presentableGeneration` returning
`null` the moment one tile is replaced at a newer generation.

The rules are proven. What is not yet true is that the renderer *consults* them —
that is the execution half.

## Gates 1 and 4 — not met

**Gate 1, Direct/Tiled pointwise parity**, and **Gate 4, CPU Full through a
bounded path**, both require tiled execution, which has not landed.

### What the execution half needs, and why it was not rushed

The render shaders derive the source texel directly from the fragment position:

```wgsl
let dimensions = textureDimensions(sourceTexture);
let coordinate = clamp(vec2i(input.position.xy), vec2i(0), vec2i(dimensions) - vec2i(1));
```

Source and destination coordinates are 1:1, which is good news — it means tiling
needs no change to the sampling logic, only a global origin added to the
fragment position. Rendering into a tile-sized target makes `position.xy`
tile-local, so each entry point needs:

```wgsl
fn globalCoordinate(position: vec2f) -> vec2i {
  return vec2i(position) + vec2i(i32(p[160]), i32(p[161]));
}
```

with `PARAM_COUNT` raised from 160 to 162 and the tile origin written per tile.
That touches roughly fifteen fragment entry points in a 4,800-line WGSL-bearing
file, and the parity gate requires the tiled result to match Direct. Landing it
half-checked would risk the GPU path that was just measured at 2.3 ms p95 at 4K,
so it is staged rather than squeezed in.

Atomicity is already solved by the architecture: one `getCurrentTexture()`, one
command encoder, every tile pass encoded into it, one `submit()`. The canvas
presents the complete assembly or nothing, so no mixed set can reach the screen.

**Engineering-only Full selection** is deliberately still absent. Exposing Full
before tiled execution exists would be exactly the "Direct-only Full" the PRD
lists as a non-goal, and on the director's own adapter
(`maxTextureDimension2D` = 8192) a Full graph above 8192 px cannot be
Direct-admitted at all.

## Regression evidence

| Suite | Result |
|---|---|
| Full Python suite (`.venv`) | `1073 passed, 3 skipped, 0 failed` |
| `node --test` over six deterministic suites | `tests 62 / pass 62 / fail 0` |
| Playwright browser suites | all pass |
| Live app | `window.HDRTileScheduler` loads and behaves as tested |

`tile-scheduler.js` is served from `index.html`, and the asset cache-busting
contract test was updated from 7 to 8 versioned assets, now naming both
schedulers explicitly rather than counting anonymously.

## Next

1. Thread a tile origin through the fragment entry points (`PARAM_COUNT` 160 → 162).
2. Encode all tiles of a generation into one command buffer against one canvas texture.
3. Parity corpus: tiled versus Direct over the pointwise graph.
4. Measured tiled residency at 24 MP, 42 MP and 8K, to replace the modelled figures above.
5. CPU tiled/strip execution and cancellation.
6. Engineering-only Full selection, once 1–5 hold.
