# Preview performance harness

Run the app, install the browser-test dependency with `npm install`, then run:

```powershell
npm run test:performance -- --url http://127.0.0.1:8000
```

The default matrix covers deterministic EXR and TIFF fixtures in fast, high-quality, and forced no-WebGPU modes with 30 timed adjustment repetitions followed by 100 settled changes for memory/cache stability. Add a local Apple HDR HEIC without committing it:

```powershell
npm run test:performance -- --inputs tests/fixtures/blender_linear_rec2020.exr,tests/fixtures/hdr_headroom.tiff,local-test-media/inputs/IMG_4109.HEIC
```

Reports are written to `output/performance/preview-performance.json`. Use `--enforce` only on the named benchmark workstation; other machines should retain the report for relative comparison.

## GPU local-adjustment sprint

The Luma opacity/feather and live-scope benchmark records isolated changes,
30-event rapid drags (including opacity direction reversals), presentation-order
guards, mask request counts, CPU mask time, transport, scheduler
queue delay, GPU submission/presentation, optional GPU timestamp queries, scope
freshness/content fingerprints, draft-local scope payloads, stale cancellation,
browser, adapter, fixture, and active resolutions:

```powershell
npm run test:gpu-local-adjustments -- --url http://127.0.0.1:8000 --phase phase0
npm run test:gpu-local-adjustments -- --url http://127.0.0.1:8000 --phase phase1
npm run test:gpu-local-adjustments -- --url http://127.0.0.1:8000 --phase phase2-final
node tools/playwright_gpu_parity.js test-pattern output/performance/gpu-local-phase2-parity --local-luma-only
```

Generated JSON is written below `output/performance/`. Durable conclusions and
the exact percentile method belong in local maintainer QA notes.

## Viewport-Bounded GPU Preview

Plan and limits: `docs/product/Viewport_Bounded_GPU_Preview_PRD_2026-10-01.md`.
Every driver opens projects in a disposable session and never saves them. Run
Electron drivers one at a time with `HDR_FINISHER_ELECTRON_WINDOW_SIZE=2560x1440`.

Preview versus export (PRD 4.6). Captures the preview at 100% for three regions
per lane, renders the same edit document through the export pipeline before
encoding, and reports the section 4.1-4.3 statistics. `--enforce` exits
non-zero when an approved limit is exceeded; `--set path=value,...` applies
in-session edits to isolate a module:

```powershell
node tests/run-in-electron.js tests/performance/preview-export-compare.js `
  --project <file.hdrfinisher> --output output/performance/review/<run>/compare.json
```

Limitations to keep in mind when reading its report:

- The fixtures choose the tiled route at native zoom and are captured on that
  route. If another project chooses Direct, picture readback requires a tiled
  capture; the app's choice and the capture route are both recorded.
- The preview side of a mask is a readback from the renderer
  (`readLocalMaskRegion`): the value each local pass sampled for the frame on
  screen, before opacity, drawn through the same shader function the local
  passes use. It covers masks from the backend and masks made on the GPU, and
  is taken on the route the app chose (`chosenRouteMasks`) as well as on the
  tiled route. The value is unrounded and the export's mask is 8-bit, so the
  reported difference can include up to half a level of the export's rounding.
  A mask that could not be read back fails the mask verdict.
- An 8-bit presentation target cannot represent less than one level, which
  near black is several percent of luminance. On such a target (the format
  names itself `8unorm`) a pixel whose largest channel difference from the
  export is at most one level of the preview's display encoding does not count
  against the tone limits (PRD 4.1). It stays in the population as a pixel
  inside the limits. `median`, `p99` and `max` remain what was measured;
  `judged` and the verdicts are what counts, and `eightBitRule` says how many
  pixels the rule covered. A float target is judged as written.

Full-size Proof versus export on a real project (PRD section 3), by file hash:

```powershell
.venv\Scripts\python.exe tests\performance\proof_export_identity.py `
  --project <file.hdrfinisher> --out output/performance/review/<run>/proof-identity.json
```

Section 6 baseline. `zoom-after-edit-review.js` covers zoom after a mask edit,
`heavy-project-long-session.js --fresh-work --minutes 5 --idle-minutes 0`
covers strokes, feather release, slider drags, pan and Match,
`raw-import-baseline.js` covers the wait after import, and
`summarize-viewport-baseline.js --out <summary.json> <reports...>` reduces them
to counts, medians, p95 and maxima.

Soft masks (PRD 5.1). `soft_mask_fuzz.py` compiles random brush, gradient and
path masks exactly and as the small bitmap the renderer stretches, and records
the true difference beside the backend's verdict; the rule in
`backend/hdr_finisher/mask_softness.py` was calibrated on it and
`tests/test_mask_softness.py` runs a small version. `soft_mask_survey.py` does
the same for the masks of a real project:

```powershell
.venv\Scripts\python.exe tests\performance\soft_mask_fuzz.py `
  --out output/performance/review/<run>/soft-mask-fuzz.json --count 60 --seed 11
```

Fixtures. `make_four_mask_fixture.py` builds the owner's four-mask case from a
RAW (and `--locals 50` the scaling case) under the git-ignored
`local-test-media/viewport/`. `peak-readout-review.js` records what the scope
panel reports as Peak at Fit and 100% with the peak option off and on.

Phase 2 keeps the owner's 1% peak limit. The panel reports a bounded estimate
in both checkbox states; the historical driver/API names remain for baseline
comparison. `tests/editing-peak-bounded.js` checks maximum peaks and robust
anchors for both lanes: no whole source above a 1,600 edge, no source-patch
budget above four million pixels, and no mask bitmap above that pixel budget.
It also checks that measurement leaves the accepted picture and its resources
alone. An optional `--reference-nits` enforces the 1% HDR peak limit against an
independently measured CPU reference:

```powershell
node tests/run-in-electron.js tests/editing-peak-bounded.js `
  --project <file.hdrfinisher> --reference-nits <exact-peak> --output <report.json>
```

Export/Proof warnings are checked by `tests/test_peak_accuracy.py` and
`tests/test_proof_export_identity.py`, including cached Proof requests with
different estimates. Full-size Proof keeps encoded export identity; reduced
Proof does not compare its smaller rendition against a native editing estimate.

Phase 3's Sharpen filter regression compares the actual GPU kernel against
export's CPU three-box blur, including small-image boundaries and radius
transitions, in both lanes:

```powershell
node tests/run-in-electron.js tests/sharpen-blur-reference.js `
  --output <report.json>
```

This synthetic filter check does not replace `preview-export-compare.js` or
its unchanged picture tolerances. The primary as-saved repair, remaining
four-mask outliers and three alternating timing pairs are recorded in
[phase 3 Detail evidence](../../../docs/technical/viewport-phase3-detail-evidence-2026-10-02.md).

`tests/neutral-color-grading-reference.js`, through the same Electron wrapper,
is a tiny CPU/GPU regression for signed near-black colours, neutral wheel
identity and active grading. It opens no project. The follow-up evidence
records a single HDR-centre fixture comparison resolving the two outliers.

`tests/mask-raster-reference.js`, through the Electron wrapper, checks GPU
path/brush tiles against CPU masks, including a native-coordinate hard-edge
regression and exact Bezier vertices. It opens no project. The first tile
implementation and one enforced fixture capture are recorded in
[phase 3 mask evidence](../../../docs/technical/viewport-phase3-mask-evidence-2026-10-02.md).

`tests/luma-region-reference.js` checks aligned source regions against the
existing whole-source GPU luminance mask for narrow/reduced feather and
inversion. It opens no project. Follow it with a chosen-route picture capture
and the bounded-peak check when changing the source/measurement contracts.
`tests/luma-region-routing.test.js` (Node) checks which lane/working-space
regions may supply that mask: HDR, and SDR only when its source is the ACEScg
scene picture.

`tests/local-grade-reference.js` checks production local parameters and the
actual local shader against CPU export for curves, wheels and opacity in both
lanes. `tests/performance/phase3-local-route-smoke.js` makes one local curves/
wheels edit and one native zoom in a disposable fixture session; it is a route
and timing observation, not an export comparison or long-session test.
`--lane sdr` runs it in the SDR lane; each action records how many backend
mask-tile requests it made. The `tiled-render` stage in its report carries
`encodeMs` beside `durationMs`; the difference is the wait for the GPU. See
[zoom transfer evidence](../../../docs/technical/viewport-phase3-zoom-transfer-evidence-2026-10-02.md).

`tests/performance/match-candidate-review.js` presses Match once in a
disposable session and records the backend's stage timing, the recipe and
the CPU-measured quality. `--renderer gpu` (the app's default), `cpu`, or
`verify`, which renders every GPU candidate on the CPU as well and reports
the largest luminance difference; verify timings are not Match timings.
`tests/test_sdr_match_remote.py` covers the bridge and its CPU fallback with
a stand-in page. See [Match evidence](../../../docs/technical/viewport-phase3-match-evidence-2026-10-02.md).

The local-route smoke also waits for an actual new settled GPU scope, checks
the loaded 512-edge GPU navigation overview, rejects a stale auxiliary render,
and asserts no CPU scope/navigation-preview requests during the two actions.
See [auxiliary-view evidence](../../../docs/technical/viewport-phase3-auxiliary-evidence-2026-10-02.md)
for one-operation timings and their limits; these are not session medians.
