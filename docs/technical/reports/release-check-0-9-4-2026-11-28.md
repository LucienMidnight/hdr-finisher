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

## Earlier fast checks

The pre-run Node suites each passed 1,572 checks with one skip. Python at
`f161fd07` passed 5,188 checks with 126 skips and one unexpected pass.

**Failure fixed — test bookkeeping.** The Python frontend inventory still
expected 83 contract functions after `aab6d698` intentionally retired the old
Curves drag source assertion in favor of live pointer, keyboard and preview
coverage. The exact inventory now expects 82 functions, with the duplicate-name
check unchanged. Fix `f161fd07` passed the frontend contracts and the full fast
suites. No application output, pixel guard, or runtime limit changed.

