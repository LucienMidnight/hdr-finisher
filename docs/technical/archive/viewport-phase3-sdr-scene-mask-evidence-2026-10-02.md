# Phase 3 SDR regional scene masks — October 2, 2026

Steve clarified that Peak is deferred and directed continuation of other
phase 3 work. Both recorded Peak issues remain open, with accuracy limits and
the measurement budget unchanged.

## Independent HDR scene region

An authored SDR rendition or legacy Match base is display-linear sRGB, whereas
luminance masks qualify the original ACEScg scene. The tiled SDR route now
fetches one independent HDR scene region for all eligible luminance leaves
and expression graphs in its foreground pass. It covers the union of tile
halos plus each leaf's feather support, aligned to the common downsample grid.
The scene region is shared by all those masks; the SDR source still supplies
the picture. Analytic graph leaves use the same scene-region placement.

Source loading uses the existing cache, single-flight requests, bounded chunk
transport and allocator accounting. The extra source is pinned while masks
are built and unpinned on success or error. Cached mask inputs are protected
using their actual scene-region identity. A refused region, excessive common
alignment, incompatible frame dimensions or unsupported form retains the
existing mask fallback. A new `regionOnly` transport option prevents a refused
scene-region request from starting whole-source preparation. No CPU export,
mask compiler, Denoise shader or Peak reduction shader is changed.

The newer materialized Match recipe already uses the original scene source;
it needs no additional HDR fetch. This distinction was confirmed when the
initial native test's required-independent-region assertion correctly refused
that setup. The final native diagnostic uses a new legacy-state archive made
from the read-only fixture, without captured locals in its HDR snapshot.

## Verification

- **71 focused Node checks pass**, including regional routing, refusal/stale
  handling, halo/grid coverage, source streaming/cache lifetime and shader pins.
- **12 compact CPU/whole-GPU reference cases pass** through the independent
  scene route: union/intersect/subtract/nested graphs, unequal opacity,
  inversion and three feather amounts. The SDR texture deliberately contains
  different pixels from the HDR source. Maximum CPU mask difference is
  **1.16993 levels**; regional and whole-source GPU results agree exactly.
- A four-mask legacy SDR native centre with a shared **manual highlight
  anchor** passes picture/mask limits across **1,947,690 pixels**, on the
  app-selected tiled route. All channel differences stay within one encoded
  level (p99 0.56, maximum 0.67). The eligible union is explicitly read from
  `gpu-mask-graph` and agrees exactly with the CPU mask. Gradient differs by
  0.12 levels; the existing painted-feather bitmap fallback remains visible.

The captured native HDR source regions are 3486x2464 and 2772x1750 inside the
5320x7968 frame, using 68,716,032 and 38,808,000 source-texture bytes. They
are cached regions, not native whole-frame preparations. These observations
establish correctness and routing, not a speed improvement or session median.

## Deferred automatic-anchor limitation

With the saved automatic maximum anchor, the legacy SDR picture comparison
fails its ceiling (17.008% maximum luminance error), although the new masks
match exactly. Disabling every local still fails (17.063%), so the mask route
is not the cause. The existing backend explicitly refuses legacy matched-SDR
candidate evidence to avoid a native render from a Peak request. Using a
common manual anchor resolves the picture discrepancy without changing the
picture limits. This limitation belongs to the deferred Peak/anchor work;
the native automatic-anchor legacy picture is **not signed off**.

Real authored-base native coverage, resampling geometry, painted whole-mask
feather/shift, broader control/zoom continuity and phase 3's full exit remain
open. This change does not close the sprint or start phase 4.

Ignored artifacts under `codebase/output/performance/review/viewport-phase3-2026-10-02/`:
`sdr-scene-graph-reference.json`, `legacy-sdr-scene-region-native-final.json`,
`legacy-sdr-no-locals-native.json`, `legacy-sdr-scene-region-manual-native.json`
and their captures. The earlier `matched-sdr-scene-region-native.json` and
`legacy-sdr-scene-region-native.json` stop at harness assertions (respectively
the materialized-source setup and a missing source field in the report).
All inputs use disposable sessions; no original fixture is saved. Changes
remain uncommitted.
