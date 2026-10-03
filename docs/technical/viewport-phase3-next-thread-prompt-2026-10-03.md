# Paste into the next thread

Continue phase 3 of Viewport-Bounded GPU Preview for HDR Finisher. Work autonomously on implementation and evidence; phase 3 remains open. Do not start phase 4, push, or widen tolerances. Do not silently defer unfinished implementation.

Workspace: `D:\AI\AI Projects\HDR Finisher Tool`. Git root: `ai`; executable/test cwd: `ai\codebase`. Branch: `viewport-bounded-preview-phase-2-wip`. The last commit is `Warp leaf masks on the GPU under straighten and perspective`, on top of `fa2fdbc` (native Feather field) and `344506c` (native Shift). Use the hash supplied with this prompt, verify HEAD and inspect status first. Preserve subsequent unrelated changes. Do not reset.

**How Steve wants the work run:** batch related changes and validate them together. Build with the fast checks only (Node unit tests, CPU-only reference tests, syntax), add a fast CPU test that de-risks a design before any GPU run, then run the slow Electron/GPU validations once, chained in as few commands as possible. Still run every relevant slow check once, and say which timings are single observations.

Read these first, relative to the git root:
- `docs/product/Viewport_Bounded_GPU_Preview_PRD_2026-10-01.md` (exit criteria, owner decisions, sections 14.17–14.22).
- `docs/technical/viewport-phase3-exit-audit-2026-10-03.md`.
- `docs/technical/viewport-phase3-resampled-mask-evidence-2026-10-03.md` (latest slice).
- `docs/technical/viewport-phase3-native-feather-evidence-2026-10-03.md` and `viewport-phase3-native-shift-evidence-2026-10-03.md` (previous slices). Follow earlier evidence links only as needed.

## What exists now

- **Native Shift and Feather** (`frontend/gpu-brush-mask.js`): `generateShiftRegion`, and the viewport-independent feather field (`generateFeatherField`, `generateFeatherRegion`, `featherFieldPlan`, `paintBounds`, `nativeScratch`). Rows and columns are tiled, so frames wider than the adapter texture limit are served. Routing in `webgpu-preview.js`: `loadGpuBrushShiftRegion`, `loadGpuBrushFeatherField`, `prefetchGpuBrushFeatherField`.
- **Straighten/perspective leaf masks**: `frontend/geometry-resample.js` is export's warp as arithmetic (Pillow coefficients, safe inset, crop rounding; not a fitted homography). `frontend/gpu-mask-resample.js` is Pillow's bicubic on byte levels with the global range clip. In `webgpu-preview.js`: `resamplePlan`, `gpuOrientedMaskRegion` (source-space mask from the native producers), `gpuMaskExtent`/`scanGpuMaskExtent`, `loadGpuResampledMask`, `loadGpuResampledLeaf` (Fit, scopes, measurements) and `loadGpuResampledRegion` (tiled native). Brush, path and linear-gradient leaves only.
- **Fit**: `loadMaskLeaf` returns a GPU brush bitmap made at the requested scale for scopes and measurements whether or not it is soft.

Key numbers: saved feathered Shift release 3608→151 ms HDR and 4649→141 ms SDR (three sessions per mode). First native zoom 620 ms (goal 300). First straightened 100% zoom 8253→about 3500 ms with CPU mask requests 8→0 (single sessions); the remainder is the straightened picture source. Fit stroke about 1.9 s, Fit Feather 1.1–1.6 s (goal 100 ms).

## Open work, in priority order

1. **Combined masks under straighten/perspective.** Export composes the whole expression in source space, rounds to bytes, then warps once. The preview still warps each leaf and composes afterwards. Build the composed source-space region (the oriented frame from `resamplePlan`) and feed it to the existing resampler. Luminance leaves need un-warped source luminance for that; see item 2.
2. **P3-LUMA-RESAMPLE-01: luminance masks under straighten/perspective.** On the primary with perspective vertical 15, the `clouds` luminance leaf measures 3.153 levels with 943 pixels over two (upper-left, both lanes) and fails the masks verdict. The route computes the mask from the warped picture; export warps the finished mask. No paired baseline was run: first confirm it predates the resampled-mask slice (`--disable-resampled-masks` on `preview-export-compare.js`), then fix it.
3. **P3-PEAK-03: Peak under straighten.** With a 2 degree straighten the scope panel shows the uncorrected "Peak (preview)" figure, 605.2 nit against export 628.4 (3.7% low; limit 1%). No bounded editing Peak is produced under straighten. Identical with the new mask route disabled. Keep the 4,194,304-pixel editing-Peak budget and the shader pins. This is separate from the deferred P3-PEAK-01/02.
4. **Straightened first zoom, about 3.5 s.** Masks no longer contribute. The backend materializes the whole rotated frame for the `roll` stage (`finishing.apply_geometry_region`); `geometry-resample.js` now holds the exact window arithmetic that function says it lacks.
5. **Fit brush stroke and Feather (1.1–2.0 s against 100 ms).** Separate GPU bitmap preparation, readback and classification, foreground overlay and automatic-anchor replacement with repeated measurements before changing anything. One known cost is the deferred P3-FALLBACK-01; do not change it without Steve.
6. **First native zoom (620 ms against 300), scopes (0.5–1.0 s), pan, and the four-mask project.** Masks are not the limiting cost; look at source transfer and scope settlement.
7. **Native leftovers.** A full-frame mask with Shift ±0.05 at 24 megapixels takes 0.4–0.5 s to prepare; unfeathered native Shift still waits on the queue per region and rescans the painted peak; the range scan for a warped unfeathered Shift mask repeats that per tile; routing depends on whether a qualified complete mask happens to be resident. Wide-frame support has reference coverage only, no real fixture.
8. **Not yet run for the last slice:** a capped-memory pressure replay with straighten, and repeated timing sessions (the straighten and Fit-bitmap timings are single observations).
9. **Coverage audit** of every non-deferred control and geometry combination, then the **30-minute editing endurance** run, last, once the items above stop changing. Short capped-cache runs are not endurance approval.

## Owner decisions in force

- General soft-mask limit is two levels. Accepted exceptions are case-specific only: rounded panels 228/249/421, and (October 3) P3-MASK-REVIEW-02: warped feathered brush masks at up to two byte levels, 2.06 as stored, six reference pixels. Neither is a general three-level approval; do not request review of unchanged cases again.
- Saved feathered Shift release timings of 151.2/141.2 ms are accepted for now against the 100 ms goal, for that control only.
- Deferred: Match optimization (3.05 s primary / 4.99 s fifty-local accepted); P3-PEAK-01/P3-PEAK-02 automatic-anchor redesign; P3-ZOOM-01 SDR cross-scale continuity; P3-FALLBACK-01 (the larger-bitmap fallback compiles a 3,200-pixel CPU mask after every GPU bitmap size is refused, 0.6–1.2 s in the background; explore later, leave unchanged). Reopen only for regression or materially altered evidence.

Preserve: Peak and Denoise shader byte pins (`webgpu-shaders.js` unchanged by the last three slices); 4,194,304-pixel editing Peak budget; exact CPU export/Proof; rounded brush shader; larger-bitmap fallback; classifier limits; cancellation, allocation ownership and device-loss recovery; immediate discrete zoom and 80 ms continuous-zoom debounce.

## Tests and artifacts

- Serialize all Electron/GPU runs through `tests/run-in-electron.js`, disposable sessions, environment `HDR_FINISHER_ELECTRON_WINDOW_SIZE=2560x1440`. Never overlap GPU tests.
- Fast (no GPU): `node --test tests/*.test.js` (408 pass). `tests/geometry-resample.test.js` checks the warp arithmetic and Pillow kernel against the Python export in about two seconds; `tests/mask-resample.test.js` and `tests/brush-native-feather.test.js` cover routing and lifetimes.
- GPU references: `tests/mask-resample-reference.js` (70 regions; fails above two byte levels and lists anything above 1.13), `tests/brush-native-feather-reference.js` (114, including a 9000-pixel frame), `tests/brush-native-shift-reference.js` (52), `tests/brush-feather-reference.js` (804).
- `tests/performance/preview-export-compare.js --enforce` with `--set shared.geometry.straighten_angle=2` or `shared.geometry.perspective_vertical=15`, `--local-type brush --local-set mask.mask_shift_edge=0.005`, `--brush-stroke`; `--disable-resampled-masks` is the paired baseline. It never saves.
- `tests/performance/phase3-local-route-smoke.js --brush-stroke --brush-feather --zoom-sequence 100,200`, with `--geometry straighten_angle=2`, `--disable-resampled-masks`, `--disable-native-feather`, `--disable-regional-erase`.
- `tests/performance/heavy-project-drag-review.js --native --only mask_shift_edge --samples 3` (`--disable-native-shift`, `--shift-feather-zero`).
- `tests/performance/heavy-project-long-session.js --fresh-work --skip-match --pan-lane hdr --budget-gb 0.5 --minutes 1 --idle-minutes 0.5 --native-shift-feather`.
- Supply the actual project path, not the string `primary`. Raw artifacts are under `codebase/output/performance/review/phase3-continuation/` (`resample-*`, `mask-resample-reference.json`, `fit-bitmap-perf-1.json`, `native-feather-*`, `native-shift-feather-*`); output is ignored by Git and stays local.
- Latest validation: 408 Node tests; 70 + 114 + 52 + 804 GPU references; 117 Python frontend-contract, verdict and softness tests. No backend code changed in the last three slices, so the full backend suite was not repeated. Do not repeat green suites or unchanged native states without a relevant change.

Never save over read-only fixtures. Verify SHA-256 after GPU tests:
Primary: `D:\Photos\Play_Raw\Fantastic light over village - AdamFromCanada\DSC00950.hdrfinisher`
`246ba308dcba22c5483c32ed4c31f5c81a2804504cd01dec2482b6d5be307d56`
Four-mask: `ai\codebase\local-test-media\viewport\DSC00264-four-masks.hdrfinisher`
`3004b621783d77d7fefee6a1997392e1599954ab845b833208841fab1f4d1825`
Fifty-local: `ai\codebase\local-test-media\viewport\DSC00264-fifty-locals.hdrfinisher`
`00913f3d8214a211ff74d0791b5393dddf06c861e57994517354aa1a88e6acee`

Update PRD and evidence as you progress. Finish with fixes, before/after measurements, validation, remaining issues and concrete owner decisions, if any. Do not declare phase 3 closed without exit evidence.
