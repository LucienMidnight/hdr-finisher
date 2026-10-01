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

## Viewport-Bounded GPU Preview (phase 0 tools)

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

- Only the tiled route retains a readable frame, so the capture forces it. The
  route the app chose is recorded in `routeChosenByApp`.
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
panel reports as Peak at Fit and 100% with Exact Peak off and on.
