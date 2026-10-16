# Codex Brief — 0.9.1 release validation

## HDR Finisher

**Date:** October 16, 2026
**Branch:** `film-look-rebuild` (do not switch branches)

Read `ai/AGENTS.md` first. This is a **release point**, so its "Release points
only" checks apply in full. Steve approved running them for this release.

## Goal

Find out whether `film-look-rebuild` is fit to become 0.9.1. When you finish,
Steve should have a short plain-language answer: what passed, what failed, and
which failures are new since 0.9.0. Also prepare the 0.9.1 version number and
draft release notes as local commits. **Do not merge, tag or push anything.**
Steve decides that after reading your report.

## Context

- `main` is still at 0.9.0 (`e4274ae`, tagged `v0.9.0`, already published).
  `film-look-rebuild` is 201 commits ahead and contains all of
  `photo-library` and `film-stocks-phase-1`. Nothing on `main` is missing from
  it, so the eventual merge is a fast-forward.
- Since 0.9.0 the main additions are the Photo Library, Film Stocks and the
  Film Look rebuild (phases 1–6), the extreme HDR preview range work, the
  physical lens filter model (Bloom removed), and Library speed work.
- Fast checks already pass at `37e6e93` (October 16): 497 Node tests and
  2,204 Python tests (3 skipped). Do not rerun them unless you change code.
- The 0.9.0 sweep is your template and baseline:
  `codebase/output/performance/review/prerelease-0.9-2026-10-09/`. It has the
  runner (`run-sweep.cjs`), the driver plan, invocation fixes, read-only
  project hashes and per-driver results. It ran 149 drivers in about 51
  minutes: 139 passed, 10 failed. `docs/known-limitations.md` section
  "v0.9 pre-release validation" explains each failure and the seven that were
  already known (Black & White parity, scope parity, editing-peak Clarity
  reference, local design QA, drag GPU load, luma-feather latency, tier-film
  consistency).
- `docs/known-limitations.md` says several older performance drivers still use
  removed Bloom recipes and need updating before this sweep.

## What to run

Put everything in a new folder:
`codebase/output/performance/review/prerelease-0.9.1-2026-10-16/`.

| Part | What it covers |
|---|---|
| Driver sweep | Every current Electron driver under `codebase/tests` and `codebase/tests/performance`, built from the files on disk today rather than copied from the 0.9.0 list, so the new Library, Film Stock and Film Look drivers are included. Sequential, at `HDR_FINISHER_ELECTRON_WINDOW_SIZE=2560x1440`. Leave out drivers whose feature has been removed and list them. Treat pure measurement probes as information, not pass or fail. |
| Coverage audit | `tests/performance/phase3-coverage-audit.js`, or whatever replaces it today. |
| Endurance | `tests/performance/phase5-endurance.js`, or whatever replaces it today. |
| Broad timing | The headline timing and drag/zoom timing drivers, judged against their recorded tolerances, not against single earlier runs. |
| Desktop unit checks | The desktop shell's own unit checks, as in 0.9.0. |

Record the three read-only project hashes before and after, as 0.9.0 did. They
must not change. Never save over those projects.

## Allowed changes during validation

- **Out-of-date drivers.** Update a driver that still uses removed settings
  (Bloom, the wavelet Denoise, old Film Look fields) so it tests the feature
  as it is now. This is the "Update" or "Remove" case in AGENTS.md. Keep each
  in its own small commit, saying what the driver now checks.
- **Wording-only failures.** Replace the test with a check on the result if
  that is practical. Otherwise update the expectation, and say so in the
  commit.
- **No application fixes.** No tolerance, limit, budget or pinned shader
  value changes. If a failure looks like a real app bug, record it and carry
  on. Steve will decide what to fix.
- **Failures.** Rerun each failure once. Classify it as **known** (on the
  0.9.0 list with the same message), **flaky** (passed on rerun), **driver
  out of date** (fixed as above), or **new**. Investigate a new failure only
  far enough to name the likely area in one line.

## Release preparation (local commits only)

1. Set the version to 0.9.1 wherever the app reads it (at least
   `codebase/desktop/package.json`). Do not touch the archived copies under
   `output/`.
2. Put a 0.9.1 entry at the top of `RELEASE_NOTES.md`, written the way the
   0.9.0 entry is: plain language, grouped by what the user notices, with
   no internal names. Read the commit log `v0.9.0..HEAD` to write it.
   Include a short "Changed or removed" note: Bloom has been replaced by the
   lens filters, and projects or presets that used removed settings must be
   recreated (pre-1.0, no migration).

Pushing a `v*` tag starts the GitHub release build, so do not create any tag.

## Records

- One short addition to `docs/known-limitations.md`, "v0.9.1 pre-release
  validation (October 16, 2026)", in the style of the 0.9.0 section: revision,
  counts, the failures by class, and where the logs are. No per-measurement
  tables.
- Leave the two untracked October 13 Library briefs in `docs/` alone. They
  are not part of this work.

## Stop and ask

- If, once the driver list is built, the whole run looks like more than about
  four hours, stop and report the estimate first.
- If the GPU device is lost repeatedly, or the read-only hashes change, stop
  and report.

## Report back to Steve

Plain language and short:

1. A one-line verdict: ready for 0.9.1, ready with known issues, or not ready.
2. Counts: passed, failed, skipped. Then each failure in one line, with its
   class.
3. Any failure that is **new** since 0.9.0, in words Steve can follow, with
   what it would affect in use.
4. Which drivers you updated or removed, and why.
5. The local commits you made (version bump, release notes, driver updates,
   records), ready for Steve to review before merge, tag and push.
