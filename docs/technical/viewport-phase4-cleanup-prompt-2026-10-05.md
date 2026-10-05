# Paste into the next thread — Phase 4 cleanup

## Goal

Phase 4 of the Viewport-Bounded GPU Preview sprint in HDR Finisher: remove the
code and the checks that the viewport-bounded design made unnecessary, so the
preview code is smaller and each remaining path is one that actually runs.
The app must behave the same afterwards. The purpose is to make future fixes
faster and safer for whoever works on this next, not to make the app faster.

When you are done Steve has: a list of what was removed and why, a test suite
in which every check either passes or fails for a named, real reason, and
measurements showing behaviour did not change against the October 5 baseline.

## Context

Workspace: `D:\AI\AI Projects\HDR Finisher Tool`. Git root: `ai`. Test and
run directory: `ai\codebase`. Branch: `viewport-bounded-preview-phase-2-wip`.
Check HEAD and status first; do not reset. Local commits are ahead of the
remote and have not been pushed.

Steve is the owner and not a coder. Explain in plain language. Put decisions
to him one at a time, each with the trade-off and what could break.

Read first, relative to the git root:

- `docs/product/Viewport_Bounded_GPU_Preview_PRD_2026-10-01.md`: section 2
  (principles), 5.5 (what phase 4 is), 7 (exit: "Removed code listed; suites
  green"), and all of section 15. Section 15.7 is the carry-forward list and
  the list of checks that still describe the old design.
- `docs/technical/viewport-phase3-baseline-before-cleanup-2026-10-05.md`: the
  "before" record. Every driver's result and the reason for each failure.
- `docs/technical/viewport-phase3-post-testing-next-thread-prompt-2026-10-03.md`:
  tools and working rules.

Raw baseline logs and reports are in the gitignored directory
`codebase/output/performance/review/phase3-baseline-2026-10-05/`
(`final-driver-ledger.json`, `classifications.json`, the three
`coverage-*.json` audits and `endurance-30min.json`).

For scale: `frontend/app.js` is about 19,300 lines and
`frontend/webgpu-preview.js` about 10,100. PRD 5.5 names the likely
candidates: request cancellation, shared compiles, cache eviction order,
background prewarming and CPU request coalescing that existed to manage
multi-second CPU jobs.

## Outcome spec

1. **An inventory before any deletion.** A short list of candidate removals,
   each with: what it is, why the current design no longer needs it, how you
   established that it does not run (or runs only as a fallback that is no
   longer reachable), and what would break if you are wrong. Put the list to
   Steve before deleting. Group it so he can approve by group.

2. **Removal in small batches.** Each batch is one coherent thing, validated
   on the fast checks, and committed locally on its own so it can be reverted
   alone. Run the slow GPU checks once per group of batches, not per batch.

3. **The out-of-date checks resolved.** Each check listed at the end of PRD
   15.7 is either rewritten to protect the same thing under the current
   design, or retired with the reason recorded. If a check protected
   something the new design still needs and nothing else covers it, say so
   rather than retiring it. The two timing races listed there are fixed in
   the test, not in the app.

4. **Behaviour unchanged, shown by measurement.** After the removals: the
   fast suites, the full driver sweep and the three coverage audits are
   repeated and compared with the baseline. A check that passed before still
   passes. A number that was inside its limit is still inside it. Report
   anything that moved, in either direction.

5. **A record.** PRD section 16 (phase 4 record) with the removed code listed
   by area and size, the checks rewritten or retired, the before/after
   comparison, and anything deliberately left in place and why. Update
   `docs/known-limitations.md` where it is out of date (it is dated September
   4 and still says there is no Denoise).

## Constraints

- **The CPU path stays.** CPU export and Proof are the exact reference and
  are not touched. The CPU preview fallback for a missing or lost GPU stays
  and must still work; `tests/device-loss-fallback.js` passes before and
  after. Remove only what the viewport-bounded design made unnecessary.
- **Do not delete around an unconfirmed finding.** Phase 3 closed with open
  items (PRD 15.7: CF-PIX, CF-PEAK, CF-SPEED, CF-ROUTE, CF-DRIFT). Steve
  chose to start cleanup before confirming them. Where a candidate removal
  touches the code one of those items points at, confirm the item first or
  leave that code alone and say so. The CF-ROUTE items matter most here: a
  CPU route that still fires in the audits is not dead code.
- **No fixes mixed in.** If you find a real defect, report it and add it to
  15.7. Do not fix it inside a cleanup batch.
- **Nothing in the picture changes.** No tolerance, limit, budget or pinned
  shader changes. The 4,194,304-pixel editing-Peak budget, the Peak and
  Denoise shader byte pins, and every deferral and acceptance in PRD 15.1 and
  15.2 stay as they are. If a removal would require changing a pinned shader,
  stop and ask.
- **No check is deleted to make a run green.**
- Saved projects keep opening: no project-file or preference change without a
  migration that is tested.
- GPU checks run one at a time through `tests/run-in-electron.js` (or
  `tests/run-native-electron.js` for drivers that launch the app themselves)
  with `HDR_FINISHER_ELECTRON_WINDOW_SIZE=2560x1440`. Never overlap them.
- Fast checks: `node --test tests/*.test.js` (427 pass) and
  `codebase/.venv/Scripts/python.exe -m pytest tests -q` (1,692 pass, three
  skipped). Use the `.venv` Python; the system Python fails one test
  spuriously.
- Never save over the read-only fixtures; verify their SHA-256 afterwards
  (table in the baseline evidence).
- Source files have mixed line endings and some tests match `\n` literally.
  Preserve each file's existing endings; do not normalise whole files. To
  compare against a committed version, read it with `git cat-file blob`
  rather than `git checkout`, which rewrites line endings on this machine.
- Commit locally per batch. Ask Steve before pushing. Do not rebuild the
  installer unless he asks.

## Questions protocol

Ask Steve before: deleting anything on the inventory he has not approved,
retiring a check that has no replacement, touching anything a carry-forward
item points at, or anything that conflicts with what the code or the PRD
says. If something that looked dead turns out to run, stop and report it;
that is a finding, not an obstacle.
