# Local v0.9.4 release check — November 28, 2026

**READY — all 14 actionable Mac rechecks passed. Two pre-existing platform prerequisites remain.**

The approved run attempted all 125 focused drivers at `c97690cc` in 65.8
minutes on the MacBook Neo (A18 Pro, 8 GB, 1408×794). It recorded **109
passed, 1 flaky, 12 new failures and 3 timeouts**. The prior plan-only blocker
is superseded. The current branch started at `2688a3a4`, 10 commits ahead of
`origin/main` and not behind. The package and latest remote tag were both
0.9.3. The release run and its timing history are separate from installer
build verification.

- Original evidence: `codebase/output/release-checks/2026-11-27T18-17-37-541Z-5bfef6e72a6695b41926/`
- Individual rerun logs: `codebase/output/release-checks/v0.9.4-local/`
- Scratch at start: 19.8 GB against the 100 GB limit.

## Driver outcomes

Classes are (a) release regression, (b) known/pre-existing, and (c) test or
fixture issue. A pass after an earlier timeout is recorded explicitly.

- `tests/grade-dng.js` — (b) standalone browser needs Microsoft Edge, absent on this Mac. Both release attempts show that exact error, as recorded in AGENTS.md item 7 and the 0.9.3 Mac check. Not a DNG pixel pass.
- `tests/jxl-source-colour.js` — (b) native colour oracle remains Windows-only (AGENTS.md item 7). Both attempts fail with `KeyError: 'data_color_encoding'`, the existing 0.9.3 signature. Not a JPEG XL colour pass.
- `tests/gpu-delivery-repeat.js` — (b) intermittent host-memory refusal, already seen November 26. Standalone replay passes unchanged at both 3 and 2 GiB caps with exact finished pixels and byte-identical Proof. Mac headroom reader/reserve are unchanged from the tag. No evidence of memory left behind between these two exports; no budget changed.
- `tests/gpu-delivery-ceiling.js` — (b) same measured host-headroom refusal as repeat in the focused run. Standalone at the starting revision passes GPU and forced CPU, both decoded peaks 1008.578 nits under the existing 1010 allowance and both full Proofs byte-identical. No memory or pixel guard changed.
- `tests/grade-panel-order.js` — (c) the new SDR section Match action intentionally precedes fixed Peak (`2d1251ef`); both lanes, ordering, fold state and exact GPU pixels pass in `grade-panel-order.log`.
- `tests/ui-picker-help-selects.js` — (c) local Hue softness intentionally has help (`400eb1e4`, renamed in `eed89fea`); the live tooltip, picker and select checks pass in `ui-picker-help-selects.log`.
- `tests/library-gpu-raw-single.js` — (c) Playwright disposed the app handle before the launcher read its PID, skipping the offline comparison. Cache the owned launch identity while live. Full locked three-photo native handoff, memory checks, post-quit Grade comparisons and no surviving app pass in `library-gpu-raw-single.log`.
- `tests/sdr-linked-interaction.js` — (c) whole Match intentionally returns editable independent SDR since `b9098170` and `2d1251ef`. A disposable linked grade retains live HDR edits, global/local unlink, history and consent coverage. Locked HDR/SDR finished GPU/CPU parity and reduced/full Proof byte identity pass in `sdr-linked-interaction.log`.
- `desktop/tests/proof-grade-diagnostic.js` — (c) test supplied a source-open grant to a source-relink operation. Use the real relink action with a one-use picker fixture. AVIF and Ultra HDR JPEG Proof both pass in `proof-grade-diagnostic-relink.log`.
- `tests/overlay-backlog.js` — (c) the runner used a 30 s deadline for a driver with a required 30 s drag. Full standalone passes, including the 39 superseded requests, current overlay, Library pixels during the drag, recovery and unchanged growth guard (`overlay-backlog.log`).
- `tests/library-precision-source.js` — (c) 30 s ended the precision matrix after GPU preemption, before the six CPU/GPU timing pairs and comparisons. Full standalone passes, including exact preemption/re-admission coverage. This is not the old native-admission error in 0.9.3 (`library-precision-source.log`).
- `tests/gpu-denoise-measurement.js` — (c) the old missing-EXR setup errors seeded a 30 s deadline. The retired EXR is not required. Full standalone passes the remaining corpus and 42 MP GPU case with unchanged finished-pixel and ceiling guards, including the post-fix rerun in `gpu-denoise-measurement-final.log`.
- `tests/library-export-live-tiles.js` — (c) all three previous Sony fixtures exceeded the intentional native 4 GB CPU-strip cutover (`d1556e87`). Replace one with a curated 10.5 MP Sony RAW. Both delivery routes, seven exports, no progress redraws and the unchanged 5% timing check pass in `library-export-live-tiles.log`.
- `tests/performance/preview-export-compare.js` — (c) relink repaired in `02a05544`; old capture compared a zoomed GPU detail target to the soft base canvas. Capture the visible detail using exact full-frame coordinates. Enforced HDR/SDR, all six viewports, masks and tone gates pass without changing pixel limits or the project (`preview-export-compare-viewport.json`).
- `tests/photo-library-stage-b.js` — (b), fixed. The v0.9.3 Details redraw also cancelled the pending suggestion lookup while preserving the input. The current failure reproduced at the same locator as November 26. Deterministic redraw during debounce now passes with exact suggestion count, keyboard choice and disk persistence (`photo-library-stage-b-redraw.log`).
- `tests/library-precision-rendition.js` — (a), fixed. v0.9.3 passes (BT.709 HDR p99.9 0.210); 0.9.4 reproduced 3.261. Denoise was measuring half-float rounding as noise. With a safely admitted float32 measurement at reduced Library tiers, the unchanged full matrix passes at 0.170, below 3.0. Grade, export, Proof and display transport are unchanged. Targeted Python 16 pass (`library-precision-rendition-float32.log`, `test-denoise-precision.log`).


## Final verification

- All 14 rechecked drivers passed independently under the shared GPU lock.
  Grade DNG (Edge required) and JPEG XL colour-oracle coverage remain the two
  documented platform gaps. No known-failure waiver was added.
- Node full run: 1,572 passed, one skip, and one stale tooltip source-link
  check. The full three-test tooltip file passed after regenerating only its
  two source-link rows in `656bcdd0`. The timing/catalogue file passed 5/5
  after the last data update. The full suite was run once.
- Python full serial run: 5,189 passed, 126 skipped and one existing
  unexpected pass in 5 min 57 s. Logs are `node-affected-final.log` and
  `pytest-affected-final.log`; the focused sync results are in
  `tooltip-catalogue-recheck.log` and `test-catalogue-final.log`.
- All three protected SHA-256 hashes match the original release run. The tag
  comparison worktree and large readback scratch were removed. Final scratch
  was 19.9 GB, below the 100 GB limit.
- This is the original focused run plus individual rechecks, not a new
  125-driver sweep or a recognition of installer checks at this revision.
  No push, tag, version bump, workflow or installer build was performed.

## Earlier fast checks

The pre-run Node suites each passed 1,572 checks with one skip. Python at
`f161fd07` passed 5,188 checks with 126 skips and one unexpected pass.

**Failure fixed — test bookkeeping.** The Python frontend inventory still
expected 83 contract functions after `aab6d698` intentionally retired the old
Curves drag source assertion in favor of live pointer, keyboard and preview
coverage. The exact inventory now expects 82 functions, with the duplicate-name
check unchanged. Fix `f161fd07` passed the frontend contracts and the full fast
suites. No application output, pixel guard, or runtime limit changed.
