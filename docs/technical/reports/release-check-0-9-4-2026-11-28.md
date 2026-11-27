# Local v0.9.4 release check — November 28, 2026

**NOT READY — focused run failures are being classified and rechecked.**

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

## Earlier fast checks

The pre-run Node suites each passed 1,572 checks with one skip. Python at
`f161fd07` passed 5,188 checks with 126 skips and one unexpected pass.

**Failure fixed — test bookkeeping.** The Python frontend inventory still
expected 83 contract functions after `aab6d698` intentionally retired the old
Curves drag source assertion in favor of live pointer, keyboard and preview
coverage. The exact inventory now expects 82 functions, with the duplicate-name
check unchanged. Fix `f161fd07` passed the frontend contracts and the full fast
suites. No application output, pixel guard, or runtime limit changed.

