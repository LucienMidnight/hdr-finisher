# Phases 7 and 8 — completion evidence

**Date:** September 20, 2026
**Commits:** `012e562`, `be1b9bc`, `839630a`, `37cd361`, `adf48e8` on `main`.

Covers the rest of Phase 7 after the film modules and the exact scope peak, and
the two Phase 8 work items that are engineering rather than judgement.

## Phase 7 — the last refusal

Denoise was the only module the tile scheduler still refused, and the reason was
memory rather than correctness: reconstruction filled a whole-frame resolved
texture, 340 MB on a 42 MP frame **on top of** the source proxy. Direct could
not fit that and Tiled would not take it, so a denoised Full had no route at
all.

Reconstruction now accepts a bounded destination. The resolve shader gained a
destination origin so it reads the original at its true frame position while
writing into a tile-sized texture; whole-frame callers leave it at zero and are
unchanged. The memory model's `tile-denoise-resolved` entry finally describes
what is allocated rather than what was intended.

It also had to join the render's single submission, since one submission per
generation is what makes replacement atomic. `resolveDenoiseProxy` can encode
into a caller's encoder, returning the parameter buffer for the caller to free
after its own submit; the tile loop became a `for...of` so it can await each
reconstruction in order.

Two guards the change needed:

- The halo rounds up to the wavelet alignment when denoise is active. A Haar
  decomposition indexes from the frame's origin, so a tile starting off the grid
  reconstructs against the wrong parity. It needs no halo of its own — no stage
  reads outside its own block — only alignment.
- Denoise counts as active only when the analysis ran on a frame of this
  render's size. The graph renders undenoised rather than wrongly.

**Evidence.** In `tiled-direct-parity.js`, the denoise *refusal* check is
replaced by the parity it was standing in for. Direct (whole-frame resolved)
against Tiled (per-tile reconstruction) is byte-exact at tile sizes 256 and 512:
maxDelta 0, 0 of 631,626 pixels differing, one submission. The suite asserts
Direct is actually reading the reconstructed source first, or it would be
comparing two undenoised renders. A further check asserts the scheduler now
refuses **nothing**, so a silent fallback cannot creep back in.

**With this, every preview module runs tiled. Full is available for any graph.**

## Phase 7 — comparison disclosure

The two preview panes are filled by different calls. The comparison pane renders
the other lane at the settled proxy edge; the primary holds whatever tier is
selected, which since Phase 1 may be larger, up to Full. Side by side at the
same on-screen size, two processing resolutions look like a difference in the
grade, and a colourist reading them as an A/B would attribute a resampling
difference to their own decisions.

The gate does not ask the panes to match — that would mean refusing Full in
comparison or paying for a second Full render. It asks that comparison never
present unlike tiers *as an exact comparison without disclosure*. So each pane
records what it actually presented, on the WebGPU route and the cached-CPU route
alike, and the stage says so when they disagree.

**Evidence.** `tests/comparison-disclosure.js`: matched panes disclose nothing
(asserted as hard as the rest — a banner that is always on is a banner nobody
reads); a tier difference reads "Not an exact comparison — Full vs 1024px"; a
generation difference reads "edit 4 vs 1"; both together name both; the claim
clears on agreement and on leaving comparison. Checked at 1680x1000 as a
single-line bar across the bottom of the stage.

## Phase 8 — authored denoise on export

**An export silently discarded it.** Denoise is authored beside the grade rather
than inside it: `LoadedSession` holds it directly, an `EditDocument` one level
down, and neither is an `AdjustmentState`. The export graph grades
`session.image` through `apply_adjustments`, which is handed an
`AdjustmentState` — so the settings were not reachable from where export ran. A
user who denoised, looked at the result and exported got their noise back, with
nothing saying so.

Export now denoises the full-resolution source **before** grading, because that
is where the preview does it. Denoising after the grade would make preview and
export differ by *where in the graph* the noise was removed, which no resolution
parity could excuse. It reconstructs through `analyze_denoise_tiled` /
`resolve_denoise_tiled`, which Phase 6 proved bit-identical to the whole-image
routines: the export stays bounded on a 42 MP frame, and it is the same
arithmetic the preview's GPU path was pinned against by the shared fixture.

A first attempt read `session.document.denoise` and would have done nothing at
all. Both shapes are read now, and a test pins both so a future move fails
loudly instead of quietly reintroducing the same silence.

**Evidence.** `tests/test_export_denoise_parity.py`, 11 cases, including: the
export source is *exactly* the reference reconstruction by `assert_array_equal`;
the bounded route equals the whole-image one; denoise that contributes nothing
is skipped rather than run to a no-op; the lanes are independent; authored
analysis settings reach the reconstruction (two levels and four differ, so a
default cannot be silently substituted); and `_render_export_branch` itself
renders different pixels with denoise on and off — the integration check that
catches computing the denoised source and then not using it.

## Phase 8 — preview/export parity

Preview grades with grain and the limiter inline. Export withholds both, applies
output finishing, then runs them — deliberately, because finishing's ringing has
to land under the limiter's ceiling rather than on top of it. The cost is that
the two run the same stages in a different order, and the only thing keeping
them the same picture is that the stages that moved commute with the one they
moved around. Nothing was checking that.

With output finishing neutral — its default — export is now pinned to be
**exactly** the preview graph by `assert_array_equal`, both lanes. That equality
is what "export-exact" has to mean before Full may be labelled with it.

The other half of the label, that the WebGPU graph preview runs at Full agrees
with the CPU one, is `tiled-cpu-detail-parity.js`, and is a tolerance rather than
an equality because GPU and CPU arithmetic differ.

Also pinned, from the "HDR range, negative values, edges" bullet: HDR headroom
survives above 1.0 and SDR holds at or under its ceiling; output is float32 with
nothing non-finite; a wide-gamut sample that is negative outside the working
primaries survives grading but does not reach the delivery; and the two
viewer-only view maps are stripped from export and only those, without mutating
the session.

## Two defects found by the full sweep

Running all 51 browser suites rather than the subsets each change came with
found two things.

**The measurement competed with session replacement.**
`test:session-replacement` began failing at `644fd42`, found by bisecting the
frontend across this session's commits. The exact-peak pass now declines to
start while an import is in progress, and captures the session id and import
generation it began under; a result arriving after either moved is dropped and
not cached, because a later session could otherwise read the previous one's
answer as its own.

**The metadata rail could be opened and not shut.** At compact-workspace widths
the source rail opens as an overlay at `z-index: 30`, under `.viewer-bar` at 40.
The bar covered the rail's own collapse button. The overlay now sits at 45:
above the bar, below tooltips and menus at 50 and up. This predates the session.

## Suite state

- `pytest -q` from `codebase/`: **1274 passed, 3 skipped**.
- `node --test tests/*.test.js`: **77 / 77**.
- Browser suites: **50 of 51**, after the two fixes above.

The one remaining failure is `test:local-design`, and it is now a different
failure from the one this session cleared. It expects the toggle knob to be 24px
with a radial gradient at `z-index: 1`; the shipped component is 16px with a
linear gradient at `z-index: 2`. That is a disagreement about the visual spec
rather than a bug, and satisfying it would change every toggle in the
application, so it is left for a design decision rather than guessed at.

## What Phase 8 still owes

- **Denoise corpus acceptance.** Tuning or rejecting the presets against the
  approved photo/render corpus wants judgement on real images, not a test.
- **Progressive disclosure** for Strength, Detail Recovery, Luminance and Colour
  Noise — a UI decision, with the constraint that it must not change results
  silently.
- **The export-exact label itself.** The numbers now support it; applying it is
  a product call.
