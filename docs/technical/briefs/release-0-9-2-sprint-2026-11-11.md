# Sprint brief: release 0.9.2 (bug hunt, cleanup, Grade performance)

**Date:** November 11, 2026. **Coordinator:** Claude (architect, merges and
reviews every branch). **Workers:** Codex agents (gpt-6.1-sol).
**Owner:** Steve. **Target:** v0.9.2 on GitHub today.

`AGENTS.md` (in the `ai` root) applies to every workstream. Where this brief
asks for something AGENTS.md does not cover, the reason is given.

## Goal

Ship 0.9.2 from current `main` (792 commits since v0.9.1) after:

1. a bug hunt and code audit, with suspected bugs fixed;
2. old, unused code removed and code simplified where that is safe;
3. a repository cleanup (nothing is permanently deleted: archive it, or
   send it to the Recycle Bin);
4. documents brought up to date with what is built;
5. a performance review of every Grade control, with timings recorded and
   anything over one second, or anything that slows other actions
   significantly, fixed before release;
6. all tests passing (fast suites plus the focused release check).

## Steve's decisions for this sprint (November 11, 2026)

- Release checks for this release are approved up to **two hours** (the
  75-minute cap in AGENTS.md is raised for this release only; the history
  estimate is about 105 minutes for 101 drivers).
- Cleanup may archive or recycle files; never delete permanently.
- Only major direction decisions, or changes to how users interact with the
  app, go to Steve. Everything else is decided by the coordinator.
- Slow tools that are also slow in other applications (complex denoising,
  highlight reconstruction and similar heavy reconstruction) may stay over
  one second. They are recorded and listed, not fixed.

## Agreed tolerances (recorded here per "Work within tolerances")

| Measure | Pass | Reason |
| --- | --- | --- |
| Grade control: change to settled preview at Fit, 24 MP class photo, 2560x1440 | under 1.0 s | Steve's release bar |
| Grade control: same, 100% zoom | under 1.0 s, or recorded as an exception with reason | Steve's release bar |
| Live drag frame rate on a pointwise control | 20 frames/s or better at Fit | Matches the October local-drag baseline (31 frames/s) with headroom |
| "Slows other actions significantly" | another action's time rises more than 25% **and** more than 20 ms after using a control, or stays raised by that much after the control is reset | Run-to-run noise is about 5–10%, and these timings move in whole display frames (16.7 ms), so a rise smaller than about one frame is noise (refined by the coordinator after W1, November 11) |
| Timing repeat noise | judge against these limits, never against one earlier run | AGENTS.md |

## Workstreams

Each workstream runs in its own Git worktree on its own branch, made from
`main`. The coordinator merges branches into `main` one at a time.

| ID | Branch | Effort | Owns |
| --- | --- | --- | --- |
| W1 | `release/grade-performance` | high | Grade control inventory, timing sweep, timings table, fixes for slow controls |
| W2 | `release/audit-grade` | high | Bug hunt and dead code in Grade editor, preview and GPU frontend code (excluding export delivery) |
| W3 | `release/audit-library-desktop` | high | Bug hunt and dead code in Library frontend, Library backend API and the Electron desktop shell; Library delete, rename and move speed |
| W4 | `release/audit-backend` | high | Bug hunt and dead code in the Python backend (import, RAW, adjustments, sessions, render cache, export, Proof) |
| W5 | `release/export-repeat` | high | GPU export repeatability (November 8 to-do item 1) |
| W6 | `release/cleanup-docs` | medium | Repository cleanup, documents, release notes draft, version, `drivers.json` mapping |

After merging: the coordinator (or one agent) runs the fast suites and the
focused release check (`npm run test:release -- --release`), fixes or
records failures, bumps the version to 0.9.2, and, with Steve's go-ahead
already given for this release, pushes `main` and the `v0.9.2` tag. The
`Desktop release` GitHub workflow builds Windows, macOS and Linux packages and
publishes the release.

## Rules shared by every workstream

- **One graphics run at a time across all agents.** Any Electron, GPU or
  real-app run (`run-in-electron.js`, `run-native-electron.js`,
  `quick-library-check.cjs`, performance drivers) must hold the shared lock:
  create the folder `D:\AI\AI Projects\HDR Finisher Tool\gpu-run.lock` (the
  create must fail if it exists, e.g. `mkdir` without `-p`), write your
  branch name and start time into `owner.txt` inside it, run one driver,
  then remove the folder. If the lock exists, wait and retry; do not break
  another agent's lock unless `owner.txt` is older than 60 minutes. Fast
  Node and Python suites do not need the lock.
- **Atomic lock correction (W1, November 11):** do not use PowerShell
  `New-Item -ItemType Directory` as the atomic operation. Concurrent
  existence checks let three waiting launchers through on this machine.
  Python `os.mkdir` must create the folder directly and handle
  `FileExistsError`; eight simultaneous contenders were checked on drive D
  with exactly one winner. W1 uses `tools/run_grade_batch.py`, one controller,
  one driver per lock, and checks its owner token while the driver runs.
  The three affected W1 reports are explicitly invalidated; previous recorded
  W1 run intervals did not overlap each other.
- **Fast checks** before handing back, from `codebase`:
  `node --test tests/*.test.js` and `.venv/Scripts/python.exe -m pytest tests -q`.
- **Worktree setup:** if `codebase/node_modules` or `codebase/.venv` is
  missing in your worktree, make a directory junction to the one in
  `D:\AI\AI Projects\HDR Finisher Tool\ai\codebase` (never copy them). Do not
  commit the junctions.
- **Export and Proof are strict** (AGENTS.md "Still strict"). Any change that
  can alter exported or Proof pixels needs the export/Proof checks that
  cover it, and must not change output unless it fixes a bug you name.
- **No pinned number is loosened** (tolerances, limits, budgets, shader
  layouts) without the coordinator, who will take it to Steve.
- **Dead code:** remove only what you have shown is unused (no callers, no
  dynamic lookups by string, no HTML or IPC references, not used by tests or
  tools that are still listed in `drivers.json`). Old-project compatibility
  code may be removed (AGENTS.md "Old projects and old code"); say which
  projects are affected.
- **Simplify** only where it makes the code clearly easier to follow without
  changing behaviour. No large reorganisations or file moves this close to a
  release.
- **User-visible behaviour** must not change except to fix a bug. If a fix
  would change how users interact with the app, stop and report it instead.
- Small local commits, one subject each, with a short note of what was run.
  Rebase onto the current local `main` before handing back and rerun the
  fast checks. Do not push.
- Update the module PRD (and the user guide where behaviour changed) in the
  same commit as the code it describes. Timings go in
  `docs/technical/performance-table.md`.
- Disk: run `.venv/Scripts/python.exe tools/output_size.py` at the start and
  end if you run GPU or timing work; clean up what you made.

## Handback (every workstream)

A short plain-language report: what you fixed (one line each, with the
commit), what you removed, what you suspect but did not fix and why, checks
run and their results, anything Steve must decide.

## Not in this sprint

- Film-stock-parity half-precision shader limit (November 8 to-do item 3):
  waiting on Steve's decision.
- Retouch changes after Steve's November 2 review (no list from Steve yet).
- Installer signing, notarisation, new features.

## W8 backend-deep outcome (November 11)

- Fixed preview/scope retry hangs after source resize errors and stale reduced
  SDR noise models after switching the authored base (`a5696f30`). Regression
  tests reproduced both failures before the fixes and compare real results.
- Backend-wide symbol/import/route audit, excluding vendored and Library
  modules: cleanup commits remove 293 lines and add 13 replacement import
  lines (280 net removed). Includes the six named unused helpers, cache
  invalidators, constants, repair protocol, old scope tokens and five uncalled
  evidence/favorites HTTP routes. Removed the orphan evidence store/schema
  and its sole test, `test_evidence_store_round_trips_records`.
- No saved photo or test projects affected. Old browser observation records in
  `delivery-proof-evidence.json` are no longer consumed. Dynamic hue-sampling,
  candidate, returned Proof-tile and preset-deletion routes were verified and
  retained. No further unused settings/model fields were proven outside the
  retired evidence schema.
- Final rebased fast checks: Node 917 passed; Python 3,244 passed, 55 skipped.
  The formerly failing Library test was repaired on main before this final
  rebase and passes. Targeted render-cache/native-noise tests: 63 passed;
  Proof tests: 33 passed; project/repair checks: 31 passed.
- Graphics checks ran serially under the shared lock at 2560x1440. Adaptive
  Denoise GPU/CPU parity passed. Quick Library check completed with no photo
  errors or memory violations, but repeats the existing drawing-gap failure
  category (1,425 ms, unchanged 250 ms limit); retained report and timing note
  are in the performance table. Its first attempt failed only at report-time
  Git worktree ownership; the rerun used process-local safe.directory.
- Successful export/Proof pixels and files are unchanged; their removed
  helpers/storage were unreachable. The optional HDR-peak policy is untouched.
  No additional reproducible defect was found; the Library cadence failure
  remains outside W8. No push. Scratch output ends at 5.5 GB, predominantly
  the junction to existing test photos; graphics scratch/profiles cleaned by
  the drivers. The small quick-check report/logs remain for review.
