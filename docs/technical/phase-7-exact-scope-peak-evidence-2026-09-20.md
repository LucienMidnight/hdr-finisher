# Phase 7 — the scope's peak, measured exactly

**Date:** September 20, 2026
**Commit:** `644fd42` on `main`, base `e03248a`.

## What the number is for

The peak is the one scope value a delivery decision is made on: *is this under
1000 nits.* Everything else a scope draws — waveform, histogram, parade — is
read for shape. A tolerance on a compliance number defeats the number, so the
tolerance here is zero, and the distributions keep trading accuracy for speed
at the quality profile's resolution.

That split is what makes an exact answer affordable, and it came out of the
product owner's framing of the requirement rather than out of the original
engineering question, which had been about resolution contracts.

## The defect

The peak was an exact maximum — but of the preview proxy, and a proxy is a
Lanczos downsample. An isolated specular is averaged with roughly 25 neighbours
on a 42 MP frame before the scope ever sees it. Measured on
`local-test-media/inputs/Affinity_DSC06898_DisplayP3_Linear_32f.exr` (7968 x
5320) at exposure +0.5:

| Scope profile | Settled source edge | Reported peak | Error against native |
|---|---|---|---|
| performance | 768 | 17,260 nit | **−2,705 nit (13.55%)** |
| detailed | 960 | 17,718 nit | **−2,247 nit (11.25%)** |
| reference | 1600 | 18,961 nit | **−1,004 nit (5.03%)** |
| — | 3200 | 19,207 nit | −758 nit (3.80%) |
| native | 7968 | **19,965 nit** | — |

Every profile under-reports, and always downward — the direction that tells a
colourist they are inside a ceiling they are in fact outside. No setting
avoided it.

## Why it is cheap to fix

A maximum is **decomposable**: the max over a set of tiles is the max over their
union, exactly. So tiling costs nothing in peak accuracy, and the reduction grid
is a work-splitting device rather than a picture — any grid size returns the
same answer. That removes the resolution contract the problem originally seemed
to need.

`scopePeakTileFragmentMain` reduces each finished tile into a shared 64 x 64
target under max blending. 64 keeps each fragment's loop near
`(workTile / 64)^2` — about 64 iterations for a 528-pixel work tile — and the
readback to 32 KB per generation. It reduces
`scopePeakSignal(scopeOutputAt(...))`, the same expression the settled scope
pass reduces, so the two cannot drift.

`measureExactScopePeak()` runs the graph at native resolution through the tile
scheduler in a new **measure-only** mode. Measure-only is the reason a native
*measurement* is affordable where a native *presentation* is not: it skips the
composite, so no presentation surface exists at native — 340 MB at 42 MP never
allocated. Results are cached per edit state.

## Isolation

A measurement presents nothing and must leave the presented state exactly as it
found it. Three guards, one of which was a real bug found in testing:

- It must not acquire the swap chain. `getCurrentTexture()` would hand it a
  texture sized to the viewer's canvas.
- It must not resize that canvas to the measurement's resolution.
- It must not drop the canvas's scope source or overwrite
  `tiledExecutionMetrics`. **The scope-source case was the bug**: a real tiled
  *presentation* drops the scope source, because that is what it owes Phase 4's
  truthful CPU fallback — but a measurement doing the same pulled the Direct
  scope source out from under the very scope read that had requested the
  measurement, so the panel silently fell back to the proxy peak forever after.

## Gate evidence

`tests/scope-exact-peak.js`, run against the 42 MP frame:

```
accumulated peak    Direct 15.6484375  tile 256 15.6484375 (12 tiles)  tile 512 15.6484375 (4 tiles)  PASS
isolation           canvas 684x1024 unchanged, scope source retained, diagnostics untouched  PASS
native measurement  7968 long edge, 176 tiles, 1753 ms  PASS
panel disclosure    on -> "Peak" at 7968, off -> "Peak (preview)"  PASS
under-report        proxy 17648.0 nit vs exact 19965.2 nit  ->  the proxy reads 11.61% low  PASS
```

The test guards its own premise. The finish texture is `rgba16float`, and a
grade extreme enough to reach 65504 working units would have every measurement
agree at the clamp and prove nothing, so the test asserts the peak is below
60000 and fails loudly rather than passing vacuously. Real content is far from
that ceiling — it is roughly 74 million nits. This was not hypothetical: an
earlier draft of the test set contrast to 15 on top of exposure +0.5 and drove
both measurements to the clamp, where they agreed to within one half-float step
and the comparison was meaningless.

On the built-in test pattern the under-report check skips itself, because that
pattern's highlights are flat enough that downsampling costs nothing. It is
reported as skipped rather than passed.

## The control

An **Exact peak** checkbox beside the scope quality selector, on by default and
independent of it. Peak trustworthiness is deliberately not tied to display
density: a low-end machine can keep the performance profile for the waveform and
still get a peak it can ship against, or turn the measurement off if even the
extra pass is too slow. With it off the panel reads **"Peak (preview)"** rather
than presenting a lower bound as though it were the answer.

## Limits worth stating

- **This is the render graph's peak, not a delivered file's.** It equals what
  the graph produces at native resolution. Codec quantization, chroma
  subsampling and a different output transform are separate steps after it, and
  export must run the same graph — which is what Phase 8's export-parity gate
  exists to prove. The full promise is a Phase 7 + Phase 8 pair.
- **It covers the GPU scope route**, which is what a Direct presentation uses. A
  *tiled* presentation settles through the CPU scope route, where the peak is
  still the proxy's. Closing that is either routing the CPU peak through the
  same measurement or giving a tiled presentation a GPU scope source of its
  own — the latter being the tile-wise accumulation of the distributions, where
  the original resolution question still applies.
- **The distributions are unchanged** and still sampled at the profile's
  resolution. That is intended, and now clearly scoped as the half that trades
  accuracy for speed.

## Suites

1255 passed / 3 skipped (pytest), 77/77 node unit tests, `tiled-direct-parity`
and `tiled-film-parity` byte-exact, and 23 browser suites.

`npm run test:local-design` fails with a `viewer-bar` pointer-event
interception. It fails identically on `e03248a`, before any UI work in this
session, and is recorded as pre-existing rather than fixed.
