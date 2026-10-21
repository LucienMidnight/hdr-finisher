# Phase 5 — Supported hardware matrix

The sprint's Phase 5 exit gates require hardware results to be recorded per class
(discrete, integrated/unified, CPU-only), with unsupported configurations disclosed
rather than inferred. This file is the matrix contract and its log.

## How to run a row (one machine)

1. Start the dev server from `codebase/backend`:
   `$env:HDR_FINISHER_PORT='8799'; & '..\.venv\Scripts\python.exe' -m hdr_finisher.main`
2. From `codebase`, capture the row:
   `node tests/performance/hardware-matrix-capture.js --machine "<name>" --class discrete|integrated|unified|cpu-only`
   (`--width/--height` default to the 4200 × 2800 workflow; the 42 MP fixture is the sprint reference and
   takes longer. On macOS pass `--channel chrome` or the browser channel installed there. On a hybrid
   machine, `--gpu low-power` pins the integrated adapter and `--gpu high-performance` the discrete one;
   the class still comes from the operator, and the captured adapter identity is recorded as measured.)
3. Merge the captured rows:
   `node tests/performance/hardware-matrix-summary.js`
   Paste the printed table into the log below.

The capture writes `output/performance/hardware/<machine>.json` (gitignored, like the rest of
`output/`). Nothing in the summary is inferred: an uncaptured machine is absent, and a failed capture
prints its recorded error instead of a status.

## What a row measures, and what the operator reports

Measured by the capture, from the machine itself:

- `webgpu`: whether a WebGPU device initialized at all;
- `adapter`: vendor / architecture / device as reported by the adapter (empty fields stay "unknown");
- `software`: the adapter's own `isFallbackAdapter` flag or a software-rasterizer description;
- `auto budget` / `calibration`: the calibrated Auto value and its source (`policy-fallback`,
  `software-adapter`, `limited-device`, `probe-downgrade`, `probe-floor`, `unavailable`) plus the probe
  bytes and outcome;
- `native-100 exact` / `warm-50 exact`: wall time for the whole-frame arrival and the warm re-entry at
  the 4200 px fixture;
- `peak drift`: the worst difference between the renderer's logical peak and the instrumented live
  device allocations, using the same device wrapper as `phase5-peak-agreement.js`;
- `cpu fallback`: when WebGPU is absent, the authoritative CPU preview path (transport, `/preview-raw`
  responses, canvas);
- `status`: `captured`, `captured-cpu-only`, or `capture-failed: <error>`.

Reported by the operator, never inferred: the `class` column. A machine whose GPU the operator cannot
classify is recorded as `unclassified` and treated as untested for support statements.

## Disclosure policy

- A machine with a working hardware WebGPU adapter is a supported configuration for the measured
  workflow; the row records what it measured.
- A machine whose adapter reports a software fallback runs, but the UI already states that
  HDR presentation is not authoritative; the row records `software: yes` and the reason.
- A machine with no WebGPU adapter is supported through the authoritative CPU preview; the capture
  exercises that path (`captured-cpu-only`) rather than failing.
- A class with no captured row is **untested**, and is reported as untested — not as supported, not as
  unsupported. No adapter-string heuristic ever upgrades or downgrades a class.

## Physical VRAM

The matrix never records physical VRAM: WebGPU does not report it, so the `auto budget` column is an
application allocation budget with its source, calibrated by `frontend/gpu-budget.js` (Phase 5 item 2).

## Log

| machine | class | webgpu | adapter | software | auto budget | calibration | native-100 exact | warm-50 exact | peak drift | cpu fallback | status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| workstation-nvidia | discrete | yes | nvidia / lovelace / unknown | no | 2.00 GiB | policy-fallback | 435 ms | 95 ms | 0.0% | not exercised | captured |
| workstation-amd-igpu | integrated | yes | amd / rdna-2 / unknown | no | 2.00 GiB | policy-fallback | 569 ms | 95 ms | 0.0% | not exercised | captured |
| CPU-only row | cpu-only | — | — | — | — | — | — | — | — | — | untested — owner run pending |
| packaged Electron baseline | discrete (packaged app) | yes | nvidia / lovelace / unknown | no | 2.00 GiB | policy-fallback | 1035 ms (100%) | 210 ms (warm 200%) | 0.0% | not exercised | captured 2026-09-24 |

The packaged Electron baseline row records `tests/performance/packaged-baselines.js` run through
`tests/run-in-electron.js --packaged` against `dist-electron/win-unpacked` (0.8.12, Chrome 150.0.7871.224,
Electron 43.4.0) at the §8 reference viewport of 2560 × 1440: Fit 57 ms to current pixels / 200 ms to
stable, 100% 1035 ms to native, 200% 210 ms warm, 400% 245 ms warm, pan painted (luma 0.81), zero page
errors, AC power (`output/performance/phase5-packaged-baselines-42mp.json`). Those are the driver's
wall-clock numbers; the §8 input-to-compositor headline numbers are
`output/performance/phase5-headline-latency-packaged.json` and are reported in the sprint ledger.

The integrated row was captured on the integrated AMD adapter of the hybrid workstation (the operator
reported the class; the browser was pinned with `--gpu low-power`, and the captured adapter identity is
`amd / rdna-2`, not inferred from the switch). It is an adapter-class row, not a second machine: the
workstation's discrete NVIDIA adapter is the row above it.

The adverse 4K-display-on-integrated case from §8.4 is **untested**: this workstation's display is
2560 × 1440 (QHD), so no 4K panel was available for it. The CPU-only row is **untested**: no CPU-only
machine was available to the owner, and no class is inferred from a forced software mode on a machine
that has working hardware adapters. A machine with no WebGPU adapter is still supported through the
authoritative CPU preview and is captured as `captured-cpu-only` when such a machine is available.
