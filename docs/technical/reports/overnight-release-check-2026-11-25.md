# Overnight release check and test fixes — November 25, 2026

Steve asked for an unattended run of the long tests before tomorrow's release,
with every test fixed that needed fixing and every issue logged. This is that
log. Machine: MacBook Neo (A18 Pro, 8 GB), 1408x794 window, branch
`feat/watermark-and-library-polish`.

## What ran

- Fast checks: Node 1108 pass, Python 3895 pass (before and after the fixes).
- Focused release check at `0f64b37f`: 117 drivers, 119.6 minutes of test
  time. **97 passed, 20 failed.** Run folder:
  `codebase/output/release-checks/2026-11-25T15-01-15-425Z-aba82431f3ce8c9999c5`.
- Every failure was traced and re-checked on the GPU at the final commit
  (`321dac3c`). Nothing was pushed.

## Result per failure

### Fixed: the test was out of date (11)

| Driver | Cause | Commit |
| --- | --- | --- |
| `desktop/tests/electron-smoke.js` | Mac shortcut note now uses ⌃/⇧ (b8e150d4) | `89f499df` |
| `desktop/tests/overlay-feedback.js` | Tooltip layer moves `title` into `data-native-tooltip` (66d744cf) | `89f499df` |
| `tests/denoise-adaptive-parity.js` | Test read `.buffer` of a plain array, so the readback was always empty. **This was listed as a known Mac GPU failure; it was only a test bug.** | `89f499df` |
| `tests/film-stock-parity.js` (UI follow-up) | Same tooltip change; the Film stage counts were right in the app | `e32027f7` |
| `tests/path-mask-interaction.js` | Local Tone Midtones Width (449a71ed) also defaults to 4; selector matched two sliders | `9cfd0db7` |
| `tests/retouch-library-gpu.js` | Refused uploads were stale work for other photos, cancelled by the driver's own cache clear (confirmed on re-run) | `831a1c63` |
| `tests/overlay-backlog.js` | Backend keeps the newest request to arrive, not the newest sent; test now checks that the shown overlay is current | `831a1c63` |
| `tests/library-precision-source.js` (1) | Faked preemption on the 15th GPU request, which a fast Mac never reaches; now deterministic and also proves requeue and re-admission | `ce7223b2` |
| `tests/library-precision-source.js` (2) | Compare helper read a ProPhoto float TIFF differently from the Library's assumed reading | `321dac3c` |
| `tests/film-stock-parity.js` (main) | Accepted "extreme HDR preview range" failure; only the PC's exact message was recorded. Mac message added; now reported as known | `85332375` |
| `tests/library-export-live-tiles.js` (cleanup) | Left an exported JPEG on every run (2.2 GB deleted); now deletes its own exports | `ea1e4124` |

### Fixed: real app difference (1)

- **Library 100% view sat 0.1–0.2 px lower than export** on lens-corrected
  photos. Grade asks Lensfun for the whole frame in one call, and Lensfun's row
  positions drift slightly down the frame; the Library asked row by row. Not
  visible by eye, but it failed `library-gpu-raw-single.js`. Fixed in
  `65da0dd0` (the Library now uses Grade's row positions; about 9 ms more
  preparation). All comparisons pass; `library-gpu-raw.js` passes too.

### Decision needed from Steve (1)

- **Large native Library exports use the CPU at the 4 GB memory default.**
  `library-export-live-tiles.js` expects the GPU. Since `005c3610` (Nov 16), a
  native export whose GPU working set does not fit the app memory ceiling uses
  CPU strips: a 42 MP RAW needs 4.03 GB of GPU work plus 1.3 GB starting
  memory against 4.00 GB. Every native export above about 27 MP takes this
  route at the default. Speed looks similar (GPU about 34–35 s per photo on
  Nov 14; the CPU-strip attempt finished in under about 44 s including app
  launch). Recommended: accept it. A test update is ready but not applied:
  `docs/technical/reports/overnight-release-check-2026-11-25-export-cpu-strips.diff`
  (apply with `git apply` from the `ai` root).
  `docs/known-limitations.md` line 110 ("all GPU including Sony") is stale
  until this is decided.

### Intermittent: did not reproduce (1)

- `tests/denoise-zoomed-region.js` hung for 15 minutes on both release
  attempts, then passed four times in a row in about 18 s. The Mac display
  turned off five minutes into the first hang, but the test also passed with
  the display off. The driver now logs every wait condition each minute and
  fails fast if the viewer shows Unavailable (`831a1c63`), so a repeat will
  name the cause. Suspect: the preview watchdog change in d26ed3ed, which
  stays idle while a frame waits for the display.

### Known, still open (unchanged from 0.9.3) (7)

| Driver | Issue |
| --- | --- |
| `tests/retouch-gpu-kernels.js` | Bounded job differs from whole-photo GPU input |
| `tests/performance/retouch-latency.js` | Spot removal over 1 s at Fit (see timings) |
| `tests/library-grade-saving.js` | Escape does not close the unsaved-changes dialog while Metadata is open |
| `tests/library-live-grid.js` | 120 s live-drawing wait times out |
| `desktop/tests/proof-grade-diagnostic.js`, `tests/performance/preview-export-compare.js` | DSC00950 project still names its Windows source. **The core preview-vs-export check cannot run on the Mac until Steve supplies the source link.** |
| `tests/gpu-denoise-measurement.js` | Needs a noise-free linear EXR (≥540x540) from Steve |
| `tests/grade-dng.js`, `tests/jxl-source-colour.js` | Need Microsoft Edge / the Windows-only JPEG XL helper |

## App bug found by reading code (not fixed)

- If the backend refuses a whole-frame source load for memory (HTTP 507), the
  preview treats it as "superseded": no CPU fallback and no message. After 20
  watchdog retries the viewer shows "Preparing…" for good.
  `frontend/source-transport.js:127-137, 662-663` →
  `frontend/preview-pipeline.js:815`. Predates 0.9.3. It should be classed as a
  memory failure in `frontend/render-failure.js`. Left for a reviewed change,
  not an overnight fix.

## Timings worth Steve's attention (performance before 1.0)

Recorded in `docs/technical/performance-table.md`, "November 25".

- **Opening a 42 MP Sony RAW in Grade: 13.4 s (GPU) / 15.6 s (CPU) to the first
  picture.** Over the 10-second wish. A Canon CR2 takes 4.4 s.
- **DNG on the CPU route: up to 59 s, almost all decode** (DJI DNG 56.5 s
  decode; GPU route 4.7 s). Only when the GPU route falls back.
- **Retouch spot removal: 0.9–2.4 s**, worst at Fit, against a 1 s target.
- Export: 12–36 s per Ultra HDR JPEG on the GPU, 16–45 s on the CPU.
- Library RAW development is fine: 1.4–1.7 s cold, 2.5–2.9 s at 100%.

## Test-suite cost

Slowest drivers: `denoise-zoomed-region` 30 min (two hangs; 18 s when well),
`film-stock-parity` 17 min (two attempts), `hsl-selection-delivery` 12 min
(its `--local` follow-up repeats the identical neutral case, about 3 minutes
that could be saved), `library-gpu-raw-single` 5 min.

## Smaller follow-ups

- `tests/library-rgb-source.js:95` uses the same "15th request" preemption
  trick that failed on the Mac; it passes today only by request count.
- `tests/overlay-backlog.js` passed, but the app's own overlay loop sent two
  newer requests during the burst, so "the newest test request wins" was not
  exercised in that run.
- A ProPhoto or untagged float TIFF shows differently in Library (assumed
  linear Rec.709) and Grade (asks; sRGB curve until chosen), as decided on
  November 2. Whether Grade should start from the Library's assumption is a
  product choice.

## Follow-up fixes — November 26

Codex Sol 6.2 (high) workers in the shared checkout; each re-checked on the
GPU at the final commit `c3352376` on a quiet Mac. Fast checks: Node 1121
pass, Python 3900 pass.

| Item | Result | Commits |
| --- | --- | --- |
| Endless "Preparing…" after a 507 memory refusal | App fixed: CPU preview fallback, then Unavailable with reason | `a36e38eb` |
| `library-live-grid.js` | Test counted shared-folder photos; app no longer delays CPU fallback behind a deferred save. Passes | `38f56307` |
| `denoise-zoomed-region.js` hang | App fixed: geometry-map no longer refused by a full-image memory check (only exact quarter turns keep it). Driver now fails before the runner deadline and names the unmet condition. One later refusal was real macOS memory pressure (0.98–1.29 GiB free vs 2 GiB reserve); proposal recorded | `6209e7cc`, `c3352376` |
| `library-grade-saving.js` (Escape with Metadata) | App fixed: dialogs get Escape first; Metadata stays open. Passes | `6aa509d3` |
| CPU DNG speed | Gain map and warp now multi-threaded, output byte-identical. DJI_0071 59.1 → 12.0–13.9 s; Leica X2 48.8 → 3.7–3.9 s | `9c5791a6` |
| Retouch spot deletion (`retouch-latency.js`) | App fixed: deletion refreshes only the changed area and reuses the Fit image. 0.19–0.51 s (was 0.9–2.4 s) | `2d4cb0df`, `f21d39f6`, `03cdc314`, `77406592` |
| `retouch-gpu-kernels.js` | Test compared against a different shader; now uses the production shader. Bit-identical | `d9b35d32` |
| `library-dng-warp.js` | Test stopped watching Activity when the embedded preview filled the grid; now watches real development | `1d377cd0` |
| `full-tier-preview.js` | Test race; app peak behaviour unchanged | `b355c427` |

Note: the November 24 "Heal and Clone on the CPU" change is only on
`feat/denoise-v1` (merge `07e55dd5`), not on this release branch.

Still waiting on files from the PC: DSC00950 source link, a noise-free EXR,
Edge and the JPEG XL helper (see the table above).

## Denoise merge — November 26

`feat/denoise-v1` merged at `2fc09428` (conflict choices in that commit message).
Full release run after the first merge fixes (`74286a54`): 101 passed, 2 flaky,
20 failed. Fixed and re-checked on the Mac since: Library native/recovery
timeouts (4 drivers), Library stage A, overlay backlog, zoomed Denoise source
region, linear DNG memory, GPU export handoff (HSL, ceiling), signed EXR Denoise
measurement, local adjustments, Retouch CPU fallback. Steve skipped a second full
release run; fast checks only before merging to `main`.

Still open after the merge:
- `tests/gpu-delivery-repeat.js`: a later repeated GPU export is refused with
  0.09 GiB safely available and falls back to CPU. Possibly memory not
  released between exports. Needs a look.
- `tests/menu-shortcuts.js`: dialog shortcut step fails; an unverified driver
  fix hung for 25 minutes and was not committed
  (`ai-handoff-2026-11-26/unverified-menu-shortcuts.diff`).
- `tests/film-stock-parity.js`: the accepted paper-gain difference is matched,
  but the `--presets-ui` follow-up has a separate error; an untested fix is in
  `ai-handoff-2026-11-26/unverified-film-presets-ui-check.diff`.
- `tests/test_denoise_native_model.py::test_fixed_calibration_matches_the_seeded_white_noise_measurement`
  fails by ~6e-7 (also on `feat/denoise-v1` alone); tolerance not changed.
- Native helpers changed: run setup after pulling on the PC.

## PC follow-up - November 26 (fix/overnight-report-followups)

Repeated delivery: the PC did not reproduce the Mac's refusal before the fix.
Both pre-change exports and both post-change exports admitted the GPU at 3 GiB
then 2 GiB test caps. HDR and SDR finished pixels matched exactly; each full-size
Proof was byte-identical to its delivered JPEG; encoded peaks passed the existing
1% allowance. A real cleanup race was found: the next job cancelled the hidden
renderer's 250 ms idle collection timer. Collection is now acknowledged and
bounded by the existing one-second collection deadline before the next job can
start. No memory default, GPU allowance, shader or CPU-strip policy changed.
The Mac refusal needs a repeat on the Mac; the PC result cannot certify that
machine's free memory.

Checks: delivery acknowledgement/pressure Node checks 16 pass; Python broker
38 pass; gpu-delivery-repeat passes before and after the fix, sequentially at
2560x1440. Logs: codebase/output/overnight-repeat.log,
overnight-repeat-fixed.log and overnight-broker-tests.log. Steve's already-open
Electron app was left running; only launcher-owned test apps were stopped.
