# Local v0.9.4 release check — November 28, 2026

**Needs Steve — local release qualification is incomplete.** The focused plan
selected 125 drivers and estimates 109.1 minutes against the approved 75-minute
cap. That includes 33.9 minutes for possible retries and excludes three drivers
with no timing history: `vignette-midpoint.js`, `grain-large-photo-parity.js`
and `scope-readout-layout.js`. The plan stopped before launch. No drivers
were removed and no limit was changed. A longer approved window is needed to
run the focused selection, including the export and Proof checks.

MacBook Neo (A18 Pro, 8 GB), 1408×794 planned window. Started from clean
`main` at `e314814b`, matching `origin/main`. The latest release tag and local
package version were both v0.9.3. The final fast checks and release plan used
`f161fd07`.

| Check | Passed | Failed | Other | Runtime |
| --- | ---: | ---: | --- | ---: |
| Node, initial and final (each) | 1,572 | 0 | 1 skipped | 31.6 s / 33.2 s |
| Python, initial | 5,187 | 1 | 126 skipped, 1 unexpected pass | 6 min 1 s |
| Python, frontend contracts after fix | 83 | 0 | — | 1.4 s |
| Python, final | 5,188 | 0 | 126 skipped, 1 unexpected pass | 5 min 47 s |
| Focused release drivers | 0 | 0 | 125 not run | 0 min |

**Failure fixed — test bookkeeping.** The Python frontend inventory still
expected 83 contract functions after `aab6d698` intentionally retired the old
Curves drag source assertion in favor of live pointer, keyboard and preview
coverage. The exact inventory now expects 82 functions, with the duplicate-name
check unchanged. Fix `f161fd07` passed the frontend contracts and the full fast
suites. No application output, pixel guard, or runtime limit changed.

Total elapsed time from the first fast check through the final check was
11 min 56 s, including concurrent Node/Python time and planning. Scratch
output was 18.2 GB before and after. No GPU processes were launched and no
protected projects were written. Local evidence is in
`codebase/output/release-checks/v0.9.4-local/`.
