# Phase 3 native-zoom source transfer — October 2, 2026

This continues the uncommitted phase 3 stage after `fe43970`. Phase 3 remains
open; phase 4 has not started. Nothing here changes pixel math, mask
qualification, peak measurement, a tolerance or a shader. Export and Proof are
unchanged.

## What a fifty-local native zoom was spending

One short SDR fifty-local session (`fifty-sdr-luma-region-smoke.json`) took
772.4 ms from the zoom to the picture. Its stages:

- 487.5 ms fetching the source region: 3,948 x 2,744 pixels (10.8 MP, 87 MB)
  in six chunks, requested one after another.
- About 20 ms loading masks, then 242 ms in the tiled render.

A Python micro-benchmark of the backend's region encode for that same size
(`encode_rgba_proxy` on six strips) took 153 ms serially and 62-99 ms on two
to six threads. The backend was not the limit; the page's sequential requests
were.

## Changes

1. **Region chunks are fetched side by side.** `loadRegion` in
   `source-transport.js` runs one request lane per staging-ring slot (four).
   Each slot's next write still waits only for its own earlier copy, at most
   four chunk responses exist at once, and every lane stops before a failed
   region's partial texture is released. The bytes and their placement are
   the same; only the order of arrival differs.
2. **The region is exactly what the pass reads.** `sourceFetchRegion` padded
   the viewport's region of interest by the halo plus one whole tile on every
   side. Tiles sit on the frame's grid, so the region of interest rounded out
   to that grid and grown by the halo is exactly the union of the foreground
   tiles' halo rectangles. The fetch is now that union. For the fifty-local
   centre view it falls from 3,948 x 2,744 to 3,486 x 2,464 (10.8 to 8.6 MP,
   87 to 69 MB) with the luma feather halo, and from 3,544 x 2,331 to the
   tiles' own extent without it.
3. **A containing region stands in only on the same cells** (recorded with
   the SDR luminance change in the mask evidence).
4. `tiled-render` now reports `encodeMs`, this thread's time to the last
   submission, beside its total.

## Checks

Node, no GPU: `source-transport.test.js` adds two region cases (chunks
overlap, never more than four at once, every row written exactly once, each
request carries the probe's epoch; a failed chunk stops every lane before the
texture is released). `roi-source-region.test.js` now asserts, over 120
viewport/tile/halo/padding combinations, that the region contains every
foreground tile's halo rectangle and is exactly their union. The whole Node
suite is 339 of 340; the one failure,
`highlight-anchor.test.js` ("a measurement on the denoised source is not
reused for the original"), also fails on a clean extract of `fe43970` and was
not touched.

Fixture comparisons after both changes, app-selected tiled route, one centre
region of 1,947,690 paired pixels each, `--enforce`:

| Capture | Luminance p99 / max | OKLab p99 / max | Verdicts |
|---|---|---|---|
| Primary HDR, as saved (`transfer-primary-hdr.json`) | 0.854% / 1.947% | 0.00258 / 0.00576 | picture, masks, peak pass |
| Four-mask HDR (`transfer-fourmask.json`) | 0.347% / 0.712% | 0.00168 / 0.00390 | pass |
| Four-mask SDR (same run) | 2.015% / 3.170% measured; every pixel within one display level | 0.00207 / 0.00595 | pass under the unchanged 8-bit rule |

These equal the figures recorded before the transfer changed. The primary
fixture has global Clarity; no `roi-region-refused` stage occurred, so the
tighter region still covers the Clarity map's reach. Masks are as before
(four-mask luminance 2.13 levels under the trial limit; primary luminance
1.15). All three fixture hashes are unchanged.

## Observations (single operations, not medians)

Fifty-local fixture, `phase3-local-route-smoke.js`, 2560 x 1440, disposable
sessions:

| Build | Lane | Native picture / scopes (ms) | Region transfer (ms) | Tiled render (ms) |
|---|---|---|---|---|
| Handoff (`fifty-gpu-auxiliary-smoke.json`) | HDR | 820.8 / 1,767.8 | not recorded | not recorded |
| SDR luma region only | SDR | 772.4 / 1,741.1 | 487.5 | 242 |
| + parallel chunks, two runs | SDR | 549.7 / 1,506.7 and 604.0 / 1,517.9 | 278.3, 314.1 | 242.2, 258.5 |
| + parallel chunks | HDR | 545.4 / 1,434.3 | 274.6 | 240.2 |
| Final, + exact region (`fifty-transfer-final-*.json`) | HDR | 467.8 / 1,400.0 | 256.4 | 180.2 |
| Final | SDR | 543.8 / 1,442.4 | 265.2 | 250.6 |

Each row is one operation in its own session unless it says two. There is no
alternating before/after study, so run-to-run spread (the two SDR runs differ
by 54 ms) is part of every difference. The fifty-local goal is 600 ms (twice
300); these single observations are under it, which is not the same as a
measured median meeting it. The four-mask and primary 300 ms goal was not
remeasured. Both actions made no backend mask-tile, CPU scope or CPU
navigation request.

Four-mask fixture, `zoom-after-edit-review.js` at 100%, one run
(`transfer-zoom-fourmask-100.json`), action to picture / to scopes, beside
the phase 2 final medians of three runs (PRD 13.4). The difference spans all
of phase 3 so far, not only the transfer change, and one run is not a median.

| Case | Phase 2 final picture, median (max) | Now, one run: picture / scopes (ms) |
|---|---|---|
| Zoom right after a stroke | 847 (859) | 301.2 / 757.1 |
| Zoom six seconds after a stroke | 131 (139) | 146.0 / 275.5 |
| Local Detail on, right after a stroke | 473 (482) | 525.6 / 660.8 |
| Local Detail on, six seconds after a stroke | 271 (277) | 288.0 / 418.9 |
| Local Detail on, nothing changed | 44 (189) | 34.6 / 100.5 |
| Zoom right after creating a local | 400 (518) | 56.5 / 115.3 |

Two cases are much faster and one reaches the 300 ms goal's edge. The three
others are level or slower; the local-Detail zoom right after a stroke is
above its earlier maximum in this single run and is not explained. Brush
strokes in the same run took 85-137 ms to the picture against the 100 ms
goal. The primary fixture was not rerun.

## Where the remaining time is

A scratch probe (`local-pass-scaling-probe.js` in the artifact folder; it
disables locals in a disposable session and zooms once) gave, for the tiled
render stage: no locals 30 ms; 12 locals 44 ms; all 50, 240 ms. By mask type
alone: 13 luminance 66 ms, 12 path 61 ms, 13 gradient 66 ms, 12 feathered
brush 34 ms. Encoding takes 7 ms of the 240, so the time is the GPU's.

- The brush locals read one small soft bitmap each and cost about 4 ms for
  288 local passes: the local passes themselves are cheap.
- Path and gradient locals each make one 512 x 512 mask texture per tile per
  local (600 textures, 314 MB, for 25 locals over 24 tiles), about 0.1 ms
  each. Luminance locals each make full-region masks (13 locals, about
  560 MB).
- The per-type costs sum to about 140 ms; the remaining 100 ms appears only
  with everything enabled and is not explained. About 1 GB of new textures in
  one frame is the suspect, not a finding.

Not built: one mask texture per analytic local for the visible region instead
of one per tile, and trimming a luminance mask to the tiles it serves.

The primary fixture's first zoom of a session presented its picture 203 ms
after the zoom (`snapped-region-primary.json`), then re-presented at 1,640 ms
once the bounded peak measurement, superseded by the zoom as designed,
finished. The probe zooms the moment the project opens, so this is the cold
case of PRD 13.4, not a new one. That sequence contains two idle gaps (about
570 ms and 220 ms) between its steps. The measurement design was not changed
or investigated further.
