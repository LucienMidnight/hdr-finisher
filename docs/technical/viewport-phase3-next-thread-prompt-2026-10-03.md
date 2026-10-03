# Paste into the next thread

Continue phase 3 of Viewport-Bounded GPU Preview for HDR Finisher. Work autonomously on implementation and evidence; phase 3 remains open. Do not start phase 4, push, or widen tolerances. Do not silently defer unfinished implementation.

Workspace: `D:\AI\AI Projects\HDR Finisher Tool`. Git root: `ai`; executable/test cwd: `ai\codebase`. Branch: `viewport-bounded-preview-phase-2-wip`. Start from the continuation checkpoint containing this prompt. Inspect status first and preserve subsequent unrelated changes.

Read these first, relative to the git root:
- `docs/product/Viewport_Bounded_GPU_Preview_PRD_2026-10-01.md` (exit criteria, owner decisions, sections 14.17–14.19).
- `docs/technical/viewport-phase3-exit-audit-2026-10-03.md`.
- `docs/technical/viewport-phase3-regional-erase-evidence-2026-10-03.md` (latest slice).
- `docs/technical/viewport-phase3-continuation-evidence-2026-10-03.md` and `viewport-phase3-brush-crop-evidence-2026-10-03.md` for earlier repairs and open faults. Follow earlier evidence links only as needed.

Latest work: native feathered brushes with hard erasers now qualify an erase-free painted bitmap using the unchanged rounded producer/classifier, then apply ordered erase/repaint attenuation at native coordinates in a bounded region. Already-qualified complete masks keep their route. Shift, intrinsically unqualified paint and resampling retain exact fallback. Qualified bitmap resolution now survives eviction recreation, including CPU-refusal fallback. Backend verdict headers expose classifier terms. Inspect `loadGpuBrushEraseRegion`, `loadGpuBrushLeaf`, `softLeafMask` and `brushRegionalEraseFragmentMain` before building on them.

Repeated primary measurements (three fresh sessions per mode, original automatic anchors): first 100% zoom picture median 2347.5 ms with only the new route disabled versus 657.6 ms enabled; scopes 2681.3 versus 990.5 ms. Native CPU mask-tile batches fall from one to zero. The 300 ms goal remains missed. Fit stroke and feather still take roughly 1.5–1.9 seconds, scopes roughly 2–2.5 seconds; no general stroke speed gain. Saved and added-stroke native comparisons pass all four verdicts in HDR/SDR and three regions; mask error approximately 1.12 levels. These results are mode blocks, not randomized trials.

Prioritize remaining work:
1. Native Shift Edge accurate bounded GPU coverage. Existing native release medians 3624.6/4719.9 ms HDR/SDR, uncached CPU mask compilation roughly 3.3–4.9 seconds. Preserve hard-edge placement and full-frame coordinate normalization.
2. Intrinsically narrow feathered paint rejected through 3200. Distinguish bend, peak deficit, mass and hard eraser terms; the regional eraser route fixes only separable eraser rejection. Do not widen admission.
3. Straighten/perspective and expression graphs with resampled leaves. Match export resampling and edge placement; a homography alone is insufficient evidence.
4. Primary stroke/feather, first-native zoom, scopes/pan and four-mask first-native/scopes. Separate GPU preparation/readback/classification, CPU fallback, foreground overlay and eventual automatic-anchor replacement using repeated representative measurements.
5. Audit non-deferred coverage and complete 30-minute editing endurance after relevant implementation stabilizes. Short capped-cache runs are not endurance approval.

Preserve general two-level mask approval; Peak and Denoise shader byte pins; 4,194,304-pixel editing Peak budget; exact CPU export/Proof; rounded brush shader; larger-bitmap fallback; cancellation, allocation ownership and device-loss recovery; immediate discrete zoom and 80 ms continuous-zoom debounce. Owner accepted only three exact rounded panels 228/249/421; do not request unchanged image review again or treat this as a general three-level approval.

Existing deferrals: Match optimization (accepted 3.05 s primary / 4.99 s fifty-local), P3-PEAK-01/P3-PEAK-02 automatic-anchor redesign, and P3-ZOOM-01 SDR cross-scale continuity. Reopen only for regression or materially altered evidence.

Tests/artifacts:
- Serialize all Electron/GPU runs through `tests/run-in-electron.js`, disposable sessions, environment `HDR_FINISHER_ELECTRON_WINDOW_SIZE=2560x1440`. Never overlap GPU tests.
- `tests/performance/heavy-project-drag-review.js --native --only mask_shift_edge --samples 3` targets Shift. Supply the actual project path.
- `tests/performance/phase3-local-route-smoke.js` measures complete-generation stroke/feather/zoom; `--disable-regional-erase` is the disposable paired baseline.
- `tests/performance/preview-export-compare.js --brush-stroke` applies the same stroke for native comparisons.
- `tests/performance/heavy-project-long-session.js` supports `--fresh-work --skip-match --pan-lane hdr --budget-gb 0.5 --minutes 1 --idle-minutes 0.5`; use actual project paths, not the string `primary`. Final assertions cover picture, drained scopes/anchors, errors, allocator debt and mask registration/residency agreement.
- Latest raw artifacts: `codebase/output/performance/review/phase3-continuation/primary-regional-erase-*`, `brush-rejection-terms.json`, `brush-regional-erase-reference*.json`. Output is ignored by Git and remains local.
- Latest validation: 371 Node tests, ten focused Python tests (`test_gpu_mask_bitmap_verdict.py`, `test_mask_softness.py`), syntax and diff checks pass. Full backend suite was not repeated for the latest slice. The 0.5 GiB short replay completes with 396 evictions, no errors/debt/transients, matching mask registry/residency and stable 30-second idle. Do not repeat green full suites or unchanged native states without a relevant change.

Never save over read-only fixtures. Verify SHA-256 after GPU tests:
Primary: `D:\Photos\Play_Raw\Fantastic light over village - AdamFromCanada\DSC00950.hdrfinisher`
`246ba308dcba22c5483c32ed4c31f5c81a2804504cd01dec2482b6d5be307d56`
Four-mask: `ai\codebase\local-test-media\viewport\DSC00264-four-masks.hdrfinisher`
`3004b621783d77d7fefee6a1997392e1599954ab845b833208841fab1f4d1825`
Fifty-local: `ai\codebase\local-test-media\viewport\DSC00264-fifty-locals.hdrfinisher`
`00913f3d8214a211ff74d0791b5393dddf06c861e57994517354aa1a88e6acee`

Update PRD and evidence as you progress. Finish with fixes, repeated before/after measurements, validation, remaining issues and concrete owner decisions, if any. Do not declare phase 3 closed without exit evidence.
