# Codex Brief — 0.9.1 focused release check

## HDR Finisher

**Date:** October 16, 2026
**Branch:** `film-look-rebuild` (do not switch branches)

Read `ai/AGENTS.md` first. **This replaces the earlier version of this brief.**
That version asked for the full sweep with coverage, endurance and timing
checks. You estimated it at 4 h 50 min, which is too long for this app before
1.0. Steve chose a focused check instead (October 16, 2026). AGENTS.md now
uses this as the standard release check.

## Goal

Find out whether `film-look-rebuild` is fit to become 0.9.1, in about an hour of
slow tests. When you finish, Steve should have a short
plain-language answer: what passed, what failed, and which failures are new.
Also prepare the 0.9.1 version number and draft release notes as local
commits. **Do not merge, tag or push anything.** Steve decides that after
reading your report.

## Context

- `main` is still at 0.9.0 (`e4274ae`, tagged `v0.9.0`, already published).
  `film-look-rebuild` is 201 commits ahead and contains all of
  `photo-library` and `film-stocks-phase-1`. The eventual merge is a
  fast-forward.
- Since 0.9.0 the main additions are the Photo Library, Film Stocks, the Film
  Look rebuild (phases 1–6), the lens filters that replaced Bloom, the extreme
  HDR preview range work, and Library speed work.
- Fast checks already pass at `37e6e93`: 497 Node tests and 2,204 Python tests
  (3 skipped). Rerun them only if you change code.
- The 0.9.0 run is your template and baseline:
  `codebase/output/performance/review/prerelease-0.9-2026-10-09/`. It has the
  runner (`run-sweep.cjs`), invocation fixes, read-only project hashes and
  per-driver results. `docs/known-limitations.md`, section "v0.9 pre-release
  validation", lists the failures already known at 0.9.0.

## What to run

Sequentially, one at a time, at `HDR_FINISHER_ELECTRON_WINDOW_SIZE=2560x1440`.
Put results in
`codebase/output/performance/review/prerelease-0.9.1-2026-10-16/`.

| Group | Drivers | Why |
|---|---|---|
| Export and Proof | `performance/export-parity.js`, `performance/preview-export-compare.js`, `proof-size-interaction.js`, `export-presets-interaction.js`, `export-file-browser-interaction.js`, `desktop/tests/proof-grade-diagnostic.js` | AGENTS.md "Still strict": mistakes here are silent and damage Steve's files |
| Film | `film-stock-parity.js`, `film-character-ui-check.js`, `film-panel-ui-check.js`, `film-presets-ui-check.js`, `grain-parity.js`, `tiled-film-parity.js`, `performance/tier-film-consistency.js`, `performance/film-look-interaction.js` | Rebuilt since 0.9.0 |
| Lens filters | `lens-filter-parity.js`, `lens-filter-tiled-parity.js` | New since 0.9.0 |
| Library | Every `library-*.js` and `photo-library-*.js` directly in `tests/` (not the speed trials in `tests/performance/`) | New since 0.9.0 |
| Core preview | `webgpu-shader-compilation.js`, `electron-initial-load.js`, `gpu-param-layout-audit.js`, `gpu-highlight-compression-parity.js`, `tiled-direct-parity.js`, `tiled-cpu-detail-parity.js`, `sdr-gamut-gpu-parity.js`, `performance/roi-parity.js`, `ui-refinement-detail-qa.js` | Basic preview and shader health; each takes seconds |

If a driver on this list no longer exists or has been renamed, use the current
equivalent and say so. Do **not** run the rest of the sweep, the coverage
audit, the endurance run, timing sweeps or the Library speed trials. Speed is
judged by Steve using the app.

Record the three read-only project hashes before and after, as 0.9.0 did. They
must not change. Never save over those projects.

## Allowed changes during the check

- **Out-of-date drivers.** Update a driver on the list that still uses removed
  settings (Bloom, the wavelet Denoise, old Film Look fields) so it tests the
  feature as it is now. Use a separate small commit for each.
- **Wording-only failures.** Replace the test with a check on the result if
  that is practical. Otherwise update the expectation, and say so in the
  commit.
- **No application fixes.** Do not change any tolerance, limit, budget or
  pinned shader value. If a failure looks like a real app bug, record it and
  carry on.
- **Failures.** Rerun each failure once. Classify it as **known** (on the
  0.9.0 list with the same message), **flaky** (passed on rerun), **driver out
  of date** (fixed as above) or **new**. Investigate a new failure only far
  enough to name the likely area in one line.

## Release preparation (local commits only)

1. Set the version to 0.9.1 wherever the app reads it (at least
   `codebase/desktop/package.json`). Do not touch the archived copies under
   `output/`.
2. Put a 0.9.1 entry at the top of `RELEASE_NOTES.md`, written the way the
   0.9.0 entry is: plain language, grouped by what the user notices, with no
   internal names. Use the commit log `v0.9.0..HEAD`. Include a short "Changed
   or removed" note: Bloom has been replaced by the lens filters, and projects
   or presets that used removed settings must be recreated (pre-1.0, no
   migration).

Do not create any tag. Pushing a `v*` tag starts the GitHub release build.

## Records

- Add one short section to `docs/known-limitations.md`, "v0.9.1 pre-release
  check (October 16, 2026)". Give the revision, the counts, the failures by
  class and where the logs are, and say plainly that this was the focused
  check, not the full sweep. No per-measurement tables.
- Leave the two untracked October 13 Library briefs in `docs/` alone.

## Stop and ask

- If the slow tests pass about 75 minutes, stop and report what is left.
- If the GPU device is lost repeatedly, or the read-only hashes change, stop
  and report.

## Report back to Steve

Plain language and short:

1. A one-line verdict: ready for 0.9.1, ready with known issues, or not ready.
2. Counts: passed, failed, skipped. Then each failure in one line, with its
   class.
3. Any **new** failure, in words Steve can follow, with what it would affect
   in use.
4. Which drivers you updated, and why.
5. The local commits you made, ready for Steve to review before merge, tag and
   push.
