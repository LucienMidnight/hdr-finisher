# Paste into the next thread

Continue phase 3 of Viewport-Bounded GPU Preview for HDR Finisher. Work autonomously on implementation and evidence; phase 3 remains open. Do not start phase 4, push, or widen tolerances. Do not silently defer unfinished implementation.

Workspace: `D:\AI\AI Projects\HDR Finisher Tool`. Git root: `ai`; executable/test cwd: `ai\codebase`. Branch: `viewport-bounded-preview-phase-2-wip`. The native Feather slice described below is committed as `Implement bounded native Feather field preview` on top of `344506c`; use the hash supplied with this prompt, verify HEAD and inspect status first. Preserve subsequent unrelated changes. Do not reset.

Read these first, relative to the git root:
- `docs/product/Viewport_Bounded_GPU_Preview_PRD_2026-10-01.md` (exit criteria, owner decisions, sections 14.17–14.21).
- `docs/technical/viewport-phase3-exit-audit-2026-10-03.md`.
- `docs/technical/viewport-phase3-native-feather-evidence-2026-10-03.md` (latest slice).
- `docs/technical/viewport-phase3-native-shift-evidence-2026-10-03.md` and `viewport-phase3-regional-erase-evidence-2026-10-03.md` (previous slices). Follow earlier evidence links only as needed.

Latest work: bounded native **Feather field**. Export's reduced feather grid depends on the mask and frame, not the viewport. `HDRGpuBrushMask.generateFeatherField` builds it once on the GPU (native paint, painted peak, banded float32 Shift boxes with complete halos, scissored coarse rows joined across bands, twelve fractional passes, blurred peak over every interpolated native pixel; peaks stored in the field's last texel row). `generateFeatherRegion` makes each viewport from it (interpolate, restore peak, invert, native ordered erase). Narrow feathers keep export's full-resolution boxes over the finite halo. In `webgpu-preview.js`, `loadGpuBrushShiftRegion` now serves Shift with or without Feather; `loadGpuBrushFeatherField` caches the field as a registered local mask; `prefetchGpuBrushFeatherField` starts it during zoom preparation. Inspect these and `featherFieldPlan`, `featherRegionPlan`, `paintBounds`, `nativeScratch` before building on them.

Native routing (long edge above 3,200): Shift → native; Shift plus Feather → field; feathered brush with erasers and no resident qualified complete mask → field first, qualified paint bitmap with native erase as fallback; feathered paint without erasers → qualification first, field after refusal, CPU last. Already-qualified complete masks keep their small-bitmap route. The classifier and its limits are untouched. The erased-brush order changed because the qualified-paint route measured 2.124 levels / 150 px over two at added-stroke Feather 0.0005; the field measures 1.12 / none.

Evidence: 108 native Feather reference regions pass at at most 1.12403 levels (reduced, full-resolution, unfeathered, up to 16 bands at 24 megapixels); 52 native Shift and 804 rounded references still pass. Five primary recipes pass all four native verdicts in both lanes and three regions. Saved feathered Shift release medians (three fresh sessions per mode): 3607.8→151.2 ms HDR, 4649.2→141.2 ms SDR; scopes 3983.8→551.8 and 5013.5→524.2 ms; CPU mask-tile requests 12→0. First native zoom: 672.9 ms previous order, 890.2 ms with the first version of the new order (cold pipelines and queue waits), 619.8 ms after prefetch and wait removal — no regression, not a claimed gain. Fit stroke about 1.9 s and Fit Feather 1.4–1.6 s are unchanged; Fit never enters the native route.

Prioritize remaining work:
1. Straighten/perspective and expression graphs with resampled leaves. Match export resampling and edge placement; a homography alone is insufficient evidence. This is now the largest remaining CPU mask path.
2. Primary stroke and Feather at Fit (about 1.4–2.0 s complete generation). Separate GPU bitmap preparation/readback/classification, CPU fallback (`loadEditingMask`/`loadMaskLeaf` with `remember=false` still compile Fit-scale CPU masks when a bitmap is not soft; the larger-bitmap fallback compiles a 3,200 CPU mask after every GPU size is refused), foreground overlay and automatic-anchor replacement with repeated measurements before changing anything. The larger-bitmap fallback is a preserved invariant: get an owner decision before altering it.
3. First native zoom (619.8 ms versus 300), scopes (about 0.5–0.95 s), pan and four-mask first-native/scopes. Masks are no longer the limiting cost at first native zoom; look at source transfer and scope settlement.
4. Native leftovers: frames wider than the adapter texture limit keep CPU fallback; a full-frame mask with Shift ±0.05 at 24 megapixels takes 406–520 ms (16 bands); unfeathered native Shift still waits on the queue per region and rescans the painted peak; routing depends on whether a qualified complete mask happens to be resident.
5. Audit non-deferred coverage and complete 30-minute editing endurance after relevant implementation stabilizes. Short capped-cache runs are not endurance approval.

Preserve general two-level mask approval; Peak and Denoise shader byte pins; 4,194,304-pixel editing Peak budget; exact CPU export/Proof; rounded brush shader; larger-bitmap fallback; cancellation, allocation ownership and device-loss recovery; immediate discrete zoom and 80 ms continuous-zoom debounce. Owner accepted only three exact rounded panels 228/249/421; do not request unchanged image review again or treat this as a general three-level approval.

Owner decisions on October 3: saved feathered Shift release timings of 151.2/141.2 ms are accepted for now against the 100 ms goal (this control only); P3-FALLBACK-01, the redundant 3,200 CPU compile in the larger-bitmap fallback, is deferred to explore later and must stay unchanged until Steve reopens it.

Existing deferrals: Match optimization (accepted 3.05 s primary / 4.99 s fifty-local), P3-PEAK-01/P3-PEAK-02 automatic-anchor redesign, and P3-ZOOM-01 SDR cross-scale continuity. Reopen only for regression or materially altered evidence.

Tests/artifacts:
- Serialize all Electron/GPU runs through `tests/run-in-electron.js`, disposable sessions, environment `HDR_FINISHER_ELECTRON_WINDOW_SIZE=2560x1440`. Never overlap GPU tests.
- `tests/brush-native-feather-reference.js` covers 108 exact CPU regions; `tests/brush-native-feather.test.js` covers plans, routing, field reuse, eviction, cancellation/device replacement, superseded generations, tile splitting and zoom preparation. `tests/brush-native-shift-reference.js` (52) and `tests/brush-feather-reference.js` (804) cover the earlier producers.
- `tests/performance/heavy-project-drag-review.js --native --only mask_shift_edge --samples 3` targets saved feathered Shift; `--disable-native-shift` disables both native routes; `--shift-feather-zero` isolates the unfeathered route. Supply the actual project path.
- `tests/performance/phase3-local-route-smoke.js --brush-stroke --brush-feather --zoom-sequence 100,200` measures complete-generation stroke/feather/zoom; `--disable-native-feather` refuses only the feather-only native entry; `--disable-regional-erase` remains.
- `tests/performance/preview-export-compare.js --enforce --local-type brush --local-set mask.mask_shift_edge=0.005` (and `--brush-stroke`, `mask.mask_feather=...`) runs native comparisons without saving.
- `tests/performance/heavy-project-long-session.js --fresh-work --skip-match --pan-lane hdr --budget-gb 0.5 --minutes 1 --idle-minutes 0.5 --native-shift-feather` exercises the field under eviction (`--native-shift-zero-feather` for the unfeathered route).
- Latest raw artifacts under `codebase/output/performance/review/phase3-continuation/`: `native-feather-reference.json`, `native-shift-feather-perf-1..3.json`, `native-shift-feather-baseline-1..3.json`, `native-shift-feather-paired-summary.json`, `native-feather-order-before-1..3.json`, `native-feather-first-perf-1..3.json`, `native-feather-prefetch-perf-1..3.json`, `native-feather-first-paired-summary.json`, `native-shift-feather-*-compare.json`, `native-narrow-feather-*-compare.json`, `native-feather-saved-compare.json`, `native-shift-feather-pressure.json`. Output is ignored by Git and remains local.
- Latest validation: 398 Node tests; 108 + 52 + 804 Electron GPU references; 117 Python frontend-contract/verdict/softness tests; syntax and diff checks. The full backend suite was not repeated (no backend change). Do not repeat green full suites or unchanged native states without a relevant change.

Never save over read-only fixtures. Verify SHA-256 after GPU tests:
Primary: `D:\Photos\Play_Raw\Fantastic light over village - AdamFromCanada\DSC00950.hdrfinisher`
`246ba308dcba22c5483c32ed4c31f5c81a2804504cd01dec2482b6d5be307d56`
Four-mask: `ai\codebase\local-test-media\viewport\DSC00264-four-masks.hdrfinisher`
`3004b621783d77d7fefee6a1997392e1599954ab845b833208841fab1f4d1825`
Fifty-local: `ai\codebase\local-test-media\viewport\DSC00264-fifty-locals.hdrfinisher`
`00913f3d8214a211ff74d0791b5393dddf06c861e57994517354aa1a88e6acee`

Update PRD and evidence as you progress. Finish with fixes, repeated before/after measurements, validation, remaining issues and concrete owner decisions, if any. Do not declare phase 3 closed without exit evidence.
