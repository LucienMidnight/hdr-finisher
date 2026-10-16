# Release checks

From `codebase`:

```powershell
npm run test:release -- --release --plan
npm run test:release -- --release
```

A release selects core plus regression drivers for areas changed since the
latest reachable `v*` tag. It compares that tag with committed HEAD, reports
unmapped files and conservatively includes every feature area for unmapped
application code. Source rules live in `drivers.json`; overlapping rules add
coverage. Shared render/shader/backend code intentionally selects all areas.
Documentation and test tooling do not select application feature areas.

The fast Node and virtual-environment Python suites remain separate and must
still run as specified in AGENTS.md. This command runs the slow drivers only.
No push, tag, packaging or installer command is performed.

## Other selections

```powershell
npm run test:release -- --area library --plan
npm run test:release -- --tier core --plan
npm run test:release -- --tier full --plan
npm run test:release -- --full --plan
npm run test:release -- --driver tests/startup-state.js --plan
```

Remove `--plan` to run. `--full` includes core, area and full checks; diagnostic
entries are excluded even from a full sweep. A diagnostic must be requested
individually with `--driver`. Diagnostic entries with manual prerequisites
print those requirements and refuse to pretend they ran. A named area selects
its core and area checks; request full separately for broad coverage. A helper
selection runs its listed parent, and is never counted as a standalone pass.

`--plan` launches nothing and writes nothing. It prints actual command arguments,
follow-up invocations and timings from history. Missing history is explicit;
there is no guessed allowance. Estimates reserve one retry for drivers whose
latest timed result failed. A restricted single-case historical invocation is
not used to estimate an entire matrix. Historical timings can predate driver
changes; they are estimates, never proof that today's code passed.

## Safety, interruption and results

Commit tracked-file changes before a real run. Untracked briefs are allowed.
Each run records HEAD and SHA-256 hashes for the same three protected projects
used by the 0.9.0 sweep. Hashes are checked on resume, after every driver and at
the end; a mismatch stops work without restoring or writing the projects. A
revision change also stops the run. Drivers run sequentially with
`HDR_FINISHER_ELECTRON_WINDOW_SIZE=2560x1440`; a global lock prevents two runner
selections from overlapping. The shared Electron launcher supports standalone
main entry points and the desktop Playwright browser branch without adapters.
Native drivers keep their existing separate launcher and disposable profiles.

Press Ctrl+C to interrupt; rerun the same selection at the same HEAD to resume.
Completed drivers are retained, including final failed results. An interrupted
attempt is logged and retried on resume, rather than marked failed. A stale
lock is reclaimed only when its runner and recorded child have both exited;
otherwise the runner reports the owned PID and waits for that run to end.
Use `--fresh` to deliberately start a new run instead of returning existing
results. An optional `--stop-after 1` stops cleanly after one driver to verify
resume. `--limit-minutes 15` imposes a stricter cap; it cannot enlarge policy
limits. Use the same reduced cap when resuming a capped validation.

Estimates above 30 minutes stop non-release selections before launch; release
checks stop above 75 minutes. Actual elapsed test time, including resumed work,
is capped at 30 or 75 minutes respectively. Full sweeps have no automatic time
cap and run only when Steve explicitly asks. The elapsed cap stops an owned
process tree even if its driver stalls. The 45-minute release and 15-minute core
times are targets, not permission to remove checks or relax guarantees.

`output/release-checks/<timestamp>-<key>/` contains a saved plan, state, one log
per attempt, fixture hashes and `summary.txt`/`summary.json`. Exit 0 means pass
(including clearly labeled flaky checks), 1 means a failure/safety stop, and
130 means interrupted or unfinished. Known failures still produce NOT READY.
`output/release-checks/history.jsonl` appends durations, results, revision and
log paths from every attempt, including interrupted attempts. Completed failures
get exactly one retry. Flaky means the retry passed; known requires the same
committed message signature on both attempts; every other failure is new.

The runner also reads the ignored 0.9.0 and 0.9.1 results when present, as timing
evidence only. A fresh checkout without that output honestly reports no history.
The inventory never contains hand-entered durations. Preserve output/history
if moving checkouts and wanting to preserve estimates.

## Add a driver

Add one entry to `drivers.json` with its path, purpose, area(s), tier and launch.
Areas: export-proof, film, lens, library, masks, detail, geometry, preview, ui.
Core runs every release; area runs when its feature changed; full runs only on
explicit full requests; diagnostic is never selected automatically. Choose the
less frequent tier when uncertain and explain it in the entry's note.

Launch methods are electron, native, packaged, node, python, powershell or
helper. `args` are passed unchanged; `{output}`, `{root}`, `{project}` and
`{electron}` are expanded by the runner without a shell. `env` supplies only
explicit per-driver inputs. `followupArgs` runs additional supported modes of
the same driver, keeping every failure and one combined attempt log. The Film
entry runs the complete parity matrix, then its character/presets/panel UI mode.
Helpers name parent entries in `via`. A required manual input is documented in
`requires`; the runner will not launch such an entry until its invocation is
made concrete. Never point a fixture builder's output at protected projects.

The fast inventory test scans immediate JS/CJS/MJS drivers and standalone
Python/PowerShell tools in tests/, tests/performance/ and desktop/tests/. Normal
*.test.js and test_*.py fast tests are outside the slow inventory, apart from
the two explicitly invoked core parameter/pass layout tests. Python conftest
and frontend-source support are fast-suite helpers, not standalone drivers.
Test tooling implementation lives under tests/release/ and is not a driver.
The test fails for an unlisted driver, missing listed file or duplicate entry.

## Known failures

Add a `known-failures.json` entry only for an already documented unresolved
failure. Include its driver, exact stable error message(s), documentation source
and original log evidence. All messages must occur in both failed attempts.
Keep numeric error details exact when they identify the recorded failure; do
not match a broad word like `Timeout` or a driver name alone. Different output
from the same driver is new. Entries seeded here are the ten unresolved
0.9.1 messages in docs/known-limitations.md; fixed entries may simply pass.
This file classifies results and never suppresses failures or changes guards.

## Conservative classifications to review

These remain diagnostic because their current purpose is broad measurement or
visual investigation rather than a defined automatic gate:

- tests/editing-peak-bounded.js: bounded-peak measurement probe.
- tests/local-stack-sizing.js: panel-size capture across local stacks.
- tests/css-app-shell-matrix.js: capture/compare shell matrix.
- tests/performance/editing-peak-clarity-reference.js: targeted historical peak investigation.
- tests/performance/many-local-layers.js: measured many-layer workload.

Retired-recipe candidates, retained without repair or deletion:

- tests/full-tier-brush-feather.js: still sets removed Bloom enable/amount.
- tests/performance/fit-filtering-ab.js: Bloom amount A/B recipe.
- tests/performance/roi-parity.js: spatial sweep sets removed Bloom amount.
- tests/performance/heavy-project-control-sweep.js: inventories removed Bloom controls.
- tests/performance/phase3-coverage-audit.js: coverage includes removed Bloom controls.

Real-project full-size Proof/export identity remains available in the full tier;
synthetic exact identity continues in the required fast Python suite. This
classification does not waive AGENTS.md's Still strict rule: if export/Proof
or pinned numerical contracts change, every check covering that change is
required, and its time estimate must be reviewed before starting.

## Tooling validation (October 16, 2026)

At revision `c9a696f`, the fast checks passed: 516 Node tests and 2,204 Python
tests, with three Python skips. All five plan selections were checked. One
core run was deliberately stopped after its first completed driver, then resumed
at the same revision: 12 passed, one new failure, none unfinished, 10.9 minutes
including the automatic retry. All three protected hashes stayed unchanged.
The preview/export comparison failed its peak verdict on both attempts; paired
pixels, tone and masks passed. No application or driver repair was attempted.

Evidence is in ignored `codebase/output/release-checks/2026-10-16T16-24-55-193Z-29cde84e1a59b2272a4f/`.
The current release plan compares with `v0.9.1`, selects only 13 core checks and
estimates 10.8 minutes entirely from history, including a retry allowance.
This is a plan, not a release certification. Release/full sweeps were not run.
