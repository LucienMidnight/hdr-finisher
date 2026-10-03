# Phase 3 regional brush eraser evidence — October 3, 2026

This continues the [continuation evidence](viewport-phase3-continuation-evidence-2026-10-03.md) and [exit audit](viewport-phase3-exit-audit-2026-10-03.md). Phase 3 remains open. The working tree is uncommitted and unpushed; phase 4 has not started.

## Fault and repair

The primary saved and added-stroke brush was rejected at native scale because the complete bitmap mixes a feathered painted field with sharp post-feather eraser attenuation. Sixty production qualification probes (five feather settings, saved/added-stroke/erase-free variants, four bitmap sizes) expose the unchanged classifier terms through `X-Mask-Soft-Terms`. At 3200, the added-stroke complete mask has zero peak penalty and mass penalties of 0.012–0.016, but bend penalties of 2–4 plus border penalties up to 0.856. Removing erasers brings bend to 1 and admits all five painted-field probes. The 0.05 feather estimate falls from 5.872 to 2.872. This is evidence for separating native erase attenuation, not weakening admission for narrow painted marks.

`loadGpuBrushEraseRegion` now qualifies the painted field without erase strokes, preserving inversion. It uses the existing rounded brush producer and classifier at 512, 1024, 1600 or 3200. The regional shader samples the qualified paint and applies the original ordered erase/repaint attenuation at native output coordinates, then rounds to byte levels. Crop, flips and right-angle rotation use the existing index geometry mapping. Already-qualified complete masks retain their existing route. Shift, resampling geometry, unqualified painted fields and cancelled work retain the exact fallback.

The output texture covers only the native proxy region, including its source halo. Its frame rectangle positions that bounded texture in the output frame; the texture reader's `wholeFrame` flag does not mean a full native-frame allocation. It uses the shared local-mask allocator, lifetime tracking and cache identity. A separate eviction repair preserves the qualified bitmap resolution when recreating a destroyed soft leaf, including its CPU-refusal fallback, rather than silently recreating it at 512.

No tolerance, general two-level mask approval, Peak/Denoise byte pin, editing Peak budget, Proof/export route, rounded brush producer, zoom scheduler or existing deferral changes. The three owner-accepted rounded cases remain acceptance of those exact cases.

## Native accuracy

Artifacts are under `ai/codebase/output/performance/review/phase3-continuation/`:

- `brush-rejection-terms.json`: the 60 qualification probes and term decomposition.
- `primary-regional-erase-native.json` and its comparison directory: saved brush at feather 0.05.
- `primary-regional-erase-edited-native.json` and its comparison directory: the smoke driver's added stroke at feather 0.03.
- `brush-regional-erase-reference.json` and `brush-regional-erase-reference-384.json`: 96 deterministic pressure/erase/repaint/inversion/index-geometry recipes at paint bitmap sizes 192 and 384 respectively.

Both primary recipes pass paired-pixel, picture/tone, mask and Peak verdicts in HDR and SDR across all three native regions (1,947,690 paired pixels per region). Regional mask errors remain approximately 1.12 byte levels, with none over two. The edited HDR luminance maximum is 1.944%, within the existing approval. Fixtures are not saved.

The reference harness forces regional rendering for inspection, then independently gates results with the backend's production classifier. Eight of 96 recipes qualify at 192 and 32 of 96 at 384; admitted regional errors are at most 1.12353515625 and 1.1240234375 levels respectively. The two runs reuse the same 96 recipes, not 192 independent recipes. Rejected recipes remain fallback cases in production. This does not qualify all narrow brushes or resampling geometry.

## Repeated before/after measurements

Three fresh production sessions and three fresh sessions with only the new regional method disabled use the same primary fixture, original automatic anchors, stroke/feather/zoom sequence and complete-generation observation. Sessions are serialized in mode blocks, not randomized or interleaved. Test-only disabling is confined to the disposable driver. Medians in milliseconds:

| Operation | Baseline picture | Regional picture | Baseline scopes | Regional scopes |
| --- | ---: | ---: | ---: | ---: |
| Fit curves | 148.3 | 135.1 | 496.7 | 606.3 |
| Added stroke | 1882.6 | 1902.4 | 2311.3 | 2511.2 |
| Feather 0.02 | 1516.5 | 1568.1 | 1949.0 | 1985.0 |
| Feather 0.05 | 1482.7 | 1519.7 | 1974.3 | 2028.5 |
| Feather 0.005 | 1614.6 | 1556.9 | 2129.5 | 2078.1 |
| Feather 0.03 | 1627.7 | 1586.9 | 2080.9 | 2063.0 |
| First 100% zoom | 2347.5 | 657.6 | 2681.3 | 990.5 |
| 200% zoom | 160.7 | 158.8 | 40.8 | 41.6 |

First-native baseline picture samples are 2500.2, 2347.5, 2299.4 ms; regional samples are 657.6, 654.4, 686.2 ms. Every baseline requests one CPU mask-tile batch; every regional run requests none. The edited primary route qualifies a 1024 paint bitmap with estimated error 2.824. Artifacts: `primary-regional-erase-perf-1..3.json`, `primary-regional-erase-baseline-1..3.json`, and `primary-regional-erase-paired-summary.json`.

The native gain is reproducible, but first-native zoom still misses 300 ms. Stroke and feather remain seconds at Fit, with foreground overlay and automatic-anchor work; these measurements support no general stroke/feather/scopes speed claim.

## Validation and ownership

The final Node suite passes 371 tests. Ten focused Python classifier/verdict tests pass; the full backend suite was not repeated for this slice. Coverage includes qualified-resolution recreation, native ordered attenuation, refusal/cancellation/index-geometry gates, complete-mask reuse and raw/base64 verdict telemetry consistency. Final JavaScript syntax checks and `git diff --check` also pass.

`primary-regional-erase-pressure.json` completes six fresh-work cycles with a 0.75 GiB disposable budget, one requested active minute and 30 seconds idle. No page or sampler errors. Final local-mask registration and residency both equal 219,613,759 bytes across 124 masks. Allocator registration is 596,251,671 bytes, reservations/transients/over-budget are zero, and idle state is stable. This run triggers no eviction and is not 30-minute endurance evidence.

`primary-regional-erase-eviction.json` completes the same short replay with a 0.5 GiB budget. It records 396 evictions totaling 1,138,449,254 bytes, no page or sampler errors, and settled picture/scopes with automatic anchors idle. Local-mask registration and residency both equal 101,946,678 bytes across 25 masks. Allocator registration is 463,142,762 bytes, reservations/transients/over-budget are zero, and all three idle checkpoints remain stable. This is short eviction/recovery evidence; the 30-minute requirement remains open.

After both GPU replays, the original primary, four-mask and fifty-local fixtures retain these SHA-256 hashes respectively:

```text
246ba308dcba22c5483c32ed4c31f5c81a2804504cd01dec2482b6d5be307d56
3004b621783d77d7fefee6a1997392e1599954ab845b833208841fab1f4d1825
00913f3d8214a211ff74d0791b5393dddf06c861e57994517354aa1a88e6acee
```

## Remaining work

Native Shift, intrinsically unqualified narrow painted marks, straighten/perspective and graph resampling still need surgical work. Primary stroke/feather, first-native zoom, scope and pan targets remain open, as does the 30-minute editing endurance pass. Match optimization, Peak/automatic-anchor redesign and SDR cross-scale continuity retain their existing deferrals. No new owner decision is required by this slice, and no additional case or tolerance is proposed for approval.
