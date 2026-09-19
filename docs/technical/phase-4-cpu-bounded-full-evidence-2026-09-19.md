# Phase 4 — CPU Full through a bounded path

**Recorded:** 2026-09-19
**Sprint:** [Stable Exact Preview Tiers and Full-Resolution Processing](../product/Stable_Exact_Full_Preview_Sprint_PRD_2026-09-19.md)
**Status:** **Exit gate 4 met.** All four Phase 4 exit gates are now closed.
**Companion:** [phase-4-tiled-execution-evidence-2026-09-19.md](phase-4-tiled-execution-evidence-2026-09-19.md) (gates 1 to 3)
**Environment:** `codebase/.venv` — Python 3.12.10. Backend only; nothing in this
phase touches the GPU render path.

The whole-frame CPU route builds the geometry-fixed frame and then every
intermediate `apply_adjustments` needs, so its peak host RAM follows the
selected tier. Measured on the reference 42.4 MP source at Full, that is
**4,083 MB** of transient float32 for one picture the user may abandon
mid-gesture. This phase adds a route that produces the *same bytes* from a
constant working set, and stops between strips when superseded.

## Gate 4 — CPU Full executes through a bounded path

**Status: met, measured on a real 42.4 MP source at Full, byte-exact.**

`codebase/tests/performance/cpu-strip-full.py`, against
`Affinity_DSC06898_DisplayP3_Linear_32f.exr` (5320 × 7968 = 42.4 MP), HDR lane,
a non-neutral grade (exposure +0.85, contrast +18, saturation +12, white balance
5200 K, a thirteen-node tone equalizer, Peak Fit highlight compression):

| Route | Strip budget | Strips | Peak host bytes | **Transient above the output frame** | Seconds | Max channel delta | Differing samples |
|---|---:|---:|---:|---:|---:|---:|---|
| Whole frame | — | — | **4,083 MB** | 3,598 MB | 14.43 | — | — |
| Bounded strips | 16 MB | 443 | **496 MB** | **10.8 MB** | 12.12 | **0** | **0 / 127,169,280** |
| Bounded strips | 48 MB | 143 | **518 MB** | **33.3 MB** | 14.68 | **0** | **0 / 127,169,280** |
| Bounded strips | 128 MB | 54 | **574 MB** | **89.1 MB** | 14.47 | **0** | **0 / 127,169,280** |

The 496 MB figure is not a floor the design chose: **485 MB of it is the output
frame itself**, which the caller asked for and every route has to hold. What sits
on top of it is 10.8 MB against a 16 MB budget — it tracks the budget, not the
image, and stays inside it at every setting. That is the same property gate 3
established on the GPU: the graph's intermediates stop following the picture.

Re-run to confirm: identical peaks and deltas, timings within 0.3 s.

**The SDR lane, same source, same Full tier**
(`cpu-strip-full-42mp-sdr.json`):

| Route | Strip budget | Strips | Peak host bytes | Seconds | Max channel delta | Differing samples |
|---|---:|---:|---:|---:|---:|---|
| Whole frame | — | — | **3,881 MB** | 14.64 | — | — |
| Bounded strips | 16 MB | 443 | **499 MB** | 15.15 | **0** | **0 / 127,169,280** |
| Bounded strips | 48 MB | 143 | **527 MB** | 16.02 | **0** | **0 / 127,169,280** |

SDR pays about 4% for its anchor pass, because its Peak Fit shoulder sits early
in the chain and has to be measured over the frame before the render can start.
That is the honest cost of the exactness; the HDR lane avoids it because its
anchor is reduced from the render's own output buffer.

Peak is `tracemalloc` over the whole call, which sees numpy's data allocations.
Raw report at the ignored path `codebase/output/performance/cpu-strip-full-42mp.json`.

**It is not slower.** At the smallest budget it is faster than the whole-frame
route (12.12 s against 14.43 s), which is what better cache locality buys back;
at larger budgets the two are within noise of each other. Rendering Full on CPU
is still seconds, which PRD 2.5 permits explicitly.

### Cancellation

Superseding the render after three strips stopped it in **0.19 s** of a 14.4 s
job — 4 checks of 143 strips, about 1.3% of the work. The check runs once per
strip in every pass, so the abandoned work is bounded by one strip rather than by
the frame. `StripCancelled` is translated to the existing `StaleRender` at the
`SessionRenderCache` boundary, so every caller sees the cancellation contract it
already handles.

## Why it is exact rather than close

A pointwise graph is not entirely pointwise: three values come from the whole
frame, and a strip that measured any of them for itself would anchor on itself.

| Whole-frame reduction | Who needs it | How the strip path gets it |
|---|---|---|
| HDR Peak Fit source peak | `_tone_adjusted_source_peak_nits` | reduced over the frame after the graph pass, injected as `HighlightAnchor.hdr_source_peak_nits` |
| HDR delivery-ceiling branch | `_clip_to_output_target` | reduced over the *compressed* frame, injected as `hdr_output_transport_max` |
| SDR Peak Fit peak | `_compress_sdr_highlights` | reduced over the frame at the highlight stage's own input, injected as `sdr_peak` |

`_clip_to_output_target` is the subtle one. Its early return —
`if max(transport) <= target: return clip(image, 0, None)` — is not
interchangeable with the branch below it once a delivery channel is negative, so
a strip whose own maximum sat under the target would take a different transform
from the whole frame. Blinding only that anchor and re-running the corpus
reproduces the disagreement at 8.96e-04, which is why it is measured rather than
assumed.

**The robust (0.9999 quantile) measurement is reduced exactly, not
approximated.** `np.quantile` at that position reads only the two order
statistics either side of `0.9999 × (n − 1)`, so retaining the largest *k*
samples reproduces it bit for bit — about 4,200 float32 values for a 42 MP
frame, whatever the frame's size. `_PeakReducer` implements numpy's own linear
interpolation including the branch it takes at or above the midpoint;
`test_peak_reducer_reproduces_numpy_quantile_exactly` asserts equality against
`np.quantile` directly.

### Staging, and why the graph runs once

The HDR shoulder measures the *finished* picture, so the anchor cannot be known
before the graph runs. Measuring it by rendering twice would double the cost of
the path this phase exists to make cheap. Instead the graph runs once into the
output buffer with the output stage withheld, the anchor is reduced from what
landed there, and the two halves of the output stage then run back over the same
buffer: one graph pass plus two cheap ones, never the graph twice.

That needed one seam in `adjustments.py`: `apply_output_clamp=False`, so the
retained intermediate is the value the output stage actually receives rather than
one already clamped at zero. The SDR shoulder sits early in the chain instead, so
its anchor pass runs only the few pointwise stages ahead of it —
`sdr_highlight_stage_input`, which is the same prefix the render uses, shared
rather than copied so the two cannot drift.

## What keeps a graph off the bounded path

Refusals are explicit and returned to the caller; there is no silent fallback to
the whole-frame route. `strip_execution_refusals` deliberately mirrors
`tiledExecutionRefusals` on the GPU side, because the reasons are the same.

| Refusal | Why | Phase |
|---|---|---|
| local adjustments | masks are full-frame | 5 |
| detail | radii derive from the frame diagonal | 5 |
| spatial film effects | multiscale over the whole image | 7 |
| grain (amount > 0, or the view map) | seeds on absolute image coordinates | 7 |
| vignette | normalizes to the whole image | 7 |
| denoise | aligned evidence tiles | 6 |
| matched SDR | whole-frame matched base and headroom mapping | later |
| roll geometry | `Image.rotate(expand=True)` still materializes the rotated frame — exact, but not bounded | carried forward |
| post-geometry downsample | a per-strip downsample does not reproduce a whole-frame one at the seams | — |

Grain is section-enabled by default, so the refusal is on grain that actually
contributes; zero-amount grain leaves the pixels alone and cannot make a strip
disagree with the whole frame.

`roll geometry` is the one refusal that is about boundedness rather than
correctness, and it is carried-forward item 2 from Phase 3 reaching its
consequence: a windowed roll is exact, but it allocates the whole rotated frame
to produce a strip, which is the opposite of what this path sells.

## How it is reached

`PreviewRequest.execution` defaults to `"whole"`, the shipped route.
`execution: "strips"` takes `SessionRenderCache.adjusted_frame_in_strips`, which
shares the frame cache with `adjusted_frame` under the same key — whichever runs
first, the other finds its result. A refused graph is answered **409** with
`{"code": "strip_execution_refused", "refusals": [...]}` rather than quietly
rendering whole-frame, because a caller measuring the bounded path needs to know
it did not run. A successful bounded render carries its own account of itself
back in `X-Strip-Execution`.

**Nothing in the application sets it.** That is the same sequencing the GPU tiled
path got: build it behind a flag, prove it, then enable. Exposing Full before
that would be the "Direct-only Full" the PRD lists as a non-goal, in CPU form.

## Deterministic coverage

`codebase/tests/test_cpu_strips.py` — 129 cases:

- **Parity corpus:** both lanes × six geometries (identity, rotate 90, double
  flip, crop, rotate 180 + crop, perspective) × three strip budgets, compared
  against `apply_adjustments` itself rather than a remembered constant. Exact
  everywhere except the windowed projective route, which carries Phase 3's
  approved 6e-08 input tolerance forward through the grade.
- **Every highlight configuration:** both lanes × four modes × three
  measurements × three colour handlings = 72 cases, each divided into 37 strips.
  Blinding the anchor makes 4 of them disagree by up to 0.84, so the corpus is
  discriminating rather than merely green.
- The authored-SDR-base variant and the legacy `legacy_base_v1` curve.
- Every refusal, named individually, plus that zero-amount grain does **not**
  refuse and that a refusal carries every reason rather than the first.
- Cancellation: that it stops, and that it abandons at most one strip.
- The plan divides the frame with no gaps or overlap and stays inside its budget,
  and planned transient bytes stay flat from 1K to 8K.
- Measured peak allocation follows the budget, not the frame.
- `_PeakReducer` against `np.quantile` and `np.max`.

`codebase/tests/test_cpu_strips_api.py` — 4 cases: the bounded route returns the
same bytes as the shipped route through the real server, refuses a vignette with
a 409 naming it, carries its report on both preview routes, and leaves the
default unchanged.

## Regression evidence

| Suite | Result |
|---|---|
| Full Python suite (`.venv`) | `1208 passed, 3 skipped, 0 failed` |
| — of which new in this phase | 133 |
| — baseline before this phase | `1075 passed, 3 skipped, 0 failed` |
| `node --test` over seven deterministic suites | `tests 69 / pass 69 / fail 0` |
| `gpu-highlight-compression-parity`, `gpu-scope-parity`, `webgpu-shader-compilation`, `sdr-match-gpu-interaction`, `sdr-gamut-gpu-parity` | PASS |
| `tiled-direct-parity`, `device-loss-fallback`, `preview-resolution-interaction` | PASS |
| 19 further browser suites | PASS |
| `path-mask-interaction` | **FAIL, and pre-existing — see below** |

### `path-mask-interaction` is failing, and it is not this sprint's doing

It fails at line 460, `waitForResponse` for the `/edit-commands` POST that should
commit an out-of-image Path handle drag, timing out after 30 s.

| Tree | Result |
|---|---|
| With this phase's changes | 1 pass / 5 fail |
| Head without them (`ace4f43`), server restarted so no stale modules | 0 pass / 4 fail |
| **Pre-sprint `83bca70`**, its own suite, its own server, its own port | **1 pass / 2 fail** |

The same line fails the same way at the release commit this sprint branched
from, so it predates every phase. The first clean-tree check was invalid and is
recorded here rather than dropped: the dev server had been started before the
stash and still held the patched modules in memory, so it proved nothing. Only
restarting the server per tree distinguished the two.

This is a real, separate defect — an out-of-image Path handle drag that does not
always commit — and it belongs to the local-adjustments area, not to preview
execution. It is carried forward, not fixed here.

The refactor that made the seams possible — `apply_fixed_source_adjustments`
splitting geometry from grading, `_sdr_pre_highlight` and
`_sdr_reference_pre_highlight` extracting the SDR prefix, and
`compress_hdr_output_highlights` / `clip_hdr_output_target` splitting the output
stage — was verified behaviour-preserving by running the full suite green at
`1075 passed` before any new test was added.

## Known costs

1. **The bounded path is CPU-only.** It is the CPU route's answer to the same
   problem tiled execution answers on the GPU; the two share their refusal model
   but not their code.
2. **`roll` geometry is refused rather than supported**, for the reason above.
   Supporting it needs a windowed rotation that reproduces
   `Image.rotate(expand=True)`'s expansion and safe-inset geometry.
3. **`STRIP_WORKING_SET_MULTIPLIER` is a measured constant, not a derived one.**
   It is 14, checked against the real graph by the measured-peak test. A future
   node with a deeper working set would need it re-measured, not guessed.

## Next

The remaining Phase 4 follow-ups, unchanged from the tiled-execution evidence
except that gate 4 is now closed:

1. Converge `renderTiledTo` and `renderTo` onto one pass-chain encoder.
2. Wire tiled execution into admission, so a graph Direct cannot fit renders
   tiled instead of relying on the allocation backoff.
3. Engineering-only Full selection, once the above hold.
4. A native-resolution Direct/Tiled parity comparison at 42 MP.
