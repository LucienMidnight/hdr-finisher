# Phase 3 source-space masks, Peak and windowed straighten evidence — October 3, 2026

This continues the [resampled-mask slice](viewport-phase3-resampled-mask-evidence-2026-10-03.md)
from commit `05207b5`. Four related changes were built on the fast checks
and validated in serialized GPU passes. Phase 3 remains open. Nothing is
committed or pushed; no phase 4 work, classifier or tolerance change, or
fixture save is performed.

## 1. Combined masks and luminance masks under straighten/perspective

Export composes the whole mask expression in source space, rounds it to
bytes and warps it once. The preview now does the same:

- **Un-resampled scene luminance.** A new backend endpoint,
  `GET /api/session/{id}/source-luminance`, serves ACEScg luminance for one
  rectangle of the source with only the quarter turn and flips applied, one
  half float per pixel. The renderer keeps it as bounded 2,048-pixel tiles
  (`orientedLuminanceTile`, capped at 192 MiB and registered with the
  allocator) and assembles any rectangle from them. It is the HDR scene for
  every lane, as in export.
- **Luminance leaves** (`gpuOrientedLumaRegion`) are qualified and feathered
  in source space with the feather's whole reach around the rectangle. Where
  the region fits (12 million pixels) the feather uses export's own six
  boxes; larger regions use the reduced grid, anchored to the frame.
- **Combinations** (`gpuOrientedGraphRegion`) are composed in source space
  from the same leaf producers, one operand at a time, with export's
  operator order, leaf opacity and inversion. The existing resampler then
  warps the result once. Fit, scopes, measurements and native tiles all use
  it; the range scan and prefetch cover combinations too.
- A mask with any unsupported leaf (a gradient with luminance enabled, a
  sampled leaf), a degenerate or disabled combination, or a feather reach no
  bounded region can hold keeps the previous route.

### Fault confirmed and fixed (P3-LUMA-RESAMPLE-01)

Paired on the primary with perspective vertical 15, `clouds` luminance leaf,
upper-left region, both lanes:

| Route | Maximum | Pixels over two | Masks verdict |
|---|---:|---:|---|
| New route disabled (`--disable-resampled-masks`) | 3.15 levels | 943 | fail |
| Source space, reduced-grid feather (first pass) | 2.12 | 4,560 | pass |
| Source space, exact boxes (final) | 2.12 | 565 | pass |

The fault predates the previous slice: the old route qualifies the warped
picture. `tests/test_source_space_luminance_mask.py` (CPU only, about one
second) shows both halves: half-float source luminance reproduces the export
mask within two levels with fewer than one pixel in 10,000 over one, and
qualifying the warped picture does not.

### Accuracy

`tests/mask-resample-reference.js` now has 112 regions (70 leaf regions as
before, plus 16 luminance leaves, 20 combinations and six native viewports of
a 4,000-pixel frame). **No byte differs by more than two levels.** 77 are
within 1.13 levels. The other 35 reach two byte levels (2.02–2.124 as stored
in half float) on a small share of pixels:

| Kind | Regions listed | Worst region |
|---|---:|---|
| Unfeathered luminance | 4 | 11 of 89,180 pixels |
| Feathered luminance, compact | 4 | 12 of 128,027 |
| Feathered luminance, 4,000-pixel frame | 3 | 479 of 921,600 (0.05%) |
| Combinations with luminance | 18 | 435 of 637,856 (0.07%) |
| Brush-and-path combination | 4 | 69 of 659,280 |
| Feathered brush leaves (accepted, P3-MASK-REVIEW-02) | 2 | 5 of 537,272 |

Cause, as before: where the GPU and CPU source masks round a byte opposite
ways, export's bicubic kernel carries that one level to two. Exact boxes cut
the feathered-luminance count about tenfold (5,090 → 479 on the native
viewport). What remains comes from half-float luminance and mask storage and
from leaves that round to bytes before a combination is composed.

Native comparisons (`--enforce`, three regions, both lanes; all four verdicts
pass in every run below):

| Run | Luminance or combined mask, worst region |
|---|---|
| Primary, straighten 2 | 2.12 levels, 541 px (0.028%); other regions ≤ 1.12 |
| Primary, perspective 15 | 2.12 levels, 565 px (0.029%); other regions ≤ 1.12 |
| Primary, straighten 2, luminance ∪ gradient | 2.12 levels, 541 px |
| Primary, perspective 15, luminance ∩ gradient | 0.00 |
| Four-mask, straighten 2 | 2.12 levels, 120 px (0.006%) |
| Four-mask, straighten 2, luminance − path | 2.12 levels, 120 px |

Brush, path and gradient leaves stay at or below 1.12 levels. The harness
does not list these masks as over the approved limit because their edges are
within one pixel; they are recorded here regardless. The paired baseline of
the combination (new route disabled) is served as CPU mask tiles at 0.12.

## 2. Peak under straighten (P3-PEAK-03)

The bounded editing Peak was refused under straighten because every patch
would have rebuilt the rotated frame. With section 3 that is no longer true,
and the refusal is removed. Primary, 2 degree straighten: **627.2 nit against
export 628.4 (0.19% low; was 605.2, 3.7% low; limit 1%)**. Perspective 15:
627.2 against 628.9. Four-mask under straighten: 3,224.7 against 3,222.1.
`tests/editing-peak-bounded.js` passes. The 4,194,304-pixel budget and the
shader pins are unchanged.

Consequence: under straighten the automatic highlight anchor is now measured
and applied, as it already was without straighten. A Fit edit's first
feedback is unchanged (39–60 ms) but its exact settlement is the anchor
replacement, 1.39–1.58 s (it was 20–140 ms only because nothing was
measured). The anchor design is the deferred P3-PEAK-01/02 work.

## 3. Straightened picture source (first zoom)

`apply_geometry_region` now resamples only the requested window for the roll
stage: `Image.rotate(expand=True)`'s matrix and the safe inset are computed
as arithmetic (the Python twin of `geometry-resample.js`) and Pillow
transforms just the window from just the source pixels it samples. The
perspective stage uses the same bounded source block. The per-channel clip
range of the whole source is measured once per source instead of per tile;
the held rotated frame is gone.

- CPU timing, 6,000 x 4,000 synthetic source, 2,560 x 1,440 window: 374–467 ms
  against 2,852 ms for the whole rotated frame.
- Parity: at most 6e-8 from the full-frame result, inside the 1e-6 tolerance
  already approved for windowed perspective. The roll tests that asserted
  byte equality with a cached frame are rewritten for the new contract
  (`tests/test_geometry_roll_cache.py`); eight angles and three shapes are
  added to `tests/test_geometry_region.py`. Export and Proof still use the
  full-frame path and are untouched.

Primary, HDR, `phase3-local-route-smoke.js --geometry straighten_angle=2`:

| Step | CPU masks (earlier baseline) | Previous slice | Now (three sessions) | Median |
|---|---:|---:|---:|---:|
| First 100% zoom picture | 8253 ms | 3710, 3497 | 853, 819, 827 | **827 ms** |
| First 100% zoom scopes | 8838 ms | 4108, 3916 | 1260, 1222, 1234 | **1234 ms** |
| CPU mask requests at 100% | 8 | 4, then 0 | 0, 0, 0 | 0 |
| 200% picture | — | 154 | 153, 153, 157 | 153 ms |

Perspective 15, one session: first zoom 697 ms, scopes 1204 ms. Without
straighten, one session: 636 ms and 968 ms (previously 620). The 300 ms goal
is unmet in all three. At the straightened first zoom the largest remaining
term is the luminance mask's whole-frame range scan (12 luminance tiles and
about 770 ms on this 36-megapixel source); the other masks' ranges take about
280 ms and each warped mask 1–2 ms.

## 4. Where Fit stroke and Feather time goes (measurement only)

From five sessions (`fit-bitmap-perf-1`, `source-space-index-perf-1`,
`peak-sources-index-perf-1..3`), primary, HDR, no straighten:

| Part | Time |
|---|---|
| First feedback after a Feather step | 104–250 ms (goal 100) |
| GPU bitmap preparation, readback and classification | 10–56 ms per attempted size (512, 1,024, 1,600); 124–131 ms at 3,200 |
| Deferred P3-FALLBACK-01 CPU compile (stroke and Feather 0.005 only) | 623–1202 ms in the background |
| Automatic-anchor measurement | starts 160–370 ms after the edit; 16 patches in two rounds; each patch one source read of 13–15 ms (22 ms under straighten) |
| Anchor replacement frame (the reported "exact") | about 1.0–1.2 s after the edit |

So the 1.1–1.6 s figures are the automatic-anchor replacement, not masks.

**Tried and not kept.** Fetching the anchor patches side by side cut exact
settlement (straighten 1.45 s → 0.74–0.85 s; Feather 1.1 s → 0.75–0.80 s,
three sessions each) but delayed first feedback under straighten from 39–60
ms to about 145 ms in two of three sessions, with sixteen or with three
requests in flight. First feedback is the stated priority, so the serial code
is restored. Artifacts: `peak-sources-*`, `peak-lanes-*`.

## 5. Capped-memory replay under straighten

`heavy-project-long-session.js --geometry straighten_angle=2 --fresh-work
--skip-match --pan-lane hdr --budget-gb 0.5 --minutes 1 --idle-minutes 0.5
--native-shift-feather` (the harness gained `--geometry`): 96 operations,
status complete, zero page errors, 4,025 warped masks (805 gradient, 2,415
brush, 805 luminance), 665 evictions, 527,982,050 bytes registered of the
536,870,912-byte budget (77 MiB of it luminance tiles), zero over-budget
bytes, no pending anchors or mask work at idle.
This is route and cache coverage, not the 30-minute endurance requirement.

## Validation

- Node: **413** tests pass (five new).
- Python: full suite **1,651 passed, three skipped** after the backend
  change; seven new luminance tests pass in addition.
- GPU, serialized: 112 resampled regions; 8 regional luminance and 12
  regional graph references (the luminance feather code was refactored, not
  changed); `editing-peak-bounded.js`; nine native comparisons; ten timing
  sessions; the replay above.
- Not repeated, no relevant change: 804 rounded, 114 native Feather and 52
  native Shift references (`gpu-brush-mask.js` and `webgpu-shaders.js` are
  untouched; shader pins pass in the Node suite).
- All three fixture hashes match after every GPU pass.

Artifacts: `codebase/output/performance/review/phase3-continuation/`
`source-space-*`, `peak-sources-*`, `peak-lanes-*`.

## Remaining

- Two-byte-level pixels in warped luminance masks and combinations (owner
  question below).
- First zoom: 827 ms straightened, 636 ms otherwise, against 300 ms. The
  luminance range scan is the next cost under straighten.
- Fit first feedback 104–250 ms after Feather (goal 100) and the anchor
  replacement at about one second (deferred anchor work).
- Scopes 0.9–1.2 s after first zoom; pan; the four-mask project timings.
- Native leftovers listed in the previous slice; no real wide fixture.
- Luminance masks at more than 24 megapixels of feathered region, and frames
  whose feather reach exceeds the texture limit, keep the previous route.
- Coverage audit and the 30-minute endurance run.

## Owner decision

**Owner decision (Steve, October 3).** Warped luminance masks and combinations at up to two byte
levels (up to 2.124 as stored; at most 0.03% of a real region, 0.07% of a reference region) are
accepted as a case-specific exception (P3-MASK-REVIEW-03), like the warped feathered brush case.
It is not a general three-level approval; the general limit stays two. Do not request review of
unchanged cases again.

The question as put:

**Warped luminance masks and combinations at two byte levels.** After this
work no pixel differs by more than two byte levels, and at most 0.03% of a
real region (0.07% of a synthetic one) reaches two; stored in half float
those read as up to 2.124. The approved general limit is two levels, and the
October 3 exception covers warped feathered brush leaves only. Accept these
as the same kind of case, or require them brought inside two? Bringing them
inside would mean carrying luminance and the source-space mask in full float
and composing leaves before any rounding; it would cost memory (twice the
luminance tiles) and touches the shared brush and shape shaders.
