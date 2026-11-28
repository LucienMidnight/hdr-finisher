# Backend startup and test process ownership — Windows, 27 November 2026

## Findings

The desktop's fixed 30-second readiness deadline rejected a backend that was
still importing normally under load. Retained failure logs on this PC:

- `%TEMP%/hdr-finisher-electron-test-LEVoT8/logs/backend.log`: desktop startup
  failed at 33,352 ms; `colour` imported in 7,643 ms and `exporters` in 8,920 ms.
  Python continued importing `PIL` and `library_pictures` after that failure.
- `%TEMP%/hdr-finisher-electron-test-py4V86/logs/backend.log`: startup failed
  at 33,879 ms while `colour` imports were still progressing.
- These are nested inclusive import times, not additive timings. They establish
  ongoing startup work rather than a crash or a port collision.
- `08ea9623:codebase/desktop/main.js` contains the same 30-second deadline.
  No branch switch or old-commit executable reproduction was performed; this
  evidence does not attribute the problem to today's delivery or UI changes.

A second failure was reproduced during the new empty-app check: Playwright's
first window was the splash. Waiting for its HTTP navigation raised “Target
page, context or browser has been closed” when the splash closed, even though
that launch's backend became ready in 2,355 ms. Wait for the main window instead.

Cleanup handlers previously started after `_electron.launch()` resolved.
Connection failure before that point therefore left no owned process handle.
The regression test captures a launched child and grandchild, exits its harness
without any Playwright handle, and verifies both have exited.

An abrupt-desktop-exit regression also demonstrated that invoking `taskkill /T`
from inside the backend's own tree could leave a Python child alive. Windows
Job Object ownership now makes backend descendant cleanup a kernel operation.

## Changes

- Backend emits distinct startup progress before native imports and through
  import/lifespan phases. Desktop waits up to 90 seconds without new progress,
  with a five-minute absolute cap. Test mode uses 45 seconds idle/two minutes
  absolute. Repeated phase messages and arbitrary log noise do not reset it.
- The splash names the current phase on a slow launch. Failure logs include
  the last phase, elapsed/idle time, original exception and log path. Health
  requests have a ten-second bound. The backend's redundant 20-second lifespan
  deadline is removed; the desktop owns the startup deadline.
- A parent watchdog starts before OpenCV imports. Windows backend/descendants
  belong to a kill-on-close Job Object; POSIX desktop sidecars own a process
  group. Normal shutdown also stops the tree and clears Proof scratch.
- Test launchers capture OS process ownership synchronously at spawn, before
  awaiting DevTools, and verify cleanup at exit even on failed connection.
  Unverifiable cleanup fails the run. The standard driver's close attempts a
  bounded graceful quit before forcing/validating its owned tree.
- `HDR_FINISHER_TEST_MODE=1` suppresses native dialogs from the start. Unexpected
  dialogs log a failure and quit; the normal unsaved-change prompt discards
  disposable edits. Recognized disposable `test-` profiles also activate this
  guard for direct historical test launchers. Explicit test mode without a
  profile creates a fresh temporary one. Quick Library sets test mode too.
- User data is isolated per launch. Backend already binds an atomic OS-chosen
  loopback port; Playwright already chooses separate debug ports. No fixed port
  change or singleton-lock bypass is needed.
- Shutdown flushes the event log before exit; otherwise a fast failure could
  lose the diagnostic that explains it.

## Validation

Windows development app, Electron 43.4.0; protected user app PID 12888, started
08:43:53, remained running. GPU lock held for every real-app check.

- Final Job Object version: ten consecutive launch/health/graceful-quit cycles
  with two CPU-bound workers, all alongside the existing user app, passed.
  Whole cycles including OS process enumeration and cleanup: 8,145–9,334 ms.
  Every captured tree had zero survivors. Missing executable failed with exit 1
  in 2,376 ms, without any modal dismissal. Evidence:
  `codebase/output/startup-lifecycle-job/report.json`, `1.log` through `10.log`,
  and `missing-backend.log` (local output, not committed).
- Earlier ten-cycle check also passed before adding Job Object ownership.
- Final 90-second plain-Electron quick Library check passed (exit 0): 30/30
  viewport photos pictured, no errors, memory within its ceiling; evidence
  `codebase/output/quick-library-check/startup-fix-library/report.json`.
- Seven new behavioral Node tests cover progress extension, duplicate progress,
  process exit, absolute cap, no-dialog mode, pre-connection orphan cleanup and
  backend parent death before readiness. With the existing Proof-scratch test:
  eight passed. Timing allowances include process startup under CPU load.
- Focused Python launcher, diagnostics and desktop security checks: 15 passed.
- Full Node run during parallel inventory/catalogue work: 1,560 passed,
  one skipped, two failures: new `owned-electron-launch.cjs` helper unlisted and
  generated catalogue out of date. The manifest/inventory workers must register
  the helper and seven new tests, then regenerate the catalogue. No app assertion
  failed in that run.

Repeat startup checks from `codebase`:

```
.venv/Scripts/python.exe tools/gpu-run-lock.py --label startup-lifecycle --minutes 15 -- node tools/check-startup-lifecycle.cjs
node --test tests/backend-startup.test.js desktop/tests/backend-process.test.js
.venv/Scripts/python.exe -m pytest tests/test_launcher.py tests/test_diagnostics.py tests/test_desktop_security.py -q
```

Mac/Linux and packaged builds were not run. Job Object assignment is intentionally
required on Windows; failure produces a logged startup error instead of silently
running a backend whose descendants cannot be owned.


## Integration verification ? 27 November 2026

The earlier manifest/catalogue blockers are resolved. The owned-launch helper is
registered with real parent drivers; no schema extension or launch routing change
was needed. Inventory records seven backend-startup cases and four catalogue cases.
The release follow-up deadline test now uses a controlled clock. Generated timing
outputs are written after the tracked-input check, preserving that safety guard.

- Final full Node suite: 1,567 passed, one skipped (24.66 seconds).
- Full Python via tools/test-python.py: 5,246 passed, 56 skipped; 842.62 seconds
  total (parallel 769.12 seconds, serial 68.84 seconds). PowerShell redirection
  surfaced NativeCommandError from informational stderr despite both passing
  pytest summaries; no Python assertion failed.
- Film release runner: PASS, first attempt, 213.582 seconds, including exposure
  and stock/panel/presets UI follow-ups. The previous 225.657-second passing run
  exposed the runner-generated-output safety stop, fixed before this clean rerun.
- HSL release runner --all: PASS, first attempt, 824.339 seconds, neutral/global/local.
  Encoding-fidelity/decoded-pair diagnostics remain report-only, as before.
- Startup lifecycle: ten successful cycles, 7,713?8,014 ms each; missing-backend
  failure also passed; all eleven records have zero survivors.
- Quick Library: exit 0, 90-second viewport observation, 30/33 eligible pictured,
  no errors, peak 5.483 GB. QNY_8816.NEF, synthetic_24mp.hdr and
  synthetic_24mp.pfm were not pictured within the window; this is not full-folder
  coverage. No additional run or unrelated Library repair was performed.
- Protected project hashes stayed unchanged. No VRAM-corruption failure required
  retry. Steve's Electron PID 12888 (08:43:53 start) stayed running.

Evidence is local under codebase/output: full-node-final.log, full-python-final.log,
release-checks/2026-11-27T06-37-50-200Z-00005967ea40d76cc775,
release-checks/2026-11-27T06-43-50-456Z-f83b7f49c0185f6b7da7,
startup-lifecycle/report.json and quick-library-check/final-review-library/report.json.

Steve's subsequent timing-cutoff request is committed separately (eeba5df5):
current-platform complete-driver median, floor 30 seconds, multiplier 1.7 through
20 minutes and 1.25 above 20 minutes. Retries share the same derived policy;
timeout failures retain cutoff/baseline evidence. Unmeasured drivers retain the
old rules. The next-Mac checklist records tuning after the full release run.
