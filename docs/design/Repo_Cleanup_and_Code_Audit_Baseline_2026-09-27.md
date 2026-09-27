# Repository Cleanup and Code Audit Baseline

**Date:** September 27, 2026  
**Branch:** `audit/repo-cleanup`  
**Pre-audit tag:** `pre-audit-2026-09-27` (commit `02dcb1f`)  
**Status:** In progress; no files have been moved or deleted

This is the before-change record required by section 3 of the cleanup and audit plan. Results in
this file are baseline observations, not regressions caused by the audit.

## Automated test baseline

| Check | Result | Notes |
|---|---:|---|
| `.venv\Scripts\python.exe -m pytest -q tests` | Pass | 1,448 passed, 3 skipped, 18 warnings in 73.32 s. The project virtual environment is required; the system Python does not contain the bundled-format dependencies. |
| `npm --prefix desktop test` | Pass | 22 passed in 1.18 s. |
| `npm run test:electron` | Fail before running a test | The npm script gives `run-in-electron.js` no required test-file argument, so the runner prints its usage and exits 1. |
| Black & White GPU/CPU parity | Pass | All 16 HDR/SDR, Film Look, and filter cases passed; maximum reported p99.9 difference was one 8-bit level. |
| Clarity-map GPU/CPU parity | Pass | All three radii passed; the companion Detail Softness/Microcontrast cases also passed. |
| Film-grain GPU/CPU parity | Pass | All six film, lane, size, and map cases passed; maximum reported difference was one 8-bit level. |
| Tiled denoise parity | Pass | Even and odd dimensions, four wavelet levels, and four tile sizes were byte-exact; live-control, zoom/pan, and superseded-analysis gates passed. |
| Tiled CPU Detail parity | Fail before parity assertion | Direct capture was 1058×597 while the CPU reference was 1024×576. The test aborts because the pixel counts cannot align. |

The first attempted Electron parity launch inside the restricted command sandbox closed before a
window was created. Re-running with desktop-app permission succeeded, so that sandbox-only launch
failure is not counted as a product failure.

## Warning baseline

The Python suite reports these pre-existing warnings:

- one Starlette deprecation warning for importing `TestClient` through the current `httpx` path;
- one Pydantic warning caused by a `datetime.utcnow()` value in the proof-evidence round trip; and
- 16 Pillow warnings from `tests/test_source_tile_api.py` passing the deprecated `mode` argument to
  `Image.fromarray()`.

These warnings belong in the code-audit findings. They are not fixed in the baseline batch.

## Preview smoothness baseline

Pending. A representative source and the exact release-to-settled measurement command need to be
selected and held constant for the after measurement. Existing performance probes are not silently
substituted because that would make the before/after number ambiguous.

## Baseline follow-ups

1. Decide whether `test:electron` should name one canonical smoke test or become an explicit
   aggregator; its current command cannot run.
2. Diagnose the Tiled CPU Detail capture/reference-size mismatch before trusting that parity gate.
3. Run and record the remaining parity-named suites, including the long-running export and ROI
   variants, using a consistent Electron-hosted backend.
4. Record release-to-settled preview latency on the chosen representative image.

## Follow-up results (2026-09-27)

### 1. `test:electron` decision — resolved

`test:electron` now names one canonical smoke test instead of the bare runner:
`node tests/run-in-electron.js tests/startup-state.js`. `startup-state.js` is the Electron
harness-verification test already documented for this host, it needs no GPU adapter, and it proves
the app boots against its sidecar. The named parity scripts remain the way to run the deeper
Electron-hosted gates. Result: pass ("Ephemeral startup-state browser test passed.").

### 2. Tiled CPU Detail capture/reference-size mismatch — diagnosed and fixed

Root cause: the test took an element screenshot 200 ms after its diagnostic render. The app's own
display-tier follow-up presented in that window and resized the canvas to the window's preview area
(1058×597), so the capture no longer held the frame the test had rendered. The diagnostic render
itself was always correct (canvas 1024×576; accepted presentation 1024×576). Fix: cancel the app
scheduler, drain in-flight drafts, and read the canvas backing store in the same task chain with
`toDataURL`, the pattern `bw-parity.js`, `grain-parity.js`, and `clarity-map-parity.js` already
use. Result: pass; seam elevation 0.0000 for columns and rows at tile sizes 256 and 512, including
the attribution check.

### 3. Remaining parity-named suites — run under the Electron host

All runs were `node tests/run-in-electron.js <test>` from `codebase/`:

| Suite | Result |
|---|---|
| Tiled CPU Detail parity (`tiled-cpu-detail-parity.js`) | Pass (after the fix above) |
| Tiled/Direct parity (`tiled-direct-parity.js`) | Pass; max delta 0 across both tile sizes, denoise and seam checks included |
| Tiled film parity (`tiled-film-parity.js`) | Pass; max delta 0 across all fourteen cases |
| Adaptive denoise parity (`denoise-adaptive-parity.js`) | Pass; GPU within half-float allowance |
| GPU scope parity (`gpu-scope-parity.js`) | Pass after a harness fix (below); no page errors |
| Highlight compression parity (`gpu-highlight-compression-parity.js`) | Pass; measured/expected agree to ~1e-5 |
| SDR gamut GPU parity (`sdr-gamut-gpu-parity.js`) | Pass; maximum absolute error 1.2e-5 |
| ROI parity (`performance/roi-parity.js`) | Pass; max difference 0 over 49,896 compared pixels |
| ROI parity, Denoise variant (`--denoise`) | Pass after a test fix (below); max difference 0; resolve tiles 22 → 44 |
| Export parity (`performance/export-parity.js`) | Pass; all six scenarios export OK and preview agreement checks pass |

Reports were written to `codebase/output/performance/electron-*.json`.

Two harness issues surfaced and were fixed while running these:

- `run-in-electron.js` did not expose `browser.version()` on its launch stub, so `gpu-scope-parity.js`
  (and four other drivers) failed with `browser.version is not a function`. The stub now reports
  Electron's Chromium version.
- `roi-parity.js --denoise` asserted the wavelet analysis tile counters, but Adaptive is now the
  default denoise method and it dispatches no analysis tiles. The assertion is now algorithm-aware:
  the wavelet method keeps its original dispatch requirement, and the adaptive method requires its
  backend model call plus an installed cache. The algorithm version is also recorded in the summary.

The four parity suites already recorded above (B&W, clarity-map, grain, tiled denoise) were not
re-run; the harness changes are additive and do not touch those paths.

### 4. Preview smoothness baseline — recorded

Command held constant (PowerShell; one line):

```
$env:HDR_FINISHER_ELECTRON_WINDOW_SIZE='2560x1440'; node tests/run-in-electron.js tests/performance/headline-latency.js --suite release --output output/performance/electron-headline-latency-release.json
```

Configuration: dev-tree Electron host (the packaged §8 build was removed during cleanup, so the
dev tree is the held-constant host), 2560×1440 viewport, generated 7968×5320 noisy source, AC
power, NVIDIA Lovelace adapter, Electron 43.4.0 / Chromium 150.0.7871.224.

Release → settled medians (warm, 9 samples each): fit 3.9 ms, 100% 5.2 ms, 200% 4.5 ms, 400%
5.2 ms. With scope refresh: 16.0, 17.3, 17.6, and 17.3 ms. No failures.
Report: `codebase/output/performance/electron-headline-latency-release.json`.

