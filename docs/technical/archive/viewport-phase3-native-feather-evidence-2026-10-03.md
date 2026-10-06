# Phase 3 native Feather evidence — October 3, 2026

This continues the [native Shift slice](viewport-phase3-native-shift-evidence-2026-10-03.md)
from checkpoint `344506c`. Phase 3 remains open. No commit, push, phase 4
work, tolerance change, classifier change or fixture save is performed.

## What changed

Native Shift Edge **with Feather** no longer compiles a CPU mask. The same
route also serves feathered paint that no bitmap qualifies for, and replaces
the paint-bitmap qualification for erased feathered brushes at native zoom.

Export feathers a painted mask on a reduced grid: block means of the
(shifted) full frame, six fractional box passes per axis, bilinear
expansion, then normalization by the full-frame painted and blurred peaks.
That grid depends on the mask and the frame, **never the viewport**. The
implementation therefore has two parts:

1. **Feather field** (`HDRGpuBrushMask.generateFeatherField`), once per mask
   and frame. Paint is rastered at native centres with the existing native
   display metric. With Shift, the painted peak is scanned first and the
   normalized field is filtered with export's six-plus-six float32 prefix
   boxes in bounded bands that carry the complete Shift halo. Each band
   writes only its own coarse rows (scissored), so adjacent bands join
   without a seam; the frame's first/last pixel rows and columns ride along
   as export requires. The coarse grid then takes the twelve fractional
   passes. The blurred peak is the maximum over every interpolated native
   pixel, scanned in bands, not the coarse maximum. The result is one small
   float texture whose last row stores the painted, shifted and blurred
   peaks. No native-frame texture or CPU mask is allocated. Work is limited
   to the painted bounds plus the Shift reach; paint is exactly zero beyond.
2. **Region** (`generateFeatherRegion`), per viewport: interpolate the
   resident grid at native pixel centres, restore the painted peak, then
   apply inversion and ordered native erase/repaint attenuation. Two small
   passes; a pan reuses the field.

A feather narrower than export's reduction threshold (sigma below 32 native
pixels, or a frame too small) keeps export's full-resolution boxes: the
field then holds only the three peaks, and the region is filtered over the
combined Shift and Feather halo. Below a quarter pixel export skips the
feather; that case is the existing unfeathered Shift route. A small shifted
bitmap is never stretched and no homography is used.

The coarse and expansion shaders are windowed copies of the rounded
producer's loops: they visit the same nonzero terms in the same order and
skip only zero-weight cells. The rounded producer, its shader and the
larger-bitmap fallback are unchanged. `webgpu-shaders.js` is untouched, so
the Peak and Denoise byte pins are unaffected.

### Routing at native zoom (long edge above 3,200)

| Mask | Route |
|---|---|
| Shift, Feather zero or below a quarter pixel | native Shift region (previous slice) |
| Shift plus Feather | feather field + region (**new**) |
| Feather, erasers, no resident qualified complete mask | feather field + region (**new**); the qualified paint bitmap with native erase is the fallback when the field refuses |
| Feather, erasers, resident qualified complete mask | unchanged small-bitmap route |
| Feather, no erasers | unchanged qualification first; feather field only after refusal (**new**), before any CPU compile |
| Resampling geometry, frame wider than the texture limit, scratch over the cap | unchanged exact fallback |

Admission is not widened: the classifier and its limits are untouched, and
every new case uses export's own arithmetic at native coordinates rather
than a stretched bitmap. The third row is a deliberate change to the
previous slice's order, taken because of the measured exceedance below.

Zoom preparation now starts the field (and compiles its pipelines) while
the zoomed source is in transit, and no longer runs a bitmap qualification
for masks that will take the native route. A single-band field and every
region are encoded and submitted without waiting on the queue; scratch is
still released only after queue completion. Multi-band fields wait between
bands so one scratch set is reused. A requester that outlives a superseded
shared generation repeats it instead of falling to a CPU compile; this also
applies to the unfeathered Shift regions.

Scratch stays within the existing 16,777,216-pixel regional cap and the
adapter's texture and storage-buffer limits; refusal keeps the fallback.
Fields and regions are ordinary registered local-mask cache entries. Stale,
cancelled or device-replaced outputs are destroyed before registration.

## Accuracy

`tests/brush-native-feather-reference.js` compares 108 regions with exact
CPU export masks: 60 compact frames (every quarter turn and flip, inversion,
disabled masks, density, ordered erase/repaint, five Shift values, three
Feather values), 40 regions of 4,000-pixel frames (all reduction factors
2–32, a small strong mark far from the viewport, frame-edge paint, viewports
on the physical borders, Shift ±0.05, sub-threshold Shift and Feather) and
eight regions of 24-megapixel frames that need up to 16 bands. All pass at
at most **1.1240234375** levels against a 1.13 guard (the general approval
stays two). 46 use the reduced grid, 58 full-resolution boxes, four the
unfeathered route and 16 are multi-band. 24 expected regions are all zero
(a contraction removes paint weaker than about 81% of the peak, including
whole masks); they check agreement, not edge placement, and the other 84
carry signal. Artifact: `native-feather-reference.json`.

The unchanged references still pass after the shared-helper refactor: 52
native Shift regions (max 1.1240234375) and 804 rounded brush recipes.

Native preview versus export, primary fixture, 2560x1440, three regions of
1,947,690 paired pixels each, HDR and SDR. All four verdicts (pixels, tone,
masks, Peak) pass in every run and the project file is unchanged:

| Recipe | Native brush mask, worst region | Artifact |
|---|---|---|
| Saved Feather 0.0085, Shift +0.005 | 1.12 levels, 0 px over two, edge 0 px | `native-shift-feather-expand-compare.json` |
| Added stroke, Shift −0.005 | 1.12 levels, 0 px over two, edge 0 px | `native-shift-feather-contract-edited-compare.json` |
| Added stroke, Feather 0.0005, no Shift | 1.12 levels, 0 px over two, edge 1 px | `native-narrow-feather-0.0005-compare.json` |
| Added stroke, Feather 0.0001, no Shift | 1.12 levels, 0 px over two | `native-narrow-feather-0.0001-compare.json` (before the order change; qualified-paint route) |
| As saved | 1.12 levels; other brushes at most 1.48 | `native-feather-saved-compare.json` |

### Exceedance found in the previous route

Before the route order changed, the added-stroke Feather 0.0005 recipe used
the qualified paint bitmap with native erase and measured **2.124 levels
with 150 pixels over two** (lower-right) and 2.116 with 14 (centre), in both
lanes. The comparison lists these as over the approved soft limit while
passing its three-level working limit. With the native field first the same
recipe measures 1.12 levels and zero pixels over two. Before artifact:
`native-narrow-feather-0.0005-before-compare.json`. This was a new edit
state, not one of the three owner-accepted panels; it is resolved by the
change, not accepted.

## Measurements

### Saved feathered Shift (the previously open benchmark)

Three fresh disposable sessions per mode, three alternating drags per lane,
saved Feather 0.0085 retained, native zoom, manual anchors, preparation
outside the clock. Serialized mode blocks, not interleaved; the third drag
can reuse a mask. `--disable-native-shift` disables both native routes in a
disposable renderer. Medians of session medians, milliseconds:

| Lane | Disabled release picture | Native release picture | Disabled scopes | Native scopes |
|---|---:|---:|---:|---:|
| HDR | 3607.8 | 151.2 | 3983.8 | 551.8 |
| SDR | 4649.2 | 141.2 | 5013.5 | 524.2 |

Session medians: native HDR 156.7/145.2/151.2, SDR 161.5/141.2/95.4;
disabled HDR 3519.5/3634.5/3607.8, SDR 4688.4/4649.2/4620.2. The disabled
runs reproduce the earlier 3624.6/4719.9. CPU mask-tile batch requests fall
from 12 to zero per lane across nine observations. Field preparation is
32–53 ms and each region 7–15 ms in these sessions (measured with the queue
waits that have since been removed).

Input-to-first-frame medians are 746.8/786.5 ms including the nominal
500 ms drag, against 4272.7/5309.6 disabled. Scopes still settle in about
0.5 s. One Fit-scale auxiliary CPU mask request (140–260 ms) and three
bitmap verdicts still accompany each uncached drag. **No 100 ms slider exit
or scope exit is claimed.** Artifacts: `native-shift-feather-perf-1..3.json`,
`native-shift-feather-baseline-1..3.json`,
`native-shift-feather-paired-summary.json`.

### Stroke, Feather and first native zoom

Three fresh HDR sessions per mode of `phase3-local-route-smoke.js`
(stroke, four Feather values at Fit, then 100% and 200%), complete
generation including automatic-anchor replacement. Picture medians, ms:

| Step | Previous order | Native first, with waits | Native first, prefetch, no waits |
|---|---:|---:|---:|
| Zoom 100% picture | 672.9 | 890.2 | **619.8** |
| Zoom 100% scopes | 1005.7 | 1214.8 | 950.0 |
| Zoom 200% picture | 159.7 | 161.5 | 159.9 |
| Fit brush stroke | 2977.5 | 1819.0 | 1981.3 |
| Fit Feather (four values) | 1395–1644 | 1452–1570 | 1433–1570 |

The first attempt at the new order was **slower** at first native zoom
(890 versus 673 ms): the field took 239 ms and the region 45 ms on first
use because of cold pipeline compilation and waits behind the source
transfer. Starting the field during zoom preparation and removing the waits
brings field and region to about 1 ms of encoding each; three sessions
measure 611.4/728.4/619.8 ms. This is roughly 50 ms better than the
previous order and inside its session spread (642–697), so it is reported
as **no regression, not a speed gain**. The 300 ms zoom goal remains missed
and masks are no longer the limiting cost at first native zoom.

Fit stroke and Feather timings are not changed by this slice: Fit never
enters the native route. The stroke baseline's 2977.5 median includes one
1820 ms session; treat the stroke column as noise, not improvement.
Artifacts: `native-feather-order-before-1..3.json`,
`native-feather-first-perf-1..3.json`, `native-feather-prefetch-perf-1..3.json`,
`native-feather-first-paired-summary.json` (first two modes).

## Pressure replay

`native-shift-feather-pressure.json`: disposable 0.5 GiB budget, fresh work
with a varying Feather and unique Shift each cycle (new
`--native-shift-feather` flag), native zoom and pans. 96 operations in six
cycles, 66.7 s active plus 30 s idle, zero errors. 13 successful native
batches and 25 field loads, 394 evictions. At idle the local-mask registry
and residency agree at 112,932,454 bytes; allocator use is 477,287,822 of
536,870,912 with zero reservations, over-budget debt or pending
destruction. Scopes are settled and anchors have no pending or inflight
work. This is route coverage under eviction, not physical VRAM containment
and not the 30-minute endurance requirement.

## Validation

- Node: **398** tests pass (19 new: plans, routing, field reuse on pan,
  eviction rebuild, cancellation and device replacement, superseded
  generations, tile splitting, zoom preparation, fallback order).
- Electron GPU references: 108 native Feather, 52 native Shift, 804 rounded.
- Python: 117 frontend-contract, bitmap-verdict and mask-softness tests
  pass. No backend or export code changed; the full backend suite is not
  repeated.
- Syntax and `git diff --check` pass. All three fixture SHA-256 hashes
  match the handoff after the GPU runs.

## Remaining

- **Narrow paint (priority 2):** unqualified feathered paint and erased
  feathered brushes no longer reach a CPU compile at native zoom on
  supported geometry. Fit-scale and auxiliary requests for such masks are
  unchanged and still use CPU masks when a bitmap does not qualify.
- **Worst-case field cost:** Shift ±0.05 with a mask spanning a
  24-megapixel frame needs 16 bands and measures 406–520 ms; typical
  recipes are 15–120 ms. Bounded and correct, but not interactive at that
  extreme.
- **Frames wider than the adapter texture limit** (8,192 here) and
  resampling geometry keep the exact fallback.
- Unfeathered native Shift still waits on the queue per region and repeats
  its painted-peak scan; it was not altered beyond shared helpers.
- A finding outside this slice's remit: when every GPU bitmap up to 3,200
  is classified not soft, the larger-bitmap fallback still compiles a CPU
  mask at 3,200 (578–977 ms observed in the background). It is left as is
  because that fallback is a preserved invariant. Steve deferred it on
  October 3 as P3-FALLBACK-01, to explore later.
- Steve accepted the 151.2/141.2 ms saved feathered Shift release timings
  for now against the 100 ms goal (this control only) and authorized a
  checkpoint commit without push.
- Resampling geometry and graphs, primary stroke/feather at Fit, first
  native zoom, scopes, pan and four-mask targets, the coverage audit and
  30-minute endurance remain open. Existing deferrals are unchanged.
