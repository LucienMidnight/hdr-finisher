# Paste into the next thread

Continue phase 3 of Viewport-Bounded GPU Preview for HDR Finisher. Work autonomously on implementation and evidence; phase 3 remains open. Do not start phase 4, push, or widen tolerances. Do not silently defer unfinished implementation.

Workspace: `D:\AI\AI Projects\HDR Finisher Tool`. Git root: `ai`; executable/test cwd: `ai\codebase`. Branch: `viewport-bounded-preview-phase-2-wip`. The native Shift continuation is committed as `Implement bounded native Shift Edge preview`; its parent checkpoint is `2f4070c`. Use the checkpoint hash supplied with this prompt and verify HEAD. Inspect status first and preserve subsequent unrelated changes. Do not reset the continuation.

Read these first, relative to the git root:
- `docs/product/Viewport_Bounded_GPU_Preview_PRD_2026-10-01.md` (exit criteria, owner decisions, sections 14.17–14.20).
- `docs/technical/viewport-phase3-exit-audit-2026-10-03.md`.
- `docs/technical/viewport-phase3-native-shift-evidence-2026-10-03.md` (latest slice).
- `docs/technical/viewport-phase3-regional-erase-evidence-2026-10-03.md` (previous slice).
- `docs/technical/viewport-phase3-continuation-evidence-2026-10-03.md` and `viewport-phase3-brush-crop-evidence-2026-10-03.md` for earlier repairs and open faults. Follow earlier evidence links only as needed.

Earlier checkpoint work: native feathered brushes with hard erasers now qualify an erase-free painted bitmap using the unchanged rounded producer/classifier, then apply ordered erase/repaint attenuation at native coordinates in a bounded region. Already-qualified complete masks keep their route. Shift, intrinsically unqualified paint and resampling retain exact fallback. Qualified bitmap resolution now survives eviction recreation, including CPU-refusal fallback. Backend verdict headers expose classifier terms. Inspect `loadGpuBrushEraseRegion`, `loadGpuBrushLeaf`, `softLeafMask` and `brushRegionalEraseFragmentMain` before building on them.

Latest work: bounded native Shift **with Feather zero**. `loadGpuBrushShiftRegion` uses foreground halos even with a whole resident picture proxy; catch-up batches split per tile. `generateShiftRegion` measures full-field paint peak in bounded GPU bands, then filters native pixels with the complete finite support. A separate compensated native metric and CPU-rounded segment deltas fix two hardness-one +0.05 pixels initially off by 12 levels; all 52 native reference regions now pass at <=1.12403 levels. The existing rounded bitmap producer remains unchanged (804 reference recipes pass). Full-field normalization still scans the uncropped GPU paint; it is bounded memory, not exclusively viewport arithmetic. Native Shift plus Feather remains exact CPU fallback and the next implementation priority.

Three fresh sessions per mode with zero Feather/manual anchors (three drags/lane/session; mode blocks; warm repeats included) measure native release medians 3321.5→186.9 ms HDR and 4265.8→158.2 ms SDR, scopes 3680.0→556.5 and 4624.0→531.3 ms. CPU mask-tile batch requests fall from 12 to zero per lane across nine observations. These are different recipes from the old saved feathered Shift benchmark. First-feedback and 100 ms slider exits still fail. See final `native-shift-metric-*` artifacts; older diagnostic/metric trials are not final evidence.

Earlier repeated primary measurements (three fresh sessions per mode, original automatic anchors): first 100% zoom picture median 2347.5 ms with only the new route disabled versus 657.6 ms enabled; scopes 2681.3 versus 990.5 ms. Native CPU mask-tile batches fall from one to zero. The 300 ms goal remains missed. Fit stroke and feather still take roughly 1.5–1.9 seconds, scopes roughly 2–2.5 seconds; no general stroke speed gain. Saved and added-stroke native comparisons pass all four verdicts in HDR/SDR and three regions; mask error approximately 1.12 levels. These results are mode blocks, not randomized trials.

Prioritize remaining work:
1. Native Shift Edge plus Feather accurate bounded GPU coverage. Zero-Feather Shift now qualifies the native route, but the saved feathered recipe still has release medians 3624.6/4719.9 ms HDR/SDR and seconds of CPU compilation. Preserve native edge placement, full-frame shifted/blurred peak normalization and the export-aligned reduced feather grid; never stretch a small shifted bitmap. Optimize repeated native paint-peak scans only with correct allocation ownership.
2. Intrinsically narrow feathered paint rejected through 3200. Distinguish bend, peak deficit, mass and hard eraser terms; the regional eraser route fixes only separable eraser rejection. Do not widen admission.
3. Straighten/perspective and expression graphs with resampled leaves. Match export resampling and edge placement; a homography alone is insufficient evidence.
4. Primary stroke/feather, first-native zoom, scopes/pan and four-mask first-native/scopes. Separate GPU preparation/readback/classification, CPU fallback, foreground overlay and eventual automatic-anchor replacement using repeated representative measurements.
5. Audit non-deferred coverage and complete 30-minute editing endurance after relevant implementation stabilizes. Short capped-cache runs are not endurance approval.

Preserve general two-level mask approval; Peak and Denoise shader byte pins; 4,194,304-pixel editing Peak budget; exact CPU export/Proof; rounded brush shader; larger-bitmap fallback; cancellation, allocation ownership and device-loss recovery; immediate discrete zoom and 80 ms continuous-zoom debounce. Owner accepted only three exact rounded panels 228/249/421; do not request unchanged image review again or treat this as a general three-level approval.

Existing deferrals: Match optimization (accepted 3.05 s primary / 4.99 s fifty-local), P3-PEAK-01/P3-PEAK-02 automatic-anchor redesign, and P3-ZOOM-01 SDR cross-scale continuity. Reopen only for regression or materially altered evidence.

Tests/artifacts:
- Serialize all Electron/GPU runs through `tests/run-in-electron.js`, disposable sessions, environment `HDR_FINISHER_ELECTRON_WINDOW_SIZE=2560x1440`. Never overlap GPU tests.
- `tests/brush-native-shift-reference.js` covers 52 exact CPU regions including native Shift extremes. `tests/brush-native-shift.test.js` covers routing, crops, inflight ownership, cancellation/device replacement and split batches.
- `tests/performance/heavy-project-drag-review.js --native --only mask_shift_edge --samples 3` targets saved feathered Shift. `--shift-feather-zero` isolates the new route; `--disable-native-shift` disables only that method. Supply the actual project path.
- `tests/performance/phase3-local-route-smoke.js` measures complete-generation stroke/feather/zoom; `--disable-regional-erase` is the disposable paired baseline.
- `tests/performance/preview-export-compare.js --brush-stroke` applies the same stroke for native comparisons.
- `tests/performance/heavy-project-long-session.js` supports `--fresh-work --skip-match --pan-lane hdr --budget-gb 0.5 --minutes 1 --idle-minutes 0.5` (`--native-shift-zero-feather` exercises the new native route); use actual project paths, not the string `primary`. Final assertions cover picture, drained scopes/anchors, errors, allocator debt and mask registration/residency agreement.
- Latest raw artifacts under `codebase/output/performance/review/phase3-continuation/`: `native-shift-metric-*`, `native-shift-baseline-final-*`, `native-shift-contract-edited-compare.json`, `native-shift-pressure-final.json`, `native-shift-reference.json`, `native-shift-existing-brush-reference.json`. Earlier `primary-regional-erase-*`, `brush-rejection-terms.json` and `brush-regional-erase-reference*.json` remain available. Output is ignored by Git and remains local.
- Latest Node validation: 379 tests; 52 native Shift GPU CPU-reference regions and 804 unchanged rounded brush/feather/Shift recipes pass. Peak/Denoise pins and syntax/diff checks pass. Native expansion/contraction pass all four verdicts in both lanes and three regions. The final 0.5 GiB Shift replay completes 96 operations, 13 successful native batches and 389 evictions, with no errors/debt/transients, matching mask registry/residency and stable 30-second idle. Earlier validation: 371 Node tests, ten focused Python tests (`test_gpu_mask_bitmap_verdict.py`, `test_mask_softness.py`), syntax and diff checks pass, and an earlier regional eraser replay with 396 evictions. Full backend suite was not repeated for the latest slice. Do not repeat green full suites or unchanged native states without a relevant change.

Never save over read-only fixtures. Verify SHA-256 after GPU tests:
Primary: `D:\Photos\Play_Raw\Fantastic light over village - AdamFromCanada\DSC00950.hdrfinisher`
`246ba308dcba22c5483c32ed4c31f5c81a2804504cd01dec2482b6d5be307d56`
Four-mask: `ai\codebase\local-test-media\viewport\DSC00264-four-masks.hdrfinisher`
`3004b621783d77d7fefee6a1997392e1599954ab845b833208841fab1f4d1825`
Fifty-local: `ai\codebase\local-test-media\viewport\DSC00264-fifty-locals.hdrfinisher`
`00913f3d8214a211ff74d0791b5393dddf06c861e57994517354aa1a88e6acee`

Update PRD and evidence as you progress. Finish with fixes, repeated before/after measurements, validation, remaining issues and concrete owner decisions, if any. Do not declare phase 3 closed without exit evidence.
